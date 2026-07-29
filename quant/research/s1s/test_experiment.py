"""Focused hostile tests for S-1S lifecycle and verdict law."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import experiment
import pytest


def load_packet_object(name: str) -> dict[str, object]:
    """Load one static packet object for tests."""

    value = json.loads((experiment.HERE / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def test_trial_family_is_complete_and_unique() -> None:
    """All 12 attempts must exist before outcome access."""

    protocol = load_packet_object("protocol.v1.json")
    ledger = load_packet_object("trial_ledger.v1.json")
    trial_ids = experiment.validate_protocol(protocol, ledger)
    assert len(trial_ids) == 12
    assert len(set(trial_ids)) == 12
    assert "lb12_z2p5_lead60" in trial_ids


def test_source_plan_forbids_realized_schedule_substitution() -> None:
    """No current or realized timestamp may masquerade as pre-entry knowledge."""

    protocol = load_packet_object("protocol.v1.json")
    schedule = protocol["requiredCausalScheduleEvidence"]
    assert isinstance(schedule, dict)
    forbidden = schedule["forbiddenSubstitutions"]
    assert isinstance(forbidden, list)
    assert "eventual funding calc_time" in forbidden
    assert "hard-coded 00:00/08:00/16:00 UTC grid" in forbidden
    assert schedule["missingEvidenceDisposition"] == "UNMEASURED"


def test_target_event_rate_and_post_settlement_bytes_are_forbidden() -> None:
    """S-1S must remain distinct from post-settlement S-1R."""

    protocol = load_packet_object("protocol.v1.json")
    signal = protocol["signal"]
    assert isinstance(signal, dict)
    assert signal["targetEventRealizedRateAllowed"] is False
    assert signal["postSettlementObservationAllowed"] is False
    boundary = protocol["distinctFromS1R"]
    assert isinstance(boundary, dict)
    assert boundary["s1rBoundary"] == "post-settlement reversion"


def test_unmeasured_result_has_no_synthetic_zero_economics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Missing causality must produce null metrics, not fabricated zeroes."""

    marker_path = tmp_path / "run.json"
    marker_path.write_text("{}\n", encoding="utf-8")
    freeze_path = tmp_path / "freeze.json"
    freeze_path.write_text("{}\n", encoding="utf-8")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(experiment, "RUN_MARKER_PATH", marker_path)
    monkeypatch.setattr(experiment, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(experiment, "SOURCE_MANIFEST_PATH", manifest_path)
    result = experiment.build_unmeasured_result({"runOrdinal": 1})
    experiment.validate_terminal_result(result)
    metrics = result["metrics"]
    assert isinstance(metrics, dict)
    net = metrics["netPer1000Usd"]
    assert isinstance(net, dict)
    assert net["publicTakerProxyUsd"] is None
    assert net["takerStressUsd"] is None
    assert metrics["pbo"]["value"] is None
    assert metrics["drawdown"]["maximumFraction"] is None
    assert metrics["capacity"]["executableCapacityUsd"] is None


def test_checksum_parser_rejects_duplicate_and_path_entries(tmp_path: Path) -> None:
    """The checksum contract is exact and packet-relative."""

    digest = hashlib.sha256(b"x").hexdigest()
    duplicate = tmp_path / "duplicate"
    duplicate.write_text(f"{digest}  x\n{digest}  x\n", encoding="utf-8")
    with pytest.raises(experiment.EvidenceError, match="duplicate"):
        experiment.parse_checksum_manifest(duplicate)
    nested = tmp_path / "nested"
    nested.write_text(f"{digest}  nested/x\n", encoding="utf-8")
    with pytest.raises(experiment.EvidenceError, match="invalid"):
        experiment.parse_checksum_manifest(nested)


def test_single_use_write_rejects_second_attempt(tmp_path: Path) -> None:
    """A consumed lifecycle marker cannot be overwritten."""

    path = tmp_path / "marker.json"
    experiment.write_object_exclusive(path, {"ordinal": 1})
    with pytest.raises(experiment.EvidenceError, match="already exists"):
        experiment.write_object_exclusive(path, {"ordinal": 2})


def test_prepare_inventory_function_never_imports_zipfile() -> None:
    """Preparation can hash compressed bytes but has no ZIP-member API."""

    source = (experiment.HERE / "experiment.py").read_text(encoding="utf-8")
    assert "import zipfile" not in source
    assert "ZipFile(" not in source


def test_null_metric_is_explicit() -> None:
    """A missing metric carries both null value and reason."""

    metric = experiment.null_metric("MISSING_CAUSAL_INPUT")
    assert metric == {
        "status": "UNMEASURED",
        "value": None,
        "reason": "MISSING_CAUSAL_INPUT",
    }
