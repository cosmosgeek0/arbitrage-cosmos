from __future__ import annotations

from dataclasses import replace
from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.contracts import (
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeGridV1,
    fraction_to_fixed_point,
)
from quant_edge.survival.metrics import (
    ANY_CAUSE,
    REASON_CALIBRATION_ERROR_EXCEEDS_BUDGET,
    REASON_CALIBRATION_UNAVAILABLE,
    REASON_CONCORDANCE_BELOW_BUDGET,
    REASON_CONCORDANCE_UNAVAILABLE,
    REASON_INTEGRATED_BRIER_EXCEEDS_BUDGET,
    REASON_INTEGRATED_BRIER_UNAVAILABLE,
    BinStatus,
    BrierPointV1,
    BrierReportV1,
    CalibrationBinV1,
    CalibrationReportV1,
    ConcordanceReportV1,
    MetricStatus,
    PredictionSetV1,
    RiskScoreSetV1,
    SubjectPredictionV1,
    SurvivalBudgetV1,
    SurvivalVerdictV1,
    Verdict,
    evaluate_brier,
    evaluate_calibration,
    evaluate_concordance,
    judge_survival,
)

SECOND_NS = 1_000_000_000
CAUSES = CauseSetV1(cause_ids=("X", "Y"))
HALF = FixedPointV1(FIXED_POINT_SCALE // 2)
ONE_FP = FixedPointV1(FIXED_POINT_SCALE)
ZERO_FP = FixedPointV1(0)
MODEL_ID = "q11.test.model"
SPLIT_ID = "q11.test.split"


def subject(
    subject_id: str,
    seconds: int,
    cause_id: str | None,
    *,
    group_id: str | None = None,
) -> SubjectV1:
    return SubjectV1(
        subject_id=subject_id,
        group_id=subject_id if group_id is None else group_id,
        stratum_id="ALL",
        duration_ns=seconds * SECOND_NS,
        status=SubjectStatus.RIGHT_CENSORED if cause_id is None else SubjectStatus.EVENT,
        cause_id=cause_id,
        quality=QualityState.SYNTHETIC,
    )


def cohort(subjects: tuple[SubjectV1, ...]) -> SurvivalCohortV1:
    return SurvivalCohortV1(
        cohort_id="q11.test.metrics",
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        causes=CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


def grid(*seconds: int) -> TimeGridV1:
    return TimeGridV1(
        grid_id="q11.test.metric.grid",
        times_ns=tuple(value * SECOND_NS for value in seconds),
    )


def constant_predictions(
    target_cohort: SurvivalCohortV1,
    target_grid: TimeGridV1,
    probability: FixedPointV1,
    *,
    cause_scope: str = ANY_CAUSE,
) -> PredictionSetV1:
    row = tuple(probability for _ in target_grid.times_ns)
    return PredictionSetV1(
        prediction_id="q11.test.constant",
        cohort_id=target_cohort.cohort_id,
        model_id=MODEL_ID,
        target=target_cohort.target,
        split_id=SPLIT_ID,
        grid=target_grid,
        cause_scope=cause_scope,
        predictions=tuple(
            SubjectPredictionV1(subject_id=member.subject_id, event_probabilities=row)
            for member in target_cohort.subjects
        ),
    )


# Hand fixture: event 2s, censor 4s, event 6s, censor 8s.
HAND_COHORT = cohort(
    (
        subject("s1", 2, "X"),
        subject("s2", 4, None),
        subject("s3", 6, "X"),
        subject("s4", 8, None),
    )
)
HAND_GRID = grid(4, 6)


class TestPredictionContracts:
    def test_probabilities_must_be_a_monotone_cdf(self) -> None:
        with pytest.raises(ContractValueError, match="non-decreasing"):
            SubjectPredictionV1(
                subject_id="s1",
                event_probabilities=(HALF, ZERO_FP),
            )
        with pytest.raises(ContractValueError, match="inside"):
            SubjectPredictionV1(
                subject_id="s1",
                event_probabilities=(FixedPointV1(FIXED_POINT_SCALE + 1),),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            SubjectPredictionV1(subject_id="s1", event_probabilities=())

    def test_prediction_set_shape(self) -> None:
        prediction = SubjectPredictionV1(subject_id="s1", event_probabilities=(ZERO_FP, HALF))
        with pytest.raises(ContractValueError, match="every grid time"):
            PredictionSetV1(
                prediction_id="p",
                cohort_id=HAND_COHORT.cohort_id,
                model_id=MODEL_ID,
                target=HAND_COHORT.target,
                split_id=SPLIT_ID,
                grid=grid(4),
                cause_scope=ANY_CAUSE,
                predictions=(prediction,),
            )
        with pytest.raises(ContractValueError, match="duplicate"):
            PredictionSetV1(
                prediction_id="p",
                cohort_id=HAND_COHORT.cohort_id,
                model_id=MODEL_ID,
                target=HAND_COHORT.target,
                split_id=SPLIT_ID,
                grid=grid(4, 6),
                cause_scope=ANY_CAUSE,
                predictions=(prediction, prediction),
            )
        with pytest.raises(ContractValueError, match="grid"):
            PredictionSetV1(
                prediction_id="p",
                cohort_id=HAND_COHORT.cohort_id,
                model_id=MODEL_ID,
                target=HAND_COHORT.target,
                split_id=SPLIT_ID,
                grid="grid",  # type: ignore[arg-type]
                cause_scope=ANY_CAUSE,
                predictions=(prediction,),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            PredictionSetV1(
                prediction_id="p",
                cohort_id=HAND_COHORT.cohort_id,
                model_id=MODEL_ID,
                target=HAND_COHORT.target,
                split_id=SPLIT_ID,
                grid=grid(4, 6),
                cause_scope=ANY_CAUSE,
                predictions=(),
            )
        with pytest.raises(ContractValueError, match="SubjectPredictionV1"):
            PredictionSetV1(
                prediction_id="p",
                cohort_id=HAND_COHORT.cohort_id,
                model_id=MODEL_ID,
                target=HAND_COHORT.target,
                split_id=SPLIT_ID,
                grid=grid(4, 6),
                cause_scope=ANY_CAUSE,
                predictions=("x",),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="cause_scope"):
            PredictionSetV1(
                prediction_id="p",
                cohort_id=HAND_COHORT.cohort_id,
                model_id=MODEL_ID,
                target=HAND_COHORT.target,
                split_id=SPLIT_ID,
                grid=grid(4, 6),
                cause_scope="bad scope",
                predictions=(prediction,),
            )
        mapping = constant_predictions(HAND_COHORT, HAND_GRID, HALF).as_mapping()
        assert mapping["causeScope"] == ANY_CAUSE

    def test_predictions_must_cover_exactly_the_cohort(self) -> None:
        missing = PredictionSetV1(
            prediction_id="p",
            cohort_id=HAND_COHORT.cohort_id,
            model_id=MODEL_ID,
            target=HAND_COHORT.target,
            split_id=SPLIT_ID,
            grid=HAND_GRID,
            cause_scope=ANY_CAUSE,
            predictions=(SubjectPredictionV1(subject_id="s1", event_probabilities=(HALF, HALF)),),
        )
        with pytest.raises(ContractValueError, match="exactly the cohort"):
            evaluate_brier(HAND_COHORT, missing)


class TestBrier:
    def test_hand_verified_ipcw_scores_with_constant_half(self) -> None:
        report = evaluate_brier(HAND_COHORT, constant_predictions(HAND_COHORT, HAND_GRID, HALF))
        # BS(4) = [1*(1/2)^2 + (3/2)*(1/4) + (3/2)*(1/4)] / 4 = 1/4; same at 6.
        for point in report.points:
            assert point.status is MetricStatus.AVAILABLE
            assert point.score == fraction_to_fixed_point(Fraction(1, 4))
        assert report.points[0].contributors == 3
        assert report.points[0].zero_weight_subjects == 1
        assert report.points[1].zero_weight_subjects == 1
        # IBS = (1/4 * 4 + 1/4 * 2) / 6 = 1/4.
        assert report.integrated == fraction_to_fixed_point(Fraction(1, 4))
        assert report.integrated_status is MetricStatus.AVAILABLE

    def test_oracle_is_zero_on_uncensored_cohorts(self) -> None:
        uncensored = cohort((subject("s1", 2, "X"), subject("s2", 4, "Y"), subject("s3", 6, "X")))
        oracle_rows = {
            "s1": (ONE_FP, ONE_FP),
            "s2": (ONE_FP, ONE_FP),
            "s3": (ZERO_FP, ONE_FP),
        }
        prediction_set = PredictionSetV1(
            prediction_id="q11.test.oracle",
            cohort_id=uncensored.cohort_id,
            model_id=MODEL_ID,
            target=uncensored.target,
            split_id=SPLIT_ID,
            grid=grid(4, 6),
            cause_scope=ANY_CAUSE,
            predictions=tuple(
                SubjectPredictionV1(
                    subject_id=member.subject_id,
                    event_probabilities=oracle_rows[member.subject_id],
                )
                for member in uncensored.subjects
            ),
        )
        report = evaluate_brier(uncensored, prediction_set)
        assert report.integrated is not None
        # s1, s2 predicted 1 before their events at 2 and 4? No: at t=4 both have
        # evented, so the indicator matches; s3 survives t=4 with prediction 0.
        assert all(point.score is not None for point in report.points)
        assert report.points[0].score == ZERO_FP
        assert report.points[1].score == ZERO_FP
        assert report.integrated == ZERO_FP

    def test_cause_specific_scope_treats_other_causes_as_known_zero(self) -> None:
        mixed = cohort((subject("s1", 2, "Y"), subject("s2", 6, "X")))
        # Scope X: s1's Y event by t=4 means the X indicator is known zero.
        prediction_set = constant_predictions(mixed, grid(4), HALF, cause_scope="X")
        report = evaluate_brier(mixed, prediction_set)
        point = report.points[0]
        assert point.status is MetricStatus.AVAILABLE
        # Both subjects contribute (1/2)^2 with weight one (no censoring): 1/4.
        assert point.score == fraction_to_fixed_point(Fraction(1, 4))
        assert point.contributors == 2

    def test_same_cohort_ipcw_weights_are_structurally_positive(self) -> None:
        # A subject that still needs a weight at t sat in every earlier
        # censoring risk set without being censored, so its weight denominator
        # can never be zero: the survivor at 10 keeps G(8) at 1/2, not 0.
        tricky = cohort(
            (
                subject("s1", 2, "X"),
                subject("s2", 8, None),
                subject("s3", 10, "X"),
            )
        )
        report = evaluate_brier(tricky, constant_predictions(tricky, grid(8, 10), HALF))
        first, second = report.points
        assert first.status is MetricStatus.AVAILABLE
        # BS(8) = [1*(1/2)^2 + 2*(1/2)^2] / 3 = 1/4 with weight 1/G(8) = 2.
        assert first.score == fraction_to_fixed_point(Fraction(1, 4))
        assert first.contributors == 2
        assert first.zero_weight_subjects == 1
        # At t=10 the event at 10 uses G(10-) = 1/2 > 0.
        assert second.status is MetricStatus.AVAILABLE
        assert report.integrated_status is MetricStatus.AVAILABLE

    def test_rejects_bad_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            evaluate_brier("cohort", constant_predictions(HAND_COHORT, HAND_GRID, HALF))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="PredictionSetV1"):
            evaluate_brier(HAND_COHORT, "predictions")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="not registered"):
            evaluate_brier(
                HAND_COHORT,
                constant_predictions(HAND_COHORT, HAND_GRID, HALF, cause_scope="Z"),
            )

    def test_point_and_report_contracts(self) -> None:
        with pytest.raises(ContractValueError, match="AVAILABLE points carry"):
            BrierPointV1(
                time_ns=SECOND_NS,
                status=MetricStatus.AVAILABLE,
                score=None,
                contributors=0,
                zero_weight_subjects=0,
                reason=None,
            )
        with pytest.raises(ContractValueError, match="UNAVAILABLE points carry"):
            BrierPointV1(
                time_ns=SECOND_NS,
                status=MetricStatus.UNAVAILABLE,
                score=ZERO_FP,
                contributors=0,
                zero_weight_subjects=0,
                reason="EXTERNAL_CENSORING_CURVE_ZERO",
            )
        with pytest.raises(ContractValueError, match="negative"):
            BrierPointV1(
                time_ns=SECOND_NS,
                status=MetricStatus.AVAILABLE,
                score=FixedPointV1(-1),
                contributors=0,
                zero_weight_subjects=0,
                reason=None,
            )
        with pytest.raises(ContractValueError, match="status"):
            BrierPointV1(
                time_ns=SECOND_NS,
                status="AVAILABLE",  # type: ignore[arg-type]
                score=ZERO_FP,
                contributors=0,
                zero_weight_subjects=0,
                reason=None,
            )
        good_point = BrierPointV1(
            time_ns=SECOND_NS,
            status=MetricStatus.AVAILABLE,
            score=ZERO_FP,
            contributors=1,
            zero_weight_subjects=0,
            reason=None,
        )
        with pytest.raises(ContractValueError, match="non-empty"):
            BrierReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                points=(),
                integrated_status=MetricStatus.AVAILABLE,
                integrated=ZERO_FP,
                integrated_reason=None,
            )
        with pytest.raises(ContractValueError, match="BrierPointV1"):
            BrierReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                points=("x",),  # type: ignore[arg-type]
                integrated_status=MetricStatus.AVAILABLE,
                integrated=ZERO_FP,
                integrated_reason=None,
            )
        with pytest.raises(ContractValueError, match="AVAILABLE integral"):
            BrierReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                points=(good_point,),
                integrated_status=MetricStatus.AVAILABLE,
                integrated=None,
                integrated_reason=None,
            )
        with pytest.raises(ContractValueError, match="UNAVAILABLE integral"):
            BrierReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                points=(good_point,),
                integrated_status=MetricStatus.UNAVAILABLE,
                integrated=ZERO_FP,
                integrated_reason=None,
            )
        with pytest.raises(ContractValueError, match="integrated_status"):
            BrierReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                points=(good_point,),
                integrated_status="AVAILABLE",  # type: ignore[arg-type]
                integrated=ZERO_FP,
                integrated_reason=None,
            )
        report = evaluate_brier(HAND_COHORT, constant_predictions(HAND_COHORT, HAND_GRID, HALF))
        assert report.as_mapping()["integratedStatus"] == "AVAILABLE"


