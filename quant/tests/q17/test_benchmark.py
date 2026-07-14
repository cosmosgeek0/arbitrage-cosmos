from __future__ import annotations

import copy
import os
import resource
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import QuantEdgeError
from quant_edge.final_proof import benchmark
from quant_edge.final_proof.benchmark import (
    BenchmarkConfigV1,
    BenchmarkError,
    measure_positive_ns,
    normalize_peak_rss,
    run_q17_benchmark,
    summarize_samples,
    validate_q17_benchmark,
)
from quant_edge.inference.contracts import InferenceLimitsV1, RequestOperation
from quant_edge.inference.protocol import protocol_digest, strict_json_object
from quant_edge.inference.service import ServiceResponseV1

REPO_ROOT = Path(__file__).resolve().parents[3]


class StepClock:
    def __init__(self, *, step: int = 10) -> None:
        self.value = 0
        self.step = step

    def __call__(self) -> int:
        self.value += self.step
        return self.value


class SequenceClock:
    def __init__(self, values: tuple[object, ...]) -> None:
        self.values = iter(values)

    def __call__(self) -> int:
        return cast(int, next(self.values))


class FakeChild:
    def __init__(
        self,
        *,
        stdout: bytes = b"",
        stderr: bytes = b"",
        returncode: int | None = 0,
        timeout_first: bool = False,
        timeout_always: bool = False,
    ) -> None:
        self.stdout = stdout
        self.stderr = stderr
        self._returncode = returncode
        self.timeout_first = timeout_first
        self.timeout_always = timeout_always
        self.communicate_calls = 0
        self.kill_calls = 0
        self.observed_timeout: float | None = None

    @property
    def returncode(self) -> int | None:
        return self._returncode

    def communicate(
        self,
        input: bytes | None = None,
        timeout: float | None = None,
    ) -> tuple[bytes, bytes]:
        assert input is None
        self.communicate_calls += 1
        self.observed_timeout = timeout
        if self.timeout_always or (self.timeout_first and self.communicate_calls == 1):
            raise subprocess.TimeoutExpired(cmd=("python",), timeout=timeout or 0)
        return self.stdout, self.stderr

    def kill(self) -> None:
        self.kill_calls += 1


class CommunicationFailureChild(FakeChild):
    def __init__(
        self,
        *,
        initial_error: BaseException,
        cleanup_error: BaseException | None = None,
        kill_error: BaseException | None = None,
    ) -> None:
        super().__init__()
        self.initial_error = initial_error
        self.cleanup_error = cleanup_error
        self.kill_error = kill_error

    def communicate(
        self,
        input: bytes | None = None,
        timeout: float | None = None,
    ) -> tuple[bytes, bytes]:
        assert input is None
        self.communicate_calls += 1
        self.observed_timeout = timeout
        if self.communicate_calls == 1:
            raise self.initial_error
        if self.cleanup_error is not None:
            raise self.cleanup_error
        return self.stdout, self.stderr

    def kill(self) -> None:
        self.kill_calls += 1
        if self.kill_error is not None:
            raise self.kill_error


def _child_stdout(raw: int = 65_536, *, unit: str = "KIBIBYTES") -> bytes:
    normalized = normalize_peak_rss(raw, reported_unit=unit)
    golden = strict_json_object(
        (REPO_ROOT / "quant" / "generated" / "q16" / "edge_assessment.v1.json").read_bytes(),
        maximum_bytes=262_144,
    )
    return canonical_json_bytes(
        {
            "peakRssBytes": normalized["peakRssBytes"],
            "rawPeakRss": raw,
            "reportedUnit": unit,
            "schema": "Q17ChildPeakRssV1",
            "version": 1,
            "workloadAttestation": benchmark._child_workload_attestation(
                protocol_digest(golden).hexdigest
            ),
        }
    )


def _fake_child_runner(_root: Path, _config: BenchmarkConfigV1) -> dict[str, object]:
    golden = strict_json_object(
        (REPO_ROOT / "quant" / "generated" / "q16" / "edge_assessment.v1.json").read_bytes(),
        maximum_bytes=262_144,
    )
    return {
        **normalize_peak_rss(64 * 1024 * 1024, reported_unit="BYTES"),
        "workloadAttestation": benchmark._child_workload_attestation(
            protocol_digest(golden).hexdigest
        ),
    }


def _validate_test_report(value: dict[str, object]) -> None:
    validate_q17_benchmark(value, repo_root=REPO_ROOT, require_actual=False)


