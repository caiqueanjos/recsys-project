# 4. Replace the mock store with PostgreSQL

You will replace the in-memory dependency behind your existing HTTP API, keep the React checkout screen working, and prove that carts, orders, and retry keys survive an API restart. Continue in **your `store-lab`** from lesson 3.

Before starting, complete the Docker preflight in [machine setup](../how-to/prepare-your-machine.md) and read **Before lesson 4** in [learning foundations](../explanation/learning-foundations.md). Stop the lab API while replacing its files; leave the frontend available for later checks.

## 1. Start the lab database

Create `compose.yaml` in the lab root:

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: lab
      POSTGRES_PASSWORD: lab
      POSTGRES_DB: lab
    ports:
      - '127.0.0.1:5434:5432'
    volumes:
      - lab-postgres:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U lab -d lab']
      interval: 2s
      timeout: 5s
      retries: 30
volumes:
  lab-postgres:
```

From the lab root:

```sh
docker compose up -d --wait
npm install -w @learn/api pg@8
npm install -D @types/pg@8
```

Expect a healthy database. Port 5434 separates the lab from the reference project's port 5432. The adapter keeps its tables in a `tutorial` schema, a named namespace within the database.

## 2. Define the durable state

Create `apps/store-api/src/lab-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS shoppers (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL REFERENCES shoppers(id), started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0), available BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS carts (
  shopper_id TEXT REFERENCES shoppers(id), product_id TEXT REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  PRIMARY KEY (shopper_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  retry_key TEXT NOT NULL, created_at TEXT NOT NULL,
  total_cents INTEGER NOT NULL, items JSONB NOT NULL,
  UNIQUE (session_id, retry_key)
);
CREATE TABLE IF NOT EXISTS event_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL
);
INSERT INTO event_counter VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL,
  occurred_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id), payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Events are append-only'; END;
$$;
CREATE OR REPLACE TRIGGER events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON events
FOR EACH STATEMENT EXECUTE FUNCTION reject_event_mutation();
```

Trace these relations before continuing: a cart row references a shopper/product; an order references a session; a session identifies its shopper. Order `items` retain names/prices as JSON snapshots. Events store raw JSON text plus append/receipt metadata. The singleton counter increments in the same transaction as each event. The trigger rejects event mutation.

This is a teaching schema. It omits session expiry and full product attributes, and uses JSON order items instead of the reference project's separate item table. We define event and metadata tables now so later lessons can extend the API without an undocumented schema migration.

## 3. Implement the same store operations asynchronously

Keep `checkout.ts` and `catalog.ts` from earlier lessons: the first exports the order type; the second now supplies seed fixtures. Create `apps/store-api/src/pg-store.ts`:

```ts
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { Product } from '@learn/contracts';
import type { Order } from './checkout.js';
import { products } from './catalog.js';

