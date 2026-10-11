# Change a store feature

Use this guide when extending the implemented storefront or API. Prerequisites: the store runs locally, and you understand the feature's expected visible behavior. Recommendation-platform implementation belongs to the user.

## Trace the smallest complete behavior

For example, to change catalog filtering, trace [CatalogPage](../../apps/web/src/pages/CatalogPage.tsx) → [useResource](../../apps/web/src/hooks/useResource.ts) → [GET /products](../../apps/store-api/src/server.ts) → SQL. Decide the URL/query semantics before changing the UI so copied URLs and Back/Forward work.

For a cart change, trace [StoreProvider.mutate](../../apps/web/src/state/StoreProvider.tsx) → cart route → [CartService.setQuantity](../../apps/store-api/src/services/cart.ts) → [Store.transaction](../../apps/store-api/src/db.ts) → backend event. Checkout follows the same boundary through [CheckoutService.execute](../../apps/store-api/src/services/checkout.ts). Keep request/session handling in the route, use-case orchestration in the service, and the mutation and its event in the same transaction.

Look up the [API](../reference/http-api.md), [events](../reference/events.md), and [database](../reference/database.md) before changing boundaries. State the intended before/after behavior in a small example.

## Make the change in the owning layer

Change shared types or validation in `packages/store-contracts` when the external contract changes. Update consumers together. Keep SQL parameters as `$1`, `$2`, etc.; do not interpolate user values. If you need a schema change, plan how existing databases acquire it: `CREATE TABLE IF NOT EXISTS` does not migrate a table.

In React, keep filters in the URL, fetch products by route ID, and prevent old page/session responses from replacing current state. The provider holds identity/cart state; page components hold local drafts. Use a small mock only to develop the visible behavior, then exercise the real boundary.

For observations, use the per-session telemetry instance. Only the backend records committed cart/purchase actions. An impression needs surface and one-based position; a click needs its prior impression ID. Adding a new event type affects live intake, synthetic generation, tests, and reference docs. Raw Bronze should continue to preserve the payload rather than compute new model features.

## Verify and document the result

Choose checks from [validation](validate.md). Contract/transaction changes need API tests; URL/identity/visible behavior needs browser regression; type changes need the build. Test the outcome or failure you changed, including retry/rollback if relevant.

Update the applicable reference page and any tutorial whose commands or outputs changed. Keep deeper reasoning in explanation pages instead of copying it into task steps. Make a small coherent commit once the change is verified.

Related: [repository map](../reference/workspace.md), [mocks and increments](../explanation/mocks-and-increments.md), [index](../README.md).
