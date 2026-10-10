# Recommendation learning project

A working consumer-goods demo store and raw data scaffold for learning recommendation engineering. The store uses React/Vite, a Fastify/TypeScript API, and PostgreSQL in Docker. It includes fake checkout, browser observations, reproducible synthetic history, and local Spark/Delta Bronze ingestion.

Start at the [documentation index](docs/README.md). To build a similar project step by step, follow the [tutorials](docs/tutorials/01-workspace-and-api.md): begin with small mocks, then introduce HTTP, React, shopper/cart state, transactions, and raw data recovery. To run this checkout, use [Run the existing store](docs/how-to/run-the-store.md).

```sh
npm ci
npm run db:up
npm run seed -- --products 140 --shoppers 80 --events 1000 --days 10 --start 2026-07-01T00:00:00.000Z
npm run dev:api
# Another terminal:
npm run dev:web
```

[Reference](docs/reference/workspace.md) documents the implemented contracts and configuration; [explanations](docs/explanation/architecture.md) cover design and tradeoffs. The [scope record](docs/reference/project-scope.md) distinguishes completed scaffold work from proposals.

The Python recommendation projects in `apps/api` and `packages/recommender` remain user-owned. Silver/Gold, retrieval, training, ranking, evaluation, and recommendation serving are not implemented. The homepage list is fixed. PostgreSQL owns store operations; Delta Bronze holds raw analytical data.
