"""Q14 property campaigns (explicit seed 20260712 via --hypothesis-seed)."""

from __future__ import annotations

from math import comb

from hypothesis import given, settings
from hypothesis import strategies as st
from q14_fixtures import BASE_NS, HOUR_NS, make_sample_set, predictions_from_scores

from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.validation.bootstrap import (
    BootstrapSpecV1,
    BootstrapStatus,
    block_bootstrap_interval,
)
from quant_edge.validation.controls import block_permuted_labels, shuffled_labels
from quant_edge.validation.dsr import DsrInputsV1, DsrStatus, deflated_sharpe_ratio
from quant_edge.validation.metrics import brier_score, pr_auc, roc_auc
from quant_edge.validation.multiplicity import PboStatus, pbo_cscv
from quant_edge.validation.samples import SampleSetV1, ValidationSampleV1
from quant_edge.validation.splits import (
    PlanStatus,
    SplitScheme,
    WalkForwardSpecV1,
    build_walk_forward_plan,
)

SCALE = 10**12

SAMPLE_SHAPES = st.lists(
    st.tuples(
        st.booleans(),  # outcome
        st.integers(min_value=1, max_value=5),  # horizon in half hours
        st.integers(min_value=0, max_value=6),  # group collision bucket
    ),
    min_size=16,
    max_size=48,
)


