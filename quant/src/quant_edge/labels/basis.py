from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.labels.outcomes import OutcomeStatus
from quant_edge.labels.rational import (
    ExactRatioV1,
    make_ratio,
    ratio_add,
    ratio_compare,
    ratio_subtract,
    scaled_to_aligned,
)
from quant_edge.labels.series import EvidenceSeriesV1, SeriesKind
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    require_contract_id,
    require_strict_int,
)

MAX_FUNDING_EVENTS: Final = 1_024
MAX_STALENESS_NS: Final = 3_600_000_000_000


class BasisConstruction(StrEnum):
    NORMAL = "NORMAL"
    REVERSE = "REVERSE"


class BorrowKnownness(StrEnum):
    KNOWN_AVAILABLE = "KNOWN_AVAILABLE"
    KNOWN_UNAVAILABLE = "KNOWN_UNAVAILABLE"
    UNKNOWN = "UNKNOWN"


class ConstructionFeasibility(StrEnum):
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    UNKNOWN = "UNKNOWN"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_ratio(value: object, *, field: str) -> ExactRatioV1:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    return value


def _require_non_negative_ratio(value: object, *, field: str) -> ExactRatioV1:
    ratio = _require_ratio(value, field=field)
    if ratio.is_negative:
        raise ContractValueError(f"{field} cannot be negative")
    return ratio


@dataclass(frozen=True, slots=True)
class BorrowAssumptionV1:
    """Borrow truth is an explicit assumption; unknown never becomes available."""

    assumption_version: str
    knownness: BorrowKnownness
    hourly_rate: ExactRatioV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.assumption_version, field="assumption_version")
        if not isinstance(self.knownness, BorrowKnownness):
            raise ContractValueError("knownness must be BorrowKnownness")
        if self.knownness is BorrowKnownness.KNOWN_AVAILABLE:
            if self.hourly_rate is None:
                raise ContractValueError("known-available borrow must carry a rate")
            _require_non_negative_ratio(self.hourly_rate, field="hourly_rate")
        elif self.hourly_rate is not None:
            raise ContractValueError("a borrow rate requires known availability")

    def as_mapping(self) -> dict[str, object]:
        return {
            "assumptionVersion": self.assumption_version,
            "hourlyRate": None if self.hourly_rate is None else self.hourly_rate.as_mapping(),
            "knownness": self.knownness.value,
        }