class TestConcordance:
    def scores(self, values: dict[str, int]) -> RiskScoreSetV1:
        return RiskScoreSetV1(
            score_id="q11.test.scores",
            cohort_id="q11.test.metrics",
            model_id=MODEL_ID,
            target=SurvivalTarget.TIME_TO_CONVERGENCE,
            split_id=SPLIT_ID,
            scores=tuple((subject_id, FixedPointV1(value)) for subject_id, value in values.items()),
        )

    def test_perfect_and_reversed_scores(self) -> None:
        members = cohort((subject("s1", 2, "X"), subject("s2", 4, "X"), subject("s3", 6, None)))
        perfect = evaluate_concordance(members, self.scores({"s1": 30, "s2": 20, "s3": 10}))
        assert perfect.concordance == ONE_FP
        assert perfect.concordant == 3
        assert perfect.usable_pairs == 3
        reversed_scores = evaluate_concordance(members, self.scores({"s1": 10, "s2": 20, "s3": 30}))
        assert reversed_scores.concordance == ZERO_FP
        assert reversed_scores.discordant == 3

    def test_ties_earn_half_credit(self) -> None:
        members = cohort((subject("s1", 2, "X"), subject("s2", 4, None)))
        tied = evaluate_concordance(members, self.scores({"s1": 5, "s2": 5}))
        assert tied.tied_scores == 1
        assert tied.concordance == HALF

    def test_same_group_pairs_are_excluded_and_counted(self) -> None:
        members = cohort(
            (
                subject("s1", 2, "X", group_id="g"),
                subject("s2", 4, None, group_id="g"),
                subject("s3", 6, None),
            )
        )
        report = evaluate_concordance(members, self.scores({"s1": 3, "s2": 2, "s3": 1}))
        assert report.excluded_same_group == 1
        assert report.usable_pairs == 1
        assert report.concordance == ONE_FP

    def test_horizon_truncates_index_events(self) -> None:
        members = cohort((subject("s1", 2, "X"), subject("s2", 6, "X"), subject("s3", 9, None)))
        truncated = evaluate_concordance(
            members,
            self.scores({"s1": 3, "s2": 2, "s3": 1}),
            horizon_ns=4 * SECOND_NS,
        )
        # Only s1 remains an index event; pairs (s1,s2), (s1,s3).
        assert truncated.usable_pairs == 2
        assert truncated.horizon_ns == 4 * SECOND_NS

    def test_cause_scope_restricts_index_events(self) -> None:
        members = cohort((subject("s1", 2, "Y"), subject("s2", 4, "X"), subject("s3", 6, None)))
        scoped = evaluate_concordance(
            members, self.scores({"s1": 3, "s2": 2, "s3": 1}), cause_scope="X"
        )
        # Only s2 is an index event; its one comparator is s3.
        assert scoped.usable_pairs == 1
        assert scoped.concordance == ONE_FP

    def test_no_usable_pairs_is_unavailable(self) -> None:
        members = cohort((subject("s1", 2, None), subject("s2", 4, None)))
        report = evaluate_concordance(members, self.scores({"s1": 1, "s2": 2}))
        assert report.status is MetricStatus.UNAVAILABLE
        assert report.concordance is None
        # Tied observed times are not usable either.
        tied_times = cohort((subject("s1", 2, "X"), subject("s2", 2, "X")))
        tied_report = evaluate_concordance(tied_times, self.scores({"s1": 1, "s2": 2}))
        assert tied_report.status is MetricStatus.UNAVAILABLE

    def test_rejects_bad_inputs(self) -> None:
        members = cohort((subject("s1", 2, "X"), subject("s2", 4, None)))
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            evaluate_concordance("cohort", self.scores({"s1": 1}))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="RiskScoreSetV1"):
            evaluate_concordance(members, "scores")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="exactly the cohort"):
            evaluate_concordance(members, self.scores({"s1": 1}))
        with pytest.raises(ContractValueError, match="horizon_ns"):
            evaluate_concordance(members, self.scores({"s1": 1, "s2": 2}), horizon_ns=0)
        with pytest.raises(ContractValueError, match="not registered"):
            evaluate_concordance(members, self.scores({"s1": 1, "s2": 2}), cause_scope="Z")
        with pytest.raises(ContractValueError, match="cause_scope"):
            evaluate_concordance(
                members,
                self.scores({"s1": 1, "s2": 2}),
                cause_scope=7,  # type: ignore[arg-type]
            )

    def test_score_set_contract(self) -> None:
        with pytest.raises(ContractValueError, match="non-empty"):
            RiskScoreSetV1(
                score_id="s",
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                scores=(),
            )
        with pytest.raises(ContractValueError, match="duplicate"):
            RiskScoreSetV1(
                score_id="s",
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                scores=(("s1", ZERO_FP), ("s1", HALF)),
            )
        with pytest.raises(ContractValueError, match="subject_id, score"):
            RiskScoreSetV1(
                score_id="s",
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                scores=(("s1",),),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="FixedPointV1"):
            RiskScoreSetV1(
                score_id="s",
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                scores=(("s1", 1),),  # type: ignore[arg-type]
            )
        scores = RiskScoreSetV1(
            score_id="s",
            cohort_id="c",
            model_id=MODEL_ID,
            target=SurvivalTarget.TIME_TO_CONVERGENCE,
            split_id=SPLIT_ID,
            scores=(("s1", HALF),),
        )
        assert scores.as_mapping()["scores"] == {
            "s1": {"mantissa": str(FIXED_POINT_SCALE // 2), "scale": str(FIXED_POINT_SCALE)}
        }

    def test_report_contract(self) -> None:
        with pytest.raises(ContractValueError, match="AVAILABLE concordance"):
            ConcordanceReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                score_id="s",
                cause_scope=ANY_CAUSE,
                horizon_ns=None,
                concordant=1,
                discordant=0,
                tied_scores=0,
                excluded_same_group=0,
                status=MetricStatus.AVAILABLE,
                concordance=None,
            )
        with pytest.raises(ContractValueError, match="UNAVAILABLE concordance"):
            ConcordanceReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                score_id="s",
                cause_scope=ANY_CAUSE,
                horizon_ns=None,
                concordant=0,
                discordant=0,
                tied_scores=0,
                excluded_same_group=0,
                status=MetricStatus.UNAVAILABLE,
                concordance=ONE_FP,
            )
        with pytest.raises(ContractValueError, match="status"):
            ConcordanceReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                score_id="s",
                cause_scope=ANY_CAUSE,
                horizon_ns=None,
                concordant=0,
                discordant=0,
                tied_scores=0,
                excluded_same_group=0,
                status="AVAILABLE",  # type: ignore[arg-type]
                concordance=ONE_FP,
            )
        members = cohort((subject("s1", 2, "X"), subject("s2", 4, None)))
        mapping = evaluate_concordance(members, self.scores({"s1": 2, "s2": 1})).as_mapping()
        assert mapping["concordant"] == 1
        assert mapping["horizonNs"] is None


