from __future__ import annotations

from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FP_ONE, FixedPointV1
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.contracts import (
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    event_time_table,
    fraction_to_fixed_point,
)
from quant_edge.survival.km import (
    CurveRole,
    SurvivalCurvePointV1,
    SurvivalCurveV1,
    estimate_censoring_survival,
    estimate_kaplan_meier,
    exact_survival_steps,
)

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


def cohort(subjects: tuple[SubjectV1, ...]) -> SurvivalCohortV1:
    return SurvivalCohortV1(
        cohort_id="q11.test.km",
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        causes=CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


# The classic Freireich 6-MP arm: (weeks-as-seconds, event?).
FREIREICH = (
    (6, True),
    (6, True),
    (6, True),
    (6, False),
    (7, True),
    (9, False),
    (10, True),
    (10, False),
    (11, False),
    (13, True),
    (16, True),
    (17, False),
    (19, False),
    (20, False),
    (22, True),
    (23, True),
    (25, False),
    (32, False),
    (32, False),
    (34, False),
    (35, False),
)


def freireich_cohort() -> SurvivalCohortV1:
    return cohort(
        tuple(
            subject(f"fr-{index:02d}", seconds, "A" if event else None)
            for index, (seconds, event) in enumerate(FREIREICH)
        )
    )


def reference_product_limit(
    observations: tuple[tuple[int, bool], ...],
) -> dict[int, Fraction]:
    """Independent Fraction reference: time -> S(time) with events before censorings."""

    survivors = sorted(observations)
    survival = Fraction(1)
    result: dict[int, Fraction] = {}
    for time in sorted({time for time, _ in observations}):
        at_risk = sum(1 for observed, _ in survivors if observed >= time)
        deaths = sum(1 for observed, event in survivors if observed == time and event)
        if deaths:
            survival *= Fraction(at_risk - deaths, at_risk)
        result[time] = survival
    return result


class TestKaplanMeier:
    def test_matches_independent_reference_exactly(self) -> None:
        curve = estimate_kaplan_meier(freireich_cohort())
        reference = reference_product_limit(FREIREICH)
        assert len(curve.points) == len(reference)
        for point in curve.points:
            expected = reference[point.time_ns // SECOND_NS]
            assert point.survival == fraction_to_fixed_point(expected)

    def test_hand_verified_mantissas(self) -> None:
        curve = estimate_kaplan_meier(freireich_cohort())
        by_seconds = {point.time_ns // SECOND_NS: point for point in curve.points}
        # S(6) = 6/7, S(7) = 96/119, S(10) = 64/85, S(23) = 160/357.
        assert by_seconds[6].survival.mantissa == 857_142_857_143
        assert by_seconds[7].survival.mantissa == 806_722_689_076
        assert by_seconds[10].survival.mantissa == 752_941_176_471
        assert by_seconds[23].survival.mantissa == 448_179_271_709
        # Nelson-Aalen at 6: H = 3/21 = 1/7.
        assert by_seconds[6].cumulative_hazard == fraction_to_fixed_point(Fraction(1, 7))
        assert by_seconds[6].at_risk == 21
        assert by_seconds[6].events == 3
        assert by_seconds[6].censored == 1

    def test_step_evaluation_law(self) -> None:
        curve = estimate_kaplan_meier(freireich_cohort())
        assert curve.survival_at(0) == FP_ONE
        assert curve.survival_at(5 * SECOND_NS) == FP_ONE
        assert curve.survival_at(6 * SECOND_NS) == FixedPointV1(857_142_857_143)
        assert curve.survival_at(8 * SECOND_NS) == FixedPointV1(806_722_689_076)
        assert curve.survival_at(35 * SECOND_NS) is not None
        assert curve.survival_at(36 * SECOND_NS) is None

    def test_all_event_cohort_reaches_zero(self) -> None:
        curve = estimate_kaplan_meier(cohort((subject("s1", 1, "A"), subject("s2", 2, "B"))))
        assert curve.points[-1].survival.mantissa == 0

    def test_all_censored_cohort_stays_at_one(self) -> None:
        curve = estimate_kaplan_meier(cohort((subject("s1", 1, None), subject("s2", 2, None))))
        assert all(point.survival == FP_ONE for point in curve.points)
        assert all(point.cumulative_hazard.mantissa == 0 for point in curve.points)


class TestCensoringSurvival:
    def test_reverse_km_excludes_same_time_events_from_risk_set(self) -> None:
        # Events leave before censorings: at t=6 the censoring risk set is 18.
        curve = estimate_censoring_survival(freireich_cohort())
        by_seconds = {point.time_ns // SECOND_NS: point for point in curve.points}
        assert by_seconds[6].survival == fraction_to_fixed_point(Fraction(17, 18))
        # t=9: n=16, no events -> factor 15/16.
        expected_9 = Fraction(17, 18) * Fraction(15, 16)
        assert by_seconds[9].survival == fraction_to_fixed_point(expected_9)
        # t=10: one event and one censoring; risk set 15 - 1 = 14.
        expected_10 = expected_9 * Fraction(13, 14)
        assert by_seconds[10].survival == fraction_to_fixed_point(expected_10)
        assert curve.role is CurveRole.CENSORING_SURVIVAL

    def test_reverse_km_hits_zero_when_last_subject_is_censored(self) -> None:
        curve = estimate_censoring_survival(cohort((subject("s1", 1, "A"), subject("s2", 2, None))))
        assert curve.points[-1].survival.mantissa == 0


class TestExactSteps:
    def test_emits_a_step_at_every_distinct_time(self) -> None:
        table = event_time_table(
            (subject("s1", 1, "A"), subject("s2", 2, None), subject("s3", 3, "B")),
            CAUSES,
        )
        steps = exact_survival_steps(table, role=CurveRole.EVENT_SURVIVAL)
        assert [time for time, _, _ in steps] == [
            SECOND_NS,
            2 * SECOND_NS,
            3 * SECOND_NS,
        ]
        assert [survival for _, survival, _ in steps] == [
            Fraction(2, 3),
            Fraction(2, 3),
            Fraction(0),
        ]
        assert steps[-1][2] == Fraction(1, 3) + Fraction(1, 1)

    def test_rejects_bad_inputs(self) -> None:
        table = event_time_table((subject("s1", 1, "A"),), CAUSES)
        with pytest.raises(ContractValueError, match="tuple"):
            exact_survival_steps(list(table), role=CurveRole.EVENT_SURVIVAL)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="CurveRole"):
            exact_survival_steps(table, role="EVENT_SURVIVAL")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="TimeTableRowV1"):
            exact_survival_steps(("x",), role=CurveRole.EVENT_SURVIVAL)  # type: ignore[arg-type]


class TestCurveContracts:
    def _point(self, seconds: int, survival_mantissa: int) -> SurvivalCurvePointV1:
        return SurvivalCurvePointV1(
            time_ns=seconds * SECOND_NS,
            at_risk=2,
            events=1,
            censored=0,
            survival=FixedPointV1(survival_mantissa),
            cumulative_hazard=FixedPointV1(0),
        )

    def test_rejects_disordered_or_mismatched_points(self) -> None:
        with pytest.raises(ContractValueError, match="strictly increase"):
            SurvivalCurveV1(
                curve_id="c",
                role=CurveRole.EVENT_SURVIVAL,
                subjects=2,
                follow_up_end_ns=2 * SECOND_NS,
                points=(self._point(2, 500), self._point(2, 400)),
            )
        with pytest.raises(ContractValueError, match="follow-up end"):
            SurvivalCurveV1(
                curve_id="c",
                role=CurveRole.EVENT_SURVIVAL,
                subjects=2,
                follow_up_end_ns=3 * SECOND_NS,
                points=(self._point(2, 500),),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            SurvivalCurveV1(
                curve_id="c",
                role=CurveRole.EVENT_SURVIVAL,
                subjects=2,
                follow_up_end_ns=SECOND_NS,
                points=(),
            )
        with pytest.raises(ContractValueError, match="SurvivalCurvePointV1"):
            SurvivalCurveV1(
                curve_id="c",
                role=CurveRole.EVENT_SURVIVAL,
                subjects=2,
                follow_up_end_ns=SECOND_NS,
                points=("x",),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="CurveRole"):
            SurvivalCurveV1(
                curve_id="c",
                role="EVENT_SURVIVAL",  # type: ignore[arg-type]
                subjects=2,
                follow_up_end_ns=2 * SECOND_NS,
                points=(self._point(2, 500),),
            )

    def test_point_contract(self) -> None:
        with pytest.raises(ContractValueError, match="survival must be"):
            SurvivalCurvePointV1(
                time_ns=SECOND_NS,
                at_risk=1,
                events=1,
                censored=0,
                survival=0.5,  # type: ignore[arg-type]
                cumulative_hazard=FixedPointV1(0),
            )
        with pytest.raises(ContractValueError, match="cumulative_hazard"):
            SurvivalCurvePointV1(
                time_ns=SECOND_NS,
                at_risk=1,
                events=1,
                censored=0,
                survival=FixedPointV1(0),
                cumulative_hazard=1,  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="negative"):
            SurvivalCurvePointV1(
                time_ns=SECOND_NS,
                at_risk=1,
                events=1,
                censored=0,
                survival=FixedPointV1(-1),
                cumulative_hazard=FixedPointV1(0),
            )

    def test_estimators_reject_non_cohorts(self) -> None:
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            estimate_kaplan_meier("cohort")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            estimate_censoring_survival("cohort")  # type: ignore[arg-type]

    def test_overlong_cohort_id_fails_closed_at_curve_derivation(self) -> None:
        long_id = "c" * 128
        built = SurvivalCohortV1(
            cohort_id=long_id,
            target=SurvivalTarget.TIME_TO_CONVERGENCE,
            causes=CauseSetV1(cause_ids=("A",)),
            posture=EvidencePosture.SYNTHETIC,
            subjects=(subject("s1", 1, "A"),),
        )
        with pytest.raises(ContractValueError, match="curve_id"):
            estimate_kaplan_meier(built)

    def test_as_mapping_shape(self) -> None:
        curve = estimate_kaplan_meier(cohort((subject("s1", 1, "A"),)))
        mapping = curve.as_mapping()
        assert mapping["role"] == "EVENT_SURVIVAL"
        assert mapping["subjects"] == 1
        assert mapping["followUpEndNs"] == str(SECOND_NS)
        assert isinstance(mapping["points"], list)

    def test_survival_at_rejects_bad_time(self) -> None:
        curve = estimate_kaplan_meier(cohort((subject("s1", 1, "A"),)))
        with pytest.raises(ContractValueError, match="time_ns"):
            curve.survival_at(-1)
