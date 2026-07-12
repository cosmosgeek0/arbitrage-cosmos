import json
import subprocess
import sys
from pathlib import Path

import pytest

from quant_edge import cli

QUANT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = QUANT_ROOT.parent


def _run_cli(*args: str, timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "quant_edge", *args],
        check=False,
        capture_output=True,
        text=True,
        cwd=QUANT_ROOT,
        timeout=timeout,
    )


def test_cli_config_and_seed_are_canonical_across_processes() -> None:
    config = _run_cli(
        "config",
        "--run-id",
        "q01.fixture",
        "--as-of-ms",
        "1783814400000",
        "--seed",
        "20260712",
        "--truth-posture",
        "SYNTHETIC",
    )
    assert config.returncode == 0
    assert config.stderr == ""
    assert json.loads(config.stdout)["datasetRevision"] is None

    args = ("seed-fixture", "--seed", "20260712", "--count", "8")
    first = _run_cli(*args)
    second = _run_cli(*args)
    assert first.returncode == second.returncode == 0
    assert first.stdout == second.stdout
    assert (
        first.stdout.encode() == (QUANT_ROOT / "fixtures/deterministic_seed_v1.json").read_bytes()
    )


def test_cli_success_commands_are_directly_composable(
    capsysbinary: pytest.CaptureFixture[bytes],
) -> None:
    assert (
        cli.main(
            [
                "config",
                "--run-id",
                "q01.direct",
                "--as-of-ms",
                "1783814400000",
                "--seed",
                "20260712",
                "--truth-posture",
                "SYNTHETIC",
            ]
        )
        == 0
    )
    assert json.loads(capsysbinary.readouterr().out)["runId"] == "q01.direct"

    assert cli.main(["seed-fixture", "--seed", "20260712", "--count", "8"]) == 0
    assert (
        capsysbinary.readouterr().out
        == (QUANT_ROOT / "fixtures/deterministic_seed_v1.json").read_bytes()
    )

    assert (
        cli.main(
            [
                "registry-verify",
                "--registry",
                str(QUANT_ROOT / "registry/edge_hypotheses.v1.json"),
                "--map",
                str(QUANT_ROOT / "EDGE_HYPOTHESIS_MAP.md"),
            ]
        )
        == 0
    )
    assert json.loads(capsysbinary.readouterr().out)["familyCount"] == 8

    assert cli.main(["protocol-verify", "--repo-root", str(REPO_ROOT)]) == 0
    assert b"22/22 protocol checks passed" in capsysbinary.readouterr().out


@pytest.mark.parametrize(
    "mutation",
    [
        ("--run-id", "contains space"),
        ("--as-of-ms", "1"),
        ("--seed", "-1"),
        ("--truth-posture", "LIVE"),
        ("--dataset-revision", "contains space"),
    ],
)
def test_cli_malformed_config_returns_nonzero(mutation: tuple[str, str]) -> None:
    values = {
        "--run-id": "q01.fixture",
        "--as-of-ms": "1783814400000",
        "--seed": "20260712",
        "--truth-posture": "SYNTHETIC",
        "--dataset-revision": "dataset.none-yet",
    }
    values[mutation[0]] = mutation[1]
    args = ["config"]
    for option, value in values.items():
        args.extend((option, value))
    result = _run_cli(*args)
    assert result.returncode == 2
    assert result.stderr


def test_cli_registry_verification_and_malformed_failure(tmp_path: Path) -> None:
    success = _run_cli(
        "registry-verify",
        "--registry",
        "registry/edge_hypotheses.v1.json",
        "--map",
        "EDGE_HYPOTHESIS_MAP.md",
    )
    assert success.returncode == 0
    assert json.loads(success.stdout)["familyCount"] == 8

    malformed = tmp_path / "bad.json"
    malformed.write_text("{}", encoding="utf-8")
    failure = _run_cli(
        "registry-verify",
        "--registry",
        str(malformed),
        "--map",
        "EDGE_HYPOTHESIS_MAP.md",
    )
    assert failure.returncode == 2
    assert "canonical" in failure.stderr


