import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, openSync, writeSync, closeSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Store } from '../../apps/store-api/src/db.js';

export async function exportBronze(
  store: Store,
  output: string,
  after = 0,
  snapshotAt = new Date().toISOString(),
) {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new Error('after must be a nonnegative sequence');
  if (!Number.isFinite(Date.parse(snapshotAt))) throw new Error('Invalid snapshot time');
  if (existsSync(output)) throw new Error('Export output already exists; choose a new path');
  const temp = `${output}.partial-${randomUUID()}`;
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(temp);
  return await store.transaction(async () => {
    const sourceId = String(
      (await store.db.prepare("SELECT value FROM metadata WHERE key='sourceId'").get())!.value,
    );
    const highWater = Number(
      (await store.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get())!.n,
    );
    if (after > highWater) throw new Error('Cursor is beyond the event log');
    const products = await store.db
      .prepare('SELECT * FROM products WHERE "listedAt"<=$1 ORDER BY id')
      .all(snapshotAt);
    const snapshotId = createHash('sha256')
      .update(JSON.stringify({ sourceId, snapshotAt, products }))
      .digest('hex');
    function writer(filename: string) {
      const fd = openSync(`${temp}/${filename}`, 'wx'),
        hash = createHash('sha256');
      let count = 0;
      return {
        line(row: unknown) {
          const text = JSON.stringify(row) + '\n';
          writeSync(fd, text);
          hash.update(text);
          count++;
        },
        finish() {
          closeSync(fd);
          return { sha256: hash.digest('hex'), count };
        },
      };
    }
    const events = writer('events.ndjson');
    let cursor = after;
    while (cursor < highWater) {
      const rows = await store.db
        .prepare('SELECT * FROM events WHERE seq>$1 AND seq<=$2 ORDER BY seq LIMIT 5000')
        .all(cursor, highWater);
      for (const row of rows) {
        events.line({
          sourceId,
          eventId: row.id,
          seq: row.seq,
          eventTime: row.occurredAt,
          ingestionTime: row.ingestedAt,
          source: row.source,
          schemaVersion: 1,
          payload: row.payload,
        });
        cursor = Number(row.seq);
      }
    }
    const eventFile = events.finish(),
      catalog = writer('catalog.ndjson');
    for (const row of products)
      catalog.line({
        sourceId,
        snapshotId,
        snapshotAt,
        productId: row.id,
        payload: JSON.stringify({ ...row, available: Boolean(row.available) }),
      });
    const catalogFile = catalog.finish();
    const manifest = {
      version: 1,
      sourceId,
      after,
      highWater,
      snapshotId,
      snapshotAt,
      files: { 'events.ndjson': eventFile, 'catalog.ndjson': catalogFile },
    };
    const file = openSync(`${temp}/manifest.json`, 'wx');
    writeSync(file, JSON.stringify(manifest, null, 2));
    closeSync(file);
    renameSync(temp, output);
    return manifest;
  });
}
if (process.argv[1]?.endsWith('/export.ts')) {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      output: {
        type: 'string',
        default: `data/exports/${new Date().toISOString().replaceAll(':', '-')}`,
      },
      after: { type: 'string', default: '0' },
    },
  });
  const store = await Store.open(values.db);
  try {
    console.log(
      JSON.stringify(await exportBronze(store, values.output!, Number(values.after)), null, 2),
    );
  } finally {
    await store.db.close();
  }
}
