from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import parse_canonical_object
from quant_edge.derivatives.campaign import build_artifacts

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "tests" / "q08" / "fixtures" / "q08_derivatives_golden_v1.json"
CAMPAIGN_JSON = QUANT_ROOT / "generated" / "q08" / "derivatives_campaign.v1.json"
CAMPAIGN_MD = QUANT_ROOT / "generated" / "q08" / "derivatives_campaign.v1.md"

pytestmark = pytest.mark.contract


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


class TestCommittedArtifacts:
    def test_committed_artifacts_equal_in_process_regeneration(self) -> None:
        fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
        assert FIXTURE_PATH.read_bytes() == fixture_bytes
        assert CAMPAIGN_JSON.read_bytes() == campaign_bytes
        assert CAMPAIGN_MD.read_bytes() == markdown_bytes

    def test_fixture_is_canonical_and_internally_hash_bound(self) -> None:
        fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
        campaign = parse_canonical_object(CAMPAIGN_JSON.read_bytes())
        assert fixture["schema"] == "Q08DerivativesGoldenFixtureV1"
        assert campaign["schema"] == "Q08DerivativesCampaignV1"
        assert campaign["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
        assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
        assert campaign["seed"] == "20260712"

    def test_fixture_pins_the_acceptance_conditions(self) -> None:
        fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
        cases = _object(fixture["executableCases"])
        normal_case = _object(_object(cases["normalKnown"])["executable"])
        reverse_case = _object(_object(cases["reverseKnown"])["executable"])
        # Normal and reverse constructions remain distinct.
        assert normal_case["entryBasis"] != reverse_case["entryBasis"]
        assert normal_case["construction"] == "NORMAL"
        assert reverse_case["construction"] == "REVERSE"
        # Missing borrow or funding never becomes zero.
        unknown_borrow = _object(_object(cases["reverseUnknownBorrow"])["netEdge"])
        assert unknown_borrow["status"] == "UNKNOWN"
        assert unknown_borrow["value"] is None
        reasons = unknown_borrow["reasons"]
        assert isinstance(reasons, list)
        assert "BORROW_UNKNOWN" in reasons
        unknown_cost = _object(_object(cases["normalUnknownCost"])["netEdge"])
        assert unknown_cost["status"] == "UNKNOWN"
        assert unknown_cost["value"] is None
        funding = _object(fixture["funding"])
        missing_level = _object(funding["missingLevel"])
        assert missing_level["status"] == "UNKNOWN"
        assert missing_level["value"] is None
        assert _object(funding["missingTimeToNext"])["status"] == "UNKNOWN"
        # Liquidation truth stays sampled and unknown notional stays unknown.
        liquidations = _object(fixture["liquidations"])
        assert _object(liquidations["count"])["sampling"] == "SAMPLED"
        unknown_notional = _object(liquidations["unknownNotional"])
        assert unknown_notional["status"] == "UNKNOWN"
        assert unknown_notional["value"] is None
        # Every golden equivalence report passed at zero deviation.
        reports = fixture["goldenReports"]
        assert isinstance(reports, list)
        assert len(reports) == 4
        for report in reports:
            mapping = _object(report)
            assert mapping["passed"] is True
            assert mapping["maxUlpDeviation"] == 0
        assert _object(fixture["leadLag"])["postureNote"] == "EVIDENCE_ONLY"

    def test_campaign_measured_zero_drift(self) -> None:
        campaign = parse_canonical_object(CAMPAIGN_JSON.read_bytes())
        max_ulp = _object(campaign["maxUlpByFeature"])
        assert len(max_ulp) == 4
        assert all(value == 0 for value in max_ulp.values())
        pairs = campaign["seededPairs"]
        assert isinstance(pairs, list)
        assert len(pairs) == 12


class TestCrossProcessDeterminism:
    def test_campaign_bytes_survive_cwd_timezone_and_hash_seed_changes(
        self,
        tmp_path: Path,
    ) -> None:
        outputs: list[tuple[bytes, bytes, bytes]] = []
        for index, (timezone, hash_seed) in enumerate(
            (("UTC", "0"), ("Australia/Eucla", "424242"))
        ):
            output_root = tmp_path / f"run-{index}"
            work_dir = tmp_path / f"cwd-{index}"
            work_dir.mkdir()
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "quant_edge.derivatives.campaign",
                    str(output_root),
                ],
                cwd=work_dir,
                env={
                    "PATH": "/usr/bin:/bin",
                    "TZ": timezone,
                    "PYTHONHASHSEED": hash_seed,
                    "PYTHONPATH": str(QUANT_ROOT / "src"),
                },
                check=True,
                capture_output=True,
                timeout=120,
            )
            outputs.append(
                (
                    (
                        output_root
                        / "tests"
                        / "q08"
                        / "fixtures"
                        / "q08_derivatives_golden_v1.json"
                    ).read_bytes(),
                    (
                        output_root / "generated" / "q08" / "derivatives_campaign.v1.json"
                    ).read_bytes(),
                    (output_root / "generated" / "q08" / "derivatives_campaign.v1.md").read_bytes(),
                )
            )
        assert outputs[0] == outputs[1]
        # The subprocess artifacts equal the committed artifacts byte for byte.
        assert outputs[0][0] == FIXTURE_PATH.read_bytes()
        assert outputs[0][1] == CAMPAIGN_JSON.read_bytes()
        assert outputs[0][2] == CAMPAIGN_MD.read_bytes()

    def test_campaign_usage_error_is_deterministic(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "quant_edge.derivatives.campaign"],
            cwd=QUANT_ROOT,
            env={
                "PATH": "/usr/bin:/bin",
                "PYTHONPATH": str(QUANT_ROOT / "src"),
            },
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 2
        assert "usage" in result.stderr
