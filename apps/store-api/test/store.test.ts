import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.js';
import { buildServer } from '../src/server.js';

test('identity isolation, transactional checkout, replay, and exposure validation', async () => {
  const store = new Store(':memory:');
  store.db
    .prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      'p1',
      'Kettle',
      'Home & Kitchen',
      'Kitchen',
      'Hearth',
      'A kettle',
      3500,
      1,
      '2025-01-01T00:00:00.000Z',
    );
  const app = buildServer(store);
  const call = async (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: Record<string, unknown>,
    id?: string,
  ) => app.inject({ method, url, payload, headers: id ? { 'x-session-id': id } : {} });
  const a = (await call('POST', '/sessions', { shopperId: 'persona-home' })).json();
  const b = (await call('POST', '/sessions', { shopperId: 'persona-active' })).json();
  assert.equal((await call('PUT', '/cart/p1', { quantity: 2 }, a.id)).statusCode, 200);
  assert.deepEqual((await call('GET', '/cart', undefined, b.id)).json(), []);
  const next = (await call('POST', '/sessions', { shopperId: 'persona-home' })).json();
  assert.notEqual(a.id, next.id);
  assert.equal((await call('GET', '/cart', undefined, next.id)).json()[0].quantity, 2);
  const order = (await call('POST', '/checkout', { idempotencyKey: 'retry' }, next.id)).json();
  assert.equal(order.totalCents, 7000);
  assert.deepEqual(
    (await call('POST', '/checkout', { idempotencyKey: 'retry' }, next.id)).json(),
    order,
  );
  assert.deepEqual((await call('GET', '/cart', undefined, next.id)).json(), []);
  assert.equal((await call('GET', '/orders', undefined, a.id)).json().length, 1);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase'").get()!.n,
    1,
  );
  const now = new Date().toISOString();
  const context = { productId: 'p1', surface: 'home_trending', position: 1 };
  assert.equal(
    (
      await call(
        'POST',
        '/events',
        {
          events: [
            {
              id: 'bad',
              type: 'click',
              occurredAt: now,
              context: { ...context, impressionId: 'missing' },
            },
          ],
        },
        next.id,
      )
    ).statusCode,
    400,
  );
  const events = [
    { id: 'exposure', type: 'impression', occurredAt: now, context },
    {
      id: 'click',
      type: 'click',
      occurredAt: now,
      context: { ...context, impressionId: 'exposure' },
    },
  ];
  assert.equal((await call('POST', '/events', { events }, next.id)).statusCode, 200);
  assert.equal((await call('POST', '/events', { events }, next.id)).statusCode, 200);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM events WHERE source='browser'").get()!.n,
    2,
  );
  assert.equal(
    (
      await call(
        'POST',
        '/events',
        { events: [{ ...events[0], context: { ...context, position: 2 } }] },
        next.id,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        'POST',
        '/events',
        {
          events: [
            { id: 'forged', type: 'purchase', occurredAt: now, context: { orderId: order.id } },
          ],
        },
        next.id,
      )
    ).statusCode,
    400,
  );
  assert.throws(() => store.db.exec('DELETE FROM events'), /append-only/);
  store.db
    .prepare("UPDATE sessions SET lastActiveAt='2025-01-01T00:00:00.000Z' WHERE id=?")
    .run(a.id);
  assert.equal((await call('GET', '/cart', undefined, a.id)).statusCode, 401);
  await app.close();
  store.db.close();
});

test('checkout failure leaves cart and events intact', async () => {
  const store = new Store(':memory:'),
    app = buildServer(store);
  store.db
    .prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)')
    .run('p', 'Soap', 'Personal Care', 'Bath', 'Pure', 'Soap', 500, 1, '2025-01-01T00:00:00.000Z');
  const s = (
    await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId: 'persona-home' } })
  ).json();
  const headers = { 'x-session-id': s.id };
  await app.inject({ method: 'PUT', url: '/cart/p', headers, payload: { quantity: 1 } });
  store.db.exec('UPDATE products SET available=0');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { idempotencyKey: 'fail' },
      })
    ).statusCode,
    409,
  );
  assert.equal(store.cart('persona-home').length, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM orders').get()!.n, 0);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase'").get()!.n,
    0,
  );
  await app.close();
  store.db.close();
});
