# 6. Build an immutable exporter

You will export **your lab's** stored events and current catalog into a complete raw batch, then export an increment using its append cursor. Continue in `store-lab` after lesson 5; no Python or Spark is needed yet.

## 1. Define the boundary before writing files

One batch has three files: `events.ndjson`, `catalog.ndjson`, and `manifest.json`. NDJSON means one JSON object per line. Each event envelope adds source database identity, sequence, and event/receipt timestamps while keeping its payload as raw JSON text. Each catalog row identifies one snapshot and product.

The cursor `after=2` means export committed sequences 3 and later. It does not mean events occurring after a date. The manifest captures `highWater`, the last included committed sequence. Catalog state is captured now, not reconstructed at earlier event times.

## 2. Implement the export transaction

Create `apps/store-api/src/export.ts`:

```ts
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PgStore } from './pg-store.js';

export async function exportBatch(
  store: PgStore,
  output: string,
  after = 0,
  snapshotAt = new Date().toISOString(),
) {
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid cursor');
  snapshotAt = new Date(snapshotAt).toISOString();
  if (existsSync(output)) throw new Error('Choose a new export path');
  const partial = `${output}.partial-${randomUUID()}`;
  try {
    return await store.transaction(async (client) => {
      const sourceId = (await client.query("SELECT value FROM metadata WHERE key='sourceId'"))
        .rows[0].value;
      const highWater = (await client.query('SELECT value FROM event_counter WHERE id=1')).rows[0]
        .value;
      if (after > highWater) throw new Error('Cursor is beyond event log');
      const products = (
        await client.query(
          'SELECT id,name,price_cents AS "priceCents",available FROM products ORDER BY id',
        )
      ).rows;
      const snapshotId = createHash('sha256')
        .update(JSON.stringify({ sourceId, snapshotAt, products }))
        .digest('hex');
      const rows = (
        await client.query('SELECT * FROM events WHERE seq>$1 AND seq<=$2 ORDER BY seq', [
          after,
          highWater,
        ])
      ).rows;
      if (
        rows.length !== highWater - after ||
        rows.some((row, index) => row.seq !== after + index + 1)
      ) {
        throw new Error('Event sequence gap');
      }
      const events = rows.map((row) => {
        const event = JSON.parse(row.payload);
        return {
          sourceId,
          eventId: row.id,
          seq: row.seq,
          eventTime: row.occurred_at,
          ingestionTime: row.ingested_at,
          source: event.source,
          schemaVersion: event.schemaVersion,
          payload: row.payload,
        };
      });
      const catalog = products.map((product) => ({
        sourceId,
        snapshotId,
        snapshotAt,
        productId: product.id,
        payload: JSON.stringify(product),
      }));
      mkdirSync(dirname(output), { recursive: true });
      mkdirSync(partial);
      function write(name: string, records: unknown[]) {
        const content = records.map((row) => JSON.stringify(row) + '\n').join('');
        writeFileSync(`${partial}/${name}`, content, { flag: 'wx' });
        return {
          count: records.length,
          sha256: createHash('sha256').update(content).digest('hex'),
        };
      }
      const files = {
        'events.ndjson': write('events.ndjson', events),
        'catalog.ndjson': write('catalog.ndjson', catalog),
      };
      const manifest = { version: 1, sourceId, after, highWater, snapshotId, snapshotAt, files };
      writeFileSync(`${partial}/manifest.json`, JSON.stringify(manifest, null, 2), { flag: 'wx' });
      renameSync(partial, output);
      return manifest;
    });
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
}
```

The exporter takes the same lock as cart, checkout, and event intake. It captures catalog/event state while cooperating writes wait. Hashes cover exact file bytes, including newlines. A temporary sibling directory becomes the published path only after both files and manifest are complete.

This small exporter reads its rows into memory. The reference project pages its event reads for larger datasets. Publishing via rename does not provide a power-loss durability guarantee; the teaching exercise models complete local-file publication and immutable replay.

## 3. Add a command without importing the server

Create `apps/store-api/src/export-cli.ts`:

```ts
import { PgStore } from './pg-store.js';
import { exportBatch } from './export.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: export-cli.ts OUTPUT [AFTER]');
const store = await PgStore.open();
try {
  console.log(await exportBatch(store, output, Number(process.argv[3] ?? 0)));
} finally {
  await store.close();
}
```

You can export while the API is running, because both use the same database and lock convention. The CLI closes its own pool.

## 4. Verify content, immutability, and an empty increment

Create `apps/store-api/test/export.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PgStore } from '../src/pg-store.js';
import { exportBatch } from '../src/export.js';

test('immutable exports contain contiguous raw events and full catalog snapshots', async () => {
  const namespace = `test_${randomUUID().replaceAll('-', '')}`;
  const store = await PgStore.open(undefined, namespace);
  const folder = mkdtempSync(join(tmpdir(), 'lab-export-'));
  try {
    const session = await store.start('alex');
    await store.set(session.id, 'mug', 2);
    const first = await exportBatch(store, join(folder, 'first'), 0, '2026-10-01T00:00:00.000Z');
    assert.equal(first.highWater, 1);
    assert.equal(first.files['events.ndjson'].count, 1);
    assert.equal(first.files['catalog.ndjson'].count, 2);
    for (const [name, spec] of Object.entries(first.files)) {
      const content = readFileSync(join(folder, 'first', name));
      assert.equal(createHash('sha256').update(content).digest('hex'), spec.sha256);
    }
    const envelope = JSON.parse(readFileSync(join(folder, 'first/events.ndjson'), 'utf8').trim());
    assert.equal(JSON.parse(envelope.payload).type, 'cart_add');
    await assert.rejects(() => exportBatch(store, join(folder, 'first')), /new export path/);
    const second = await exportBatch(
      store,
      join(folder, 'second'),
      first.highWater,
      '2026-10-02T00:00:00.000Z',
    );
    assert.equal(second.files['events.ndjson'].count, 0);
    assert.equal(second.files['catalog.ndjson'].count, 2);
    assert.notEqual(first.snapshotId, second.snapshotId);
  } finally {
    await store.pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
```

Run `npm run check` and `npm test`. Expect all prior tests and this export test to pass. It uses a private schema and temporary paths, not your demo records.

## 5. Publish a real lab batch

After producing the browser/cart/purchase actions from lesson 5, stop API/Vite to keep the next checkpoint quiet. Keep PostgreSQL running. From the lab root:

```sh
node --import tsx apps/store-api/src/export-cli.ts data/exports/lab-first
node --input-type=module <<'JS'
import fs from 'node:fs';
const base = 'data/exports/lab-first';
const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'));
console.log(manifest);
const line = fs.readFileSync(`${base}/events.ndjson`, 'utf8').trim().split('\n')[0];
if (line) {
  const envelope = JSON.parse(line);
  console.log({ envelope, event: JSON.parse(envelope.payload) });
}
JS
```

Expect a positive event count, two catalog rows, and raw browser/backend payloads with their sources. Use a new output path if you repeat the exercise.

You have implemented the raw-data boundary of your own lab. Keep `lab-first` for the next lesson. Its source ID belongs to this lab database, not a simulator seed or file path.

Next: [7. Build replay-safe Delta ingestion](07-build-bronze.md). Detailed protocol comparison: [Bronze reference](../reference/bronze.md). [Index](../README.md).
