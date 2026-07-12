"""Q14 sample/prediction contract law."""

from __future__ import annotations

from dataclasses import replace

import pytest
from q14_fixtures import BASE_NS, HOUR_NS, make_sample, make_sample_set, predictions_from_scores

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.validation.samples import (
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    ValidationSampleV1,
    aligned_pairs,
    rebind_predictions,
)


def _sample(**overrides: object) -> ValidationSampleV1:
    base = make_sample(1, outcome=True, strata=(("liquidity", "mid"),))
    return replace(base, **overrides)  # type: ignore[arg-type]


def _scores(samples: SampleSetV1) -> PredictionSetV1:
    return predictions_from_scores(
        samples,
        {sample.sample_id: make_ratio(1, 2) for sample in samples.samples},
    )


def test_valid_sample_round_trips_mapping() -> None:
    sample = _sample()
    mapping = sample.as_mapping()
    assert mapping["sampleId"] == "s-0001"
    assert mapping["strata"] == {"liquidity": "mid"}
    assert mapping["binaryOutcome"] is True
    assert sample.label_horizon_ns == sample.label_end_ns - sample.cutoff_ns


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sample_id", "bad id"),
        ("symbol", ""),
        ("group_id", "x" * 200),
    ],
)
def test_sample_identity_law(field: str, value: str) -> None:
    with pytest.raises(ContractValueError):
        _sample(**{field: value})


def test_label_interval_must_follow_cutoff() -> None:
    with pytest.raises(ContractValueError, match="label interval"):
        _sample(label_end_ns=BASE_NS + HOUR_NS)


@pytest.mark.parametrize(
    "strata",
    [
        [("liquidity", "mid")],
        (("liquidity", "mid"),) * 9,
        (("liquidity",),),
        (("Liquidity!", "mid"),),
        (("liquidity", "mid mid"),),
        (("b", "1"), ("a", "1")),
        (("a", "1"), ("a", "2")),
    ],
)
def test_sample_strata_law(strata: object) -> None:
    with pytest.raises(ContractValueError):
        _sample(strata=strata)


def test_sample_outcome_edge_and_quality_law() -> None:
    with pytest.raises(ContractValueError, match="binary_outcome"):
        _sample(binary_outcome=1)
    with pytest.raises(ContractValueError, match="quality"):
        _sample(quality="COMPLETE")
    with pytest.raises(ContractValueError, match="gross_edge_ratio"):
        _sample(gross_edge_ratio=0.25)
    with pytest.raises(ContractValueError, match="base_cost_ratio"):
        _sample(base_cost_ratio="1/2")


def test_sample_set_digest_lookup_and_horizon() -> None:
    samples = make_sample_set(6)
    assert samples.digest() == samples.digest()
    assert samples.sample_ids == tuple(f"s-{index:04d}" for index in range(6))
    assert samples.max_label_horizon_ns == HOUR_NS // 2
    assert samples.by_id("s-0002").sample_id == "s-0002"
    with pytest.raises(ContractValueError, match="unknown sample id"):
        samples.by_id("s-9999")


def test_sample_set_identity_and_shape_law() -> None:
    samples = make_sample_set(3)
    with pytest.raises(ContractValueError, match="dataset_id"):
        SampleSetV1(dataset_id="", posture=samples.posture, samples=samples.samples)
    with pytest.raises(ContractValueError, match="posture"):
        SampleSetV1(dataset_id="d", posture="SYNTHETIC", samples=samples.samples)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        SampleSetV1(dataset_id="d", posture=samples.posture, samples=())
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        SampleSetV1(dataset_id="d", posture=samples.posture, samples=list(samples.samples))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="ValidationSampleV1"):
        SampleSetV1(dataset_id="d", posture=samples.posture, samples=(1, 2))  # type: ignore[arg-type]


def test_sample_set_bound_law(monkeypatch: pytest.MonkeyPatch) -> None:
    import quant_edge.validation.samples as samples_module

    tail = make_sample_set(3).samples
    monkeypatch.setattr(samples_module, "MAX_SAMPLES", 2)
    with pytest.raises(ContractValueError, match="MAX_SAMPLES"):
        SampleSetV1(dataset_id="d", posture=EvidencePosture.SYNTHETIC, samples=tail)


def test_sample_set_order_and_duplicate_law() -> None:
    first = make_sample(0, outcome=True)
    second = make_sample(1, outcome=False)
    duplicate_later = replace(second, sample_id="s-0000")
    with pytest.raises(ContractValueError, match="duplicate sample id"):
        SampleSetV1(
            dataset_id="d",
            posture=EvidencePosture.SYNTHETIC,
            samples=(first, duplicate_later),
        )
    with pytest.raises(ContractValueError, match="sorted"):
        SampleSetV1(
            dataset_id="d",
            posture=EvidencePosture.SYNTHETIC,
            samples=(second, first),
        )


