"""Bounded deterministic Q16 local service over the pure inference pipeline."""

from __future__ import annotations

import hashlib
import os
import struct
from contextlib import suppress
from dataclasses import dataclass, replace
from multiprocessing import get_context
from multiprocessing.connection import Connection, wait
from multiprocessing.context import SpawnContext
from multiprocessing.process import BaseProcess
from threading import BoundedSemaphore, Event, RLock
from time import monotonic
from typing import Final

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.inference.contracts import (
    AdmissionState,
    InferenceLimitsV1,
    LocalRequestV1,
    RequestOperation,
    ServiceCountersV1,
    ServingLineageV1,
)
from quant_edge.inference.pipeline import run_inference_pipeline
from quant_edge.inference.protocol import (
    ProtocolBoundaryError,
    ProtocolContractV1,
    protocol_error,
    protocol_json_bytes,
    reject_forbidden_keys,
    strict_json_object,
)
from quant_edge.primitives import require_utc_millis

_WORKER_POLL_SECONDS: Final = 0.01
_WORKER_EXIT_GRACE_SECONDS: Final = 0.1
_WORKER_KILL_GRACE_SECONDS: Final = 1.0
_WORKER_FRAME_MAGIC: Final = b"Q16W"
_WORKER_FRAME_VERSION: Final = 1
_WORKER_STATUS_OK: Final = 1
_WORKER_STATUS_ERROR: Final = 2
_WORKER_FRAME_FLAGS: Final = 0
_WORKER_CONTROL_BYTES: Final = 256
_WORKER_READ_BYTES: Final = 4_096
_WORKER_WRITE_BYTES: Final = 16_384
_WORKER_FRAME_HEADER: Final = struct.Struct("!4sBBH32sI32s4x")
_WORKER_ERROR_CODES: Final = frozenset(
    {"INFERENCE_WORKER_FAILED", "REQUEST_REJECTED", "RESPONSE_LIMIT"}
)


class InferenceWorkerError(QuantEdgeError):
    """A disposable local inference worker failed without exposing child details."""


class _WorkerDeadlineExceeded(Exception):
    pass


class _WorkerCancelled(Exception):
    pass


@dataclass(frozen=True, slots=True)
class _WorkerFrameV1:
    status: int
    body: bytes


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


def _worker_body_limit(*, status: int, response_bytes: int) -> int:
    if status == _WORKER_STATUS_OK:
        return response_bytes
    if status == _WORKER_STATUS_ERROR:
        return _WORKER_CONTROL_BYTES
    raise InferenceWorkerError("inference worker frame status was unsupported")


def _worker_error_bytes(*, request_id: str, code: str) -> bytes:
    if code not in _WORKER_ERROR_CODES:
        raise InferenceWorkerError("inference worker error code was unsupported")
    return protocol_json_bytes(
        {
            "code": code,
            "requestId": request_id,
            "schema": "Q16InferenceWorkerErrorV1",
            "version": 1,
        }
    )


def _require_atomic_worker_pipe(connection: Connection) -> int:
    try:
        pipe_buf = os.fpathconf(connection.fileno(), "PC_PIPE_BUF")
    except (OSError, ValueError) as error:
        raise InferenceWorkerError("inference worker pipe bound was unavailable") from error
    if (
        isinstance(pipe_buf, bool)
        or not isinstance(pipe_buf, int)
        or pipe_buf < _WORKER_FRAME_HEADER.size
    ):
        raise InferenceWorkerError("inference worker pipe cannot atomically frame headers")
    return connection.fileno()


def _worker_frame_header(*, request_id: str, status: int, body: bytes) -> bytes:
    if status not in (_WORKER_STATUS_OK, _WORKER_STATUS_ERROR):
        raise InferenceWorkerError("inference worker frame status was unsupported")
    return _WORKER_FRAME_HEADER.pack(
        _WORKER_FRAME_MAGIC,
        _WORKER_FRAME_VERSION,
        status,
        _WORKER_FRAME_FLAGS,
        hashlib.sha256(request_id.encode("ascii", errors="strict")).digest(),
        len(body),
        hashlib.sha256(body).digest(),
    )


