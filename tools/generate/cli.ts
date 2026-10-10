import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../../apps/store-api/src/db.js';
import { simulateDelivery } from './delivery.js';
import { generate, defaults } from './generator.js';

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    products: { type: 'string' },
    shoppers: { type: 'string' },
    events: { type: 'string' },
    days: { type: 'string' },
    start: { type: 'string' },
    db: { type: 'string' },
    delivery: { type: 'string' },
    'missing-rate': { type: 'string', default: '0.01' },
    'duplicate-rate': { type: 'string', default: '0.02' },
    'max-delay-seconds': { type: 'string', default: '3600' },
    diagnostics: { type: 'string', default: 'data/generator-diagnostics' },
  },
});
const config = { ...defaults };
for (const key of ['seed', 'products', 'shoppers', 'events', 'days'] as const)
  if (values[key]) config[key] = Number(values[key]);
if (values.start) config.start = values.start;
const store = await Store.open(values.db);
await store.seedPersonas();
try {
  const result = await generate(store, config);
  if ('diagnostics' in result) {
    mkdirSync(values.diagnostics!, { recursive: true });
    writeFileSync(`${values.diagnostics}/${result.run}.json`, JSON.stringify(result.diagnostics));
  }
  const { diagnostics, ...summary } = result as typeof result & {
    diagnostics?: unknown;
  };
  console.log(JSON.stringify(summary, null, 2));
  if (values.delivery)
    console.log(
      JSON.stringify(
        await simulateDelivery(store, result.run, values.delivery, {
          seed: config.seed,
          missingRate: Number(values['missing-rate']),
          duplicateRate: Number(values['duplicate-rate']),
          maxDelaySeconds: Number(values['max-delay-seconds']),
        }),
        null,
        2,
      ),
    );
} finally {
  await store.db.close();
}
