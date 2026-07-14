"""Bounded deep-sequence metadata contracts for the Q13 failed-data gate.

These contracts describe future sequence inputs and fold lineage.  They do not hold
model weights, train a model, create a prediction, or imply that current evidence is
sufficient.  Sequence payloads remain content-addressed; point-in-time and missingness
facts stay explicit and exact.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Final

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
from quant_edge.validation import ValidationSampleV1

MAX_SEQUENCE_FRAMES: Final = 4_096
MAX_SEQUENCE_FEATURES: Final = 256
MAX_TRAINING_MEMBERS: Final = 100_000


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _optional_non_negative(value: object, *, field: str) -> int | None:
    if value is None:
        return None
    return require_strict_int(value, field=field, minimum=0)


def _require_sorted_ids(
    value: object,
    *,
    field: str,
    minimum: int,
    maximum: int,
) -> tuple[str, ...]:
    if not isinstance(value, tuple) or not minimum <= len(value) <= maximum:
        raise ContractValueError(f"{field} must contain {minimum}..{maximum} items")
    normalized = tuple(require_contract_id(item, field=field) for item in value)
    if normalized != tuple(sorted(set(normalized))):
        raise ContractValueError(f"{field} must be sorted and unique")
    return normalized


@dataclass(frozen=True, slots=True)
class DeepSequenceWindowV1:
    """Content-addressed point-in-time sequence metadata; no tensor is fabricated."""

    sequence_id: str
    sample_id: str
    symbol: str
    group_id: str
    sequence_start_ns: int
    cutoff_ns: int
    label_end_ns: int
    frame_asof_ns: tuple[int, ...]
    feature_ids: tuple[str, ...]
    level_count: int | None
    gap_count: int | None
    quality: QualityState
    posture: EvidencePosture
    payload_digest: DigestV1
    binary_outcome: bool | None
    gross_edge_ratio: ExactRatioV1 | None
    base_cost_ratio: ExactRatioV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.sequence_id, field="sequence_id")
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.symbol, field="symbol")
        require_contract_id(self.group_id, field="group_id")
        start = _require_ns(self.sequence_start_ns, field="sequence_start_ns")
        cutoff = _require_ns(self.cutoff_ns, field="cutoff_ns")
        label_end = _require_ns(self.label_end_ns, field="label_end_ns")
        if not start <= cutoff < label_end:
            raise ContractValueError("sequence time law requires start <= cutoff < label end")
        if not isinstance(self.frame_asof_ns, tuple) or not (
            1 <= len(self.frame_asof_ns) <= MAX_SEQUENCE_FRAMES
        ):
            raise ContractValueError("frame_asof_ns must be a bounded non-empty tuple")
        previous: int | None = None
        for frame_ns in self.frame_asof_ns:
            current = _require_ns(frame_ns, field="frame_asof_ns")
            if current < start or current > cutoff:
                raise ContractValueError("every frame must be inside the pre-cutoff sequence")
            if previous is not None and current <= previous:
                raise ContractValueError("frame_asof_ns must be strictly increasing")
            previous = current
        _require_sorted_ids(
            self.feature_ids,
            field="feature_ids",
            minimum=1,
            maximum=MAX_SEQUENCE_FEATURES,
        )
        levels = _optional_non_negative(self.level_count, field="level_count")
        gaps = _optional_non_negative(self.gap_count, field="gap_count")
        if levels == 0:
            raise ContractValueError("level_count must be positive when known")
        if not isinstance(self.quality, QualityState):
            raise ContractValueError("quality must be a QualityState")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be an EvidencePosture")
        if self.posture is EvidencePosture.SYNTHETIC and self.quality is not QualityState.SYNTHETIC:
            raise ContractValueError("synthetic evidence must retain SYNTHETIC quality")
        if self.quality is QualityState.COMPLETE and (levels is None or gaps != 0):
            raise ContractValueError("COMPLETE requires known levels and exactly zero gaps")
        if not isinstance(self.payload_digest, DigestV1):
            raise ContractValueError("payload_digest must be DigestV1")
        if self.binary_outcome is not None and not isinstance(self.binary_outcome, bool):
            raise ContractValueError("binary_outcome must be boolean or None")
        for field, value in (
            ("gross_edge_ratio", self.gross_edge_ratio),
            ("base_cost_ratio", self.base_cost_ratio),
        ):
            if value is not None and not isinstance(value, ExactRatioV1):
                raise ContractValueError(f"{field} must be ExactRatioV1 or None")

    @property
    def max_feature_asof_ns(self) -> int:
        return self.frame_asof_ns[-1]

    def as_validation_sample(self) -> ValidationSampleV1:
        """Lossless Q14 sample projection; unknown costs stay ``None``."""

        return ValidationSampleV1(
            sample_id=self.sample_id,
            symbol=self.symbol,
            group_id=self.group_id,
            cutoff_ns=self.cutoff_ns,
            label_end_ns=self.label_end_ns,
            strata=(("evidence_posture", self.posture.value.lower()),),
            binary_outcome=self.binary_outcome,
            gross_edge_ratio=self.gross_edge_ratio,
            base_cost_ratio=self.base_cost_ratio,
            quality=self.quality,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseCostRatio": (
                None if self.base_cost_ratio is None else self.base_cost_ratio.as_mapping()
            ),
            "binaryOutcome": self.binary_outcome,
            "cutoffNs": str(self.cutoff_ns),
            "featureIds": list(self.feature_ids),
            "frameAsofNs": [str(value) for value in self.frame_asof_ns],
            "gapCount": self.gap_count,
            "grossEdgeRatio": (
                None if self.gross_edge_ratio is None else self.gross_edge_ratio.as_mapping()
            ),
            "groupId": self.group_id,
            "labelEndNs": str(self.label_end_ns),
            "levelCount": self.level_count,
            "payloadSha256": self.payload_digest.hexdigest,
            "posture": self.posture.value,
            "quality": self.quality.value,
            "sampleId": self.sample_id,
            "schema": "Q13DeepSequenceWindowV1",
            "sequenceId": self.sequence_id,
            "sequenceStartNs": str(self.sequence_start_ns),
            "symbol": self.symbol,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


@dataclass(frozen=True, slots=True)
class DeepFoldLineageV1:
    """Future out-of-fold training lineage not expressible in Q14 predictions alone."""

    fold_id: str
    candidate_id: str
    validation_sample_id: str
    validation_group_id: str
    validation_cutoff_ns: int
    training_sample_ids: tuple[str, ...]
    training_group_ids: tuple[str, ...]
    max_training_label_end_ns: int
    embargo_ns: int
    training_set_digest: DigestV1
    split_plan_digest: DigestV1
    feature_registry_digest: DigestV1
    label_manifest_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.fold_id, field="fold_id")
        require_contract_id(self.candidate_id, field="candidate_id")
        require_contract_id(self.validation_sample_id, field="validation_sample_id")
        require_contract_id(self.validation_group_id, field="validation_group_id")
        cutoff = _require_ns(self.validation_cutoff_ns, field="validation_cutoff_ns")
        label_end = _require_ns(
            self.max_training_label_end_ns,
            field="max_training_label_end_ns",
        )
        embargo = require_strict_int(self.embargo_ns, field="embargo_ns", minimum=0)
        sample_ids = _require_sorted_ids(
            self.training_sample_ids,
            field="training_sample_ids",
            minimum=1,
            maximum=MAX_TRAINING_MEMBERS,
        )
        group_ids = _require_sorted_ids(
            self.training_group_ids,
            field="training_group_ids",
            minimum=1,
            maximum=MAX_TRAINING_MEMBERS,
        )
        if self.validation_sample_id in sample_ids:
            raise ContractValueError("validation sample cannot appear in its training fold")
        if self.validation_group_id in group_ids:
            raise ContractValueError("validation group cannot appear in its training fold")
        if label_end + embargo > cutoff:
            raise ContractValueError("training labels plus embargo must precede validation cutoff")
        for field, value in (
            ("training_set_digest", self.training_set_digest),
            ("split_plan_digest", self.split_plan_digest),
            ("feature_registry_digest", self.feature_registry_digest),
            ("label_manifest_digest", self.label_manifest_digest),
        ):
            if not isinstance(value, DigestV1):
                raise ContractValueError(f"{field} must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "candidateId": self.candidate_id,
            "embargoNs": str(self.embargo_ns),
            "featureRegistrySha256": self.feature_registry_digest.hexdigest,
            "foldId": self.fold_id,
            "labelManifestSha256": self.label_manifest_digest.hexdigest,
            "maxTrainingLabelEndNs": str(self.max_training_label_end_ns),
            "schema": "Q13DeepFoldLineageV1",
            "splitPlanSha256": self.split_plan_digest.hexdigest,
            "trainingGroupIds": list(self.training_group_ids),
            "trainingSampleIds": list(self.training_sample_ids),
            "trainingSetSha256": self.training_set_digest.hexdigest,
            "validationCutoffNs": str(self.validation_cutoff_ns),
            "validationGroupId": self.validation_group_id,
            "validationSampleId": self.validation_sample_id,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )
