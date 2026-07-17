"""Q17 bounded local benchmark with explicit synthetic-only semantics.

The benchmark times the accepted Q16 advisory service.  It deliberately repeats
one BNBUSDT synthetic fixture to exercise the Q00 capacity shape; it does not
claim distinct symbols, an observed event trace, a current universe, or a
production latency service level.  Runtime samples are evidence captured once,
not deterministic golden bytes.
"""

from __future__ import annotations

import copy
import hashlib
import os
import platform
import resource
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from fractions import Fraction
from functools import partial
from pathlib import Path
from threading import Barrier, BrokenBarrierError, Event, Thread
from time import monotonic, perf_counter_ns
from typing import Protocol, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import QuantEdgeError
from quant_edge.inference.artifacts import build_serving_manifest, load_serving_lineage
from quant_edge.inference.contracts import (
    InferenceLimitsV1,
    LocalRequestV1,
    RequestOperation,
    ServingLineageV1,
)
from quant_edge.inference.pipeline import run_inference_pipeline
from quant_edge.inference.protocol import (
    ProtocolContractV1,
    protocol_digest,
    strict_json_object,
)
from quant_edge.inference.service import LocalInferenceServiceV1, ServiceResponseV1

NANOSECONDS_PER_SECOND = 1_000_000_000
PROVISIONAL_PEAK_RSS_CEILING_BYTES = 8 * 1024 * 1024 * 1024
MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991
LOAD_ROWS = {
    "candidate": 128,
    "deepFocus": 10,
    "focus": 25,
    "single": 1,
    "universeWatch": 452,
}
MEASUREMENT_ORDER = (
    "single",
    "deepFocus",
    "focus",
    "candidate",
    "universeWatch",
)
PERCENTILE_LAW = "NEAREST_RANK_CEILING"
ACTUAL_CAPTURE_MODE = "ACTUAL_RUNTIME"
INJECTED_CAPTURE_MODE = "INJECTED_TEST_SEAM"
DIRECT_HANDLE_SCOPE = "PARENT_DIRECT_HANDLE_SPAWNED_ONE_SHOT_WORKER_NO_JSON_OR_SOCKET"
COLD_CONSTRUCTION_SCOPE = "SERVICE_CONSTRUCTION_ONLY_SPAWN_CONTEXT_SELECTED_NO_WORKER_STARTED"
SERVICE_CLOSE_SCOPE = "PARENT_CLOSE_SIGNAL_AND_IDLE_WORKER_GUARD_ONLY_NO_TRANSPORT"
POST_KILL_REAP_TIMEOUT_MS = 1_000


class BenchmarkError(QuantEdgeError):
    """Raised when benchmark evidence is invalid or cannot be captured safely."""


class ChildProcess(Protocol):
    """Minimal child-process surface used by the timeout-safe runner."""

    @property
    def returncode(self) -> int | None: ...

    def communicate(
        self,
        input: bytes | None = None,
        timeout: float | None = None,
    ) -> tuple[bytes, bytes]: ...

    def kill(self) -> None: ...


ClockNs = Callable[[], int]
ChildRunner = Callable[[Path, "BenchmarkConfigV1"], dict[str, object]]
SpawnChild = Callable[[tuple[str, ...], Path], ChildProcess]


def _strict_int(
    value: object,
    *,
    field: str,
    minimum: int,
    maximum: int = MAX_SAFE_JSON_INTEGER,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BenchmarkError(f"{field} must be an integer")
    if not minimum <= value <= maximum:
        raise BenchmarkError(f"{field} is outside the bounded range")
    return value


@dataclass(frozen=True, slots=True)
class BenchmarkConfigV1:
    """Explicit, bounded benchmark profile; load capacities are frozen constants."""

    warmup_iterations: int = 2
    measurement_samples: int = 3
    batch_limit: int = 32
    queue_capacity: int = 2
    request_timeout_ms: int = 30_000
    child_timeout_ms: int = 60_000
    queue_probe_timeout_ms: int = 5_000

    def __post_init__(self) -> None:
        _strict_int(
            self.warmup_iterations,
            field="warmup_iterations",
            minimum=1,
            maximum=32,
        )
        _strict_int(
            self.measurement_samples,
            field="measurement_samples",
            minimum=1,
            maximum=32,
        )
        _strict_int(self.batch_limit, field="batch_limit", minimum=1, maximum=32)
        if self.batch_limit != 32:
            raise BenchmarkError("Q17 benchmark batch_limit is frozen at 32 rows")
        _strict_int(self.queue_capacity, field="queue_capacity", minimum=1, maximum=32)
        _strict_int(
            self.request_timeout_ms,
            field="request_timeout_ms",
            minimum=1_000,
            maximum=30_000,
        )
        _strict_int(
            self.child_timeout_ms,
            field="child_timeout_ms",
            minimum=1_000,
            maximum=120_000,
        )
        _strict_int(
            self.queue_probe_timeout_ms,
            field="queue_probe_timeout_ms",
            minimum=1_000,
            maximum=30_000,
        )
        if self.queue_probe_timeout_ms >= self.request_timeout_ms:
            raise BenchmarkError("queue probe timeout must precede the request timeout")

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchLimit": self.batch_limit,
            "childTimeoutMs": self.child_timeout_ms,
            "measurementSamples": self.measurement_samples,
            "percentileLaw": PERCENTILE_LAW,
            "queueCapacity": self.queue_capacity,
            "queueProbeTimeoutMs": self.queue_probe_timeout_ms,
            "requestTimeoutMs": self.request_timeout_ms,
            "warmupIterations": self.warmup_iterations,
        }


DEFAULT_BENCHMARK_CONFIG = BenchmarkConfigV1()


def _nearest_rank(samples: tuple[int, ...], percentile: int) -> int:
    rank = ((percentile * len(samples)) + 99) // 100
    return sorted(samples)[rank - 1]


def summarize_samples(samples: Sequence[int], *, items_per_sample: int) -> dict[str, object]:
    """Return integer-only raw samples, nearest-rank latency and rational throughput."""

    values = tuple(_strict_int(value, field="sampleNs", minimum=1) for value in tuple(samples))
    if not values:
        raise BenchmarkError("latency samples must be non-empty")
    items = _strict_int(items_per_sample, field="items_per_sample", minimum=1)
    total_ns = sum(values)
    total_items = items * len(values)
    throughput = Fraction(total_items * NANOSECONDS_PER_SECOND, total_ns)
    return {
        "itemsPerSample": items,
        "maximumNs": max(values),
        "minimumNs": min(values),
        "p50Ns": _nearest_rank(values, 50),
        "p95Ns": _nearest_rank(values, 95),
        "p99Ns": _nearest_rank(values, 99),
        "rawNs": list(values),
        "sampleCount": len(values),
        "totalItems": total_items,
        "totalNs": total_ns,
        "throughput": {
            "denominator": throughput.denominator,
            "numerator": throughput.numerator,
            "unit": "ITEMS_PER_SECOND",
        },
    }


