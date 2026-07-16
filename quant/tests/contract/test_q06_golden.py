from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q06_feature_golden_v1.json"
CAMPAIGN_JSON_PATH = QUANT_ROOT / "generated" / "q06" / "feature_campaign.v1.json"
CAMPAIGN_MD_PATH = QUANT_ROOT / "generated" / "q06" / "feature_campaign.v1.md"
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q06_feature_campaign.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def test_committed_fixture_is_canonical_and_equivalence_passed() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)

    assert fixture["schema"] == "Q06FeatureGoldenFixtureV1"
    assert canonical_json_bytes(fixture) == raw
    registry = _object(fixture["registry"])
    assert registry["schema"] == "Q06FeatureRegistryV1"
    reports = fixture["goldenReports"]
    assert isinstance(reports, list)
    assert len(reports) == 4
    for report in reports:
        mapping = _object(report)
        assert mapping["passed"] is True
        assert mapping["statusMismatches"] == 0


def test_campaign_artifacts_regenerate_byte_identically() -> None:
    sys.path.insert(0, str(QUANT_ROOT / "scripts"))
    try:
        from q06_feature_campaign import build_artifacts
    finally:
        sys.path.pop(0)
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()

    assert fixture_bytes == FIXTURE_PATH.read_bytes()
    assert campaign_bytes == CAMPAIGN_JSON_PATH.read_bytes()
    assert markdown_bytes == CAMPAIGN_MD_PATH.read_bytes()


def test_campaign_json_binds_fixture_and_measured_drift() -> None:
    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())

    assert campaign["schema"] == "Q06FeatureCampaignV1"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["seed"] == "20260712"
    assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    drift = _object(campaign["maxUlpByFeature"])
    assert set(drift) == {
        "activity_intensity:v1",
        "bar_return:v1",
        "ewma_variance:v1",
        "robust_z:v1",
    }


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
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert (
        output_root / "fixtures" / "q06_feature_golden_v1.json"
    ).read_bytes() == FIXTURE_PATH.read_bytes()
    assert (
        output_root / "generated" / "q06" / "feature_campaign.v1.json"
    ).read_bytes() == CAMPAIGN_JSON_PATH.read_bytes()
    assert (
        output_root / "generated" / "q06" / "feature_campaign.v1.md"
    ).read_bytes() == CAMPAIGN_MD_PATH.read_bytes()


def test_campaign_script_usage_error() -> None:
    result = subprocess.run(
        [sys.executable, str(CAMPAIGN_SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )

    assert result.returncode == 2
    assert "usage" in result.stderr
