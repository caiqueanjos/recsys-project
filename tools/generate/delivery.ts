import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { StoreEvent } from '@store/contracts';
import { Store } from '../../apps/store-api/src/db.js';

export type DeliveryConfig = {
  seed: number;
  missingRate: number;
  duplicateRate: number;
  maxDelaySeconds: number;
};
// A separate transport experiment: never mutate the authoritative event log or orders.
export async function simulateDelivery(
  store: Store,
  run: string,
  output: string,
  config: DeliveryConfig,
) {
  if (
    !Number.isSafeInteger(config.seed) ||
    !Number.isFinite(config.maxDelaySeconds) ||
    config.maxDelaySeconds < 0
  )
    throw new Error('Invalid delivery seed or delay');
  for (const rate of [config.missingRate, config.duplicateRate])
    if (!Number.isFinite(rate) || rate < 0 || rate > 1)
      throw new Error('Delivery rates must be between zero and one');
  let state = config.seed >>> 0;
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  mkdirSync(dirname(output), { recursive: true });
  const file = openSync(output, 'wx'),
    hash = createHash('sha256');
  let missing = 0,
    duplicate = 0,
    delivered = 0,
    original = 0,
    previousDelivery = 0;
  try {
    let cursorTime = '',
      cursorSeq = 0;
    while (true) {
      const rows = await store.db
        .prepare(
          'SELECT payload,"occurredAt",seq FROM events WHERE id LIKE $1 AND ("occurredAt",seq)>($2,$3) ORDER BY "occurredAt",seq LIMIT 5000',
        )
        .all(`${run}-event-%`, cursorTime, cursorSeq);
      if (!rows.length) break;
      for (const row of rows) {
        cursorTime = String(row.occurredAt);
        cursorSeq = Number(row.seq);
        original++;
        const event = JSON.parse(String(row.payload)) as StoreEvent;
        if (rng() < config.missingRate) {
          missing++;
          continue;
        }
        const delay = Math.floor(rng() * config.maxDelaySeconds * 1000);
        // Delay transport while retaining causal event timestamps and chronological delivery order.
        previousDelivery = Math.max(previousDelivery, Date.parse(event.ingestedAt) + delay);
        const write = () => {
          const line =
            JSON.stringify({
              deliveryId: `${run}-delivery-${delivered++}`,
              deliveredAt: new Date(previousDelivery).toISOString(),
              event,
            }) + '\n';
          writeSync(file, line);
          hash.update(line);
        };
        write();
        if (rng() < config.duplicateRate) {
          duplicate++;
          previousDelivery++;
          write();
        }
      }
    }
  } finally {
    closeSync(file);
  }
  return { run, config, original, delivered, missing, duplicate, sha256: hash.digest('hex') };
}
