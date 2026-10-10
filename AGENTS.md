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

- `apps/web`: implemented React/Vite storefront with React Router URL navigation and a development proxy to the store API.
- `apps/store-api`: implemented Fastify/TypeScript backend using PostgreSQL in Docker for catalog, shoppers, sessions, carts, orders, and event ingestion.
- `packages/store-contracts`: shared TypeScript types and Zod validation for the versioned live/synthetic event contract.
- `tools/generate`: TypeScript catalog/history generation, immutable raw exports, optional delivery-quality simulation, and selective live-cart resets.
- `tools/validate`: Playwright browser regression checks using an isolated temporary store.
- `tools/bronze`: explicitly approved standalone Python 3.12 project using Spark 4.0.1 and Delta 4.0.0; separate from the user's Python recommendation projects.
- One PostgreSQL database in Docker owns store operational data and event records, with a persistent named volume.
- `apps/api` and `packages/recommender`: user-owned Python recommendation platform, not the store backend.
- Local Bronze Delta ingestion is in scaffolding scope. Silver/Gold pipelines, embeddings, training, candidate retrieval, ranking, evaluation, and recommendation serving belong to the user.

## MVP and data

- Fixed seeded homepage trending list; no related-product sections on product or cart pages initially.
- Anonymous shoppers and fake selectable personas. Each shopper retains its cart and purchase history; persona switches begin new sessions.
- Guest identity persists in localStorage. Reloads also open new sessions; sessions expire after 30 minutes of inactivity. This is a local demo identity mechanism, not authentication.
- Fake checkout creates an order, records a purchase event, and clears the cart. No real payments or shipping integration.
- Cart mutations and checkout events commit with their operational changes. Preserve checkout idempotency and rollback behavior.
- Browser instrumentation records observed behavior; the store backend records successful transactional actions.
- Visible-product impressions include surface and one-based position; clicks reference prior impressions. Never invent model attribution for the fixed trending list or double-count backend transactions as browser events.
- Synthetic consumer-goods catalog and historical sessions must be reproducible, coherent, and compatible with live event contracts.
- Include behavioral randomness, exposure/position bias, and time-based cold-start cohorts. Data-quality corruption is optional.
- Keep generator-only latent preferences out of model inputs. Synthetic evaluation is not evidence of real-world effectiveness.
- Latent diagnostics belong only in the separate generator diagnostics artifacts, not operational tables or Bronze exports. Optional missing/duplicate/delayed delivery artifacts must not mutate authoritative events or orders.
- Events are append-only. Operational resets must preserve the learning dataset; the existing reset command clears only live carts and records removal events.

## Local workflow and validation

- Use npm workspaces and Node 24 for store development; keep the existing Python recommendation workspace independent.
- See `docs/README.md` for the documentation index and `docs/how-to/` for setup, generation, exports, ingestion, validation, and selective resets. Default PostgreSQL URL: `postgresql://store:store@127.0.0.1:5432/store`; generated data and runtime artifacts are ignored by Git.
- Store commands: `npm run dev:api`, `npm run dev:web`, `npm run seed`, `npm run export:bronze`, and `npm run reset:carts`.
- Run checks appropriate to the change: `npm test` for API/history contracts, `npm run test:browser` for storefront flows, `npm run build` for TypeScript and production assets, and `npm run format:check` for formatting. Chromium and its system dependencies are needed for browser checks.
- For ingestion changes, run `uv run python -m unittest discover -s tests -v` from `tools/bronze`. Spark requires JDK 17/21, local JVM sockets, and first-run Maven downloads.
- Bronze preserves raw JSON, provenance, event/ingestion times, and catalog snapshot identity/time. Preserve source-specific durable cursors, replay-safe merges, conflict/gap rejection, and crash recovery. No Silver/Gold transformations belong in this scaffold.
- Catalog snapshots capture export-time state; they do not reconstruct historical availability. Synthetic scale measurements are local feasibility observations, not throughput guarantees.
- Make small, coherent commits as work is verified, consistent with the user's request to commit often.

## Reference and plan

Use `docs/README.md` as the Diátaxis documentation index. Follow `docs/reference/project-scope.md` for agreed scope and implementation decisions; all six scaffold stages are implemented. Use `docs/reference/http-api.md` and `docs/reference/events.md` for endpoint/event semantics, and `docs/how-to/` for runnable workflows. Tutorials in `docs/tutorials/` build simplified teaching mocks in a separate workspace before exercising this repository; distinguish those mocks from implemented behavior. The architectural reference is https://www.databricks.com/blog/real-time-retail-intelligence-building-e-commerce-recommendations-lakebase-and-ai-search.

Preserve the distinction between offline event ingestion and direct session context in future online recommendation requests. PostgreSQL is the store database, not the analytical lakehouse or recommendation feature store.
