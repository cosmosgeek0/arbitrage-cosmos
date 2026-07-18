"""Fold-bound feature diagnostics for redundancy, stability and attribution.

This module owns exact contracts and aggregation only. Binary64 fitting stays in the
Q10 model engine; every value crossing this boundary is fixed-point or exact-rational.
The authoritative Q14 walk-forward plan supplies train and chronological validation
identities, so feature diagnostics cannot invent a second split or inspect the final
untouched holdout. Matrices retain exact source-cell provenance and posture; synthetic
posture and post-cutoff donor truth fail closed before evidence can become available.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    round_half_even,
)
from quant_edge.features.values import FeatureValueStatus, FeatureValueV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    require_contract_id,
    require_strict_int,
)
from quant_edge.models.engine import (
    DIAGNOSTIC_ALGORITHM_ID,
    DIAGNOSTIC_MODEL_REVISION,
    MAX_DIAGNOSTIC_ARTIFACT_BYTES,
    BoostParams,
    DiagnosticArtifactOutput,
    refit_xgb_classifier_artifact,
    training_mutual_information,
    xgb_classifier_artifact_outputs,
    xgb_classifier_artifact_shapes,
)
from quant_edge.models.quantize import (
    quantize_binary64,
    quantize_binary64_with_abs_error,
    quantize_probability_vector,
    quantize_vector,
)
from quant_edge.validation.samples import SampleSetV1
from quant_edge.validation.splits import FoldStatus, FoldV1, PlanStatus, WalkForwardPlanV1

MAX_DIAGNOSTIC_FEATURES: Final = 256
MAX_DIAGNOSTIC_ROWS: Final = 100_000
MAX_PERMUTATION_REPEATS: Final = 64
MAX_SHAP_LOCAL_ACCURACY_ULPS: Final = 1_000_000
MIN_STABILITY_SLICES: Final = 2
MUTUAL_INFORMATION_ESTIMATOR_ID: Final = "sklearn-1.9-mutual-info-classif"
MUTUAL_INFORMATION_SEED: Final = 7


class DiagnosticStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    UNSUPPORTED = "UNSUPPORTED"
    INVALID = "INVALID"


class DiagnosticFeatureRole(StrEnum):
    ENGINE_BASELINE = "ENGINE_BASELINE"
    CANDIDATE = "CANDIDATE"


class DiagnosticFeatureKind(StrEnum):
    CONTINUOUS = "CONTINUOUS"
    DISCRETE = "DISCRETE"


class AttributionMethod(StrEnum):
    XGBOOST_3_3_EXACT_TREE_SHAP = "XGBOOST_3_3_EXACT_TREE_SHAP"
    EXACT_ADDITIVE_EQUIVALENT = "EXACT_ADDITIVE_EQUIVALENT"


class AttributionDependence(StrEnum):
    TREE_PATH_DEPENDENT = "TREE_PATH_DEPENDENT"
    DECLARED_BACKGROUND = "DECLARED_BACKGROUND"


class AttributionOutputSpace(StrEnum):
    RAW_MARGIN = "RAW_MARGIN"


class ShapeEvidenceStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


class FeatureVariantKind(StrEnum):
    FULL = "FULL"
    FAMILY_ABLATION = "FAMILY_ABLATION"
    ENGINE_ONLY = "ENGINE_ONLY"
    ENGINE_PLUS_CANDIDATE = "ENGINE_PLUS_CANDIDATE"


class FitScope(StrEnum):
    TRAINING_ONLY = "TRAINING_ONLY"


class DiagnosticObligation(StrEnum):
    REGIME_CORRELATION = "REGIME_PEARSON_RANK_DISTANCE_CORRELATION"
    REDUNDANCY_CLUSTERING = "HIERARCHICAL_REDUNDANCY_CLUSTERING"
    VARIANCE_NEAR_CONSTANT = "VARIANCE_AND_NEAR_CONSTANT_CHECKS"
    TRAINING_FOLD_MUTUAL_INFORMATION = "MUTUAL_INFORMATION_IN_TRAINING_FOLDS"
    CHRONOLOGICAL_PERMUTATION = "PERMUTATION_IMPORTANCE_ON_CHRONOLOGICAL_HOLDOUTS"
    ADDITIVE_ATTRIBUTION = "SHAP_OR_EQUIVALENT_ATTRIBUTION"
    SIGN_MONOTONICITY_STABILITY = "SIGN_AND_MONOTONICITY_STABILITY_ACROSS_FOLDS_REGIMES"
    MISSINGNESS_SIGNAL = "MISSINGNESS_AS_SIGNAL_DETECTION"
    FAMILY_ABLATION = "ADVERSARIAL_FAMILY_ABLATION"
    INCREMENTAL_ENGINE_VALUE = "INCREMENTAL_VALUE_AFTER_ENGINE_FEATURES"


@dataclass(frozen=True, slots=True)
class DiagnosticFeatureSpecV1:
    feature_id: str
    family_id: str
    role: DiagnosticFeatureRole
    kind: DiagnosticFeatureKind
    expected_direction: int

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        require_contract_id(self.family_id, field="family_id")
        if not isinstance(self.role, DiagnosticFeatureRole):
            raise ContractValueError("role must be DiagnosticFeatureRole")
        if not isinstance(self.kind, DiagnosticFeatureKind):
            raise ContractValueError("kind must be DiagnosticFeatureKind")
        require_strict_int(
            self.expected_direction,
            field="expected_direction",
            minimum=-1,
            maximum=1,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "expectedDirection": self.expected_direction,
            "familyId": self.family_id,
            "featureId": self.feature_id,
            "kind": self.kind.value,
            "role": self.role.value,
        }


@dataclass(frozen=True, slots=True)
class DiagnosticFeatureCellV1:
    """One source-owned feature fact selected for one diagnostic sample."""

    sample_id: str
    feature_id: str
    source_id: str
    source_revision: str
    source_artifact_sha256: DigestV1
    posture: EvidencePosture
    observation: FeatureValueV1

    def __post_init__(self) -> None:
        for field_name in ("sample_id", "feature_id", "source_id", "source_revision"):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.source_artifact_sha256, DigestV1):
            raise ContractValueError("source_artifact_sha256 must be DigestV1")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        if not isinstance(self.observation, FeatureValueV1):
            raise ContractValueError("observation must be FeatureValueV1")
        if self.observation.feature_id != self.feature_id:
            raise ContractValueError("diagnostic cell feature identity must match observation")

    @property
    def value(self) -> int | None:
        return (
            None
            if self.observation.status is not FeatureValueStatus.AVAILABLE
            else self.observation.value.mantissa
            if self.observation.value is not None
            else None
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "featureId": self.feature_id,
            "observation": self.observation.as_mapping(),
            "posture": self.posture.value,
            "sampleId": self.sample_id,
            "sourceArtifactSha256": self.source_artifact_sha256.hexdigest,
            "sourceId": self.source_id,
            "sourceRevision": self.source_revision,
        }


@dataclass(frozen=True, slots=True)
class DiagnosticMatrixV1:
    dataset_digest: DigestV1
    posture: EvidencePosture
    sample_ids: tuple[str, ...]
    feature_specs: tuple[DiagnosticFeatureSpecV1, ...]
    feature_cells: tuple[tuple[DiagnosticFeatureCellV1, ...], ...]
    regime_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.dataset_digest, DigestV1):
            raise ContractValueError("dataset_digest must be DigestV1")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        if not isinstance(self.sample_ids, tuple) or not (
            1 <= len(self.sample_ids) <= MAX_DIAGNOSTIC_ROWS
        ):
            raise ContractValueError("sample_ids must be a bounded non-empty tuple")
        if len(set(self.sample_ids)) != len(self.sample_ids):
            raise ContractValueError("sample_ids must be unique")
        for sample_id in self.sample_ids:
            require_contract_id(sample_id, field="sample_id")
        if not isinstance(self.feature_specs, tuple) or not (
            1 <= len(self.feature_specs) <= MAX_DIAGNOSTIC_FEATURES
        ):
            raise ContractValueError("feature_specs must be a bounded non-empty tuple")
        feature_ids = tuple(spec.feature_id for spec in self.feature_specs)
        if feature_ids != tuple(sorted(feature_ids)) or len(set(feature_ids)) != len(feature_ids):
            raise ContractValueError("feature_specs must be sorted by unique feature_id")
        if not isinstance(self.feature_cells, tuple) or len(self.feature_cells) != len(
            self.sample_ids
        ):
            raise ContractValueError("feature_cells must align exactly with sample_ids")
        width = len(self.feature_specs)
        for sample_id, cell_row in zip(self.sample_ids, self.feature_cells, strict=True):
            if not isinstance(cell_row, tuple) or len(cell_row) != width:
                raise ContractValueError("every feature cell row must match declared width")
            for feature_id, cell in zip(feature_ids, cell_row, strict=True):
                if not isinstance(cell, DiagnosticFeatureCellV1):
                    raise ContractValueError("feature_cells must contain DiagnosticFeatureCellV1")
                if (
                    cell.sample_id != sample_id
                    or cell.feature_id != feature_id
                    or cell.posture is not self.posture
                ):
                    raise ContractValueError(
                        "diagnostic cells must match matrix sample, feature and posture"
                    )
        if not isinstance(self.regime_ids, tuple) or len(self.regime_ids) != len(
            self.feature_cells
        ):
            raise ContractValueError("regime_ids must align exactly with rows")
        for regime_id in self.regime_ids:
            require_contract_id(regime_id, field="regime_id")

    @property
    def feature_ids(self) -> tuple[str, ...]:
        return tuple(spec.feature_id for spec in self.feature_specs)

    @property
    def family_ids(self) -> tuple[str, ...]:
        return tuple(sorted({spec.family_id for spec in self.feature_specs}))

    @property
    def rows(self) -> tuple[tuple[int | None, ...], ...]:
        return tuple(tuple(cell.value for cell in cell_row) for cell_row in self.feature_cells)

    @property
    def feature_asof_ns(self) -> tuple[tuple[int, ...], ...]:
        return tuple(
            tuple(cell.observation.as_of_ns for cell in cell_row) for cell_row in self.feature_cells
        )

    def cell_for(self, sample_id: str, feature_id: str) -> DiagnosticFeatureCellV1:
        try:
            row_index = self.sample_ids.index(sample_id)
        except ValueError as error:
            raise ContractValueError(f"matrix has no row for {sample_id}") from error
        return self.feature_cells[row_index][self.feature_index(feature_id)]

    def row_for(self, sample_id: str) -> tuple[int | None, ...]:
        try:
            return self.rows[self.sample_ids.index(sample_id)]
        except ValueError as error:
            raise ContractValueError(f"matrix has no row for {sample_id}") from error

    def regime_for(self, sample_id: str) -> str:
        try:
            return self.regime_ids[self.sample_ids.index(sample_id)]
        except ValueError as error:
            raise ContractValueError(f"matrix has no regime for {sample_id}") from error

    def feature_asof_row_for(self, sample_id: str) -> tuple[int, ...]:
        try:
            return self.feature_asof_ns[self.sample_ids.index(sample_id)]
        except ValueError as error:
            raise ContractValueError(f"matrix has no feature lineage for {sample_id}") from error

    def max_feature_asof_for(
        self,
        sample_id: str,
        feature_ids: tuple[str, ...],
    ) -> int:
        if not feature_ids:
            raise ContractValueError("feature lineage requires a non-empty feature selection")
        lineage_row = self.feature_asof_row_for(sample_id)
        return max(lineage_row[self.feature_index(feature_id)] for feature_id in feature_ids)

    def feature_index(self, feature_id: str) -> int:
        try:
            return self.feature_ids.index(feature_id)
        except ValueError as error:
            raise ContractValueError(f"unknown feature {feature_id}") from error

    def as_mapping(self) -> dict[str, object]:
        return {
            "datasetDigest": self.dataset_digest.hexdigest,
            "featureCells": [
                [cell.as_mapping() for cell in cell_row] for cell_row in self.feature_cells
            ],
            "featureSpecs": [spec.as_mapping() for spec in self.feature_specs],
            "posture": self.posture.value,
            "regimeIds": list(self.regime_ids),
            "sampleIds": list(self.sample_ids),
            "schema": "Q14DiagnosticMatrixV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


def build_diagnostic_matrix(
    *,
    samples: SampleSetV1,
    feature_specs: tuple[DiagnosticFeatureSpecV1, ...],
    feature_cells: tuple[tuple[DiagnosticFeatureCellV1, ...], ...],
    regime_ids: tuple[str, ...],
) -> DiagnosticMatrixV1:
    """Build the diagnostic projection from exact source-cell observations."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    matrix = DiagnosticMatrixV1(
        dataset_digest=samples.digest(),
        posture=samples.posture,
        sample_ids=samples.sample_ids,
        feature_specs=feature_specs,
        feature_cells=feature_cells,
        regime_ids=regime_ids,
    )
    for sample_id, lineage_row in zip(
        matrix.sample_ids,
        matrix.feature_asof_ns,
        strict=True,
    ):
        if any(value > samples.by_id(sample_id).cutoff_ns for value in lineage_row):
            raise ContractValueError("diagnostic matrix contains post-cutoff feature truth")
    return matrix


