"""Point-in-time sample and prediction contracts for the Q14 validation factory.

Validation operates only on injected, digest-bound sample and prediction sets. A
sample carries the identity, feature cutoff, dependent label interval and strata that
were knowable at the cutoff; a prediction carries its model identity and the declared
latest feature as-of time so temporal leakage is auditable. Unknown outcomes stay
unknown; nothing here reads ambient state.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    QualityState,
    require_contract_id,
    require_strict_int,
)

MAX_SAMPLES = 100_000
MAX_STRATA = 8


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_strata(value: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, tuple) or len(value) > MAX_STRATA:
        raise ContractValueError("strata must be a tuple of at most MAX_STRATA pairs")
    keys: list[str] = []
    for entry in value:
        if not isinstance(entry, tuple) or len(entry) != 2:
            raise ContractValueError("each stratum must be a (key, value) pair")
        key, stratum = entry
        require_contract_id(key, field="stratum key")
        require_contract_id(stratum, field="stratum value")
        keys.append(key)
    if sorted(keys) != keys or len(set(keys)) != len(keys):
        raise ContractValueError("stratum keys must be sorted and unique")
    return value


def _optional_ratio(value: object, *, field: str) -> ExactRatioV1 | None:
    if value is not None and not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1 or None")
    return value


@dataclass(frozen=True, slots=True)
class ValidationSampleV1:
    """One labeled research sample with point-in-time identity."""

    sample_id: str
    symbol: str
    group_id: str
    cutoff_ns: int
    label_end_ns: int
    strata: tuple[tuple[str, str], ...]
    binary_outcome: bool | None
    gross_edge_ratio: ExactRatioV1 | None
    base_cost_ratio: ExactRatioV1 | None
    quality: QualityState

    def __post_init__(self) -> None:
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.symbol, field="symbol")
        require_contract_id(self.group_id, field="group_id")
        cutoff = _require_ns(self.cutoff_ns, field="cutoff_ns")
        label_end = _require_ns(self.label_end_ns, field="label_end_ns")
        if label_end <= cutoff:
            raise ContractValueError("label interval must end strictly after the feature cutoff")
        _require_strata(self.strata)
        if self.binary_outcome is not None and not isinstance(self.binary_outcome, bool):
            raise ContractValueError("binary_outcome must be a boolean or None")
        _optional_ratio(self.gross_edge_ratio, field="gross_edge_ratio")
        _optional_ratio(self.base_cost_ratio, field="base_cost_ratio")
        if not isinstance(self.quality, QualityState):
            raise ContractValueError("quality must be a QualityState")

    @property
    def label_horizon_ns(self) -> int:
        return self.label_end_ns - self.cutoff_ns

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseCostRatio": _ratio_mapping(self.base_cost_ratio),
            "binaryOutcome": self.binary_outcome,
            "cutoffNs": str(self.cutoff_ns),
            "grossEdgeRatio": _ratio_mapping(self.gross_edge_ratio),
            "groupId": self.group_id,
            "labelEndNs": str(self.label_end_ns),
            "quality": self.quality.value,
            "sampleId": self.sample_id,
            "strata": dict(self.strata),
            "symbol": self.symbol,
        }


def _ratio_mapping(value: ExactRatioV1 | None) -> dict[str, object] | None:
    return None if value is None else value.as_mapping()


@dataclass(frozen=True, slots=True)
class SampleSetV1:
    """Bounded, chronologically sorted, digest-bound sample collection."""

    dataset_id: str
    posture: EvidencePosture
    samples: tuple[ValidationSampleV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.dataset_id, field="dataset_id")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be an EvidencePosture")
        if not isinstance(self.samples, tuple) or not self.samples:
            raise ContractValueError("samples must be a non-empty tuple")
        if len(self.samples) > MAX_SAMPLES:
            raise ContractValueError("sample count exceeds MAX_SAMPLES")
        seen: set[str] = set()
        previous: tuple[int, str] | None = None
        for sample in self.samples:
            if not isinstance(sample, ValidationSampleV1):
                raise ContractValueError("samples must contain ValidationSampleV1 entries")
            if sample.sample_id in seen:
                raise ContractValueError(f"duplicate sample id: {sample.sample_id}")
            seen.add(sample.sample_id)
            key = (sample.cutoff_ns, sample.sample_id)
            if previous is not None and key <= previous:
                raise ContractValueError("samples must be sorted by (cutoff_ns, sample_id)")
            previous = key

    @property
    def sample_ids(self) -> tuple[str, ...]:
        return tuple(sample.sample_id for sample in self.samples)

    @property
    def max_label_horizon_ns(self) -> int:
        return max(sample.label_horizon_ns for sample in self.samples)

    def by_id(self, sample_id: str) -> ValidationSampleV1:
        for sample in self.samples:
            if sample.sample_id == sample_id:
                return sample
        raise ContractValueError(f"unknown sample id: {sample_id}")

    def as_mapping(self) -> dict[str, object]:
        return {
            "datasetId": self.dataset_id,
            "posture": self.posture.value,
            "sampleCount": len(self.samples),
            "samples": [sample.as_mapping() for sample in self.samples],
            "schema": "Q14SampleSetV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


@dataclass(frozen=True, slots=True)
class PredictionV1:
    """One model score for one sample with declared temporal lineage."""

    sample_id: str
    score: ExactRatioV1
    max_feature_asof_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.sample_id, field="sample_id")
        if not isinstance(self.score, ExactRatioV1):
            raise ContractValueError("score must be ExactRatioV1")
        _require_ns(self.max_feature_asof_ns, field="max_feature_asof_ns")

    def as_mapping(self) -> dict[str, object]:
        return {
            "maxFeatureAsofNs": str(self.max_feature_asof_ns),
            "sampleId": self.sample_id,
            "score": self.score.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class PredictionSetV1:
    """Digest-bound predictions of one model over one sample set."""

    model_id: str
    dataset_digest: DigestV1
    predictions: tuple[PredictionV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.model_id, field="model_id")
        if not isinstance(self.dataset_digest, DigestV1):
            raise ContractValueError("dataset_digest must be DigestV1")
        if not isinstance(self.predictions, tuple) or not self.predictions:
            raise ContractValueError("predictions must be a non-empty tuple")
        if len(self.predictions) > MAX_SAMPLES:
            raise ContractValueError("prediction count exceeds MAX_SAMPLES")
        previous_id: str | None = None
        for prediction in self.predictions:
            if not isinstance(prediction, PredictionV1):
                raise ContractValueError("predictions must contain PredictionV1 entries")
            if previous_id is not None and prediction.sample_id <= previous_id:
                raise ContractValueError("predictions must be sorted by unique sample_id")
            previous_id = prediction.sample_id

    def score_for(self, sample_id: str) -> PredictionV1:
        for prediction in self.predictions:
            if prediction.sample_id == sample_id:
                return prediction
        raise ContractValueError(f"no prediction for sample id: {sample_id}")

    def as_mapping(self) -> dict[str, object]:
        return {
            "datasetDigest": self.dataset_digest.hexdigest,
            "modelId": self.model_id,
            "predictionCount": len(self.predictions),
            "predictions": [prediction.as_mapping() for prediction in self.predictions],
            "schema": "Q14PredictionSetV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def subset_by_ids(samples: SampleSetV1, ids: tuple[str, ...]) -> SampleSetV1:
    """Chronological subset of a sample set; unknown ids are loud."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(ids, tuple) or not ids:
        raise ContractValueError("ids must be a non-empty tuple")
    known = set(samples.sample_ids)
    missing = [sample_id for sample_id in ids if sample_id not in known]
    if missing:
        raise ContractValueError(f"unknown sample ids: {missing[:4]}")
    selected = set(ids)
    return SampleSetV1(
        dataset_id=f"{samples.dataset_id}.subset",
        posture=samples.posture,
        samples=tuple(sample for sample in samples.samples if sample.sample_id in selected),
    )