@dataclass(frozen=True, slots=True)
class BasisCostAssumptionV1:
    """Four-leg fees plus intended-size slippage and recovery, all versioned."""

    assumption_version: str
    per_leg_fee: ExactRatioV1
    entry_slippage: ExactRatioV1
    exit_slippage: ExactRatioV1
    recovery_cost: ExactRatioV1
    legs: int = 4

    def __post_init__(self) -> None:
        require_contract_id(self.assumption_version, field="assumption_version")
        for name in ("per_leg_fee", "entry_slippage", "exit_slippage", "recovery_cost"):
            _require_non_negative_ratio(getattr(self, name), field=name)
        if self.legs != 4:
            raise ContractValueError("basis round trips are four-leg constructions")

    @property
    def total_cost(self) -> ExactRatioV1:
        total = make_ratio(self.per_leg_fee.numerator * self.legs, self.per_leg_fee.denominator)
        total = ratio_add(total, self.entry_slippage)
        total = ratio_add(total, self.exit_slippage)
        return ratio_add(total, self.recovery_cost)

    def as_mapping(self) -> dict[str, object]:
        return {
            "assumptionVersion": self.assumption_version,
            "entrySlippage": self.entry_slippage.as_mapping(),
            "exitSlippage": self.exit_slippage.as_mapping(),
            "legs": self.legs,
            "perLegFee": self.per_leg_fee.as_mapping(),
            "recoveryCost": self.recovery_cost.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class FundingEventV1:
    time_ns: int
    rate: ExactRatioV1

    def __post_init__(self) -> None:
        _require_ns(self.time_ns, field="time_ns")
        _require_ratio(self.rate, field="rate")

    def as_mapping(self) -> dict[str, object]:
        return {"rate": self.rate.as_mapping(), "timeNs": str(self.time_ns)}


@dataclass(frozen=True, slots=True)
class BasisDefinitionV1:
    definition_version: str
    max_reference_staleness_ns: int
    partial_convergence_fraction: ExactRatioV1
    full_convergence_fraction: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.definition_version, field="definition_version")
        require_strict_int(
            self.max_reference_staleness_ns,
            field="max_reference_staleness_ns",
            minimum=1,
            maximum=MAX_STALENESS_NS,
        )
        partial = _require_non_negative_ratio(
            self.partial_convergence_fraction,
            field="partial_convergence_fraction",
        )
        full = _require_non_negative_ratio(
            self.full_convergence_fraction,
            field="full_convergence_fraction",
        )
        one = make_ratio(1, 1)
        if ratio_compare(partial, one) >= 0 or ratio_compare(full, partial) >= 0:
            raise ContractValueError("convergence fractions must satisfy full < partial < 1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "definitionVersion": self.definition_version,
            "fullConvergenceFraction": self.full_convergence_fraction.as_mapping(),
            "maxReferenceStalenessNs": str(self.max_reference_staleness_ns),
            "partialConvergenceFraction": self.partial_convergence_fraction.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class BasisLabelV1:
    construction: BasisConstruction
    definition: BasisDefinitionV1
    costs: BasisCostAssumptionV1
    borrow: BorrowAssumptionV1
    feasibility: ConstructionFeasibility
    status: OutcomeStatus
    entry_basis: ExactRatioV1 | None
    net_entry_edge: ExactRatioV1 | None
    partial_convergence_time_ns: int | None
    full_convergence_time_ns: int | None
    convergence_censor_time_ns: int | None
    funding_transfer: ExactRatioV1 | None
    max_executable_net_edge_status: OutcomeStatus
    max_executable_net_edge: ExactRatioV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.construction, BasisConstruction):
            raise ContractValueError("construction must be BasisConstruction")
        if not isinstance(self.definition, BasisDefinitionV1):
            raise ContractValueError("definition must be BasisDefinitionV1")
        if not isinstance(self.costs, BasisCostAssumptionV1):
            raise ContractValueError("costs must be BasisCostAssumptionV1")
        if not isinstance(self.borrow, BorrowAssumptionV1):
            raise ContractValueError("borrow must be BorrowAssumptionV1")
        if not isinstance(self.feasibility, ConstructionFeasibility):
            raise ContractValueError("feasibility must be ConstructionFeasibility")
        if not isinstance(self.status, OutcomeStatus):
            raise ContractValueError("status must be OutcomeStatus")
        core_present = self.entry_basis is not None
        if core_present != (self.status is OutcomeStatus.AVAILABLE):
            raise ContractValueError("entry basis exists exactly when the label is AVAILABLE")
        if (self.net_entry_edge is not None) != core_present:
            raise ContractValueError("net entry edge must accompany the entry basis")
        if (self.funding_transfer is not None) != core_present:
            raise ContractValueError("funding transfer must accompany the entry basis")
        if core_present:
            if (
                self.partial_convergence_time_ns is None
                and self.full_convergence_time_ns is None
                and self.convergence_censor_time_ns is None
            ):
                raise ContractValueError(
                    "an AVAILABLE label needs convergence times or explicit censoring"
                )
        elif (
            self.partial_convergence_time_ns is not None
            or self.full_convergence_time_ns is not None
            or self.convergence_censor_time_ns is not None
        ):
            raise ContractValueError("non-AVAILABLE labels carry no convergence evidence")
        if self.full_convergence_time_ns is not None and (
            self.partial_convergence_time_ns is None
            or self.full_convergence_time_ns < self.partial_convergence_time_ns
        ):
            raise ContractValueError("full convergence implies earlier partial convergence")
        if self.max_executable_net_edge_status is OutcomeStatus.AVAILABLE:
            if self.max_executable_net_edge is None:
                raise ContractValueError("an AVAILABLE executable edge must carry a value")
        elif self.max_executable_net_edge is not None:
            raise ContractValueError("only AVAILABLE executable edges carry values")
        if (
            self.construction is BasisConstruction.REVERSE
            and self.borrow.knownness is not BorrowKnownness.KNOWN_AVAILABLE
            and self.feasibility is ConstructionFeasibility.FEASIBLE
        ):
            raise ContractValueError(
                "reverse basis cannot be feasible without known borrow availability"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "borrow": self.borrow.as_mapping(),
            "construction": self.construction.value,
            "convergenceCensorTimeNs": (
                None
                if self.convergence_censor_time_ns is None
                else str(self.convergence_censor_time_ns)
            ),
            "costs": self.costs.as_mapping(),
            "definition": self.definition.as_mapping(),
            "entryBasis": None if self.entry_basis is None else self.entry_basis.as_mapping(),
            "feasibility": self.feasibility.value,
            "fullConvergenceTimeNs": (
                None
                if self.full_convergence_time_ns is None
                else str(self.full_convergence_time_ns)
            ),
            "fundingTransfer": (
                None if self.funding_transfer is None else self.funding_transfer.as_mapping()
            ),
            "maxExecutableNetEdge": (
                None
                if self.max_executable_net_edge is None
                else self.max_executable_net_edge.as_mapping()
            ),
            "maxExecutableNetEdgeStatus": self.max_executable_net_edge_status.value,
            "netEntryEdge": (
                None if self.net_entry_edge is None else self.net_entry_edge.as_mapping()
            ),
            "partialConvergenceTimeNs": (
                None
                if self.partial_convergence_time_ns is None
                else str(self.partial_convergence_time_ns)
            ),
            "schema": "Q05BasisLabelV1",
            "status": self.status.value,
            "version": 1,
        }