def _write_worker_frame(
    connection: Connection,
    *,
    request_id: str,
    status: int,
    body: bytes,
    response_bytes: int,
) -> None:
    """Write an atomic header followed by a bounded body to a disposable pipe."""

    if type(body) is not bytes or not body:
        raise InferenceWorkerError("inference worker frame body was invalid")
    if len(body) > _worker_body_limit(status=status, response_bytes=response_bytes):
        raise InferenceWorkerError("inference worker frame body exceeded its bound")
    descriptor = _require_atomic_worker_pipe(connection)
    header = _worker_frame_header(request_id=request_id, status=status, body=body)
    if os.write(descriptor, header) != len(header):
        raise InferenceWorkerError("inference worker frame header was truncated")
    view = memoryview(body)
    offset = 0
    while offset < len(view):
        written = os.write(descriptor, view[offset : offset + _WORKER_WRITE_BYTES])
        if written <= 0:
            raise InferenceWorkerError("inference worker frame body was truncated")
        offset += written


def _read_worker_frame(
    connection: Connection,
    *,
    request_id: str,
    response_bytes: int,
    deadline: float,
    closed_event: Event,
    process_sentinel: int | None,
) -> _WorkerFrameV1:
    """Read exactly one bounded worker frame without a blocking framed receive."""

    descriptor = _require_atomic_worker_pipe(connection)
    os.set_blocking(descriptor, False)
    buffered = bytearray()
    expected_total: int | None = None
    expected_status: int | None = None
    expected_digest: bytes | None = None
    maximum_total = _WORKER_FRAME_HEADER.size + max(response_bytes, _WORKER_CONTROL_BYTES) + 1
    saw_eof = False

    while True:
        if closed_event.is_set():
            raise _WorkerCancelled
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise _WorkerDeadlineExceeded

        while len(buffered) < maximum_total:
            try:
                chunk = os.read(
                    descriptor,
                    min(_WORKER_READ_BYTES, maximum_total - len(buffered)),
                )
            except BlockingIOError:
                break
            except OSError as error:
                raise InferenceWorkerError("inference worker pipe read failed") from error
            if not chunk:
                saw_eof = True
                break
            buffered.extend(chunk)

            if expected_total is None and len(buffered) >= _WORKER_FRAME_HEADER.size:
                try:
                    (
                        magic,
                        version,
                        status,
                        flags,
                        correlation_digest,
                        body_length,
                        body_digest,
                    ) = _WORKER_FRAME_HEADER.unpack_from(buffered)
                except struct.error as error:  # pragma: no cover - size is guarded
                    raise InferenceWorkerError(
                        "inference worker frame header was malformed"
                    ) from error
                if (
                    magic != _WORKER_FRAME_MAGIC
                    or version != _WORKER_FRAME_VERSION
                    or flags != _WORKER_FRAME_FLAGS
                ):
                    raise InferenceWorkerError("inference worker frame header was unsupported")
                if (
                    correlation_digest
                    != hashlib.sha256(request_id.encode("ascii", errors="strict")).digest()
                ):
                    raise InferenceWorkerError("inference worker response correlation drifted")
                body_limit = _worker_body_limit(status=status, response_bytes=response_bytes)
                if body_length == 0 or body_length > body_limit:
                    raise InferenceWorkerError("inference worker frame body exceeded its bound")
                expected_status = status
                expected_digest = body_digest
                expected_total = _WORKER_FRAME_HEADER.size + body_length

            if expected_total is not None and len(buffered) > expected_total:
                raise InferenceWorkerError("inference worker emitted trailing frame bytes")

        if len(buffered) >= maximum_total:
            raise InferenceWorkerError("inference worker frame exceeded its bound")
        if saw_eof:
            if expected_total is None or len(buffered) != expected_total:
                raise InferenceWorkerError("inference worker frame ended before completion")
            body = bytes(buffered[_WORKER_FRAME_HEADER.size :])
            if expected_digest is None or hashlib.sha256(body).digest() != expected_digest:
                raise InferenceWorkerError("inference worker frame digest drifted")
            if expected_status is None:  # pragma: no cover - header parse establishes it
                raise InferenceWorkerError("inference worker frame status was missing")
            return _WorkerFrameV1(status=expected_status, body=body)

        waitables: list[Connection | int] = [connection]
        if process_sentinel is not None:
            waitables.append(process_sentinel)
        wait(waitables, timeout=min(_WORKER_POLL_SECONDS, remaining))


