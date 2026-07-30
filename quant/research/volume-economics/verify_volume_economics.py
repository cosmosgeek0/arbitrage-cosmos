#!/usr/bin/env python3
"""Offline exact-packet verifier for the Volume invalid-test correction."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
WORKTREE = ROOT.parents[2]
ACCEPTED_VOLUME_COMMIT = "ef12b15e7490848012992e71f86ecae9064ca9ff"
ACCEPTED_VOLUME_TREE = "e5dab9cfafdaf156e40c67530558ae307cc2ce58"
PREDECESSOR_COMMIT = "20a3a66acc2bd92638fd13b1377225ff8e8def6f"
PREDECESSOR_TREE = "bb14c2880ebce1a07ff32632bb7b63aa14ec5f26"
INVALID_RUN_PRODUCER_SHA256 = "576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826"
AUTHORIZED_PREFIX = "quant/research/volume-economics/"
IMMUTABLE_PREDECESSOR_FILES = {
    ".gitattributes": "6519a73728d2d0ea8904f902a30bcb000b5fc985a1f43ce0f79a47f3536edf11",
    ".gitignore": "862263fa1f46c20f0d1e4dac5ffcc75abd55c08211b2c3864c5f8764b9d87793",
    "accepted-events.phase0.csv": (
        "7b950cabcdcb4a2282956e520f03c83c7bd50451743c46b206e8e2ec5f75c1f0"
    ),
    "accepted-events.phase1.csv": (
        "ce1fd2d3197ee115153ce7af244eb76e0f2c7d7da7e17b97aecbbe83cc92ed0e"
    ),
    "archive-manifest.raw.json": "8826021ada900746dfff9fff9c46722d7d65c74f5e9a1a0453e65f0480801179",
    "archive-manifest.v1.json": "e1a118c314aa5d508195dc4d5de44635147bfe7787c9d3da11ba5f185b647ec5",
    "economics-policy.v1.json": "27402815b52079d9d34eda0e822ec7a7598af9f12fe797533cde731a8551266e",
    "measure_volume_12m.py": INVALID_RUN_PRODUCER_SHA256,
    "official-source-review.v1.json": (
        "2fb1970561d15d77c5e50b70b5cd774ee13550eb7824ce64cca162c5207e7a62"
    ),
    "raw-result.phase0.json": "6eb83892634acf5f1be609802224fb31c825321634e8b2218842219a54fd2f7c",
    "raw-result.phase1.json": "3fc42ad96a001420e19475265a6223cda16d24315a1c2b3c2ceeff25a25b3a0b",
    "run-metadata.phase0.json": "debf496390b6a4a3b7ea73285bb1df3d3bec4d421b4f114d16056e37ddd9382d",
    "run-metadata.phase1.json": "87c3cd8e78259716372b953f20d2e23ffa6a01d0a51b122a816836d9285a11a7",
    "seal_archive_manifest.py": "93d5c3c78bb62301930f6e417cd14d06eea8fe26cd80a0569e832acde48bb62e",
    "source-equivalence.v1.json": (
        "f29c4381e13dc8f72cfbf432435f503ebfc7b4044d650e703e1774fd5c1fba4c"
    ),
}


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


def read_json(name: str) -> dict[str, Any]:
    value = json.loads((ROOT / name).read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"JSON_OBJECT_REQUIRED:{name}")
    return value


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
    expected = {
        path.name for path in ROOT.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    }
    require(names == expected, "CHECKSUM_INVENTORY_MISMATCH")


def exact_count_map(
    result: dict[str, Any],
    field: str,
    symbols: list[str],
    phase: str,
) -> dict[str, int]:
    value = result.get(field)
    require(isinstance(value, dict), f"RAW_CHRONOLOGY_MAP:{phase}:{field}")
    require(set(value) == set(symbols), f"RAW_CHRONOLOGY_SYMBOLS:{phase}:{field}")
    for symbol, count in value.items():
        require(
            isinstance(count, int) and not isinstance(count, bool) and count >= 0,
            f"RAW_CHRONOLOGY_COUNT:{phase}:{field}:{symbol}",
        )
    return {symbol: value[symbol] for symbol in symbols}


def verify_lineage() -> None:
    require(
        git("rev-parse", f"{PREDECESSOR_COMMIT}^{{tree}}") == PREDECESSOR_TREE, "PREDECESSOR_TREE"
    )
    head = git("rev-parse", "HEAD")
    require(head != PREDECESSOR_COMMIT, "CORRECTION_NOT_FROZEN")
    require(git("rev-parse", "HEAD^") == PREDECESSOR_COMMIT, "DIRECT_PARENT")
    require(
        int(git("rev-list", "--count", f"{PREDECESSOR_COMMIT}..HEAD")) == 1,
        "ONE_CORRECTION_COMMIT",
    )
    changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines()
    require(bool(changed), "EMPTY_CORRECTION")
    require(all(path.startswith(AUTHORIZED_PREFIX) for path in changed), "PATH_SCOPE")
    require(git("status", "--porcelain") == "", "WORKTREE_DIRTY")


def main() -> None:
    policy = read_json("economics-policy.v1.json")
    result = read_json("terminal-result.v1.json")
    raw_manifest = json.loads((ROOT / "archive-manifest.raw.json").read_text(encoding="utf-8"))
    manifest = read_json("archive-manifest.v1.json")
    equivalence = read_json("source-equivalence.v1.json")
    raw_results = {
        "phase0": read_json("raw-result.phase0.json"),
        "phase1": read_json("raw-result.phase1.json"),
    }

    for name, digest in IMMUTABLE_PREDECESSOR_FILES.items():
        require(sha256_file(ROOT / name) == digest, f"IMMUTABLE_PREDECESSOR_CHANGED:{name}")

    require(policy["schemaVersion"] == "volume.economics-policy.v1", "POLICY_SCHEMA")
    require(
        policy["source"]["acceptedVolumeCommit"] == ACCEPTED_VOLUME_COMMIT,
        "POLICY_BASE",
    )
    require(
        policy["source"]["acceptedVolumeTree"] == ACCEPTED_VOLUME_TREE,
        "POLICY_BASE_TREE",
    )
    require(
        policy["source"]["measurementScriptSha256"] == INVALID_RUN_PRODUCER_SHA256,
        "POLICY_INVALID_RUN_PRODUCER",
    )
    require(policy["outcomesKnownFromPriorConsumedRun"] is True, "OUTCOME_HISTORY")
    require(policy["defaults"]["strategyEnabled"] is False, "DEFAULT_OFF")
    require(policy["defaults"]["killSwitchEngaged"] is True, "KILL_ON")
    require(policy["defaults"]["mode"] == "SHADOW_ONLY", "SHADOW_ONLY")
    require(policy["defaults"]["submitAuthority"] is False, "SUBMIT_AUTHORITY")
    require(policy["defaults"]["casAuthority"] is False, "CAS_AUTHORITY")
    require(policy["defaults"]["privateOrSignedAuthority"] is False, "PRIVATE_AUTHORITY")
    require(
        policy["defaults"]["orderTransferWithdrawalMoneyAuthority"] is False,
        "MONEY_AUTHORITY",
    )
    require(equivalence["status"] == "PASS", "SOURCE_EQUIVALENCE")
    require(
        equivalence["acceptedVolumeCommit"] == ACCEPTED_VOLUME_COMMIT,
        "EQUIVALENCE_BASE",
    )
    require(
        all(item["historicalBlob"] == item["acceptedBlob"] for item in equivalence["paths"]),
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

    symbols = policy["dataset"]["symbols"]
    exact_anomalies: dict[str, dict[str, dict[str, int]]] = {}
    for phase, raw in raw_results.items():
        duplicates = exact_count_map(
            raw,
            "archiveIdenticalDuplicateRowsBySymbol",
            symbols,
            phase,
        )
        out_of_order = exact_count_map(
            raw,
            "archiveOutOfOrderTransitionsBySymbol",
            symbols,
            phase,
        )
        exact_anomalies[phase] = {
            "duplicates": {symbol: count for symbol, count in duplicates.items() if count},
            "outOfOrder": {symbol: count for symbol, count in out_of_order.items() if count},
        }
        require(
            exact_anomalies[phase]["duplicates"] == {"NEARUSDT": 2313},
            f"DUPLICATE_EVIDENCE:{phase}",
        )
        require(exact_anomalies[phase]["outOfOrder"] == {"NEARUSDT": 1}, f"ORDER_EVIDENCE:{phase}")

    require(result["schemaVersion"] == "volume.archive-conditional-economics.v1", "RESULT_SCHEMA")
    require(result["testStatus"] == "INVALID_TEST", "RESULT_TEST_STATUS")
    require(result["measurementStatus"] == "UNMEASURED", "RESULT_MEASUREMENT_STATUS")
    require(result["goNoGo"] == "NOT_APPLICABLE", "RESULT_GO_NO_GO")
    require(result["sample"] is None, "RESULT_SAMPLE")
    require(result["phases"] is None, "RESULT_PHASES")
    require(all(value is None for value in result["economics"].values()), "RESULT_ECONOMICS")
    require(result["capacity"]["supports1000QuoteNotional"] == "UNKNOWN", "RESULT_CAPACITY")
    require(result["feePosture"]["accountEffectiveFeeState"] == "UNKNOWN", "RESULT_FEES")
    require(result["verdict"]["testDisposition"] == "INVALID_TEST", "RESULT_DISPOSITION")
    require(result["verdict"]["archiveConditional"] == "UNMEASURED", "RESULT_VERDICT")
    require(result["verdict"]["oosGate"].startswith("FAILED_"), "RESULT_OOS")
    require(result["verdict"]["pboGate"] == "NOT_ESTABLISHED", "RESULT_PBO")
    require(result["verdict"]["repairAuthority"] == "NONE", "RESULT_REPAIR")
    require(result["verdict"]["rerunAuthority"] == "NONE", "RESULT_RERUN")
    require(result["verdict"]["executionAuthority"] == "NONE", "RESULT_AUTHORITY")
    require(
        result["rejectedEvidence"]["phase0"]["reportedDuplicateCollapsedKeysBySymbol"]
        == exact_anomalies["phase0"]["duplicates"],
        "RESULT_PHASE0_DUPLICATES",
    )
    require(
        result["rejectedEvidence"]["phase1"]["reportedDuplicateCollapsedKeysBySymbol"]
        == exact_anomalies["phase1"]["duplicates"],
        "RESULT_PHASE1_DUPLICATES",
    )
    require(
        result["rejectedEvidence"]["phase0"]["reportedOutOfOrderTransitionsBySymbol"]
        == exact_anomalies["phase0"]["outOfOrder"],
        "RESULT_PHASE0_ORDER",
    )
    require(
        result["rejectedEvidence"]["phase1"]["reportedOutOfOrderTransitionsBySymbol"]
        == exact_anomalies["phase1"]["outOfOrder"],
        "RESULT_PHASE1_ORDER",
    )
    fail_closed_hash = sha256_file(ROOT / "measure_volume_12m_fail_closed.py")
    require(
        result["source"]["failClosedEntrypointSha256"] == fail_closed_hash,
        "FAIL_CLOSED_ENTRYPOINT_BINDING",
    )
    require(
        result["source"]["recordedOfficialChecksumVerifications"] == 120,
        "RECORDED_CHECKSUM_VERIFICATIONS",
    )
    require(
        result["source"]["rawArchiveBytesPresentInGit"] is False,
        "RAW_ARCHIVE_CUSTODY",
    )
    require(result["sourceRules"]["sortAllowed"] is False, "SORT_FORBIDDEN")
    require(
        result["sourceRules"]["deduplicationAllowed"] is False,
        "DEDUP_FORBIDDEN",
    )
    require(
        result["sourceRules"]["rowOrSymbolExclusionAllowed"] is False,
        "EXCLUSION_FORBIDDEN",
    )
    require(
        result["sourceRules"]["gapFillOrRepairAllowed"] is False,
        "REPAIR_FORBIDDEN",
    )

    verify_sums()
    verify_lineage()
    print("VOLUME_ECONOMICS_INVALID_TEST_VERIFY_PASS")


if __name__ == "__main__":
    main()
