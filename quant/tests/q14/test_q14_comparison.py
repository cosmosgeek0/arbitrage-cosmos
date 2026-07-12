"""Q14 comparison report law: verdicts, digests, holdout grants and Markdown."""

from __future__ import annotations

import pytest
from q14_fixtures import informative_predictions, make_sample_set, predictions_from_scores

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.validation.bootstrap import BootstrapSpecV1
from quant_edge.validation.comparison import (
    ComparisonSpecV1,
    ComparisonVerdict,
    compare_models,
    render_comparison_markdown,
)
from quant_edge.validation.controls import (
    falsify_lineage,
    future_leaked_predictions,
    random_rank_predictions,
)
from quant_edge.validation.leakage import LeakageSpecV1, LeakageVerdict
from quant_edge.validation.metrics import MetricKind, MetricStatus, PrimaryMetricSpecV1
from quant_edge.validation.multiplicity import TrialLedgerV1, TrialRecordV1, TrialStatus
from quant_edge.validation.samples import (
    PredictionSetV1,
    SampleSetV1,
    restrict_predictions,
    subset_by_ids,
)
from quant_edge.validation.splits import (
    HoldoutGrantV1,
    SplitScheme,
    WalkForwardPlanV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
)

SEED = 20260712
HOUR_NS = 3_600_000_000_000


def _ledger() -> TrialLedgerV1:
    return TrialLedgerV1(
        trials=(
            TrialRecordV1(
                trial_id="t-000",
                family_id="family-h1",
                model_id="baseline",
                metric_id="pr_auc",
                status=TrialStatus.COMPLETED,
                note="baseline trial",
            ),
            TrialRecordV1(
                trial_id="t-001",
                family_id="family-h1",
                model_id="challenger",
                metric_id="pr_auc",
                status=TrialStatus.COMPLETED,
                note="challenger trial",
            ),
        )
    )


def _comparison_spec(
    kind: MetricKind = MetricKind.PR_AUC,
    *,
    k: int | None = None,
    implausible_mantissa: int = 990_000_000_000,
) -> ComparisonSpecV1:
    return ComparisonSpecV1(
        primary=PrimaryMetricSpecV1(kind=kind, k=k, ece_bins=None),
        bootstrap=BootstrapSpecV1(
            seed=SEED,
            block_length=1,
            replicates=64,
            coverage_per_myriad=9_000,
        ),
        leakage=LeakageSpecV1(
            primary=PrimaryMetricSpecV1(kind=kind, k=k, ece_bins=None),
            implausible_skill=FixedPointV1(implausible_mantissa),
            band_seed=SEED,
            band_replicates=32,
        ),
    )


def _plan(
    samples: SampleSetV1,
    *,
    fold_count: int = 4,
    min_train_size: int = 4,
    holdout_num: int = 1,
    holdout_den: int = 5,
) -> WalkForwardPlanV1:
    spec = WalkForwardSpecV1(
        scheme=SplitScheme.EXPANDING,
        fold_count=fold_count,
        max_label_horizon_ns=HOUR_NS,
        max_feature_lookback_ns=0,
        embargo_ns=HOUR_NS,
        min_train_size=min_train_size,
        holdout_fraction=make_ratio(holdout_num, holdout_den),
        rolling_train_size=None,
    )
    return build_walk_forward_plan(samples, spec)


def test_comparison_spec_contract_law() -> None:
    spec = _comparison_spec()
    assert spec.as_mapping()["primary"] == {"eceBins": None, "k": None, "kind": "PR_AUC"}
    with pytest.raises(ContractValueError, match="PrimaryMetricSpecV1"):
        ComparisonSpecV1(primary="pr_auc", bootstrap=spec.bootstrap, leakage=spec.leakage)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="BootstrapSpecV1"):
        ComparisonSpecV1(primary=spec.primary, bootstrap="b", leakage=spec.leakage)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="LeakageSpecV1"):
        ComparisonSpecV1(primary=spec.primary, bootstrap=spec.bootstrap, leakage="l")  # type: ignore[arg-type]


