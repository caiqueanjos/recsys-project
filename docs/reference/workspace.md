# Workspace and runtime reference

Use this page to locate code and look up runtime configuration. Sources: [root scripts](../../package.json), [Compose](../../compose.yaml), and [TypeScript configuration](../../tsconfig.base.json).

## Repository map

| Path                               | Responsibility                                                        | Entry points                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                         | React/Vite storefront                                                 | [main.tsx](../../apps/web/src/main.tsx), [App.tsx](../../apps/web/src/App.tsx)                                                            |
| `apps/store-api`                   | Fastify store API and PostgreSQL persistence                          | [main.ts](../../apps/store-api/src/main.ts), [server.ts](../../apps/store-api/src/server.ts), [db.ts](../../apps/store-api/src/db.ts)     |
| `packages/store-contracts`         | Shared TypeScript response types and Zod event validation             | [index.ts](../../packages/store-contracts/src/index.ts)                                                                                   |
| `tools/generate`                   | Catalog/history, raw exports, transport experiments, live-cart resets | [cli.ts](../../tools/generate/cli.ts), [export.ts](../../tools/generate/export.ts), [reset-carts.ts](../../tools/generate/reset-carts.ts) |
| `tools/validate`                   | Browser regression and isolated database fixtures                     | [browser.ts](../../tools/validate/browser.ts), [database.ts](../../tools/validate/database.ts)                                            |
| `tools/bronze`                     | Separate Python project for raw Spark/Delta ingestion                 | [ingest.py](../../tools/bronze/ingest.py), [pyproject.toml](../../tools/bronze/pyproject.toml)                                            |
| `apps/api`, `packages/recommender` | User-owned Python recommendation workspace                            | [API project](../../apps/api/pyproject.toml), [recommender project](../../packages/recommender/pyproject.toml)                            |

The npm workspaces are `apps/store-api`, `apps/web`, and `packages/store-contracts`. `tsx` runs TypeScript commands directly; package builds check types, and Vite emits frontend assets. Shared contracts export TypeScript source. The Python recommendation workspace and Bronze environment are independent of npm and of one another.

## Runtime requirements

| Component            | Requirement                                                       |
| -------------------- | ----------------------------------------------------------------- |
| Store and generator  | Node 24, npm                                                      |
| Store persistence    | Docker Compose; checked-in image `postgres:18`                    |
| Browser validation   | Playwright Chromium and its system libraries                      |
| Bronze               | uv; Python `>=3.12,<3.13`; Spark 4.0.1; Delta 4.0.0; JDK 17 or 21 |
| Bronze local process | JVM sockets, local POSIX file locking, Maven access on first run  |

## Environment variables

| Variable                  | Default                                                 | Used by                                                                        |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `STORE_DATABASE_URL`      | `postgresql://store:store@127.0.0.1:5432/store`         | API, generator, export, reset                                                  |
| `STORE_TEST_DATABASE_URL` | `STORE_DATABASE_URL`, otherwise default URL             | API/history/browser test fixtures; role needs schema creation/drop permissions |
| `STORE_POSTGRES_PORT`     | `5432`                                                  | Compose host port; changing it does not change client URLs                     |
| `PORT`                    | `3001`                                                  | Store API listener on `127.0.0.1`                                              |
| `STORE_API_ORIGIN`        | `http://127.0.0.1:3001`                                 | Vite `/api` development proxy                                                  |
| `JAVA_HOME`               | Environment's Java selection                            | JVM used by Spark                                                              |
| `SPARK_IVY_DIR`           | Absolute `data/spark-ivy` relative to working directory | Spark Maven dependency cache                                                   |

There is no automatic `.env` loader in the store entry points. Export variables in your shell or prefix commands. The legacy `STORE_DB` variable is not used.

## Root commands

| Command                 | Effect                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `npm run db:up`         | `docker compose up -d --wait`                                 |
| `npm run db:down`       | Stops/removes Compose containers; retains named volume        |
| `npm run dev:api`       | Runs Fastify through `tsx watch`                              |
| `npm run dev:web`       | Runs Vite on loopback, normally port 5173                     |
| `npm run seed`          | Generates synthetic operational records                       |
| `npm run export:bronze` | Publishes a fresh immutable export directory                  |
| `npm run reset:carts`   | Clears live cart lines and appends removal events             |
| `npm test`              | API and synthetic-history tests                               |
| `npm run test:browser`  | Isolated API plus Vite on port 5175 and Chromium              |
| `npm run build`         | Contracts/API type checks, frontend type check and Vite build |
| `npm run format:check`  | Prettier check of configured TS/TSX/CSS; excludes Markdown    |
| `npm run format`        | Formats those configured source files                         |

Compose binds PostgreSQL to `127.0.0.1`, uses demo credentials `store`/`store`, and mounts its named volume at `/var/lib/postgresql`. The volume name is normally `recsys-project_store-postgres`; the prefix depends on the Compose project name. `docker compose down -v` removes it. Generated data, exports, caches, virtual environments, and build outputs are ignored by Git.

Related: [run the store](../how-to/run-the-store.md), [troubleshoot](../how-to/troubleshoot.md), [documentation index](../README.md).
