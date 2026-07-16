from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import scaled_to_aligned
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    require_contract_id,
    require_strict_int,
)

MAX_SERIES_POINTS: Final = 100_000
MAX_GAP_INTERVALS: Final = 1_024

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


class SeriesKind(StrEnum):
    TRADE_MID_PROXY = "TRADE_MID_PROXY"
    MID = "MID"
    EXECUTABLE_QUOTES = "EXECUTABLE_QUOTES"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_price(value: object, *, field: str) -> ExactScaledValueV1:
    if not isinstance(value, ExactScaledValueV1):
        raise ContractValueError(f"{field} must be ExactScaledValueV1")
    if value.coefficient <= 0:
        raise ContractValueError(f"{field} must be strictly positive")
    return value


def _require_posture(value: object, *, field: str) -> EvidencePosture:
    if not isinstance(value, EvidencePosture) or value not in _ALLOWED_POSTURES:
        raise ContractValueError(
            f"{field} must be SYNTHETIC or REPLAY; Q05 owns no live market evidence"
        )
    return value


@dataclass(frozen=True, slots=True)
class PricePointV1:
    event_time_ns: int
    ordinal: int
    price: ExactScaledValueV1

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        _require_price(self.price, field="price")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "price": {
                "coefficient": str(self.price.coefficient),
                "scale": self.price.scale,
                "unitId": self.price.unit_id,
            },
        }


@dataclass(frozen=True, slots=True)
class QuotePointV1:
    event_time_ns: int
    ordinal: int
    bid: ExactScaledValueV1
    ask: ExactScaledValueV1

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        bid = _require_price(self.bid, field="bid")
        ask = _require_price(self.ask, field="ask")
        if scaled_to_aligned(bid) > scaled_to_aligned(ask):
            raise ContractValueError("quote points cannot be crossed")

    def as_mapping(self) -> dict[str, object]:
        return {
            "ask": {
                "coefficient": str(self.ask.coefficient),
                "scale": self.ask.scale,
                "unitId": self.ask.unit_id,
            },
            "bid": {
                "coefficient": str(self.bid.coefficient),
                "scale": self.bid.scale,
                "unitId": self.bid.unit_id,
            },
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
        }


@dataclass(frozen=True, slots=True)
class GapIntervalV1:
    """A known evidence gap; outcomes intersecting a gap are DATA_INVALID, never zero."""

    start_ns: int
    end_ns: int

    def __post_init__(self) -> None:
        start = _require_ns(self.start_ns, field="start_ns")
        end = _require_ns(self.end_ns, field="end_ns")
        if start >= end:
            raise ContractValueError("gap start must precede gap end")

    def intersects(self, start_ns: int, end_ns: int) -> bool:
        return self.start_ns < end_ns and start_ns < self.end_ns

    def as_mapping(self) -> dict[str, object]:
        return {"endNs": str(self.end_ns), "startNs": str(self.start_ns)}


def _validate_points(
    points: object,
    *,
    field: str,
    point_type: type[PricePointV1] | type[QuotePointV1],
) -> None:
    if not isinstance(points, tuple) or not points or len(points) > MAX_SERIES_POINTS:
        raise ContractValueError(
            f"{field} must be a tuple of 1..{MAX_SERIES_POINTS} evidence points"
        )
    previous_time: int | None = None
    previous_ordinal: int | None = None
    for index, point in enumerate(points):
        if not isinstance(point, PricePointV1 | QuotePointV1) or not isinstance(point, point_type):
            raise ContractValueError(f"{field}[{index}] must be {point_type.__name__}")
        time_ns = point.event_time_ns
        ordinal = point.ordinal
        if previous_time is not None and previous_ordinal is not None:
            if time_ns < previous_time:
                raise ContractValueError(f"{field} must be time-ordered")
            if ordinal <= previous_ordinal:
                raise ContractValueError(f"{field} ordinals must strictly increase")
        previous_time = time_ns
        previous_ordinal = ordinal


