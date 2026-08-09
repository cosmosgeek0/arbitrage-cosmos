from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

from research.dq13 import CausalReceiptV1, validate_causal_asof_mapping_v1
from research.dq13.fixture_support import load_fixture_cases_v1

PROOF_SCHEMA_V1 = "cosmos.dq13.causal-asof-proof.v1"
POLICY_SCHEMA_V1 = "cosmos.dq13.causal-asof-policy.v1"
CANONICAL_BASE = "a169b123fb186d1943a75ad648552c4d95be1be1"

_DQ13_DIR = Path(__file__).resolve().parent
_QUANT_DIR = _DQ13_DIR.parents[1]
_ARTIFACTS = (
    "research/dq13/README.md",
    "research/dq13/REFERENCES.md",
    "research/dq13/__init__.py",
    "research/dq13/__main__.py",
    "research/dq13/fixture_support.py",
    "research/dq13/fixtures/cases.v1.json",
    "research/dq13/policy.v1.json",
    "research/dq13/pytest-proof.ini",
    "research/dq13/test_validator.py",
    "research/dq13/validator.py",
    "research/dq13/verify.py",
    "uv.lock",
)
_FOCUSED_TEST_ARGS = (
    "-B",
    "-m",
    "pytest",
    "-c",
    "research/dq13/pytest-proof.ini",
    "--noconftest",
    "-s",
    "-q",
    "-p",
    "no:cacheprovider",
    "-p",
    "research.dq13.verify",
    "research/dq13/test_validator.py",
)
_FOCUSED_TEST_SENTINEL = "DQ13_FOCUSED_TEST_SENTINEL"
_FOCUSED_TEST_REPORTS: list[tuple[str, str]] = []


def pytest_sessionstart(session: object) -> None:
    """Reset deterministic proof-plugin state at the exact pytest session boundary."""

    del session
    _FOCUSED_TEST_REPORTS.clear()


def pytest_runtest_logreport(report: object) -> None:
    """Record actual call-phase outcomes; collection or setup alone never counts."""

    when = getattr(report, "when", None)
    nodeid = getattr(report, "nodeid", None)
    outcome = getattr(report, "outcome", None)
    if when == "call" and isinstance(nodeid, str) and isinstance(outcome, str):
        _FOCUSED_TEST_REPORTS.append((nodeid, outcome))


def pytest_sessionfinish(session: object, exitstatus: object) -> None:
    """Emit one deterministic sentinel consumed by the parent verifier."""

    del session, exitstatus
    reports = sorted(_FOCUSED_TEST_REPORTS)
    payload = "".join(f"{nodeid}\0{outcome}\n" for nodeid, outcome in reports).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    passed = sum(outcome == "passed" for _, outcome in reports)
    print(f"\n{_FOCUSED_TEST_SENTINEL} {len(reports)} {passed} {digest}")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _nonvalid_selection_projection(receipt: CausalReceiptV1) -> list[dict[str, object]]:
    return [
        {
            "keyId": selection.key_id,
            "reasonCodes": list(selection.reason_codes),
            "status": selection.status.value,
        }
        for selection in receipt.selections
        if selection.status.value != "VALID"
    ]


def _availability_evidence_projection(receipt: CausalReceiptV1) -> dict[str, list[str]]:
    return {
        selection.key_id: [
            selection.availability_evidence_id,
            selection.availability_evidence_digest,
        ]
        for selection in receipt.selections
        if selection.availability_evidence_id is not None
        and selection.availability_evidence_digest is not None
    }


