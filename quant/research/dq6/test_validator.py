"""Focused valid and hostile tests for DQ-6."""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable
from decimal import Decimal, Inexact, localcontext
from pathlib import Path

import pytest
from research.dq6.validator import (
    TruthValidationError,
    canonical_receipt_json,
    validate_research_economics_truth_v1,
)
from research.dq6.verify_known_answer import (
    apply_hostile_case,
    load_hostile_cases,
    load_valid_fixture,
)


def _nested(document: dict[str, object], *path: str) -> dict[str, object]:
    current = document
    for segment in path:
        value = current[segment]
        assert type(value) is dict
        current = value
    return current


def _assert_code(code: str, action: Callable[[], object]) -> None:
    with pytest.raises(TruthValidationError, match=rf"^{code} ") as caught:
        action()
    assert caught.value.code == code


def test_valid_fixture_matches_frozen_known_answer() -> None:
    document = load_valid_fixture()
    receipt = validate_research_economics_truth_v1(document)
    expected = (Path(__file__).resolve().parent / "known_answer.v1.json").read_bytes()
    assert canonical_receipt_json(receipt) == expected


def test_known_answer_digest_is_independently_recomputed() -> None:
    known_answer_path = Path(__file__).resolve().parent / "known_answer.v1.json"
    frozen_bytes = known_answer_path.read_bytes()
    parsed: object = json.loads(frozen_bytes)
    assert type(parsed) is dict
    digest = parsed.pop("receiptDigestSha256")
    assert type(digest) is str
    canonical_without_digest = (
        json.dumps(
            parsed,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode()

    assert hashlib.sha256(canonical_without_digest).hexdigest() == digest


@pytest.mark.parametrize("case", load_hostile_cases(), ids=lambda case: str(case["caseId"]))
def test_hostile_fixture_has_exact_failure_code(case: dict[str, object]) -> None:
    document = apply_hostile_case(load_valid_fixture(), case)
    expected_code = case["expectedCode"]
    assert type(expected_code) is str
    _assert_code(
        expected_code,
        lambda: validate_research_economics_truth_v1(document),
    )


def test_signed_positive_funding_is_added_once() -> None:
    document = load_valid_fixture()
    economics = _nested(document, "economics")
    _nested(economics, "fundingPnl")["amount"] = "0.5"
    _nested(economics, "declaredScenarioNetPnl")["amount"] = "19.5"
    reporting = _nested(document, "reporting")
    reporting["scenarioNetPer1000ReturnDenominator"] = "19.5"

    receipt = validate_research_economics_truth_v1(document)

    receipt_economics = _nested(receipt, "economics")
    scenario_net = _nested(receipt_economics, "scenarioNetPnl")
    assert scenario_net["amount"] == "19.5"


def test_initial_capital_not_gross_exposure_controls_normalization() -> None:
    document = load_valid_fixture()
    denominator = _nested(document, "capital", "capitalDenominator")
    denominator["amount"] = "500"
    reporting = _nested(document, "reporting")
    reporting["scenarioNetPer1000ReturnDenominator"] = "37"

    receipt = validate_research_economics_truth_v1(document)

    assert _nested(receipt, "capitalDenominator")["amount"] == "500"
    ratio = _nested(receipt, "grossExposureRatio")
    assert ratio == {
        "grossEntryNotional": "2000",
        "initialResearchCapital": "500",
    }
    assert _nested(receipt, "reporting")["scenarioNetPer1000ReturnDenominator"] == "37"


def test_unmeasured_capacity_has_no_numeric_proxy() -> None:
    document = load_valid_fixture()
    capacity = _nested(document, "capacity")
    capacity.update(
        {
            "state": "UNMEASURED",
            "proxyKind": None,
            "sourceMetricAmount": None,
            "proxyFraction": None,
            "proxyAmount": None,
            "observedAtUtc": None,
            "sourceArtifactSha256": None,
        }
    )

    receipt = validate_research_economics_truth_v1(document)

    assert _nested(receipt, "capacity")["state"] == "UNMEASURED"
    assert _nested(receipt, "capacity")["proxyAmount"] is None
    assert _nested(receipt, "capacity")["executableCapacityState"] == "UNMEASURED"


def test_public_fee_scenario_does_not_upgrade_account_fee() -> None:
    receipt = validate_research_economics_truth_v1(load_valid_fixture())

    assert _nested(receipt, "economics", "feeCost")["amount"] == "4"
    assert _nested(receipt, "accountFee") == {
        "state": "UNKNOWN",
        "amount": None,
        "asset": "USDT",
        "reasonCode": "SIGNED_ACCOUNT_FEE_EVIDENCE_ABSENT",
    }
    assert _nested(receipt, "economics")["accountEffectiveNetPnlState"] == "UNKNOWN"


def test_sensitivity_component_taints_aggregate_scenario() -> None:
    falsely_public = load_valid_fixture()
    _nested(falsely_public, "economics", "slippageCost")["truthState"] = "SENSITIVITY_ONLY"
    _assert_code(
        "E_SCENARIO_TRUTH",
        lambda: validate_research_economics_truth_v1(falsely_public),
    )

    labeled_sensitivity = load_valid_fixture()
    _nested(labeled_sensitivity, "economics", "slippageCost")["truthState"] = "SENSITIVITY_ONLY"
    _nested(labeled_sensitivity, "economics", "declaredScenarioNetPnl")["truthState"] = (
        "SENSITIVITY_SCENARIO"
    )
    receipt = validate_research_economics_truth_v1(labeled_sensitivity)
    assert _nested(receipt, "economics", "scenarioNetPnl")["truthState"] == "SENSITIVITY_SCENARIO"


def test_capacity_proxy_math_is_exact_decimal() -> None:
    document = load_valid_fixture()
    _nested(document, "capacity")["proxyAmount"] = "2500.000000000001"

    _assert_code(
        "E_CAPACITY_PROXY_MATH",
        lambda: validate_research_economics_truth_v1(document),
    )


def test_caller_decimal_context_cannot_change_validation_or_receipt() -> None:
    document = load_valid_fixture()
    economics = _nested(document, "economics")
    _nested(economics, "grossPnl")["amount"] = "999999999999999.999999999999"
    _nested(economics, "feeCost")["amount"] = "0.000000000001"
    _nested(economics, "slippageCost")["amount"] = "0"
    _nested(economics, "fundingPnl")["amount"] = "0"
    _nested(economics, "declaredScenarioNetPnl")["amount"] = "999999999999999.999999999998"
    _nested(document, "reporting")["scenarioNetPer1000ReturnDenominator"] = "1000000000000000"
    capacity = _nested(document, "capacity")
    capacity["sourceMetricAmount"] = "999999999999999.999999999999"
    capacity["proxyFraction"] = "1"
    capacity["proxyAmount"] = "999999999999999.999999999999"

    rendered_receipts: list[bytes] = []
    for precision in (6, 28, 60):
        with localcontext() as caller_context:
            caller_context.prec = precision
            caller_context.traps[Inexact] = True
            receipt = validate_research_economics_truth_v1(document)
        rendered_receipts.append(canonical_receipt_json(receipt))

    assert rendered_receipts[0] == rendered_receipts[1] == rendered_receipts[2]


def test_truncated_capacity_product_fails_at_every_caller_precision() -> None:
    document = load_valid_fixture()
    capacity = _nested(document, "capacity")
    capacity["sourceMetricAmount"] = "999999999999999.999999999999"
    capacity["proxyFraction"] = "0.999999999999"
    capacity["proxyAmount"] = "999999999998999.999999999999"

    for precision in (6, 28, 60):
        with localcontext() as caller_context:
            caller_context.prec = precision
            _assert_code(
                "E_CAPACITY_PROXY_MATH",
                lambda: validate_research_economics_truth_v1(document),
            )


def test_negative_fee_and_slippage_are_rejected() -> None:
    for component in ("feeCost", "slippageCost"):
        document = load_valid_fixture()
        _nested(document, "economics", component)["amount"] = "-0.1"
        _assert_code(
            "E_DECIMAL_RANGE",
            lambda document=document: validate_research_economics_truth_v1(document),
        )


def test_binary_float_is_not_evidence() -> None:
    document = load_valid_fixture()
    _nested(document, "economics", "feeCost")["amount"] = 4.0

    _assert_code("E_TEXT", lambda: validate_research_economics_truth_v1(document))


def test_negative_zero_is_not_canonical() -> None:
    document = load_valid_fixture()
    _nested(document, "economics", "fundingPnl")["amount"] = "-0"

    _assert_code("E_DECIMAL", lambda: validate_research_economics_truth_v1(document))


def test_extra_keys_fail_closed() -> None:
    document = load_valid_fixture()
    document["usdAmount"] = "18.5"

    _assert_code("E_KEYS", lambda: validate_research_economics_truth_v1(document))


def test_entry_leg_order_and_identity_are_canonical() -> None:
    reordered = load_valid_fixture()
    capital = _nested(reordered, "capital")
    legs = capital["entryLegs"]
    assert type(legs) is list
    capital["entryLegs"] = list(reversed(legs))
    _assert_code(
        "E_ORDER",
        lambda: validate_research_economics_truth_v1(reordered),
    )

    duplicated = load_valid_fixture()
    duplicate_legs = _nested(duplicated, "capital")["entryLegs"]
    assert type(duplicate_legs) is list
    first = duplicate_legs[0]
    second = duplicate_legs[1]
    assert type(first) is dict
    assert type(second) is dict
    second["legId"] = first["legId"]
    _assert_code(
        "E_DUPLICATE",
        lambda: validate_research_economics_truth_v1(duplicated),
    )


def test_mapping_key_order_does_not_change_receipt() -> None:
    document = load_valid_fixture()
    reversed_root = dict(reversed(list(copy.deepcopy(document).items())))

    first = validate_research_economics_truth_v1(document)
    second = validate_research_economics_truth_v1(reversed_root)

    assert canonical_receipt_json(first) == canonical_receipt_json(second)
    assert Decimal(_nested(first, "reporting")["scenarioNetPer1000ReturnDenominator"]) == Decimal(
        "18.5"
    )
