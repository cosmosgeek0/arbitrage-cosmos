from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.derivatives.borrow import (
    BorrowObservationV1,
    construction_feasibility,
    effective_borrow_knownness,
)
from quant_edge.derivatives.costs import CostKnownness, CostStackV1
from quant_edge.errors import ContractValueError
from quant_edge.labels.basis import (
    BasisConstruction,
    BorrowKnownness,
    ConstructionFeasibility,
    basis_entry_return,
)
from quant_edge.labels.rational import (
    ExactRatioV1,
    ratio_subtract,
    scaled_to_aligned,
)
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    ExactScaledValueV1,
    require_reason_code,
    require_strict_int,
)

MAX_QUOTE_STALENESS_NS: Final = 3_600_000_000_000
MAX_REASONS: Final = 16

REASON_SPOT_QUOTE_MISSING: Final = "SPOT_QUOTE_MISSING"
REASON_PERP_QUOTE_MISSING: Final = "PERP_QUOTE_MISSING"
REASON_SPOT_QUOTE_STALE: Final = "SPOT_QUOTE_STALE"
REASON_PERP_QUOTE_STALE: Final = "PERP_QUOTE_STALE"
REASON_SIZE_UNKNOWN: Final = "SIZE_UNKNOWN"
REASON_SIZE_INSUFFICIENT: Final = "SIZE_INSUFFICIENT"
REASON_BASIS_UNAVAILABLE: Final = "BASIS_UNAVAILABLE"
REASON_COST_COMPONENT_UNKNOWN: Final = "COST_COMPONENT_UNKNOWN"
REASON_BORROW_UNKNOWN: Final = "BORROW_UNKNOWN"
REASON_BORROW_UNAVAILABLE: Final = "BORROW_UNAVAILABLE"


class LegKind(StrEnum):
    SPOT = "SPOT"
    USDM_PERP = "USDM_PERP"


class SizeFeasibility(StrEnum):
    SUFFICIENT = "SUFFICIENT"
    INSUFFICIENT = "INSUFFICIENT"
    UNKNOWN = "UNKNOWN"


class ExecutableStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_positive_scaled(value: object, *, field: str) -> ExactScaledValueV1:
    if not isinstance(value, ExactScaledValueV1):
        raise ContractValueError(f"{field} must be ExactScaledValueV1")
    if value.coefficient <= 0:
        raise ContractValueError(f"{field} must be strictly positive")
    return value


def _require_reasons(value: object, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, tuple) or len(value) > MAX_REASONS:
        raise ContractValueError(f"{field} must be a bounded tuple of reason codes")
    for reason in value:
        require_reason_code(reason, field=field)
    if tuple(sorted(set(value))) != value:
        raise ContractValueError(f"{field} must be sorted and unique")
    return value


@dataclass(frozen=True, slots=True)
class SizedQuoteV1:
    """One two-sided top-of-book quote for one declared leg; sizes may be unknown
    and an unknown size is never treated as depth."""

    leg: LegKind
    event_time_ns: int
    ordinal: int
    bid: ExactScaledValueV1
    ask: ExactScaledValueV1
    bid_size: ExactScaledValueV1 | None
    ask_size: ExactScaledValueV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.leg, LegKind):
            raise ContractValueError("leg must be LegKind")
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        bid = _require_positive_scaled(self.bid, field="bid")
        ask = _require_positive_scaled(self.ask, field="ask")
        if scaled_to_aligned(bid) > scaled_to_aligned(ask):
            raise ContractValueError("quotes cannot be crossed")
        for name in ("bid_size", "ask_size"):
            size = getattr(self, name)
            if size is None:
                continue
            if not isinstance(size, ExactScaledValueV1):
                raise ContractValueError(f"{name} must be ExactScaledValueV1 or None")
            if size.coefficient < 0:
                raise ContractValueError(f"{name} cannot be negative")

    def as_mapping(self) -> dict[str, object]:
        def scaled(value: ExactScaledValueV1 | None) -> dict[str, object] | None:
            if value is None:
                return None
            return {
                "coefficient": str(value.coefficient),
                "scale": value.scale,
                "unitId": value.unit_id,
            }

        return {
            "ask": scaled(self.ask),
            "askSize": scaled(self.ask_size),
            "bid": scaled(self.bid),
            "bidSize": scaled(self.bid_size),
            "eventTimeNs": str(self.event_time_ns),
            "leg": self.leg.value,
            "ordinal": self.ordinal,
        }


