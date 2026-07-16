from __future__ import annotations

from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FP_ZERO, FixedPointV1
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.competing import (
    AalenJohansenV1,
    CauseIncidenceCurveV1,
    IncidencePointV1,
    estimate_aalen_johansen,
    exact_incidence_steps,
)
from quant_edge.survival.contracts import (
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeTableRowV1,
    event_time_table,
    fraction_to_fixed_point,
)
from quant_edge.survival.km import CurveRole, estimate_kaplan_meier, exact_survival_steps

SECOND_NS = 1_000_000_000
CAUSES = CauseSetV1(cause_ids=("A", "B"))


def subject(subject_id: str, seconds: int, cause_id: str | None) -> SubjectV1:
    return SubjectV1(
        subject_id=subject_id,
        group_id=subject_id,
        stratum_id="ALL",
        duration_ns=seconds * SECOND_NS,
        status=SubjectStatus.RIGHT_CENSORED if cause_id is None else SubjectStatus.EVENT,
        cause_id=cause_id,
        quality=QualityState.SYNTHETIC,
    )


def cohort(subjects: tuple[SubjectV1, ...], causes: CauseSetV1 = CAUSES) -> SurvivalCohortV1:
    return SurvivalCohortV1(
        cohort_id="q11.test.aj",
        target=SurvivalTarget.ACTIONABILITY_WINDOW,
        causes=causes,
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


HAND_COHORT = cohort(
    (
        subject("s1", 1, "A"),
        subject("s2", 2, "B"),
        subject("s3", 3, None),
        subject("s4", 4, "A"),
        subject("s5", 5, None),
        subject("s6", 7, "B"),
    )
)


class TestAalenJohansen:
    def test_hand_verified_incidence_curves(self) -> None:
        estimate = estimate_aalen_johansen(HAND_COHORT)
        cause_a = estimate.incidence[0]
        cause_b = estimate.incidence[1]
        assert cause_a.cause_id == "A"
        assert cause_b.cause_id == "B"
        by_seconds_a = {point.time_ns // SECOND_NS: point.incidence for point in cause_a.points}
        by_seconds_b = {point.time_ns // SECOND_NS: point.incidence for point in cause_b.points}
        # CIF_A: 1/6 at t=1, then + S(1-)*1/3 = 1/6 + (2/3)(1/3) = 7/18 at t=4.
        assert by_seconds_a[1] == fraction_to_fixed_point(Fraction(1, 6))
        assert by_seconds_a[4] == fraction_to_fixed_point(Fraction(7, 18))
        assert by_seconds_a[7] == fraction_to_fixed_point(Fraction(7, 18))
        # CIF_B: (5/6)(1/5) = 1/6 at t=2, then + (4/9)(1/1) = 11/18 at t=7.
        assert by_seconds_b[2] == fraction_to_fixed_point(Fraction(1, 6))
        assert by_seconds_b[7] == fraction_to_fixed_point(Fraction(11, 18))
        # Overall survival at the end is zero: 0 + 7/18 + 11/18 = 1.
        assert estimate.overall_survival.points[-1].survival.mantissa == 0

    def test_conservation_is_exact_in_the_internal_rationals(self) -> None:
        table = event_time_table(HAND_COHORT.subjects, HAND_COHORT.causes)
        survival_steps = exact_survival_steps(table, role=CurveRole.EVENT_SURVIVAL)
        incidence_a = exact_incidence_steps(table, 0)
        incidence_b = exact_incidence_steps(table, 1)
        for (_, survival, _), (_, cif_a), (_, cif_b) in zip(
            survival_steps, incidence_a, incidence_b, strict=True
        ):
            assert survival + cif_a + cif_b == Fraction(1)

    def test_quantized_conservation_defect_is_bounded_by_rounding(self) -> None:
        estimate = estimate_aalen_johansen(HAND_COHORT)
        causes = len(estimate.incidence)
        for index, point in enumerate(estimate.overall_survival.points):
            total = point.survival.mantissa + sum(
                curve.points[index].incidence.mantissa for curve in estimate.incidence
            )
            assert abs(total - 10**12) <= (causes + 1)

    def test_single_cause_incidence_equals_one_minus_km(self) -> None:
        single = cohort(
            (
                subject("s1", 1, "A"),
                subject("s2", 3, None),
                subject("s3", 4, "A"),
                subject("s4", 6, None),
            ),
            causes=CauseSetV1(cause_ids=("A",)),
        )
        estimate = estimate_aalen_johansen(single)
        km = estimate_kaplan_meier(single)
        for aj_point, km_point in zip(estimate.incidence[0].points, km.points, strict=True):
            assert aj_point.incidence.mantissa == 10**12 - km_point.survival.mantissa

    def test_incidence_at_step_law(self) -> None:
        estimate = estimate_aalen_johansen(HAND_COHORT)
        curve = estimate.incidence[0]
        assert curve.incidence_at(0) == FP_ZERO
        assert curve.incidence_at(SECOND_NS) == fraction_to_fixed_point(Fraction(1, 6))
        assert curve.incidence_at(3 * SECOND_NS) == fraction_to_fixed_point(Fraction(1, 6))
        assert curve.incidence_at(7 * SECOND_NS) == fraction_to_fixed_point(Fraction(7, 18))
        assert curve.incidence_at(8 * SECOND_NS) is None
        with pytest.raises(ContractValueError, match="time_ns"):
            curve.incidence_at(-1)

    def test_as_mapping_shape(self) -> None:
        estimate = estimate_aalen_johansen(HAND_COHORT)
        mapping = estimate.as_mapping()
        assert mapping["cohortId"] == "q11.test.aj"
        assert isinstance(mapping["incidence"], list)
        assert isinstance(mapping["overallSurvival"], dict)
        point_mapping = estimate.incidence[0].points[0].as_mapping()
        assert point_mapping["atRisk"] == 6
        assert point_mapping["causeEvents"] == 1

    def test_rejects_non_cohort(self) -> None:
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            estimate_aalen_johansen("cohort")  # type: ignore[arg-type]


class TestExactIncidenceSteps:
    def test_rejects_bad_tables(self) -> None:
        with pytest.raises(ContractValueError, match="non-empty"):
            exact_incidence_steps((), 0)
        table = event_time_table((subject("s1", 1, "A"),), CAUSES)
        with pytest.raises(ContractValueError, match="cause_index"):
            exact_incidence_steps(table, 2)
        with pytest.raises(ContractValueError, match="cause_index"):
            exact_incidence_steps(table, -1)
        with pytest.raises(ContractValueError, match="TimeTableRowV1"):
            exact_incidence_steps((table[0], "x"), 0)  # type: ignore[arg-type]
        mixed = (
            table[0],
            TimeTableRowV1(time_ns=2 * SECOND_NS, at_risk=1, events=(1,), censored=0),
        )
        with pytest.raises(ContractValueError, match="one cause arity"):
            exact_incidence_steps(mixed, 0)


class TestIncidenceContracts:
    def _point(self, seconds: int, mantissa: int) -> IncidencePointV1:
        return IncidencePointV1(
            time_ns=seconds * SECOND_NS,
            at_risk=2,
            cause_events=1,
            incidence=FixedPointV1(mantissa),
        )

    def test_point_contract(self) -> None:
        with pytest.raises(ContractValueError, match="non-negative"):
            self._point(1, -1)
        with pytest.raises(ContractValueError, match="non-negative"):
            IncidencePointV1(
                time_ns=SECOND_NS,
                at_risk=2,
                cause_events=1,
                incidence=0.5,  # type: ignore[arg-type]
            )

    def test_curve_contract(self) -> None:
        with pytest.raises(ContractValueError, match="strictly increase"):
            CauseIncidenceCurveV1(
                cause_id="A",
                subjects=2,
                follow_up_end_ns=SECOND_NS,
                points=(self._point(1, 0), self._point(1, 0)),
            )
        with pytest.raises(ContractValueError, match="follow-up end"):
            CauseIncidenceCurveV1(
                cause_id="A",
                subjects=2,
                follow_up_end_ns=2 * SECOND_NS,
                points=(self._point(1, 0),),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            CauseIncidenceCurveV1(
                cause_id="A",
                subjects=2,
                follow_up_end_ns=SECOND_NS,
                points=(),
            )
        with pytest.raises(ContractValueError, match="IncidencePointV1"):
            CauseIncidenceCurveV1(
                cause_id="A",
                subjects=2,
                follow_up_end_ns=SECOND_NS,
                points=("x",),  # type: ignore[arg-type]
            )

    def test_estimate_contract(self) -> None:
        estimate = estimate_aalen_johansen(HAND_COHORT)
        with pytest.raises(ContractValueError, match="SurvivalCurveV1"):
            AalenJohansenV1(
                cohort_id="c",
                overall_survival="x",  # type: ignore[arg-type]
                incidence=estimate.incidence,
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            AalenJohansenV1(
                cohort_id="c",
                overall_survival=estimate.overall_survival,
                incidence=(),
            )
        with pytest.raises(ContractValueError, match="CauseIncidenceCurveV1"):
            AalenJohansenV1(
                cohort_id="c",
                overall_survival=estimate.overall_survival,
                incidence=("x",),  # type: ignore[arg-type]
            )
        truncated = CauseIncidenceCurveV1(
            cause_id="A",
            subjects=6,
            follow_up_end_ns=SECOND_NS,
            points=(self._point(1, 0),),
        )
        with pytest.raises(ContractValueError, match="follow-up must match"):
            AalenJohansenV1(
                cohort_id="c",
                overall_survival=estimate.overall_survival,
                incidence=(truncated,),
            )
