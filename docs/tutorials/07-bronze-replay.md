# 7. Export raw data and recover an interrupted ingestion

You will inspect a raw export, interrupt ingestion after one table commits, and replay it without duplicating events. Use this repository and the `docs_demo` database from lesson 5. Lesson 6 explains how small synthetic histories are built; its temporary fixtures are separate from this database. You now need uv, Python 3.12, and JDK 17 or 21. Spark requires local JVM sockets and first-run Maven downloads. Run from the repository root unless told otherwise.

## 1. Publish a small immutable batch

Use unused output paths; if you repeat the lesson, choose new names for both export and Bronze root.

```sh
export STORE_DATABASE_URL=postgresql://store:store@127.0.0.1:5432/docs_demo
npm run export:bronze -- --after 0 --output data/exports/docs-first
node --input-type=module <<'JS'
import fs from 'node:fs';
const base = 'data/exports/docs-first';
const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'));
const first = JSON.parse(fs.readFileSync(`${base}/events.ndjson`, 'utf8').trim().split('\n')[0]);
console.log(manifest);
console.log({ envelope: first, decodedPayload: JSON.parse(first.payload) });
JS
```

Expect source ID, cursor range, snapshot time/ID, counts, and checksums. The event envelope's `payload` is raw JSON text, so you parse it separately. Sequence is append order; `eventTime` is occurrence time. Catalog payloads carry product state as captured by this export.

## 2. Fail after the events commit

Check your runtime and install the isolated Bronze environment:

```sh
java -version
uv sync --project tools/bronze
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/docs-first --root data/bronze-docs --fail-after-events
```

**Expect the final command to fail** with `Injected failure after event commit...`. This is the intended exercise. In a fresh root, the events Delta table exists, but completed progress does not:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
console.log({
  eventsCommitted: fs.existsSync('data/bronze-docs/events/_delta_log'),
  progressCommitted: fs.existsSync('data/bronze-docs/progress.json'),
});
JS
```

Expect `eventsCommitted: true` and `progressCommitted: false`. This failure leaves replayable partial work, not a completed batch.

## 3. Complete and replay the batch

```sh
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/docs-first --root data/bronze-docs
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/docs-first --root data/bronze-docs
```

Both should print the same cursor/snapshot. Matching rows are not inserted twice. Inspect table counts by creating temporary `data/check-docs-bronze.py` with:

```python
import json
from pathlib import Path
from ingest import create_spark

manifest = json.loads(Path('data/exports/docs-first/manifest.json').read_text())
spark = create_spark()
try:
    events = spark.read.format('delta').load(str(Path('data/bronze-docs/events').resolve()))
    catalog = spark.read.format('delta').load(str(Path('data/bronze-docs/catalog').resolve()))
    assert events.count() == manifest['files']['events.ndjson']['count']
    assert catalog.count() == manifest['files']['catalog.ndjson']['count']
    events.select('seq', 'source', 'eventTime', 'payload').orderBy('seq').show(3, truncate=False)
    print('Replay retained one copy of each exported record')
finally:
    spark.stop()
```

Run with the ingestion module on the Python import path:

```sh
PYTHONPATH=tools/bronze uv run --project tools/bronze python data/check-docs-bronze.py
```

Expect both assertions to pass. This count check assumes the fresh root used in this lesson contains only the first batch so far.

## 4. Export an empty increment with another snapshot

Read this source's completed cursor automatically:

```sh
bronze_cursor=$(node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("data/exports/docs-first/manifest.json","utf8")); const p=JSON.parse(fs.readFileSync("data/bronze-docs/progress.json","utf8")); console.log(p[m.sourceId]);')
npm run export:bronze -- --after "$bronze_cursor" --output data/exports/docs-second
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/docs-second --root data/bronze-docs
```

If API/Vite are stopped and you have generated no new data, expect zero exported events and an unchanged cursor. The new snapshot timestamp gives another catalog snapshot. If the browser is still generating activity, the increment can contain those events instead.

## 5. Locate the recovery mechanism

Read [ingest.py](../../tools/bronze/ingest.py) in this order: `verify_batch`, `merge_raw`, `ingest`, and `save_progress`. Find the failure injection point, then the cursor write after the catalog merge. The full [integration test](../../tools/bronze/tests/test_ingest.py) also exercises gaps, conflicts, corrupt bytes, and missing tables.

You now have a working store-to-raw-data boundary. Further cleaning, features, evaluation, and recommendation models belong to the user-owned platform; this lesson ends at Bronze.

Related: [recovery explanation](../explanation/bronze-recovery.md), [format reference](../reference/bronze.md), [incremental ingestion guide](../how-to/export-and-ingest.md), [index](../README.md).
