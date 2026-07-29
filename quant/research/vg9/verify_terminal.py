"""Read-only verifier for the terminal V-G9 UNMEASURED packet."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final

from research.vg9 import experiment as e
from research.vg9 import verify as phase1

HERE: Final = Path(__file__).resolve().parent
TERMINAL_INPUTS: Final = frozenset({"TERMINAL.md", "verify_terminal.py", "test_verify_terminal.py"})
EVIDENCE_INPUTS: Final = frozenset(
    {
        "development_opened.v1.json",
        "development_result.v1.json",
        "evidence_manifest.v1.json",
    }
)
FORBIDDEN_OUTCOME_NAMES: Final = (
    "candidate_seal.v1.json",
    "holdout_opened.v1.json",
    "result.v1.json",
)
EXPECTED_DETAIL: Final = "USD-M timestamp is not integer: 1000CATUSDT/1h/1000CATUSDT-1h-2025-07.zip"


class TerminalVerificationError(RuntimeError):
    """Terminal packet authentication or semantics failed."""


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise TerminalVerificationError(f"cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise TerminalVerificationError(f"{path.name} must contain an object")
    return value


def _verify_exact_sums(
    directory: Path,
    sums_name: str,
    expected_names: frozenset[str],
) -> dict[str, str]:
    try:
        sums = phase1.parse_sums(directory / sums_name)
    except phase1.VerificationError as exc:
        raise TerminalVerificationError(str(exc)) from exc
    if set(sums) != expected_names:
        raise TerminalVerificationError(f"{sums_name} inventory mismatch")
    for name, expected in sums.items():
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise TerminalVerificationError(f"summed file missing or symlinked: {name}")
        if e.sha256_path(path) != expected:
            raise TerminalVerificationError(f"digest mismatch: {name}")
    return sums


def _required_bindings(root: Path) -> dict[str, str]:
    return {
        "freezeSha256": e.sha256_path(root / "freeze.v1.json"),
        "protocolSha256": e.sha256_path(root / "protocol.v1.json"),
        "sourceManifestSha256": e.sha256_path(root / "source_manifest.v1.json"),
    }


def _require_bindings(
    value: Mapping[str, Any],
    bindings: Mapping[str, str],
    *,
    artifact: str,
) -> None:
    for key, expected in bindings.items():
        if value.get(key) != expected:
            raise TerminalVerificationError(f"{artifact} {key} binding mismatch")


def _reject_outcome_artifacts(root: Path) -> None:
    for directory in (root, root / "evidence"):
        for name in FORBIDDEN_OUTCOME_NAMES:
            if (directory / name).exists():
                raise TerminalVerificationError(f"forbidden terminal artifact exists: {name}")


def validate_terminal_evidence(
    root: Path,
    bindings: Mapping[str, str],
) -> dict[str, Any]:
    _reject_outcome_artifacts(root)
    evidence = root / "evidence"
    sums = _verify_exact_sums(evidence, "SHA256SUMS", EVIDENCE_INPUTS)
    marker_path = evidence / "development_opened.v1.json"
    result_path = evidence / "development_result.v1.json"
    manifest_path = evidence / "evidence_manifest.v1.json"
    marker = _read_object(marker_path)
    result = _read_object(result_path)
    manifest = _read_object(manifest_path)

    if manifest.get("schema") != "VG9TrackedEvidenceManifestV1":
        raise TerminalVerificationError("evidence manifest schema mismatch")
    if manifest.get("stage") != "DEVELOPMENT_TERMINAL":
        raise TerminalVerificationError("evidence manifest stage mismatch")
    if manifest.get("outcomesRecomputedDuringSeal") is not False:
        raise TerminalVerificationError("evidence seal recomputation posture drift")
    _require_bindings(manifest, bindings, artifact="evidence manifest")
    artifacts = manifest.get("artifacts")
    expected_artifacts = [
        {
            "name": "development_opened.v1.json",
            "sha256": sums["development_opened.v1.json"],
        },
        {
            "name": "development_result.v1.json",
            "sha256": sums["development_result.v1.json"],
        },
    ]
    if artifacts != expected_artifacts:
        raise TerminalVerificationError("evidence manifest artifact inventory mismatch")

    marker_keys = {
        "archiveBodyOpenCount",
        "freezeSha256",
        "openedAtFrozenUtc",
        "protocolSha256",
        "schema",
        "sharedArchiveMutationPermitted",
        "sourceManifestSha256",
    }
    if set(marker) != marker_keys:
        raise TerminalVerificationError("development marker field inventory mismatch")
    if marker.get("schema") != "VG9DevelopmentOpenedV1":
        raise TerminalVerificationError("development marker schema mismatch")
    if marker.get("archiveBodyOpenCount") != 1 or isinstance(
        marker.get("archiveBodyOpenCount"), bool
    ):
        raise TerminalVerificationError("development open count must equal exactly one")
    if marker.get("sharedArchiveMutationPermitted") is not False:
        raise TerminalVerificationError("shared archive mutation posture drift")
    _require_bindings(marker, bindings, artifact="development marker")

    result_keys = {
        "analysis",
        "detail",
        "developmentMarkerSha256",
        "freezeSha256",
        "protocolSha256",
        "reason",
        "schema",
        "sourceManifestSha256",
        "status",
    }
    if set(result) != result_keys:
        raise TerminalVerificationError("development result field inventory mismatch")
    if result.get("schema") != "VG9DevelopmentResultV1":
        raise TerminalVerificationError("development result schema mismatch")
    if result.get("status") != "UNMEASURED" or result.get("reason") != "DataError":
        raise TerminalVerificationError("terminal verdict or failure class drift")
    if result.get("detail") != EXPECTED_DETAIL:
        raise TerminalVerificationError("terminal source failure detail drift")
    if result.get("analysis") is not None:
        raise TerminalVerificationError("UNMEASURED result must have null analysis")
    if result.get("developmentMarkerSha256") != sums["development_opened.v1.json"]:
        raise TerminalVerificationError("result development-marker binding mismatch")
    _require_bindings(result, bindings, artifact="development result")
    forbidden_economics = {
        "BASE",
        "STRESS",
        "matchedSpotShareSTRESS",
        "stressBootstrap",
        "stressMatchedExcessNetUsdPer1000",
        "stressMatchedExcessBootstrap",
        "gates",
        "champion",
    }
    if forbidden_economics & set(result):
        raise TerminalVerificationError("UNMEASURED result contains economics")

    return {
        "developmentOpenReceipts": 1,
        "developmentMarkerSha256": sums["development_opened.v1.json"],
        "developmentResultSha256": sums["development_result.v1.json"],
        "evidenceManifestSha256": sums["evidence_manifest.v1.json"],
        "verdict": "UNMEASURED",
        "reason": "DataError",
        "detail": EXPECTED_DETAIL,
        "analysis": None,
    }


def _verify_external_state(root: Path, state_root: Path | None) -> str:
    if state_root is None or not state_root.exists():
        return "ABSENT_TRACKED_EVIDENCE_VERIFIED"
    if state_root.is_symlink() or not state_root.is_dir():
        raise TerminalVerificationError("external state root is not a regular directory")
    expected = {"development_opened.v1.json", "development_result.v1.json"}
    observed = {path.name for path in state_root.iterdir()}
    if observed != expected:
        raise TerminalVerificationError("external state inventory mismatch")
    for name in expected:
        external = state_root / name
        tracked = root / "evidence" / name
        if external.is_symlink() or not external.is_file():
            raise TerminalVerificationError(f"external artifact invalid: {name}")
        try:
            identical = external.read_bytes() == tracked.read_bytes()
        except OSError as exc:
            raise TerminalVerificationError(f"cannot compare external artifact: {name}") from exc
        if not identical:
            raise TerminalVerificationError(f"external artifact differs: {name}")
    for name in FORBIDDEN_OUTCOME_NAMES:
        if (state_root / name).exists():
            raise TerminalVerificationError(f"external forbidden artifact exists: {name}")
    return "PRESENT_BYTE_IDENTICAL"


def verify_terminal(
    root: Path = HERE,
    *,
    state_root: Path | None = e.DEFAULT_STATE_ROOT,
    verify_sources: bool = True,
) -> dict[str, Any]:
    if root.resolve() != HERE:
        raise TerminalVerificationError("terminal verifier root must be the V-G9 packet")
    try:
        phase1.verify_hash_inventory(root)
    except phase1.VerificationError as exc:
        raise TerminalVerificationError(f"Phase-1 hash verification failed: {exc}") from exc
    _verify_exact_sums(root, "TERMINAL_SHA256SUMS", TERMINAL_INPUTS)

    protocol = _read_object(root / "protocol.v1.json")
    try:
        phase1.validate_protocol_semantics(protocol)
        samples, plan = e.build_schedule_plan()
    except (phase1.VerificationError, e.VG9Error) as exc:
        raise TerminalVerificationError(f"protocol validation failed: {exc}") from exc
    freeze = _read_object(root / "freeze.v1.json")
    partition = freeze.get("partition")
    if not isinstance(partition, dict):
        raise TerminalVerificationError("freeze partition missing")
    if partition.get("walkForwardPlanSha256") != plan.digest().hexdigest:
        raise TerminalVerificationError("freeze schedule-plan binding mismatch")
    if len(samples.samples) != 43 or len(plan.holdout_sample_ids) != 17:
        raise TerminalVerificationError("canonical schedule membership drift")

    source = _read_object(root / "source_manifest.v1.json")
    if verify_sources:
        try:
            pairs = e.verify_source_manifest(protocol, source)
        except e.VG9Error as exc:
            raise TerminalVerificationError(f"source metadata verification failed: {exc}") from exc
        source_rows = sum(len(rows) for rows in pairs.values())
    else:
        inventory = source.get("monthInventory")
        if not isinstance(inventory, list):
            raise TerminalVerificationError("source month inventory missing")
        source_rows = sum(
            row["pairCount"]
            for row in inventory
            if isinstance(row, dict) and isinstance(row.get("pairCount"), int)
        )
    if source_rows != 4365:
        raise TerminalVerificationError("source pair-month count drift")

    bindings = _required_bindings(root)
    evidence = validate_terminal_evidence(root, bindings)
    costs = protocol.get("costs")
    verdict = protocol.get("verdictLaw")
    if not isinstance(costs, dict) or not isinstance(verdict, dict):
        raise TerminalVerificationError("protocol authority or cost boundary missing")
    if costs.get("accountEffectiveFees") != "UNKNOWN":
        raise TerminalVerificationError("account-effective fees were promoted")
    if costs.get("capacity") != "UNKNOWN":
        raise TerminalVerificationError("capacity was promoted")
    if verdict.get("capitalAuthority") != "NONE" or verdict.get("executionAuthority") != "NONE":
        raise TerminalVerificationError("authority boundary drift")

    external_state = _verify_external_state(root, state_root)
    return {
        "schema": "VG9TerminalVerificationV1",
        "status": "TERMINAL_VERIFIED_UNMEASURED_HOLDOUT_UNOPENED",
        "verdict": evidence["verdict"],
        "reason": evidence["reason"],
        "detail": evidence["detail"],
        "analysis": None,
        "economics": "UNMEASURED_NOT_ZERO",
        "accountEffectiveFees": "UNKNOWN",
        "capacity": "UNKNOWN",
        "developmentOpenReceipts": evidence["developmentOpenReceipts"],
        "candidateSealed": False,
        "holdoutOpened": False,
        "authority": "NONE",
        "sourcePairMonthRows": source_rows,
        "freezeSha256": bindings["freezeSha256"],
        "externalState": external_state,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-root", type=Path, default=e.DEFAULT_STATE_ROOT)
    parser.add_argument("--tracked-only", action="store_true")
    parser.add_argument("--skip-source-state", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    state_root = None if args.tracked_only else args.state_root.resolve()
    try:
        report = verify_terminal(
            state_root=state_root,
            verify_sources=not args.skip_source_state,
        )
    except (TerminalVerificationError, e.VG9Error) as exc:
        print(f"VG9_TERMINAL_VERIFY_ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