@dataclass(frozen=True, slots=True)
class ExecutableBasisV1:
    """One executable-basis observation for one construction at one intended size.

    The entry basis exists exactly when the status is AVAILABLE; it is computed only
    from the crossed executable sides of two-sided quotes, never from mid, mark,
    index or last-trade references.
    """

    construction: BasisConstruction
    as_of_ns: int
    intended_size: ExactScaledValueV1
    status: ExecutableStatus
    size_feasibility: SizeFeasibility
    entry_basis: ExactRatioV1 | None
    spot_time_ns: int | None
    perp_time_ns: int | None
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.construction, BasisConstruction):
            raise ContractValueError("construction must be BasisConstruction")
        _require_ns(self.as_of_ns, field="as_of_ns")
        _require_positive_scaled(self.intended_size, field="intended_size")
        if not isinstance(self.status, ExecutableStatus):
            raise ContractValueError("status must be ExecutableStatus")
        if not isinstance(self.size_feasibility, SizeFeasibility):
            raise ContractValueError("size_feasibility must be SizeFeasibility")
        if (self.entry_basis is not None) != (self.status is ExecutableStatus.AVAILABLE):
            raise ContractValueError("entry basis exists exactly when the status is AVAILABLE")
        if self.entry_basis is not None and not isinstance(self.entry_basis, ExactRatioV1):
            raise ContractValueError("entry_basis must be ExactRatioV1 or None")
        for name in ("spot_time_ns", "perp_time_ns"):
            time_value = getattr(self, name)
            if time_value is not None:
                _require_ns(time_value, field=name)
        _require_reasons(self.reasons, field="reasons")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfNs": str(self.as_of_ns),
            "construction": self.construction.value,
            "entryBasis": None if self.entry_basis is None else self.entry_basis.as_mapping(),
            "intendedSize": {
                "coefficient": str(self.intended_size.coefficient),
                "scale": self.intended_size.scale,
                "unitId": self.intended_size.unit_id,
            },
            "perpTimeNs": None if self.perp_time_ns is None else str(self.perp_time_ns),
            "reasons": list(self.reasons),
            "sizeFeasibility": self.size_feasibility.value,
            "spotTimeNs": None if self.spot_time_ns is None else str(self.spot_time_ns),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class NetExecutableEdgeV1:
    """Net-of-cost executable edge; a value exists exactly when the status is
    AVAILABLE, which requires an available basis, sufficient intended size, a fully
    KNOWN cost stack and — for REVERSE only — known-available borrow. Nothing
    unknown is ever replaced by zero."""

    construction: BasisConstruction
    as_of_ns: int
    status: ExecutableStatus
    feasibility: ConstructionFeasibility
    value: ExactRatioV1 | None
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.construction, BasisConstruction):
            raise ContractValueError("construction must be BasisConstruction")
        _require_ns(self.as_of_ns, field="as_of_ns")
        if not isinstance(self.status, ExecutableStatus):
            raise ContractValueError("status must be ExecutableStatus")
        if not isinstance(self.feasibility, ConstructionFeasibility):
            raise ContractValueError("feasibility must be ConstructionFeasibility")
        if (self.value is not None) != (self.status is ExecutableStatus.AVAILABLE):
            raise ContractValueError("a net edge exists exactly when the status is AVAILABLE")
        if self.value is not None and not isinstance(self.value, ExactRatioV1):
            raise ContractValueError("value must be ExactRatioV1 or None")
        if (
            self.construction is BasisConstruction.REVERSE
            and self.status is ExecutableStatus.AVAILABLE
            and self.feasibility is not ConstructionFeasibility.FEASIBLE
        ):
            raise ContractValueError("a REVERSE net edge requires FEASIBLE borrow truth")
        _require_reasons(self.reasons, field="reasons")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfNs": str(self.as_of_ns),
            "construction": self.construction.value,
            "feasibility": self.feasibility.value,
            "reasons": list(self.reasons),
            "status": self.status.value,
            "value": None if self.value is None else self.value.as_mapping(),
        }