def _valid_child_argv(root: Path) -> tuple[str, ...]:
    return (
        sys.executable,
        str(Path(benchmark.__file__).resolve()),
        "--q17-rss-child",
        str(root.resolve()),
    )


@pytest.fixture(scope="module")
def captured_report() -> dict[str, object]:
    return benchmark._run_q17_benchmark_for_test(
        REPO_ROOT,
        config=BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
        clock=StepClock(),
        child_runner=_fake_child_runner,
    )


@pytest.fixture(scope="module")
def actual_report() -> dict[str, object]:
    return run_q17_benchmark(
        REPO_ROOT,
        config=BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
    )


def test_config_is_explicit_bounded_and_integer_only() -> None:
    config = BenchmarkConfigV1()
    assert config.as_mapping() == {
        "batchLimit": 32,
        "childTimeoutMs": 60_000,
        "measurementSamples": 3,
        "percentileLaw": "NEAREST_RANK_CEILING",
        "queueCapacity": 2,
        "queueProbeTimeoutMs": 5_000,
        "requestTimeoutMs": 30_000,
        "warmupIterations": 2,
    }
    assert canonical_json_bytes(config.as_mapping()).count(b".") == 0


@pytest.mark.parametrize(
    "kwargs",
    [
        {"warmup_iterations": True},
        {"warmup_iterations": 0},
        {"measurement_samples": 33},
        {"batch_limit": 31},
        {"queue_capacity": 0},
        {"request_timeout_ms": 999},
        {"child_timeout_ms": 120_001},
        {"queue_probe_timeout_ms": 999},
        {"request_timeout_ms": 5_000, "queue_probe_timeout_ms": 5_000},
    ],
)
def test_config_rejects_hostile_values(kwargs: dict[str, Any]) -> None:
    with pytest.raises(BenchmarkError):
        BenchmarkConfigV1(**kwargs)


def test_summary_preserves_raw_samples_and_uses_nearest_rank() -> None:
    summary = summarize_samples((10, 20, 30, 40), items_per_sample=2)
    assert summary == {
        "itemsPerSample": 2,
        "maximumNs": 40,
        "minimumNs": 10,
        "p50Ns": 20,
        "p95Ns": 40,
        "p99Ns": 40,
        "rawNs": [10, 20, 30, 40],
        "sampleCount": 4,
        "totalItems": 8,
        "totalNs": 100,
        "throughput": {
            "denominator": 1,
            "numerator": 80_000_000,
            "unit": "ITEMS_PER_SECOND",
        },
    }
    near_max = summarize_samples(tuple(range(1, 102)), items_per_sample=1)
    assert near_max["p99Ns"] == 100
    assert near_max["maximumNs"] == 101


@pytest.mark.parametrize(
    ("samples", "items"),
    [
        ((), 1),
        ((0,), 1),
        ((True,), 1),
        ((1,), 0),
        ((1,), True),
    ],
)
def test_summary_rejects_empty_nonpositive_and_boolean_inputs(
    samples: tuple[int, ...],
    items: int,
) -> None:
    with pytest.raises(BenchmarkError):
        summarize_samples(samples, items_per_sample=items)


def test_measurement_requires_a_strictly_positive_integer_clock() -> None:
    invoked: list[str] = []
    assert measure_positive_ns(lambda: invoked.append("done"), clock=SequenceClock((10, 17))) == 7
    assert invoked == ["done"]
    for clock in (
        SequenceClock((True, 2)),
        SequenceClock((2, True)),
        SequenceClock((2, 2)),
        SequenceClock((3, 2)),
    ):
        with pytest.raises(BenchmarkError):
            measure_positive_ns(lambda: None, clock=clock)
    with pytest.raises(BenchmarkError, match="callable"):
        measure_positive_ns(cast(Callable[[], object], 1))


def test_measurement_propagates_action_failure_without_fabricating_a_sample() -> None:
    def fail() -> None:
        raise RuntimeError("expected")

    with pytest.raises(RuntimeError, match="expected"):
        measure_positive_ns(fail, clock=SequenceClock((1,)))


