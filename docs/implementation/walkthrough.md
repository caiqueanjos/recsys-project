# Tutorial: follow a store interaction into an export

Observe identity persistence, transactional events, and the raw export using an isolated learning database. Run commands from the repository root with Node 24, Docker Compose, and installed npm dependencies. This exercise does not require Spark and uses a separate PostgreSQL database.

## 1. Create a small catalog and history

Choose a fresh database name and export path if you have already completed this exercise:

```sh
npm ci
npm run db:up
docker compose exec postgres createdb -U store docs_demo
npm run seed -- --db postgresql://store:store@127.0.0.1:5432/docs_demo --products 140 --shoppers 80 --events 1000 --seed 17 --start 2026-07-01T00:00:00.000Z --days 10
```

The summary reports run, events, sessions, and orders. Expect at least the requested event count because generation finishes its last session. The historical window must end in the past.

## 2. Start the store

In one terminal:

```sh
STORE_DATABASE_URL=postgresql://store:store@127.0.0.1:5432/docs_demo npm run dev:api
```

In another:

```sh
npm run dev:web
```

Open `http://127.0.0.1:5173`. If those ports are already occupied, follow the [runbook](../local-development.md) to configure the API port and Vite proxy.

## 3. Observe persistence and checkout

1. Select Guest, open Shop all, search for `kettle`, open an available item, and add it to the bag.
2. Switch to Sam. Sam's bag is separate. Switch back to Guest to recover the item.
3. Reload. The current route stays open under a new session; Guest's bag remains.
4. Open the bag and place a demo order. The bag clears and history displays the order with saved prices. There is no payment.

If the localStorage guest belongs to another database, startup recreates it. Browser observations are asynchronous; allow activity recording to finish before exporting. Backend purchase recording is already committed when checkout succeeds.

## 4. Inspect an immutable raw batch

While the API is using that database, export from another terminal:

```sh
npm run export:bronze -- --db postgresql://store:store@127.0.0.1:5432/docs_demo --output data/exports/docs-demo
```

Open `manifest.json`, `events.ndjson`, and `catalog.ndjson` under `data/exports/docs-demo`. The manifest names the database source, high-water sequence, snapshot, counts, and checksums. Event payloads include earlier synthetic activity and the new browser/backend activity; the purchase source is `store_backend`, while the impression/click source is `browser`.

For a concise count check:

```sh
node --input-type=module -e 'import { readFileSync } from "node:fs"; const m = JSON.parse(readFileSync("data/exports/docs-demo/manifest.json", "utf8")); console.log(m.highWater, m.files["events.ndjson"].count);'
```

Because this export starts at zero, its event line count equals the high-water sequence. Running the same export path again is rejected; choose a fresh path for another snapshot.

Stop both development servers with Ctrl-C. Keep the artifacts for inspection. Continue with [event semantics](events.md), [generation](synthetic-history.md), or [Bronze ingestion](bronze.md); the [runbook](../local-development.md) gives the optional Spark steps.