def _size_covers(size: ExactScaledValueV1 | None, intended: ExactScaledValueV1) -> bool | None:
    if size is None:
        return None
    return scaled_to_aligned(size) >= scaled_to_aligned(intended)


def compute_executable_basis(
    *,
    construction: BasisConstruction,
    spot_quote: SizedQuoteV1 | None,
    perp_quote: SizedQuoteV1 | None,
    intended_size: ExactScaledValueV1,
    as_of_ns: int,
    max_staleness_ns: int,
) -> ExecutableBasisV1:
    """Executable entry basis from the crossed sides of both legs.

    NORMAL (buy Spot, sell perp): ``(perp_bid - spot_ask) / spot_ask``.
    REVERSE (sell Spot, buy perp): ``(spot_bid - perp_ask) / perp_ask``.

    Both constructions consume the runtime owner's versioned return-on-long-leg
    contract. The crossed sides differ, but the denominator is always the price paid
    for the long leg. Missing or stale legs yield no basis; unknown sizes yield
    UNKNOWN feasibility, never assumed depth.
    """

    if not isinstance(construction, BasisConstruction):
        raise ContractValueError("construction must be BasisConstruction")
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    require_strict_int(
        max_staleness_ns,
        field="max_staleness_ns",
        minimum=1,
        maximum=MAX_QUOTE_STALENESS_NS,
    )
    intended = _require_positive_scaled(intended_size, field="intended_size")
    reasons: set[str] = set()
    for name, quote, expected_leg, missing_reason in (
        ("spot_quote", spot_quote, LegKind.SPOT, REASON_SPOT_QUOTE_MISSING),
        ("perp_quote", perp_quote, LegKind.USDM_PERP, REASON_PERP_QUOTE_MISSING),
    ):
        if quote is None:
            reasons.add(missing_reason)
            continue
        if not isinstance(quote, SizedQuoteV1):
            raise ContractValueError(f"{name} must be SizedQuoteV1 or None")
        if quote.leg is not expected_leg:
            raise ContractValueError(
                f"{name} must carry leg {expected_leg.value}; construction legs are typed "
                "and never interchangeable"
            )
        if quote.event_time_ns > as_of:
            raise ContractValueError(f"{name} cannot be newer than as-of")

    status = ExecutableStatus.UNKNOWN
    entry_basis: ExactRatioV1 | None = None
    if spot_quote is not None and perp_quote is not None:
        spot_stale = as_of - spot_quote.event_time_ns > max_staleness_ns
        perp_stale = as_of - perp_quote.event_time_ns > max_staleness_ns
        if spot_stale:
            reasons.add(REASON_SPOT_QUOTE_STALE)
        if perp_stale:
            reasons.add(REASON_PERP_QUOTE_STALE)
        if spot_stale or perp_stale:
            status = ExecutableStatus.STALE
        else:
            status = ExecutableStatus.AVAILABLE
            if construction is BasisConstruction.NORMAL:
                spot_price = spot_quote.ask
                perp_price = perp_quote.bid
            else:
                spot_price = spot_quote.bid
                perp_price = perp_quote.ask
            entry_basis = basis_entry_return(
                construction=construction,
                spot_price=spot_price,
                perp_price=perp_price,
            )

    # NORMAL consumes the Spot ask and perp bid; REVERSE consumes the Spot bid and
    # perp ask. Feasibility inspects exactly the consumed sides.
    if spot_quote is None or perp_quote is None:
        size_feasibility = SizeFeasibility.UNKNOWN
        reasons.add(REASON_SIZE_UNKNOWN)
    else:
        if construction is BasisConstruction.NORMAL:
            covers = (
                _size_covers(spot_quote.ask_size, intended),
                _size_covers(perp_quote.bid_size, intended),
            )
        else:
            covers = (
                _size_covers(spot_quote.bid_size, intended),
                _size_covers(perp_quote.ask_size, intended),
            )
        if any(cover is False for cover in covers):
            size_feasibility = SizeFeasibility.INSUFFICIENT
            reasons.add(REASON_SIZE_INSUFFICIENT)
        elif any(cover is None for cover in covers):
            size_feasibility = SizeFeasibility.UNKNOWN
            reasons.add(REASON_SIZE_UNKNOWN)
        else:
            size_feasibility = SizeFeasibility.SUFFICIENT

    return ExecutableBasisV1(
        construction=construction,
        as_of_ns=as_of,
        intended_size=intended,
        status=status,
        size_feasibility=size_feasibility,
        entry_basis=entry_basis,
        spot_time_ns=None if spot_quote is None else spot_quote.event_time_ns,
        perp_time_ns=None if perp_quote is None else perp_quote.event_time_ns,
        reasons=tuple(sorted(reasons)),
    )