def _require_context(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
) -> None:
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(plan, WalkForwardPlanV1):
        raise ContractValueError("plan must be WalkForwardPlanV1")
    if not isinstance(matrix, DiagnosticMatrixV1):
        raise ContractValueError("matrix must be DiagnosticMatrixV1")
    if plan.status is not PlanStatus.VALID:
        raise ContractValueError("feature diagnostics require a valid walk-forward plan")
    if matrix.posture is not samples.posture:
        raise ContractValueError("diagnostic matrix posture must match the sample set")
    if samples.posture is EvidencePosture.SYNTHETIC:
        raise ContractValueError("synthetic evidence cannot publish available feature diagnostics")
    expected_digest = samples.digest()
    if plan.dataset_digest != expected_digest or matrix.dataset_digest != expected_digest:
        raise ContractValueError("samples, plan and matrix must bind one dataset digest")
    if matrix.sample_ids != samples.sample_ids:
        raise ContractValueError(
            "matrix sample ids must equal the sample set in chronological order"
        )
    for sample_id, lineage_row in zip(
        matrix.sample_ids,
        matrix.feature_asof_ns,
        strict=True,
    ):
        cutoff_ns = samples.by_id(sample_id).cutoff_ns
        if any(value > cutoff_ns for value in lineage_row):
            raise ContractValueError("diagnostic matrix contains post-cutoff feature truth")


def _fold_by_id(plan: WalkForwardPlanV1, fold_id: str) -> FoldV1:
    for fold in plan.folds:
        if fold.fold_id == fold_id:
            if fold.status is not FoldStatus.VALID:
                raise ContractValueError("diagnostic evidence cannot bind an invalid fold")
            return fold
    raise ContractValueError(f"unknown fold id {fold_id}")


def _ratio_mean(values: tuple[ExactRatioV1, ...]) -> ExactRatioV1:
    total = sum((Fraction(value.numerator, value.denominator) for value in values), Fraction())
    mean = total / len(values)
    return make_ratio(mean.numerator, mean.denominator)


def _brier(
    samples: SampleSetV1,
    sample_ids: tuple[str, ...],
    scores: tuple[FixedPointV1, ...],
) -> ExactRatioV1 | None:
    if len(sample_ids) != len(scores):
        raise ContractValueError("scores must align with sample ids")
    squared = 0
    for sample_id, score in zip(sample_ids, scores, strict=True):
        if not isinstance(score, FixedPointV1):
            raise ContractValueError("scores must contain FixedPointV1")
        if not 0 <= score.mantissa <= FIXED_POINT_SCALE:
            raise ContractValueError("diagnostic probability scores must lie in [0, 1]")
        outcome = samples.by_id(sample_id).binary_outcome
        if outcome is None:
            return None
        difference = score.mantissa - int(outcome) * FIXED_POINT_SCALE
        squared += difference * difference
    return make_ratio(squared, len(scores) * FIXED_POINT_SCALE * FIXED_POINT_SCALE)


def _mapping_digest(mapping: dict[str, object]) -> DigestV1:
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def diagnostic_input_digest(
    samples: SampleSetV1,
    matrix: DiagnosticMatrixV1,
    sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
    *,
    include_labels: bool,
) -> DigestV1:
    """Bind exact ordered values; labels are admitted only to the train scope."""

    rows: list[dict[str, object]] = []
    feature_indices = tuple(matrix.feature_index(feature_id) for feature_id in feature_ids)
    for sample_id in sample_ids:
        matrix_row = matrix.row_for(sample_id)
        lineage_row = matrix.feature_asof_row_for(sample_id)
        cutoff_ns = samples.by_id(sample_id).cutoff_ns
        selected_asof = tuple(lineage_row[index] for index in feature_indices)
        if any(value > cutoff_ns for value in selected_asof):
            raise ContractValueError("diagnostic matrix contains post-cutoff feature truth")
        row: dict[str, object] = {
            "featureCells": [
                matrix.cell_for(sample_id, feature_id).as_mapping() for feature_id in feature_ids
            ],
            "sampleId": sample_id,
            "values": [
                None if matrix_row[index] is None else str(matrix_row[index])
                for index in feature_indices
            ],
        }
        if include_labels:
            row["binaryOutcome"] = samples.by_id(sample_id).binary_outcome
        rows.append(row)
    return _mapping_digest(
        {
            "featureIds": list(feature_ids),
            "labelScope": "TRAINING_ONLY" if include_labels else "NOT_READ",
            "rows": rows,
        }
    )


@dataclass(frozen=True, slots=True)
class FoldMutualInformationV1:
    dataset_digest: DigestV1
    matrix_digest: DigestV1
    fold_id: str
    feature_id: str
    estimator_id: str
    seed: int
    train_sample_ids: tuple[str, ...]
    used_train_sample_ids: tuple[str, ...]
    status: DiagnosticStatus
    training_row_count: int
    value_nats: FixedPointV1 | None
    quantization_abs_error: FixedPointV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.dataset_digest, DigestV1) or not isinstance(
            self.matrix_digest, DigestV1
        ):
            raise ContractValueError("mutual-information digests must be DigestV1")
        require_contract_id(self.fold_id, field="fold_id")
        require_contract_id(self.feature_id, field="feature_id")
        require_contract_id(self.estimator_id, field="estimator_id")
        require_strict_int(self.seed, field="seed", minimum=0, maximum=(1 << 128) - 1)
        if not isinstance(self.train_sample_ids, tuple) or not self.train_sample_ids:
            raise ContractValueError("train_sample_ids must be a non-empty tuple")
        if len(set(self.train_sample_ids)) != len(self.train_sample_ids):
            raise ContractValueError("train_sample_ids must be unique")
        if not isinstance(self.used_train_sample_ids, tuple) or not set(
            self.used_train_sample_ids
        ) <= set(self.train_sample_ids):
            raise ContractValueError("used_train_sample_ids must be a tuple subset of train ids")
        if len(set(self.used_train_sample_ids)) != len(self.used_train_sample_ids):
            raise ContractValueError("used_train_sample_ids must be unique")
        for sample_id in self.train_sample_ids:
            require_contract_id(sample_id, field="train sample id")
        for sample_id in self.used_train_sample_ids:
            require_contract_id(sample_id, field="used train sample id")
        if not isinstance(self.status, DiagnosticStatus):
            raise ContractValueError("status must be DiagnosticStatus")
        require_strict_int(self.training_row_count, field="training_row_count", minimum=0)
        available = self.status is DiagnosticStatus.AVAILABLE
        if available and self.training_row_count < 4:
            raise ContractValueError("available mutual information requires at least four rows")
        if available != (
            isinstance(self.value_nats, FixedPointV1)
            and isinstance(self.quantization_abs_error, FixedPointV1)
        ):
            raise ContractValueError("available mutual information must carry value and error")
        if not available and (
            self.value_nats is not None or self.quantization_abs_error is not None
        ):
            raise ContractValueError("unavailable mutual information cannot carry a value")
        if self.value_nats is not None and self.value_nats.mantissa < 0:
            raise ContractValueError("mutual information cannot be negative")


