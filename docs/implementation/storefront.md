# Catalog and storefront features

Trace browsing from the React UI to SQL. The entry point [main.tsx](../../apps/web/src/main.tsx) mounts React Router and the shared [StoreProvider](../../apps/web/src/state/StoreProvider.tsx). [App.tsx](../../apps/web/src/App.tsx) owns the layout and routes; page components live in `apps/web/src/pages`, reusable UI in `components`, and API/telemetry helpers in `lib`. Styling remains in [style.css](../../apps/web/src/style.css), with catalog endpoints in [server.ts](../../apps/store-api/src/server.ts).

## Implemented surfaces

| Surface | Behavior |
| --- | --- |
| Home | Hero, seven category shortcuts, fixed favorites from `/trending` |
| Catalog | Submitted search, category filter, 24-item pages, previous/next controls |
| Product | Category art, description, brand, price, availability, add-to-bag action |
| Cart | Shopper-specific quantities, removal, subtotal, fake checkout |
| History | Shopper-specific orders with saved item prices and names |

React Router uses browser history with routes `/`, `/catalog`, `/products/:productId`, `/cart`, and `/orders`. Links support Back/Forward and direct navigation. Catalog query parameters `q`, `category`, and `page` preserve submitted filters and pagination across refresh and history navigation; changing search or category resets pagination. Product details fetch `/products/:id`, including on direct entry, and show errors for missing products. Unknown routes show a page-not-found message. Reload preserves the URL and opens a new session; persona switching and manual session recovery return home. Category art is a placeholder symbol, not a product-image pipeline.

The shared provider remains mounted across routes so navigation retains identity, session, cart, and checkout retry state. Page requests discard results after navigation or session changes. Route visits emit one session-activity observation, and successful product loads emit a product-view observation; returning to a product counts as another visit. Existing impression/click attribution stays in [ProductCard](../../apps/web/src/components/ProductCard.tsx). Event page labels retain `/home` and `/history` for those surfaces; product views and activity use `/products/:id`.

A production host must serve `index.html` for frontend paths so direct links and refresh work, while routing `/api` to the store backend. Vite provides the SPA fallback during local development.

## Catalog query path

`GET /products` accepts `q`, `category`, `page`, and `limit`. It matches name or description using SQL `LIKE`, filters category by equality, excludes future-listed products, and orders by product ID. Defaults are page 1 and limit 24; the maximum limit is 100. SQL parameters bind user values, although `%` and `_` retain `LIKE` wildcard meaning. This is substring-style matching, not semantic search or relevance ranking.

Unavailable products can appear in browse results; their add button is disabled and the backend rejects positive quantities. `/products/:id` rejects unknown or future-listed products. `/trending` follows stored positions and filters future listings. Favorites are not derived from purchases or user preference; generation attempts to populate positions from available products among the first twelve generated IDs, so the list can contain fewer than twelve products.

## UI state and errors

Search text becomes active only on submit; submission records a search observation and resets pagination. Category changes also reset pagination. The request helper adds `x-session-id` for scoped calls and turns API error responses into `ApiError`. Busy state disables transactional controls. Session errors expose a “Start a new session” action. Responsive CSS supports narrow screens, with overflow checked by the browser regression.

See [identity](identity.md), [transactions](transactions.md), and [instrumentation](events.md) for the behavior beneath these surfaces. Run the [store walkthrough](walkthrough.md) to observe them together.
