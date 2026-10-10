# A future path to recommendations and Databricks

Understand the possible extension beyond the implemented store/ingestion scaffold. **This is a proposal, not a runnable deployment guide.** Models, analytical transformations, evaluation, serving, cloud resources, and platform integration remain user-owned.

## Begin with one visible recommendation boundary

The current homepage returns a fixed seeded list. A future first increment could publish precomputed product IDs keyed by shopper and surface, then let the store hydrate them against its catalog. This separates recommendation selection from operational product state and gives a clear fallback to the fixed list.

A later session-aware path could send recent views, searches, and cart contents directly to a recommendation endpoint. Offline events still feed analytical pipelines, but the request need not wait for export/ingestion to learn what happened moments ago. These are separate freshness requirements.

The distinction is inspired by the batch and request-time serving paths in the [Databricks retail architecture article](https://www.databricks.com/blog/real-time-retail-intelligence-building-e-commerce-recommendations-lakebase-and-ai-search). That article is an architectural reference, not a benchmark or deployment guarantee for this project.

## Map responsibilities before selecting managed services

| Responsibility                    | Implemented here                         | Possible later destination                   |
| --------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Store operations                  | React/Fastify and PostgreSQL             | Can remain outside Databricks                |
| Raw landing                       | Local immutable exports and Delta Bronze | Remote governed Delta tables                 |
| Cleaning/features/training data   | Not implemented                          | User-designed Silver/Gold jobs               |
| Retrieval/scoring/evaluation      | Not implemented                          | User-owned modules and managed execution     |
| Precomputed lists/online features | Not implemented                          | Separate recommendation-owned online storage |
| Request-time serving              | Python workspace placeholder             | User-built endpoint and integration          |

This mapping is this project's proposed adaptation. Store PostgreSQL should not quietly become the recommendation feature store. The imported architecture diagrams under [assets](../assets/architecture-diagram.png) and [serving diagram](../assets/realtime-serving.png) are source-reference illustrations, not diagrams of the local implementation.

## Move one verified boundary at a time

A reasonable learning sequence is to define portable computation interfaces, run a small offline flow locally, publish one homepage list, and then exercise that same boundary remotely. Shipping the code is only part of the remote work: identities, permissions, catalogs, storage, supported runtimes, and retry behavior need independent validation.

Local Bronze assumes a POSIX file lock and filesystem progress file. A remote pipeline must replace those assumptions with a defined source cursor and coordination strategy. Preserve raw provenance, replay conflict detection, and the distinction between event time and processing time.

Infrastructure provisioning and application deployment are separate responsibilities. Before creating resources, decide cloud/workspace, budget, runtime compatibility, online storage requirements, authentication, and whether the learning objective is recommendation logic or managed-platform operations. No bundle, Terraform configuration, serving endpoint, or cloud job is supplied by this scaffold.

Related: [current architecture](architecture.md), [confirmed scope](../reference/project-scope.md), [synthetic evaluation limits](synthetic-data.md), [index](../README.md).
