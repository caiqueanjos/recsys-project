# Shopper identity and sessions

Understand why a cart survives reload while a session does not. Identity/session behavior is implemented in [the frontend](../../apps/web/src/main.tsx) and [server routes](../../apps/store-api/src/server.ts).

A shopper owns carts and purchase history. A session groups activity for that shopper. For example, Guest can add a kettle, switch to Sam and see an empty cart, then switch back to Guest and recover the kettle under a new session ID.

## Initialization and switching

The browser saves the guest ID under `store.guest`. It remembers the selected identity under `store.active`; startup restores a selected seeded persona when possible, otherwise uses Guest. Missing guests are created with `POST /shoppers`. If a reset database no longer recognizes a persisted identity, a 404 from session creation triggers guest recreation.

`POST /sessions` always creates a new live session. The API seeds three personas: Alex (`persona-home`), Sam (`persona-active`), and Jo (`persona-family`). Synthetic shoppers cannot open live sessions. A reload starts a session; switching identity also starts one, returns home, clears displayed orders/product state, loads that shopper's cart, and resets the checkout key. A generation counter prevents an earlier cart-mutation response from replacing the new identity's displayed cart.

## Session lifetime

Cart, checkout, orders, and event routes require `x-session-id`. The server accepts only live sessions and expires them after more than thirty minutes since `lastActiveAt`. The session helper refreshes activity when it accepts a session, before subsequent endpoint validation; a later request failure can therefore still refresh the timestamp. Public catalog requests alone do not refresh it, though browser page observations use the event endpoint.

Expired/missing sessions return 401. The UI offers manual recovery with a new session for the current shopper. Old observations keep their original session and are not reassigned to the recovered identity.

This is local demo identity, not authentication: IDs and session headers do not establish a trusted account boundary. There are no passwords, authorization roles, or shared-device privacy guarantees.

Related: [data model](data-model.md), [events](events.md), [store walkthrough](walkthrough.md).
