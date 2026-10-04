# Operational data model

Use this reference to locate the state behind a store feature. The authoritative schema and persistence helpers are in [db.ts](../../apps/store-api/src/db.ts); shared response types are in [contracts](../../packages/store-contracts/src/index.ts).

| Table | Key / relationship | Purpose |
| --- | --- | --- |
| `products` | `id` | Name, category/subcategory, brand, description, cents, availability, listing time |
| `trending` | `position`; product foreign key | Fixed ordered homepage selection |
| `shoppers` | `id` | Anonymous, persona, or synthetic identity |
| `sessions` | `id`; shopper foreign key | Start/activity timestamps and live/synthetic source |
| `carts` | `(shopperId, productId)` | Persistent quantity 1–99 per shopper/product |
| `orders` | `id`; shopper/session foreign keys | Time, total, checkout key; unique `(sessionId, idempotencyKey)` |
| `order_items` | `(orderId, productId)` | Purchased name, quantity, unit price snapshot |
| `events` | Auto-increment `seq`; unique `id` | Indexed metadata plus full JSON payload |
| `metadata` | `key` | Persistent source database UUID |
| `generation_runs` | `id` | Completed configuration and generation counts |

Foreign keys are enabled. WAL journaling permits readers alongside a writer; a five-second busy timeout handles lock contention. `Store.transaction()` uses `BEGIN IMMEDIATE`, commits on success, and rolls back on an exception. The database API is synchronous, so large seed/export operations can block live work.

## Money, state, and history

Prices and totals use integer cents; the frontend formats USD. Availability is a boolean, not an inventory ledger. Carts hydrate current product data. Orders retain purchased names and prices in `order_items`, so history does not recalculate from current catalog prices.

Events retain occurrence time, ingestion time, identity, source, and JSON context. Database triggers reject event updates and deletes. `seq` provides source-local export order; it is not event time and is not a global ordering across databases.

The source UUID is created once in `metadata`. A newly created database gets a distinct identity; copying a database also copies that identity. Generation run metadata contains configuration and counts, not latent shopper preferences. Those preferences live in separate diagnostics files.

There is no ORM, schema migration runner, stock reservation, or analytical transformation here. For behavior built on this model, see [identity](identity.md) and [cart/checkout](transactions.md).
