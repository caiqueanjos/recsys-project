# Repository exercise B: generate a tiny reproducible history

You will build a small seeded simulator instead of creating unrelated random event rows. Use the reference repository after [exercise A](05-observe-the-store.md), with npm dependencies and PostgreSQL running. No Python or model training is needed. The script below creates two private test schemas, compares their events, exports one, and cleans up both schemas. It leaves the normal store and `docs_demo` untouched.

## 1. Define a repeatable sequence

Create `data/tutorial-history.mts` from the repository root; create `data/` first if it is absent. This is an ignored learning script, not a new application module:

```ts
import assert from 'node:assert/strict';
import { temporaryStore } from '../tools/validate/database.js';
import { exportBronze } from '../tools/generate/export.js';
import type { Store } from '../apps/store-api/src/db.js';
import type { StoreEvent } from '@store/contracts';

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function history(store: Store, seed: number) {
  const rng = random(seed);
  let eventNumber = 0;
  await store.transaction(async () => {
    for (const [id, name, price] of [
      ['mug', 'Stoneware mug', 2500],
      ['kettle', 'Pour-over kettle', 4500],
    ] as const) {
      await store.db
        .prepare('INSERT INTO products VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)')
        .run(
          id,
          name,
          'Home & Kitchen',
          'Kitchen',
          'Lab',
          name,
          price,
          1,
          '2026-06-01T00:00:00.000Z',
        );
    }
    await store.db
      .prepare('INSERT INTO shoppers VALUES($1,$2,$3,$4)')
      .run('lab-shopper', 'Synthetic shopper', 'synthetic', '2026-07-01T00:00:00.000Z');
    for (let n = 0; n < 10; n++) {
      const sessionId = `seed-${seed}-session-${n}`;
      let clock = Date.parse('2026-07-01T00:00:00.000Z') + n * 86400000;
      const start = new Date(clock).toISOString();
      await store.db
        .prepare('INSERT INTO sessions VALUES($1,$2,$3,$4,$5)')
        .run(sessionId, 'lab-shopper', start, start, 'synthetic');
      async function emit(type: StoreEvent['type'], context: StoreEvent['context']) {
        clock += 1000;
        const event: StoreEvent = {
          schemaVersion: 1,
          id: `seed-${seed}-event-${eventNumber++}`,
          type,
          occurredAt: new Date(clock).toISOString(),
          ingestedAt: new Date(clock + 2000).toISOString(),
          shopperId: 'lab-shopper',
          sessionId,
          source: 'synthetic',
          context,
        };
        await store.append(event);
        return event.id;
      }
      await emit('session_activity', { page: '/catalog' });
      const list = rng() < 0.5 ? ['mug', 'kettle'] : ['kettle', 'mug'];
      for (const [index, productId] of list.entries()) {
        const position = index + 1;
        const context = { productId, surface: 'catalog' as const, position };
        const impressionId = await emit('impression', context);
        // A teaching exposure bias: the first slot has a higher click probability.
        if (rng() < 0.6 / position) {
          await emit('click', { ...context, impressionId });
        }
      }
      await store.db
        .prepare('UPDATE sessions SET "lastActiveAt"=$1 WHERE id=$2')
        .run(new Date(clock).toISOString(), sessionId);
    }
  });
  return (await store.db.prepare('SELECT payload FROM events ORDER BY seq').all()).map((row) =>
    String(row.payload),
  );
}

const first = await temporaryStore();
let second: Awaited<ReturnType<typeof temporaryStore>> | undefined;
try {
  second = await temporaryStore();
  const a = await history(first.store, 7);
  const b = await history(second.store, 7);
  assert.deepEqual(a, b);
  console.log({ reproducible: true, events: a.length });
  const manifest = await exportBronze(
    first.store,
    'data/exports/tutorial-history',
    0,
    '2026-10-01T00:00:00.000Z',
  );
  console.log(manifest);
} finally {
  await second?.cleanup();
  await first.cleanup();
}
```

Every random choice comes from the seeded function. IDs and timestamps come from counters/fixed times. No current wall-clock values enter the event payloads. A click is emitted only after its impression, with the same product, position, and session.

## 2. Generate and compare

From the repository root:

```sh
node --import tsx data/tutorial-history.mts
```

Expect `reproducible: true` and an event count between 30 and 50: ten session activities, twenty impressions, and zero to twenty clicks. The two private schemas have different source UUIDs, but their event payloads match exactly. The exported manifest identifies the first fixture's source; cleanup removes its database schema after export, so keep the published files if you want to inspect them later.

For another run, change the output path because existing exports are immutable. Change both `history` seed arguments from 7 to 8 and rerun. Their payloads should still agree with one another while differing from the seed-7 population.

## 3. Inspect one bias you introduced

Read the loop's `0.6 / position` probability. The same item receives a different chance of being clicked depending on where it is shown. Randomizing item order does not erase this position effect. Keeping impressions and positions makes that mechanism visible to later analysis.

This tiny simulator has one shopper, two products, no latent preferences, no carts/orders, and no cold-start cohort. It teaches reproducibility and causal references. It does not model a customer population or demonstrate recommendation quality.

## 4. Find the fuller generator

Open [generator.ts](../../tools/generate/generator.ts). Compare its seeded RNG, configuration-based IDs, product listing dates, per-shopper chronology, exposure-before-click ordering, and persistent cart/order writes to this small loop. Look up [generator reference](../reference/generator.md) for cohort definitions and [synthetic-data explanation](../explanation/synthetic-data.md) for evaluation limits.

You have generated coherent observations using the same raw contract as the live store. The next lesson uses `docs_demo` to include both synthetic history and the live actions from exercise A; it does not ingest this temporary fixture automatically.

Next comparison: [C. Export and recover raw ingestion](07-bronze-replay.md). [Index](../README.md).
