"""Deterministic Q11 survival-layer campaign and golden-fixture builder.

Usage: ``python -m quant_edge.survival.campaign OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or
ambient-time access:

- ``OUTPUT_ROOT/generated/q11/survival_golden_v1.json``
- ``OUTPUT_ROOT/generated/q11/survival_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q11/survival_campaign.v1.md``

Everything here is SYNTHETIC fixture evidence proving the §14.4 machinery:
survival curves, competing-risk incidence, the discrete hazard model and the
time-dependent metrics are measured on cohorts drawn from known hazards. No
model, curve or hazard is claimed to be predictive, calibrated on market data
or economically valuable.
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import replace
from fractions import Fraction
from pathlib import Path
from typing import cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.randomness import DeterministicRandom
from quant_edge.survival.competing import estimate_aalen_johansen
from quant_edge.survival.contracts import (
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeGridV1,
    event_time_table,
    fraction_to_fixed_point,
)
from quant_edge.survival.hazard_model import (
    DiscreteHazardModelV1,
    HazardModelConfigV1,
    fit_discrete_hazard,
)
from quant_edge.survival.km import (
    ONE,
    CurveRole,
    estimate_censoring_survival,
    estimate_kaplan_meier,
    exact_survival_steps,
)
from quant_edge.survival.metrics import (
    ANY_CAUSE,
    PredictionSetV1,
    RiskScoreSetV1,
    SubjectPredictionV1,
    SurvivalBudgetV1,
    evaluate_brier,
    evaluate_calibration,
    evaluate_concordance,
    judge_survival,
)
from quant_edge.survival.targets import V1_TARGET_SPECS, v1_target_spec

CAMPAIGN_SEED = 20260712
SECOND_NS = 1_000_000_000
MINUTE_NS = 60 * SECOND_NS

CAUSE_PRIMARY = "PRIMARY"
CAUSE_COMPETING = "COMPETING"
SEEDED_CAUSES = CauseSetV1(cause_ids=(CAUSE_COMPETING, CAUSE_PRIMARY))
SEEDED_STRATA = ("S0", "S1", "S2", "S3")
SEEDED_BINS = 12
SEEDED_SUBJECTS_PER_STRATUM = 60
SEEDED_GRID = TimeGridV1(
    grid_id="q11.seeded.grid.v1",
    times_ns=tuple((index + 1) * MINUTE_NS for index in range(SEEDED_BINS)),
)

# Per-stratum constant per-bin cause hazards for the known generating law.
SEEDED_HAZARDS: dict[str, tuple[Fraction, Fraction]] = {
    "S0": (Fraction(1, 100), Fraction(1, 200)),
    "S1": (Fraction(3, 100), Fraction(1, 100)),
    "S2": (Fraction(8, 100), Fraction(2, 100)),
    "S3": (Fraction(15, 100), Fraction(3, 100)),
}
SEEDED_CENSOR_HAZARD = Fraction(2, 100)

_U64_SPAN = 1 << 64


def _threshold(probability: Fraction) -> int:
    return probability.numerator * _U64_SPAN // probability.denominator


def _require_covered(value: FixedPointV1 | None) -> FixedPointV1:
    """Fail closed when a curve query outruns the observed follow-up."""

    if value is None:
        raise ContractValueError("seeded follow-up must cover the grid")
    return value


def _fp_text(value: object) -> str:
    """Render a fixed-point mapping (or anything else) for the Markdown table."""

    if isinstance(value, dict) and "mantissa" in value:
        mantissa = int(str(value["mantissa"]))
        return f"{Fraction(mantissa, FIXED_POINT_SCALE):.6f}"
    return str(value)


def _subject(
    subject_id: str,
    duration_ns: int,
    cause_id: str | None,
    *,
    stratum_id: str = "ALL",
    group_id: str | None = None,
) -> SubjectV1:
    return SubjectV1(
        subject_id=subject_id,
        group_id=subject_id if group_id is None else group_id,
        stratum_id=stratum_id,
        duration_ns=duration_ns,
        status=SubjectStatus.RIGHT_CENSORED if cause_id is None else SubjectStatus.EVENT,
        cause_id=cause_id,
        quality=QualityState.SYNTHETIC,
    )


def _freireich_cohort() -> SurvivalCohortV1:
    """The classic 6-MP remission-duration arm; a hand-verifiable KM fixture."""

    observed: tuple[tuple[int, bool], ...] = (
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
    subjects = tuple(
        _subject(
            f"fr-{index:02d}",
            seconds * SECOND_NS,
            "INVALIDATION" if is_event else None,
        )
        for index, (seconds, is_event) in enumerate(observed)
    )
    return SurvivalCohortV1(
        cohort_id="q11.golden.km",
        target=SurvivalTarget.TIME_TO_INVALIDATION,
        causes=v1_target_spec(SurvivalTarget.TIME_TO_INVALIDATION).cause_set(),
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


def _competing_cohort() -> SurvivalCohortV1:
    """Six subjects, two causes; every incidence value is hand-checkable."""

    spec = v1_target_spec(SurvivalTarget.ACTIONABILITY_WINDOW)
    rows: tuple[tuple[int, str | None], ...] = (
        (1, spec.primary_cause),
        (2, "INVALIDATION"),
        (3, None),
        (4, spec.primary_cause),
        (5, None),
        (7, "INVALIDATION"),
    )
    subjects = tuple(
        _subject(f"aj-{index}", seconds * SECOND_NS, cause_id)
        for index, (seconds, cause_id) in enumerate(rows)
    )
    return SurvivalCohortV1(
        cohort_id="q11.golden.aj",
        target=SurvivalTarget.ACTIONABILITY_WINDOW,
        causes=spec.cause_set(),
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


_GOLDEN_MODEL_CAUSES = CauseSetV1(cause_ids=("A", "B"))
_GOLDEN_MODEL_GRID = TimeGridV1(
    grid_id="q11.golden.grid",
    times_ns=(10 * SECOND_NS, 20 * SECOND_NS, 30 * SECOND_NS),
)


def _hazard_model_cohort() -> SurvivalCohortV1:
    subjects = (
        _subject("h1", 5 * SECOND_NS, "A", stratum_id="HIGH"),
        _subject("h2", 10 * SECOND_NS, "B", stratum_id="HIGH"),
        _subject("h3", 15 * SECOND_NS, None, stratum_id="HIGH"),
        _subject("h4", 25 * SECOND_NS, "A", stratum_id="HIGH"),
        _subject("h5", 40 * SECOND_NS, None, stratum_id="HIGH"),
        _subject("l1", 30 * SECOND_NS, "B", stratum_id="LOW"),
        _subject("l2", 35 * SECOND_NS, None, stratum_id="LOW"),
        _subject("l3", 8 * SECOND_NS, None, stratum_id="LOW"),
        _subject("t1", 5 * SECOND_NS, "A", stratum_id="THIN"),
    )
    return SurvivalCohortV1(
        cohort_id="q11.golden.hazard",
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        causes=_GOLDEN_MODEL_CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


def golden_hazard_model() -> DiscreteHazardModelV1:
    config = HazardModelConfigV1(
        model_version="q11.golden.hazard.v1",
        grid=_GOLDEN_MODEL_GRID,
        causes=_GOLDEN_MODEL_CAUSES,
        smoothing=make_ratio(1, 1),
        min_risk_set=2,
    )
    return fit_discrete_hazard(_hazard_model_cohort(), config)


_METRIC_GRID = TimeGridV1(
    grid_id="q11.golden.metric.grid",
    times_ns=(7 * SECOND_NS, 13 * SECOND_NS, 23 * SECOND_NS),
)
_GOLDEN_BUDGET = SurvivalBudgetV1(
    budget_id="q11.golden.budget.v1",
    max_integrated_brier=FixedPointV1(FIXED_POINT_SCALE // 4),
    min_concordance=FixedPointV1(6 * FIXED_POINT_SCALE // 10),
    max_calibration_error=FixedPointV1(FIXED_POINT_SCALE // 10),
)


def _oracle_predictions(cohort: SurvivalCohortV1, grid: TimeGridV1) -> PredictionSetV1:
    """Indicator predictions: exactly right for every observed outcome."""

    predictions = []
    for subject in cohort.subjects:
        row = tuple(
            FixedPointV1(
                FIXED_POINT_SCALE if subject.is_event and subject.duration_ns <= time_ns else 0
            )
            for time_ns in grid.times_ns
        )
        predictions.append(
            SubjectPredictionV1(subject_id=subject.subject_id, event_probabilities=row)
        )
    return PredictionSetV1(
        prediction_id=f"{cohort.cohort_id}.oracle",
        cohort_id=cohort.cohort_id,
        model_id=f"{cohort.cohort_id}.oracle-model.v1",
        target=cohort.target,
        split_id=f"{cohort.cohort_id}.evaluation-split.v1",
        grid=grid,
        cause_scope=ANY_CAUSE,
        predictions=tuple(predictions),
    )


def _constant_one_predictions(cohort: SurvivalCohortV1, grid: TimeGridV1) -> PredictionSetV1:
    """The everyone-events-immediately predictor; a deliberate miscalibration."""

    row = tuple(FixedPointV1(FIXED_POINT_SCALE) for _ in grid.times_ns)
    return PredictionSetV1(
        prediction_id=f"{cohort.cohort_id}.constant-one",
        cohort_id=cohort.cohort_id,
        model_id=f"{cohort.cohort_id}.constant-one-model.v1",
        target=cohort.target,
        split_id=f"{cohort.cohort_id}.evaluation-split.v1",
        grid=grid,
        cause_scope=ANY_CAUSE,
        predictions=tuple(
            SubjectPredictionV1(subject_id=subject.subject_id, event_probabilities=row)
            for subject in cohort.subjects
        ),
    )


def _marginal_predictions(
    cohort: SurvivalCohortV1,
    grid: TimeGridV1,
    source: SurvivalCohortV1,
) -> PredictionSetV1:
    """Predict the source cohort's own KM event probability for every subject."""

    curve = estimate_kaplan_meier(source)
    row = []
    for time_ns in grid.times_ns:
        survival = curve.survival_at(time_ns)
        if survival is None:
            raise ContractValueError("marginal predictor requires the grid inside follow-up")
        row.append(FixedPointV1(FIXED_POINT_SCALE - survival.mantissa))
    fixed_row = tuple(row)
    return PredictionSetV1(
        prediction_id=f"{cohort.cohort_id}.marginal",
        cohort_id=cohort.cohort_id,
        model_id=f"{source.cohort_id}.marginal-model.v1",
        target=cohort.target,
        split_id=f"{cohort.cohort_id}.evaluation-split.v1",
        grid=grid,
        cause_scope=ANY_CAUSE,
        predictions=tuple(
            SubjectPredictionV1(subject_id=subject.subject_id, event_probabilities=fixed_row)
            for subject in cohort.subjects
        ),
    )


