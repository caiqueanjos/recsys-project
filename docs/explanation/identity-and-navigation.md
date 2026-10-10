# Shopper identity, sessions, and browser state

Understand why a shopper and a session are separate and why navigation belongs in the URL.

## A shopper owns the cart; a session groups activity

Alex adds a mug and then reloads. The browser opens a new session for Alex, but the mug remains because carts are keyed by shopper. Switching to Sam changes the shopper and starts another session; Sam sees their own cart/history. Switching back to Alex exposes Alex's records again.

The persistent guest ID works the same way through localStorage. It identifies a local demo shopper; it proves no authenticated identity. Server sessions expire after 30 minutes of inactivity. Session-scoped requests refresh activity before processing their action.

Keeping sessions separate gives events a useful interaction boundary without making cart lifetime depend on a page load. It also makes checkout retry scope explicit: a key reused in the same session finds the original order; a new session does not.

## URLs carry shareable navigation state

A catalog URL such as `/catalog?q=kettle&page=2` says what to load without relying on the prior page. A product URL carries its ID, then fetches that product. This lets Back/Forward, direct links, and reloads behave consistently.

Component state still has a role: the search input can hold a draft until submit. The committed filter goes into search params. Provider state holds the current session and a cart display cache. PostgreSQL remains authoritative for the cart.

## Old requests must not repaint a new context

A slow cart request for Alex might finish after the user switches to Sam. Without a guard, Alex's bag could appear under Sam's name. [StoreProvider](../../apps/web/src/state/StoreProvider.tsx) uses a generation counter to discard stale identity results. [useResource](../../apps/web/src/hooks/useResource.ts) ties page data to session, API path, and router location entry.

The lesson is broader than cancellation: a result needs to belong to the context that requested it. This project uses both effect cleanup and context keys. A request may complete on the network while its result is deliberately ignored.

Related: [frontend state reference](../reference/frontend.md), [mock checkout tutorial](../tutorials/03-mock-checkout.md), [index](../README.md).
