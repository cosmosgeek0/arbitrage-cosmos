from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, localcontext
from typing import cast

import pytest
import research.dq8 as dq8
from research.dq8.known_answer import (
    apply_hostile_case_v1,
    hostile_case_id_v1,
    hostile_cases_v1,
    hostile_expected_code_v1,
    known_answer_projection_v1,
    load_known_receipt_v1,
    load_valid_payload_v1,
    verify_synthetic_source_digest_v1,
)
from research.dq8.validator import (
    ClockMarkV1,
    CoordinateContractError,
    JsonObject,
    build_clock_digest_v1,
    validate_payload_v1,
)

_CASES = hostile_cases_v1()
_HIGH_PRECISION_END = "12345678901234567890123456789012"
_HIGH_PRECISION_NET = "12345678901234567890123456789011"
_ROUNDED_HIGH_PRECISION_NET = "12345678901234567890123456790000"


def _objects(value: object) -> list[JsonObject]:
    assert isinstance(value, list)
    assert all(isinstance(item, dict) for item in value)
    return cast(list[JsonObject], value)


def _object(value: object) -> JsonObject:
    assert isinstance(value, dict)
    return cast(JsonObject, value)


def _refresh_clock_digest(payload: JsonObject) -> None:
    plan = _object(payload["clockPlan"])
    raw_marks = _objects(plan["marks"])
    marks = tuple(
        ClockMarkV1(
            mark_id=cast(str, mark["markId"]),
            timestamp_us=cast(int, mark["timestampUs"]),
            timestamp_label=cast(str, mark["timestampLabel"]),
            date_label=cast(str, mark["dateLabel"]),
        )
        for mark in raw_marks
    )
    plan["clockDigest"] = build_clock_digest_v1(cast(str, plan["pathId"]), marks)


def test_public_api_is_frozen() -> None:
    assert dq8.PUBLIC_API_V1 == (
        "SCHEMA_V1",
        "CashEventKind",
        "ClockMarkV1",
        "CoordinateContractError",
        "EconomicCashEventV1",
        "NavClockPlanV1",
        "NavDrawdownClaimV1",
        "NavDrawdownReceiptV1",
        "NavMarkV1",
        "PositionMarkV1",
        "PriceCoordinateV1",
        "PriceUse",
        "TradeEventV1",
        "TradeRole",
        "build_clock_digest_v1",
        "validate_nav_drawdown_coordinates_v1",
        "validate_payload_v1",
    )
    assert tuple(name for name in dq8.__all__ if name != "PUBLIC_API_V1") == (dq8.PUBLIC_API_V1)


def test_valid_known_answer_and_source_digest_are_frozen() -> None:
    payload = load_valid_payload_v1()
    assert (
        verify_synthetic_source_digest_v1(payload)
        == "9a3f0ca4daf721bb89870ef40b00ede1adad51262905c315689bc69a679d8f41"
    )
    receipt = validate_payload_v1(payload)
    assert receipt.as_dict() == load_known_receipt_v1()
    assert receipt.as_dict() == known_answer_projection_v1()
    assert receipt.authority == "NONE"
    assert receipt.cash_hours == 10
    assert receipt.net_result.as_tuple().sign == 1
    assert (receipt.maximum_drawdown_loss, receipt.maximum_drawdown_peak) == (
        Decimal("300"),
        Decimal("1200"),
    )
    assert receipt.canonical_bytes().endswith(b"\n")


@pytest.mark.parametrize("case", _CASES, ids=hostile_case_id_v1)
def test_hostile_fixtures_fail_with_exact_code(case: JsonObject) -> None:
    with pytest.raises(CoordinateContractError) as captured:
        validate_payload_v1(apply_hostile_case_v1(load_valid_payload_v1(), case))
    assert captured.value.code == hostile_expected_code_v1(case)


def test_set_like_input_order_cannot_change_receipt_bytes() -> None:
    original_payload = load_valid_payload_v1()
    original = validate_payload_v1(original_payload)
    reordered = deepcopy(original_payload)
    for field in ("prices", "trades", "cashEvents", "navMarks"):
        values = cast(list[object], reordered[field])
        values.reverse()
    for nav_mark in _objects(reordered["navMarks"]):
        cast(list[object], nav_mark["positions"]).reverse()
    replay = validate_payload_v1(reordered)
    assert replay == original
    assert replay.canonical_bytes() == original.canonical_bytes()


