# What behavioral events can tell you

Understand why exposure, click, and purchase are separate facts, and how their collection limits later analysis.

## A click needs an exposure context

A kettle at position 1 gets more opportunities than a kettle below the fold. If you retain clicks without recording what appeared and where, later analysis can mistake display opportunity for preference. The browser therefore records an impression when at least half the card intersects the viewport, with its surface and one-based position. A click points to that impression.

Intersection is a measurable proxy for exposure, not proof that a person noticed an item. The observer has no dwell threshold. Card activation can establish an impression before the observer callback, including keyboard use. Rerenders/navigation can start another effect lifecycle and another exposure record.

The backend verifies the referenced impression's session, product, surface, position, and chronology. That makes the attribution coherent; it does not remove exposure bias.

## Producers express different evidence

A browser product view means the page loaded that product. A backend purchase means checkout committed an order. The latter is authoritative for the local store even when browser telemetry fails. The schema disallows browser transaction types to avoid counting both a click on checkout and its committed outcome as two purchases.

The fixed homepage list has no model version or recommendation request ID. Inventing those values would make an ordinary seed list look like model output. Reserved attribution fields become meaningful only when a future recommendation producer actually supplies them.

## Delivery is an independent uncertainty

The telemetry queue is ordered, batched, and retried in memory. It is not persisted across browser closure, and the API's current error mapping can stop retries for failures returned as 400. Thus absence of a browser event is not always absence of behavior.

Synthetic delivery experiments model missing, duplicated, and delayed transport separately. They preserve the authoritative order/event dataset so developers can compare the transport artifact against its source. The ordinary Bronze pipeline intentionally ingests the authoritative export, not that experimental format.

Related: [event reference](../reference/events.md), [observe events tutorial](../tutorials/05-observe-the-store.md), [synthetic data](synthetic-data.md), [index](../README.md).
