from __future__ import annotations

import json
import shutil
from decimal import Decimal
from pathlib import Path

import pytest

from quant_edge.maker_fee_grid import (
    REQUIRED_POSITIVE_GATES,
    classify_positive,
    sha256_path,
    verify_package,
)

PACKAGE = Path(__file__).parent / "fixtures" / "package"


def _load(name: str) -> dict[str, object]:
    value = json.loads((PACKAGE / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def test_package_is_structurally_valid_and_measurement_stays_blocked() -> None:
    report = verify_package(PACKAGE)

    assert report == {
        "schema": "MakerFeeGridVerificationV1",
        "artifactCount": 4,
        "blocker": "ACCEPTED_E1_BODY_BYTES_UNAVAILABLE",
        "errors": [],
        "evidenceStatus": "PASS",
        "measurementStatus": "BLOCKED",
        "normalizedVerdict": "UNKNOWN_DATA",
    }


def test_protocol_is_frozen_before_grid_outcomes() -> None:
    protocol = _load("protocol.v1.json")

    assert protocol["freezeState"] == "FROZEN_BEFORE_GRID_OUTCOMES"
    assert protocol["consumer"] == "verdict-normalization/final profitability"
    input_contract = protocol["inputContract"]
    assert isinstance(input_contract, dict)
    assert input_contract["reuseOnly"] is True
    assert input_contract["networkAcquisitionForbidden"] is True
    assert input_contract["reconstructionFromSummariesForbidden"] is True


def test_public_fee_grid_matches_current_official_scenarios() -> None:
    protocol = _load("protocol.v1.json")
    scenarios = protocol["scenarios"]

    assert scenarios == [
        {
            "scenarioId": "PUBLIC_REGULAR_USDT_NO_BNB",
            "spotEntryMakerBps": "10",
            "spotExitTakerBps": "10",
            "usdtMEntryMakerBps": "2",
            "usdtMExitTakerBps": "5",
            "discountAssumption": "NONE",
        },
        {
            "scenarioId": "PUBLIC_REGULAR_USDT_BNB_SENSITIVITY",
            "spotEntryMakerBps": "7.5",
            "spotExitTakerBps": "7.5",
            "usdtMEntryMakerBps": "1.8",
            "usdtMExitTakerBps": "4.5",
            "discountAssumption": "SPOT_25_PERCENT_AND_USDT_M_10_PERCENT_APPLY",
        },
    ]


def test_public_rates_never_become_account_truth() -> None:
    sources = _load("official_fee_sources.v1.json")

    assert sources["feePosture"] == "PUBLIC_SCHEDULE_SCENARIO_ONLY"
    assert sources["accountEffectiveFees"] == "UNKNOWN"
    assert sources["capitalAuthority"] == "NONE"


def test_missing_bodies_keep_all_requested_metrics_null() -> None:
    result = _load("result.v1.json")
    scenarios = result["scenarios"]
    assert isinstance(scenarios, list)

    for scenario in scenarios:
        assert isinstance(scenario, dict)
        assert scenario["measurementState"] == "NOT_MEASURED"
        assert scenario["netUsdPer1000SpotEntryNotional"] is None
        assert scenario["interval95UsdPer1000SpotEntryNotional"] is None
        assert scenario["maxDrawdownUsd"] is None
        assert scenario["maxDrawdownFraction"] is None
        assert scenario["capacityUsd"] is None
        assert scenario["positiveSubsetCount"] is None
        assert scenario["feeDecompositionUsd"] is None
        assert scenario["pairAndPredeclaredRegimeBreakdown"] is None


@pytest.mark.parametrize(
    ("field", "mutation"),
    [
        ("feeDecompositionUsd", {"invented": "1"}),
        ("pairAndPredeclaredRegimeBreakdown", []),
    ],
)
def test_verifier_rejects_invented_blocked_metrics(
    tmp_path: Path,
    field: str,
    mutation: object,
) -> None:
    package = tmp_path / "package"
    shutil.copytree(PACKAGE, package)
    result_path = package / "result.v1.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["scenarios"][0][field] = mutation
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    manifest_path = package / "artifact_manifest.v1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    next(entry for entry in manifest["artifacts"] if entry["path"] == "result.v1.json")[
        "sha256"
    ] = sha256_path(result_path)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    report = verify_package(package)

    assert report["evidenceStatus"] == "FAIL"
    assert "BLOCKED_RESULT_CONTAINS_MEASURED_METRIC" in report["errors"]


def test_verifier_rejects_missing_requested_metric(tmp_path: Path) -> None:
    package = tmp_path / "package"
    shutil.copytree(PACKAGE, package)
    result_path = package / "result.v1.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    del result["scenarios"][0]["pairAndPredeclaredRegimeBreakdown"]
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    manifest_path = package / "artifact_manifest.v1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    next(entry for entry in manifest["artifacts"] if entry["path"] == "result.v1.json")[
        "sha256"
    ] = sha256_path(result_path)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    report = verify_package(package)

    assert report["evidenceStatus"] == "FAIL"
    assert "BLOCKED_RESULT_CONTAINS_MEASURED_METRIC" in report["errors"]


def test_positive_is_rejected_when_even_one_required_gate_is_missing() -> None:
    gates = dict.fromkeys(REQUIRED_POSITIVE_GATES, True)
    gates["independentOosHoldoutPassed"] = False

    assert classify_positive(Decimal("0.01"), gates) == "REJECTED_POSITIVE_UNVERIFIED"


def test_pbo_cannot_override_another_missing_gate() -> None:
    gates = dict.fromkeys(REQUIRED_POSITIVE_GATES, True)
    gates["causalMakerEntryFillVerified"] = False
    gates["pboPassed"] = True

    assert classify_positive(Decimal("10"), gates) == "REJECTED_POSITIVE_UNVERIFIED"


def test_truthy_non_boolean_gate_values_cannot_qualify() -> None:
    gates: dict[str, object] = dict.fromkeys(REQUIRED_POSITIVE_GATES, True)
    gates["pboPassed"] = "true"

    assert classify_positive(Decimal("10"), gates) == "REJECTED_POSITIVE_UNVERIFIED"


def test_positive_requires_every_frozen_gate_but_is_not_capital_authority() -> None:
    gates = dict.fromkeys(REQUIRED_POSITIVE_GATES, True)

    assert (
        classify_positive(Decimal("0.000001"), gates) == "FAMILY_QUALIFYING_NOT_CAPITAL_AUTHORITY"
    )


@pytest.mark.parametrize(
    ("point", "expected"),
    [
        (None, "NOT_ASSESSED"),
        (Decimal("0"), "NON_POSITIVE"),
        (Decimal("-0.01"), "NON_POSITIVE"),
    ],
)
def test_nonpositive_and_unmeasured_classification(
    point: Decimal | None,
    expected: str,
) -> None:
    assert classify_positive(point, {}) == expected
