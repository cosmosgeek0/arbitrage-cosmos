from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int

MAX_BUCKETS: Final = 4_096
MAX_BUCKET_COUNT: Final = 10**12


class StageLabel(StrEnum):
    DORMANT = "DORMANT"
    IGNITION = "IGNITION"
    EARLY_EXPANSION = "EARLY_EXPANSION"
    CONTINUATION = "CONTINUATION"
    EXHAUSTION = "EXHAUSTION"
    FADE = "FADE"
    UNWIND = "UNWIND"
    DISORDER = "DISORDER"
    NO_EVENT = "NO_EVENT"
    UNKNOWN = "UNKNOWN"


def _require_counts(value: object, *, field: str) -> tuple[int, ...]:
    if not isinstance(value, tuple) or not value or len(value) > MAX_BUCKETS:
        raise ContractValueError(f"{field} must be a tuple of 1..{MAX_BUCKETS} bucket counts")
    for count in value:
        require_strict_int(count, field=field, minimum=0, maximum=MAX_BUCKET_COUNT)
    return value


def _require_ratio(value: object, *, field: str, positive: bool) -> ExactRatioV1:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if positive and value.numerator <= 0:
        raise ContractValueError(f"{field} must be strictly positive")
    return value


@dataclass(frozen=True, slots=True)
class StageDefinitionV1:
    """Versioned stage discovery thresholds; descriptors of a rule, never truth."""

    definition_version: str
    dormant_max_count: int
    ignition_ratio: ExactRatioV1
    continuation_floor_ratio: ExactRatioV1
    fade_ceiling_ratio: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.definition_version, field="definition_version")
        require_strict_int(
            self.dormant_max_count,
            field="dormant_max_count",
            minimum=0,
            maximum=MAX_BUCKET_COUNT,
        )
        ignition = _require_ratio(self.ignition_ratio, field="ignition_ratio", positive=True)
        floor = _require_ratio(
            self.continuation_floor_ratio,
            field="continuation_floor_ratio",
            positive=True,
        )
        ceiling = _require_ratio(
            self.fade_ceiling_ratio,
            field="fade_ceiling_ratio",
            positive=True,
        )
        if ratio_compare(ignition, make_ratio(1, 1)) <= 0:
            raise ContractValueError("ignition must require growth above baseline")
        if ratio_compare(ceiling, floor) >= 0:
            raise ContractValueError("the fade ceiling must lie below the continuation floor")

    def as_mapping(self) -> dict[str, object]:
        return {
            "continuationFloorRatio": self.continuation_floor_ratio.as_mapping(),
            "definitionVersion": self.definition_version,
            "dormantMaxCount": self.dormant_max_count,
            "fadeCeilingRatio": self.fade_ceiling_ratio.as_mapping(),
            "ignitionRatio": self.ignition_ratio.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class StageEvidenceV1:
    """Observable activity/price facts for one sample window; nothing manual."""

    baseline_bucket_counts: tuple[int, ...]
    window_bucket_counts: tuple[int, ...]
    net_return_sign: int
    window_complete: bool
    disorder_observed: bool

    def __post_init__(self) -> None:
        _require_counts(self.baseline_bucket_counts, field="baseline_bucket_counts")
        _require_counts(self.window_bucket_counts, field="window_bucket_counts")
        require_strict_int(self.net_return_sign, field="net_return_sign", minimum=-1, maximum=1)
        if not isinstance(self.window_complete, bool) or not isinstance(
            self.disorder_observed, bool
        ):
            raise ContractValueError("window_complete and disorder_observed must be boolean")

    def as_mapping(self) -> dict[str, object]:
        return {
            "baselineBucketCounts": list(self.baseline_bucket_counts),
            "disorderObserved": self.disorder_observed,
            "netReturnSign": self.net_return_sign,
            "windowBucketCounts": list(self.window_bucket_counts),
            "windowComplete": self.window_complete,
        }

    def evidence_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


@dataclass(frozen=True, slots=True)
class StageAssignmentV1:
    definition_version: str
    stage: StageLabel
    rationale_code: str
    evidence_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.definition_version, field="definition_version")
        if not isinstance(self.stage, StageLabel):
            raise ContractValueError("stage must be StageLabel")
        require_contract_id(self.rationale_code, field="rationale_code")
        if not isinstance(self.evidence_digest, DigestV1):
            raise ContractValueError("evidence_digest must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "definitionVersion": self.definition_version,
            "evidenceSha256": self.evidence_digest.hexdigest,
            "rationaleCode": self.rationale_code,
            "stage": self.stage.value,
        }


