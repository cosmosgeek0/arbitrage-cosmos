#!/usr/bin/env python3
"""Independent structural verifier for the sealed S-2C packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
BASE = "a169b123fb186d1943a75ad648552c4d95be1be1"
SUMS_PATH = HERE / "SHA256SUMS"
STATE_ROOT = Path("/private/tmp/cosmos-s2c-low-residual-vol-1be1-54d8-state")
RAW_ROOT = STATE_ROOT / "raw"
PACKET_FILES = (
    ".gitignore",
    "CANDIDATE_SEALED.v1.json",
    "DISTINCTNESS.md",
    "README.md",
    "RUN_STARTED.v1.json",
    "__init__.py",
    "development.v1.json",
    "experiment.py",
    "official_sources.v1.json",
    "protocol.freeze.v1.json",
    "protocol.v1.json",
    "result.v1.json",
    "source_manifest.v1.json",
    "source_plan.v1.json",
    "test_experiment.py",
    "verifier.py",
)


class VerificationError(RuntimeError):
    """Packet verification failure."""


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise VerificationError(f"OBJECT_REQUIRED:{path.name}")
    return value


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            value.update(chunk)
    return value.hexdigest()


def verify_static() -> None:
    freeze = load(HERE / "protocol.freeze.v1.json")
    hashes = freeze.get("staticSha256")
    if not isinstance(hashes, dict):
        raise VerificationError("FREEZE_HASH_MAP_INVALID")
    for name, expected in hashes.items():
        path = HERE / str(name)
        if not path.is_file() or digest(path) != expected:
            raise VerificationError(f"STATIC_DIGEST_INVALID:{name}")


def verify_manifest() -> int:
    manifest = load(HERE / "source_manifest.v1.json")
    if manifest.get("freezeSha256") != digest(HERE / "protocol.freeze.v1.json"):
        raise VerificationError("MANIFEST_FREEZE_INVALID")
    rows = manifest.get("rows")
    if not isinstance(rows, list) or not rows:
        raise VerificationError("MANIFEST_ROWS_INVALID")
    for raw in rows:
        if not isinstance(raw, dict):
            raise VerificationError("MANIFEST_ROW_INVALID")
        archive = RAW_ROOT / str(raw["relativePath"])
        sidecar = RAW_ROOT / str(raw["checksumRelativePath"])
        if digest(archive) != raw["archiveSha256"]:
            raise VerificationError(f"ARCHIVE_DIGEST_INVALID:{raw['relativePath']}")
        if digest(sidecar) != raw["checksumSha256"]:
            raise VerificationError(f"SIDECAR_DIGEST_INVALID:{raw['relativePath']}")
        declared = sidecar.read_text(encoding="utf-8").strip().split()[0].lower()
        if declared != raw["archiveSha256"]:
            raise VerificationError(f"SIDECAR_BINDING_INVALID:{raw['relativePath']}")
    return len(rows)


def verify_result() -> dict[str, Any]:
    result = load(HERE / "result.v1.json")
    if result.get("state") not in {"TERMINAL_MEASURED", "TERMINAL_UNMEASURED"}:
        raise VerificationError("RESULT_STATE_INVALID")
    if result.get("verdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VerificationError("VERDICT_INVALID")
    if result.get("capitalVerdict") != "NO_GO":
        raise VerificationError("CAPITAL_VERDICT_INVALID")
    if result.get("executionAuthority") != "NONE":
        raise VerificationError("EXECUTION_AUTHORITY_INVALID")
    lifecycle = result.get("lifecycle")
    if not isinstance(lifecycle, dict) or lifecycle.get("runCount") != 1:
        raise VerificationError("RUN_COUNT_INVALID")
    if lifecycle.get("networkCallsDuringEvaluation") != 0:
        raise VerificationError("EVALUATION_NETWORK_INVALID")
    holdout = result.get("holdout")
    if not isinstance(holdout, dict):
        raise VerificationError("HOLDOUT_INVALID")
    opened = holdout.get("openedCount")
    marker = HERE / "HOLDOUT_OPENED.v1.json"
    state_marker = STATE_ROOT / "HOLDOUT_OPENED.v1.json"
    if opened == 0:
        if marker.exists() or state_marker.exists():
            raise VerificationError("UNOPENED_HOLDOUT_MARKER_PRESENT")
    elif opened == 1:
        if not marker.is_file() or not state_marker.is_file():
            raise VerificationError("OPENED_HOLDOUT_MARKER_MISSING")
    else:
        raise VerificationError("HOLDOUT_OPEN_COUNT_INVALID")
    return result


def verify_scope() -> None:
    root = HERE.parents[2]
    command = ["git", "-C", str(root), "diff", "--name-only", f"{BASE}..HEAD"]
    output = subprocess.run(command, check=True, text=True, capture_output=True).stdout.splitlines()
    if any(not path.startswith("quant/research/s2c/") for path in output):
        raise VerificationError("SCOPE_INVALID")


def sums_payload() -> str:
    names = [name for name in PACKET_FILES if (HERE / name).is_file()]
    if (HERE / "HOLDOUT_OPENED.v1.json").is_file():
        names.append("HOLDOUT_OPENED.v1.json")
    return "".join(f"{digest(HERE / name)}  {name}\n" for name in sorted(names))


def write_sums() -> None:
    SUMS_PATH.write_text(sums_payload(), encoding="utf-8")


def verify_sums() -> None:
    if not SUMS_PATH.is_file():
        raise VerificationError("SHA256SUMS_MISSING")
    if SUMS_PATH.read_text(encoding="utf-8") != sums_payload():
        raise VerificationError("SHA256SUMS_INVALID")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-sums", action="store_true")
    parser.add_argument("--skip-scope", action="store_true")
    args = parser.parse_args(argv)
    try:
        verify_static()
        count = verify_manifest()
        result = verify_result()
        if args.write_sums:
            write_sums()
        verify_sums()
        if not args.skip_scope:
            verify_scope()
    except (
        OSError,
        KeyError,
        ValueError,
        subprocess.CalledProcessError,
        VerificationError,
    ) as error:
        print(f"S2C_VERIFY_FAIL {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "status": "PASS",
                "artifactCount": count,
                "state": result["state"],
                "verdict": result["verdict"],
                "holdoutState": result["holdout"]["state"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