def _feasibility(
    construction: BasisConstruction,
    borrow: BorrowAssumptionV1,
) -> ConstructionFeasibility:
    if construction is BasisConstruction.NORMAL:
        return ConstructionFeasibility.FEASIBLE
    if borrow.knownness is BorrowKnownness.KNOWN_AVAILABLE:
        return ConstructionFeasibility.FEASIBLE
    if borrow.knownness is BorrowKnownness.KNOWN_UNAVAILABLE:
        return ConstructionFeasibility.INFEASIBLE
    return ConstructionFeasibility.UNKNOWN


def _unavailable(
    construction: BasisConstruction,
    definition: BasisDefinitionV1,
    costs: BasisCostAssumptionV1,
    borrow: BorrowAssumptionV1,
    status: OutcomeStatus,
) -> BasisLabelV1:
    return BasisLabelV1(
        construction=construction,
        definition=definition,
        costs=costs,
        borrow=borrow,
        feasibility=_feasibility(construction, borrow),
        status=status,
        entry_basis=None,
        net_entry_edge=None,
        partial_convergence_time_ns=None,
        full_convergence_time_ns=None,
        convergence_censor_time_ns=None,
        funding_transfer=None,
        max_executable_net_edge_status=OutcomeStatus.UNAVAILABLE,
        max_executable_net_edge=None,
    )