def test_file_and_response_boundaries_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(BenchmarkError, match="regular file"):
        benchmark._sha256_file(tmp_path, field="probe")
    fixture_path, _, raw, lineage, protocol, generated_at_ms = benchmark._load_context(REPO_ROOT)
    golden, _ = benchmark._golden_workload(
        quant_root=fixture_path.parents[1],
        raw_fixture=raw,
        lineage=lineage,
        protocol=protocol,
        generated_at_ms=generated_at_ms,
    )
    with pytest.raises(BenchmarkError, match="service response"):
        benchmark._assert_abstention(
            {"code": "QUEUE_FULL"},
            rows=1,
            expected_request_id="q17.malformed",
            expected_operation=RequestOperation.ASSESS,
            expected_generated_at_ms=generated_at_ms,
            golden_assessment=golden,
            protocol=protocol,
        )
    malformed = ServiceResponseV1(
        request_id="q17.malformed",
        operation=RequestOperation.ASSESS,
        generated_at_ms=generated_at_ms,
        payload={"advisoryAction": "WATCH"},
    )
    with pytest.raises(BenchmarkError, match="golden safe abstention"):
        benchmark._assert_abstention(
            malformed,
            rows=1,
            expected_request_id="q17.malformed",
            expected_operation=RequestOperation.ASSESS,
            expected_generated_at_ms=generated_at_ms,
            golden_assessment=golden,
            protocol=protocol,
        )
    wrong_correlation = ServiceResponseV1(
        request_id="q17.other",
        operation=RequestOperation.ASSESS,
        generated_at_ms=generated_at_ms,
        payload=golden,
    )
    with pytest.raises(BenchmarkError, match="correlation"):
        benchmark._assert_abstention(
            wrong_correlation,
            rows=1,
            expected_request_id="q17.malformed",
            expected_operation=RequestOperation.ASSESS,
            expected_generated_at_ms=generated_at_ms,
            golden_assessment=golden,
            protocol=protocol,
        )
    with pytest.raises(BenchmarkError, match="repo_root"):
        benchmark._load_context(tmp_path / "missing")


def test_provenance_records_unknown_cpu_without_fabricating_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(os, "cpu_count", lambda: None)
    provenance = benchmark._provenance(
        fixture_path=REPO_ROOT / "quant" / "fixtures" / "q16_raw_fixture_v1.json",
        lock_path=REPO_ROOT / "quant" / "uv.lock",
        profile=BenchmarkConfigV1().as_mapping(),
    )
    assert provenance["cpuCount"] is None


def test_held_work_slot_rejects_a_second_hold() -> None:
    _, _, _, lineage, protocol, _ = benchmark._load_context(REPO_ROOT)
    service = benchmark._HeldWorkSlotService(
        limits=InferenceLimitsV1(queue_capacity=2),
        lineage=lineage,
        protocol=protocol,
    )
    service.hold_work_slot()
    try:
        with pytest.raises(BenchmarkError, match="could not hold"):
            service.hold_work_slot()
    finally:
        service.release_work_slot()
        service.close()


def test_peak_rss_normalization_is_platform_explicit_and_ceiling_bounded() -> None:
    mac = normalize_peak_rss(1024, reported_unit="BYTES")
    linux = normalize_peak_rss(1024, reported_unit="KIBIBYTES")
    assert mac["peakRssBytes"] == 1024
    assert linux["peakRssBytes"] == 1024 * 1024
    assert linux["measurementScope"] == "CHILD_SELF_RUSAGE_MAXRSS"
    assert linux["withinProvisionalCeiling"] is True
    above = normalize_peak_rss(8 * 1024 * 1024 + 1, reported_unit="KIBIBYTES")
    assert above["withinProvisionalCeiling"] is False
    for raw, unit in ((0, "BYTES"), (True, "BYTES"), (1, "PAGES")):
        with pytest.raises(BenchmarkError):
            normalize_peak_rss(raw, reported_unit=unit)


def test_child_rss_runner_accepts_only_canonical_consistent_self_report(tmp_path: Path) -> None:
    child = FakeChild(stdout=_child_stdout())
    result = benchmark._run_child_peak_rss_with_spawn(
        _valid_child_argv(tmp_path),
        cwd=tmp_path,
        timeout_ms=2_000,
        spawn=lambda _argv, _cwd: child,
    )
    assert result["peakRssBytes"] == 65_536 * 1024
    assert child.observed_timeout == 2.0
    assert child.kill_calls == 0


def test_child_rss_timeout_kills_and_reaps_the_process(tmp_path: Path) -> None:
    child = FakeChild(timeout_first=True)
    with pytest.raises(BenchmarkError, match="killed"):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    assert child.kill_calls == 1
    assert child.communicate_calls == 2


def test_child_rss_post_kill_reap_is_bounded(tmp_path: Path) -> None:
    child = FakeChild(timeout_always=True)
    with pytest.raises(BenchmarkError, match="bounded cleanup"):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    assert child.kill_calls == 1
    assert child.communicate_calls == 2
    assert child.observed_timeout == 1.0


