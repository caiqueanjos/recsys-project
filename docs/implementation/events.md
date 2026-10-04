# Event contract and browser instrumentation

Understand what an observation means, who records it, and how attribution survives retries. Runtime validation is in [contracts](../../packages/store-contracts/src/index.ts), causal checks in [Store.append](../../apps/store-api/src/db.ts), and browser delivery in [telemetry.ts](../../apps/web/src/lib/telemetry.ts), card attribution in [ProductCard](../../apps/web/src/components/ProductCard.tsx), and route observations in [App](../../apps/web/src/App.tsx) and [ProductPage](../../apps/web/src/pages/ProductPage.tsx).

## Version 1 envelope

Every stored event has `schemaVersion: 1`, `id`, `type`, `occurredAt`, `ingestedAt`, `shopperId`, `sessionId`, `source`, and `context`. Zod rejects unknown envelope/context fields and normalizes timestamps to UTC ISO strings. Sources are `browser`, `store_backend`, and `synthetic`.

| Type | Required context | Live writer |
| --- | --- | --- |
| `session_activity` | No additional required field | Browser |
| `search` | `query` | Browser |
| `product_view` | `productId` | Browser |
| `impression` | `productId`, `surface`, one-based `position` | Browser |
| `click` | Impression fields plus `impressionId` | Browser |
| `cart_add`, `cart_update`, `cart_remove` | `productId`, resulting `quantity` | Backend |
| `purchase` | `orderId` | Backend |

Context can also contain page and reserved recommendation attribution fields. The fixed `home_trending` surface rejects populated recommendation request/list/model attribution. These fields reserve a future integration; no model supplies them today.

## Visibility and click attribution

A product card emits an impression once per exposure lifecycle after `IntersectionObserver` reports at least 50% visibility. There is no dwell-duration threshold. A keyboard/card activation before the observer callback establishes an impression immediately. The click references that impression and its product, surface, and position. Catalog positions are absolute across 24-item pages. Returning/remounting a card can create a new impression.

`Store.append()` checks session/shopper agreement, occurrence after session start, and product listing time. A click must match an existing prior impression in session, product, surface, position, and time. A purchase must match its session's order and exact order timestamp.

## Ingestion and retry behavior

`POST /events` accepts at most 100 browser observations in one atomic batch. Clients submit only ID, type, occurrence time, and context; the server supplies identity, ingestion time, source, and version. More than sixty seconds into the future is rejected. Browser transaction types are forbidden.

Telemetry queues events in memory, sends sequential batches, and retains stable IDs for retry. Transient errors retry after five seconds; most client errors stop that session's queue (429 can retry). Switching identities attempts to flush the old queue under its original session. Closing the tab can lose pending observations; there is no durable browser outbox.

Duplicate IDs with the same normalized payload are accepted without another row; retry ingestion time is ignored when comparing. A conflicting payload is rejected. Backend transaction events do not depend on telemetry delivery. Database triggers enforce append-only storage.

See the concise [store contract](../store-contract.md), [transactions](transactions.md), and [Bronze envelope reference](bronze.md).
