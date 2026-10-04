# Store MVP and recommendation learning scaffold

Status: agreed scope; implementation not started. This document does not authorize implementation beyond the user's current request.

## Goal and working relationship

Create a plausible early-stage consumer-goods store and useful synthetic data so the user can practice building a recommendation platform as its Staff/Senior ML Engineer. The assistant owns the store scaffold and helps explore decisions; the user owns ML engineering and recommendation integration.

## Architectural reference

Reference: [Real-Time Retail Intelligence: Building E-Commerce Recommendations with Lakebase and AI Search](https://www.databricks.com/blog/real-time-retail-intelligence-building-e-commerce-recommendations-lakebase-and-ai-search).

Adapt its boundaries locally rather than duplicating every managed service:

| Responsibility | Initial local implementation | Future/user-owned work |
| --- | --- | --- |
| Store application | React/Vite + TypeScript store API | Store integration with recommendation API |
| Store persistence | One SQLite database | PostgreSQL in Docker |
| Offline ingestion | Incremental store event/catalog ingestion | Streaming or Databricks ingestion |
| Bronze | Local Delta tables using Spark/Delta | Databricks-backed tables |
| Silver/Gold | Not implemented by scaffold | Cleaning, sessionization, features, training datasets |
| Online features and recommendation lists | Not implemented by scaffold | Recommendation-owned database; eventual Lakebase analogue |
| Candidate retrieval | Not implemented by scaffold | Local vector retrieval and eventual AI Search integration |
| Recommendation serving | Existing Python project boundary | User-built serving pipeline |

The store database and analytical storage have different roles. Historical events feed offline pipelines; future real-time recommendation requests carry current session context directly, without waiting for Bronze ingestion.

## Confirmed store requirements

- `apps/web`: React/Vite frontend.
- `apps/store-api`: separate TypeScript backend owning basic store functions.
- Catalog browsing, search, product details, cart, fake checkout, and purchase history.
- Homepage trending products come from a fixed seeded list, not behavioral ranking.
- No related-product sections on product or cart pages initially. No local adaptive recommender.
- Anonymous identity plus a small set of selectable demo personas.
- Each identity retains its cart and purchase history; switching personas starts a new session.
- Successful fake checkout creates an order, records a purchase, and clears that identity's cart.
- No real authentication, payment processing, or shipping integration in the MVP.
- One SQLite database with separate catalog, shopper, cart, order, session, and event tables.

## Event contract and recording

Define one versioned event contract shared by live instrumentation and synthetic generation. Include unique event ID, event type, occurrence timestamp, ingestion timestamp, shopper ID, session ID, source, and appropriate product/page/action context. Use UTC timestamps and stable cross-system identifiers.

- Browser: session activity, searches, product views, clicks, and visible-product impressions with surface and position. Distinguish exposure from a click.
- Store backend: successful cart mutations and purchases. Avoid double-counting these as both browser and authoritative transaction events.
- Distinguish synthetic historical events from live storefront events.
- Preserve append-only events; allow operational resets without deleting the learning dataset.
- Reserve future attribution fields for recommendation request/list IDs and model versions; do not invent model attribution for the fixed list.

## Synthetic data

Proposed configurable starting scale, not a fixed performance guarantee:

- 10,000 consumer-goods products.
- 20,000 synthetic shoppers, separate from the small selectable persona set.
- Approximately 1 million events across 90 days.

Cover electronics, home/kitchen, personal care, clothing, sports, toys, and groceries with coherent category hierarchies, brands, prices, descriptions, availability, and listing dates. Reconcile generated transactions with store purchase-history records rather than producing disconnected purchase events.

Generate sessions from latent category/brand preferences, price sensitivity, shopping intent, and purchase propensity. Add seeded behavioral randomness: off-interest exploration, impulse purchases, abandoned carts, non-converting sessions, skewed shopper activity, long-tail popularity, position bias, repeat purchases, and changing intent. Simulated clicks must follow exposure; actions must respect product availability and session chronology.

Keep latent generator preferences and any diagnostic ground truth separate from production-like model inputs. Include optional configurable delayed, duplicated, or missing event delivery as a distinct data-quality mode, disabled by default. Do not corrupt authoritative orders or violate causal action ordering to simulate delivery problems.

Introduce users and products after chronological training cutoffs to create evaluable cold starts. Include sparse-history cohorts and separate completely unobserved entities from entities with held-out first interactions. Keep future behavior out of earlier feature snapshots.

## Bronze ingestion

- Incrementally copy raw events and catalog snapshots into local Delta tables.
- Preserve raw provenance and distinguish event time from ingestion time.
- Use event IDs and durable progress tracking for replay-safe ingestion; avoid silently duplicating logical events on retries.
- Keep Bronze raw: no model-ready aggregations, embeddings, or ranking logic.
- Specify snapshot identity/time for catalog exports to support point-in-time interpretation.
- Document local Spark/Delta prerequisites, generation, ingestion, and selective resets.

## Implementation stages

1. Define operational schemas, event contract, identity/session behavior, and ingestion boundaries.
2. Build the TypeScript store API with SQLite persistence and transactional checkout.
3. Build the storefront, persona switching, instrumentation, and fixed trending list.
4. Add reproducible catalog/history generation using the same contracts and consistent store records.
5. Add local Bronze Delta ingestion and run documentation.
6. Validate store flows, generated-data consistency, and replay-safe ingestion.

Validation should cover cart isolation/persistence, session changes, order/event consistency, impression attribution, reproducibility, referential integrity, chronological cold-start cohorts, and ingestion retry behavior. Choose test tools consistent with the implementations; avoid adding unrelated infrastructure.

## Future recommendation integration: user-owned

- Path A: replace fixed homepage items with precomputed lists keyed by shopper and surface.
- Path B: introduce session-aware surfaces later, sending recent views, searches, cart contents, and available dwell signals directly to the Python API.
- Keep catalog hydration and store transactions in the store API. Retrieval, feature assembly, scoring, and reranking belong to the recommendation platform.
- Define timeouts/fallbacks when integration is implemented; the fixed list can remain a baseline/fallback.

## Decisions deferred until implementation

- TypeScript API framework, ORM/database access, package manager, styling, and testing tools.
- Session expiry policy, browser identity persistence, and detailed endpoint schemas.
- Exact generation distributions, cold-start proportions, and achievable local scale.
- Location and ownership of generation/ingestion tooling. Confirm before adding Python scaffold code, since the user's Python projects are reserved for their learning work.
- Local Spark/Delta runtime setup and export/ingestion cadence.

Resolve these with focused tradeoff discussions; do not reopen confirmed architectural decisions unnecessarily.
