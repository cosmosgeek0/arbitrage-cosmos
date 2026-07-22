from __future__ import annotations

from itertools import pairwise

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.randomness import DeterministicRandom

engine = pytest.importorskip("quant_edge.models.engine", reason="Q10 models extra not installed")


def _rows(count: int, width: int, seed: int) -> tuple[tuple[int, ...], ...]:
    rng = DeterministicRandom.from_seed(seed)
    return tuple(tuple(int(rng.next_u64() % 201) - 100 for _ in range(width)) for _ in range(count))


def _binary_labels(rows: tuple[tuple[int, ...], ...], seed: int) -> tuple[int, ...]:
    rng = DeterministicRandom.from_seed(seed + 1)
    return tuple(1 if 30 * row[0] + int(rng.next_u64() % 2_001) - 1_000 > 0 else 0 for row in rows)


ROWS = _rows(120, 4, 7)
BINARY = _binary_labels(ROWS, 7)
LINEAR = tuple(3 * row[0] - 2 * row[1] + 5 for row in ROWS)
TRAIN = range(0, 80)
EVAL = range(80, 120)
PARAMS = engine.BoostParams(max_depth=3, n_estimators=40, learning_rate="0.1", min_child_weight=2)


def test_boost_params_learning_rate_law() -> None:
    assert PARAMS.learning_rate_value() == 0.1
    q10_profile = engine._q10_boost_common(PARAMS, None)
    assert q10_profile["tree_method"] == "exact"
    assert q10_profile["n_jobs"] == q10_profile["nthread"] == 1
    assert q10_profile["base_score"] == 0.5
    assert q10_profile["random_state"] == 7
    assert q10_profile["seed_per_iteration"] is False
    assert q10_profile["device"] == "cpu"
    assert q10_profile["subsample"] == q10_profile["colsample_bytree"] == 1.0
    assert engine._boost_common(PARAMS, None)["tree_method"] == "hist"
    with pytest.raises(ContractValueError, match="decimal string"):
        engine.BoostParams(3, 40, "fast", 2).learning_rate_value()
    with pytest.raises(ContractValueError, match=r"\(0, 1\]"):
        engine.BoostParams(3, 40, "0", 2).learning_rate_value()
    with pytest.raises(ContractValueError, match=r"\(0, 1\]"):
        engine.BoostParams(3, 40, "1.5", 2).learning_rate_value()


def test_logistic_scores_are_probabilities_and_deterministic() -> None:
    first = engine.logistic_scores(ROWS, BINARY, TRAIN, EVAL, elastic_net=False)
    second = engine.logistic_scores(ROWS, BINARY, TRAIN, EVAL, elastic_net=False)
    assert first == second
    assert len(first) == len(EVAL)
    assert all(0.0 <= score <= 1.0 for score in first)
    elastic = engine.logistic_scores(ROWS, BINARY, TRAIN, EVAL, elastic_net=True)
    assert elastic == engine.logistic_scores(ROWS, BINARY, TRAIN, EVAL, elastic_net=True)
    assert elastic != first


def test_logistic_handles_constant_columns_via_unit_scale() -> None:
    rows = tuple((row[0], 42, row[2], row[3]) for row in ROWS)
    scores = engine.logistic_scores(rows, BINARY, TRAIN, EVAL, elastic_net=False)
    assert all(0.0 <= score <= 1.0 for score in scores)


def test_linear_regression_recovers_planted_line() -> None:
    values = engine.linear_regression_values(ROWS, LINEAR, TRAIN, EVAL)
    residuals = [value - label for value, label in zip(values, LINEAR[80:], strict=True)]
    assert max(abs(residual) for residual in residuals) < 1e-6


def test_quantile_linear_values_are_ordered_on_average() -> None:
    vectors = engine.quantile_linear_values(ROWS, LINEAR, TRAIN, EVAL, quantiles=(0.25, 0.5, 0.75))
    assert len(vectors) == 3
    assert all(len(vector) == len(EVAL) for vector in vectors)
    mean_low = sum(vectors[0]) / len(EVAL)
    mean_high = sum(vectors[2]) / len(EVAL)
    assert mean_low <= mean_high


def test_xgb_classifier_deterministic_and_bounded() -> None:
    first = engine.xgb_classifier_scores(ROWS, BINARY, TRAIN, EVAL, params=PARAMS, monotone=None)
    second = engine.xgb_classifier_scores(ROWS, BINARY, TRAIN, EVAL, params=PARAMS, monotone=None)
    assert first == second
    assert all(0.0 < score < 1.0 for score in first)


def test_xgb_regressor_monotone_constraint_direction() -> None:
    monotone = (1, 0, 0, 0)
    values = engine.xgb_regressor_values(
        ROWS, LINEAR, TRAIN, EVAL, params=PARAMS, monotone=monotone
    )
    assert len(values) == len(EVAL)
    base_row = ROWS[0]
    probe_rows = tuple((step, *base_row[1:]) for step in range(-100, 101, 10))
    probe = engine.xgb_regressor_values(
        probe_rows + ROWS[:80],
        tuple(LINEAR[:1] * len(probe_rows)) + LINEAR[:80],
        range(len(probe_rows), len(probe_rows) + 80),
        range(0, len(probe_rows)),
        params=PARAMS,
        monotone=monotone,
    )
    assert all(later >= earlier for earlier, later in pairwise(probe))


def test_xgb_quantile_values_shape_law() -> None:
    vectors = engine.xgb_quantile_values(
        ROWS, LINEAR, TRAIN, EVAL, params=PARAMS, monotone=None, quantiles=(0.25, 0.5, 0.75)
    )
    assert len(vectors) == 3
    assert all(len(vector) == len(EVAL) for vector in vectors)
    with pytest.raises(ContractValueError, match="shape must match"):
        engine.xgb_quantile_values(
            ROWS, LINEAR, TRAIN, EVAL, params=PARAMS, monotone=None, quantiles=(0.5,)
        )


def test_xgb_ranker_group_alignment_law() -> None:
    grades = tuple(min(max(label // 100 + 1, 0), 3) for label in LINEAR)
    scores = engine.xgb_ranker_scores(
        ROWS, grades, TRAIN, EVAL, params=PARAMS, monotone=None, group_size=8
    )
    assert len(scores) == len(EVAL)
    with pytest.raises(ContractValueError, match="whole groups"):
        engine.xgb_ranker_scores(
            ROWS, grades, TRAIN, EVAL, params=PARAMS, monotone=None, group_size=7
        )


def test_isotonic_calibrate_bounds_and_monotonicity() -> None:
    fit_scores = tuple(index / 39 for index in range(40))
    fit_labels = tuple(0 if index < 20 else 1 for index in range(40))
    apply_scores = (0.05, 0.4, 0.6, 0.95, -1.0, 2.0)
    calibrated = engine.isotonic_calibrate(fit_scores, fit_labels, apply_scores)
    assert all(0.0 <= value <= 1.0 for value in calibrated)
    ordered = engine.isotonic_calibrate(fit_scores, fit_labels, tuple(sorted(apply_scores)))
    assert all(later >= earlier for earlier, later in pairwise(ordered))
    with pytest.raises(ContractValueError, match="align and be non-empty"):
        engine.isotonic_calibrate((0.5,), (1, 0), (0.5,))
    with pytest.raises(ContractValueError, match="align and be non-empty"):
        engine.isotonic_calibrate((), (), (0.5,))
