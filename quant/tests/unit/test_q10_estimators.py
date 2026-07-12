from __future__ import annotations

from typing import Any

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.models.contracts import ModelRole, TargetKind
from quant_edge.models.synthetic import (
    TARGET_BINARY_ID,
    TARGET_QUANTILE_ID,
    TARGET_RANK_ID,
    TARGET_REGRESSION_ID,
    battery_split,
    build_battery_dataset,
)

estimators = pytest.importorskip(
    "quant_edge.models.estimators", reason="Q10 models extra not installed"
)

SEED = 20260712
DATASET = build_battery_dataset(SEED)
SPLIT = battery_split()
EstimatorFamily = estimators.EstimatorFamily
EstimatorSpecV1 = estimators.EstimatorSpecV1


def spec(
    model_id: str,
    family: object,
    role: ModelRole,
    kind: TargetKind,
    params: tuple[tuple[str, int | str], ...] = (),
) -> Any:
    return EstimatorSpecV1(model_id, family, role, kind, params)


def test_spec_laws() -> None:
    with pytest.raises(ContractValueError, match="does not support"):
        spec("m:v1", EstimatorFamily.LOGISTIC, ModelRole.TRANSPARENT_BASELINE, TargetKind.RANK)
    with pytest.raises(ContractValueError, match="challengers"):
        spec("m:v1", EstimatorFamily.LOGISTIC, ModelRole.BOOSTED_CHALLENGER, TargetKind.BINARY)
    with pytest.raises(ContractValueError, match="challengers"):
        spec("m:v1", EstimatorFamily.XGB_CLASSIFIER, ModelRole.CONTROL, TargetKind.BINARY)
    with pytest.raises(ContractValueError, match="sorted by unique name"):
        spec(
            "m:v1",
            EstimatorFamily.LOGISTIC,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.BINARY,
            (("b", 1), ("a", 2)),
        )
    with pytest.raises(ContractValueError, match="EstimatorFamily"):
        EstimatorSpecV1("m:v1", "LOGISTIC", ModelRole.CONTROL, TargetKind.BINARY, ())
    with pytest.raises(ContractValueError, match="ModelRole"):
        EstimatorSpecV1("m:v1", EstimatorFamily.LOGISTIC, "CONTROL", TargetKind.BINARY, ())
    with pytest.raises(ContractValueError, match="TargetKind"):
        EstimatorSpecV1(
            "m:v1", EstimatorFamily.LOGISTIC, ModelRole.TRANSPARENT_BASELINE, "BINARY", ()
        )
    with pytest.raises(ContractValueError, match="params must be a tuple"):
        EstimatorSpecV1(
            "m:v1", EstimatorFamily.LOGISTIC, ModelRole.TRANSPARENT_BASELINE, TargetKind.BINARY, []
        )


def test_spec_param_accessors() -> None:
    built = spec(
        "m:v1",
        EstimatorFamily.XGB_CLASSIFIER,
        ModelRole.BOOSTED_CHALLENGER,
        TargetKind.BINARY,
        (("learning_rate", "0.1"), ("max_depth", 3), ("min_child_weight", 2), ("n_estimators", 10)),
    )
    assert built.int_param("max_depth") == 3
    assert built.str_param("learning_rate") == "0.1"
    with pytest.raises(ContractValueError, match="does not declare"):
        built.param("missing")
    with pytest.raises(ContractValueError, match="must be an integer"):
        built.int_param("learning_rate")
    with pytest.raises(ContractValueError, match="must be a string"):
        built.str_param("max_depth")
    params = estimators.boost_params_from_spec(built)
    assert (params.max_depth, params.n_estimators) == (3, 10)


def test_monotone_vector_laws() -> None:
    vector = estimators.monotone_vector(DATASET, {"lin_primary": 1, "activity_proxy": 1})
    assert vector[DATASET.feature_index("lin_primary")] == 1
    assert vector[DATASET.feature_index("activity_proxy")] == 1
    assert sum(abs(item) for item in vector) == 2
    with pytest.raises(ContractValueError, match="contradicts"):
        estimators.monotone_vector(DATASET, {"lin_primary": -1})
    with pytest.raises(ContractValueError, match="contradicts"):
        estimators.monotone_vector(DATASET, {"noise_a": 1})
    with pytest.raises(ContractValueError, match="-1 or \\+1"):
        estimators.monotone_vector(DATASET, {"lin_primary": 2})
    with pytest.raises(ContractValueError, match="unknown feature"):
        estimators.monotone_vector(DATASET, {"missing": 1})


def test_random_scores_deterministic_bounded() -> None:
    first = estimators.random_scores(SEED, 0, 16)
    second = estimators.random_scores(SEED, 0, 16)
    assert first == second
    assert estimators.random_scores(SEED, 1, 16) != first
    assert all(0.0 <= score < 1.0 for score in first)
    with pytest.raises(ContractValueError, match="positive"):
        estimators.random_scores(SEED, 0, 0)


