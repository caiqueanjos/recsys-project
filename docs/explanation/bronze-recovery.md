# Why Bronze needs snapshots and durable progress

Understand why raw ingestion has more machinery than copying JSON into a table.

## Provenance makes replay identifiable

An event ID alone can collide across independent datasets. `sourceId` identifies the source database; `(sourceId, eventId)` identifies the logical record. An export range records append order, and hashes/counts describe the exact published bytes. These let ingestion distinguish a retry from missing data or changed content.

`eventTime` is when the action occurred. `ingestionTime` is when the store recorded it. Neither is the time Spark processed the file. Keeping the raw JSON and both timestamps lets later pipelines choose their own interpretation without losing source evidence.

## Two table commits are not one atomic pipeline commit

Consider a batch ending at sequence 100. Events commit successfully, then the process stops before catalog commits. If progress had already moved to 100, a subsequent incremental export could omit data needed to complete that batch. Instead, progress advances only after both table writes.

| Failure point                      | Durable state             | Next replay                                |
| ---------------------------------- | ------------------------- | ------------------------------------------ |
| Before events commit               | Old tables/progress       | Writes batch normally                      |
| After events, before catalog       | New events, old progress  | Matches existing events, completes catalog |
| After both tables, before progress | Both tables, old progress | Matches both, advances progress            |
| After progress                     | Complete batch            | Leaves matching records/cursor intact      |

The two Delta tables can briefly show partial results to another reader. Replay-safe completion is the guarantee; atomic visibility across both tables is not.

## A cursor tracks completed append ranges

The cursor is maintained per source. Ingesting an old batch must not move it backward, so progress uses a maximum. Ingesting a range starting beyond it would skip records, so the pipeline rejects that gap. The store's transactional counter makes contiguous export validation possible even after failed event batches.

Deleting tables while retaining progress breaks the relationship between data and cursor. Rebuild into a new root from sequence zero instead.

## Catalog history starts at the snapshot boundary

A snapshot ID and timestamp let you keep several observations of a changing catalog. They tell you what the exporter captured at that time. They do not prove a product was available during an earlier session. Asking the exporter for an earlier timestamp only filters listing dates; it does not recover overwritten state.

The protocol uses local file locks, rename, and fsync for progress. A future object-store/Databricks adaptation needs a new coordination/progress mechanism; replacing paths alone is insufficient.

Related: [protocol reference](../reference/bronze.md), [recovery lesson](../tutorials/07-bronze-replay.md), [architecture](architecture.md), [index](../README.md).