def net_executable_edge(
    *,
    executable: ExecutableBasisV1,
    costs: CostStackV1,
    borrow: BorrowObservationV1,
    as_of_ns: int,
) -> NetExecutableEdgeV1:
    """Entry basis minus the fully known cost stack under the borrow feasibility law.

    Any unknown ingredient — basis, size coverage, one cost component, or borrow for
    the REVERSE construction — removes the value entirely; nothing is zero-filled.
    """

    if not isinstance(executable, ExecutableBasisV1):
        raise ContractValueError("executable must be ExecutableBasisV1")
    if not isinstance(costs, CostStackV1):
        raise ContractValueError("costs must be CostStackV1")
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    if as_of < executable.as_of_ns:
        raise ContractValueError("the net edge cannot pre-date its basis observation")
    knownness = effective_borrow_knownness(borrow, as_of)
    feasibility = construction_feasibility(executable.construction, knownness)

    # Size reasons are already carried forward from the executable observation.
    reasons = set(executable.reasons)
    if executable.entry_basis is None:
        reasons.add(REASON_BASIS_UNAVAILABLE)
    if costs.total_knownness is CostKnownness.UNKNOWN:
        reasons.add(REASON_COST_COMPONENT_UNKNOWN)
    if executable.construction is BasisConstruction.REVERSE:
        if knownness is BorrowKnownness.UNKNOWN:
            reasons.add(REASON_BORROW_UNKNOWN)
        elif knownness is BorrowKnownness.KNOWN_UNAVAILABLE:
            reasons.add(REASON_BORROW_UNAVAILABLE)

    value: ExactRatioV1 | None = None
    status = ExecutableStatus.UNKNOWN
    if executable.status is ExecutableStatus.STALE:
        status = ExecutableStatus.STALE
    elif (
        executable.entry_basis is not None
        and executable.size_feasibility is SizeFeasibility.SUFFICIENT
        and costs.total_knownness is CostKnownness.KNOWN
        and (
            executable.construction is BasisConstruction.NORMAL
            or knownness is BorrowKnownness.KNOWN_AVAILABLE
        )
    ):
        # The stack law guarantees a KNOWN total here.
        total = cast(ExactRatioV1, costs.total())
        value = ratio_subtract(executable.entry_basis, total)
        status = ExecutableStatus.AVAILABLE

    return NetExecutableEdgeV1(
        construction=executable.construction,
        as_of_ns=as_of,
        status=status,
        feasibility=feasibility,
        value=value,
        reasons=tuple(sorted(reasons)),
    )
