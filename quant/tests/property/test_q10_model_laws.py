"""Deterministic multi-seed model laws: planted-direction monotonicity holds.

These are seeded fitting laws rather than Hypothesis properties because each
example costs a model fit; the seeds are fixed and the assertions exact.
"""

from __future__ import annotations

from itertools import pairwise

import pytest

from quant_edge.models.synthetic import build_battery_dataset

engine = pytest.importorskip("quant_edge.models.engine", reason="Q10 models extra not installed")
estimators = pytest.importorskip(
    "quant_edge.models.estimators", reason="Q10 models extra not installed"
)

PARAMS = engine.BoostParams(max_depth=4, n_estimators=60, learning_rate="0.1", min_child_weight=2)


@pytest.mark.parametrize("seed", [20260712, 20260713])
def test_constrained_classifier_is_monotone_in_planted_direction(seed: int) -> None:
    dataset = build_battery_dataset(seed)
    target = dataset.target("transition_binary:v1")
    monotone = estimators.monotone_vector(dataset, {"lin_primary": 1, "lin_secondary": 1})
    column = dataset.feature_index("lin_primary")
    base_row = dataset.rows[0]
    probe_rows = tuple(
        tuple(step if index == column else value for index, value in enumerate(base_row))
        for step in range(-100, 101, 20)
    )
    train_count = 400
    rows = probe_rows + dataset.rows[:train_count]
    labels = (0,) * len(probe_rows) + target.labels[:train_count]
    scores = engine.xgb_classifier_scores(
        rows,
        labels,
        range(len(probe_rows), len(probe_rows) + train_count),
        range(0, len(probe_rows)),
        params=PARAMS,
        monotone=monotone,
    )
    assert all(later >= earlier for earlier, later in pairwise(scores))


@pytest.mark.parametrize("seed", [20260712, 20260713])
def test_constrained_ranker_is_monotone_in_planted_direction(seed: int) -> None:
    dataset = build_battery_dataset(seed)
    target = dataset.target("attention_rank:v1")
    monotone = estimators.monotone_vector(dataset, {"activity_proxy": 1, "lin_primary": 1})
    column = dataset.feature_index("lin_primary")
    base_row = dataset.rows[1]
    # exactly one whole ranker group of ascending lin_primary probes
    probe_rows = tuple(
        tuple(
            -100 + 13 * step if index == column else value for index, value in enumerate(base_row)
        )
        for step in range(target.require_group_size())
    )
    train_count = 400
    rows = probe_rows + dataset.rows[:train_count]
    labels = (0,) * len(probe_rows) + target.labels[:train_count]
    scores = engine.xgb_ranker_scores(
        rows,
        labels,
        range(len(probe_rows), len(probe_rows) + train_count),
        range(0, len(probe_rows)),
        params=PARAMS,
        monotone=monotone,
        group_size=target.require_group_size(),
    )
    assert all(later >= earlier for earlier, later in pairwise(scores))
