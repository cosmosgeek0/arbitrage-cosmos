"""Hostile S-1W packet authentication tests."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from research.s1w.verifier import VerificationError, verify_packet

PACKET_ROOT = Path(__file__).resolve().parent


def _copy_terminal_packet(tmp_path: Path) -> Path:
    target = tmp_path / "s1w"
    shutil.copytree(
        PACKET_ROOT,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )
    return target


def test_exact_terminal_packet_authenticates() -> None:
    verify_packet(PACKET_ROOT)


def test_tampered_result_is_rejected(tmp_path: Path) -> None:
    target = _copy_terminal_packet(tmp_path)
    result_path = target / "generated/result.v1.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["capitalVerdict"] = "GO"
    result_path.write_text(json.dumps(result), encoding="utf-8")
    with pytest.raises(VerificationError):
        verify_packet(target)


def test_holdout_marker_is_structurally_forbidden(tmp_path: Path) -> None:
    target = _copy_terminal_packet(tmp_path)
    marker = target / "generated/HOLDOUT_OPENED.v1.json"
    marker.write_text("{}\n", encoding="utf-8")
    with pytest.raises(VerificationError, match="FORBIDDEN_LIFECYCLE_ARTIFACT_PRESENT"):
        verify_packet(target)


def test_numeric_zero_cannot_replace_unmeasured_null(tmp_path: Path) -> None:
    target = _copy_terminal_packet(tmp_path)
    result_path = target / "generated/result.v1.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["headline"]["stressNetUsdPerOriginal1000"] = 0
    result_path.write_text(json.dumps(result), encoding="utf-8")
    with pytest.raises(VerificationError):
        verify_packet(target)
