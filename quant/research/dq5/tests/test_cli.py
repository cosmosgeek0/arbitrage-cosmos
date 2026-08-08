from __future__ import annotations

import io
from pathlib import Path

from research.dq5.cli import MAX_INPUT_BYTES, run
from research.dq5.tests.support import DQ5_ROOT

from quant_edge.canonical import parse_canonical_object


def _run(registry: Path, candidate: Path) -> tuple[int, dict[str, object]]:
    output = io.BytesIO()
    exit_code = run(
        ["--registry", str(registry), "--candidate", str(candidate)],
        stdout=output,
    )
    return exit_code, parse_canonical_object(output.getvalue())


def test_cli_exit_codes_distinguish_eligible_and_policy_rejection() -> None:
    eligible_code, eligible = _run(
        DQ5_ROOT / "fixtures" / "valid" / "registry_pending_fresh.json",
        DQ5_ROOT / "fixtures" / "valid" / "candidate_fresh.json",
    )
    rejected_code, rejected = _run(
        DQ5_ROOT / "fixtures" / "hostile" / "registry_candidate_opened.json",
        DQ5_ROOT / "fixtures" / "hostile" / "candidate_opened.json",
    )

    assert eligible_code == 0
    assert eligible["status"] == "ELIGIBLE_FOR_INTAKE"
    assert rejected_code == 1
    assert rejected["status"] == "REJECTED"


def test_cli_rejects_noncanonical_candidate_with_exit_two(tmp_path: Path) -> None:
    candidate = tmp_path / "candidate.json"
    candidate.write_bytes(b'{"schemaVersion":"DQ5_CANDIDATE_V1"}')

    exit_code, output = _run(
        DQ5_ROOT / "fixtures" / "valid" / "registry_empty.json",
        candidate,
    )

    assert exit_code == 2
    assert output["code"] == "DQ5_CANDIDATE_INVALID"
    assert output["status"] == "INVALID"


def test_cli_rejects_symlink_metadata(tmp_path: Path) -> None:
    link = tmp_path / "registry-link.json"
    link.symlink_to(DQ5_ROOT / "fixtures" / "valid" / "registry_empty.json")

    exit_code, output = _run(
        link,
        DQ5_ROOT / "fixtures" / "valid" / "candidate_fresh.json",
    )

    assert exit_code == 2
    assert output["code"] == "DQ5_REGISTRY_INVALID"
    assert output["reason"] == "metadata path must be a regular non-symlink file"


def test_cli_rejects_oversized_metadata_without_parsing(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized.json"
    oversized.write_bytes(b"x" * (MAX_INPUT_BYTES + 1))

    exit_code, output = _run(
        oversized,
        DQ5_ROOT / "fixtures" / "valid" / "candidate_fresh.json",
    )

    assert exit_code == 2
    assert output["code"] == "DQ5_REGISTRY_INVALID"
    assert "exceeds" in str(output["reason"])


def test_cli_normalizes_over_limit_integer_to_deterministic_invalid(tmp_path: Path) -> None:
    malformed = tmp_path / "registry.json"
    malformed.write_bytes(b'{"value":' + (b"9" * 5_000) + b"}\n")

    exit_code, output = _run(
        malformed,
        DQ5_ROOT / "fixtures" / "valid" / "candidate_fresh.json",
    )

    assert exit_code == 2
    assert output["code"] == "DQ5_REGISTRY_INVALID"
    assert output["reason"] == "must be exact canonical UTF-8 JSON"
