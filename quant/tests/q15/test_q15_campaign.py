from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from q15_fixtures import BASE_COMMIT, REPO_ROOT

from quant_edge.registry_ops.campaign import build_campaign, render_markdown

COMMITTED = REPO_ROOT / "quant" / "generated" / "q15"


def test_campaign_records_exact_champion_demotion_and_mismatch() -> None:
    cards, campaign, synthetic = build_campaign(REPO_ROOT, code_commit=BASE_COMMIT)
    initial = campaign["initialChampion"]
    final = campaign["finalChampion"]
    assert isinstance(initial, dict)
    assert isinstance(final, dict)
    assert initial["modelId"] == final["modelId"]
    assert initial["artifactSha256"] == final["artifactSha256"]
    assert final["posture"] == "ABSTAIN_UNKNOWN"
    assert campaign["q14IdentityMismatchRejected"] is True
    assert campaign["feedbackState"] == "MATURED"
    assert campaign["shadowEvaluationCounts"] == {
        "distinctEventCount": 1,
        "evaluationUnitCount": 1,
        "slotId": "transition-binary",
    }
    assert campaign["transitionCount"] == 2
    assert cards["schema"] == "Q15RegistryCardsV1"
    assert b"Q15SyntheticPromotionReportV1" in synthetic
    markdown = render_markdown(campaign)
    assert "Challenger self-promoted by drift: `false`" in markdown


def _generate(output: Path, cwd: Path, *, timezone: str, hash_seed: str) -> None:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(REPO_ROOT / "quant" / "src")
    environment["PYTHONHASHSEED"] = hash_seed
    environment["TZ"] = timezone
    subprocess.run(
        [
            sys.executable,
            "-m",
            "quant_edge.registry_ops.campaign",
            str(output),
            str(REPO_ROOT),
            BASE_COMMIT,
        ],
        cwd=cwd,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_campaign_is_byte_deterministic_across_process_cwd_timezone_and_hash_seed(
    tmp_path: Path,
) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    cwd_a = tmp_path / "cwd-a"
    cwd_b = tmp_path / "cwd-b"
    cwd_a.mkdir()
    cwd_b.mkdir()
    _generate(first, cwd_a, timezone="UTC", hash_seed="0")
    _generate(second, cwd_b, timezone="Pacific/Kiritimati", hash_seed="987654")
    expected_names = tuple(sorted(path.name for path in COMMITTED.iterdir()))
    assert tuple(sorted(path.name for path in first.iterdir())) == expected_names
    assert tuple(sorted(path.name for path in second.iterdir())) == expected_names
    for name in expected_names:
        committed = (COMMITTED / name).read_bytes()
        assert (first / name).read_bytes() == committed
        assert (second / name).read_bytes() == committed
