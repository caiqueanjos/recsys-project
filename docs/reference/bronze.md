# Export and Bronze reference

Sources: [export.ts](../../tools/generate/export.ts) and [ingest.py](../../tools/bronze/ingest.py). This protocol uses immutable local files and raw Delta tables. It does not implement streaming, feature computation, or remote Databricks deployment.

## Export directory

| File             | Contents                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| `events.ndjson`  | One event envelope per line                                                   |
| `catalog.ndjson` | One catalog envelope per product per line                                     |
| `manifest.json`  | Version, provenance, range, snapshot identity, file counts and SHA-256 hashes |

Manifest fields: `version=1`, `sourceId`, `after`, `highWater`, `snapshotId`, `snapshotAt`, and `files`. `files` contains exactly `events.ndjson` and `catalog.ndjson`, each with `count` and `sha256`. Hashes cover the exact file bytes, including newline terminators.

A temporary sibling `<output>.partial-<UUID>` is written and renamed to the requested output after the manifest is complete. Existing outputs are rejected. Failed exports can leave partial directories. Rename publishes a complete directory; the exporter does not fsync its files for a power-loss durability guarantee.

## Event envelope and Delta columns

| Column          | Spark type | Meaning                                                     |
| --------------- | ---------- | ----------------------------------------------------------- |
| `sourceId`      | STRING     | Persistent store database UUID                              |
| `eventId`       | STRING     | Event payload ID                                            |
| `seq`           | LONG       | Gap-free store append order, distinct from occurrence order |
| `eventTime`     | STRING     | Event occurrence timestamp                                  |
| `ingestionTime` | STRING     | Store receipt timestamp, not Bronze processing time         |
| `source`        | STRING     | Browser/backend/synthetic producer                          |
| `schemaVersion` | INT        | Currently 1                                                 |
| `payload`       | STRING     | Original stored JSON text                                   |

Merge key: `(sourceId, eventId)`. `sourceId` is stable for the lifetime of the database metadata, independent of export path or generator run ID.

## Catalog envelope and Delta columns

| Column       | Spark type | Meaning                                                                        |
| ------------ | ---------- | ------------------------------------------------------------------------------ |
| `sourceId`   | STRING     | Store provenance                                                               |
| `snapshotId` | STRING     | SHA-256 identity over source, snapshot time, and ordered database product rows |
| `snapshotAt` | STRING     | Export's snapshot timestamp                                                    |
| `productId`  | STRING     | Product ID                                                                     |
| `payload`    | STRING     | Product JSON with boolean availability                                         |

Merge key: `(sourceId, snapshotId, productId)`. Export includes products listed by snapshot time, including unavailable products. Snapshot rows capture current export-time state. They do not reconstruct availability or prices at historical event time. A new snapshot time produces a new snapshot identity even if products are unchanged.

## Ingestion CLI

From the repository root:

```sh
uv run --project tools/bronze python tools/bronze/ingest.py BATCH --root ROOT
```

`BATCH` is required; `--root` defaults to `data/bronze` relative to the current working directory. `--fail-after-events` raises deliberately after the events Delta commit and before catalog/progress commits. It exists to exercise recovery.

| Root path       | Role                                                    |
| --------------- | ------------------------------------------------------- |
| `events/`       | Raw event Delta table                                   |
| `catalog/`      | Raw catalog snapshot Delta table                        |
| `progress.json` | JSON map `{ sourceId: lastCompletedSequence }`          |
| `.ingest.lock`  | POSIX exclusive lock covering local merges and progress |

## Validation and commit order

1. Validate manifest version/range, exact file set, hashes, and line counts before starting Spark in the CLI.
2. Acquire one local writer lock. Reject `after > current source cursor` and a missing events table when a nonzero cursor exists.
3. Read typed envelopes. Reject missing required identity/payload/sequence fields, source mismatches, out-of-range sequences, and noncontiguous event ranges.
4. Reject duplicate logical merge keys within a batch. Merge all event rows, including overlapping records, to detect changed replay content.
5. Validate catalog provenance, snapshot ID/time, product IDs, and payload presence; merge catalog rows.
6. Advance this source's cursor to `max(old cursor, highWater)` after both commits. Write temporary progress, fsync, replace, and fsync its directory.

Exact matching rows are not inserted again. Conflicting rows are rejected; the merge does not update existing logical records. Bronze keeps payloads raw and does not revalidate the full nested event contract. Two tables and progress are separate commits; no cross-table atomic visibility is promised. Replay completes partial work after failure.

Local ingestion uses Spark `local[2]`, two shuffle partitions, and disabled Spark UI. Locking/progress rely on a local POSIX filesystem; copying this code unchanged to object storage does not provide the same guarantees.

Related: [incremental ingestion guide](../how-to/export-and-ingest.md), [recovery explanation](../explanation/bronze-recovery.md), [replay tutorial](../tutorials/07-bronze-replay.md), [index](../README.md).