def _golden_metrics() -> dict[str, object]:
    cohort = _freireich_cohort()
    # A perfectly discriminating risk score: earlier observed time, higher risk.
    # Two subjects share one group to exercise the same-group exclusion law.
    grouped = list(cohort.subjects)
    grouped[0] = replace(grouped[0], group_id="fr-shared-group")
    grouped[20] = replace(grouped[20], group_id="fr-shared-group")
    grouped_cohort = SurvivalCohortV1(
        cohort_id="q11.golden.km.grouped",
        target=cohort.target,
        causes=cohort.causes,
        posture=cohort.posture,
        subjects=tuple(grouped),
    )
    oracle = _oracle_predictions(grouped_cohort, _METRIC_GRID)
    constant_one = _constant_one_predictions(grouped_cohort, _METRIC_GRID)
    marginal = _marginal_predictions(grouped_cohort, _METRIC_GRID, grouped_cohort)
    brier_oracle = evaluate_brier(grouped_cohort, oracle)
    brier_constant = evaluate_brier(grouped_cohort, constant_one)
    brier_marginal = evaluate_brier(grouped_cohort, marginal)

    perfect_scores = RiskScoreSetV1(
        score_id="q11.golden.scores.perfect",
        cohort_id=grouped_cohort.cohort_id,
        model_id=oracle.model_id,
        target=grouped_cohort.target,
        split_id=oracle.split_id,
        scores=tuple(
            (subject.subject_id, FixedPointV1(-subject.duration_ns))
            for subject in grouped_cohort.subjects
        ),
    )
    constant_scores = RiskScoreSetV1(
        score_id="q11.golden.scores.constant",
        cohort_id=grouped_cohort.cohort_id,
        model_id=constant_one.model_id,
        target=grouped_cohort.target,
        split_id=constant_one.split_id,
        scores=tuple((subject.subject_id, FixedPointV1(0)) for subject in grouped_cohort.subjects),
    )
    concordance_perfect = evaluate_concordance(
        grouped_cohort, perfect_scores, horizon_ns=_METRIC_GRID.end_ns
    )
    concordance_constant = evaluate_concordance(
        grouped_cohort, constant_scores, horizon_ns=_METRIC_GRID.end_ns
    )
    calibration_oracle = evaluate_calibration(
        grouped_cohort, oracle, horizon_ns=_METRIC_GRID.end_ns, bin_count=4
    )
    calibration_marginal = evaluate_calibration(
        grouped_cohort, marginal, horizon_ns=_METRIC_GRID.end_ns, bin_count=4
    )
    calibration_constant = evaluate_calibration(
        grouped_cohort, constant_one, horizon_ns=_METRIC_GRID.end_ns, bin_count=4
    )
    verdict_pass = judge_survival(
        _GOLDEN_BUDGET,
        brier=brier_oracle,
        concordance=concordance_perfect,
        calibration=calibration_oracle,
    )
    verdict_fail = judge_survival(
        _GOLDEN_BUDGET,
        brier=brier_constant,
        concordance=concordance_constant,
        calibration=calibration_constant,
    )
    return {
        "brier": {
            "constantOne": brier_constant.as_mapping(),
            "marginal": brier_marginal.as_mapping(),
            "oracle": brier_oracle.as_mapping(),
        },
        "budget": _GOLDEN_BUDGET.as_mapping(),
        "calibration": {
            "constantOne": calibration_constant.as_mapping(),
            "marginal": calibration_marginal.as_mapping(),
            "oracle": calibration_oracle.as_mapping(),
        },
        "concordance": {
            "constant": concordance_constant.as_mapping(),
            "perfect": concordance_perfect.as_mapping(),
        },
        "verdicts": {
            "fail": verdict_fail.as_mapping(),
            "pass": verdict_pass.as_mapping(),
        },
    }


