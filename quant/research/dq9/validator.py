from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, NoReturn, cast

SCHEMA_V1: Final = "cosmos.dq9.sealed-research-lifecycle.v1"
PRE_RUN_SCHEMA_V1: Final = "cosmos.dq9.pre-run-identity.v1"
FREEZE_SCHEMA_V1: Final = "cosmos.dq9.freeze-marker.v1"
RUN_SCHEMA_V1: Final = "cosmos.dq9.run-consumed.v1"
DEVELOPMENT_SCHEMA_V1: Final = "cosmos.dq9.development-opening.v1"
CANDIDATE_SCHEMA_V1: Final = "cosmos.dq9.candidate-seal.v1"
HOLDOUT_SCHEMA_V1: Final = "cosmos.dq9.holdout-opening.v1"
TERMINAL_SCHEMA_V1: Final = "cosmos.dq9.terminal-result.v1"
RECEIPT_SCHEMA_V1: Final = "cosmos.dq9.lifecycle-receipt.v1"

_PRE_RUN_DOMAIN: Final = b"cosmos-dq9-pre-run-identity-v1\0"
_FREEZE_DOMAIN: Final = b"cosmos-dq9-freeze-marker-v1\0"
_FROZEN_STATE_DOMAIN: Final = b"cosmos-dq9-frozen-state-v1\0"
_RUN_DOMAIN: Final = b"cosmos-dq9-run-consumed-v1\0"
_DEVELOPMENT_DOMAIN: Final = b"cosmos-dq9-development-opening-v1\0"
_CANDIDATE_DOMAIN: Final = b"cosmos-dq9-candidate-seal-v1\0"
_HOLDOUT_DOMAIN: Final = b"cosmos-dq9-holdout-opening-v1\0"
_TERMINAL_DOMAIN: Final = b"cosmos-dq9-terminal-result-v1\0"
_RECEIPT_DOMAIN: Final = b"cosmos-dq9-lifecycle-receipt-v1\0"

_ID_PATTERN: Final = re.compile(r"^[a-z0-9][a-z0-9_.:@+-]{0,127}$")
_GIT_OID_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_SCOPE_PATTERN: Final = re.compile(r"^quant/research/[a-z][a-z0-9_-]{0,47}$")
_ORIGIN_REF_PATTERN: Final = re.compile(
    r"^refs/remotes/origin/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,190}[A-Za-z0-9])?$"
)
_MAX_JSON_BYTES: Final = 131_072
_MAX_JSON_NODES: Final = 4_096
_MAX_JSON_DEPTH: Final = 32


