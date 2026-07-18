"""Bounded public-flow point-process baselines and Hawkes challengers.

Public depth deltas cannot distinguish cancellations from executions.  Accordingly the
fourth event type is always ``REMOVE_OR_EXECUTE`` and true cancellation intensity is
explicitly ``BLOCKED_DATA``.  Hawkes output is a research challenger only; a branching
row bound at or above one is rejected before any intensity is exposed.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    fp_add,
    fp_mul,
)
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_contract_id, require_strict_int

SECOND_NS: Final = 1_000_000_000
MAX_POINT_EVENTS: Final = 4_096
TRUE_CANCEL_STATUS: Final = "BLOCKED_DATA"
PUBLIC_REMOVAL_SEMANTICS: Final = (
    "REMOVE_OR_EXECUTE: public book deltas do not identify true cancellation; "
    "CANCEL intensity remains BLOCKED_DATA"
)


class PublicEventKind(StrEnum):
    BUY = "BUY"
    SELL = "SELL"
    ADD = "ADD"
    REMOVE_OR_EXECUTE = "REMOVE_OR_EXECUTE"


EVENT_KINDS: Final = tuple(PublicEventKind)


class HawkesStatus(StrEnum):
    STABLE_CHALLENGER = "STABLE_CHALLENGER"
    REJECTED_EXPLOSIVE = "REJECTED_EXPLOSIVE"


@dataclass(frozen=True, slots=True)
class PointEventV1:
    event_id: str
    event_time_ns: int
    ordinal: int
    kind: PublicEventKind

    def __post_init__(self) -> None:
        require_contract_id(self.event_id, field="event_id")
        require_strict_int(self.event_time_ns, field="event_time_ns", minimum=0)
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        if not isinstance(self.kind, PublicEventKind):
            raise ContractValueError(
                "kind must be a public event kind; true CANCEL is BLOCKED_DATA"
            )


@dataclass(frozen=True, slots=True)
class PoissonIntensityV1:
    kind: PublicEventKind
    count: int
    exposure_ns: int
    events_per_second: ExactRatioV1

    def __post_init__(self) -> None:
        if not isinstance(self.kind, PublicEventKind):
            raise ContractValueError("kind must be PublicEventKind")
        require_strict_int(self.count, field="count", minimum=0, maximum=MAX_POINT_EVENTS)
        require_strict_int(self.exposure_ns, field="exposure_ns", minimum=1)
        if not isinstance(self.events_per_second, ExactRatioV1):
            raise ContractValueError("events_per_second must be ExactRatioV1")


@dataclass(frozen=True, slots=True)
class HawkesSpecV1:
    spec_id: str
    baselines: tuple[FixedPointV1, ...]
    excitation: tuple[tuple[FixedPointV1, ...], ...]
    decay_per_second: FixedPointV1
    max_events: int = MAX_POINT_EVENTS

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        dimension = len(EVENT_KINDS)
        if not isinstance(self.baselines, tuple) or len(self.baselines) != dimension:
            raise ContractValueError("baselines must cover every public event kind")
        if not isinstance(self.excitation, tuple) or len(self.excitation) != dimension:
            raise ContractValueError("excitation must be a square public-event matrix")
        for value in self.baselines:
            if not isinstance(value, FixedPointV1) or value.mantissa < 0:
                raise ContractValueError("baselines must be non-negative FixedPointV1")
        for row in self.excitation:
            if not isinstance(row, tuple) or len(row) != dimension:
                raise ContractValueError("excitation must be a square public-event matrix")
            if any(not isinstance(value, FixedPointV1) or value.mantissa < 0 for value in row):
                raise ContractValueError("excitation must be non-negative FixedPointV1")
        if not isinstance(self.decay_per_second, FixedPointV1):
            raise ContractValueError("decay_per_second must be FixedPointV1")
        if self.decay_per_second.mantissa <= 0:
            raise ContractValueError("decay_per_second must be positive")
        require_strict_int(self.max_events, field="max_events", minimum=1, maximum=MAX_POINT_EVENTS)


@dataclass(frozen=True, slots=True)
class HawkesAssessmentV1:
    spec_id: str
    status: HawkesStatus
    branching_row_sums: tuple[ExactRatioV1, ...]
    intensities: tuple[FixedPointV1 | None, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        if not isinstance(self.status, HawkesStatus):
            raise ContractValueError("status must be HawkesStatus")
        if len(self.branching_row_sums) != len(EVENT_KINDS):
            raise ContractValueError("branching sums must cover every event kind")
        if len(self.intensities) != len(EVENT_KINDS):
            raise ContractValueError("intensities must cover every event kind")
        rejected = self.status is HawkesStatus.REJECTED_EXPLOSIVE
        if rejected != all(value is None for value in self.intensities):
            raise ContractValueError("explosive Hawkes fits must expose no intensities")


@dataclass(frozen=True, slots=True)
class TimeRescalingReportV1:
    spec_id: str
    status: HawkesStatus
    event_count: int
    compensator_increments: tuple[FixedPointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        if not isinstance(self.status, HawkesStatus):
            raise ContractValueError("status must be HawkesStatus")
        require_strict_int(self.event_count, field="event_count", minimum=0)
        if self.status is HawkesStatus.REJECTED_EXPLOSIVE and self.compensator_increments:
            raise ContractValueError("explosive Hawkes fits expose no residuals")
        if self.status is HawkesStatus.STABLE_CHALLENGER and len(
            self.compensator_increments
        ) != max(0, self.event_count - 1):
            raise ContractValueError("stable residuals must cover every inter-event interval")


def _validate_events(events: tuple[PointEventV1, ...], *, maximum: int) -> None:
    if not isinstance(events, tuple) or len(events) > maximum:
        raise ContractValueError(f"events must be a tuple bounded at {maximum}")
    prior_time = -1
    prior_ordinal = -1
    for event in events:
        if not isinstance(event, PointEventV1):
            raise ContractValueError("events must contain PointEventV1")
        if event.event_time_ns <= prior_time or event.ordinal <= prior_ordinal:
            raise ContractValueError("events must be strictly chronological")
        prior_time = event.event_time_ns
        prior_ordinal = event.ordinal


def poisson_intensities(
    events: tuple[PointEventV1, ...], *, start_ns: int, end_ns: int
) -> tuple[PoissonIntensityV1, ...]:
    _validate_events(events, maximum=MAX_POINT_EVENTS)
    require_strict_int(start_ns, field="start_ns", minimum=0)
    require_strict_int(end_ns, field="end_ns", minimum=start_ns + 1)
    if any(not start_ns <= event.event_time_ns < end_ns for event in events):
        raise ContractValueError("every event must fall inside the exposure interval")
    exposure = end_ns - start_ns
    return tuple(
        PoissonIntensityV1(
            kind=kind,
            count=sum(event.kind is kind for event in events),
            exposure_ns=exposure,
            events_per_second=make_ratio(
                sum(event.kind is kind for event in events) * SECOND_NS, exposure
            ),
        )
        for kind in EVENT_KINDS
    )


def _decimal_exp(value: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        return value.exp()


def _fixed_from_decimal(value: Decimal) -> FixedPointV1:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        scaled = (value * Decimal(FIXED_POINT_SCALE)).to_integral_value()
    return FixedPointV1(int(scaled))


def exponential_intensities(
    events: tuple[PointEventV1, ...], *, as_of_ns: int, decay_ns: int
) -> tuple[FixedPointV1, ...]:
    """Exponentially weighted event counts, quantized once to the Q06 grid."""

    _validate_events(events, maximum=MAX_POINT_EVENTS)
    require_strict_int(as_of_ns, field="as_of_ns", minimum=0)
    require_strict_int(decay_ns, field="decay_ns", minimum=1)
    if any(event.event_time_ns > as_of_ns for event in events):
        raise ContractValueError("future events cannot enter an intensity")
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        weighted = [Decimal(0)] * len(EVENT_KINDS)
        for event in events:
            age = Decimal(as_of_ns - event.event_time_ns) / Decimal(decay_ns)
            weighted[EVENT_KINDS.index(event.kind)] += _decimal_exp(-age)
        return tuple(_fixed_from_decimal(value) for value in weighted)


def _branching_rows(spec: HawkesSpecV1) -> tuple[ExactRatioV1, ...]:
    return tuple(
        make_ratio(
            sum(value.mantissa for value in row),
            spec.decay_per_second.mantissa,
        )
        for row in spec.excitation
    )


def _status(rows: tuple[ExactRatioV1, ...]) -> HawkesStatus:
    return (
        HawkesStatus.REJECTED_EXPLOSIVE
        if any(row.numerator >= row.denominator for row in rows)
        else HawkesStatus.STABLE_CHALLENGER
    )


def hawkes_assessment(
    events: tuple[PointEventV1, ...], *, as_of_ns: int, spec: HawkesSpecV1
) -> HawkesAssessmentV1:
    if not isinstance(spec, HawkesSpecV1):
        raise ContractValueError("spec must be HawkesSpecV1")
    _validate_events(events, maximum=spec.max_events)
    rows = _branching_rows(spec)
    status = _status(rows)
    if status is HawkesStatus.REJECTED_EXPLOSIVE:
        return HawkesAssessmentV1(spec.spec_id, status, rows, (None,) * len(EVENT_KINDS))
    decay_ns = max(1, (SECOND_NS * FIXED_POINT_SCALE) // spec.decay_per_second.mantissa)
    weights = exponential_intensities(events, as_of_ns=as_of_ns, decay_ns=decay_ns)
    intensities: list[FixedPointV1] = []
    for target, baseline in enumerate(spec.baselines):
        intensity = baseline
        for source, weight in enumerate(weights):
            intensity = fp_add(intensity, fp_mul(spec.excitation[target][source], weight))
        intensities.append(intensity)
    return HawkesAssessmentV1(spec.spec_id, status, rows, tuple(intensities))


def time_rescaling_residuals(
    events: tuple[PointEventV1, ...], *, spec: HawkesSpecV1
) -> TimeRescalingReportV1:
    """Total-process compensator increments for the time-rescaling diagnostic."""

    if not isinstance(spec, HawkesSpecV1):
        raise ContractValueError("spec must be HawkesSpecV1")
    _validate_events(events, maximum=spec.max_events)
    rows = _branching_rows(spec)
    status = _status(rows)
    if status is HawkesStatus.REJECTED_EXPLOSIVE:
        return TimeRescalingReportV1(spec.spec_id, status, len(events), ())
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        beta = Decimal(spec.decay_per_second.mantissa) / Decimal(FIXED_POINT_SCALE)
        baseline_total = Decimal(sum(item.mantissa for item in spec.baselines)) / Decimal(
            FIXED_POINT_SCALE
        )
        increments: list[FixedPointV1] = []
        for index in range(1, len(events)):
            start = events[index - 1].event_time_ns
            end = events[index].event_time_ns
            delta = Decimal(end - start) / Decimal(SECOND_NS)
            integrated = baseline_total * delta
            for past in events[:index]:
                source = EVENT_KINDS.index(past.kind)
                alpha_total = Decimal(
                    sum(
                        spec.excitation[target][source].mantissa
                        for target in range(len(EVENT_KINDS))
                    )
                ) / Decimal(FIXED_POINT_SCALE)
                start_age = Decimal(max(0, start - past.event_time_ns)) / Decimal(SECOND_NS)
                end_age = Decimal(end - past.event_time_ns) / Decimal(SECOND_NS)
                integrated += (alpha_total / beta) * (
                    _decimal_exp(-beta * start_age) - _decimal_exp(-beta * end_age)
                )
            increments.append(_fixed_from_decimal(integrated))
    return TimeRescalingReportV1(spec.spec_id, status, len(events), tuple(increments))
