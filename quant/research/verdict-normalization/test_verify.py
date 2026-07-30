#!/usr/bin/env python3
"""Hostile tests for the verdict-normalization freeze and verifier."""

# ruff: noqa: PT009, PT027

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from typing import Any, ClassVar
from unittest.mock import patch

import verify as subject


class VerdictNormalizationTests(unittest.TestCase):
    base_dir: ClassVar[Path]
    repo: ClassVar[Path]
    run_md: ClassVar[Path]
    expected: ClassVar[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]

    @classmethod
    def setUpClass(cls) -> None:
        cls.base_dir = Path(__file__).resolve().parent
        cls.repo = Path(
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=cls.base_dir,
                text=True,
            ).strip()
        )
        cls.run_md = Path("/Users/cosmosgeek/Desktop/run.md")
        cls.expected = subject.build_documents(cls.repo, cls.run_md)

    def copy_fixture(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        target = Path(temporary.name)
        for source in subject.paths(self.base_dir):
            shutil.copy2(source, target / source.name)
        return temporary, target

    def mutate_json(self, target: Path, index: int, mutator: Any) -> None:
        path = subject.paths(target)[index]
        value = json.loads(path.read_text())
        mutator(value)
        path.write_bytes(subject.canonical_bytes(value))

    def assert_materialized_fails(self, target: Path) -> None:
        with self.assertRaises(subject.ContractError):
            subject.verify_materialized(self.expected, target)

    def test_frozen_documents_verify(self) -> None:
        subject.verify_materialized(self.expected, self.base_dir)

    def test_two_builds_are_byte_identical(self) -> None:
        second = subject.build_documents(self.repo, self.run_md)
        self.assertEqual(
            [subject.canonical_bytes(value) for value in self.expected],
            [subject.canonical_bytes(value) for value in second],
        )

    def test_census_and_pending_controls_are_exact(self) -> None:
        registry = self.expected[2]
        self.assertEqual(registry["summary"]["recordCount"], 94)
        self.assertEqual(registry["summary"]["targetDispositionCount"], 92)
        self.assertEqual(registry["summary"]["pendingInputCount"], 2)
        self.assertEqual(
            [record["id"] for record in registry["records"][-2:]],
            ["BASIS-MAKER-REAL-TIER-GRID", "VOLUME-ECONOMICS"],
        )
        self.assertEqual(
            [record["taskLocatorSuffix"] for record in registry["records"][-2:]],
            ["7179", "e15a"],
        )

    def test_duplicate_json_key_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)
        subject.paths(target)[2].write_bytes(b'{"schema":"x","schema":"y"}\n')
        self.assert_materialized_fails(target)

    def test_nonfinite_number_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)
        subject.paths(target)[2].write_bytes(b'{"value":NaN}\n')
        self.assert_materialized_fails(target)

    def test_noncanonical_pretty_json_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)
        value = json.loads(subject.paths(target)[2].read_text())
        subject.paths(target)[2].write_text(json.dumps(value, indent=2) + "\n")
        self.assert_materialized_fails(target)

    def test_extra_registry_key_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)
        self.mutate_json(target, 2, lambda value: value.update({"extra": True}))
        self.assert_materialized_fails(target)

    def test_null_fee_cannot_become_zero(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["records"][0]["fees"]["accountEffectiveValue"] = 0

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_pbo_null_cannot_become_zero(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["records"][0]["pbo"]["value"] = "0"

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_public_capacity_cannot_become_executable(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["records"][0]["capacity"]["executableState"] = "MEASURED"
            value["records"][0]["capacity"]["executableValue"] = "1000 USD"

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_holdout_cannot_be_reopened(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            record = next(record for record in value["records"] if record["id"] == "S-1Z")
            record["holdout"]["state"] = "OPENED"

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_positive_cannot_be_promoted(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["records"][0]["credibility"]["verifiedPositive"] = True

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_rejected_packet_cannot_become_consumable(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            record = next(record for record in value["records"] if record["id"] == "V-G1")
            record["economicConsumable"] = True
            record["n3Consumption"] = "CONSUMED"

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_pending_record_cannot_disappear(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["records"].pop()

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_source_spec_short_oid_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["acceptedBoundary"]["commit"] = "0c0c774c"

        self.mutate_json(target, 1, mutate)
        self.assert_materialized_fails(target)

    def test_source_spec_semantic_promotion_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["records"][0]["normalizedVerdict"] = None

        self.mutate_json(target, 1, mutate)
        self.assert_materialized_fails(target)

    def test_schema_mutation_is_rejected(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)
        self.mutate_json(target, 0, lambda value: value.update({"title": "mutated"}))
        self.assert_materialized_fails(target)

    def test_run_receipt_mutation_is_rejected(self) -> None:
        raw = self.run_md.read_bytes()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        altered = Path(temporary.name) / "run.md"
        altered.write_bytes(
            raw.replace(
                b"terminal N3-S4 candidate measured once",
                b"terminal N3-S4 candidate altered once",
                1,
            )
        )
        with self.assertRaises(subject.ContractError):
            subject.build_documents(self.repo, altered)

    def test_new_target_disposition_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        altered = Path(temporary.name) / "run.md"
        altered.write_bytes(
            raw + b"- item=`2026-07-30 ORCHESTRATOR V-G39 ACCEPTANCE` | status=`ACCEPTED`\n"
        )
        with self.assertRaises(subject.ContractError):
            subject.build_documents(self.repo, altered)

    def test_pending_maker_terminal_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        altered = Path(temporary.name) / "run.md"
        altered.write_bytes(raw + b"- item=`2026-07-30 MAKER-FEE TERMINAL` | status=`PASS`\n")
        with self.assertRaises(subject.ContractError):
            subject.build_documents(self.repo, altered)

    def test_result_raw_hash_is_recomputed(self) -> None:
        original = subject.LEGACY["V-G14"]
        corrupted = replace(original, raw_sha256="0" * 64)
        with (
            patch.dict(subject.LEGACY, {"V-G14": corrupted}),
            self.assertRaises(subject.ContractError),
        ):
            subject.build_documents(self.repo, self.run_md)

    def test_source_documents_contain_no_binary_float(self) -> None:
        def walk(value: Any) -> None:
            self.assertNotIsInstance(value, float)
            if isinstance(value, dict):
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        for document in self.expected:
            walk(document)

    def test_no_result_content_was_read_for_normalization(self) -> None:
        registry = self.expected[2]
        pins = [record["resultPin"] for record in registry["records"] if record["resultPin"]]
        self.assertTrue(pins)
        self.assertTrue(all(pin["contentReadForNormalization"] is False for pin in pins))
        self.assertTrue(all(pin["rawSha256VerifiedThisTask"] is True for pin in pins))


if __name__ == "__main__":
    unittest.main()