def _sample_set(shapes: list[tuple[bool, int, int]]) -> SampleSetV1:
    samples = []
    for index, (outcome, horizon_halves, group_bucket) in enumerate(shapes):
        group = f"g-{index // max(group_bucket, 1):04d}" if group_bucket else f"solo-{index:04d}"
        samples.append(
            ValidationSampleV1(
                sample_id=f"s-{index:04d}",
                symbol="BNBUSDT",
                group_id=group,
                cutoff_ns=BASE_NS + index * HOUR_NS,
                label_end_ns=BASE_NS + index * HOUR_NS + horizon_halves * (HOUR_NS // 2),
                strata=(),
                binary_outcome=outcome,
                gross_edge_ratio=None,
                base_cost_ratio=None,
                quality=QualityState.SYNTHETIC,
            )
        )
    return SampleSetV1(
        dataset_id="property-set",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(samples),
    )


@settings(max_examples=60, deadline=None)
@given(shapes=SAMPLE_SHAPES, fold_count=st.integers(min_value=2, max_value=4))
def test_split_law_holds_for_random_sample_sets(
    shapes: list[tuple[bool, int, int]],
    fold_count: int,
) -> None:
    samples = _sample_set(shapes)
    spec = WalkForwardSpecV1(
        scheme=SplitScheme.EXPANDING,
        fold_count=fold_count,
        max_label_horizon_ns=3 * HOUR_NS,
        max_feature_lookback_ns=HOUR_NS,
        embargo_ns=4 * HOUR_NS,
        min_train_size=1,
        holdout_fraction=make_ratio(1, 6),
        rolling_train_size=None,
    )
    plan = build_walk_forward_plan(samples, spec)
    assert plan == build_walk_forward_plan(samples, spec)

    holdout = set(plan.holdout_sample_ids)
    quarantined = set(plan.quarantined_sample_ids)
    for fold in plan.folds:
        members = set(fold.train_sample_ids) | set(fold.validation_sample_ids)
        assert not members & holdout
        assert not members & quarantined
        validation = [samples.by_id(sample_id) for sample_id in fold.validation_sample_ids]
        validation_start = min(sample.cutoff_ns for sample in validation)
        validation_groups = {sample.group_id for sample in validation}
        for train_id in fold.train_sample_ids:
            train_sample = samples.by_id(train_id)
            assert train_sample.cutoff_ns < validation_start
            assert train_sample.label_end_ns < validation_start - spec.embargo_ns
            assert train_sample.group_id not in validation_groups
    if plan.status is PlanStatus.VALID:
        assert all(fold.train_sample_ids for fold in plan.folds)


@settings(max_examples=60, deadline=None)
@given(
    outcomes=st.lists(st.booleans(), min_size=4, max_size=40),
    scores=st.lists(st.integers(min_value=0, max_value=1_000), min_size=4, max_size=40),
)
def test_metric_bounds_and_determinism(outcomes: list[bool], scores: list[int]) -> None:
    count = min(len(outcomes), len(scores))
    samples = make_sample_set(count, outcome_of=lambda index: outcomes[index])
    predictions = predictions_from_scores(
        samples,
        {f"s-{index:04d}": make_ratio(scores[index], 1_000) for index in range(count)},
    )
    for metric in (
        pr_auc(samples, predictions),
        roc_auc(samples, predictions),
        brier_score(samples, predictions),
    ):
        if metric.value is not None:
            assert 0 <= metric.value.mantissa <= SCALE
    assert pr_auc(samples, predictions) == pr_auc(samples, predictions)


@settings(max_examples=60, deadline=None)
@given(
    outcomes=st.lists(st.booleans(), min_size=6, max_size=40),
    seed=st.integers(min_value=0, max_value=2**32),
    block_size=st.integers(min_value=2, max_value=8),
)
def test_label_permutations_preserve_counts(
    outcomes: list[bool],
    seed: int,
    block_size: int,
) -> None:
    samples = make_sample_set(len(outcomes), outcome_of=lambda index: outcomes[index])
    shuffled = shuffled_labels(samples, seed=seed)
    assert sorted(bool(sample.binary_outcome) for sample in shuffled.samples) == sorted(outcomes)
    blocked = block_permuted_labels(samples, seed=seed, block_size=block_size)
    for start in range(0, len(outcomes), block_size):
        expected = sorted(map(bool, outcomes[start : start + block_size]))
        actual = sorted(
            bool(sample.binary_outcome) for sample in blocked.samples[start : start + block_size]
        )
        assert actual == expected


@settings(max_examples=60, deadline=None)
@given(
    values=st.lists(st.integers(min_value=-1_000, max_value=1_000), min_size=4, max_size=32),
    seed=st.integers(min_value=0, max_value=2**32),
    block_length=st.integers(min_value=1, max_value=6),
)
def test_bootstrap_interval_geometry_and_determinism(
    values: list[int],
    seed: int,
    block_length: int,
) -> None:
    series = tuple(make_ratio(value, 1_000) for value in values)
    spec = BootstrapSpecV1(
        seed=seed,
        block_length=block_length,
        replicates=64,
        coverage_per_myriad=9_500,
    )
    interval = block_bootstrap_interval(series, spec)
    assert interval == block_bootstrap_interval(series, spec)
    if interval.status is BootstrapStatus.AVAILABLE:
        assert interval.lower is not None
        assert interval.upper is not None
        assert interval.lower.mantissa <= interval.upper.mantissa
    else:
        assert interval.reason == "BLOCK_LONGER_THAN_SERIES"


@settings(max_examples=60, deadline=None)
@given(
    matrix=st.lists(
        st.lists(st.integers(min_value=-100, max_value=100), min_size=6, max_size=6),
        min_size=2,
        max_size=8,
    )
)
def test_pbo_stays_in_unit_range(matrix: list[list[int]]) -> None:
    rows = tuple(tuple(make_ratio(value, 100) for value in row) for row in matrix)
    report = pbo_cscv(rows)
    assert report.status is PboStatus.AVAILABLE
    assert report.split_count == comb(6, 3)
    assert report.pbo is not None
    assert 0 <= report.pbo.mantissa <= SCALE
    assert report == pbo_cscv(rows)


@settings(max_examples=80, deadline=None)
@given(
    returns=st.lists(st.integers(min_value=-500, max_value=500), min_size=20, max_size=64),
    trial_count=st.integers(min_value=1, max_value=1_000),
)
def test_dsr_is_gated_or_a_probability(returns: list[int], trial_count: int) -> None:
    inputs = DsrInputsV1(
        returns=tuple(make_ratio(value, 10_000) for value in returns),
        trial_count=trial_count,
        trial_sr_variance=make_ratio(1, 100),
    )
    report = deflated_sharpe_ratio(inputs)
    assert report == deflated_sharpe_ratio(inputs)
    if report.status is DsrStatus.AVAILABLE:
        assert report.dsr_probability is not None
        assert 0 <= report.dsr_probability.mantissa <= SCALE
    else:
        assert report.reason in (
            "VARIANCE_BELOW_RESOLUTION",
            "NON_POSITIVE_VARIANCE_ADJUSTMENT",
        )
