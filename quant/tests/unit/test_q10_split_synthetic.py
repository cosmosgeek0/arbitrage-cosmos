from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture
from quant_edge.models.contracts import TargetKind
from quant_edge.models.split import SPLIT_AUTHORITY, InternalChronologicalSplitV1
from quant_edge.models.synthetic import (
    BATTERY_FEATURE_SPECS,
    BATTERY_ROWS,
    RANK_GROUP_SIZE,
    TARGET_BINARY_ID,
    TARGET_QUANTILE_ID,
    TARGET_RANK_ID,
    TARGET_REGRESSION_ID,
    FeatureRole,
    SyntheticDatasetV1,
    SyntheticFeatureSpecV1,
    SyntheticTargetV1,
    battery_split,
    build_battery_dataset,
    require_learnable_binary,
)

SEED = 20260712


def test_split_partitions_rows_exactly() -> None:
    split = InternalChronologicalSplitV1(train_rows=4, embargo_rows=2, valid_rows=3, test_rows=5)
    indices = (
        list(split.train_indices)
        + list(split.embargo_indices)
        + list(split.valid_indices)
        + list(split.test_indices)
    )
    assert indices == list(range(14))
    assert split.total_rows == 14
    split.require_exact_cover(14)
    with pytest.raises(ContractValueError, match="cover the dataset rows exactly"):
        split.require_exact_cover(15)
    assert split.as_mapping()["authority"] == SPLIT_AUTHORITY


def test_split_bounds_fail_closed() -> None:
    with pytest.raises(ContractValueError, match="train_rows"):
        InternalChronologicalSplitV1(train_rows=1, embargo_rows=0, valid_rows=2, test_rows=2)
    with pytest.raises(ContractValueError, match="embargo_rows"):
        InternalChronologicalSplitV1(train_rows=2, embargo_rows=-1, valid_rows=2, test_rows=2)
    with pytest.raises(ContractValueError, match="row_count"):
        battery_split().require_exact_cover(0)


def test_battery_split_is_the_declared_partition() -> None:
    split = battery_split()
    assert (split.train_rows, split.embargo_rows, split.valid_rows, split.test_rows) == (
        400,
        16,
        96,
        128,
    )
    assert split.valid_rows % RANK_GROUP_SIZE == 0
    assert split.test_rows % RANK_GROUP_SIZE == 0


def test_feature_spec_direction_laws() -> None:
    with pytest.raises(ContractValueError, match="declare a direction"):
        SyntheticFeatureSpecV1("f", FeatureRole.PLANTED_MONOTONE_SIGNAL, 0)
    with pytest.raises(ContractValueError, match="must not declare"):
        SyntheticFeatureSpecV1("f", FeatureRole.NOISE, 1)
    with pytest.raises(ContractValueError, match="must not declare"):
        SyntheticFeatureSpecV1("f", FeatureRole.HETEROSCEDASTICITY_DRIVER, -1)
    with pytest.raises(ContractValueError, match="monotone_direction"):
        SyntheticFeatureSpecV1("f", FeatureRole.NOISE, 2)
    with pytest.raises(ContractValueError, match="FeatureRole"):
        SyntheticFeatureSpecV1("f", "NOISE", 0)  # type: ignore[arg-type]
    spec = SyntheticFeatureSpecV1("f", FeatureRole.LIQUIDITY_PROXY, 0)
    assert spec.as_mapping()["role"] == "LIQUIDITY_PROXY"


def test_target_laws() -> None:
    with pytest.raises(ContractValueError, match="binary labels"):
        SyntheticTargetV1("t:v1", TargetKind.BINARY, (0, 2), None)
    with pytest.raises(ContractValueError, match="group size"):
        SyntheticTargetV1("t:v1", TargetKind.RANK, (0, 1), None)
    with pytest.raises(ContractValueError, match="whole groups"):
        SyntheticTargetV1("t:v1", TargetKind.RANK, (0, 1, 2), 2)
    with pytest.raises(ContractValueError, match="grade range"):
        SyntheticTargetV1("t:v1", TargetKind.RANK, (0, 9), 2)
    with pytest.raises(ContractValueError, match="only for rank targets"):
        SyntheticTargetV1("t:v1", TargetKind.REGRESSION, (0, 1), 2)
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        SyntheticTargetV1("t:v1", TargetKind.REGRESSION, (), None)
    with pytest.raises(ContractValueError, match="TargetKind"):
        SyntheticTargetV1("t:v1", "BINARY", (0, 1), None)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match=r"labels\[0\]"):
        SyntheticTargetV1("t:v1", TargetKind.REGRESSION, (10**10,), None)
    rank = SyntheticTargetV1("t:v1", TargetKind.RANK, (0, 3), 2)
    assert rank.require_group_size() == 2
    plain = SyntheticTargetV1("t:v1", TargetKind.REGRESSION, (5, -5), None)
    with pytest.raises(ContractValueError, match="declare a group size"):
        plain.require_group_size()
    assert plain.as_mapping()["labels"] == ["5", "-5"]


