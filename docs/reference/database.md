# Operational database reference

Schema: [schema.ts](../../apps/store-api/src/schema.ts). Connection/transaction helpers: [db.ts](../../apps/store-api/src/db.ts). The API stores operations and append-only events in one PostgreSQL database, normally its `public` schema.

## Tables

| Table             | Keys and constraints                                               | Stored fields/purpose                                             |
| ----------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `products`        | `id` PK; positive `priceCents`; availability integer 0/1           | Name, category/subcategory, brand, description, listing timestamp |
| `trending`        | `position` PK; product FK                                          | Fixed homepage product IDs                                        |
| `shoppers`        | `id` PK                                                            | Name, kind, creation timestamp                                    |
| `sessions`        | `id` PK; shopper FK                                                | Start/activity timestamps, live/synthetic source                  |
| `carts`           | `(shopperId, productId)` PK; both FKs; quantity 1–99               | Current cart per shopper                                          |
| `orders`          | `id` PK; shopper/session FKs; unique `(sessionId, idempotencyKey)` | Creation time, total cents, checkout retry key                    |
| `order_items`     | `(orderId, productId)` PK; both FKs; quantity >0                   | Purchased name and price snapshots                                |
| `event_counter`   | Singleton PK `id=1`; nonnegative BIGINT value                      | Last committed event sequence                                     |
| `events`          | Positive BIGINT `seq` PK; unique `id`; shopper/session FKs         | Type, occurrence/ingestion times, source, JSON payload as TEXT    |
| `metadata`        | `key` PK                                                           | Persistent source UUID at `sourceId`                              |
| `generation_runs` | `id` PK                                                            | JSON manifest as TEXT for completed generation configs            |

Camel-case SQL columns are quoted, such as `"shopperId"`. Timestamps are TEXT in the event contract's UTC ISO representation. Product availability is converted to a boolean in API/export payloads. Types/kinds are represented in application contracts; SQL does not enforce every enum or cross-entity relationship. In particular, application validation enforces that an event shopper matches its session.

Indexes exist on event session ID and order shopper ID. An append-only statement trigger rejects UPDATE, DELETE, and TRUNCATE on `events`; even an update/delete affecting no rows is rejected. Orders are treated as historical records by the app, but do not have equivalent mutation-blocking triggers.

## Store methods

| Method                                          | Behavior                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Store.open(url?, namespace='public')`          | Opens pool, initializes schema and source ID; URL defaults to environment then local URL |
| `transaction(async callback)`                   | BEGIN, schema-scoped advisory lock, callback, COMMIT; ROLLBACK on error                  |
| `product(id)`                                   | Product or undefined; helper itself does not filter future listings                      |
| `cart(shopperId)`                               | Joins cart to current product data                                                       |
| `order(id)`                                     | Order with historical item name/price snapshots; caller must supply existing ID          |
| `append(event)`                                 | Validates identity/references/replay, increments transactional sequence, inserts payload |
| `event(session, type, context, time?, source?)` | Creates UUID event; defaults to backend source and current time                          |
| `seedPersonas()`                                | Inserts the three stable demo personas if absent                                         |
| `db.prepare(sql).get/all/run(...params)`        | Async query facade using PostgreSQL `$1` parameters                                      |
| `db.exec(sql)`, `db.close()`                    | Executes SQL; closes pool                                                                |

An `AsyncLocalStorage` context directs all operations inside a transaction to the same checked-out client. Nested transaction callbacks join the outer transaction; they do not establish savepoints. Advisory locking serializes participating store transactions across processes for the same schema. Direct SQL and some simple API writes do not acquire this lock; it is not a database-wide prohibition on other writers. Isolation is PostgreSQL's default READ COMMITTED; coherent store exports rely on cooperating mutations taking the same lock.

The BIGINT parser rejects values outside JavaScript's safe integer range. The counter increments transactionally, so failed appends/batches do not consume sequence numbers. There is no versioned migration system or SQLite import command. Schema setup runs on open; editing `CREATE TABLE IF NOT EXISTS` does not alter an existing table.

## Identity fixtures

| ID               | Label                  |
| ---------------- | ---------------------- |
| `persona-home`   | Alex · home projects   |
| `persona-active` | Sam · active days      |
| `persona-family` | Jo · family essentials |

Test fixtures create a UUID-named `test_...` schema and drop it at cleanup. They leave `public` learning data untouched.

Related: [transactions](../explanation/transactions.md), [manage experiments](../how-to/manage-experiments.md), [index](../README.md).
