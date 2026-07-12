"""Exact Kaplan-Meier, Nelson-Aalen and reverse-KM (censoring) estimators.

All arithmetic is exact rational over the integer time table; published values
are quantized half-even to fixed point exactly once at the contract boundary.
At tied times, events are processed before censorings (the standard
product-limit convention), so the censoring estimator's risk set at a tied time
excludes that time's true events. Step evaluation beyond observed follow-up
returns ``None``: unknowns stay ``UNKNOWN``.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FP_ONE, FixedPointV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.survival.contracts import (
    MAX_DURATION_NS,
    MAX_SUBJECTS,
    SurvivalCohortV1,
    TimeTableRowV1,
    event_time_table,
    fraction_to_fixed_point,
)

ONE = Fraction(1)
ZERO = Fraction(0)


class CurveRole(StrEnum):
    EVENT_SURVIVAL = "EVENT_SURVIVAL"
    CENSORING_SURVIVAL = "CENSORING_SURVIVAL"


def exact_survival_steps(
    table: tuple[TimeTableRowV1, ...],
    *,
    role: CurveRole,
) -> tuple[tuple[int, Fraction, Fraction], ...]:
    """Exact internal layer: per distinct time, (time, S after, cumulative hazard after).

    For ``EVENT_SURVIVAL`` the risk set is every subject still observed at the
    time; for ``CENSORING_SURVIVAL`` the roles are exchanged and that time's true
    events leave the risk set before censorings are counted. Times where the
    tracked quantity has no departures still emit a step (with unchanged values)
    so downstream step evaluation can align on every observed time.
    """

    if not isinstance(table, tuple):
        raise ContractValueError("table must be a tuple of TimeTableRowV1")
    if not isinstance(role, CurveRole):
        raise ContractValueError("role must be CurveRole")
    survival = ONE
    hazard = ZERO
    steps: list[tuple[int, Fraction, Fraction]] = []
    for index, row in enumerate(table):
        if not isinstance(row, TimeTableRowV1):
            raise ContractValueError(f"table[{index}] must be TimeTableRowV1")
        if role is CurveRole.EVENT_SURVIVAL:
            departures = row.total_events
            risk_set = row.at_risk
        else:
            departures = row.censored
            risk_set = row.at_risk - row.total_events
        if departures > 0:
            survival *= Fraction(risk_set - departures, risk_set)
            hazard += Fraction(departures, risk_set)
        steps.append((row.time_ns, survival, hazard))
    return tuple(steps)


@dataclass(frozen=True, slots=True)
class SurvivalCurvePointV1:
    """Counts and quantized survival state after one distinct observed time."""

    time_ns: int
    at_risk: int
    events: int
    censored: int
    survival: FixedPointV1
    cumulative_hazard: FixedPointV1

    def __post_init__(self) -> None:
        require_strict_int(self.time_ns, field="time_ns", minimum=1, maximum=MAX_DURATION_NS)
        require_strict_int(self.at_risk, field="at_risk", minimum=1)
        require_strict_int(self.events, field="events", minimum=0)
        require_strict_int(self.censored, field="censored", minimum=0)
        if not isinstance(self.survival, FixedPointV1):
            raise ContractValueError("survival must be FixedPointV1")
        if not isinstance(self.cumulative_hazard, FixedPointV1):
            raise ContractValueError("cumulative_hazard must be FixedPointV1")
        if self.survival.mantissa < 0 or self.cumulative_hazard.mantissa < 0:
            raise ContractValueError("survival state cannot be negative")

    def as_mapping(self) -> dict[str, object]:
        return {
            "atRisk": self.at_risk,
            "censored": self.censored,
            "cumulativeHazard": self.cumulative_hazard.as_mapping(),
            "events": self.events,
            "survival": self.survival.as_mapping(),
            "timeNs": str(self.time_ns),
        }


@dataclass(frozen=True, slots=True)
class SurvivalCurveV1:
    """Right-continuous step curve over the observed follow-up; bounded and typed."""

    curve_id: str
    role: CurveRole
    subjects: int
    follow_up_end_ns: int
    points: tuple[SurvivalCurvePointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.curve_id, field="curve_id")
        if not isinstance(self.role, CurveRole):
            raise ContractValueError("role must be CurveRole")
        require_strict_int(self.subjects, field="subjects", minimum=1, maximum=MAX_SUBJECTS)
        require_strict_int(
            self.follow_up_end_ns,
            field="follow_up_end_ns",
            minimum=1,
            maximum=MAX_DURATION_NS,
        )
        if not isinstance(self.points, tuple) or not self.points:
            raise ContractValueError("points must be a non-empty tuple")
        previous = 0
        for index, point in enumerate(self.points):
            if not isinstance(point, SurvivalCurvePointV1):
                raise ContractValueError(f"points[{index}] must be SurvivalCurvePointV1")
            if point.time_ns <= previous:
                raise ContractValueError("curve points must strictly increase in time")
            previous = point.time_ns
        if previous != self.follow_up_end_ns:
            raise ContractValueError("follow-up end must equal the last observed time")

    def survival_at(self, time_ns: int) -> FixedPointV1 | None:
        """Step-evaluate S(t); one before the first point, None beyond follow-up."""

        require_strict_int(time_ns, field="time_ns", minimum=0, maximum=MAX_DURATION_NS)
        if time_ns > self.follow_up_end_ns:
            return None
        value = FP_ONE
        for point in self.points:
            if point.time_ns > time_ns:
                break
            value = point.survival
        return value

    def as_mapping(self) -> dict[str, object]:
        return {
            "curveId": self.curve_id,
            "followUpEndNs": str(self.follow_up_end_ns),
            "points": [point.as_mapping() for point in self.points],
            "role": self.role.value,
            "subjects": self.subjects,
        }


def _curve_from_table(
    *,
    curve_id: str,
    role: CurveRole,
    subjects: int,
    table: tuple[TimeTableRowV1, ...],
) -> SurvivalCurveV1:
    steps = exact_survival_steps(table, role=role)
    points: list[SurvivalCurvePointV1] = []
    for row, (time_ns, survival, hazard) in zip(table, steps, strict=True):
        points.append(
            SurvivalCurvePointV1(
                time_ns=time_ns,
                at_risk=row.at_risk,
                events=row.total_events,
                censored=row.censored,
                survival=fraction_to_fixed_point(survival),
                cumulative_hazard=fraction_to_fixed_point(hazard),
            )
        )
    return SurvivalCurveV1(
        curve_id=curve_id,
        role=role,
        subjects=subjects,
        follow_up_end_ns=table[-1].time_ns,
        points=tuple(points),
    )


def estimate_kaplan_meier(cohort: SurvivalCohortV1) -> SurvivalCurveV1:
    """All-cause Kaplan-Meier survival with the Nelson-Aalen cumulative hazard."""

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    table = event_time_table(cohort.subjects, cohort.causes)
    return _curve_from_table(
        curve_id=f"{cohort.cohort_id}.km",
        role=CurveRole.EVENT_SURVIVAL,
        subjects=cohort.size,
        table=table,
    )


def estimate_censoring_survival(cohort: SurvivalCohortV1) -> SurvivalCurveV1:
    """Reverse Kaplan-Meier estimate of the censoring distribution G for IPCW."""

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    table = event_time_table(cohort.subjects, cohort.causes)
    return _curve_from_table(
        curve_id=f"{cohort.cohort_id}.reverse-km",
        role=CurveRole.CENSORING_SURVIVAL,
        subjects=cohort.size,
        table=table,
    )
