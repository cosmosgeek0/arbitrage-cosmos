from __future__ import annotations

import io
import json
from collections.abc import Sequence
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.fee_truth.__main__ import main

_EXPECTED_ERROR = "fee-truth: rejected\n"
_SENTINEL = "SENSITIVE_RAW_ACCOUNT_SENTINEL_7D21"


def _unknown_spot_receipt() -> dict[str, object]:
    return {
        "provenance": {
            "captureKind": "OWNER_SUPPLIED_SANITIZED_CAPTURE",
            "observedAtUtc": "2026-07-28T00:00:00Z",
            "sources": ["BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA"],
            "temporalScope": "CURRENT_POINT_IN_TIME",
            "validUntilUtc": "2026-07-28T00:05:00Z",
        },
        "rows": [
            {
                "chargeBasis": "RECEIVED_ASSET_AMOUNT",
                "discount": {
                    "application": "UNKNOWN",
                    "feeAsset": "UNKNOWN",
                    "standardPayableMultiplier": {
                        "decimal": None,
                        "state": "UNKNOWN",
                    },
                },
                "role": "TAKER",
                "scenarioId": "fee1.unknown.binance_spot.btcusdt.taker.buy",
                "side": "BUY",
                "sourceFieldRefs": [],
                "special": {"decimal": None, "state": "UNKNOWN"},
                "standard": {"decimal": None, "state": "UNKNOWN"},
                "symbol": "BTCUSDT",
                "tax": {"decimal": None, "state": "UNKNOWN"},
                "truthState": "UNKNOWN",
                "venue": "BINANCE_SPOT",
            }
        ],
        "sanitizationPolicyId": "FEE1_STRICT_ALLOWLIST_V1",
        "schema": "FEE_TRUTH_RECEIPT",
        "version": 1,
    }


def _invoke(raw: bytes, argv: Sequence[str]) -> tuple[int, bytes, str]:
    stdout = io.BytesIO()
    stderr = io.StringIO()
    exit_code = main(
        argv,
        stdin=io.BytesIO(raw),
        stdout=stdout,
        stderr=stderr,
    )
    return exit_code, stdout.getvalue(), stderr.getvalue()


def test_cli_emits_only_canonical_projection_from_explicit_inputs() -> None:
    raw = canonical_json_bytes(_unknown_spot_receipt())
    first = _invoke(
        raw,
        (
            "--evaluation-time-utc",
            "2026-07-28T00:01:00Z",
            "--expected-symbol",
            "BTCUSDT",
        ),
    )
    second = _invoke(
        raw,
        (
            "--expected-symbol",
            "BTCUSDT",
            "--evaluation-time-utc",
            "2026-07-28T00:01:00Z",
        ),
    )

    assert first == second
    exit_code, output, error = first
    assert exit_code == 0
    assert error == ""
    parsed = cast(dict[str, object], json.loads(output))
    assert canonical_json_bytes(parsed) == output
    assert parsed["schema"] == "N3FeeScenarioInputsV1"
    assert parsed["consumer"] == "N-3"
    assert parsed["asOfUtc"] == "2026-07-28T00:01:00Z"
    assert parsed["unknownCostsRemainUnknown"] is True
    assert len(cast(list[object], parsed["scenarios"])) == 4


@pytest.mark.parametrize(
    ("raw", "argv"),
    [
        pytest.param(
            canonical_json_bytes(
                {
                    **_unknown_spot_receipt(),
                    "apiKey": _SENTINEL,
                }
            ),
            (
                "--evaluation-time-utc",
                "2026-07-28T00:01:00Z",
                "--expected-symbol",
                "BTCUSDT",
            ),
            id="forbidden-receipt-field",
        ),
        pytest.param(
            canonical_json_bytes(_unknown_spot_receipt()),
            (
                "--evaluation-time-utc",
                "2026-07-28T00:01:00Z",
                "--expected-symbol",
                "ETHUSDT",
            ),
            id="symbol-not-in-explicit-set",
        ),
        pytest.param(
            canonical_json_bytes(_unknown_spot_receipt()),
            (
                "--evaluation-time-utc",
                _SENTINEL,
                "--expected-symbol",
                "BTCUSDT",
            ),
            id="invalid-explicit-clock",
        ),
        pytest.param(
            canonical_json_bytes(_unknown_spot_receipt()),
            ("--expected-symbol", "BTCUSDT"),
            id="missing-clock-has-no-implicit-fallback",
        ),
        pytest.param(
            _SENTINEL.encode() + b"x" * 262_144,
            (
                "--evaluation-time-utc",
                "2026-07-28T00:01:00Z",
                "--expected-symbol",
                "BTCUSDT",
            ),
            id="oversized-input",
        ),
        pytest.param(
            canonical_json_bytes(_unknown_spot_receipt()),
            (_SENTINEL,),
            id="unexpected-option",
        ),
    ],
)
def test_cli_failures_are_stable_and_never_echo_rejected_bytes(
    raw: bytes,
    argv: Sequence[str],
) -> None:
    exit_code, output, error = _invoke(raw, argv)

    assert exit_code == 2
    assert output == b""
    assert error == _EXPECTED_ERROR
    assert _SENTINEL not in error
