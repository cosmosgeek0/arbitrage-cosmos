#!/usr/bin/env python3
"""Independent, network-free verifier for the sealed S-1R packet."""

from __future__ import annotations

import ast
import hashlib
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_SCHEMAS = {
    "freeze.v1.json": "cosmos.quant.research.s1r.freeze.v1",
    "run_consumed.v1.json": "cosmos.quant.research.s1r.run_consumed.v1",
    "development.v1.json": "cosmos.quant.research.s1r.development.v1",
    "result.v1.json": "cosmos.quant.research.s1r.result.v1",
}
REQUIRED_FREEZE_BINDINGS = {
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "experiment.py",
    "protocol.v1.json",
    "source_manifest.v1.json",
    "test_experiment.py",
    "test_verifier.py",
    "verifier.py",
}
EXPECTED_DISCOVERY_SHA256 = "5fd5924a63fd31c08378002e3d508d6de5d895383c3322ce3cd82caad35b1c0f"


class VerificationError(RuntimeError):
    """Packet authentication failure."""


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise VerificationError(f"FILE_READ_FAILED:{path}:{exc}") from exc
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise VerificationError(f"JSON_READ_FAILED:{path}:{exc}") from exc


def verify_signed_document(path: Path, schema: str) -> dict[str, Any]:
    raw = load_json(path)
    if not isinstance(raw, dict) or raw.get("schema") != schema:
        raise VerificationError(f"SCHEMA_INVALID:{path.name}")
    digest = raw.get("artifactSha256")
    if not isinstance(digest, str):
        raise VerificationError(f"DIGEST_MISSING:{path.name}")
    unsigned = dict(raw)
    del unsigned["artifactSha256"]
    actual = hashlib.sha256(canonical_bytes(unsigned)).hexdigest()
    if actual != digest:
        raise VerificationError(f"DIGEST_INVALID:{path.name}")
    return dict(raw)


