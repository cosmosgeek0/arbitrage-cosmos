"""Q14 negative-control transform law (§16.2)."""

from __future__ import annotations

import pytest
from q14_fixtures import make_sample_set, predictions_from_scores

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import QualityState
from quant_edge.validation.controls import (
    NegativeControlKind,
    activity_only_predictions,
    block_permuted_labels,
    falsify_lineage,
    future_leaked_predictions,
    inject_false_bursts,
    random_rank_predictions,
    shuffled_labels,
    stale_predictions,
    withhold_data,
)
from quant_edge.validation.samples import PredictionSetV1, PredictionV1, SampleSetV1

SEED = 20260712


def _predictions(samples: SampleSetV1) -> PredictionSetV1:
    return predictions_from_scores(
        samples,
        {
            sample.sample_id: make_ratio(index + 1, len(samples.samples) + 1)
            for index, sample in enumerate(samples.samples)
        },
    )


def test_negative_control_vocabulary_is_complete() -> None:
    assert {kind.value for kind in NegativeControlKind} == {
        "SHUFFLED_LABELS",
        "BLOCK_PERMUTED_LABELS",
        "STALE_PREDICTIONS",
        "FUTURE_VALUE_INJECTION",
        "RANDOM_RANK",
        "ACTIVITY_ONLY_BASELINE",
        "INCOMPLETE_DATA",
        "SYNTHETIC_FALSE_BURST",
        "COST_PERTURBATION",
    }


def test_shuffled_labels_permutes_and_preserves_multiset() -> None:
    samples = make_sample_set(24)
    shuffled = shuffled_labels(samples, seed=SEED)
    assert shuffled.dataset_id == "q14-test.shuffled-labels"
    original = [sample.binary_outcome for sample in samples.samples]
    permuted = [sample.binary_outcome for sample in shuffled.samples]
    assert sorted(map(bool, original)) == sorted(map(bool, permuted))
    assert original != permuted
    assert shuffled_labels(samples, seed=SEED).digest() == shuffled.digest()
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        shuffled_labels("nope", seed=SEED)  # type: ignore[arg-type]


def test_block_permuted_labels_stay_inside_blocks() -> None:
    samples = make_sample_set(10)
    permuted = block_permuted_labels(samples, seed=SEED, block_size=4)
    original = [sample.binary_outcome for sample in samples.samples]
    shuffled = [sample.binary_outcome for sample in permuted.samples]
    for start in range(0, 10, 4):
        assert sorted(map(bool, original[start : start + 4])) == sorted(
            map(bool, shuffled[start : start + 4])
        )
    with pytest.raises(ContractValueError, match="block_size"):
        block_permuted_labels(samples, seed=SEED, block_size=1)


def test_stale_predictions_shift_back_by_lag() -> None:
    samples = make_sample_set(6)
    predictions = _predictions(samples)
    stale = stale_predictions(samples, predictions, lag=2)
    assert stale.model_id == "test-model.stale-2"
    ordered = samples.samples
    for index, sample in enumerate(ordered):
        source = ordered[max(index - 2, 0)]
        assert (
            stale.score_for(sample.sample_id).score == predictions.score_for(source.sample_id).score
        )
    with pytest.raises(ContractValueError, match="PredictionSetV1"):
        stale_predictions(samples, "nope", lag=1)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="different sample set"):
        stale_predictions(make_sample_set(6, dataset_id="other"), predictions, lag=1)
    with pytest.raises(ContractValueError, match="lag"):
        stale_predictions(samples, predictions, lag=6)
    foreign = PredictionSetV1(
        model_id="m",
        dataset_digest=samples.digest(),
        predictions=tuple(
            PredictionV1(
                sample_id=f"x-{index:04d}",
                score=make_ratio(1, 2),
                max_feature_asof_ns=samples.samples[0].cutoff_ns,
            )
            for index in range(6)
        ),
    )
    with pytest.raises(ContractValueError, match="missing prediction"):
        stale_predictions(samples, foreign, lag=1)


def test_future_leak_carries_true_lineage() -> None:
    samples = make_sample_set(8)
    leaked = future_leaked_predictions(samples, model_id="leak")
    for sample in samples.samples:
        prediction = leaked.score_for(sample.sample_id)
        assert prediction.max_feature_asof_ns == sample.label_end_ns
        expected = 1 if sample.binary_outcome else 0
        assert prediction.score == make_ratio(expected, 1)
    forged = falsify_lineage(leaked, samples)
    assert forged.model_id == "leak.falsified-lineage"
    for sample in samples.samples:
        assert forged.score_for(sample.sample_id).max_feature_asof_ns == sample.cutoff_ns
    with pytest.raises(ContractValueError, match="PredictionSetV1"):
        falsify_lineage("nope", samples)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="unknown sample id"):
        falsify_lineage(leaked, make_sample_set(4))


def test_random_rank_and_activity_only_baselines() -> None:
    samples = make_sample_set(8)
    random_rank = random_rank_predictions(samples, seed=SEED, model_id="random")
    assert random_rank.model_id == "random"
    assert random_rank_predictions(samples, seed=SEED, model_id="random") == random_rank
    for prediction in random_rank.predictions:
        assert 0 <= prediction.score.numerator < prediction.score.denominator

    activity = {
        sample.sample_id: make_ratio(index, 8) for index, sample in enumerate(samples.samples)
    }
    baseline = activity_only_predictions(samples, activity, model_id="activity")
    assert baseline.score_for("s-0003").score == make_ratio(3, 8)
    with pytest.raises(ContractValueError, match="activity"):
        activity_only_predictions(samples, "nope", model_id="activity")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="missing sample id"):
        activity_only_predictions(samples, {}, model_id="activity")


def test_withhold_data_marks_unknown_never_zero() -> None:
    samples = make_sample_set(40, gross_edge=make_ratio(3, 1000), base_cost=make_ratio(1, 1000))
    incomplete = withhold_data(samples, seed=SEED, missing_per_thousand=400)
    withheld = [
        sample for sample in incomplete.samples if sample.quality is QualityState.UNAVAILABLE
    ]
    kept = [
        sample for sample in incomplete.samples if sample.quality is not QualityState.UNAVAILABLE
    ]
    assert withheld
    assert kept
    for sample in withheld:
        assert sample.binary_outcome is None
        assert sample.gross_edge_ratio is None
    with pytest.raises(ContractValueError, match="missing_per_thousand"):
        withhold_data(samples, seed=SEED, missing_per_thousand=0)


def test_inject_false_bursts_targets_true_negatives_only() -> None:
    samples = make_sample_set(40, gross_edge=make_ratio(1, 1000))
    burst_edge = make_ratio(5, 100)
    bursty = inject_false_bursts(
        samples, seed=SEED, burst_per_thousand=500, burst_gross_edge=burst_edge
    )
    changed = [
        (original, mutated)
        for original, mutated in zip(samples.samples, bursty.samples, strict=True)
        if mutated.gross_edge_ratio == burst_edge
    ]
    assert changed
    for _, mutated in changed:
        assert mutated.binary_outcome is False
    for original, mutated in zip(samples.samples, bursty.samples, strict=True):
        if mutated.gross_edge_ratio != burst_edge:
            assert mutated == original
    with pytest.raises(ContractValueError, match="burst_per_thousand"):
        inject_false_bursts(samples, seed=SEED, burst_per_thousand=0, burst_gross_edge=burst_edge)
    with pytest.raises(ContractValueError, match="burst_gross_edge"):
        inject_false_bursts(
            samples, seed=SEED, burst_per_thousand=10, burst_gross_edge=make_ratio(-1, 100)
        )
