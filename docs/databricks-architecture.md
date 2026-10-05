# Real-Time Retail Intelligence

Building E-Commerce Recommendations with Lakebase and AI Search on Databricks

How a leading fashion e-commerce platform delivers low latency personalized product recommendations to millions of users — powered entirely by the Databricks Data Intelligence Platform.

## The opportunity: Personalization as a revenue engine

Every second a shopper spends on a fashion e-commerce app generates a stream of intent signals — searches, product views, wishlist additions, cart interactions. The platforms that convert those signals into relevant product recommendations in real time are the ones that win. Industry benchmarks show that effective personalization can lift conversion rates by 10–30% and increase average order value significantly.

Yet building a production-grade recommendation system remains one of the hardest ML engineering challenges. It demands real-time data ingestion, complex feature engineering, multiple ML models working in concert, and serving infrastructure that responds in milliseconds — all while keeping inventory, location, and business rules in sync.

This blog presents a complete reference architecture for building such a system on Databricks, based on a real-world implementation for a leading fashion e-commerce platform in Asia serving over 1 million monthly active users across a catalog of 100,000+ SKUs.

## System overview: The architecture at a glance

The architecture follows a unified platform approach where every component — from ingestion to serving — runs on Databricks, governed by Unity Catalog.

Overall System Architecture:

![Databricks proposed architecture diagram](assets/architecture-diagram.png)

## Data ingestion: From clickstream to lakehouse in seconds

The platform ingests approximately 1,000 events per second — product views, searches, add-to-cart actions, purchases, and session metadata. Lakeflow Connect’s Zerobus Ingest provides the ingestion backbone, landing events directly into Unity Catalog Delta tables without requiring a self-managed message broker.

An important architectural distinction: clickstream data flows through Zerobus into the lakehouse for offline feature computation and model training, but during real-time inference (Path B), in-session user signals — what the shopper is browsing right now — are sent directly as part of the API request payload to the Model Serving endpoint. This bypasses lakehouse storage entirely during the inference path, ensuring that real-time context is available without incurring ingestion latency.

Zerobus accepts data from any standard Kafka producer client (Java, Python, Go) via a simple configuration change — point the bootstrap server at the Zerobus endpoint, and records land in the target Delta table. For teams already running Kafka infrastructure, Structured Streaming with Declarative Pipelines offers an alternative path with the same downstream architecture.

The data flows into a medallion architecture:

Bronze layer — Raw, append-only event streams plus reference data:

- User signals:
    - Behavioral: browsing sequences, search queries, dwell time patterns, click-through history
    - Transactional: purchase frequency, average order value, return rate, category spend distribution
    - Preference: wishlisted items, saved searches, brand affinities, size preferences
    - Demographic: age cohort, location cluster, device type, app engagement tier

- Item signals:
    - Catalog: category hierarchy, brand, price tier, material, color, seasonality
    - Performance: conversion rate, view-to-cart ratio, return rate, average rating
    - Visual: image embeddings (capturing style similarity beyond text attributes)
    - Freshness: days since listing, trending velocity, stock trajectory

- Contextual signals:
    - Temporal: time of day, day of week, proximity to payday, festival/sale periods
    - Geographic: user city, nearest fulfillment center, regional style preferences
    - Environmental: weather (drives category preferences), local events
    - Session: current browsing intent (inferred from in-session behavior)

Silver layer — Cleaned, sessionized, and enriched:

- Sessionized user behavior (browsing sequences, dwell times, interaction patterns)
- Cleaned product features (normalized attributes, category hierarchies)
- Aggregated engagement signals (7-day view counts, trending scores, popularity indices)
- User-product interaction matrices (implicit feedback signals)

Gold layer — Model-ready feature tables and training datasets:

- User feature vectors (behavioral embeddings, preference profiles, demographic clusters)
- Item feature vectors (product embeddings, attribute encodings)
- Training datasets (labeled interaction pairs for model training)
- Pre-computed recommendation lists (batch-generated, stored for fast lookup)

