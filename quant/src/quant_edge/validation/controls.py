"""Deterministic §16.2 negative-control transforms.

Every transform is a pure, seeded function over injected sample/prediction sets. The
future-value injection helper builds the deliberately leaked model: its predictions
equal the future outcome and honestly carry the label-interval end as their feature
as-of time, so the temporal audit must catch it. A falsified-lineage variant exists
solely so tests can prove the behavioral battery catches leaks whose declared lineage
lies.
"""

from __future__ import annotations

from dataclasses import replace
from enum import StrEnum

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import QualityState, require_strict_int
from quant_edge.randomness import DeterministicRandom
from quant_edge.validation.samples import (
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    ValidationSampleV1,
)

MAX_BLOCK_SIZE = 4_096
SCORE_DENOMINATOR = 1_000_000


class NegativeControlKind(StrEnum):
    SHUFFLED_LABELS = "SHUFFLED_LABELS"
    BLOCK_PERMUTED_LABELS = "BLOCK_PERMUTED_LABELS"
    STALE_PREDICTIONS = "STALE_PREDICTIONS"
    FUTURE_VALUE_INJECTION = "FUTURE_VALUE_INJECTION"
    RANDOM_RANK = "RANDOM_RANK"
    ACTIVITY_ONLY_BASELINE = "ACTIVITY_ONLY_BASELINE"
    INCOMPLETE_DATA = "INCOMPLETE_DATA"
    SYNTHETIC_FALSE_BURST = "SYNTHETIC_FALSE_BURST"
    COST_PERTURBATION = "COST_PERTURBATION"


def _require_samples(samples: object) -> SampleSetV1:
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    return samples


def _permutation(count: int, rng: DeterministicRandom) -> list[int]:
    """Deterministic Fisher-Yates permutation of ``range(count)``."""

    order = list(range(count))
    for index in range(count - 1, 0, -1):
        swap = rng.next_u64() % (index + 1)
        order[index], order[swap] = order[swap], order[index]
    return order


def _with_labels(
    samples: SampleSetV1,
    labels: list[bool | None],
    control_suffix: str,
) -> SampleSetV1:
    rebuilt = tuple(
        replace(sample, binary_outcome=label)
        for sample, label in zip(samples.samples, labels, strict=True)
    )
    return SampleSetV1(
        dataset_id=f"{samples.dataset_id}.{control_suffix}",
        posture=samples.posture,
        samples=rebuilt,
    )


def shuffled_labels(samples: SampleSetV1, *, seed: int) -> SampleSetV1:
    """Destroy the label/feature relationship by a seeded global permutation."""

    _require_samples(samples)
    rng = DeterministicRandom.from_seed(seed)
    labels = [sample.binary_outcome for sample in samples.samples]
    order = _permutation(len(labels), rng)
    return _with_labels(samples, [labels[index] for index in order], "shuffled-labels")


def block_permuted_labels(samples: SampleSetV1, *, seed: int, block_size: int) -> SampleSetV1:
    """Permute labels only inside chronological blocks of the declared size."""

    _require_samples(samples)
    require_strict_int(block_size, field="block_size", minimum=2, maximum=MAX_BLOCK_SIZE)
    rng = DeterministicRandom.from_seed(seed)
    labels = [sample.binary_outcome for sample in samples.samples]
    permuted: list[bool | None] = []
    for start in range(0, len(labels), block_size):
        block = labels[start : start + block_size]
        order = _permutation(len(block), rng)
        permuted.extend(block[index] for index in order)
    return _with_labels(samples, permuted, "block-permuted-labels")


def stale_predictions(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    lag: int,
) -> PredictionSetV1:
    """Shift scores back by ``lag`` chronological samples; genuine timing signal dies."""

    _require_samples(samples)
    if not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("predictions must be PredictionSetV1")
    if predictions.dataset_digest != samples.digest():
        raise ContractValueError("prediction set is bound to a different sample set")
    require_strict_int(lag, field="lag", minimum=1, maximum=len(samples.samples) - 1)
    by_id = {prediction.sample_id: prediction for prediction in predictions.predictions}
    rebuilt: list[PredictionV1] = []
    ordered = samples.samples
    for index, sample in enumerate(ordered):
        source = ordered[max(index - lag, 0)]
        origin = by_id.get(source.sample_id)
        if origin is None:
            raise ContractValueError(f"missing prediction for sample id: {source.sample_id}")
        rebuilt.append(
            PredictionV1(
                sample_id=sample.sample_id,
                score=origin.score,
                max_feature_asof_ns=origin.max_feature_asof_ns,
            )
        )
    rebuilt.sort(key=lambda prediction: prediction.sample_id)
    return PredictionSetV1(
        model_id=f"{predictions.model_id}.stale-{lag}",
        dataset_digest=predictions.dataset_digest,
        predictions=tuple(rebuilt),
    )


def future_leaked_predictions(samples: SampleSetV1, *, model_id: str) -> PredictionSetV1:
    """The deliberate leak: scores equal future outcomes, lineage tells the truth."""

    _require_samples(samples)
    rebuilt = tuple(
        PredictionV1(
            sample_id=sample.sample_id,
            score=make_ratio(1 if sample.binary_outcome else 0, 1),
            max_feature_asof_ns=sample.label_end_ns,
        )
        for sample in sorted(samples.samples, key=lambda sample: sample.sample_id)
    )
    return PredictionSetV1(
        model_id=model_id,
        dataset_digest=samples.digest(),
        predictions=rebuilt,
    )