def _build_golden() -> dict[str, object]:
    km_cohort = _freireich_cohort()
    aj_cohort = _competing_cohort()
    model = golden_hazard_model()
    predictions = {
        table.stratum_id: prediction.as_mapping()
        for table in model.strata
        if (prediction := model.predict(table.stratum_id)) is not None
    }
    return {
        "aalenJohansen": {
            "cohort": aj_cohort.as_mapping(),
            "estimate": estimate_aalen_johansen(aj_cohort).as_mapping(),
        },
        "evidencePosture": "SYNTHETIC_ONLY",
        "hazardModel": {
            "model": model.as_mapping(),
            "predictions": predictions,
            "unseenStratumIsUnknown": model.predict("UNSEEN") is None,
        },
        "kaplanMeier": {
            "censoringCurve": estimate_censoring_survival(km_cohort).as_mapping(),
            "cohort": km_cohort.as_mapping(),
            "curve": estimate_kaplan_meier(km_cohort).as_mapping(),
        },
        "metrics": _golden_metrics(),
        "schema": "Q11SurvivalGoldenV1",
        "targets": [spec.as_mapping() for spec in V1_TARGET_SPECS],
        "version": 1,
    }


def _draw_seeded_cohort(rng: DeterministicRandom, cohort_id: str) -> SurvivalCohortV1:
    """Draw one cohort from the known per-stratum discrete hazard law."""

    censor_threshold = _threshold(SEEDED_CENSOR_HAZARD)
    subjects: list[SubjectV1] = []
    for stratum_id in SEEDED_STRATA:
        primary, competing = SEEDED_HAZARDS[stratum_id]
        primary_threshold = _threshold(primary)
        total_threshold = _threshold(primary + competing)
        for index in range(SEEDED_SUBJECTS_PER_STRATUM):
            subject_id = f"{cohort_id}-{stratum_id}-{index:03d}"
            duration_ns: int | None = None
            cause_id: str | None = None
            for bin_index in range(SEEDED_BINS):
                draw = rng.next_u64()
                if draw < primary_threshold:
                    duration_ns = SEEDED_GRID.times_ns[bin_index]
                    cause_id = CAUSE_PRIMARY
                    break
                if draw < total_threshold:
                    duration_ns = SEEDED_GRID.times_ns[bin_index]
                    cause_id = CAUSE_COMPETING
                    break
                if rng.next_u64() < censor_threshold:
                    duration_ns = SEEDED_GRID.times_ns[bin_index]
                    break
            if duration_ns is None:
                duration_ns = SEEDED_GRID.end_ns + MINUTE_NS
            subjects.append(_subject(subject_id, duration_ns, cause_id, stratum_id=stratum_id))
    return SurvivalCohortV1(
        cohort_id=cohort_id,
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        causes=SEEDED_CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        subjects=tuple(subjects),
    )