def validate_training_mutual_information(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    reports: tuple[FoldMutualInformationV1, ...],
) -> tuple[FoldMutualInformationV1, ...]:
    """Bind externally fitted MI to every authoritative train fold and feature."""

    _require_context(samples, plan, matrix)
    if not isinstance(reports, tuple):
        raise ContractValueError("reports must be a tuple")
    expected = {
        (fold.fold_id, feature_id) for fold in plan.folds for feature_id in matrix.feature_ids
    }
    observed: set[tuple[str, str]] = set()
    previous: tuple[str, str] | None = None
    for report in reports:
        if not isinstance(report, FoldMutualInformationV1):
            raise ContractValueError("reports must contain FoldMutualInformationV1")
        key = (report.fold_id, report.feature_id)
        if previous is not None and key <= previous:
            raise ContractValueError("mutual-information reports must be sorted and unique")
        previous = key
        fold = _fold_by_id(plan, report.fold_id)
        if report.feature_id not in matrix.feature_ids:
            raise ContractValueError("mutual information references an unknown feature")
        if (
            report.estimator_id != MUTUAL_INFORMATION_ESTIMATOR_ID
            or report.seed != MUTUAL_INFORMATION_SEED
        ):
            raise ContractValueError("mutual information must use the canonical estimator and seed")
        if report.dataset_digest != samples.digest() or report.matrix_digest != matrix.digest():
            raise ContractValueError("mutual information binds the wrong dataset or matrix")
        if report.train_sample_ids != fold.train_sample_ids:
            raise ContractValueError("mutual information must bind exact authoritative train ids")
        feature_index = matrix.feature_index(report.feature_id)
        expected_used_ids = tuple(
            sample_id
            for sample_id in fold.train_sample_ids
            if matrix.row_for(sample_id)[feature_index] is not None
            and samples.by_id(sample_id).binary_outcome is not None
        )
        if report.used_train_sample_ids != expected_used_ids:
            raise ContractValueError(
                "mutual information must use every complete labeled training row"
            )
        if report.training_row_count != len(report.used_train_sample_ids):
            raise ContractValueError("mutual information count must equal used training ids")
        used_rows = tuple(
            (matrix.row_for(sample_id)[feature_index],)
            for sample_id in report.used_train_sample_ids
        )
        used_labels = tuple(
            1 if samples.by_id(sample_id).binary_outcome is True else 0
            for sample_id in report.used_train_sample_ids
        )
        enough = len(used_rows) >= 4 and set(used_labels) == {0, 1}
        expected_measurements: tuple[
            DiagnosticStatus,
            FixedPointV1 | None,
            FixedPointV1 | None,
        ]
        if enough:
            spec = matrix.feature_specs[feature_index]
            replayed = training_mutual_information(
                used_rows,
                used_labels,
                tuple(range(len(used_rows))),
                discrete_features=(spec.kind is DiagnosticFeatureKind.DISCRETE,),
                seed=MUTUAL_INFORMATION_SEED,
            )[0]
            expected_value, expected_error = quantize_binary64_with_abs_error(
                replayed,
                field="verified training mutual information",
            )
            expected_measurements = (
                DiagnosticStatus.AVAILABLE,
                expected_value,
                expected_error,
            )
        else:
            expected_measurements = (
                DiagnosticStatus.DATA_INSUFFICIENT,
                None,
                None,
            )
        if (
            report.status,
            report.value_nats,
            report.quantization_abs_error,
        ) != expected_measurements:
            raise ContractValueError(
                "mutual information must equal exact deterministic training-only replay"
            )
        observed.add(key)
    if observed != expected:
        raise ContractValueError("mutual information must report every fold and feature")
    return reports


@dataclass(frozen=True, slots=True)
class FoldFitManifestV1:
    dataset_digest: DigestV1
    matrix_digest: DigestV1
    plan_digest: DigestV1
    fold_digest: DigestV1
    fold_id: str
    algorithm_id: str
    model_revision: str
    params: tuple[tuple[str, str], ...]
    params_digest: DigestV1
    model_spec_digest: DigestV1
    fit_artifact_digest: DigestV1
    fit_artifact_ubj: bytes
    training_input_digest: DigestV1
    validation_input_digest: DigestV1
    prediction_output_digest: DigestV1
    attribution_output_digest: DigestV1 | None
    expected_value_digest: DigestV1 | None
    fit_scope: FitScope
    seed: int
    train_sample_ids: tuple[str, ...]
    validation_sample_ids: tuple[str, ...]
    feature_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        required_digests = (
            self.dataset_digest,
            self.matrix_digest,
            self.plan_digest,
            self.fold_digest,
            self.params_digest,
            self.model_spec_digest,
            self.fit_artifact_digest,
            self.training_input_digest,
            self.validation_input_digest,
            self.prediction_output_digest,
        )
        if any(not isinstance(value, DigestV1) for value in required_digests):
            raise ContractValueError("manifest digests must be DigestV1")
        if (self.attribution_output_digest is None) != (self.expected_value_digest is None):
            raise ContractValueError(
                "attribution and expected-value digests must be present together"
            )
        if self.attribution_output_digest is not None and not isinstance(
            self.attribution_output_digest, DigestV1
        ):
            raise ContractValueError("attribution_output_digest must be DigestV1 or None")
        if self.expected_value_digest is not None and not isinstance(
            self.expected_value_digest, DigestV1
        ):
            raise ContractValueError("expected_value_digest must be DigestV1 or None")
        if self.fit_scope is not FitScope.TRAINING_ONLY:
            raise ContractValueError("diagnostic fits must declare TRAINING_ONLY scope")
        if (
            not isinstance(self.fit_artifact_ubj, bytes)
            or not 0 < len(self.fit_artifact_ubj) <= MAX_DIAGNOSTIC_ARTIFACT_BYTES
        ):
            raise ContractValueError("fit artifact must be bounded XGBoost UBJ bytes")
        if hashlib.sha256(self.fit_artifact_ubj).hexdigest() != self.fit_artifact_digest.hexdigest:
            raise ContractValueError("fit artifact digest does not bind exact UBJ bytes")
        for field_name in ("fold_id", "algorithm_id", "model_revision"):
            require_contract_id(getattr(self, field_name), field=field_name)
        expected_param_names = (
            "learningRate",
            "maxDepth",
            "minChildWeight",
            "nEstimators",
        )
        if (
            not isinstance(self.params, tuple)
            or any(not isinstance(item, tuple) or len(item) != 2 for item in self.params)
            or tuple(name for name, _ in self.params) != expected_param_names
            or any(not isinstance(value, str) or not value for _, value in self.params)
        ):
            raise ContractValueError("fit params must be the exact sorted XGBoost specification")
        require_strict_int(self.seed, field="seed", minimum=0, maximum=(1 << 128) - 1)
        if not self.train_sample_ids or not self.validation_sample_ids:
            raise ContractValueError("fit manifests require train and validation sample ids")
        if len(set(self.train_sample_ids)) != len(self.train_sample_ids) or len(
            set(self.validation_sample_ids)
        ) != len(self.validation_sample_ids):
            raise ContractValueError("fit sample ids must be unique")
        if set(self.train_sample_ids) & set(self.validation_sample_ids):
            raise ContractValueError("fit train and validation ids must be disjoint")
        if not self.feature_ids or self.feature_ids != tuple(sorted(set(self.feature_ids))):
            raise ContractValueError("fit feature ids must be sorted and unique")
        for sample_id in self.train_sample_ids + self.validation_sample_ids:
            require_contract_id(sample_id, field="fit sample id")
        for feature_id in self.feature_ids:
            require_contract_id(feature_id, field="fit feature id")

    def as_mapping(self) -> dict[str, object]:
        return {
            "algorithmId": self.algorithm_id,
            "attributionOutputDigest": None
            if self.attribution_output_digest is None
            else self.attribution_output_digest.hexdigest,
            "datasetDigest": self.dataset_digest.hexdigest,
            "expectedValueDigest": None
            if self.expected_value_digest is None
            else self.expected_value_digest.hexdigest,
            "featureIds": list(self.feature_ids),
            "fitArtifactDigest": self.fit_artifact_digest.hexdigest,
            "fitArtifactEncoding": "XGBOOST_UBJ",
            "fitScope": self.fit_scope.value,
            "foldId": self.fold_id,
            "foldDigest": self.fold_digest.hexdigest,
            "matrixDigest": self.matrix_digest.hexdigest,
            "modelRevision": self.model_revision,
            "modelSpecDigest": self.model_spec_digest.hexdigest,
            "params": dict(self.params),
            "paramsDigest": self.params_digest.hexdigest,
            "planDigest": self.plan_digest.hexdigest,
            "predictionOutputDigest": self.prediction_output_digest.hexdigest,
            "seed": str(self.seed),
            "trainSampleIds": list(self.train_sample_ids),
            "trainingInputDigest": self.training_input_digest.hexdigest,
            "validationSampleIds": list(self.validation_sample_ids),
            "validationInputDigest": self.validation_input_digest.hexdigest,
        }

    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


def diagnostic_model_spec_digest(manifest: FoldFitManifestV1) -> DigestV1:
    return _mapping_digest(
        {
            "algorithmId": manifest.algorithm_id,
            "featureIds": list(manifest.feature_ids),
            "modelRevision": manifest.model_revision,
            "objective": "binary:logistic",
            "paramsDigest": manifest.params_digest.hexdigest,
            "seed": str(manifest.seed),
            "treeMethod": "hist",
        }
    )


def _manifest_boost_params(manifest: FoldFitManifestV1) -> BoostParams:
    values = dict(manifest.params)

    def bounded_int(name: str, *, minimum: int, maximum: int) -> int:
        raw = values[name]
        try:
            parsed = int(raw)
        except ValueError as error:
            raise ContractValueError(f"fit param {name} must be a canonical integer") from error
        if str(parsed) != raw or not minimum <= parsed <= maximum:
            raise ContractValueError(f"fit param {name} is outside deterministic bounds")
        return parsed

    params = BoostParams(
        max_depth=bounded_int("maxDepth", minimum=1, maximum=16),
        n_estimators=bounded_int("nEstimators", minimum=1, maximum=1_024),
        learning_rate=values["learningRate"],
        min_child_weight=bounded_int("minChildWeight", minimum=1, maximum=1_000_000),
    )
    params.learning_rate_value()
    if params.as_mapping() != values:
        raise ContractValueError("fit params do not match the exact engine specification")
    return params


