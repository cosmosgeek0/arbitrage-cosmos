#!/usr/bin/env python3
"""Independent custody and authority verifier for terminal S-1Z."""

from __future__ import annotations

import hashlib
import json
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, cast

PACKET = Path(__file__).resolve().parent
REPO_ROOT = PACKET.parents[2]
BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SCOPE_PREFIX = "quant/research/s1z/"
EXPECTED = {
    "DISTINCTNESS.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "SHA256SUMS",
    "__init__.py",
    "acquire.py",
    "body-consumed.v1.json",
    "experiment.py",
    "freeze.v1.json",
    "input-audit.v1.json",
    "protocol.v1.json",
    "result.v1.json",
    "run-marker.v1.json",
    "seed-table.v1.json",
    "source-manifest.v1.json",
    "test_s1z.py",
    "trial-ledger.v1.json",
    "verdict.v1.json",
    "verifier.py",
}
SHA_LINE_RE = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$")


class VerificationError(RuntimeError):
    """Terminal proof failure."""


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def load_json(name: str) -> dict[str, Any]:
    path = PACKET / name
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict) or raw != canonical_bytes(value):
        raise VerificationError(f"{name} is not canonical object JSON")
    return cast(dict[str, Any], value)


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise VerificationError(f"git {' '.join(args)} failed")
    return completed.stdout.strip()


def exact_packet() -> None:
    observed: set[str] = set()
    for path in PACKET.iterdir():
        details = path.lstat()
        if stat.S_ISLNK(details.st_mode):
            raise VerificationError(f"symlink forbidden: {path.name}")
        if stat.S_ISREG(details.st_mode):
            observed.add(path.name)
        elif path.name != "__pycache__":
            raise VerificationError(f"unexpected directory: {path.name}")
    if observed != EXPECTED:
        raise VerificationError(
            f"packet inventory mismatch missing={sorted(EXPECTED - observed)} "
            f"extra={sorted(observed - EXPECTED)}"
        )


