# Project context

This is a learning project for recommender systems. The user is the Staff/Senior ML Engineer responsible for the recommendation platform and its integration into an existing-style e-commerce MVP.

## Collaboration

- Act as a partner and coworker, not an answer dispenser. Help the user explore, reason, and decide.
- Explain tradeoffs and ask focused questions for meaningful unresolved decisions; avoid prescribing choices without context.
- Respect agreed decisions and the user's engineering experience. Do not repeatedly reopen settled choices or turn routine implementation into unnecessary questions.
- Distinguish proposals, assumptions, and confirmed requirements. Explain limitations of synthetic data and local infrastructure.
- When asked to plan, do not implement. When implementation is explicitly authorized, execute within the agreed scope.
- Leave ML and recommendation-platform work to the user unless explicitly requested.

## Architecture and ownership

- `apps/web`: planned React/Vite storefront.
- `apps/store-api`: planned separate TypeScript backend for catalog, shoppers, sessions, carts, orders, and event ingestion.
- One SQLite database initially owns store operational data and event records. PostgreSQL in Docker is a later migration goal.
- `apps/api` and `packages/recommender`: user-owned Python recommendation platform, not the store backend.
- Local Bronze Delta ingestion is in scaffolding scope. Silver/Gold pipelines, embeddings, training, candidate retrieval, ranking, evaluation, and recommendation serving belong to the user.

## MVP and data

- Fixed seeded homepage trending list; no related-product sections on product or cart pages initially.
- Anonymous shoppers and fake selectable personas. Each shopper retains its cart and purchase history; persona switches begin new sessions.
- Fake checkout creates an order, records a purchase event, and clears the cart. No real payments or shipping integration.
- Browser instrumentation records observed behavior; the store backend records successful transactional actions.
- Synthetic consumer-goods catalog and historical sessions must be reproducible, coherent, and compatible with live event contracts.
- Include behavioral randomness, exposure/position bias, and time-based cold-start cohorts. Data-quality corruption is optional.
- Keep generator-only latent preferences out of model inputs. Synthetic evaluation is not evidence of real-world effectiveness.

## Reference and plan

Follow `docs/implementation-plan.md` for scope, stages, and unresolved details. The architectural reference is https://www.databricks.com/blog/real-time-retail-intelligence-building-e-commerce-recommendations-lakebase-and-ai-search.

Preserve the distinction between offline event ingestion and direct session context in future online recommendation requests. SQLite is the store database, not the analytical lakehouse or recommendation feature store.
