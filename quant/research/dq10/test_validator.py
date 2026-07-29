#!/usr/bin/env python3
"""Focused hostile tests for the portable DQ-10 truth validator."""

# ruff: noqa: PT009, PT027

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from decimal import ROUND_DOWN, Decimal, Inexact, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, cast
from unittest import mock

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
HOSTILE = FIXTURES / "hostile"
POLICY_PATH = FIXTURES / "policy.json"
VALIDATOR_PATH = HERE / "validator.py"

SPEC = importlib.util.spec_from_file_location("dq10_validator_under_test", VALIDATOR_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load validator at {VALIDATOR_PATH}")
validator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = validator
SPEC.loader.exec_module(validator)

SEMANTIC_CASES = {
    case["name"]: case
    for case in json.loads((HOSTILE / "semantic_cases.json").read_text(encoding="utf-8"))
}


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def hostile_bytes(name: str) -> bytes:
    return (HOSTILE / name).read_bytes()


def policy_bytes() -> bytes:
    return POLICY_PATH.read_bytes()


def mutated_fixture_bytes(base: str, path: list[str], value: Any) -> bytes:
    document: Any = json.loads((FIXTURES / base).read_text(encoding="utf-8"))
    cursor = document
    for component in path[:-1]:
        cursor = cursor[component]
    cursor[path[-1]] = value
    return (
        json.dumps(
            document,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def semantic_case_bytes(name: str) -> bytes:
    case = SEMANTIC_CASES[name]
    return mutated_fixture_bytes(case["base"], case["path"], case["value"])


class ValidatorFunctionTests(unittest.TestCase):
    maxDiff = None

    def assert_rejected(
        self,
        raw: bytes,
        *,
        code: str,
        path: str,
    ) -> Any:
        with self.assertRaises(validator.ContractError) as caught:
            validator.validate_bytes(policy_bytes(), raw)
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(caught.exception.path, path)
        return caught.exception

    def assert_semantic_case(self, name: str) -> None:
        case = SEMANTIC_CASES[name]
        self.assert_rejected(
            semantic_case_bytes(name),
            code=case["expectedCode"],
            path=case["expectedPath"],
        )

    def test_valid_go(self) -> None:
        projection = validator.validate_bytes(policy_bytes(), fixture_bytes("valid_go.json"))
        self.assertEqual(projection.measurement_verdict, "GO")
        self.assertTrue(projection.credible_positive)

    def test_failed_optional_gate_does_not_block_go_or_join_credible_evidence(self) -> None:
        document = cast(dict[str, Any], json.loads(fixture_bytes("valid_go.json")))
        gates = cast(list[dict[str, Any]], document["gates"])
        optional = gates[1]
        credible = cast(dict[str, Any], document["crediblePositive"])
        self.assertFalse(optional["mandatory"])
        self.assertFalse(optional["passed"])
        self.assertNotIn("gate-optional", credible["evidenceIds"])
        projection = validator.validate_bytes(policy_bytes(), fixture_bytes("valid_go.json"))
        self.assertEqual(projection.measurement_verdict, "GO")
        self.assertTrue(projection.credible_positive)

    def test_valid_no_go_with_verified_zero(self) -> None:
        validator.validate_bytes(policy_bytes(), fixture_bytes("valid_no_go_verified_zero.json"))

    def test_valid_no_go_with_failed_mandatory_gate(self) -> None:
        validator.validate_bytes(policy_bytes(), fixture_bytes("valid_no_go_failed_gate.json"))

    def test_valid_no_go_with_nonpositive_lower_bound(self) -> None:
        validator.validate_bytes(
            policy_bytes(),
            fixture_bytes("valid_no_go_nonpositive_lower_bound.json"),
        )

    def test_valid_unmeasured(self) -> None:
        validator.validate_bytes(policy_bytes(), fixture_bytes("valid_unmeasured.json"))

    def test_valid_unmeasured_with_verified_zero_sample(self) -> None:
        validator.validate_bytes(
            policy_bytes(),
            fixture_bytes("valid_unmeasured_verified_zero_sample.json"),
        )

    def test_parse_document_preserves_verified_zero_lexeme(self) -> None:
        document = validator.parse_document(fixture_bytes("valid_no_go_verified_zero.json"))
        economics = document["economics"]
        self.assertIsInstance(economics, dict)
        estimate = economics["estimate"]
        self.assertIsInstance(estimate, dict)
        zero = estimate["value"]
        self.assertIsInstance(zero, validator.JsonNumber)
        self.assertEqual(zero.raw, "0")
        self.assertEqual(zero.decimal, Decimal("0"))
        self.assertTrue(zero.integer_lexeme)

    def test_validate_document_accepts_parsed_go(self) -> None:
        policy = validator.parse_policy_bytes(policy_bytes())
        validator.validate_document(
            validator.parse_document(fixture_bytes("valid_go.json")),
            policy,
        )

    def test_validate_bytes_rejects_oversize_input(self) -> None:
        self.assert_rejected(
            b" " * (validator.MAX_INPUT_BYTES + 1),
            code="INPUT_TOO_LARGE",
            path="$",
        )

    def test_duplicate_key(self) -> None:
        self.assert_rejected(
            hostile_bytes("duplicate_key.json"),
            code="JSON_DUPLICATE_KEY",
            path="$",
        )

    def test_nan(self) -> None:
        self.assert_rejected(
            hostile_bytes("nan.json"),
            code="JSON_NUMBER_NONFINITE",
            path="$",
        )

    def test_infinity(self) -> None:
        self.assert_rejected(
            hostile_bytes("infinity.json"),
            code="JSON_NUMBER_NONFINITE",
            path="$",
        )

    def test_negative_zero(self) -> None:
        self.assert_rejected(
            hostile_bytes("negative_zero.json"),
            code="JSON_NEGATIVE_ZERO",
            path="$",
        )

    def test_unsafe_integer(self) -> None:
        self.assert_rejected(
            hostile_bytes("unsafe_integer.json"),
            code="JSON_UNSAFE_INTEGER",
            path="$",
        )

    def test_closed_key_drift(self) -> None:
        self.assert_semantic_case("closed_key_drift")

    def test_closed_key_error_does_not_echo_object_names(self) -> None:
        document = cast(dict[str, Any], json.loads(fixture_bytes("valid_go.json")))
        hostile_name = "caller-controlled-object-name"
        document[hostile_name] = True
        raw = (json.dumps(document, separators=(",", ":"), sort_keys=True) + "\n").encode()
        error = self.assert_rejected(raw, code="KEY_SET_MISMATCH", path="$")
        self.assertEqual(error.detail, "object keys do not match the closed schema")
        self.assertNotIn(hostile_name, error.detail)

    def test_unknown_with_zero(self) -> None:
        self.assert_semantic_case("unknown_with_zero")

    def test_verified_with_null(self) -> None:
        self.assert_semantic_case("verified_with_null")

    def test_verified_without_evidence(self) -> None:
        self.assert_semantic_case("verified_without_evidence")

    def test_zero_sample_denominator_with_go(self) -> None:
        self.assert_semantic_case("zero_sample_denominator_with_go")

    def test_gate_summary_drift(self) -> None:
        self.assert_semantic_case("gate_summary_drift")

    def test_verdict_escalation(self) -> None:
        self.assert_semantic_case("verdict_escalation")

    def test_credible_positive_escalation(self) -> None:
        self.assert_semantic_case("credible_positive_escalation")

    def test_capital_verdict_escalation(self) -> None:
        self.assert_semantic_case("capital_verdict_escalation")

    def test_capital_authority_escalation(self) -> None:
        self.assert_semantic_case("capital_authority_escalation")

    def test_execution_authority_escalation(self) -> None:
        self.assert_semantic_case("execution_authority_escalation")

    def test_interval_contradiction(self) -> None:
        self.assert_semantic_case("interval_contradiction")

    def test_evidence_union_contradiction(self) -> None:
        self.assert_semantic_case("evidence_union_contradiction")

    def test_result_policy_digest_must_match_exact_policy_bytes(self) -> None:
        self.assert_rejected(
            mutated_fixture_bytes(
                "valid_go.json",
                ["policy", "sha256"],
                "0" * 64,
            ),
            code="POLICY_DIGEST_MISMATCH",
            path="$.policy.sha256",
        )

    def test_semantically_equal_policy_bytes_do_not_share_a_digest(self) -> None:
        with self.assertRaises(validator.ContractError) as caught:
            validator.validate_bytes(
                policy_bytes() + b" ",
                fixture_bytes("valid_go.json"),
            )
        self.assertEqual(caught.exception.code, "POLICY_DIGEST_MISMATCH")
        self.assertEqual(caught.exception.path, "$.policy.sha256")

    def test_result_unit_must_match_policy(self) -> None:
        self.assert_rejected(
            mutated_fixture_bytes(
                "valid_go.json",
                ["economics", "unit"],
                "P_VALUE",
            ),
            code="POLICY_ECONOMICS_UNIT_MISMATCH",
            path="$.economics.unit",
        )

    def test_result_gate_inventory_must_match_policy(self) -> None:
        gates = cast(
            list[dict[str, Any]],
            json.loads(fixture_bytes("valid_go.json"))["gates"],
        )
        gates[0]["id"] = "reported-only"
        self.assert_rejected(
            mutated_fixture_bytes("valid_go.json", ["gates"], gates),
            code="POLICY_GATE_INVENTORY_MISMATCH",
            path="$.gates",
        )

    def test_optional_gate_cannot_escalate_to_mandatory(self) -> None:
        document = cast(dict[str, Any], json.loads(fixture_bytes("valid_go.json")))
        gates = cast(list[dict[str, Any]], document["gates"])
        gates[1]["mandatory"] = True
        raw = (json.dumps(document, separators=(",", ":"), sort_keys=True) + "\n").encode()
        self.assert_rejected(
            raw,
            code="POLICY_GATE_CLASS_MISMATCH",
            path="$.gates[1].mandatory",
        )

    def test_result_policy_id_must_match_supplied_policy(self) -> None:
        self.assert_rejected(
            mutated_fixture_bytes(
                "valid_go.json",
                ["policy", "id"],
                "different-policy",
            ),
            code="POLICY_ID_MISMATCH",
            path="$.policy.id",
        )

    def test_capital_limitation_is_mandatory(self) -> None:
        self.assert_rejected(
            mutated_fixture_bytes(
                "valid_go.json",
                ["limitations"],
                ["UPSTREAM_REVIEW_REQUIRED"],
            ),
            code="CAPITAL_LIMITATION_REQUIRED",
            path="$.limitations",
        )

    def test_policy_rejects_non_economic_unit(self) -> None:
        policy_document = cast(dict[str, Any], json.loads(policy_bytes()))
        policy_document["economicsUnit"] = "P_VALUE"
        hostile_policy = (
            json.dumps(policy_document, separators=(",", ":"), sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(validator.ContractError) as caught:
            validator.validate_bytes(hostile_policy, fixture_bytes("valid_go.json"))
        self.assertEqual(caught.exception.code, "POLICY_ECONOMICS_UNIT_INVALID")
        self.assertEqual(caught.exception.path, "$policy.economicsUnit")

    def test_decimal_range_check_is_context_independent(self) -> None:
        raw = fixture_bytes("valid_go.json").replace(
            b'"value": 2',
            b'"value": 1.8e308',
            1,
        )
        with localcontext() as context:
            context.prec = 1
            context.rounding = ROUND_DOWN
            self.assert_rejected(
                raw,
                code="JSON_NUMBER_RANGE",
                path="$",
            )

    def test_decimal_validation_does_not_signal_ambient_context(self) -> None:
        document = cast(dict[str, Any], json.loads(fixture_bytes("valid_go.json")))
        economics = cast(dict[str, Any], document["economics"])
        cast(dict[str, Any], economics["estimate"])["value"] = 1.2
        cast(dict[str, Any], economics["lowerBound"])["value"] = 1.1
        cast(dict[str, Any], economics["upperBound"])["value"] = 1.3
        raw = (json.dumps(document, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
        with localcontext() as context:
            context.prec = 1
            context.traps[Inexact] = True
            context.clear_flags()
            validator.validate_bytes(policy_bytes(), raw)
            self.assertFalse(any(context.flags.values()))

    def test_extreme_exponent_is_context_independent_and_does_not_signal(self) -> None:
        raw = fixture_bytes("valid_go.json").replace(
            b'"value": 2',
            b'"value": 1e9999999999999999999',
            1,
        )
        codes: list[str] = []
        for trapped in (False, True):
            with localcontext() as context:
                context.traps[InvalidOperation] = trapped
                context.clear_flags()
                with self.assertRaises(validator.ContractError) as caught:
                    validator.validate_bytes(policy_bytes(), raw)
                codes.append(caught.exception.code)
                self.assertFalse(any(context.flags.values()))
        self.assertEqual(codes, ["JSON_NUMBER_RANGE", "JSON_NUMBER_RANGE"])

    def test_zero_with_extreme_exponent_remains_portable_verified_zero(self) -> None:
        document = validator.parse_document(b'{"value":0e9999999999999999999}')
        value = document["value"]
        self.assertIsInstance(value, validator.JsonNumber)
        self.assertEqual(value.raw, "0e9999999999999999999")
        self.assertEqual(value.decimal, Decimal(0))

    def test_pure_python_decimal_fallback_has_the_same_extreme_outcomes(self) -> None:
        script = """
import importlib
import importlib.util
import sys

sys.modules["decimal"] = importlib.import_module("_pydecimal")
spec = importlib.util.spec_from_file_location("dq10_pure_decimal", sys.argv[1])
if spec is None or spec.loader is None:
    raise RuntimeError("validator module could not be loaded")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
try:
    module.parse_document(b'{"value":1e9999999999999999999}')
except module.ContractError as error:
    print(error.code)
else:
    raise RuntimeError("extreme nonzero exponent was accepted")
document = module.parse_document(b'{"value":0e9999999999999999999}')
print(document["value"].decimal)
"""
        completed = subprocess.run(
            [sys.executable, "-c", script, str(VALIDATOR_PATH)],
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, b"JSON_NUMBER_RANGE\n0\n")

    def test_file_reader_rejects_path_replacement_during_read(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "result.json"
            replacement = Path(temporary) / "replacement.json"
            path.write_bytes(fixture_bytes("valid_go.json"))
            replacement.write_bytes(
                mutated_fixture_bytes(
                    "valid_go.json",
                    ["capitalAuthority"],
                    "LIVE",
                )
            )
            real_read = os.read
            replaced = False

            def replacing_read(descriptor: int, size: int) -> bytes:
                nonlocal replaced
                chunk = real_read(descriptor, size)
                if not replaced:
                    os.replace(replacement, path)
                    replaced = True
                return chunk

            with (
                mock.patch.object(validator.os, "read", side_effect=replacing_read),
                self.assertRaises(validator.ContractError) as caught,
            ):
                validator._read_regular_file(str(path))
        self.assertEqual(caught.exception.code, "INPUT_CHANGED")

    def test_file_reader_rejects_same_inode_rewrite_with_restored_mtime(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "result.json"
            original = fixture_bytes("valid_go.json")
            replacement = original.replace(b'"value": 2', b'"value": 9', 1)
            self.assertEqual(len(original), len(replacement))
            path.write_bytes(original)
            initial = path.stat()
            real_read = os.read
            rewritten = False

            def rewriting_read(descriptor: int, size: int) -> bytes:
                nonlocal rewritten
                chunk = real_read(descriptor, size)
                if not rewritten:
                    path.write_bytes(replacement)
                    os.utime(
                        path,
                        ns=(initial.st_atime_ns, initial.st_mtime_ns),
                    )
                    rewritten = True
                return chunk

            with (
                mock.patch.object(validator.os, "read", side_effect=rewriting_read),
                self.assertRaises(validator.ContractError) as caught,
            ):
                validator._read_regular_file(str(path))
        self.assertEqual(caught.exception.code, "INPUT_CHANGED")

    def test_unavailable_stdin_is_a_contract_error(self) -> None:
        with (
            mock.patch.object(validator.sys, "stdin", None),
            self.assertRaises(validator.ContractError) as caught,
        ):
            validator._read_stdin()
        self.assertEqual(caught.exception.code, "INPUT_READ_FAILED")
        self.assertEqual(caught.exception.path, "$")


class ValidatorCliTests(unittest.TestCase):
    maxDiff = None

    def run_cli(
        self,
        *arguments: str,
        input_bytes: bytes | None = None,
        timeout: float = 10,
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [sys.executable, str(VALIDATOR_PATH), *arguments],
            capture_output=True,
            check=False,
            input=input_bytes,
            timeout=timeout,
        )

    def assert_error_report(
        self,
        completed: subprocess.CompletedProcess[bytes],
        *,
        code: str,
        path: str,
    ) -> dict[str, Any]:
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stderr, b"")
        report = cast(dict[str, Any], json.loads(completed.stdout))
        self.assertEqual(report["schema"], validator.REPORT_SCHEMA)
        self.assertFalse(report["valid"])
        self.assertEqual(len(report["errors"]), 1)
        self.assertEqual(report["errors"][0]["code"], code)
        self.assertEqual(report["errors"][0]["path"], path)
        self.assertTrue(completed.stdout.endswith(b"\n"))
        return report

    def test_cli_valid_file_exit_and_report(self) -> None:
        raw = fixture_bytes("valid_go.json")
        completed = self.run_cli(str(POLICY_PATH), str(FIXTURES / "valid_go.json"))
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        report = cast(dict[str, Any], json.loads(completed.stdout))
        self.assertEqual(
            report,
            {
                "errors": [],
                "inputSha256": hashlib.sha256(raw).hexdigest(),
                "policySha256": hashlib.sha256(policy_bytes()).hexdigest(),
                "result": {
                    "capitalAuthority": "NONE",
                    "capitalVerdict": "NO_GO",
                    "crediblePositive": True,
                    "executionAuthority": "NONE",
                    "measurementVerdict": "GO",
                    "policyId": "dq10-policy-v1",
                    "resultId": "go-fixture",
                },
                "schema": validator.REPORT_SCHEMA,
                "valid": True,
            },
        )
        canonical = (json.dumps(report, separators=(",", ":"), sort_keys=True) + "\n").encode(
            "utf-8"
        )
        self.assertEqual(completed.stdout, canonical)

    def test_cli_invalid_file_exit_and_report(self) -> None:
        completed = self.run_cli(
            str(POLICY_PATH),
            str(HOSTILE / "duplicate_key.json"),
        )
        report = self.assert_error_report(
            completed,
            code="JSON_DUPLICATE_KEY",
            path="$",
        )
        self.assertIsNone(report["result"])
        self.assertEqual(report["policySha256"], hashlib.sha256(policy_bytes()).hexdigest())
        self.assertEqual(
            report["inputSha256"],
            hashlib.sha256(hostile_bytes("duplicate_key.json")).hexdigest(),
        )
        self.assertEqual(
            report["errors"][0]["message"],
            "object names must be unique",
        )

    def test_cli_invalid_report_is_deterministic(self) -> None:
        path = str(HOSTILE / "duplicate_key.json")
        first = self.run_cli(str(POLICY_PATH), path)
        second = self.run_cli(str(POLICY_PATH), path)
        self.assertEqual(first.returncode, second.returncode)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(first.stderr, second.stderr)

    def test_cli_reports_bind_distinct_verdict_inputs(self) -> None:
        reports: list[dict[str, Any]] = []
        for name in (
            "valid_go.json",
            "valid_no_go_verified_zero.json",
            "valid_unmeasured.json",
        ):
            completed = self.run_cli(str(POLICY_PATH), str(FIXTURES / name))
            self.assertEqual(completed.returncode, 0)
            reports.append(cast(dict[str, Any], json.loads(completed.stdout)))
        self.assertEqual(
            [report["result"]["measurementVerdict"] for report in reports],
            ["GO", "NO_GO", "UNMEASURED"],
        )
        self.assertEqual(len({report["inputSha256"] for report in reports}), 3)

    def test_cli_valid_stdin(self) -> None:
        completed = self.run_cli(
            str(POLICY_PATH),
            "-",
            input_bytes=fixture_bytes("valid_no_go_verified_zero.json"),
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        report = cast(dict[str, Any], json.loads(completed.stdout))
        self.assertTrue(report["valid"])
        self.assertEqual(report["result"]["measurementVerdict"], "NO_GO")
        self.assertFalse(report["result"]["crediblePositive"])

    def test_cli_invalid_stdin(self) -> None:
        completed = self.run_cli(
            str(POLICY_PATH),
            "-",
            input_bytes=hostile_bytes("nan.json"),
        )
        self.assert_error_report(
            completed,
            code="JSON_NUMBER_NONFINITE",
            path="$",
        )

    def test_cli_duplicate_name_report_is_bounded(self) -> None:
        key = b"a" * 400_000
        raw = b'{"' + key + b'":1,"' + key + b'":2}'
        self.assertLess(len(raw), validator.MAX_INPUT_BYTES)
        completed = self.run_cli(str(POLICY_PATH), "-", input_bytes=raw)
        report = self.assert_error_report(
            completed,
            code="JSON_DUPLICATE_KEY",
            path="$",
        )
        self.assertEqual(report["errors"][0]["message"], "object names must be unique")
        self.assertLess(len(completed.stdout), 2_048)

    def test_cli_nested_long_names_cannot_amplify_error_report(self) -> None:
        value: Any = "x" * (validator.MAX_STRING_BYTES + 1)
        hostile_name = "k" * validator.MAX_STRING_BYTES
        for _ in range(31):
            value = {hostile_name: value}
        raw = json.dumps(value, separators=(",", ":")).encode()
        self.assertLess(len(raw), validator.MAX_INPUT_BYTES)
        completed = self.run_cli(str(POLICY_PATH), "-", input_bytes=raw)
        report = self.assert_error_report(
            completed,
            code="JSON_STRING_TOO_LONG",
            path="$<path-truncated>",
        )
        self.assertLessEqual(
            len(report["errors"][0]["path"]),
            validator.MAX_ERROR_PATH_CHARS,
        )
        self.assertNotIn(hostile_name, completed.stdout.decode())
        self.assertLess(len(completed.stdout), 2_048)

    def test_main_fails_closed_when_stdout_is_unwritable(self) -> None:
        broken = mock.Mock()
        broken.buffer.write.side_effect = BrokenPipeError
        with mock.patch.object(validator.sys, "stdout", broken):
            status = validator.main(
                [
                    str(POLICY_PATH),
                    str(FIXTURES / "valid_go.json"),
                ]
            )
        self.assertEqual(status, 1)

    def test_main_completes_short_stdout_writes_before_returning_green(self) -> None:
        sink = bytearray()

        def short_write(raw: bytes) -> int:
            sink.extend(raw[:1])
            return 1

        stream = mock.Mock()
        stream.buffer.write.side_effect = short_write
        with mock.patch.object(validator.sys, "stdout", stream):
            status = validator.main(
                [
                    str(POLICY_PATH),
                    str(FIXTURES / "valid_go.json"),
                ]
            )
        self.assertEqual(status, 0)
        self.assertTrue(cast(dict[str, Any], json.loads(sink))["valid"])
        stream.buffer.flush.assert_called_once_with()

    def test_main_fails_closed_when_stdout_write_makes_no_progress(self) -> None:
        for results in ([0], [None], [1, None]):
            with self.subTest(results=results):
                stream = mock.Mock()
                stream.buffer.write.side_effect = results
                with mock.patch.object(validator.sys, "stdout", stream):
                    status = validator.main(
                        [
                            str(POLICY_PATH),
                            str(FIXTURES / "valid_go.json"),
                        ]
                    )
                self.assertEqual(status, 1)

    def test_main_usage_has_no_traceback_when_stderr_is_unavailable(self) -> None:
        with mock.patch.object(validator.sys, "stderr", None):
            status = validator.main([])
        self.assertEqual(status, 2)

    def test_cli_missing_argument_is_usage_error(self) -> None:
        completed = self.run_cli()
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, validator._usage())

    def test_cli_help_is_success(self) -> None:
        completed = self.run_cli("--help")
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, validator._usage())
        self.assertEqual(completed.stderr, b"")

    def test_cli_help_with_extra_argument_is_usage_error(self) -> None:
        completed = self.run_cli("--help", "unexpected")
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, validator._usage())

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink is unavailable")
    def test_cli_rejects_symlink_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            link = Path(temporary) / "result.json"
            try:
                os.symlink(FIXTURES / "valid_go.json", link)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"symlink unavailable: {error}")
            completed = self.run_cli(str(POLICY_PATH), str(link))
        self.assert_error_report(
            completed,
            code="INPUT_NOT_REGULAR",
            path="$",
        )

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO is unavailable")
    def test_cli_rejects_fifo_without_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fifo = Path(temporary) / "result.pipe"
            os.mkfifo(fifo)
            completed = self.run_cli(str(POLICY_PATH), str(fifo), timeout=5)
        self.assert_error_report(
            completed,
            code="INPUT_NOT_REGULAR",
            path="$",
        )

    def test_cli_rejects_oversize_file_before_read(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "oversize.json"
            path.write_bytes(b" " * (validator.MAX_INPUT_BYTES + 1))
            completed = self.run_cli(str(POLICY_PATH), str(path))
        self.assert_error_report(
            completed,
            code="INPUT_TOO_LARGE",
            path="$",
        )

    def test_cli_accepts_exact_size_boundary(self) -> None:
        raw = fixture_bytes("valid_go.json")
        self.assertLess(len(raw), validator.MAX_INPUT_BYTES)
        bounded = raw + (b" " * (validator.MAX_INPUT_BYTES - len(raw)))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "bounded.json"
            path.write_bytes(bounded)
            completed = self.run_cli(str(POLICY_PATH), str(path))
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        report = cast(dict[str, Any], json.loads(completed.stdout))
        self.assertTrue(report["valid"])
        self.assertEqual(report["inputSha256"], hashlib.sha256(bounded).hexdigest())

    def test_cli_rejects_oversize_stdin(self) -> None:
        completed = self.run_cli(
            str(POLICY_PATH),
            "-",
            input_bytes=b" " * (validator.MAX_INPUT_BYTES + 1),
        )
        self.assert_error_report(
            completed,
            code="INPUT_TOO_LARGE",
            path="$",
        )


if __name__ == "__main__":
    unittest.main()
