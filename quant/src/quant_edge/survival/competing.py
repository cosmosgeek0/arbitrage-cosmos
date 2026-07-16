"""Exact Aalen-Johansen cause-specific cumulative incidence for competing risks.

The estimator runs over the same integer time table as Kaplan-Meier. At each
distinct time the incidence of cause ``k`` grows by ``S(t-) * d_k / n``; the
overall survival then absorbs all causes at once. In the internal rationals,
``S(t) + sum_k CIF_k(t) == 1`` holds exactly at every step — the conservation
law the property suite asserts against an independent reference. With a single
cause the incidence equals ``1 - KM`` exactly.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FP_ZERO, FixedPointV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.survival.contracts import (
    MAX_DURATION_NS,
    MAX_SUBJECTS,
    SurvivalCohortV1,
    TimeTableRowV1,
    event_time_table,
    fraction_to_fixed_point,
)
from quant_edge.survival.km import ONE, CurveRole, SurvivalCurveV1, _curve_from_table


def exact_incidence_steps(
    table: tuple[TimeTableRowV1, ...],
    cause_index: int,
) -> tuple[tuple[int, Fraction], ...]:
    """Exact internal layer: per distinct time, (time, CIF of the cause after it)."""

    if not isinstance(table, tuple) or not table:
        raise ContractValueError("table must be a non-empty tuple of TimeTableRowV1")
    require_strict_int(
        cause_index, field="cause_index", minimum=0, maximum=len(table[0].events) - 1
    )
    survival_before = ONE
    incidence = Fraction(0)
    steps: list[tuple[int, Fraction]] = []
    for index, row in enumerate(table):
        if not isinstance(row, TimeTableRowV1):
            raise ContractValueError(f"table[{index}] must be TimeTableRowV1")
        if len(row.events) != len(table[0].events):
            raise ContractValueError("table rows must share one cause arity")
        departures = row.total_events
        if departures > 0:
            incidence += survival_before * Fraction(row.events[cause_index], row.at_risk)
            survival_before *= Fraction(row.at_risk - departures, row.at_risk)
        steps.append((row.time_ns, incidence))
    return tuple(steps)


@dataclass(frozen=True, slots=True)
class IncidencePointV1:
    """Counts and quantized cumulative incidence after one distinct observed time."""

    time_ns: int
    at_risk: int
    cause_events: int
    incidence: FixedPointV1

    def __post_init__(self) -> None:
        require_strict_int(self.time_ns, field="time_ns", minimum=1, maximum=MAX_DURATION_NS)
        require_strict_int(self.at_risk, field="at_risk", minimum=1)
        require_strict_int(self.cause_events, field="cause_events", minimum=0)
        if not isinstance(self.incidence, FixedPointV1) or self.incidence.mantissa < 0:
            raise ContractValueError("incidence must be a non-negative FixedPointV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "atRisk": self.at_risk,
            "causeEvents": self.cause_events,
            "incidence": self.incidence.as_mapping(),
            "timeNs": str(self.time_ns),
        }


@dataclass(frozen=True, slots=True)
class CauseIncidenceCurveV1:
    """Right-continuous cumulative-incidence step curve for one competing cause."""

    cause_id: str
    subjects: int
    follow_up_end_ns: int
    points: tuple[IncidencePointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.cause_id, field="cause_id")
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
            if not isinstance(point, IncidencePointV1):
                raise ContractValueError(f"points[{index}] must be IncidencePointV1")
            if point.time_ns <= previous:
                raise ContractValueError("incidence points must strictly increase in time")
            previous = point.time_ns
        if previous != self.follow_up_end_ns:
            raise ContractValueError("follow-up end must equal the last observed time")

    def incidence_at(self, time_ns: int) -> FixedPointV1 | None:
        """Step-evaluate CIF(t); zero before the first point, None beyond follow-up."""

        require_strict_int(time_ns, field="time_ns", minimum=0, maximum=MAX_DURATION_NS)
        if time_ns > self.follow_up_end_ns:
            return None
        value = FP_ZERO
        for point in self.points:
            if point.time_ns > time_ns:
                break
            value = point.incidence
        return value

    def as_mapping(self) -> dict[str, object]:
        return {
            "causeId": self.cause_id,
            "followUpEndNs": str(self.follow_up_end_ns),
            "points": [point.as_mapping() for point in self.points],
            "subjects": self.subjects,
        }


@dataclass(frozen=True, slots=True)
class AalenJohansenV1:
    """Overall survival plus one cumulative-incidence curve per registered cause."""

    cohort_id: str
    overall_survival: SurvivalCurveV1
    incidence: tuple[CauseIncidenceCurveV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.cohort_id, field="cohort_id")
        if not isinstance(self.overall_survival, SurvivalCurveV1):
            raise ContractValueError("overall_survival must be SurvivalCurveV1")
        if not isinstance(self.incidence, tuple) or not self.incidence:
            raise ContractValueError("incidence must be a non-empty tuple")
        for index, curve in enumerate(self.incidence):
            if not isinstance(curve, CauseIncidenceCurveV1):
                raise ContractValueError(f"incidence[{index}] must be CauseIncidenceCurveV1")
            if curve.follow_up_end_ns != self.overall_survival.follow_up_end_ns:
                raise ContractValueError("incidence follow-up must match overall survival")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortId": self.cohort_id,
            "incidence": [curve.as_mapping() for curve in self.incidence],
            "overallSurvival": self.overall_survival.as_mapping(),
        }


def estimate_aalen_johansen(cohort: SurvivalCohortV1) -> AalenJohansenV1:
    """Aalen-Johansen cumulative incidence per cause with the all-cause survival."""

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    table = event_time_table(cohort.subjects, cohort.causes)
    overall = _curve_from_table(
        curve_id=f"{cohort.cohort_id}.aj",
        role=CurveRole.EVENT_SURVIVAL,
        subjects=cohort.size,
        table=table,
    )
    curves: list[CauseIncidenceCurveV1] = []
    for cause_index, cause_id in enumerate(cohort.causes.cause_ids):
        steps = exact_incidence_steps(table, cause_index)
        points = tuple(
            IncidencePointV1(
                time_ns=row.time_ns,
                at_risk=row.at_risk,
                cause_events=row.events[cause_index],
                incidence=fraction_to_fixed_point(incidence),
            )
            for row, (_, incidence) in zip(table, steps, strict=True)
        )
        curves.append(
            CauseIncidenceCurveV1(
                cause_id=cause_id,
                subjects=cohort.size,
                follow_up_end_ns=table[-1].time_ns,
                points=points,
            )
        )
    return AalenJohansenV1(
        cohort_id=cohort.cohort_id,
        overall_survival=overall,
        incidence=tuple(curves),
    )
