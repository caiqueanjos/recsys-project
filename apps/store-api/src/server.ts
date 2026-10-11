import Fastify, { type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { browserTypes, eventSchema, type Session, type StoreEvent } from '@store/contracts';
import { Store } from './db.js';
import { CartService } from './services/cart.js';
import { CheckoutService } from './services/checkout.js';
import { StoreOperationError } from './services/errors.js';

export async function buildServer(providedStore?: Store) {
  const store = providedStore ?? (await Store.open());
  const cartService = new CartService(store);
  const checkoutService = new CheckoutService(store);
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await store.seedPersonas();
  const fail = (message: string, statusCode = 400): never => {
    throw Object.assign(new Error(message), { statusCode });
  };
  const session = async (req: FastifyRequest): Promise<Session> => {
    const id = req.headers['x-session-id'];
    if (typeof id !== 'string') return fail('Session required', 401);
    const row = (await store.db
      .prepare('SELECT * FROM sessions WHERE id=$1 AND source=$2')
      .get(id, 'live')) as Session | undefined;
    if (!row || Date.now() - Date.parse(row.lastActiveAt) > 30 * 60_000)
      return fail('Session expired; start a new session', 401);
    await store.db
      .prepare('UPDATE sessions SET "lastActiveAt"=$1 WHERE id=$2')
      .run(new Date().toISOString(), id);
    return row;
  };
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & {
      statusCode?: number;
    };
    const statusCode =
      e instanceof StoreOperationError
        ? e.code === 'product_not_found'
          ? 404
          : 409
        : e instanceof z.ZodError
          ? 400
          : (e.statusCode ?? 400);
    reply.code(statusCode).send({ error: e.message });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get(
    '/personas',
    async () =>
      await store.db.prepare("SELECT * FROM shoppers WHERE kind='persona' ORDER BY id").all(),
  );
  app.post('/shoppers', async () => {
    const shopper = {
      id: randomUUID(),
      name: 'Guest',
      kind: 'anonymous',
      createdAt: new Date().toISOString(),
    };
    await store.db
      .prepare('INSERT INTO shoppers VALUES($1,$2,$3,$4)')
      .run(shopper.id, shopper.name, shopper.kind, shopper.createdAt);
    return shopper;
  });
  app.post('/sessions', async (req) => {
    const { shopperId } = z.object({ shopperId: z.string() }).parse(req.body);
    if (
      !(await store.db
        .prepare("SELECT id FROM shoppers WHERE id=$1 AND kind != 'synthetic'")
        .get(shopperId))
    )
      fail('Shopper not found', 404);
    const now = new Date().toISOString();
    const result: Session = {
      id: randomUUID(),
      shopperId,
      startedAt: now,
      lastActiveAt: now,
      source: 'live',
    };
    await store.db
      .prepare('INSERT INTO sessions VALUES($1,$2,$3,$4,$5)')
      .run(result.id, shopperId, now, now, 'live');
    return result;
  });
  app.get('/products', async (req) => {
    const { q, category, page, limit } = z
      .object({
        q: z.string().max(200).default(''),
        category: z.string().default(''),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(24),
      })
      .parse(req.query);
    const params = [new Date().toISOString(), `%${q}%`, `%${q}%`, category, category];
    const where =
      '"listedAt"<=$1 AND (name ILIKE $2 OR description ILIKE $3) AND ($4=\'\' OR category=$5)';
    const rows = await store.db
      .prepare(`SELECT id FROM products WHERE ${where} ORDER BY id LIMIT $6 OFFSET $7`)
      .all(...params, limit, (page - 1) * limit);
    return {
      items: await Promise.all(rows.map(async (row) => await store.product(String(row.id)))),
      total: (await store.db
        .prepare(`SELECT count(*) AS n FROM products WHERE ${where}`)
        .get(...params))!.n,
      page,
      limit,
    };
  });
  app.get('/products/:id', async (req) => {
    const { id } = req.params as {
      id: string;
    };
    const product = await store.product(id);
    if (!product || product.listedAt > new Date().toISOString())
      return fail('Product not found', 404);
    return product;
  });
  app.get('/trending', async () => {
    const rows = await store.db.prepare('SELECT "productId" FROM trending ORDER BY position').all();
    const products = await Promise.all(rows.map((row) => store.product(String(row.productId))));
    return products.filter((p) => p && p.listedAt <= new Date().toISOString());
  });
  app.get('/cart', async (req) => await store.cart((await session(req)).shopperId));
  app.put('/cart/:productId', async (req) => {
    const s = await session(req),
      { productId } = req.params as {
        productId: string;
      };
    const { quantity } = z.object({ quantity: z.number().int().min(0).max(99) }).parse(req.body);
    return cartService.setQuantity(s, productId, quantity);
  });
  app.post('/checkout', async (req) => {
    const s = await session(req);
    const { idempotencyKey } = z
      .object({ idempotencyKey: z.string().min(1).max(128) })
      .parse(req.body);
    return checkoutService.execute(s, idempotencyKey);
  });
  app.get('/orders', async (req) => {
    const s = await session(req);
    return Promise.all(
      (
        await store.db
          .prepare('SELECT id FROM orders WHERE "shopperId"=$1 ORDER BY "createdAt" DESC')
          .all(s.shopperId)
      ).map(async (row) => await store.order(String(row.id))),
    );
  });
  app.post('/events', async (req) => {
    const s = await session(req),
      now = new Date().toISOString();
    const { events } = z
      .object({
        events: z
          .array(
            z
              .object({
                id: z.string(),
                type: z.enum(browserTypes),
                occurredAt: z.iso.datetime(),
                context: z.unknown(),
              })
              .strict(),
          )
          .max(100),
      })
      .parse(req.body);
    await store.transaction(async () => {
      for (const input of events) {
        if (Date.parse(input.occurredAt) > Date.now() + 60_000) fail('Future event timestamp');
        const event = eventSchema.parse({
          ...input,
          schemaVersion: 1,
          ingestedAt: now,
          shopperId: s.shopperId,
          sessionId: s.id,
          source: 'browser',
        }) as StoreEvent;
        await store.append(event);
      }
    });
    return { accepted: events.length };
  });
  app.addHook('onClose', async () => {
    if (!providedStore) await store.db.close();
  });
  return app;
}
