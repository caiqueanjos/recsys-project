# Local development

Use this guide to run the storefront, generate test data, and load raw exports into local Bronze tables. Run commands from the repository root unless a step says otherwise.

The store requires **Node 24 and npm**. Bronze ingestion also requires **uv, Python 3.12, and JDK 17 or 21**. Its Python environment lives in `tools/bronze`, independently of the recommendation projects.

## Run the store

Install dependencies and create a small dataset for browsing:

```sh
npm ci
npm run seed -- --products 350 --shoppers 200 --events 20000
```

Start the API in one terminal:

```sh
npm run dev:api
```

Start the storefront in another terminal:

```sh
npm run dev:web
```

Open http://127.0.0.1:5173. The API runs at http://127.0.0.1:3001, and Vite forwards `/api` requests to it. Store data is saved in `data/store.sqlite` by default.

You can browse as a guest or switch between demo personas. Each shopper keeps their own cart and order history. Switching personas or reloading starts a new session; sessions expire after 30 minutes of inactivity. The browser remembers the guest identity in localStorage. This demo identity mechanism does not provide authentication.

### Change the database or ports

| Variable | Purpose | Default |
| --- | --- | --- |
| `STORE_DB` | SQLite database used by the API and store commands | `data/store.sqlite` |
| `PORT` | API port | `3001` |
| `STORE_API_ORIGIN` | API address used by Vite's development proxy | `http://127.0.0.1:3001` |

For example, to run an experiment on another database and API port:

```sh
npm run seed -- --db data/experiment.sqlite --products 350 --shoppers 200 --events 20000
STORE_DB=data/experiment.sqlite PORT=3002 npm run dev:api
```

In the storefront terminal, point Vite at that port:

```sh
STORE_API_ORIGIN=http://127.0.0.1:3002 npm run dev:web
```

Set `STORE_DB` for export and reset commands too when working with that database. The seed and export commands also accept `--db`.

For deployment, the frontend host must serve `index.html` for frontend routes and forward `/api` to the backend. See [storefront behavior](implementation/storefront.md) for navigation and catalog details.

## Synthetic history

The small dataset above is enough to try the UI. To generate the full default dataset:

```sh
npm run seed
```

Defaults are 10,000 products, 20,000 shoppers, and roughly 1 million events over 90 days, starting July 1, 2026 UTC. The window ends September 29, with a September 11 cutoff for introducing cold-start products and shoppers.

For a separate experiment, choose a database and seed:

```sh
npm run seed -- --db data/experiment.sqlite --seed 7 --products 1000 --shoppers 2000 --events 100000
```

Use `--start` with a UTC ISO timestamp and `--days` to change the history window. The window must end in the past. Minimums are 35 products, 20 shoppers, and 10 days. The event count is approximate because generation finishes the last session before stopping.

Repeating a completed configuration skips generation. Changing the configuration adds another synthetic population to the same database; it does not replace the previous one. The first seed establishes the fixed homepage trending list. Use separate databases to keep experiments independent. Generation runs in one transaction and can block writes from a running store.

Generator diagnostics are written to `data/generator-diagnostics/<run>.json`. Use `--diagnostics` to choose another directory. These files contain simulated preferences and cohort information; keep them out of model inputs. They are excluded from operational tables and Bronze exports.

The data includes browsing, clicks, persistent carts, abandoned sessions, and repeat orders. See [synthetic history](implementation/synthetic-history.md) for behavioral assumptions and cohort definitions. Synthetic evaluation can check engineering behavior, but it does not establish real-world recommendation effectiveness.

### Simulate missing, duplicate, or delayed deliveries

Delivery simulation is optional. It writes a separate NDJSON file without changing the store's events or orders:

```sh
npm run seed -- --db data/delivery-experiment.sqlite --products 350 --shoppers 200 --events 20000 --delivery data/delivery/experiment.ndjson
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--missing-rate` | `0.01` | Fraction of events omitted from delivery |
| `--duplicate-rate` | `0.02` | Probability of an extra delivery for a retained event |
| `--max-delay-seconds` | `3600` | Maximum simulated delivery delay |

