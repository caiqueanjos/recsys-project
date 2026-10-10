# Project documentation

Current implementation guide, verified against the source on October 10, 2026. Start with the scaffold and follow the reading order to understand each implemented feature. Familiarity with TypeScript, HTTP, SQL transactions, and basic event pipelines is useful; Spark is needed only for running Bronze ingestion.

## Implementation reading order

1. [Project scaffolding](implementation/scaffolding.md) — workspaces, entry points, runtimes, and configuration.
2. [Architecture](implementation/architecture.md) — operational and offline data flow, ownership, and boundaries.
3. [Operational data model](implementation/data-model.md) — tables, keys, snapshots, and persistence rules.
4. [Catalog and storefront](implementation/storefront.md) — home, browsing, search, product details, and navigation.
5. [Identity and sessions](implementation/identity.md) — guest persistence, personas, expiry, and recovery.
6. [Carts, checkout, and history](implementation/transactions.md) — mutations, atomicity, retries, and selective resets.
7. [Events and instrumentation](implementation/events.md) — visibility, click attribution, validation, and delivery.
8. [Synthetic catalog/history](implementation/synthetic-history.md) — reproducibility, behavior, cohorts, and delivery experiments.
9. [Exports and Bronze](implementation/bronze.md) — envelopes, snapshots, merges, cursors, and crash recovery.
10. [Validation](implementation/validation.md) — existing coverage and limits.

These explanation/reference pages describe the current implementation rather than prescribing recommendation-platform design.

## Learn and operate

- [Workspace setup tutorial](implementation/workspace-setup.md): create a similar scaffold from an empty directory.

- [Store-to-export tutorial](implementation/walkthrough.md): a small isolated exercise with visible results.
- [Local development](local-development.md): run the store, generate data, ingest exports, run checks, and reset carts.
- [Store contract v1](store-contract.md): concise endpoint and event semantics.
- [Implementation plan](implementation-plan.md): agreed scope and completed scaffold stages.

The store and raw ingestion scaffold are implemented. The Python recommendation projects remain user-owned placeholders; Silver/Gold, model development, retrieval, ranking, evaluation, and serving are not implemented here.

## Proposed Databricks development

- [Developing locally and deploying to Databricks](databricks-development.md): proposed milestones, portability boundaries, remote Bronze changes, infrastructure as code, and CI/CD.
- [Databricks architecture reference](databricks-architecture.md): the reference architecture behind the proposal.

This roadmap describes future work. No Databricks resources or recommendation-platform implementation have been added.
