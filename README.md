# Recommendation learning project

A consumer-goods store scaffold for learning recommendation engineering. React/Vite (`apps/web`) and a TypeScript/SQLite API (`apps/store-api`) support browsing, personas, carts, demo checkout, and observed behavior. Reproducible synthetic history and raw local Spark/Delta ingestion provide offline data.

See the [local runbook](docs/local-development.md), [store contract](docs/store-contract.md), and [implementation plan](docs/implementation-plan.md).

```sh
npm ci
npm run seed -- --products 350 --shoppers 200 --events 20000
npm run dev:api
# Another terminal:
npm run dev:web
```

The Python recommendation platform in `apps/api` and `packages/recommender` is user-owned. Silver/Gold, retrieval, training, ranking, evaluation, and recommendation serving remain for the user to build. SQLite owns store operations and events; it is not the analytical lakehouse or recommendation feature store. Homepage favorites are fixed.