def _true_any_event_survival(bin_index: int) -> Fraction:
    """Population survival of the generating mixture at a bin end (equal strata)."""

    total = Fraction(0)
    for stratum_id in SEEDED_STRATA:
        primary, competing = SEEDED_HAZARDS[stratum_id]
        total += (ONE - primary - competing) ** (bin_index + 1)
    return total / len(SEEDED_STRATA)


def _cohort_summary(cohort: SurvivalCohortV1) -> dict[str, object]:
    counts = cohort.event_counts()
    return {
        "censored": cohort.censored_count,
        "events": {
            cause_id: counts[index] for index, cause_id in enumerate(cohort.causes.cause_ids)
        },
        "size": cohort.size,
    }


def _model_prediction_rows(
    model: DiscreteHazardModelV1,
) -> dict[str, tuple[tuple[FixedPointV1, ...], tuple[FixedPointV1, ...]]]:
    """Per stratum: (any-event probabilities, primary-cause incidences) per bin."""

    primary_index = SEEDED_CAUSES.index_of(CAUSE_PRIMARY)
    rows: dict[str, tuple[tuple[FixedPointV1, ...], tuple[FixedPointV1, ...]]] = {}
    for table in model.strata:
        prediction = model.predict(table.stratum_id)
        if prediction is None or prediction.known_bins != prediction.grid.bin_count:
            raise ContractValueError("model prediction rows need fully KNOWN strata")
        any_event: list[FixedPointV1] = []
        primary_cif: list[FixedPointV1] = []
        for predicted_bin in prediction.bins:
            survival = cast(FixedPointV1, predicted_bin.survival)
            incidence = cast("tuple[FixedPointV1, ...]", predicted_bin.incidence)
            any_event.append(FixedPointV1(FIXED_POINT_SCALE - survival.mantissa))
            primary_cif.append(incidence[primary_index])
        rows[table.stratum_id] = (tuple(any_event), tuple(primary_cif))
    return rows


