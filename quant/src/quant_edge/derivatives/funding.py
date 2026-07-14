from __future__ import annotations

import itertools
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, fp_from_int, fp_from_ratio
from quant_edge.features.values import FeatureValueStatus, FeatureValueV1
from quant_edge.labels.rational import ExactRatioV1, ratio_subtract
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    require_contract_id,
    require_strict_int,
)

MAX_FUNDING_OBSERVATIONS: Final = 4_096
MAX_SCHEDULE_TIMES: Final = 4_096
MAX_FUNDING_STALENESS_NS: Final = 86_400_000_000_000

FUNDING_LEVEL_FEATURE_ID: Final = "funding_level:v1"
FUNDING_CHANGE_FEATURE_ID: Final = "funding_change:v1"
TIME_TO_NEXT_FUNDING_FEATURE_ID: Final = "time_to_next_funding_ns:v1"

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


class ScheduleIntervalVerdict(StrEnum):
    UNCHANGED = "UNCHANGED"
    CHANGED = "CHANGED"
    UNKNOWN = "UNKNOWN"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class FundingObservationV1:
    """One observed funding rate at one event time; a rate may be negative."""

    event_time_ns: int
    ordinal: int
    rate: ExactRatioV1

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        if not isinstance(self.rate, ExactRatioV1):
            raise ContractValueError("rate must be ExactRatioV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "rate": self.rate.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class FundingEvidenceV1:
    """Funding observations plus the known funding schedule for one symbol.

    Schedule times are known future/past funding exchange moments; an absent
    schedule is honestly unknown, never a fabricated eight-hour default.
    """

    symbol: str
    posture: EvidencePosture
    completeness_start_ns: int
    completeness_end_ns: int
    observations: tuple[FundingObservationV1, ...]
    schedule_times_ns: tuple[int, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.posture, EvidencePosture) or self.posture not in _ALLOWED_POSTURES:
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q08 owns no live market evidence"
            )
        start = _require_ns(self.completeness_start_ns, field="completeness_start_ns")
        end = _require_ns(self.completeness_end_ns, field="completeness_end_ns")
        if start >= end:
            raise ContractValueError("completeness interval must be non-empty")
        if (
            not isinstance(self.observations, tuple)
            or len(self.observations) > MAX_FUNDING_OBSERVATIONS
        ):
            raise ContractValueError("observations must be a bounded tuple")
        previous_time: int | None = None
        previous_ordinal: int | None = None
        for index, observation in enumerate(self.observations):
            if not isinstance(observation, FundingObservationV1):
                raise ContractValueError(f"observations[{index}] must be FundingObservationV1")
            if previous_time is not None and previous_ordinal is not None:
                if observation.event_time_ns < previous_time:
                    raise ContractValueError("observations must be time-ordered")
                if observation.ordinal <= previous_ordinal:
                    raise ContractValueError("observation ordinals must strictly increase")
            if not start <= observation.event_time_ns <= end:
                raise ContractValueError("observations must lie inside the completeness interval")
            previous_time = observation.event_time_ns
            previous_ordinal = observation.ordinal
        if not isinstance(self.schedule_times_ns, tuple) or (
            len(self.schedule_times_ns) > MAX_SCHEDULE_TIMES
        ):
            raise ContractValueError("schedule_times_ns must be a bounded tuple")
        previous_schedule: int | None = None
        for time_value in self.schedule_times_ns:
            checked = _require_ns(time_value, field="schedule_times_ns")
            if previous_schedule is not None and checked <= previous_schedule:
                raise ContractValueError("schedule times must strictly increase")
            previous_schedule = checked

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessEndNs": str(self.completeness_end_ns),
            "completenessStartNs": str(self.completeness_start_ns),
            "observations": [observation.as_mapping() for observation in self.observations],
            "posture": self.posture.value,
            "scheduleTimesNs": [str(time_value) for time_value in self.schedule_times_ns],
            "symbol": self.symbol,
        }

    def last_observations_at_or_before(
        self,
        time_ns: int,
        count: int,
    ) -> tuple[FundingObservationV1, ...]:
        eligible = [
            observation for observation in self.observations if observation.event_time_ns <= time_ns
        ]
        return tuple(eligible[-count:])


def _feature_value(
    *,
    feature_id: str,
    as_of_ns: int,
    input_last_event_ns: int,
    status: FeatureValueStatus,
    value: FixedPointV1 | None,
) -> FeatureValueV1:
    return FeatureValueV1(
        feature_id=feature_id,
        as_of_ns=as_of_ns,
        input_last_event_ns=input_last_event_ns,
        status=status,
        value=value,
    )


