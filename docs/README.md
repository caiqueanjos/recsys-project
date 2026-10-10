# Build and understand a recommendation learning store

This project gives you a working e-commerce demo and raw behavioral data to practice recommendation engineering. Its store is implemented; its recommendation platform is yours to build.

Start with a small working system. The learning path below teaches workspace setup, a mock API, a React storefront, demo checkout, database transactions, event collection, and raw ingestion. You will build the early lessons in a **separate directory**, then use this repository to examine the fuller implementation.

You need basic JavaScript, terminal, and HTTP knowledge. The lessons introduce TypeScript, SQL transactions, and event ingestion when you use them. Node 24 and npm are needed first; Docker Compose comes in lesson 4; Python/uv and Java come in lesson 7.

## Tutorials: learn by building

Follow these lessons in order. Each has a small result you can check before continuing.

| Lesson                                                                                   | What you will make                                           | Starting point  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------- |
| [1. Create a workspace and mock catalog API](tutorials/01-workspace-and-api.md)          | Two npm packages and a tested HTTP API                       | Empty directory |
| [2. Build a storefront from a mock](tutorials/02-storefront.md)                          | React catalog, URL search, product pages, API connection     | Lesson 1        |
| [3. Add shoppers, carts, and mock checkout](tutorials/03-mock-checkout.md)               | In-memory identity isolation and retry-safe demo orders      | Lesson 2        |
| [4. Make a checkout durable with PostgreSQL](tutorials/04-postgres-transactions.md)      | A real transaction with orders, events, rollback, and replay | Lesson 3        |
| [5. Follow a browser action into an event](tutorials/05-observe-the-store.md)            | An isolated store experiment and traceable observations      | This repository |
| [6. Generate a tiny reproducible history](tutorials/06-synthetic-history.md)             | A seeded observation simulator using private fixtures        | Lesson 5        |
| [7. Export raw data and recover an interrupted ingestion](tutorials/07-bronze-replay.md) | Immutable export and replay-safe local Delta tables          | Lesson 5        |

The teaching mocks omit features deliberately. They are labeled where introduced, and every lesson links to the corresponding implementation. You do not need to build a ranking model to finish this path.

## How-to guides: get a task done

- [Run the existing store](how-to/run-the-store.md).
- [Create an isolated experiment and reset live carts](how-to/manage-experiments.md).
- [Generate history and delivery experiments](how-to/generate-data.md).
- [Export and ingest incremental data](how-to/export-and-ingest.md).
- [Change a store feature](how-to/change-a-feature.md).
- [Run the right validation checks](how-to/validate.md).
- [Troubleshoot the local environment](how-to/troubleshoot.md).

## Reference: look up exact behavior

- [Repository map and runtime configuration](reference/workspace.md).
- [Store HTTP API](reference/http-api.md).
- [Event contract v1](reference/events.md).
- [Operational database](reference/database.md).
- [Generator and command options](reference/generator.md).
- [Export format and Bronze protocol](reference/bronze.md).
- [Frontend routes and state](reference/frontend.md).
- [Project scope and implementation decisions](reference/project-scope.md).

## Explanation: understand the design

- [System boundaries and data flow](explanation/architecture.md).
- [How mocks help you build in stages](explanation/mocks-and-increments.md).
- [Shopper identity, sessions, and browser state](explanation/identity-and-navigation.md).
- [Atomic checkout, retries, and event sequences](explanation/transactions.md).
- [What behavioral events can tell you](explanation/observations.md).
- [What synthetic history can and cannot teach you](explanation/synthetic-data.md).
- [Why Bronze needs snapshots and durable progress](explanation/bronze-recovery.md).
- [A future path to recommendations and Databricks](explanation/recommendation-roadmap.md).

The structure follows the four reader needs in [Diátaxis](https://diataxis.fr/start-here/): learning, doing, looking up, and understanding. References describe the checked-in implementation. Roadmap pages describe proposals. No cloud deployment, Silver/Gold pipeline, model training, or recommendation serving is implemented here.