def _prediction_sets_from_model(
    model: DiscreteHazardModelV1,
    cohort: SurvivalCohortV1,
) -> tuple[PredictionSetV1, PredictionSetV1]:
    rows = _model_prediction_rows(model)
    any_event = tuple(
        SubjectPredictionV1(
            subject_id=subject.subject_id,
            event_probabilities=rows[subject.stratum_id][0],
        )
        for subject in cohort.subjects
    )
    primary = tuple(
        SubjectPredictionV1(
            subject_id=subject.subject_id,
            event_probabilities=rows[subject.stratum_id][1],
        )
        for subject in cohort.subjects
    )
    return (
        PredictionSetV1(
            prediction_id=f"{cohort.cohort_id}.model.any",
            cohort_id=cohort.cohort_id,
            model_id=model.config.model_version,
            target=cohort.target,
            split_id=f"{cohort.cohort_id}.evaluation-split.v1",
            grid=SEEDED_GRID,
            cause_scope=ANY_CAUSE,
            predictions=any_event,
        ),
        PredictionSetV1(
            prediction_id=f"{cohort.cohort_id}.model.primary",
            cohort_id=cohort.cohort_id,
            model_id=model.config.model_version,
            target=cohort.target,
            split_id=f"{cohort.cohort_id}.evaluation-split.v1",
            grid=SEEDED_GRID,
            cause_scope=CAUSE_PRIMARY,
            predictions=primary,
        ),
    )