def _diagnostic_rows(
    matrix: DiagnosticMatrixV1,
    sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
) -> tuple[tuple[int | None, ...], ...]:
    indices = tuple(matrix.feature_index(feature_id) for feature_id in feature_ids)
    return tuple(
        tuple(matrix.row_for(sample_id)[index] for index in indices) for sample_id in sample_ids
    )


def fold_prediction_output_digest(
    validation_sample_ids: tuple[str, ...],
    scores: tuple[FixedPointV1, ...],
    raw_margins: tuple[FixedPointV1, ...],
    max_feature_asof_ns: tuple[int, ...],
) -> DigestV1:
    return _mapping_digest(
        {
            "maxFeatureAsofNs": [str(value) for value in max_feature_asof_ns],
            "rawMargins": [margin.as_mapping() for margin in raw_margins],
            "scores": [score.as_mapping() for score in scores],
            "validationSampleIds": list(validation_sample_ids),
        }
    )


def _require_manifest(
    manifest: FoldFitManifestV1,
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    *,
    include_contributions: bool = False,
) -> tuple[FoldV1, DiagnosticArtifactOutput]:
    if not isinstance(manifest, FoldFitManifestV1):
        raise ContractValueError("manifest must be FoldFitManifestV1")
    fold = _fold_by_id(plan, manifest.fold_id)
    if (
        manifest.dataset_digest != matrix.dataset_digest
        or manifest.matrix_digest != matrix.digest()
    ):
        raise ContractValueError("fit manifest binds the wrong dataset or feature matrix")
    if manifest.plan_digest != plan.digest():
        raise ContractValueError("fit manifest binds the wrong walk-forward plan")
    expected_fold_digest = _mapping_digest(fold.as_mapping())
    if manifest.fold_digest != expected_fold_digest:
        raise ContractValueError("fit manifest binds the wrong fold membership/order")
    if manifest.train_sample_ids != fold.train_sample_ids:
        raise ContractValueError("fit manifest must use the exact authoritative train ids")
    if manifest.validation_sample_ids != fold.validation_sample_ids:
        raise ContractValueError("fit manifest must use exact chronological validation ids")
    if not set(manifest.feature_ids) <= set(matrix.feature_ids):
        raise ContractValueError("fit manifest references an unknown feature")
    if manifest.training_input_digest != diagnostic_input_digest(
        samples,
        matrix,
        manifest.train_sample_ids,
        manifest.feature_ids,
        include_labels=True,
    ):
        raise ContractValueError("fit manifest training input is not the exact training slice")
    if manifest.validation_input_digest != diagnostic_input_digest(
        samples,
        matrix,
        manifest.validation_sample_ids,
        manifest.feature_ids,
        include_labels=False,
    ):
        raise ContractValueError("fit manifest validation input is not the exact evaluation slice")
    if manifest.params_digest != _mapping_digest(dict(manifest.params)):
        raise ContractValueError("fit manifest params digest is inconsistent")
    if manifest.model_spec_digest != diagnostic_model_spec_digest(manifest):
        raise ContractValueError("fit manifest model specification digest is inconsistent")
    if (
        manifest.algorithm_id != DIAGNOSTIC_ALGORITHM_ID
        or manifest.model_revision != DIAGNOSTIC_MODEL_REVISION
    ):
        raise ContractValueError("fit manifest model identity is not the exact Q10 engine")
    params = _manifest_boost_params(manifest)
    train_outcomes = tuple(
        samples.by_id(sample_id).binary_outcome for sample_id in manifest.train_sample_ids
    )
    if any(outcome not in (0, 1) for outcome in train_outcomes):
        raise ContractValueError("fit artifact cannot prove an exact labeled training slice")
    binding, replay = refit_xgb_classifier_artifact(
        _diagnostic_rows(matrix, manifest.train_sample_ids, manifest.feature_ids),
        tuple(1 if outcome is True else 0 for outcome in train_outcomes),
        _diagnostic_rows(matrix, manifest.validation_sample_ids, manifest.feature_ids),
        feature_ids=manifest.feature_ids,
        params=params,
        seed=manifest.seed,
        include_contributions=include_contributions,
    )
    if (
        binding.params_digest != manifest.params_digest.hexdigest
        or binding.model_spec_digest != manifest.model_spec_digest.hexdigest
        or binding.fit_artifact_digest != manifest.fit_artifact_digest.hexdigest
        or binding.fit_artifact_ubj != manifest.fit_artifact_ubj
    ):
        raise ContractValueError(
            "fit artifact is not the deterministic model fitted on the authoritative training slice"
        )
    expected_scores = quantize_probability_vector(
        replay.probabilities,
        field="verified diagnostic probabilities",
    )
    expected_raw_margins = quantize_vector(
        replay.raw_margins,
        field="verified diagnostic raw margins",
    )
    expected_asof = tuple(
        matrix.max_feature_asof_for(sample_id, manifest.feature_ids)
        for sample_id in manifest.validation_sample_ids
    )
    if manifest.prediction_output_digest != fold_prediction_output_digest(
        manifest.validation_sample_ids,
        expected_scores,
        expected_raw_margins,
        expected_asof,
    ):
        raise ContractValueError(
            "fit manifest output is not the deterministic artifact replay on chronological holdout"
        )
    return fold, replay


@dataclass(frozen=True, slots=True)
class FoldPredictionsV1:
    manifest: FoldFitManifestV1
    scores: tuple[FixedPointV1, ...]
    raw_margins: tuple[FixedPointV1, ...]
    max_feature_asof_ns: tuple[int, ...]
    output_digest: DigestV1

    def __post_init__(self) -> None:
        if not isinstance(self.manifest, FoldFitManifestV1):
            raise ContractValueError("manifest must be FoldFitManifestV1")
        count = len(self.manifest.validation_sample_ids)
        if not isinstance(self.scores, tuple) or len(self.scores) != count:
            raise ContractValueError("scores must align with validation sample ids")
        if not isinstance(self.raw_margins, tuple) or len(self.raw_margins) != count:
            raise ContractValueError("raw margins must align with validation sample ids")
        if (
            not isinstance(self.max_feature_asof_ns, tuple)
            or len(self.max_feature_asof_ns) != count
        ):
            raise ContractValueError("feature as-of times must align with validation samples")
        if any(not isinstance(score, FixedPointV1) for score in self.scores):
            raise ContractValueError("scores must contain FixedPointV1")
        if any(not isinstance(margin, FixedPointV1) for margin in self.raw_margins):
            raise ContractValueError("raw margins must contain FixedPointV1")
        for value in self.max_feature_asof_ns:
            require_strict_int(value, field="max_feature_asof_ns")
        if not isinstance(self.output_digest, DigestV1):
            raise ContractValueError("output_digest must be DigestV1")
        if self.output_digest != fold_prediction_output_digest(
            self.manifest.validation_sample_ids,
            self.scores,
            self.raw_margins,
            self.max_feature_asof_ns,
        ):
            raise ContractValueError("prediction output digest does not bind exact output")


def _require_predictions(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    predictions: FoldPredictionsV1,
    *,
    require_manifest_output: bool = True,
    expected_max_feature_asof_ns: tuple[int, ...] | None = None,
) -> FoldV1:
    if not isinstance(predictions, FoldPredictionsV1):
        raise ContractValueError("predictions must be FoldPredictionsV1")
    fold, replay = _require_manifest(predictions.manifest, samples, plan, matrix)
    expected_scores = quantize_probability_vector(
        replay.probabilities,
        field="verified diagnostic probabilities",
    )
    expected_raw_margins = quantize_vector(
        replay.raw_margins,
        field="verified diagnostic raw margins",
    )
    if require_manifest_output and (
        predictions.output_digest != predictions.manifest.prediction_output_digest
        or predictions.scores != expected_scores
        or predictions.raw_margins != expected_raw_margins
    ):
        raise ContractValueError("prediction output does not match exact fitted artifact replay")
    expected_asof = (
        tuple(
            matrix.max_feature_asof_for(sample_id, predictions.manifest.feature_ids)
            for sample_id in fold.validation_sample_ids
        )
        if expected_max_feature_asof_ns is None
        else expected_max_feature_asof_ns
    )
    if predictions.max_feature_asof_ns != expected_asof:
        raise ContractValueError(
            "diagnostic prediction lineage must bind exact feature as-of times"
        )
    for sample_id, asof in zip(
        fold.validation_sample_ids,
        predictions.max_feature_asof_ns,
        strict=True,
    ):
        if asof > samples.by_id(sample_id).cutoff_ns:
            raise ContractValueError("diagnostic prediction uses post-cutoff feature truth")
    return fold


def permutation_evaluation_rows(
    samples: SampleSetV1,
    matrix: DiagnosticMatrixV1,
    *,
    receiver_sample_ids: tuple[str, ...],
    donor_sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
    feature_id: str,
) -> tuple[tuple[int | None, ...], ...]:
    if len(receiver_sample_ids) != len(donor_sample_ids):
        raise ContractValueError("permutation receiver and donor rows must align")
    if matrix.dataset_digest != samples.digest() or matrix.sample_ids != samples.sample_ids:
        raise ContractValueError("permutation samples and matrix must bind one dataset")
    local_index = feature_ids.index(feature_id)
    global_index = matrix.feature_index(feature_id)
    rows = [list(row) for row in _diagnostic_rows(matrix, receiver_sample_ids, feature_ids)]
    for position, (receiver_id, donor_id) in enumerate(
        zip(receiver_sample_ids, donor_sample_ids, strict=True)
    ):
        receiver_cutoff = samples.by_id(receiver_id).cutoff_ns
        donor_cell = matrix.cell_for(donor_id, feature_id)
        if (
            donor_id == receiver_id
            or samples.by_id(donor_id).cutoff_ns > receiver_cutoff
            or donor_cell.observation.as_of_ns > receiver_cutoff
        ):
            raise ContractValueError(
                "permutation donors must be non-identity chronological feature truth"
            )
        rows[position][local_index] = matrix.row_for(donor_id)[global_index]
    return tuple(tuple(row) for row in rows)


