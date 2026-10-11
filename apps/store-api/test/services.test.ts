import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@store/contracts';
import { temporaryStore } from '../../../tools/validate/database.js';
import type { Store } from '../src/db.js';
import { CartService } from '../src/services/cart.js';
import { CheckoutService } from '../src/services/checkout.js';
import { StoreOperationError } from '../src/services/errors.js';

async function seed(store: Store): Promise<Session> {
  await store.seedPersonas();
  await store.db
    .prepare('INSERT INTO products VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)')
    .run('p', 'Soap', 'Personal Care', 'Bath', 'Pure', 'Soap', 500, 1, '2025-01-01T00:00:00.000Z');
  const now = new Date().toISOString();
  const session: Session = {
    id: 'service-session',
    shopperId: 'persona-home',
    startedAt: now,
    lastActiveAt: now,
    source: 'live',
  };
  await store.db
    .prepare('INSERT INTO sessions VALUES($1,$2,$3,$4,$5)')
    .run(session.id, session.shopperId, now, now, session.source);
  return session;
}

// Fail after an event insert to exercise rollback of prior writes and the counter.
async function rejectEventType(store: Store, type: string) {
  assert.ok(['cart_update', 'purchase'].includes(type));
  await store.db.exec(`
    CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = '${type}' THEN RAISE EXCEPTION 'Injected event failure'; END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_test_event AFTER INSERT ON events
    FOR EACH ROW EXECUTE FUNCTION reject_test_event();
  `);
}

test('cart service works without HTTP and rolls back mutation when event recording fails', async (t) => {
  const { store, cleanup } = await temporaryStore();
  t.after(cleanup);
  const session = await seed(store);
  const cart = new CartService(store);
  assert.equal((await cart.setQuantity(session, 'p', 1))[0].quantity, 1);
  await cart.setQuantity(session, 'p', 1);
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM events').get())!.n, 1);

  await rejectEventType(store, 'cart_update');
  await assert.rejects(() => cart.setQuantity(session, 'p', 2), /Injected event failure/);
  assert.equal((await store.cart(session.shopperId))[0].quantity, 1);
  assert.equal((await store.db.prepare('SELECT value FROM event_counter').get())!.value, 1);
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM events').get())!.n, 1);

  await store.db.exec('UPDATE products SET available=0');
  await assert.rejects(
    () => cart.setQuantity(session, 'p', 2),
    (error: unknown) =>
      error instanceof StoreOperationError && error.code === 'product_unavailable',
  );
  assert.deepEqual(await cart.setQuantity(session, 'p', 0), []);
  assert.deepEqual(
    (await store.db.prepare('SELECT seq,type FROM events ORDER BY seq').all()).map((row) => [
      row.seq,
      row.type,
    ]),
    [
      [1, 'cart_add'],
      [2, 'cart_remove'],
    ],
  );
});

test('checkout service rolls back partial writes and concurrent retries return one snapshot', async (t) => {
  const { store, cleanup } = await temporaryStore();
  t.after(cleanup);
  const session = await seed(store);
  const cart = new CartService(store);
  const checkout = new CheckoutService(store);
  await cart.setQuantity(session, 'p', 2);
  await rejectEventType(store, 'purchase');

  await assert.rejects(() => checkout.execute(session, 'retry'), /Injected event failure/);
  assert.equal((await store.cart(session.shopperId))[0].quantity, 2);
  for (const table of ['orders', 'order_items'])
    assert.equal((await store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get())!.n, 0);
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM events').get())!.n, 1);
  assert.equal((await store.db.prepare('SELECT value FROM event_counter').get())!.value, 1);

  await store.db.exec('DROP TRIGGER reject_test_event ON events');
  const orders = await Promise.all(
    Array.from({ length: 5 }, () => checkout.execute(session, 'retry')),
  );
  for (const order of orders) assert.deepEqual(order, orders[0]);
  assert.equal(orders[0].totalCents, 1000);
  assert.deepEqual(await store.cart(session.shopperId), []);
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM orders').get())!.n, 1);
  assert.deepEqual(
    (await store.db.prepare('SELECT seq,type FROM events ORDER BY seq').all()).map((row) => [
      row.seq,
      row.type,
    ]),
    [
      [1, 'cart_add'],
      [2, 'purchase'],
    ],
  );

  await store.db.exec('UPDATE products SET name=\'New name\', "priceCents"=900, available=0');
  assert.deepEqual(await checkout.execute(session, 'retry'), orders[0]);
  assert.deepEqual(orders[0].items, [
    { productId: 'p', name: 'Soap', quantity: 2, unitPriceCents: 500 },
  ]);
  await assert.rejects(
    () => checkout.execute(session, 'new-key'),
    (error: unknown) => error instanceof StoreOperationError && error.code === 'cart_empty',
  );
});