def _max_abs_survival_gap(cohort: SurvivalCohortV1) -> tuple[FixedPointV1, list[object]]:
    """Measure KM recovery of the known generating survival at every bin end."""

    table = event_time_table(cohort.subjects, cohort.causes)
    steps = exact_survival_steps(table, role=CurveRole.EVENT_SURVIVAL)
    per_time: list[object] = []
    worst = Fraction(0)
    for bin_index, time_ns in enumerate(SEEDED_GRID.times_ns):
        estimated = ONE
        for step_time, survival, _ in steps:
            if step_time <= time_ns:
                estimated = survival
        truth = _true_any_event_survival(bin_index)
        gap = abs(estimated - truth)
        worst = max(worst, gap)
        per_time.append(
            {
                "absGap": fraction_to_fixed_point(gap).as_mapping(),
                "estimated": fraction_to_fixed_point(estimated).as_mapping(),
                "timeNs": str(time_ns),
                "truth": fraction_to_fixed_point(truth).as_mapping(),
            }
        )
    return fraction_to_fixed_point(worst), per_time


def _quantized_conservation_defect_ulps(cohort: SurvivalCohortV1) -> int:
    """Max |1 - S - sum(CIF)| over all times, in units of the fixed-point ulp."""

    estimate = estimate_aalen_johansen(cohort)
    worst = 0
    for index, point in enumerate(estimate.overall_survival.points):
        total = point.survival.mantissa
        for curve in estimate.incidence:
            total += curve.points[index].incidence.mantissa
        worst = max(worst, abs(total - FIXED_POINT_SCALE))
    return worst