def test_child_rss_communication_failure_kills_and_reaps_the_process(
    tmp_path: Path,
) -> None:
    child = CommunicationFailureChild(initial_error=OSError("pipe failure"))
    with pytest.raises(BenchmarkError, match="bounded kill and reap"):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    assert child.kill_calls == 1
    assert child.communicate_calls == 2
    assert child.observed_timeout == 1.0


@pytest.mark.parametrize(
    ("child", "message"),
    [
        (
            CommunicationFailureChild(
                initial_error=OSError("pipe failure"),
                kill_error=RuntimeError("kill failure"),
            ),
            "could not be killed",
        ),
        (
            CommunicationFailureChild(
                initial_error=OSError("pipe failure"),
                cleanup_error=OSError("reap failure"),
            ),
            "post-kill cleanup",
        ),
    ],
)
def test_child_rss_cleanup_failures_are_fail_closed(
    tmp_path: Path,
    child: CommunicationFailureChild,
    message: str,
) -> None:
    with pytest.raises(BenchmarkError, match=message):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    assert child.kill_calls == 1


def test_child_rss_process_lookup_race_still_reaps_then_fails_closed(
    tmp_path: Path,
) -> None:
    child = CommunicationFailureChild(
        initial_error=OSError("pipe failure"),
        kill_error=ProcessLookupError("already exited"),
    )
    with pytest.raises(BenchmarkError, match="bounded kill and reap"):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    assert child.kill_calls == 1
    assert child.communicate_calls == 2


def test_child_rss_interrupt_cleans_up_then_propagates(tmp_path: Path) -> None:
    child = CommunicationFailureChild(initial_error=KeyboardInterrupt())
    with pytest.raises(KeyboardInterrupt):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    assert child.kill_calls == 1
    assert child.communicate_calls == 2


@pytest.mark.parametrize(
    "child",
    [
        FakeChild(stdout=_child_stdout(), returncode=1),
        FakeChild(stdout=_child_stdout(), stderr=b"warning"),
        FakeChild(stdout=b"not-json\n"),
        FakeChild(stdout=b"x" * 4_097),
        FakeChild(
            stdout=canonical_json_bytes(
                {
                    "peakRssBytes": 1,
                    "rawPeakRss": 1,
                    "reportedUnit": "KIBIBYTES",
                    "schema": "Q17ChildPeakRssV1",
                    "version": 1,
                }
            )
        ),
        FakeChild(
            stdout=canonical_json_bytes(
                {
                    "peakRssBytes": 1,
                    "rawPeakRss": 1,
                    "reportedUnit": "BYTES",
                    "schema": "Q17ChildPeakRssV1",
                    "version": True,
                }
            )
        ),
        FakeChild(
            stdout=canonical_json_bytes(
                {
                    "extra": 1,
                    "peakRssBytes": 1,
                    "rawPeakRss": 1,
                    "reportedUnit": "BYTES",
                    "schema": "Q17ChildPeakRssV1",
                    "version": 1,
                }
            )
        ),
        FakeChild(
            stdout=canonical_json_bytes(
                {
                    "peakRssBytes": 1,
                    "rawPeakRss": "1",
                    "reportedUnit": "BYTES",
                    "schema": "Q17ChildPeakRssV1",
                    "version": 1,
                }
            )
        ),
        FakeChild(
            stdout=canonical_json_bytes(
                {
                    "peakRssBytes": 1,
                    "rawPeakRss": 1,
                    "reportedUnit": "BYTES",
                    "schema": "wrong",
                    "version": 1,
                }
            )
        ),
    ],
)
def test_child_rss_runner_fails_closed_on_bad_process_or_output(
    child: FakeChild,
    tmp_path: Path,
) -> None:
    with pytest.raises(BenchmarkError):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )


@pytest.mark.parametrize(
    ("path", "replacement"),
    [
        (("schema",), "wrong"),
        (("version",), True),
        (("rawPeakRss",), "1"),
        (("peakRssBytes",), 1),
        (("workloadAttestation", "requestCount"), 14),
        (("workloadAttestation", "assessmentSha256"), "z" * 64),
        (("workloadAttestation", "fixtureMaterialization"), "ALIASED"),
    ],
)
def test_child_parser_rejects_attested_payload_tampering(
    path: tuple[str, ...],
    replacement: object,
    tmp_path: Path,
) -> None:
    value = parse_canonical_object(_child_stdout())
    _set_nested(value, path, replacement)
    child = FakeChild(stdout=canonical_json_bytes(value))
    with pytest.raises(BenchmarkError):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )


