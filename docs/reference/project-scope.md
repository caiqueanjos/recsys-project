# Project scope and implementation decisions

This is the record of agreed scaffold scope. All six original stages are implemented: contracts/data model, store API, storefront, synthetic history, local Bronze, and validation. The former implementation plan is consolidated here.

## Implemented responsibilities

| Component                | Scope                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Store                    | Consumer-goods browsing/search, product details, carts, demo checkout, orders                                   |
| Identity                 | Anonymous guests and three selectable personas; persistent per-shopper carts/history                            |
| Recommendations in store | Fixed seeded homepage list; no related-product sections on product/cart pages                                   |
| Events                   | Browser observations, backend transactional events, append-only storage, exposure attribution                   |
| Synthetic history        | Reproducible coherent catalog/sessions/orders, behavioral randomness, position bias, chronological cold cohorts |
| Data delivery            | Optional separate missing/duplicate/delay artifact                                                              |
| Raw analytical landing   | Immutable exports, incremental local Spark/Delta Bronze, replay/conflict/gap checks and crash recovery          |

## Confirmed boundaries

The user owns `apps/api` and `packages/recommender`: Silver/Gold transformations, embeddings, training, retrieval, ranking, evaluation, and recommendation serving. Bronze is an explicitly approved separate Python 3.12 project. It must not absorb recommendation-platform logic.

PostgreSQL in Docker owns store operational data and events. It is neither the analytical lakehouse nor a recommendation feature store. Future online requests supply current session context directly, independently of offline event ingestion.

Demo checkout has no payments or shipping integration. Demo identity is not authentication. Operational resets retain learning data; the existing reset clears live carts only and records removals.

Latent simulator preferences remain exclusively in separate diagnostics. Transport corruption does not mutate authoritative records. Synthetic evaluation is not evidence of real-world effectiveness. Catalog snapshots represent export-time state, not reconstructed historical inventory.

## Implementation choices and history

The store uses npm workspaces, Node 24, TypeScript, Fastify, node-postgres without an ORM, React/Vite, React Router, Zod, Node tests, and Playwright. PostgreSQL 18 runs in Compose with a persistent volume. It replaced the original SQLite backend on October 10, 2026; no historical SQLite import tool is implemented.

Checkout, event-producing mutations, generation, and exports use schema-scoped transactional advisory locking. A transactional event counter preserves contiguous Bronze cursor ranges through rollback. This favors understandable local correctness over write concurrency.

Bronze uses Spark 4.0.1, Delta 4.0.0, Python 3.12, JDK 17/21, immutable manual exports, raw merges, and per-source progress. There is no automatic scheduler or remote pipeline deployment.

Historical validation included a roughly million-event SQLite run and real local Delta ingestion. Those are local feasibility observations. PostgreSQL default-scale generation has not been benchmarked. Current check definitions and their limits are in [validation](../how-to/validate.md); historical observations are not a claim that every environment can run them unchanged.

## Future work remains proposed

The [recommendation roadmap](../explanation/recommendation-roadmap.md) discusses precomputed homepage lists, eventual direct-session scoring, and remote Databricks adaptation. It does not authorize a deployment or change the implemented scope.

Related: [architecture](../explanation/architecture.md), [documentation index](../README.md).
