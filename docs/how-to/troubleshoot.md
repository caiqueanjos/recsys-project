# Troubleshoot local development

Use the symptom below to restore a working development environment. Run store commands from the repository root. Runtime/configuration facts are in [workspace reference](../reference/workspace.md).

## PostgreSQL refuses connections

Run `docker compose ps` and `docker compose logs postgres`. Start it with `npm run db:up`. Check that the URL database exists and its host/port match Compose. `STORE_POSTGRES_PORT` changes only the published port; also change `STORE_DATABASE_URL` and test URLs. A database name in a URL does not create that database.

If port 5432 is occupied, start Compose with another port, for example `STORE_POSTGRES_PORT=5433 npm run db:up`, and use `postgresql://store:store@127.0.0.1:5433/store`. Keep the same Compose port setting for later starts. Do not remove the named volume to resolve a port conflict.

## The API is healthy but the catalog is empty

`/health` returns a static process status. Inspect `/products?limit=1` and the seed summary. Check that generation and API use the same database. Generate a small population whose history window ends in the past. The API hides products listed in the future.

## Browser requests fail but direct API requests work

Check `STORE_API_ORIGIN` in the Vite terminal. Restart Vite after changing it. Inspect the browser request URL and response; Vite should forward `/api/products` to API `/products`. In a production host, configure `/api` forwarding separately; Vite's proxy is development-only.

## A refresh or copied product URL fails after deployment

Configure the frontend host to serve `index.html` for client routes such as `/products/ID`, while keeping `/api` routed to the backend. Then test a direct URL and refresh. Route-specific state must come from the URL and API, not an earlier in-memory catalog object.

## A session expires or a guest belongs to an old database

Use the storefront's **Start a new session** action when offered. It starts a session for the current shopper; their cart/order records persist. Reload also opens a new session. Startup recreates a guest if its localStorage ID is absent in the selected database. Session changes alter checkout idempotency scope.

## Browser validation cannot launch Chromium

Run `npx playwright install --with-deps chromium` in an environment allowed to install its system dependencies. Errors naming shared libraries, including `libnspr4.so`, indicate missing OS prerequisites. Ensure port 5175 is free. See [validation](validate.md).

## Generation is rejected or appears slow

Check minimums (35 products, 20 shoppers, 10 days), positive event count, and a past-ending history window. Default generation targets roughly a million events and performs PostgreSQL round trips; use 1000 events for an initial smoke check. Participating writes wait while generation holds its transaction lock. Reusing an exact completed config returns `alreadyGenerated`, not a new population.

## Spark fails before reading the batch

Check `java -version` and select JDK 17 or 21 through `JAVA_HOME`. Run `uv run --project tools/bronze python --version` and confirm Python 3.12. Allow Maven dependency downloads and writable `SPARK_IVY_DIR`; allow local JVM sockets. Run Bronze on a POSIX local filesystem with file-lock support.

## Ingestion rejects a batch

| Message/symptom                          | Action                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Integrity check failure                  | Recover the original immutable files or create a new authoritative export; do not alter manifest hashes to disguise corruption |
| Skips unprocessed events                 | Export from this source's completed cursor or earlier                                                                          |
| Logical record changed during replay     | Investigate provenance/changed content; preserve original records                                                              |
| Events table missing while cursor exists | Replay from zero into a new Bronze root                                                                                        |
| Failure after events commit              | Rerun the identical batch/root without the failure flag                                                                        |
| Export output already exists             | Choose a new directory; do not overwrite completed exports                                                                     |

Related: [incremental export/ingestion](export-and-ingest.md), [recovery explanation](../explanation/bronze-recovery.md), [index](../README.md).
