from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.models.synthetic import build_battery_dataset

pytest.importorskip("quant_edge.models.battery", reason="Q10 models extra not installed")

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q10_model_golden_v1.json"
CAMPAIGN_JSON_PATH = QUANT_ROOT / "generated" / "q10" / "model_campaign.v1.json"
CAMPAIGN_MD_PATH = QUANT_ROOT / "generated" / "q10" / "model_campaign.v1.md"
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q10_model_campaign.py"

EXPECTED_TARGETS = (
    "attention_rank:v1",
    "net_edge_quantiles:v1",
    "net_edge_regression:v1",
    "transition_binary:v1",
)


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def _object_list(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    return [_object(item) for item in value]


def test_committed_fixture_is_canonical_and_complete() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)
    assert fixture["schema"] == "Q10ModelGoldenFixtureV1"
    assert canonical_json_bytes(fixture) == raw

    result = _object(fixture["battery"])
    assert result["schema"] == "Q10BatteryResultV1"
    assert result["seed"] == "20260712"
    assert _object(result["frameworks"]) == {
        "optuna": "4.9.0",
        "scikit-learn": "1.9.0",
        "xgboost": "3.3.0",
    }
    split = _object(result["split"])
    assert split["authority"] == "BATTERY_INTERNAL_NON_AUTHORITATIVE"

    dataset = _object(result["dataset"])
    rebuilt = build_battery_dataset(20260712)
    assert dataset["contentSha256"] == rebuilt.content_digest.hexdigest
    assert dataset["rowCount"] == 640

    reports = _object_list(result["reports"])
    assert [report["targetId"] for report in reports] == list(EXPECTED_TARGETS)
    for report in reports:
        results = _object_list(report["results"])
        assert len(results) >= 4
        model_ids = [cast(str, item["modelId"]) for item in results]
        assert model_ids == sorted(model_ids)
        assert report["winnerModelId"] in model_ids
        roles = {cast(str, item["role"]) for item in results}
        assert roles == {"BOOSTED_CHALLENGER", "CONTROL", "TRANSPARENT_BASELINE"}

    studies = _object_list(result["studies"])
    assert len(studies) == 4
    for study in studies:
        spec = _object(study["spec"])
        trials = _object_list(study["trials"])
        assert spec["nTrials"] == 12
        assert len(trials) == 12
        assert [trial["trialIndex"] for trial in trials] == list(range(12))
        assert all(trial["state"] in ("COMPLETE", "FAILED") for trial in trials)
        assert study["bestTrialIndex"] is not None

    dispositions = _object_list(result["dispositions"])
    assert len(dispositions) == 24
    waiting = [
        record["bulletId"] for record in dispositions if record["disposition"] == "WAITING_Q14"
    ]
    assert len(waiting) == 5


def test_frozen_honest_challenger_loss_on_the_regression_target() -> None:
    fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
    reports = _object_list(_object(fixture["battery"])["reports"])
    regression = next(
        report for report in reports if report["targetId"] == "net_edge_regression:v1"
    )
    assert regression["winnerModelId"] == "ols:v1"
    results = _object_list(regression["results"])
    challenger_ids = {
        cast(str, item["modelId"]) for item in results if item["role"] == "BOOSTED_CHALLENGER"
    }
    assert challenger_ids == {"xgb_regressor:v1", "xgb_regressor_tuned:v1"}

    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())
    losses = _object_list(campaign["honestChallengerLosses"])
    regression_loss = next(loss for loss in losses if loss["targetId"] == "net_edge_regression:v1")
    assert regression_loss["winnerModelId"] == "ols:v1"
    assert regression_loss["losingChallengers"] == sorted(challenger_ids)


def test_campaign_json_binds_fixture_and_studies() -> None:
    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())
    assert campaign["schema"] == "Q10ModelCampaignV1"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["seed"] == "20260712"
    assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
    battery_bytes = canonical_json_bytes(_object(fixture["battery"]))
    assert campaign["batterySha256"] == hashlib.sha256(battery_bytes).hexdigest()
    winners = _object(campaign["winnersByTarget"])
    assert set(winners) == set(EXPECTED_TARGETS)
    summaries = _object_list(campaign["studySummaries"])
    assert len(summaries) == 4
    for summary in summaries:
        assert summary["loggedTrials"] == summary["requestedTrials"] == 12


def test_campaign_artifacts_regenerate_byte_identically() -> None:
    sys.path.insert(0, str(QUANT_ROOT / "scripts"))
    try:
        from q10_model_campaign import build_artifacts
    finally:
        sys.path.pop(0)
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    assert fixture_bytes == FIXTURE_PATH.read_bytes()
    assert campaign_bytes == CAMPAIGN_JSON_PATH.read_bytes()
    assert markdown_bytes == CAMPAIGN_MD_PATH.read_bytes()


@pytest.mark.parametrize(
    ("timezone", "hash_seed"),
    [("UTC", "0"), ("Pacific/Kiritimati", "987654")],
)
def test_campaign_script_is_process_deterministic(
    tmp_path: Path,
    timezone: str,
    hash_seed: str,
) -> None:
    output_root = tmp_path / "out"
    env = dict(os.environ)
    env["TZ"] = timezone
    env["PYTHONHASHSEED"] = hash_seed
    result = subprocess.run(
        [sys.executable, str(CAMPAIGN_SCRIPT), str(output_root)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    )
    assert result.returncode == 0, result.stderr
    assert (
        output_root / "fixtures" / "q10_model_golden_v1.json"
    ).read_bytes() == FIXTURE_PATH.read_bytes()
    assert (
        output_root / "generated" / "q10" / "model_campaign.v1.json"
    ).read_bytes() == CAMPAIGN_JSON_PATH.read_bytes()
    assert (
        output_root / "generated" / "q10" / "model_campaign.v1.md"
    ).read_bytes() == CAMPAIGN_MD_PATH.read_bytes()
    assert "wall-ns" in result.stdout


def test_campaign_script_usage_error() -> None:
    result = subprocess.run(
        [sys.executable, str(CAMPAIGN_SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 2
    assert "usage" in result.stderr
