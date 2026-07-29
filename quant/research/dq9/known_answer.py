from __future__ import annotations

import hashlib
from dataclasses import replace

from .validator import (
    CANDIDATE_SCHEMA_V1,
    DEVELOPMENT_SCHEMA_V1,
    FREEZE_SCHEMA_V1,
    HOLDOUT_SCHEMA_V1,
    PRE_RUN_SCHEMA_V1,
    RUN_SCHEMA_V1,
    SCHEMA_V1,
    TERMINAL_SCHEMA_V1,
    CandidateSealV1,
    DevelopmentDisposition,
    DevelopmentOpeningV1,
    FreezeMarkerV1,
    HoldoutOpeningV1,
    LifecycleSnapshotV1,
    PreRunIdentityV1,
    RunConsumedV1,
    TerminalResultV1,
    TerminalVerdict,
    validate_lifecycle_v1,
)


def _sha(label: str) -> str:
    return hashlib.sha256(label.encode("ascii", errors="strict")).hexdigest()


def frozen_snapshot_v1() -> LifecycleSnapshotV1:
    freeze = FreezeMarkerV1(
        schema=FREEZE_SCHEMA_V1,
        lifecycle_id="dq9-known-answer",
        frozen_static_commit="1" * 40,
        frozen_static_tree="2" * 40,
        freeze_artifact_digest=_sha("freeze-artifact"),
        protocol_digest=_sha("protocol"),
        source_manifest_digest=_sha("source-manifest"),
        runtime_digest=_sha("runtime"),
        inputs_digest=_sha("inputs"),
        archive_bodies_opened=0,
        holdout_bodies_opened=0,
        outcome_bytes_observed=0,
    )
    pre_run = PreRunIdentityV1(
        schema=PRE_RUN_SCHEMA_V1,
        lifecycle_id=freeze.lifecycle_id,
        commit="3" * 40,
        tree="4" * 40,
        parent_commit=freeze.frozen_static_commit,
        origin_ref="refs/remotes/origin/codex/dq9-known-answer",
        origin_commit="3" * 40,
        scope="quant/research/dq9fixture",
        worktree_clean=True,
        freeze_artifact_digest=freeze.freeze_artifact_digest,
    )
    return LifecycleSnapshotV1(
        schema=SCHEMA_V1,
        lifecycle_id=freeze.lifecycle_id,
        freeze=freeze,
        pre_run=pre_run,
        run_consumed=None,
        development_opening=None,
        candidate_seal=None,
        holdout_opening=None,
        terminal_result=None,
    )


def consumed_snapshot_v1() -> LifecycleSnapshotV1:
    snapshot = frozen_snapshot_v1()
    frozen_receipt = validate_lifecycle_v1(snapshot)
    run = RunConsumedV1(
        schema=RUN_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id="run-001",
        predecessor_digest=frozen_receipt.frozen_state_digest,
        marker_artifact_digest=_sha("run-marker"),
        pre_run_commit=snapshot.pre_run.commit,
        pre_run_tree=snapshot.pre_run.tree,
        freeze_artifact_digest=snapshot.freeze.freeze_artifact_digest,
        run_count=1,
        allowed_run_count=1,
        opened_development_bytes_before_marker=0,
        rerun_authorized=False,
        resume_authorized=False,
        repair_authorized=False,
        refreeze_authorized=False,
    )
    return replace(snapshot, run_consumed=run)


def development_snapshot_v1() -> LifecycleSnapshotV1:
    snapshot = consumed_snapshot_v1()
    consumed_receipt = validate_lifecycle_v1(snapshot)
    assert consumed_receipt.run_id is not None
    assert consumed_receipt.run_record_digest is not None
    development = DevelopmentOpeningV1(
        schema=DEVELOPMENT_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=consumed_receipt.run_id,
        predecessor_digest=consumed_receipt.run_record_digest,
        marker_artifact_digest=_sha("development-marker"),
        partition_digest=_sha("development-partition"),
        open_count=1,
        opened_bytes_before_marker=0,
        outcome_bytes_before_marker=0,
    )
    return replace(snapshot, development_opening=development)


