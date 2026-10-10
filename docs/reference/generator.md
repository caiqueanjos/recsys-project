# Generator and CLI reference

Sources: [generator.ts](../../tools/generate/generator.ts), [cli.ts](../../tools/generate/cli.ts), [delivery.ts](../../tools/generate/delivery.ts), [export.ts](../../tools/generate/export.ts). All commands below run from the repository root.

## History generation: `npm run seed -- [options]`

| Option                | Default                            | Rule                                                                              |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `--db`                | Environment/default PostgreSQL URL | PostgreSQL URL; database must already exist                                       |
| `--seed`              | `42`                               | Safe integer                                                                      |
| `--products`          | `10000`                            | Integer >=35                                                                      |
| `--shoppers`          | `20000`                            | Integer >=20                                                                      |
| `--events`            | `1000000`                          | Positive integer target; finishes last session, so actual count can exceed target |
| `--days`              | `90`                               | Integer >=10                                                                      |
| `--start`             | `2026-07-01T00:00:00.000Z`         | Valid timestamp; history window must end in the past                              |
| `--diagnostics`       | `data/generator-diagnostics`       | Separate output directory for latent simulator diagnostics                        |
| `--delivery`          | Disabled                           | New output file for optional transport simulation                                 |
| `--missing-rate`      | `0.01`                             | Number in [0,1]; only used with delivery                                          |
| `--duplicate-rate`    | `0.02`                             | Number in [0,1]; only used with delivery                                          |
| `--max-delay-seconds` | `3600`                             | Finite nonnegative number; only used with delivery                                |

The run ID is the first 12 hex characters of SHA-256 over the serialized normalized configuration and `generatorVersion=1`. Synthetic IDs use `<run>-<kind>-<zero-padded-number>`. Repeating a completed configuration in the same database returns `alreadyGenerated: true`; changing it adds a population. Diagnostics are emitted on new generation; skipping an old run does not recreate a missing diagnostics file. An existing delivery path is rejected.

The generator uses seven categories: Electronics, Home & Kitchen, Personal Care, Clothing, Sports, Toys, and Groceries. Catalog variants keep category, type, subcategory, brand, description, and plausible price aligned. The initial available products among indices 0–11 establish trending positions; later runs do not overwrite occupied positions.

## Cohorts and behavior

| Property               | Implementation                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| Chronological cutoff   | Start + floor(days ×0.8) days                                               |
| Cold products/shoppers | Last 15% by index; listed/created after cutoff                              |
| Unobserved entities    | Last 5%; subset of cold cohort, excluded from simulated interactions        |
| Sparse shoppers        | Index interval [75%,85%); at most one generated session                     |
| Activity               | Seeded mixture of skewed head activity and broader shopper sampling         |
| Exposure               | Category intent, off-interest exploration, skewed candidate frequency       |
| Clicks                 | Category/brand/price affinity and position discount plus random exploration |
| Cart/order state       | Persistent across sessions; purchased items reconciled to order records     |

Cold and sparse definitions are deterministic index cohorts, not random labels inferred from model inputs. Diagnostics hold `interest`, `brand`, `budget`, `propensity`, and cohort flags; operational shopper records do not.

Generation uses one transaction and blocks other participating event-producing writes. PostgreSQL default-scale generation has not been benchmarked. Earlier million-event observations used SQLite and do not establish PostgreSQL throughput.

## Delivery simulation

Delivery wraps unchanged event objects in `{ deliveryId, deliveredAt, event }`. Missing events are omitted from the artifact; duplicates repeat the logical event with another delivery ID. Delays retain monotonically ordered delivery times and preserve causal event timestamps. The summary reports `original`, `delivered`, `missing`, `duplicate`, and SHA-256.

This artifact is **not** a standard Bronze export and has no direct ingestion command. Authoritative events, carts, and orders are unchanged.

## Export: `npm run export:bronze -- [options]`

| Option     | Default                                    | Rule                                                    |
| ---------- | ------------------------------------------ | ------------------------------------------------------- |
| `--db`     | Environment/default PostgreSQL URL         | Select source database                                  |
| `--output` | Timestamped directory under `data/exports` | Must not exist                                          |
| `--after`  | `0`                                        | Safe nonnegative integer, <= source high-water sequence |

Includes events `(after, highWater]` and a full export-time catalog snapshot. See [Bronze format](bronze.md).

## Reset: `npm run reset:carts`

Uses `STORE_DATABASE_URL`; there is no `--db` option. Removes cart lines for non-synthetic shoppers, creates reset sessions with `source=live`, and appends backend `cart_remove` events with page `/reset`. Synthetic carts and all historical data remain.

Related: [generate data](../how-to/generate-data.md), [synthetic limitations](../explanation/synthetic-data.md), [index](../README.md).
