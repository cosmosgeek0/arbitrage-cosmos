"""The Q10 battery: run every model honestly, log every trial, keep every loss.

For each synthetic target the battery fits transparent baselines, honest
controls and the Q01-selected XGBoost challengers (default and study-tuned),
calibrates classifier probabilities isotonic-on-validation, measures exact
metrics on the untouched-by-fitting test slice and freezes a complete
comparison report. Studies are bounded, seeded and fully logged. Winners
follow predeclared primary metrics; a boosted loss to a linear baseline is
reported verbatim, never smoothed. Everything is SYNTHETIC machinery proof —
no model here is predictive, validated or economically valuable, and the
Q14-owned validation factory pieces are recorded ``WAITING_Q14``.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from importlib import metadata
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import DigestV1
from quant_edge.models import engine
from quant_edge.models.contracts import (
    BatteryDisposition,
    BatteryDispositionRecordV1,
    CalibrationMethod,
    ComparisonReportV1,
    MetricDirection,
    MetricValueV1,
    ModelResultV1,
    ModelRole,
    ProbabilitySemantics,
    TargetKind,
    disposition_table_digest,
    make_comparison_report,
    prediction_digest,
)
from quant_edge.models.estimators import (
    SCORE_OUTPUT,
    EstimatorFamily,
    EstimatorSpecV1,
    monotone_vector,
    raw_outputs,
)
from quant_edge.models.metrics import (
    binary64_log_loss,
    brier_score,
    coverage_abs_error,
    crossing_fraction,
    exact_auc,
    expected_calibration_error,
    kendall_tau_a,
    mean_absolute_error,
    mean_squared_error,
    pinball_loss,
    pinball_mean,
    precision_at_k,
    recall_at_k,
)
from quant_edge.models.quantize import quantize_probability_vector, quantize_vector
from quant_edge.models.split import InternalChronologicalSplitV1
from quant_edge.models.studies import (
    ParamKind,
    ParamSpecV1,
    StudyRecordV1,
    StudySpecV1,
    run_bounded_study,
)
from quant_edge.models.synthetic import (
    QUANTILE_LEVELS,
    RANK_RELEVANT_GRADE,
    TARGET_BINARY_ID,
    TARGET_QUANTILE_ID,
    TARGET_RANK_ID,
    TARGET_REGRESSION_ID,
    SyntheticDatasetV1,
    SyntheticTargetV1,
    battery_split,
    build_battery_dataset,
)

BATTERY_SEED: Final = 20260712
RANK_K: Final = 4

_FRAMEWORKS: Final = ("optuna", "scikit-learn", "xgboost")

_BOOST_SPACE: Final[tuple[ParamSpecV1, ...]] = (
    ParamSpecV1("learning_rate", ParamKind.CATEGORICAL, choices=("0.05", "0.1", "0.2")),
    ParamSpecV1("max_depth", ParamKind.INT_RANGE, low=2, high=5),
    ParamSpecV1("min_child_weight", ParamKind.INT_RANGE, low=1, high=8),
    ParamSpecV1("n_estimators", ParamKind.CATEGORICAL, choices=(50, 100, 150)),
)

_RANKER_SPACE: Final[tuple[ParamSpecV1, ...]] = (
    ParamSpecV1("learning_rate", ParamKind.CATEGORICAL, choices=("0.05", "0.1", "0.2")),
    ParamSpecV1("max_depth", ParamKind.INT_RANGE, low=2, high=4),
    ParamSpecV1("min_child_weight", ParamKind.INT_RANGE, low=1, high=8),
    ParamSpecV1("n_estimators", ParamKind.CATEGORICAL, choices=(30, 60, 100)),
)

_DEFAULT_BOOST_PARAMS: Final[tuple[tuple[str, int | str], ...]] = (
    ("learning_rate", "0.1"),
    ("max_depth", 5),
    ("min_child_weight", 2),
    ("n_estimators", 150),
)

_DEFAULT_RANKER_PARAMS: Final[tuple[tuple[str, int | str], ...]] = (
    ("learning_rate", "0.1"),
    ("max_depth", 4),
    ("min_child_weight", 2),
    ("n_estimators", 100),
)

_STUDY_TRIALS: Final = 12
_STUDY_SEEDS: Final = {
    TARGET_BINARY_ID: 101,
    TARGET_REGRESSION_ID: 102,
    TARGET_QUANTILE_ID: 103,
    TARGET_RANK_ID: 104,
}


def _labels_at(target: SyntheticTargetV1, indices: range) -> tuple[int, ...]:
    return tuple(target.labels[index] for index in indices)


def _params_tuple(params: dict[str, int | str]) -> tuple[tuple[str, int | str], ...]:
    return tuple(sorted(params.items()))


def _score_vector(raw: dict[str, tuple[float, ...]]) -> tuple[float, ...]:
    return raw[SCORE_OUTPUT]


def _run_binary(
    dataset: SyntheticDatasetV1, split: InternalChronologicalSplitV1, seed: int
) -> tuple[ComparisonReportV1, StudyRecordV1]:
    target = dataset.target(TARGET_BINARY_ID)
    valid_labels = _labels_at(target, split.valid_indices)
    test_labels = _labels_at(target, split.test_indices)
    monotone = monotone_vector(dataset, {"lin_primary": 1, "lin_secondary": 1})

    def trial_spec(params: dict[str, int | str], model_id: str) -> EstimatorSpecV1:
        return EstimatorSpecV1(
            model_id=model_id,
            family=EstimatorFamily.XGB_CLASSIFIER,
            role=ModelRole.BOOSTED_CHALLENGER,
            target_kind=TargetKind.BINARY,
            params=_params_tuple(params),
        )

    def objective(params: dict[str, int | str]) -> MetricValueV1:
        raw = raw_outputs(
            trial_spec(params, "xgb_classifier_trial:v1"),
            dataset,
            target,
            split,
            split.valid_indices,
            battery_seed=seed,
            monotone=monotone,
        )
        quantized = quantize_probability_vector(_score_vector(raw), field="trial score")
        return brier_score(quantized, valid_labels)

    study = run_bounded_study(
        StudySpecV1(
            study_id="study_xgb_classifier:v1",
            objective_metric="brier",
            direction=MetricDirection.LOWER_IS_BETTER,
            n_trials=_STUDY_TRIALS,
            sampler_seed=_STUDY_SEEDS[TARGET_BINARY_ID],
        ),
        _BOOST_SPACE,
        objective,
    )

    specs = (
        EstimatorSpecV1(
            "logistic:v1",
            EstimatorFamily.LOGISTIC,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.BINARY,
            (),
        ),
        EstimatorSpecV1(
            "elastic_net_logistic:v1",
            EstimatorFamily.ELASTIC_LOGISTIC,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.BINARY,
            (("l1_ratio", "0.5"),),
        ),
        EstimatorSpecV1(
            "no_trade_prevalence:v1",
            EstimatorFamily.PREVALENCE,
            ModelRole.CONTROL,
            TargetKind.BINARY,
            (),
        ),
        EstimatorSpecV1(
            "random_rank:v1",
            EstimatorFamily.RANDOM_RANK,
            ModelRole.CONTROL,
            TargetKind.BINARY,
            (("seed", seed),),
        ),
        EstimatorSpecV1(
            "xgb_classifier:v1",
            EstimatorFamily.XGB_CLASSIFIER,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.BINARY,
            _DEFAULT_BOOST_PARAMS,
        ),
        EstimatorSpecV1(
            "xgb_classifier_tuned:v1",
            EstimatorFamily.XGB_CLASSIFIER,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.BINARY,
            study.best_params(),
        ),
    )

    results = []
    for spec in specs:
        spec_monotone = monotone if spec.family is EstimatorFamily.XGB_CLASSIFIER else None
        calibrate = spec.family in (
            EstimatorFamily.LOGISTIC,
            EstimatorFamily.ELASTIC_LOGISTIC,
            EstimatorFamily.XGB_CLASSIFIER,
        )
        raw_test = _score_vector(
            raw_outputs(
                spec,
                dataset,
                target,
                split,
                split.test_indices,
                battery_seed=seed,
                monotone=spec_monotone,
            )
        )
        raw_test_quantized = quantize_probability_vector(raw_test, field=f"{spec.model_id} raw")
        if calibrate:
            raw_valid = _score_vector(
                raw_outputs(
                    spec,
                    dataset,
                    target,
                    split,
                    split.valid_indices,
                    battery_seed=seed,
                    monotone=spec_monotone,
                )
            )
            calibrated = engine.isotonic_calibrate(raw_valid, valid_labels, raw_test)
            final = quantize_probability_vector(calibrated, field=f"{spec.model_id} calibrated")
        else:
            final = raw_test_quantized
        metric_list = [
            brier_score(final, test_labels),
            exact_auc(final, test_labels),
            expected_calibration_error(final, test_labels),
            binary64_log_loss(final, test_labels),
        ]
        if calibrate:
            metric_list.append(
                expected_calibration_error(
                    raw_test_quantized, test_labels, name="ece_precalibration"
                )
            )
        results.append(
            ModelResultV1(
                model_id=spec.model_id,
                target_id=target.target_id,
                role=spec.role,
                calibration=(
                    CalibrationMethod.ISOTONIC_VALIDATION if calibrate else CalibrationMethod.NONE
                ),
                probability_semantics=(
                    ProbabilitySemantics.CALIBRATED
                    if calibrate
                    else ProbabilitySemantics.UNCALIBRATED_SCORE
                ),
                params=spec.params,
                metrics=tuple(sorted(metric_list, key=lambda metric: metric.name)),
                predictions=prediction_digest({SCORE_OUTPUT: final}),
            )
        )
    report = make_comparison_report(
        target_id=target.target_id,
        target_kind=TargetKind.BINARY,
        primary_metric="brier",
        results=tuple(results),
    )
    return report, study


def _run_regression(
    dataset: SyntheticDatasetV1, split: InternalChronologicalSplitV1, seed: int
) -> tuple[ComparisonReportV1, StudyRecordV1]:
    target = dataset.target(TARGET_REGRESSION_ID)
    valid_labels = _labels_at(target, split.valid_indices)
    test_labels = _labels_at(target, split.test_indices)
    monotone = monotone_vector(dataset, {"lin_primary": 1, "lin_secondary": 1})

    def objective(params: dict[str, int | str]) -> MetricValueV1:
        spec = EstimatorSpecV1(
            "xgb_regressor_trial:v1",
            EstimatorFamily.XGB_REGRESSOR,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.REGRESSION,
            _params_tuple(params),
        )
        raw = raw_outputs(
            spec, dataset, target, split, split.valid_indices, battery_seed=seed, monotone=monotone
        )
        quantized = quantize_vector(_score_vector(raw), field="trial values")
        return mean_squared_error(quantized, valid_labels)

    study = run_bounded_study(
        StudySpecV1(
            study_id="study_xgb_regressor:v1",
            objective_metric="mse",
            direction=MetricDirection.LOWER_IS_BETTER,
            n_trials=_STUDY_TRIALS,
            sampler_seed=_STUDY_SEEDS[TARGET_REGRESSION_ID],
        ),
        _BOOST_SPACE,
        objective,
    )

    specs = (
        EstimatorSpecV1(
            "ols:v1", EstimatorFamily.OLS, ModelRole.TRANSPARENT_BASELINE, TargetKind.REGRESSION, ()
        ),
        EstimatorSpecV1(
            "train_mean:v1",
            EstimatorFamily.TRAIN_MEAN,
            ModelRole.CONTROL,
            TargetKind.REGRESSION,
            (),
        ),
        EstimatorSpecV1(
            "xgb_regressor:v1",
            EstimatorFamily.XGB_REGRESSOR,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.REGRESSION,
            _DEFAULT_BOOST_PARAMS,
        ),
        EstimatorSpecV1(
            "xgb_regressor_tuned:v1",
            EstimatorFamily.XGB_REGRESSOR,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.REGRESSION,
            study.best_params(),
        ),
    )

    results = []
    for spec in specs:
        spec_monotone = monotone if spec.family is EstimatorFamily.XGB_REGRESSOR else None
        raw_test = _score_vector(
            raw_outputs(
                spec,
                dataset,
                target,
                split,
                split.test_indices,
                battery_seed=seed,
                monotone=spec_monotone,
            )
        )
        final = quantize_vector(raw_test, field=f"{spec.model_id} values")
        metric_list = [
            mean_absolute_error(final, test_labels),
            mean_squared_error(final, test_labels),
        ]
        results.append(
            ModelResultV1(
                model_id=spec.model_id,
                target_id=target.target_id,
                role=spec.role,
                calibration=CalibrationMethod.NONE,
                probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
                params=spec.params,
                metrics=tuple(sorted(metric_list, key=lambda metric: metric.name)),
                predictions=prediction_digest({SCORE_OUTPUT: final}),
            )
        )
    report = make_comparison_report(
        target_id=target.target_id,
        target_kind=TargetKind.REGRESSION,
        primary_metric="mse",
        results=tuple(results),
    )
    return report, study


def _quantile_payload(
    raw: dict[str, tuple[float, ...]], *, field: str
) -> dict[str, tuple[FixedPointV1, ...]]:
    return {
        f"q{level}": quantize_vector(raw[f"q{level}"], field=f"{field} q{level}")
        for level in QUANTILE_LEVELS
    }


def _run_quantile(
    dataset: SyntheticDatasetV1, split: InternalChronologicalSplitV1, seed: int
) -> tuple[ComparisonReportV1, StudyRecordV1]:
    target = dataset.target(TARGET_QUANTILE_ID)
    valid_labels = _labels_at(target, split.valid_indices)
    test_labels = _labels_at(target, split.test_indices)
    # No monotone constraints here: XGBoost multi-quantile vector leaves do not
    # honor them (measured violation on planted-direction probes), so applying
    # constraints to this challenger would be an indefensible false promise.

    def objective(params: dict[str, int | str]) -> MetricValueV1:
        spec = EstimatorSpecV1(
            "xgb_quantile_trial:v1",
            EstimatorFamily.XGB_QUANTILE,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.QUANTILE,
            _params_tuple(params),
        )
        raw = raw_outputs(
            spec, dataset, target, split, split.valid_indices, battery_seed=seed, monotone=None
        )
        payload = _quantile_payload(raw, field="trial")
        return pinball_mean(
            {level: payload[f"q{level}"] for level in QUANTILE_LEVELS}, valid_labels
        )

    study = run_bounded_study(
        StudySpecV1(
            study_id="study_xgb_quantile:v1",
            objective_metric="pinball_mean",
            direction=MetricDirection.LOWER_IS_BETTER,
            n_trials=_STUDY_TRIALS,
            sampler_seed=_STUDY_SEEDS[TARGET_QUANTILE_ID],
        ),
        _BOOST_SPACE,
        objective,
    )

    specs = (
        EstimatorSpecV1(
            "quantile_linear:v1",
            EstimatorFamily.QUANTILE_LINEAR,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.QUANTILE,
            (),
        ),
        EstimatorSpecV1(
            "train_quantile_constant:v1",
            EstimatorFamily.TRAIN_QUANTILE,
            ModelRole.CONTROL,
            TargetKind.QUANTILE,
            (),
        ),
        EstimatorSpecV1(
            "xgb_quantile:v1",
            EstimatorFamily.XGB_QUANTILE,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.QUANTILE,
            _DEFAULT_BOOST_PARAMS,
        ),
        EstimatorSpecV1(
            "xgb_quantile_tuned:v1",
            EstimatorFamily.XGB_QUANTILE,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.QUANTILE,
            study.best_params(),
        ),
    )

    results = []
    for spec in specs:
        raw_test = raw_outputs(
            spec,
            dataset,
            target,
            split,
            split.test_indices,
            battery_seed=seed,
            monotone=None,
        )
        payload = _quantile_payload(raw_test, field=spec.model_id)
        by_level = {level: payload[f"q{level}"] for level in QUANTILE_LEVELS}
        metric_list = [pinball_mean(by_level, test_labels)]
        metric_list.extend(
            pinball_loss(by_level[level], test_labels, level=level) for level in QUANTILE_LEVELS
        )
        metric_list.extend(
            coverage_abs_error(by_level[level], test_labels, level=level)
            for level in QUANTILE_LEVELS
        )
        metric_list.append(crossing_fraction(by_level["0.25"], by_level["0.5"], by_level["0.75"]))
        results.append(
            ModelResultV1(
                model_id=spec.model_id,
                target_id=target.target_id,
                role=spec.role,
                calibration=CalibrationMethod.NONE,
                probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
                params=spec.params,
                metrics=tuple(sorted(metric_list, key=lambda metric: metric.name)),
                predictions=prediction_digest(payload),
            )
        )
    report = make_comparison_report(
        target_id=target.target_id,
        target_kind=TargetKind.QUANTILE,
        primary_metric="pinball_mean",
        results=tuple(results),
    )
    return report, study


def _run_rank(
    dataset: SyntheticDatasetV1, split: InternalChronologicalSplitV1, seed: int
) -> tuple[ComparisonReportV1, StudyRecordV1]:
    target = dataset.target(TARGET_RANK_ID)
    group_size = target.require_group_size()
    valid_labels = _labels_at(target, split.valid_indices)
    test_labels = _labels_at(target, split.test_indices)
    monotone = monotone_vector(dataset, {"activity_proxy": 1, "lin_primary": 1})

    def objective(params: dict[str, int | str]) -> MetricValueV1:
        spec = EstimatorSpecV1(
            "xgb_ranker_trial:v1",
            EstimatorFamily.XGB_RANKER,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.RANK,
            _params_tuple(params),
        )
        raw = raw_outputs(
            spec, dataset, target, split, split.valid_indices, battery_seed=seed, monotone=monotone
        )
        scores = quantize_vector(_score_vector(raw), field="trial scores")
        return precision_at_k(
            scores,
            valid_labels,
            group_size=group_size,
            k=RANK_K,
            relevant_grade=RANK_RELEVANT_GRADE,
        )

    study = run_bounded_study(
        StudySpecV1(
            study_id="study_xgb_ranker:v1",
            objective_metric=f"precision_at_{RANK_K}",
            direction=MetricDirection.HIGHER_IS_BETTER,
            n_trials=_STUDY_TRIALS,
            sampler_seed=_STUDY_SEEDS[TARGET_RANK_ID],
        ),
        _RANKER_SPACE,
        objective,
    )

    specs = (
        EstimatorSpecV1(
            "activity_only:v1",
            EstimatorFamily.FEATURE_RANKER,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.RANK,
            (("feature_id", "activity_proxy"),),
        ),
        EstimatorSpecV1(
            "liquidity_only:v1",
            EstimatorFamily.FEATURE_RANKER,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.RANK,
            (("feature_id", "liquidity_proxy"),),
        ),
        EstimatorSpecV1(
            "random_rank:v1",
            EstimatorFamily.RANDOM_RANK,
            ModelRole.CONTROL,
            TargetKind.RANK,
            (("seed", seed),),
        ),
        EstimatorSpecV1(
            "xgb_ranker:v1",
            EstimatorFamily.XGB_RANKER,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.RANK,
            _DEFAULT_RANKER_PARAMS,
        ),
        EstimatorSpecV1(
            "xgb_ranker_tuned:v1",
            EstimatorFamily.XGB_RANKER,
            ModelRole.BOOSTED_CHALLENGER,
            TargetKind.RANK,
            study.best_params(),
        ),
    )

    results = []
    for spec in specs:
        spec_monotone = monotone if spec.family is EstimatorFamily.XGB_RANKER else None
        raw_test = _score_vector(
            raw_outputs(
                spec,
                dataset,
                target,
                split,
                split.test_indices,
                battery_seed=seed,
                monotone=spec_monotone,
            )
        )
        final = quantize_vector(raw_test, field=f"{spec.model_id} scores")
        metric_list = [
            precision_at_k(
                final,
                test_labels,
                group_size=group_size,
                k=RANK_K,
                relevant_grade=RANK_RELEVANT_GRADE,
            ),
            recall_at_k(
                final,
                test_labels,
                group_size=group_size,
                k=RANK_K,
                relevant_grade=RANK_RELEVANT_GRADE,
            ),
            kendall_tau_a(final, test_labels, group_size=group_size),
        ]
        results.append(
            ModelResultV1(
                model_id=spec.model_id,
                target_id=target.target_id,
                role=spec.role,
                calibration=CalibrationMethod.NONE,
                probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
                params=spec.params,
                metrics=tuple(sorted(metric_list, key=lambda metric: metric.name)),
                predictions=prediction_digest({SCORE_OUTPUT: final}),
            )
        )
    report = make_comparison_report(
        target_id=target.target_id,
        target_kind=TargetKind.RANK,
        primary_metric=f"precision_at_{RANK_K}",
        results=tuple(results),
    )
    return report, study


SECTION_14_BATTERY_DISPOSITIONS: Final[tuple[BatteryDispositionRecordV1, ...]] = (
    BatteryDispositionRecordV1(
        bullet_id="14.1-01-robust-heuristic-baselines",
        bullet="robust heuristic baselines already used by current engines",
        disposition=BatteryDisposition.ADAPT,
        reason=(
            "production engine heuristics live outside the Q lane (read-only); the proxy "
            "single-feature rankers stand in as the transparent heuristic tier"
        ),
        implemented_ids=("activity_only:v1", "liquidity_only:v1"),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.1-02-calibrated-logistic-elastic-net",
        bullet="calibrated logistic/elastic-net classification",
        disposition=BatteryDisposition.ADOPT,
        reason="both fitted on train only and isotonic-calibrated on the validation slice",
        implemented_ids=("elastic_net_logistic:v1", "logistic:v1"),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.1-03-linear-quantile-regression",
        bullet="linear/quantile regression",
        disposition=BatteryDisposition.ADOPT,
        reason="OLS and exact-LP linear quantile baselines over the declared levels",
        implemented_ids=("ols:v1", "quantile_linear:v1"),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.1-04-gam-spline",
        bullet="GAM/spline challenger where useful",
        disposition=BatteryDisposition.REFERENCE_ONLY,
        reason=(
            "not useful yet: the synthetic machinery proof has no smooth-nonlinear planted "
            "structure a spline tier would demonstrate beyond the boosted challenger"
        ),
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.1-05-liquidity-activity-rankers",
        bullet="liquidity-only and activity-only rankers",
        disposition=BatteryDisposition.ADOPT,
        reason="exact single-feature rankers over the declared proxy features",
        implemented_ids=("activity_only:v1", "liquidity_only:v1"),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.1-06-random-and-no-trade-controls",
        bullet="random-rank and no-trade controls",
        disposition=BatteryDisposition.ADOPT,
        reason="seeded random scores and the train-prevalence/mean/quantile constants",
        implemented_ids=(
            "no_trade_prevalence:v1",
            "random_rank:v1",
            "train_mean:v1",
            "train_quantile_constant:v1",
        ),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.2-01-topk-precision-recall",
        bullet="top-k candidate recall and precision at focus budget",
        disposition=BatteryDisposition.ADOPT,
        reason="exact-rational precision@k and micro recall@k over whole groups",
        implemented_ids=("kendall_tau_a", "precision_at_4", "recall_at_4"),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.2-02-detection-lead-time",
        bullet="detection lead time",
        disposition=BatteryDisposition.DATA_INSUFFICIENT,
        reason="needs real point-in-time event timing evidence the lane does not hold",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.2-03-information-gain-promotion",
        bullet="expected information gain from promotion",
        disposition=BatteryDisposition.DATA_INSUFFICIENT,
        reason="needs a real promotion/observation loop; no production integration exists",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.2-04-conservative-net-value",
        bullet="expected conservative net value",
        disposition=BatteryDisposition.DATA_INSUFFICIENT,
        reason=(
            "needs measured cost/latency truth; the Q14 cost/latency stress factory is also "
            "not merged at this base"
        ),
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.2-05-compute-stream-cost",
        bullet="compute/stream cost",
        disposition=BatteryDisposition.DATA_INSUFFICIENT,
        reason="no production stream exists; host wall time is stdout-only evidence",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.3-01-xgboost-challengers",
        bullet="selected boosted challengers over tabular targets",
        disposition=BatteryDisposition.ADOPT,
        reason=(
            "XGBoost is the Q01-selected booster: classifier, regressor, multi-quantile and "
            "pairwise ranker, default and study-tuned, single-threaded hist with fixed seeds"
        ),
        implemented_ids=(
            "xgb_classifier:v1",
            "xgb_classifier_tuned:v1",
            "xgb_quantile:v1",
            "xgb_quantile_tuned:v1",
            "xgb_ranker:v1",
            "xgb_ranker_tuned:v1",
            "xgb_regressor:v1",
            "xgb_regressor_tuned:v1",
        ),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.3-02-lightgbm",
        bullet="LightGBM challenger",
        disposition=BatteryDisposition.REFERENCE_ONLY,
        reason="Q01 framework card: no dependency unless a comparative ablation earns promotion",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.3-03-catboost",
        bullet="CatBoost challenger",
        disposition=BatteryDisposition.REFERENCE_ONLY,
        reason=(
            "Q01 framework card: ablation-only candidate; mostly-numeric evidence removes its edge"
        ),
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.3-04-monotonic-constraints",
        bullet="monotonic/interaction constraints only where economically defensible",
        disposition=BatteryDisposition.ADOPT,
        reason=(
            "constraints are derivable only from declared planted directions, the "
            "derivation fails closed on any contradiction and the law is "
            "property-tested on classifier/regressor/ranker; the multi-quantile "
            "objective is excluded because XGBoost vector leaves measurably violate "
            "declared constraints"
        ),
        implemented_ids=("monotone_vector",),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.3-05-real-market-targets",
        bullet=(
            "dormant transition, continuation, exhaustion, Basis convergence, MFE/MAE, "
            "actionability and manipulation-like risk on real evidence"
        ),
        disposition=BatteryDisposition.DATA_INSUFFICIENT,
        reason=(
            "no persisted real market rows or point-in-time labels exist in the lane; the "
            "battery machinery is target-generic and proven on synthetic planted structure"
        ),
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="14.3-06-record-all-trials",
        bullet="record all trials",
        disposition=BatteryDisposition.ADOPT,
        reason=(
            "every budgeted Optuna trial is logged typed, including failures; short "
            "logs fail closed"
        ),
        implemented_ids=(
            "study_xgb_classifier:v1",
            "study_xgb_quantile:v1",
            "study_xgb_ranker:v1",
            "study_xgb_regressor:v1",
        ),
    ),
    BatteryDispositionRecordV1(
        bullet_id="15-01-per-model-calibration",
        bullet="per-model probability calibration with measured error",
        disposition=BatteryDisposition.ADOPT,
        reason="isotonic on the validation slice only; ECE measured before and after",
        implemented_ids=("isotonic_calibrate",),
    ),
    BatteryDispositionRecordV1(
        bullet_id="15-02-ensemble-conformal-abstention",
        bullet="stacking, conformal intervals, uncertainty decomposition, abstention",
        disposition=BatteryDisposition.REFERENCE_ONLY,
        reason="Q12 phase property; deliberately not built in Q10",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="16-01-purged-embargoed-walk-forward",
        bullet="purged/embargoed walk-forward validation",
        disposition=BatteryDisposition.WAITING_Q14,
        reason=(
            "Q14 validation-factory property; no frozen Q14 interface exists at this base and "
            "the battery-internal chronological split is typed non-authoritative"
        ),
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="16-02-untouched-holdout",
        bullet="untouched holdout governance",
        disposition=BatteryDisposition.WAITING_Q14,
        reason="Q14 property; the battery test slice is not an untouched holdout",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="16-03-negative-control-factory",
        bullet="negative-control factory (shuffled labels, deliberate leaks)",
        disposition=BatteryDisposition.WAITING_Q14,
        reason=(
            "Q14 property; the battery's random/no-trade controls are model controls, not the "
            "leak-detection factory"
        ),
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="16-04-cost-latency-stress",
        bullet="cost/latency stress turning attractive predictions into abstention",
        disposition=BatteryDisposition.WAITING_Q14,
        reason="Q14 property together with Q12 abstention; not reimplemented here",
        implemented_ids=(),
    ),
    BatteryDispositionRecordV1(
        bullet_id="16-05-pbo-dsr-bootstrap",
        bullet="PBO/DSR diagnostics and bootstrap intervals",
        disposition=BatteryDisposition.WAITING_Q14,
        reason="Q14 property; no comparison here claims validation-grade authority",
        implemented_ids=(),
    ),
)


@dataclass(frozen=True, slots=True)
class BatteryResultV1:
    """Complete battery outcome: reports, studies, dispositions, identity."""

    seed: int
    dataset: SyntheticDatasetV1
    split: InternalChronologicalSplitV1
    reports: tuple[ComparisonReportV1, ...]
    studies: tuple[StudyRecordV1, ...]
    dispositions: tuple[BatteryDispositionRecordV1, ...]
    frameworks: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        report_ids = [report.target_id for report in self.reports]
        if report_ids != sorted(report_ids) or len(set(report_ids)) != len(report_ids):
            raise ContractValueError("reports must be sorted by unique target_id")
        study_ids = [study.spec.study_id for study in self.studies]
        if study_ids != sorted(study_ids) or len(set(study_ids)) != len(study_ids):
            raise ContractValueError("studies must be sorted by unique study_id")
        disposition_table_digest(self.dispositions)

    def report(self, target_id: str) -> ComparisonReportV1:
        for candidate in self.reports:
            if candidate.target_id == target_id:
                return candidate
        raise ContractValueError(f"unknown report {target_id}")

    def as_mapping(self) -> dict[str, object]:
        return {
            "dataset": self.dataset.summary_mapping(),
            "dispositions": [record.as_mapping() for record in self.dispositions],
            "dispositionsSha256": disposition_table_digest(self.dispositions).hexdigest,
            "frameworks": dict(self.frameworks),
            "reports": [report.as_mapping() for report in self.reports],
            "schema": "Q10BatteryResultV1",
            "seed": str(self.seed),
            "split": self.split.as_mapping(),
            "studies": [study.as_mapping() for study in self.studies],
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        payload = canonical_json_bytes(self.as_mapping())
        return DigestV1(hexdigest=hashlib.sha256(payload).hexdigest())


def framework_versions() -> tuple[tuple[str, str], ...]:
    """Installed pinned versions of the adopted modeling frameworks."""

    return tuple((name, metadata.version(name)) for name in _FRAMEWORKS)


def run_battery(seed: int) -> BatteryResultV1:
    """Run the full deterministic battery for one seed."""

    dataset = build_battery_dataset(seed)
    split = battery_split()
    split.require_exact_cover(len(dataset.rows))
    binary_report, binary_study = _run_binary(dataset, split, seed)
    regression_report, regression_study = _run_regression(dataset, split, seed)
    quantile_report, quantile_study = _run_quantile(dataset, split, seed)
    rank_report, rank_study = _run_rank(dataset, split, seed)
    reports = tuple(
        sorted(
            (binary_report, regression_report, quantile_report, rank_report),
            key=lambda report: report.target_id,
        )
    )
    studies = tuple(
        sorted(
            (binary_study, regression_study, quantile_study, rank_study),
            key=lambda study: study.spec.study_id,
        )
    )
    return BatteryResultV1(
        seed=seed,
        dataset=dataset,
        split=split,
        reports=reports,
        studies=studies,
        dispositions=SECTION_14_BATTERY_DISPOSITIONS,
        frameworks=framework_versions(),
    )
