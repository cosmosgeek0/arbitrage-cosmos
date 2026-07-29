"""Offline non-recomputing verifier for the terminal S-1J evidence packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final

HERE: Final = Path(__file__).resolve().parent
FREEZE_INPUTS: Final = (
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "METHODOLOGY.md",
    "protocol.v1.json",
    "trial_ledger.v1.json",
    "source_plan.v1.json",
    "experiment.py",
    "verifier.py",
    "test_experiment.py",
    "test_verifier.py",
)


class VerificationError(RuntimeError):
    """Packet authentication or terminal-semantics failure."""


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise VerificationError(f"cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise VerificationError(f"{path.name} must contain an object")
    return value


def parse_sums(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text().splitlines()
    except OSError as exc:
        raise VerificationError(f"cannot read SHA256SUMS: {exc}") from exc
    result: dict[str, str] = {}
    for line in lines:
        parts = line.split("  ", 1)
        if len(parts) != 2 or len(parts[0]) != 64 or parts[1] in result:
            raise VerificationError("malformed SHA256SUMS")
        result[parts[1]] = parts[0]
    return result


def validate_result_semantics(result: Mapping[str, Any], holdout_marker_exists: bool) -> None:
    if result.get("schema") != "cosmos.quant.s1j.result.v1":
        raise VerificationError("result schema mismatch")
    if result.get("status") != "TERMINAL":
        raise VerificationError("result is not terminal")
    if result.get("verdict") not in {"NO_GO", "UNMEASURED"}:
        raise VerificationError("public-only S-1J cannot serialize GO")
    if result.get("capital") != "NO_GO" or result.get("authority") != "NONE":
        raise VerificationError("authority boundary drift")
    fees = result.get("fees")
    if fees is not None:
        if not isinstance(fees, dict):
            raise VerificationError("fees must be an object")
        if (
            fees.get("accountEffectiveSpot") != "UNKNOWN"
            or fees.get("accountEffectiveUsdM") != "UNKNOWN"
        ):
            raise VerificationError("account fee truth promoted")
    maker = result.get("makerEntry")
    if maker is not None:
        if not isinstance(maker, dict) or maker.get("fillTruth") != "UNKNOWN":
            raise VerificationError("maker fill truth promoted")
        if maker.get("role") != "NON_AUTHORITATIVE_SENSITIVITY":
            raise VerificationError("maker case received authority")
    holdout = result.get("holdout")
    if not isinstance(holdout, dict):
        raise VerificationError("holdout object absent")
    status = str(holdout.get("status"))
    opened_statuses = {"OPENED_CHAMPION_ONLY", "OPENED_TERMINAL_ERROR"}
    not_opened_statuses = {
        "SEALED_NOT_OPENED_DEVELOPMENT_GATE_FAIL",
        "NOT_OPENED_TERMINAL_ERROR",
    }
    if status in opened_statuses and not holdout_marker_exists:
        raise VerificationError("opened holdout lacks marker")
    if status in not_opened_statuses and holdout_marker_exists:
        raise VerificationError("not-opened holdout unexpectedly has marker")
    if status not in opened_statuses | not_opened_statuses:
        raise VerificationError("unknown holdout lifecycle status")
    if result.get("verdict") == "UNMEASURED":
        proxy_status = str(result.get("publicProxyStatus"))
        allowed = {
            "INVALID_EVIDENCE",
            "PUBLIC_PROXY_POSITIVE_ACCOUNT_AND_EXECUTION_UNKNOWN",
        }
        if proxy_status not in allowed:
            raise VerificationError("UNMEASURED reason is not frozen")


def verify_packet(root: Path = HERE) -> dict[str, Any]:
    sums = parse_sums(root / "SHA256SUMS")
    required = {
        *FREEZE_INPUTS,
        "freeze.v1.json",
        "run_consumed.v1.json",
        "candidate_seal.v1.json",
        "result.v1.json",
    }
    if not required.issubset(sums):
        raise VerificationError(f"SHA256SUMS missing {sorted(required - set(sums))}")
    for name, expected in sums.items():
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise VerificationError(f"summed file missing or symlinked: {name}")
        if sha256_path(path) != expected:
            raise VerificationError(f"digest mismatch: {name}")
    freeze = read_json(root / "freeze.v1.json")
    frozen_hashes = freeze.get("fileSha256")
    if not isinstance(frozen_hashes, dict) or set(frozen_hashes) != set(FREEZE_INPUTS):
        raise VerificationError("freeze inventory mismatch")
    for name, expected in frozen_hashes.items():
        if sha256_path(root / name) != expected:
            raise VerificationError(f"freeze byte drift: {name}")
    run_marker = read_json(root / "run_consumed.v1.json")
    candidate = read_json(root / "candidate_seal.v1.json")
    result = read_json(root / "result.v1.json")
    freeze_sha = sha256_path(root / "freeze.v1.json")
    run_sha = sha256_path(root / "run_consumed.v1.json")
    candidate_sha = sha256_path(root / "candidate_seal.v1.json")
    if run_marker.get("freezeSha256") != freeze_sha:
        raise VerificationError("run marker freeze binding mismatch")
    if candidate.get("freezeSha256") != freeze_sha:
        raise VerificationError("candidate freeze binding mismatch")
    if candidate.get("runMarkerSha256") != run_sha:
        raise VerificationError("candidate run-marker binding mismatch")
    if result.get("freezeSha256") != freeze_sha:
        raise VerificationError("result freeze binding mismatch")
    frozen_commit = run_marker.get("frozenCommit")
    if (
        not isinstance(frozen_commit, str)
        or candidate.get("frozenCommit") != frozen_commit
        or result.get("frozenCommit") != frozen_commit
    ):
        raise VerificationError("frozen commit lineage mismatch")
    holdout_exists = (root / "holdout_opened.v1.json").is_file()
    if holdout_exists:
        if "holdout_opened.v1.json" not in sums:
            raise VerificationError("opened holdout marker absent from SHA256SUMS")
        holdout_marker = read_json(root / "holdout_opened.v1.json")
        if holdout_marker.get("frozenCommit") != frozen_commit:
            raise VerificationError("holdout frozen commit mismatch")
        if holdout_marker.get("candidateSealSha256") != candidate_sha:
            raise VerificationError("holdout candidate binding mismatch")
        holdout_sha = sha256_path(root / "holdout_opened.v1.json")
        holdout_result = result.get("holdout")
        if (
            not isinstance(holdout_result, dict)
            or holdout_result.get("markerSha256") != holdout_sha
        ):
            raise VerificationError("result holdout-marker binding mismatch")
    if result.get("runMarkerSha256") != run_sha:
        raise VerificationError("result run-marker binding mismatch")
    if result.get("candidateSealSha256") != candidate_sha:
        raise VerificationError("result candidate binding mismatch")
    validate_result_semantics(result, holdout_exists)
    source = result.get("source")
    if isinstance(source, dict) and source.get("sharedArchivesMutated") is not False:
        raise VerificationError("shared archive disposition missing")
    return {
        "status": "VERIFIED",
        "verdict": result["verdict"],
        "publicProxyStatus": result["publicProxyStatus"],
        "champion": result.get("champion"),
        "netUsdPer1000": result.get("netUsdPer1000"),
        "holdout": result["holdout"]["status"],
        "pbo": result.get("pbo"),
        "frozenCommit": frozen_commit,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=HERE)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = verify_packet(args.root.resolve())
    except VerificationError as exc:
        print(f"S1J_VERIFY_ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
