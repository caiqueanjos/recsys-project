# Frontend reference

Sources: [App](../../apps/web/src/App.tsx), [StoreProvider](../../apps/web/src/state/StoreProvider.tsx), [useResource](../../apps/web/src/hooks/useResource.ts), and [telemetry](../../apps/web/src/lib/telemetry.ts).

## Routes

| Route                         | Component                                                         | Behavior                                                          |
| ----------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/`                           | [HomePage](../../apps/web/src/pages/HomePage.tsx)                 | Fixed trending list and category links                            |
| `/catalog?q=&category=&page=` | [CatalogPage](../../apps/web/src/pages/CatalogPage.tsx)           | URL filters; 24 items/page; page resets on search/category change |
| `/products/:productId`        | [ProductPage](../../apps/web/src/pages/ProductPage.tsx)           | Fetches product by URL ID; add to bag                             |
| `/cart`                       | [CartPage](../../apps/web/src/pages/CartPage.tsx)                 | Quantity mutations and fake checkout                              |
| `/orders`                     | [OrderHistoryPage](../../apps/web/src/pages/OrderHistoryPage.tsx) | Shopper's purchase history                                        |
| Other routes                  | App fallback                                                      | Missing-page message and home link                                |

React Router's `BrowserRouter` handles client navigation. Production hosts must serve `index.html` for frontend routes and route `/api` to the store API; Vite's development proxy is not a production deployment configuration.

## State ownership

| State                         | Location/lifetime                                                         |
| ----------------------------- | ------------------------------------------------------------------------- |
| Catalog search/category/page  | URL search params; survives copied URLs and Back/Forward                  |
| Search input draft            | Catalog component; synchronizes to URL changes                            |
| Guest ID                      | localStorage `store.guest`                                                |
| Active shopper ID             | localStorage `store.active`                                               |
| Current session               | StoreProvider memory; recreated on reload/switch/recovery                 |
| Current cart display          | Provider cache; authoritative state in PostgreSQL                         |
| Checkout idempotency key      | Provider ref; retained across failure, cleared on success/mutation/switch |
| Requests tied to page/session | `useResource` result key and effect cancellation                          |
| Pending observations          | Per-session Telemetry instance memory                                     |

Startup loads personas, restores or creates a guest, chooses a stored persona or guest, creates a session, and fetches its cart. If a restored guest no longer exists in the database, a 404 during session creation triggers creation of a replacement guest. Persona switches create sessions and navigate home. Session recovery reuses the chosen shopper through the same switch operation.

Generation guards prevent completed old-identity requests from replacing the new identity's cart. `useResource` keys include session, location entry key, and API path; stale results are hidden when those change.

## Instrumentation

[ProductCard](../../apps/web/src/components/ProductCard.tsx) observes visibility at >=50% intersection and records one impression per effect lifecycle. Activation can create an impression before the observer callback, then records a click referencing it. Positions are one-based; catalog positions include pagination offset.

App navigation records `session_activity`; product loads record `product_view`; submitting the search form records `search`. Cart and purchase events come from the API. The fixed trending surface uses no model attribution.

Telemetry sends ordered batches of up to 100. It retries transport/server failures and 429 after five seconds; other HTTP errors stop that session's queue. `close()` attempts to flush pending observations with their original identity. It is not a durable browser outbox or an unload-delivery guarantee; reloads and browser closure can lose pending data.

Related: [navigation explanation](../explanation/identity-and-navigation.md), [observation explanation](../explanation/observations.md), [index](../README.md).
