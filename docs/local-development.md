# Local store runbook

Use Node 24 and npm. The recommendation Python projects remain independent.

```sh
npm ci
npm run seed -- --products 350 --shoppers 200 --events 20000
npm run dev:api
# Another terminal:
npm run dev:web
```

Open http://127.0.0.1:5173. API: 127.0.0.1:3001; Vite proxies `/api`. `STORE_DB` changes the SQLite path (default `data/store.sqlite`). `PORT` changes the API port; set `STORE_API_ORIGIN` for Vite to match. Persona switching and reloads open new sessions; each identity retains carts/orders. Guest identity persists in localStorage. Sessions expire after 30 minutes of inactivity. This is a local demo identity system, not authentication. Navigation uses React Router: reload keeps the current URL, catalog filters/pagination use query parameters, and product URLs support direct entry. A production host must provide an SPA fallback to `index.html` for frontend paths and route `/api` to the backend. USD prices use integer cents; product art uses category placeholders. Availability is a boolean, not stock accounting. Favorites are a fixed seeded list.

## Synthetic history

```sh
# Full defaults: 10k products, 20k shoppers, ~1m events, 90 days.
npm run seed
npm run seed -- --db data/experiment.sqlite --seed 7 --products 1000 --shoppers 2000 --events 100000
```

Defaults span July 1–September 29, 2026 UTC; chronological cutoff: September 11. Override `--start` (UTC ISO) and `--days` for another past window. Minimums: 35 products, 20 shoppers, 10 days. Generation completes its last coherent session, so the event target is approximate. Seed/configuration determines stable IDs; repeating a completed configuration does nothing. Different configurations append isolated populations; use separate databases when you want one population. The first seed owns the fixed favorites list. Full generation uses one transaction and can block live writes; use a separate database for experiments.

Sessions mix category/brand affinity, budget sensitivity, changing intent, exploration, position-biased clicks, skewed activity/popularity, impulse additions, abandoned carts, and repeat orders. Clicks reference prior impressions. Cart actions require available/listed products. Orders consume persistent carts chronologically and reconcile with purchase events. Delivery corruption is disabled by default. Add `--delivery data/delivery/experiment.ndjson` to write a separate transport experiment with seeded missing, duplicate, and delayed envelopes. Configure `--missing-rate` (default 0.01), `--duplicate-rate` (0.02), and `--max-delay-seconds` (3600). This leaves authoritative events/orders unchanged, retains event timestamps and causal delivery ordering, and reports counts/checksum. Repeating it with the same seed produces identical bytes; choose a new output path. Envelopes distinguish delivery IDs/times from logical events. This experimental artifact is separate from the contiguous, replay-safe Bronze export; no automatic cleaning or model pipeline consumes it.

The last 15% of shopper/product IDs are introduced after the 80%-time cutoff; the last 5% are intentionally unobserved. A separate 10% shopper cohort has at most one session. Actual observed cohort counts depend on seed/scale. Latent preferences and cohort diagnostics live only in `data/generator-diagnostics/<run>.json` (override `--diagnostics`), never operational tables or Bronze exports. Run metadata retains configuration and counts, not latent vectors. Diagnostics are simulator internals, not model inputs. Synthetic evaluation is not evidence of real-world effectiveness. Catalog templates and static availability simplify reality; current snapshots do not reconstruct historical availability.

## Bronze prerequisites and ingestion

The approved standalone `tools/bronze` project uses Python 3.12, Spark 4.0.1, Delta 4.0.0. Install JDK 17 or 21 and set `JAVA_HOME` if needed. `uv sync` can provision Python 3.12. First-run Maven downloads need network access; Spark needs local JVM sockets. Ivy cache: `data/spark-ivy` relative to the working directory (`SPARK_IVY_DIR` overrides it). For hostname issues, set `SPARK_LOCAL_IP=127.0.0.1`.

References: [Spark prerequisites](https://spark.apache.org/docs/4.0.0/index.html), [Delta setup](https://docs.delta.io/quick-start/).

```sh
uv sync --project tools/bronze
npm run export:bronze -- --output data/exports/first
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/first
# Replaying the same batch is safe.
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/first
```

Exports capture a consistent SQLite transaction in immutable checksummed NDJSON plus a manifest. Existing directories are never overwritten. Event envelopes preserve source database ID, sequence, logical ID, event/ingestion times, provenance, version, and raw JSON. Catalog rows preserve snapshot ID/time, product ID, listing time, and raw JSON; snapshots represent state at export time. Future-listed products are excluded. Latent diagnostics are excluded.

Delta tables: `data/bronze/events`, `data/bronze/catalog`; source-specific durable cursors: `data/bronze/progress.json`. Event merge key: sourceId/eventId; catalog merge key: sourceId/snapshotId/productId. Replayed logical records must match existing fields. No cleaning, features, embeddings, or ranking are added. Original ingestion times are retained; Delta commit history records Bronze write times.

Read the current source cursor from progress.json and pass it as `--after` for incremental export:

```sh
# Replace 20013 with your actual cursor.
npm run export:bronze -- --after 20013 --output data/exports/second
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/second
```

Exports starting ahead of the cursor are rejected; earlier ranges are safe. A file lock serializes local writers. Progress advances after both Delta commits; a crash between commits is repaired through replay. Exercise this with `--fail-after-events`, then retry without that flag. Local filesystems are the supported boundary, not cloud/distributed locking. Exports and ingestion are manually scheduled. Future online requests still send current session context directly to the recommendation API independently of offline ingestion.

## Validation and selective resets

```sh
npm test
npm run build
npm run format:check
# One-time Chromium setup (Linux may require system dependencies):
npx playwright install --with-deps chromium
npm run test:browser
# Real Spark/Delta integration test:
cd tools/bronze
uv run python -m unittest discover -s tests -v
```

The browser check creates an isolated temporary store and verifies URL filters/pagination, Back/Forward, product direct links and refresh, missing routes/products, cart/persona isolation, checkout retry idempotency/history, session recovery, mobile overflow, and observed events. Browser observations retry in memory with stable IDs; closing the tab can lose unsent observations. Transactional events are persisted by the backend independently.

API/history checks cover identity isolation, session expiry, checkout retry/rollback, exposure attribution, append-only events, reproducibility, chronological carts/orders, references, and cold/unobserved cohorts. Spark checks cover crash recovery, replay, incremental/empty batches, snapshots, monotonic cursors, checksums, and skipped ranges.

`npm run reset:carts` clears only live carts and appends backend removal events. Synthetic carts, orders, identities, and existing learning events remain. Rebuild Bronze by using a new `--root data/bronze-rebuild` and replaying from zero. Do not keep an old cursor after removing its tables. Start separate store experiments with a new `STORE_DB`, which receives a distinct source ID. Preserve/export learning records before intentionally discarding a database.

Validation on the implementation host included 10,000 products, 20,000 shoppers, and 1,000,014 generated events, plus ingestion of a real 20,013-event export into Delta. These are local feasibility observations, not a throughput guarantee.
