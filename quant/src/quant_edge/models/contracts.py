"""Public typed contracts for the Q10 transparent-and-boosted model battery.

Every numeric field is an integer, an exact rational or a ``FixedPointV1``;
floats are forbidden here by the lane law. Comparison reports are complete by
construction: every registered model appears exactly once, winners follow the
predeclared primary metric, and an honest challenger loss cannot be dropped.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import DigestV1, require_contract_id

MAX_BATTERY_MODELS = 32
MAX_BATTERY_METRICS = 32


class TargetKind(StrEnum):
    BINARY = "BINARY"
    REGRESSION = "REGRESSION"
    QUANTILE = "QUANTILE"
    RANK = "RANK"


class ModelRole(StrEnum):
    TRANSPARENT_BASELINE = "TRANSPARENT_BASELINE"
    CONTROL = "CONTROL"
    BOOSTED_CHALLENGER = "BOOSTED_CHALLENGER"


class MetricDerivation(StrEnum):
    """How a metric value was produced from the once-quantized predictions."""

    EXACT_RATIONAL = "EXACT_RATIONAL"
    BINARY64 = "BINARY64"


class MetricDirection(StrEnum):
    HIGHER_IS_BETTER = "HIGHER_IS_BETTER"
    LOWER_IS_BETTER = "LOWER_IS_BETTER"


class ProbabilitySemantics(StrEnum):
    CALIBRATED = "CALIBRATED"
    UNCALIBRATED_SCORE = "UNCALIBRATED_SCORE"
    NOT_PROBABILITY = "NOT_PROBABILITY"


class CalibrationMethod(StrEnum):
    NONE = "NONE"
    ISOTONIC_VALIDATION = "ISOTONIC_VALIDATION"


@dataclass(frozen=True, slots=True)
class MetricValueV1:
    name: str
    value: FixedPointV1
    derivation: MetricDerivation
    direction: MetricDirection

    def __post_init__(self) -> None:
        require_contract_id(self.name, field="name")
        if not isinstance(self.value, FixedPointV1):
            raise ContractValueError("value must be FixedPointV1")
        if not isinstance(self.derivation, MetricDerivation):
            raise ContractValueError("derivation must be MetricDerivation")
        if not isinstance(self.direction, MetricDirection):
            raise ContractValueError("direction must be MetricDirection")

    def as_mapping(self) -> dict[str, object]:
        return {
            "derivation": self.derivation.value,
            "direction": self.direction.value,
            "name": self.name,
            "value": self.value.as_mapping(),
        }


def prediction_digest(payload: dict[str, tuple[FixedPointV1, ...]]) -> DigestV1:
    """Digest of the quantized prediction payload, keyed by output name."""

    if not payload:
        raise ContractValueError("prediction payload must be non-empty")
    mapping: dict[str, object] = {}
    for key in sorted(payload):
        vector = payload[key]
        require_contract_id(key, field="prediction output name")
        if not isinstance(vector, tuple) or not vector:
            raise ContractValueError("prediction vectors must be non-empty tuples")
        mapping[key] = [str(item.mantissa) for item in vector]
    return DigestV1(hexdigest=hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def _require_json_safe_param(value: object, *, field: str) -> int | str:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ContractValueError(f"{field} must be an exact integer or string parameter")
    return value


@dataclass(frozen=True, slots=True)
class ModelResultV1:
    """One model's honest, fully-reported outcome on one target's test slice."""

    model_id: str
    target_id: str
    role: ModelRole
    calibration: CalibrationMethod
    probability_semantics: ProbabilitySemantics
    params: tuple[tuple[str, int | str], ...]
    metrics: tuple[MetricValueV1, ...]
    predictions: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.model_id, field="model_id")
        require_contract_id(self.target_id, field="target_id")
        if not isinstance(self.role, ModelRole):
            raise ContractValueError("role must be ModelRole")
        if not isinstance(self.calibration, CalibrationMethod):
            raise ContractValueError("calibration must be CalibrationMethod")
        if not isinstance(self.probability_semantics, ProbabilitySemantics):
            raise ContractValueError("probability_semantics must be ProbabilitySemantics")
        if not isinstance(self.params, tuple):
            raise ContractValueError("params must be a tuple of name/value pairs")
        names = [name for name, _ in self.params]
        if names != sorted(names) or len(set(names)) != len(names):
            raise ContractValueError("params must be sorted by unique name")
        for name, value in self.params:
            require_contract_id(name, field="param name")
            _require_json_safe_param(value, field=f"param {name}")
        if not isinstance(self.metrics, tuple) or not (
            1 <= len(self.metrics) <= MAX_BATTERY_METRICS
        ):
            raise ContractValueError("metrics must be a bounded non-empty tuple")
        metric_names = [metric.name for metric in self.metrics]
        if metric_names != sorted(metric_names) or len(set(metric_names)) != len(metric_names):
            raise ContractValueError("metrics must be sorted by unique name")
        if not isinstance(self.predictions, DigestV1):
            raise ContractValueError("predictions must be DigestV1")

    def metric(self, name: str) -> MetricValueV1:
        for metric in self.metrics:
            if metric.name == name:
                return metric
        raise ContractValueError(f"metric {name} is not reported by {self.model_id}")

    def as_mapping(self) -> dict[str, object]:
        return {
            "calibration": self.calibration.value,
            "metrics": [metric.as_mapping() for metric in self.metrics],
            "modelId": self.model_id,
            "params": dict(self.params),
            "predictionsSha256": self.predictions.hexdigest,
            "probabilitySemantics": self.probability_semantics.value,
            "role": self.role.value,
            "targetId": self.target_id,
        }


@dataclass(frozen=True, slots=True)
class ComparisonReportV1:
    """Complete per-target comparison; losses are preserved by construction."""

    target_id: str
    target_kind: TargetKind
    primary_metric: str
    results: tuple[ModelResultV1, ...]
    winner_model_id: str

    def __post_init__(self) -> None:
        require_contract_id(self.target_id, field="target_id")
        if not isinstance(self.target_kind, TargetKind):
            raise ContractValueError("target_kind must be TargetKind")
        require_contract_id(self.primary_metric, field="primary_metric")
        if not isinstance(self.results, tuple) or not (
            2 <= len(self.results) <= MAX_BATTERY_MODELS
        ):
            raise ContractValueError("results must hold at least two bounded models")
        model_ids = [result.model_id for result in self.results]
        if model_ids != sorted(model_ids) or len(set(model_ids)) != len(model_ids):
            raise ContractValueError("results must be sorted by unique model_id")
        directions = set()
        for result in self.results:
            if result.target_id != self.target_id:
                raise ContractValueError("every result must belong to the report target")
            directions.add(result.metric(self.primary_metric).direction)
        if len(directions) != 1:
            raise ContractValueError("primary metric direction must be consistent")
        if self.winner_model_id != self._computed_winner():
            raise ContractValueError("winner_model_id must follow the primary metric law")

    def _computed_winner(self) -> str:
        direction = self.results[0].metric(self.primary_metric).direction

        def ordered_key(result: ModelResultV1) -> tuple[int, str]:
            mantissa = result.metric(self.primary_metric).value.mantissa
            ordered = -mantissa if direction is MetricDirection.HIGHER_IS_BETTER else mantissa
            return (ordered, result.model_id)

        return min(self.results, key=ordered_key).model_id

    def losing_model_ids(self) -> tuple[str, ...]:
        return tuple(
            result.model_id for result in self.results if result.model_id != self.winner_model_id
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "primaryMetric": self.primary_metric,
            "results": [result.as_mapping() for result in self.results],
            "targetId": self.target_id,
            "targetKind": self.target_kind.value,
            "winnerModelId": self.winner_model_id,
        }


def make_comparison_report(
    *,
    target_id: str,
    target_kind: TargetKind,
    primary_metric: str,
    results: tuple[ModelResultV1, ...],
) -> ComparisonReportV1:
    """Sort results, compute the lawful winner, and build the complete report."""

    ordered = tuple(sorted(results, key=lambda result: result.model_id))
    if not ordered:
        raise ContractValueError("a comparison report needs results")
    direction = ordered[0].metric(primary_metric).direction

    def ordered_key(result: ModelResultV1) -> tuple[int, str]:
        mantissa = result.metric(primary_metric).value.mantissa
        signed = -mantissa if direction is MetricDirection.HIGHER_IS_BETTER else mantissa
        return (signed, result.model_id)

    winner = min(ordered, key=ordered_key).model_id
    return ComparisonReportV1(
        target_id=target_id,
        target_kind=target_kind,
        primary_metric=primary_metric,
        results=ordered,
        winner_model_id=winner,
    )


class BatteryDisposition(StrEnum):
    ADOPT = "ADOPT"
    ADAPT = "ADAPT"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    REJECT = "REJECT"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    WAITING_Q14 = "WAITING_Q14"


@dataclass(frozen=True, slots=True)
class BatteryDispositionRecordV1:
    bullet_id: str
    bullet: str
    disposition: BatteryDisposition
    reason: str
    implemented_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.bullet_id, field="bullet_id")
        if not isinstance(self.bullet, str) or not self.bullet.strip():
            raise ContractValueError("bullet must be non-empty text")
        if not isinstance(self.disposition, BatteryDisposition):
            raise ContractValueError("disposition must be BatteryDisposition")
        if not isinstance(self.reason, str) or not self.reason.strip():
            raise ContractValueError("reason must be non-empty text")
        if not isinstance(self.implemented_ids, tuple) or (
            tuple(sorted(self.implemented_ids)) != self.implemented_ids
        ):
            raise ContractValueError("implemented_ids must be a sorted tuple")
        implemented = self.disposition in (BatteryDisposition.ADOPT, BatteryDisposition.ADAPT)
        if implemented != bool(self.implemented_ids):
            raise ContractValueError("ids exist exactly for ADOPT/ADAPT dispositions")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bullet": self.bullet,
            "bulletId": self.bullet_id,
            "disposition": self.disposition.value,
            "implementedIds": list(self.implemented_ids),
            "reason": self.reason,
        }


def disposition_table_digest(records: tuple[BatteryDispositionRecordV1, ...]) -> DigestV1:
    if not records:
        raise ContractValueError("disposition table must be non-empty")
    bullet_ids = [record.bullet_id for record in records]
    if bullet_ids != sorted(bullet_ids) or len(set(bullet_ids)) != len(bullet_ids):
        raise ContractValueError("disposition records must be sorted by unique bullet_id")
    payload = canonical_json_bytes([record.as_mapping() for record in records])
    return DigestV1(hexdigest=hashlib.sha256(payload).hexdigest())
