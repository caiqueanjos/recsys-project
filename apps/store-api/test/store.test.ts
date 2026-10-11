import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temporaryStore } from '../../../tools/validate/database.js';
import { buildServer } from '../src/server.js';

test('identity isolation, transactional checkout, replay, and exposure validation', async (t) => {
  const fixture = await temporaryStore();
  t.after(() => fixture.cleanup());
  const { store } = fixture;
  await store.db
    .prepare('INSERT INTO products VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)')
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
  const app = await buildServer(store);
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
    (await store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase'").get())!.n,
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
    (await store.db.prepare("SELECT count(*) AS n FROM events WHERE source='browser'").get())!.n,
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
  await assert.rejects(() => store.db.exec('DELETE FROM events'), /append-only/);
  await store.db
    .prepare('UPDATE sessions SET "lastActiveAt"=\'2025-01-01T00:00:00.000Z\' WHERE id=$1')
    .run(a.id);
  assert.equal((await call('GET', '/cart', undefined, a.id)).statusCode, 401);
  await app.close();
});
test('checkout failure leaves cart and events intact', async (t) => {
  const fixture = await temporaryStore();
  t.after(() => fixture.cleanup());
  const { store } = fixture;
  const app = await buildServer(store);
  await store.db
    .prepare('INSERT INTO products VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)')
    .run('p', 'Soap', 'Personal Care', 'Bath', 'Pure', 'Soap', 500, 1, '2025-01-01T00:00:00.000Z');
  const s = (
    await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId: 'persona-home' } })
  ).json();
  const headers = { 'x-session-id': s.id };
  await app.inject({ method: 'PUT', url: '/cart/p', headers, payload: { quantity: 1 } });
  await store.db.exec('UPDATE products SET available=0');
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
  assert.equal((await store.cart('persona-home')).length, 1);
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM orders').get())!.n, 0);
  assert.equal(
    (await store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase'").get())!.n,
    0,
  );
  await app.close();
});

test('cart and checkout routes preserve validation and application error responses', async (t) => {
  const { store, cleanup } = await temporaryStore();
  t.after(cleanup);
  const app = await buildServer(store);
  t.after(() => app.close());
  await store.db
    .prepare('INSERT INTO products VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)')
    .run('p', 'Soap', 'Personal Care', 'Bath', 'Pure', 'Soap', 500, 0, '2025-01-01T00:00:00.000Z');
  const session = (
    await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId: 'persona-home' } })
  ).json();
  const headers = { 'x-session-id': session.id };
  for (const [productId, error, statusCode] of [
    ['missing', 'Product not found', 404],
    ['p', 'Product unavailable', 409],
  ] as const) {
    const response = await app.inject({
      method: 'PUT',
      url: `/cart/${productId}`,
      headers,
      payload: { quantity: 1 },
    });
    assert.equal(response.statusCode, statusCode);
    assert.deepEqual(response.json(), { error });
  }
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/cart/p', headers, payload: { quantity: 100 } }))
      .statusCode,
    400,
  );
  const empty = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers,
    payload: { idempotencyKey: 'empty' },
  });
  assert.equal(empty.statusCode, 409);
  assert.deepEqual(empty.json(), { error: 'Cart is empty' });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { idempotencyKey: '' },
      })
    ).statusCode,
    400,
  );
});

test('concurrent checkout retries commit one purchase and failed event batches leave no sequence gaps', async (t) => {
  const fixture = await temporaryStore();
  t.after(() => fixture.cleanup());
  const { store } = fixture;
  const app = await buildServer(store);
  t.after(() => app.close());
  await store.db
    .prepare('INSERT INTO products VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)')
    .run('p', 'Soap', 'Personal Care', 'Bath', 'Pure', 'Soap', 500, 1, '2025-01-01T00:00:00.000Z');
  const session = (
    await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId: 'persona-home' } })
  ).json();
  const headers = { 'x-session-id': session.id };
  await app.inject({ method: 'PUT', url: '/cart/p', headers, payload: { quantity: 1 } });
  const retries = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { idempotencyKey: 'concurrent' },
      }),
    ),
  );
  for (const response of retries) {
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), retries[0].json());
  }
  assert.equal((await store.db.prepare('SELECT count(*) AS n FROM orders').get())!.n, 1);
  const now = new Date().toISOString();
  const event = {
    id: 'rolled-back',
    type: 'session_activity',
    occurredAt: now,
    context: { page: '/home' },
  };
  const failure = await app.inject({
    method: 'POST',
    url: '/events',
    headers,
    payload: {
      events: [
        event,
        {
          id: 'invalid-click',
          type: 'click',
          occurredAt: now,
          context: { productId: 'p', surface: 'catalog', position: 1, impressionId: 'missing' },
        },
      ],
    },
  });
  assert.equal(failure.statusCode, 400);
  assert.equal(
    await store.db.prepare('SELECT id FROM events WHERE id=$1').get(event.id),
    undefined,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/events', headers, payload: { events: [event] } }))
      .statusCode,
    200,
  );
  assert.deepEqual(
    (await store.db.prepare('SELECT seq FROM events ORDER BY seq').all()).map((row) => row.seq),
    [1, 2, 3],
  );
  for (const sql of ['UPDATE events SET payload=payload', 'DELETE FROM events', 'TRUNCATE events'])
    await assert.rejects(() => store.db.exec(sql), /append-only/);
});
