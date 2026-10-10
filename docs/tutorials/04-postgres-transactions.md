# 4. Make a checkout durable with PostgreSQL

You will commit an order and a purchase together, inject a failure, and retry one checkout without creating another order. Continue in `store-lab`; you now need Docker Compose. This is a standalone persistence exercise in the lab, not a complete replacement of its in-memory HTTP API. The next lesson connects these ideas in the implemented repository.

## 1. Start a separate lab database

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

Run from `store-lab`:

```sh
docker compose up -d --wait
npm install -w @learn/api pg@8
npm install -D @types/pg@8
```

Port 5434 separates this lab from the repository's default PostgreSQL port. The named volume keeps records after containers stop.

## 2. Create a small relational schema

Create `apps/store-api/src/lab-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS shoppers (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL REFERENCES shoppers(id)
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
  retry_key TEXT NOT NULL, total_cents INTEGER NOT NULL, items JSONB NOT NULL,
  UNIQUE (session_id, retry_key)
);
CREATE TABLE IF NOT EXISTS event_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL
);
INSERT INTO event_counter VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id), payload JSONB NOT NULL
);
```

This teaching schema stores purchased item snapshots in an order JSON column and a minimal purchase payload. The full project uses `order_items`, the versioned event contract, more identity/product fields, and append-only triggers. Do not feed these lab rows into its Bronze exporter.

## 3. Use one connection for the entire transaction

Create `apps/store-api/src/durable-checkout.ts`:

```ts
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://lab:lab@127.0.0.1:5434/lab' });

async function checkout(sessionId: string, key: string, injectFailure = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(48004)');
    const prior = await client.query('SELECT * FROM orders WHERE session_id=$1 AND retry_key=$2', [
      sessionId,
      key,
    ]);
    if (prior.rows[0]) {
      await client.query('COMMIT');
      return prior.rows[0];
    }
    const session = await client.query('SELECT shopper_id FROM sessions WHERE id=$1', [sessionId]);
    if (!session.rows[0]) throw new Error('Session required');
    const shopperId = session.rows[0].shopper_id;
    const cart = await client.query(
      'SELECT p.id, p.name, p.price_cents, p.available, c.quantity FROM carts c JOIN products p ON p.id=c.product_id WHERE c.shopper_id=$1 ORDER BY p.id',
      [shopperId],
    );
    if (!cart.rows.length) throw new Error('Cart is empty');
    if (cart.rows.some((item) => !item.available)) throw new Error('Product unavailable');
    const items = cart.rows.map(({ available, ...item }) => item);
    const total = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
    const orderId = randomUUID();
    const order = await client.query(
      'INSERT INTO orders VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *',
      [orderId, sessionId, key, total, JSON.stringify(items)],
    );
    const counter = await client.query(
      'UPDATE event_counter SET value=value+1 WHERE id=1 RETURNING value',
    );
    await client.query('INSERT INTO events VALUES ($1,$2,$3,$4::jsonb)', [
      counter.rows[0].value,
      randomUUID(),
      orderId,
      JSON.stringify({ type: 'purchase', orderId }),
    ]);
    if (injectFailure) throw new Error('Injected failure');
    await client.query('DELETE FROM carts WHERE shopper_id=$1', [shopperId]);
    await client.query('COMMIT');
    return order.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await pool.query(readFileSync(new URL('./lab-schema.sql', import.meta.url), 'utf8'));
  await pool.query("INSERT INTO shoppers VALUES ('alex') ON CONFLICT DO NOTHING");
  await pool.query(
    "INSERT INTO products VALUES ('mug','Stoneware mug',2500,true) ON CONFLICT DO NOTHING",
  );
  const sessionId = randomUUID();
  await pool.query('INSERT INTO sessions VALUES ($1,$2)', [sessionId, 'alex']);
  // Reset only this lab cart fixture; retain prior orders/events on reruns.
  await pool.query(
    "INSERT INTO carts VALUES ('alex','mug',2) ON CONFLICT (shopper_id,product_id) DO UPDATE SET quantity=2",
  );
  const before = (await pool.query('SELECT value FROM event_counter WHERE id=1')).rows[0].value;
  await assert.rejects(() => checkout(sessionId, 'failed', true), /Injected failure/);
  assert.equal(
    (await pool.query('SELECT * FROM orders WHERE session_id=$1', [sessionId])).rows.length,
    0,
  );
  assert.equal(
    (await pool.query("SELECT quantity FROM carts WHERE shopper_id='alex'")).rows[0].quantity,
    2,
  );
  assert.equal(
    (await pool.query('SELECT value FROM event_counter WHERE id=1')).rows[0].value,
    before,
  );
  const first = await checkout(sessionId, 'demo-order');
  const retries = await Promise.all(
    Array.from({ length: 3 }, () => checkout(sessionId, 'demo-order')),
  );
  for (const retry of retries) assert.equal(retry.id, first.id);
  assert.equal(first.total_cents, 5000);
  assert.equal(
    (await pool.query('SELECT value FROM event_counter WHERE id=1')).rows[0].value,
    before + 1,
  );
  assert.equal((await pool.query("SELECT * FROM carts WHERE shopper_id='alex'")).rows.length, 0);
  console.log({
    orderId: first.id,
    totalCents: first.total_cents,
    rollbackVerified: true,
    sameOrder: true,
  });
} finally {
  await pool.end();
}
```

`pool.query` outside a transaction is fine for this single-run fixture setup. Inside checkout, every query uses `client.query` so BEGIN, all writes, and COMMIT share one connection. The advisory lock serializes cooperating checkouts, including simultaneous retries.

## 4. Observe rollback, retry, and persistence

From the lab root:

```sh
npm run check
node --import tsx apps/store-api/src/durable-checkout.ts
docker compose exec -T postgres psql -U lab -d lab -c 'SELECT seq, order_id FROM events ORDER BY seq;'
```

Expect a 5000-cent order, `rollbackVerified: true`, and `sameOrder: true`. On a fresh lab, SQL shows one event at sequence 1. The failed checkout retained the cart and rolled back its order, event, and counter increment.

Stop and restart the lab database:

```sh
docker compose down
docker compose up -d --wait
docker compose exec -T postgres psql -U lab -d lab -c 'SELECT id, total_cents FROM orders;'
```

The order still exists. Rerunning the script creates a fresh session and another demonstration order while preserving old orders/events. The in-memory HTTP API from lesson 3 still loses its own state on restart; this script demonstrates the persistence boundary separately.

## 5. Locate the full implementation

In this repository, [Store.transaction](../../apps/store-api/src/db.ts) routes nested helper queries to one client automatically. [Schema](../../apps/store-api/src/schema.ts) stores richer relational records and protects append-only events. [Checkout route](../../apps/store-api/src/server.ts) performs retry lookup, validation, item/purchase writes, and cart clearing inside that transaction.

You have now practiced the database mechanics needed to understand those helpers. Stop the lab API before running the repository API on port 3001.

Next: [5. Follow an action into an event](05-observe-the-store.md). Deeper reasoning: [transactions and sequences](../explanation/transactions.md). [Index](../README.md).
