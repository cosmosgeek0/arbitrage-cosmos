"""Censored time-to-event contracts for the Q11 survival layer.

Durations are integer nanoseconds relative to each subject's own time origin
(its feature cutoff). A subject either experienced an ``EVENT`` of exactly one
registered cause or is ``RIGHT_CENSORED``; censored subjects remain censored
everywhere downstream (§11.7). Quality gating is a measured builder step: only
``COMPLETE``/``SYNTHETIC`` subjects enter a cohort, everything else is excluded
into per-quality counts and never becomes a normal negative. All published
probabilities are fixed-point values quantized half-even exactly once at the
contract boundary; integer counts are published raw.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.lake.contracts import (
    EvidencePosture,
    QualityState,
    require_contract_id,
    require_strict_int,
)

MAX_SUBJECTS: Final = 10_000
MAX_CAUSES: Final = 8
MAX_GRID_TIMES: Final = 512
MAX_STRATA: Final = 64
MAX_DURATION_NS: Final = 400 * 24 * 3_600 * 1_000_000_000

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})
_ELIGIBLE_QUALITIES: Final = frozenset({QualityState.COMPLETE, QualityState.SYNTHETIC})


class SurvivalTarget(StrEnum):
    """The six §14.4 time-to-event targets; a versioned vocabulary, not market truth."""

    TIME_TO_IGNITION = "TIME_TO_IGNITION"
    TIME_TO_CONTINUATION = "TIME_TO_CONTINUATION"
    TIME_TO_FADE = "TIME_TO_FADE"
    TIME_TO_CONVERGENCE = "TIME_TO_CONVERGENCE"
    TIME_TO_INVALIDATION = "TIME_TO_INVALIDATION"
    ACTIONABILITY_WINDOW = "ACTIONABILITY_WINDOW"


class SubjectStatus(StrEnum):
    EVENT = "EVENT"
    RIGHT_CENSORED = "RIGHT_CENSORED"


def fraction_to_fixed_point(value: Fraction) -> FixedPointV1:
    """Quantize an exact rational half-even to the house fixed-point scale.

    This is the single documented boundary between exact internal arithmetic and
    published numbers; it is applied exactly once per published value.
    """

    if not isinstance(value, Fraction):
        raise ContractValueError("value must be an exact Fraction")
    return FixedPointV1(round_half_even(value.numerator * FIXED_POINT_SCALE, value.denominator))


def fixed_point_to_fraction(value: FixedPointV1) -> Fraction:
    """Read a published fixed-point value back as its exact rational."""

    if not isinstance(value, FixedPointV1):
        raise ContractValueError("value must be FixedPointV1")
    return Fraction(value.mantissa, FIXED_POINT_SCALE)


def require_probability(value: object, *, field: str) -> FixedPointV1:
    if not isinstance(value, FixedPointV1):
        raise ContractValueError(f"{field} must be FixedPointV1")
    if not 0 <= value.mantissa <= FIXED_POINT_SCALE:
        raise ContractValueError(f"{field} must lie inside [0, 1]")
    return value


@dataclass(frozen=True, slots=True)
class CauseSetV1:
    """Bounded registry of competing-event causes; sorted, unique, immutable."""

    cause_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.cause_ids, tuple) or not 1 <= len(self.cause_ids) <= MAX_CAUSES:
            raise ContractValueError(f"cause_ids must be a tuple of 1..{MAX_CAUSES} causes")
        for index, cause_id in enumerate(self.cause_ids):
            require_contract_id(cause_id, field=f"cause_ids[{index}]")
        if list(self.cause_ids) != sorted(set(self.cause_ids)):
            raise ContractValueError("cause_ids must be strictly sorted and unique")

    def index_of(self, cause_id: str) -> int:
        require_contract_id(cause_id, field="cause_id")
        try:
            return self.cause_ids.index(cause_id)
        except ValueError as error:
            raise ContractValueError(f"cause {cause_id} is not registered") from error

    def as_mapping(self) -> dict[str, object]:
        return {"causeIds": list(self.cause_ids)}


@dataclass(frozen=True, slots=True)
class SubjectV1:
    """One censored time-to-event observation with explicit quality truth."""

    subject_id: str
    group_id: str
    stratum_id: str
    duration_ns: int
    status: SubjectStatus
    cause_id: str | None
    quality: QualityState

    def __post_init__(self) -> None:
        require_contract_id(self.subject_id, field="subject_id")
        require_contract_id(self.group_id, field="group_id")
        require_contract_id(self.stratum_id, field="stratum_id")
        require_strict_int(
            self.duration_ns, field="duration_ns", minimum=1, maximum=MAX_DURATION_NS
        )
        if not isinstance(self.status, SubjectStatus):
            raise ContractValueError("status must be SubjectStatus")
        if self.status is SubjectStatus.EVENT:
            if self.cause_id is None:
                raise ContractValueError("EVENT subjects must carry a cause")
            require_contract_id(self.cause_id, field="cause_id")
        elif self.cause_id is not None:
            raise ContractValueError("only EVENT subjects may carry a cause")
        if not isinstance(self.quality, QualityState):
            raise ContractValueError("quality must be QualityState")

    @property
    def is_event(self) -> bool:
        return self.status is SubjectStatus.EVENT

    @property
    def is_eligible(self) -> bool:
        return self.quality in _ELIGIBLE_QUALITIES

    def as_mapping(self) -> dict[str, object]:
        return {
            "causeId": self.cause_id,
            "durationNs": str(self.duration_ns),
            "groupId": self.group_id,
            "quality": self.quality.value,
            "status": self.status.value,
            "stratumId": self.stratum_id,
            "subjectId": self.subject_id,
        }


@dataclass(frozen=True, slots=True)
class SurvivalCohortV1:
    """Bounded cohort of eligible censored subjects; posture is honest, never live."""

    cohort_id: str
    target: SurvivalTarget
    causes: CauseSetV1
    posture: EvidencePosture
    subjects: tuple[SubjectV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.cohort_id, field="cohort_id")
        if not isinstance(self.target, SurvivalTarget):
            raise ContractValueError("target must be SurvivalTarget")
        if not isinstance(self.causes, CauseSetV1):
            raise ContractValueError("causes must be CauseSetV1")
        if not isinstance(self.posture, EvidencePosture) or self.posture not in _ALLOWED_POSTURES:
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q11 owns no live market evidence"
            )
        if (
            not isinstance(self.subjects, tuple)
            or not self.subjects
            or len(self.subjects) > MAX_SUBJECTS
        ):
            raise ContractValueError(f"subjects must be a tuple of 1..{MAX_SUBJECTS} subjects")
        seen: set[str] = set()
        strata: set[str] = set()
        for index, subject in enumerate(self.subjects):
            if not isinstance(subject, SubjectV1):
                raise ContractValueError(f"subjects[{index}] must be SubjectV1")
            if subject.subject_id in seen:
                raise ContractValueError(f"duplicate subject id {subject.subject_id}")
            seen.add(subject.subject_id)
            strata.add(subject.stratum_id)
            if not subject.is_eligible:
                raise ContractValueError(
                    "cohorts accept only COMPLETE/SYNTHETIC subjects; use build_cohort"
                )
            if subject.cause_id is not None and subject.cause_id not in self.causes.cause_ids:
                raise ContractValueError(f"cause {subject.cause_id} is not in the cause set")
        if len(strata) > MAX_STRATA:
            raise ContractValueError(f"cohorts are bounded to {MAX_STRATA} strata")

    @property
    def size(self) -> int:
        return len(self.subjects)

    @property
    def censored_count(self) -> int:
        return sum(1 for subject in self.subjects if not subject.is_event)

    def event_counts(self) -> tuple[int, ...]:
        counts = [0] * len(self.causes.cause_ids)
        for subject in self.subjects:
            if subject.cause_id is not None:
                counts[self.causes.index_of(subject.cause_id)] += 1
        return tuple(counts)

    def as_mapping(self) -> dict[str, object]:
        return {
            "causes": self.causes.as_mapping(),
            "cohortId": self.cohort_id,
            "posture": self.posture.value,
            "subjects": [subject.as_mapping() for subject in self.subjects],
            "target": self.target.value,
        }


@dataclass(frozen=True, slots=True)
class CohortBuildResultV1:
    """Quality-gated cohort construction with measured DATA_INVALID-style exclusions."""

    cohort: SurvivalCohortV1 | None
    excluded_by_quality: tuple[tuple[QualityState, int], ...]

    def __post_init__(self) -> None:
        if self.cohort is not None and not isinstance(self.cohort, SurvivalCohortV1):
            raise ContractValueError("cohort must be SurvivalCohortV1 or None")
        if not isinstance(self.excluded_by_quality, tuple):
            raise ContractValueError("excluded_by_quality must be a tuple")
        for entry in self.excluded_by_quality:
            if (
                not isinstance(entry, tuple)
                or len(entry) != 2
                or not isinstance(entry[0], QualityState)
            ):
                raise ContractValueError("exclusion entries must be (QualityState, count)")
            require_strict_int(entry[1], field="exclusion count", minimum=1)

    @property
    def excluded_total(self) -> int:
        return sum(count for _, count in self.excluded_by_quality)

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohort": None if self.cohort is None else self.cohort.as_mapping(),
            "excludedByQuality": {
                quality.value: count for quality, count in self.excluded_by_quality
            },
        }


def build_cohort(
    *,
    cohort_id: str,
    target: SurvivalTarget,
    causes: CauseSetV1,
    posture: EvidencePosture,
    candidates: tuple[SubjectV1, ...],
) -> CohortBuildResultV1:
    """Admit eligible subjects and count every ineligible one by its quality.

    Gapped/stale/unknown evidence never becomes a normal negative (§11.7); it is
    excluded and measured. An all-ineligible candidate set yields no cohort.
    """

    if not isinstance(candidates, tuple) or not candidates or len(candidates) > MAX_SUBJECTS:
        raise ContractValueError(f"candidates must be a tuple of 1..{MAX_SUBJECTS} subjects")
    eligible: list[SubjectV1] = []
    excluded: Counter[QualityState] = Counter()
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, SubjectV1):
            raise ContractValueError(f"candidates[{index}] must be SubjectV1")
        if candidate.is_eligible:
            eligible.append(candidate)
        else:
            excluded[candidate.quality] += 1
    cohort = (
        SurvivalCohortV1(
            cohort_id=cohort_id,
            target=target,
            causes=causes,
            posture=posture,
            subjects=tuple(eligible),
        )
        if eligible
        else None
    )
    if cohort is None:
        require_contract_id(cohort_id, field="cohort_id")
    return CohortBuildResultV1(
        cohort=cohort,
        excluded_by_quality=tuple(sorted(excluded.items(), key=lambda item: item[0].value)),
    )


@dataclass(frozen=True, slots=True)
class TimeGridV1:
    """Bounded strictly increasing evaluation grid with a right-closed binning law.

    Bin ``j`` covers ``(times_ns[j-1], times_ns[j]]`` with an implicit left edge of
    zero for the first bin. Durations beyond the last grid time belong to no bin;
    callers administratively censor them at grid end and count them.
    """

    grid_id: str
    times_ns: tuple[int, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.grid_id, field="grid_id")
        if not isinstance(self.times_ns, tuple) or not 1 <= len(self.times_ns) <= MAX_GRID_TIMES:
            raise ContractValueError(f"times_ns must be a tuple of 1..{MAX_GRID_TIMES} times")
        previous = 0
        for index, time_ns in enumerate(self.times_ns):
            require_strict_int(
                time_ns, field=f"times_ns[{index}]", minimum=1, maximum=MAX_DURATION_NS
            )
            if time_ns <= previous:
                raise ContractValueError("grid times must strictly increase")
            previous = time_ns

    @property
    def bin_count(self) -> int:
        return len(self.times_ns)

    @property
    def end_ns(self) -> int:
        return self.times_ns[-1]

    def bin_index(self, duration_ns: int) -> int | None:
        """Return the right-closed bin holding ``duration_ns``; None beyond the grid."""

        require_strict_int(duration_ns, field="duration_ns", minimum=1, maximum=MAX_DURATION_NS)
        if duration_ns > self.end_ns:
            return None
        low, high = 0, len(self.times_ns) - 1
        while low < high:
            middle = (low + high) // 2
            if self.times_ns[middle] < duration_ns:
                low = middle + 1
            else:
                high = middle
        return low

    def index_of_time(self, time_ns: int) -> int:
        """Return the exact grid position of ``time_ns``; horizons must be on-grid."""

        require_strict_int(time_ns, field="time_ns", minimum=1, maximum=MAX_DURATION_NS)
        position = self.bin_index(time_ns)
        if position is None or self.times_ns[position] != time_ns:
            raise ContractValueError(f"time {time_ns} is not a grid time")
        return position

    def as_mapping(self) -> dict[str, object]:
        return {
            "gridId": self.grid_id,
            "timesNs": [str(time_ns) for time_ns in self.times_ns],
        }


@dataclass(frozen=True, slots=True)
class TimeTableRowV1:
    """Exact integer counts at one distinct observed time; the estimators' input."""

    time_ns: int
    at_risk: int
    events: tuple[int, ...]
    censored: int

    def __post_init__(self) -> None:
        require_strict_int(self.time_ns, field="time_ns", minimum=1, maximum=MAX_DURATION_NS)
        require_strict_int(self.at_risk, field="at_risk", minimum=1)
        if not isinstance(self.events, tuple) or not 1 <= len(self.events) <= MAX_CAUSES:
            raise ContractValueError(f"events must be a tuple of 1..{MAX_CAUSES} counts")
        for index, count in enumerate(self.events):
            require_strict_int(count, field=f"events[{index}]", minimum=0)
        require_strict_int(self.censored, field="censored", minimum=0)
        total = sum(self.events) + self.censored
        if total < 1:
            raise ContractValueError("a table row must record at least one departure")
        if total > self.at_risk:
            raise ContractValueError("departures cannot exceed the risk set")

    @property
    def total_events(self) -> int:
        return sum(self.events)

    def as_mapping(self) -> dict[str, object]:
        return {
            "atRisk": self.at_risk,
            "censored": self.censored,
            "events": list(self.events),
            "timeNs": str(self.time_ns),
        }