def _validate_gaps(gaps: object, *, field: str) -> None:
    if not isinstance(gaps, tuple) or len(gaps) > MAX_GAP_INTERVALS:
        raise ContractValueError(f"{field} must be a bounded tuple of gap intervals")
    previous_end: int | None = None
    for index, gap in enumerate(gaps):
        if not isinstance(gap, GapIntervalV1):
            raise ContractValueError(f"{field}[{index}] must be GapIntervalV1")
        if previous_end is not None and gap.start_ns < previous_end:
            raise ContractValueError(f"{field} must be sorted and non-overlapping")
        previous_end = gap.end_ns


@dataclass(frozen=True, slots=True)
class EvidenceSeriesV1:
    """One evidence series with explicit completeness truth and honest posture."""

    series_id: str
    symbol: str
    kind: SeriesKind
    posture: EvidencePosture
    completeness_start_ns: int
    completeness_end_ns: int
    price_points: tuple[PricePointV1, ...]
    quote_points: tuple[QuotePointV1, ...]
    known_gaps: tuple[GapIntervalV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.series_id, field="series_id")
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.kind, SeriesKind):
            raise ContractValueError("kind must be SeriesKind")
        _require_posture(self.posture, field="posture")
        start = _require_ns(self.completeness_start_ns, field="completeness_start_ns")
        end = _require_ns(self.completeness_end_ns, field="completeness_end_ns")
        if start >= end:
            raise ContractValueError("completeness interval must be non-empty")
        if self.kind is SeriesKind.EXECUTABLE_QUOTES:
            if self.price_points or not self.quote_points:
                raise ContractValueError("quote series carry quote points only")
            _validate_points(self.quote_points, field="quote_points", point_type=QuotePointV1)
            points_times = [point.event_time_ns for point in self.quote_points]
        else:
            if self.quote_points or not self.price_points:
                raise ContractValueError("price series carry price points only")
            _validate_points(self.price_points, field="price_points", point_type=PricePointV1)
            points_times = [point.event_time_ns for point in self.price_points]
        if points_times[0] < start or points_times[-1] > end:
            raise ContractValueError("points must lie inside the completeness interval")
        _validate_gaps(self.known_gaps, field="known_gaps")
        for gap in self.known_gaps:
            if gap.start_ns < start or gap.end_ns > end:
                raise ContractValueError("gaps must lie inside the completeness interval")

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessEndNs": str(self.completeness_end_ns),
            "completenessStartNs": str(self.completeness_start_ns),
            "kind": self.kind.value,
            "knownGaps": [gap.as_mapping() for gap in self.known_gaps],
            "posture": self.posture.value,
            "pricePoints": [point.as_mapping() for point in self.price_points],
            "quotePoints": [point.as_mapping() for point in self.quote_points],
            "seriesId": self.series_id,
            "symbol": self.symbol,
        }

    def evidence_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())

    def pre_cutoff_digest(self, cutoff_ns: int) -> DigestV1:
        """Digest of evidence at or before the cutoff only.

        Injecting or changing evidence after the cutoff can never alter this value;
        the §11.7 leakage law tests bind to it.
        """

        _require_ns(cutoff_ns, field="cutoff_ns")
        mapping = {
            "cutoffNs": str(cutoff_ns),
            "kind": self.kind.value,
            "pricePoints": [
                point.as_mapping()
                for point in self.price_points
                if point.event_time_ns <= cutoff_ns
            ],
            "quotePoints": [
                point.as_mapping()
                for point in self.quote_points
                if point.event_time_ns <= cutoff_ns
            ],
            "schema": "Q05PreCutoffEvidenceV1",
            "seriesId": self.series_id,
            "symbol": self.symbol,
            "version": 1,
        }
        return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())

    def gap_intersecting(self, start_ns: int, end_ns: int) -> bool:
        return any(gap.intersects(start_ns, end_ns) for gap in self.known_gaps)

    def last_price_at_or_before(self, time_ns: int) -> PricePointV1 | None:
        chosen: PricePointV1 | None = None
        for point in self.price_points:
            if point.event_time_ns > time_ns:
                break
            chosen = point
        return chosen

    def last_quote_at_or_before(self, time_ns: int) -> QuotePointV1 | None:
        chosen: QuotePointV1 | None = None
        for point in self.quote_points:
            if point.event_time_ns > time_ns:
                break
            chosen = point
        return chosen