type Context = Record<string, unknown>;
export class PgStore {
  readonly pool: Pool;
  constructor(
    readonly namespace: string,
    url: string,
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(namespace)) throw new Error('Invalid schema name');
    this.pool = new Pool({ connectionString: url, options: `-c search_path=${namespace}` });
  }
  static async open(
    url = process.env.LAB_DATABASE_URL ?? 'postgresql://lab:lab@127.0.0.1:5434/lab',
    namespace = 'tutorial',
  ) {
    const store = new PgStore(namespace, url);
    try {
      await store.pool.query(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`);
      await store.transaction(async (client) => {
        await client.query(readFileSync(new URL('./lab-schema.sql', import.meta.url), 'utf8'));
        await client.query('INSERT INTO metadata VALUES ($1,$2) ON CONFLICT DO NOTHING', [
          'sourceId',
          randomUUID(),
        ]);
        for (const shopperId of ['alex', 'sam']) {
          await client.query('INSERT INTO shoppers VALUES ($1) ON CONFLICT DO NOTHING', [
            shopperId,
          ]);
        }
        for (const p of products) {
          await client.query('INSERT INTO products VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
            p.id,
            p.name,
            p.priceCents,
            p.available,
          ]);
        }
      });
      return store;
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(48004, hashtext(current_schema()))');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async start(shopperId: string) {
    const exists = await this.pool.query('SELECT id FROM shoppers WHERE id=$1', [shopperId]);
    if (!exists.rows.length) throw new Error('Unknown demo shopper');
    const id = randomUUID();
    await this.pool.query('INSERT INTO sessions VALUES ($1,$2,$3)', [
      id,
      shopperId,
      new Date().toISOString(),
    ]);
    return { id, shopperId };
  }
  async catalog(q = ''): Promise<Product[]> {
    return (
      await this.pool.query(
        'SELECT id,name,price_cents AS "priceCents",available FROM products WHERE name ILIKE $1 ORDER BY id',
        [`%${q}%`],
      )
    ).rows;
  }
  async product(id: string): Promise<Product | undefined> {
    return (
      await this.pool.query(
        'SELECT id,name,price_cents AS "priceCents",available FROM products WHERE id=$1',
        [id],
      )
    ).rows[0];
  }
  async sessionOn(client: PoolClient, sessionId: string) {
    const row = (await client.query('SELECT * FROM sessions WHERE id=$1', [sessionId])).rows[0];
    if (!row) throw new Error('Session required');
    return row;
  }
  async cartOn(client: PoolClient, sessionId: string): Promise<Order['items']> {
    const session = await this.sessionOn(client, sessionId);
    return (
      await client.query(
        'SELECT p.id AS "productId",p.name,c.quantity,p.price_cents AS "unitPriceCents" FROM carts c JOIN products p ON p.id=c.product_id WHERE c.shopper_id=$1 ORDER BY p.id',
        [session.shopper_id],
      )
    ).rows;
  }
  async cart(sessionId: string) {
    return this.transaction((client) => this.cartOn(client, sessionId));
  }
  async appendOn(
    client: PoolClient,
    sessionId: string,
    type: string,
    context: Context,
    id = randomUUID() as string,
    occurredAt = new Date().toISOString(),
    source = 'store_backend',
  ) {
    const session = await this.sessionOn(client, sessionId);
    if (occurredAt < session.started_at) throw new Error('Event precedes session');
    const event = {
      schemaVersion: 1,
      id,
      type,
      occurredAt,
      ingestedAt: new Date().toISOString(),
      shopperId: session.shopper_id,
      sessionId,
      source,
      context,
    };
    const prior = (await client.query('SELECT payload FROM events WHERE id=$1', [id])).rows[0];
    if (prior) {
      const old = JSON.parse(prior.payload);
      if (JSON.stringify({ ...old, ingestedAt: event.ingestedAt }) !== JSON.stringify(event)) {
        throw new Error('Event ID conflicts with existing payload');
      }
      return id;
    }
    const next = (
      await client.query('UPDATE event_counter SET value=value+1 WHERE id=1 RETURNING value')
    ).rows[0].value;
    await client.query('INSERT INTO events VALUES ($1,$2,$3,$4,$5,$6)', [
      next,
      id,
      event.occurredAt,
      event.ingestedAt,
      sessionId,
      JSON.stringify(event),
    ]);
    return id;
  }
  async set(sessionId: string, productId: string, quantity: number) {
    return this.transaction(async (client) => {
      const session = await this.sessionOn(client, sessionId);
      const product = (await client.query('SELECT * FROM products WHERE id=$1', [productId]))
        .rows[0];
      if (!product || (quantity > 0 && !product.available)) throw new Error('Product unavailable');
      const prior =
        (
          await client.query('SELECT quantity FROM carts WHERE shopper_id=$1 AND product_id=$2', [
            session.shopper_id,
            productId,
          ])
        ).rows[0]?.quantity ?? 0;
      if (prior !== quantity) {
        if (quantity === 0)
          await client.query('DELETE FROM carts WHERE shopper_id=$1 AND product_id=$2', [
            session.shopper_id,
            productId,
          ]);
        else
          await client.query(
            'INSERT INTO carts VALUES ($1,$2,$3) ON CONFLICT (shopper_id,product_id) DO UPDATE SET quantity=excluded.quantity',
            [session.shopper_id, productId, quantity],
          );
        await this.appendOn(
          client,
          sessionId,
          quantity === 0 ? 'cart_remove' : prior === 0 ? 'cart_add' : 'cart_update',
          { productId, quantity },
        );
      }
      return this.cartOn(client, sessionId);
    });
  }
  async checkout(sessionId: string, key: string, injectFailure = false): Promise<Order> {
    return this.transaction(async (client) => {
      const session = await this.sessionOn(client, sessionId);
      const prior = (
        await client.query(
          'SELECT id,total_cents AS "totalCents",items FROM orders WHERE session_id=$1 AND retry_key=$2',
          [sessionId, key],
        )
      ).rows[0];
      if (prior) return { ...prior, shopperId: session.shopper_id, sessionId };
      const items = await this.cartOn(client, sessionId);
      if (!items.length) throw new Error('Cart is empty');
      const unavailable = await client.query(
        'SELECT 1 FROM carts c JOIN products p ON p.id=c.product_id WHERE c.shopper_id=$1 AND NOT p.available',
        [session.shopper_id],
      );
      if (unavailable.rows.length) throw new Error('Product unavailable');
      const order: Order = {
        id: randomUUID(),
        shopperId: session.shopper_id,
        sessionId,
        items,
        totalCents: items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0),
      };
      const now = new Date().toISOString();
      await client.query('INSERT INTO orders VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [
        order.id,
        sessionId,
        key,
        now,
        order.totalCents,
        JSON.stringify(items),
      ]);
      await this.appendOn(client, sessionId, 'purchase', { orderId: order.id }, undefined, now);
      if (injectFailure) throw new Error('Injected failure');
      await client.query('DELETE FROM carts WHERE shopper_id=$1', [session.shopper_id]);
      return order;
    });
  }
  async orders(sessionId: string): Promise<Order[]> {
    return this.transaction(async (client) => {
      const session = await this.sessionOn(client, sessionId);
      return (
        await client.query(
          'SELECT o.id,s.shopper_id AS "shopperId",o.session_id AS "sessionId",o.total_cents AS "totalCents",o.items FROM orders o JOIN sessions s ON s.id=o.session_id WHERE s.shopper_id=$1 ORDER BY o.created_at DESC',
          [session.shopper_id],
        )
      ).rows;
    });
  }
  close() {
    return this.pool.end();
  }
}
```

Read this file in three passes. First find `open`, `transaction`, and `close`: they own database setup and connection lifetime. Next find `start`, `catalog`, `cart`, and `set`: they replace Map access while preserving HTTP response shapes. Finally follow `checkout`: prior-order lookup → validation → order/purchase writes → cart clearing.

`appendOn` is an internal helper used only with a transaction's client. It assigns identity from the session and stores a backend fact. Next lesson adds browser validation before calling it. Never call `transaction` from inside another transaction in this teaching adapter; pass the existing client to helpers such as `cartOn` instead.

The advisory lock serializes cooperating transactions in the same schema. For a small lab this makes retries and exports easy to reason about. It limits concurrency and does not protect arbitrary external SQL writers. Seed initialization uses `ON CONFLICT DO NOTHING`, so restarting the API does not overwrite carts, orders, or changed catalog values.

## 4. Connect it to the existing routes

Copy your current `apps/store-api/src/server.ts` to `apps/store-api/src/mock-server.ts`. In **both** existing test files (`catalog.test.ts` and `checkout.test.ts`), change the import from `../src/server.js` to `../src/mock-server.js`. Those tests still check the in-memory model and need no database.

Replace the entire `apps/store-api/src/server.ts` with:

```ts
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PgStore } from './pg-store.js';

export async function buildServer(provided?: PgStore) {
  const store = provided ?? (await PgStore.open());
  const app = Fastify();
  const sessionId = (req: FastifyRequest) => {
    const id = req.headers['x-session-id'];
    if (typeof id !== 'string') throw new Error('Session required');
    return id;
  };
  app.setErrorHandler((error, _req, reply) =>
    reply.code(400).send({ error: (error as Error).message }),
  );
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/products', async (req) => {
    const { q } = z.object({ q: z.string().max(200).default('') }).parse(req.query);
    const items = await store.catalog(q);
    return { items, total: items.length };
  });
  app.get('/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = await store.product(id);
    return product ?? reply.code(404).send({ error: 'Product not found' });
  });
  app.post('/sessions', async (req) => {
    const { shopperId } = z.object({ shopperId: z.string() }).parse(req.body);
    return store.start(shopperId);
  });
  app.get('/cart', async (req) => store.cart(sessionId(req)));
  app.put('/cart/:productId', async (req) => {
    const { productId } = req.params as { productId: string };
    const { quantity } = z.object({ quantity: z.number().int().min(0).max(99) }).parse(req.body);
    return store.set(sessionId(req), productId, quantity);
  });
  app.post('/checkout', async (req) => {
    const { idempotencyKey } = z
      .object({ idempotencyKey: z.string().min(1).max(128) })
      .parse(req.body);
    return store.checkout(sessionId(req), idempotencyKey);
  });
  app.get('/orders', async (req) => store.orders(sessionId(req)));
  app.addHook('onClose', async () => {
    if (!provided) await store.close();
  });
  return app;
}
```

In `apps/store-api/src/main.ts`, change `const app = buildServer();` to `const app = await buildServer();`. Opening the database is asynchronous, so server construction now returns a promise. Public routes and cart/checkout paths stay the same. Tests can supply a store and own its cleanup; normal server shutdown closes its own pool.

## 5. Verify the integration, rollback, and durable retry

Create `apps/store-api/test/persistence.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { buildServer } from '../src/server.js';

test('the HTTP store retains carts and orders and rolls back failed checkout', async () => {
  const namespace = `test_${randomUUID().replaceAll('-', '')}`;
  let store = await PgStore.open(undefined, namespace);
  let app = await buildServer(store);
  try {
    const start = async (shopperId: string) =>
      (await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId } })).json();
    const alex = await start('alex');
    const sam = await start('sam');
    const headers = { 'x-session-id': alex.id };
    assert.equal(
      (await app.inject({ method: 'PUT', url: '/cart/mug', headers, payload: { quantity: 2 } }))
        .statusCode,
      200,
    );
    assert.deepEqual(
      (
        await app.inject({ method: 'GET', url: '/cart', headers: { 'x-session-id': sam.id } })
      ).json(),
      [],
    );
    const before = (await store.pool.query('SELECT value FROM event_counter')).rows[0].value;
    await assert.rejects(() => store.checkout(alex.id, 'failed', true), /Injected failure/);
    assert.equal((await store.cart(alex.id))[0].quantity, 2);
    assert.equal((await store.orders(alex.id)).length, 0);
    assert.equal((await store.pool.query('SELECT value FROM event_counter')).rows[0].value, before);
    // Close/reopen the same schema, as an API restart would.
    await app.close();
    await store.close();
    store = await PgStore.open(undefined, namespace);
    app = await buildServer(store);
    assert.equal((await store.cart(alex.id))[0].quantity, 2);
    const request = {
      method: 'POST' as const,
      url: '/checkout',
      headers,
      payload: { idempotencyKey: 'one-order' },
    };
    const responses = await Promise.all(Array.from({ length: 3 }, () => app.inject(request)));
    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), responses[0].json());
    }
    assert.equal(responses[0].json().totalCents, 5000);
    await app.close();
    await store.close();
    store = await PgStore.open(undefined, namespace);
    app = await buildServer(store);
    assert.equal((await app.inject(request)).json().id, responses[0].json().id);
    assert.equal((await store.orders(alex.id)).length, 1);
    assert.deepEqual(await store.cart(alex.id), []);
    assert.equal(
      (await store.pool.query('SELECT value FROM event_counter')).rows[0].value,
      before + 1,
    );
  } finally {
    await app.close();
    await store.pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await store.close();
  }
});
```

Run `npm run check` and `npm test` from the lab root. Expect the two old mock tests plus the new integration test to pass. The integration test creates/drops a private schema, so it does not consume your demo cart. The failed checkout retains the cart and rolls back its order, purchase, and counter increment. The test closes/reopens the pool to prove retries work from database state rather than a surviving Map.

## 6. Add durable history to the screen

The existing screen can already mutate and checkout through the same endpoints. Extend `apps/web/src/Checkout.tsx` from lesson 3 with these small changes:

1. Add `const [history, setHistory] = useState<Order[]>([]);` beside the `order` state.
2. In the shopper effect, clear history with `setHistory([])` beside `setCart([])`.
3. After fetching `items`, fetch `const previous = await call<Order[]>('/orders', 'GET', undefined, next.id);`. Inside the same `if (!cancelled)` block that adopts the session/cart, add `setHistory(previous)`.
4. After a successful checkout, add `setHistory((previous) => [placed, ...previous]);` beside `setOrder(placed)`.
5. Before the closing `</section>`, add:

```tsx
<h3>Purchase history</h3>
<ul>{history.map((previous) => (
  <li key={previous.id}>Order {previous.id}: {(previous.totalCents / 100).toFixed(2)}</li>
))}</ul>
```

Start `npm run dev:api`, and run `npm run dev -w @learn/web` in another lab-root terminal. In Bag, choose Alex and add two mugs. Stop only the API with Ctrl+C, restart it, and reload the page. **The two mugs must still be there.** Place the order; expect 50.00 and an empty bag. Restart the API and reload once more: the order now appears in history. Switch to Sam: Alex's order must not appear.

Run `npm run build -w @learn/web`. You have replaced the mock behind the existing UI and verified its durable behavior.

## 7. Inspect the persisted facts

From the lab root:

```sh
docker compose exec -T postgres psql -U lab -d lab <<'SQL'
SELECT id, total_cents FROM tutorial.orders ORDER BY created_at;
SELECT seq, payload::jsonb->>'type' AS type FROM tutorial.events ORDER BY seq;
SQL
```

Expect backend cart and purchase records. To verify container persistence too, stop the API, run `docker compose down`, then `docker compose up -d --wait`, restart the API, and reload history. Keep the named volume; `down -v` would erase this lab's database.

The lab still has demo identity, no session expiry, and fake payment/shipping. Those shortcuts are explicit. Compare with the richer [store helper](../../apps/store-api/src/db.ts) and [schema](../../apps/store-api/src/schema.ts) when you reach the repository exercises.

Next: [5. Build browser observation collection](05-build-events.md). Design context: [transactions and sequences](../explanation/transactions.md). [Index](../README.md).
