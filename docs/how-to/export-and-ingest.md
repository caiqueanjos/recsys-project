# Export and ingest incremental raw data

Use this guide to land store records in local Bronze Delta tables. Prerequisites: seeded PostgreSQL, npm dependencies, uv, Python 3.12, and JDK 17 or 21. Spark needs local JVM sockets and first-run Maven downloads. Run from the repository root so default paths are consistent.

## Export a first batch

Use a fresh path; replace `first` if it already exists:

```sh
npm run export:bronze -- --after 0 --output data/exports/first
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/first --root data/bronze
```

Verify the export directory has a manifest and two NDJSON files. Ingestion prints `sourceId`, `cursor`, and `snapshotId`. Confirm `data/bronze/events/_delta_log`, `data/bronze/catalog/_delta_log`, and `data/bronze/progress.json` exist.

First-run dependency downloads can take time. Set `JAVA_HOME` if `java -version` selects an incompatible JVM. Use [troubleshooting](troubleshoot.md) for dependency/socket errors.

## Export from this source's cursor

Find the `sourceId` in the prior manifest and look up that exact key in `progress.json`. Use the completed cursor, not an event occurrence timestamp or a cursor from another database. This command computes it automatically from the first manifest:

```sh
bronze_cursor=$(node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("data/exports/first/manifest.json","utf8")); const p=JSON.parse(fs.readFileSync("data/bronze/progress.json","utf8")); console.log(p[m.sourceId] ?? 0);')
npm run export:bronze -- --after "$bronze_cursor" --output data/exports/second
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/second --root data/bronze
```

Expect only newer events and a complete new catalog snapshot. With no new events, event count is zero and the cursor stays unchanged; a catalog snapshot can still be added.

## Retry interrupted ingestion

Rerun the same batch and root after a failure:

```sh
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/second --root data/bronze
```

Matching event/snapshot records do not duplicate. A failure between events and catalog/progress commits is completed by replay. Do not edit a published batch to make it pass: changed bytes fail integrity checks; conflicting logical content fails replay checks. An `after` greater than the durable cursor is rejected as a gap.

## Rebuild into another Bronze root

```sh
npm run export:bronze -- --after 0 --output data/exports/rebuild
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/rebuild --root data/bronze-rebuild
```

Use that root for subsequent ingestions. Keep the old root for comparison until the new one is verified. Never reuse an old progress file with deleted event tables.

Related: [format/protocol reference](../reference/bronze.md), [guided recovery exercise](../tutorials/07-bronze-replay.md), [recovery explanation](../explanation/bronze-recovery.md), [index](../README.md).
