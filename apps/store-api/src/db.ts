import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, types, type PoolClient } from 'pg';
import { eventSchema, type Product, type StoreEvent, type Order } from '@store/contracts';
import { schema } from './schema.js';

export const defaultDatabaseUrl = 'postgresql://store:store@127.0.0.1:5432/store';
// Counts and event sequences are consumed as JSON numbers. Reject precision loss.
types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe JSON range');
  return number;
});
export class Store {
  private readonly context = new AsyncLocalStorage<PoolClient>();
  private readonly pool: Pool;
  readonly db;
  private constructor(url: string, namespace: string) {
    if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('Use a PostgreSQL connection URL');
    if (!/^[a-z][a-z0-9_]*$/.test(namespace)) throw new Error('Invalid database schema');
    this.pool = new Pool({
      connectionString: url,
      options: `-c search_path=${namespace}`,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (error) =>
      console.error('Idle PostgreSQL connection error:', error.message),
    );
    this.db = {
      prepare: (sql: string) => ({
        get: async (...params: unknown[]) =>
          (await this.query(sql, params)).rows[0] as Record<string, any> | undefined,
        all: async (...params: unknown[]) =>
          (await this.query(sql, params)).rows as Record<string, any>[],
        run: async (...params: unknown[]) => {
          await this.query(sql, params);
        },
      }),
      exec: async (sql: string) => {
        await this.query(sql);
      },
      close: () => this.pool.end(),
    };
  }
  static async open(
    url = process.env.STORE_DATABASE_URL ?? defaultDatabaseUrl,
    namespace = 'public',
  ) {
    const store = new Store(url, namespace);
    try {
      await store.transaction(async () => {
        await store.db.exec(schema);
        await store.db
          .prepare('INSERT INTO metadata VALUES($1,$2) ON CONFLICT DO NOTHING')
          .run('sourceId', randomUUID());
      });
      return store;
    } catch (error) {
      await store.db.close();
      throw error;
    }
  }
  private query(sql: string, params: unknown[] = []) {
    return (this.context.getStore() ?? this.pool).query(sql, params);
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize store mutations and snapshots, including across API processes.
      // A transactional event counter avoids sequence holes after rollbacks.
      await client.query('SELECT pg_advisory_xact_lock(731024, hashtext(current_schema()))');
      const result = await this.context.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async product(id: string): Promise<Product | undefined> {
    const row = await this.db.prepare('SELECT * FROM products WHERE id=$1').get(id);
    return row ? ({ ...row, available: Boolean(row.available) } as Product) : undefined;
  }
  async cart(shopperId: string) {
    const rows = await this.db
      .prepare(
        'SELECT p.*, c.quantity FROM carts c JOIN products p ON p.id=c."productId" WHERE c."shopperId"=$1 ORDER BY p.id',
      )
      .all(shopperId);
    return rows.map(({ quantity, ...product }) => ({
      product: { ...product, available: Boolean(product.available) } as Product,
      quantity: Number(quantity),
    }));
  }
  async order(id: string): Promise<Order> {
    const row = (await this.db
      .prepare('SELECT id,"shopperId","sessionId","createdAt","totalCents" FROM orders WHERE id=$1')
      .get(id))!;
    return {
      ...row,
      items: await this.db
        .prepare(
          'SELECT "productId",name,quantity,"unitPriceCents" FROM order_items WHERE "orderId"=$1 ORDER BY "productId"',
        )
        .all(id),
    } as Order;
  }
  async setCartQuantity(shopperId: string, productId: string, quantity: number): Promise<void> {
    if (quantity === 0)
      await this.db
        .prepare('DELETE FROM carts WHERE "shopperId"=$1 AND "productId"=$2')
        .run(shopperId, productId);
    else
      await this.db
        .prepare(
          'INSERT INTO carts VALUES($1,$2,$3) ON CONFLICT("shopperId","productId") DO UPDATE SET quantity=excluded.quantity',
        )
        .run(shopperId, productId, quantity);
  }
  async clearCart(shopperId: string): Promise<void> {
    await this.db.prepare('DELETE FROM carts WHERE "shopperId"=$1').run(shopperId);
  }
  async orderForCheckout(sessionId: string, idempotencyKey: string): Promise<Order | undefined> {
    const row = await this.db
      .prepare('SELECT id FROM orders WHERE "sessionId"=$1 AND "idempotencyKey"=$2')
      .get(sessionId, idempotencyKey);
    return row ? this.order(String(row.id)) : undefined;
  }
  // The caller owns the transaction spanning this insert and its other changes.
  async createOrder(order: Order, idempotencyKey: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO orders VALUES($1,$2,$3,$4,$5,$6)')
      .run(
        order.id,
        order.shopperId,
        order.sessionId,
        order.createdAt,
        order.totalCents,
        idempotencyKey,
      );
    for (const item of order.items)
      await this.db
        .prepare('INSERT INTO order_items VALUES($1,$2,$3,$4,$5)')
        .run(order.id, item.productId, item.name, item.quantity, item.unitPriceCents);
  }
  async append(input: StoreEvent): Promise<void> {
    if (!this.context.getStore()) return this.transaction(() => this.append(input));
    const event = eventSchema.parse(input);
    const existing = await this.db.prepare('SELECT payload FROM events WHERE id=$1').get(event.id);
    if (existing) {
      const previous = JSON.parse(String(existing.payload));
      if (JSON.stringify({ ...previous, ingestedAt: event.ingestedAt }) !== JSON.stringify(event))
        throw new Error('Event ID conflicts with existing payload');
      return;
    }
    const session = await this.db
      .prepare('SELECT "shopperId","startedAt" FROM sessions WHERE id=$1')
      .get(event.sessionId);
    if (!session || session.shopperId !== event.shopperId)
      throw new Error('Invalid event identity');
    if (event.occurredAt < String(session.startedAt)) throw new Error('Event precedes session');
    if (event.context.productId) {
      const product = await this.product(event.context.productId);
      if (!product || product.listedAt > event.occurredAt)
        throw new Error('Product not listed at event time');
    }
    if (event.type === 'click') {
      const row = await this.db
        .prepare('SELECT payload FROM events WHERE id=$1')
        .get(event.context.impressionId!);
      const impression = row ? (JSON.parse(String(row.payload)) as StoreEvent) : undefined;
      if (
        !impression ||
        impression.type !== 'impression' ||
        impression.sessionId !== event.sessionId ||
        impression.context.productId !== event.context.productId ||
        impression.context.surface !== event.context.surface ||
        impression.context.position !== event.context.position ||
        impression.occurredAt > event.occurredAt
      )
        throw new Error('Click has no matching prior impression');
    }
    if (event.type === 'purchase') {
      const order = await this.db
        .prepare('SELECT "sessionId","createdAt" FROM orders WHERE id=$1')
        .get(event.context.orderId!);
      if (!order || order.sessionId !== event.sessionId || order.createdAt !== event.occurredAt)
        throw new Error('Purchase must match order');
    }
    await this.db.exec('UPDATE event_counter SET value=value+1 WHERE id=1');
    await this.db
      .prepare(
        'INSERT INTO events(seq,id,type,"occurredAt","ingestedAt","shopperId","sessionId",source,payload) SELECT value,$1,$2,$3,$4,$5,$6,$7,$8 FROM event_counter WHERE id=1',
      )
      .run(
        event.id,
        event.type,
        event.occurredAt,
        event.ingestedAt,
        event.shopperId,
        event.sessionId,
        event.source,
        JSON.stringify(event),
      );
  }
  async event(
    session: {
      id: string;
      shopperId: string;
    },
    type: StoreEvent['type'],
    context: StoreEvent['context'],
    time = new Date().toISOString(),
    source: StoreEvent['source'] = 'store_backend',
  ) {
    await this.append({
      schemaVersion: 1,
      id: randomUUID(),
      type,
      occurredAt: time,
      ingestedAt: time,
      shopperId: session.shopperId,
      sessionId: session.id,
      source,
      context,
    });
  }
  async seedPersonas() {
    for (const [id, name] of [
      ['persona-home', 'Alex · home projects'],
      ['persona-active', 'Sam · active days'],
      ['persona-family', 'Jo · family essentials'],
    ]) {
      await this.db
        .prepare('INSERT INTO shoppers VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING')
        .run(id, name, 'persona', '2025-01-01T00:00:00.000Z');
    }
  }
}
