# Build and understand a recommendation learning store

This project gives you a working e-commerce demo and raw behavioral data to practice recommendation engineering. Its store is implemented; its recommendation platform is yours to build.

Start with a small working system. The learning path below teaches workspace setup, a mock API, a React storefront, demo checkout, database transactions, event collection, and raw ingestion. You will build the complete small learning system in a **separate `store-lab` directory**, then use this repository for comparison exercises. Each construction lesson extends the same lab; repository comparison exercises follow the completed build path.

You need basic JavaScript functions, arrays, objects, promises, terminal use, and HTTP knowledge. Start with [machine setup](how-to/prepare-your-machine.md) and use [learning foundations](explanation/learning-foundations.md) before the TypeScript, React, SQL, and Spark lessons. If JSX or Python is new, the primers link to introductory practice before those sections. Node 24 and npm are needed first; Docker Compose comes in lesson 4; Python/uv and Java come in lesson 7.

## Tutorials: learn by building

Follow these lessons in order. Each has a small result you can check before continuing.

| Lesson                                                                             | What you will build                                                          | Starting point  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------- |
| [1. Workspace and mock catalog API](tutorials/01-workspace-and-api.md)             | Shared types, two-product API, request tests                                 | Empty directory |
| [2. Storefront from a mock](tutorials/02-storefront.md)                            | React catalog, URL search, product pages                                     | Lesson 1        |
| [3. Shoppers, carts, and mock checkout](tutorials/03-mock-checkout.md)             | Isolated carts, retry keys, checkout UI                                      | Lesson 2        |
| [4. Replace the mock store with PostgreSQL](tutorials/04-postgres-transactions.md) | Durable API behind the same UI, history, rollback/restart checks             | Lesson 3        |
| [5. Build browser observation collection](tutorials/05-build-events.md)            | Shared validation, ordered queue, exposure attribution, transactional intake | Lesson 4        |
| [6. Build an immutable exporter](tutorials/06-build-exports.md)                    | Raw envelopes, catalog snapshots, hashes, incremental cursor                 | Lesson 5        |
| [7. Build replay-safe Delta ingestion](tutorials/07-build-bronze.md)               | Your own raw merges, completed progress, crash recovery                      | Lesson 6        |

## Repository comparison exercises

After building the lab, examine how this repository handles a larger catalog, more event types, synthetic cohorts, and operational validation. These exercises use the completed implementation to illustrate differences in scope and scale.

- [A. Trace live store actions](tutorials/05-observe-the-store.md): create a separate reference-store database and inspect exposure/purchase records.
- [B. Generate a tiny reproducible history](tutorials/06-synthetic-history.md): build a seeded loop using the reference project's tested persistence helpers.
- [C. Exercise reference Bronze recovery](tutorials/07-bronze-replay.md): compare your ingestion with the checked-in protocol.

The teaching mocks omit features deliberately. They are labeled where introduced, and every lesson links to the corresponding implementation. You do not need to build a ranking model to finish this path.

## How-to guides: get a task done

- [Prepare your machine](how-to/prepare-your-machine.md).
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
- [Operational database and relationship diagram](reference/database.md).
- [Generator and command options](reference/generator.md).
- [Export format and Bronze protocol](reference/bronze.md).
- [Frontend routes and state](reference/frontend.md).
- [Project scope and implementation decisions](reference/project-scope.md).

## Explanation: understand the design

- [Learning foundations: types, React, SQL, and Spark](explanation/learning-foundations.md).
- [System boundaries and data flow](explanation/architecture.md).
- [How mocks help you build in stages](explanation/mocks-and-increments.md).
- [Shopper identity, sessions, and browser state](explanation/identity-and-navigation.md).
- [Atomic checkout, retries, and event sequences](explanation/transactions.md).
- [What behavioral events can tell you](explanation/observations.md).
- [What synthetic history can and cannot teach you](explanation/synthetic-data.md).
- [Why Bronze needs snapshots and durable progress](explanation/bronze-recovery.md).
- [A future path to recommendations and Databricks](explanation/recommendation-roadmap.md).

The structure follows the four reader needs in [Diátaxis](https://diataxis.fr/start-here/): learning, doing, looking up, and understanding. References describe the checked-in implementation. Roadmap pages describe proposals. No cloud deployment, Silver/Gold pipeline, model training, or recommendation serving is implemented here.
