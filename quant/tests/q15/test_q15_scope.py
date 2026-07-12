from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE = "f756f3b582f24857811e6ec4c0d08a3a61026b74"
OWNER_INPUTS = {"DIRECTOR_Q_L_TWO_LANE_LAUNCH.md", "QUANT_EDGE_RESEARCH_FACTORY_12H.md"}
OWNER_INPUT_SHA256 = {
    "DIRECTOR_Q_L_TWO_LANE_LAUNCH.md": (
        "26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06"
    ),
    "QUANT_EDGE_RESEARCH_FACTORY_12H.md": (
        "198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4"
    ),
}


def _allowed(path: str) -> bool:
    return path.startswith(
        (
            "quant/src/quant_edge/registry_ops/",
            "quant/tests/q15/",
            "quant/generated/q15/",
            "quant/TASKS/Q15",
            "quant/RECEIPTS/Q15",
            "quant/DECISIONS/Q15",
        )
    )


def test_all_q15_changes_stay_inside_exclusive_write_set() -> None:
    assert {
        path: hashlib.sha256((REPO_ROOT / path).read_bytes()).hexdigest()
        for path in sorted(OWNER_INPUTS)
    } == OWNER_INPUT_SHA256
    tracked = subprocess.run(
        ["git", "diff", "--name-only", BASE],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    changed = set(tracked) | (set(untracked) - OWNER_INPUTS)
    assert changed
    assert not [path for path in sorted(changed) if not _allowed(path)]


def test_branch_and_base_are_exact() -> None:
    branch = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE, "HEAD"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert branch == "q15-registry-20260712"
    assert ancestry.returncode == 0