def restrict_predictions(
    predictions: PredictionSetV1,
    samples: SampleSetV1,
) -> PredictionSetV1:
    """Filter predictions down to a sample subset and rebind the digest."""

    if not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("predictions must be PredictionSetV1")
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    wanted = set(samples.sample_ids)
    kept = tuple(
        prediction for prediction in predictions.predictions if prediction.sample_id in wanted
    )
    if len(kept) != len(wanted):
        raise ContractValueError("predictions do not cover the sample subset")
    return PredictionSetV1(
        model_id=predictions.model_id,
        dataset_digest=samples.digest(),
        predictions=kept,
    )


def rebind_predictions(predictions: PredictionSetV1, samples: SampleSetV1) -> PredictionSetV1:
    """Rebind scores to a label-transformed variant carrying the same sample ids.

    Negative-control transforms change outcomes (and therefore the set digest) while
    keeping identities; this is the only lawful way to evaluate existing predictions
    against such a control set.
    """

    if not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("predictions must be PredictionSetV1")
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    prediction_ids = tuple(prediction.sample_id for prediction in predictions.predictions)
    if tuple(sorted(samples.sample_ids)) != prediction_ids:
        raise ContractValueError("prediction ids do not match the target sample set")
    return PredictionSetV1(
        model_id=predictions.model_id,
        dataset_digest=samples.digest(),
        predictions=predictions.predictions,
    )


def aligned_pairs(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
) -> tuple[tuple[ValidationSampleV1, PredictionV1], ...]:
    """Pair every sample with its prediction; alignment failures are loud."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("predictions must be PredictionSetV1")
    if predictions.dataset_digest != samples.digest():
        raise ContractValueError("prediction set is bound to a different sample set")
    if len(predictions.predictions) != len(samples.samples):
        raise ContractValueError("prediction and sample counts differ")
    by_id = {prediction.sample_id: prediction for prediction in predictions.predictions}
    pairs: list[tuple[ValidationSampleV1, PredictionV1]] = []
    for sample in samples.samples:
        prediction = by_id.get(sample.sample_id)
        if prediction is None:
            raise ContractValueError(f"missing prediction for sample id: {sample.sample_id}")
        pairs.append((sample, prediction))
    return tuple(pairs)
