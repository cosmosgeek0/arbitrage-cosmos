from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.micro.families import disposition_table_digest

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q07_micro_golden_v1.json"
CAMPAIGN_JSON_PATH = QUANT_ROOT / "generated" / "q07" / "micro_campaign.v1.json"
CAMPAIGN_MD_PATH = QUANT_ROOT / "generated" / "q07" / "micro_campaign.v1.md"
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q07_micro_campaign.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def test_committed_fixture_is_canonical_and_equivalence_passed() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)

    assert fixture["schema"] == "Q07MicroGoldenFixtureV1"
    assert canonical_json_bytes(fixture) == raw
    registry = _object(fixture["registry"])
    assert registry["schema"] == "Q06FeatureRegistryV1"
    reports = fixture["goldenReports"]
    assert isinstance(reports, list)
    assert len(reports) == 16
    for report in reports:
        mapping = _object(report)
        assert mapping["passed"] is True
        assert mapping["statusMismatches"] == 0
        assert mapping["maxUlpDeviation"] == 0
    table = fixture["dispositionTable"]
    assert isinstance(table, list)
    assert len(table) == 17
    assert fixture["dispositionSha256"] == disposition_table_digest().hexdigest
    semantics = fixture["spoofPatternSemantics"]
    assert isinstance(semantics, str)
    assert "never attribute individual intent" in semantics


def test_campaign_artifacts_regenerate_byte_identically() -> None:
    sys.path.insert(0, str(QUANT_ROOT / "scripts"))
    try:
        from q07_micro_campaign import build_artifacts
    finally:
        sys.path.pop(0)
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()

    assert fixture_bytes == FIXTURE_PATH.read_bytes()
    assert campaign_bytes == CAMPAIGN_JSON_PATH.read_bytes()
    assert markdown_bytes == CAMPAIGN_MD_PATH.read_bytes()


def test_campaign_json_binds_fixture_and_measured_costs() -> None:
    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())

    assert campaign["schema"] == "Q07MicroCampaignV1"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["seed"] == "20260712"
    assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    ulp = _object(campaign["maxUlpByFeature"])
    ops = _object(campaign["maxUpdateOpsByFeature"])
    expected_ids = {
        "absorption_ratio:v1",
        "amihud_illiquidity:v1",
        "band_flow:v1",
        "book_slope_imbalance:v1",
        "cumulative_band_imbalance:v1",
        "depth_resiliency:v1",
        "effective_spread:v1",
        "kyle_slope:v1",
        "l1_queue_imbalance:v1",
        "microprice_displacement:v1",
        "ofi_l1:v1",
        "signed_trade_imbalance:v1",
        "size_concentration_hhi:v1",
        "trade_dispersion:v1",
        "trade_intensity:v1",
        "vwap_spread_at_size:v1",
    }
    assert set(ulp) == expected_ids
    assert set(ops) == expected_ids
    assert all(value == 0 for value in ulp.values())
    scenarios = campaign["seededScenarios"]
    assert isinstance(scenarios, list)
    assert len(scenarios) == 10


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
        output_root / "fixtures" / "q07_micro_golden_v1.json"
    ).read_bytes() == FIXTURE_PATH.read_bytes()
    assert (
        output_root / "generated" / "q07" / "micro_campaign.v1.json"
    ).read_bytes() == CAMPAIGN_JSON_PATH.read_bytes()
    assert (
        output_root / "generated" / "q07" / "micro_campaign.v1.md"
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