def test_prediction_contracts() -> None:
    with pytest.raises(ContractValueError, match="sample_id"):
        PredictionV1(sample_id="", score=make_ratio(1, 2), max_feature_asof_ns=BASE_NS)
    with pytest.raises(ContractValueError, match="score"):
        PredictionV1(sample_id="s-1", score=0.5, max_feature_asof_ns=BASE_NS)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="max_feature_asof_ns"):
        PredictionV1(sample_id="s-1", score=make_ratio(1, 2), max_feature_asof_ns=-1)
    prediction = PredictionV1(sample_id="s-1", score=make_ratio(1, 2), max_feature_asof_ns=BASE_NS)
    assert prediction.as_mapping()["maxFeatureAsofNs"] == str(BASE_NS)


def test_prediction_set_law() -> None:
    samples = make_sample_set(3)
    predictions = _scores(samples)
    assert predictions.score_for("s-0001").sample_id == "s-0001"
    assert predictions.as_mapping()["schema"] == "Q14PredictionSetV1"
    assert predictions.digest() == predictions.digest()
    with pytest.raises(ContractValueError, match="no prediction"):
        predictions.score_for("s-9999")
    with pytest.raises(ContractValueError, match="model_id"):
        PredictionSetV1(
            model_id="",
            dataset_digest=samples.digest(),
            predictions=predictions.predictions,
        )
    with pytest.raises(ContractValueError, match="dataset_digest"):
        PredictionSetV1(
            model_id="m",
            dataset_digest="deadbeef",  # type: ignore[arg-type]
            predictions=predictions.predictions,
        )
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        PredictionSetV1(model_id="m", dataset_digest=samples.digest(), predictions=())
    with pytest.raises(ContractValueError, match="PredictionV1"):
        PredictionSetV1(model_id="m", dataset_digest=samples.digest(), predictions=(1,))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="sorted"):
        PredictionSetV1(
            model_id="m",
            dataset_digest=samples.digest(),
            predictions=tuple(reversed(predictions.predictions)),
        )


def test_prediction_set_bound_law(monkeypatch: pytest.MonkeyPatch) -> None:
    import quant_edge.validation.samples as samples_module

    samples = make_sample_set(3)
    predictions = _scores(samples)
    monkeypatch.setattr(samples_module, "MAX_SAMPLES", 2)
    with pytest.raises(ContractValueError, match="MAX_SAMPLES"):
        PredictionSetV1(
            model_id="m",
            dataset_digest=samples.digest(),
            predictions=predictions.predictions,
        )


def test_aligned_pairs_law() -> None:
    samples = make_sample_set(4)
    predictions = _scores(samples)
    pairs = aligned_pairs(samples, predictions)
    assert [sample.sample_id for sample, _ in pairs] == list(samples.sample_ids)
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        aligned_pairs("nope", predictions)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="PredictionSetV1"):
        aligned_pairs(samples, "nope")  # type: ignore[arg-type]
    other = make_sample_set(4, dataset_id="other")
    with pytest.raises(ContractValueError, match="different sample set"):
        aligned_pairs(other, predictions)


def test_alignment_requires_exactly_the_sample_ids() -> None:
    samples = make_sample_set(3)
    foreign_predictions = tuple(
        PredictionV1(
            sample_id=f"x-{index:04d}",
            score=make_ratio(1, 2),
            max_feature_asof_ns=BASE_NS,
        )
        for index in range(3)
    )
    foreign = PredictionSetV1(
        model_id="m",
        dataset_digest=samples.digest(),
        predictions=foreign_predictions,
    )
    with pytest.raises(ContractValueError, match="missing prediction"):
        aligned_pairs(samples, foreign)
    shorter = PredictionSetV1(
        model_id="m",
        dataset_digest=samples.digest(),
        predictions=foreign_predictions[:2],
    )
    with pytest.raises(ContractValueError, match="counts differ"):
        aligned_pairs(samples, shorter)


def test_rebind_predictions_law() -> None:
    samples = make_sample_set(3)
    predictions = _scores(samples)
    relabeled = SampleSetV1(
        dataset_id="relabeled",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(
            replace(sample, binary_outcome=not sample.binary_outcome) for sample in samples.samples
        ),
    )
    rebound = rebind_predictions(predictions, relabeled)
    assert rebound.dataset_digest == relabeled.digest()
    assert rebound.predictions == predictions.predictions
    with pytest.raises(ContractValueError, match="PredictionSetV1"):
        rebind_predictions("nope", relabeled)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        rebind_predictions(predictions, "nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="do not match"):
        rebind_predictions(predictions, make_sample_set(4))


def test_unknown_quality_sample_keeps_unknown_truth() -> None:
    sample = make_sample(2, outcome=None, quality=QualityState.UNKNOWN)
    assert sample.binary_outcome is None
    assert sample.as_mapping()["quality"] == "UNKNOWN"