class TestCalibration:
    def test_marginal_prediction_has_zero_gap(self) -> None:
        # Predicting the cohort's own observed frequency puts everyone in one
        # bin whose observed value equals the prediction exactly.
        members = cohort(
            (
                subject("s1", 2, "X"),
                subject("s2", 4, None),
                subject("s3", 6, "X"),
                subject("s4", 8, None),
            )
        )
        # Observed any-cause event fraction at 6: 1 - S(6); S = 3/4 * (1/2) = 3/8?
        # KM: t=2 n=4 d=1 -> 3/4; t=4 censor; t=6 n=2 d=1 -> 3/8. F = 5/8.
        prediction = constant_predictions(members, grid(6), fraction_to_fixed_point(Fraction(5, 8)))
        report = evaluate_calibration(members, prediction, horizon_ns=6 * SECOND_NS, bin_count=4)
        assert report.status is MetricStatus.AVAILABLE
        assert report.expected_calibration_error == ZERO_FP
        available = [b for b in report.bins if b.status is BinStatus.AVAILABLE]
        assert len(available) == 1
        assert available[0].count == 4
        assert available[0].observed == fraction_to_fixed_point(Fraction(5, 8))
        assert available[0].signed_gap == ZERO_FP
        empty = [b for b in report.bins if b.status is BinStatus.EMPTY]
        assert len(empty) == 3

    def test_censoring_aware_observed_frequency(self) -> None:
        # A censored subject does not count as a negative: with s2 censored at 4
        # the observed frequency at 6 is the KM complement 5/8, not 1/2.
        members = cohort(
            (
                subject("s1", 2, "X"),
                subject("s2", 4, None),
                subject("s3", 6, "X"),
                subject("s4", 8, None),
            )
        )
        prediction = constant_predictions(members, grid(6), HALF)
        report = evaluate_calibration(members, prediction, horizon_ns=6 * SECOND_NS, bin_count=2)
        the_bin = report.bins[1]
        assert the_bin.status is BinStatus.AVAILABLE
        assert the_bin.observed == fraction_to_fixed_point(Fraction(5, 8))
        assert the_bin.mean_predicted == HALF
        assert the_bin.signed_gap == fraction_to_fixed_point(Fraction(1, 8))
        assert report.expected_calibration_error == fraction_to_fixed_point(Fraction(1, 8))

    def test_unknowable_bins_fail_closed(self) -> None:
        # Both members of the low bin end (censored) before the horizon, so the
        # observed frequency is unknowable and never guessed.
        members = cohort(
            (
                subject("s1", 2, None),
                subject("s2", 3, None),
                subject("s3", 8, "X"),
                subject("s4", 9, None),
            )
        )
        rows = {
            "s1": (ZERO_FP,),
            "s2": (ZERO_FP,),
            "s3": (ONE_FP,),
            "s4": (ONE_FP,),
        }
        prediction = PredictionSetV1(
            prediction_id="q11.test.split",
            cohort_id=members.cohort_id,
            model_id=MODEL_ID,
            target=members.target,
            split_id=SPLIT_ID,
            grid=grid(8),
            cause_scope=ANY_CAUSE,
            predictions=tuple(
                SubjectPredictionV1(
                    subject_id=member.subject_id,
                    event_probabilities=rows[member.subject_id],
                )
                for member in members.subjects
            ),
        )
        report = evaluate_calibration(members, prediction, horizon_ns=8 * SECOND_NS, bin_count=2)
        assert report.bins[0].status is BinStatus.UNAVAILABLE
        assert report.bins[0].count == 2
        assert report.unavailable_subjects == 2
        assert report.bins[1].status is BinStatus.AVAILABLE
        assert report.evaluated == 2
        assert report.status is MetricStatus.UNAVAILABLE
        assert report.expected_calibration_error is None

    def test_all_bins_unknowable_is_unavailable(self) -> None:
        members = cohort((subject("s1", 2, None),))
        prediction = constant_predictions(members, grid(4), HALF)
        report = evaluate_calibration(members, prediction, horizon_ns=4 * SECOND_NS, bin_count=2)
        assert report.status is MetricStatus.UNAVAILABLE
        assert report.expected_calibration_error is None

    def test_cause_specific_observed_uses_cause_incidence(self) -> None:
        members = cohort((subject("s1", 2, "Y"), subject("s2", 4, "X")))
        prediction = constant_predictions(members, grid(4), HALF, cause_scope="X")
        report = evaluate_calibration(members, prediction, horizon_ns=4 * SECOND_NS, bin_count=2)
        the_bin = report.bins[1]
        # CIF_X(4) = 1/2 exactly: the Y event at 2 is not an X event.
        assert the_bin.observed == HALF
        assert report.expected_calibration_error == ZERO_FP

    def test_rejects_bad_inputs(self) -> None:
        members = cohort((subject("s1", 2, "X"),))
        prediction = constant_predictions(members, grid(4), HALF)
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            evaluate_calibration("cohort", prediction, horizon_ns=4 * SECOND_NS, bin_count=2)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="PredictionSetV1"):
            evaluate_calibration(members, "prediction", horizon_ns=4 * SECOND_NS, bin_count=2)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="bin_count"):
            evaluate_calibration(members, prediction, horizon_ns=4 * SECOND_NS, bin_count=1)
        with pytest.raises(ContractValueError, match="not a grid time"):
            evaluate_calibration(members, prediction, horizon_ns=3 * SECOND_NS, bin_count=2)

    def test_bin_and_report_contracts(self) -> None:
        from quant_edge.labels.rational import make_ratio

        lower = make_ratio(0, 2)
        upper = make_ratio(1, 2)
        with pytest.raises(ContractValueError, match="AVAILABLE bins carry"):
            CalibrationBinV1(
                bin_index=0,
                lower=lower,
                upper=upper,
                status=BinStatus.AVAILABLE,
                count=1,
                mean_predicted=None,
                observed=None,
                signed_gap=None,
            )
        with pytest.raises(ContractValueError, match="EMPTY bins carry"):
            CalibrationBinV1(
                bin_index=0,
                lower=lower,
                upper=upper,
                status=BinStatus.EMPTY,
                count=1,
                mean_predicted=None,
                observed=None,
                signed_gap=None,
            )
        with pytest.raises(ContractValueError, match="UNAVAILABLE bins carry"):
            CalibrationBinV1(
                bin_index=0,
                lower=lower,
                upper=upper,
                status=BinStatus.UNAVAILABLE,
                count=0,
                mean_predicted=None,
                observed=None,
                signed_gap=None,
            )
        with pytest.raises(ContractValueError, match="bounds"):
            CalibrationBinV1(
                bin_index=0,
                lower=0,  # type: ignore[arg-type]
                upper=upper,
                status=BinStatus.EMPTY,
                count=0,
                mean_predicted=None,
                observed=None,
                signed_gap=None,
            )
        with pytest.raises(ContractValueError, match="status"):
            CalibrationBinV1(
                bin_index=0,
                lower=lower,
                upper=upper,
                status="EMPTY",  # type: ignore[arg-type]
                count=0,
                mean_predicted=None,
                observed=None,
                signed_gap=None,
            )
        empty_bin = CalibrationBinV1(
            bin_index=0,
            lower=lower,
            upper=upper,
            status=BinStatus.EMPTY,
            count=0,
            mean_predicted=None,
            observed=None,
            signed_gap=None,
        )
        assert empty_bin.as_mapping()["status"] == "EMPTY"
        with pytest.raises(ContractValueError, match="calibration bins"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=(empty_bin,),
                evaluated=0,
                unavailable_subjects=0,
                status=MetricStatus.UNAVAILABLE,
                expected_calibration_error=None,
            )
        with pytest.raises(ContractValueError, match="dense and ordered"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=(empty_bin, empty_bin),
                evaluated=0,
                unavailable_subjects=0,
                status=MetricStatus.UNAVAILABLE,
                expected_calibration_error=None,
            )
        with pytest.raises(ContractValueError, match="CalibrationBinV1"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=("x", "y"),  # type: ignore[arg-type]
                evaluated=0,
                unavailable_subjects=0,
                status=MetricStatus.UNAVAILABLE,
                expected_calibration_error=None,
            )
        second_bin = CalibrationBinV1(
            bin_index=1,
            lower=upper,
            upper=make_ratio(1, 1),
            status=BinStatus.EMPTY,
            count=0,
            mean_predicted=None,
            observed=None,
            signed_gap=None,
        )
        unavailable_bin = CalibrationBinV1(
            bin_index=0,
            lower=lower,
            upper=upper,
            status=BinStatus.UNAVAILABLE,
            count=1,
            mean_predicted=None,
            observed=None,
            signed_gap=None,
        )
        available_bin = CalibrationBinV1(
            bin_index=1,
            lower=upper,
            upper=make_ratio(1, 1),
            status=BinStatus.AVAILABLE,
            count=1,
            mean_predicted=ZERO_FP,
            observed=ZERO_FP,
            signed_gap=ZERO_FP,
        )
        with pytest.raises(ContractValueError, match="minimum evaluated support"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=(unavailable_bin, available_bin),
                evaluated=1,
                unavailable_subjects=1,
                status=MetricStatus.AVAILABLE,
                expected_calibration_error=ZERO_FP,
            )
        with pytest.raises(ContractValueError, match="AVAILABLE report carries"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=(empty_bin, second_bin),
                evaluated=0,
                unavailable_subjects=0,
                status=MetricStatus.AVAILABLE,
                expected_calibration_error=ZERO_FP,
            )
        with pytest.raises(ContractValueError, match="UNAVAILABLE report carries"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=(empty_bin, second_bin),
                evaluated=0,
                unavailable_subjects=0,
                status=MetricStatus.UNAVAILABLE,
                expected_calibration_error=ZERO_FP,
            )
        with pytest.raises(ContractValueError, match="status"):
            CalibrationReportV1(
                cohort_id="c",
                model_id=MODEL_ID,
                target=SurvivalTarget.TIME_TO_CONVERGENCE,
                split_id=SPLIT_ID,
                prediction_id="p",
                cause_scope=ANY_CAUSE,
                horizon_ns=SECOND_NS,
                bins=(empty_bin, second_bin),
                evaluated=0,
                unavailable_subjects=0,
                status="UNAVAILABLE",  # type: ignore[arg-type]
                expected_calibration_error=None,
            )


