from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

QUANT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = QUANT_ROOT.parent
SHARD_BASE_SHA = "24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd"
SHARD_TIP_SHA = "4bac0892fd410d60edcf7b35f8ca59a5e0cf37c9"

# D-LAUNCH-5 shard law: one writer, this exact allowlist, everything else frozen.
ALLOWED_PREFIXES = (
    "quant/src/quant_edge/derivatives/",
    "quant/tests/q08/",
    "quant/generated/q08/",
)
ALLOWED_STATE_PREFIXES = (
    "quant/TASKS/Q08",
    "quant/RECEIPTS/Q08",
    "quant/DECISIONS/Q08",
)
FROZEN_PATHS = (
    "EDGE_PROTOCOL_V1.md",
    "packages/edge-protocol",
    "packages/edge-protocol-tests",
    "quant/DIRECTIVE_INPUTS.lock",
    "quant/src/quant_edge/features",
    "quant/src/quant_edge/labels",
    "quant/src/quant_edge/lake",
    "quant/src/quant_edge/book",
    "quant/src/quant_edge/bootstrap",
    "quant/pyproject.toml",
    "quant/uv.lock",
)


pytestmark = pytest.mark.contract


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    return result.stdout


def _shard_path_allowed(path: str) -> bool:
    if any(path.startswith(prefix) for prefix in ALLOWED_PREFIXES):
        return True
    return any(path.startswith(prefix) for prefix in ALLOWED_STATE_PREFIXES)


def test_the_shard_base_commit_is_an_ancestor() -> None:
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", SHARD_BASE_SHA, SHARD_TIP_SHA],
        cwd=REPO_ROOT,
        check=True,
        timeout=60,
    )


def test_every_commit_after_the_shard_base_stays_inside_the_allowlist() -> None:
    output = _git(
        "log",
        "--format=",
        "--name-only",
        "--no-renames",
        f"{SHARD_BASE_SHA}..{SHARD_TIP_SHA}",
    )
    committed = sorted({line for line in output.splitlines() if line})
    violations = [path for path in committed if not _shard_path_allowed(path)]
    assert not violations, violations


def test_frozen_paths_are_byte_identical_to_the_shard_base() -> None:
    result = subprocess.run(
        [
            "git",
            "diff",
            "--quiet",
            SHARD_BASE_SHA,
            SHARD_TIP_SHA,
            "--",
            *FROZEN_PATHS,
        ],
        cwd=REPO_ROOT,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, "a frozen path differs from the shard base"


def test_the_audited_shard_tip_is_exact() -> None:
    assert _git("rev-parse", f"{SHARD_TIP_SHA}^{{commit}}").strip() == SHARD_TIP_SHA
