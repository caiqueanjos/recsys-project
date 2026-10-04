import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from ingest import create_spark, ingest, verify_batch


def batch(path, after=0, high=2, snapshot="snapshot-one"):
    path.mkdir()
    files = {
        "events.ndjson": [dict(sourceId="store-one", eventId=f"e-{i}", seq=i,
                               eventTime="2026-01-01T00:00:00.000Z", ingestionTime="2026-01-01T00:00:01.000Z",
                               source="synthetic", schemaVersion=1, payload=json.dumps({"id": f"e-{i}"}))
                           for i in range(after + 1, high + 1)],
        "catalog.ndjson": [dict(sourceId="store-one", snapshotId=snapshot,
                                snapshotAt="2026-01-02T00:00:00.000Z", productId="p-1", payload='{"id":"p-1"}')],
    }
    specs = {}
    for name, rows in files.items():
        content = "".join(json.dumps(row) + "\n" for row in rows).encode()
        (path / name).write_bytes(content)
        specs[name] = dict(sha256=hashlib.sha256(content).hexdigest(), count=len(rows))
    manifest = dict(version=1, sourceId="store-one", after=after, highWater=high,
                    snapshotId=snapshot, snapshotAt="2026-01-02T00:00:00.000Z", files=specs)
    (path / "manifest.json").write_text(json.dumps(manifest))


class BronzeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spark = create_spark()

    @classmethod
    def tearDownClass(cls):
        cls.spark.stop()

    def test_crash_replay_incremental_snapshot_and_gap(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "bronze"
            first = Path(temp) / "first"
            batch(first)
            with self.assertRaisesRegex(RuntimeError, "Injected failure"):
                ingest(self.spark, first, root, fail_after_events=True)
            self.assertFalse((root / "progress.json").exists())
            ingest(self.spark, first, root)
            ingest(self.spark, first, root)
            self.assertEqual(self.spark.read.format("delta").load(str(root / "events")).count(), 2)
            self.assertEqual(self.spark.read.format("delta").load(str(root / "catalog")).count(), 1)
            second = Path(temp) / "second"
            batch(second, after=2, high=3, snapshot="snapshot-two")
            self.assertEqual(ingest(self.spark, second, root)["cursor"], 3)
            self.assertEqual(self.spark.read.format("delta").load(str(root / "events")).count(), 3)
            self.assertEqual(self.spark.read.format("delta").load(str(root / "catalog")).count(), 2)
            # An old batch must never move the durable cursor backward.
            self.assertEqual(ingest(self.spark, first, root)["cursor"], 3)
            empty = Path(temp) / "empty"
            batch(empty, after=3, high=3, snapshot="snapshot-three")
            self.assertEqual(ingest(self.spark, empty, root)["cursor"], 3)
            gap = Path(temp) / "gap"
            batch(gap, after=4, high=5)
            with self.assertRaisesRegex(ValueError, "skips"):
                ingest(self.spark, gap, root)
            (first / "events.ndjson").write_text("corruption")
            with self.assertRaisesRegex(ValueError, "integrity"):
                verify_batch(first)


if __name__ == "__main__":
    unittest.main()
