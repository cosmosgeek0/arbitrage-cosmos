"""Bounded public/research point-process measurements for canonical Q07.

True cancellation is measurable only on an explicitly complete public order-lifecycle
segment. Anonymous aggregate depth removal remains ``REMOVE_OR_EXECUTE`` and is never
relabelled as ``CANCEL``. Missing or partial coverage yields ``DATA_INSUFFICIENT``;
only a bounded ``COMPLETE`` observation window may prove an exact zero intensity.
Hawkes and time-rescaling outputs are deterministic research challengers, never
production or execution authority.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.domains import BarDomain
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    fp_add,
    fp_mul,
)
from quant_edge.features.registry import FeatureCardV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.micro.equivalence import MicroFeatureImplementationV1
from quant_edge.micro.l1 import fp_from_fraction

SECOND_NS: Final = 1_000_000_000
MAX_POINT_EVENTS: Final = 4_096
MAX_POINT_WINDOW_NS: Final = 86_400 * SECOND_NS
PUBLIC_REMOVAL_SEMANTICS: Final = (
    "CANCEL is accepted only from complete public order-lifecycle evidence; "
    "anonymous depth loss remains REMOVE_OR_EXECUTE and the two intensities are distinct"
)


class PublicEventKind(StrEnum):
    BUY = "BUY"
    SELL = "SELL"
    ADD = "ADD"
    CANCEL = "CANCEL"
    REMOVE_OR_EXECUTE = "REMOVE_OR_EXECUTE"


EVENT_KINDS: Final = tuple(PublicEventKind)
MAX_POINT_UPDATE_OPS: Final = len(EVENT_KINDS) * MAX_POINT_EVENTS


class PointEvidencePosture(StrEnum):
    PUBLIC_REPLAY_RESEARCH_ONLY = "PUBLIC_REPLAY_RESEARCH_ONLY"
    SYNTHETIC_RESEARCH_ONLY = "SYNTHETIC_RESEARCH_ONLY"


class PointCoverageStatus(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNAVAILABLE = "UNAVAILABLE"


class PointEventSemantics(StrEnum):
    AGGREGATE_PUBLIC_DELTA = "AGGREGATE_PUBLIC_DELTA"
    PUBLIC_ORDER_LIFECYCLE = "PUBLIC_ORDER_LIFECYCLE"


class PointProcessStatus(StrEnum):
    AVAILABLE_RESEARCH_ONLY = "AVAILABLE_RESEARCH_ONLY"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


class HawkesStatus(StrEnum):
    STABLE_CHALLENGER = "STABLE_CHALLENGER"
    REJECTED_EXPLOSIVE = "REJECTED_EXPLOSIVE"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


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
            raise ContractValueError("kind must be PublicEventKind")


def _validate_events(events: tuple[PointEventV1, ...], *, maximum: int) -> None:
    if not isinstance(events, tuple) or len(events) > maximum:
        raise ContractValueError(f"events must be a tuple bounded at {maximum}")
    prior_time = -1
    prior_ordinal: int | None = None
    event_ids: set[str] = set()
    for event in events:
        if not isinstance(event, PointEventV1):
            raise ContractValueError("events must contain PointEventV1")
        if prior_ordinal is not None and event.ordinal <= prior_ordinal:
            raise ContractValueError("events must be strictly chronological")
        if prior_ordinal is not None and event.ordinal != prior_ordinal + 1:
            raise ContractValueError("events must form one gap-free ordinal segment")
        if event.event_id in event_ids:
            raise ContractValueError("event identifiers must be unique")
        if event.event_time_ns <= prior_time:
            raise ContractValueError("events must be strictly chronological")
        event_ids.add(event.event_id)
        prior_time = event.event_time_ns
        prior_ordinal = event.ordinal


@dataclass(frozen=True, slots=True)
class PointEventSegmentV1:
    segment_id: str
    source_id: str
    source_revision: str
    source_sha256: DigestV1
    posture: PointEvidencePosture
    coverage: PointCoverageStatus
    semantics: PointEventSemantics
    start_ns: int
    end_ns: int
    events: tuple[PointEventV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.segment_id, field="segment_id")
        require_contract_id(self.source_id, field="source_id")
        require_contract_id(self.source_revision, field="source_revision")
        if not isinstance(self.source_sha256, DigestV1):
            raise ContractValueError("source_sha256 must be DigestV1")
        if not isinstance(self.posture, PointEvidencePosture):
            raise ContractValueError("posture must be public/research-only")
        if not isinstance(self.coverage, PointCoverageStatus):
            raise ContractValueError("coverage must be PointCoverageStatus")
        if not isinstance(self.semantics, PointEventSemantics):
            raise ContractValueError("semantics must be PointEventSemantics")
        require_strict_int(self.start_ns, field="start_ns", minimum=0)
        require_strict_int(self.end_ns, field="end_ns", minimum=self.start_ns + 1)
        if self.end_ns - self.start_ns > MAX_POINT_WINDOW_NS:
            raise ContractValueError(f"observation window must be bounded at {MAX_POINT_WINDOW_NS}")
        _validate_events(self.events, maximum=MAX_POINT_EVENTS)
        if self.coverage is PointCoverageStatus.UNAVAILABLE and self.events:
            raise ContractValueError("unavailable coverage cannot expose events")
        if any(not self.start_ns <= event.event_time_ns < self.end_ns for event in self.events):
            raise ContractValueError("every event must fall inside the observation window")
        kinds = {event.kind for event in self.events}
        if (
            self.semantics is PointEventSemantics.AGGREGATE_PUBLIC_DELTA
            and PublicEventKind.CANCEL in kinds
        ):
            raise ContractValueError("aggregate public deltas cannot identify CANCEL")
        if (
            self.semantics is PointEventSemantics.PUBLIC_ORDER_LIFECYCLE
            and PublicEventKind.REMOVE_OR_EXECUTE in kinds
        ):
            raise ContractValueError(
                "order-lifecycle evidence must distinguish CANCEL from execution"
            )


@dataclass(frozen=True, slots=True)
class PoissonIntensityV1:
    kind: PublicEventKind
    status: PointProcessStatus
    count: int | None
    exposure_ns: int | None
    events_per_second: ExactRatioV1 | None
    reason: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, PublicEventKind):
            raise ContractValueError("kind must be PublicEventKind")
        if not isinstance(self.status, PointProcessStatus):
            raise ContractValueError("status must be PointProcessStatus")
        available = self.status is PointProcessStatus.AVAILABLE_RESEARCH_ONLY
        if available:
            if self.count is None or self.exposure_ns is None or self.events_per_second is None:
                raise ContractValueError("available Poisson intensity requires exact evidence")
            require_strict_int(self.count, field="count", minimum=0, maximum=MAX_POINT_EVENTS)
            require_strict_int(self.exposure_ns, field="exposure_ns", minimum=1)
            if not isinstance(self.events_per_second, ExactRatioV1):
                raise ContractValueError("events_per_second must be ExactRatioV1")
        elif any(
            value is not None for value in (self.count, self.exposure_ns, self.events_per_second)
        ):
            raise ContractValueError("data-insufficient Poisson intensity exposes no value")
        if available != (self.reason is None):
            raise ContractValueError("reason exists exactly for data-insufficient intensity")


@dataclass(frozen=True, slots=True)
class ExponentialIntensityV1:
    kind: PublicEventKind
    status: PointProcessStatus
    weighted_count: FixedPointV1 | None
    reason: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, PublicEventKind):
            raise ContractValueError("kind must be PublicEventKind")
        if not isinstance(self.status, PointProcessStatus):
            raise ContractValueError("status must be PointProcessStatus")
        available = self.status is PointProcessStatus.AVAILABLE_RESEARCH_ONLY
        if available != isinstance(self.weighted_count, FixedPointV1):
            raise ContractValueError("weighted count exists exactly when evidence is available")
        if available != (self.reason is None):
            raise ContractValueError("reason exists exactly for data-insufficient intensity")


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
    unavailable_kinds: tuple[PublicEventKind, ...]
    reason: str | None

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        if not isinstance(self.status, HawkesStatus):
            raise ContractValueError("status must be HawkesStatus")
        if len(self.branching_row_sums) != len(EVENT_KINDS):
            raise ContractValueError("branching sums must cover every event kind")
        if len(self.intensities) != len(EVENT_KINDS):
            raise ContractValueError("intensities must cover every event kind")
        if tuple(kind for kind in EVENT_KINDS if kind in self.unavailable_kinds) != (
            self.unavailable_kinds
        ):
            raise ContractValueError("unavailable kinds must follow canonical event order")
        if self.status is HawkesStatus.STABLE_CHALLENGER:
            for kind, value in zip(EVENT_KINDS, self.intensities, strict=True):
                if (kind in self.unavailable_kinds) == (value is not None):
                    raise ContractValueError("stable intensity availability must match semantics")
            if self.reason is not None:
                raise ContractValueError("stable challenger cannot carry a failure reason")
        elif any(value is not None for value in self.intensities) or self.reason is None:
            raise ContractValueError("non-stable Hawkes assessment exposes no intensity")


@dataclass(frozen=True, slots=True)
class TimeRescalingReportV1:
    spec_id: str
    status: HawkesStatus
    event_count: int
    compensator_increments: tuple[FixedPointV1, ...]
    reason: str | None

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        if not isinstance(self.status, HawkesStatus):
            raise ContractValueError("status must be HawkesStatus")
        require_strict_int(self.event_count, field="event_count", minimum=0)
        if self.status is HawkesStatus.STABLE_CHALLENGER:
            if len(self.compensator_increments) != max(0, self.event_count - 1):
                raise ContractValueError("stable residuals must cover every inter-event interval")
            if self.reason is not None:
                raise ContractValueError("stable residuals cannot carry a failure reason")
        elif self.compensator_increments or self.reason is None:
            raise ContractValueError("non-stable Hawkes fit exposes no residuals")


def _segment_reason(segment: PointEventSegmentV1 | None) -> str | None:
    if segment is None:
        return "SEGMENT_UNAVAILABLE"
    if not isinstance(segment, PointEventSegmentV1):
        raise ContractValueError("segment must be PointEventSegmentV1 or None")
    if segment.coverage is not PointCoverageStatus.COMPLETE:
        return f"COVERAGE_{segment.coverage.value}"
    return None


def _unsupported_kind(segment: PointEventSegmentV1, kind: PublicEventKind) -> bool:
    return (
        segment.semantics is PointEventSemantics.AGGREGATE_PUBLIC_DELTA
        and kind is PublicEventKind.CANCEL
    ) or (
        segment.semantics is PointEventSemantics.PUBLIC_ORDER_LIFECYCLE
        and kind is PublicEventKind.REMOVE_OR_EXECUTE
    )


def poisson_intensities(
    segment: PointEventSegmentV1 | None,
) -> tuple[PoissonIntensityV1, ...]:
    reason = _segment_reason(segment)
    if reason is not None:
        return tuple(
            PoissonIntensityV1(
                kind,
                PointProcessStatus.DATA_INSUFFICIENT,
                None,
                None,
                None,
                reason,
            )
            for kind in EVENT_KINDS
        )
    if segment is None:
        raise AssertionError("available segment checked above")
    exposure = segment.end_ns - segment.start_ns
    output: list[PoissonIntensityV1] = []
    for kind in EVENT_KINDS:
        if _unsupported_kind(segment, kind):
            output.append(
                PoissonIntensityV1(
                    kind,
                    PointProcessStatus.DATA_INSUFFICIENT,
                    None,
                    None,
                    None,
                    "EVENT_SEMANTICS_UNAVAILABLE",
                )
            )
            continue
        count = sum(event.kind is kind for event in segment.events)
        output.append(
            PoissonIntensityV1(
                kind,
                PointProcessStatus.AVAILABLE_RESEARCH_ONLY,
                count,
                exposure,
                make_ratio(count * SECOND_NS, exposure),
                None,
            )
        )
    return tuple(output)


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
    segment: PointEventSegmentV1 | None,
    *,
    decay_ns: int,
) -> tuple[ExponentialIntensityV1, ...]:
    require_strict_int(decay_ns, field="decay_ns", minimum=1, maximum=MAX_POINT_WINDOW_NS)
    reason = _segment_reason(segment)
    if reason is not None:
        return tuple(
            ExponentialIntensityV1(
                kind,
                PointProcessStatus.DATA_INSUFFICIENT,
                None,
                reason,
            )
            for kind in EVENT_KINDS
        )
    if segment is None:
        raise AssertionError("available segment checked above")
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        weighted = [Decimal(0)] * len(EVENT_KINDS)
        for event in segment.events:
            age = Decimal(segment.end_ns - event.event_time_ns) / Decimal(decay_ns)
            weighted[EVENT_KINDS.index(event.kind)] += _decimal_exp(-age)
    return tuple(
        ExponentialIntensityV1(
            kind,
            (
                PointProcessStatus.DATA_INSUFFICIENT
                if _unsupported_kind(segment, kind)
                else PointProcessStatus.AVAILABLE_RESEARCH_ONLY
            ),
            None if _unsupported_kind(segment, kind) else _fixed_from_decimal(weighted[index]),
            "EVENT_SEMANTICS_UNAVAILABLE" if _unsupported_kind(segment, kind) else None,
        )
        for index, kind in enumerate(EVENT_KINDS)
    )


def _branching_rows(spec: HawkesSpecV1) -> tuple[ExactRatioV1, ...]:
    return tuple(
        make_ratio(sum(value.mantissa for value in row), spec.decay_per_second.mantissa)
        for row in spec.excitation
    )


def _hawkes_status(rows: tuple[ExactRatioV1, ...]) -> HawkesStatus:
    return (
        HawkesStatus.REJECTED_EXPLOSIVE
        if any(row.numerator >= row.denominator for row in rows)
        else HawkesStatus.STABLE_CHALLENGER
    )


def hawkes_assessment(
    segment: PointEventSegmentV1 | None,
    *,
    spec: HawkesSpecV1,
) -> HawkesAssessmentV1:
    if not isinstance(spec, HawkesSpecV1):
        raise ContractValueError("spec must be HawkesSpecV1")
    if segment is not None and len(segment.events) > spec.max_events:
        raise ContractValueError(f"events must be a tuple bounded at {spec.max_events}")
    rows = _branching_rows(spec)
    if _hawkes_status(rows) is HawkesStatus.REJECTED_EXPLOSIVE:
        return HawkesAssessmentV1(
            spec.spec_id,
            HawkesStatus.REJECTED_EXPLOSIVE,
            rows,
            (None,) * len(EVENT_KINDS),
            (),
            "BRANCHING_RATIO_NOT_STABLE",
        )
    reason = _segment_reason(segment)
    if reason is not None:
        return HawkesAssessmentV1(
            spec.spec_id,
            HawkesStatus.DATA_INSUFFICIENT,
            rows,
            (None,) * len(EVENT_KINDS),
            (),
            reason,
        )
    if segment is None:
        raise AssertionError("available segment checked above")
    decay_ns = max(1, (SECOND_NS * FIXED_POINT_SCALE) // spec.decay_per_second.mantissa)
    weights = exponential_intensities(segment, decay_ns=decay_ns)
    unavailable = tuple(kind for kind in EVENT_KINDS if _unsupported_kind(segment, kind))
    intensities: list[FixedPointV1 | None] = []
    for target, baseline in enumerate(spec.baselines):
        if EVENT_KINDS[target] in unavailable:
            intensities.append(None)
            continue
        intensity = baseline
        for source, weight in enumerate(weights):
            if weight.weighted_count is not None:
                intensity = fp_add(
                    intensity,
                    fp_mul(spec.excitation[target][source], weight.weighted_count),
                )
        intensities.append(intensity)
    return HawkesAssessmentV1(
        spec.spec_id,
        HawkesStatus.STABLE_CHALLENGER,
        rows,
        tuple(intensities),
        unavailable,
        None,
    )


def time_rescaling_residuals(
    segment: PointEventSegmentV1 | None,
    *,
    spec: HawkesSpecV1,
) -> TimeRescalingReportV1:
    """Total observable-process compensator increments for research diagnostics."""

    if not isinstance(spec, HawkesSpecV1):
        raise ContractValueError("spec must be HawkesSpecV1")
    if segment is not None and len(segment.events) > spec.max_events:
        raise ContractValueError(f"events must be a tuple bounded at {spec.max_events}")
    rows = _branching_rows(spec)
    if _hawkes_status(rows) is HawkesStatus.REJECTED_EXPLOSIVE:
        return TimeRescalingReportV1(
            spec.spec_id,
            HawkesStatus.REJECTED_EXPLOSIVE,
            0 if segment is None else len(segment.events),
            (),
            "BRANCHING_RATIO_NOT_STABLE",
        )
    reason = _segment_reason(segment)
    if reason is not None:
        return TimeRescalingReportV1(
            spec.spec_id,
            HawkesStatus.DATA_INSUFFICIENT,
            0 if segment is None else len(segment.events),
            (),
            reason,
        )
    if segment is None:
        raise AssertionError("available segment checked above")
    available_indices = tuple(
        index for index, kind in enumerate(EVENT_KINDS) if not _unsupported_kind(segment, kind)
    )
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        beta = Decimal(spec.decay_per_second.mantissa) / Decimal(FIXED_POINT_SCALE)
        baseline_total = Decimal(
            sum(spec.baselines[index].mantissa for index in available_indices)
        ) / Decimal(FIXED_POINT_SCALE)
        increments: list[FixedPointV1] = []
        for index in range(1, len(segment.events)):
            start = segment.events[index - 1].event_time_ns
            end = segment.events[index].event_time_ns
            delta = Decimal(end - start) / Decimal(SECOND_NS)
            integrated = baseline_total * delta
            for past in segment.events[:index]:
                source = EVENT_KINDS.index(past.kind)
                alpha_total = Decimal(
                    sum(spec.excitation[target][source].mantissa for target in available_indices)
                ) / Decimal(FIXED_POINT_SCALE)
                start_age = Decimal(max(0, start - past.event_time_ns)) / Decimal(SECOND_NS)
                end_age = Decimal(end - past.event_time_ns) / Decimal(SECOND_NS)
                integrated += (alpha_total / beta) * (
                    _decimal_exp(-beta * start_age) - _decimal_exp(-beta * end_age)
                )
            increments.append(_fixed_from_decimal(integrated))
    return TimeRescalingReportV1(
        spec.spec_id,
        HawkesStatus.STABLE_CHALLENGER,
        len(segment.events),
        tuple(increments),
        None,
    )


def _point_intensity_value(
    segment: PointEventSegmentV1,
    kind: PublicEventKind,
) -> FixedPointV1 | None:
    estimate = next(item for item in poisson_intensities(segment) if item.kind is kind)
    if estimate.events_per_second is None:
        return None
    return fp_from_fraction(
        estimate.events_per_second.numerator,
        estimate.events_per_second.denominator,
    )


def batch_cancel_intensity(
    segments: tuple[PointEventSegmentV1, ...],
) -> FixedPointV1 | None:
    return None if not segments else _point_intensity_value(segments[-1], PublicEventKind.CANCEL)


def batch_add_intensity(
    segments: tuple[PointEventSegmentV1, ...],
) -> FixedPointV1 | None:
    return None if not segments else _point_intensity_value(segments[-1], PublicEventKind.ADD)


class _StreamingPointIntensity:
    __slots__ = ("__kind", "__ops")

    def __init__(self, kind: PublicEventKind) -> None:
        self.__kind = kind
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, segment: PointEventSegmentV1) -> FixedPointV1 | None:
        if not isinstance(segment, PointEventSegmentV1):
            raise ContractValueError("segments must contain PointEventSegmentV1")
        self.__ops = max(1, len(EVENT_KINDS) * len(segment.events))
        return _point_intensity_value(segment, self.__kind)


def _point_feature(
    *,
    name: str,
    kind: PublicEventKind,
    batch: Callable[[tuple[PointEventSegmentV1, ...]], FixedPointV1 | None],
    hypothesis: str,
    semantics: str,
) -> MicroFeatureImplementationV1[PointEventSegmentV1]:
    return MicroFeatureImplementationV1(
        card=FeatureCardV1(
            name=name,
            version="v1",
            economic_hypothesis=hypothesis,
            inputs=("public_point_event_segments",),
            window_law=(
                f"exact event count divided by an explicitly COMPLETE bounded window; {semantics}"
            ),
            domain=BarDomain.EVENT_TIME,
            normalization_cohort="symbol-self",
            missing_behavior=(
                "absent, partial or semantically unsupported evidence yields UNKNOWN; only "
                "a COMPLETE window may yield zero"
            ),
            stale_behavior="events outside the declared window or chronology gaps are rejected",
            unit_id="EVENTS_PER_SECOND",
            lower_bound=FixedPointV1(0),
            upper_bound=None,
            incremental_update_rule=(
                f"replace the prior bounded window with the current segment and count {kind.value}"
            ),
            batch_reference=f"quant_edge.micro.point_process:batch_{name}",
            streaming_implementation="quant_edge.micro.point_process:_StreamingPointIntensity",
            provenance=(
                "Q07 public/research point-process adapter; no production or execution authority"
            ),
            computational_cost="O_WINDOW_PER_UPDATE",
            expected_failure_modes=(
                "COVERAGE_INCOMPLETE",
                "EVENT_SEMANTICS_UNAVAILABLE",
                "GAPPED_ORDINALS",
            ),
            test_binding="tests.unit.test_q07_flow",
            equivalence_tolerance_ulp=0,
        ),
        batch=batch,
        make_streaming=lambda: _StreamingPointIntensity(kind),
        declared_max_update_ops=MAX_POINT_UPDATE_OPS,
    )


def cancel_intensity_feature() -> MicroFeatureImplementationV1[PointEventSegmentV1]:
    return _point_feature(
        name="cancel_intensity",
        kind=PublicEventKind.CANCEL,
        batch=batch_cancel_intensity,
        hypothesis=(
            "classified cancellation intensity in public order-lifecycle evidence measures "
            "order-removal activity without conflating executions"
        ),
        semantics="requires PUBLIC_ORDER_LIFECYCLE semantics",
    )


def add_intensity_feature() -> MicroFeatureImplementationV1[PointEventSegmentV1]:
    return _point_feature(
        name="add_intensity",
        kind=PublicEventKind.ADD,
        batch=batch_add_intensity,
        hypothesis="public addition intensity measures the rate of observable liquidity arrival",
        semantics="available under either declared public event semantics",
    )
