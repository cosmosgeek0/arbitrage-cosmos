from __future__ import annotations

from fractions import Fraction

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.competing import (
    estimate_aalen_johansen,
    exact_incidence_steps,
)
from quant_edge.survival.contracts import (
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeGridV1,
    build_cohort,
    event_time_table,
    fraction_to_fixed_point,
)
from quant_edge.survival.hazard_model import HazardModelConfigV1, fit_discrete_hazard
from quant_edge.survival.km import (
    CurveRole,
    estimate_censoring_survival,
    estimate_kaplan_meier,
    exact_survival_steps,
)
from quant_edge.survival.metrics import (
    ANY_CAUSE,
    MetricStatus,
    PredictionSetV1,
    RiskScoreSetV1,
    SubjectPredictionV1,
    evaluate_brier,
    evaluate_calibration,
    evaluate_concordance,
)

SECOND_NS = 1_000_000_000
CAUSES = CauseSetV1(cause_ids=("A", "B"))
MODEL_ID = "q11.prop.model"
SPLIT_ID = "q11.prop.split"

# One observation: (duration seconds 1..40, outcome 0=censored, 1=A, 2=B).
OBSERVATIONS = st.lists(
    st.tuples(
        st.integers(min_value=1, max_value=40),
        st.integers(min_value=0, max_value=2),
    ),
    min_size=1,
    max_size=60,
)


def build(observations: list[tuple[int, int]]) -> SurvivalCohortV1:
    subjects = tuple(
        SubjectV1(
            subject_id=f"s{index:03d}",
            group_id=f"s{index:03d}",
            stratum_id="ALL",
            duration_ns=seconds * SECOND_NS,
            status=SubjectStatus.EVENT if outcome else SubjectStatus.RIGHT_CENSORED,
            cause_id=None if outcome == 0 else ("A" if outcome == 1 else "B"),
            quality=QualityState.SYNTHETIC,
        )
        for index, (seconds, outcome) in enumerate(observations)
    )
    return SurvivalCohortV1(
        cohort_id="q11.prop",
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        causes=CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_km_is_a_monotone_probability_curve(observations: list[tuple[int, int]]) -> None:
    curve = estimate_kaplan_meier(build(observations))
    previous = FIXED_POINT_SCALE
    for point in curve.points:
        assert 0 <= point.survival.mantissa <= previous
        previous = point.survival.mantissa
    censoring = estimate_censoring_survival(build(observations))
    previous = FIXED_POINT_SCALE
    for point in censoring.points:
        assert 0 <= point.survival.mantissa <= previous
        previous = point.survival.mantissa


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_km_equals_one_minus_ecdf_without_censoring(
    observations: list[tuple[int, int]],
) -> None:
    uncensored = [(seconds, 1 + outcome % 2) for seconds, outcome in observations]
    cohort = build(uncensored)
    curve = estimate_kaplan_meier(cohort)
    total = len(uncensored)
    for point in curve.points:
        remaining = sum(1 for seconds, _ in uncensored if seconds * SECOND_NS > point.time_ns)
        assert point.survival == fraction_to_fixed_point(Fraction(remaining, total))


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_aalen_johansen_conserves_probability_exactly(
    observations: list[tuple[int, int]],
) -> None:
    cohort = build(observations)
    table = event_time_table(cohort.subjects, cohort.causes)
    survival_steps = exact_survival_steps(table, role=CurveRole.EVENT_SURVIVAL)
    incidence_a = exact_incidence_steps(table, 0)
    incidence_b = exact_incidence_steps(table, 1)
    for (_, survival, _), (_, cif_a), (_, cif_b) in zip(
        survival_steps, incidence_a, incidence_b, strict=True
    ):
        assert survival + cif_a + cif_b == Fraction(1)
        assert cif_a >= 0
        assert cif_b >= 0
        assert survival >= 0


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_single_cause_incidence_is_km_complement(
    observations: list[tuple[int, int]],
) -> None:
    single_cause = [(seconds, min(outcome, 1)) for seconds, outcome in observations]
    subjects = tuple(
        SubjectV1(
            subject_id=f"s{index:03d}",
            group_id=f"s{index:03d}",
            stratum_id="ALL",
            duration_ns=seconds * SECOND_NS,
            status=SubjectStatus.EVENT if outcome else SubjectStatus.RIGHT_CENSORED,
            cause_id="A" if outcome else None,
            quality=QualityState.SYNTHETIC,
        )
        for index, (seconds, outcome) in enumerate(single_cause)
    )
    cohort = SurvivalCohortV1(
        cohort_id="q11.prop.single",
        target=SurvivalTarget.TIME_TO_INVALIDATION,
        causes=CauseSetV1(cause_ids=("A",)),
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )
    estimate = estimate_aalen_johansen(cohort)
    km = estimate_kaplan_meier(cohort)
    for aj_point, km_point in zip(estimate.incidence[0].points, km.points, strict=True):
        assert aj_point.incidence.mantissa == FIXED_POINT_SCALE - km_point.survival.mantissa


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_life_table_model_equals_km_on_aligned_grid(
    observations: list[tuple[int, int]],
) -> None:
    cohort = build(observations)
    distinct = tuple(sorted({subject.duration_ns for subject in cohort.subjects}))
    grid = TimeGridV1(grid_id="q11.prop.grid", times_ns=distinct)
    config = HazardModelConfigV1(
        model_version="q11.prop.model",
        grid=grid,
        causes=CAUSES,
        smoothing=make_ratio(0, 1),
        min_risk_set=1,
    )
    model = fit_discrete_hazard(cohort, config)
    prediction = model.predict("ALL")
    assert prediction is not None
    km = estimate_kaplan_meier(cohort)
    for predicted in prediction.bins:
        if predicted.survival is None:
            break
        assert predicted.survival == km.survival_at(predicted.end_ns)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_oracle_brier_is_zero_without_censoring(
    observations: list[tuple[int, int]],
) -> None:
    uncensored = [(seconds, 1 + outcome % 2) for seconds, outcome in observations]
    cohort = build(uncensored)
    grid = TimeGridV1(
        grid_id="q11.prop.brier.grid",
        times_ns=(10 * SECOND_NS, 40 * SECOND_NS),
    )
    predictions = tuple(
        SubjectPredictionV1(
            subject_id=subject.subject_id,
            event_probabilities=tuple(
                FixedPointV1(FIXED_POINT_SCALE if subject.duration_ns <= time_ns else 0)
                for time_ns in grid.times_ns
            ),
        )
        for subject in cohort.subjects
    )
    report = evaluate_brier(
        cohort,
        PredictionSetV1(
            prediction_id="q11.prop.oracle",
            cohort_id=cohort.cohort_id,
            model_id=MODEL_ID,
            target=cohort.target,
            split_id=SPLIT_ID,
            grid=grid,
            cause_scope=ANY_CAUSE,
            predictions=predictions,
        ),
    )
    assert report.integrated == FixedPointV1(0)
    assert all(point.score == FixedPointV1(0) for point in report.points)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS, st.integers(min_value=0, max_value=FIXED_POINT_SCALE))
