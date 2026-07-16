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
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q05_label_golden_v1.json"
CAMPAIGN_JSON_PATH = QUANT_ROOT / "generated" / "q05" / "label_campaign.v1.json"
CAMPAIGN_MD_PATH = QUANT_ROOT / "generated" / "q05" / "label_campaign.v1.md"
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q05_label_campaign.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def test_committed_fixture_is_canonical_and_honest() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)

    assert fixture["schema"] == "Q05LabelGoldenFixtureV1"
    assert fixture["version"] == 1
    assert canonical_json_bytes(fixture) == raw
    manifest = _object(fixture["manifest"])
    assert manifest["schema"] == "Q05LabelManifestV1"
    assert _object(manifest["dispositionCounts"]) == {
        "ACTED": 1,
        "DATA_INVALID": 1,
        "QUIET_CONTROL": 1,
    }
    reference = _object(fixture["objectiveOutcomeReference"])
    assert reference["objectiveOutcomeOwner"] == "quantEdgeLabels"
    basis = _object(fixture["basisLabel"])
    assert basis["maxExecutableNetEdgeStatus"] == "UNAVAILABLE"
    assert basis["feasibility"] == "FEASIBLE"


def test_campaign_artifacts_regenerate_byte_identically() -> None:
    sys.path.insert(0, str(QUANT_ROOT / "scripts"))
    try:
        from q05_label_campaign import build_artifacts
    finally:
        sys.path.pop(0)
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()

    assert fixture_bytes == FIXTURE_PATH.read_bytes()
    assert campaign_bytes == CAMPAIGN_JSON_PATH.read_bytes()
    assert markdown_bytes == CAMPAIGN_MD_PATH.read_bytes()


def test_campaign_json_binds_fixture_and_synthetic_posture() -> None:
    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())

    assert campaign["schema"] == "Q05LabelCampaignV1"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    seeded = _object(campaign["seeded"])
    assert seeded["seed"] == "20260712"
    statuses = _object(seeded["horizonStatusCounts"])
    censored = statuses.get("CENSORED", 0)
    assert isinstance(censored, int)
    assert censored > 0, "the seeded sweep must exercise censoring"


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
        output_root / "fixtures" / "q05_label_golden_v1.json"
    ).read_bytes() == FIXTURE_PATH.read_bytes()
    assert (
        output_root / "generated" / "q05" / "label_campaign.v1.json"
    ).read_bytes() == CAMPAIGN_JSON_PATH.read_bytes()
    assert (
        output_root / "generated" / "q05" / "label_campaign.v1.md"
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
