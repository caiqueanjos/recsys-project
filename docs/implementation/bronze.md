# Immutable exports and local Bronze ingestion

Understand the replay and recovery protocol between SQLite and raw Delta tables. Export code is [export.ts](../../tools/generate/export.ts); ingestion is [ingest.py](../../tools/bronze/ingest.py). Bronze means a raw analytical landing layer, preserving source data rather than producing model features.

## Export protocol

The exporter captures the event high-water sequence and catalog within one SQLite transaction. It writes a temporary sibling directory, calculates line counts and SHA-256 digests, writes `manifest.json`, then renames the directory to the requested destination. Existing output paths are rejected. A failed export can leave a partial directory; it is not a completed batch.

| Artifact | Fields |
| --- | --- |
| `manifest.json` | Version, source ID, `after`, `highWater`, snapshot ID/time, file counts/checksums |
| `events.ndjson` | `sourceId`, `eventId`, `seq`, `eventTime`, `ingestionTime`, `source`, `schemaVersion`, raw JSON `payload` string |
| `catalog.ndjson` | `sourceId`, `snapshotId`, `snapshotAt`, `productId`, raw JSON `payload` string |

Events cover `(after, highWater]` in sequence order. The snapshot ID hashes source ID, snapshot time, and exported products. Catalog includes products listed by snapshot time and their full current fields, including `listedAt` inside the payload. It is export-time state, not a reconstruction of past availability. Diagnostics and order tables are not exported separately; purchase events reference orders in the store.

## Ingestion checks and merge keys

The standalone Python project uses Spark 4.0.1, Delta 4.0.0, and Python 3.12. Spark runs `local[2]`; prerequisites and exact commands are in the [runbook](../local-development.md#bronze-prerequisites-and-ingestion).

Ingestion verifies manifest version, required file names, ranges, line counts, and checksums. A local file lock serializes writers to one Bronze root. Event envelopes must belong to the manifest source and contain a distinct, contiguous sequence range. Catalog envelopes must match source and snapshot metadata.

| Delta table | Logical merge key |
| --- | --- |
| `events` | `(sourceId, eventId)` |
| `catalog` | `(sourceId, snapshotId, productId)` |

Duplicate keys within a batch are rejected. Existing keys must match all incoming non-key fields; changed replay data is rejected rather than silently overwritten. New keys are inserted. Timestamp strings and raw JSON remain intact; Bronze does not fully revalidate the embedded store contract or transform payloads into features.

## Cursor and crash recovery

`progress.json` maps source IDs to processed high-water sequences. A batch starting ahead of its source cursor is rejected to prevent skipped events. Earlier/overlapping batches are accepted and checked for conflicts. Progress uses `max(oldCursor, highWater)`, so replay cannot move it backward.

Event and catalog Delta commits are separate. Progress advances only after both complete, using a flushed/fsynced temporary file and atomic replacement. If ingestion crashes after events commit, retry merges those events safely, commits catalog, and advances progress. This provides recovery through replay, not a transaction spanning both Delta tables.

The `--fail-after-events` switch exercises that gap. A nonzero cursor without its events table is rejected. To rebuild, choose a fresh Bronze root and replay from zero; do not reuse progress from discarded tables.

Local filesystems, Unix file locking, and manually scheduled exports/ingestion are the supported scope. Cloud locking, streaming, Silver/Gold, and online serving are unimplemented. Continue with [validation](validation.md) and the [runbook](../local-development.md).