def test_constant_prediction_brier_identity_without_censoring(
    observations: list[tuple[int, int]], mantissa: int
) -> None:
    uncensored = [(seconds, 1 + outcome % 2) for seconds, outcome in observations]
    cohort = build(uncensored)
    probability = Fraction(mantissa, FIXED_POINT_SCALE)
    grid = TimeGridV1(grid_id="q11.prop.const.grid", times_ns=(20 * SECOND_NS,))
    row = (FixedPointV1(mantissa),)
    report = evaluate_brier(
        cohort,
        PredictionSetV1(
            prediction_id="q11.prop.const",
            cohort_id=cohort.cohort_id,
            model_id=MODEL_ID,
            target=cohort.target,
            split_id=SPLIT_ID,
            grid=grid,
            cause_scope=ANY_CAUSE,
            predictions=tuple(
                SubjectPredictionV1(subject_id=subject.subject_id, event_probabilities=row)
                for subject in cohort.subjects
            ),
        ),
    )
    events = sum(1 for seconds, _ in uncensored if seconds <= 20)
    survivors = len(uncensored) - events
    expected = (events * (1 - probability) ** 2 + survivors * probability**2) / len(uncensored)
    assert report.points[0].score == fraction_to_fixed_point(expected)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(
        st.tuples(
            st.integers(min_value=1, max_value=40),
            st.integers(min_value=0, max_value=2),
            st.integers(min_value=-1_000, max_value=1_000),
        ),
        min_size=2,
        max_size=40,
        unique_by=lambda row: row[2],
    )
)
def test_concordance_reversal_symmetry_without_ties(
    rows: list[tuple[int, int, int]],
) -> None:
    cohort = build([(seconds, outcome) for seconds, outcome, _ in rows])
    forward = RiskScoreSetV1(
        score_id="q11.prop.fwd",
        cohort_id=cohort.cohort_id,
        model_id="q11.prop.forward-model",
        target=cohort.target,
        split_id=SPLIT_ID,
        scores=tuple(
            (f"s{index:03d}", FixedPointV1(score)) for index, (_, _, score) in enumerate(rows)
        ),
    )
    backward = RiskScoreSetV1(
        score_id="q11.prop.bwd",
        cohort_id=cohort.cohort_id,
        model_id="q11.prop.backward-model",
        target=cohort.target,
        split_id=SPLIT_ID,
        scores=tuple(
            (f"s{index:03d}", FixedPointV1(-score)) for index, (_, _, score) in enumerate(rows)
        ),
    )
    forward_report = evaluate_concordance(cohort, forward)
    backward_report = evaluate_concordance(cohort, backward)
    if forward_report.status is MetricStatus.UNAVAILABLE:
        assert backward_report.status is MetricStatus.UNAVAILABLE
        return
    assert forward_report.concordant == backward_report.discordant
    assert forward_report.discordant == backward_report.concordant
    assert forward_report.tied_scores == backward_report.tied_scores == 0
    assert forward_report.concordance is not None
    assert backward_report.concordance is not None
    assert (
        forward_report.concordance.mantissa + backward_report.concordance.mantissa
        == FIXED_POINT_SCALE
    )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(OBSERVATIONS)
