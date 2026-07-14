from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from quant_edge.book.replay import run_replay, script_from_mapping
from quant_edge.canonical import canonical_json_bytes, parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q04_replay_golden_v1.json"
CAMPAIGN_JSON_PATH = QUANT_ROOT / "generated" / "q04" / "replay_campaign.v1.json"
CAMPAIGN_MD_PATH = QUANT_ROOT / "generated" / "q04" / "replay_campaign.v1.md"
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q04_replay_campaign.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def test_committed_fixture_is_canonical_and_binds_exact_digests() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)

    assert fixture["schema"] == "Q04ReplayGoldenFixtureV1"
    assert fixture["version"] == 1
    assert canonical_json_bytes(fixture) == raw
    for product_key in ("spot", "usdM"):
        entry = _object(fixture[product_key])
        script = script_from_mapping(entry["script"])
        assert script.script_digest.hexdigest == entry["scriptSha256"]
        result = run_replay(script)
        assert result.result_digest.hexdigest == entry["resultSha256"]
        assert result.final_view.model_eligible


def test_golden_replay_settles_through_lawful_resynchronization_only() -> None:
    fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
    for product_key in ("spot", "usdM"):
        entry = _object(fixture[product_key])
        result = run_replay(script_from_mapping(entry["script"]))
        transitions = [
            _object(effect)
            for effect in (effect.as_mapping() for effect in result.effects)
            if effect["effect"] == "QUALITY_TRANSITION"
        ]
        to_complete = [t for t in transitions if t["toQuality"] == "COMPLETE"]
        assert to_complete, "the golden script must reach COMPLETE"
        assert all(t["reasonCode"] == "SYNC_VALIDATED" for t in to_complete)
        assert all(t["fromQuality"] == "RECONSTRUCTING" for t in to_complete)
        # The golden script includes at least one full gap/resync cycle.
        assert any(t["toQuality"] == "GAPPED" for t in transitions)


def test_campaign_artifacts_regenerate_byte_identically() -> None:
    sys.path.insert(0, str(QUANT_ROOT / "scripts"))
    try:
        from q04_replay_campaign import build_artifacts
    finally:
        sys.path.pop(0)
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()

    assert fixture_bytes == FIXTURE_PATH.read_bytes()
    assert campaign_bytes == CAMPAIGN_JSON_PATH.read_bytes()
    assert markdown_bytes == CAMPAIGN_MD_PATH.read_bytes()


def test_campaign_json_binds_fixture_and_synthetic_posture() -> None:
    campaign = parse_canonical_object(CAMPAIGN_JSON_PATH.read_bytes())

    assert campaign["schema"] == "Q04ReplayCampaignV1"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["seed"] == "20260712"
    assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    for product_key in ("spot", "usdM"):
        entry = _object(campaign[product_key])
        golden = _object(entry["golden"])
        seeded = _object(entry["seeded"])
        assert golden["finalModelEligible"] is True
        assert seeded["scripts"] == seeded["completeFinalViews"]
        totals = _object(seeded["totalAnomalies"])
        assert totals, "seeded campaigns must actually exercise anomalies"


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
    generated = output_root / "fixtures" / "q04_replay_golden_v1.json"
    assert generated.read_bytes() == FIXTURE_PATH.read_bytes()
    assert (
        output_root / "generated" / "q04" / "replay_campaign.v1.json"
    ).read_bytes() == CAMPAIGN_JSON_PATH.read_bytes()
    assert (
        output_root / "generated" / "q04" / "replay_campaign.v1.md"
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