def measure_positive_ns(action: Callable[[], object], *, clock: ClockNs = perf_counter_ns) -> int:
    """Measure one action and reject ambiguous, non-monotone or non-integer clocks."""

    if not callable(action) or not callable(clock):
        raise BenchmarkError("action and clock must be callable")
    start = clock()
    _strict_int(start, field="clock start", minimum=0)
    action()
    end = clock()
    _strict_int(end, field="clock end", minimum=0)
    elapsed = end - start
    if elapsed <= 0:
        raise BenchmarkError("benchmark clock must produce a positive elapsed duration")
    return elapsed


def _sha256_file(path: Path, *, field: str) -> str:
    if not isinstance(path, Path) or not path.is_file() or path.is_symlink():
        raise BenchmarkError(f"{field} must be a regular file")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha256_mapping(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _chunks(rows: int, limit: int) -> tuple[int, ...]:
    remaining = _strict_int(rows, field="rows", minimum=1)
    bounded_limit = _strict_int(limit, field="limit", minimum=1, maximum=32)
    chunks: list[int] = []
    while remaining:
        chunk = min(remaining, bounded_limit)
        chunks.append(chunk)
        remaining -= chunk
    return tuple(chunks)


def _expected_counters(*, requests: int, assessments: int) -> dict[str, object]:
    return {
        "abstentions": assessments,
        "accepted": requests,
        "completed": requests,
        "protocolErrors": 0,
        "queueDepth": 0,
        "queueRejections": 0,
        "schema": "Q16ServiceMetricsV1",
        "serviceClosedRejections": 0,
        "timeouts": 0,
        "transportErrors": 0,
        "version": 1,
    }


def _require_exact_counters(
    value: object,
    *,
    expected: dict[str, object],
    field: str,
) -> dict[str, object]:
    counters = _exact(
        value,
        keys={
            "abstentions",
            "accepted",
            "completed",
            "protocolErrors",
            "queueDepth",
            "queueRejections",
            "schema",
            "serviceClosedRejections",
            "timeouts",
            "transportErrors",
            "version",
        },
        field=field,
    )
    for name in (
        "abstentions",
        "accepted",
        "completed",
        "protocolErrors",
        "queueDepth",
        "queueRejections",
        "serviceClosedRejections",
        "timeouts",
        "transportErrors",
        "version",
    ):
        _strict_int(counters[name], field=f"{field}.{name}", minimum=0)
    if counters != expected:
        raise BenchmarkError(f"{field} does not match the exact expected counter state")
    return counters


def _request(
    *,
    request_id: str,
    operation: RequestOperation,
    generated_at_ms: int,
    rows: tuple[dict[str, object], ...],
) -> LocalRequestV1:
    return LocalRequestV1(
        request_id=request_id,
        operation=operation,
        generated_at_ms=generated_at_ms,
        items=rows,
    )


def _golden_workload(
    *,
    quant_root: Path,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    generated_at_ms: int,
) -> tuple[dict[str, object], dict[str, object]]:
    golden_path = quant_root / "generated" / "q16" / "edge_assessment.v1.json"
    golden = strict_json_object(golden_path.read_bytes(), maximum_bytes=262_144)
    pipeline = run_inference_pipeline(
        copy.deepcopy(raw_fixture),
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=generated_at_ms,
    )
    protocol.validate_envelope(golden, maximum_bytes=262_144)
    if pipeline.assessment != golden:
        raise BenchmarkError("Q16 live pipeline assessment drifted from its immutable golden")
    assessment_sha256 = protocol_digest(golden).hexdigest
    if pipeline.assessment_sha256.hexdigest != assessment_sha256:
        raise BenchmarkError("Q16 pipeline stage digest drifted from the golden assessment")
    stages = [stage.as_mapping() for stage in pipeline.stages]
    if [stage["stage"] for stage in stages] != [
        "RAW",
        "EVIDENCE",
        "FEATURES",
        "MODELS",
        "CALIBRATION",
        "ASSESSMENT",
    ]:
        raise BenchmarkError("Q16 pipeline stage order is not exact")
    return golden, {
        "assessmentSha256": assessment_sha256,
        "assessmentSchema": "EdgeAssessmentEnvelopeV1",
        "pipelineStages": stages,
        "protocolValidated": True,
        "safeAction": "ABSTAIN_UNKNOWN",
    }


def _assert_abstention(
    response: ServiceResponseV1 | dict[str, object],
    *,
    rows: int,
    expected_request_id: str,
    expected_operation: RequestOperation,
    expected_generated_at_ms: int,
    golden_assessment: dict[str, object],
    protocol: ProtocolContractV1,
) -> None:
    if not isinstance(response, ServiceResponseV1):
        raise BenchmarkError("benchmark request did not produce a service response")
    wrapper = response.as_mapping()
    if (
        wrapper.get("schema") != "Q16LocalInferenceResponseV1"
        or type(wrapper.get("version")) is not int
        or wrapper.get("version") != 1
        or response.request_id != expected_request_id
        or response.operation is not expected_operation
        or response.generated_at_ms != expected_generated_at_ms
    ):
        raise BenchmarkError("benchmark service response correlation or wrapper drifted")
    payload = response.payload
    assessments = payload if isinstance(payload, list) else [payload]
    if len(assessments) != rows or any(
        not isinstance(item, dict)
        or item.get("schema") != "EdgeAssessmentEnvelopeV1"
        or item.get("advisoryAction") != "ABSTAIN_UNKNOWN"
        or item.get("predictions") != []
        or item.get("netExpectedValue") != {"state": "UNKNOWN"}
        or item.get("oodState") != "UNKNOWN"
        or item.get("driftState") != "UNKNOWN"
        or item != golden_assessment
        for item in assessments
    ):
        raise BenchmarkError("benchmark workload must remain the exact Q16 golden safe abstention")
    for assessment in assessments:
        item = cast(dict[str, object], assessment)
        protocol.validate_envelope(item, maximum_bytes=262_144)
        if protocol_digest(item).hexdigest != protocol_digest(golden_assessment).hexdigest:
            raise BenchmarkError("benchmark assessment digest drifted from the Q16 golden")


def _run_rows(
    service: LocalInferenceServiceV1,
    *,
    raw_fixture: dict[str, object],
    generated_at_ms: int,
    scenario: str,
    iteration: int,
    batch_limit: int,
    golden_assessment: dict[str, object],
    protocol: ProtocolContractV1,
) -> tuple[int, int]:
    rows = LOAD_ROWS[scenario]
    request_count = 0
    assessment_count = 0
    for chunk_index, chunk_rows in enumerate(_chunks(rows, batch_limit)):
        operation = RequestOperation.ASSESS if chunk_rows == 1 else RequestOperation.BATCH_ASSESS
        request_id = f"q17.bench.{scenario}.{iteration}.{chunk_index}"
        response = service.handle_request(
            _request(
                request_id=request_id,
                operation=operation,
                generated_at_ms=generated_at_ms,
                rows=tuple(copy.deepcopy(raw_fixture) for _ in range(chunk_rows)),
            ),
            evaluation_time_ms=generated_at_ms,
        )
        _assert_abstention(
            response,
            rows=chunk_rows,
            expected_request_id=request_id,
            expected_operation=operation,
            expected_generated_at_ms=generated_at_ms,
            golden_assessment=golden_assessment,
            protocol=protocol,
        )
        request_count += 1
        assessment_count += chunk_rows
    return request_count, assessment_count


class _HeldWorkSlotService(LocalInferenceServiceV1):
    """Test-boundary subclass that synchronizes exact queue saturation."""

    def hold_work_slot(self) -> None:
        if not self._work_slot.acquire(blocking=False):
            raise BenchmarkError("queue probe could not hold the Q16 work slot")

    def release_work_slot(self) -> None:
        self._work_slot.release()


def _queue_saturation_probe(
    *,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    generated_at_ms: int,
    config: BenchmarkConfigV1,
) -> dict[str, object]:
    service = _HeldWorkSlotService(
        limits=InferenceLimitsV1(
            batch_rows=config.batch_limit,
            queue_capacity=config.queue_capacity,
            timeout_ms=config.request_timeout_ms,
        ),
        lineage=lineage,
        protocol=protocol,
    )
    admitted_target = config.queue_capacity + 1
    barrier = Barrier(admitted_target + 1)
    results: list[ServiceResponseV1 | dict[str, object]] = []
    worker_errors: list[BaseException] = []
    service.hold_work_slot()

    def worker(index: int) -> None:
        try:
            barrier.wait(timeout=config.queue_probe_timeout_ms / 1_000)
            results.append(
                service.handle_request(
                    _request(
                        request_id=f"q17.queue.accepted.{index}",
                        operation=RequestOperation.HEALTH,
                        generated_at_ms=generated_at_ms,
                        rows=(),
                    ),
                    evaluation_time_ms=generated_at_ms,
                )
            )
        except BaseException as error:  # synchronized probe returns errors to caller
            worker_errors.append(error)

    workers = [
        Thread(target=worker, args=(index,), name=f"q17-queue-{index}", daemon=True)
        for index in range(admitted_target)
    ]
    for worker_thread in workers:
        worker_thread.start()
    released = False
    try:
        barrier.wait(timeout=config.queue_probe_timeout_ms / 1_000)
        deadline = monotonic() + (config.queue_probe_timeout_ms / 1_000)
        pulse = Event()
        while service.counters.accepted != admitted_target and monotonic() < deadline:
            pulse.wait(0.001)
        if service.counters.accepted != admitted_target:
            raise BenchmarkError("queue probe did not reach exact synchronized saturation")
        overflow = service.handle_request(
            _request(
                request_id="q17.queue.overflow",
                operation=RequestOperation.HEALTH,
                generated_at_ms=generated_at_ms,
                rows=(),
            ),
            evaluation_time_ms=generated_at_ms,
        )
        service.release_work_slot()
        released = True
        for worker_thread in workers:
            worker_thread.join(timeout=config.queue_probe_timeout_ms / 1_000)
        if any(worker_thread.is_alive() for worker_thread in workers):
            raise BenchmarkError("queue probe worker did not terminate")
    except BrokenBarrierError as error:
        raise BenchmarkError("queue probe synchronization failed") from error
    finally:
        if not released:
            service.close()
            service.release_work_slot()
            for worker_thread in workers:
                worker_thread.join(timeout=config.queue_probe_timeout_ms / 1_000)
        service.close()
    if worker_errors:
        raise BenchmarkError("queue probe worker failed") from worker_errors[0]
    if not isinstance(overflow, dict) or overflow.get("code") != "QUEUE_FULL":
        raise BenchmarkError("queue probe did not produce the exact QUEUE_FULL response")
    counters = service.counters.as_mapping(queue_depth=service.queue_depth)
    expected_counters = _expected_counters(requests=admitted_target, assessments=0)
    expected_counters["queueRejections"] = 1
    _require_exact_counters(
        counters,
        expected=expected_counters,
        field="queue probe counters",
    )
    if len(results) != admitted_target or any(
        not isinstance(item, ServiceResponseV1) for item in results
    ):
        raise BenchmarkError("queue probe counters or responses are not exact")
    return {
        "admittedRequests": admitted_target,
        "completedRequests": admitted_target,
        "concurrency": 1,
        "method": "SYNCHRONIZED_HELD_WORK_SLOT",
        "overflowAttempts": 1,
        "queueCapacity": config.queue_capacity,
        "queueFullResponses": 1,
        "serviceCounterSnapshot": counters,
    }


def normalize_peak_rss(raw_peak_rss: int, *, reported_unit: str) -> dict[str, object]:
    """Normalize a child self-report; macOS reports bytes and Linux reports KiB."""

    raw = _strict_int(raw_peak_rss, field="raw_peak_rss", minimum=1)
    if reported_unit == "BYTES":
        peak_bytes = raw
    elif reported_unit == "KIBIBYTES":
        peak_bytes = raw * 1024
    else:
        raise BenchmarkError("child peak RSS unit is unsupported")
    _strict_int(peak_bytes, field="peak_rss_bytes", minimum=1)
    return {
        "measurementScope": "CHILD_SELF_RUSAGE_MAXRSS",
        "peakRssBytes": peak_bytes,
        "provisionalCeilingBytes": PROVISIONAL_PEAK_RSS_CEILING_BYTES,
        "rawPeakRss": raw,
        "reportedUnit": reported_unit,
        "withinProvisionalCeiling": peak_bytes <= PROVISIONAL_PEAK_RSS_CEILING_BYTES,
    }


def _spawn_child(argv: tuple[str, ...], cwd: Path) -> ChildProcess:
    return subprocess.Popen(
        argv,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False,
        start_new_session=True,
        close_fds=True,
    )


def _child_workload_attestation(assessment_sha256: str) -> dict[str, object]:
    request_count = len(_chunks(LOAD_ROWS["universeWatch"], 32))
    assessment_count = LOAD_ROWS["universeWatch"]
    return {
        "advisoryAction": "ABSTAIN_UNKNOWN",
        "assessmentCount": assessment_count,
        "assessmentSha256": assessment_sha256,
        "batchChunks": list(_chunks(assessment_count, 32)),
        "fixtureMaterialization": "DISTINCT_DEEPCOPY_PER_ROW",
        "requestCount": request_count,
        "serviceCountersAfter": _expected_counters(
            requests=request_count,
            assessments=assessment_count,
        ),
        "serviceResponseContractCheckedCount": request_count,
    }


def _validate_child_workload_attestation(value: object) -> dict[str, object]:
    attestation = _exact(
        value,
        keys={
            "advisoryAction",
            "assessmentCount",
            "assessmentSha256",
            "batchChunks",
            "fixtureMaterialization",
            "requestCount",
            "serviceCountersAfter",
            "serviceResponseContractCheckedCount",
        },
        field="child workload attestation",
    )
    expected_requests = len(_chunks(LOAD_ROWS["universeWatch"], 32))
    expected_assessments = LOAD_ROWS["universeWatch"]
    for field, expected in (
        ("assessmentCount", expected_assessments),
        ("requestCount", expected_requests),
        ("serviceResponseContractCheckedCount", expected_requests),
    ):
        observed = _strict_int(attestation[field], field=f"child.{field}", minimum=1)
        if observed != expected:
            raise BenchmarkError(f"child {field} does not attest the exact workload")
    digest = attestation["assessmentSha256"]
    if (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(character not in "0123456789abcdef" for character in digest)
    ):
        raise BenchmarkError("child assessmentSha256 is invalid")
    if (
        attestation["advisoryAction"] != "ABSTAIN_UNKNOWN"
        or attestation["fixtureMaterialization"] != "DISTINCT_DEEPCOPY_PER_ROW"
    ):
        raise BenchmarkError("child workload semantics are invalid")
    chunks = attestation["batchChunks"]
    if not isinstance(chunks, list):
        raise BenchmarkError("child batchChunks must be an array")
    for item in chunks:
        _strict_int(item, field="child.batchChunks", minimum=1, maximum=32)
    if chunks != list(_chunks(expected_assessments, 32)):
        raise BenchmarkError("child batchChunks do not match the exact workload")
    _require_exact_counters(
        attestation["serviceCountersAfter"],
        expected=_expected_counters(
            requests=expected_requests,
            assessments=expected_assessments,
        ),
        field="child service counters",
    )
    return attestation


def _run_child_peak_rss_with_spawn(
    argv: tuple[str, ...],
    *,
    cwd: Path,
    timeout_ms: int,
    spawn: SpawnChild,
) -> dict[str, object]:
    """Run one argv-only child and consume its bounded self-reported RSS evidence."""

    if not isinstance(cwd, Path) or not cwd.is_dir() or cwd.is_symlink():
        raise BenchmarkError("child cwd must be a real directory")
    if (
        not isinstance(argv, tuple)
        or len(argv) != 4
        or any(not isinstance(item, str) or not item or "\x00" in item for item in argv)
    ):
        raise BenchmarkError("child argv must be the exact four-argument RSS command")
    expected_source = Path(__file__).resolve()
    if (
        argv[0] != sys.executable
        or Path(argv[1]).resolve() != expected_source
        or argv[2] != "--q17-rss-child"
        or Path(argv[3]).resolve() != cwd.resolve()
    ):
        raise BenchmarkError("child argv executable, source, mode or repo root is unauthorized")
    bounded_timeout = _strict_int(
        timeout_ms,
        field="timeout_ms",
        minimum=1,
        maximum=120_000,
    )
    child = spawn(argv, cwd)
    try:
        stdout, stderr = child.communicate(timeout=bounded_timeout / 1_000)
    except BaseException as error:
        try:
            child.kill()
        except ProcessLookupError:
            pass
        except BaseException as cleanup_error:
            raise BenchmarkError(
                "child RSS probe could not be killed after communication failure"
            ) from cleanup_error
        try:
            child.communicate(timeout=POST_KILL_REAP_TIMEOUT_MS / 1_000)
        except subprocess.TimeoutExpired as cleanup_error:
            raise BenchmarkError(
                "child RSS probe remained unreaped after kill and bounded cleanup"
            ) from cleanup_error
        except BaseException as cleanup_error:
            raise BenchmarkError(
                "child RSS probe failed during bounded post-kill cleanup"
            ) from cleanup_error
        if isinstance(error, subprocess.TimeoutExpired):
            raise BenchmarkError("child RSS probe exceeded its timeout and was killed") from error
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        raise BenchmarkError(
            "child RSS probe communication failed after bounded kill and reap"
        ) from error
    if child.returncode != 0:
        raise BenchmarkError("child RSS probe failed")
    if stderr or len(stdout) > 4_096:
        raise BenchmarkError("child RSS probe output is contaminated or oversized")
    try:
        value = parse_canonical_object(stdout)
    except QuantEdgeError as error:
        raise BenchmarkError("child RSS probe output is not canonical JSON") from error
    if set(value) != {
        "peakRssBytes",
        "rawPeakRss",
        "reportedUnit",
        "schema",
        "version",
        "workloadAttestation",
    }:
        raise BenchmarkError("child RSS self-report fields are not exact")
    if (
        value["schema"] != "Q17ChildPeakRssV1"
        or type(value["version"]) is not int
        or value["version"] != 1
    ):
        raise BenchmarkError("child RSS self-report schema/version is invalid")
    unit = value["reportedUnit"]
    raw = value["rawPeakRss"]
    if not isinstance(unit, str) or isinstance(raw, bool) or not isinstance(raw, int):
        raise BenchmarkError("child RSS self-report types are invalid")
    normalized = normalize_peak_rss(raw, reported_unit=unit)
    peak_bytes = _strict_int(
        value["peakRssBytes"],
        field="child self-report peakRssBytes",
        minimum=1,
    )
    if peak_bytes != normalized["peakRssBytes"]:
        raise BenchmarkError("child RSS normalized byte count is inconsistent")
    workload = _validate_child_workload_attestation(value["workloadAttestation"])
    return {**normalized, "workloadAttestation": workload}


def run_child_peak_rss(repo_root: Path, *, timeout_ms: int) -> dict[str, object]:
    """Run the sole authorized local Python RSS child; no executable is caller-selected."""

    argv = (
        sys.executable,
        str(Path(__file__).resolve()),
        "--q17-rss-child",
        str(repo_root.resolve()),
    )
    return _run_child_peak_rss_with_spawn(
        argv,
        cwd=repo_root,
        timeout_ms=timeout_ms,
        spawn=_spawn_child,
    )


def _load_context(
    repo_root: Path,
) -> tuple[
    Path,
    Path,
    dict[str, object],
    ServingLineageV1,
    ProtocolContractV1,
    int,
]:
    if not isinstance(repo_root, Path) or not repo_root.is_dir() or repo_root.is_symlink():
        raise BenchmarkError("repo_root must be a real directory")
    quant_root = repo_root / "quant"
    fixture_path = quant_root / "fixtures" / "q16_raw_fixture_v1.json"
    lock_path = quant_root / "uv.lock"
    raw_fixture = parse_canonical_object(fixture_path.read_bytes())
    generated = raw_fixture.get("generatedAtMs")
    generated_at_ms = _strict_int(generated, field="generatedAtMs", minimum=0)
    protocol = ProtocolContractV1.load(repo_root)
    lineage = load_serving_lineage(quant_root, build_serving_manifest(quant_root))
    return fixture_path, lock_path, raw_fixture, lineage, protocol, generated_at_ms


def _service(
    *,
    config: BenchmarkConfigV1,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> LocalInferenceServiceV1:
    return LocalInferenceServiceV1(
        limits=InferenceLimitsV1(
            batch_rows=config.batch_limit,
            queue_capacity=config.queue_capacity,
            timeout_ms=config.request_timeout_ms,
        ),
        lineage=lineage,
        protocol=protocol,
    )


def _child_rss_report(repo_root: Path, config: BenchmarkConfigV1) -> dict[str, object]:
    return run_child_peak_rss(repo_root, timeout_ms=config.child_timeout_ms)


def _provenance(
    *,
    fixture_path: Path,
    lock_path: Path,
    profile: dict[str, object],
) -> dict[str, object]:
    python_identity = {
        "cacheTag": sys.implementation.cache_tag,
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }
    host_identity = {
        "machine": platform.machine() or "UNKNOWN",
        "release": platform.release() or "UNKNOWN",
        "system": platform.system() or "UNKNOWN",
    }
    cpu_count = os.cpu_count()
    if cpu_count is not None:
        _strict_int(cpu_count, field="cpu_count", minimum=1)
    return {
        "cpuCount": cpu_count,
        "fixtureSha256": _sha256_file(fixture_path, field="fixture_path"),
        "hostProfile": host_identity,
        "hostProfileSha256": _sha256_mapping(host_identity),
        "lockSha256": _sha256_file(lock_path, field="lock_path"),
        "profileSha256": _sha256_mapping(profile),
        "pythonProfile": python_identity,
        "pythonProfileSha256": _sha256_mapping(python_identity),
    }


def _capture_q17_benchmark(
    repo_root: Path,
    *,
    config: BenchmarkConfigV1,
    clock: ClockNs,
    child_runner: ChildRunner,
) -> dict[str, object]:
    if not isinstance(config, BenchmarkConfigV1):
        raise BenchmarkError("config must be BenchmarkConfigV1")
    capture_mode = (
        ACTUAL_CAPTURE_MODE
        if clock is perf_counter_ns and child_runner is _child_rss_report
        else INJECTED_CAPTURE_MODE
    )
    fixture_path, lock_path, raw_fixture, lineage, protocol, generated_at_ms = _load_context(
        repo_root
    )
    quant_root = fixture_path.parents[1]
    golden_assessment, golden_attestation = _golden_workload(
        quant_root=quant_root,
        raw_fixture=raw_fixture,
        lineage=lineage,
        protocol=protocol,
        generated_at_ms=generated_at_ms,
    )
    profile = config.as_mapping()
    chunks = {name: list(_chunks(rows, config.batch_limit)) for name, rows in LOAD_ROWS.items()}
    cold_samples: list[int] = []
    cold_services: list[LocalInferenceServiceV1] = []

    def construct_cold_service() -> None:
        cold_services.append(_service(config=config, lineage=lineage, protocol=protocol))

    for _ in range(config.measurement_samples):
        cold_samples.append(
            measure_positive_ns(
                construct_cold_service,
                clock=clock,
            )
        )
        cold_services.pop().close()
    service = _service(config=config, lineage=lineage, protocol=protocol)
    measurements: dict[str, object] = {}
    observed_requests = 0
    observed_assessments = 0
    counters_before = service.counters.as_mapping(queue_depth=service.queue_depth)
    _require_exact_counters(
        counters_before,
        expected=_expected_counters(requests=0, assessments=0),
        field="benchmark counters before workload",
    )

    def run_counted(*, scenario: str, iteration: int) -> None:
        nonlocal observed_assessments, observed_requests
        result = _run_rows(
            service,
            raw_fixture=raw_fixture,
            generated_at_ms=generated_at_ms,
            scenario=scenario,
            iteration=iteration,
            batch_limit=config.batch_limit,
            golden_assessment=golden_assessment,
            protocol=protocol,
        )
        if (
            not isinstance(result, tuple)
            or len(result) != 2
            or any(isinstance(item, bool) or not isinstance(item, int) for item in result)
        ):
            raise BenchmarkError(
                "benchmark workload did not return exact request/assessment counts"
            )
        requests, assessments = result
        observed_requests += requests
        observed_assessments += assessments

    try:
        for iteration in range(config.warmup_iterations):
            run_counted(
                scenario="single",
                iteration=iteration,
            )
        for scenario in MEASUREMENT_ORDER:
            samples = [
                measure_positive_ns(
                    partial(
                        run_counted,
                        scenario=scenario,
                        iteration=iteration,
                    ),
                    clock=clock,
                )
                for iteration in range(config.measurement_samples)
            ]
            measurement_name = "warmSingle" if scenario == "single" else scenario
            measurements[measurement_name] = summarize_samples(
                samples,
                items_per_sample=LOAD_ROWS[scenario],
            )
        expected_requests = config.warmup_iterations + config.measurement_samples * sum(
            len(_chunks(LOAD_ROWS[scenario], config.batch_limit)) for scenario in MEASUREMENT_ORDER
        )
        expected_assessments = config.warmup_iterations + config.measurement_samples * sum(
            LOAD_ROWS[scenario] for scenario in MEASUREMENT_ORDER
        )
        if observed_requests != expected_requests or observed_assessments != expected_assessments:
            raise BenchmarkError("benchmark workload counts do not match the exact capacity shape")
        counters_after = service.counters.as_mapping(queue_depth=service.queue_depth)
        _require_exact_counters(
            counters_after,
            expected=_expected_counters(
                requests=expected_requests,
                assessments=expected_assessments,
            ),
            field="benchmark counters after workload",
        )
        close_ns = measure_positive_ns(service.close, clock=clock)
    except BaseException:
        service.close()
        raise
    measurements["coldConstruction"] = {
        **summarize_samples(cold_samples, items_per_sample=1),
        "scope": COLD_CONSTRUCTION_SCOPE,
    }
    measurements["serviceCloseCall"] = {
        **summarize_samples((close_ns,), items_per_sample=1),
        "scope": SERVICE_CLOSE_SCOPE,
        "transportGracefulShutdownProven": False,
    }
    queue_probe = _queue_saturation_probe(
        lineage=lineage,
        protocol=protocol,
        generated_at_ms=generated_at_ms,
        config=config,
    )
    rss = child_runner(repo_root, config)
    workload_attestation = {
        **golden_attestation,
        "expectedAssessmentCount": expected_assessments,
        "expectedRequestCount": expected_requests,
        "fixtureMaterialization": "DISTINCT_DEEPCOPY_PER_ROW",
        "responseCorrelationCheckedCount": expected_requests,
        "responseGeneratedAtMs": generated_at_ms,
        "responseOperations": ["ASSESS", "BATCH_ASSESS"],
        "serviceCountersAfter": counters_after,
        "serviceCountersBefore": counters_before,
        "serviceResponseSchema": "Q16LocalInferenceResponseV1",
    }
    report: dict[str, object] = {
        "advisoryOnly": True,
        "captureMode": capture_mode,
        "captureSemantics": (
            "MEASURE_ONCE_NON_GOLDEN_RUNTIME_EVIDENCE"
            if capture_mode == ACTUAL_CAPTURE_MODE
            else "INJECTED_TEST_SEAM_NOT_RUNTIME_EVIDENCE"
        ),
        "childPeakRss": rss,
        "latencyTargetNs": None,
        "loadShape": {
            "batchChunks": chunks,
            "candidateRows": 128,
            "currentUniverse": None,
            "deepFocusRows": 10,
            "distinctEventTracesClaimed": False,
            "distinctSymbolsClaimed": False,
            "eventTrace": None,
            "fixtureCopiesOnly": True,
            "fixtureMaterialization": "DISTINCT_DEEPCOPY_PER_ROW",
            "fixtureSymbol": "BNBUSDT",
            "focusRows": 25,
            "singleRows": 1,
            "sourceLabel": "ONE_REPEATED_Q16_SYNTHETIC_FIXTURE",
            "universeRows": 452,
            "universeWatchSharedMeasurement": True,
            "watchRows": 452,
        },
        "measurementScope": DIRECT_HANDLE_SCOPE,
        "measurements": measurements,
        "posture": "SYNTHETIC_ONLY",
        "productionClaims": False,
        "profile": profile,
        "provenance": _provenance(
            fixture_path=fixture_path,
            lock_path=lock_path,
            profile=profile,
        ),
        "queueSaturation": queue_probe,
        "schema": "Q17LocalBenchmarkV1",
        "version": 1,
        "workloadAttestation": workload_attestation,
    }
    validate_q17_benchmark(
        report,
        repo_root=repo_root,
        require_actual=capture_mode == ACTUAL_CAPTURE_MODE,
    )
    return report


def run_q17_benchmark(
    repo_root: Path,
    *,
    config: BenchmarkConfigV1 = DEFAULT_BENCHMARK_CONFIG,
) -> dict[str, object]:
    """Capture actual runtime evidence; clock and child execution are not injectable."""

    return _capture_q17_benchmark(
        repo_root,
        config=config,
        clock=perf_counter_ns,
        child_runner=_child_rss_report,
    )


def _run_q17_benchmark_for_test(
    repo_root: Path,
    *,
    config: BenchmarkConfigV1,
    clock: ClockNs,
    child_runner: ChildRunner,
) -> dict[str, object]:
    """Private deterministic seam whose output is permanently labeled non-actual."""

    return _capture_q17_benchmark(
        repo_root,
        config=config,
        clock=clock,
        child_runner=child_runner,
    )


def _exact(value: object, *, keys: set[str], field: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != keys:
        raise BenchmarkError(f"{field} fields are not exact")
    return cast(dict[str, object], value)


def _validate_summary(value: object, *, items_per_sample: int, samples: int) -> None:
    summary = _exact(
        value,
        keys={
            "itemsPerSample",
            "maximumNs",
            "minimumNs",
            "p50Ns",
            "p95Ns",
            "p99Ns",
            "rawNs",
            "sampleCount",
            "totalItems",
            "totalNs",
            "throughput",
        },
        field="measurement summary",
    )
    raw = summary["rawNs"]
    if not isinstance(raw, list):
        raise BenchmarkError("measurement rawNs must be an array")
    for field in (
        "itemsPerSample",
        "maximumNs",
        "minimumNs",
        "p50Ns",
        "p95Ns",
        "p99Ns",
        "sampleCount",
        "totalItems",
        "totalNs",
    ):
        _strict_int(summary[field], field=f"measurement summary.{field}", minimum=1)
    throughput = _exact(
        summary["throughput"],
        keys={"denominator", "numerator", "unit"},
        field="measurement throughput",
    )
    _strict_int(throughput["denominator"], field="throughput.denominator", minimum=1)
    _strict_int(throughput["numerator"], field="throughput.numerator", minimum=1)
    if throughput["unit"] != "ITEMS_PER_SECOND":
        raise BenchmarkError("measurement throughput unit is invalid")
    expected = summarize_samples(
        tuple(_strict_int(item, field="rawNs", minimum=1) for item in raw),
        items_per_sample=items_per_sample,
    )
    if (
        expected != summary
        or type(summary["sampleCount"]) is not int
        or summary["sampleCount"] != samples
    ):
        raise BenchmarkError("measurement summary does not match its raw samples")


def validate_q17_benchmark(
    value: dict[str, object],
    *,
    repo_root: Path | None = None,
    require_actual: bool = True,
) -> None:
    """Validate integer-only evidence against current Q16 fixture, lock and golden truth."""

    if not isinstance(require_actual, bool):
        raise BenchmarkError("require_actual must be boolean")
    resolved_root = Path(__file__).resolve().parents[4] if repo_root is None else repo_root
    if not resolved_root.is_dir() or resolved_root.is_symlink():
        raise BenchmarkError("validator repo_root must be a real directory")
    try:
        canonical_json_bytes(value)
    except QuantEdgeError as error:
        raise BenchmarkError("benchmark must be strict integer-only canonical JSON") from error
    root = _exact(
        value,
        keys={
            "advisoryOnly",
            "captureMode",
            "captureSemantics",
            "childPeakRss",
            "latencyTargetNs",
            "loadShape",
            "measurementScope",
            "measurements",
            "posture",
            "productionClaims",
            "profile",
            "provenance",
            "queueSaturation",
            "schema",
            "version",
            "workloadAttestation",
        },
        field="benchmark",
    )
    capture_mode = root["captureMode"]
    expected_capture_semantics = (
        "MEASURE_ONCE_NON_GOLDEN_RUNTIME_EVIDENCE"
        if capture_mode == ACTUAL_CAPTURE_MODE
        else "INJECTED_TEST_SEAM_NOT_RUNTIME_EVIDENCE"
    )
    if (
        root["schema"] != "Q17LocalBenchmarkV1"
        or type(root["version"]) is not int
        or root["version"] != 1
        or root["posture"] != "SYNTHETIC_ONLY"
        or root["measurementScope"] != DIRECT_HANDLE_SCOPE
        or root["captureSemantics"] != expected_capture_semantics
        or capture_mode not in (ACTUAL_CAPTURE_MODE, INJECTED_CAPTURE_MODE)
        or (require_actual and capture_mode != ACTUAL_CAPTURE_MODE)
        or root["advisoryOnly"] is not True
        or root["productionClaims"] is not False
        or root["latencyTargetNs"] is not None
    ):
        raise BenchmarkError("benchmark root or capture semantics are invalid")
    profile = _exact(
        root["profile"],
        keys={
            "batchLimit",
            "childTimeoutMs",
            "measurementSamples",
            "percentileLaw",
            "queueCapacity",
            "queueProbeTimeoutMs",
            "requestTimeoutMs",
            "warmupIterations",
        },
        field="profile",
    )
    config = BenchmarkConfigV1(
        warmup_iterations=cast(int, profile["warmupIterations"]),
        measurement_samples=cast(int, profile["measurementSamples"]),
        batch_limit=cast(int, profile["batchLimit"]),
        queue_capacity=cast(int, profile["queueCapacity"]),
        request_timeout_ms=cast(int, profile["requestTimeoutMs"]),
        child_timeout_ms=cast(int, profile["childTimeoutMs"]),
        queue_probe_timeout_ms=cast(int, profile["queueProbeTimeoutMs"]),
    )
    if profile != config.as_mapping():
        raise BenchmarkError("benchmark profile is not canonical")
    load = _exact(
        root["loadShape"],
        keys={
            "batchChunks",
            "candidateRows",
            "currentUniverse",
            "deepFocusRows",
            "distinctEventTracesClaimed",
            "distinctSymbolsClaimed",
            "eventTrace",
            "fixtureCopiesOnly",
            "fixtureMaterialization",
            "fixtureSymbol",
            "focusRows",
            "singleRows",
            "sourceLabel",
            "universeRows",
            "universeWatchSharedMeasurement",
            "watchRows",
        },
        field="loadShape",
    )
    for field, expected in (
        ("candidateRows", 128),
        ("deepFocusRows", 10),
        ("focusRows", 25),
        ("singleRows", 1),
        ("universeRows", 452),
        ("watchRows", 452),
    ):
        if _strict_int(load[field], field=f"loadShape.{field}", minimum=1) != expected:
            raise BenchmarkError("benchmark load row capacity is invalid")
    expected_chunks = {
        name: list(_chunks(rows, config.batch_limit)) for name, rows in LOAD_ROWS.items()
    }
    observed_chunks = _exact(
        load["batchChunks"],
        keys=set(LOAD_ROWS),
        field="loadShape.batchChunks",
    )
    for name, expected_chunk in expected_chunks.items():
        observed = observed_chunks[name]
        if not isinstance(observed, list) or any(
            _strict_int(item, field=f"loadShape.batchChunks.{name}", minimum=1) > 32
            for item in observed
        ):
            raise BenchmarkError("benchmark batch chunks are not bounded integer arrays")
        if observed != expected_chunk:
            raise BenchmarkError("benchmark batch chunks do not match the exact load shape")
    if (
        load["currentUniverse"] is not None
        or load["eventTrace"] is not None
        or load["distinctEventTracesClaimed"] is not False
        or load["distinctSymbolsClaimed"] is not False
        or load["fixtureCopiesOnly"] is not True
        or load["universeWatchSharedMeasurement"] is not True
        or load["fixtureMaterialization"] != "DISTINCT_DEEPCOPY_PER_ROW"
        or load["fixtureSymbol"] != "BNBUSDT"
        or load["sourceLabel"] != "ONE_REPEATED_Q16_SYNTHETIC_FIXTURE"
    ):
        raise BenchmarkError("benchmark load shape is not the exact synthetic capacity profile")
    measurements = _exact(
        root["measurements"],
        keys={
            "candidate",
            "coldConstruction",
            "deepFocus",
            "focus",
            "serviceCloseCall",
            "universeWatch",
            "warmSingle",
        },
        field="measurements",
    )
    for name in MEASUREMENT_ORDER:
        measurement_name = "warmSingle" if name == "single" else name
        _validate_summary(
            measurements[measurement_name],
            items_per_sample=LOAD_ROWS[name],
            samples=config.measurement_samples,
        )
    cold = _exact(
        measurements["coldConstruction"],
        keys={
            "itemsPerSample",
            "maximumNs",
            "minimumNs",
            "p50Ns",
            "p95Ns",
            "p99Ns",
            "rawNs",
            "sampleCount",
            "scope",
            "totalItems",
            "totalNs",
            "throughput",
        },
        field="coldConstruction",
    )
    cold_summary = {key: item for key, item in cold.items() if key != "scope"}
    _validate_summary(cold_summary, items_per_sample=1, samples=config.measurement_samples)
    if cold["scope"] != COLD_CONSTRUCTION_SCOPE:
        raise BenchmarkError("cold construction scope overstates measured work")
    close = _exact(
        measurements["serviceCloseCall"],
        keys={
            "itemsPerSample",
            "maximumNs",
            "minimumNs",
            "p50Ns",
            "p95Ns",
            "p99Ns",
            "rawNs",
            "sampleCount",
            "scope",
            "totalItems",
            "totalNs",
            "throughput",
            "transportGracefulShutdownProven",
        },
        field="serviceCloseCall",
    )
    close_summary = {
        key: item
        for key, item in close.items()
        if key not in {"scope", "transportGracefulShutdownProven"}
    }
    _validate_summary(close_summary, items_per_sample=1, samples=1)
    if (
        close["scope"] != SERVICE_CLOSE_SCOPE
        or close["transportGracefulShutdownProven"] is not False
    ):
        raise BenchmarkError("service close call overstates graceful shutdown evidence")
    queue = _exact(
        root["queueSaturation"],
        keys={
            "admittedRequests",
            "completedRequests",
            "concurrency",
            "method",
            "overflowAttempts",
            "queueCapacity",
            "queueFullResponses",
            "serviceCounterSnapshot",
        },
        field="queueSaturation",
    )
    admitted = config.queue_capacity + 1
    for field, expected in (
        ("admittedRequests", admitted),
        ("completedRequests", admitted),
        ("concurrency", 1),
        ("overflowAttempts", 1),
        ("queueCapacity", config.queue_capacity),
        ("queueFullResponses", 1),
    ):
        if _strict_int(queue[field], field=f"queue.{field}", minimum=1) != expected:
            raise BenchmarkError("queue saturation numeric proof is not exact")
    if queue["method"] != "SYNCHRONIZED_HELD_WORK_SLOT":
        raise BenchmarkError("queue saturation method is invalid")
    queue_expected = _expected_counters(requests=admitted, assessments=0)
    queue_expected["queueRejections"] = 1
    _require_exact_counters(
        queue["serviceCounterSnapshot"],
        expected=queue_expected,
        field="queue service counters",
    )
    attestation = _exact(
        root["workloadAttestation"],
        keys={
            "assessmentSchema",
            "assessmentSha256",
            "expectedAssessmentCount",
            "expectedRequestCount",
            "fixtureMaterialization",
            "pipelineStages",
            "protocolValidated",
            "responseCorrelationCheckedCount",
            "responseGeneratedAtMs",
            "responseOperations",
            "safeAction",
            "serviceCountersAfter",
            "serviceCountersBefore",
            "serviceResponseSchema",
        },
        field="workloadAttestation",
    )
    expected_requests = config.warmup_iterations + config.measurement_samples * sum(
        len(_chunks(LOAD_ROWS[scenario], config.batch_limit)) for scenario in MEASUREMENT_ORDER
    )
    expected_assessments = config.warmup_iterations + config.measurement_samples * sum(
        LOAD_ROWS[scenario] for scenario in MEASUREMENT_ORDER
    )
    for field, expected in (
        ("expectedAssessmentCount", expected_assessments),
        ("expectedRequestCount", expected_requests),
        ("responseCorrelationCheckedCount", expected_requests),
    ):
        if _strict_int(attestation[field], field=f"attestation.{field}", minimum=1) != expected:
            raise BenchmarkError("workload attestation count is invalid")
    fixture_path = resolved_root / "quant" / "fixtures" / "q16_raw_fixture_v1.json"
    lock_path = resolved_root / "quant" / "uv.lock"
    golden_path = resolved_root / "quant" / "generated" / "q16" / "edge_assessment.v1.json"
    campaign_path = resolved_root / "quant" / "generated" / "q16" / "inference_campaign.v1.json"
    raw_fixture = parse_canonical_object(fixture_path.read_bytes())
    golden = strict_json_object(golden_path.read_bytes(), maximum_bytes=262_144)
    campaign = parse_canonical_object(campaign_path.read_bytes())
    pipeline = campaign.get("pipeline")
    if not isinstance(pipeline, dict) or not isinstance(pipeline.get("stages"), list):
        raise BenchmarkError("current Q16 campaign pipeline stages are unavailable")
    generated_at_ms = _strict_int(
        raw_fixture.get("generatedAtMs"),
        field="current fixture generatedAtMs",
        minimum=0,
    )
    assessment_sha256 = protocol_digest(golden).hexdigest
    if (
        attestation["assessmentSchema"] != "EdgeAssessmentEnvelopeV1"
        or attestation["assessmentSha256"] != assessment_sha256
        or attestation["pipelineStages"] != pipeline["stages"]
        or attestation["protocolValidated"] is not True
        or attestation["fixtureMaterialization"] != "DISTINCT_DEEPCOPY_PER_ROW"
        or attestation["responseGeneratedAtMs"] != generated_at_ms
        or type(attestation["responseGeneratedAtMs"]) is not int
        or attestation["responseOperations"] != ["ASSESS", "BATCH_ASSESS"]
        or attestation["safeAction"] != "ABSTAIN_UNKNOWN"
        or attestation["serviceResponseSchema"] != "Q16LocalInferenceResponseV1"
    ):
        raise BenchmarkError("workload attestation drifted from current Q16 golden truth")
    _require_exact_counters(
        attestation["serviceCountersBefore"],
        expected=_expected_counters(requests=0, assessments=0),
        field="workload counters before",
    )
    _require_exact_counters(
        attestation["serviceCountersAfter"],
        expected=_expected_counters(
            requests=expected_requests,
            assessments=expected_assessments,
        ),
        field="workload counters after",
    )
    rss = _exact(
        root["childPeakRss"],
        keys={
            "measurementScope",
            "peakRssBytes",
            "provisionalCeilingBytes",
            "rawPeakRss",
            "reportedUnit",
            "withinProvisionalCeiling",
            "workloadAttestation",
        },
        field="childPeakRss",
    )
    normalized = normalize_peak_rss(
        cast(int, rss["rawPeakRss"]),
        reported_unit=cast(str, rss["reportedUnit"]),
    )
    _strict_int(rss["peakRssBytes"], field="childPeakRss.peakRssBytes", minimum=1)
    _strict_int(
        rss["provisionalCeilingBytes"],
        field="childPeakRss.provisionalCeilingBytes",
        minimum=1,
    )
    rss_base = {key: item for key, item in rss.items() if key != "workloadAttestation"}
    if rss_base != normalized or rss["withinProvisionalCeiling"] is not True:
        raise BenchmarkError("child peak RSS evidence is inconsistent or above the ceiling")
    child_attestation = _validate_child_workload_attestation(rss["workloadAttestation"])
    if child_attestation["assessmentSha256"] != assessment_sha256:
        raise BenchmarkError("child workload did not attest the current Q16 golden assessment")
    provenance = _exact(
        root["provenance"],
        keys={
            "cpuCount",
            "fixtureSha256",
            "hostProfile",
            "hostProfileSha256",
            "lockSha256",
            "profileSha256",
            "pythonProfile",
            "pythonProfileSha256",
        },
        field="provenance",
    )
    cpu_count = provenance["cpuCount"]
    if cpu_count is not None:
        _strict_int(cpu_count, field="cpuCount", minimum=1)
    host_profile = _exact(
        provenance["hostProfile"],
        keys={"machine", "release", "system"},
        field="hostProfile",
    )
    python_profile = _exact(
        provenance["pythonProfile"],
        keys={"cacheTag", "implementation", "version"},
        field="pythonProfile",
    )
    for name, item in (*host_profile.items(), *python_profile.items()):
        if not isinstance(item, str) or not item or len(item) > 256:
            raise BenchmarkError(f"safe provenance field {name} is invalid")
    current_host_profile = {
        "machine": platform.machine() or "UNKNOWN",
        "release": platform.release() or "UNKNOWN",
        "system": platform.system() or "UNKNOWN",
    }
    current_python_profile = {
        "cacheTag": sys.implementation.cache_tag,
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }
    if (
        host_profile != current_host_profile
        or python_profile != current_python_profile
        or cpu_count != os.cpu_count()
        or (cpu_count is not None and type(cpu_count) is not int)
    ):
        raise BenchmarkError("provenance profiles do not describe the current safe runtime")
    for field in (
        "fixtureSha256",
        "hostProfileSha256",
        "lockSha256",
        "profileSha256",
        "pythonProfileSha256",
    ):
        digest = provenance[field]
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise BenchmarkError(f"{field} must be a lowercase SHA-256 digest")
    if (
        provenance["fixtureSha256"] != _sha256_file(fixture_path, field="fixture_path")
        or provenance["lockSha256"] != _sha256_file(lock_path, field="lock_path")
        or provenance["hostProfileSha256"] != _sha256_mapping(host_profile)
        or provenance["pythonProfileSha256"] != _sha256_mapping(python_profile)
        or provenance["profileSha256"] != _sha256_mapping(profile)
    ):
        raise BenchmarkError("provenance hashes do not bind current fixture, lock and profiles")


def _self_peak_rss() -> dict[str, object]:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    raw = usage.ru_maxrss
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise BenchmarkError("platform ru_maxrss is not an integer")
    if sys.platform == "darwin":
        unit = "BYTES"
    elif sys.platform.startswith("linux"):
        unit = "KIBIBYTES"
    else:
        raise BenchmarkError("platform ru_maxrss unit is unsupported")
    normalized = normalize_peak_rss(raw, reported_unit=unit)
    return {
        "peakRssBytes": normalized["peakRssBytes"],
        "rawPeakRss": raw,
        "reportedUnit": unit,
        "schema": "Q17ChildPeakRssV1",
        "version": 1,
    }


def _rss_child(repo_root: Path) -> None:
    config = BenchmarkConfigV1()
    fixture_path, _, raw_fixture, lineage, protocol, generated_at_ms = _load_context(repo_root)
    golden_assessment, golden_attestation = _golden_workload(
        quant_root=fixture_path.parents[1],
        raw_fixture=raw_fixture,
        lineage=lineage,
        protocol=protocol,
        generated_at_ms=generated_at_ms,
    )
    service = _service(config=config, lineage=lineage, protocol=protocol)
    try:
        result = _run_rows(
            service,
            raw_fixture=raw_fixture,
            generated_at_ms=generated_at_ms,
            scenario="universeWatch",
            iteration=0,
            batch_limit=config.batch_limit,
            golden_assessment=golden_assessment,
            protocol=protocol,
        )
    finally:
        service.close()
    expected_requests = len(_chunks(LOAD_ROWS["universeWatch"], config.batch_limit))
    expected_assessments = LOAD_ROWS["universeWatch"]
    if result != (expected_requests, expected_assessments):
        raise BenchmarkError("child workload did not execute its exact request/assessment shape")
    counters = service.counters.as_mapping(queue_depth=service.queue_depth)
    _require_exact_counters(
        counters,
        expected=_expected_counters(
            requests=expected_requests,
            assessments=expected_assessments,
        ),
        field="child post-workload counters",
    )
    workload = _child_workload_attestation(cast(str, golden_attestation["assessmentSha256"]))
    if workload["serviceCountersAfter"] != counters:
        raise BenchmarkError("child workload attestation does not bind observed counters")
    output = {**_self_peak_rss(), "workloadAttestation": workload}
    sys.stdout.buffer.write(canonical_json_bytes(output))


def main(argv: Sequence[str] | None = None) -> int:
    arguments = tuple(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 2 or arguments[0] != "--q17-rss-child":
        return 2
    try:
        _rss_child(Path(arguments[1]))
    except (OSError, QuantEdgeError, ValueError):
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the child boundary
    raise SystemExit(main())
