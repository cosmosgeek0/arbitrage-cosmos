"""Focused verifier-law tests for S-1S."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import experiment
import pytest


def make_terminal_result(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """Build one valid synthetic terminal result."""

    marker = tmp_path / "marker.json"
    marker.write_text("{}\n", encoding="utf-8")
    freeze = tmp_path / "freeze.json"
    freeze.write_text("{}\n", encoding="utf-8")
    manifest = tmp_path / "manifest.json"
    manifest.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(experiment, "RUN_MARKER_PATH", marker)
    monkeypatch.setattr(experiment, "FREEZE_PATH", freeze)
    monkeypatch.setattr(experiment, "SOURCE_MANIFEST_PATH", manifest)
    return experiment.build_unmeasured_result({"runOrdinal": 1})


def test_terminal_result_rejects_non_null_net(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An UNMEASURED packet cannot smuggle in a profitability number."""

    result = make_terminal_result(tmp_path, monkeypatch)
    tampered = copy.deepcopy(result)
    metrics = tampered["metrics"]
    assert isinstance(metrics, dict)
    net = metrics["netPer1000Usd"]
    assert isinstance(net, dict)
    net["publicTakerProxyUsd"] = 1.0
    with pytest.raises(experiment.EvidenceError, match="must be null"):
        experiment.validate_terminal_result(tampered)


def test_terminal_result_rejects_authority(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Research evidence cannot grant execution authority."""

    result = make_terminal_result(tmp_path, monkeypatch)
    tampered = copy.deepcopy(result)
    authority = tampered["authority"]
    assert isinstance(authority, dict)
    authority["execution"] = "ENABLED"
    with pytest.raises(experiment.EvidenceError, match="authority"):
        experiment.validate_terminal_result(tampered)


def test_terminal_result_rejects_opened_holdout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A causal preflight failure must leave holdout unopened."""

    result = make_terminal_result(tmp_path, monkeypatch)
    tampered = copy.deepcopy(result)
    holdout = tampered["holdout"]
    assert isinstance(holdout, dict)
    holdout["archiveMembersOpenedByS1S"] = True
    with pytest.raises(experiment.EvidenceError, match="holdout custody"):
        experiment.validate_terminal_result(tampered)


def test_static_json_objects_parse() -> None:
    """Every pre-run JSON artifact is an object."""

    for name in (
        "protocol.v1.json",
        "trial_ledger.v1.json",
        "source_plan.v1.json",
    ):
        value = json.loads((experiment.HERE / name).read_text(encoding="utf-8"))
        assert isinstance(value, dict)
