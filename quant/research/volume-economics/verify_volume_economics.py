#!/usr/bin/env python3
"""Offline exact-packet verifier for the frozen Volume economics successor."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WORKTREE = ROOT.parents[2]
BASE_COMMIT = "ef12b15e7490848012992e71f86ecae9064ca9ff"
BASE_TREE = "e5dab9cfafdaf156e40c67530558ae307cc2ce58"
SCRIPT_HASH = "576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826"
AUTHORIZED_PREFIX = "quant/research/volume-economics/"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require(condition: bool, code: str) -> None:
    if not condition:
        raise RuntimeError(code)


def git(*args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(WORKTREE), *args],
        text=True,
    ).strip()


def verify_sums() -> None:
    lines = (ROOT / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    require(bool(lines), "CHECKSUMS_EMPTY")
    names: set[str] = set()
    for line in lines:
        digest, name = line.split("  ", 1)
        require(len(digest) == 64, f"CHECKSUM_FORMAT:{name}")
        require(name not in names, f"CHECKSUM_DUPLICATE:{name}")
        names.add(name)
        path = ROOT / name
        require(path.is_file(), f"CHECKSUM_FILE_MISSING:{name}")
        require(sha256_file(path) == digest, f"CHECKSUM_MISMATCH:{name}")
    require("SHA256SUMS" not in names, "CHECKSUM_SELF_REFERENCE")


def main() -> None:
    policy = json.loads((ROOT / "economics-policy.v1.json").read_text(encoding="utf-8"))
    result = json.loads((ROOT / "terminal-result.v1.json").read_text(encoding="utf-8"))
    raw_manifest = json.loads(
        (ROOT / "archive-manifest.raw.json").read_text(encoding="utf-8")
    )
    manifest = json.loads(
        (ROOT / "archive-manifest.v1.json").read_text(encoding="utf-8")
    )
    equivalence = json.loads((ROOT / "source-equivalence.v1.json").read_text(encoding="utf-8"))

    require(policy["schemaVersion"] == "volume.economics-policy.v1", "POLICY_SCHEMA")
    require(policy["source"]["acceptedVolumeCommit"] == BASE_COMMIT, "POLICY_BASE")
    require(policy["source"]["acceptedVolumeTree"] == BASE_TREE, "POLICY_BASE_TREE")
    require(policy["source"]["measurementScriptSha256"] == SCRIPT_HASH, "POLICY_SCRIPT")
    require(sha256_file(ROOT / "measure_volume_12m.py") == SCRIPT_HASH, "SCRIPT_HASH")
    require(policy["outcomesKnownFromPriorConsumedRun"] is True, "OUTCOME_HISTORY")
    require(policy["verdict"]["oosGate"].startswith("FAILED_"), "OOS_TRUTH")
    require(policy["verdict"]["pboGate"] == "NOT_ESTABLISHED", "PBO_TRUTH")
    require(policy["defaults"]["strategyEnabled"] is False, "DEFAULT_OFF")
    require(policy["defaults"]["killSwitchEngaged"] is True, "KILL_ON")
    require(policy["defaults"]["submitAuthority"] is False, "SUBMIT_AUTHORITY")
    require(policy["defaults"]["casAuthority"] is False, "CAS_AUTHORITY")
    require(
        policy["defaults"]["orderTransferWithdrawalMoneyAuthority"] is False,
        "MONEY_AUTHORITY",
    )
    require(equivalence["status"] == "PASS", "SOURCE_EQUIVALENCE")
    require(equivalence["acceptedVolumeCommit"] == BASE_COMMIT, "EQUIVALENCE_BASE")
    require(
        all(
            item["historicalBlob"] == item["acceptedBlob"]
            for item in equivalence["paths"]
        ),
        "EQUIVALENCE_BLOB_MISMATCH",
    )

    require(isinstance(raw_manifest, list) and len(raw_manifest) == 120, "RAW_MANIFEST_COUNT")
    require(manifest["schemaVersion"] == "volume.archive-manifest.v1", "MANIFEST_SCHEMA")
    require(manifest["archiveCount"] == 120, "MANIFEST_COUNT")
    require(manifest["officialChecksumVerifiedCount"] == 120, "MANIFEST_VERIFY")
    require(
        manifest["rawManifestSha256"] == sha256_file(ROOT / "archive-manifest.raw.json"),
        "MANIFEST_RAW_BINDING",
    )
    require(
        len(manifest["records"]) == 120
        and all(
            item["checksumVerified"] is True
            and item["advertisedArchiveSha256"] == item["archiveSha256"]
            for item in manifest["records"]
        ),
        "MANIFEST_RECORDS",
    )
    require(
        result["schemaVersion"] == "volume.archive-conditional-economics.v1",
        "RESULT_SCHEMA",
    )
    require(result["verdict"]["archiveConditional"] == "NO_GO", "RESULT_VERDICT")
    require(result["verdict"]["oosGate"].startswith("FAILED_"), "RESULT_OOS")
    require(result["verdict"]["pboGate"] == "NOT_ESTABLISHED", "RESULT_PBO")
    require(result["verdict"]["executionAuthority"] == "NONE", "RESULT_AUTHORITY")
    require(result["feePosture"]["accountEffectiveFeeState"] == "UNKNOWN", "RESULT_FEES")
    require(result["capacity"]["supports1000QuoteNotional"] == "UNKNOWN", "RESULT_CAPACITY")
    for phase_id in ("phase0", "phase1"):
        scenarios = result["phases"][phase_id]["scenarios"]
        require([item["id"] for item in scenarios] == [
            "PUBLIC_10_BPS_PER_SIDE",
            "PUBLIC_12_BPS_PER_SIDE_STRESS",
        ], f"SCENARIO_ORDER:{phase_id}")
        require(
            float(scenarios[1]["bootstrap95"]["upperNetSyntheticUsdtPer1000"]) < 0,
            f"NO_GO_BOUNDARY:{phase_id}",
        )
        require(scenarios[1]["drawdown"]["capitalDrawdownClaim"] is False, "DRAWDOWN")

    verify_sums()
    head = git("rev-parse", "HEAD")
    if head != BASE_COMMIT:
        require(git("rev-parse", "HEAD^") == BASE_COMMIT, "DIRECT_PARENT")
        require(int(git("rev-list", "--count", f"{BASE_COMMIT}..HEAD")) == 1, "ONE_COMMIT")
        changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines()
        require(bool(changed), "EMPTY_SUCCESSOR")
        require(
            all(path.startswith(AUTHORIZED_PREFIX) for path in changed),
            "PATH_SCOPE",
        )
        require(git("status", "--porcelain") == "", "WORKTREE_DIRTY")
    print("VOLUME_ECONOMICS_VERIFY_PASS")


if __name__ == "__main__":
    main()
