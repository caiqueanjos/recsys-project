import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { temporaryStore } from '../../../tools/validate/database.js';
import { generate, defaults } from '../../../tools/generate/generator.js';
import { simulateDelivery } from '../../../tools/generate/delivery.js';
import { exportBronze } from '../../../tools/generate/export.js';

test('seeded history is reproducible, chronological, referentially valid and reconciled', async (t) => {
  const fixtureA = await temporaryStore();
  t.after(() => fixtureA.cleanup());
  const fixtureB = await temporaryStore();
  t.after(() => fixtureB.cleanup());
  const a = fixtureA.store,
    b = fixtureB.store;
  const config = { ...defaults, products: 140, shoppers: 80, events: 5000 };
  const first = await generate(a, config),
    second = await generate(b, config);
  assert.deepEqual(first, second);
  assert.ok('diagnostics' in first);
  for (const table of [
    'products',
    'shoppers',
    'sessions',
    'carts',
    'orders',
    'order_items',
    'events',
  ])
    assert.deepEqual(
      await a.db
        .prepare(
          `SELECT * FROM ${table} ORDER BY ${table === 'events' ? 'seq' : table === 'carts' ? '"shopperId","productId"' : table === 'order_items' ? '"orderId","productId"' : 'id'}`,
        )
        .all(),
      await b.db
        .prepare(
          `SELECT * FROM ${table} ORDER BY ${table === 'events' ? 'seq' : table === 'carts' ? '"shopperId","productId"' : table === 'order_items' ? '"orderId","productId"' : 'id'}`,
        )
        .all(),
    );
  const before = (await a.db.prepare('SELECT count(*) AS n FROM events').get())!.n;
  assert.equal((await generate(a, config)).alreadyGenerated, true);
  assert.equal((await a.db.prepare('SELECT count(*) AS n FROM events').get())!.n, before);
  await assert.rejects(
    () =>
      a.db
        .prepare('INSERT INTO carts VALUES($1,$2,$3)')
        .run('missing-shopper', 'missing-product', 1),
    /foreign key/,
  );
  assert.equal(
    (await a.db
      .prepare(
        'SELECT count(*) AS n FROM orders o WHERE "totalCents" != (SELECT sum(quantity*"unitPriceCents") FROM order_items i WHERE i."orderId"=o.id)',
      )
      .get())!.n,
    0,
  );
  assert.equal(
    (await a.db
      .prepare(
        "SELECT count(*) AS n FROM orders o WHERE (SELECT count(*) FROM events e WHERE e.type='purchase' AND e.payload::jsonb->'context'->>'orderId'=o.id)!=1",
      )
      .get())!.n,
    0,
  );
  assert.equal(
    (await a.db
      .prepare(
        'SELECT count(*) AS n FROM events e JOIN shoppers s ON s.id=e."shopperId" WHERE e."occurredAt"<s."createdAt"',
      )
      .get())!.n,
    0,
  );
  const events = (await a.db.prepare('SELECT payload FROM events ORDER BY seq').all()).map((r) =>
    JSON.parse(String(r.payload)),
  );
  const times = new Map<string, string>();
  for (const e of events) {
    assert.ok(!times.has(e.sessionId) || times.get(e.sessionId)! <= e.occurredAt);
    times.set(e.sessionId, e.occurredAt);
    assert.ok(e.occurredAt < first.end!);
  }
  // Reconstruct carts in event order, checking that purchases consume exactly the recorded contents.
  const carts = new Map<string, Map<string, number>>();
  for (const e of events) {
    const cart = carts.get(e.shopperId) ?? new Map<string, number>();
    carts.set(e.shopperId, cart);
    if (e.type.startsWith('cart_')) cart.set(e.context.productId, e.context.quantity);
    if (e.type === 'purchase') {
      const order = await a.order(e.context.orderId);
      assert.deepEqual(
        order.items.map((i) => [i.productId, i.quantity]),
        [...cart.entries()].filter(([, q]) => q > 0).sort(([a], [b]) => a.localeCompare(b)),
      );
      cart.clear();
    }
  }
  const diagnostics = first.diagnostics!;
  for (const u of first.diagnostics.users.slice(Math.floor(config.shoppers * 0.85)))
    assert.ok(u.createdAt > first.cutoff);
  const coldProducts = await a.db
    .prepare('SELECT "listedAt" FROM products ORDER BY id OFFSET $1')
    .all(Math.floor(config.products * 0.85));
  assert.ok(coldProducts.every((p) => String(p.listedAt) > first.cutoff));
  for (const u of first.diagnostics.users.filter((u) => u.sparse))
    assert.ok(
      Number(
        (await a.db.prepare('SELECT count(*) AS n FROM sessions WHERE "shopperId"=$1').get(u.id))!
          .n,
      ) <= 1,
    );
  for (const u of diagnostics.users.filter((u) => u.unobserved))
    assert.equal(
      (await a.db.prepare('SELECT count(*) AS n FROM events WHERE "shopperId"=$1').get(u.id))!.n,
      0,
    );
  for (const p of diagnostics.unobservedProducts)
    assert.equal(
      (await a.db
        .prepare(
          "SELECT count(*) AS n FROM events WHERE payload::jsonb->'context'->>'productId'=$1",
        )
        .get(p))!.n,
      0,
    );
  assert.ok(
    ((await a.db
      .prepare('SELECT count(*) AS n FROM shoppers WHERE "createdAt">$1')
      .get(first.cutoff!))!.n as number) > 0,
  );
  assert.ok(
    ((await a.db
      .prepare('SELECT count(*) AS n FROM products WHERE "listedAt">$1')
      .get(first.cutoff!))!.n as number) > 0,
  );
  const dir = mkdtempSync(join(tmpdir(), 'store-export-'));
  try {
    const manifest = await exportBronze(a, join(dir, 'batch'), 0, '2026-10-01T00:00:00.000Z');
    assert.equal(manifest.files['events.ndjson'].count, before);
    await assert.rejects(() => exportBronze(a, join(dir, 'batch')), /already exists/);
    const deliveryConfig = {
      seed: 12,
      missingRate: 0.1,
      duplicateRate: 0.2,
      maxDelaySeconds: 3600,
    };
    const deliveryA = await simulateDelivery(
      a,
      first.run,
      join(dir, 'delivery-a.ndjson'),
      deliveryConfig,
    );
    const deliveryB = await simulateDelivery(
      b,
      first.run,
      join(dir, 'delivery-b.ndjson'),
      deliveryConfig,
    );
    assert.deepEqual(deliveryA, deliveryB);
    assert.ok(deliveryA.missing > 0 && deliveryA.duplicate > 0);
    assert.equal(deliveryA.delivered, deliveryA.original - deliveryA.missing + deliveryA.duplicate);
    const deliveries = readFileSync(join(dir, 'delivery-a.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    for (let i = 1; i < deliveries.length; i++)
      assert.ok(deliveries[i - 1].deliveredAt <= deliveries[i].deliveredAt);
    assert.equal((await a.db.prepare('SELECT count(*) AS n FROM events').get())!.n, before);
    const raw = readFileSync(join(dir, 'batch', 'events.ndjson'), 'utf8');
    assert.ok(!raw.includes('propensity'));
    assert.ok(!raw.includes('budget'));
    assert.equal(
      (await exportBronze(a, join(dir, 'empty'), manifest.highWater)).files['events.ndjson'].count,
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
