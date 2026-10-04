# Catalog and storefront features

Trace browsing from the React UI to SQL. The implementation lives in [main.tsx](../../apps/web/src/main.tsx), [style.css](../../apps/web/src/style.css), and [server.ts](../../apps/store-api/src/server.ts).

## Implemented surfaces

| Surface | Behavior |
| --- | --- |
| Home | Hero, seven category shortcuts, fixed favorites from `/trending` |
| Catalog | Submitted search, category filter, 24-item pages, previous/next controls |
| Product | Category art, description, brand, price, availability, add-to-bag action |
| Cart | Shopper-specific quantities, removal, subtotal, fake checkout |
| History | Shopper-specific orders with saved item prices and names |

Navigation uses React state rather than a URL router. Reload returns to home and starts a session. Product details open from an already loaded card object; the API also supports direct product lookup, but the UI has no product deep-link route. Category art is a placeholder symbol, not a product-image pipeline.

## Catalog query path

`GET /products` accepts `q`, `category`, `page`, and `limit`. It matches name or description using SQL `LIKE`, filters category by equality, excludes future-listed products, and orders by product ID. Defaults are page 1 and limit 24; the maximum limit is 100. SQL parameters bind user values, although `%` and `_` retain `LIKE` wildcard meaning. This is substring-style matching, not semantic search or relevance ranking.

Unavailable products can appear in browse results; their add button is disabled and the backend rejects positive quantities. `/products/:id` rejects unknown or future-listed products. `/trending` follows stored positions and filters future listings. Favorites are not derived from purchases or user preference; generation attempts to populate positions from available products among the first twelve generated IDs, so the list can contain fewer than twelve products.

## UI state and errors

Search text becomes active only on submit; submission records a search observation and resets pagination. Category changes also reset pagination. The request helper adds `x-session-id` for scoped calls and turns API error responses into `ApiError`. Busy state disables transactional controls. Session errors expose a “Start a new session” action. Responsive CSS supports narrow screens, with overflow checked by the browser regression.

See [identity](identity.md), [transactions](transactions.md), and [instrumentation](events.md) for the behavior beneath these surfaces. Run the [store walkthrough](walkthrough.md) to observe them together.