def _tiny_dataset() -> SyntheticDatasetV1:
    features = (
        SyntheticFeatureSpecV1("a", FeatureRole.NOISE, 0),
        SyntheticFeatureSpecV1("b", FeatureRole.LIQUIDITY_PROXY, 0),
    )
    rows = tuple((index, index * 2) for index in range(4))
    target = SyntheticTargetV1("t:v1", TargetKind.REGRESSION, (1, 2, 3, 4), None)
    return SyntheticDatasetV1(
        dataset_id="tiny:v1",
        posture=EvidencePosture.SYNTHETIC,
        features=features,
        rows=rows,
        targets=(target,),
    )


def test_dataset_laws() -> None:
    dataset = _tiny_dataset()
    assert dataset.feature_index("b") == 1
    assert dataset.target("t:v1").target_id == "t:v1"
    with pytest.raises(ContractValueError, match="unknown feature"):
        dataset.feature_index("missing")
    with pytest.raises(ContractValueError, match="unknown target"):
        dataset.target("missing:v1")
    summary = dataset.summary_mapping()
    assert summary["rowCount"] == 4
    assert summary["contentSha256"] == dataset.content_digest.hexdigest

    with pytest.raises(ContractValueError, match="SYNTHETIC only"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.LIVE,
            features=dataset.features,
            rows=dataset.rows,
            targets=dataset.targets,
        )
    with pytest.raises(ContractValueError, match="at least four"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=dataset.rows[:2],
            targets=dataset.targets,
        )
    with pytest.raises(ContractValueError, match="feature width"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=((1,), (2,), (3,), (4,)),
            targets=dataset.targets,
        )
    with pytest.raises(ContractValueError, match="feature ids must be unique"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=(dataset.features[0], dataset.features[0]),
            rows=dataset.rows,
            targets=dataset.targets,
        )
    with pytest.raises(ContractValueError, match="target ids must be unique"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=dataset.rows,
            targets=(dataset.targets[0], dataset.targets[0]),
        )
    with pytest.raises(ContractValueError, match="cover every row"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=dataset.rows,
            targets=(SyntheticTargetV1("t:v1", TargetKind.REGRESSION, (1, 2), None),),
        )
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=(),
            rows=dataset.rows,
            targets=dataset.targets,
        )
    with pytest.raises(ContractValueError, match="targets must be a non-empty tuple"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=dataset.rows,
            targets=(),
        )
    with pytest.raises(ContractValueError, match=r"rows\[0\]\[0\]"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=((10**10, 1), (1, 2), (2, 3), (3, 4)),
            targets=dataset.targets,
        )
    with pytest.raises(ContractValueError, match="at least four"):
        SyntheticDatasetV1(
            dataset_id="tiny:v1",
            posture=EvidencePosture.SYNTHETIC,
            features=dataset.features,
            rows=[],  # type: ignore[arg-type]
            targets=dataset.targets,
        )


def test_battery_dataset_is_deterministic_and_complete() -> None:
    first = build_battery_dataset(SEED)
    second = build_battery_dataset(SEED)
    assert first.content_digest == second.content_digest
    assert len(first.rows) == BATTERY_ROWS
    assert first.features == BATTERY_FEATURE_SPECS
    target_ids = [target.target_id for target in first.targets]
    assert target_ids == [
        TARGET_BINARY_ID,
        TARGET_REGRESSION_ID,
        TARGET_QUANTILE_ID,
        TARGET_RANK_ID,
    ]
    assert first.target(TARGET_QUANTILE_ID).labels == first.target(TARGET_REGRESSION_ID).labels
    assert first.target(TARGET_RANK_ID).group_size == RANK_GROUP_SIZE
    different = build_battery_dataset(SEED + 1)
    assert different.content_digest != first.content_digest


def test_learnable_binary_guard_fails_closed() -> None:
    split = InternalChronologicalSplitV1(train_rows=2, embargo_rows=0, valid_rows=2, test_rows=2)
    with pytest.raises(ContractValueError, match="train slice"):
        require_learnable_binary((0, 0, 0, 1, 0, 1), split)
    with pytest.raises(ContractValueError, match="valid slice"):
        require_learnable_binary((0, 1, 1, 1, 0, 1), split)
    with pytest.raises(ContractValueError, match="test slice"):
        require_learnable_binary((0, 1, 0, 1, 1, 1), split)
    require_learnable_binary((0, 1, 0, 1, 0, 1), split)
