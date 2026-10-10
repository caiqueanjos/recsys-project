# System boundaries and data flow

Understand which component owns a store action and how it becomes learning data. The project starts with an operational store because useful recommendation experiments need coherent identities, products, exposures, and transactions.

```mermaid
flowchart LR
    Browser[React storefront] -->|HTTP| API[Fastify store API]
    API --> PG[(PostgreSQL: operations and events)]
    Generator[Seeded simulator] --> PG
    PG --> Export[Immutable raw exports]
    Export --> Ingest[Local Spark ingestion]
    Ingest --> Delta[(Bronze Delta tables)]
    Generator --> Diagnostics[Separate latent diagnostics]
```

## Operations and observations have different owners

A shopper adds a kettle. The backend changes their cart and appends a cart event in one transaction. If that transaction fails, neither change survives. When the shopper merely sees the kettle card, the browser knows about the visibility and sends an impression separately. A page can lose an observation while a successful order still exists.

This division gives a clear owner for each fact. Browser code owns what it observes; store transactions own what successfully changes. Recording a purchase in both layers would count one order twice. Source fields distinguish live observation, backend action, and synthetic history.

The shared contract ties those producers together. It is the shape of the data, not an implementation of recommendation logic. [The event reference](../reference/events.md) describes that shape.

## Store persistence and analytical persistence serve different work

PostgreSQL answers operational questions: what is in this shopper's bag, is the product available, and did this checkout already finish? These queries need current state and transaction boundaries.

Bronze answers provenance questions: what raw records arrived from a particular source, with what event/receipt times and catalog snapshot? Delta retains those records for later analysis. The export boundary keeps the store runnable without a Spark process on every request.

Raw ingestion does not build features. Cleaning, sessionization, embeddings, candidate retrieval, ranking, and evaluation belong to the user's recommendation workspace. The [scope reference](../reference/project-scope.md) records this ownership.

## Future online context is a separate path

Suppose a shopper views three tents within a minute. A future session-aware recommendation request should be able to send those current views directly, even if the latest raw export has not reached Bronze. Long-term features can still come from an offline pipeline. Waiting for the analytical landing step would turn ingestion delay into recommendation context delay.

This is a proposed integration boundary. The current homepage is a fixed seed list and the Python recommendation API is a placeholder. [The roadmap](recommendation-roadmap.md) explains the possible extension without treating it as deployed behavior.

Related: [repository map](../reference/workspace.md), [checkout explanation](transactions.md), [index](../README.md).