def test_child_rss_runner_rejects_unsafe_argv_cwd_and_timeout(tmp_path: Path) -> None:
    symlink = tmp_path / "linked"
    directory = tmp_path / "directory"
    directory.mkdir()
    symlink.symlink_to(directory, target_is_directory=True)
    child = FakeChild(stdout=_child_stdout())
    source = str(Path(benchmark.__file__).resolve())
    unauthorized = (
        (),
        ("",),
        ("bad\x00arg",),
        cast(tuple[str, ...], ["not", "tuple"]),
        ("sh", source, "--q17-rss-child", str(tmp_path)),
        (sys.executable, str(tmp_path / "other.py"), "--q17-rss-child", str(tmp_path)),
        (sys.executable, source, "--wrong", str(tmp_path)),
        (sys.executable, source, "--q17-rss-child", str(directory)),
        (*_valid_child_argv(tmp_path), "extra"),
    )
    for argv in unauthorized:
        with pytest.raises(BenchmarkError, match="argv"):
            benchmark._run_child_peak_rss_with_spawn(
                argv,
                cwd=tmp_path,
                timeout_ms=1_000,
                spawn=lambda _argv, _cwd: child,
            )
    with pytest.raises(BenchmarkError, match="cwd"):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(symlink),
            cwd=symlink,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: child,
        )
    with pytest.raises(BenchmarkError, match="timeout_ms"):
        benchmark._run_child_peak_rss_with_spawn(
            _valid_child_argv(tmp_path),
            cwd=tmp_path,
            timeout_ms=True,
            spawn=lambda _argv, _cwd: child,
        )


def test_default_spawn_is_argv_only_no_shell_and_inherits_environment(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}
    child = FakeChild(stdout=_child_stdout())

    def fake_popen(argv: tuple[str, ...], **kwargs: object) -> FakeChild:
        captured["argv"] = argv
        captured.update(kwargs)
        return child

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    assert benchmark._spawn_child((sys_executable := "python", "probe.py"), tmp_path) is child
    assert captured["argv"] == (sys_executable, "probe.py")
    assert captured["shell"] is False
    assert captured["cwd"] == tmp_path
    assert captured["start_new_session"] is True
    assert "env" not in captured


def test_real_child_self_reports_peak_rss_without_parent_rusage_cumulative_trap() -> None:
    result = benchmark._child_rss_report(
        REPO_ROOT,
        BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
    )
    assert result["measurementScope"] == "CHILD_SELF_RUSAGE_MAXRSS"
    assert result["reportedUnit"] in {"BYTES", "KIBIBYTES"}
    assert cast(int, result["rawPeakRss"]) > 0
    assert result["withinProvisionalCeiling"] is True


def test_self_rss_units_and_unknown_platform_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(resource, "getrusage", lambda _scope: SimpleNamespace(ru_maxrss=1024))
    monkeypatch.setattr(sys, "platform", "darwin")
    assert benchmark._self_peak_rss()["reportedUnit"] == "BYTES"
    monkeypatch.setattr(sys, "platform", "linux")
    assert benchmark._self_peak_rss()["peakRssBytes"] == 1024 * 1024
    monkeypatch.setattr(sys, "platform", "unknown")
    with pytest.raises(BenchmarkError, match="unsupported"):
        benchmark._self_peak_rss()
    monkeypatch.setattr(resource, "getrusage", lambda _scope: SimpleNamespace(ru_maxrss=True))
    with pytest.raises(BenchmarkError, match="not an integer"):
        benchmark._self_peak_rss()


def test_rss_child_runs_real_q16_workload_and_emits_canonical_self_report(
    capsys: pytest.CaptureFixture[str],
) -> None:
    benchmark._rss_child(REPO_ROOT)
    output = capsys.readouterr().out.encode()
    value = parse_canonical_object(output)
    assert value["schema"] == "Q17ChildPeakRssV1"
    assert cast(int, value["peakRssBytes"]) > 0


def test_rss_child_rejects_noop_workload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(benchmark, "_run_rows", lambda *_args, **_kwargs: (0, 0))
    with pytest.raises(BenchmarkError, match="exact request/assessment shape"):
        benchmark._rss_child(REPO_ROOT)