def test_explicit_fee_is_bound_into_cash_nav_and_endpoint_economics() -> None:
    payload = load_valid_payload_v1()
    payload["cashEvents"] = [
        {
            "eventId": "fee-exit",
            "markId": "clock-20",
            "kind": "FEE",
            "amount": "-10",
            "evidenceSha256": ("9a3f0ca4daf721bb89870ef40b00ede1adad51262905c315689bc69a679d8f41"),
        }
    ]
    nav_marks = _objects(payload["navMarks"])
    for index in (4, 5):
        nav_marks[index]["cash"] = "940"
        nav_marks[index]["nav"] = "940"
    claim = _object(payload["claim"])
    claim.update(
        {
            "endingNav": "940",
            "economicCashChange": "-10",
            "netResult": "-60",
            "returnNumerator": "-60",
        }
    )
    receipt = validate_payload_v1(payload)
    assert receipt.ending_nav == Decimal("940")
    assert receipt.economic_cash_change == Decimal("-10")
    assert receipt.net_result == Decimal("-60")


def test_positive_fee_fails_closed() -> None:
    payload = load_valid_payload_v1()
    payload["cashEvents"] = [
        {
            "eventId": "fee-positive",
            "markId": "clock-20",
            "kind": "FEE",
            "amount": "1",
            "evidenceSha256": ("9a3f0ca4daf721bb89870ef40b00ede1adad51262905c315689bc69a679d8f41"),
        }
    ]
    with pytest.raises(CoordinateContractError, match="CASH_EVENT_SIGN_INVALID"):
        validate_payload_v1(payload)


@pytest.mark.parametrize("value", [100.0, "1e2", "-0", "NaN", "Infinity"])
def test_noncanonical_or_nonstring_price_values_fail(value: object) -> None:
    payload = load_valid_payload_v1()
    _objects(payload["prices"])[0]["price"] = value
    with pytest.raises(CoordinateContractError) as captured:
        validate_payload_v1(payload)
    assert captured.value.code in {"DECIMAL_INVALID", "DECIMAL_NONCANONICAL"}


def test_unknown_payload_field_fails_closed() -> None:
    payload = load_valid_payload_v1()
    payload["nearestTimestampTolerance"] = "1h"
    with pytest.raises(CoordinateContractError, match="FIELD_SET_INVALID"):
        validate_payload_v1(payload)


def test_clock_digest_is_semantic_and_checked() -> None:
    payload = load_valid_payload_v1()
    plan = _object(payload["clockPlan"])
    assert plan["clockDigest"] == (
        "7deeaf5c4d8aecc1f1dc817e185df3e2da8791142076ad8e739aacd51bb50d22"
    )
    plan["clockDigest"] = "f" * 64
    with pytest.raises(CoordinateContractError, match="CLOCK_DIGEST_MISMATCH"):
        validate_payload_v1(payload)


def _high_precision_endpoint_payload() -> JsonObject:
    payload = load_valid_payload_v1()
    payload["startingCash"] = "1"

    prices = _objects(payload["prices"])
    for price in prices:
        price["price"] = (
            "1" if price["priceId"] in {"price-entry", "price-mark-entry"} else _HIGH_PRECISION_END
        )

    trades = _objects(payload["trades"])
    trades[0]["quantityDelta"] = "1"
    trades[1]["quantityDelta"] = "-1"

    nav_marks = _objects(payload["navMarks"])
    nav_marks[0]["cash"] = nav_marks[0]["nav"] = "1"
    nav_marks[1]["cash"] = "0"
    nav_marks[1]["nav"] = "1"
    entry_position = _objects(nav_marks[1]["positions"])[0]
    entry_position["quantity"] = "1"
    entry_position["marketValue"] = "1"
    for index in (2, 3):
        nav_marks[index]["cash"] = "0"
        nav_marks[index]["nav"] = _HIGH_PRECISION_END
        position = _objects(nav_marks[index]["positions"])[0]
        position["quantity"] = "1"
        position["marketValue"] = _HIGH_PRECISION_END
    for index in (4, 5):
        nav_marks[index]["cash"] = _HIGH_PRECISION_END
        nav_marks[index]["nav"] = _HIGH_PRECISION_END

    claim = _object(payload["claim"])
    claim.update(
        {
            "startingNav": "1",
            "endingNav": _HIGH_PRECISION_END,
            "tradeCashChange": _HIGH_PRECISION_NET,
            "netResult": _HIGH_PRECISION_NET,
            "returnNumerator": _HIGH_PRECISION_NET,
            "returnDenominator": "1",
            "maximumDrawdownLoss": "0",
            "maximumDrawdownPeak": "1",
            "peakNavMarkId": "nav-00",
            "troughNavMarkId": "nav-00",
            "peakTimestampLabel": "2026-01-01T00:00:00Z",
            "troughTimestampLabel": "2026-01-01T00:00:00Z",
        }
    )
    return payload