def permutation_max_feature_asof_ns(
    samples: SampleSetV1,
    matrix: DiagnosticMatrixV1,
    *,
    receiver_sample_ids: tuple[str, ...],
    donor_sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
    feature_id: str,
) -> tuple[int, ...]:
    """Return exact lineage after donor-cell substitution, rejecting future donors."""

    permutation_evaluation_rows(
        samples,
        matrix,
        receiver_sample_ids=receiver_sample_ids,
        donor_sample_ids=donor_sample_ids,
        feature_ids=feature_ids,
        feature_id=feature_id,
    )
    other_feature_ids = tuple(item for item in feature_ids if item != feature_id)
    result = []
    for receiver_id, donor_id in zip(receiver_sample_ids, donor_sample_ids, strict=True):
        lineage = [matrix.cell_for(donor_id, feature_id).observation.as_of_ns]
        lineage.extend(
            matrix.cell_for(receiver_id, item).observation.as_of_ns for item in other_feature_ids
        )
        result.append(max(lineage))
    return tuple(result)


def permutation_input_digest(
    samples: SampleSetV1,
    matrix: DiagnosticMatrixV1,
    *,
    receiver_sample_ids: tuple[str, ...],
    donor_sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
    feature_id: str,
) -> DigestV1:
    rows = permutation_evaluation_rows(
        samples,
        matrix,
        receiver_sample_ids=receiver_sample_ids,
        donor_sample_ids=donor_sample_ids,
        feature_ids=feature_ids,
        feature_id=feature_id,
    )
    max_feature_asof_ns = permutation_max_feature_asof_ns(
        samples,
        matrix,
        receiver_sample_ids=receiver_sample_ids,
        donor_sample_ids=donor_sample_ids,
        feature_ids=feature_ids,
        feature_id=feature_id,
    )
    return _mapping_digest(
        {
            "donorSampleIds": list(donor_sample_ids),
            "donorSourceCells": [
                matrix.cell_for(donor_id, feature_id).as_mapping() for donor_id in donor_sample_ids
            ],
            "featureId": feature_id,
            "featureIds": list(feature_ids),
            "permutedMaxFeatureAsofNs": [str(value) for value in max_feature_asof_ns],
            "receiverSampleIds": list(receiver_sample_ids),
            "rows": [[None if value is None else str(value) for value in row] for row in rows],
        }
    )


def deterministic_permutation_donor_ids(
    *,
    samples: SampleSetV1,
    matrix: DiagnosticMatrixV1,
    plan_digest: DigestV1,
    fold_id: str,
    feature_id: str,
    repeat_index: int,
    seed: int,
    receiver_sample_ids: tuple[str, ...],
    donor_pool_sample_ids: tuple[str, ...],
) -> tuple[str, ...]:
    """Choose deterministic donors whose feature truth exists by each receiver cutoff."""

    if not isinstance(samples, SampleSetV1) or not isinstance(matrix, DiagnosticMatrixV1):
        raise ContractValueError("permutation donors require samples and matrix")
    if matrix.dataset_digest != samples.digest() or matrix.sample_ids != samples.sample_ids:
        raise ContractValueError("permutation samples and matrix must bind one dataset")
    if not isinstance(plan_digest, DigestV1):
        raise ContractValueError("permutation plan digest must be DigestV1")
    require_contract_id(fold_id, field="fold_id")
    require_contract_id(feature_id, field="feature_id")
    require_strict_int(
        repeat_index,
        field="repeat_index",
        minimum=0,
        maximum=MAX_PERMUTATION_REPEATS - 1,
    )
    require_strict_int(seed, field="seed", minimum=0, maximum=(1 << 128) - 1)
    if (
        not isinstance(receiver_sample_ids, tuple)
        or not 1 <= len(receiver_sample_ids) <= MAX_DIAGNOSTIC_ROWS
        or len(set(receiver_sample_ids)) != len(receiver_sample_ids)
    ):
        raise ContractValueError("permutation receivers must be a bounded tuple of unique IDs")
    for sample_id in receiver_sample_ids:
        require_contract_id(sample_id, field="receiver sample id")
    if (
        not isinstance(donor_pool_sample_ids, tuple)
        or not donor_pool_sample_ids
        or len(donor_pool_sample_ids) > MAX_DIAGNOSTIC_ROWS
        or len(set(donor_pool_sample_ids)) != len(donor_pool_sample_ids)
    ):
        raise ContractValueError("permutation donor pool must be bounded and unique")
    for sample_id in donor_pool_sample_ids:
        require_contract_id(sample_id, field="donor pool sample id")
        samples.by_id(sample_id)
    domain = canonical_json_bytes(
        {
            "domain": "Q070PermutationDonorOrderV1",
            "featureId": feature_id,
            "foldId": fold_id,
            "planDigest": plan_digest.hexdigest,
            "receiverSampleIds": list(receiver_sample_ids),
            "donorPoolSampleIds": list(donor_pool_sample_ids),
            "repeatIndex": str(repeat_index),
            "seed": str(seed),
        }
    )
    donors: list[str] = []
    for receiver_id in receiver_sample_ids:
        receiver_cutoff = samples.by_id(receiver_id).cutoff_ns
        eligible = tuple(
            donor_id
            for donor_id in donor_pool_sample_ids
            if donor_id != receiver_id
            and samples.by_id(donor_id).cutoff_ns <= receiver_cutoff
            and matrix.cell_for(donor_id, feature_id).observation.as_of_ns <= receiver_cutoff
        )
        if not eligible:
            raise ContractValueError(
                "permutation has no non-identity donor available by receiver cutoff"
            )
        donors.append(
            min(
                eligible,
                key=lambda donor_id: (
                    hashlib.sha256(
                        domain
                        + b"\0"
                        + receiver_id.encode("utf-8")
                        + b"\0"
                        + donor_id.encode("utf-8")
                    ).digest(),
                    donor_id,
                ),
            )
        )
    return tuple(donors)


@dataclass(frozen=True, slots=True)
class PermutationManifestV1:
    plan_digest: DigestV1
    input_digest: DigestV1
    fold_id: str
    feature_id: str
    repeat_index: int
    seed: int
    receiver_sample_ids: tuple[str, ...]
    donor_sample_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.plan_digest, DigestV1) or not isinstance(
            self.input_digest, DigestV1
        ):
            raise ContractValueError("permutation digests must be DigestV1")
        require_contract_id(self.fold_id, field="fold_id")
        require_contract_id(self.feature_id, field="feature_id")
        require_strict_int(
            self.repeat_index,
            field="repeat_index",
            minimum=0,
            maximum=MAX_PERMUTATION_REPEATS - 1,
        )
        require_strict_int(self.seed, field="seed", minimum=0, maximum=(1 << 128) - 1)
        if not self.receiver_sample_ids or len(self.receiver_sample_ids) != len(
            self.donor_sample_ids
        ):
            raise ContractValueError("permutation receivers and donors must align")
        if len(set(self.receiver_sample_ids)) != len(self.receiver_sample_ids):
            raise ContractValueError("permutation receivers must be unique")
        for receiver_id, donor_id in zip(
            self.receiver_sample_ids,
            self.donor_sample_ids,
            strict=True,
        ):
            require_contract_id(receiver_id, field="permutation receiver sample id")
            require_contract_id(donor_id, field="permutation donor sample id")
            if receiver_id == donor_id:
                raise ContractValueError("permutation donors must be non-identity")


@dataclass(frozen=True, slots=True)
class PermutationEvidenceV1:
    permutation: PermutationManifestV1
    baseline: FoldPredictionsV1
    permuted: FoldPredictionsV1

    def __post_init__(self) -> None:
        if not isinstance(self.permutation, PermutationManifestV1):
            raise ContractValueError("permutation must be PermutationManifestV1")
        if not isinstance(self.baseline, FoldPredictionsV1) or not isinstance(
            self.permuted, FoldPredictionsV1
        ):
            raise ContractValueError("permutation evidence requires fold predictions")
        if self.baseline.manifest != self.permuted.manifest:
            raise ContractValueError("permutation must reuse the exact same fitted model")
        manifest = self.baseline.manifest
        if self.permutation.fold_id != manifest.fold_id:
            raise ContractValueError("permutation fold must match the fitted model")
        if self.permutation.feature_id not in manifest.feature_ids:
            raise ContractValueError("permutation feature must belong to the fitted model")
        if self.permutation.receiver_sample_ids != manifest.validation_sample_ids:
            raise ContractValueError("permutation receivers must be exact validation ids")


@dataclass(frozen=True, slots=True)
class PermutationImportanceV1:
    feature_id: str
    status: DiagnosticStatus
    fold_count: int
    repeat_count: int
    negative_importance_count: int
    mean_brier_importance: ExactRatioV1 | None


