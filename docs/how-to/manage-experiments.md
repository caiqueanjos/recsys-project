# Isolate an experiment and reset live carts

Use this guide to work with a separate dataset or clear demo carts while preserving learning records. Prerequisites: a running Compose PostgreSQL instance and installed npm dependencies. Run from the repository root.

## Create a separate database

Choose an unused database name. This example uses `experiment`:

```sh
docker compose exec -T postgres createdb -U store experiment
export STORE_DATABASE_URL=postgresql://store:store@127.0.0.1:5432/experiment
npm run seed -- --products 140 --shoppers 80 --events 1000 --days 10 --start 2026-07-01T00:00:00.000Z
PORT=3002 npm run dev:api
```

In another terminal:

```sh
STORE_API_ORIGIN=http://127.0.0.1:3002 npm run dev:web
```

Confirm the API's `/products` response and browse through the Vite URL. Seed/export accept `--db URL` as an alternative to the environment variable. Reset uses only the environment variable. Set the same connection in every terminal operating on this experiment.

The browser may remember a guest ID from another database. On startup the app recreates an absent guest. A persona switch or page reload starts a fresh session. Each database has its own persistent source ID; retain that provenance when inspecting Bronze progress.

## Clear live carts

With `STORE_DATABASE_URL` pointing at the intended database:

```sh
npm run reset:carts
```

Expect a count of cleared live cart lines. Reload the storefront to fetch current state. Backend removal events and reset sessions are added; shoppers, orders, earlier events, and synthetic carts remain. The command has no full-dataset reset mode.

Check the result with SQL (replace the database name if needed):

```sh
docker compose exec -T postgres psql -U store -d experiment <<'SQL'
SELECT count(*) FROM carts c JOIN shoppers s ON s.id=c."shopperId"
WHERE s.kind <> 'synthetic';
SQL
```

Expect zero live cart lines. Historical events should still exist.

## Start over without erasing prior work

Create another database with another name, seed it, and point the API at it. If you need to rebuild analytical tables, export from sequence zero to a new directory and ingest into a new Bronze root; see [export and ingest](export-and-ingest.md). Do not delete event rows to make a fresh experiment.

Related: [database reference](../reference/database.md), [scope](../reference/project-scope.md), [index](../README.md).
