"""Offline Phase-1 verifier for the frozen V-G9 packet."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final

from research.vg9 import experiment as e

HERE: Final = Path(__file__).resolve().parent
FREEZE_INPUTS: Final = (
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "DISTINCTNESS.md",
    "__init__.py",
    "protocol.v1.json",
    "source_manifest.v1.json",
    "experiment.py",
    "verify.py",
    "test_experiment.py",
    "test_verify.py",
)
FORBIDDEN_PHASE1_ARTIFACTS: Final = (
    "development_opened.v1.json",
    "development_result.v1.json",
    "candidate_seal.v1.json",
    "holdout_opened.v1.json",
    "result.v1.json",
    "evidence",
)


class VerificationError(RuntimeError):
    """The tracked freeze, source metadata, or unopened-state proof failed."""


def parse_sums(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text().splitlines()
    except OSError as exc:
        raise VerificationError(f"cannot read SHA256SUMS: {exc}") from exc
    result: dict[str, str] = {}
    for line in lines:
        parts = line.split("  ", 1)
        if (
            len(parts) != 2
            or e.SHA256_RE.fullmatch(parts[0]) is None
            or not parts[1]
            or parts[1] in result
        ):
            raise VerificationError("malformed SHA256SUMS")
        result[parts[1]] = parts[0]
    return result


def verify_hash_inventory(root: Path) -> dict[str, str]:
    sums = parse_sums(root / "SHA256SUMS")
    expected_names = {*FREEZE_INPUTS, "freeze.v1.json"}
    if set(sums) != expected_names:
        raise VerificationError("SHA256SUMS inventory mismatch")
    for name, expected in sums.items():
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise VerificationError(f"summed file missing or symlinked: {name}")
        if e.sha256_path(path) != expected:
            raise VerificationError(f"digest mismatch: {name}")
    try:
        freeze = json.loads((root / "freeze.v1.json").read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise VerificationError(f"cannot read freeze: {exc}") from exc
    if not isinstance(freeze, dict) or freeze.get("schema") != "VG9Phase1FreezeV1":
        raise VerificationError("freeze schema mismatch")
    frozen = freeze.get("fileSha256")
    if not isinstance(frozen, dict) or set(frozen) != set(FREEZE_INPUTS):
        raise VerificationError("freeze input inventory mismatch")
    for name, expected in frozen.items():
        if not isinstance(expected, str) or e.sha256_path(root / name) != expected:
            raise VerificationError(f"freeze byte drift: {name}")
    if freeze.get("holdoutOpened") is not False or freeze.get("developmentOpened") is not False:
        raise VerificationError("freeze does not assert unopened partitions")
    return sums


def verify_unopened(root: Path, state_root: Path) -> None:
    for name in FORBIDDEN_PHASE1_ARTIFACTS:
        if (root / name).exists():
            raise VerificationError(f"tracked Phase-1 outcome artifact exists: {name}")
    marker_names = FORBIDDEN_PHASE1_ARTIFACTS[:-1]
    for name in marker_names:
        if (state_root / name).exists():
            raise VerificationError(f"one-shot state is not unopened: {name}")


def validate_protocol_semantics(protocol: Mapping[str, Any]) -> None:
    distinctness = e.require_mapping(protocol.get("distinctness"), "distinctness")
    forbidden = distinctness.get("forbiddenSignalInputs")
    if not isinstance(forbidden, list):
        raise VerificationError("forbidden signal inventory missing")
    required_forbidden = {
        "PRICE",
        "RETURN",
        "SHARE_ACCELERATION",
        "BASIS",
        "FUNDING",
        "TAKER_SIDE_IMBALANCE",
    }
    if not required_forbidden.issubset(set(forbidden)):
        raise VerificationError("price-free distinctness boundary drift")
    trials = e.trial_specs(protocol)
    if len(trials) != 6:
        raise VerificationError("frozen trial family must contain six trials")
    portfolio = e.require_mapping(protocol.get("portfolio"), "portfolio")
    if portfolio.get("usdMPosition") != "NONE_SIGNAL_ONLY":
        raise VerificationError("USD-M gained payoff authority")
    verdict = e.require_mapping(protocol.get("verdictLaw"), "verdictLaw")
    if verdict.get("capitalAuthority") != "NONE" or verdict.get("executionAuthority") != "NONE":
        raise VerificationError("authority boundary drift")


def verify_phase1(
    root: Path = HERE,
    state_root: Path = e.DEFAULT_STATE_ROOT,
    *,
    verify_sources: bool = True,
) -> dict[str, Any]:
    verify_hash_inventory(root)
    verify_unopened(root, state_root)
    protocol = e.load_protocol()
    validate_protocol_semantics(protocol)
    samples, plan = e.build_schedule_plan()
    if len(samples.samples) != 43 or len(plan.holdout_sample_ids) != 17:
        raise VerificationError("canonical schedule membership drift")
    source = e.read_object(root / "source_manifest.v1.json")
    if verify_sources:
        try:
            pairs = e.verify_source_manifest(protocol, source)
        except e.VG9Error as exc:
            raise VerificationError(f"source metadata verification failed: {exc}") from exc
        pair_count = sum(len(rows) for rows in pairs.values())
    else:
        inventory = source.get("monthInventory")
        if not isinstance(inventory, list):
            raise VerificationError("source month inventory missing")
        pair_count = sum(
            int(row["pairCount"])
            for row in inventory
            if isinstance(row, dict) and isinstance(row.get("pairCount"), int)
        )
    freeze_sha = e.sha256_path(root / "freeze.v1.json")
    return {
        "schema": "VG9Phase1VerificationV1",
        "status": "PHASE1_VERIFIED_HOLDOUT_UNOPENED",
        "developmentOpened": False,
        "holdoutOpened": False,
        "outcome": None,
        "sourcePairMonths": pair_count,
        "sourceInventorySha256": source.get("inventorySha256"),
        "walkForwardPlanSha256": plan.digest().hexdigest,
        "freezeSha256": freeze_sha,
        "authority": "NONE",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=HERE)
    parser.add_argument("--state-root", type=Path, default=e.DEFAULT_STATE_ROOT)
    parser.add_argument("--skip-source-state", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = verify_phase1(
            args.root.resolve(),
            args.state_root.resolve(),
            verify_sources=not args.skip_source_state,
        )
    except (VerificationError, e.VG9Error) as exc:
        print(f"VG9_PHASE1_VERIFY_ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