def checksums() -> None:
    lines = (PACKET / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    entries: dict[str, str] = {}
    for line in lines:
        match = SHA_LINE_RE.fullmatch(line)
        if match is None:
            raise VerificationError("SHA256SUMS grammar mismatch")
        digest, name = match.groups()
        if name in entries or name == "SHA256SUMS":
            raise VerificationError("SHA256SUMS duplicate/self entry")
        entries[name] = digest
    expected = EXPECTED - {"SHA256SUMS"}
    if set(entries) != expected:
        raise VerificationError("SHA256SUMS coverage mismatch")
    for name, digest in entries.items():
        if sha256_path(PACKET / name) != digest:
            raise VerificationError(f"checksum mismatch: {name}")


def git_proof() -> None:
    if git("status", "--porcelain=v1", "--untracked-files=all"):
        raise VerificationError("terminal worktree is dirty")
    head = git("rev-parse", "HEAD")
    if head != git("rev-parse", "@{upstream}"):
        raise VerificationError("terminal HEAD differs from upstream")
    if head != git("ls-remote", "--heads", "origin", git("branch", "--show-current")).split()[0]:
        raise VerificationError("terminal origin branch differs from HEAD")
    if git("rev-list", "--merges", f"{BASE_COMMIT}..HEAD", "--count") != "0":
        raise VerificationError("terminal history contains a merge")
    changed = set(git("diff", "--name-only", f"{BASE_COMMIT}..HEAD").splitlines())
    expected_paths = {SCOPE_PREFIX + name for name in EXPECTED}
    if changed != expected_paths:
        raise VerificationError("base-to-terminal path inventory mismatch")
    terminal_delta = set(git("diff", "--name-only", "HEAD^..HEAD").splitlines())
    expected_terminal = {
        SCOPE_PREFIX + name
        for name in (
            "SHA256SUMS",
            "body-consumed.v1.json",
            "result.v1.json",
            "trial-ledger.v1.json",
            "verdict.v1.json",
        )
    }
    if terminal_delta != expected_terminal:
        raise VerificationError("terminal commit delta mismatch")


def chronology() -> None:
    freeze = load_json("freeze.v1.json")
    marker = load_json("run-marker.v1.json")
    consumed = load_json("body-consumed.v1.json")
    freeze_commit = cast(str, marker["freezeCommit"])
    if git("diff", "--name-only", f"{freeze_commit}^..{freeze_commit}") != (
        SCOPE_PREFIX + "freeze.v1.json"
    ):
        raise VerificationError("freeze commit is not exclusive")
    if freeze["inputCommit"] != git("rev-parse", f"{freeze_commit}^"):
        raise VerificationError("freeze input commit chronology mismatch")
    marker_commit = cast(str, consumed["runMarkerCommit"])
    if git("rev-parse", f"{marker_commit}^") != freeze_commit:
        raise VerificationError("run-marker does not directly follow freeze")
    if git("diff", "--name-only", f"{marker_commit}^..{marker_commit}") != (
        SCOPE_PREFIX + "run-marker.v1.json"
    ):
        raise VerificationError("run-marker commit is not exclusive")
    if consumed["freezeSha256"] != sha256_path(PACKET / "freeze.v1.json"):
        raise VerificationError("consumption receipt freeze binding mismatch")
    if consumed["runMarkerSha256"] != sha256_path(PACKET / "run-marker.v1.json"):
        raise VerificationError("consumption receipt marker binding mismatch")
    static_hashes = cast(dict[str, str], freeze["staticSha256"])
    for name, digest in static_hashes.items():
        if sha256_path(PACKET / name) != digest:
            raise VerificationError(f"post-freeze mutation: {name}")


def semantic_proof() -> str:
    protocol = load_json("protocol.v1.json")
    manifest = load_json("source-manifest.v1.json")
    audit = load_json("input-audit.v1.json")
    result = load_json("result.v1.json")
    verdict = load_json("verdict.v1.json")
    ledger = load_json("trial-ledger.v1.json")
    if manifest.get("artifactCount") != 864 or audit.get("artifactCount") != 864:
        raise VerificationError("source Cartesian count mismatch")
    if (
        audit.get("status") != "PASS"
        or audit.get("economicValuesEmitted") is not False
        or audit.get("sourceBodiesOpened") is not False
        or audit.get("rowValidation") != "DEFERRED_UNTIL_EXCLUSIVE_CONSUMPTION"
    ):
        raise VerificationError("input audit semantics mismatch")
    if protocol.get("primaryTrialId") != "w120_l28_h3":
        raise VerificationError("primary trial changed")
    authority = cast(dict[str, Any], protocol["authority"])
    if (
        authority.get("capitalAuthority") != "NONE"
        or authority.get("executionAuthority") != "NONE"
        or authority.get("moneyEffectUsd") != "0"
    ):
        raise VerificationError("protocol authority is unsafe")
    if result.get("status") not in {"MEASURED", "UNMEASURED"}:
        raise VerificationError("result status is invalid")
    if result.get("rerun") != "FORBIDDEN":
        raise VerificationError("result rerun posture is invalid")
    if result.get("universeTruth") != "CURRENT_SNAPSHOT_ONLY_HISTORICAL_MEMBERSHIP_UNMEASURED":
        raise VerificationError("historical universe limitation is missing")
    if verdict != {
        "accountProfitability": "UNMEASURED",
        "capital": "NO_GO",
        "executionAuthority": "NONE",
        "publicProxy": result.get("publicProxyVerdict", "UNMEASURED"),
        "schemaVersion": "s1z.verdict.v1",
    }:
        raise VerificationError("verdict authority/result mismatch")
    if result.get("status") == "MEASURED":
        if result.get("window") != {
            "days": 365,
            "endExclusive": "2026-06-22T00:00:00Z",
            "start": "2025-06-22T00:00:00Z",
        }:
            raise VerificationError("measured window mismatch")
        inference = cast(dict[str, Any], result["inference"])
        if inference.get("localTrials") != 12:
            raise VerificationError("multiplicity family mismatch")
        pbo = cast(dict[str, Any], inference["pbo"])
        if pbo.get("diagnosticOnly") is not True or pbo.get("combinations") != 70:
            raise VerificationError("PBO semantics mismatch")
        trials = cast(list[Any], ledger["trials"])
        if len(trials) != 12:
            raise VerificationError("trial-ledger size mismatch")
    return cast(str, result["status"])


def verify() -> str:
    exact_packet()
    checksums()
    git_proof()
    chronology()
    return semantic_proof()


def main() -> int:
    try:
        status = verify()
    except (OSError, KeyError, TypeError, ValueError, VerificationError) as error:
        print(f"VERIFY_STOP {error}", file=sys.stderr)
        return 2
    print(f"VERIFY_PASS status={status} authority=NONE capital=NO_GO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
