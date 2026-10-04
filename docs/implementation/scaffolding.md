# Project scaffolding

Understand which workspace owns each part before running or extending the project. This is an explanation of the current scaffold, not a reconstruction of its commit history.

To create a new repository with these boundaries, follow the [workspace setup tutorial](workspace-setup.md). It builds a minimal runnable frontend/API/shared-package example and optionally adds the independent Python projects.

## Repository map

| Location | Implemented responsibility | Entry point |
| --- | --- | --- |
| `apps/web` | React 19 storefront, Vite development server, CSS | [main.tsx](../../apps/web/src/main.tsx) |
| `apps/store-api` | Fastify 5 store operations with SQLite | [main.ts](../../apps/store-api/src/main.ts) |
| `packages/store-contracts` | Shared types and Zod 4 event validation | [index.ts](../../packages/store-contracts/src/index.ts) |
| `tools/generate` | Catalog/history, exports, delivery simulation, cart reset | [cli.ts](../../tools/generate/cli.ts) |
| `tools/validate` | Isolated browser regression | [browser.ts](../../tools/validate/browser.ts) |
| `tools/bronze` | Standalone Spark/Delta raw ingestion | [ingest.py](../../tools/bronze/ingest.py) |
| `apps/api`, `packages/recommender` | User-owned Python placeholders | [API entry](../../apps/api/main.py) |

The root [package.json](../../package.json) includes three npm workspaces: store API, web, and contracts. Generation and browser tools run from the root with `node --import tsx`. Contracts export TypeScript source directly. The build checks contracts and API types, then checks web types and emits Vite production assets; it does not emit a deployable API bundle.

## Runtime boundaries

Store development requires Node 24 for built-in `node:sqlite`. The root [Python workspace](../../pyproject.toml) requires Python 3.14 or newer and contains the recommendation projects. Bronze has its own [Python project](../../tools/bronze/pyproject.toml), using Python 3.12 and separate dependencies. Keep these environments independent.

The API binds to loopback on port 3001 by default. Vite serves the storefront on port 5173 and rewrites `/api/products` to `/products` at the API origin through its [development proxy](../../apps/web/vite.config.ts). A production reverse proxy or deployment topology is not implemented by this scaffold.

SQLite defaults to `data/store.sqlite`; `STORE_DB` selects another database. Generated data, dependencies, build outputs, and local environments are ignored by Git. Database initialization uses `CREATE TABLE IF NOT EXISTS`; there is no versioned migration framework.

For installation and exact commands, use the [local runbook](../local-development.md). Continue with [architecture](architecture.md).
