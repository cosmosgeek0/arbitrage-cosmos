from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from research.s1j.verifier import VerificationError, validate_result_semantics


def _result() -> dict[str, Any]:
    return {
        "schema": "cosmos.quant.s1j.result.v1",
        "status": "TERMINAL",
        "verdict": "NO_GO",
        "publicProxyStatus": "DEVELOPMENT_GATE_FAIL",
        "capital": "NO_GO",
        "authority": "NONE",
        "fees": {
            "accountEffectiveSpot": "UNKNOWN",
            "accountEffectiveUsdM": "UNKNOWN",
        },
        "makerEntry": {
            "role": "NON_AUTHORITATIVE_SENSITIVITY",
            "fillTruth": "UNKNOWN",
        },
        "holdout": {"status": "SEALED_NOT_OPENED_DEVELOPMENT_GATE_FAIL"},
    }


def test_terminal_no_go_semantics_pass() -> None:
    validate_result_semantics(_result(), False)


def test_go_is_rejected() -> None:
    result = _result()
    result["verdict"] = "GO"
    with pytest.raises(VerificationError):
        validate_result_semantics(result, False)


def test_account_fee_promotion_is_rejected() -> None:
    result = _result()
    result["fees"]["accountEffectiveSpot"] = "0.001"
    with pytest.raises(VerificationError):
        validate_result_semantics(result, False)


def test_maker_fill_promotion_is_rejected() -> None:
    result = _result()
    result["makerEntry"]["fillTruth"] = "FILLED"
    with pytest.raises(VerificationError):
        validate_result_semantics(result, False)


def test_opened_holdout_requires_marker() -> None:
    result = _result()
    result["holdout"] = {"status": "OPENED_CHAMPION_ONLY"}
    with pytest.raises(VerificationError):
        validate_result_semantics(result, False)
    validate_result_semantics(result, True)


def test_opened_terminal_error_requires_marker() -> None:
    result = _result()
    result["verdict"] = "UNMEASURED"
    result["publicProxyStatus"] = "INVALID_EVIDENCE"
    result["holdout"] = {"status": "OPENED_TERMINAL_ERROR"}
    with pytest.raises(VerificationError):
        validate_result_semantics(result, False)
    validate_result_semantics(result, True)


def test_sealed_holdout_forbids_marker() -> None:
    with pytest.raises(VerificationError):
        validate_result_semantics(_result(), True)


def test_unmeasured_reason_is_frozen() -> None:
    result = deepcopy(_result())
    result["verdict"] = "UNMEASURED"
    result["publicProxyStatus"] = "UNKNOWN_REASON"
    with pytest.raises(VerificationError):
        validate_result_semantics(result, False)
