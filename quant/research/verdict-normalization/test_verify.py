#!/usr/bin/env python3
"""Hostile tests for the verdict-normalization freeze and verifier."""

# ruff: noqa: PT009, PT027

from __future__ import annotations

import json
import os
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

    def test_census_and_control_terminals_are_exact(self) -> None:
        registry = self.expected[2]
        self.assertEqual(registry["summary"]["recordCount"], 94)
        self.assertEqual(registry["summary"]["targetDispositionCount"], 92)
        self.assertEqual(registry["summary"]["controlTerminalCount"], 2)
        self.assertEqual(registry["summary"]["pendingInputCount"], 0)
        self.assertEqual(
            [record["id"] for record in registry["records"][-2:]],
            ["BASIS-MAKER-REAL-TIER-GRID", "VOLUME-ECONOMICS"],
        )
        self.assertEqual(
            [record["normalizedVerdict"] for record in registry["records"][-2:]],
            ["UNKNOWN_DATA", "INVALID_TEST"],
        )
        self.assertTrue(
            all(record["taskLocatorSuffix"] is None for record in registry["records"][-2:])
        )
        source_spec = self.expected[1]
        self.assertNotIn("pendingControls", source_spec)
        self.assertEqual(
            [record["id"] for record in source_spec["controlTerminals"]],
            ["BASIS-MAKER-REAL-TIER-GRID", "VOLUME-ECONOMICS"],
        )

    def test_accepted_maker_control_is_exact_unknown_data(self) -> None:
        record = subject.maker_record(
            self.repo,
            subject.run_rows(self.run_md.read_bytes()),
        )
        self.assertEqual(record["disposition"], "ACCEPTED_SOURCE_ONLY")
        self.assertEqual(record["n3Consumption"], "SOURCE_ONLY")
        self.assertEqual(record["normalizedVerdict"], "UNKNOWN_DATA")
        self.assertEqual(record["rejection"]["detail"], "ACCEPTED_E1_BODY_BYTES_UNAVAILABLE")
        self.assertFalse(record["economicConsumable"])
        self.assertEqual(record["fees"]["accountEffectiveState"], "UNKNOWN")
        self.assertIsNone(record["fees"]["accountEffectiveValue"])
        self.assertEqual(
            record["fees"]["publicProxyState"],
            "PUBLIC_SCHEDULE_SCENARIO_ONLY",
        )
        self.assertEqual(record["capacity"]["executableState"], "UNKNOWN")
        self.assertEqual(record["pbo"]["state"], "NOT_RUN")
        self.assertEqual(record["holdout"]["state"], "UNOPENED")
        self.assertIsNone(record["credibility"]["verifiedPositive"])
        self.assertEqual(record["authority"], "NONE")
        self.assertTrue(record["resultPin"]["rawSha256VerifiedThisTask"])
        self.assertTrue(record["resultPin"]["contentReadForNormalization"])
        self.assertFalse(record["resultPin"]["trustedForEconomics"])

    def test_maker_acceptance_row_mutation_is_rejected(self) -> None:
        raw = self.run_md.read_bytes()
        rows = subject.run_rows(
            raw.replace(
                b"accepted E-1 bodies are absent",
                b"accepted E-1 bodies are changed",
                1,
            )
        )
        with self.assertRaises(subject.ContractError):
            subject.maker_record(self.repo, rows)

    def test_maker_result_raw_hash_is_recomputed(self) -> None:
        corrupted = replace(subject.MAKER_PIN, raw_sha256="0" * 64)
        with (
            patch.object(subject, "MAKER_PIN", corrupted),
            self.assertRaises(subject.ContractError),
        ):
            subject.maker_record(self.repo, subject.run_rows(self.run_md.read_bytes()))

    def test_accepted_volume_control_is_exact_invalid_test(self) -> None:
        record = subject.volume_record(
            self.repo,
            subject.run_rows(self.run_md.read_bytes()),
        )
        self.assertEqual(record["disposition"], "ACCEPTED_SOURCE_ONLY")
        self.assertEqual(record["n3Consumption"], "SOURCE_ONLY")
        self.assertEqual(record["normalizedVerdict"], "INVALID_TEST")
        self.assertEqual(record["rejection"]["code"], "INVALID_TEST")
        self.assertFalse(record["economicConsumable"])
        self.assertEqual(record["fees"]["accountEffectiveState"], "UNKNOWN")
        self.assertIsNone(record["fees"]["accountEffectiveValue"])
        self.assertEqual(record["capacity"]["executableState"], "UNKNOWN")
        self.assertIsNone(record["capacity"]["executableValue"])
        self.assertEqual(
            record["oos"]["state"],
            "FAILED_RETROSPECTIVE_OUTCOMES_PREVIOUSLY_OPENED",
        )
        self.assertEqual(record["pbo"]["state"], "NOT_ESTABLISHED")
        self.assertEqual(record["holdout"]["state"], "INVALIDATED_BEFORE_ECONOMICS")
        self.assertIsNone(record["credibility"]["verifiedPositive"])
        self.assertEqual(record["authority"], "NONE")
        self.assertTrue(record["resultPin"]["contentReadForNormalization"])
        self.assertFalse(record["resultPin"]["trustedForEconomics"])

    def test_volume_acceptance_row_mutation_is_rejected(self) -> None:
        raw = self.run_md.read_bytes()
        rows = subject.run_rows(
            raw.replace(
                b"terminal is INVALID_TEST/UNMEASURED",
                b"terminal is changed/UNMEASURED",
                1,
            )
        )
        with self.assertRaises(subject.ContractError):
            subject.volume_record(self.repo, rows)

    def test_volume_result_raw_hash_is_recomputed(self) -> None:
        corrupted = replace(subject.VOLUME_PIN, raw_sha256="0" * 64)
        with (
            patch.object(subject, "VOLUME_PIN", corrupted),
            self.assertRaises(subject.ContractError),
        ):
            subject.volume_record(self.repo, subject.run_rows(self.run_md.read_bytes()))

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

    def test_invalid_test_cannot_become_no_go_or_consumable(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            record = next(
                record for record in value["records"] if record["id"] == "VOLUME-ECONOMICS"
            )
            record["normalizedVerdict"] = "NO_GO"
            record["economicConsumable"] = True

        self.mutate_json(target, 2, mutate)
        self.assert_materialized_fails(target)

    def test_unknown_data_cannot_become_positive(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            record = next(
                record
                for record in value["records"]
                if record["id"] == "BASIS-MAKER-REAL-TIER-GRID"
            )
            record["credibility"]["verifiedPositive"] = True

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

    def test_control_terminal_cannot_disappear(self) -> None:
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

    def test_every_typed_object_schema_is_closed(self) -> None:
        def walk(value: Any) -> None:
            if isinstance(value, dict):
                if value.get("type") == "object":
                    self.assertIs(value.get("additionalProperties"), False)
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(self.expected[0])

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

    def test_second_existing_target_disposition_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        altered = Path(temporary.name) / "run.md"
        altered.write_bytes(
            raw
            + b"- item=`2026-07-30 ORCHESTRATOR S-1B SECOND ACCEPTANCE`"
            + b" | status=`ACCEPTED`\n"
        )
        with self.assertRaises(subject.ContractError):
            subject.build_documents(self.repo, altered)

    def test_terminal_or_verdict_existing_target_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        for suffix in ("TERMINAL", "VERDICT"):
            with self.subTest(suffix=suffix):
                temporary = tempfile.TemporaryDirectory()
                self.addCleanup(temporary.cleanup)
                altered = Path(temporary.name) / "run.md"
                altered.write_bytes(
                    raw
                    + (
                        f"- item=`2026-07-30 ORCHESTRATOR S-1B {suffix}` | status=`ACCEPTED`\n"
                    ).encode()
                )
                with self.assertRaises(subject.ContractError):
                    subject.build_documents(self.repo, altered)

    def test_unbound_control_terminal_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        altered = Path(temporary.name) / "run.md"
        altered.write_bytes(raw + b"- item=`2026-07-30 MAKER-FEE TERMINAL` | status=`PASS`\n")
        with self.assertRaises(subject.ContractError):
            subject.build_documents(self.repo, altered)

    def test_control_family_acceptance_lookalike_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        for suffix in ("NEW ACCEPTANCE", "NEW"):
            with self.subTest(suffix=suffix):
                temporary = tempfile.TemporaryDirectory()
                self.addCleanup(temporary.cleanup)
                altered = Path(temporary.name) / "run.md"
                altered.write_bytes(
                    raw
                    + (
                        f"- item=`2026-07-30 ORCHESTRATOR VOLUME-CORRECTION {suffix}`"
                        " | status=`ACCEPTED`\n"
                    ).encode()
                )
                with self.assertRaises(subject.ContractError):
                    subject.build_documents(self.repo, altered)

    def test_target_status_lookalike_requires_successor(self) -> None:
        raw = self.run_md.read_bytes()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        altered = Path(temporary.name) / "run.md"
        altered.write_bytes(
            raw + (b"- item=`2026-07-30 ORCHESTRATOR S-1B NEW` | status=`ACCEPTED`\n")
        )
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

    def test_result_content_read_scope_is_exact(self) -> None:
        registry = self.expected[2]
        pinned_records = {
            record["id"]: record["resultPin"]
            for record in registry["records"]
            if record["resultPin"]
        }
        self.assertTrue(pinned_records)
        self.assertEqual(
            {
                record_id
                for record_id, pin in pinned_records.items()
                if pin["contentReadForNormalization"]
            },
            {"BASIS-MAKER-REAL-TIER-GRID", "VOLUME-ECONOMICS"},
        )
        self.assertTrue(
            all(pin["rawSha256VerifiedThisTask"] is True for pin in pinned_records.values())
        )

    def test_strategy_renderer_is_deterministic_and_fable5_safe(self) -> None:
        first = subject.strategy_verdicts_bytes(self.expected[2])
        second = subject.strategy_verdicts_bytes(self.expected[2])
        self.assertEqual(first, second)
        self.assertTrue(first.endswith(b"\n"))
        self.assertNotIn(b"\r", first)
        self.assertNotIn(b"RUNNING", first)
        self.assertNotIn(b"PENDING", first)
        self.assertNotIn(subject.MAKER_PIN.commit.encode(), first)
        self.assertNotIn(subject.VOLUME_PIN.commit.encode(), first)
        self.assertIn(b"FINAL_PROFITABILITY", first)
        self.assertIn(b"FUTURE_S_DASH_DATA", first)
        self.assertIn(b"UNKNOWN_DATA", first)
        self.assertIn(b"INVALID_TEST", first)

    def test_strategy_renderer_rejects_record_consumer_divergence(self) -> None:
        registry = json.loads(json.dumps(self.expected[2]))
        registry["records"][0]["consumer"] = {
            "ids": ["FINAL_PROFITABILITY"],
            "state": "EXACT",
        }
        with self.assertRaises(subject.ContractError):
            subject.strategy_verdicts_bytes(registry)

    def test_preacceptance_freeze_changes_no_output(self) -> None:
        raw = self.run_md.read_bytes()
        acceptance_prefix = b"- item=`2026-07-30 ORCHESTRATOR VOLUME-CORRECTION ACCEPTANCE`"
        altered_raw = b"".join(
            row for row in raw.splitlines(keepends=True) if not row.startswith(acceptance_prefix)
        )
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        target = Path(temporary.name)
        for source in subject.paths(self.base_dir):
            shutil.copy2(source, target / source.name)
        altered = target / "run.md"
        altered.write_bytes(altered_raw)
        strategy = target / "STRATEGY_VERDICTS.md"
        strategy.write_bytes(b"old\n")
        before = {path.name: path.read_bytes() for path in (*subject.paths(target), strategy)}
        with self.assertRaises(subject.ContractError):
            subject.freeze(self.repo, altered, target, strategy)
        after = {path.name: path.read_bytes() for path in (*subject.paths(target), strategy)}
        self.assertEqual(before, after)

    def test_partial_replace_failure_rolls_back_every_output(self) -> None:
        temporary, target = self.copy_fixture()
        self.addCleanup(temporary.cleanup)
        strategy = target / "STRATEGY_VERDICTS.md"
        strategy.write_bytes(b"old strategy\n")
        tracked = (*subject.paths(target), strategy)
        before = {path.name: path.read_bytes() for path in tracked}
        real_replace = os.replace
        replace_calls = 0

        def fail_second_replace(source: Path | str, destination: Path | str) -> None:
            nonlocal replace_calls
            replace_calls += 1
            if replace_calls == 2:
                raise OSError("injected second replace failure")
            real_replace(source, destination)

        with (
            patch("verify.os.replace", side_effect=fail_second_replace),
            self.assertRaises(OSError),
        ):
            subject.freeze(self.repo, self.run_md, target, strategy)
        after = {path.name: path.read_bytes() for path in tracked}
        self.assertEqual(before, after)

    def test_verify_rejects_altered_strategy_card(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        strategy = Path(temporary.name) / "STRATEGY_VERDICTS.md"
        strategy.write_bytes(b"stale\n")
        with self.assertRaises(subject.ContractError):
            subject.verify(self.repo, self.run_md, self.base_dir, strategy)

    def test_cli_requires_strategy_card_for_verify(self) -> None:
        with self.assertRaises(SystemExit):
            subject.parser().parse_args(["verify"])


if __name__ == "__main__":
    unittest.main()