def test_captured_benchmark_exercises_exact_bounded_synthetic_shape(
    captured_report: dict[str, object],
) -> None:
    _validate_test_report(captured_report)
    with pytest.raises(BenchmarkError, match="capture"):
        validate_q17_benchmark(captured_report, repo_root=REPO_ROOT)
    assert captured_report["captureSemantics"] == "INJECTED_TEST_SEAM_NOT_RUNTIME_EVIDENCE"
    assert captured_report["captureMode"] == "INJECTED_TEST_SEAM"
    load = cast(dict[str, object], captured_report["loadShape"])
    chunks = cast(dict[str, list[int]], load["batchChunks"])
    assert chunks["candidate"] == [32, 32, 32, 32]
    assert chunks["universeWatch"] == ([32] * 14) + [4]
    assert load["fixtureCopiesOnly"] is True
    assert load["distinctSymbolsClaimed"] is False
    assert load["distinctEventTracesClaimed"] is False
    assert load["currentUniverse"] is None
    assert captured_report["latencyTargetNs"] is None
    queue = cast(dict[str, object], captured_report["queueSaturation"])
    assert queue["queueFullResponses"] == 1
    assert queue["admittedRequests"] == 3
    measurements = cast(dict[str, dict[str, object]], captured_report["measurements"])
    assert all(
        all(isinstance(sample, int) and sample > 0 for sample in cast(list[int], summary["rawNs"]))
        for summary in measurements.values()
    )
    assert measurements["serviceCloseCall"]["transportGracefulShutdownProven"] is False
    assert captured_report["productionClaims"] is False
    provenance = cast(dict[str, object], captured_report["provenance"])
    assert set(cast(dict[str, object], provenance["hostProfile"])) == {
        "machine",
        "release",
        "system",
    }
    assert set(cast(dict[str, object], provenance["pythonProfile"])) == {
        "cacheTag",
        "implementation",
        "version",
    }


def test_public_capture_is_actual_and_strictly_validated(
    actual_report: dict[str, object],
) -> None:
    validate_q17_benchmark(actual_report, repo_root=REPO_ROOT)
    assert actual_report["captureMode"] == "ACTUAL_RUNTIME"
    assert actual_report["captureSemantics"] == "MEASURE_ONCE_NON_GOLDEN_RUNTIME_EVIDENCE"
    child = cast(dict[str, object], actual_report["childPeakRss"])
    workload = cast(dict[str, object], child["workloadAttestation"])
    assert workload["assessmentCount"] == 452
    assert workload["requestCount"] == 15


def _mutated(
    value: dict[str, object],
    mutate: Callable[[dict[str, object]], None],
) -> dict[str, object]:
    clone = copy.deepcopy(value)
    mutate(clone)
    return clone


def _set_nested(value: dict[str, object], path: tuple[str, ...], item: object) -> None:
    current = value
    for key in path[:-1]:
        current = cast(dict[str, object], current[key])
    current[path[-1]] = item