def _run_inference_worker(
    connection: Connection,
    request: LocalRequestV1,
    evaluation_time_ms: int,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    response_bytes: int,
) -> None:
    """Execute one bounded assessment request and emit one sanitized frame."""

    status = _WORKER_STATUS_ERROR
    try:
        if request.operation is RequestOperation.ASSESS:
            payload: object = run_inference_pipeline(
                request.items[0],
                lineage=lineage,
                protocol=protocol,
                evaluation_time_ms=evaluation_time_ms,
            ).assessment
        elif request.operation is RequestOperation.BATCH_ASSESS:
            payload = [
                run_inference_pipeline(
                    item,
                    lineage=lineage,
                    protocol=protocol,
                    evaluation_time_ms=evaluation_time_ms,
                ).assessment
                for item in request.items
            ]
        else:
            raise ContractValueError("inference worker accepts assessment operations only")
        response = ServiceResponseV1(
            request_id=request.request_id,
            operation=request.operation,
            generated_at_ms=evaluation_time_ms,
            payload=payload,
        )
        body = protocol_json_bytes(response.as_mapping())
        if len(body) > response_bytes:
            body = _worker_error_bytes(
                request_id=request.request_id,
                code="RESPONSE_LIMIT",
            )
        else:
            status = _WORKER_STATUS_OK
    except (ProtocolBoundaryError, QuantEdgeError, ValueError):
        body = _worker_error_bytes(request_id=request.request_id, code="REQUEST_REJECTED")
    except BaseException:
        body = _worker_error_bytes(
            request_id=request.request_id,
            code="INFERENCE_WORKER_FAILED",
        )
    try:
        _write_worker_frame(
            connection,
            request_id=request.request_id,
            status=status,
            body=body,
            response_bytes=response_bytes,
        )
    finally:
        connection.close()


def _reap_worker(
    process: BaseProcess,
    *,
    terminate: bool,
) -> tuple[bool, bool, int | None]:
    """Bound worker cleanup and report whether force was required."""

    forced = terminate
    if not terminate:
        process.join(timeout=_WORKER_EXIT_GRACE_SECONDS)
    if terminate or process.is_alive():
        forced = True
        if process.is_alive():
            with suppress(ProcessLookupError):
                process.terminate()
        process.join(timeout=_WORKER_EXIT_GRACE_SECONDS)
    if process.is_alive():
        with suppress(ProcessLookupError):
            process.kill()
        process.join(timeout=_WORKER_KILL_GRACE_SECONDS)
    if process.is_alive():
        return False, forced, None
    exit_code = process.exitcode
    process.close()
    return True, forced, exit_code


