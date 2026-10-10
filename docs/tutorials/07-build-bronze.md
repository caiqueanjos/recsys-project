# 7. Build replay-safe Delta ingestion

You will implement raw ingestion for **your lab export**, merge matching records without duplicates, and recover after one table commits but progress does not. Continue in `store-lab` after lesson 6 with `data/exports/lab-first` available.

Complete the uv/Python/JDK preflight in [machine setup](../how-to/prepare-your-machine.md). Read **Before lesson 7** in [learning foundations](../explanation/learning-foundations.md). The Python examples use indented blocks, dictionaries such as `manifest['sourceId']`, and `try/finally` for cleanup. If Python functions/files are new, practice the [official Python tutorial](https://docs.python.org/3.12/tutorial/) first. No prior Spark pipeline is assumed.

## 1. Create a separate Python tool project

From the lab root, run `mkdir -p tools/bronze`. Create `tools/bronze/pyproject.toml`:

```toml
[project]
name = "lab-bronze"
version = "0.0.0"
requires-python = ">=3.12,<3.13"
dependencies = ["pyspark==4.0.1", "delta-spark==4.0.0"]

[tool.uv]
package = false
```

Run `uv sync --project tools/bronze`. Expect an isolated environment under that directory and a lockfile. Keep these separate from npm and any recommendation project. First Spark startup needs Maven downloads; a missing Java executable is a prerequisite failure.

## 2. Define the recovery order

The event merge key is `(sourceId, eventId)`. The catalog merge key is `(sourceId, snapshotId, productId)`. Matching existing rows remain unchanged; different content under the same key is a conflict.

Use this commit order: verify immutable files → merge events → merge catalog → save completed cursor. If events commit and the next step fails, replay finds the same events and finishes the remaining work. The cursor moves only after both tables complete. This is recoverable completion, not atomic visibility across tables.

## 3. Implement verification, raw merges, and progress

Create `tools/bronze/ingest.py`:

```python
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path

from delta import configure_spark_with_delta_pip
from delta.tables import DeltaTable
from pyspark.sql import SparkSession, functions as F

EVENT_SCHEMA = "sourceId STRING,eventId STRING,seq LONG,eventTime STRING,ingestionTime STRING,source STRING,schemaVersion INT,payload STRING"
CATALOG_SCHEMA = "sourceId STRING,snapshotId STRING,snapshotAt STRING,productId STRING,payload STRING"


def read_batch(batch):
    manifest = json.loads((batch / "manifest.json").read_text())
    if manifest["version"] != 1 or not 0 <= manifest["after"] <= manifest["highWater"]:
        raise ValueError("Invalid manifest version/range")
    if set(manifest["files"]) != {"events.ndjson", "catalog.ndjson"}:
        raise ValueError("Unexpected files")
    contents = {}
    for name, spec in manifest["files"].items():
        raw = (batch / name).read_bytes()
        rows = [json.loads(line) for line in raw.splitlines()]
        if hashlib.sha256(raw).hexdigest() != spec["sha256"] or len(rows) != spec["count"]:
            raise ValueError("Export integrity check failed")
        if any(row["sourceId"] != manifest["sourceId"] for row in rows):
            raise ValueError("Source mismatch")
        contents[name] = rows
    events = contents["events.ndjson"]
    if sorted(row["seq"] for row in events) != list(range(manifest["after"] + 1, manifest["highWater"] + 1)):
        raise ValueError("Noncontiguous event range")
    if any(not row["eventId"] or not isinstance(row["payload"], str) for row in events):
        raise ValueError("Invalid event envelope")
    catalog = contents["catalog.ndjson"]
    if any(row["snapshotId"] != manifest["snapshotId"] or row["snapshotAt"] != manifest["snapshotAt"]
           or not row["productId"] or not isinstance(row["payload"], str) for row in catalog):
        raise ValueError("Invalid catalog envelope")
    return manifest, events, catalog


def create_spark():
    builder = (SparkSession.builder.appName("lab-bronze").master("local[2]")
               .config("spark.ui.enabled", "false")
               .config("spark.sql.shuffle.partitions", "2")
               .config("spark.databricks.delta.snapshotPartitions", "2")
               .config("spark.jars.ivy", str(Path("data/spark-ivy").resolve()))
               .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
               .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog"))
    spark = configure_spark_with_delta_pip(builder).getOrCreate()
    spark.sparkContext.setLogLevel("WARN")
    return spark


def merge_raw(spark, rows, schema, path, keys):
    frame = spark.createDataFrame(rows, schema)
    if frame.groupBy(*keys).count().filter("count > 1").limit(1).count():
        raise ValueError("Duplicate logical keys")
    location = str(path.resolve())
    if not DeltaTable.isDeltaTable(spark, location):
        frame.write.format("delta").mode("errorifexists").save(location)
        return
    target = DeltaTable.forPath(spark, location)
    overlaps = target.toDF().alias("old").join(frame.alias("new"), keys)
    equal = F.lit(True)
    for column in frame.columns:
        if column not in keys:
            equal = equal & F.col(f"old.{column}").eqNullSafe(F.col(f"new.{column}"))
    if overlaps.filter(~equal).limit(1).count():
        raise ValueError("Logical record changed during replay")
    condition = " AND ".join(f"old.{key}=new.{key}" for key in keys)
    target.alias("old").merge(frame.alias("new"), condition).whenNotMatchedInsertAll().execute()


def save_progress(path, progress):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as stream:
        json.dump(progress, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def ingest(spark, batch, root, fail_after_events=False):
    manifest, events, catalog = read_batch(batch)
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".ingest.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        progress_path = root / "progress.json"
        progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
        source = manifest["sourceId"]
        cursor = progress.get(source, 0)
        if manifest["after"] > cursor:
            raise ValueError("Batch skips unprocessed events")
        if cursor and not (root / "events" / "_delta_log").is_dir():
            raise ValueError("Missing events table with existing progress")
        merge_raw(spark, events, EVENT_SCHEMA, root / "events", ["sourceId", "eventId"])
        if fail_after_events:
            raise RuntimeError("Injected failure after events commit")
        merge_raw(spark, catalog, CATALOG_SCHEMA, root / "catalog", ["sourceId", "snapshotId", "productId"])
        progress[source] = max(cursor, manifest["highWater"])
        save_progress(progress_path, progress)
        return {"sourceId": source, "cursor": progress[source]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("batch", type=Path)
    parser.add_argument("--root", type=Path, default=Path("data/bronze-lab"))
    parser.add_argument("--fail-after-events", action="store_true")
    args = parser.parse_args()
    read_batch(args.batch)  # Check bytes before paying the JVM startup cost.
    spark = create_spark()
    try:
        print(ingest(spark, args.batch, args.root, args.fail_after_events))
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
```

Read one function at a time:

- `read_batch` verifies bytes/counts/provenance and requires every sequence in the declared range.
- `create_spark` starts a local JVM with Delta support.
- `merge_raw` rejects duplicate keys and changed replay content before inserting missing rows. `payload` stays a string; it is not transformed into features.
- `save_progress` replaces a flushed progress file after data commits.
- `ingest` holds one local writer lock, rejects skipped ranges, and preserves monotonic per-source progress.

This small implementation loads each export into Python memory. The reference ingestion reads JSON through Spark directly. Both are local POSIX workflows; file locks/progress cannot simply be copied to an object store. Catalog payloads represent export-time state, not historical availability.

## 4. Exercise failure and replay in one Spark process

Create `tools/bronze/check-replay.py`:

```python
import json
from pathlib import Path
from ingest import create_spark, ingest

batch = Path('data/exports/lab-first')
root = Path('data/bronze-lab-test')  # Use a fresh path if you repeat this exercise.
manifest = json.loads((batch / 'manifest.json').read_text())
spark = create_spark()
try:
    try:
        ingest(spark, batch, root, fail_after_events=True)
    except RuntimeError as error:
        assert 'Injected failure' in str(error)
    else:
        raise AssertionError('Expected the injected failure')
    assert (root / 'events' / '_delta_log').is_dir()
    assert not (root / 'progress.json').exists()
    ingest(spark, batch, root)
    ingest(spark, batch, root)
    events = spark.read.format('delta').load(str((root / 'events').resolve()))
    catalog = spark.read.format('delta').load(str((root / 'catalog').resolve()))
    assert events.count() == manifest['files']['events.ndjson']['count']
    assert catalog.count() == manifest['files']['catalog.ndjson']['count']
    assert json.loads((root / 'progress.json').read_text())[manifest['sourceId']] == manifest['highWater']
    print('Partial commit recovered; exact replay added no duplicate rows')
finally:
    spark.stop()
```

From the lab root:

```sh
uv run --project tools/bronze python tools/bronze/check-replay.py
```

Expect **Partial commit recovered; exact replay added no duplicate rows**. The script deliberately fails after the event commit, verifies progress is absent, then completes and replays the same batch. Use a new `root` in the script on subsequent demonstrations of the initial failure checkpoint.

## 5. Run your CLI and an empty increment

```sh
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/lab-first --root data/bronze-lab
```

Expect source ID and completed cursor. With API/Vite still stopped, read that source's cursor and export an increment:

```sh
bronze_cursor=$(node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("data/exports/lab-first/manifest.json","utf8")); const p=JSON.parse(fs.readFileSync("data/bronze-lab/progress.json","utf8")); console.log(p[m.sourceId]);')
node --import tsx apps/store-api/src/export-cli.ts data/exports/lab-second "$bronze_cursor"
uv run --project tools/bronze python tools/bronze/ingest.py data/exports/lab-second --root data/bronze-lab
```

Expect zero new events, the same cursor, and a new catalog snapshot. Use fresh export paths when repeating. An older batch can be replayed without moving progress backward. A batch starting beyond progress is rejected.

To inspect conflict handling, keep the original batch unchanged and trace `merge_raw`: matching keys with different non-key fields raise before insertion. The reference project's [integration tests](../../tools/bronze/tests/test_ingest.py) exercise conflict/gap/corruption cases against its production scaffold.

You have built an integrated small system: React → durable store API → observed/backend events → immutable export → raw Delta tables with recovery. Its shortcuts remain demo identity, a tiny catalog, no session expiry, small in-memory export batches, and no recommendation model.

Next, compare it with the larger implementation using [the repository store exercise](05-observe-the-store.md), [seeded history exercise](06-synthetic-history.md), and [repository recovery exercise](07-bronze-replay.md). [Index](../README.md).