class LifecycleContractError(ValueError):
    """A stable, fail-closed DQ-9 lifecycle contract failure."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class LifecycleState(StrEnum):
    FROZEN = "FROZEN"
    RUN_CONSUMED = "RUN_CONSUMED"
    DEVELOPMENT_OPENED = "DEVELOPMENT_OPENED"
    CANDIDATE_SEALED = "CANDIDATE_SEALED"
    HOLDOUT_OPENED = "HOLDOUT_OPENED"
    TERMINAL = "TERMINAL"


class DevelopmentDisposition(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    UNMEASURED = "UNMEASURED"


class TerminalVerdict(StrEnum):
    GO = "GO"
    NO_GO = "NO_GO"
    UNMEASURED = "UNMEASURED"


class IntakeStatus(StrEnum):
    NOT_TERMINAL_FOR_INTAKE = "NOT_TERMINAL_FOR_INTAKE"
    TERMINAL_LIFECYCLE_VALID = "TERMINAL_LIFECYCLE_VALID"


def _fail(code: str, detail: str) -> NoReturn:
    raise LifecycleContractError(code, detail)


def _canonical_json_bytes(value: object) -> bytes:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise LifecycleContractError(
            "CANONICAL_JSON_INVALID",
            "value is outside the frozen JSON domain",
        ) from error
    return f"{encoded}\n".encode("utf-8", errors="strict")


def _digest(domain: bytes, value: object) -> str:
    return hashlib.sha256(domain + _canonical_json_bytes(value)).hexdigest()


def _require_string(value: object, *, field: str) -> str:
    if type(value) is not str:
        _fail("STRING_REQUIRED", f"{field} must be an exact built-in string")
    return value


def _require_id(value: object, *, field: str) -> str:
    checked = _require_string(value, field=field)
    if _ID_PATTERN.fullmatch(checked) is None:
        _fail("ID_INVALID", f"{field} must match the frozen lowercase ASCII identifier contract")
    return checked


def _require_git_oid(value: object, *, field: str) -> str:
    checked = _require_string(value, field=field)
    if _GIT_OID_PATTERN.fullmatch(checked) is None:
        _fail("GIT_OID_INVALID", f"{field} must be exact lowercase 40-hex")
    return checked


def _require_sha256(value: object, *, field: str) -> str:
    checked = _require_string(value, field=field)
    if _SHA256_PATTERN.fullmatch(checked) is None:
        _fail("SHA256_INVALID", f"{field} must be exact lowercase SHA-256 hex")
    return checked


def _optional_sha256(value: object, *, field: str) -> str | None:
    return None if value is None else _require_sha256(value, field=field)


def _optional_id(value: object, *, field: str) -> str | None:
    return None if value is None else _require_id(value, field=field)


def _require_bool(value: object, *, field: str) -> bool:
    if type(value) is not bool:
        _fail("BOOLEAN_REQUIRED", f"{field} must be a strict boolean")
    return value


def _require_count(value: object, *, field: str, allowed: tuple[int, ...]) -> int:
    if type(value) is not int:
        _fail("INTEGER_REQUIRED", f"{field} must be a strict integer")
    checked = value
    if checked not in allowed:
        rendered = ",".join(str(item) for item in allowed)
        _fail("COUNT_INVALID", f"{field} must be one of [{rendered}]")
    return checked


def _require_scope(value: object, *, field: str) -> str:
    checked = _require_string(value, field=field)
    if _SCOPE_PATTERN.fullmatch(checked) is None:
        _fail("SCOPE_INVALID", f"{field} must be one normalized quant/research child")
    return checked


def _require_origin_ref(value: object, *, field: str) -> str:
    checked = _require_string(value, field=field)
    components = checked.split("/")
    if (
        _ORIGIN_REF_PATTERN.fullmatch(checked) is None
        or "//" in checked
        or ".." in checked
        or any(component.startswith(".") or component.endswith(".lock") for component in components)
    ):
        _fail("ORIGIN_REF_INVALID", f"{field} must be one normalized origin tracking ref")
    return checked


def _require_literal(value: object, *, field: str, expected: str) -> str:
    checked = _require_string(value, field=field)
    if checked != expected:
        _fail("LITERAL_MISMATCH", f"{field} must equal {expected}")
    return checked


def _require_mapping(value: object, *, field: str) -> Mapping[str, object]:
    if type(value) is not dict:
        _fail("OBJECT_REQUIRED", f"{field} must be a JSON object")
    if any(not isinstance(key, str) for key in value):
        _fail("OBJECT_KEY_INVALID", f"{field} keys must be strings")
    return cast(Mapping[str, object], value)


def _require_exact_fields(
    value: Mapping[str, object],
    *,
    field: str,
    expected: frozenset[str],
) -> None:
    actual = frozenset(value)
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing or unknown:
        _fail(
            "FIELD_SET_INVALID",
            f"{field} missing={missing!r} unknown={unknown!r}",
        )


@dataclass(frozen=True, slots=True)
class FreezeMarkerV1:
    schema: str
    lifecycle_id: str
    frozen_static_commit: str
    frozen_static_tree: str
    freeze_artifact_digest: str
    protocol_digest: str
    source_manifest_digest: str
    runtime_digest: str
    inputs_digest: str
    archive_bodies_opened: int
    holdout_bodies_opened: int
    outcome_bytes_observed: int

    def as_dict(self) -> dict[str, object]:
        return {
            "archiveBodiesOpened": self.archive_bodies_opened,
            "freezeArtifactDigest": self.freeze_artifact_digest,
            "frozenStaticCommit": self.frozen_static_commit,
            "frozenStaticTree": self.frozen_static_tree,
            "holdoutBodiesOpened": self.holdout_bodies_opened,
            "inputsDigest": self.inputs_digest,
            "lifecycleId": self.lifecycle_id,
            "outcomeBytesObserved": self.outcome_bytes_observed,
            "protocolDigest": self.protocol_digest,
            "runtimeDigest": self.runtime_digest,
            "schema": self.schema,
            "sourceManifestDigest": self.source_manifest_digest,
        }


@dataclass(frozen=True, slots=True)
class PreRunIdentityV1:
    schema: str
    lifecycle_id: str
    commit: str
    tree: str
    parent_commit: str
    origin_ref: str
    origin_commit: str
    scope: str
    worktree_clean: bool
    freeze_artifact_digest: str

    def as_dict(self) -> dict[str, object]:
        return {
            "commit": self.commit,
            "freezeArtifactDigest": self.freeze_artifact_digest,
            "lifecycleId": self.lifecycle_id,
            "originCommit": self.origin_commit,
            "originRef": self.origin_ref,
            "parentCommit": self.parent_commit,
            "schema": self.schema,
            "scope": self.scope,
            "tree": self.tree,
            "worktreeClean": self.worktree_clean,
        }


@dataclass(frozen=True, slots=True)
class RunConsumedV1:
    schema: str
    lifecycle_id: str
    run_id: str
    predecessor_digest: str
    marker_artifact_digest: str
    pre_run_commit: str
    pre_run_tree: str
    freeze_artifact_digest: str
    run_count: int
    allowed_run_count: int
    opened_development_bytes_before_marker: int
    rerun_authorized: bool
    resume_authorized: bool
    repair_authorized: bool
    refreeze_authorized: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "allowedRunCount": self.allowed_run_count,
            "freezeArtifactDigest": self.freeze_artifact_digest,
            "lifecycleId": self.lifecycle_id,
            "markerArtifactDigest": self.marker_artifact_digest,
            "openedDevelopmentBytesBeforeMarker": self.opened_development_bytes_before_marker,
            "preRunCommit": self.pre_run_commit,
            "preRunTree": self.pre_run_tree,
            "predecessorDigest": self.predecessor_digest,
            "refreezeAuthorized": self.refreeze_authorized,
            "repairAuthorized": self.repair_authorized,
            "rerunAuthorized": self.rerun_authorized,
            "resumeAuthorized": self.resume_authorized,
            "runCount": self.run_count,
            "runId": self.run_id,
            "schema": self.schema,
        }


@dataclass(frozen=True, slots=True)
class DevelopmentOpeningV1:
    schema: str
    lifecycle_id: str
    run_id: str
    predecessor_digest: str
    marker_artifact_digest: str
    partition_digest: str
    open_count: int
    opened_bytes_before_marker: int
    outcome_bytes_before_marker: int

    def as_dict(self) -> dict[str, object]:
        return {
            "lifecycleId": self.lifecycle_id,
            "markerArtifactDigest": self.marker_artifact_digest,
            "openCount": self.open_count,
            "openedBytesBeforeMarker": self.opened_bytes_before_marker,
            "outcomeBytesBeforeMarker": self.outcome_bytes_before_marker,
            "partitionDigest": self.partition_digest,
            "predecessorDigest": self.predecessor_digest,
            "runId": self.run_id,
            "schema": self.schema,
        }


@dataclass(frozen=True, slots=True)
class CandidateSealV1:
    schema: str
    lifecycle_id: str
    run_id: str
    predecessor_digest: str
    seal_artifact_digest: str
    development_open_count: int
    development_disposition: DevelopmentDisposition
    development_result_digest: str
    development_gate_digest: str
    candidate_id: str | None
    candidate_artifact_digest: str | None
    frozen_parameters_digest: str | None
    frozen_code_digest: str
    frozen_data_digest: str
    frozen_cost_digest: str
    frozen_statistic_digest: str
    frozen_decision_rule_digest: str
    holdout_eligible: bool
    fallback_authorized: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "candidateArtifactDigest": self.candidate_artifact_digest,
            "candidateId": self.candidate_id,
            "developmentDisposition": self.development_disposition.value,
            "developmentGateDigest": self.development_gate_digest,
            "developmentOpenCount": self.development_open_count,
            "developmentResultDigest": self.development_result_digest,
            "fallbackAuthorized": self.fallback_authorized,
            "frozenCodeDigest": self.frozen_code_digest,
            "frozenCostDigest": self.frozen_cost_digest,
            "frozenDataDigest": self.frozen_data_digest,
            "frozenDecisionRuleDigest": self.frozen_decision_rule_digest,
            "frozenParametersDigest": self.frozen_parameters_digest,
            "frozenStatisticDigest": self.frozen_statistic_digest,
            "holdoutEligible": self.holdout_eligible,
            "lifecycleId": self.lifecycle_id,
            "predecessorDigest": self.predecessor_digest,
            "runId": self.run_id,
            "schema": self.schema,
            "sealArtifactDigest": self.seal_artifact_digest,
        }


@dataclass(frozen=True, slots=True)
class HoldoutOpeningV1:
    schema: str
    lifecycle_id: str
    run_id: str
    predecessor_digest: str
    marker_artifact_digest: str
    partition_digest: str
    candidate_seal_digest: str
    candidate_id: str
    candidate_artifact_digest: str
    open_count: int
    candidate_count: int
    opened_bytes_before_marker: int
    feedback_count_before_marker: int
    fallback_used: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "candidateArtifactDigest": self.candidate_artifact_digest,
            "candidateCount": self.candidate_count,
            "candidateId": self.candidate_id,
            "candidateSealDigest": self.candidate_seal_digest,
            "fallbackUsed": self.fallback_used,
            "feedbackCountBeforeMarker": self.feedback_count_before_marker,
            "lifecycleId": self.lifecycle_id,
            "markerArtifactDigest": self.marker_artifact_digest,
            "openCount": self.open_count,
            "openedBytesBeforeMarker": self.opened_bytes_before_marker,
            "partitionDigest": self.partition_digest,
            "predecessorDigest": self.predecessor_digest,
            "runId": self.run_id,
            "schema": self.schema,
        }


@dataclass(frozen=True, slots=True)
class TerminalResultV1:
    schema: str
    lifecycle_id: str
    run_id: str
    predecessor_digest: str
    terminal_artifact_digest: str
    candidate_seal_digest: str
    pre_run_commit: str
    pre_run_tree: str
    freeze_artifact_digest: str
    verdict: TerminalVerdict
    run_count: int
    development_open_count: int
    holdout_open_count: int
    terminal_count: int
    authority: str
    rerun_authorized: bool
    resume_authorized: bool
    repair_authorized: bool
    refreeze_authorized: bool
    successor_authorized: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "authority": self.authority,
            "candidateSealDigest": self.candidate_seal_digest,
            "developmentOpenCount": self.development_open_count,
            "freezeArtifactDigest": self.freeze_artifact_digest,
            "holdoutOpenCount": self.holdout_open_count,
            "lifecycleId": self.lifecycle_id,
            "preRunCommit": self.pre_run_commit,
            "preRunTree": self.pre_run_tree,
            "predecessorDigest": self.predecessor_digest,
            "refreezeAuthorized": self.refreeze_authorized,
            "repairAuthorized": self.repair_authorized,
            "rerunAuthorized": self.rerun_authorized,
            "resumeAuthorized": self.resume_authorized,
            "runCount": self.run_count,
            "runId": self.run_id,
            "schema": self.schema,
            "successorAuthorized": self.successor_authorized,
            "terminalArtifactDigest": self.terminal_artifact_digest,
            "terminalCount": self.terminal_count,
            "verdict": self.verdict.value,
        }


@dataclass(frozen=True, slots=True)
class LifecycleSnapshotV1:
    schema: str
    lifecycle_id: str
    freeze: FreezeMarkerV1
    pre_run: PreRunIdentityV1
    run_consumed: RunConsumedV1 | None
    development_opening: DevelopmentOpeningV1 | None
    candidate_seal: CandidateSealV1 | None
    holdout_opening: HoldoutOpeningV1 | None
    terminal_result: TerminalResultV1 | None

    def as_dict(self) -> dict[str, object]:
        return {
            "candidateSeal": (
                None
                if self.candidate_seal is None
                else CandidateSealV1.as_dict(self.candidate_seal)
            ),
            "developmentOpening": (
                None
                if self.development_opening is None
                else DevelopmentOpeningV1.as_dict(self.development_opening)
            ),
            "freeze": FreezeMarkerV1.as_dict(self.freeze),
            "holdoutOpening": (
                None
                if self.holdout_opening is None
                else HoldoutOpeningV1.as_dict(self.holdout_opening)
            ),
            "lifecycleId": self.lifecycle_id,
            "preRun": PreRunIdentityV1.as_dict(self.pre_run),
            "runConsumed": (
                None if self.run_consumed is None else RunConsumedV1.as_dict(self.run_consumed)
            ),
            "schema": self.schema,
            "terminalResult": (
                None
                if self.terminal_result is None
                else TerminalResultV1.as_dict(self.terminal_result)
            ),
        }

    def canonical_bytes(self) -> bytes:
        return _canonical_json_bytes(LifecycleSnapshotV1.as_dict(self))


@dataclass(frozen=True, slots=True)
class LifecycleReceiptV1:
    schema: str
    lifecycle_id: str
    state: LifecycleState
    scope: str
    pre_run_commit: str
    pre_run_tree: str
    origin_ref: str
    freeze_artifact_digest: str
    frozen_state_digest: str
    run_id: str | None
    run_consumed: bool
    run_record_digest: str | None
    development_open_count: int
    development_record_digest: str | None
    development_disposition: DevelopmentDisposition | None
    candidate_seal_digest: str | None
    candidate_id: str | None
    holdout_eligible: bool
    holdout_open_count: int
    holdout_record_digest: str | None
    terminal_result_digest: str | None
    verdict: TerminalVerdict | None
    intake_status: IntakeStatus
    consumer: str
    rerun_authorized: bool
    resume_authorized: bool
    repair_authorized: bool
    refreeze_authorized: bool
    authority: str
    receipt_digest: str

    def as_dict(self) -> dict[str, object]:
        return {
            "authority": self.authority,
            "candidateId": self.candidate_id,
            "candidateSealDigest": self.candidate_seal_digest,
            "consumer": self.consumer,
            "developmentDisposition": (
                None if self.development_disposition is None else self.development_disposition.value
            ),
            "developmentOpenCount": self.development_open_count,
            "developmentRecordDigest": self.development_record_digest,
            "freezeArtifactDigest": self.freeze_artifact_digest,
            "frozenStateDigest": self.frozen_state_digest,
            "holdoutEligible": self.holdout_eligible,
            "holdoutOpenCount": self.holdout_open_count,
            "holdoutRecordDigest": self.holdout_record_digest,
            "intakeStatus": self.intake_status.value,
            "lifecycleId": self.lifecycle_id,
            "originRef": self.origin_ref,
            "preRunCommit": self.pre_run_commit,
            "preRunTree": self.pre_run_tree,
            "receiptDigest": self.receipt_digest,
            "refreezeAuthorized": self.refreeze_authorized,
            "repairAuthorized": self.repair_authorized,
            "rerunAuthorized": self.rerun_authorized,
            "resumeAuthorized": self.resume_authorized,
            "runConsumed": self.run_consumed,
            "runId": self.run_id,
            "runRecordDigest": self.run_record_digest,
            "schema": self.schema,
            "scope": self.scope,
            "state": self.state.value,
            "terminalResultDigest": self.terminal_result_digest,
            "verdict": None if self.verdict is None else self.verdict.value,
        }

    def canonical_bytes(self) -> bytes:
        return _canonical_json_bytes(LifecycleReceiptV1.as_dict(self))


def _check_lifecycle_id(actual: object, *, expected: str, field: str) -> str:
    checked = _require_id(actual, field=field)
    if checked != expected:
        _fail("LIFECYCLE_ID_MISMATCH", f"{field} does not bind the snapshot lifecycle")
    return checked


def _check_run_id(actual: object, *, expected: str, field: str) -> str:
    checked = _require_id(actual, field=field)
    if checked != expected:
        _fail("RUN_ID_MISMATCH", f"{field} does not bind the consumed run")
    return checked


def _check_digest(actual: object, *, expected: str, field: str, code: str) -> str:
    checked = _require_sha256(actual, field=field)
    if checked != expected:
        _fail(code, f"{field} does not bind its exact predecessor")
    return checked


def _check_git_oid(actual: object, *, expected: str, field: str, code: str) -> str:
    checked = _require_git_oid(actual, field=field)
    if checked != expected:
        _fail(code, f"{field} does not bind the pre-run identity")
    return checked


def _require_false(value: object, *, field: str, code: str) -> None:
    if _require_bool(value, field=field):
        _fail(code, f"{field} must remain false")


def _validate_freeze(marker: FreezeMarkerV1, lifecycle_id: str) -> None:
    _require_literal(marker.schema, field="freeze.schema", expected=FREEZE_SCHEMA_V1)
    _check_lifecycle_id(marker.lifecycle_id, expected=lifecycle_id, field="freeze.lifecycle_id")
    _require_git_oid(marker.frozen_static_commit, field="freeze.frozen_static_commit")
    _require_git_oid(marker.frozen_static_tree, field="freeze.frozen_static_tree")
    _require_sha256(marker.freeze_artifact_digest, field="freeze.freeze_artifact_digest")
    _require_sha256(marker.protocol_digest, field="freeze.protocol_digest")
    _require_sha256(marker.source_manifest_digest, field="freeze.source_manifest_digest")
    _require_sha256(marker.runtime_digest, field="freeze.runtime_digest")
    _require_sha256(marker.inputs_digest, field="freeze.inputs_digest")
    _require_count(marker.archive_bodies_opened, field="freeze.archive_bodies_opened", allowed=(0,))
    _require_count(marker.holdout_bodies_opened, field="freeze.holdout_bodies_opened", allowed=(0,))
    _require_count(
        marker.outcome_bytes_observed, field="freeze.outcome_bytes_observed", allowed=(0,)
    )


def _validate_pre_run(
    identity: PreRunIdentityV1,
    *,
    lifecycle_id: str,
    freeze: FreezeMarkerV1,
) -> None:
    _require_literal(identity.schema, field="pre_run.schema", expected=PRE_RUN_SCHEMA_V1)
    _check_lifecycle_id(
        identity.lifecycle_id,
        expected=lifecycle_id,
        field="pre_run.lifecycle_id",
    )
    commit = _require_git_oid(identity.commit, field="pre_run.commit")
    tree = _require_git_oid(identity.tree, field="pre_run.tree")
    parent = _require_git_oid(identity.parent_commit, field="pre_run.parent_commit")
    origin_commit = _require_git_oid(identity.origin_commit, field="pre_run.origin_commit")
    _require_origin_ref(identity.origin_ref, field="pre_run.origin_ref")
    _require_scope(identity.scope, field="pre_run.scope")
    if not _require_bool(identity.worktree_clean, field="pre_run.worktree_clean"):
        _fail("PRE_RUN_TREE_DIRTY", "the pre-run worktree must be clean")
    _check_digest(
        identity.freeze_artifact_digest,
        expected=freeze.freeze_artifact_digest,
        field="pre_run.freeze_artifact_digest",
        code="PRE_RUN_FREEZE_MISMATCH",
    )
    if parent != freeze.frozen_static_commit:
        _fail(
            "PRE_RUN_PARENT_MISMATCH",
            "pre-run commit must directly descend from frozen static commit",
        )
    if commit == parent:
        _fail("PRE_RUN_COMMIT_NOT_DISTINCT", "pre-run commit must be a distinct immutable revision")
    if tree == freeze.frozen_static_tree:
        _fail(
            "PRE_RUN_TREE_NOT_DISTINCT", "pre-run tree must contain the committed freeze artifact"
        )
    if origin_commit != commit:
        _fail("PRE_RUN_ORIGIN_MISMATCH", "origin must preserve the exact pre-run commit")


def _validate_run(
    run: RunConsumedV1,
    *,
    lifecycle_id: str,
    expected_predecessor: str,
    pre_run: PreRunIdentityV1,
    freeze: FreezeMarkerV1,
) -> str:
    _require_literal(run.schema, field="run.schema", expected=RUN_SCHEMA_V1)
    _check_lifecycle_id(run.lifecycle_id, expected=lifecycle_id, field="run.lifecycle_id")
    run_id = _require_id(run.run_id, field="run.run_id")
    _check_digest(
        run.predecessor_digest,
        expected=expected_predecessor,
        field="run.predecessor_digest",
        code="RUN_PREDECESSOR_MISMATCH",
    )
    _require_sha256(run.marker_artifact_digest, field="run.marker_artifact_digest")
    _check_git_oid(
        run.pre_run_commit,
        expected=pre_run.commit,
        field="run.pre_run_commit",
        code="RUN_PRE_RUN_COMMIT_MISMATCH",
    )
    _check_git_oid(
        run.pre_run_tree,
        expected=pre_run.tree,
        field="run.pre_run_tree",
        code="RUN_PRE_RUN_TREE_MISMATCH",
    )
    _check_digest(
        run.freeze_artifact_digest,
        expected=freeze.freeze_artifact_digest,
        field="run.freeze_artifact_digest",
        code="RUN_FREEZE_MISMATCH",
    )
    _require_count(run.run_count, field="run.run_count", allowed=(1,))
    _require_count(run.allowed_run_count, field="run.allowed_run_count", allowed=(1,))
    _require_count(
        run.opened_development_bytes_before_marker,
        field="run.opened_development_bytes_before_marker",
        allowed=(0,),
    )
    _require_false(
        run.rerun_authorized,
        field="run.rerun_authorized",
        code="RERUN_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        run.resume_authorized,
        field="run.resume_authorized",
        code="RESUME_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        run.repair_authorized,
        field="run.repair_authorized",
        code="REPAIR_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        run.refreeze_authorized,
        field="run.refreeze_authorized",
        code="REFREEZE_AUTHORITY_FORBIDDEN",
    )
    return run_id


def _validate_development(
    opening: DevelopmentOpeningV1,
    *,
    lifecycle_id: str,
    run_id: str,
    expected_predecessor: str,
) -> None:
    _require_literal(
        opening.schema,
        field="development.schema",
        expected=DEVELOPMENT_SCHEMA_V1,
    )
    _check_lifecycle_id(
        opening.lifecycle_id,
        expected=lifecycle_id,
        field="development.lifecycle_id",
    )
    _check_run_id(opening.run_id, expected=run_id, field="development.run_id")
    _check_digest(
        opening.predecessor_digest,
        expected=expected_predecessor,
        field="development.predecessor_digest",
        code="DEVELOPMENT_PREDECESSOR_MISMATCH",
    )
    _require_sha256(
        opening.marker_artifact_digest,
        field="development.marker_artifact_digest",
    )
    _require_sha256(opening.partition_digest, field="development.partition_digest")
    _require_count(opening.open_count, field="development.open_count", allowed=(1,))
    _require_count(
        opening.opened_bytes_before_marker,
        field="development.opened_bytes_before_marker",
        allowed=(0,),
    )
    _require_count(
        opening.outcome_bytes_before_marker,
        field="development.outcome_bytes_before_marker",
        allowed=(0,),
    )


def _validate_candidate(
    seal: CandidateSealV1,
    *,
    lifecycle_id: str,
    run_id: str,
    expected_predecessor: str,
    development_present: bool,
) -> None:
    _require_literal(seal.schema, field="candidate.schema", expected=CANDIDATE_SCHEMA_V1)
    _check_lifecycle_id(
        seal.lifecycle_id,
        expected=lifecycle_id,
        field="candidate.lifecycle_id",
    )
    _check_run_id(seal.run_id, expected=run_id, field="candidate.run_id")
    _check_digest(
        seal.predecessor_digest,
        expected=expected_predecessor,
        field="candidate.predecessor_digest",
        code="CANDIDATE_PREDECESSOR_MISMATCH",
    )
    _require_sha256(seal.seal_artifact_digest, field="candidate.seal_artifact_digest")
    expected_open_count = 1 if development_present else 0
    _require_count(
        seal.development_open_count,
        field="candidate.development_open_count",
        allowed=(expected_open_count,),
    )
    if type(seal.development_disposition) is not DevelopmentDisposition:
        _fail(
            "DEVELOPMENT_DISPOSITION_INVALID",
            "candidate.development_disposition must be a frozen enum value",
        )
    _require_sha256(
        seal.development_result_digest,
        field="candidate.development_result_digest",
    )
    _require_sha256(
        seal.development_gate_digest,
        field="candidate.development_gate_digest",
    )
    candidate_id = _optional_id(seal.candidate_id, field="candidate.candidate_id")
    candidate_digest = _optional_sha256(
        seal.candidate_artifact_digest,
        field="candidate.candidate_artifact_digest",
    )
    parameters_digest = _optional_sha256(
        seal.frozen_parameters_digest,
        field="candidate.frozen_parameters_digest",
    )
    _require_sha256(seal.frozen_code_digest, field="candidate.frozen_code_digest")
    _require_sha256(seal.frozen_data_digest, field="candidate.frozen_data_digest")
    _require_sha256(seal.frozen_cost_digest, field="candidate.frozen_cost_digest")
    _require_sha256(
        seal.frozen_statistic_digest,
        field="candidate.frozen_statistic_digest",
    )
    _require_sha256(
        seal.frozen_decision_rule_digest,
        field="candidate.frozen_decision_rule_digest",
    )
    holdout_eligible = _require_bool(
        seal.holdout_eligible,
        field="candidate.holdout_eligible",
    )
    _require_false(
        seal.fallback_authorized,
        field="candidate.fallback_authorized",
        code="CANDIDATE_FALLBACK_FORBIDDEN",
    )

    if seal.development_disposition is DevelopmentDisposition.PASSED:
        if not development_present:
            _fail(
                "DEVELOPMENT_PASS_WITHOUT_OPEN",
                "development cannot pass before its opening marker",
            )
        if (
            candidate_id is None
            or candidate_digest is None
            or parameters_digest is None
            or not holdout_eligible
        ):
            _fail(
                "ELIGIBLE_CANDIDATE_INCOMPLETE",
                "passed development requires one exact eligible candidate",
            )
    else:
        if (
            candidate_id is not None
            or candidate_digest is not None
            or parameters_digest is not None
        ):
            _fail(
                "NULL_CANDIDATE_REQUIRED",
                "failed or unmeasured development must seal a null candidate",
            )
        if holdout_eligible:
            _fail(
                "HOLDOUT_ELIGIBILITY_FORBIDDEN",
                "failed or unmeasured development cannot qualify a holdout",
            )
        if (
            not development_present
            and seal.development_disposition is not DevelopmentDisposition.UNMEASURED
        ):
            _fail(
                "DEVELOPMENT_FAILURE_WITHOUT_OPEN",
                "pre-development terminal evidence must remain UNMEASURED",
            )


def _validate_holdout(
    opening: HoldoutOpeningV1,
    *,
    lifecycle_id: str,
    run_id: str,
    expected_predecessor: str,
    candidate: CandidateSealV1,
) -> None:
    _require_literal(opening.schema, field="holdout.schema", expected=HOLDOUT_SCHEMA_V1)
    _check_lifecycle_id(
        opening.lifecycle_id,
        expected=lifecycle_id,
        field="holdout.lifecycle_id",
    )
    _check_run_id(opening.run_id, expected=run_id, field="holdout.run_id")
    _check_digest(
        opening.predecessor_digest,
        expected=expected_predecessor,
        field="holdout.predecessor_digest",
        code="HOLDOUT_PREDECESSOR_MISMATCH",
    )
    _require_sha256(opening.marker_artifact_digest, field="holdout.marker_artifact_digest")
    _require_sha256(opening.partition_digest, field="holdout.partition_digest")
    _check_digest(
        opening.candidate_seal_digest,
        expected=expected_predecessor,
        field="holdout.candidate_seal_digest",
        code="HOLDOUT_CANDIDATE_SEAL_MISMATCH",
    )
    candidate_id = _require_id(opening.candidate_id, field="holdout.candidate_id")
    candidate_artifact_digest = _require_sha256(
        opening.candidate_artifact_digest,
        field="holdout.candidate_artifact_digest",
    )
    _require_count(opening.open_count, field="holdout.open_count", allowed=(1,))
    _require_count(opening.candidate_count, field="holdout.candidate_count", allowed=(1,))
    _require_count(
        opening.opened_bytes_before_marker,
        field="holdout.opened_bytes_before_marker",
        allowed=(0,),
    )
    _require_count(
        opening.feedback_count_before_marker,
        field="holdout.feedback_count_before_marker",
        allowed=(0,),
    )
    _require_false(
        opening.fallback_used,
        field="holdout.fallback_used",
        code="HOLDOUT_FALLBACK_FORBIDDEN",
    )
    if candidate.development_disposition is not DevelopmentDisposition.PASSED:
        _fail("HOLDOUT_AFTER_FAILED_DEVELOPMENT", "holdout requires passed development")
    if not candidate.holdout_eligible:
        _fail("HOLDOUT_NOT_ELIGIBLE", "candidate seal does not authorize a holdout opening")
    if candidate.candidate_id is None or candidate.candidate_artifact_digest is None:
        _fail("HOLDOUT_CANDIDATE_ABSENT", "holdout requires one non-null sealed candidate")
    if candidate_id != candidate.candidate_id:
        _fail("HOLDOUT_CANDIDATE_SUBSTITUTION", "holdout candidate identity changed after seal")
    if candidate_artifact_digest != candidate.candidate_artifact_digest:
        _fail("HOLDOUT_CANDIDATE_SUBSTITUTION", "holdout candidate artifact changed after seal")


def _validate_terminal(
    result: TerminalResultV1,
    *,
    lifecycle_id: str,
    run_id: str,
    expected_predecessor: str,
    pre_run: PreRunIdentityV1,
    freeze: FreezeMarkerV1,
    candidate: CandidateSealV1,
    candidate_digest: str,
    development_present: bool,
    holdout_present: bool,
) -> None:
    _require_literal(result.schema, field="terminal.schema", expected=TERMINAL_SCHEMA_V1)
    _check_lifecycle_id(
        result.lifecycle_id,
        expected=lifecycle_id,
        field="terminal.lifecycle_id",
    )
    _check_run_id(result.run_id, expected=run_id, field="terminal.run_id")
    _check_digest(
        result.predecessor_digest,
        expected=expected_predecessor,
        field="terminal.predecessor_digest",
        code="TERMINAL_PREDECESSOR_MISMATCH",
    )
    _require_sha256(
        result.terminal_artifact_digest,
        field="terminal.terminal_artifact_digest",
    )
    _check_digest(
        result.candidate_seal_digest,
        expected=candidate_digest,
        field="terminal.candidate_seal_digest",
        code="TERMINAL_CANDIDATE_SEAL_MISMATCH",
    )
    _check_git_oid(
        result.pre_run_commit,
        expected=pre_run.commit,
        field="terminal.pre_run_commit",
        code="TERMINAL_PRE_RUN_COMMIT_MISMATCH",
    )
    _check_git_oid(
        result.pre_run_tree,
        expected=pre_run.tree,
        field="terminal.pre_run_tree",
        code="TERMINAL_PRE_RUN_TREE_MISMATCH",
    )
    _check_digest(
        result.freeze_artifact_digest,
        expected=freeze.freeze_artifact_digest,
        field="terminal.freeze_artifact_digest",
        code="TERMINAL_FREEZE_MISMATCH",
    )
    if type(result.verdict) is not TerminalVerdict:
        _fail("TERMINAL_VERDICT_INVALID", "terminal.verdict must be a frozen enum value")
    _require_count(result.run_count, field="terminal.run_count", allowed=(1,))
    _require_count(
        result.development_open_count,
        field="terminal.development_open_count",
        allowed=(1 if development_present else 0,),
    )
    _require_count(
        result.holdout_open_count,
        field="terminal.holdout_open_count",
        allowed=(1 if holdout_present else 0,),
    )
    _require_count(result.terminal_count, field="terminal.terminal_count", allowed=(1,))
    _require_literal(result.authority, field="terminal.authority", expected="NONE")
    _require_false(
        result.rerun_authorized,
        field="terminal.rerun_authorized",
        code="RERUN_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        result.resume_authorized,
        field="terminal.resume_authorized",
        code="RESUME_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        result.repair_authorized,
        field="terminal.repair_authorized",
        code="REPAIR_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        result.refreeze_authorized,
        field="terminal.refreeze_authorized",
        code="REFREEZE_AUTHORITY_FORBIDDEN",
    )
    _require_false(
        result.successor_authorized,
        field="terminal.successor_authorized",
        code="TERMINAL_SUCCESSOR_FORBIDDEN",
    )

    if result.verdict is TerminalVerdict.UNMEASURED and (
        candidate.development_disposition is not DevelopmentDisposition.UNMEASURED
        or candidate.candidate_id is not None
        or candidate.candidate_artifact_digest is not None
        or candidate.frozen_parameters_digest is not None
        or candidate.holdout_eligible
        or holdout_present
    ):
        _fail(
            "UNMEASURED_VERDICT_REQUIRES_NULL_CANDIDATE",
            "terminal UNMEASURED requires an unmeasured null candidate and no holdout",
        )
    if result.verdict is TerminalVerdict.GO and not holdout_present:
        _fail("GO_WITHOUT_HOLDOUT", "GO requires one opened champion-only holdout")
    if candidate.development_disposition is DevelopmentDisposition.UNMEASURED:
        if result.verdict is not TerminalVerdict.UNMEASURED:
            _fail(
                "UNMEASURED_DISPOSITION_VERDICT_MISMATCH",
                "unmeasured development requires terminal UNMEASURED",
            )
    elif candidate.development_disposition is DevelopmentDisposition.FAILED:
        if result.verdict is TerminalVerdict.GO:
            _fail("FAILED_DEVELOPMENT_GO_FORBIDDEN", "failed development cannot produce GO")
        if holdout_present:
            _fail("FAILED_DEVELOPMENT_HOLDOUT_FORBIDDEN", "failed development cannot open holdout")
    elif not holdout_present and result.verdict is not TerminalVerdict.UNMEASURED:
        _fail(
            "PASSED_DEVELOPMENT_WITHOUT_HOLDOUT",
            "passed development without a holdout can terminate only UNMEASURED",
        )


def validate_lifecycle_v1(snapshot: LifecycleSnapshotV1) -> LifecycleReceiptV1:
    """Atomically validate one prospective sealed-research lifecycle snapshot."""

    if type(snapshot) is not LifecycleSnapshotV1:
        _fail("SNAPSHOT_TYPE_INVALID", "snapshot must be exact LifecycleSnapshotV1")
    _require_literal(snapshot.schema, field="snapshot.schema", expected=SCHEMA_V1)
    lifecycle_id = _require_id(snapshot.lifecycle_id, field="snapshot.lifecycle_id")
    if type(snapshot.freeze) is not FreezeMarkerV1:
        _fail("FREEZE_REQUIRED", "snapshot.freeze must be FreezeMarkerV1")
    if type(snapshot.pre_run) is not PreRunIdentityV1:
        _fail("PRE_RUN_REQUIRED", "snapshot.pre_run must be PreRunIdentityV1")
    _validate_freeze(snapshot.freeze, lifecycle_id)
    _validate_pre_run(snapshot.pre_run, lifecycle_id=lifecycle_id, freeze=snapshot.freeze)

    freeze_record_digest = _digest(
        _FREEZE_DOMAIN,
        FreezeMarkerV1.as_dict(snapshot.freeze),
    )
    pre_run_record_digest = _digest(
        _PRE_RUN_DOMAIN,
        PreRunIdentityV1.as_dict(snapshot.pre_run),
    )
    frozen_state_digest = _digest(
        _FROZEN_STATE_DOMAIN,
        {
            "freezeRecordDigest": freeze_record_digest,
            "preRunRecordDigest": pre_run_record_digest,
            "version": 1,
        },
    )

    state = LifecycleState.FROZEN
    run_id: str | None = None
    run_record_digest: str | None = None
    development_record_digest: str | None = None
    candidate_record_digest: str | None = None
    holdout_record_digest: str | None = None
    terminal_record_digest: str | None = None
    development_disposition: DevelopmentDisposition | None = None
    candidate_id: str | None = None
    holdout_eligible = False
    verdict: TerminalVerdict | None = None

    if snapshot.run_consumed is None:
        if any(
            item is not None
            for item in (
                snapshot.development_opening,
                snapshot.candidate_seal,
                snapshot.holdout_opening,
                snapshot.terminal_result,
            )
        ):
            _fail("RUN_PREFIX_MISSING", "no lifecycle record may follow an absent run marker")
    else:
        if type(snapshot.run_consumed) is not RunConsumedV1:
            _fail("RUN_RECORD_INVALID", "snapshot.run_consumed must be RunConsumedV1")
        run_id = _validate_run(
            snapshot.run_consumed,
            lifecycle_id=lifecycle_id,
            expected_predecessor=frozen_state_digest,
            pre_run=snapshot.pre_run,
            freeze=snapshot.freeze,
        )
        run_record_digest = _digest(
            _RUN_DOMAIN,
            RunConsumedV1.as_dict(snapshot.run_consumed),
        )
        state = LifecycleState.RUN_CONSUMED

        if snapshot.development_opening is not None:
            if type(snapshot.development_opening) is not DevelopmentOpeningV1:
                _fail(
                    "DEVELOPMENT_RECORD_INVALID",
                    "snapshot.development_opening must be DevelopmentOpeningV1",
                )
            _validate_development(
                snapshot.development_opening,
                lifecycle_id=lifecycle_id,
                run_id=run_id,
                expected_predecessor=run_record_digest,
            )
            development_record_digest = _digest(
                _DEVELOPMENT_DOMAIN,
                DevelopmentOpeningV1.as_dict(snapshot.development_opening),
            )
            state = LifecycleState.DEVELOPMENT_OPENED

        if snapshot.candidate_seal is None:
            if snapshot.holdout_opening is not None or snapshot.terminal_result is not None:
                _fail(
                    "CANDIDATE_SEAL_MISSING",
                    "holdout and terminal records require one exact candidate seal",
                )
        else:
            if type(snapshot.candidate_seal) is not CandidateSealV1:
                _fail(
                    "CANDIDATE_RECORD_INVALID",
                    "snapshot.candidate_seal must be CandidateSealV1",
                )
            candidate_predecessor = development_record_digest or run_record_digest
            _validate_candidate(
                snapshot.candidate_seal,
                lifecycle_id=lifecycle_id,
                run_id=run_id,
                expected_predecessor=candidate_predecessor,
                development_present=snapshot.development_opening is not None,
            )
            candidate_record_digest = _digest(
                _CANDIDATE_DOMAIN,
                CandidateSealV1.as_dict(snapshot.candidate_seal),
            )
            development_disposition = snapshot.candidate_seal.development_disposition
            candidate_id = snapshot.candidate_seal.candidate_id
            holdout_eligible = snapshot.candidate_seal.holdout_eligible
            state = LifecycleState.CANDIDATE_SEALED

            if snapshot.holdout_opening is not None:
                if type(snapshot.holdout_opening) is not HoldoutOpeningV1:
                    _fail(
                        "HOLDOUT_RECORD_INVALID",
                        "snapshot.holdout_opening must be HoldoutOpeningV1",
                    )
                _validate_holdout(
                    snapshot.holdout_opening,
                    lifecycle_id=lifecycle_id,
                    run_id=run_id,
                    expected_predecessor=candidate_record_digest,
                    candidate=snapshot.candidate_seal,
                )
                holdout_record_digest = _digest(
                    _HOLDOUT_DOMAIN,
                    HoldoutOpeningV1.as_dict(snapshot.holdout_opening),
                )
                state = LifecycleState.HOLDOUT_OPENED

            if snapshot.terminal_result is not None:
                if type(snapshot.terminal_result) is not TerminalResultV1:
                    _fail(
                        "TERMINAL_RECORD_INVALID",
                        "snapshot.terminal_result must be TerminalResultV1",
                    )
                terminal_predecessor = holdout_record_digest or candidate_record_digest
                _validate_terminal(
                    snapshot.terminal_result,
                    lifecycle_id=lifecycle_id,
                    run_id=run_id,
                    expected_predecessor=terminal_predecessor,
                    pre_run=snapshot.pre_run,
                    freeze=snapshot.freeze,
                    candidate=snapshot.candidate_seal,
                    candidate_digest=candidate_record_digest,
                    development_present=snapshot.development_opening is not None,
                    holdout_present=snapshot.holdout_opening is not None,
                )
                terminal_record_digest = _digest(
                    _TERMINAL_DOMAIN,
                    TerminalResultV1.as_dict(snapshot.terminal_result),
                )
                verdict = snapshot.terminal_result.verdict
                state = LifecycleState.TERMINAL

    intake_status = (
        IntakeStatus.TERMINAL_LIFECYCLE_VALID
        if state is LifecycleState.TERMINAL
        else IntakeStatus.NOT_TERMINAL_FOR_INTAKE
    )
    receipt_payload: dict[str, object] = {
        "authority": "NONE",
        "candidateId": candidate_id,
        "candidateSealDigest": candidate_record_digest,
        "consumer": "N3_FUTURE_RESEARCH_INTAKE",
        "developmentDisposition": (
            None if development_disposition is None else development_disposition.value
        ),
        "developmentOpenCount": 1 if snapshot.development_opening is not None else 0,
        "developmentRecordDigest": development_record_digest,
        "freezeArtifactDigest": snapshot.freeze.freeze_artifact_digest,
        "frozenStateDigest": frozen_state_digest,
        "holdoutEligible": holdout_eligible,
        "holdoutOpenCount": 1 if snapshot.holdout_opening is not None else 0,
        "holdoutRecordDigest": holdout_record_digest,
        "intakeStatus": intake_status.value,
        "lifecycleId": lifecycle_id,
        "originRef": snapshot.pre_run.origin_ref,
        "preRunCommit": snapshot.pre_run.commit,
        "preRunTree": snapshot.pre_run.tree,
        "refreezeAuthorized": False,
        "repairAuthorized": False,
        "rerunAuthorized": False,
        "resumeAuthorized": False,
        "runConsumed": snapshot.run_consumed is not None,
        "runId": run_id,
        "runRecordDigest": run_record_digest,
        "schema": RECEIPT_SCHEMA_V1,
        "scope": snapshot.pre_run.scope,
        "state": state.value,
        "terminalResultDigest": terminal_record_digest,
        "verdict": None if verdict is None else verdict.value,
    }
    receipt_digest = _digest(_RECEIPT_DOMAIN, receipt_payload)
    return LifecycleReceiptV1(
        schema=RECEIPT_SCHEMA_V1,
        lifecycle_id=lifecycle_id,
        state=state,
        scope=snapshot.pre_run.scope,
        pre_run_commit=snapshot.pre_run.commit,
        pre_run_tree=snapshot.pre_run.tree,
        origin_ref=snapshot.pre_run.origin_ref,
        freeze_artifact_digest=snapshot.freeze.freeze_artifact_digest,
        frozen_state_digest=frozen_state_digest,
        run_id=run_id,
        run_consumed=snapshot.run_consumed is not None,
        run_record_digest=run_record_digest,
        development_open_count=1 if snapshot.development_opening is not None else 0,
        development_record_digest=development_record_digest,
        development_disposition=development_disposition,
        candidate_seal_digest=candidate_record_digest,
        candidate_id=candidate_id,
        holdout_eligible=holdout_eligible,
        holdout_open_count=1 if snapshot.holdout_opening is not None else 0,
        holdout_record_digest=holdout_record_digest,
        terminal_result_digest=terminal_record_digest,
        verdict=verdict,
        intake_status=intake_status,
        consumer="N3_FUTURE_RESEARCH_INTAKE",
        rerun_authorized=False,
        resume_authorized=False,
        repair_authorized=False,
        refreeze_authorized=False,
        authority="NONE",
        receipt_digest=receipt_digest,
    )


def _duplicate_object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _fail("JSON_DUPLICATE_KEY", f"duplicate JSON object key {key!r}")
        result[key] = value
    return result


def _reject_json_constant(token: str) -> NoReturn:
    _fail("JSON_NONFINITE_NUMBER", f"JSON constant {token!r} is forbidden")


def _reject_json_float(token: str) -> NoReturn:
    _fail("JSON_FLOAT_FORBIDDEN", f"JSON float {token!r} is outside the lifecycle schema")


def _check_json_shape(value: object) -> None:
    stack: list[tuple[object, int]] = [(value, 1)]
    nodes = 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if nodes > _MAX_JSON_NODES:
            _fail("JSON_NODE_LIMIT", "JSON input exceeds the frozen node limit")
        if depth > _MAX_JSON_DEPTH:
            _fail("JSON_DEPTH_LIMIT", "JSON input exceeds the frozen depth limit")
        if isinstance(item, dict):
            stack.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)


def _parse_development_disposition(value: object, *, field: str) -> DevelopmentDisposition:
    checked = _require_string(value, field=field)
    try:
        return DevelopmentDisposition(checked)
    except ValueError as error:
        raise LifecycleContractError(
            "DEVELOPMENT_DISPOSITION_INVALID",
            f"{field} is not a frozen disposition",
        ) from error


def _parse_terminal_verdict(value: object, *, field: str) -> TerminalVerdict:
    checked = _require_string(value, field=field)
    try:
        return TerminalVerdict(checked)
    except ValueError as error:
        raise LifecycleContractError(
            "TERMINAL_VERDICT_INVALID",
            f"{field} is not a frozen verdict",
        ) from error


def _parse_freeze(value: object) -> FreezeMarkerV1:
    data = _require_mapping(value, field="freeze")
    _require_exact_fields(
        data,
        field="freeze",
        expected=frozenset(
            {
                "archiveBodiesOpened",
                "freezeArtifactDigest",
                "frozenStaticCommit",
                "frozenStaticTree",
                "holdoutBodiesOpened",
                "inputsDigest",
                "lifecycleId",
                "outcomeBytesObserved",
                "protocolDigest",
                "runtimeDigest",
                "schema",
                "sourceManifestDigest",
            }
        ),
    )
    return FreezeMarkerV1(
        schema=_require_string(data["schema"], field="freeze.schema"),
        lifecycle_id=_require_string(data["lifecycleId"], field="freeze.lifecycleId"),
        frozen_static_commit=_require_string(
            data["frozenStaticCommit"],
            field="freeze.frozenStaticCommit",
        ),
        frozen_static_tree=_require_string(
            data["frozenStaticTree"],
            field="freeze.frozenStaticTree",
        ),
        freeze_artifact_digest=_require_string(
            data["freezeArtifactDigest"],
            field="freeze.freezeArtifactDigest",
        ),
        protocol_digest=_require_string(
            data["protocolDigest"],
            field="freeze.protocolDigest",
        ),
        source_manifest_digest=_require_string(
            data["sourceManifestDigest"],
            field="freeze.sourceManifestDigest",
        ),
        runtime_digest=_require_string(data["runtimeDigest"], field="freeze.runtimeDigest"),
        inputs_digest=_require_string(data["inputsDigest"], field="freeze.inputsDigest"),
        archive_bodies_opened=_require_count(
            data["archiveBodiesOpened"],
            field="freeze.archiveBodiesOpened",
            allowed=(0,),
        ),
        holdout_bodies_opened=_require_count(
            data["holdoutBodiesOpened"],
            field="freeze.holdoutBodiesOpened",
            allowed=(0,),
        ),
        outcome_bytes_observed=_require_count(
            data["outcomeBytesObserved"],
            field="freeze.outcomeBytesObserved",
            allowed=(0,),
        ),
    )


def _parse_pre_run(value: object) -> PreRunIdentityV1:
    data = _require_mapping(value, field="preRun")
    _require_exact_fields(
        data,
        field="preRun",
        expected=frozenset(
            {
                "commit",
                "freezeArtifactDigest",
                "lifecycleId",
                "originCommit",
                "originRef",
                "parentCommit",
                "schema",
                "scope",
                "tree",
                "worktreeClean",
            }
        ),
    )
    return PreRunIdentityV1(
        schema=_require_string(data["schema"], field="preRun.schema"),
        lifecycle_id=_require_string(data["lifecycleId"], field="preRun.lifecycleId"),
        commit=_require_string(data["commit"], field="preRun.commit"),
        tree=_require_string(data["tree"], field="preRun.tree"),
        parent_commit=_require_string(data["parentCommit"], field="preRun.parentCommit"),
        origin_ref=_require_string(data["originRef"], field="preRun.originRef"),
        origin_commit=_require_string(data["originCommit"], field="preRun.originCommit"),
        scope=_require_string(data["scope"], field="preRun.scope"),
        worktree_clean=_require_bool(data["worktreeClean"], field="preRun.worktreeClean"),
        freeze_artifact_digest=_require_string(
            data["freezeArtifactDigest"],
            field="preRun.freezeArtifactDigest",
        ),
    )


def _parse_run(value: object) -> RunConsumedV1:
    data = _require_mapping(value, field="runConsumed")
    _require_exact_fields(
        data,
        field="runConsumed",
        expected=frozenset(
            {
                "allowedRunCount",
                "freezeArtifactDigest",
                "lifecycleId",
                "markerArtifactDigest",
                "openedDevelopmentBytesBeforeMarker",
                "preRunCommit",
                "preRunTree",
                "predecessorDigest",
                "refreezeAuthorized",
                "repairAuthorized",
                "rerunAuthorized",
                "resumeAuthorized",
                "runCount",
                "runId",
                "schema",
            }
        ),
    )
    return RunConsumedV1(
        schema=_require_string(data["schema"], field="runConsumed.schema"),
        lifecycle_id=_require_string(
            data["lifecycleId"],
            field="runConsumed.lifecycleId",
        ),
        run_id=_require_string(data["runId"], field="runConsumed.runId"),
        predecessor_digest=_require_string(
            data["predecessorDigest"],
            field="runConsumed.predecessorDigest",
        ),
        marker_artifact_digest=_require_string(
            data["markerArtifactDigest"],
            field="runConsumed.markerArtifactDigest",
        ),
        pre_run_commit=_require_string(
            data["preRunCommit"],
            field="runConsumed.preRunCommit",
        ),
        pre_run_tree=_require_string(data["preRunTree"], field="runConsumed.preRunTree"),
        freeze_artifact_digest=_require_string(
            data["freezeArtifactDigest"],
            field="runConsumed.freezeArtifactDigest",
        ),
        run_count=_require_count(data["runCount"], field="runConsumed.runCount", allowed=(1,)),
        allowed_run_count=_require_count(
            data["allowedRunCount"],
            field="runConsumed.allowedRunCount",
            allowed=(1,),
        ),
        opened_development_bytes_before_marker=_require_count(
            data["openedDevelopmentBytesBeforeMarker"],
            field="runConsumed.openedDevelopmentBytesBeforeMarker",
            allowed=(0,),
        ),
        rerun_authorized=_require_bool(
            data["rerunAuthorized"],
            field="runConsumed.rerunAuthorized",
        ),
        resume_authorized=_require_bool(
            data["resumeAuthorized"],
            field="runConsumed.resumeAuthorized",
        ),
        repair_authorized=_require_bool(
            data["repairAuthorized"],
            field="runConsumed.repairAuthorized",
        ),
        refreeze_authorized=_require_bool(
            data["refreezeAuthorized"],
            field="runConsumed.refreezeAuthorized",
        ),
    )


def _parse_development(value: object) -> DevelopmentOpeningV1:
    data = _require_mapping(value, field="developmentOpening")
    _require_exact_fields(
        data,
        field="developmentOpening",
        expected=frozenset(
            {
                "lifecycleId",
                "markerArtifactDigest",
                "openCount",
                "openedBytesBeforeMarker",
                "outcomeBytesBeforeMarker",
                "partitionDigest",
                "predecessorDigest",
                "runId",
                "schema",
            }
        ),
    )
    return DevelopmentOpeningV1(
        schema=_require_string(data["schema"], field="developmentOpening.schema"),
        lifecycle_id=_require_string(
            data["lifecycleId"],
            field="developmentOpening.lifecycleId",
        ),
        run_id=_require_string(data["runId"], field="developmentOpening.runId"),
        predecessor_digest=_require_string(
            data["predecessorDigest"],
            field="developmentOpening.predecessorDigest",
        ),
        marker_artifact_digest=_require_string(
            data["markerArtifactDigest"],
            field="developmentOpening.markerArtifactDigest",
        ),
        partition_digest=_require_string(
            data["partitionDigest"],
            field="developmentOpening.partitionDigest",
        ),
        open_count=_require_count(
            data["openCount"],
            field="developmentOpening.openCount",
            allowed=(1,),
        ),
        opened_bytes_before_marker=_require_count(
            data["openedBytesBeforeMarker"],
            field="developmentOpening.openedBytesBeforeMarker",
            allowed=(0,),
        ),
        outcome_bytes_before_marker=_require_count(
            data["outcomeBytesBeforeMarker"],
            field="developmentOpening.outcomeBytesBeforeMarker",
            allowed=(0,),
        ),
    )


def _parse_candidate(value: object) -> CandidateSealV1:
    data = _require_mapping(value, field="candidateSeal")
    _require_exact_fields(
        data,
        field="candidateSeal",
        expected=frozenset(
            {
                "candidateArtifactDigest",
                "candidateId",
                "developmentDisposition",
                "developmentGateDigest",
                "developmentOpenCount",
                "developmentResultDigest",
                "fallbackAuthorized",
                "frozenCodeDigest",
                "frozenCostDigest",
                "frozenDataDigest",
                "frozenDecisionRuleDigest",
                "frozenParametersDigest",
                "frozenStatisticDigest",
                "holdoutEligible",
                "lifecycleId",
                "predecessorDigest",
                "runId",
                "schema",
                "sealArtifactDigest",
            }
        ),
    )
    return CandidateSealV1(
        schema=_require_string(data["schema"], field="candidateSeal.schema"),
        lifecycle_id=_require_string(
            data["lifecycleId"],
            field="candidateSeal.lifecycleId",
        ),
        run_id=_require_string(data["runId"], field="candidateSeal.runId"),
        predecessor_digest=_require_string(
            data["predecessorDigest"],
            field="candidateSeal.predecessorDigest",
        ),
        seal_artifact_digest=_require_string(
            data["sealArtifactDigest"],
            field="candidateSeal.sealArtifactDigest",
        ),
        development_open_count=_require_count(
            data["developmentOpenCount"],
            field="candidateSeal.developmentOpenCount",
            allowed=(0, 1),
        ),
        development_disposition=_parse_development_disposition(
            data["developmentDisposition"],
            field="candidateSeal.developmentDisposition",
        ),
        development_result_digest=_require_string(
            data["developmentResultDigest"],
            field="candidateSeal.developmentResultDigest",
        ),
        development_gate_digest=_require_string(
            data["developmentGateDigest"],
            field="candidateSeal.developmentGateDigest",
        ),
        candidate_id=(
            None
            if data["candidateId"] is None
            else _require_string(data["candidateId"], field="candidateSeal.candidateId")
        ),
        candidate_artifact_digest=(
            None
            if data["candidateArtifactDigest"] is None
            else _require_string(
                data["candidateArtifactDigest"],
                field="candidateSeal.candidateArtifactDigest",
            )
        ),
        frozen_parameters_digest=(
            None
            if data["frozenParametersDigest"] is None
            else _require_string(
                data["frozenParametersDigest"],
                field="candidateSeal.frozenParametersDigest",
            )
        ),
        frozen_code_digest=_require_string(
            data["frozenCodeDigest"],
            field="candidateSeal.frozenCodeDigest",
        ),
        frozen_data_digest=_require_string(
            data["frozenDataDigest"],
            field="candidateSeal.frozenDataDigest",
        ),
        frozen_cost_digest=_require_string(
            data["frozenCostDigest"],
            field="candidateSeal.frozenCostDigest",
        ),
        frozen_statistic_digest=_require_string(
            data["frozenStatisticDigest"],
            field="candidateSeal.frozenStatisticDigest",
        ),
        frozen_decision_rule_digest=_require_string(
            data["frozenDecisionRuleDigest"],
            field="candidateSeal.frozenDecisionRuleDigest",
        ),
        holdout_eligible=_require_bool(
            data["holdoutEligible"],
            field="candidateSeal.holdoutEligible",
        ),
        fallback_authorized=_require_bool(
            data["fallbackAuthorized"],
            field="candidateSeal.fallbackAuthorized",
        ),
    )


def _parse_holdout(value: object) -> HoldoutOpeningV1:
    data = _require_mapping(value, field="holdoutOpening")
    _require_exact_fields(
        data,
        field="holdoutOpening",
        expected=frozenset(
            {
                "candidateArtifactDigest",
                "candidateCount",
                "candidateId",
                "candidateSealDigest",
                "fallbackUsed",
                "feedbackCountBeforeMarker",
                "lifecycleId",
                "markerArtifactDigest",
                "openCount",
                "openedBytesBeforeMarker",
                "partitionDigest",
                "predecessorDigest",
                "runId",
                "schema",
            }
        ),
    )
    return HoldoutOpeningV1(
        schema=_require_string(data["schema"], field="holdoutOpening.schema"),
        lifecycle_id=_require_string(
            data["lifecycleId"],
            field="holdoutOpening.lifecycleId",
        ),
        run_id=_require_string(data["runId"], field="holdoutOpening.runId"),
        predecessor_digest=_require_string(
            data["predecessorDigest"],
            field="holdoutOpening.predecessorDigest",
        ),
        marker_artifact_digest=_require_string(
            data["markerArtifactDigest"],
            field="holdoutOpening.markerArtifactDigest",
        ),
        partition_digest=_require_string(
            data["partitionDigest"],
            field="holdoutOpening.partitionDigest",
        ),
        candidate_seal_digest=_require_string(
            data["candidateSealDigest"],
            field="holdoutOpening.candidateSealDigest",
        ),
        candidate_id=_require_string(
            data["candidateId"],
            field="holdoutOpening.candidateId",
        ),
        candidate_artifact_digest=_require_string(
            data["candidateArtifactDigest"],
            field="holdoutOpening.candidateArtifactDigest",
        ),
        open_count=_require_count(
            data["openCount"],
            field="holdoutOpening.openCount",
            allowed=(1,),
        ),
        candidate_count=_require_count(
            data["candidateCount"],
            field="holdoutOpening.candidateCount",
            allowed=(1,),
        ),
        opened_bytes_before_marker=_require_count(
            data["openedBytesBeforeMarker"],
            field="holdoutOpening.openedBytesBeforeMarker",
            allowed=(0,),
        ),
        feedback_count_before_marker=_require_count(
            data["feedbackCountBeforeMarker"],
            field="holdoutOpening.feedbackCountBeforeMarker",
            allowed=(0,),
        ),
        fallback_used=_require_bool(
            data["fallbackUsed"],
            field="holdoutOpening.fallbackUsed",
        ),
    )


def _parse_terminal(value: object) -> TerminalResultV1:
    data = _require_mapping(value, field="terminalResult")
    _require_exact_fields(
        data,
        field="terminalResult",
        expected=frozenset(
            {
                "authority",
                "candidateSealDigest",
                "developmentOpenCount",
                "freezeArtifactDigest",
                "holdoutOpenCount",
                "lifecycleId",
                "preRunCommit",
                "preRunTree",
                "predecessorDigest",
                "refreezeAuthorized",
                "repairAuthorized",
                "rerunAuthorized",
                "resumeAuthorized",
                "runCount",
                "runId",
                "schema",
                "successorAuthorized",
                "terminalArtifactDigest",
                "terminalCount",
                "verdict",
            }
        ),
    )
    return TerminalResultV1(
        schema=_require_string(data["schema"], field="terminalResult.schema"),
        lifecycle_id=_require_string(
            data["lifecycleId"],
            field="terminalResult.lifecycleId",
        ),
        run_id=_require_string(data["runId"], field="terminalResult.runId"),
        predecessor_digest=_require_string(
            data["predecessorDigest"],
            field="terminalResult.predecessorDigest",
        ),
        terminal_artifact_digest=_require_string(
            data["terminalArtifactDigest"],
            field="terminalResult.terminalArtifactDigest",
        ),
        candidate_seal_digest=_require_string(
            data["candidateSealDigest"],
            field="terminalResult.candidateSealDigest",
        ),
        pre_run_commit=_require_string(
            data["preRunCommit"],
            field="terminalResult.preRunCommit",
        ),
        pre_run_tree=_require_string(
            data["preRunTree"],
            field="terminalResult.preRunTree",
        ),
        freeze_artifact_digest=_require_string(
            data["freezeArtifactDigest"],
            field="terminalResult.freezeArtifactDigest",
        ),
        verdict=_parse_terminal_verdict(
            data["verdict"],
            field="terminalResult.verdict",
        ),
        run_count=_require_count(
            data["runCount"],
            field="terminalResult.runCount",
            allowed=(1,),
        ),
        development_open_count=_require_count(
            data["developmentOpenCount"],
            field="terminalResult.developmentOpenCount",
            allowed=(0, 1),
        ),
        holdout_open_count=_require_count(
            data["holdoutOpenCount"],
            field="terminalResult.holdoutOpenCount",
            allowed=(0, 1),
        ),
        terminal_count=_require_count(
            data["terminalCount"],
            field="terminalResult.terminalCount",
            allowed=(1,),
        ),
        authority=_require_string(data["authority"], field="terminalResult.authority"),
        rerun_authorized=_require_bool(
            data["rerunAuthorized"],
            field="terminalResult.rerunAuthorized",
        ),
        resume_authorized=_require_bool(
            data["resumeAuthorized"],
            field="terminalResult.resumeAuthorized",
        ),
        repair_authorized=_require_bool(
            data["repairAuthorized"],
            field="terminalResult.repairAuthorized",
        ),
        refreeze_authorized=_require_bool(
            data["refreezeAuthorized"],
            field="terminalResult.refreezeAuthorized",
        ),
        successor_authorized=_require_bool(
            data["successorAuthorized"],
            field="terminalResult.successorAuthorized",
        ),
    )


def parse_lifecycle_snapshot_v1(payload: bytes) -> LifecycleSnapshotV1:
    """Parse strict bounded JSON into the frozen DQ-9 snapshot types."""

    if type(payload) is not bytes:
        _fail("JSON_BYTES_REQUIRED", "snapshot payload must be immutable bytes")
    if not payload or len(payload) > _MAX_JSON_BYTES:
        _fail("JSON_SIZE_INVALID", f"snapshot payload must be 1..{_MAX_JSON_BYTES} bytes")
    if payload.startswith(b"\xef\xbb\xbf"):
        _fail("JSON_BOM_FORBIDDEN", "UTF-8 BOM is outside the frozen JSON contract")
    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise LifecycleContractError("JSON_UTF8_INVALID", "snapshot is not strict UTF-8") from error
    try:
        parsed = json.loads(
            text,
            object_pairs_hook=_duplicate_object_pairs,
            parse_constant=_reject_json_constant,
            parse_float=_reject_json_float,
        )
    except LifecycleContractError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as error:
        raise LifecycleContractError("JSON_SYNTAX_INVALID", "snapshot JSON is malformed") from error
    _check_json_shape(parsed)
    data = _require_mapping(parsed, field="snapshot")
    _require_exact_fields(
        data,
        field="snapshot",
        expected=frozenset(
            {
                "candidateSeal",
                "developmentOpening",
                "freeze",
                "holdoutOpening",
                "lifecycleId",
                "preRun",
                "runConsumed",
                "schema",
                "terminalResult",
            }
        ),
    )
    snapshot = LifecycleSnapshotV1(
        schema=_require_string(data["schema"], field="snapshot.schema"),
        lifecycle_id=_require_string(data["lifecycleId"], field="snapshot.lifecycleId"),
        freeze=_parse_freeze(data["freeze"]),
        pre_run=_parse_pre_run(data["preRun"]),
        run_consumed=None if data["runConsumed"] is None else _parse_run(data["runConsumed"]),
        development_opening=(
            None
            if data["developmentOpening"] is None
            else _parse_development(data["developmentOpening"])
        ),
        candidate_seal=(
            None if data["candidateSeal"] is None else _parse_candidate(data["candidateSeal"])
        ),
        holdout_opening=(
            None if data["holdoutOpening"] is None else _parse_holdout(data["holdoutOpening"])
        ),
        terminal_result=(
            None if data["terminalResult"] is None else _parse_terminal(data["terminalResult"])
        ),
    )
    return snapshot


def validate_lifecycle_json_v1(payload: bytes) -> LifecycleReceiptV1:
    """Parse and atomically validate one serialized DQ-9 lifecycle snapshot."""

    return validate_lifecycle_v1(parse_lifecycle_snapshot_v1(payload))