def funding_level(
    evidence: FundingEvidenceV1,
    *,
    as_of_ns: int,
    max_staleness_ns: int,
) -> FeatureValueV1:
    """The latest observed funding rate; missing funding is UNKNOWN, never zero."""

    observations, as_of = _validated_window(evidence, as_of_ns, max_staleness_ns, count=1)
    if not observations:
        return _feature_value(
            feature_id=FUNDING_LEVEL_FEATURE_ID,
            as_of_ns=as_of,
            input_last_event_ns=as_of,
            status=FeatureValueStatus.UNKNOWN,
            value=None,
        )
    latest = observations[-1]
    if as_of - latest.event_time_ns > max_staleness_ns:
        return _feature_value(
            feature_id=FUNDING_LEVEL_FEATURE_ID,
            as_of_ns=as_of,
            input_last_event_ns=latest.event_time_ns,
            status=FeatureValueStatus.STALE,
            value=None,
        )
    return _feature_value(
        feature_id=FUNDING_LEVEL_FEATURE_ID,
        as_of_ns=as_of,
        input_last_event_ns=latest.event_time_ns,
        status=FeatureValueStatus.AVAILABLE,
        value=fp_from_ratio(latest.rate),
    )


def funding_change(
    evidence: FundingEvidenceV1,
    *,
    as_of_ns: int,
    max_staleness_ns: int,
) -> FeatureValueV1:
    """Latest funding rate minus the previous one; either missing stays UNKNOWN."""

    observations, as_of = _validated_window(evidence, as_of_ns, max_staleness_ns, count=2)
    if len(observations) < 2:
        last_event = observations[-1].event_time_ns if observations else as_of
        return _feature_value(
            feature_id=FUNDING_CHANGE_FEATURE_ID,
            as_of_ns=as_of,
            input_last_event_ns=last_event,
            status=FeatureValueStatus.UNKNOWN,
            value=None,
        )
    previous, latest = observations[-2], observations[-1]
    if as_of - latest.event_time_ns > max_staleness_ns:
        return _feature_value(
            feature_id=FUNDING_CHANGE_FEATURE_ID,
            as_of_ns=as_of,
            input_last_event_ns=latest.event_time_ns,
            status=FeatureValueStatus.STALE,
            value=None,
        )
    change = ratio_subtract(latest.rate, previous.rate)
    return _feature_value(
        feature_id=FUNDING_CHANGE_FEATURE_ID,
        as_of_ns=as_of,
        input_last_event_ns=latest.event_time_ns,
        status=FeatureValueStatus.AVAILABLE,
        value=fp_from_ratio(change),
    )


def time_to_next_funding(evidence: FundingEvidenceV1, *, as_of_ns: int) -> FeatureValueV1:
    """Nanoseconds until the next known scheduled funding exchange.

    Without a known future schedule time the result is UNKNOWN; the library never
    fabricates a default funding interval.
    """

    if not isinstance(evidence, FundingEvidenceV1):
        raise ContractValueError("evidence must be FundingEvidenceV1")
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    next_time: int | None = None
    for time_value in evidence.schedule_times_ns:
        if time_value > as_of:
            next_time = time_value
            break
    if next_time is None:
        return _feature_value(
            feature_id=TIME_TO_NEXT_FUNDING_FEATURE_ID,
            as_of_ns=as_of,
            input_last_event_ns=as_of,
            status=FeatureValueStatus.UNKNOWN,
            value=None,
        )
    # The value is the exact nanosecond count expressed at the fixed-point scale.
    return _feature_value(
        feature_id=TIME_TO_NEXT_FUNDING_FEATURE_ID,
        as_of_ns=as_of,
        input_last_event_ns=as_of,
        status=FeatureValueStatus.AVAILABLE,
        value=fp_from_int(next_time - as_of),
    )


def schedule_interval_verdict(
    evidence: FundingEvidenceV1,
    *,
    as_of_ns: int,
) -> ScheduleIntervalVerdict:
    """Whether the known funding schedule spacing changes at or before as-of.

    Fewer than three known schedule times cannot support a verdict and stay UNKNOWN;
    funding-cap/frequency regime discovery beyond spacing remains a later phase.
    """

    if not isinstance(evidence, FundingEvidenceV1):
        raise ContractValueError("evidence must be FundingEvidenceV1")
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    known = [time_value for time_value in evidence.schedule_times_ns if time_value <= as_of]
    if len(known) < 3:
        return ScheduleIntervalVerdict.UNKNOWN
    intervals = [second - first for first, second in itertools.pairwise(known)]
    if any(interval != intervals[0] for interval in intervals[1:]):
        return ScheduleIntervalVerdict.CHANGED
    return ScheduleIntervalVerdict.UNCHANGED


def _validated_window(
    evidence: FundingEvidenceV1,
    as_of_ns: int,
    max_staleness_ns: int,
    *,
    count: int,
) -> tuple[tuple[FundingObservationV1, ...], int]:
    if not isinstance(evidence, FundingEvidenceV1):
        raise ContractValueError("evidence must be FundingEvidenceV1")
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    require_strict_int(
        max_staleness_ns,
        field="max_staleness_ns",
        minimum=1,
        maximum=MAX_FUNDING_STALENESS_NS,
    )
    return evidence.last_observations_at_or_before(as_of, count), as_of