def chronological_permutation_importance(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    evidence: tuple[PermutationEvidenceV1, ...],
) -> tuple[PermutationImportanceV1, ...]:
    """Aggregate same-fit, validation-only Brier degradation for every feature."""

    _require_context(samples, plan, matrix)
    if not isinstance(evidence, tuple) or not evidence:
        raise ContractValueError("permutation evidence must be a non-empty tuple")
    grouped: dict[str, list[ExactRatioV1]] = {feature_id: [] for feature_id in matrix.feature_ids}
    repeats_by_pair: dict[tuple[str, str], set[int]] = {}
    seen: set[tuple[str, str, int]] = set()
    previous: tuple[str, str, int] | None = None
    unknown_features: set[str] = set()
    baseline_by_fold: dict[str, FoldPredictionsV1] = {}
    for item in evidence:
        if not isinstance(item, PermutationEvidenceV1):
            raise ContractValueError("evidence must contain PermutationEvidenceV1")
        key = (
            item.permutation.fold_id,
            item.permutation.feature_id,
            item.permutation.repeat_index,
        )
        if previous is not None and key <= previous:
            raise ContractValueError("permutation evidence must be sorted and unique")
        previous = key
        if item.permutation.plan_digest != plan.digest():
            raise ContractValueError("permutation evidence binds the wrong plan")
        fold = _require_predictions(samples, plan, matrix, item.baseline)
        manifest = item.baseline.manifest
        if item.permutation.seed != manifest.seed:
            raise ContractValueError("permutation seed must match the fitted model seed")
        expected_donors = deterministic_permutation_donor_ids(
            samples=samples,
            matrix=matrix,
            plan_digest=plan.digest(),
            fold_id=item.permutation.fold_id,
            feature_id=item.permutation.feature_id,
            repeat_index=item.permutation.repeat_index,
            seed=item.permutation.seed,
            receiver_sample_ids=item.permutation.receiver_sample_ids,
            donor_pool_sample_ids=(
                *fold.train_sample_ids,
                *fold.validation_sample_ids,
            ),
        )
        if item.permutation.donor_sample_ids != expected_donors:
            raise ContractValueError(
                "permutation donors do not match the deterministic donor order"
            )
        expected_permuted_asof = permutation_max_feature_asof_ns(
            samples,
            matrix,
            receiver_sample_ids=item.permutation.receiver_sample_ids,
            donor_sample_ids=item.permutation.donor_sample_ids,
            feature_ids=manifest.feature_ids,
            feature_id=item.permutation.feature_id,
        )
        _require_predictions(
            samples,
            plan,
            matrix,
            item.permuted,
            require_manifest_output=False,
            expected_max_feature_asof_ns=expected_permuted_asof,
        )
        expected_input_digest = permutation_input_digest(
            samples,
            matrix,
            receiver_sample_ids=item.permutation.receiver_sample_ids,
            donor_sample_ids=item.permutation.donor_sample_ids,
            feature_ids=manifest.feature_ids,
            feature_id=item.permutation.feature_id,
        )
        if item.permutation.input_digest != expected_input_digest:
            raise ContractValueError("permutation input digest does not bind donor-remapped rows")
        replay = xgb_classifier_artifact_outputs(
            manifest.fit_artifact_ubj,
            permutation_evaluation_rows(
                samples,
                matrix,
                receiver_sample_ids=item.permutation.receiver_sample_ids,
                donor_sample_ids=item.permutation.donor_sample_ids,
                feature_ids=manifest.feature_ids,
                feature_id=item.permutation.feature_id,
            ),
        )
        if item.permuted.scores != quantize_probability_vector(
            replay.probabilities,
            field="verified permutation probabilities",
        ) or item.permuted.raw_margins != quantize_vector(
            replay.raw_margins, field="verified permutation raw margins"
        ):
            raise ContractValueError(
                "permutation output is not exact replay of the training-fit artifact"
            )
        prior_baseline = baseline_by_fold.setdefault(key[0], item.baseline)
        if item.baseline != prior_baseline:
            raise ContractValueError("all permutations in one fold must share one baseline")
        seen.add(key)
        repeats_by_pair.setdefault(key[:2], set()).add(key[2])
        baseline = _brier(
            samples, item.baseline.manifest.validation_sample_ids, item.baseline.scores
        )
        permuted = _brier(
            samples, item.permuted.manifest.validation_sample_ids, item.permuted.scores
        )
        if baseline is None or permuted is None:
            unknown_features.add(key[1])
            continue
        grouped[key[1]].append(
            make_ratio(
                permuted.numerator * baseline.denominator
                - baseline.numerator * permuted.denominator,
                permuted.denominator * baseline.denominator,
            )
        )
    expected_pairs = {
        (fold.fold_id, feature_id) for fold in plan.folds for feature_id in matrix.feature_ids
    }
    if set(repeats_by_pair) != expected_pairs:
        raise ContractValueError("permutation evidence must cover every fold and feature")
    repeat_sets = tuple(repeats_by_pair[pair] for pair in sorted(repeats_by_pair))
    first_repeats = repeat_sets[0]
    if first_repeats != set(range(len(first_repeats))) or any(
        repeats != first_repeats for repeats in repeat_sets
    ):
        raise ContractValueError("permutation repeats must be complete and consistent")
    reports = []
    for feature_id in matrix.feature_ids:
        values = tuple(grouped[feature_id])
        status = (
            DiagnosticStatus.DATA_INSUFFICIENT
            if feature_id in unknown_features
            else DiagnosticStatus.AVAILABLE
        )
        reports.append(
            PermutationImportanceV1(
                feature_id=feature_id,
                status=status,
                fold_count=len(plan.folds),
                repeat_count=len(first_repeats),
                negative_importance_count=sum(value.is_negative for value in values),
                mean_brier_importance=(
                    _ratio_mean(values) if status is DiagnosticStatus.AVAILABLE else None
                ),
            )
        )
    return tuple(reports)


def tree_attribution_output_digest(
    *,
    validation_sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
    fit_artifact_digest: DigestV1,
    method: AttributionMethod,
    dependence: AttributionDependence,
    output_space: AttributionOutputSpace,
    raw_margins: tuple[FixedPointV1, ...],
    base_values: tuple[FixedPointV1, ...],
    contributions: tuple[tuple[FixedPointV1, ...], ...],
) -> DigestV1:
    return _mapping_digest(
        {
            "baseValues": [value.as_mapping() for value in base_values],
            "contributions": [[value.as_mapping() for value in row] for row in contributions],
            "dependence": dependence.value,
            "featureIds": list(feature_ids),
            "fitArtifactDigest": fit_artifact_digest.hexdigest,
            "method": method.value,
            "outputSpace": output_space.value,
            "rawMargins": [value.as_mapping() for value in raw_margins],
            "validationSampleIds": list(validation_sample_ids),
        }
    )


def tree_expected_value_digest(
    *,
    fit_artifact_digest: DigestV1,
    base_values: tuple[FixedPointV1, ...],
) -> DigestV1:
    return _mapping_digest(
        {
            "baseValues": [value.as_mapping() for value in base_values],
            "fitArtifactDigest": fit_artifact_digest.hexdigest,
        }
    )


@dataclass(frozen=True, slots=True)
class TreeAttributionSetV1:
    manifest: FoldFitManifestV1
    fit_artifact_digest: DigestV1
    attribution_output_digest: DigestV1
    expected_value_digest: DigestV1
    method: AttributionMethod
    dependence: AttributionDependence
    output_space: AttributionOutputSpace
    raw_margins: tuple[FixedPointV1, ...]
    base_values: tuple[FixedPointV1, ...]
    contributions: tuple[tuple[FixedPointV1, ...], ...]

    def __post_init__(self) -> None:
        if not isinstance(self.manifest, FoldFitManifestV1):
            raise ContractValueError("manifest must be FoldFitManifestV1")
        if any(
            not isinstance(value, DigestV1)
            for value in (
                self.fit_artifact_digest,
                self.attribution_output_digest,
                self.expected_value_digest,
            )
        ):
            raise ContractValueError("tree attribution bindings must be DigestV1")
        if not isinstance(self.method, AttributionMethod):
            raise ContractValueError("method must be AttributionMethod")
        if not isinstance(self.dependence, AttributionDependence):
            raise ContractValueError("dependence must be AttributionDependence")
        if self.output_space is not AttributionOutputSpace.RAW_MARGIN:
            raise ContractValueError("tree attribution output space must be RAW_MARGIN")
        if (
            self.method is AttributionMethod.XGBOOST_3_3_EXACT_TREE_SHAP
            and self.dependence is not AttributionDependence.TREE_PATH_DEPENDENT
        ):
            raise ContractValueError("exact XGBoost TreeSHAP must declare TREE_PATH_DEPENDENT")
        count = len(self.manifest.validation_sample_ids)
        if not all(
            isinstance(values, tuple) and len(values) == count
            for values in (self.raw_margins, self.base_values, self.contributions)
        ):
            raise ContractValueError("tree attribution rows must align with validation ids")
        width = len(self.manifest.feature_ids)
        if any(
            not isinstance(row, tuple)
            or len(row) != width
            or any(not isinstance(value, FixedPointV1) for value in row)
            for row in self.contributions
        ):
            raise ContractValueError("tree contributions must match the fitted feature width")
        if any(not isinstance(value, FixedPointV1) for value in self.raw_margins):
            raise ContractValueError("raw margins must contain FixedPointV1")
        if any(not isinstance(value, FixedPointV1) for value in self.base_values):
            raise ContractValueError("base values must contain FixedPointV1")


@dataclass(frozen=True, slots=True)
class TreeAttributionReportV1:
    fold_id: str
    status: DiagnosticStatus
    sample_count: int
    max_local_accuracy_residual: FixedPointV1
    mean_abs_contribution: tuple[tuple[str, FixedPointV1], ...] | None

    @property
    def causality_claim(self) -> bool:
        return False


def validate_tree_attributions(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    attribution_sets: tuple[TreeAttributionSetV1, ...],
) -> tuple[TreeAttributionReportV1, ...]:
    """Verify additive local accuracy; attribution remains explanation, not causality."""

    _require_context(samples, plan, matrix)
    if not isinstance(attribution_sets, tuple):
        raise ContractValueError("attribution_sets must be a tuple")
    expected_folds = tuple(fold.fold_id for fold in plan.folds)
    if tuple(item.manifest.fold_id for item in attribution_sets) != expected_folds:
        raise ContractValueError("tree attribution must report every fold in order")
    reports = []
    for item in attribution_sets:
        _, verified = _require_manifest(
            item.manifest,
            samples,
            plan,
            matrix,
            include_contributions=True,
        )
        if item.manifest.feature_ids != matrix.feature_ids:
            raise ContractValueError("tree attribution must cover the full feature set")
        verified_raw_margins = quantize_vector(
            verified.raw_margins,
            field="verified TreeSHAP raw margins",
        )
        verified_base_values = tuple(
            quantize_vector((row[-1],), field="verified TreeSHAP expected value")[0]
            for row in verified.contributions_with_bias
        )
        verified_contributions = tuple(
            quantize_vector(row[:-1], field="verified TreeSHAP contributions")
            for row in verified.contributions_with_bias
        )
        residuals = tuple(
            abs(raw.mantissa - base.mantissa - sum(value.mantissa for value in contribution_row))
            for raw, base, contribution_row in zip(
                item.raw_margins,
                item.base_values,
                item.contributions,
                strict=True,
            )
        )
        maximum = max(residuals, default=0)
        observed_output_digest = tree_attribution_output_digest(
            validation_sample_ids=item.manifest.validation_sample_ids,
            feature_ids=item.manifest.feature_ids,
            fit_artifact_digest=item.fit_artifact_digest,
            method=item.method,
            dependence=item.dependence,
            output_space=item.output_space,
            raw_margins=item.raw_margins,
            base_values=item.base_values,
            contributions=item.contributions,
        )
        observed_expected_value_digest = tree_expected_value_digest(
            fit_artifact_digest=item.fit_artifact_digest,
            base_values=item.base_values,
        )
        genuine_binding = (
            item.method is AttributionMethod.XGBOOST_3_3_EXACT_TREE_SHAP
            and item.fit_artifact_digest == item.manifest.fit_artifact_digest
            and item.attribution_output_digest == observed_output_digest
            and item.attribution_output_digest == item.manifest.attribution_output_digest
            and item.expected_value_digest == observed_expected_value_digest
            and item.expected_value_digest == item.manifest.expected_value_digest
            and len({value.mantissa for value in item.base_values}) == 1
            and item.raw_margins == verified_raw_margins
            and item.base_values == verified_base_values
            and item.contributions == verified_contributions
        )
        if item.method is not AttributionMethod.XGBOOST_3_3_EXACT_TREE_SHAP:
            status = DiagnosticStatus.UNSUPPORTED
        elif not genuine_binding or maximum > MAX_SHAP_LOCAL_ACCURACY_ULPS:
            status = DiagnosticStatus.INVALID
        else:
            status = DiagnosticStatus.AVAILABLE
        aggregate = None
        if status is DiagnosticStatus.AVAILABLE:
            aggregate = tuple(
                (
                    feature_id,
                    FixedPointV1(
                        round_half_even(
                            sum(abs(row[index].mantissa) for row in item.contributions),
                            len(item.contributions),
                        )
                    ),
                )
                for index, feature_id in enumerate(item.manifest.feature_ids)
            )
        reports.append(
            TreeAttributionReportV1(
                fold_id=item.manifest.fold_id,
                status=status,
                sample_count=len(item.raw_margins),
                max_local_accuracy_residual=FixedPointV1(maximum),
                mean_abs_contribution=aggregate,
            )
        )
    return tuple(reports)