@pytest.mark.parametrize(
    ("path", "replacement"),
    [
        (("schema",), "wrong"),
        (("version",), 2),
        (("posture",), "LIVE"),
        (("measurementScope",), "SOCKET"),
        (("captureSemantics",), "fabricated"),
        (("captureMode",), "UNKNOWN"),
        (("advisoryOnly",), False),
        (("productionClaims",), True),
        (("latencyTargetNs",), 1),
        (("loadShape", "currentUniverse"), 452),
        (("loadShape", "eventTrace"), "invented"),
        (("loadShape", "distinctEventTracesClaimed"), True),
        (("loadShape", "distinctSymbolsClaimed"), True),
        (("loadShape", "singleRows"), True),
        (("loadShape", "candidateRows"), 127),
        (("loadShape", "fixtureCopiesOnly"), 1),
        (("loadShape", "universeWatchSharedMeasurement"), False),
        (("loadShape", "fixtureMaterialization"), "ALIASED"),
        (("loadShape", "fixtureSymbol"), "ALL"),
        (("loadShape", "sourceLabel"), "REAL_UNIVERSE"),
        (("loadShape", "batchChunks"), {}),
        (("loadShape", "batchChunks", "candidate"), [True, True, True, True]),
        (("loadShape", "batchChunks", "candidate"), [33, 32, 32, 31]),
        (("loadShape", "batchChunks", "candidate"), [32, 32, 31, 32, 1]),
        (("profile", "batchLimit"), 31),
        (("measurements", "warmSingle", "p50Ns"), 999),
        (("measurements", "warmSingle", "itemsPerSample"), True),
        (("measurements", "warmSingle", "throughput", "unit"), "FLOAT_PER_SECOND"),
        (("measurements", "coldConstruction", "scope"), "PROCESS_STARTUP"),
        (("measurements", "serviceCloseCall", "transportGracefulShutdownProven"), True),
        (("queueSaturation", "queueFullResponses"), 0),
        (("queueSaturation", "admittedRequests"), 2),
        (("queueSaturation", "concurrency"), True),
        (("queueSaturation", "method"), "UNSYNCHRONIZED"),
        (("queueSaturation", "serviceCounterSnapshot", "timeouts"), True),
        (("childPeakRss", "peakRssBytes"), 1),
        (("childPeakRss", "peakRssBytes"), True),
        (("childPeakRss", "rawPeakRss"), True),
        (("childPeakRss", "workloadAttestation", "requestCount"), True),
        (("childPeakRss", "workloadAttestation", "assessmentCount"), 451),
        (("childPeakRss", "workloadAttestation", "assessmentSha256"), "g" * 64),
        (("childPeakRss", "workloadAttestation", "assessmentSha256"), "0" * 64),
        (("childPeakRss", "workloadAttestation", "advisoryAction"), "WATCH"),
        (("childPeakRss", "workloadAttestation", "batchChunks"), ([True] * 14) + [4]),
        (("childPeakRss", "workloadAttestation", "batchChunks"), ([32] * 13) + [31, 5]),
        (("workloadAttestation", "serviceCountersAfter", "timeouts"), True),
        (("workloadAttestation", "expectedRequestCount"), 1),
        (("workloadAttestation", "safeAction"), "WATCH"),
        (("workloadAttestation", "protocolValidated"), False),
        (("provenance", "cpuCount"), True),
        (("provenance", "fixtureSha256"), "0" * 64),
        (("provenance", "hostProfile", "system"), ""),
        (("provenance", "hostProfile", "machine"), "fabricated"),
        (("provenance", "pythonProfile", "version"), "0.0.0"),
        (("provenance", "profileSha256"), "0" * 64),
        (("provenance", "lockSha256"), "A" * 64),
    ],
)
def test_validator_rejects_semantic_tampering(
    captured_report: dict[str, object],
    path: tuple[str, ...],
    replacement: object,
) -> None:
    tampered = _mutated(
        captured_report,
        lambda item: _set_nested(item, path, replacement),
    )
    with pytest.raises(QuantEdgeError):
        _validate_test_report(tampered)


def test_validator_rejects_raw_nonpositive_float_extra_and_missing_fields(
    captured_report: dict[str, object],
) -> None:
    variants: list[dict[str, object]] = []
    raw_zero = copy.deepcopy(captured_report)
    cast(
        dict[str, object],
        cast(dict[str, object], raw_zero["measurements"])["warmSingle"],
    )["rawNs"] = [0]
    variants.append(raw_zero)
    raw_object = copy.deepcopy(captured_report)
    cast(
        dict[str, object],
        cast(dict[str, object], raw_object["measurements"])["warmSingle"],
    )["rawNs"] = {"not": "an array"}
    variants.append(raw_object)
    float_value = copy.deepcopy(captured_report)
    float_value["latencyTargetNs"] = 1.5
    variants.append(float_value)
    extra = copy.deepcopy(captured_report)
    extra["invented"] = True
    variants.append(extra)
    missing = copy.deepcopy(captured_report)
    del missing["posture"]
    variants.append(missing)
    for item in variants:
        with pytest.raises(QuantEdgeError):
            _validate_test_report(item)


def test_validator_covers_profile_counter_rss_cpu_and_boolean_version_edges(
    captured_report: dict[str, object],
) -> None:
    wrong_law = copy.deepcopy(captured_report)
    cast(dict[str, object], wrong_law["profile"])["percentileLaw"] = "INTERPOLATED"
    bad_counter = copy.deepcopy(captured_report)
    queue = cast(dict[str, object], bad_counter["queueSaturation"])
    cast(dict[str, object], queue["serviceCounterSnapshot"])["queueDepth"] = 1
    bool_version = copy.deepcopy(captured_report)
    bool_version["version"] = True
    counter_bool_version = copy.deepcopy(captured_report)
    queue_bool = cast(dict[str, object], counter_bool_version["queueSaturation"])
    cast(dict[str, object], queue_bool["serviceCounterSnapshot"])["version"] = True
    above_rss = copy.deepcopy(captured_report)
    old_rss = cast(dict[str, object], above_rss["childPeakRss"])
    above_rss["childPeakRss"] = {
        **normalize_peak_rss(8 * 1024 * 1024 + 1, reported_unit="KIBIBYTES"),
        "workloadAttestation": old_rss["workloadAttestation"],
    }
    for item in (wrong_law, bad_counter, bool_version, counter_bool_version, above_rss):
        with pytest.raises(QuantEdgeError):
            _validate_test_report(item)
    cpu_unknown = copy.deepcopy(captured_report)
    cast(dict[str, object], cpu_unknown["provenance"])["cpuCount"] = None
    with pytest.raises(QuantEdgeError):
        _validate_test_report(cpu_unknown)


