from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from enum import StrEnum
from typing import Final, NoReturn

SCHEMA_V1: Final = "cosmos.dq8.nav-drawdown-coordinates.v1"

_CLOCK_DOMAIN: Final = b"cosmos-dq8-clock-plan-v1\0"
_PRICE_DOMAIN: Final = b"cosmos-dq8-price-coordinates-v1\0"
_TRADE_DOMAIN: Final = b"cosmos-dq8-trade-events-v1\0"
_CASH_DOMAIN: Final = b"cosmos-dq8-economic-cash-events-v1\0"
_NAV_DOMAIN: Final = b"cosmos-dq8-nav-marks-v1\0"
_CLAIM_DOMAIN: Final = b"cosmos-dq8-nav-drawdown-claim-v1\0"
_PATH_DOMAIN: Final = b"cosmos-dq8-bound-path-v1\0"
_ECONOMICS_DOMAIN: Final = b"cosmos-dq8-derived-economics-v1\0"
_RECEIPT_DOMAIN: Final = b"cosmos-dq8-coordinate-receipt-v1\0"

_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@+\-/]{0,127}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_DECIMAL_PATTERN: Final = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
_MAX_CLOCK_MARKS: Final = 100_000
_MAX_PRICES: Final = 500_000
_MAX_EVENTS: Final = 200_000
_MAX_POSITIONS_PER_MARK: Final = 50_000
_MAX_DECIMAL_DIGITS: Final = 32
_MAX_DECIMAL_SCALE: Final = 18
_ARITHMETIC_PRECISION: Final = 100
_HOUR_US: Final = 3_600_000_000
_MAX_TIMESTAMP_US: Final = 253_402_300_799_999_999
_EPOCH: Final = datetime(1970, 1, 1, tzinfo=UTC)

type JsonObject = dict[str, object]