def test_endpoint_economics_ignore_ambient_decimal_rounding() -> None:
    payload = _high_precision_endpoint_payload()
    with localcontext() as context:
        context.prec = 28
        receipt = validate_payload_v1(payload)
    assert receipt.net_result == Decimal(_HIGH_PRECISION_NET)
    assert receipt.trade_cash_change == Decimal(_HIGH_PRECISION_NET)

    hostile = deepcopy(payload)
    hostile_claim = _object(hostile["claim"])
    hostile_claim["netResult"] = _ROUNDED_HIGH_PRECISION_NET
    hostile_claim["returnNumerator"] = _ROUNDED_HIGH_PRECISION_NET
    with localcontext() as context:
        context.prec = 28
        with pytest.raises(CoordinateContractError) as captured:
            validate_payload_v1(hostile)
    assert captured.value.code == "NET_RESULT_MISMATCH"


def test_descending_or_duplicate_clock_coordinate_fails_before_digest() -> None:
    payload = load_valid_payload_v1()
    plan = _object(payload["clockPlan"])
    marks = _objects(plan["marks"])
    marks[2]["timestampUs"] = marks[1]["timestampUs"]
    marks[2]["timestampLabel"] = marks[1]["timestampLabel"]
    with pytest.raises(CoordinateContractError, match="CLOCK_NOT_STRICTLY_INCREASING"):
        validate_payload_v1(payload)


def test_zero_drawdown_uses_first_mark_for_both_coordinates() -> None:
    payload = load_valid_payload_v1()
    prices = _objects(payload["prices"])
    for price in prices:
        price["price"] = "100"
    nav_marks = _objects(payload["navMarks"])
    for index in (1, 2, 3):
        position = _objects(nav_marks[index]["positions"])[0]
        position["marketValue"] = "1000"
        nav_marks[index]["nav"] = "1000"
    for index in (4, 5):
        nav_marks[index]["cash"] = "1000"
        nav_marks[index]["nav"] = "1000"
    claim = _object(payload["claim"])
    claim.update(
        {
            "endingNav": "1000",
            "tradeCashChange": "0",
            "netResult": "0",
            "returnNumerator": "0",
            "maximumDrawdownLoss": "0",
            "maximumDrawdownPeak": "1000",
            "peakNavMarkId": "nav-00",
            "troughNavMarkId": "nav-00",
            "peakTimestampLabel": "2026-01-01T00:00:00Z",
            "troughTimestampLabel": "2026-01-01T00:00:00Z",
        }
    )
    receipt = validate_payload_v1(payload)
    assert receipt.maximum_drawdown_loss == 0
    assert receipt.peak_nav_mark_id == receipt.trough_nav_mark_id == "nav-00"