def _build_campaign(fixture_sha256: str) -> tuple[dict[str, object], list[str]]:
    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    train = _draw_seeded_cohort(rng, "q11.seeded.train")
    test = _draw_seeded_cohort(rng, "q11.seeded.test")

    # Smoothing 1/100 regularizes empty bins without materially distorting the
    # ~1..18% per-bin hazards at risk sets of this size; alpha = 1 would inflate
    # low-hazard strata by ~2% per bin per cause and measurably miscalibrate.
    config = HazardModelConfigV1(
        model_version="q11.seeded.model.v1",
        grid=SEEDED_GRID,
        causes=SEEDED_CAUSES,
        smoothing=make_ratio(1, 100),
        min_risk_set=1,
    )
    model = fit_discrete_hazard(train, config)
    model_any, model_primary = _prediction_sets_from_model(model, test)
    marginal_any = _marginal_predictions(test, SEEDED_GRID, train)

    brier_model = evaluate_brier(test, model_any)
    brier_marginal = evaluate_brier(test, marginal_any)
    brier_primary = evaluate_brier(test, model_primary)

    horizon_mid = SEEDED_GRID.times_ns[SEEDED_BINS // 2 - 1]
    horizon_end = SEEDED_GRID.end_ns
    calibration_mid = evaluate_calibration(test, model_any, horizon_ns=horizon_mid, bin_count=8)
    calibration_end = evaluate_calibration(test, model_any, horizon_ns=horizon_end, bin_count=8)
    calibration_primary = evaluate_calibration(
        test, model_primary, horizon_ns=horizon_end, bin_count=8
    )

    rows = _model_prediction_rows(model)
    end_index = SEEDED_BINS - 1
    scores = RiskScoreSetV1(
        score_id="q11.seeded.scores.model",
        cohort_id=test.cohort_id,
        model_id=model_any.model_id,
        target=test.target,
        split_id=model_any.split_id,
        scores=tuple(
            (subject.subject_id, rows[subject.stratum_id][0][end_index])
            for subject in test.subjects
        ),
    )
    concordance = evaluate_concordance(test, scores, horizon_ns=horizon_end)

    budget = SurvivalBudgetV1(
        budget_id="q11.seeded.budget.v1",
        max_integrated_brier=FixedPointV1(FIXED_POINT_SCALE // 4),
        min_concordance=FixedPointV1(55 * FIXED_POINT_SCALE // 100),
        max_calibration_error=FixedPointV1(FIXED_POINT_SCALE // 10),
    )
    verdict = judge_survival(
        budget, brier=brier_model, concordance=concordance, calibration=calibration_end
    )

    recovery_gap, recovery_rows = _max_abs_survival_gap(test)
    censoring_curve = estimate_censoring_survival(test)
    censoring_at_end = _require_covered(censoring_curve.survival_at(horizon_end))

    campaign = {
        "budgetVerdict": {"budget": budget.as_mapping(), "verdict": verdict.as_mapping()},
        "censoring": {
            "reverseKmAtGridEnd": censoring_at_end.as_mapping(),
            "zeroWeightAtGridEnd": brier_model.points[-1].zero_weight_subjects,
        },
        "cohorts": {
            "test": _cohort_summary(test),
            "train": _cohort_summary(train),
        },
        "competing": {
            "quantizedConservationDefectUlps": _quantized_conservation_defect_ulps(test),
        },
        "estimatorRecovery": {
            "maxAbsSurvivalGap": recovery_gap.as_mapping(),
            "perTime": recovery_rows,
        },
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": fixture_sha256,
        "generatingLaw": {
            "censorHazard": make_ratio(
                SEEDED_CENSOR_HAZARD.numerator, SEEDED_CENSOR_HAZARD.denominator
            ).as_mapping(),
            "strata": {
                stratum_id: {
                    "competing": make_ratio(
                        competing.numerator, competing.denominator
                    ).as_mapping(),
                    "primary": make_ratio(primary.numerator, primary.denominator).as_mapping(),
                }
                for stratum_id, (primary, competing) in sorted(SEEDED_HAZARDS.items())
            },
        },
        "modelEvaluation": {
            "brier": {
                "marginalAny": brier_marginal.as_mapping(),
                "modelAny": brier_model.as_mapping(),
                "modelPrimary": brier_primary.as_mapping(),
            },
            "calibration": {
                "modelAnyGridEnd": calibration_end.as_mapping(),
                "modelAnyMid": calibration_mid.as_mapping(),
                "modelPrimaryGridEnd": calibration_primary.as_mapping(),
            },
            "concordance": concordance.as_mapping(),
        },
        "schema": "Q11SurvivalCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "version": 1,
    }

    integrated_model = brier_model.as_mapping()["integrated"]
    integrated_marginal = brier_marginal.as_mapping()["integrated"]
    concordance_value = concordance.as_mapping()["concordance"]
    ece_end = calibration_end.as_mapping()["expectedCalibrationError"]
    lines = [
        "# Q11 survival campaign evidence (synthetic only)",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{fixture_sha256}`",
        f"- Train/test: {train.size}/{test.size} subjects over {len(SEEDED_STRATA)} strata,"
        f" {SEEDED_BINS} one-minute bins",
        "",
        "No survival model, curve or hazard is claimed to be predictive, calibrated",
        "on market data or economically valuable; these are machinery measurements",
        "on cohorts drawn from a known synthetic hazard law.",
        "",
        "| Measurement | Value |",
        "| --- | ---: |",
        f"| KM max abs recovery gap | {_fp_text(recovery_gap.as_mapping())} |",
        f"| Integrated Brier (model, any cause) | {_fp_text(integrated_model)} |",
        f"| Integrated Brier (marginal, any cause) | {_fp_text(integrated_marginal)} |",
        f"| Concordance (model risk scores) | {_fp_text(concordance_value)} |",
        f"| ECE at grid end (model, any cause) | {_fp_text(ece_end)} |",
        f"| Quantized AJ conservation defect (ulps) | "
        f"{_quantized_conservation_defect_ulps(test)} |",
        f"| Budget verdict | {verdict.verdict.value} |",
        "",
    ]
    return campaign, lines


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    golden = _build_golden()
    fixture_bytes = canonical_json_bytes(golden)
    fixture_sha256 = hashlib.sha256(fixture_bytes).hexdigest()
    campaign, lines = _build_campaign(fixture_sha256)
    campaign_bytes = canonical_json_bytes(campaign)
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m quant_edge.survival.campaign OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    target = output_root / "generated" / "q11"
    target.mkdir(parents=True, exist_ok=True)
    (target / "survival_golden_v1.json").write_bytes(fixture_bytes)
    (target / "survival_campaign.v1.json").write_bytes(campaign_bytes)
    (target / "survival_campaign.v1.md").write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