def test_marginal_calibration_gap_is_zero_at_a_covered_horizon(
    observations: list[tuple[int, int]],
) -> None:
    cohort = build(observations)
    horizon_ns = max(subject.duration_ns for subject in cohort.subjects)
    grid = TimeGridV1(grid_id="q11.prop.cal.grid", times_ns=(horizon_ns,))
    table = event_time_table(cohort.subjects, cohort.causes)
    survival = exact_survival_steps(table, role=CurveRole.EVENT_SURVIVAL)[-1][1]
    observed = Fraction(1) - survival
    row = (fraction_to_fixed_point(observed),)
    report = evaluate_calibration(
        cohort,
        PredictionSetV1(
            prediction_id="q11.prop.marginal",
            cohort_id=cohort.cohort_id,
            model_id=MODEL_ID,
            target=cohort.target,
            split_id=SPLIT_ID,
            grid=grid,
            cause_scope=ANY_CAUSE,
            predictions=tuple(
                SubjectPredictionV1(subject_id=subject.subject_id, event_probabilities=row)
                for subject in cohort.subjects
            ),
        ),
        horizon_ns=horizon_ns,
        bin_count=4,
    )
    assert report.status is MetricStatus.AVAILABLE
    assert report.expected_calibration_error is not None
    # Prediction and observation differ only through the single boundary
    # quantization of the predicted value.
    assert report.expected_calibration_error.mantissa <= 1


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(
        st.sampled_from(sorted(QualityState, key=lambda state: state.value)),
        min_size=1,
        max_size=30,
    )
)
def test_quality_gate_never_upgrades(qualities: list[QualityState]) -> None:
    candidates = tuple(
        SubjectV1(
            subject_id=f"s{index:03d}",
            group_id=f"s{index:03d}",
            stratum_id="ALL",
            duration_ns=SECOND_NS,
            status=SubjectStatus.EVENT,
            cause_id="A",
            quality=quality,
        )
        for index, quality in enumerate(qualities)
    )
    result = build_cohort(
        cohort_id="q11.prop.gate",
        target=SurvivalTarget.TIME_TO_IGNITION,
        causes=CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        candidates=candidates,
    )
    eligible = sum(
        1 for quality in qualities if quality in (QualityState.COMPLETE, QualityState.SYNTHETIC)
    )
    assert result.excluded_total == len(qualities) - eligible
    if eligible:
        assert result.cohort is not None
        assert result.cohort.size == eligible
    else:
        assert result.cohort is None
    for quality, count in result.excluded_by_quality:
        assert quality not in (QualityState.COMPLETE, QualityState.SYNTHETIC)
        assert count == sum(1 for value in qualities if value is quality)
