"""Immutable Q15 registry, card, lifecycle, shadow and drift contracts.

The registry is an offline research authority only.  A champion identifies a
reproducible research artifact; it never grants product, capital, risk or order
authority.  All timestamps, commands and evidence are caller supplied.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.primitives import require_utc_millis

MAX_CARD_ITEMS: Final = 128
MAX_TEXT_LENGTH: Final = 4_096
MAX_ARTIFACT_BYTES: Final = 64 * 1024 * 1024
MAX_HORIZON_MS: Final = 31 * 24 * 60 * 60 * 1_000


def _require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT_LENGTH:
        raise ContractValueError(f"{field} must be bounded non-empty text")
    value.encode("utf-8", errors="strict")
    return value


def _require_text_tuple(
    value: object,
    *,
    field: str,
    allow_empty: bool = False,
    sorted_unique: bool = True,
) -> tuple[str, ...]:
    if not isinstance(value, tuple) or len(value) > MAX_CARD_ITEMS:
        raise ContractValueError(f"{field} must be a bounded tuple")
    if not allow_empty and not value:
        raise ContractValueError(f"{field} must not be empty")
    for index, item in enumerate(value):
        _require_text(item, field=f"{field}[{index}]")
    if sorted_unique and (tuple(sorted(value)) != value or len(set(value)) != len(value)):
        raise ContractValueError(f"{field} must be sorted and unique")
    return value


def _require_pairs(
    value: object,
    *,
    field: str,
    allow_empty: bool = False,
) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, tuple) or len(value) > MAX_CARD_ITEMS:
        raise ContractValueError(f"{field} must be a bounded tuple of pairs")
    if not allow_empty and not value:
        raise ContractValueError(f"{field} must not be empty")
    names: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, tuple) or len(item) != 2:
            raise ContractValueError(f"{field}[{index}] must be a pair")
        name, entry = item
        require_contract_id(name, field=f"{field}[{index}].name")
        _require_text(entry, field=f"{field}[{index}].value")
        names.append(name)
    if names != sorted(names) or len(set(names)) != len(names):
        raise ContractValueError(f"{field} names must be sorted and unique")
    return value


def mapping_digest(mapping: dict[str, object]) -> DigestV1:
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


class ArtifactKind(StrEnum):
    DATASET = "DATASET"
    DEPENDENCY_LOCK = "DEPENDENCY_LOCK"
    EXPERIMENT = "EXPERIMENT"
    FEATURE_REGISTRY = "FEATURE_REGISTRY"
    HYPOTHESIS_REGISTRY = "HYPOTHESIS_REGISTRY"
    MODEL_EVIDENCE = "MODEL_EVIDENCE"
    MODEL_PAYLOAD = "MODEL_PAYLOAD"
    VALIDATION_REPORT = "VALIDATION_REPORT"


class EvidencePosture(StrEnum):
    SYNTHETIC_ONLY = "SYNTHETIC_ONLY"
    REPLAY = "REPLAY"
    RESEARCH_ONLY = "RESEARCH_ONLY"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


class ModelLifecycle(StrEnum):
    SHADOW_CHALLENGER = "SHADOW_CHALLENGER"
    CHAMPION = "CHAMPION"
    RETIRED = "RETIRED"


class ServingPosture(StrEnum):
    ADVISORY = "ADVISORY"
    ABSTAIN_UNKNOWN = "ABSTAIN_UNKNOWN"


class TransitionKind(StrEnum):
    BOOTSTRAP = "BOOTSTRAP"
    PROMOTION = "PROMOTION"
    DEMOTION = "DEMOTION"
    RECOVERY = "RECOVERY"
    ROLLBACK = "ROLLBACK"


class CommitStage(StrEnum):
    AFTER_BEGIN = "AFTER_BEGIN"
    BEFORE_COMMIT = "BEFORE_COMMIT"
    AFTER_COMMIT = "AFTER_COMMIT"


class FeedbackState(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNKNOWN = "UNKNOWN"


class OutcomeDisposition(StrEnum):
    ACTED = "ACTED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    MISSED = "MISSED"
    QUIET_CONTROL = "QUIET_CONTROL"


class OutcomeReality(StrEnum):
    REAL = "REAL"
    HYPOTHETICAL = "HYPOTHETICAL"
    REPLAY = "REPLAY"


class DriftLayer(StrEnum):
    INPUT_FEATURE_DISTRIBUTION = "INPUT_FEATURE_DISTRIBUTION"
    MISSINGNESS_QUALITY = "MISSINGNESS_QUALITY"
    PREDICTION_DISTRIBUTION = "PREDICTION_DISTRIBUTION"
    RESIDUAL_ERROR = "RESIDUAL_ERROR"
    CALIBRATION = "CALIBRATION"
    REGIME_MIX = "REGIME_MIX"
    NET_UTILITY_EDGE_DECAY = "NET_UTILITY_EDGE_DECAY"
    INFERENCE_LATENCY_RESOURCE = "INFERENCE_LATENCY_RESOURCE"


class DriftResponse(StrEnum):
    WARN = "WARN"
    FREEZE_ADVISORY = "FREEZE_ADVISORY"
    ABSTAIN_UNKNOWN = "ABSTAIN_UNKNOWN"


@dataclass(frozen=True, slots=True)
class ArtifactRefV1:
    artifact_id: str
    kind: ArtifactKind
    schema_name: str
    schema_version: int
    relative_path: str
    sha256: DigestV1
    byte_length: int
    media_type: str

    def __post_init__(self) -> None:
        require_contract_id(self.artifact_id, field="artifact_id")
        if not isinstance(self.kind, ArtifactKind):
            raise ContractValueError("kind must be ArtifactKind")
        require_contract_id(self.schema_name, field="schema_name")
        require_strict_int(self.schema_version, field="schema_version", minimum=1, maximum=65_535)
        _require_text(self.relative_path, field="relative_path")
        parsed = PurePosixPath(self.relative_path)
        if (
            parsed.is_absolute()
            or not parsed.parts
            or any(part in ("", ".", "..") for part in parsed.parts)
            or "\\" in self.relative_path
            or "://" in self.relative_path
        ):
            raise ContractValueError("relative_path must be a safe relative POSIX path")
        if not isinstance(self.sha256, DigestV1):
            raise ContractValueError("sha256 must be DigestV1")
        require_strict_int(
            self.byte_length,
            field="byte_length",
            minimum=1,
            maximum=MAX_ARTIFACT_BYTES,
        )
        _require_text(self.media_type, field="media_type")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactId": self.artifact_id,
            "byteLength": self.byte_length,
            "kind": self.kind.value,
            "mediaType": self.media_type,
            "relativePath": self.relative_path,
            "schemaName": self.schema_name,
            "schemaVersion": self.schema_version,
            "sha256": self.sha256.hexdigest,
        }


@dataclass(frozen=True, slots=True)
class ArtifactManifestV1:
    manifest_id: str
    artifacts: tuple[ArtifactRefV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.manifest_id, field="manifest_id")
        if not isinstance(self.artifacts, tuple) or not (
            1 <= len(self.artifacts) <= MAX_CARD_ITEMS
        ):
            raise ContractValueError("artifacts must be a bounded non-empty tuple")
        ids = [artifact.artifact_id for artifact in self.artifacts]
        if any(not isinstance(artifact, ArtifactRefV1) for artifact in self.artifacts):
            raise ContractValueError("artifacts must contain ArtifactRefV1")
        if ids != sorted(ids) or len(set(ids)) != len(ids):
            raise ContractValueError("artifacts must be sorted by unique artifact_id")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifacts": [artifact.as_mapping() for artifact in self.artifacts],
            "manifestId": self.manifest_id,
            "schema": "Q15ArtifactManifestV1",
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class DatasetCardV1:
    card_id: str
    revision: str
    dataset_id: str
    posture: EvidencePosture
    sources_and_licenses: tuple[tuple[str, str], ...]
    date_coverage: str
    symbol_product_coverage: tuple[str, ...]
    cadence_and_timestamps: tuple[str, ...]
    gaps_revisions_checksums: tuple[str, ...]
    survivorship_delisting_limits: tuple[str, ...]
    l2_availability: str
    feature_label_lineage: tuple[str, ...]
    retention_privacy: tuple[str, ...]
    artifact_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.card_id, field="card_id")
        require_contract_id(self.revision, field="revision")
        require_contract_id(self.dataset_id, field="dataset_id")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        _require_pairs(self.sources_and_licenses, field="sources_and_licenses")
        _require_text(self.date_coverage, field="date_coverage")
        for field_name in (
            "symbol_product_coverage",
            "cadence_and_timestamps",
            "gaps_revisions_checksums",
            "survivorship_delisting_limits",
            "feature_label_lineage",
            "retention_privacy",
        ):
            _require_text_tuple(getattr(self, field_name), field=field_name, sorted_unique=False)
        _require_text_tuple(self.artifact_ids, field="artifact_ids")
        _require_text(self.l2_availability, field="l2_availability")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactIds": list(self.artifact_ids),
            "cadenceAndTimestamps": list(self.cadence_and_timestamps),
            "cardId": self.card_id,
            "datasetId": self.dataset_id,
            "dateCoverage": self.date_coverage,
            "featureLabelLineage": list(self.feature_label_lineage),
            "gapsRevisionsChecksums": list(self.gaps_revisions_checksums),
            "l2Availability": self.l2_availability,
            "posture": self.posture.value,
            "retentionPrivacy": list(self.retention_privacy),
            "revision": self.revision,
            "schema": "Q15DatasetCardV1",
            "sourcesAndLicenses": dict(self.sources_and_licenses),
            "survivorshipDelistingLimits": list(self.survivorship_delisting_limits),
            "symbolProductCoverage": list(self.symbol_product_coverage),
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class ModelCardV1:
    card_id: str
    revision: str
    model_id: str
    model_revision: str
    posture: EvidencePosture
    registry_state_at_issue: ModelLifecycle
    intended_use: tuple[str, ...]
    forbidden_use: tuple[str, ...]
    periods: tuple[tuple[str, str], ...]
    symbols_products_cohorts: tuple[str, ...]
    data_sufficiency_missingness: tuple[str, ...]
    feature_versions: tuple[str, ...]
    label_versions: tuple[str, ...]
    algorithm: str
    hyperparameters: tuple[tuple[str, str], ...]
    calibration_method: str
    cost_assumptions: tuple[str, ...]
    performance_slices: tuple[str, ...]
    known_failures: tuple[str, ...]
    drift_triggers: tuple[str, ...]
    inference_budget: tuple[str, ...]
    loadable_model_payload: bool
    artifact_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        for field_name in ("card_id", "revision", "model_id", "model_revision"):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        if not isinstance(self.registry_state_at_issue, ModelLifecycle):
            raise ContractValueError("registry_state_at_issue must be ModelLifecycle")
        for field_name in (
            "intended_use",
            "forbidden_use",
            "symbols_products_cohorts",
            "data_sufficiency_missingness",
            "feature_versions",
            "label_versions",
            "cost_assumptions",
            "performance_slices",
            "known_failures",
            "drift_triggers",
            "inference_budget",
        ):
            _require_text_tuple(getattr(self, field_name), field=field_name, sorted_unique=False)
        _require_text_tuple(self.artifact_ids, field="artifact_ids")
        _require_pairs(self.periods, field="periods")
        _require_text(self.algorithm, field="algorithm")
        _require_pairs(self.hyperparameters, field="hyperparameters", allow_empty=True)
        _require_text(self.calibration_method, field="calibration_method")
        if not isinstance(self.loadable_model_payload, bool):
            raise ContractValueError("loadable_model_payload must be boolean")

    def as_mapping(self) -> dict[str, object]:
        return {
            "algorithm": self.algorithm,
            "artifactIds": list(self.artifact_ids),
            "calibrationMethod": self.calibration_method,
            "cardId": self.card_id,
            "costAssumptions": list(self.cost_assumptions),
            "dataSufficiencyMissingness": list(self.data_sufficiency_missingness),
            "driftTriggers": list(self.drift_triggers),
            "featureVersions": list(self.feature_versions),
            "forbiddenUse": list(self.forbidden_use),
            "hyperparameters": dict(self.hyperparameters),
            "inferenceBudget": list(self.inference_budget),
            "intendedUse": list(self.intended_use),
            "knownFailures": list(self.known_failures),
            "labelVersions": list(self.label_versions),
            "loadableModelPayload": self.loadable_model_payload,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "performanceSlices": list(self.performance_slices),
            "periods": dict(self.periods),
            "posture": self.posture.value,
            "revision": self.revision,
            "registryStateAtIssue": self.registry_state_at_issue.value,
            "schema": "Q15ModelCardV1",
            "symbolsProductsCohorts": list(self.symbols_products_cohorts),
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class ExperimentCardV1:
    card_id: str
    revision: str
    experiment_id: str
    hypothesis_id: str
    code_commit: str
    dependency_lock_sha256: DigestV1
    dataset_manifest_ids: tuple[str, ...]
    feature_versions: tuple[str, ...]
    label_versions: tuple[str, ...]
    split_fold_ids: tuple[str, ...]
    parameters: tuple[tuple[str, str], ...]
    seed: int
    attempted_trial_ids: tuple[str, ...]
    metrics_and_intervals: tuple[str, ...]
    artifact_ids: tuple[str, ...]
    latency_resource_benchmark: tuple[str, ...]
    model_card_ids: tuple[str, ...]
    decision: str
    posture: EvidencePosture

    def __post_init__(self) -> None:
        for field_name in ("card_id", "revision", "experiment_id", "hypothesis_id"):
            require_contract_id(getattr(self, field_name), field=field_name)
        invalid_commit = len(self.code_commit) != 40 or any(
            char not in "0123456789abcdef" for char in self.code_commit
        )
        if invalid_commit:
            raise ContractValueError("code_commit must be a full lowercase Git SHA")
        if not isinstance(self.dependency_lock_sha256, DigestV1):
            raise ContractValueError("dependency_lock_sha256 must be DigestV1")
        for field_name in (
            "dataset_manifest_ids",
            "feature_versions",
            "label_versions",
            "split_fold_ids",
            "attempted_trial_ids",
            "metrics_and_intervals",
            "latency_resource_benchmark",
        ):
            _require_text_tuple(getattr(self, field_name), field=field_name, sorted_unique=False)
        _require_text_tuple(self.artifact_ids, field="artifact_ids")
        _require_text_tuple(self.model_card_ids, field="model_card_ids")
        _require_pairs(self.parameters, field="parameters", allow_empty=True)
        require_strict_int(self.seed, field="seed", minimum=0)
        _require_text(self.decision, field="decision")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactIds": list(self.artifact_ids),
            "attemptedTrialIds": list(self.attempted_trial_ids),
            "cardId": self.card_id,
            "codeCommit": self.code_commit,
            "datasetManifestIds": list(self.dataset_manifest_ids),
            "decision": self.decision,
            "dependencyLockSha256": self.dependency_lock_sha256.hexdigest,
            "experimentId": self.experiment_id,
            "featureVersions": list(self.feature_versions),
            "hypothesisId": self.hypothesis_id,
            "labelVersions": list(self.label_versions),
            "latencyResourceBenchmark": list(self.latency_resource_benchmark),
            "metricsAndIntervals": list(self.metrics_and_intervals),
            "modelCardIds": list(self.model_card_ids),
            "parameters": dict(self.parameters),
            "posture": self.posture.value,
            "revision": self.revision,
            "schema": "Q15ExperimentCardV1",
            "seed": str(self.seed),
            "splitFoldIds": list(self.split_fold_ids),
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class ModelRegistrationV1:
    model_id: str
    model_revision: str
    artifact: ArtifactRefV1
    model_card_digest: DigestV1
    dataset_card_digest: DigestV1
    experiment_card_digest: DigestV1
    output_contract_id: str
    target_id: str
    score_contract_id: str
    posture: EvidencePosture
    registered_at_ms: int

    def __post_init__(self) -> None:
        require_contract_id(self.model_id, field="model_id")
        require_contract_id(self.model_revision, field="model_revision")
        if not isinstance(self.artifact, ArtifactRefV1):
            raise ContractValueError("artifact must be ArtifactRefV1")
        for field_name in (
            "model_card_digest",
            "dataset_card_digest",
            "experiment_card_digest",
        ):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        require_contract_id(self.output_contract_id, field="output_contract_id")
        require_contract_id(self.target_id, field="target_id")
        require_contract_id(self.score_contract_id, field="score_contract_id")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        require_utc_millis(self.registered_at_ms, field="registered_at_ms")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifact": self.artifact.as_mapping(),
            "datasetCardSha256": self.dataset_card_digest.hexdigest,
            "experimentCardSha256": self.experiment_card_digest.hexdigest,
            "modelCardSha256": self.model_card_digest.hexdigest,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "outputContractId": self.output_contract_id,
            "scoreContractId": self.score_contract_id,
            "targetId": self.target_id,
            "posture": self.posture.value,
            "registeredAtMs": str(self.registered_at_ms),
            "schema": "Q15ModelRegistrationV1",
            "version": 1,
        }


@dataclass(frozen=True, slots=True)
class PromotionGateV1:
    immutable_inputs: bool
    leakage_negative_controls: bool
    chronological_primary_metric: bool
    calibration: bool
    costs_latency: bool
    inference_resources: bool
    critical_regimes_tails: bool
    cards_complete: bool
    mature_shadow_comparison: bool
    auditable_record: bool

    def __post_init__(self) -> None:
        if any(not isinstance(value, bool) for value in self.values()):
            raise ContractValueError("promotion gate fields must be booleans")

    def values(self) -> tuple[bool, ...]:
        return (
            self.immutable_inputs,
            self.leakage_negative_controls,
            self.chronological_primary_metric,
            self.calibration,
            self.costs_latency,
            self.inference_resources,
            self.critical_regimes_tails,
            self.cards_complete,
            self.mature_shadow_comparison,
            self.auditable_record,
        )

    @property
    def all_passed(self) -> bool:
        return all(self.values())

    def as_mapping(self) -> dict[str, object]:
        return {
            "auditableRecord": self.auditable_record,
            "calibration": self.calibration,
            "cardsComplete": self.cards_complete,
            "chronologicalPrimaryMetric": self.chronological_primary_metric,
            "costsLatency": self.costs_latency,
            "criticalRegimesTails": self.critical_regimes_tails,
            "immutableInputs": self.immutable_inputs,
            "inferenceResources": self.inference_resources,
            "leakageNegativeControls": self.leakage_negative_controls,
            "matureShadowComparison": self.mature_shadow_comparison,
        }


@dataclass(frozen=True, slots=True)
class ValidationBindingV1:
    evidence_id: str
    subject_model_id: str
    subject_model_revision: str
    subject_artifact_sha256: DigestV1
    report_artifact: ArtifactRefV1
    report_baseline_model_id: str
    report_challenger_model_id: str
    report_verdict: str
    shadow_report_sha256: DigestV1
    posture: EvidencePosture
    gates: PromotionGateV1

    def __post_init__(self) -> None:
        for field_name in (
            "evidence_id",
            "subject_model_id",
            "subject_model_revision",
            "report_baseline_model_id",
            "report_challenger_model_id",
            "report_verdict",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.subject_artifact_sha256, DigestV1):
            raise ContractValueError("subject_artifact_sha256 must be DigestV1")
        if not isinstance(self.report_artifact, ArtifactRefV1):
            raise ContractValueError("report_artifact must be ArtifactRefV1")
        if not isinstance(self.shadow_report_sha256, DigestV1):
            raise ContractValueError("shadow_report_sha256 must be DigestV1")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        if not isinstance(self.gates, PromotionGateV1):
            raise ContractValueError("gates must be PromotionGateV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "evidenceId": self.evidence_id,
            "gates": self.gates.as_mapping(),
            "posture": self.posture.value,
            "reportArtifact": self.report_artifact.as_mapping(),
            "reportBaselineModelId": self.report_baseline_model_id,
            "reportChallengerModelId": self.report_challenger_model_id,
            "reportVerdict": self.report_verdict,
            "shadowReportSha256": self.shadow_report_sha256.hexdigest,
            "subjectArtifactSha256": self.subject_artifact_sha256.hexdigest,
            "subjectModelId": self.subject_model_id,
            "subjectModelRevision": self.subject_model_revision,
        }


@dataclass(frozen=True, slots=True)
class ChampionSnapshotV1:
    slot_id: str
    generation: int
    model_id: str
    model_revision: str
    artifact_sha256: DigestV1
    model_card_sha256: DigestV1
    policy_revision: str
    posture: ServingPosture
    transition_id: str
    updated_at_ms: int

    def __post_init__(self) -> None:
        for field_name in (
            "slot_id",
            "model_id",
            "model_revision",
            "policy_revision",
            "transition_id",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        require_strict_int(self.generation, field="generation", minimum=1)
        for field_name in ("artifact_sha256", "model_card_sha256"):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        if not isinstance(self.posture, ServingPosture):
            raise ContractValueError("posture must be ServingPosture")
        require_utc_millis(self.updated_at_ms, field="updated_at_ms")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactSha256": self.artifact_sha256.hexdigest,
            "generation": self.generation,
            "modelCardSha256": self.model_card_sha256.hexdigest,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "policyRevision": self.policy_revision,
            "posture": self.posture.value,
            "slotId": self.slot_id,
            "transitionId": self.transition_id,
            "updatedAtMs": str(self.updated_at_ms),
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class ShadowPredictionV1:
    model_id: str
    model_revision: str
    artifact_sha256: DigestV1
    output_digest: DigestV1
    score_micros: int | None

    def __post_init__(self) -> None:
        require_contract_id(self.model_id, field="model_id")
        require_contract_id(self.model_revision, field="model_revision")
        if not isinstance(self.artifact_sha256, DigestV1) or not isinstance(
            self.output_digest, DigestV1
        ):
            raise ContractValueError("prediction digests must be DigestV1")
        if self.score_micros is not None:
            require_strict_int(
                self.score_micros,
                field="score_micros",
                minimum=0,
                maximum=1_000_000,
            )
            expected_output = mapping_digest({"scoreMicros": str(self.score_micros)})
            if self.output_digest != expected_output:
                raise ContractValueError(
                    "scored shadow output digest must bind its exact score_micros"
                )

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactSha256": self.artifact_sha256.hexdigest,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "outputSha256": self.output_digest.hexdigest,
            "scoreMicros": self.score_micros,
        }


@dataclass(frozen=True, slots=True)
class ShadowScoreBatchV1:
    batch_id: str
    slot_id: str
    event_id: str
    target_id: str
    feature_cutoff_ms: int
    horizon_ms: int
    champion_generation: int
    champion_transition_id: str
    champion: ShadowPredictionV1
    challengers: tuple[ShadowPredictionV1, ...]
    disposition: OutcomeDisposition
    reality: OutcomeReality

    def __post_init__(self) -> None:
        for field_name in ("batch_id", "slot_id", "event_id", "target_id"):
            require_contract_id(getattr(self, field_name), field=field_name)
        require_utc_millis(self.feature_cutoff_ms, field="feature_cutoff_ms")
        require_strict_int(self.horizon_ms, field="horizon_ms", minimum=1, maximum=MAX_HORIZON_MS)
        require_strict_int(self.champion_generation, field="champion_generation", minimum=1)
        require_contract_id(self.champion_transition_id, field="champion_transition_id")
        if not isinstance(self.champion, ShadowPredictionV1):
            raise ContractValueError("champion must be ShadowPredictionV1")
        if not isinstance(self.challengers, tuple) or not (
            1 <= len(self.challengers) <= MAX_CARD_ITEMS
        ):
            raise ContractValueError("challengers must be a bounded non-empty tuple")
        keys = [(item.model_id, item.model_revision) for item in self.challengers]
        if any(not isinstance(item, ShadowPredictionV1) for item in self.challengers):
            raise ContractValueError("challengers must contain ShadowPredictionV1")
        if keys != sorted(keys) or len(set(keys)) != len(keys):
            raise ContractValueError("challengers must be sorted by unique model identity")
        if (self.champion.model_id, self.champion.model_revision) in keys:
            raise ContractValueError("champion cannot also be a challenger")
        if not isinstance(self.disposition, OutcomeDisposition):
            raise ContractValueError("disposition must be OutcomeDisposition")
        if not isinstance(self.reality, OutcomeReality):
            raise ContractValueError("reality must be OutcomeReality")

    @property
    def matures_at_ms(self) -> int:
        return self.feature_cutoff_ms + self.horizon_ms

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchId": self.batch_id,
            "challengers": [item.as_mapping() for item in self.challengers],
            "champion": self.champion.as_mapping(),
            "championGeneration": self.champion_generation,
            "championTransitionId": self.champion_transition_id,
            "disposition": self.disposition.value,
            "eventId": self.event_id,
            "featureCutoffMs": str(self.feature_cutoff_ms),
            "horizonMs": str(self.horizon_ms),
            "maturesAtMs": str(self.matures_at_ms),
            "reality": self.reality.value,
            "slotId": self.slot_id,
            "targetId": self.target_id,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class ShadowEvaluationCountsV1:
    slot_id: str
    evaluation_unit_count: int
    distinct_event_count: int

    def __post_init__(self) -> None:
        require_contract_id(self.slot_id, field="slot_id")
        evaluation_units = require_strict_int(
            self.evaluation_unit_count,
            field="evaluation_unit_count",
            minimum=0,
        )
        distinct_events = require_strict_int(
            self.distinct_event_count,
            field="distinct_event_count",
            minimum=0,
        )
        if distinct_events > evaluation_units:
            raise ContractValueError("distinct event count cannot exceed evaluation units")

    def as_mapping(self) -> dict[str, object]:
        return {
            "distinctEventCount": self.distinct_event_count,
            "evaluationUnitCount": self.evaluation_unit_count,
            "slotId": self.slot_id,
        }


@dataclass(frozen=True, slots=True)
class ShadowComparisonV1:
    comparison_id: str
    slot_id: str
    target_id: str
    horizon_ms: int
    champion_generation: int
    champion_transition_id: str
    champion_model_id: str
    champion_model_revision: str
    champion_artifact_sha256: DigestV1
    challenger_model_id: str
    challenger_model_revision: str
    challenger_artifact_sha256: DigestV1
    batch_ids: tuple[str, ...]
    feedback_digests: tuple[DigestV1, ...]
    metric_id: str
    champion_metric_micros: int | None
    challenger_metric_micros: int | None
    verdict: str
    posture: EvidencePosture

    def __post_init__(self) -> None:
        for field_name in (
            "comparison_id",
            "slot_id",
            "target_id",
            "champion_transition_id",
            "champion_model_id",
            "champion_model_revision",
            "challenger_model_id",
            "challenger_model_revision",
            "metric_id",
            "verdict",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if self.verdict not in ("PASS", "FAIL", "UNKNOWN"):
            raise ContractValueError("shadow comparison verdict is unsupported")
        if self.metric_id != "brier_loss_micros:v1":
            raise ContractValueError("shadow comparison metric is not admitted")
        if self.verdict == "UNKNOWN":
            if self.champion_metric_micros is not None or self.challenger_metric_micros is not None:
                raise ContractValueError("unknown shadow verdict cannot fabricate metric values")
        else:
            champion_metric = require_strict_int(
                self.champion_metric_micros,
                field="champion_metric_micros",
                minimum=0,
            )
            challenger_metric = require_strict_int(
                self.challenger_metric_micros,
                field="challenger_metric_micros",
                minimum=0,
            )
            expected_verdict = "PASS" if challenger_metric < champion_metric else "FAIL"
            if self.verdict != expected_verdict:
                raise ContractValueError(
                    "shadow verdict must be derived from the lower-is-better metric"
                )
        require_strict_int(self.horizon_ms, field="horizon_ms", minimum=1, maximum=MAX_HORIZON_MS)
        require_strict_int(self.champion_generation, field="champion_generation", minimum=1)
        for field_name in ("champion_artifact_sha256", "challenger_artifact_sha256"):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        _require_text_tuple(self.batch_ids, field="batch_ids")
        if not isinstance(self.feedback_digests, tuple) or not self.feedback_digests:
            raise ContractValueError("feedback_digests must be a non-empty tuple")
        hashes = [digest.hexdigest for digest in self.feedback_digests]
        if (
            any(not isinstance(digest, DigestV1) for digest in self.feedback_digests)
            or hashes != sorted(hashes)
            or len(set(hashes)) != len(hashes)
        ):
            raise ContractValueError("feedback_digests must be sorted and unique")
        if len(self.feedback_digests) != len(self.batch_ids):
            raise ContractValueError("every shadow batch needs one mature feedback digest")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchIds": list(self.batch_ids),
            "challengerArtifactSha256": self.challenger_artifact_sha256.hexdigest,
            "challengerModelId": self.challenger_model_id,
            "challengerModelRevision": self.challenger_model_revision,
            "challengerMetricMicros": self.challenger_metric_micros,
            "championArtifactSha256": self.champion_artifact_sha256.hexdigest,
            "championGeneration": self.champion_generation,
            "championModelId": self.champion_model_id,
            "championModelRevision": self.champion_model_revision,
            "championMetricMicros": self.champion_metric_micros,
            "championTransitionId": self.champion_transition_id,
            "comparisonId": self.comparison_id,
            "feedbackSha256": [digest.hexdigest for digest in self.feedback_digests],
            "horizonMs": str(self.horizon_ms),
            "metricId": self.metric_id,
            "posture": self.posture.value,
            "slotId": self.slot_id,
            "targetId": self.target_id,
            "verdict": self.verdict,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class DelayedFeedbackV1:
    feedback_id: str
    batch_id: str
    event_id: str
    target_id: str
    horizon_ms: int
    source_revision: str
    observed_at_ms: int
    state: FeedbackState
    outcome_digest: DigestV1 | None
    outcome_micros: int | None

    def __post_init__(self) -> None:
        for field_name in ("feedback_id", "batch_id", "event_id", "target_id", "source_revision"):
            require_contract_id(getattr(self, field_name), field=field_name)
        require_strict_int(self.horizon_ms, field="horizon_ms", minimum=1, maximum=MAX_HORIZON_MS)
        require_utc_millis(self.observed_at_ms, field="observed_at_ms")
        if not isinstance(self.state, FeedbackState):
            raise ContractValueError("state must be FeedbackState")
        if self.state is FeedbackState.AVAILABLE:
            if not isinstance(self.outcome_digest, DigestV1):
                raise ContractValueError("available feedback requires outcome_digest")
            require_strict_int(
                self.outcome_micros,
                field="outcome_micros",
                minimum=0,
                maximum=1_000_000,
            )
            expected_outcome = mapping_digest({"outcomeMicros": str(self.outcome_micros)})
            if self.outcome_digest != expected_outcome:
                raise ContractValueError(
                    "available outcome digest must bind its exact outcome_micros"
                )
        elif self.outcome_digest is not None or self.outcome_micros is not None:
            raise ContractValueError("unknown feedback cannot fabricate an outcome")

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchId": self.batch_id,
            "eventId": self.event_id,
            "feedbackId": self.feedback_id,
            "horizonMs": str(self.horizon_ms),
            "observedAtMs": str(self.observed_at_ms),
            "outcomeSha256": None if self.outcome_digest is None else self.outcome_digest.hexdigest,
            "outcomeMicros": self.outcome_micros,
            "sourceRevision": self.source_revision,
            "state": self.state.value,
            "targetId": self.target_id,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class OwnerAnnotationV1:
    annotation_id: str
    event_id: str
    evidence_digest: DigestV1
    outcome_hidden_when_tagged: bool
    tagged_at_ms: int
    schema_revision: str
    tags: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.annotation_id, field="annotation_id")
        require_contract_id(self.event_id, field="event_id")
        if not isinstance(self.evidence_digest, DigestV1):
            raise ContractValueError("evidence_digest must be DigestV1")
        if not isinstance(self.outcome_hidden_when_tagged, bool):
            raise ContractValueError("outcome_hidden_when_tagged must be boolean")
        require_utc_millis(self.tagged_at_ms, field="tagged_at_ms")
        require_contract_id(self.schema_revision, field="schema_revision")
        _require_text_tuple(self.tags, field="tags")

    def as_mapping(self) -> dict[str, object]:
        return {
            "annotationId": self.annotation_id,
            "eventId": self.event_id,
            "evidenceSha256": self.evidence_digest.hexdigest,
            "outcomeHiddenWhenTagged": self.outcome_hidden_when_tagged,
            "schemaRevision": self.schema_revision,
            "taggedAtMs": str(self.tagged_at_ms),
            "tags": list(self.tags),
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class AnnotationOutcomeLinkV1:
    link_id: str
    annotation_id: str
    feedback_id: str
    linked_at_ms: int

    def __post_init__(self) -> None:
        require_contract_id(self.link_id, field="link_id")
        require_contract_id(self.annotation_id, field="annotation_id")
        require_contract_id(self.feedback_id, field="feedback_id")
        require_utc_millis(self.linked_at_ms, field="linked_at_ms")

    def as_mapping(self) -> dict[str, object]:
        return {
            "annotationId": self.annotation_id,
            "feedbackId": self.feedback_id,
            "linkId": self.link_id,
            "linkedAtMs": str(self.linked_at_ms),
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class DriftAlarmV1:
    alarm_id: str
    layer: DriftLayer
    monitored_model_id: str
    monitored_model_revision: str
    monitored_artifact_sha256: DigestV1
    monitored_generation: int
    monitored_transition_id: str
    detector_id: str
    evidence_digest: DigestV1
    response: DriftResponse
    reason_code: str
    observed_at_ms: int
    alarmed: bool

    def __post_init__(self) -> None:
        for field_name in (
            "alarm_id",
            "monitored_model_id",
            "monitored_model_revision",
            "monitored_transition_id",
            "detector_id",
            "reason_code",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.layer, DriftLayer):
            raise ContractValueError("layer must be DriftLayer")
        if not isinstance(self.monitored_artifact_sha256, DigestV1) or not isinstance(
            self.evidence_digest, DigestV1
        ):
            raise ContractValueError("drift digests must be DigestV1")
        if not isinstance(self.response, DriftResponse):
            raise ContractValueError("response must be DriftResponse")
        require_strict_int(self.monitored_generation, field="monitored_generation", minimum=1)
        require_utc_millis(self.observed_at_ms, field="observed_at_ms")
        if not isinstance(self.alarmed, bool):
            raise ContractValueError("alarmed must be boolean")
        if not self.alarmed and self.response is not DriftResponse.WARN:
            raise ContractValueError("a non-alarm may only emit WARN")

    def as_mapping(self) -> dict[str, object]:
        return {
            "alarmId": self.alarm_id,
            "alarmed": self.alarmed,
            "detectorId": self.detector_id,
            "evidenceSha256": self.evidence_digest.hexdigest,
            "layer": self.layer.value,
            "monitoredArtifactSha256": self.monitored_artifact_sha256.hexdigest,
            "monitoredGeneration": self.monitored_generation,
            "monitoredModelId": self.monitored_model_id,
            "monitoredModelRevision": self.monitored_model_revision,
            "monitoredTransitionId": self.monitored_transition_id,
            "observedAtMs": str(self.observed_at_ms),
            "reasonCode": self.reason_code,
            "response": self.response.value,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class RetirementRecordV1:
    retirement_id: str
    model_id: str
    model_revision: str
    artifact_sha256: DigestV1
    reason: str
    last_valid_cohort: str
    successor_or_fallback: str
    rollback_path: str
    evidence_digest: DigestV1
    retired_at_ms: int

    def __post_init__(self) -> None:
        for field_name in ("retirement_id", "model_id", "model_revision"):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.artifact_sha256, DigestV1) or not isinstance(
            self.evidence_digest, DigestV1
        ):
            raise ContractValueError("retirement digests must be DigestV1")
        for field_name in ("reason", "last_valid_cohort", "successor_or_fallback", "rollback_path"):
            _require_text(getattr(self, field_name), field=field_name)
        require_utc_millis(self.retired_at_ms, field="retired_at_ms")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactSha256": self.artifact_sha256.hexdigest,
            "evidenceSha256": self.evidence_digest.hexdigest,
            "lastValidCohort": self.last_valid_cohort,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "reason": self.reason,
            "retiredAtMs": str(self.retired_at_ms),
            "retirementId": self.retirement_id,
            "rollbackPath": self.rollback_path,
            "successorOrFallback": self.successor_or_fallback,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())