def test_challenger_improvement_is_evidence_based() -> None:
    samples = make_sample_set(80)
    plan = _plan(samples)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = informative_predictions(samples, model_id="informative-challenger")
    report = compare_models(samples, plan, baseline, challenger, _ledger(), _comparison_spec())
    assert report.verdict is ComparisonVerdict.IMPROVES
    assert report.improved_fold_count == 4
    assert report.worsened_fold_count == 0
    assert report.effect_interval is not None
    assert report.holdout_grant is None
    assert report.digest() == report.digest()
    mapping = report.as_mapping()
    assert mapping["schema"] == "Q14ComparisonReportV1"
    assert mapping["planDigest"] == plan.digest().hexdigest

    reversed_report = compare_models(
        samples, plan, challenger, baseline, _ledger(), _comparison_spec()
    )
    assert reversed_report.verdict is ComparisonVerdict.WORSE

    tied_report = compare_models(samples, plan, baseline, baseline, _ledger(), _comparison_spec())
    assert tied_report.verdict is ComparisonVerdict.NO_EVIDENCE
    assert tied_report.tied_fold_count == 4


def test_lower_is_better_effects_are_direction_adjusted() -> None:
    # With Brier as the primary metric, lower is better; the informative
    # challenger's smaller loss must still read as a positive effect.
    samples = make_sample_set(80)
    plan = _plan(samples)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = informative_predictions(samples, model_id="informative-challenger")
    report = compare_models(
        samples,
        plan,
        baseline,
        challenger,
        _ledger(),
        _comparison_spec(MetricKind.BRIER, implausible_mantissa=10_000_000_000),
    )
    assert report.verdict is ComparisonVerdict.IMPROVES
    assert report.improved_fold_count == 4
    for fold in report.folds:
        assert fold.effect is not None
        assert fold.effect.numerator > 0
        assert fold.challenger.value is not None
        assert fold.baseline.value is not None
        assert fold.challenger.value.mantissa < fold.baseline.value.mantissa


def test_leaked_challenger_never_reaches_comparison() -> None:
    samples = make_sample_set(80)
    plan = _plan(samples)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    leaked = future_leaked_predictions(samples, model_id="leaked-model")
    report = compare_models(samples, plan, baseline, leaked, _ledger(), _comparison_spec())
    assert report.verdict is ComparisonVerdict.REJECTED_CHALLENGER_LEAKAGE
    assert report.challenger_assessment.verdict is LeakageVerdict.REJECTED_TEMPORAL_LEAK
    assert report.folds == ()

    forged = falsify_lineage(leaked, samples)
    forged_report = compare_models(samples, plan, baseline, forged, _ledger(), _comparison_spec())
    assert forged_report.verdict is ComparisonVerdict.REJECTED_CHALLENGER_LEAKAGE
    assert forged_report.challenger_assessment.verdict is LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL

    baseline_leak_report = compare_models(
        samples, plan, leaked, informative_predictions(samples), _ledger(), _comparison_spec()
    )
    assert baseline_leak_report.verdict is ComparisonVerdict.INVALID_BASELINE


def test_invalid_plan_and_insufficient_folds() -> None:
    samples = make_sample_set(80)
    invalid_plan = _plan(samples, min_train_size=60)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = informative_predictions(samples, model_id="informative-challenger")
    invalid_report = compare_models(
        samples, invalid_plan, baseline, challenger, _ledger(), _comparison_spec()
    )
    assert invalid_report.verdict is ComparisonVerdict.INVALID_PLAN

    # k = 20 is measurable on the 64-sample research set (leakage passes) but no
    # 13-sample fold validation slice can support it, so every fold is skipped.
    plan = _plan(samples)
    starved = compare_models(
        samples,
        plan,
        baseline,
        challenger,
        _ledger(),
        _comparison_spec(MetricKind.PRECISION_AT_K, k=20),
    )
    assert starved.verdict is ComparisonVerdict.INSUFFICIENT_FOLDS
    assert starved.skipped_fold_count == 4