The same seed and configuration produce identical output. Choose a new output path for each run; existing files are not overwritten. This file is a delivery experiment, not a Bronze export, and no implemented pipeline automatically ingests or cleans it.

## Bronze prerequisites and ingestion

Bronze is the raw ingestion layer: it stores exported events and catalog snapshots in local Delta tables. It preserves raw JSON and source metadata without adding recommendation features or transformations.

### Set up the ingestion environment

Install uv and JDK 17 or 21, then sync the standalone Python project:

```sh
uv sync --project tools/bronze
```

uv can provision the required Python 3.12 version. The project uses Spark 4.0.1 and Delta 4.0.0. Set `JAVA_HOME` if Java is not found.

Spark needs local JVM sockets and network access for its first Maven downloads. Downloaded dependencies are cached in `data/spark-ivy`, relative to the working directory; `SPARK_IVY_DIR` overrides that path. If Spark cannot resolve the local hostname, set `SPARK_LOCAL_IP=127.0.0.1` when running ingestion.

### Export and ingest the first batch

```sh
npm run export:bronze -- --output data/exports/first
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/first
```

The export directory contains `events.ndjson`, `catalog.ndjson`, and a manifest with counts and checksums. Choose a new directory for every export; existing directories are not overwritten. The catalog snapshot represents the state at export time, rather than historical availability.

Ingestion prints the source ID, the last processed event sequence (`cursor`), and the snapshot ID. It writes:

| Path | Contents |
| --- | --- |
| `data/bronze/events` | Raw events in a Delta table |
| `data/bronze/catalog` | Catalog snapshots in a Delta table |
| `data/bronze/progress.json` | Last processed event sequence for each source database |

You can rerun the ingestion command for the same batch. Matching records are not duplicated; conflicting records are rejected.

### Export only new events

Read `data/bronze/progress.json` and find the sequence for your database's source ID. The source ID also appears in the export manifest and ingestion output. Pass that sequence as `--after`:

```sh
# Example only: replace 20013 with this source's actual cursor.
npm run export:bronze -- --after 20013 --output data/exports/second
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/second
```

This exports events after the given sequence and a new catalog snapshot. Ingestion rejects batches that skip unprocessed events. Earlier or overlapping batches can be replayed safely.

Exports and ingestion are run manually. A file lock allows one local ingestion writer at a time. Progress is saved only after both Delta tables have been committed. If ingestion fails between commits, rerun the same batch to finish it. To exercise this recovery path, add `--fail-after-events` to an ingestion command, then retry without the flag.

See [exports and Bronze](implementation/bronze.md) for envelope fields, merge keys, and recovery guarantees. This scaffold supports local filesystems. Future online recommendation requests will send current session context directly to the recommendation API, independently of offline ingestion.

## Run validation

Run the store checks from the repository root:

```sh
npm test
npm run build
npm run format:check
```

For browser checks, install Chromium once, then run the regression suite. On Linux, the install command may also need to install system dependencies:

```sh
npx playwright install --with-deps chromium
npm run test:browser
```

The browser suite creates an isolated temporary store. It checks navigation, identity and cart isolation, checkout, session recovery, mobile layout, and observed events.

For Spark/Delta integration checks, run from `tools/bronze`:

```sh
cd tools/bronze
uv run python -m unittest discover -s tests -v
```

These checks use the same Java, network, and socket prerequisites as ingestion. See [validation coverage](implementation/validation.md) for the full list of checks and known limits.

## Reset carts or start a fresh experiment

To clear carts used by guests and demo personas:

```sh
npm run reset:carts
```

This appends backend cart-removal events and clears live carts. Synthetic carts, orders, shopper identities, and existing events are retained.

To start a separate store experiment, seed a new database with `--db` and point the API at it with `STORE_DB`, as shown above. Each database has its own source ID. Export any learning records you want to keep before discarding a database.

To rebuild Bronze, export from sequence zero into a new directory, then ingest into a new root:

```sh
npm run export:bronze -- --after 0 --output data/exports/rebuild
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/rebuild --root data/bronze-rebuild
```

Use the new root for later ingestion commands too. Do not reuse an old progress file after deleting the tables it tracks.
