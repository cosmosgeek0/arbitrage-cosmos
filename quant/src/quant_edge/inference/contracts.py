"""Bounded Q16 local-inference contracts.

These records describe an advisory-only local process.  They carry no strategy,
capital, risk, order, account or promotion authority.  All clocks are injected.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from enum import StrEnum
from typing import Final
from weakref import WeakKeyDictionary

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.primitives import require_utc_millis

MAX_REQUEST_BYTES: Final = 262_144
MAX_RESPONSE_BYTES: Final = 262_144
MAX_BATCH_ROWS: Final = 128
MAX_SYMBOLS: Final = 128
MAX_HORIZONS: Final = 16
MAX_QUEUE_CAPACITY: Final = 256
MAX_CONCURRENCY: Final = 8
MAX_TIMEOUT_MS: Final = 30_000
MAX_REASON_CODES: Final = 64


class _LineageSeal:
    __slots__ = ("__weakref__",)


_VERIFIED_LINEAGE_SEALS: Final[WeakKeyDictionary[_LineageSeal, tuple[object, ...]]] = (
    WeakKeyDictionary()
)


def _seal_serving_lineage(identity: tuple[object, ...]) -> object:
    seal = _LineageSeal()
    _VERIFIED_LINEAGE_SEALS[seal] = identity
    return seal


class RequestOperation(StrEnum):
    ASSESS = "ASSESS"
    BATCH_ASSESS = "BATCH_ASSESS"
    HEALTH = "HEALTH"
    READINESS = "READINESS"
    LINEAGE = "LINEAGE"
    METRICS = "METRICS"


class AdmissionState(StrEnum):
    ENQUEUED = "ENQUEUED"
    REJECTED_QUEUE_FULL = "REJECTED_QUEUE_FULL"
    REJECTED_SERVICE_CLOSED = "REJECTED_SERVICE_CLOSED"


class ModelAvailability(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE_NONLOADABLE = "UNAVAILABLE_NONLOADABLE"
    UNAVAILABLE_INTEGRITY = "UNAVAILABLE_INTEGRITY"
    UNKNOWN = "UNKNOWN"


class ReadinessState(StrEnum):
    READY = "READY"
    READY_ABSTAIN_ONLY = "READY_ABSTAIN_ONLY"
    NOT_READY = "NOT_READY"


class StreamingState(StrEnum):
    NOT_JUSTIFIED = "NOT_JUSTIFIED"


@dataclass(frozen=True, slots=True)
class InferenceLimitsV1:
    request_bytes: int = MAX_REQUEST_BYTES
    response_bytes: int = MAX_RESPONSE_BYTES
    batch_rows: int = MAX_BATCH_ROWS
    symbols: int = MAX_SYMBOLS
    horizons: int = MAX_HORIZONS
    queue_capacity: int = 32
    concurrency: int = 1
    timeout_ms: int = 2_000

    def __post_init__(self) -> None:
        bounds = (
            ("request_bytes", self.request_bytes, 1, MAX_REQUEST_BYTES),
            ("response_bytes", self.response_bytes, 1, MAX_RESPONSE_BYTES),
            ("batch_rows", self.batch_rows, 1, MAX_BATCH_ROWS),
            ("symbols", self.symbols, 1, MAX_SYMBOLS),
            ("horizons", self.horizons, 1, MAX_HORIZONS),
            ("queue_capacity", self.queue_capacity, 1, MAX_QUEUE_CAPACITY),
            ("concurrency", self.concurrency, 1, MAX_CONCURRENCY),
            ("timeout_ms", self.timeout_ms, 1, MAX_TIMEOUT_MS),
        )
        for field, value, minimum, maximum in bounds:
            require_strict_int(value, field=field, minimum=minimum, maximum=maximum)

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchRows": self.batch_rows,
            "concurrency": self.concurrency,
            "horizons": self.horizons,
            "queueCapacity": self.queue_capacity,
            "requestBytes": self.request_bytes,
            "responseBytes": self.response_bytes,
            "symbols": self.symbols,
            "timeoutMs": self.timeout_ms,
        }


@dataclass(frozen=True, slots=True)
class LocalRequestV1:
    request_id: str
    operation: RequestOperation
    generated_at_ms: int
    items: tuple[dict[str, object], ...] = ()

    def __post_init__(self) -> None:
        require_contract_id(self.request_id, field="request_id")
        if not isinstance(self.operation, RequestOperation):
            raise ContractValueError("operation must be RequestOperation")
        require_utc_millis(self.generated_at_ms, field="generated_at_ms")
        if not isinstance(self.items, tuple) or len(self.items) > MAX_BATCH_ROWS:
            raise ContractValueError(f"items must be a tuple of at most {MAX_BATCH_ROWS} rows")
        if any(not isinstance(item, dict) for item in self.items):
            raise ContractValueError("items must contain JSON objects")
        requires_items = self.operation in (
            RequestOperation.ASSESS,
            RequestOperation.BATCH_ASSESS,
        )
        if requires_items != bool(self.items):
            raise ContractValueError(
                "assessment operations require items; read operations forbid them"
            )
        if self.operation is RequestOperation.ASSESS and len(self.items) != 1:
            raise ContractValueError("ASSESS requires exactly one item")

    def as_mapping(self) -> dict[str, object]:
        return {
            "generatedAtMs": self.generated_at_ms,
            "items": list(self.items),
            "operation": self.operation.value,
            "requestId": self.request_id,
            "schema": "Q16LocalInferenceRequestV1",
            "version": 1,
        }

    @classmethod
    def from_mapping(cls, value: dict[str, object], *, limits: InferenceLimitsV1) -> LocalRequestV1:
        if not isinstance(limits, InferenceLimitsV1):
            raise ContractValueError("limits must be InferenceLimitsV1")
        expected = {
            "generatedAtMs",
            "items",
            "operation",
            "requestId",
            "schema",
            "version",
        }
        if set(value) != expected:
            raise ContractValueError("local request fields are not schema-exact")
        if (
            value["schema"] != "Q16LocalInferenceRequestV1"
            or type(value["version"]) is not int
            or value["version"] != 1
        ):
            raise ContractValueError("local request schema/version is unsupported")
        items = value["items"]
        if not isinstance(items, list) or len(items) > limits.batch_rows:
            raise ContractValueError("local request items exceed the bounded batch")
        operation_raw = value["operation"]
        if not isinstance(operation_raw, str):
            raise ContractValueError("local request operation must be text")
        try:
            operation = RequestOperation(operation_raw)
        except (TypeError, ValueError) as error:
            raise ContractValueError("local request operation is unsupported") from error
        request_id = value["requestId"]
        generated_at_ms = value["generatedAtMs"]
        if not isinstance(request_id, str):
            raise ContractValueError("requestId must be text")
        if isinstance(generated_at_ms, bool) or not isinstance(generated_at_ms, int):
            raise ContractValueError("generatedAtMs must be an integer")
        return cls(
            request_id=request_id,
            operation=operation,
            generated_at_ms=generated_at_ms,
            items=tuple(items),
        )


@dataclass(frozen=True, slots=True)
class StageDigestV1:
    stage: str
    schema: str
    digest: DigestV1
    parent_digests: tuple[DigestV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.stage, field="stage")
        require_contract_id(self.schema, field="schema")
        if not isinstance(self.digest, DigestV1):
            raise ContractValueError("digest must be DigestV1")
        if not isinstance(self.parent_digests, tuple) or len(self.parent_digests) > 16:
            raise ContractValueError("parent_digests must be a bounded tuple")
        if any(not isinstance(item, DigestV1) for item in self.parent_digests):
            raise ContractValueError("parent_digests must contain DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "parentSha256": [item.hexdigest for item in self.parent_digests],
            "schema": self.schema,
            "sha256": self.digest.hexdigest,
            "stage": self.stage,
        }


@dataclass(frozen=True, slots=True)
class ServingLineageV1:
    champion_model_id: str
    champion_revision: str
    champion_posture: str
    champion_availability: ModelAvailability
    shadow_model_ids: tuple[str, ...]
    deep_gate: str
    calibration_revision: str
    calibration_available: bool
    dependency_lock_sha256: DigestV1
    manifest_sha256: DigestV1
    _seal: object = dataclass_field(repr=False, compare=False)

    def __post_init__(self) -> None:
        require_contract_id(self.champion_model_id, field="champion_model_id")
        require_contract_id(self.champion_revision, field="champion_revision")
        require_contract_id(self.champion_posture, field="champion_posture")
        if not isinstance(self.champion_availability, ModelAvailability):
            raise ContractValueError("champion_availability must be ModelAvailability")
        if (
            not isinstance(self.shadow_model_ids, tuple)
            or tuple(sorted(set(self.shadow_model_ids))) != self.shadow_model_ids
        ):
            raise ContractValueError("shadow_model_ids must be sorted and unique")
        for item in self.shadow_model_ids:
            require_contract_id(item, field="shadow_model_id")
        require_contract_id(self.deep_gate, field="deep_gate")
        require_contract_id(self.calibration_revision, field="calibration_revision")
        if not isinstance(self.calibration_available, bool):
            raise ContractValueError("calibration_available must be boolean")
        if not isinstance(self.dependency_lock_sha256, DigestV1):
            raise ContractValueError("dependency_lock_sha256 must be DigestV1")
        if not isinstance(self.manifest_sha256, DigestV1):
            raise ContractValueError("manifest_sha256 must be DigestV1")
        identity = (
            self.champion_model_id,
            self.champion_revision,
            self.champion_posture,
            self.champion_availability.value,
            self.shadow_model_ids,
            self.deep_gate,
            self.calibration_revision,
            self.calibration_available,
            self.dependency_lock_sha256.hexdigest,
            self.manifest_sha256.hexdigest,
        )
        if not isinstance(self._seal, _LineageSeal) or (
            _VERIFIED_LINEAGE_SEALS.get(self._seal) != identity
        ):
            raise ContractValueError("serving lineage must come from verified accepted artifacts")

    @property
    def readiness(self) -> ReadinessState:
        if (
            self.champion_availability is ModelAvailability.AVAILABLE
            and self.calibration_available
            and self.champion_posture == "ADVISORY"
        ):
            return ReadinessState.READY
        if (
            self.champion_availability is ModelAvailability.UNAVAILABLE_NONLOADABLE
            and self.champion_posture == "ABSTAIN_UNKNOWN"
        ):
            return ReadinessState.READY_ABSTAIN_ONLY
        return ReadinessState.NOT_READY

    def blocking_reason_codes(self) -> tuple[str, ...]:
        reasons: list[str] = []
        if self.champion_availability is not ModelAvailability.AVAILABLE:
            reasons.append("CHAMPION_PAYLOAD_UNAVAILABLE")
        if not self.calibration_available:
            reasons.append("CALIBRATION_UNAVAILABLE")
        if self.champion_posture == "ABSTAIN_UNKNOWN":
            reasons.append("REGISTRY_POSTURE_ABSTAIN_UNKNOWN")
        if self.deep_gate == "FAIL_DATA_INSUFFICIENT":
            reasons.append("DEEP_DATA_INSUFFICIENT")
        return tuple(sorted(set(reasons)))

    def as_mapping(self) -> dict[str, object]:
        return {
            "calibrationRevision": self.calibration_revision,
            "calibrationAvailable": self.calibration_available,
            "champion": {
                "availability": self.champion_availability.value,
                "modelId": self.champion_model_id,
                "posture": self.champion_posture,
                "revision": self.champion_revision,
            },
            "deepGate": self.deep_gate,
            "dependencyLockSha256": self.dependency_lock_sha256.hexdigest,
            "manifestSha256": self.manifest_sha256.hexdigest,
            "readiness": self.readiness.value,
            "schema": "Q16ServingLineageV1",
            "shadowModelIds": list(self.shadow_model_ids),
            "streaming": StreamingState.NOT_JUSTIFIED.value,
            "version": 1,
        }


@dataclass(frozen=True, slots=True)
class ServiceCountersV1:
    accepted: int = 0
    completed: int = 0
    protocol_errors: int = 0
    abstentions: int = 0
    queue_rejections: int = 0
    service_closed_rejections: int = 0
    timeouts: int = 0
    transport_errors: int = 0

    def __post_init__(self) -> None:
        for field in (
            "accepted",
            "completed",
            "protocol_errors",
            "abstentions",
            "queue_rejections",
            "service_closed_rejections",
            "timeouts",
            "transport_errors",
        ):
            require_strict_int(getattr(self, field), field=field, minimum=0)

    def as_mapping(self, *, queue_depth: int) -> dict[str, object]:
        require_strict_int(queue_depth, field="queue_depth", minimum=0)
        return {
            "abstentions": self.abstentions,
            "accepted": self.accepted,
            "completed": self.completed,
            "protocolErrors": self.protocol_errors,
            "queueDepth": queue_depth,
            "queueRejections": self.queue_rejections,
            "serviceClosedRejections": self.service_closed_rejections,
            "schema": "Q16ServiceMetricsV1",
            "timeouts": self.timeouts,
            "transportErrors": self.transport_errors,
            "version": 1,
        }