@dataclass(frozen=True, slots=True)
class FoldFeatureShapeV1:
    manifest: FoldFitManifestV1
    feature_id: str
    regime_id: str
    status: ShapeEvidenceStatus
    signed_effect: FixedPointV1 | None
    comparable_steps: int
    monotonic_violation_count: int

    def __post_init__(self) -> None:
        if not isinstance(self.manifest, FoldFitManifestV1):
            raise ContractValueError("manifest must be FoldFitManifestV1")
        require_contract_id(self.feature_id, field="feature_id")
        require_contract_id(self.regime_id, field="regime_id")
        if not isinstance(self.status, ShapeEvidenceStatus):
            raise ContractValueError("status must be ShapeEvidenceStatus")
        require_strict_int(self.comparable_steps, field="comparable_steps", minimum=0)
        require_strict_int(
            self.monotonic_violation_count,
            field="monotonic_violation_count",
            minimum=0,
        )
        if self.monotonic_violation_count > self.comparable_steps:
            raise ContractValueError("monotonic violations cannot exceed comparable steps")
        if (self.status is ShapeEvidenceStatus.AVAILABLE) != isinstance(
            self.signed_effect, FixedPointV1
        ):
            raise ContractValueError("available shape evidence must carry a signed effect")
        if self.status is ShapeEvidenceStatus.DATA_INSUFFICIENT and (
            self.signed_effect is not None
            or self.comparable_steps != 0
            or self.monotonic_violation_count != 0
        ):
            raise ContractValueError("data-insufficient shape evidence carries no measurements")


@dataclass(frozen=True, slots=True)
class FeatureStabilityV1:
    feature_id: str
    status: DiagnosticStatus
    available_slice_count: int
    positive_slice_count: int
    negative_slice_count: int
    sign_stable: bool | None
    monotonic_stable: bool | None


def sign_monotonicity_stability(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    evidence: tuple[FoldFeatureShapeV1, ...],
) -> tuple[FeatureStabilityV1, ...]:
    _require_context(samples, plan, matrix)
    if not isinstance(evidence, tuple):
        raise ContractValueError("shape evidence must be a tuple")
    expected: set[tuple[str, str, str]] = set()
    for fold in plan.folds:
        regimes = {matrix.regime_for(sample_id) for sample_id in fold.validation_sample_ids}
        expected.update(
            (feature_id, regime_id, fold.fold_id)
            for feature_id in matrix.feature_ids
            for regime_id in regimes
        )
    grouped: dict[str, list[FoldFeatureShapeV1]] = {
        feature_id: [] for feature_id in matrix.feature_ids
    }
    manifest_by_fold: dict[str, FoldFitManifestV1] = {}
    replay_by_fold: dict[
        str,
        dict[
            tuple[str, str],
            tuple[ShapeEvidenceStatus, FixedPointV1 | None, int, int],
        ],
    ] = {}
    observed: set[tuple[str, str, str]] = set()
    previous: tuple[str, str, str] | None = None
    for item in evidence:
        if not isinstance(item, FoldFeatureShapeV1):
            raise ContractValueError("evidence must contain FoldFeatureShapeV1")
        key = (item.feature_id, item.regime_id, item.manifest.fold_id)
        if previous is not None and key <= previous:
            raise ContractValueError("shape evidence must be sorted and unique")
        previous = key
        if item.manifest.feature_ids != matrix.feature_ids:
            raise ContractValueError("shape evidence must come from the full feature fit")
        if key not in expected:
            raise ContractValueError("shape evidence references a foreign fold/regime/feature")
        prior_manifest = manifest_by_fold.setdefault(item.manifest.fold_id, item.manifest)
        if item.manifest != prior_manifest:
            raise ContractValueError("one fold must use one exact full-feature shape artifact")
        if item.manifest.fold_id not in replay_by_fold:
            fold, _ = _require_manifest(item.manifest, samples, plan, matrix)
            regime_order = tuple(
                sorted({matrix.regime_for(sample_id) for sample_id in fold.validation_sample_ids})
            )
            regime_positions = tuple(
                tuple(
                    position
                    for position, sample_id in enumerate(fold.validation_sample_ids)
                    if matrix.regime_for(sample_id) == regime_id
                )
                for regime_id in regime_order
            )
            replayed_shapes = xgb_classifier_artifact_shapes(
                item.manifest.fit_artifact_ubj,
                _diagnostic_rows(
                    matrix,
                    item.manifest.train_sample_ids,
                    item.manifest.feature_ids,
                ),
                _diagnostic_rows(
                    matrix,
                    item.manifest.validation_sample_ids,
                    item.manifest.feature_ids,
                ),
                regime_positions=regime_positions,
            )
            replay_by_fold[item.manifest.fold_id] = {
                (
                    item.manifest.feature_ids[shape.feature_index],
                    regime_order[shape.regime_index],
                ): (
                    ShapeEvidenceStatus.AVAILABLE
                    if shape.signed_effect is not None
                    else ShapeEvidenceStatus.DATA_INSUFFICIENT,
                    None
                    if shape.signed_effect is None
                    else quantize_binary64(
                        shape.signed_effect,
                        field="verified local shape effect",
                    ),
                    shape.comparable_steps,
                    shape.monotonic_violation_count,
                )
                for shape in replayed_shapes
            }
        exact_shape = replay_by_fold[item.manifest.fold_id][(item.feature_id, item.regime_id)]
        if (
            item.status,
            item.signed_effect,
            item.comparable_steps,
            item.monotonic_violation_count,
        ) != exact_shape:
            raise ContractValueError(
                "shape evidence does not match exact training-fit artifact replay"
            )
        observed.add(key)
        grouped[item.feature_id].append(item)
    if observed != expected:
        raise ContractValueError("shape evidence must cover every observed fold/regime slice")
    reports = []
    for feature_id in matrix.feature_ids:
        available = [
            item
            for item in grouped[feature_id]
            if item.status is ShapeEvidenceStatus.AVAILABLE
            and item.signed_effect is not None
            and not item.signed_effect.is_zero
        ]
        positive = sum(item.signed_effect.mantissa > 0 for item in available if item.signed_effect)
        negative = sum(item.signed_effect.mantissa < 0 for item in available if item.signed_effect)
        enough = (
            len(available) >= MIN_STABILITY_SLICES
            and len({item.manifest.fold_id for item in available}) >= MIN_STABILITY_SLICES
        )
        reports.append(
            FeatureStabilityV1(
                feature_id=feature_id,
                status=(
                    DiagnosticStatus.AVAILABLE if enough else DiagnosticStatus.DATA_INSUFFICIENT
                ),
                available_slice_count=len(available),
                positive_slice_count=positive,
                negative_slice_count=negative,
                sign_stable=((positive == 0) != (negative == 0)) if enough else None,
                monotonic_stable=(
                    all(item.monotonic_violation_count == 0 for item in available)
                    if enough
                    else None
                ),
            )
        )
    return tuple(reports)


@dataclass(frozen=True, slots=True)
class FoldFeatureVariantV1:
    kind: FeatureVariantKind
    predictions: FoldPredictionsV1
    excluded_family_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, FeatureVariantKind):
            raise ContractValueError("kind must be FeatureVariantKind")
        if not isinstance(self.predictions, FoldPredictionsV1):
            raise ContractValueError("predictions must be FoldPredictionsV1")
        if self.kind is FeatureVariantKind.FAMILY_ABLATION:
            if self.excluded_family_id is None:
                raise ContractValueError("family ablation must name the excluded family")
            require_contract_id(self.excluded_family_id, field="excluded_family_id")
        elif self.excluded_family_id is not None:
            raise ContractValueError("only family ablations may name an excluded family")


@dataclass(frozen=True, slots=True)
class FamilyAblationReportV1:
    family_id: str
    status: DiagnosticStatus
    fold_count: int
    improved_fold_count: int
    worsened_fold_count: int
    mean_brier_importance: ExactRatioV1 | None


def _require_same_refit_law(
    reference: FoldFitManifestV1,
    challenger: FoldFitManifestV1,
) -> None:
    if (
        reference.dataset_digest,
        reference.fold_id,
        reference.algorithm_id,
        reference.model_revision,
        reference.params_digest,
        reference.seed,
        reference.train_sample_ids,
        reference.validation_sample_ids,
    ) != (
        challenger.dataset_digest,
        challenger.fold_id,
        challenger.algorithm_id,
        challenger.model_revision,
        challenger.params_digest,
        challenger.seed,
        challenger.train_sample_ids,
        challenger.validation_sample_ids,
    ):
        raise ContractValueError("diagnostic refits must preserve model, params, seed and fold")


