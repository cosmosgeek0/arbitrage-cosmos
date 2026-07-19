from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE = "f756f3b582f24857811e6ec4c0d08a3a61026b74"
TIP = "e69f6879b5914879b5d9342e3f05fa964f5b9496"


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
    changed = set(
        subprocess.run(
            [
                "git",
                "log",
                "--format=",
                "--name-only",
                "--no-renames",
                f"{BASE}..{TIP}",
            ],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
    )
    changed.discard("")
    assert changed
    assert not [path for path in sorted(changed) if not _allowed(path)]


def test_audited_tip_and_base_are_exact() -> None:
    resolved_base = subprocess.run(
        ["git", "rev-parse", f"{BASE}^{{commit}}"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    resolved_tip = subprocess.run(
        ["git", "rev-parse", f"{TIP}^{{commit}}"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE, TIP],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert resolved_base == BASE
    assert resolved_tip == TIP
    assert ancestry.returncode == 0