def _tie_path() -> JsonObject:
    payload = load_valid_payload_v1()
    plan = _object(payload["clockPlan"])
    clocks = _objects(plan["marks"])
    clocks.extend(
        [
            {
                "markId": "clock-30",
                "timestampUs": 1767333600000000,
                "timestampLabel": "2026-01-02T06:00:00Z",
                "dateLabel": "2026-01-02",
            },
            {
                "markId": "clock-36",
                "timestampUs": 1767355200000000,
                "timestampLabel": "2026-01-02T12:00:00Z",
                "dateLabel": "2026-01-02",
            },
        ]
    )
    _refresh_clock_digest(payload)

    prices = _objects(payload["prices"])
    source_digest = prices[0]["sourceArtifactSha256"]
    prices.extend(
        [
            {
                "priceId": "price-mark-equal-peak",
                "lotId": "lot-1",
                "instrument": "BTCUSDT",
                "venue": "SYNTHETIC_VENUE",
                "use": "VALUATION",
                "sourceField": "OPEN",
                "sourceArtifactSha256": source_digest,
                "sourceRowId": "row-equal-peak",
                "markId": "clock-20",
                "timestampUs": 1767297600000000,
                "timestampLabel": "2026-01-01T20:00:00Z",
                "dateLabel": "2026-01-01",
                "price": "120",
            },
            {
                "priceId": "price-mark-equal-trough",
                "lotId": "lot-1",
                "instrument": "BTCUSDT",
                "venue": "SYNTHETIC_VENUE",
                "use": "VALUATION",
                "sourceField": "OPEN",
                "sourceArtifactSha256": source_digest,
                "sourceRowId": "row-equal-trough",
                "markId": "clock-24",
                "timestampUs": 1767312000000000,
                "timestampLabel": "2026-01-02T00:00:00Z",
                "dateLabel": "2026-01-02",
                "price": "90",
            },
        ]
    )
    exit_price = next(price for price in prices if price["priceId"] == "price-exit")
    exit_price.update(
        {
            "markId": "clock-30",
            "timestampUs": 1767333600000000,
            "timestampLabel": "2026-01-02T06:00:00Z",
            "dateLabel": "2026-01-02",
        }
    )
    exit_event = _objects(payload["trades"])[1]
    exit_event["markId"] = "clock-30"

    nav_marks = _objects(payload["navMarks"])
    nav_marks[4] = {
        "navMarkId": "nav-20",
        "clockMarkId": "clock-20",
        "cash": "0",
        "positions": [
            {
                "lotId": "lot-1",
                "quantity": "10",
                "priceId": "price-mark-equal-peak",
                "expectedPriceField": "OPEN",
                "marketValue": "1200",
            }
        ],
        "nav": "1200",
    }
    nav_marks[5] = {
        "navMarkId": "nav-24",
        "clockMarkId": "clock-24",
        "cash": "0",
        "positions": [
            {
                "lotId": "lot-1",
                "quantity": "10",
                "priceId": "price-mark-equal-trough",
                "expectedPriceField": "OPEN",
                "marketValue": "900",
            }
        ],
        "nav": "900",
    }
    nav_marks.extend(
        [
            {
                "navMarkId": "nav-30",
                "clockMarkId": "clock-30",
                "cash": "950",
                "positions": [],
                "nav": "950",
            },
            {
                "navMarkId": "nav-36",
                "clockMarkId": "clock-36",
                "cash": "950",
                "positions": [],
                "nav": "950",
            },
        ]
    )
    claim = _object(payload["claim"])
    claim.update(
        {
            "endNavMarkId": "nav-36",
            "cashDurationUs": 43200000000,
            "cashHours": 12,
        }
    )
    return payload


def test_equal_later_peak_and_trough_keep_earliest_coordinate_pair() -> None:
    payload = _tie_path()
    receipt = validate_payload_v1(payload)
    assert (receipt.peak_nav_mark_id, receipt.trough_nav_mark_id) == (
        "nav-12",
        "nav-18",
    )

    shifted_claim = _object(payload["claim"])
    shifted_claim.update(
        {
            "peakNavMarkId": "nav-20",
            "troughNavMarkId": "nav-24",
            "peakTimestampLabel": "2026-01-01T20:00:00Z",
            "troughTimestampLabel": "2026-01-02T00:00:00Z",
            "peakDateLabel": "2026-01-01",
            "troughDateLabel": "2026-01-02",
        }
    )
    with pytest.raises(CoordinateContractError, match="DRAWDOWN_PEAK_MARK_MISMATCH"):
        validate_payload_v1(payload)