def family_ablation(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    full_variants: tuple[FoldFeatureVariantV1, ...],
    ablated_variants: tuple[FoldFeatureVariantV1, ...],
) -> tuple[FamilyAblationReportV1, ...]:
    _require_context(samples, plan, matrix)
    full_by_fold: dict[str, FoldFeatureVariantV1] = {}
    for variant in full_variants:
        if variant.kind is not FeatureVariantKind.FULL:
            raise ContractValueError("full_variants must contain FULL variants")
        _require_predictions(samples, plan, matrix, variant.predictions)
        manifest = variant.predictions.manifest
        if manifest.feature_ids != matrix.feature_ids:
            raise ContractValueError("full variants must contain every feature")
        if manifest.fold_id in full_by_fold:
            raise ContractValueError("full variants must be unique by fold")
        full_by_fold[manifest.fold_id] = variant
    if set(full_by_fold) != {fold.fold_id for fold in plan.folds}:
        raise ContractValueError("full variants must cover every fold")
    grouped: dict[str, list[ExactRatioV1]] = {family_id: [] for family_id in matrix.family_ids}
    seen: set[tuple[str, str]] = set()
    for variant in ablated_variants:
        if variant.kind is not FeatureVariantKind.FAMILY_ABLATION:
            raise ContractValueError("ablated_variants must contain FAMILY_ABLATION variants")
        _require_predictions(samples, plan, matrix, variant.predictions)
        family_id = variant.excluded_family_id
        if family_id is None or family_id not in grouped:
            raise ContractValueError("ablation references an unknown family")
        manifest = variant.predictions.manifest
        key = (family_id, manifest.fold_id)
        if key in seen:
            raise ContractValueError("ablation variants must be unique by family and fold")
        seen.add(key)
        full = full_by_fold[manifest.fold_id]
        _require_same_refit_law(full.predictions.manifest, manifest)
        expected_features = tuple(
            spec.feature_id for spec in matrix.feature_specs if spec.family_id != family_id
        )
        if manifest.feature_ids != expected_features:
            raise ContractValueError("ablation must refit with exactly full minus one family")
        if manifest.digest() == full.predictions.manifest.digest():
            raise ContractValueError("ablation must be a distinct refit manifest")
        full_loss = _brier(
            samples,
            full.predictions.manifest.validation_sample_ids,
            full.predictions.scores,
        )
        ablated_loss = _brier(
            samples,
            manifest.validation_sample_ids,
            variant.predictions.scores,
        )
        if full_loss is None or ablated_loss is None:
            continue
        grouped[family_id].append(
            make_ratio(
                ablated_loss.numerator * full_loss.denominator
                - full_loss.numerator * ablated_loss.denominator,
                ablated_loss.denominator * full_loss.denominator,
            )
        )
    expected = {(family_id, fold.fold_id) for family_id in matrix.family_ids for fold in plan.folds}
    if seen != expected:
        raise ContractValueError("ablation evidence must cover every family and fold")
    return tuple(
        FamilyAblationReportV1(
            family_id=family_id,
            status=(
                DiagnosticStatus.AVAILABLE
                if len(grouped[family_id]) == len(plan.folds)
                else DiagnosticStatus.DATA_INSUFFICIENT
            ),
            fold_count=len(grouped[family_id]),
            improved_fold_count=sum(
                not value.is_negative and not value.is_zero for value in grouped[family_id]
            ),
            worsened_fold_count=sum(value.is_negative for value in grouped[family_id]),
            mean_brier_importance=(
                _ratio_mean(tuple(grouped[family_id]))
                if len(grouped[family_id]) == len(plan.folds)
                else None
            ),
        )
        for family_id in matrix.family_ids
    )


@dataclass(frozen=True, slots=True)
class IncrementalEngineValueV1:
    status: DiagnosticStatus
    engine_feature_ids: tuple[str, ...]
    candidate_feature_ids: tuple[str, ...]
    fold_count: int
    improved_fold_count: int
    worsened_fold_count: int
    mean_brier_improvement: ExactRatioV1 | None


def incremental_engine_value(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: DiagnosticMatrixV1,
    engine_variants: tuple[FoldFeatureVariantV1, ...],
    augmented_variants: tuple[FoldFeatureVariantV1, ...],
) -> IncrementalEngineValueV1:
    _require_context(samples, plan, matrix)
    engine_features = tuple(
        spec.feature_id
        for spec in matrix.feature_specs
        if spec.role is DiagnosticFeatureRole.ENGINE_BASELINE
    )
    candidate_features = tuple(
        spec.feature_id
        for spec in matrix.feature_specs
        if spec.role is DiagnosticFeatureRole.CANDIDATE
    )
    if not engine_features or not candidate_features:
        raise ContractValueError("incremental value requires engine and candidate features")
    engine_by_fold: dict[str, FoldFeatureVariantV1] = {}
    augmented_by_fold: dict[str, FoldFeatureVariantV1] = {}
    for variant in engine_variants:
        if variant.kind is not FeatureVariantKind.ENGINE_ONLY:
            raise ContractValueError("engine_variants must contain ENGINE_ONLY variants")
        _require_predictions(samples, plan, matrix, variant.predictions)
        manifest = variant.predictions.manifest
        if manifest.feature_ids != engine_features:
            raise ContractValueError("engine-only fit must preserve the exact engine baseline")
        if manifest.fold_id in engine_by_fold:
            raise ContractValueError("engine-only variants must be unique by fold")
        engine_by_fold[manifest.fold_id] = variant
    for variant in augmented_variants:
        if variant.kind is not FeatureVariantKind.ENGINE_PLUS_CANDIDATE:
            raise ContractValueError("augmented_variants must contain ENGINE_PLUS_CANDIDATE")
        _require_predictions(samples, plan, matrix, variant.predictions)
        manifest = variant.predictions.manifest
        if manifest.feature_ids != matrix.feature_ids:
            raise ContractValueError("augmented fit must contain engine plus every candidate")
        if manifest.fold_id in augmented_by_fold:
            raise ContractValueError("augmented variants must be unique by fold")
        augmented_by_fold[manifest.fold_id] = variant
    expected_folds = {fold.fold_id for fold in plan.folds}
    if set(engine_by_fold) != expected_folds or set(augmented_by_fold) != expected_folds:
        raise ContractValueError("incremental variants must cover every fold")
    values = []
    for fold_id in sorted(expected_folds):
        engine = engine_by_fold[fold_id]
        augmented = augmented_by_fold[fold_id]
        _require_same_refit_law(engine.predictions.manifest, augmented.predictions.manifest)
        if engine.predictions.manifest.digest() == augmented.predictions.manifest.digest():
            raise ContractValueError("incremental comparison requires distinct refit manifests")
        engine_loss = _brier(
            samples,
            engine.predictions.manifest.validation_sample_ids,
            engine.predictions.scores,
        )
        augmented_loss = _brier(
            samples,
            augmented.predictions.manifest.validation_sample_ids,
            augmented.predictions.scores,
        )
        if engine_loss is None or augmented_loss is None:
            continue
        values.append(
            make_ratio(
                engine_loss.numerator * augmented_loss.denominator
                - augmented_loss.numerator * engine_loss.denominator,
                engine_loss.denominator * augmented_loss.denominator,
            )
        )
    available = len(values) == len(plan.folds)
    return IncrementalEngineValueV1(
        status=(DiagnosticStatus.AVAILABLE if available else DiagnosticStatus.DATA_INSUFFICIENT),
        engine_feature_ids=engine_features,
        candidate_feature_ids=candidate_features,
        fold_count=len(values),
        improved_fold_count=sum(not value.is_negative and not value.is_zero for value in values),
        worsened_fold_count=sum(value.is_negative for value in values),
        mean_brier_improvement=_ratio_mean(tuple(values)) if available else None,
    )


@dataclass(frozen=True, slots=True)
class DiagnosticObligationEvidenceV1:
    obligation: DiagnosticObligation
    status: DiagnosticStatus
    evidence_digest: DigestV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.obligation, DiagnosticObligation):
            raise ContractValueError("obligation must be DiagnosticObligation")
        if not isinstance(self.status, DiagnosticStatus):
            raise ContractValueError("status must be DiagnosticStatus")
        if self.evidence_digest is not None and not isinstance(self.evidence_digest, DigestV1):
            raise ContractValueError("evidence_digest must be DigestV1 or null")
        if self.status is DiagnosticStatus.AVAILABLE and self.evidence_digest is None:
            raise ContractValueError("available obligations require an evidence digest")


@dataclass(frozen=True, slots=True)
class FeatureDiagnosticSuiteV1:
    posture: EvidencePosture
    obligations: tuple[DiagnosticObligationEvidenceV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")
        if not isinstance(self.obligations, tuple):
            raise ContractValueError("obligations must be a tuple")
        if any(not isinstance(item, DiagnosticObligationEvidenceV1) for item in self.obligations):
            raise ContractValueError("obligations must contain DiagnosticObligationEvidenceV1")
        expected = tuple(sorted(DiagnosticObligation, key=lambda item: item.value))
        observed = tuple(item.obligation for item in self.obligations)
        if observed != expected:
            raise ContractValueError("diagnostic suite requires all ten obligations exactly once")
        if self.posture is EvidencePosture.SYNTHETIC and any(
            item.status is DiagnosticStatus.AVAILABLE for item in self.obligations
        ):
            raise ContractValueError(
                "synthetic diagnostic suites cannot publish AVAILABLE obligations"
            )

    @property
    def promotion_authority(self) -> bool:
        return False

    def as_mapping(self) -> dict[str, object]:
        return {
            "obligations": [
                {
                    "evidenceSha256": (
                        None if item.evidence_digest is None else item.evidence_digest.hexdigest
                    ),
                    "obligation": item.obligation.value,
                    "status": item.status.value,
                }
                for item in self.obligations
            ],
            "posture": self.posture.value,
            "promotionAuthority": False,
            "schema": "Q14FeatureDiagnosticSuiteV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())