def falsify_lineage(predictions: PredictionSetV1, samples: SampleSetV1) -> PredictionSetV1:
    """Adversarial fixture: forge every as-of time back to the sample cutoff.

    This exists only so tests can prove that a leak whose declared lineage lies is
    still rejected by the behavioral battery; it is not a production path.
    """

    _require_samples(samples)
    if not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("predictions must be PredictionSetV1")
    cutoff_by_id = {sample.sample_id: sample.cutoff_ns for sample in samples.samples}
    rebuilt: list[PredictionV1] = []
    for prediction in predictions.predictions:
        cutoff = cutoff_by_id.get(prediction.sample_id)
        if cutoff is None:
            raise ContractValueError(f"unknown sample id: {prediction.sample_id}")
        rebuilt.append(replace(prediction, max_feature_asof_ns=cutoff))
    return PredictionSetV1(
        model_id=f"{predictions.model_id}.falsified-lineage",
        dataset_digest=predictions.dataset_digest,
        predictions=tuple(rebuilt),
    )


def random_rank_predictions(
    samples: SampleSetV1,
    *,
    seed: int,
    model_id: str,
) -> PredictionSetV1:
    """Seeded no-skill baseline with scores in [0, 1)."""

    _require_samples(samples)
    rng = DeterministicRandom.from_seed(seed)
    rebuilt = tuple(
        PredictionV1(
            sample_id=sample.sample_id,
            score=make_ratio(int(rng.next_u64() % SCORE_DENOMINATOR), SCORE_DENOMINATOR),
            max_feature_asof_ns=sample.cutoff_ns,
        )
        for sample in sorted(samples.samples, key=lambda sample: sample.sample_id)
    )
    return PredictionSetV1(
        model_id=model_id,
        dataset_digest=samples.digest(),
        predictions=rebuilt,
    )


def activity_only_predictions(
    samples: SampleSetV1,
    activity: dict[str, ExactRatioV1],
    *,
    model_id: str,
) -> PredictionSetV1:
    """Baseline that ranks purely by a declared pre-cutoff activity column."""

    _require_samples(samples)
    if not isinstance(activity, dict):
        raise ContractValueError("activity must map sample ids to ExactRatioV1")
    rebuilt: list[PredictionV1] = []
    for sample in sorted(samples.samples, key=lambda sample: sample.sample_id):
        value = activity.get(sample.sample_id)
        if not isinstance(value, ExactRatioV1):
            raise ContractValueError(f"activity is missing sample id: {sample.sample_id}")
        rebuilt.append(
            PredictionV1(
                sample_id=sample.sample_id,
                score=value,
                max_feature_asof_ns=sample.cutoff_ns,
            )
        )
    return PredictionSetV1(
        model_id=model_id,
        dataset_digest=samples.digest(),
        predictions=tuple(rebuilt),
    )


def withhold_data(
    samples: SampleSetV1,
    *,
    seed: int,
    missing_per_thousand: int,
) -> SampleSetV1:
    """Intentionally incomplete data: seeded subset loses outcome and quality truth."""

    _require_samples(samples)
    require_strict_int(missing_per_thousand, field="missing_per_thousand", minimum=1, maximum=1_000)
    rng = DeterministicRandom.from_seed(seed)
    rebuilt: list[ValidationSampleV1] = []
    for sample in samples.samples:
        if rng.next_u64() % 1_000 < missing_per_thousand:
            rebuilt.append(
                replace(
                    sample,
                    binary_outcome=None,
                    gross_edge_ratio=None,
                    quality=QualityState.UNAVAILABLE,
                )
            )
        else:
            rebuilt.append(sample)
    return SampleSetV1(
        dataset_id=f"{samples.dataset_id}.incomplete",
        posture=samples.posture,
        samples=tuple(rebuilt),
    )


def inject_false_bursts(
    samples: SampleSetV1,
    *,
    seed: int,
    burst_per_thousand: int,
    burst_gross_edge: ExactRatioV1,
) -> SampleSetV1:
    """Synthetic false bursts: attractive gross edge on true-negative samples."""

    _require_samples(samples)
    require_strict_int(burst_per_thousand, field="burst_per_thousand", minimum=1, maximum=1_000)
    if not isinstance(burst_gross_edge, ExactRatioV1) or burst_gross_edge.is_negative:
        raise ContractValueError("burst_gross_edge must be a non-negative ExactRatioV1")
    rng = DeterministicRandom.from_seed(seed)
    rebuilt: list[ValidationSampleV1] = []
    for sample in samples.samples:
        selected = rng.next_u64() % 1_000 < burst_per_thousand
        if selected and sample.binary_outcome is False:
            rebuilt.append(replace(sample, gross_edge_ratio=burst_gross_edge))
        else:
            rebuilt.append(sample)
    return SampleSetV1(
        dataset_id=f"{samples.dataset_id}.false-burst",
        posture=samples.posture,
        samples=tuple(rebuilt),
    )