def _abs_ratio(value: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(abs(value.numerator), value.denominator)


def _fraction_of(value: ExactRatioV1, fraction: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(
        value.numerator * fraction.numerator,
        value.denominator * fraction.denominator,
    )


def _last_value_at_or_before(
    series: EvidenceSeriesV1,
    time_ns: int,
    staleness_ns: int,
) -> int | None:
    point = series.last_price_at_or_before(time_ns)
    if point is None or time_ns - point.event_time_ns > staleness_ns:
        return None
    return scaled_to_aligned(point.price)


def compute_basis_label(
    *,
    construction: BasisConstruction,
    spot_series: EvidenceSeriesV1,
    perp_series: EvidenceSeriesV1,
    label_start_ns: int,
    label_end_ns: int,
    definition: BasisDefinitionV1,
    costs: BasisCostAssumptionV1,
    borrow: BorrowAssumptionV1,
    funding_schedule: tuple[FundingEventV1, ...],
) -> BasisLabelV1:
    """Compute the §11.4 label over dual-leg evidence; unknown stays unknown.

    Trade/mid evidence supports indicative basis truth only; the maximum executable net
    edge requires two-sided executable quotes on both legs and is otherwise
    ``UNAVAILABLE``.
    """

    if not isinstance(construction, BasisConstruction):
        raise ContractValueError("construction must be BasisConstruction")
    for name, series in (("spot_series", spot_series), ("perp_series", perp_series)):
        if not isinstance(series, EvidenceSeriesV1):
            raise ContractValueError(f"{name} must be EvidenceSeriesV1")
        if series.kind is SeriesKind.EXECUTABLE_QUOTES:
            raise ContractValueError(
                "executable-quote basis legs are not supported by definition v1; "
                "supply price evidence and keep executable edge UNAVAILABLE"
            )
    if not isinstance(definition, BasisDefinitionV1):
        raise ContractValueError("definition must be BasisDefinitionV1")
    if not isinstance(costs, BasisCostAssumptionV1):
        raise ContractValueError("costs must be BasisCostAssumptionV1")
    if not isinstance(borrow, BorrowAssumptionV1):
        raise ContractValueError("borrow must be BorrowAssumptionV1")
    start = _require_ns(label_start_ns, field="label_start_ns")
    end = _require_ns(label_end_ns, field="label_end_ns")
    if start >= end:
        raise ContractValueError("the basis label interval must be non-empty")
    if (
        not isinstance(funding_schedule, tuple)
        or len(funding_schedule) > MAX_FUNDING_EVENTS
        or any(not isinstance(event, FundingEventV1) for event in funding_schedule)
    ):
        raise ContractValueError("funding_schedule must be a bounded tuple of FundingEventV1")
    previous_time: int | None = None
    for event in funding_schedule:
        if previous_time is not None and event.time_ns <= previous_time:
            raise ContractValueError("funding events must strictly increase in time")
        previous_time = event.time_ns

    if spot_series.gap_intersecting(start, end) or perp_series.gap_intersecting(start, end):
        return _unavailable(construction, definition, costs, borrow, OutcomeStatus.DATA_INVALID)
    staleness = definition.max_reference_staleness_ns
    spot_entry = _last_value_at_or_before(spot_series, start, staleness)
    perp_entry = _last_value_at_or_before(perp_series, start, staleness)
    if spot_entry is None or perp_entry is None:
        return _unavailable(construction, definition, costs, borrow, OutcomeStatus.UNAVAILABLE)

    entry_basis = make_ratio(perp_entry - spot_entry, spot_entry)
    gross_edge = _abs_ratio(entry_basis)
    net_entry_edge = ratio_subtract(gross_edge, costs.total_cost)

    horizon_end = min(end, spot_series.completeness_end_ns, perp_series.completeness_end_ns)
    partial_threshold = _fraction_of(gross_edge, definition.partial_convergence_fraction)
    full_threshold = _fraction_of(gross_edge, definition.full_convergence_fraction)
    partial_time: int | None = None
    full_time: int | None = None
    if not gross_edge.is_zero:
        for point in perp_series.price_points:
            if point.event_time_ns <= start:
                continue
            if point.event_time_ns > horizon_end:
                break
            spot_value = _last_value_at_or_before(
                spot_series,
                point.event_time_ns,
                staleness,
            )
            if spot_value is None:
                continue
            observed = _abs_ratio(
                make_ratio(scaled_to_aligned(point.price) - spot_value, spot_value)
            )
            if partial_time is None and ratio_compare(observed, partial_threshold) <= 0:
                partial_time = point.event_time_ns
            if ratio_compare(observed, full_threshold) <= 0:
                full_time = point.event_time_ns
                break
    # Non-convergence is right-censored at the last observable time, which is the
    # label end when evidence is complete and the completeness end otherwise.
    censor_time = horizon_end if full_time is None else None

    funding_end = horizon_end if full_time is None else full_time
    transfer_sum = make_ratio(0, 1)
    for event in funding_schedule:
        if start < event.time_ns <= funding_end:
            transfer_sum = ratio_add(transfer_sum, event.rate)
    if construction is BasisConstruction.REVERSE:
        transfer_sum = make_ratio(-transfer_sum.numerator, transfer_sum.denominator)

    return BasisLabelV1(
        construction=construction,
        definition=definition,
        costs=costs,
        borrow=borrow,
        feasibility=_feasibility(construction, borrow),
        status=OutcomeStatus.AVAILABLE,
        entry_basis=entry_basis,
        net_entry_edge=net_entry_edge,
        partial_convergence_time_ns=partial_time,
        full_convergence_time_ns=full_time,
        convergence_censor_time_ns=censor_time,
        funding_transfer=transfer_sum,
        max_executable_net_edge_status=OutcomeStatus.UNAVAILABLE,
        max_executable_net_edge=None,
    )