class TestBudget:
    BUDGET = SurvivalBudgetV1(
        budget_id="q11.test.budget",
        max_integrated_brier=fraction_to_fixed_point(Fraction(1, 4)),
        min_concordance=fraction_to_fixed_point(Fraction(3, 5)),
        max_calibration_error=fraction_to_fixed_point(Fraction(1, 10)),
    )

    def _reports(
        self,
    ) -> tuple[BrierReportV1, ConcordanceReportV1, CalibrationReportV1]:
        members = cohort(
            (
                subject("s1", 2, "X"),
                subject("s2", 4, None),
                subject("s3", 6, "X"),
                subject("s4", 8, None),
            )
        )
        prediction = constant_predictions(members, grid(6), fraction_to_fixed_point(Fraction(5, 8)))
        brier = evaluate_brier(members, prediction)
        scores = RiskScoreSetV1(
            score_id="q11.test.budget.scores",
            cohort_id=members.cohort_id,
            model_id=MODEL_ID,
            target=members.target,
            split_id=SPLIT_ID,
            scores=tuple(
                (member.subject_id, FixedPointV1(-member.duration_ns))
                for member in members.subjects
            ),
        )
        concordance = evaluate_concordance(members, scores, horizon_ns=6 * SECOND_NS)
        calibration = evaluate_calibration(
            members, prediction, horizon_ns=6 * SECOND_NS, bin_count=4
        )
        return brier, concordance, calibration

    def test_pass_verdict(self) -> None:
        brier, concordance, calibration = self._reports()
        verdict = judge_survival(
            self.BUDGET, brier=brier, concordance=concordance, calibration=calibration
        )
        assert verdict.verdict is Verdict.PASS
        assert verdict.reasons == ()
        mismatched_calibrations = (
            replace(calibration, cohort_id="q11.test.foreign"),
            replace(calibration, model_id="q11.test.foreign-model"),
            replace(calibration, target=SurvivalTarget.ACTIONABILITY_WINDOW),
            replace(calibration, split_id="q11.test.foreign-split"),
            replace(calibration, cause_scope="X"),
            replace(calibration, horizon_ns=7 * SECOND_NS),
        )
        for mismatched in mismatched_calibrations:
            with pytest.raises(ContractValueError, match="exact evaluation identity"):
                judge_survival(
                    self.BUDGET,
                    brier=brier,
                    concordance=concordance,
                    calibration=mismatched,
                )

    def test_every_fail_reason_is_reachable(self) -> None:
        brier, concordance, calibration = self._reports()
        tight = SurvivalBudgetV1(
            budget_id="q11.test.tight",
            max_integrated_brier=ZERO_FP,
            min_concordance=ONE_FP,
            max_calibration_error=ZERO_FP,
        )
        # The pass fixture has IBS > 0, C = 1 and ECE = 0: tighten two axes and
        # make the third fail through a strictly greater concordance floor.
        strict = judge_survival(
            tight, brier=brier, concordance=concordance, calibration=calibration
        )
        assert strict.verdict is Verdict.FAIL
        assert REASON_INTEGRATED_BRIER_EXCEEDS_BUDGET in strict.reasons
        assert REASON_CONCORDANCE_BELOW_BUDGET not in strict.reasons
        assert REASON_CALIBRATION_ERROR_EXCEEDS_BUDGET not in strict.reasons

        members = cohort((subject("s1", 2, None),))
        prediction = constant_predictions(members, grid(4), HALF)
        # An externally estimated censoring curve may be unavailable; the shape
        # is hand-built because same-cohort IPCW can never produce it.
        unavailable_brier = BrierReportV1(
            cohort_id=members.cohort_id,
            model_id=MODEL_ID,
            target=members.target,
            split_id=SPLIT_ID,
            prediction_id=prediction.prediction_id,
            cause_scope=ANY_CAUSE,
            horizon_ns=4 * SECOND_NS,
            points=(
                BrierPointV1(
                    time_ns=SECOND_NS,
                    status=MetricStatus.UNAVAILABLE,
                    score=None,
                    contributors=0,
                    zero_weight_subjects=0,
                    reason="EXTERNAL_CENSORING_CURVE_ZERO",
                ),
            ),
            integrated_status=MetricStatus.UNAVAILABLE,
            integrated=None,
            integrated_reason="EXTERNAL_CENSORING_CURVE_ZERO",
        )
        unavailable_concordance = evaluate_concordance(
            members,
            RiskScoreSetV1(
                score_id="s",
                cohort_id=members.cohort_id,
                model_id=MODEL_ID,
                target=members.target,
                split_id=SPLIT_ID,
                scores=(("s1", ZERO_FP),),
            ),
            horizon_ns=4 * SECOND_NS,
        )
        unavailable_calibration = evaluate_calibration(
            members, prediction, horizon_ns=4 * SECOND_NS, bin_count=2
        )
        unavailable = judge_survival(
            self.BUDGET,
            brier=unavailable_brier,
            concordance=unavailable_concordance,
            calibration=unavailable_calibration,
        )
        assert unavailable.verdict is Verdict.FAIL
        assert unavailable.reasons == (
            REASON_CALIBRATION_UNAVAILABLE,
            REASON_CONCORDANCE_UNAVAILABLE,
            REASON_INTEGRATED_BRIER_UNAVAILABLE,
        )

    def test_below_budget_reasons(self) -> None:
        # Observed frequency at 6 is 1/3 (KM: 2/3 survive) against a constant
        # prediction of one, so the calibration gap is 2/3.
        members = cohort((subject("s1", 2, "X"), subject("s2", 4, None), subject("s3", 6, None)))
        prediction = constant_predictions(members, grid(6), ONE_FP)
        brier = evaluate_brier(members, prediction)
        anti_scores = RiskScoreSetV1(
            score_id="q11.test.anti",
            cohort_id=members.cohort_id,
            model_id=MODEL_ID,
            target=members.target,
            split_id=SPLIT_ID,
            scores=tuple(
                (member.subject_id, FixedPointV1(member.duration_ns)) for member in members.subjects
            ),
        )
        concordance = evaluate_concordance(members, anti_scores, horizon_ns=6 * SECOND_NS)
        calibration = evaluate_calibration(
            members, prediction, horizon_ns=6 * SECOND_NS, bin_count=2
        )
        verdict = judge_survival(
            self.BUDGET, brier=brier, concordance=concordance, calibration=calibration
        )
        assert verdict.verdict is Verdict.FAIL
        assert REASON_CONCORDANCE_BELOW_BUDGET in verdict.reasons
        assert REASON_CALIBRATION_ERROR_EXCEEDS_BUDGET in verdict.reasons

    def test_budget_and_verdict_contracts(self) -> None:
        with pytest.raises(ContractValueError, match="max_integrated_brier"):
            SurvivalBudgetV1(
                budget_id="b",
                max_integrated_brier=FixedPointV1(-1),
                min_concordance=HALF,
                max_calibration_error=HALF,
            )
        with pytest.raises(ContractValueError, match="max_integrated_brier"):
            SurvivalBudgetV1(
                budget_id="b",
                max_integrated_brier=1,  # type: ignore[arg-type]
                min_concordance=HALF,
                max_calibration_error=HALF,
            )
        with pytest.raises(ContractValueError, match="inside"):
            SurvivalBudgetV1(
                budget_id="b",
                max_integrated_brier=ZERO_FP,
                min_concordance=FixedPointV1(2 * FIXED_POINT_SCALE),
                max_calibration_error=HALF,
            )
        with pytest.raises(ContractValueError, match="PASS carries no reasons"):
            SurvivalVerdictV1(budget_id="b", verdict=Verdict.PASS, reasons=("SOMETHING",))
        with pytest.raises(ContractValueError, match="PASS carries no reasons"):
            SurvivalVerdictV1(budget_id="b", verdict=Verdict.FAIL, reasons=())
        with pytest.raises(ContractValueError, match="sorted"):
            SurvivalVerdictV1(budget_id="b", verdict=Verdict.FAIL, reasons=("B", "A"))
        with pytest.raises(ContractValueError, match="Verdict"):
            SurvivalVerdictV1(budget_id="b", verdict="PASS", reasons=())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="reasons must be a tuple"):
            SurvivalVerdictV1(budget_id="b", verdict=Verdict.FAIL, reasons=["A"])  # type: ignore[arg-type]
        brier, concordance, calibration = self._reports()
        with pytest.raises(ContractValueError, match="SurvivalBudgetV1"):
            judge_survival(
                "budget",  # type: ignore[arg-type]
                brier=brier,
                concordance=concordance,
                calibration=calibration,
            )
        with pytest.raises(ContractValueError, match="BrierReportV1"):
            judge_survival(
                self.BUDGET,
                brier="brier",  # type: ignore[arg-type]
                concordance=concordance,
                calibration=calibration,
            )
        with pytest.raises(ContractValueError, match="ConcordanceReportV1"):
            judge_survival(
                self.BUDGET,
                brier=brier,
                concordance="concordance",  # type: ignore[arg-type]
                calibration=calibration,
            )
        with pytest.raises(ContractValueError, match="CalibrationReportV1"):
            judge_survival(
                self.BUDGET,
                brier=brier,
                concordance=concordance,
                calibration="calibration",  # type: ignore[arg-type]
            )
        assert self.BUDGET.as_mapping()["budgetId"] == "q11.test.budget"
        verdict = judge_survival(
            self.BUDGET, brier=brier, concordance=concordance, calibration=calibration
        )
        assert verdict.as_mapping()["verdict"] == "PASS"
