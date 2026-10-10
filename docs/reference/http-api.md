# Store HTTP API reference

The current API is defined in [server.ts](../../apps/store-api/src/server.ts), with response types in [store-contracts](../../packages/store-contracts/src/index.ts). Direct development base URL: `http://127.0.0.1:3001`. Browser requests use `/api` through Vite; the proxy removes that prefix.

JSON request bodies use `Content-Type: application/json`. Session-scoped endpoints require `x-session-id`. A session must exist, be live, and have activity within the last 30 minutes. Passing the session check updates `lastActiveAt`, even if subsequent request processing fails. This is demo identity, not authentication.

## Public endpoints

| Method/path         | Input                    | Response/behavior                                                      |
| ------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `GET /health`       | None                     | `{ "status": "ok" }`; not a database readiness probe                   |
| `GET /personas`     | None                     | Persona shoppers ordered by ID                                         |
| `POST /shoppers`    | None required            | New anonymous shopper, named `Guest`                                   |
| `POST /sessions`    | `{ "shopperId": "..." }` | New live session for an existing non-synthetic shopper; 404 otherwise  |
| `GET /products`     | Query below              | `{ items: Product[], total, page, limit }`                             |
| `GET /products/:id` | Product ID               | Product; 404 if absent or not yet listed                               |
| `GET /trending`     | None                     | Products in seeded position order, filtered to already listed products |

`GET /products` accepts `q` (string, at most 200 characters, default empty), `category` (exact category string, default empty), `page` (integer >=1, default 1), and `limit` (integer 1–100, default 24). It matches name/description with PostgreSQL `ILIKE '%query%'`; `%` and `_` retain SQL wildcard meaning. Results are ordered by product ID and filtered to `listedAt <= now`. Unavailable products remain visible. Unknown categories produce an empty result.

Trending is fixed by seed insertion; requests do not compute popularity or personalization. Unavailable items can still appear if their availability changes after seeding.

## Session-scoped endpoints

| Method/path            | Input                                         | Response/behavior                                                      |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /cart`            | Session header                                | `CartItem[]` for the session's shopper, ordered by product ID          |
| `PUT /cart/:productId` | `{ "quantity": 0..99 }`, integer              | Updated full cart; quantity is an absolute target                      |
| `POST /checkout`       | `{ "idempotencyKey": "..." }`, 1–128 chars    | Order with item snapshots; matching session/key returns original order |
| `GET /orders`          | Session header                                | Shopper's orders by descending creation time                           |
| `POST /events`         | `{ "events": [Observation, ...] }`, up to 100 | `{ "accepted": N }`; empty array allowed                               |

Cart quantity zero removes a line. A changed quantity appends exactly one backend `cart_add`, `cart_update`, or `cart_remove` event with the mutation. Repeating the same quantity writes no new event. Unknown/future products return 404; adding an unavailable item returns 409. Removing an unavailable product is allowed.

Checkout rejects empty carts and unavailable items with 409. It atomically writes order, items, and purchase, then clears the cart. It emits no cart-removal events for items consumed by checkout. Retry lookup happens before empty-cart validation. Idempotency is scoped to `(sessionId, idempotencyKey)`; a new session is a new key scope. No payment or shipping request is made.

An `Observation` has only `id`, `type`, `occurredAt`, and `context`. The server assigns identity, `schemaVersion`, `ingestedAt`, and `source=browser`. Types are restricted to browser observations. Unknown top-level observation fields and unknown context fields are rejected. Events more than 60 seconds ahead of server time are rejected. The entire batch rolls back if any event fails. Exact logical retries are accepted without inserting duplicates; `accepted` counts submitted observations, not new rows. See [event reference](events.md) for validation and retry rules.

## Response structures

| Type       | Fields                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `Product`  | `id`, `name`, `category`, `subcategory`, `brand`, `description`, `priceCents`, `available`, `listedAt` |
| `Shopper`  | `id`, `name`, `kind` (`anonymous`, `persona`, `synthetic`), `createdAt`                                |
| `Session`  | `id`, `shopperId`, `startedAt`, `lastActiveAt`, `source` (`live`, `synthetic`)                         |
| `CartItem` | `product: Product`, `quantity`                                                                         |
| `Order`    | `id`, `shopperId`, `sessionId`, `createdAt`, `totalCents`, `items`                                     |
| Order item | `productId`, purchased `name`, `quantity`, `unitPriceCents`                                            |

Prices/totals use integer cents. Store-generated timestamps are canonical UTC ISO strings. IDs are stable strings; live entities use UUIDs. Successful operations normally return 200, including creation. Product/session/request schemas are not identical: only event schemas explicitly enforce strict unknown-field rejection throughout.

## Errors

Errors use `{ "error": "message" }`. Request validation is 400; required/expired sessions are 401; missing shoppers/products are 404; cart availability/empty checkout conflicts are 409. The custom handler defaults unclassified exceptions to 400, including many database failures. Do not interpret all 400s as safe client mistakes or assume a uniform production error taxonomy.

The API body limit is 256 KiB. It implements neither production authorization nor a rate-limit policy.

Related: [checkout explanation](../explanation/transactions.md), [frontend reference](frontend.md), [documentation index](../README.md).