class LocalInferenceServiceV1:
    """Parent-owned bounded queue with disposable spawned inference workers."""

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
        self._worker_guard = RLock()
        self._closed_event = Event()
        self._worker_context: SpawnContext = get_context("spawn")
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
        self._closed_event.set()
        with self._worker_guard:
            pass
        with self._state_lock:
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

    def _mark_worker_failure(self, *, code: str, close_service: bool = False) -> None:
        with self._state_lock:
            self._last_error_code = code
            if close_service:
                self._closed = True
        if close_service:
            self._closed_event.set()

    def _decode_worker_frame(
        self,
        frame: _WorkerFrameV1,
        *,
        request: LocalRequestV1,
        evaluation_time_ms: int,
    ) -> object:
        if not isinstance(frame, _WorkerFrameV1):
            raise InferenceWorkerError("inference worker response was malformed")
        if frame.status == _WORKER_STATUS_ERROR:
            try:
                error_envelope = strict_json_object(
                    frame.body,
                    maximum_bytes=_WORKER_CONTROL_BYTES,
                )
            except ProtocolBoundaryError as error:
                raise InferenceWorkerError("inference worker error frame was malformed") from error
            if set(error_envelope) != {"code", "requestId", "schema", "version"}:
                raise InferenceWorkerError("inference worker error frame was not schema-exact")
            if (
                error_envelope["schema"] != "Q16InferenceWorkerErrorV1"
                or type(error_envelope["version"]) is not int
                or error_envelope["version"] != 1
                or error_envelope["requestId"] != request.request_id
                or error_envelope["code"] not in _WORKER_ERROR_CODES
            ):
                raise InferenceWorkerError("inference worker error frame was unsupported")
            if error_envelope["code"] == "RESPONSE_LIMIT":
                raise ProtocolBoundaryError("local response exceeds the configured byte limit")
            raise InferenceWorkerError("inference worker rejected the bounded request")
        if frame.status != _WORKER_STATUS_OK:
            raise InferenceWorkerError("inference worker response status was unsupported")
        try:
            response = strict_json_object(
                frame.body,
                maximum_bytes=self._limits.response_bytes,
            )
        except ProtocolBoundaryError as error:
            raise InferenceWorkerError("inference worker response frame was malformed") from error
        if set(response) != {
            "generatedAtMs",
            "operation",
            "payload",
            "requestId",
            "schema",
            "version",
        }:
            raise InferenceWorkerError("inference worker response was not schema-exact")
        if (
            response["schema"] != "Q16LocalInferenceResponseV1"
            or type(response["version"]) is not int
            or response["version"] != 1
            or response["requestId"] != request.request_id
            or response["operation"] != request.operation.value
            or type(response["generatedAtMs"]) is not int
            or response["generatedAtMs"] != evaluation_time_ms
        ):
            raise InferenceWorkerError("inference worker response contract drifted")
        payload = response["payload"]
        if request.operation is RequestOperation.ASSESS:
            if not isinstance(payload, dict):
                raise InferenceWorkerError("inference worker assessment payload was malformed")
            self._protocol.validate_envelope(payload, maximum_bytes=self._limits.response_bytes)
        elif request.operation is RequestOperation.BATCH_ASSESS:
            if (
                not isinstance(payload, list)
                or len(payload) != len(request.items)
                or any(not isinstance(item, dict) for item in payload)
            ):
                raise InferenceWorkerError("inference worker batch payload was malformed")
            for item in payload:
                self._protocol.validate_envelope(item, maximum_bytes=self._limits.response_bytes)
        else:  # pragma: no cover - caller restricts worker operations
            raise InferenceWorkerError("inference worker operation was unsupported")
        return payload

    def _run_assessment_worker(
        self,
        request: LocalRequestV1,
        *,
        evaluation_time_ms: int,
        deadline: float,
    ) -> object:
        with self._worker_guard:
            try:
                receive_connection, send_connection = self._worker_context.Pipe(duplex=False)
            except BaseException as error:
                self._mark_worker_failure(code="INFERENCE_WORKER_START_FAILED")
                raise InferenceWorkerError("inference worker IPC could not be created") from error
            try:
                process = self._worker_context.Process(
                    target=_run_inference_worker,
                    args=(
                        send_connection,
                        request,
                        evaluation_time_ms,
                        self._lineage,
                        self._protocol,
                        self._limits.response_bytes,
                    ),
                    name=f"q16-{request.request_id}",
                    daemon=True,
                )
            except BaseException as error:
                receive_connection.close()
                send_connection.close()
                self._mark_worker_failure(code="INFERENCE_WORKER_START_FAILED")
                raise InferenceWorkerError("inference worker could not be constructed") from error
            started = False
            reaped = False
            try:
                try:
                    process.start()
                except BaseException as error:
                    if process.pid is None:
                        process.close()
                    else:
                        started = True
                        reaped, _forced, _exit_code = _reap_worker(process, terminate=True)
                    self._mark_worker_failure(
                        code="INFERENCE_WORKER_START_FAILED",
                        close_service=not reaped and started,
                    )
                    raise InferenceWorkerError("inference worker could not start") from error
                started = True
                send_connection.close()
                frame: _WorkerFrameV1 | None = None
                frame_error: InferenceWorkerError | None = None
                timed_out = False
                cancelled = False
                try:
                    frame = _read_worker_frame(
                        receive_connection,
                        request_id=request.request_id,
                        response_bytes=self._limits.response_bytes,
                        deadline=deadline,
                        closed_event=self._closed_event,
                        process_sentinel=process.sentinel,
                    )
                except _WorkerDeadlineExceeded:
                    timed_out = True
                except _WorkerCancelled:
                    cancelled = True
                except InferenceWorkerError as error:
                    frame_error = error
                reaped, forced, exit_code = _reap_worker(
                    process,
                    terminate=timed_out or cancelled or frame_error is not None,
                )
                if not reaped:
                    self._mark_worker_failure(
                        code="INFERENCE_WORKER_UNREAPED",
                        close_service=True,
                    )
                    raise InferenceWorkerError("inference worker could not be reaped")
                if timed_out:
                    raise _WorkerDeadlineExceeded
                if cancelled:
                    raise _WorkerCancelled
                if frame_error is not None:
                    self._mark_worker_failure(code="INFERENCE_WORKER_FAILED")
                    raise frame_error
                if frame is None or forced or exit_code != 0:
                    self._mark_worker_failure(code="INFERENCE_WORKER_FAILED")
                    raise InferenceWorkerError("inference worker exited without a clean result")
                try:
                    return self._decode_worker_frame(
                        frame,
                        request=request,
                        evaluation_time_ms=evaluation_time_ms,
                    )
                except InferenceWorkerError:
                    self._mark_worker_failure(code="INFERENCE_WORKER_FAILED")
                    raise
            except BaseException:
                if started and not reaped:
                    reaped, _forced, _exit_code = _reap_worker(process, terminate=True)
                    if not reaped:
                        self._mark_worker_failure(
                            code="INFERENCE_WORKER_UNREAPED",
                            close_service=True,
                        )
                raise
            finally:
                receive_connection.close()
                send_connection.close()

    def _process(
        self,
        request: LocalRequestV1,
        *,
        evaluation_time_ms: int,
        deadline: float,
    ) -> ServiceResponseV1:
        if request.operation in (RequestOperation.ASSESS, RequestOperation.BATCH_ASSESS):
            payload = self._run_assessment_worker(
                request,
                evaluation_time_ms=evaluation_time_ms,
                deadline=deadline,
            )
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
        try:
            try:
                response = self._process(
                    request,
                    evaluation_time_ms=evaluation_time_ms,
                    deadline=deadline,
                )
            except _WorkerDeadlineExceeded:
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
            except _WorkerCancelled:
                with self._state_lock:
                    self._last_error_code = "SERVICE_CLOSED"
                    self._counters = replace(
                        self._counters,
                        service_closed_rejections=(self._counters.service_closed_rejections + 1),
                    )
                return protocol_error(
                    code="SERVICE_CLOSED",
                    message="local inference service closed during processing",
                    occurred_at_ms=evaluation_time_ms,
                    correlation_id=request.request_id,
                    stage="inference",
                )
        finally:
            self._work_slot.release()
            with self._state_lock:
                self._outstanding -= 1
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
