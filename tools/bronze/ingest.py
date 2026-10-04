"""Single-writer, local raw ingestion. No recommendation features or transformations."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path


def verify_batch(batch: Path) -> dict:
    manifest = json.loads((batch / "manifest.json").read_text())
    if manifest.get("version") != 1:
        raise ValueError("Unsupported export version")
    if not 0 <= manifest["after"] <= manifest["highWater"]:
        raise ValueError("Invalid export range")
    expected = {"events.ndjson", "catalog.ndjson"}
    if set(manifest["files"]) != expected:
        raise ValueError("Unexpected export files")
    for name in expected:
        digest, count = hashlib.sha256(), 0
        with (batch / name).open("rb") as stream:
            for line in stream:
                digest.update(line)
                count += 1
        spec = manifest["files"][name]
        if digest.hexdigest() != spec["sha256"] or count != spec["count"]:
            raise ValueError(f"Export integrity check failed: {name}")
    return manifest


def save_progress(path: Path, progress: dict) -> None:
    temp = path.with_suffix(".tmp")
    with temp.open("w") as stream:
        json.dump(progress, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def create_spark():
    from delta import configure_spark_with_delta_pip
    from pyspark.sql import SparkSession

    builder = (
        SparkSession.builder.appName("store-bronze")
        .master("local[2]")
        .config("spark.ui.enabled", "false")
        .config("spark.jars.ivy", os.environ.get("SPARK_IVY_DIR", str(Path("data/spark-ivy").resolve())))
        .config("spark.sql.shuffle.partitions", "2")
        .config("spark.databricks.delta.snapshotPartitions", "2")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
    )
    spark = configure_spark_with_delta_pip(builder).getOrCreate()
    spark.sparkContext.setLogLevel("WARN")
    return spark


def merge_raw(spark, frame, path: Path, keys: list[str]) -> None:
    from delta.tables import DeltaTable
    from pyspark.sql import functions as F

    location = str(path.resolve())
    if frame.groupBy(*keys).count().filter("count > 1").limit(1).count():
        raise ValueError("Duplicate logical records inside an export")
    if DeltaTable.isDeltaTable(spark, location):
        target = DeltaTable.forPath(spark, location)
        condition = " AND ".join(f"target.{key} = incoming.{key}" for key in keys)
        conflicts = target.toDF().alias("target").join(frame.alias("incoming"), keys)
        same = F.lit(True)
        for column in frame.columns:
            if column not in keys:
                same = same & F.col(f"target.{column}").eqNullSafe(F.col(f"incoming.{column}"))
        if conflicts.filter(~same).limit(1).count():
            raise ValueError("A logical record changed during replay")
        target.alias("target").merge(frame.alias("incoming"), condition).whenNotMatchedInsertAll().execute()
    else:
        frame.write.format("delta").mode("errorifexists").save(location)


def ingest(spark, batch: Path, root: Path, fail_after_events: bool = False) -> dict:
    from pyspark.sql import functions as F

    manifest = verify_batch(batch)
    root.mkdir(parents=True, exist_ok=True)
    # Protect both Delta merges and cursor advancement from concurrent local writers.
    with (root / ".ingest.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        progress_file = root / "progress.json"
        progress = json.loads(progress_file.read_text()) if progress_file.exists() else {}
        source = manifest["sourceId"]
        cursor = int(progress.get(source, 0))
        if manifest["after"] > cursor:
            raise ValueError("Export skips unprocessed events; export from the current cursor or earlier")
        if cursor and not (root / "events" / "_delta_log").is_dir():
            raise ValueError("Events table is missing while its cursor exists; replay into a new Bronze root")
        # Strings intentionally retain original UTC representation and raw JSON.
        events = spark.read.schema(
            "sourceId STRING,eventId STRING,seq LONG,eventTime STRING,ingestionTime STRING,source STRING,schemaVersion INT,payload STRING"
        ).json(str((batch / "events.ndjson").resolve()))
        invalid = events.filter(
            F.col("sourceId").isNull() | (F.col("sourceId") != source)
            | F.col("eventId").isNull() | F.col("payload").isNull()
            | F.col("seq").isNull() | (F.col("seq") <= manifest["after"])
            | (F.col("seq") > manifest["highWater"])
        )
        if invalid.limit(1).count():
            raise ValueError("Invalid event envelope")
        if events.count() != manifest["highWater"] - manifest["after"] or events.select("seq").distinct().count() != events.count():
            raise ValueError("Export does not contain a contiguous event range")
        # Merge the full export, including prior IDs, to detect conflicting replays.
        merge_raw(spark, events, root / "events", ["sourceId", "eventId"])
        if fail_after_events:
            raise RuntimeError("Injected failure after event commit and before catalog/cursor commit")
        catalog = spark.read.schema(
            "sourceId STRING,snapshotId STRING,snapshotAt STRING,productId STRING,payload STRING"
        ).json(str((batch / "catalog.ndjson").resolve()))
        if catalog.filter(
            F.col("sourceId").isNull() | (F.col("sourceId") != source)
            | F.col("snapshotId").isNull() | (F.col("snapshotId") != manifest["snapshotId"])
            | F.col("snapshotAt").isNull() | (F.col("snapshotAt") != manifest["snapshotAt"])
            | F.col("productId").isNull() | F.col("payload").isNull()
        ).limit(1).count():
            raise ValueError("Invalid catalog envelope")
        merge_raw(spark, catalog, root / "catalog", ["sourceId", "snapshotId", "productId"])
        progress[source] = max(cursor, manifest["highWater"])
        save_progress(progress_file, progress)
        return {"sourceId": source, "cursor": progress[source], "snapshotId": manifest["snapshotId"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch", type=Path)
    parser.add_argument("--root", type=Path, default=Path("data/bronze"))
    parser.add_argument("--fail-after-events", action="store_true", help="Exercise crash recovery")
    args = parser.parse_args()
    verify_batch(args.batch)  # Validate bytes before starting the JVM.
    spark = create_spark()
    try:
        print(json.dumps(ingest(spark, args.batch, args.root, args.fail_after_events)))
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
