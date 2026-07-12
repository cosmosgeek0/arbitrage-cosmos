"""Shared deterministic builders for the Q14 test suite (SYNTHETIC evidence only)."""

from __future__ import annotations

from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.validation.samples import (
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    ValidationSampleV1,
)

BASE_NS = 1_772_000_000_000_000_000
HOUR_NS = 3_600_000_000_000
HALF_HOUR_NS = HOUR_NS // 2


def make_sample(
    index: int,
    *,
    outcome: bool | None,
    group_id: str | None = None,
    horizon_ns: int = HALF_HOUR_NS,
    gross_edge: ExactRatioV1 | None = None,
    base_cost: ExactRatioV1 | None = None,
    strata: tuple[tuple[str, str], ...] = (),
    quality: QualityState = QualityState.SYNTHETIC,
) -> ValidationSampleV1:
    return ValidationSampleV1(
        sample_id=f"s-{index:04d}",
        symbol="BNBUSDT",
        group_id=group_id if group_id is not None else f"g-{index:04d}",
        cutoff_ns=BASE_NS + index * HOUR_NS,
        label_end_ns=BASE_NS + index * HOUR_NS + horizon_ns,
        strata=strata,
        binary_outcome=outcome,
        gross_edge_ratio=gross_edge,
        base_cost_ratio=base_cost,
        quality=quality,
    )


def periodic_outcome(index: int) -> bool:
    return (index * 7) % 3 == 0


def make_sample_set(
    count: int,
    *,
    dataset_id: str = "q14-test",
    outcome_of: object = None,
    gross_edge: ExactRatioV1 | None = None,
    base_cost: ExactRatioV1 | None = None,
) -> SampleSetV1:
    samples = []
    for index in range(count):
        outcome = outcome_of(index) if callable(outcome_of) else periodic_outcome(index)
        samples.append(
            make_sample(index, outcome=outcome, gross_edge=gross_edge, base_cost=base_cost)
        )
    return SampleSetV1(
        dataset_id=dataset_id,
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(samples),
    )


def predictions_from_scores(
    samples: SampleSetV1,
    scores: dict[str, ExactRatioV1],
    *,
    model_id: str = "test-model",
) -> PredictionSetV1:
    rebuilt = tuple(
        PredictionV1(
            sample_id=sample.sample_id,
            score=scores[sample.sample_id],
            max_feature_asof_ns=sample.cutoff_ns,
        )
        for sample in sorted(samples.samples, key=lambda sample: sample.sample_id)
    )
    return PredictionSetV1(
        model_id=model_id,
        dataset_digest=samples.digest(),
        predictions=rebuilt,
    )


def informative_predictions(
    samples: SampleSetV1,
    *,
    model_id: str = "informative-model",
    positive_score: ExactRatioV1 | None = None,
    negative_score: ExactRatioV1 | None = None,
) -> PredictionSetV1:
    """Imperfect but skilled scores: positives high, negatives low, some overlap."""

    high = positive_score if positive_score is not None else make_ratio(7, 10)
    low = negative_score if negative_score is not None else make_ratio(3, 10)
    scores: dict[str, ExactRatioV1] = {}
    for position, sample in enumerate(samples.samples):
        noisy = position % 5 == 0
        if sample.binary_outcome:
            scores[sample.sample_id] = low if noisy else high
        else:
            scores[sample.sample_id] = high if noisy else low
    return predictions_from_scores(samples, scores, model_id=model_id)