class CoordinateContractError(ValueError):
    """A stable, fail-closed DQ-8 contract failure."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class PriceUse(StrEnum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    VALUATION = "VALUATION"


class TradeRole(StrEnum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"


class CashEventKind(StrEnum):
    FEE = "FEE"
    FUNDING = "FUNDING"
    BORROW_INTEREST = "BORROW_INTEREST"
    REBATE = "REBATE"
    OTHER_COST = "OTHER_COST"


@dataclass(frozen=True, slots=True)
class ClockMarkV1:
    mark_id: str
    timestamp_us: int
    timestamp_label: str
    date_label: str

    def as_dict(self) -> JsonObject:
        return {
            "dateLabel": self.date_label,
            "markId": self.mark_id,
            "timestampLabel": self.timestamp_label,
            "timestampUs": self.timestamp_us,
        }


@dataclass(frozen=True, slots=True)
class NavClockPlanV1:
    path_id: str
    marks: tuple[ClockMarkV1, ...]
    clock_digest: str


@dataclass(frozen=True, slots=True)
class PriceCoordinateV1:
    price_id: str
    lot_id: str
    instrument: str
    venue: str
    use: PriceUse
    source_field: str
    source_artifact_sha256: str
    source_row_id: str
    mark_id: str
    timestamp_us: int
    timestamp_label: str
    date_label: str
    price: Decimal

    def as_dict(self) -> JsonObject:
        return {
            "dateLabel": self.date_label,
            "instrument": self.instrument,
            "lotId": self.lot_id,
            "markId": self.mark_id,
            "price": _decimal_text(self.price),
            "priceId": self.price_id,
            "sourceArtifactSha256": self.source_artifact_sha256,
            "sourceField": self.source_field,
            "sourceRowId": self.source_row_id,
            "timestampLabel": self.timestamp_label,
            "timestampUs": self.timestamp_us,
            "use": self.use.value,
            "venue": self.venue,
        }


@dataclass(frozen=True, slots=True)
class TradeEventV1:
    event_id: str
    lot_id: str
    instrument: str
    role: TradeRole
    mark_id: str
    price_id: str
    expected_price_field: str
    quantity_delta: Decimal

    def as_dict(self) -> JsonObject:
        return {
            "eventId": self.event_id,
            "expectedPriceField": self.expected_price_field,
            "instrument": self.instrument,
            "lotId": self.lot_id,
            "markId": self.mark_id,
            "priceId": self.price_id,
            "quantityDelta": _decimal_text(self.quantity_delta),
            "role": self.role.value,
        }


@dataclass(frozen=True, slots=True)
class EconomicCashEventV1:
    event_id: str
    mark_id: str
    kind: CashEventKind
    amount: Decimal
    evidence_sha256: str

    def as_dict(self) -> JsonObject:
        return {
            "amount": _decimal_text(self.amount),
            "eventId": self.event_id,
            "evidenceSha256": self.evidence_sha256,
            "kind": self.kind.value,
            "markId": self.mark_id,
        }


@dataclass(frozen=True, slots=True)
class PositionMarkV1:
    lot_id: str
    quantity: Decimal
    price_id: str
    expected_price_field: str
    market_value: Decimal

    def as_dict(self) -> JsonObject:
        return {
            "expectedPriceField": self.expected_price_field,
            "lotId": self.lot_id,
            "marketValue": _decimal_text(self.market_value),
            "priceId": self.price_id,
            "quantity": _decimal_text(self.quantity),
        }


@dataclass(frozen=True, slots=True)
class NavMarkV1:
    nav_mark_id: str
    clock_mark_id: str
    cash: Decimal
    positions: tuple[PositionMarkV1, ...]
    nav: Decimal

    def as_dict(self) -> JsonObject:
        return {
            "cash": _decimal_text(self.cash),
            "clockMarkId": self.clock_mark_id,
            "nav": _decimal_text(self.nav),
            "navMarkId": self.nav_mark_id,
            "positions": [
                position.as_dict()
                for position in sorted(self.positions, key=lambda item: item.lot_id)
            ],
        }


@dataclass(frozen=True, slots=True)
class NavDrawdownClaimV1:
    start_nav_mark_id: str
    end_nav_mark_id: str
    starting_nav: Decimal
    ending_nav: Decimal
    trade_cash_change: Decimal
    economic_cash_change: Decimal
    net_result: Decimal
    return_numerator: Decimal
    return_denominator: Decimal
    cash_duration_us: int
    cash_hours: int
    maximum_drawdown_loss: Decimal
    maximum_drawdown_peak: Decimal
    peak_nav_mark_id: str
    trough_nav_mark_id: str
    peak_timestamp_label: str
    trough_timestamp_label: str
    peak_date_label: str
    trough_date_label: str

    def as_dict(self) -> JsonObject:
        return {
            "cashDurationUs": self.cash_duration_us,
            "cashHours": self.cash_hours,
            "economicCashChange": _decimal_text(self.economic_cash_change),
            "endNavMarkId": self.end_nav_mark_id,
            "endingNav": _decimal_text(self.ending_nav),
            "maximumDrawdownLoss": _decimal_text(self.maximum_drawdown_loss),
            "maximumDrawdownPeak": _decimal_text(self.maximum_drawdown_peak),
            "netResult": _decimal_text(self.net_result),
            "peakDateLabel": self.peak_date_label,
            "peakNavMarkId": self.peak_nav_mark_id,
            "peakTimestampLabel": self.peak_timestamp_label,
            "returnDenominator": _decimal_text(self.return_denominator),
            "returnNumerator": _decimal_text(self.return_numerator),
            "startNavMarkId": self.start_nav_mark_id,
            "startingNav": _decimal_text(self.starting_nav),
            "tradeCashChange": _decimal_text(self.trade_cash_change),
            "troughDateLabel": self.trough_date_label,
            "troughNavMarkId": self.trough_nav_mark_id,
            "troughTimestampLabel": self.trough_timestamp_label,
        }


@dataclass(frozen=True, slots=True)
class NavDrawdownReceiptV1:
    schema: str
    path_id: str
    clock_digest: str
    price_coordinate_digest: str
    trade_event_digest: str
    economic_cash_event_digest: str
    nav_mark_digest: str
    claim_digest: str
    path_digest: str
    economics_digest: str
    clock_mark_count: int
    price_coordinate_count: int
    trade_event_count: int
    economic_cash_event_count: int
    starting_nav: Decimal
    ending_nav: Decimal
    trade_cash_change: Decimal
    economic_cash_change: Decimal
    net_result: Decimal
    return_numerator: Decimal
    return_denominator: Decimal
    cash_duration_us: int
    cash_hours: int
    maximum_drawdown_loss: Decimal
    maximum_drawdown_peak: Decimal
    peak_nav_mark_id: str
    trough_nav_mark_id: str
    peak_timestamp_label: str
    trough_timestamp_label: str
    peak_date_label: str
    trough_date_label: str
    authority: str
    receipt_digest: str

    def as_dict(self) -> JsonObject:
        return {
            "authority": self.authority,
            "cashDurationUs": self.cash_duration_us,
            "cashHours": self.cash_hours,
            "claimDigest": self.claim_digest,
            "clockDigest": self.clock_digest,
            "clockMarkCount": self.clock_mark_count,
            "economicCashChange": _decimal_text(self.economic_cash_change),
            "economicCashEventCount": self.economic_cash_event_count,
            "economicCashEventDigest": self.economic_cash_event_digest,
            "economicsDigest": self.economics_digest,
            "endingNav": _decimal_text(self.ending_nav),
            "maximumDrawdownLoss": _decimal_text(self.maximum_drawdown_loss),
            "maximumDrawdownPeak": _decimal_text(self.maximum_drawdown_peak),
            "navMarkDigest": self.nav_mark_digest,
            "netResult": _decimal_text(self.net_result),
            "pathDigest": self.path_digest,
            "pathId": self.path_id,
            "peakDateLabel": self.peak_date_label,
            "peakNavMarkId": self.peak_nav_mark_id,
            "peakTimestampLabel": self.peak_timestamp_label,
            "priceCoordinateCount": self.price_coordinate_count,
            "priceCoordinateDigest": self.price_coordinate_digest,
            "receiptDigest": self.receipt_digest,
            "returnDenominator": _decimal_text(self.return_denominator),
            "returnNumerator": _decimal_text(self.return_numerator),
            "schema": self.schema,
            "startingNav": _decimal_text(self.starting_nav),
            "tradeCashChange": _decimal_text(self.trade_cash_change),
            "tradeEventCount": self.trade_event_count,
            "tradeEventDigest": self.trade_event_digest,
            "troughDateLabel": self.trough_date_label,
            "troughNavMarkId": self.trough_nav_mark_id,
            "troughTimestampLabel": self.trough_timestamp_label,
        }

    def canonical_bytes(self) -> bytes:
        return _canonical_json_bytes(self.as_dict())


def _fail(code: str, detail: str) -> NoReturn:
    raise CoordinateContractError(code, detail)


def _canonical_json_bytes(value: object) -> bytes:
    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise CoordinateContractError(
            "CANONICAL_JSON_INVALID", "value is outside the frozen JSON domain"
        ) from error
    return f"{encoded}\n".encode("utf-8", errors="strict")


def _digest(domain: bytes, value: object) -> str:
    return hashlib.sha256(domain + _canonical_json_bytes(value)).hexdigest()


def _decimal_text(value: Decimal) -> str:
    if value == 0:
        return "0"
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _require_id(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _ID_PATTERN.fullmatch(value) is None:
        _fail("ID_INVALID", f"{field} must match the frozen ASCII identifier contract")
    return value


def _require_sha256(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        _fail("DIGEST_INVALID", f"{field} must be lowercase SHA-256 hex")
    return value


def _require_string(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        _fail("STRING_INVALID", f"{field} must be a nonempty bounded string")
    return value


def _require_int(value: object, *, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail("INTEGER_INVALID", f"{field} must be a strict integer")
    if not minimum <= value <= maximum:
        _fail("INTEGER_OUT_OF_RANGE", f"{field} must be in [{minimum}, {maximum}]")
    return value


def _require_decimal(
    value: object,
    *,
    field: str,
    positive: bool = False,
    nonnegative: bool = False,
    nonzero: bool = False,
) -> Decimal:
    if not isinstance(value, str) or _DECIMAL_PATTERN.fullmatch(value) is None:
        _fail(
            "DECIMAL_INVALID",
            f"{field} must be a canonical non-exponent decimal string",
        )
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise CoordinateContractError("DECIMAL_INVALID", f"{field} is not finite") from error
    if not parsed.is_finite() or _decimal_text(parsed) != value:
        _fail("DECIMAL_NONCANONICAL", f"{field} must use the minimal canonical spelling")
    return _checked_decimal(
        parsed,
        field=field,
        positive=positive,
        nonnegative=nonnegative,
        nonzero=nonzero,
    )


def _checked_decimal(
    value: object,
    *,
    field: str,
    positive: bool = False,
    nonnegative: bool = False,
    nonzero: bool = False,
) -> Decimal:
    if not isinstance(value, Decimal) or not value.is_finite():
        _fail("DECIMAL_INVALID", f"{field} must be a finite Decimal")
    decimal_tuple = value.as_tuple()
    digits = len(decimal_tuple.digits)
    exponent = decimal_tuple.exponent
    if not isinstance(exponent, int):
        _fail("DECIMAL_NONCANONICAL", f"{field} must be finite")
    integral_digits = digits + max(0, exponent)
    scale = max(0, -exponent)
    if integral_digits > _MAX_DECIMAL_DIGITS or scale > _MAX_DECIMAL_SCALE:
        _fail("DECIMAL_OUT_OF_RANGE", f"{field} exceeds the frozen decimal bounds")
    if positive and value <= 0:
        _fail("DECIMAL_OUT_OF_RANGE", f"{field} must be positive")
    if nonnegative and value < 0:
        _fail("DECIMAL_OUT_OF_RANGE", f"{field} must be nonnegative")
    if nonzero and value == 0:
        _fail("DECIMAL_OUT_OF_RANGE", f"{field} must be nonzero")
    return value


def _require_mapping(value: object, *, field: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        _fail("OBJECT_REQUIRED", f"{field} must be an object")
    if not all(isinstance(key, str) for key in value):
        _fail("OBJECT_KEY_INVALID", f"{field} keys must be strings")
    return value


def _require_list(
    value: object,
    *,
    field: str,
    minimum: int,
    maximum: int,
) -> list[object]:
    if not isinstance(value, list):
        _fail("ARRAY_REQUIRED", f"{field} must be an array")
    if not minimum <= len(value) <= maximum:
        _fail(
            "CARDINALITY_INVALID",
            f"{field} cardinality must be in [{minimum}, {maximum}]",
        )
    return value


def _require_fields(
    value: Mapping[str, object],
    *,
    field: str,
    expected: frozenset[str],
) -> None:
    actual = frozenset(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        _fail(
            "FIELD_SET_INVALID",
            f"{field} has missing={missing!r} extra={extra!r}",
        )


def _enum_value[T: StrEnum](
    enum_type: type[T],
    value: object,
    *,
    field: str,
    code: str,
) -> T:
    if not isinstance(value, str):
        _fail(code, f"{field} must be a frozen enum value")
    try:
        return enum_type(value)
    except ValueError as error:
        raise CoordinateContractError(code, f"{field} is not a frozen enum value") from error


def _labels_for_timestamp(timestamp_us: int) -> tuple[str, str]:
    instant = _EPOCH + timedelta(microseconds=timestamp_us)
    if instant.microsecond:
        timestamp_label = instant.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    else:
        timestamp_label = instant.strftime("%Y-%m-%dT%H:%M:%SZ")
    return timestamp_label, instant.strftime("%Y-%m-%d")


def _validate_clock_marks(marks: tuple[ClockMarkV1, ...]) -> None:
    if not 2 <= len(marks) <= _MAX_CLOCK_MARKS:
        _fail(
            "CLOCK_CARDINALITY_INVALID",
            f"clock marks must contain between 2 and {_MAX_CLOCK_MARKS} rows",
        )
    seen_ids: set[str] = set()
    previous_timestamp: int | None = None
    for index, mark in enumerate(marks):
        if not isinstance(mark, ClockMarkV1):
            _fail(
                "CLOCK_MARK_INVALID",
                f"clockPlan.marks[{index}] has the wrong type",
            )
        _require_id(mark.mark_id, field=f"clockPlan.marks[{index}].markId")
        if mark.mark_id in seen_ids:
            _fail("CLOCK_MARK_DUPLICATE", f"duplicate clock mark {mark.mark_id}")
        seen_ids.add(mark.mark_id)
        _require_int(
            mark.timestamp_us,
            field=f"clockPlan.marks[{index}].timestampUs",
            minimum=0,
            maximum=_MAX_TIMESTAMP_US,
        )
        expected_timestamp, expected_date = _labels_for_timestamp(mark.timestamp_us)
        if mark.timestamp_label != expected_timestamp:
            _fail(
                "TIMESTAMP_LABEL_SHIFTED",
                f"clock mark {mark.mark_id} timestamp label is not its exact UTC instant",
            )
        if mark.date_label != expected_date:
            _fail(
                "DATE_LABEL_SHIFTED",
                f"clock mark {mark.mark_id} date label is not its exact UTC date",
            )
        if previous_timestamp is not None:
            if mark.timestamp_us <= previous_timestamp:
                _fail("CLOCK_NOT_STRICTLY_INCREASING", "clock timestamps must strictly increase")
            if (mark.timestamp_us - previous_timestamp) % _HOUR_US != 0:
                _fail(
                    "CLOCK_INTERVAL_NOT_WHOLE_HOURS",
                    "every clock interval must contain a whole number of hours",
                )
        previous_timestamp = mark.timestamp_us


def build_clock_digest_v1(path_id: str, marks: tuple[ClockMarkV1, ...]) -> str:
    checked_path = _require_id(path_id, field="clockPlan.pathId")
    if not isinstance(marks, tuple):
        _fail("TUPLE_REQUIRED", "clockPlan.marks must be an immutable tuple")
    _validate_clock_marks(marks)
    return _digest(
        _CLOCK_DOMAIN,
        {
            "marks": [mark.as_dict() for mark in marks],
            "pathId": checked_path,
            "version": 1,
        },
    )


def _validate_price_labels(
    price: PriceCoordinateV1,
    *,
    index: int,
) -> None:
    _require_id(price.price_id, field=f"prices[{index}].priceId")
    _require_id(price.lot_id, field=f"prices[{index}].lotId")
    _require_id(price.instrument, field=f"prices[{index}].instrument")
    _require_id(price.venue, field=f"prices[{index}].venue")
    _require_id(price.source_field, field=f"prices[{index}].sourceField")
    _require_sha256(
        price.source_artifact_sha256,
        field=f"prices[{index}].sourceArtifactSha256",
    )
    _require_id(price.source_row_id, field=f"prices[{index}].sourceRowId")
    _require_id(price.mark_id, field=f"prices[{index}].markId")
    _require_int(
        price.timestamp_us,
        field=f"prices[{index}].timestampUs",
        minimum=0,
        maximum=_MAX_TIMESTAMP_US,
    )
    expected_timestamp, expected_date = _labels_for_timestamp(price.timestamp_us)
    if price.timestamp_label != expected_timestamp:
        _fail(
            "PRICE_TIMESTAMP_LABEL_SHIFTED",
            f"price {price.price_id} timestamp label is not its source instant",
        )
    if price.date_label != expected_date:
        _fail(
            "PRICE_DATE_LABEL_SHIFTED",
            f"price {price.price_id} date label is not its source UTC date",
        )
    if not isinstance(price.use, PriceUse):
        _fail("PRICE_USE_INVALID", f"price {price.price_id} has an invalid use")
    _checked_decimal(
        price.price,
        field=f"prices[{index}].price",
        positive=True,
    )


def _consume_price(price_id: str, *, consumed: set[str]) -> None:
    if price_id in consumed:
        _fail("PRICE_COORDINATE_REUSED", f"price coordinate {price_id} was consumed twice")
    consumed.add(price_id)


def _bind_trade_price(
    event: TradeEventV1,
    *,
    expected_use: PriceUse,
    price_by_id: Mapping[str, PriceCoordinateV1],
    clock_by_id: Mapping[str, ClockMarkV1],
    consumed: set[str],
) -> PriceCoordinateV1:
    price = price_by_id.get(event.price_id)
    if price is None:
        _fail(
            f"{event.role.value}_PRICE_UNBOUND",
            f"trade event {event.event_id} references no exact price coordinate",
        )
    clock = clock_by_id[event.mark_id]
    if price.use is not expected_use:
        _fail(
            f"{event.role.value}_PRICE_USE_MISMATCH",
            f"trade event {event.event_id} uses the wrong price role",
        )
    if price.lot_id != event.lot_id or price.instrument != event.instrument:
        _fail(
            f"{event.role.value}_PRICE_IDENTITY_MISMATCH",
            f"trade event {event.event_id} price identity differs",
        )
    if price.source_field != event.expected_price_field:
        _fail(
            f"{event.role.value}_PRICE_FIELD_MISMATCH",
            f"trade event {event.event_id} uses the wrong source field",
        )
    if (
        price.mark_id != clock.mark_id
        or price.timestamp_us != clock.timestamp_us
        or price.timestamp_label != clock.timestamp_label
        or price.date_label != clock.date_label
    ):
        _fail(
            f"{event.role.value}_PRICE_COORDINATE_SHIFTED",
            f"trade event {event.event_id} price is not bound to its exact clock mark",
        )
    _consume_price(price.price_id, consumed=consumed)
    return price


def _bind_valuation_price(
    position: PositionMarkV1,
    *,
    nav_mark: NavMarkV1,
    instrument: str,
    clock: ClockMarkV1,
    price_by_id: Mapping[str, PriceCoordinateV1],
    consumed: set[str],
) -> PriceCoordinateV1:
    price = price_by_id.get(position.price_id)
    if price is None:
        _fail(
            "VALUATION_PRICE_UNBOUND",
            f"position {position.lot_id} references no exact valuation price",
        )
    if price.use is not PriceUse.VALUATION:
        _fail(
            "VALUATION_PRICE_USE_MISMATCH",
            f"position {position.lot_id} does not use a valuation coordinate",
        )
    if price.lot_id != position.lot_id or price.instrument != instrument:
        _fail(
            "VALUATION_PRICE_IDENTITY_MISMATCH",
            f"position {position.lot_id} valuation identity differs",
        )
    if price.source_field != position.expected_price_field:
        _fail(
            "VALUATION_PRICE_FIELD_MISMATCH",
            f"position {position.lot_id} uses the wrong source field",
        )
    if (
        price.mark_id != clock.mark_id
        or price.timestamp_us != clock.timestamp_us
        or price.timestamp_label != clock.timestamp_label
        or price.date_label != clock.date_label
    ):
        _fail(
            "VALUATION_PRICE_COORDINATE_SHIFTED",
            f"position {position.lot_id} valuation is not bound to nav mark {nav_mark.nav_mark_id}",
        )
    _consume_price(price.price_id, consumed=consumed)
    return price


def _receipt_payload(
    *,
    schema: str,
    path_id: str,
    clock_digest: str,
    price_coordinate_digest: str,
    trade_event_digest: str,
    economic_cash_event_digest: str,
    nav_mark_digest: str,
    claim_digest: str,
    path_digest: str,
    economics_digest: str,
    clock_mark_count: int,
    price_coordinate_count: int,
    trade_event_count: int,
    economic_cash_event_count: int,
    starting_nav: Decimal,
    ending_nav: Decimal,
    trade_cash_change: Decimal,
    economic_cash_change: Decimal,
    net_result: Decimal,
    return_numerator: Decimal,
    return_denominator: Decimal,
    cash_duration_us: int,
    cash_hours: int,
    maximum_drawdown_loss: Decimal,
    maximum_drawdown_peak: Decimal,
    peak_nav_mark_id: str,
    trough_nav_mark_id: str,
    peak_timestamp_label: str,
    trough_timestamp_label: str,
    peak_date_label: str,
    trough_date_label: str,
) -> JsonObject:
    return {
        "authority": "NONE",
        "cashDurationUs": cash_duration_us,
        "cashHours": cash_hours,
        "claimDigest": claim_digest,
        "clockDigest": clock_digest,
        "clockMarkCount": clock_mark_count,
        "economicCashChange": _decimal_text(economic_cash_change),
        "economicCashEventCount": economic_cash_event_count,
        "economicCashEventDigest": economic_cash_event_digest,
        "economicsDigest": economics_digest,
        "endingNav": _decimal_text(ending_nav),
        "maximumDrawdownLoss": _decimal_text(maximum_drawdown_loss),
        "maximumDrawdownPeak": _decimal_text(maximum_drawdown_peak),
        "navMarkDigest": nav_mark_digest,
        "netResult": _decimal_text(net_result),
        "pathDigest": path_digest,
        "pathId": path_id,
        "peakDateLabel": peak_date_label,
        "peakNavMarkId": peak_nav_mark_id,
        "peakTimestampLabel": peak_timestamp_label,
        "priceCoordinateCount": price_coordinate_count,
        "priceCoordinateDigest": price_coordinate_digest,
        "returnDenominator": _decimal_text(return_denominator),
        "returnNumerator": _decimal_text(return_numerator),
        "schema": schema,
        "startingNav": _decimal_text(starting_nav),
        "tradeCashChange": _decimal_text(trade_cash_change),
        "tradeEventCount": trade_event_count,
        "tradeEventDigest": trade_event_digest,
        "troughDateLabel": trough_date_label,
        "troughNavMarkId": trough_nav_mark_id,
        "troughTimestampLabel": trough_timestamp_label,
    }


def _validate_claim_values(claim: NavDrawdownClaimV1) -> None:
    for id_field, id_value in (
        ("claim.startNavMarkId", claim.start_nav_mark_id),
        ("claim.endNavMarkId", claim.end_nav_mark_id),
        ("claim.peakNavMarkId", claim.peak_nav_mark_id),
        ("claim.troughNavMarkId", claim.trough_nav_mark_id),
    ):
        _require_id(id_value, field=id_field)
    for label_field, label_value in (
        ("claim.peakTimestampLabel", claim.peak_timestamp_label),
        ("claim.troughTimestampLabel", claim.trough_timestamp_label),
        ("claim.peakDateLabel", claim.peak_date_label),
        ("claim.troughDateLabel", claim.trough_date_label),
    ):
        _require_string(label_value, field=label_field)
    for decimal_field, decimal_value in (
        ("claim.tradeCashChange", claim.trade_cash_change),
        ("claim.economicCashChange", claim.economic_cash_change),
        ("claim.netResult", claim.net_result),
        ("claim.returnNumerator", claim.return_numerator),
    ):
        _checked_decimal(decimal_value, field=decimal_field)
    for positive_field, positive_value in (
        ("claim.startingNav", claim.starting_nav),
        ("claim.endingNav", claim.ending_nav),
        ("claim.returnDenominator", claim.return_denominator),
        ("claim.maximumDrawdownPeak", claim.maximum_drawdown_peak),
    ):
        _checked_decimal(positive_value, field=positive_field, positive=True)
    _checked_decimal(
        claim.maximum_drawdown_loss,
        field="claim.maximumDrawdownLoss",
        nonnegative=True,
    )
    _require_int(
        claim.cash_duration_us,
        field="claim.cashDurationUs",
        minimum=0,
        maximum=_MAX_TIMESTAMP_US,
    )
    _require_int(
        claim.cash_hours,
        field="claim.cashHours",
        minimum=0,
        maximum=_MAX_TIMESTAMP_US // _HOUR_US,
    )


def validate_nav_drawdown_coordinates_v1(
    *,
    schema: str,
    starting_cash: Decimal,
    clock_plan: NavClockPlanV1,
    prices: tuple[PriceCoordinateV1, ...],
    trades: tuple[TradeEventV1, ...],
    cash_events: tuple[EconomicCashEventV1, ...],
    marks: tuple[NavMarkV1, ...],
    claim: NavDrawdownClaimV1,
) -> NavDrawdownReceiptV1:
    """Replay and bind one flat-to-flat research NAV/drawdown path."""

    if schema != SCHEMA_V1:
        _fail("SCHEMA_MISMATCH", f"schema must equal {SCHEMA_V1}")
    if not isinstance(clock_plan, NavClockPlanV1):
        _fail("CLOCK_PLAN_INVALID", "clock_plan must be NavClockPlanV1")
    if not all(isinstance(value, tuple) for value in (prices, trades, cash_events, marks)):
        _fail("TUPLE_REQUIRED", "all coordinate collections must be immutable tuples")
    if not isinstance(claim, NavDrawdownClaimV1):
        _fail("CLAIM_INVALID", "claim must be NavDrawdownClaimV1")
    _checked_decimal(starting_cash, field="startingCash", positive=True)
    _validate_claim_values(claim)
    path_id = _require_id(clock_plan.path_id, field="clockPlan.pathId")
    expected_clock_digest = build_clock_digest_v1(path_id, clock_plan.marks)
    if clock_plan.clock_digest != expected_clock_digest:
        _fail("CLOCK_DIGEST_MISMATCH", "clock plan digest does not bind its exact marks")
    _require_sha256(clock_plan.clock_digest, field="clockPlan.clockDigest")
    if len(prices) > _MAX_PRICES:
        _fail("PRICE_CARDINALITY_INVALID", "price coordinate capacity exceeded")
    if len(trades) > _MAX_EVENTS or len(cash_events) > _MAX_EVENTS:
        _fail("EVENT_CARDINALITY_INVALID", "event capacity exceeded")

    clock_by_id = {mark.mark_id: mark for mark in clock_plan.marks}
    clock_index = {mark.mark_id: index for index, mark in enumerate(clock_plan.marks)}

    price_by_id: dict[str, PriceCoordinateV1] = {}
    for index, price in enumerate(prices):
        if not isinstance(price, PriceCoordinateV1):
            _fail("PRICE_COORDINATE_INVALID", f"prices[{index}] has the wrong type")
        _validate_price_labels(price, index=index)
        if price.price_id in price_by_id:
            _fail("PRICE_COORDINATE_DUPLICATE", f"duplicate price ID {price.price_id}")
        if price.mark_id not in clock_by_id:
            _fail(
                "PRICE_CLOCK_MARK_UNBOUND",
                f"price {price.price_id} references no clock mark",
            )
        price_by_id[price.price_id] = price

    trade_by_id: dict[str, TradeEventV1] = {}
    trades_by_lot: dict[str, list[TradeEventV1]] = defaultdict(list)
    trades_by_mark: dict[str, list[TradeEventV1]] = defaultdict(list)
    for index, trade_event in enumerate(trades):
        if not isinstance(trade_event, TradeEventV1):
            _fail("TRADE_EVENT_INVALID", f"trades[{index}] has the wrong type")
        _require_id(trade_event.event_id, field=f"trades[{index}].eventId")
        _require_id(trade_event.lot_id, field=f"trades[{index}].lotId")
        _require_id(trade_event.instrument, field=f"trades[{index}].instrument")
        _require_id(trade_event.mark_id, field=f"trades[{index}].markId")
        _require_id(trade_event.price_id, field=f"trades[{index}].priceId")
        _require_id(
            trade_event.expected_price_field,
            field=f"trades[{index}].expectedPriceField",
        )
        if not isinstance(trade_event.role, TradeRole):
            _fail(
                "TRADE_ROLE_INVALID",
                f"trade event {trade_event.event_id} has an invalid role",
            )
        _checked_decimal(
            trade_event.quantity_delta,
            field=f"trades[{index}].quantityDelta",
            nonzero=True,
        )
        if trade_event.event_id in trade_by_id:
            _fail(
                "TRADE_EVENT_DUPLICATE",
                f"duplicate trade event {trade_event.event_id}",
            )
        if trade_event.mark_id not in clock_by_id:
            _fail(
                "TRADE_CLOCK_MARK_UNBOUND",
                f"trade event {trade_event.event_id} has no clock mark",
            )
        trade_by_id[trade_event.event_id] = trade_event
        trades_by_lot[trade_event.lot_id].append(trade_event)
        trades_by_mark[trade_event.mark_id].append(trade_event)

    lot_instrument: dict[str, str] = {}
    for lot_id, lot_events in trades_by_lot.items():
        if len(lot_events) != 2:
            _fail("LOT_NOT_FULLY_CLOSED", f"lot {lot_id} must have one entry and one exit")
        entries = [event for event in lot_events if event.role is TradeRole.ENTRY]
        exits = [event for event in lot_events if event.role is TradeRole.EXIT]
        if len(entries) != 1 or len(exits) != 1:
            _fail("LOT_ROLE_INVALID", f"lot {lot_id} must have exactly one entry and exit")
        entry = entries[0]
        exit_event = exits[0]
        if entry.instrument != exit_event.instrument:
            _fail("LOT_INSTRUMENT_MISMATCH", f"lot {lot_id} changes instrument")
        if clock_index[entry.mark_id] >= clock_index[exit_event.mark_id]:
            _fail("LOT_CHRONOLOGY_INVALID", f"lot {lot_id} exit must follow entry")
        with localcontext() as context:
            context.prec = _ARITHMETIC_PRECISION
            closed_quantity = entry.quantity_delta + exit_event.quantity_delta
        if closed_quantity != 0:
            _fail("LOT_QUANTITY_NOT_CLOSED", f"lot {lot_id} exit does not exactly flatten entry")
        lot_instrument[lot_id] = entry.instrument

    cash_event_by_id: dict[str, EconomicCashEventV1] = {}
    cash_events_by_mark: dict[str, list[EconomicCashEventV1]] = defaultdict(list)
    for index, cash_event in enumerate(cash_events):
        if not isinstance(cash_event, EconomicCashEventV1):
            _fail("CASH_EVENT_INVALID", f"cashEvents[{index}] has the wrong type")
        _require_id(cash_event.event_id, field=f"cashEvents[{index}].eventId")
        _require_id(cash_event.mark_id, field=f"cashEvents[{index}].markId")
        _require_sha256(
            cash_event.evidence_sha256,
            field=f"cashEvents[{index}].evidenceSha256",
        )
        if not isinstance(cash_event.kind, CashEventKind):
            _fail(
                "CASH_EVENT_KIND_INVALID",
                f"cash event {cash_event.event_id} has an invalid kind",
            )
        _checked_decimal(
            cash_event.amount,
            field=f"cashEvents[{index}].amount",
            nonzero=True,
        )
        if (
            cash_event.kind
            in {
                CashEventKind.FEE,
                CashEventKind.BORROW_INTEREST,
                CashEventKind.OTHER_COST,
            }
            and cash_event.amount >= 0
        ):
            _fail(
                "CASH_EVENT_SIGN_INVALID",
                f"cash event {cash_event.event_id} must be negative",
            )
        if cash_event.kind is CashEventKind.REBATE and cash_event.amount <= 0:
            _fail(
                "CASH_EVENT_SIGN_INVALID",
                f"cash event {cash_event.event_id} must be positive",
            )
        if cash_event.event_id in cash_event_by_id:
            _fail(
                "CASH_EVENT_DUPLICATE",
                f"duplicate cash event {cash_event.event_id}",
            )
        if cash_event.mark_id not in clock_by_id:
            _fail(
                "CASH_EVENT_CLOCK_MARK_UNBOUND",
                f"cash event {cash_event.event_id} has no mark",
            )
        cash_event_by_id[cash_event.event_id] = cash_event
        cash_events_by_mark[cash_event.mark_id].append(cash_event)

    nav_by_clock: dict[str, NavMarkV1] = {}
    nav_id_seen: set[str] = set()
    for index, nav_mark in enumerate(marks):
        if not isinstance(nav_mark, NavMarkV1):
            _fail("NAV_MARK_INVALID", f"navMarks[{index}] has the wrong type")
        _require_id(nav_mark.nav_mark_id, field=f"navMarks[{index}].navMarkId")
        _require_id(nav_mark.clock_mark_id, field=f"navMarks[{index}].clockMarkId")
        if nav_mark.nav_mark_id in nav_id_seen:
            _fail("NAV_MARK_ID_DUPLICATE", f"duplicate NAV mark {nav_mark.nav_mark_id}")
        if nav_mark.clock_mark_id in nav_by_clock:
            _fail(
                "NAV_CLOCK_MARK_DUPLICATE",
                f"clock mark {nav_mark.clock_mark_id} has two NAV marks",
            )
        if nav_mark.clock_mark_id not in clock_by_id:
            _fail(
                "NAV_CLOCK_MARK_UNBOUND",
                f"NAV mark {nav_mark.nav_mark_id} has no exact clock mark",
            )
        _checked_decimal(
            nav_mark.cash,
            field=f"navMarks[{index}].cash",
        )
        _checked_decimal(
            nav_mark.nav,
            field=f"navMarks[{index}].nav",
            positive=True,
        )
        if not isinstance(nav_mark.positions, tuple):
            _fail(
                "TUPLE_REQUIRED",
                f"navMarks[{index}].positions must be an immutable tuple",
            )
        if len(nav_mark.positions) > _MAX_POSITIONS_PER_MARK:
            _fail("POSITION_CARDINALITY_INVALID", "position mark capacity exceeded")
        nav_id_seen.add(nav_mark.nav_mark_id)
        nav_by_clock[nav_mark.clock_mark_id] = nav_mark
    if set(nav_by_clock) != set(clock_by_id):
        _fail("NAV_CLOCK_PLAN_MISMATCH", "every clock mark must have exactly one NAV mark")

    first_clock = clock_plan.marks[0]
    if trades_by_mark[first_clock.mark_id] or cash_events_by_mark[first_clock.mark_id]:
        _fail("STARTING_MARK_HAS_EVENTS", "the starting NAV anchor must precede all events")

    consumed_prices: set[str] = set()
    open_quantities: dict[str, Decimal] = {}
    cash = starting_cash
    trade_cash_change = Decimal(0)
    economic_cash_change = Decimal(0)
    open_after_mark: list[bool] = []
    ordered_nav: list[NavMarkV1] = []

    with localcontext() as context:
        context.prec = _ARITHMETIC_PRECISION
        for clock in clock_plan.marks:
            nav_mark = nav_by_clock[clock.mark_id]
            ordered_nav.append(nav_mark)

            events = sorted(
                trades_by_mark[clock.mark_id],
                key=lambda event: (0 if event.role is TradeRole.EXIT else 1, event.event_id),
            )
            for trade_event in events:
                expected_use = (
                    PriceUse.ENTRY if trade_event.role is TradeRole.ENTRY else PriceUse.EXIT
                )
                price = _bind_trade_price(
                    trade_event,
                    expected_use=expected_use,
                    price_by_id=price_by_id,
                    clock_by_id=clock_by_id,
                    consumed=consumed_prices,
                )
                current_quantity = open_quantities.get(
                    trade_event.lot_id,
                    Decimal(0),
                )
                if trade_event.role is TradeRole.ENTRY:
                    if current_quantity != 0:
                        _fail(
                            "LOT_DOUBLE_ENTRY",
                            f"lot {trade_event.lot_id} is already open",
                        )
                elif current_quantity == 0:
                    _fail(
                        "LOT_EXIT_WITHOUT_ENTRY",
                        f"lot {trade_event.lot_id} is not open",
                    )
                cash_effect = -(trade_event.quantity_delta * price.price)
                cash += cash_effect
                trade_cash_change += cash_effect
                next_quantity = current_quantity + trade_event.quantity_delta
                if next_quantity == 0:
                    open_quantities.pop(trade_event.lot_id, None)
                else:
                    open_quantities[trade_event.lot_id] = next_quantity

            for cash_event in sorted(
                cash_events_by_mark[clock.mark_id],
                key=lambda item: item.event_id,
            ):
                cash += cash_event.amount
                economic_cash_change += cash_event.amount

            if nav_mark.cash != cash:
                _fail(
                    "NAV_CASH_RECONCILIATION_MISMATCH",
                    f"NAV mark {nav_mark.nav_mark_id} cash does not replay exactly",
                )

            position_by_lot: dict[str, PositionMarkV1] = {}
            for position_index, position in enumerate(nav_mark.positions):
                if not isinstance(position, PositionMarkV1):
                    _fail(
                        "POSITION_MARK_INVALID",
                        f"NAV mark {nav_mark.nav_mark_id} position {position_index} is invalid",
                    )
                _require_id(
                    position.lot_id,
                    field=f"navMark[{nav_mark.nav_mark_id}].positions[{position_index}].lotId",
                )
                _require_id(
                    position.price_id,
                    field=f"navMark[{nav_mark.nav_mark_id}].positions[{position_index}].priceId",
                )
                _require_id(
                    position.expected_price_field,
                    field=(
                        f"navMark[{nav_mark.nav_mark_id}].positions"
                        f"[{position_index}].expectedPriceField"
                    ),
                )
                _checked_decimal(
                    position.quantity,
                    field=(f"navMark[{nav_mark.nav_mark_id}].positions[{position_index}].quantity"),
                    nonzero=True,
                )
                _checked_decimal(
                    position.market_value,
                    field=(
                        f"navMark[{nav_mark.nav_mark_id}].positions[{position_index}].marketValue"
                    ),
                )
                if position.lot_id in position_by_lot:
                    _fail(
                        "POSITION_MARK_DUPLICATE",
                        f"NAV mark {nav_mark.nav_mark_id} repeats lot {position.lot_id}",
                    )
                position_by_lot[position.lot_id] = position
            if set(position_by_lot) != set(open_quantities):
                _fail(
                    "POSITION_MARK_SET_MISMATCH",
                    f"NAV mark {nav_mark.nav_mark_id} does not mark every open lot exactly once",
                )

            position_total = Decimal(0)
            for lot_id in sorted(open_quantities):
                position = position_by_lot[lot_id]
                expected_quantity = open_quantities[lot_id]
                if position.quantity != expected_quantity:
                    _fail(
                        "POSITION_QUANTITY_MISMATCH",
                        f"NAV mark {nav_mark.nav_mark_id} lot {lot_id} quantity differs",
                    )
                valuation = _bind_valuation_price(
                    position,
                    nav_mark=nav_mark,
                    instrument=lot_instrument[lot_id],
                    clock=clock,
                    price_by_id=price_by_id,
                    consumed=consumed_prices,
                )
                expected_value = expected_quantity * valuation.price
                if position.market_value != expected_value:
                    _fail(
                        "POSITION_VALUE_MISMATCH",
                        f"NAV mark {nav_mark.nav_mark_id} lot {lot_id} value differs",
                    )
                position_total += expected_value
            if nav_mark.nav != cash + position_total:
                _fail(
                    "NAV_RECONCILIATION_MISMATCH",
                    f"NAV mark {nav_mark.nav_mark_id} is not cash plus marked positions",
                )
            open_after_mark.append(bool(open_quantities))

    first_nav = ordered_nav[0]
    last_nav = ordered_nav[-1]
    if first_nav.positions or first_nav.cash != starting_cash or first_nav.nav != starting_cash:
        _fail("STARTING_MARK_NOT_FLAT", "the first NAV mark must equal starting cash")
    if open_quantities or last_nav.positions:
        _fail("ENDING_MARK_NOT_FLAT", "the final NAV mark must be flat")
    if consumed_prices != set(price_by_id):
        orphaned = sorted(set(price_by_id) - consumed_prices)
        _fail(
            "PRICE_COORDINATE_UNBOUND",
            f"unconsumed price coordinate IDs remain: {orphaned!r}",
        )

    cash_duration_us = 0
    for index, is_open in enumerate(open_after_mark[:-1]):
        if not is_open:
            cash_duration_us += (
                clock_plan.marks[index + 1].timestamp_us - clock_plan.marks[index].timestamp_us
            )
    cash_hours = cash_duration_us // _HOUR_US

    peak_nav = first_nav.nav
    running_peak_mark = first_nav
    maximum_loss = Decimal(0)
    maximum_peak = first_nav.nav
    drawdown_peak_mark = first_nav
    drawdown_trough_mark = first_nav
    with localcontext() as context:
        context.prec = _ARITHMETIC_PRECISION
        for nav_mark in ordered_nav[1:]:
            if nav_mark.nav > peak_nav:
                peak_nav = nav_mark.nav
                running_peak_mark = nav_mark
            loss = peak_nav - nav_mark.nav
            if loss * maximum_peak > maximum_loss * peak_nav:
                maximum_loss = loss
                maximum_peak = peak_nav
                drawdown_peak_mark = running_peak_mark
                drawdown_trough_mark = nav_mark

    peak_clock = clock_by_id[drawdown_peak_mark.clock_mark_id]
    trough_clock = clock_by_id[drawdown_trough_mark.clock_mark_id]
    with localcontext() as context:
        context.prec = _ARITHMETIC_PRECISION
        net_result = last_nav.nav - first_nav.nav
        replayed_cash_change = trade_cash_change + economic_cash_change
    if net_result != replayed_cash_change:
        _fail(
            "INTERNAL_ENDPOINT_RECONCILIATION_MISMATCH",
            "flat endpoint economics do not equal replayed cash changes",
        )

    expected_claims: tuple[tuple[bool, str, str], ...] = (
        (
            claim.start_nav_mark_id == first_nav.nav_mark_id,
            "CLAIM_START_MARK_MISMATCH",
            "claim start mark is not the first validated NAV mark",
        ),
        (
            claim.end_nav_mark_id == last_nav.nav_mark_id,
            "CLAIM_END_MARK_MISMATCH",
            "claim end mark is not the final validated NAV mark",
        ),
        (
            claim.starting_nav == first_nav.nav,
            "STARTING_NAV_MISMATCH",
            "claimed starting NAV differs",
        ),
        (
            claim.ending_nav == last_nav.nav,
            "ENDING_NAV_MISMATCH",
            "claimed ending NAV differs",
        ),
        (
            claim.trade_cash_change == trade_cash_change,
            "TRADE_CASH_CHANGE_MISMATCH",
            "claimed trade cash change differs",
        ),
        (
            claim.economic_cash_change == economic_cash_change,
            "ECONOMIC_CASH_CHANGE_MISMATCH",
            "claimed economic cash change differs",
        ),
        (
            claim.net_result == net_result,
            "NET_RESULT_MISMATCH",
            "claimed endpoint net result differs",
        ),
        (
            claim.return_numerator == net_result,
            "RETURN_NUMERATOR_MISMATCH",
            "claimed return numerator differs",
        ),
        (
            claim.return_denominator == first_nav.nav,
            "RETURN_DENOMINATOR_MISMATCH",
            "claimed return denominator differs",
        ),
        (
            claim.cash_duration_us == cash_duration_us,
            "CASH_DURATION_MISMATCH",
            "claimed cash duration differs",
        ),
        (
            claim.cash_hours == cash_hours,
            "CASH_HOURS_MISMATCH",
            "claimed cash hours differ",
        ),
        (
            claim.maximum_drawdown_loss == maximum_loss,
            "DRAWDOWN_LOSS_MISMATCH",
            "claimed maximum drawdown loss differs",
        ),
        (
            claim.maximum_drawdown_peak == maximum_peak,
            "DRAWDOWN_PEAK_VALUE_MISMATCH",
            "claimed maximum drawdown peak differs",
        ),
        (
            claim.peak_nav_mark_id == drawdown_peak_mark.nav_mark_id,
            "DRAWDOWN_PEAK_MARK_MISMATCH",
            "claimed maximum drawdown peak mark differs",
        ),
        (
            claim.trough_nav_mark_id == drawdown_trough_mark.nav_mark_id,
            "DRAWDOWN_TROUGH_MARK_MISMATCH",
            "claimed maximum drawdown trough mark differs",
        ),
        (
            claim.peak_timestamp_label == peak_clock.timestamp_label,
            "DRAWDOWN_PEAK_TIMESTAMP_SHIFTED",
            "claimed peak timestamp label is shifted",
        ),
        (
            claim.trough_timestamp_label == trough_clock.timestamp_label,
            "DRAWDOWN_TROUGH_TIMESTAMP_SHIFTED",
            "claimed trough timestamp label is shifted",
        ),
        (
            claim.peak_date_label == peak_clock.date_label,
            "DRAWDOWN_PEAK_DATE_SHIFTED",
            "claimed peak date label is shifted",
        ),
        (
            claim.trough_date_label == trough_clock.date_label,
            "DRAWDOWN_TROUGH_DATE_SHIFTED",
            "claimed trough date label is shifted",
        ),
    )
    for valid, code, detail in expected_claims:
        if not valid:
            _fail(code, detail)

    price_coordinate_digest = _digest(
        _PRICE_DOMAIN,
        [price.as_dict() for price in sorted(prices, key=lambda item: item.price_id)],
    )
    trade_event_digest = _digest(
        _TRADE_DOMAIN,
        [event.as_dict() for event in sorted(trades, key=lambda item: item.event_id)],
    )
    economic_cash_event_digest = _digest(
        _CASH_DOMAIN,
        [event.as_dict() for event in sorted(cash_events, key=lambda item: item.event_id)],
    )
    nav_mark_digest = _digest(
        _NAV_DOMAIN,
        [nav_mark.as_dict() for nav_mark in ordered_nav],
    )
    claim_digest = _digest(_CLAIM_DOMAIN, claim.as_dict())
    path_digest = _digest(
        _PATH_DOMAIN,
        {
            "claimDigest": claim_digest,
            "clockDigest": clock_plan.clock_digest,
            "economicCashEventDigest": economic_cash_event_digest,
            "navMarkDigest": nav_mark_digest,
            "pathId": path_id,
            "priceCoordinateDigest": price_coordinate_digest,
            "schema": schema,
            "startingCash": _decimal_text(starting_cash),
            "tradeEventDigest": trade_event_digest,
        },
    )
    economics = {
        "cashDurationUs": cash_duration_us,
        "cashHours": cash_hours,
        "economicCashChange": _decimal_text(economic_cash_change),
        "endingNav": _decimal_text(last_nav.nav),
        "maximumDrawdownLoss": _decimal_text(maximum_loss),
        "maximumDrawdownPeak": _decimal_text(maximum_peak),
        "netResult": _decimal_text(net_result),
        "peakNavMarkId": drawdown_peak_mark.nav_mark_id,
        "returnDenominator": _decimal_text(first_nav.nav),
        "returnNumerator": _decimal_text(net_result),
        "startingNav": _decimal_text(first_nav.nav),
        "tradeCashChange": _decimal_text(trade_cash_change),
        "troughNavMarkId": drawdown_trough_mark.nav_mark_id,
    }
    economics_digest = _digest(_ECONOMICS_DOMAIN, economics)
    receipt_payload = _receipt_payload(
        schema=schema,
        path_id=path_id,
        clock_digest=clock_plan.clock_digest,
        price_coordinate_digest=price_coordinate_digest,
        trade_event_digest=trade_event_digest,
        economic_cash_event_digest=economic_cash_event_digest,
        nav_mark_digest=nav_mark_digest,
        claim_digest=claim_digest,
        path_digest=path_digest,
        economics_digest=economics_digest,
        clock_mark_count=len(clock_plan.marks),
        price_coordinate_count=len(prices),
        trade_event_count=len(trades),
        economic_cash_event_count=len(cash_events),
        starting_nav=first_nav.nav,
        ending_nav=last_nav.nav,
        trade_cash_change=trade_cash_change,
        economic_cash_change=economic_cash_change,
        net_result=net_result,
        return_numerator=net_result,
        return_denominator=first_nav.nav,
        cash_duration_us=cash_duration_us,
        cash_hours=cash_hours,
        maximum_drawdown_loss=maximum_loss,
        maximum_drawdown_peak=maximum_peak,
        peak_nav_mark_id=drawdown_peak_mark.nav_mark_id,
        trough_nav_mark_id=drawdown_trough_mark.nav_mark_id,
        peak_timestamp_label=peak_clock.timestamp_label,
        trough_timestamp_label=trough_clock.timestamp_label,
        peak_date_label=peak_clock.date_label,
        trough_date_label=trough_clock.date_label,
    )
    receipt_digest = _digest(_RECEIPT_DOMAIN, receipt_payload)
    return NavDrawdownReceiptV1(
        schema=schema,
        path_id=path_id,
        clock_digest=clock_plan.clock_digest,
        price_coordinate_digest=price_coordinate_digest,
        trade_event_digest=trade_event_digest,
        economic_cash_event_digest=economic_cash_event_digest,
        nav_mark_digest=nav_mark_digest,
        claim_digest=claim_digest,
        path_digest=path_digest,
        economics_digest=economics_digest,
        clock_mark_count=len(clock_plan.marks),
        price_coordinate_count=len(prices),
        trade_event_count=len(trades),
        economic_cash_event_count=len(cash_events),
        starting_nav=first_nav.nav,
        ending_nav=last_nav.nav,
        trade_cash_change=trade_cash_change,
        economic_cash_change=economic_cash_change,
        net_result=net_result,
        return_numerator=net_result,
        return_denominator=first_nav.nav,
        cash_duration_us=cash_duration_us,
        cash_hours=cash_hours,
        maximum_drawdown_loss=maximum_loss,
        maximum_drawdown_peak=maximum_peak,
        peak_nav_mark_id=drawdown_peak_mark.nav_mark_id,
        trough_nav_mark_id=drawdown_trough_mark.nav_mark_id,
        peak_timestamp_label=peak_clock.timestamp_label,
        trough_timestamp_label=trough_clock.timestamp_label,
        peak_date_label=peak_clock.date_label,
        trough_date_label=trough_clock.date_label,
        authority="NONE",
        receipt_digest=receipt_digest,
    )


def _parse_clock_mark(value: object, *, field: str) -> ClockMarkV1:
    item = _require_mapping(value, field=field)
    _require_fields(
        item,
        field=field,
        expected=frozenset({"dateLabel", "markId", "timestampLabel", "timestampUs"}),
    )
    return ClockMarkV1(
        mark_id=_require_id(item["markId"], field=f"{field}.markId"),
        timestamp_us=_require_int(
            item["timestampUs"],
            field=f"{field}.timestampUs",
            minimum=0,
            maximum=_MAX_TIMESTAMP_US,
        ),
        timestamp_label=_require_string(item["timestampLabel"], field=f"{field}.timestampLabel"),
        date_label=_require_string(item["dateLabel"], field=f"{field}.dateLabel"),
    )


def _parse_clock_plan(value: object) -> NavClockPlanV1:
    item = _require_mapping(value, field="clockPlan")
    _require_fields(
        item,
        field="clockPlan",
        expected=frozenset({"clockDigest", "marks", "pathId"}),
    )
    raw_marks = _require_list(
        item["marks"],
        field="clockPlan.marks",
        minimum=2,
        maximum=_MAX_CLOCK_MARKS,
    )
    return NavClockPlanV1(
        path_id=_require_id(item["pathId"], field="clockPlan.pathId"),
        marks=tuple(
            _parse_clock_mark(mark, field=f"clockPlan.marks[{index}]")
            for index, mark in enumerate(raw_marks)
        ),
        clock_digest=_require_sha256(item["clockDigest"], field="clockPlan.clockDigest"),
    )


def _parse_price(value: object, *, field: str) -> PriceCoordinateV1:
    item = _require_mapping(value, field=field)
    _require_fields(
        item,
        field=field,
        expected=frozenset(
            {
                "dateLabel",
                "instrument",
                "lotId",
                "markId",
                "price",
                "priceId",
                "sourceArtifactSha256",
                "sourceField",
                "sourceRowId",
                "timestampLabel",
                "timestampUs",
                "use",
                "venue",
            }
        ),
    )
    return PriceCoordinateV1(
        price_id=_require_id(item["priceId"], field=f"{field}.priceId"),
        lot_id=_require_id(item["lotId"], field=f"{field}.lotId"),
        instrument=_require_id(item["instrument"], field=f"{field}.instrument"),
        venue=_require_id(item["venue"], field=f"{field}.venue"),
        use=_enum_value(
            PriceUse,
            item["use"],
            field=f"{field}.use",
            code="PRICE_USE_INVALID",
        ),
        source_field=_require_id(item["sourceField"], field=f"{field}.sourceField"),
        source_artifact_sha256=_require_sha256(
            item["sourceArtifactSha256"],
            field=f"{field}.sourceArtifactSha256",
        ),
        source_row_id=_require_id(item["sourceRowId"], field=f"{field}.sourceRowId"),
        mark_id=_require_id(item["markId"], field=f"{field}.markId"),
        timestamp_us=_require_int(
            item["timestampUs"],
            field=f"{field}.timestampUs",
            minimum=0,
            maximum=_MAX_TIMESTAMP_US,
        ),
        timestamp_label=_require_string(item["timestampLabel"], field=f"{field}.timestampLabel"),
        date_label=_require_string(item["dateLabel"], field=f"{field}.dateLabel"),
        price=_require_decimal(item["price"], field=f"{field}.price", positive=True),
    )


def _parse_trade(value: object, *, field: str) -> TradeEventV1:
    item = _require_mapping(value, field=field)
    _require_fields(
        item,
        field=field,
        expected=frozenset(
            {
                "eventId",
                "expectedPriceField",
                "instrument",
                "lotId",
                "markId",
                "priceId",
                "quantityDelta",
                "role",
            }
        ),
    )
    return TradeEventV1(
        event_id=_require_id(item["eventId"], field=f"{field}.eventId"),
        lot_id=_require_id(item["lotId"], field=f"{field}.lotId"),
        instrument=_require_id(item["instrument"], field=f"{field}.instrument"),
        role=_enum_value(
            TradeRole,
            item["role"],
            field=f"{field}.role",
            code="TRADE_ROLE_INVALID",
        ),
        mark_id=_require_id(item["markId"], field=f"{field}.markId"),
        price_id=_require_id(item["priceId"], field=f"{field}.priceId"),
        expected_price_field=_require_id(
            item["expectedPriceField"],
            field=f"{field}.expectedPriceField",
        ),
        quantity_delta=_require_decimal(
            item["quantityDelta"],
            field=f"{field}.quantityDelta",
            nonzero=True,
        ),
    )


def _parse_cash_event(value: object, *, field: str) -> EconomicCashEventV1:
    item = _require_mapping(value, field=field)
    _require_fields(
        item,
        field=field,
        expected=frozenset({"amount", "eventId", "evidenceSha256", "kind", "markId"}),
    )
    return EconomicCashEventV1(
        event_id=_require_id(item["eventId"], field=f"{field}.eventId"),
        mark_id=_require_id(item["markId"], field=f"{field}.markId"),
        kind=_enum_value(
            CashEventKind,
            item["kind"],
            field=f"{field}.kind",
            code="CASH_EVENT_KIND_INVALID",
        ),
        amount=_require_decimal(item["amount"], field=f"{field}.amount", nonzero=True),
        evidence_sha256=_require_sha256(
            item["evidenceSha256"],
            field=f"{field}.evidenceSha256",
        ),
    )


def _parse_position(value: object, *, field: str) -> PositionMarkV1:
    item = _require_mapping(value, field=field)
    _require_fields(
        item,
        field=field,
        expected=frozenset({"expectedPriceField", "lotId", "marketValue", "priceId", "quantity"}),
    )
    return PositionMarkV1(
        lot_id=_require_id(item["lotId"], field=f"{field}.lotId"),
        quantity=_require_decimal(
            item["quantity"],
            field=f"{field}.quantity",
            nonzero=True,
        ),
        price_id=_require_id(item["priceId"], field=f"{field}.priceId"),
        expected_price_field=_require_id(
            item["expectedPriceField"],
            field=f"{field}.expectedPriceField",
        ),
        market_value=_require_decimal(
            item["marketValue"],
            field=f"{field}.marketValue",
        ),
    )


def _parse_nav_mark(value: object, *, field: str) -> NavMarkV1:
    item = _require_mapping(value, field=field)
    _require_fields(
        item,
        field=field,
        expected=frozenset({"cash", "clockMarkId", "nav", "navMarkId", "positions"}),
    )
    raw_positions = _require_list(
        item["positions"],
        field=f"{field}.positions",
        minimum=0,
        maximum=_MAX_POSITIONS_PER_MARK,
    )
    return NavMarkV1(
        nav_mark_id=_require_id(item["navMarkId"], field=f"{field}.navMarkId"),
        clock_mark_id=_require_id(item["clockMarkId"], field=f"{field}.clockMarkId"),
        cash=_require_decimal(item["cash"], field=f"{field}.cash"),
        positions=tuple(
            _parse_position(position, field=f"{field}.positions[{index}]")
            for index, position in enumerate(raw_positions)
        ),
        nav=_require_decimal(item["nav"], field=f"{field}.nav", positive=True),
    )


def _parse_claim(value: object) -> NavDrawdownClaimV1:
    item = _require_mapping(value, field="claim")
    _require_fields(
        item,
        field="claim",
        expected=frozenset(
            {
                "cashDurationUs",
                "cashHours",
                "economicCashChange",
                "endNavMarkId",
                "endingNav",
                "maximumDrawdownLoss",
                "maximumDrawdownPeak",
                "netResult",
                "peakDateLabel",
                "peakNavMarkId",
                "peakTimestampLabel",
                "returnDenominator",
                "returnNumerator",
                "startNavMarkId",
                "startingNav",
                "tradeCashChange",
                "troughDateLabel",
                "troughNavMarkId",
                "troughTimestampLabel",
            }
        ),
    )
    return NavDrawdownClaimV1(
        start_nav_mark_id=_require_id(item["startNavMarkId"], field="claim.startNavMarkId"),
        end_nav_mark_id=_require_id(item["endNavMarkId"], field="claim.endNavMarkId"),
        starting_nav=_require_decimal(
            item["startingNav"], field="claim.startingNav", positive=True
        ),
        ending_nav=_require_decimal(item["endingNav"], field="claim.endingNav", positive=True),
        trade_cash_change=_require_decimal(item["tradeCashChange"], field="claim.tradeCashChange"),
        economic_cash_change=_require_decimal(
            item["economicCashChange"], field="claim.economicCashChange"
        ),
        net_result=_require_decimal(item["netResult"], field="claim.netResult"),
        return_numerator=_require_decimal(item["returnNumerator"], field="claim.returnNumerator"),
        return_denominator=_require_decimal(
            item["returnDenominator"],
            field="claim.returnDenominator",
            positive=True,
        ),
        cash_duration_us=_require_int(
            item["cashDurationUs"],
            field="claim.cashDurationUs",
            minimum=0,
            maximum=_MAX_TIMESTAMP_US,
        ),
        cash_hours=_require_int(
            item["cashHours"],
            field="claim.cashHours",
            minimum=0,
            maximum=_MAX_TIMESTAMP_US // _HOUR_US,
        ),
        maximum_drawdown_loss=_require_decimal(
            item["maximumDrawdownLoss"],
            field="claim.maximumDrawdownLoss",
            nonnegative=True,
        ),
        maximum_drawdown_peak=_require_decimal(
            item["maximumDrawdownPeak"],
            field="claim.maximumDrawdownPeak",
            positive=True,
        ),
        peak_nav_mark_id=_require_id(item["peakNavMarkId"], field="claim.peakNavMarkId"),
        trough_nav_mark_id=_require_id(item["troughNavMarkId"], field="claim.troughNavMarkId"),
        peak_timestamp_label=_require_string(
            item["peakTimestampLabel"], field="claim.peakTimestampLabel"
        ),
        trough_timestamp_label=_require_string(
            item["troughTimestampLabel"], field="claim.troughTimestampLabel"
        ),
        peak_date_label=_require_string(item["peakDateLabel"], field="claim.peakDateLabel"),
        trough_date_label=_require_string(item["troughDateLabel"], field="claim.troughDateLabel"),
    )


def validate_payload_v1(payload: Mapping[str, object]) -> NavDrawdownReceiptV1:
    """Parse a closed JSON-compatible v1 payload and validate its exact coordinates."""

    _require_fields(
        payload,
        field="payload",
        expected=frozenset(
            {
                "cashEvents",
                "claim",
                "clockPlan",
                "navMarks",
                "prices",
                "schema",
                "startingCash",
                "trades",
            }
        ),
    )
    schema = _require_string(payload["schema"], field="schema")
    starting_cash = _require_decimal(
        payload["startingCash"],
        field="startingCash",
        positive=True,
    )
    raw_prices = _require_list(
        payload["prices"],
        field="prices",
        minimum=0,
        maximum=_MAX_PRICES,
    )
    raw_trades = _require_list(
        payload["trades"],
        field="trades",
        minimum=0,
        maximum=_MAX_EVENTS,
    )
    raw_cash_events = _require_list(
        payload["cashEvents"],
        field="cashEvents",
        minimum=0,
        maximum=_MAX_EVENTS,
    )
    raw_nav_marks = _require_list(
        payload["navMarks"],
        field="navMarks",
        minimum=2,
        maximum=_MAX_CLOCK_MARKS,
    )
    return validate_nav_drawdown_coordinates_v1(
        schema=schema,
        starting_cash=starting_cash,
        clock_plan=_parse_clock_plan(payload["clockPlan"]),
        prices=tuple(
            _parse_price(price, field=f"prices[{index}]") for index, price in enumerate(raw_prices)
        ),
        trades=tuple(
            _parse_trade(event, field=f"trades[{index}]") for index, event in enumerate(raw_trades)
        ),
        cash_events=tuple(
            _parse_cash_event(event, field=f"cashEvents[{index}]")
            for index, event in enumerate(raw_cash_events)
        ),
        marks=tuple(
            _parse_nav_mark(mark, field=f"navMarks[{index}]")
            for index, mark in enumerate(raw_nav_marks)
        ),
        claim=_parse_claim(payload["claim"]),
    )
