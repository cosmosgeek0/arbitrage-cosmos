"""Q14 golden fixture and campaign determinism contracts."""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

from q14_validation_campaign import build_artifacts

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
GENERATED = QUANT_ROOT / "generated" / "q14"
FIXTURE_PATH = GENERATED / "q14_validation_golden_v1.json"
CAMPAIGN_JSON_PATH = GENERATED / "validation_campaign.v1.json"
CAMPAIGN_MD_PATH = GENERATED / "validation_campaign.v1.md"
CAMPAIGN_SCRIPT = QUANT_ROOT / "tests" / "q14" / "q14_validation_campaign.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def test_committed_fixture_is_canonical_and_rejects_the_leak() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)
    assert fixture["schema"] == "Q14ValidationGoldenFixtureV1"
    assert canonical_json_bytes(fixture) == raw

    leaked = _object(fixture["leakedAssessment"])
    assert leaked["verdict"] == "REJECTED_TEMPORAL_LEAK"
    forged = _object(fixture["forgedAssessment"])
    assert forged["verdict"] == "REJECTED_IMPLAUSIBLE_SKILL"
    honest = _object(fixture["honestAssessment"])
    assert honest["verdict"] == "ACCEPTED_FOR_COMPARISON"

    comparison = _object(fixture["comparison"])
    assert comparison["verdict"] == "IMPROVES"
    assert comparison["holdoutGrant"] is not None

    plan = _object(fixture["plan"])
    assert plan["status"] == "VALID"
    holdout_ids = plan["holdoutSampleIds"]
    assert isinstance(holdout_ids, list)
    assert holdout_ids
    folds = plan["folds"]
    assert isinstance(folds, list)
    assert len(folds) == 4
    for fold in folds:
        members = _object(fold)
        train = members["trainSampleIds"]
        validation = members["validationSampleIds"]
        assert isinstance(train, list)
        assert isinstance(validation, list)
        assert not set(train) & set(holdout_ids)
        assert not set(validation) & set(holdout_ids)

    stress = _object(fixture["stress"])
    outcomes = stress["outcomes"]
    assert isinstance(outcomes, list)
    fee_shock = _object(outcomes[1])
    assert isinstance(fee_shock["flippedFromBaseCount"], int)
    assert fee_shock["flippedFromBaseCount"] > 0

    assert _object(fixture["pbo"])["status"] == "AVAILABLE"
    assert _object(fixture["deflatedSharpe"])["status"] == "AVAILABLE"
    assert _object(fixture["bootstrapInterval"])["status"] == "AVAILABLE"
    ledger = _object(fixture["trialLedger"])
    assert ledger["attemptedCount"] == 3


def test_campaign_binds_fixture_and_rejection_battery() -> None:
    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())
    assert campaign["schema"] == "Q14ValidationCampaignV1"
    fixture_sha = hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    assert campaign["goldenFixtureSha256"] == fixture_sha
    assert campaign["temporalRejections"] == campaign["batteryDatasets"]
    assert campaign["behavioralRejections"] == campaign["batteryDatasets"]
    assert campaign["honestAccepted"] == campaign["batteryDatasets"]
    assert campaign["comparisonVerdict"] == "IMPROVES"
    battery = campaign["battery"]
    assert isinstance(battery, list)
    assert len(battery) == campaign["batteryDatasets"]
    for entry in battery:
        row = _object(entry)
        assert row["temporalVerdict"] == "REJECTED_TEMPORAL_LEAK"
        assert row["behavioralVerdict"] == "REJECTED_IMPLAUSIBLE_SKILL"
        assert row["honestVerdict"] == "ACCEPTED_FOR_COMPARISON"


def test_campaign_artifacts_regenerate_byte_identically() -> None:
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    assert fixture_bytes == FIXTURE_PATH.read_bytes()
    assert campaign_bytes == CAMPAIGN_JSON_PATH.read_bytes()
    assert markdown_bytes == CAMPAIGN_MD_PATH.read_bytes()


def _run_campaign(target: Path, cwd: Path, extra_env: dict[str, str]) -> None:
    env = {key: value for key, value in os.environ.items() if key not in ("TZ", "PYTHONHASHSEED")}
    env.update(extra_env)
    result = subprocess.run(
        [sys.executable, str(CAMPAIGN_SCRIPT), str(target)],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_campaign_is_process_and_environment_deterministic(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    other_cwd = tmp_path / "elsewhere"
    other_cwd.mkdir()
    _run_campaign(first, QUANT_ROOT, {"TZ": "UTC", "PYTHONHASHSEED": "0"})
    _run_campaign(second, other_cwd, {"TZ": "Pacific/Kiritimati", "PYTHONHASHSEED": "31337"})
    for name in (
        "q14_validation_golden_v1.json",
        "validation_campaign.v1.json",
        "validation_campaign.v1.md",
    ):
        first_bytes = (first / "generated" / "q14" / name).read_bytes()
        second_bytes = (second / "generated" / "q14" / name).read_bytes()
        assert first_bytes == second_bytes
        assert first_bytes == (GENERATED / name).read_bytes()


def test_campaign_usage_error_is_loud() -> None:
    result = subprocess.run(
        [sys.executable, str(CAMPAIGN_SCRIPT)],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 2
    assert "usage" in result.stderr
