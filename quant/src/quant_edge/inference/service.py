"""Bounded deterministic Q16 local service over the pure inference pipeline."""

from __future__ import annotations

from dataclasses import dataclass, replace
from threading import BoundedSemaphore, Event, RLock, Thread
from time import monotonic

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.inference.contracts import (
    AdmissionState,
    InferenceLimitsV1,
    LocalRequestV1,
    RequestOperation,
    ServiceCountersV1,
    ServingLineageV1,
)
from quant_edge.inference.pipeline import PipelineResultV1, run_inference_pipeline
from quant_edge.inference.protocol import (
    ProtocolBoundaryError,
    ProtocolContractV1,
    protocol_error,
    protocol_json_bytes,
    reject_forbidden_keys,
    strict_json_object,
)
from quant_edge.primitives import require_utc_millis


@dataclass(frozen=True, slots=True)
class AdmissionResultV1:
    state: AdmissionState
    request_id: str
    queue_depth: int

    def __post_init__(self) -> None:
        if not isinstance(self.state, AdmissionState):
            raise ContractValueError("state must be AdmissionState")
        if not isinstance(self.request_id, str) or not self.request_id:
            raise ContractValueError("request_id must be non-empty text")
        if isinstance(self.queue_depth, bool) or not isinstance(self.queue_depth, int):
            raise ContractValueError("queue_depth must be an integer")

    @property
    def accepted(self) -> bool:
        return self.state is AdmissionState.ENQUEUED

    def as_mapping(self) -> dict[str, object]:
        return {
            "queueDepth": self.queue_depth,
            "requestId": self.request_id,
            "state": self.state.value,
        }


@dataclass(frozen=True, slots=True)
class ServiceResponseV1:
    request_id: str
    operation: RequestOperation
    generated_at_ms: int
    payload: object

    def as_mapping(self) -> dict[str, object]:
        return {
            "generatedAtMs": self.generated_at_ms,
            "operation": self.operation.value,
            "payload": self.payload,
            "requestId": self.request_id,
            "schema": "Q16LocalInferenceResponseV1",
            "version": 1,
        }