def _activity_ratio(count: int, baseline: tuple[int, ...]) -> ExactRatioV1:
    total = sum(baseline)
    if total == 0:
        # An empty baseline makes any activity infinite growth; represent it against
        # a one-count floor so the comparison stays exact and explicit.
        total = 1
    return make_ratio(count * len(baseline), total)


def generate_stage(
    evidence: StageEvidenceV1,
    definition: StageDefinitionV1,
) -> StageAssignmentV1:
    """Apply the versioned v1 stage rules in documented precedence order.

    There is no relabeling path: assignments are frozen values derived from frozen
    evidence, and re-running with identical inputs is the only way to reproduce one.
    """

    if not isinstance(evidence, StageEvidenceV1):
        raise ContractValueError("evidence must be StageEvidenceV1")
    if not isinstance(definition, StageDefinitionV1):
        raise ContractValueError("definition must be StageDefinitionV1")

    stage, rationale = _classify(evidence, definition)
    return StageAssignmentV1(
        definition_version=definition.definition_version,
        stage=stage,
        rationale_code=rationale,
        evidence_digest=evidence.evidence_digest(),
    )


def _classify(
    evidence: StageEvidenceV1,
    definition: StageDefinitionV1,
) -> tuple[StageLabel, str]:
    if evidence.disorder_observed:
        return (StageLabel.DISORDER, "DISORDER_EVIDENCE_OBSERVED")
    if not evidence.window_complete:
        return (StageLabel.UNKNOWN, "WINDOW_INCOMPLETE")
    buckets = evidence.window_bucket_counts
    baseline = evidence.baseline_bucket_counts
    if max(buckets) <= definition.dormant_max_count and (
        max(baseline) <= definition.dormant_max_count
    ):
        return (StageLabel.DORMANT, "ACTIVITY_BELOW_DORMANT_MAX")
    ratios = [_activity_ratio(count, baseline) for count in buckets]
    ignited = [
        index
        for index, ratio in enumerate(ratios)
        if ratio_compare(ratio, definition.ignition_ratio) >= 0
    ]
    if not ignited:
        return (StageLabel.NO_EVENT, "ACTIVITY_NEVER_IGNITED")
    first_ignited = ignited[0]
    last_index = len(buckets) - 1
    if first_ignited == last_index:
        return (StageLabel.IGNITION, "IGNITION_AT_WINDOW_END")
    peak_index = max(range(len(buckets)), key=lambda index: (buckets[index], -index))
    if peak_index == last_index:
        return (StageLabel.EARLY_EXPANSION, "ACTIVITY_STILL_GROWING_AT_WINDOW_END")
    last_ratio = ratios[last_index]
    if ratio_compare(last_ratio, definition.fade_ceiling_ratio) < 0:
        return (StageLabel.FADE, "ACTIVITY_COLLAPSED_BELOW_FADE_CEILING")
    if evidence.net_return_sign < 0:
        return (StageLabel.UNWIND, "SUSTAINED_ACTIVITY_WITH_NEGATIVE_REVERSAL")
    if ratio_compare(last_ratio, definition.continuation_floor_ratio) >= 0:
        return (StageLabel.CONTINUATION, "ACTIVITY_SUSTAINED_ABOVE_CONTINUATION_FLOOR")
    return (StageLabel.EXHAUSTION, "ACTIVITY_DECAYING_BETWEEN_FLOORS")