def test_exact_train_quantile() -> None:
    labels = (5, 1, 3, 2, 4)
    assert estimators.exact_train_quantile(labels, level="0.25") == 2
    assert estimators.exact_train_quantile(labels, level="0.5") == 3
    assert estimators.exact_train_quantile(labels, level="0.75") == 4
    with pytest.raises(ContractValueError, match="unknown quantile level"):
        estimators.exact_train_quantile(labels, level="0.99")


def _outputs(built: object, target_id: str, indices: range) -> dict[str, tuple[float, ...]]:
    result = estimators.raw_outputs(
        built,
        DATASET,
        DATASET.target(target_id),
        SPLIT,
        indices,
        battery_seed=SEED,
        monotone=None,
    )
    assert isinstance(result, dict)
    return result


def test_pure_families_are_exact_constants() -> None:
    target = DATASET.target(TARGET_BINARY_ID)
    train_labels = tuple(target.labels[index] for index in SPLIT.train_indices)
    prevalence = _outputs(
        spec("no_trade:v1", EstimatorFamily.PREVALENCE, ModelRole.CONTROL, TargetKind.BINARY),
        TARGET_BINARY_ID,
        SPLIT.test_indices,
    )["score"]
    assert set(prevalence) == {sum(train_labels) / len(train_labels)}

    regression = DATASET.target(TARGET_REGRESSION_ID)
    train_values = tuple(regression.labels[index] for index in SPLIT.train_indices)
    mean = _outputs(
        spec("mean:v1", EstimatorFamily.TRAIN_MEAN, ModelRole.CONTROL, TargetKind.REGRESSION),
        TARGET_REGRESSION_ID,
        SPLIT.test_indices,
    )["score"]
    assert set(mean) == {sum(train_values) / len(train_values)}

    quantiles = _outputs(
        spec("quant:v1", EstimatorFamily.TRAIN_QUANTILE, ModelRole.CONTROL, TargetKind.QUANTILE),
        TARGET_QUANTILE_ID,
        SPLIT.test_indices,
    )
    for level in ("0.25", "0.5", "0.75"):
        expected = float(estimators.exact_train_quantile(train_values, level=level))
        assert set(quantiles[f"q{level}"]) == {expected}


def test_feature_ranker_reads_declared_proxy_column() -> None:
    scores = _outputs(
        spec(
            "activity_only:v1",
            EstimatorFamily.FEATURE_RANKER,
            ModelRole.TRANSPARENT_BASELINE,
            TargetKind.RANK,
            (("feature_id", "activity_proxy"),),
        ),
        TARGET_RANK_ID,
        SPLIT.test_indices,
    )["score"]
    column = DATASET.feature_index("activity_proxy")
    expected = tuple(float(DATASET.rows[index][column]) for index in SPLIT.test_indices)
    assert scores == expected
    with pytest.raises(ContractValueError, match="proxy-feature stand-ins"):
        _outputs(
            spec(
                "bad:v1",
                EstimatorFamily.FEATURE_RANKER,
                ModelRole.TRANSPARENT_BASELINE,
                TargetKind.RANK,
                (("feature_id", "lin_primary"),),
            ),
            TARGET_RANK_ID,
            SPLIT.test_indices,
        )


def test_raw_outputs_guards() -> None:
    with pytest.raises(ContractValueError, match="cannot score"):
        _outputs(
            spec(
                "m:v1", EstimatorFamily.LOGISTIC, ModelRole.TRANSPARENT_BASELINE, TargetKind.BINARY
            ),
            TARGET_REGRESSION_ID,
            SPLIT.test_indices,
        )
    with pytest.raises(ContractValueError, match="boosted challengers only"):
        estimators.raw_outputs(
            spec(
                "m:v1", EstimatorFamily.LOGISTIC, ModelRole.TRANSPARENT_BASELINE, TargetKind.BINARY
            ),
            DATASET,
            DATASET.target(TARGET_BINARY_ID),
            SPLIT,
            SPLIT.test_indices,
            battery_seed=SEED,
            monotone=(1,) * 10,
        )


def test_random_rank_family_uses_target_position() -> None:
    binary_scores = _outputs(
        spec("random_rank:v1", EstimatorFamily.RANDOM_RANK, ModelRole.CONTROL, TargetKind.BINARY),
        TARGET_BINARY_ID,
        SPLIT.test_indices,
    )["score"]
    rank_scores = _outputs(
        spec("random_rank:v1", EstimatorFamily.RANDOM_RANK, ModelRole.CONTROL, TargetKind.RANK),
        TARGET_RANK_ID,
        SPLIT.test_indices,
    )["score"]
    assert binary_scores != rank_scores
    assert binary_scores == estimators.random_scores(SEED, 0, len(SPLIT.test_indices))
    assert rank_scores == estimators.random_scores(SEED, 3, len(SPLIT.test_indices))
