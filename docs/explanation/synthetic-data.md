# What synthetic history can and cannot teach you

Understand the purpose of the simulator before using its output in a recommendation experiment.

## Coherence is more useful than disconnected random rows

A purchase is useful only if its products, shopper, session, and order exist. A click should follow a matching impression. A cold product should not be viewed before listing. The generator uses the same event validation and store helpers as live traffic, and reconciles purchased quantities to persistent cart/order state.

Seeded randomness provides repeatability without making every shopper behave identically. Simulated category/brand affinity, price sensitivity, position discount, exploration, abandonment, and skewed activity create development cases. Reusing a configuration creates the same population; switching configuration produces another population with another run ID.

## Temporal cohorts create specific exercises

The last 15% of shoppers/products appear after a cutoff at 80% of the history window. A subset—the last 5%—remains completely unobserved. These represent different tests: a first interaction held out after cutoff is different from an entity with no generated interactions at all. Another 10% of shoppers are limited to one session.

For example, a product listed on day 9 cannot belong to a day-7 training catalog merely because it exists in today's export. Chronological splitting must respect listing time and feature availability. Current catalog snapshots include export-time state, so they cannot reconstruct stock or price trajectories that were never recorded.

## Generator knowledge is not model input

The simulator knows latent preference and purchase propensity because it uses them to generate behavior. A model trained on those variables would learn an answer unavailable to the real application. They stay in separate diagnostics, never in operational shoppers or Bronze payloads.

Diagnostics can help debug whether a cohort was produced. They do not prove a recommendation algorithm will work with real shoppers. A model can do well by recovering this generator's equations or biases and fail on actual behavior.

## Measurements have a local scope

A synthetic run can reveal serialization cost, contract failures, replay errors, or memory pressure in this environment. It cannot establish cloud throughput, production latency, or business lift. A prior million-event SQLite run says little about current PostgreSQL network round trips. Start with small data and measure the actual path you need.

Related: [generator reference](../reference/generator.md), [generation guide](../how-to/generate-data.md), [scope](../reference/project-scope.md), [index](../README.md).
