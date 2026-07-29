"""Focused tests for the independent S-1R verifier."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
import verifier


def signed(document: dict) -> dict:
    result = dict(document)
    result["artifactSha256"] = hashlib.sha256(verifier.canonical_bytes(result)).hexdigest()
    return result


def test_signed_document_detects_tampering(tmp_path: Path) -> None:
    path = tmp_path / "artifact.json"
    path.write_text(
        json.dumps(
            signed({"schema": "test.schema", "value": 1}),
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    assert verifier.verify_signed_document(path, "test.schema")["value"] == 1
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["value"] = 2
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(verifier.VerificationError, match="DIGEST_INVALID"):
        verifier.verify_signed_document(path, "test.schema")


def test_network_free_check_rejects_socket(tmp_path: Path) -> None:
    path = tmp_path / "unsafe.py"
    path.write_text("import socket\n", encoding="utf-8")
    with pytest.raises(verifier.VerificationError, match="NETWORK_OR_PROCESS_IMPORT_PRESENT"):
        verifier.ensure_network_free(path)


def test_freeze_requires_exact_closed_binding_graph() -> None:
    freeze = {
        "baseCommit": verifier.BASE_COMMIT,
        "status": "SEALED_DEVELOPMENT_AND_HOLDOUT_MEMBERS_CLOSED",
        "archiveMemberOpenCount": 0,
        "holdoutState": "CLOSED_UNREAD",
        "bindings": dict.fromkeys(verifier.REQUIRED_FREEZE_BINDINGS, "a" * 64),
    }
    assert verifier.validate_freeze_header_and_bindings(freeze) == freeze["bindings"]
    freeze["bindings"].pop("verifier.py")
    with pytest.raises(
        verifier.VerificationError,
        match="FREEZE_BINDING_SET_INVALID",
    ):
        verifier.validate_freeze_header_and_bindings(freeze)


def test_semantics_rejects_capital_go() -> None:
    protocol = {
        "baseCommit": verifier.BASE_COMMIT,
        "authority": "NONE",
        "distinctness": {
            "forbiddenSignalInputs": [
                "SIGN_CHANGE_OR_SIGN_FLIP",
                "CUMULATIVE_FUNDING_OR_PERSISTENCE",
                "FUNDING_FORECAST_OR_FUTURE_FUNDING",
                "FIRST_OR_SECOND_DIFFERENCE_ACCELERATION_OR_VELOCITY",
            ],
            "required": [
                "CURRENT_SETTLEMENT_EXCLUDED_FROM_PRIOR_ROBUST_BASELINE",
                "EVENT_FUNDING_NOT_BOOKED_AND_EXIT_STRICTLY_BEFORE_ANY_LATER_SETTLEMENT",
            ],
        },
    }
    trial = {
        "trialId": "T",
        "fundingCashflowUsd": "0",
        "trades": [],
    }
    development = {
        "trialCount": 12,
        "trials": [dict(trial, trialId=f"T{index}") for index in range(12)],
        "championTrialId": "T0",
        "championChecks": {"gate": False},
        "admitted": False,
        "pbo": {"splits": 924, "authority": "DIAGNOSTIC_ONLY"},
    }
    result = {
        "capitalAuthority": "GO",
        "executionAuthority": "NONE",
        "positiveEdgeClaim": False,
        "strategyVerdict": "NO_GO",
        "holdoutState": "UNOPENED",
        "externalTruth": {
            "historicalFundingPublicationLatency": "UNMEASURED",
            "historicalArchiveFundingRateType": "UNAVAILABLE",
            "accountEffectiveFees": "UNKNOWN",
            "executableCapacity": "UNMEASURED",
        },
        "effects": {"moneyUsd": "0"},
    }
    with pytest.raises(verifier.VerificationError, match="CAPITAL_AUTHORITY_INVALID"):
        verifier.validate_semantics(
            protocol,
            development,
            result,
            champion_present=False,
            holdout_open_present=False,
            holdout=None,
        )
