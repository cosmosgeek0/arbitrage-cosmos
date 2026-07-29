from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from research.vg9 import experiment as e
from research.vg9 import verify_terminal as terminal


def _copy_evidence(target_root: Path) -> None:
    target = target_root / "evidence"
    target.mkdir(parents=True)
    for name in (*terminal.EVIDENCE_INPUTS, "SHA256SUMS"):
        shutil.copyfile(terminal.HERE / "evidence" / name, target / name)


def test_terminal_packet_verifies_from_tracked_evidence_only(tmp_path: Path) -> None:
    report = terminal.verify_terminal(
        state_root=tmp_path / "missing-state",
        verify_sources=False,
    )
    assert report["status"] == "TERMINAL_VERIFIED_UNMEASURED_HOLDOUT_UNOPENED"
    assert report["verdict"] == "UNMEASURED"
    assert report["analysis"] is None
    assert report["economics"] == "UNMEASURED_NOT_ZERO"
    assert report["developmentOpenReceipts"] == 1
    assert report["candidateSealed"] is False
    assert report["holdoutOpened"] is False
    assert report["authority"] == "NONE"
    assert report["externalState"] == "ABSENT_TRACKED_EVIDENCE_VERIFIED"


def test_terminal_evidence_contract_accepts_exact_packet(tmp_path: Path) -> None:
    _copy_evidence(tmp_path)
    evidence = terminal.validate_terminal_evidence(
        tmp_path,
        terminal._required_bindings(terminal.HERE),
    )
    assert evidence["verdict"] == "UNMEASURED"
    assert evidence["analysis"] is None


def test_terminal_evidence_rejects_tampered_result(tmp_path: Path) -> None:
    _copy_evidence(tmp_path)
    result = tmp_path / "evidence" / "development_result.v1.json"
    result.write_bytes(result.read_bytes() + b" ")
    with pytest.raises(terminal.TerminalVerificationError, match="digest mismatch"):
        terminal.validate_terminal_evidence(
            tmp_path,
            terminal._required_bindings(terminal.HERE),
        )


def test_terminal_evidence_rejects_candidate_artifact(tmp_path: Path) -> None:
    _copy_evidence(tmp_path)
    (tmp_path / "candidate_seal.v1.json").write_text("{}")
    with pytest.raises(terminal.TerminalVerificationError, match="forbidden"):
        terminal.validate_terminal_evidence(
            tmp_path,
            terminal._required_bindings(terminal.HERE),
        )


def test_external_state_must_match_tracked_bytes(tmp_path: Path) -> None:
    state = tmp_path / "state"
    state.mkdir()
    for name in ("development_opened.v1.json", "development_result.v1.json"):
        shutil.copyfile(terminal.HERE / "evidence" / name, state / name)
    assert terminal._verify_external_state(terminal.HERE, state) == "PRESENT_BYTE_IDENTICAL"
    (state / "development_result.v1.json").write_text("{}")
    with pytest.raises(terminal.TerminalVerificationError, match="differs"):
        terminal._verify_external_state(terminal.HERE, state)


def test_terminal_verifier_has_no_network_or_archive_body_api() -> None:
    source = Path(terminal.__file__).read_text().lower()
    assert "requests" not in source
    assert "urllib" not in source
    assert "socket" not in source
    assert "zipfile" not in source
    assert "parse_spot_archive" not in source
    assert "parse_usd_m_archive" not in source
    assert e.DEFAULT_STATE_ROOT.name == "cosmos-vg9-spot-usdm-volume-leadership-v1"
