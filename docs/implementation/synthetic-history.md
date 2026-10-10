# Reproducible catalog and historical behavior

Understand the simulator before using its output as training or evaluation data. The core is [generator.ts](../../tools/generate/generator.ts), with [CLI](../../tools/generate/cli.ts) and separate [delivery simulation](../../tools/generate/delivery.ts).

## Configuration and reproducibility

Defaults: seed 42, 10,000 products, 20,000 shoppers, target 1,000,000 events, 90 days starting July 1, 2026 UTC. Minimums are 35 products, 20 shoppers, and 10 days; the window must end in the past. The event count is approximate because the last session finishes coherently.

A hash of generator version and configuration becomes the run ID and prefixes stable entity/event IDs. A seeded PRNG drives behavior. A completed run is recorded in `generation_runs`; repeating it skips generation. Different configurations append separate synthetic populations. Fixed trending positions use insert-if-absent behavior, so earlier runs retain populated positions. Use separate databases to isolate experiments.

Generation writes in one transaction. The CLI writes diagnostics afterward; a database commit and diagnostics-file write are not atomic. Repeating a completed run does not recreate missing diagnostics, so retain the original diagnostic artifact when needed.

## Catalog and session simulation

Seven category templates supply subcategories, brands, descriptions, price ranges, and product variants. Approximately 4% are statically unavailable. Brand text is aligned with the assigned brand. Listing times control whether a product may appear in simulated history.

A shopper has latent category interest, brand preference, budget, and purchase propensity. Session scheduling mixes high-activity shoppers with long-tail activity and prevents a shopper's later session from preceding their last activity. Intent can change. Sessions can search, expose products in up to six positions per round, click, view, add/update a cart, and optionally purchase. Candidate exposure favors a popular head; click probability separately decreases with position and responds to affinity, brand, and price. Impulse additions and exploration add randomness.

Clicks reference generated impressions. Persistent carts survive abandoned sessions; a later purchase consumes the current cart. Generated orders/items and purchase events reconcile, including exact timestamps and totals. All generated events use shared validation and `source=synthetic`.

## Cohorts and leakage boundaries

The cutoff is at `floor(days × 0.8)` days after the start. The final 15% of products/shoppers are introduced after that cutoff; the final 5% are reserved unobserved entities within that cold cohort. A separate 10% shopper cohort has at most one session. Cohorts are selected by generated index, with floor rounding; finite runs need not observe every eligible entity.

Latent shopper values and cohort diagnostics go to `data/generator-diagnostics/<run>.json`, not operational tables or raw exports. They are simulator internals, not legitimate model inputs. Configuration/count metadata remains in PostgreSQL.

## Optional delivery-quality artifact

The CLI can write NDJSON envelopes with `deliveryId`, `deliveredAt`, and the original `event`. Missing events, duplicate deliveries, and delay are seeded and configurable. Logical event IDs/timestamps stay intact; duplicate envelopes receive new delivery IDs. Delivery timestamps remain monotonic for retained events; a missing impression can still leave a delivered click without its parent.

This artifact never changes authoritative events, carts, or orders and is not a Bronze export. No implemented pipeline automatically cleans or ingests it. Reusing an output path is rejected.

Synthetic preferences, template products, static availability, and programmed exposure/click probabilities limit realism. Synthetic evaluation can test engineering assumptions but cannot establish real-world recommendation effectiveness. For commands and options see the [runbook](../local-development.md#synthetic-history); for exports see [Bronze](bronze.md).