def event_time_table(
    subjects: tuple[SubjectV1, ...],
    causes: CauseSetV1,
) -> tuple[TimeTableRowV1, ...]:
    """Aggregate subjects into exact per-time risk-set/event/censoring counts.

    Rows are emitted at every distinct observed duration in ascending order; the
    risk set at time ``t`` counts every subject with duration at or above ``t``.
    """

    if not isinstance(subjects, tuple) or not subjects or len(subjects) > MAX_SUBJECTS:
        raise ContractValueError(f"subjects must be a tuple of 1..{MAX_SUBJECTS} subjects")
    if not isinstance(causes, CauseSetV1):
        raise ContractValueError("causes must be CauseSetV1")
    cause_count = len(causes.cause_ids)
    events_at: dict[int, list[int]] = {}
    censored_at: dict[int, int] = {}
    for index, subject in enumerate(subjects):
        if not isinstance(subject, SubjectV1):
            raise ContractValueError(f"subjects[{index}] must be SubjectV1")
        if subject.cause_id is None:
            censored_at[subject.duration_ns] = censored_at.get(subject.duration_ns, 0) + 1
        else:
            row = events_at.setdefault(subject.duration_ns, [0] * cause_count)
            row[causes.index_of(subject.cause_id)] += 1
    at_risk = len(subjects)
    rows: list[TimeTableRowV1] = []
    for time_ns in sorted(set(events_at) | set(censored_at)):
        event_row = tuple(events_at.get(time_ns, [0] * cause_count))
        censored = censored_at.get(time_ns, 0)
        rows.append(
            TimeTableRowV1(
                time_ns=time_ns,
                at_risk=at_risk,
                events=event_row,
                censored=censored,
            )
        )
        at_risk -= sum(event_row) + censored
    return tuple(rows)