def ensure_network_free(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    forbidden = {
        "aiohttp",
        "http",
        "requests",
        "socket",
        "subprocess",
        "urllib",
    }
    if forbidden & imported:
        raise VerificationError("NETWORK_OR_PROCESS_IMPORT_PRESENT")


def validate_freeze_header_and_bindings(freeze: Mapping[str, Any]) -> Mapping[str, Any]:
    if freeze.get("baseCommit") != BASE_COMMIT:
        raise VerificationError("FREEZE_BASE_INVALID")
    if freeze.get("status") != "SEALED_DEVELOPMENT_AND_HOLDOUT_MEMBERS_CLOSED":
        raise VerificationError("FREEZE_STATUS_INVALID")
    if freeze.get("archiveMemberOpenCount") != 0:
        raise VerificationError("FREEZE_OPEN_COUNT_INVALID")
    if freeze.get("holdoutState") != "CLOSED_UNREAD":
        raise VerificationError("FREEZE_HOLDOUT_STATE_INVALID")
    bindings = freeze.get("bindings")
    if not isinstance(bindings, dict) or set(bindings) != REQUIRED_FREEZE_BINDINGS:
        raise VerificationError("FREEZE_BINDING_SET_INVALID")
    return bindings


def validate_semantics(
    protocol: Mapping[str, Any],
    development: Mapping[str, Any] | None,
    result: Mapping[str, Any],
    *,
    champion_present: bool,
    holdout_open_present: bool,
    holdout: Mapping[str, Any] | None,
) -> None:
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise VerificationError("PROTOCOL_BASE_INVALID")
    if protocol.get("authority") != "NONE":
        raise VerificationError("PROTOCOL_AUTHORITY_INVALID")
    distinctness = protocol.get("distinctness")
    if not isinstance(distinctness, dict):
        raise VerificationError("DISTINCTNESS_MISSING")
    forbidden = set(distinctness.get("forbiddenSignalInputs", []))
    required_forbidden = {
        "SIGN_CHANGE_OR_SIGN_FLIP",
        "CUMULATIVE_FUNDING_OR_PERSISTENCE",
        "FUNDING_FORECAST_OR_FUTURE_FUNDING",
        "FIRST_OR_SECOND_DIFFERENCE_ACCELERATION_OR_VELOCITY",
    }
    if not required_forbidden.issubset(forbidden):
        raise VerificationError("DISTINCTNESS_FORBIDDANCE_INCOMPLETE")
    required = set(distinctness.get("required", []))
    if {
        "CURRENT_SETTLEMENT_EXCLUDED_FROM_PRIOR_ROBUST_BASELINE",
        "EVENT_FUNDING_NOT_BOOKED_AND_EXIT_STRICTLY_BEFORE_ANY_LATER_SETTLEMENT",
    } - required:
        raise VerificationError("DISTINCTNESS_REQUIRED_INCOMPLETE")
    if result.get("capitalAuthority") != "NO_GO":
        raise VerificationError("CAPITAL_AUTHORITY_INVALID")
    if result.get("executionAuthority") != "NONE":
        raise VerificationError("EXECUTION_AUTHORITY_INVALID")
    if result.get("positiveEdgeClaim") is not False:
        raise VerificationError("POSITIVE_EDGE_CLAIM_INVALID")
    external = result.get("externalTruth")
    if not isinstance(external, dict):
        raise VerificationError("EXTERNAL_TRUTH_INVALID")
    if external.get("historicalFundingPublicationLatency") != "UNMEASURED":
        raise VerificationError("PUBLICATION_LATENCY_OVERCLAIM")
    if external.get("historicalArchiveFundingRateType") != "UNAVAILABLE":
        raise VerificationError("FUNDING_RATE_TYPE_OVERCLAIM")
    if external.get("accountEffectiveFees") != "UNKNOWN":
        raise VerificationError("ACCOUNT_FEE_OVERCLAIM")
    if external.get("executableCapacity") != "UNMEASURED":
        raise VerificationError("CAPACITY_OVERCLAIM")
    effects = result.get("effects")
    if not isinstance(effects, dict) or effects.get("moneyUsd") != "0":
        raise VerificationError("EFFECTS_INVALID")
    verdict = result.get("strategyVerdict")
    if verdict not in {"NO_GO", "UNMEASURED"}:
        raise VerificationError("VERDICT_INVALID")
    terminal_error = result.get("terminalError")
    if development is None:
        if (
            verdict != "UNMEASURED"
            or not isinstance(terminal_error, dict)
            or result.get("holdoutState") != "UNOPENED"
            or champion_present
            or holdout_open_present
            or holdout is not None
        ):
            raise VerificationError("PRE_DEVELOPMENT_TERMINAL_STATE_INVALID")
        return
    trials = development.get("trials")
    if not isinstance(trials, list) or len(trials) != 12:
        raise VerificationError("DEVELOPMENT_TRIAL_COUNT_INVALID")
    if development.get("trialCount") != 12:
        raise VerificationError("DEVELOPMENT_FAMILY_SIZE_INVALID")
    checks = development.get("championChecks")
    if not isinstance(checks, dict) or not checks:
        raise VerificationError("DEVELOPMENT_CHECKS_INVALID")
    if development.get("admitted") is not all(value is True for value in checks.values()):
        raise VerificationError("DEVELOPMENT_ADMISSION_MISMATCH")
    pbo = development.get("pbo")
    if not isinstance(pbo, dict) or pbo.get("splits") != 924:
        raise VerificationError("PBO_INVALID")
    if pbo.get("authority") != "DIAGNOSTIC_ONLY":
        raise VerificationError("PBO_AUTHORITY_INVALID")
    champion_id = development.get("championTrialId")
    if champion_id not in {row.get("trialId") for row in trials if isinstance(row, dict)}:
        raise VerificationError("CHAMPION_NOT_IN_FAMILY")
    for trial in trials:
        if not isinstance(trial, dict) or trial.get("fundingCashflowUsd") != "0":
            raise VerificationError("NONZERO_OR_MISSING_FUNDING_CASHFLOW")
        trades = trial.get("trades")
        if not isinstance(trades, list):
            raise VerificationError("TRADE_LEDGER_INVALID")
        if any(
            not isinstance(trade, dict) or trade.get("fundingCashflowUsd") != "0"
            for trade in trades
        ):
            raise VerificationError("TRADE_FUNDING_CASHFLOW_INVALID")
    if isinstance(terminal_error, dict):
        if verdict != "UNMEASURED":
            raise VerificationError("TERMINAL_ERROR_VERDICT_INVALID")
        return
    if development.get("admitted") is False:
        if verdict != "NO_GO" or result.get("holdoutState") != "UNOPENED":
            raise VerificationError("DEVELOPMENT_FAILURE_VERDICT_INVALID")
        if champion_present or holdout_open_present or holdout is not None:
            raise VerificationError("HOLDOUT_OPENED_AFTER_DEVELOPMENT_FAILURE")
    else:
        if not champion_present or not holdout_open_present or holdout is None:
            raise VerificationError("ADMITTED_DEVELOPMENT_WITHOUT_HOLDOUT")
        holdout_checks = holdout.get("checks")
        if not isinstance(holdout_checks, dict) or not holdout_checks:
            raise VerificationError("HOLDOUT_CHECKS_INVALID")
        if holdout.get("admitted") is not all(value is True for value in holdout_checks.values()):
            raise VerificationError("HOLDOUT_ADMISSION_MISMATCH")
        expected_verdict = "UNMEASURED" if holdout.get("admitted") is True else "NO_GO"
        if verdict != expected_verdict:
            raise VerificationError("HOLDOUT_VERDICT_MISMATCH")


def verify_packet(packet_dir: Path) -> dict[str, Any]:
    packet = packet_dir.resolve()
    protocol_raw = load_json(packet / "protocol.v1.json")
    if not isinstance(protocol_raw, dict):
        raise VerificationError("PROTOCOL_INVALID")
    protocol = dict(protocol_raw)
    freeze = verify_signed_document(packet / "freeze.v1.json", EXPECTED_SCHEMAS["freeze.v1.json"])
    bindings = validate_freeze_header_and_bindings(freeze)
    for name, expected in bindings.items():
        path = packet / str(name)
        if sha256_file(path) != str(expected):
            raise VerificationError(f"FREEZE_BINDING_DRIFT:{name}")
    manifest = verify_signed_document(
        packet / "source_manifest.v1.json",
        "cosmos.quant.research.s1r.source_manifest.v1",
    )
    if (
        manifest.get("discoverySha256") != EXPECTED_DISCOVERY_SHA256
        or manifest.get("zipMembersOpened") is not False
        or manifest.get("entryCount") != 96
    ):
        raise VerificationError("SOURCE_MANIFEST_INVALID")
    run = verify_signed_document(
        packet / "run_consumed.v1.json",
        EXPECTED_SCHEMAS["run_consumed.v1.json"],
    )
    if run.get("freezeFileSha256") != sha256_file(packet / "freeze.v1.json"):
        raise VerificationError("RUN_FREEZE_LINK_INVALID")
    if run.get("allowedRunCount") != 1 or run.get("currentRun") != 1:
        raise VerificationError("RUN_COUNT_INVALID")
    result = verify_signed_document(packet / "result.v1.json", EXPECTED_SCHEMAS["result.v1.json"])
    if result.get("runFileSha256") != sha256_file(packet / "run_consumed.v1.json"):
        raise VerificationError("RESULT_RUN_LINK_INVALID")
    development_path = packet / "development.v1.json"
    development: dict[str, Any] | None = None
    if development_path.exists():
        development = verify_signed_document(
            development_path,
            EXPECTED_SCHEMAS["development.v1.json"],
        )
        if result.get("developmentFileSha256") != sha256_file(development_path):
            raise VerificationError("RESULT_DEVELOPMENT_LINK_INVALID")
    elif result.get("developmentFileSha256") is not None:
        raise VerificationError("RESULT_DEVELOPMENT_ABSENCE_LINK_INVALID")
    champion_path = packet / "champion.v1.json"
    holdout_open_path = packet / "holdout_open.v1.json"
    holdout_path = packet / "holdout.v1.json"
    holdout: dict[str, Any] | None = None
    if holdout_path.exists():
        holdout = verify_signed_document(holdout_path, "cosmos.quant.research.s1r.holdout.v1")
    if champion_path.exists():
        if development is None:
            raise VerificationError("CHAMPION_WITHOUT_DEVELOPMENT")
        champion = verify_signed_document(champion_path, "cosmos.quant.research.s1r.champion.v1")
        if champion.get("developmentFileSha256") != sha256_file(development_path):
            raise VerificationError("CHAMPION_DEVELOPMENT_LINK_INVALID")
        if result.get("championFileSha256") != sha256_file(champion_path):
            raise VerificationError("RESULT_CHAMPION_LINK_INVALID")
    elif result.get("championFileSha256") is not None:
        raise VerificationError("RESULT_CHAMPION_ABSENCE_LINK_INVALID")
    if holdout_open_path.exists():
        opened = verify_signed_document(
            holdout_open_path, "cosmos.quant.research.s1r.holdout_open.v1"
        )
        if opened.get("championFileSha256") != sha256_file(champion_path):
            raise VerificationError("HOLDOUT_CHAMPION_LINK_INVALID")
    if holdout is not None:
        if result.get("holdoutFileSha256") != sha256_file(holdout_path):
            raise VerificationError("RESULT_HOLDOUT_LINK_INVALID")
    elif result.get("holdoutFileSha256") is not None:
        raise VerificationError("RESULT_HOLDOUT_ABSENCE_LINK_INVALID")
    ensure_network_free(packet / "experiment.py")
    ensure_network_free(packet / "verifier.py")
    validate_semantics(
        protocol,
        development,
        result,
        champion_present=champion_path.exists(),
        holdout_open_present=holdout_open_path.exists(),
        holdout=holdout,
    )
    return {
        "schema": "cosmos.quant.research.s1r.verification_receipt.v1",
        "status": "AUTHENTIC",
        "packet": str(packet),
        "baseCommit": BASE_COMMIT,
        "strategyVerdict": result["strategyVerdict"],
        "holdoutState": result["holdoutState"],
        "capitalAuthority": "NO_GO",
        "networkUsed": False,
        "archiveMembersOpenedByVerifier": 0,
    }


def main() -> int:
    try:
        receipt = verify_packet(Path(__file__).resolve().parent)
    except VerificationError as exc:
        print(f"VERIFY_FAILED:{exc}", file=sys.stderr)
        return 2
    print(json.dumps(receipt, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