def _focused_test_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("PYTEST_ADDOPTS", None)
    environment.pop("PYTEST_PLUGINS", None)
    environment["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    environment["PYTHONHASHSEED"] = "0"
    environment["PYTHONPATH"] = os.pathsep.join(("src", "."))
    return environment


def _parse_focused_test_sentinel(output: bytes) -> tuple[int, str]:
    try:
        lines = output.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as error:
        raise RuntimeError("FOCUSED_TEST_SENTINEL_INVALID") from error
    sentinels = [line for line in lines if line.startswith(f"{_FOCUSED_TEST_SENTINEL} ")]
    if len(sentinels) != 1:
        raise RuntimeError("FOCUSED_TEST_SENTINEL_INVALID")
    fields = sentinels[0].split()
    if len(fields) != 4:
        raise RuntimeError("FOCUSED_TEST_SENTINEL_INVALID")
    try:
        executed = int(fields[1])
        passed = int(fields[2])
    except ValueError as error:
        raise RuntimeError("FOCUSED_TEST_SENTINEL_INVALID") from error
    digest = fields[3]
    if (
        executed <= 0
        or passed != executed
        or len(digest) != 64
        or any(character not in "0123456789abcdef" for character in digest)
    ):
        raise RuntimeError("FOCUSED_TEST_SENTINEL_INVALID")
    return (executed, digest)


def _focused_test_evidence() -> dict[str, object]:
    try:
        completed = subprocess.run(
            (sys.executable, *_FOCUSED_TEST_ARGS),
            cwd=_QUANT_DIR,
            env=_focused_test_environment(),
            check=False,
            capture_output=True,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("FOCUSED_TEST_EXECUTION_FAILED") from error
    if completed.returncode != 0:
        raise RuntimeError("FOCUSED_TEST_FAILED")
    executed, outcome_digest = _parse_focused_test_sentinel(completed.stdout)
    return {
        "command": ["python", *_FOCUSED_TEST_ARGS],
        "conftestLoading": False,
        "executedTestCount": executed,
        "externalAddopts": False,
        "externalPlugins": False,
        "nodeIdOutcomeSha256": outcome_digest,
        "pluginAutoload": False,
        "result": "PASS",
        "testFileSha256": _sha256(_DQ13_DIR / "test_validator.py"),
    }


def proof_projection_v1() -> dict[str, object]:
    focused_test = _focused_test_evidence()
    cases: list[dict[str, object]] = []
    receipts: dict[str, CausalReceiptV1] = {}
    fixture_cases = load_fixture_cases_v1()
    for case in fixture_cases:
        first = validate_causal_asof_mapping_v1(case.frame)
        second = validate_causal_asof_mapping_v1(case.frame)
        if first != second or first.canonical_bytes() != second.canonical_bytes():
            raise RuntimeError("NONDETERMINISTIC_FIXTURE")
        if first.status is not case.expected_status:
            raise RuntimeError("FIXTURE_STATUS_MISMATCH")
        if first.reason_codes != case.expected_reasons:
            raise RuntimeError("FIXTURE_REASON_MISMATCH")
        receipts[case.case_id] = first
        cases.append(
            {
                "availabilityEvidence": _availability_evidence_projection(first),
                "caseId": case.case_id,
                "nonvalidSelections": _nonvalid_selection_projection(first),
                "reasonCodes": list(first.reason_codes),
                "receiptDigest": first.receipt_digest,
                "selectedRecordIds": {
                    selection.key_id: list(selection.selected_record_ids)
                    for selection in first.selections
                    if selection.selected_record_ids
                },
                "status": first.status.value,
            }
        )
    for case in fixture_cases:
        if (
            case.digest_equals_case is not None
            and receipts[case.case_id].receipt_digest
            != receipts[case.digest_equals_case].receipt_digest
        ):
            raise RuntimeError("FIXTURE_EQUIVALENCE_MISMATCH")
    valid = receipts["valid-all-feeds"]
    return {
        "artifactSha256": {relative: _sha256(_QUANT_DIR / relative) for relative in _ARTIFACTS},
        "authority": "NONE",
        "canonicalBase": CANONICAL_BASE,
        "caseCount": len(cases),
        "cases": cases,
        "consumerScope": ["FUTURE_S1_VG", "N3_FINAL_CONVERGENCE"],
        "fixtureSchema": "cosmos.dq13.hostile-fixtures.v1",
        "focusedTest": focused_test,
        "historicalReclassification": False,
        "policySchema": POLICY_SCHEMA_V1,
        "schema": PROOF_SCHEMA_V1,
        "validReceipt": valid.as_dict(),
    }


def _pretty_bytes(value: object) -> bytes:
    return f"{json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)}\n".encode()


def main() -> int:
    expected_path = _DQ13_DIR / "proof.v1.json"
    try:
        expected_bytes = expected_path.read_bytes()
        expected = cast(object, json.loads(expected_bytes))
        actual = proof_projection_v1()
        actual_bytes = _pretty_bytes(actual)
    except (IndexError, KeyError, OSError, RuntimeError, TypeError, ValueError):
        print("DQ13_PROOF_INVALID")
        return 1
    if expected != actual or expected_bytes != actual_bytes:
        print("DQ13_PROOF_MISMATCH")
        return 1
    digest = hashlib.sha256(actual_bytes).hexdigest()
    print(f"DQ13_PROOF_PASS {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = (
    "CANONICAL_BASE",
    "POLICY_SCHEMA_V1",
    "PROOF_SCHEMA_V1",
    "main",
    "proof_projection_v1",
)