Features are refreshed on different cadences: behavioral aggregates update daily through scheduled Databricks Workflows, while the full product catalog syncs weekly. Embeddings for both users and items are recomputed daily to capture evolving preferences and new inventory. The Databricks Feature Store manages both offline features (for training) and online features (for serving), ensuring training-serving consistency — the same feature definitions used during model training are automatically available at inference time via Lakebase online tables.

Unity Catalog governs every layer — providing lineage from raw clickstream event to the final prediction served to the app, with fine-grained access control ensuring PII stays protected while aggregated features flow freely to model training.

## Real-time serving: Two paths to low latency responses

The serving architecture provides two complementary paths, each optimized for different interaction patterns. Path A handles the high-volume, predictable surfaces where pre-computation is both feasible and optimal. Path B handles the dynamic, session-aware surfaces where the user's immediate intent must shape the response in real time.

![Realtime serving picture](assets/realtime-serving.png)

### Path A — Pre-computed batch recommendations (< 2 digit ms)

Path A serves the majority of recommendation surfaces — homepage carousels, category page rankings, email campaigns, and push notifications. These surfaces share a common trait: the user's identity and surface type are known in advance, so results can be computed ahead of time.

A nightly batch job, orchestrated by Databricks Workflows, runs the full 3-stage funnel offline for every active user. It retrieves the latest user embeddings, executes batch ANN queries against the AI Search item index to generate candidates, scores them with the LightGBM model using features from the Gold layer, and applies business rules (inventory scoring, delivery proximity, diversity, promotional boosting). The output — a top-N ranked product list per user (typically 50–100 items per surface) — is written to Lakebase online tables, keyed by user ID and surface type.

At serving time, the app performs a simple key-value lookup: user_id + surface → ranked product list. No model inference, no vector search, no feature assembly — just a direct read from Lakebase.

Because the batch job runs nightly, Path A reflects the previous day's signals and inventory state. For most surfaces this freshness is more than sufficient — long-term preferences and brand affinities evolve over days, not minutes — and new products that received their initial embeddings will surface in recommendations within 24 hours.

### Path B — Real-time session-aware scoring (< 2-digit ms)

Path B activates when the recommendation context only exists at request time — "Similar items" on a product detail page, "Complete the look" suggestions, or dynamically re-ranked search results that adapt as the user browses.

The e-commerce app sends current session signals — items viewed in the last few minutes, active search queries, cart contents, and dwell-time patterns — directly as request payload to the Model Serving endpoint via REST API. The endpoint executes the full 3-stage funnel synchronously within a single request-response cycle:

- Stage 1 — Real-time candidate retrieval The endpoint transforms session signals into a query embedding — either the item embedding of the product being viewed, or a blended user embedding that fuses the long-term preference profile (from Lakebase) with in-session behavior, weighting recent signals more heavily. This embedding is sent to Databricks AI Search, which performs hybrid retrieval: ANN similarity search combined with hard metadata filters (category eligibility, regional inventory, minimum stock thresholds). Items that are out of stock or ineligible never enter the candidate set. AI Search returns 200–500 candidates in a single network round-trip. For session-aware surfaces, the endpoint computes a blended query embedding — combining the user's pre-computed long-term preference embedding (retrieved from Lakebase) with a session embedding derived from recently viewed items, weighted toward recent signals to capture immediate intent. This blending is a lightweight computation performed within the endpoint, not a separate model call
- Stage 2 — Feature assembly and scoring Candidate item IDs trigger point lookups against Lakebase online tables, retrieving pre-computed user features (behavioral aggregates, demographic segment, price sensitivity) and item features (conversion rate, trending score, days since listing). Real-time context features (time of day, device, location, active promotions) are derived directly from the request payload. The endpoint constructs feature vectors for each user-candidate pair — including cross features such as user-category affinity and brand preference overlap — and passes them to the LightGBM scoring model, which predicts conversion probability in a single batch inference call without GPU resources.
- Stage 3 — Business rules and re-ranking The scored list passes through a deterministic re-ranking layer: inventory-aware scoring deprioritizes declining stock, delivery proximity scoring favors closer warehouses for faster fulfillment, diversity injection prevents brand or category dominance in the final list, and promotional boosting surfaces items aligned with active campaigns. The re-ranked list is truncated to the requested size (typically 10–20 items) and returned as the API response.