class LocalInferenceServiceV1:
    """Single-process bounded queue with explicit deterministic draining."""

    def __init__(
        self,
        *,
        limits: InferenceLimitsV1,
        lineage: ServingLineageV1,
        protocol: ProtocolContractV1,
    ) -> None:
        if not isinstance(limits, InferenceLimitsV1):
            raise ContractValueError("limits must be InferenceLimitsV1")
        if not isinstance(lineage, ServingLineageV1):
            raise ContractValueError("lineage must be ServingLineageV1")
        if not isinstance(protocol, ProtocolContractV1):
            raise ContractValueError("protocol must be ProtocolContractV1")
        if limits.concurrency != 1:
            raise ContractValueError("Q16 sequential service requires concurrency=1")
        self._limits = limits
        self._lineage = lineage
        self._protocol = protocol
        self._counters = ServiceCountersV1()
        self._closed = False
        self._state_lock = RLock()
        self._work_slot = BoundedSemaphore(1)
        self._outstanding = 0
        self._last_error_code: str | None = None
        self._last_success_ms: int | None = None

    @property
    def limits(self) -> InferenceLimitsV1:
        return self._limits

    @property
    def queue_depth(self) -> int:
        with self._state_lock:
            return max(0, self._outstanding - 1)

    @property
    def closed(self) -> bool:
        with self._state_lock:
            return self._closed

    @property
    def counters(self) -> ServiceCountersV1:
        with self._state_lock:
            return self._counters

    def close(self) -> None:
        with self._state_lock:
            self._closed = True
            self._last_error_code = "SERVICE_CLOSED"

    def record_transport_failure(self, *, code: str) -> None:
        if code not in ("FRAME_INVALID", "TRANSPORT_TIMEOUT", "TRANSPORT_IO_ERROR"):
            raise ContractValueError("transport failure code is unsupported")
        with self._state_lock:
            self._last_error_code = code
            self._counters = replace(
                self._counters,
                timeouts=self._counters.timeouts + int(code == "TRANSPORT_TIMEOUT"),
                transport_errors=self._counters.transport_errors + 1,
            )

    def record_connection_rejection(self) -> None:
        with self._state_lock:
            self._last_error_code = "CONNECTION_CAPACITY"
            self._counters = replace(
                self._counters,
                queue_rejections=self._counters.queue_rejections + 1,
                transport_errors=self._counters.transport_errors + 1,
            )

    def _health(self, generated_at_ms: int) -> dict[str, object]:
        reasons = self._lineage.blocking_reason_codes()
        return {
            "blockingReasons": [reason.replace("_", " ").lower() for reason in reasons],
            "componentId": "quant-inference-q16",
            "driftState": "UNKNOWN",
            "generatedAtMs": generated_at_ms,
            "lastErrorCode": self._last_error_code or (reasons[0] if reasons else None),
            "lastSuccessMs": self._last_success_ms,
            "modelVersions": {
                "calibration": self._lineage.calibration_revision,
                "champion": (
                    f"{self._lineage.champion_model_id}.{self._lineage.champion_revision}"
                ),
            },
            "queueDepth": self.queue_depth,
            "revision": 0,
            "schema": "EdgeBrainHealthV1",
            "state": "DEGRADED" if reasons else "OK",
            "truthLabel": "SYNTHETIC",
            "version": 1,
        }

    def _readiness(self) -> dict[str, object]:
        blockers = self._lineage.blocking_reason_codes()
        return {
            "advisoryReady": not self._closed and not blockers,
            "blockingReasonCodes": list(blockers),
            "limits": self._limits.as_mapping(),
            "modelReadiness": self._lineage.readiness.value,
            "processReady": not self._closed,
            "safeFallback": "ABSTAIN_UNKNOWN",
            "schema": "Q16ReadinessV1",
            "serviceability": "SAFE_ABSTAIN_ONLY" if blockers else "ADVISORY_READY",
            "version": 1,
        }

    def _assess(self, item: dict[str, object], *, evaluation_time_ms: int) -> PipelineResultV1:
        return run_inference_pipeline(
            item,
            lineage=self._lineage,
            protocol=self._protocol,
            evaluation_time_ms=evaluation_time_ms,
        )

    def _process(self, request: LocalRequestV1, *, evaluation_time_ms: int) -> ServiceResponseV1:
        if request.operation is RequestOperation.ASSESS:
            payload: object = self._assess(
                request.items[0],
                evaluation_time_ms=evaluation_time_ms,
            ).assessment
        elif request.operation is RequestOperation.BATCH_ASSESS:
            payload = [
                self._assess(item, evaluation_time_ms=evaluation_time_ms).assessment
                for item in request.items
            ]
        elif request.operation is RequestOperation.HEALTH:
            payload = self._health(evaluation_time_ms)
            self._protocol.validate_envelope(payload, maximum_bytes=self._limits.response_bytes)
        elif request.operation is RequestOperation.READINESS:
            payload = self._readiness()
        elif request.operation is RequestOperation.LINEAGE:
            payload = self._lineage.as_mapping()
        elif request.operation is RequestOperation.METRICS:
            with self._state_lock:
                payload = self._counters.as_mapping(queue_depth=self.queue_depth)
        else:  # pragma: no cover - enum construction makes this unreachable
            raise ContractValueError("unsupported local inference operation")
        response = ServiceResponseV1(
            request_id=request.request_id,
            operation=request.operation,
            generated_at_ms=evaluation_time_ms,
            payload=payload,
        )
        if len(protocol_json_bytes(response.as_mapping())) > self._limits.response_bytes:
            raise ProtocolBoundaryError("local response exceeds the configured byte limit")
        return response

    def _record_completion(self, response: ServiceResponseV1, *, evaluation_time_ms: int) -> None:
        abstentions = 0
        if response.operation is RequestOperation.ASSESS and isinstance(response.payload, dict):
            abstentions = int(response.payload.get("advisoryAction") == "ABSTAIN_UNKNOWN")
        elif response.operation is RequestOperation.BATCH_ASSESS and isinstance(
            response.payload, list
        ):
            abstentions = sum(
                int(isinstance(item, dict) and item.get("advisoryAction") == "ABSTAIN_UNKNOWN")
                for item in response.payload
            )
        with self._state_lock:
            self._counters = replace(
                self._counters,
                completed=self._counters.completed + 1,
                abstentions=self._counters.abstentions + abstentions,
            )
            self._last_success_ms = evaluation_time_ms

    def handle_request(
        self,
        request: LocalRequestV1,
        *,
        evaluation_time_ms: int,
    ) -> ServiceResponseV1 | dict[str, object]:
        if not isinstance(request, LocalRequestV1):
            raise ContractValueError("request must be LocalRequestV1")
        require_utc_millis(evaluation_time_ms, field="evaluation_time_ms")
        deadline = monotonic() + (self._limits.timeout_ms / 1_000)
        with self._state_lock:
            if self._closed:
                self._last_error_code = "SERVICE_CLOSED"
                self._counters = replace(
                    self._counters,
                    service_closed_rejections=self._counters.service_closed_rejections + 1,
                )
                return protocol_error(
                    code="SERVICE_CLOSED",
                    message="local inference service is closed",
                    occurred_at_ms=evaluation_time_ms,
                    correlation_id=request.request_id,
                    stage="admission",
                )
            if self._outstanding >= self._limits.queue_capacity + self._limits.concurrency:
                self._last_error_code = "QUEUE_FULL"
                self._counters = replace(
                    self._counters,
                    queue_rejections=self._counters.queue_rejections + 1,
                )
                return protocol_error(
                    code="QUEUE_FULL",
                    message="bounded local inference queue is full",
                    occurred_at_ms=evaluation_time_ms,
                    correlation_id=request.request_id,
                    stage="admission",
                    retryable=True,
                )
            self._outstanding += 1
            self._counters = replace(self._counters, accepted=self._counters.accepted + 1)
        acquired = self._work_slot.acquire(timeout=max(0.0, deadline - monotonic()))
        if not acquired:
            with self._state_lock:
                self._outstanding -= 1
                self._last_error_code = "REQUEST_TIMEOUT"
                self._counters = replace(
                    self._counters,
                    timeouts=self._counters.timeouts + 1,
                )
            return protocol_error(
                code="REQUEST_TIMEOUT",
                message="request exceeded the bounded queue wait",
                occurred_at_ms=evaluation_time_ms,
                correlation_id=request.request_id,
                stage="admission",
                retryable=True,
            )
        with self._state_lock:
            if self.closed:
                self._work_slot.release()
                self._outstanding -= 1
                self._last_error_code = "SERVICE_CLOSED"
                self._counters = replace(
                    self._counters,
                    service_closed_rejections=self._counters.service_closed_rejections + 1,
                )
                return protocol_error(
                    code="SERVICE_CLOSED",
                    message="local inference service closed before processing",
                    occurred_at_ms=evaluation_time_ms,
                    correlation_id=request.request_id,
                    stage="admission",
                )
        completed = Event()
        result: list[ServiceResponseV1 | BaseException] = []

        def execute() -> None:
            try:
                result.append(self._process(request, evaluation_time_ms=evaluation_time_ms))
            except BaseException as error:  # worker boundary re-raises on the caller thread
                result.append(error)
            finally:
                self._work_slot.release()
                with self._state_lock:
                    self._outstanding -= 1
                completed.set()

        Thread(target=execute, name=f"q16-{request.request_id}", daemon=True).start()
        if not completed.wait(timeout=max(0.0, deadline - monotonic())):
            with self._state_lock:
                self._last_error_code = "REQUEST_TIMEOUT"
                self._counters = replace(
                    self._counters,
                    timeouts=self._counters.timeouts + 1,
                )
            return protocol_error(
                code="REQUEST_TIMEOUT",
                message="request exceeded the bounded execution deadline",
                occurred_at_ms=evaluation_time_ms,
                correlation_id=request.request_id,
                stage="inference",
                retryable=True,
            )
        outcome = result[0]
        if isinstance(outcome, BaseException):
            raise outcome
        response = outcome
        self._record_completion(response, evaluation_time_ms=evaluation_time_ms)
        return response

    def handle_bytes(self, raw: bytes, *, fallback_now_ms: int) -> bytes:
        try:
            mapping = strict_json_object(raw, maximum_bytes=self._limits.request_bytes)
            reject_forbidden_keys(mapping)
            request = LocalRequestV1.from_mapping(mapping, limits=self._limits)
            response = self.handle_request(request, evaluation_time_ms=fallback_now_ms)
            output = response.as_mapping() if isinstance(response, ServiceResponseV1) else response
        except (ProtocolBoundaryError, QuantEdgeError, ValueError) as error:
            with self._state_lock:
                self._counters = replace(
                    self._counters,
                    protocol_errors=self._counters.protocol_errors + 1,
                )
            output = protocol_error(
                code="REQUEST_REJECTED",
                message="request failed strict bounded validation",
                occurred_at_ms=fallback_now_ms,
                correlation_id=None,
                stage="decode",
            )
            _ = error  # deliberately do not echo raw input or exception details
        encoded = protocol_json_bytes(output)
        if len(encoded) > self._limits.response_bytes:
            raise ProtocolBoundaryError("bounded error/response exceeds configured bytes")
        return encoded