def test_workload_failure_closes_and_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_rows(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("hostile workload")

    monkeypatch.setattr(benchmark, "_run_rows", fail_rows)
    with pytest.raises(RuntimeError, match="hostile workload"):
        benchmark._run_q17_benchmark_for_test(
            REPO_ROOT,
            config=BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
            clock=StepClock(),
            child_runner=_fake_child_runner,
        )


def test_noop_workload_cannot_produce_a_false_green(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(benchmark, "_run_rows", lambda *_args, **_kwargs: None)
    with pytest.raises(BenchmarkError, match="exact request/assessment counts"):
        benchmark._run_q17_benchmark_for_test(
            REPO_ROOT,
            config=BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
            clock=StepClock(),
            child_runner=_fake_child_runner,
        )


def test_fabricated_zero_workload_counts_cannot_produce_a_false_green(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(benchmark, "_run_rows", lambda *_args, **_kwargs: (0, 0))
    with pytest.raises(BenchmarkError, match="capacity shape"):
        benchmark._run_q17_benchmark_for_test(
            REPO_ROOT,
            config=BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
            clock=StepClock(),
            child_runner=_fake_child_runner,
        )


def test_public_actual_capture_does_not_accept_injected_seams() -> None:
    with pytest.raises(TypeError):
        run_q17_benchmark(  # type: ignore[call-arg]
            REPO_ROOT,
            clock=StepClock(),
            child_runner=_fake_child_runner,
        )
    with pytest.raises(TypeError):
        benchmark.run_child_peak_rss(  # type: ignore[call-arg]
            REPO_ROOT,
            timeout_ms=1_000,
            spawn=lambda _argv, _cwd: FakeChild(),
        )


def test_private_capture_cannot_label_injected_dependencies_as_actual() -> None:
    with pytest.raises(TypeError):
        benchmark._capture_q17_benchmark(  # type: ignore[call-arg]
            REPO_ROOT,
            config=BenchmarkConfigV1(),
            clock=StepClock(),
            child_runner=_fake_child_runner,
            capture_mode=benchmark.ACTUAL_CAPTURE_MODE,
        )
    injected = benchmark._capture_q17_benchmark(
        REPO_ROOT,
        config=BenchmarkConfigV1(warmup_iterations=1, measurement_samples=1),
        clock=StepClock(),
        child_runner=_fake_child_runner,
    )
    assert injected["captureMode"] == benchmark.INJECTED_CAPTURE_MODE
    with pytest.raises(BenchmarkError, match="capture semantics"):
        validate_q17_benchmark(injected, repo_root=REPO_ROOT)


def test_entrypoint_rejects_wrong_config_and_validator_rejects_wrong_input() -> None:
    with pytest.raises(BenchmarkError, match="config"):
        run_q17_benchmark(
            REPO_ROOT,
            config=cast(BenchmarkConfigV1, object()),
        )
    with pytest.raises(QuantEdgeError):
        _validate_test_report(cast(dict[str, object], []))


def test_validator_requires_boolean_mode_and_real_current_root(
    captured_report: dict[str, object],
    tmp_path: Path,
) -> None:
    with pytest.raises(BenchmarkError, match="boolean"):
        validate_q17_benchmark(
            captured_report,
            repo_root=REPO_ROOT,
            require_actual=cast(bool, 1),
        )
    with pytest.raises(BenchmarkError, match="repo_root"):
        validate_q17_benchmark(
            captured_report,
            repo_root=tmp_path / "missing",
            require_actual=False,
        )
    validate_q17_benchmark(captured_report, require_actual=False)


def test_cli_rejects_unknown_invocation() -> None:
    assert benchmark.main(()) == 2
    assert benchmark.main(("--wrong", "path")) == 2


def test_cli_success_and_failure_exit_codes(monkeypatch: pytest.MonkeyPatch) -> None:
    observed: list[Path] = []
    monkeypatch.setattr(benchmark, "_rss_child", observed.append)
    assert benchmark.main(("--q17-rss-child", str(REPO_ROOT))) == 0
    assert observed == [REPO_ROOT]

    def fail(_path: Path) -> None:
        raise BenchmarkError("expected")

    monkeypatch.setattr(benchmark, "_rss_child", fail)
    assert benchmark.main(("--q17-rss-child", str(REPO_ROOT))) == 1