def test_two_fold_comparison_yields_no_evidence_interval_gate() -> None:
    samples = make_sample_set(60)
    plan = _plan(samples, fold_count=2, holdout_num=0, holdout_den=1)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = informative_predictions(samples, model_id="informative-challenger")
    report = compare_models(samples, plan, baseline, challenger, _ledger(), _comparison_spec())
    assert report.verdict is ComparisonVerdict.NO_EVIDENCE
    assert report.effect_interval is not None
    assert report.effect_interval.reason == "INSUFFICIENT_VALUES"


def test_holdout_grant_is_recorded_and_used_once_granted() -> None:
    samples = make_sample_set(80)
    plan = _plan(samples)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = informative_predictions(samples, model_id="informative-challenger")
    grant = HoldoutGrantV1(
        grant_id="grant-final",
        reason="final untouched holdout read for the declared primary metric",
        plan_digest=plan.digest(),
    )
    report = compare_models(
        samples,
        plan,
        baseline,
        challenger,
        _ledger(),
        _comparison_spec(),
        holdout_grant=grant,
    )
    assert report.holdout_grant == grant
    assert report.holdout_baseline is not None
    assert report.holdout_challenger is not None
    assert report.holdout_challenger.status is MetricStatus.AVAILABLE
    markdown = render_comparison_markdown(report)
    assert "Holdout opened: True" in markdown
    assert report.digest().hexdigest in markdown
    with pytest.raises(ContractValueError, match="ComparisonReportV1"):
        render_comparison_markdown("nope")  # type: ignore[arg-type]


def test_comparison_input_contract_law() -> None:
    samples = make_sample_set(40)
    plan = _plan(samples)
    baseline = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = informative_predictions(samples, model_id="informative-challenger")
    spec = _comparison_spec()
    ledger = _ledger()
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        compare_models("nope", plan, baseline, challenger, ledger, spec)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="WalkForwardPlanV1"):
        compare_models(samples, "nope", baseline, challenger, ledger, spec)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="TrialLedgerV1"):
        compare_models(samples, plan, baseline, challenger, "nope", spec)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="ComparisonSpecV1"):
        compare_models(samples, plan, baseline, challenger, ledger, "nope")  # type: ignore[arg-type]
    other = make_sample_set(40, dataset_id="other")
    with pytest.raises(ContractValueError, match="different sample set"):
        compare_models(other, plan, baseline, challenger, ledger, spec)


def test_subset_and_restrict_helpers() -> None:
    samples = make_sample_set(6)
    predictions = predictions_from_scores(
        samples,
        {sample.sample_id: make_ratio(1, 2) for sample in samples.samples},
    )
    subset = subset_by_ids(samples, ("s-0001", "s-0004"))
    assert subset.sample_ids == ("s-0001", "s-0004")
    assert subset.dataset_id == "q14-test.subset"
    restricted = restrict_predictions(predictions, subset)
    assert restricted.dataset_digest == subset.digest()
    assert len(restricted.predictions) == 2
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        subset_by_ids("nope", ("s-0001",))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        subset_by_ids(samples, ())
    with pytest.raises(ContractValueError, match="unknown sample ids"):
        subset_by_ids(samples, ("s-9999",))
    with pytest.raises(ContractValueError, match="PredictionSetV1"):
        restrict_predictions("nope", subset)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        restrict_predictions(predictions, "nope")  # type: ignore[arg-type]
    partial = PredictionSetV1(
        model_id="m",
        dataset_digest=samples.digest(),
        predictions=predictions.predictions[:3],
    )
    with pytest.raises(ContractValueError, match="do not cover"):
        restrict_predictions(partial, subset)
