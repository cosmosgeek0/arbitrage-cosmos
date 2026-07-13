from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.models.battery import SECTION_14_BATTERY_DISPOSITIONS
from quant_edge.models.contracts import disposition_table_digest

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q12_ensemble_golden_v1.json"
CAMPAIGN_PATH = QUANT_ROOT / "generated" / "q12" / "ensemble_campaign.v1.json"
MARKDOWN_PATH = QUANT_ROOT / "generated" / "q12" / "ensemble_campaign.v1.md"
SCRIPT_PATH = QUANT_ROOT / "scripts" / "q12_ensemble_campaign.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def _object_list(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    return [_object(item) for item in value]


def test_committed_q12_fixture_is_canonical_complete_and_synthetic_only() -> None:
    raw = FIXTURE_PATH.read_bytes()
    fixture = parse_canonical_object(raw)
    assert canonical_json_bytes(fixture) == raw
    assert fixture["schema"] == "Q12EnsembleGoldenFixtureV1"
    assert fixture["seed"] == "20260712"
    assert fixture["evidencePosture"] == "SYNTHETIC_ONLY"
    assert len(cast(str, fixture["matrixDigest"])) == 64

    closure = _object(fixture["closure"])
    records = _object_list(closure["records"])
    assert len(records) == 5
    assert all(record["status"] == "ADAPTED_CLOSED" for record in records)
    assert (
        closure["q10DispositionDigest"]
        == disposition_table_digest(SECTION_14_BATTERY_DISPOSITIONS).hexdigest
    )
    assert closure["q14AcceptanceCommit"] == "e266b42913fb721cc2a8470a08774be3fdf1ce0c"
    assert closure["q14DirectorMerge"] == "f756f3b582f24857811e6ec4c0d08a3a61026b74"

    stack_comparison = _object(fixture["stack"])
    stack = _object(stack_comparison["selectedGrid16"])
    coarse = _object(stack_comparison["coarseGrid8"])
    assert stack["schema"] == coarse["schema"] == "Q12FittedStackV1"
    assert stack["weightDivisions"] == 16
    assert coarse["weightDivisions"] == 8
    selected_brier = _object(stack["trainingBrier"])
    coarse_brier = _object(coarse["trainingBrier"])
    assert selected_brier == {
        "denominator": "6144000000",
        "numerator": "749353027",
    }
    assert coarse_brier == {
        "denominator": "12288000",
        "numerator": "1501607",
    }
    assert int(cast(str, selected_brier["numerator"])) * int(
        cast(str, coarse_brier["denominator"])
    ) < int(cast(str, coarse_brier["numerator"])) * int(cast(str, selected_brier["denominator"]))
    assert set(_object(stack["weights"])) == {
        "specialist-linear:v1",
        "specialist-robust:v1",
    }
    calibration = _object(fixture["calibration"])
    assert calibration["chosenMethod"] in {
        "PLATT_CHRONOLOGICAL",
        "ISOTONIC_CHRONOLOGICAL",
    }
    assert len(_object_list(calibration["evaluations"])) == 2
    conformal = _object(fixture["conformal"])
    assert _object(conformal["model"])["semantics"] == "EMPIRICAL_NONEXCHANGEABLE_CHALLENGER"
    assert _object(conformal["coverage"])["status"] == "AVAILABLE"
    assert _object(fixture["adaptive"])["prefixDigestUnchangedByUnknownOutcome"] is True


def test_acceptance_abstention_matrix_and_q14_validation_evidence() -> None:
    fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
    decisions = _object(fixture["decisions"])
    expected = {
        "conflicting": "SPECIALIST_CONFLICT",
        "costNegative": "COST_NEGATIVE",
        "costUnknown": "COST_UNKNOWN",
        "ood": "OOD_SUSPECT",
        "stale": "EVIDENCE_STALE",
    }
    for case, reason in expected.items():
        decision = _object(_object(decisions[case])["decision"])
        assert decision["action"] == "ABSTAIN_UNKNOWN"
        assert reason in cast(list[str], decision["reasons"])
        assert decision["calibratedProbability"] is None
        assert decision["interval"] is None
    healthy = _object(_object(decisions["healthy"])["decision"])
    assert healthy["action"] == "WATCH"
    assert healthy["reasons"] == []

    validation = _object(fixture["validationSummary"])
    assert validation["honestLeakageVerdict"] == "ACCEPTED_FOR_COMPARISON"
    assert validation["implausibleLeakageVerdict"] == "REJECTED_IMPLAUSIBLE_SKILL"
    assert validation["temporalLeakageVerdict"] == "REJECTED_TEMPORAL_LEAK"
    assert validation["holdoutOpenCallsPerBuild"] == 1
    assert validation["holdoutCount"] == 16
    assert validation["bootstrapStatus"] == "AVAILABLE"
    assert validation["pboStatus"] == "AVAILABLE"
    assert validation["dsrStatus"] == "AVAILABLE"


def test_campaign_binds_fixture_and_summary() -> None:
    campaign = parse_canonical_object(CAMPAIGN_PATH.read_bytes())
    assert campaign["schema"] == "Q12EnsembleCampaignV1"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["q10WaitingQ14Closed"] == 5
    assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    actions = _object(campaign["abstentionActions"])
    assert actions["healthy"] == "WATCH"
    assert all(action == "ABSTAIN_UNKNOWN" for case, action in actions.items() if case != "healthy")
    markdown = MARKDOWN_PATH.read_text(encoding="utf-8")
    assert "synthetic only" in markdown.lower()
    assert "ABSTAIN_UNKNOWN" in markdown
    assert "ADAPTED_CLOSED" in markdown


def test_campaign_artifacts_regenerate_byte_identically_in_process() -> None:
    sys.path.insert(0, str(QUANT_ROOT / "scripts"))
    try:
        from q12_ensemble_campaign import build_artifacts
    finally:
        sys.path.pop(0)
    fixture, campaign, markdown = build_artifacts()
    assert fixture == FIXTURE_PATH.read_bytes()
    assert campaign == CAMPAIGN_PATH.read_bytes()
    assert markdown == MARKDOWN_PATH.read_bytes()


@pytest.mark.parametrize(
    ("timezone", "hash_seed"),
    [("UTC", "0"), ("Pacific/Kiritimati", "987654")],
)
def test_campaign_is_process_cwd_timezone_and_hash_seed_deterministic(
    tmp_path: Path,
    timezone: str,
    hash_seed: str,
) -> None:
    output = tmp_path / "out"
    env = dict(os.environ)
    env["TZ"] = timezone
    env["PYTHONHASHSEED"] = hash_seed
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), str(output)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert (output / "fixtures" / FIXTURE_PATH.name).read_bytes() == FIXTURE_PATH.read_bytes()
    assert (
        output / "generated" / "q12" / CAMPAIGN_PATH.name
    ).read_bytes() == CAMPAIGN_PATH.read_bytes()
    assert (
        output / "generated" / "q12" / MARKDOWN_PATH.name
    ).read_bytes() == MARKDOWN_PATH.read_bytes()
    assert "wall-ns" in result.stdout


def test_campaign_usage_error_is_real() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 2
    assert "usage" in result.stderr