def test_cli_registry_rejects_oversized_deep_and_non_utf8_inputs(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized.json"
    oversized.write_bytes(b"x" * (cli._REGISTRY_MAX_BYTES + 1))
    too_large = _run_cli(
        "registry-verify",
        "--registry",
        str(oversized),
        "--map",
        "EDGE_HYPOTHESIS_MAP.md",
    )
    assert too_large.returncode == 2
    assert "exceeds" in too_large.stderr

    deeply_nested = tmp_path / "deep.json"
    deeply_nested.write_bytes(b'{"x":' + (b"[" * 2_000) + b"0" + (b"]" * 2_000) + b"}\n")
    too_deep = _run_cli(
        "registry-verify",
        "--registry",
        str(deeply_nested),
        "--map",
        "EDGE_HYPOTHESIS_MAP.md",
    )
    assert too_deep.returncode == 2
    assert "nesting" in too_deep.stderr

    non_utf8 = tmp_path / "map.md"
    non_utf8.write_bytes(b"\xff")
    bad_map = _run_cli(
        "registry-verify",
        "--registry",
        "registry/edge_hypotheses.v1.json",
        "--map",
        str(non_utf8),
    )
    assert bad_map.returncode == 2
    assert "UTF-8" in bad_map.stderr

    surrogate = tmp_path / "surrogate.json"
    surrogate.write_bytes(rb'{"x":"\ud800"}' + b"\n")
    bad_surrogate = _run_cli(
        "registry-verify",
        "--registry",
        str(surrogate),
        "--map",
        "EDGE_HYPOTHESIS_MAP.md",
    )
    assert bad_surrogate.returncode == 2
    assert "strict UTF-8" in bad_surrogate.stderr
    assert "Traceback" not in bad_surrogate.stderr


@pytest.mark.contract
def test_cli_runs_the_frozen_protocol_suite() -> None:
    result = _run_cli("protocol-verify", "--repo-root", str(REPO_ROOT))
    assert result.returncode == 0
    assert "22/22 protocol checks passed" in result.stdout


def test_cli_protocol_failure_missing_timeout_and_return_bounds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    missing = cli.main(["protocol-verify", "--repo-root", str(tmp_path)])
    assert missing == 2
    assert "missing" in capsys.readouterr().err

    def failed(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args, kwargs
        return subprocess.CompletedProcess(["node"], 7, stdout=b"", stderr=b"")

    monkeypatch.setattr(subprocess, "run", failed)
    assert cli.main(["protocol-verify", "--repo-root", str(REPO_ROOT)]) == 7
    assert (
        cli.main(["protocol-verify", "--repo-root", str(REPO_ROOT), "--timeout-seconds", "0"]) == 2
    )
    capsys.readouterr()

    def timed_out(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args, kwargs
        raise subprocess.TimeoutExpired(cmd="node", timeout=1)

    monkeypatch.setattr(subprocess, "run", timed_out)
    assert cli.main(["protocol-verify", "--repo-root", str(REPO_ROOT)]) == 2
    assert "timed out" in capsys.readouterr().err


def test_cli_protocol_rejects_false_green_and_maps_abnormal_return(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def false_green(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args, kwargs
        return subprocess.CompletedProcess(["node"], 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(subprocess, "run", false_green)
    assert cli.main(["protocol-verify", "--repo-root", str(REPO_ROOT)]) == 2
    assert "output mismatch" in capsys.readouterr().err

    def abnormal(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args, kwargs
        return subprocess.CompletedProcess(["node"], 126, stdout=b"", stderr=b"")

    monkeypatch.setattr(subprocess, "run", abnormal)
    assert cli.main(["protocol-verify", "--repo-root", str(REPO_ROOT)]) == 1


def test_cli_protocol_has_no_public_runner_override() -> None:
    for executable in ("/usr/bin/true", "/bin/echo"):
        result = _run_cli(
            "protocol-verify",
            "--repo-root",
            str(REPO_ROOT),
            "--node",
            executable,
        )
        assert result.returncode == 2
        assert "unrecognized arguments" in result.stderr


def test_cli_propagates_explicit_io_failure(tmp_path: Path) -> None:
    missing = tmp_path / "missing.json"
    result = _run_cli(
        "registry-verify",
        "--registry",
        str(missing),
        "--map",
        str(tmp_path / "missing.md"),
    )
    assert result.returncode == 2
    assert str(missing) in result.stderr