def candidate_snapshot_v1() -> LifecycleSnapshotV1:
    snapshot = development_snapshot_v1()
    development_receipt = validate_lifecycle_v1(snapshot)
    assert development_receipt.run_id is not None
    assert development_receipt.development_record_digest is not None
    candidate = CandidateSealV1(
        schema=CANDIDATE_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=development_receipt.run_id,
        predecessor_digest=development_receipt.development_record_digest,
        seal_artifact_digest=_sha("candidate-seal"),
        development_open_count=1,
        development_disposition=DevelopmentDisposition.PASSED,
        development_result_digest=_sha("development-result"),
        development_gate_digest=_sha("development-gates"),
        candidate_id="trial-alpha",
        candidate_artifact_digest=_sha("trial-alpha-artifact"),
        frozen_parameters_digest=_sha("trial-alpha-parameters"),
        frozen_code_digest=_sha("frozen-code"),
        frozen_data_digest=_sha("frozen-data"),
        frozen_cost_digest=_sha("frozen-costs"),
        frozen_statistic_digest=_sha("frozen-statistics"),
        frozen_decision_rule_digest=_sha("frozen-decision-rule"),
        holdout_eligible=True,
        fallback_authorized=False,
    )
    return replace(snapshot, candidate_seal=candidate)


def holdout_snapshot_v1() -> LifecycleSnapshotV1:
    snapshot = candidate_snapshot_v1()
    candidate_receipt = validate_lifecycle_v1(snapshot)
    assert candidate_receipt.run_id is not None
    assert candidate_receipt.candidate_seal_digest is not None
    assert snapshot.candidate_seal is not None
    assert snapshot.candidate_seal.candidate_id is not None
    assert snapshot.candidate_seal.candidate_artifact_digest is not None
    holdout = HoldoutOpeningV1(
        schema=HOLDOUT_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=candidate_receipt.run_id,
        predecessor_digest=candidate_receipt.candidate_seal_digest,
        marker_artifact_digest=_sha("holdout-marker"),
        partition_digest=_sha("holdout-partition"),
        candidate_seal_digest=candidate_receipt.candidate_seal_digest,
        candidate_id=snapshot.candidate_seal.candidate_id,
        candidate_artifact_digest=snapshot.candidate_seal.candidate_artifact_digest,
        open_count=1,
        candidate_count=1,
        opened_bytes_before_marker=0,
        feedback_count_before_marker=0,
        fallback_used=False,
    )
    return replace(snapshot, holdout_opening=holdout)


def known_answer_snapshot_v1() -> LifecycleSnapshotV1:
    snapshot = holdout_snapshot_v1()
    holdout_receipt = validate_lifecycle_v1(snapshot)
    assert holdout_receipt.run_id is not None
    assert holdout_receipt.candidate_seal_digest is not None
    assert holdout_receipt.holdout_record_digest is not None
    terminal = TerminalResultV1(
        schema=TERMINAL_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=holdout_receipt.run_id,
        predecessor_digest=holdout_receipt.holdout_record_digest,
        terminal_artifact_digest=_sha("terminal-result"),
        candidate_seal_digest=holdout_receipt.candidate_seal_digest,
        pre_run_commit=snapshot.pre_run.commit,
        pre_run_tree=snapshot.pre_run.tree,
        freeze_artifact_digest=snapshot.freeze.freeze_artifact_digest,
        verdict=TerminalVerdict.NO_GO,
        run_count=1,
        development_open_count=1,
        holdout_open_count=1,
        terminal_count=1,
        authority="NONE",
        rerun_authorized=False,
        resume_authorized=False,
        repair_authorized=False,
        refreeze_authorized=False,
        successor_authorized=False,
    )
    return replace(snapshot, terminal_result=terminal)


def known_answer_projection_v1() -> dict[str, object]:
    return validate_lifecycle_v1(known_answer_snapshot_v1()).as_dict()