Business rules are configuration-driven — promotional weights, diversity thresholds, and inventory cutoffs are read from a managed configuration table at serving time, allowing commercial teams to adjust rules without redeploying the model.

The endpoint is implemented as a custom MLflow PyFunc model that orchestrates the multi-stage pipeline internally — querying AI Search, performing Lakebase lookups, running LightGBM inference, and applying business rules within a single predict() call.

A fallback strategy ensures resilience: if the real-time path exceeds its latency budget, the system gracefully degrades to serving cached popular items or the user's pre-computed recommendations from Path A.

## Handling the cold start problem

Every recommendation system must address two cold-start scenarios:

New users (no browsing history): When a user first arrives, the system constructs a default user embedding from available demographic signals — location, device type, sign-up context, and any stated preferences. This embedding is used for ANN search against the item index, effectively placing the new user within a behavioral cluster of similar demographics. As the user interacts, their embedding rapidly converges toward their true preferences.

New products (no interaction data): When a new SKU enters the catalog, the system generates an item embedding from its attributes — title, category, brand, price point, and visual features extracted from product images. This embedding is used to find similar existing items in the vector space, and the new product inherits initial recommendation scores from its nearest neighbors. New products surface in recommendations at the next daily batch cycle.

## Model lifecycle and continuous improvement

Models are retrained weekly using Databricks Workflows, with experiment tracking and versioning managed through MLflow. The platform supports champion/challenger deployment — new model versions are deployed alongside the production model, with traffic gradually shifted based on online performance metrics.

Key ML metrics monitored include:

- AUC-ROC — measures the scoring model's ability to distinguish between items a user will and won't engage with
- NDCG@K (Normalized Discounted Cumulative Gain) — evaluates whether the most relevant items appear at the top of the ranked list
- Recall@K — measures what fraction of relevant items the candidate generation stage successfully retrieves
- Log Loss — tracks prediction calibration, ensuring conversion probability scores remain well-calibrated over time

These model metrics are complemented by business KPIs — click-through rate, conversion rate, and revenue per session — which serve as the ultimate validation that model improvements translate to real-world impact.

Automated drift detection flags when feature distributions or prediction score distributions deviate from baselines, triggering investigation or accelerated retraining. Serving logs are correlated back to training pipelines via request-level identifiers, ensuring the feedback loop produces clean, leakage-free training data for the next model iteration. Position-aware training techniques ensure the model learns true user preference rather than display-position artifacts.

## Expected outcomes

This architecture enables:

- low 2-digit ms personalized responses at scale, matching the performance expectations of modern mobile-first shoppers
- Daily-fresh recommendations that reflect the latest inventory, trending products, and evolving user preferences
- Unified governance from raw clickstream to production predictions, with full lineage and access control via Unity Catalog
- Rapid experimentation — new model variants can be trained, evaluated, and deployed within days rather than months
- Operational simplicity — a single platform replaces the patchwork of separate systems for ingestion, feature engineering, training, and serving
- Graceful scaling — from thousands to millions of users without re-architecting, leveraging serverless compute and managed infrastructure

## Conclusion

Building a production-grade recommendation and ranking engine no longer requires stitching together a dozen specialized systems. By unifying real-time ingestion (Zerobus), feature management (Feature Store + Lakebase), model training (MLflow + Workflows), vector retrieval (AI Search), and low-latency serving (Model Serving) on a single governed platform, e-commerce teams can focus on what matters: understanding their customers and delivering the right product at the right moment.

The result is not just a recommendation engine — it is a complete, production-ready personalization platform that can serve as the intelligent backbone of any e-commerce experience.