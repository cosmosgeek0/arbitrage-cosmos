"""Capture and write the final Q17 proof kit; evidence generation only."""

from __future__ import annotations

import hashlib
import sys
import tempfile
from pathlib import Path

from quant_edge.final_proof.benchmark import run_q17_benchmark
from quant_edge.final_proof.components import build_component_manifest
from quant_edge.final_proof.evidence import project_research_evidence
from quant_edge.final_proof.generation import (
    EXPECTED_C17_PATHS,
    FROZEN_FILE_SHA256,
    TRUSTED_SOURCE_SHA256,
    build_q17_artifacts,
    preflight_q17_output_directory,
    validate_q17_artifact_directory,
    write_q17_artifacts,
)
from quant_edge.final_proof.replay import (
    EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
    EXPECTED_EVALUATION_TIME_MS,
    EXPECTED_EXPIRED_EVALUATION_TIME_MS,
    run_replay_fault_campaign,
)
from quant_edge.final_proof.security import (
    require_only_post_acceptance_directive_lock_drift,
    scan_python_files,
    scan_python_tree,
    verify_changed_path_scope,
    verify_frozen_files,
)


def _security_scope(repo_root: Path) -> dict[str, object]:
    source = scan_python_tree(
        repo_root / "quant" / "src" / "quant_edge",
        trusted_source_sha256=TRUSTED_SOURCE_SHA256,
    )
    campaign = scan_python_files(
        repo_root,
        ("quant/scripts/q17_acceptance_campaign.py",),
        trusted_source_sha256=TRUSTED_SOURCE_SHA256,
    )
    frozen = verify_frozen_files(repo_root, FROZEN_FILE_SHA256)
    scope = verify_changed_path_scope(EXPECTED_C17_PATHS)
    source.require_clean()
    campaign.require_clean()
    require_only_post_acceptance_directive_lock_drift(frozen)
    scope.require_clean()
    return {
        "actualStagedCommitScope": "NOT_MEASURED_RESERVED_FOR_Q17_RECEIPT",
        "advisoryOnly": True,
        "conclusion": {
            "executionAuthority": False,
            "externalNetwork": False,
            "forbiddenFindings": 0,
            "moneyAuthority": False,
            "secretAccess": False,
        },
        "declaredC17PathScope": scope.as_mapping(),
        "frozenFiles": frozen.as_mapping(),
        "posture": "ADVISORY_ONLY",
        "schema": "Q17SecurityScopeV1",
        "scopeEvidenceClass": "DECLARED_EXPECTED_C17_INVENTORY",
        "securityScan": {
            "campaignScript": campaign.as_mapping(),
            "sourceTree": source.as_mapping(),
        },
        "version": 1,
    }


def main(argv: list[str]) -> int:
    if len(argv) > 2:
        print("usage: q17_acceptance_campaign.py [REPO_ROOT]", file=sys.stderr)
        return 2
    repo_root = (
        Path(argv[1]).resolve(strict=True)
        if len(argv) == 2
        else Path(__file__).resolve().parents[2]
    )
    quant_root = repo_root / "quant"
    preflight_q17_output_directory(repo_root)
    with tempfile.TemporaryDirectory(prefix="q17-fault-") as copy_directory:
        replay = run_replay_fault_campaign(
            quant_root,
            repo_root,
            Path(copy_directory).resolve(strict=True),
            evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
            expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
            ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        )
    artifacts = build_q17_artifacts(
        repo_root,
        replay_proof=replay,
        research_evidence=project_research_evidence(repo_root),
        benchmark=run_q17_benchmark(repo_root),
        security_scope=_security_scope(repo_root),
        component_manifest=build_component_manifest(repo_root),
    )
    write_q17_artifacts(repo_root, artifacts)
    validate_q17_artifact_directory(repo_root)
    for relative_path, raw in artifacts.items():
        print(f"{relative_path} {len(raw)} bytes sha256={hashlib.sha256(raw).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
