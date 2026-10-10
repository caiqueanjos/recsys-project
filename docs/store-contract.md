# Store contract v1

The store uses integer cents, UTC ISO timestamps, stable string IDs, and foreign keys. PostgreSQL owns operational catalog, shoppers, sessions, carts, orders, order items, and append-only events. It is not an analytical feature store. Shared TypeScript types and runtime event validation live in `packages/store-contracts`.

A browser persists an anonymous shopper ID in localStorage; personas have seeded IDs. `POST /sessions` always opens a new session. Sessions expire after 30 minutes of server-observed inactivity. Requests for carts, checkout, history, and events carry `x-session-id`; successful requests refresh activity. This is a local demo identity mechanism, not authentication.

Events contain schemaVersion, ID, type, occurrence/ingestion times, shopper/session, source, and context. The backend supplies identity, ingestion time, and browser provenance. Synthetic records use the same validation and source=synthetic. A visible impression has product, surface, and one-based position; clicks reference the impression ID. Fixed trending contains no recommendation/model attribution. Cart quantity is the resulting quantity; purchase references an immutable order. Browser events cannot create transaction events. Event IDs are idempotent; a conflicting payload for an existing ID is rejected.

Endpoints: `GET /health`, `/personas`, `/products?q=&category=&page=&limit=`, `/products/:id`, `/trending`; `POST /shoppers`, `/sessions` (shopperId); session-scoped `GET /cart`, `PUT /cart/:productId` (quantity 0–99), `POST /checkout` (idempotencyKey), `GET /orders`, `POST /events` (events array). Checkout atomically creates order/items/purchase and clears the cart; retries with the same session and key return the original order.

Raw exports use monotonically increasing, gap-free event sequence numbers and an immutable snapshot ID/time. Bronze uses event-ID merge plus a durable cursor written only after Delta commits. Catalog snapshots retain identity/time and product listing time. Future online requests send current session context directly to the recommendation API, independently of offline ingestion.

Routine implementation choices: npm workspaces, Fastify, Node 24 and node-postgres, React/Vite, CSS, Node test runner with Fastify injection. No ORM; Docker Compose runs the operational PostgreSQL service.
