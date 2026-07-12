from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio, scaled_to_aligned
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    ExactScaledValueV1,
    require_contract_id,
    require_strict_int,
)

MAX_REFERENCE_STALENESS_NS: Final = 3_600_000_000_000


class ReferenceKind(StrEnum):
    """Distinct price-reference vocabularies; the library never substitutes one
    kind for another and no executable construction accepts any of them."""

    LAST_TRADE = "LAST_TRADE"
    MID = "MID"
    MARK = "MARK"
    INDEX = "INDEX"


class ReferenceDifferenceStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_price(value: object, *, field: str) -> ExactScaledValueV1:
    if not isinstance(value, ExactScaledValueV1):
        raise ContractValueError(f"{field} must be ExactScaledValueV1")
    if value.coefficient <= 0:
        raise ContractValueError(f"{field} must be strictly positive")
    return value


@dataclass(frozen=True, slots=True)
class ReferencePriceV1:
    """One reference price of one declared kind at one event time."""

    kind: ReferenceKind
    event_time_ns: int
    price: ExactScaledValueV1

    def __post_init__(self) -> None:
        if not isinstance(self.kind, ReferenceKind):
            raise ContractValueError("kind must be ReferenceKind")
        _require_ns(self.event_time_ns, field="event_time_ns")
        _require_price(self.price, field="price")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "kind": self.kind.value,
            "price": {
                "coefficient": str(self.price.coefficient),
                "scale": self.price.scale,
                "unitId": self.price.unit_id,
            },
        }


@dataclass(frozen=True, slots=True)
class ReferenceSetV1:
    """At most one price per kind for one symbol; absent kinds stay absent."""

    symbol: str
    as_of_ns: int
    max_staleness_ns: int
    entries: tuple[ReferencePriceV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        as_of = _require_ns(self.as_of_ns, field="as_of_ns")
        require_strict_int(
            self.max_staleness_ns,
            field="max_staleness_ns",
            minimum=1,
            maximum=MAX_REFERENCE_STALENESS_NS,
        )
        if not isinstance(self.entries, tuple) or len(self.entries) > len(ReferenceKind):
            raise ContractValueError("entries must be a tuple with at most one price per kind")
        seen: set[ReferenceKind] = set()
        for entry in self.entries:
            if not isinstance(entry, ReferencePriceV1):
                raise ContractValueError("entries must contain ReferencePriceV1")
            if entry.kind in seen:
                raise ContractValueError(f"duplicate reference kind {entry.kind.value}")
            if entry.event_time_ns > as_of:
                raise ContractValueError("a reference cannot be newer than as-of")
            seen.add(entry.kind)
        if tuple(sorted(entry.kind.value for entry in self.entries)) != tuple(
            entry.kind.value for entry in self.entries
        ):
            raise ContractValueError("entries must be sorted by kind")

    def entry(self, kind: ReferenceKind) -> ReferencePriceV1 | None:
        if not isinstance(kind, ReferenceKind):
            raise ContractValueError("kind must be ReferenceKind")
        for candidate in self.entries:
            if candidate.kind is kind:
                return candidate
        return None

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfNs": str(self.as_of_ns),
            "entries": [entry.as_mapping() for entry in self.entries],
            "maxStalenessNs": str(self.max_staleness_ns),
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class ReferenceDifferenceV1:
    """Relative difference ``(numerator_kind - denominator_kind) / denominator_kind``
    computed only from its own two declared kinds; a value exists exactly when the
    status is AVAILABLE and a missing or stale kind never becomes zero."""

    numerator_kind: ReferenceKind
    denominator_kind: ReferenceKind
    as_of_ns: int
    status: ReferenceDifferenceStatus
    value: ExactRatioV1 | None

    def __post_init__(self) -> None:
        for name in ("numerator_kind", "denominator_kind"):
            if not isinstance(getattr(self, name), ReferenceKind):
                raise ContractValueError(f"{name} must be ReferenceKind")
        if self.numerator_kind is self.denominator_kind:
            raise ContractValueError("a reference difference needs two distinct kinds")
        _require_ns(self.as_of_ns, field="as_of_ns")
        if not isinstance(self.status, ReferenceDifferenceStatus):
            raise ContractValueError("status must be ReferenceDifferenceStatus")
        if (self.value is not None) != (self.status is ReferenceDifferenceStatus.AVAILABLE):
            raise ContractValueError("a value exists exactly when the status is AVAILABLE")
        if self.value is not None and not isinstance(self.value, ExactRatioV1):
            raise ContractValueError("value must be ExactRatioV1 or None")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfNs": str(self.as_of_ns),
            "denominatorKind": self.denominator_kind.value,
            "numeratorKind": self.numerator_kind.value,
            "status": self.status.value,
            "value": None if self.value is None else self.value.as_mapping(),
        }


def reference_difference(
    references: ReferenceSetV1,
    numerator_kind: ReferenceKind,
    denominator_kind: ReferenceKind,
) -> ReferenceDifferenceV1:
    """Compute one cross-kind difference; kinds are never substituted or mixed."""

    if not isinstance(references, ReferenceSetV1):
        raise ContractValueError("references must be ReferenceSetV1")
    if not isinstance(numerator_kind, ReferenceKind) or not isinstance(
        denominator_kind, ReferenceKind
    ):
        raise ContractValueError("kinds must be ReferenceKind")
    if numerator_kind is denominator_kind:
        raise ContractValueError("a reference difference needs two distinct kinds")
    numerator = references.entry(numerator_kind)
    denominator = references.entry(denominator_kind)
    if numerator is None or denominator is None:
        status = ReferenceDifferenceStatus.UNKNOWN
        value: ExactRatioV1 | None = None
    elif (
        references.as_of_ns - numerator.event_time_ns > references.max_staleness_ns
        or references.as_of_ns - denominator.event_time_ns > references.max_staleness_ns
    ):
        status = ReferenceDifferenceStatus.STALE
        value = None
    else:
        numerator_aligned = scaled_to_aligned(numerator.price)
        denominator_aligned = scaled_to_aligned(denominator.price)
        status = ReferenceDifferenceStatus.AVAILABLE
        value = make_ratio(numerator_aligned - denominator_aligned, denominator_aligned)
    return ReferenceDifferenceV1(
        numerator_kind=numerator_kind,
        denominator_kind=denominator_kind,
        as_of_ns=references.as_of_ns,
        status=status,
        value=value,
    )


def premium(references: ReferenceSetV1) -> ReferenceDifferenceV1:
    """The mark/index premium ``(MARK - INDEX) / INDEX``; MARK and INDEX only."""

    return reference_difference(references, ReferenceKind.MARK, ReferenceKind.INDEX)
