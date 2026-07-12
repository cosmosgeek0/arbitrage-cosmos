"""Q14 walk-forward splitting, purge/embargo/group law and the untouched holdout."""

from __future__ import annotations

from dataclasses import replace

import pytest
from q14_fixtures import HOUR_NS, make_sample, make_sample_set

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture
from quant_edge.validation.samples import SampleSetV1
from quant_edge.validation.splits import (
    FoldStatus,
    HoldoutGrantV1,
    PlanStatus,
    SplitScheme,
    WalkForwardSpecV1,
    build_walk_forward_plan,
    open_holdout,
    ratio_at_least_one,
)

HALF_HOUR_NS = HOUR_NS // 2


def _spec(**overrides: object) -> WalkForwardSpecV1:
    base = WalkForwardSpecV1(
        scheme=SplitScheme.EXPANDING,
        fold_count=4,
        max_label_horizon_ns=HOUR_NS,
        max_feature_lookback_ns=HOUR_NS,
        embargo_ns=2 * HOUR_NS,
        min_train_size=4,
        holdout_fraction=make_ratio(1, 5),
        rolling_train_size=None,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def test_spec_contract_law() -> None:
    with pytest.raises(ContractValueError, match="scheme"):
        _spec(scheme="EXPANDING")
    with pytest.raises(ContractValueError, match="fold_count"):
        _spec(fold_count=0)
    with pytest.raises(ContractValueError, match="fold_count"):
        _spec(fold_count=65)
    with pytest.raises(ContractValueError, match="embargo"):
        _spec(embargo_ns=2 * HOUR_NS - 1)
    with pytest.raises(ContractValueError, match="holdout_fraction"):
        _spec(holdout_fraction=0.2)
    with pytest.raises(ContractValueError, match="0, 1"):
        _spec(holdout_fraction=make_ratio(-1, 5))
    with pytest.raises(ContractValueError, match="0, 1"):
        _spec(holdout_fraction=make_ratio(1, 1))
    with pytest.raises(ContractValueError, match="requires rolling_train_size"):
        _spec(scheme=SplitScheme.ROLLING)
    with pytest.raises(ContractValueError, match="rolling_train_size"):
        _spec(scheme=SplitScheme.ROLLING, rolling_train_size=3)
    with pytest.raises(ContractValueError, match="forbids rolling_train_size"):
        _spec(rolling_train_size=8)
    mapping = _spec().as_mapping()
    assert mapping["scheme"] == "EXPANDING"
    assert mapping["embargoNs"] == str(2 * HOUR_NS)


def test_ratio_at_least_one() -> None:
    assert ratio_at_least_one(make_ratio(3, 2))
    assert not ratio_at_least_one(make_ratio(1, 2))


def test_plan_shape_and_untouched_holdout() -> None:
    samples = make_sample_set(60)
    plan = build_walk_forward_plan(samples, _spec())
    assert plan.status is PlanStatus.VALID
    assert len(plan.folds) == 4
    assert len(plan.holdout_sample_ids) == 12
    assert plan.dataset_digest == samples.digest()

    holdout = set(plan.holdout_sample_ids)
    fold_members: set[str] = set()
    for fold in plan.folds:
        fold_members.update(fold.train_sample_ids)
        fold_members.update(fold.validation_sample_ids)
        assert fold.status is FoldStatus.VALID
    assert not fold_members & holdout
    assert holdout == set(samples.sample_ids[-12:])
    mapping = plan.as_mapping()
    assert mapping["schema"] == "Q14WalkForwardPlanV1"


def test_purge_embargo_and_group_law() -> None:
    samples = []
    for index in range(24):
        group = "g-shared" if index in (5, 12) else f"g-{index:04d}"
        samples.append(
            make_sample(index, outcome=index % 3 == 0, group_id=group, horizon_ns=HOUR_NS + 1)
        )
    sample_set = SampleSetV1(
        dataset_id="purge-law",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(samples),
    )
    spec = _spec(
        fold_count=2,
        max_label_horizon_ns=2 * HOUR_NS,
        embargo_ns=3 * HOUR_NS,
        min_train_size=1,
        holdout_fraction=make_ratio(0, 1),
    )
    plan = build_walk_forward_plan(sample_set, spec)
    assert plan.holdout_sample_ids == ()
    for fold in plan.folds:
        validation_start = min(
            sample_set.by_id(sample_id).cutoff_ns for sample_id in fold.validation_sample_ids
        )
        validation_groups = {
            sample_set.by_id(sample_id).group_id for sample_id in fold.validation_sample_ids
        }
        for train_id in fold.train_sample_ids:
            train_sample = sample_set.by_id(train_id)
            assert train_sample.label_end_ns < validation_start - spec.embargo_ns
            assert train_sample.group_id not in validation_groups
    with_conflicts = [fold for fold in plan.folds if fold.group_conflict_count]
    assert with_conflicts, "the shared group must be excluded from some fold's train set"
    assert any(fold.purged_count for fold in plan.folds)
    assert any(fold.embargoed_count for fold in plan.folds)


def test_rolling_scheme_trims_train_window() -> None:
    samples = make_sample_set(40)
    spec = _spec(
        scheme=SplitScheme.ROLLING,
        rolling_train_size=5,
        min_train_size=4,
        holdout_fraction=make_ratio(0, 1),
    )
    plan = build_walk_forward_plan(samples, spec)
    assert plan.status is PlanStatus.VALID
    late_folds = [fold for fold in plan.folds if fold.rolling_trimmed_count]
    assert late_folds
    for fold in late_folds:
        assert len(fold.train_sample_ids) == 5


def test_insufficient_train_marks_fold_and_plan_invalid() -> None:
    samples = make_sample_set(12)
    spec = _spec(fold_count=2, min_train_size=30, holdout_fraction=make_ratio(0, 1))
    plan = build_walk_forward_plan(samples, spec)
    assert plan.status is PlanStatus.INVALID_FOLD
    assert plan.folds[0].status is FoldStatus.INVALID_INSUFFICIENT_TRAIN


def test_group_straddling_holdout_boundary_is_quarantined() -> None:
    samples = []
    for index in range(20):
        group = "g-straddle" if index in (15, 17) else f"g-{index:04d}"
        samples.append(make_sample(index, outcome=index % 3 == 0, group_id=group))
    sample_set = SampleSetV1(
        dataset_id="straddle",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(samples),
    )
    spec = _spec(fold_count=2, min_train_size=2, holdout_fraction=make_ratio(1, 5))
    plan = build_walk_forward_plan(sample_set, spec)
    assert plan.holdout_sample_ids == tuple(f"s-{index:04d}" for index in range(16, 20))
    assert plan.quarantined_sample_ids == ("s-0015",)
    fold_members = {
        sample_id
        for fold in plan.folds
        for sample_id in fold.train_sample_ids + fold.validation_sample_ids
    }
    assert "s-0015" not in fold_members


def test_plan_input_contract_law() -> None:
    samples = make_sample_set(30)
    spec = _spec()
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        build_walk_forward_plan("nope", spec)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="WalkForwardSpecV1"):
        build_walk_forward_plan(samples, "nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="declared maximum label horizon"):
        build_walk_forward_plan(samples, _spec(max_label_horizon_ns=HALF_HOUR_NS - 1))
    with pytest.raises(ContractValueError, match="fold_count"):
        build_walk_forward_plan(make_sample_set(4), _spec(holdout_fraction=make_ratio(0, 1)))


def test_holdout_grant_law() -> None:
    samples = make_sample_set(30)
    plan = build_walk_forward_plan(samples, _spec())
    grant = HoldoutGrantV1(
        grant_id="grant-1",
        reason="final untouched evaluation of the declared primary metric",
        plan_digest=plan.digest(),
    )
    holdout = open_holdout(samples, plan, grant)
    assert tuple(sample.sample_id for sample in holdout) == plan.holdout_sample_ids
    assert grant.as_mapping()["grantId"] == "grant-1"

    with pytest.raises(ContractValueError, match="grant_id"):
        HoldoutGrantV1(grant_id="", reason="r", plan_digest=plan.digest())
    with pytest.raises(ContractValueError, match="reason"):
        HoldoutGrantV1(grant_id="g", reason="", plan_digest=plan.digest())
    with pytest.raises(ContractValueError, match="reason"):
        HoldoutGrantV1(grant_id="g", reason="x" * 401, plan_digest=plan.digest())
    with pytest.raises(ContractValueError, match="plan_digest"):
        HoldoutGrantV1(grant_id="g", reason="r", plan_digest="deadbeef")  # type: ignore[arg-type]

    with pytest.raises(ContractValueError, match="SampleSetV1"):
        open_holdout("nope", plan, grant)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="WalkForwardPlanV1"):
        open_holdout(samples, "nope", grant)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="HoldoutGrantV1"):
        open_holdout(samples, plan, "nope")  # type: ignore[arg-type]

    other_samples = make_sample_set(30, dataset_id="other")
    with pytest.raises(ContractValueError, match="different sample set"):
        open_holdout(other_samples, plan, grant)
    other_plan = build_walk_forward_plan(other_samples, _spec())
    with pytest.raises(ContractValueError, match="different plan"):
        open_holdout(other_samples, other_plan, grant)

    no_holdout_plan = build_walk_forward_plan(samples, _spec(holdout_fraction=make_ratio(0, 1)))
    empty_grant = HoldoutGrantV1(
        grant_id="grant-2",
        reason="attempt to open a plan without a holdout",
        plan_digest=no_holdout_plan.digest(),
    )
    with pytest.raises(ContractValueError, match="no holdout"):
        open_holdout(samples, no_holdout_plan, empty_grant)
