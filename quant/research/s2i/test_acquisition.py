from __future__ import annotations

import json
import pathlib
import tempfile
import unittest
from copy import deepcopy

import acquisition


class AcquisitionTests(unittest.TestCase):
    def test_plan_is_exact_and_unique(self) -> None:
        plan = acquisition.load_json(acquisition.PLAN_PATH)
        acquisition.validate_source_plan(plan)
        artifacts = acquisition.enumerate_plan(plan)
        self.assertEqual(len(artifacts), 416)
        self.assertEqual(len({item.key for item in artifacts}), 416)
        counts: dict[str, int] = {}
        for item in artifacts:
            counts[item.lifecycle_partition] = (
                counts.get(item.lifecycle_partition, 0) + 1
            )
        self.assertEqual(
            counts,
            {
                "WARMUP": 32,
                "DEVELOPMENT": 256,
                "EMBARGO_HOLDOUT": 128,
            },
        )

    def test_checksum_requires_exact_filename(self) -> None:
        digest = "a" * 64
        self.assertEqual(
            acquisition.parse_checksum(
                f"{digest}  BTCUSDT-1h-2025-06.zip\n".encode(),
                "BTCUSDT-1h-2025-06.zip",
            ),
            digest,
        )
        with self.assertRaises(acquisition.AcquisitionError):
            acquisition.parse_checksum(
                f"{digest}  other.zip\n".encode(),
                "BTCUSDT-1h-2025-06.zip",
            )

    def test_manifest_file_verification_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            relative = "data/example.zip"
            target = root / relative
            target.parent.mkdir(parents=True)
            target.write_bytes(b"opaque bytes")
            digest = acquisition.sha256_file(target)
            sidecar = target.with_name(f"{target.name}.CHECKSUM")
            sidecar.write_text(f"{digest}  {target.name}\n", encoding="utf-8")
            manifest = {
                "artifacts": [
                    {
                        "archive_sha256": digest,
                        "checksum_sha256": acquisition.sha256_file(sidecar),
                        "key": relative,
                        "local_path": relative,
                        "publisher_sha256": digest,
                    }
                ]
            }
            self.assertEqual(
                acquisition.verify_manifest_files(manifest, root), []
            )
            target.write_bytes(b"mutated")
            self.assertTrue(
                acquisition.verify_manifest_files(manifest, root)[0].startswith(
                    "ARCHIVE_HASH"
                )
            )

    def test_source_plan_is_canonical_json(self) -> None:
        plan = json.loads(acquisition.PLAN_PATH.read_bytes())
        acquisition.validate_source_plan(plan)
        self.assertEqual(plan["schema"], "cosmos.s2i.source-plan.v1")
        self.assertEqual(plan["symbols"], sorted(plan["symbols"]))
        mutated = deepcopy(plan)
        mutated["archive_base"] = "https://example.invalid"
        with self.assertRaises(acquisition.AcquisitionError):
            acquisition.validate_source_plan(mutated)

    def test_manifest_semantics_bind_every_planned_field(self) -> None:
        plan = acquisition.load_json(acquisition.PLAN_PATH)
        artifacts = acquisition.enumerate_plan(plan)
        rows = []
        for item in artifacts:
            rows.append(
                {
                    "archive_bytes": 1,
                    "archive_sha256": "a" * 64,
                    "checksum_bytes": 1,
                    "checksum_sha256": "b" * 64,
                    "checksum_url": item.checksum_url,
                    "dataset": item.dataset,
                    "key": item.key,
                    "lifecycle_partition": item.lifecycle_partition,
                    "local_path": item.local_path,
                    "month": item.month,
                    "publisher_sha256": "a" * 64,
                    "symbol": item.symbol,
                    "url": item.url,
                }
            )
        inventory = [
            {
                "archive_sha256": row["archive_sha256"],
                "checksum_sha256": row["checksum_sha256"],
                "key": row["key"],
            }
            for row in rows
        ]
        manifest = {
            "archive_base": plan["archive_base"],
            "artifact_count": len(rows),
            "artifacts": rows,
            "inventory_sha256": acquisition.sha256_bytes(
                acquisition.canonical_json_bytes(inventory)
            ),
            "outcome_member_access": "NONE",
            "schema": "cosmos.s2i.source-manifest.v1",
            "source_plan_semantic_sha256": (
                acquisition.EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256
            ),
            "source_plan_sha256": acquisition.sha256_file(
                acquisition.PLAN_PATH
            ),
        }
        self.assertEqual(
            acquisition.validate_manifest_semantics(manifest, plan), []
        )
        mutated = deepcopy(manifest)
        mutated["artifacts"][0]["symbol"] = "WRONG"
        self.assertIn(
            "ARTIFACT_FIELD 0 symbol",
            acquisition.validate_manifest_semantics(mutated, plan),
        )


if __name__ == "__main__":
    unittest.main()
