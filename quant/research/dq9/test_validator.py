from __future__ import annotations

import ast
import hashlib
import json
from dataclasses import fields, replace
from pathlib import Path

import pytest
import research.dq9 as dq9
from research.dq9 import (
    CANDIDATE_SCHEMA_V1,
    TERMINAL_SCHEMA_V1,
    CandidateSealV1,
    DevelopmentDisposition,
    HoldoutOpeningV1,
    IntakeStatus,
    LifecycleContractError,
    LifecycleState,
    TerminalResultV1,
    TerminalVerdict,
    parse_lifecycle_snapshot_v1,
    validate_lifecycle_json_v1,
    validate_lifecycle_v1,
)
from research.dq9.known_answer import (
    candidate_snapshot_v1,
    consumed_snapshot_v1,
    development_snapshot_v1,
    frozen_snapshot_v1,
    holdout_snapshot_v1,
    known_answer_projection_v1,
    known_answer_snapshot_v1,
)


def _sha(label: str) -> str:
    return hashlib.sha256(label.encode("ascii", errors="strict")).hexdigest()


def _null_candidate_snapshot(*, development_opened: bool) -> dq9.LifecycleSnapshotV1:
    snapshot = development_snapshot_v1() if development_opened else consumed_snapshot_v1()
    prefix = validate_lifecycle_v1(snapshot)
    assert prefix.run_id is not None
    predecessor = prefix.development_record_digest or prefix.run_record_digest
    assert predecessor is not None
    candidate = CandidateSealV1(
        schema=CANDIDATE_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=prefix.run_id,
        predecessor_digest=predecessor,
        seal_artifact_digest=_sha("null-candidate-seal"),
        development_open_count=1 if development_opened else 0,
        development_disposition=DevelopmentDisposition.UNMEASURED,
        development_result_digest=_sha("unmeasured-development-result"),
        development_gate_digest=_sha("unmeasured-development-gates"),
        candidate_id=None,
        candidate_artifact_digest=None,
        frozen_parameters_digest=None,
        frozen_code_digest=_sha("unmeasured-frozen-code"),
        frozen_data_digest=_sha("unmeasured-frozen-data"),
        frozen_cost_digest=_sha("unmeasured-frozen-costs"),
        frozen_statistic_digest=_sha("unmeasured-frozen-statistic"),
        frozen_decision_rule_digest=_sha("unmeasured-frozen-decision"),
        holdout_eligible=False,
        fallback_authorized=False,
    )
    return replace(snapshot, candidate_seal=candidate)


def _terminal_from_candidate(
    snapshot: dq9.LifecycleSnapshotV1,
    *,
    verdict: TerminalVerdict,
) -> dq9.LifecycleSnapshotV1:
    prefix = validate_lifecycle_v1(snapshot)
    assert prefix.run_id is not None
    assert prefix.candidate_seal_digest is not None
    predecessor = prefix.holdout_record_digest or prefix.candidate_seal_digest
    terminal = TerminalResultV1(
        schema=TERMINAL_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=prefix.run_id,
        predecessor_digest=predecessor,
        terminal_artifact_digest=_sha(f"terminal-{verdict.value.lower()}"),
        candidate_seal_digest=prefix.candidate_seal_digest,
        pre_run_commit=snapshot.pre_run.commit,
        pre_run_tree=snapshot.pre_run.tree,
        freeze_artifact_digest=snapshot.freeze.freeze_artifact_digest,
        verdict=verdict,
        run_count=1,
        development_open_count=1 if snapshot.development_opening is not None else 0,
        holdout_open_count=1 if snapshot.holdout_opening is not None else 0,
        terminal_count=1,
        authority="NONE",
        rerun_authorized=False,
        resume_authorized=False,
        repair_authorized=False,
        refreeze_authorized=False,
        successor_authorized=False,
    )
    return replace(snapshot, terminal_result=terminal)


def _failed_candidate_snapshot() -> dq9.LifecycleSnapshotV1:
    snapshot = development_snapshot_v1()
    prefix = validate_lifecycle_v1(snapshot)
    assert prefix.run_id is not None
    assert prefix.development_record_digest is not None
    assert snapshot.candidate_seal is None
    failed = CandidateSealV1(
        schema=CANDIDATE_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=prefix.run_id,
        predecessor_digest=prefix.development_record_digest,
        seal_artifact_digest=_sha("failed-candidate-seal"),
        development_open_count=1,
        development_disposition=DevelopmentDisposition.FAILED,
        development_result_digest=_sha("failed-development-result"),
        development_gate_digest=_sha("failed-development-gates"),
        candidate_id=None,
        candidate_artifact_digest=None,
        frozen_parameters_digest=None,
        frozen_code_digest=_sha("failed-frozen-code"),
        frozen_data_digest=_sha("failed-frozen-data"),
        frozen_cost_digest=_sha("failed-frozen-cost"),
        frozen_statistic_digest=_sha("failed-frozen-statistic"),
        frozen_decision_rule_digest=_sha("failed-frozen-decision"),
        holdout_eligible=False,
        fallback_authorized=False,
    )
    return replace(snapshot, candidate_seal=failed)


def _reverse_json_mappings(value: object) -> object:
    if isinstance(value, dict):
        return {key: _reverse_json_mappings(value[key]) for key in reversed(tuple(value))}
    if isinstance(value, list):
        return [_reverse_json_mappings(item) for item in value]
    return value


def test_public_api_is_frozen() -> None:
    assert dq9.PUBLIC_API_V1 == (
        "CANDIDATE_SCHEMA_V1",
        "DEVELOPMENT_SCHEMA_V1",
        "FREEZE_SCHEMA_V1",
        "HOLDOUT_SCHEMA_V1",
        "PRE_RUN_SCHEMA_V1",
        "RECEIPT_SCHEMA_V1",
        "RUN_SCHEMA_V1",
        "SCHEMA_V1",
        "TERMINAL_SCHEMA_V1",
        "CandidateSealV1",
        "DevelopmentDisposition",
        "DevelopmentOpeningV1",
        "FreezeMarkerV1",
        "HoldoutOpeningV1",
        "IntakeStatus",
        "LifecycleContractError",
        "LifecycleReceiptV1",
        "LifecycleSnapshotV1",
        "LifecycleState",
        "PreRunIdentityV1",
        "RunConsumedV1",
        "TerminalResultV1",
        "TerminalVerdict",
        "parse_lifecycle_snapshot_v1",
        "validate_lifecycle_json_v1",
        "validate_lifecycle_v1",
    )
    assert tuple(name for name in dq9.__all__ if name != "PUBLIC_API_V1") == dq9.PUBLIC_API_V1


@pytest.mark.parametrize(
    ("snapshot_factory", "expected_state", "run_consumed", "intake_status"),
    [
        (
            frozen_snapshot_v1,
            LifecycleState.FROZEN,
            False,
            IntakeStatus.NOT_TERMINAL_FOR_INTAKE,
        ),
        (
            consumed_snapshot_v1,
            LifecycleState.RUN_CONSUMED,
            True,
            IntakeStatus.NOT_TERMINAL_FOR_INTAKE,
        ),
        (
            development_snapshot_v1,
            LifecycleState.DEVELOPMENT_OPENED,
            True,
            IntakeStatus.NOT_TERMINAL_FOR_INTAKE,
        ),
        (
            candidate_snapshot_v1,
            LifecycleState.CANDIDATE_SEALED,
            True,
            IntakeStatus.NOT_TERMINAL_FOR_INTAKE,
        ),
        (
            holdout_snapshot_v1,
            LifecycleState.HOLDOUT_OPENED,
            True,
            IntakeStatus.NOT_TERMINAL_FOR_INTAKE,
        ),
        (
            known_answer_snapshot_v1,
            LifecycleState.TERMINAL,
            True,
            IntakeStatus.TERMINAL_LIFECYCLE_VALID,
        ),
    ],
)
def test_every_legal_prefix_has_one_derived_state(
    snapshot_factory: object,
    expected_state: LifecycleState,
    run_consumed: bool,
    intake_status: IntakeStatus,
) -> None:
    snapshot = snapshot_factory()  # type: ignore[operator]
    receipt = validate_lifecycle_v1(snapshot)
    assert receipt.state is expected_state
    assert receipt.run_consumed is run_consumed
    assert receipt.intake_status is intake_status
    assert receipt.authority == "NONE"
    assert not receipt.rerun_authorized
    assert not receipt.resume_authorized
    assert not receipt.repair_authorized
    assert not receipt.refreeze_authorized


def test_terminal_before_development_is_null_unmeasured_and_consumed() -> None:
    snapshot = _terminal_from_candidate(
        _null_candidate_snapshot(development_opened=False),
        verdict=TerminalVerdict.UNMEASURED,
    )
    receipt = validate_lifecycle_v1(snapshot)
    assert receipt.state is LifecycleState.TERMINAL
    assert receipt.development_open_count == 0
    assert receipt.development_disposition is DevelopmentDisposition.UNMEASURED
    assert receipt.candidate_id is None
    assert receipt.holdout_open_count == 0
    assert receipt.verdict is TerminalVerdict.UNMEASURED
    assert receipt.run_consumed
    assert receipt.intake_status is IntakeStatus.TERMINAL_LIFECYCLE_VALID


def test_development_failure_terminates_no_go_without_holdout() -> None:
    snapshot = _terminal_from_candidate(
        _failed_candidate_snapshot(),
        verdict=TerminalVerdict.NO_GO,
    )
    receipt = validate_lifecycle_v1(snapshot)
    assert receipt.state is LifecycleState.TERMINAL
    assert receipt.development_disposition is DevelopmentDisposition.FAILED
    assert receipt.holdout_open_count == 0
    assert receipt.verdict is TerminalVerdict.NO_GO


def test_holdout_terminal_binds_one_exact_candidate() -> None:
    receipt = validate_lifecycle_v1(known_answer_snapshot_v1())
    assert receipt.development_disposition is DevelopmentDisposition.PASSED
    assert receipt.candidate_id == "trial-alpha"
    assert receipt.holdout_eligible
    assert receipt.holdout_open_count == 1
    assert receipt.verdict is TerminalVerdict.NO_GO
    assert receipt.terminal_result_digest is not None


def test_holdout_open_without_terminal_is_consumed_nonterminal() -> None:
    receipt = validate_lifecycle_v1(holdout_snapshot_v1())
    assert receipt.state is LifecycleState.HOLDOUT_OPENED
    assert receipt.run_consumed
    assert receipt.holdout_open_count == 1
    assert receipt.intake_status is IntakeStatus.NOT_TERMINAL_FOR_INTAKE
    assert not receipt.rerun_authorized
    assert receipt.terminal_result_digest is None


def test_known_answer_packet() -> None:
    expected = json.loads(
        Path(__file__).with_name("known_answer.v1.json").read_text(encoding="utf-8")
    )
    assert known_answer_projection_v1() == expected


def test_json_key_order_and_whitespace_do_not_change_receipt() -> None:
    snapshot = known_answer_snapshot_v1()
    canonical = validate_lifecycle_json_v1(snapshot.canonical_bytes())
    reordered = _reverse_json_mappings(snapshot.as_dict())
    reordered_bytes = json.dumps(
        reordered,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
    ).encode("utf-8")
    parsed = parse_lifecycle_snapshot_v1(reordered_bytes)
    receipt = validate_lifecycle_v1(parsed)
    assert receipt == canonical
    assert receipt.canonical_bytes() == canonical.canonical_bytes()


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        ({"commit": "a" * 39}, "GIT_OID_INVALID"),
        ({"commit": "A" * 40}, "GIT_OID_INVALID"),
        ({"origin_commit": "5" * 40}, "PRE_RUN_ORIGIN_MISMATCH"),
        ({"parent_commit": "5" * 40}, "PRE_RUN_PARENT_MISMATCH"),
        ({"tree": "2" * 40}, "PRE_RUN_TREE_NOT_DISTINCT"),
        ({"worktree_clean": False}, "PRE_RUN_TREE_DIRTY"),
        ({"scope": "../dq9"}, "SCOPE_INVALID"),
        ({"origin_ref": "refs/remotes/origin/../dq9"}, "ORIGIN_REF_INVALID"),
        ({"origin_ref": "refs/remotes/origin/a..b"}, "ORIGIN_REF_INVALID"),
        ({"origin_ref": "refs/remotes/origin/a.lock/b"}, "ORIGIN_REF_INVALID"),
        ({"origin_ref": "refs/remotes/origin/a/.hidden/b"}, "ORIGIN_REF_INVALID"),
    ],
)
def test_pre_run_identity_fails_closed(mutation: dict[str, object], code: str) -> None:
    snapshot = frozen_snapshot_v1()
    hostile = replace(snapshot, pre_run=replace(snapshot.pre_run, **mutation))
    with pytest.raises(LifecycleContractError, match=code):
        validate_lifecycle_v1(hostile)


def test_one_character_origin_tracking_ref_is_valid() -> None:
    snapshot = frozen_snapshot_v1()
    receipt = validate_lifecycle_v1(
        replace(
            snapshot,
            pre_run=replace(
                snapshot.pre_run,
                origin_ref="refs/remotes/origin/a",
            ),
        )
    )
    assert receipt.origin_ref == "refs/remotes/origin/a"


def test_any_record_after_absent_run_fails_closed() -> None:
    opened = development_snapshot_v1()
    hostile = replace(opened, run_consumed=None)
    with pytest.raises(LifecycleContractError, match="RUN_PREFIX_MISSING"):
        validate_lifecycle_v1(hostile)


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("run_count", 2, "COUNT_INVALID"),
        ("run_count", True, "INTEGER_REQUIRED"),
        ("allowed_run_count", 2, "COUNT_INVALID"),
        ("opened_development_bytes_before_marker", 1, "COUNT_INVALID"),
        ("rerun_authorized", True, "RERUN_AUTHORITY_FORBIDDEN"),
        ("resume_authorized", True, "RESUME_AUTHORITY_FORBIDDEN"),
        ("repair_authorized", True, "REPAIR_AUTHORITY_FORBIDDEN"),
        ("refreeze_authorized", True, "REFREEZE_AUTHORITY_FORBIDDEN"),
        ("predecessor_digest", "0" * 64, "RUN_PREDECESSOR_MISMATCH"),
        ("pre_run_commit", "5" * 40, "RUN_PRE_RUN_COMMIT_MISMATCH"),
        ("freeze_artifact_digest", "0" * 64, "RUN_FREEZE_MISMATCH"),
    ],
)
def test_run_consumption_is_exactly_once_and_irrevocable(
    field: str,
    value: object,
    code: str,
) -> None:
    snapshot = consumed_snapshot_v1()
    assert snapshot.run_consumed is not None
    hostile_run = replace(snapshot.run_consumed, **{field: value})
    with pytest.raises(LifecycleContractError, match=code):
        validate_lifecycle_v1(replace(snapshot, run_consumed=hostile_run))


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("predecessor_digest", "0" * 64, "DEVELOPMENT_PREDECESSOR_MISMATCH"),
        ("open_count", 2, "COUNT_INVALID"),
        ("opened_bytes_before_marker", 1, "COUNT_INVALID"),
        ("outcome_bytes_before_marker", 1, "COUNT_INVALID"),
    ],
)
def test_development_opening_must_follow_consumption(
    field: str,
    value: object,
    code: str,
) -> None:
    snapshot = development_snapshot_v1()
    assert snapshot.development_opening is not None
    hostile = replace(
        snapshot,
        development_opening=replace(snapshot.development_opening, **{field: value}),
    )
    with pytest.raises(LifecycleContractError, match=code):
        validate_lifecycle_v1(hostile)


def test_passed_candidate_requires_opened_development() -> None:
    candidate = candidate_snapshot_v1().candidate_seal
    assert candidate is not None
    consumed = consumed_snapshot_v1()
    prefix = validate_lifecycle_v1(consumed)
    assert prefix.run_record_digest is not None
    hostile_candidate = replace(
        candidate,
        predecessor_digest=prefix.run_record_digest,
        development_open_count=0,
    )
    with pytest.raises(LifecycleContractError, match="DEVELOPMENT_PASS_WITHOUT_OPEN"):
        validate_lifecycle_v1(replace(consumed, candidate_seal=hostile_candidate))


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("predecessor_digest", "0" * 64, "CANDIDATE_PREDECESSOR_MISMATCH"),
        ("fallback_authorized", True, "CANDIDATE_FALLBACK_FORBIDDEN"),
        ("holdout_eligible", False, "ELIGIBLE_CANDIDATE_INCOMPLETE"),
        ("candidate_id", None, "ELIGIBLE_CANDIDATE_INCOMPLETE"),
        ("candidate_artifact_digest", None, "ELIGIBLE_CANDIDATE_INCOMPLETE"),
        ("frozen_parameters_digest", None, "ELIGIBLE_CANDIDATE_INCOMPLETE"),
        ("development_open_count", 0, "COUNT_INVALID"),
    ],
)
def test_candidate_seal_fails_closed(
    field: str,
    value: object,
    code: str,
) -> None:
    snapshot = candidate_snapshot_v1()
    assert snapshot.candidate_seal is not None
    hostile = replace(
        snapshot,
        candidate_seal=replace(snapshot.candidate_seal, **{field: value}),
    )
    with pytest.raises(LifecycleContractError, match=code):
        validate_lifecycle_v1(hostile)


def test_failed_candidate_must_be_null_and_ineligible() -> None:
    valid = _failed_candidate_snapshot()
    assert valid.candidate_seal is not None
    hostile = replace(
        valid,
        candidate_seal=replace(
            valid.candidate_seal,
            candidate_id="fallback",
            candidate_artifact_digest=_sha("fallback"),
            frozen_parameters_digest=_sha("fallback-parameters"),
        ),
    )
    with pytest.raises(LifecycleContractError, match="NULL_CANDIDATE_REQUIRED"):
        validate_lifecycle_v1(hostile)


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("predecessor_digest", "0" * 64, "HOLDOUT_PREDECESSOR_MISMATCH"),
        ("candidate_seal_digest", "0" * 64, "HOLDOUT_CANDIDATE_SEAL_MISMATCH"),
        ("candidate_id", "trial-beta", "HOLDOUT_CANDIDATE_SUBSTITUTION"),
        ("candidate_artifact_digest", "0" * 64, "HOLDOUT_CANDIDATE_SUBSTITUTION"),
        ("open_count", 2, "COUNT_INVALID"),
        ("candidate_count", 2, "COUNT_INVALID"),
        ("opened_bytes_before_marker", 1, "COUNT_INVALID"),
        ("feedback_count_before_marker", 1, "COUNT_INVALID"),
        ("fallback_used", True, "HOLDOUT_FALLBACK_FORBIDDEN"),
    ],
)
def test_holdout_opening_is_champion_only_and_once(
    field: str,
    value: object,
    code: str,
) -> None:
    snapshot = holdout_snapshot_v1()
    assert snapshot.holdout_opening is not None
    hostile = replace(
        snapshot,
        holdout_opening=replace(snapshot.holdout_opening, **{field: value}),
    )
    with pytest.raises(LifecycleContractError, match=code):
        validate_lifecycle_v1(hostile)


def test_holdout_after_failed_development_is_forbidden() -> None:
    snapshot = _failed_candidate_snapshot()
    receipt = validate_lifecycle_v1(snapshot)
    assert receipt.run_id is not None
    assert receipt.candidate_seal_digest is not None
    holdout = HoldoutOpeningV1(
        schema=dq9.HOLDOUT_SCHEMA_V1,
        lifecycle_id=snapshot.lifecycle_id,
        run_id=receipt.run_id,
        predecessor_digest=receipt.candidate_seal_digest,
        marker_artifact_digest=_sha("invalid-holdout-marker"),
        partition_digest=_sha("invalid-holdout-partition"),
        candidate_seal_digest=receipt.candidate_seal_digest,
        candidate_id="fallback",
        candidate_artifact_digest=_sha("fallback"),
        open_count=1,
        candidate_count=1,
        opened_bytes_before_marker=0,
        feedback_count_before_marker=0,
        fallback_used=False,
    )
    with pytest.raises(LifecycleContractError, match="HOLDOUT_AFTER_FAILED_DEVELOPMENT"):
        validate_lifecycle_v1(replace(snapshot, holdout_opening=holdout))


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("predecessor_digest", "0" * 64, "TERMINAL_PREDECESSOR_MISMATCH"),
        ("candidate_seal_digest", "0" * 64, "TERMINAL_CANDIDATE_SEAL_MISMATCH"),
        ("pre_run_commit", "5" * 40, "TERMINAL_PRE_RUN_COMMIT_MISMATCH"),
        ("pre_run_tree", "5" * 40, "TERMINAL_PRE_RUN_TREE_MISMATCH"),
        ("freeze_artifact_digest", "0" * 64, "TERMINAL_FREEZE_MISMATCH"),
        ("run_count", 2, "COUNT_INVALID"),
        ("development_open_count", 0, "COUNT_INVALID"),
        ("holdout_open_count", 0, "COUNT_INVALID"),
        ("terminal_count", 2, "COUNT_INVALID"),
        ("authority", "CAPITAL", "LITERAL_MISMATCH"),
        ("rerun_authorized", True, "RERUN_AUTHORITY_FORBIDDEN"),
        ("resume_authorized", True, "RESUME_AUTHORITY_FORBIDDEN"),
        ("repair_authorized", True, "REPAIR_AUTHORITY_FORBIDDEN"),
        ("refreeze_authorized", True, "REFREEZE_AUTHORITY_FORBIDDEN"),
        ("successor_authorized", True, "TERMINAL_SUCCESSOR_FORBIDDEN"),
    ],
)
def test_terminal_result_is_absorbing_and_exact(
    field: str,
    value: object,
    code: str,
) -> None:
    snapshot = known_answer_snapshot_v1()
    assert snapshot.terminal_result is not None
    hostile = replace(
        snapshot,
        terminal_result=replace(snapshot.terminal_result, **{field: value}),
    )
    with pytest.raises(LifecycleContractError, match=code):
        validate_lifecycle_v1(hostile)


def test_go_requires_opened_holdout() -> None:
    candidate = candidate_snapshot_v1()
    hostile = _terminal_from_candidate(candidate, verdict=TerminalVerdict.GO)
    with pytest.raises(LifecycleContractError, match="GO_WITHOUT_HOLDOUT"):
        validate_lifecycle_v1(hostile)


def test_unmeasured_development_cannot_claim_no_go() -> None:
    candidate = _null_candidate_snapshot(development_opened=True)
    hostile = _terminal_from_candidate(candidate, verdict=TerminalVerdict.NO_GO)
    with pytest.raises(
        LifecycleContractError,
        match="UNMEASURED_DISPOSITION_VERDICT_MISMATCH",
    ):
        validate_lifecycle_v1(hostile)


@pytest.mark.parametrize(
    "snapshot",
    [
        known_answer_snapshot_v1(),
        _terminal_from_candidate(
            candidate_snapshot_v1(),
            verdict=TerminalVerdict.UNMEASURED,
        ),
    ],
)
def test_unmeasured_verdict_requires_null_candidate_and_no_holdout(
    snapshot: dq9.LifecycleSnapshotV1,
) -> None:
    assert snapshot.terminal_result is not None
    hostile = replace(
        snapshot,
        terminal_result=replace(
            snapshot.terminal_result,
            verdict=TerminalVerdict.UNMEASURED,
        ),
    )
    with pytest.raises(
        LifecycleContractError,
        match="UNMEASURED_VERDICT_REQUIRES_NULL_CANDIDATE",
    ):
        validate_lifecycle_v1(hostile)


def test_string_subclasses_cannot_forge_bindings_or_authority() -> None:
    class EqualityForgingString(str):
        def __eq__(self, other: object) -> bool:
            return True

        def __ne__(self, other: object) -> bool:
            return False

    consumed = consumed_snapshot_v1()
    assert consumed.run_consumed is not None
    hostile_run = replace(
        consumed.run_consumed,
        predecessor_digest=EqualityForgingString("0" * 64),
    )
    with pytest.raises(LifecycleContractError, match="STRING_REQUIRED"):
        validate_lifecycle_v1(replace(consumed, run_consumed=hostile_run))

    terminal = known_answer_snapshot_v1()
    assert terminal.terminal_result is not None
    hostile_terminal = replace(
        terminal.terminal_result,
        authority=EqualityForgingString("CAPITAL"),
    )
    with pytest.raises(LifecycleContractError, match="STRING_REQUIRED"):
        validate_lifecycle_v1(replace(terminal, terminal_result=hostile_terminal))


def test_record_and_snapshot_subclasses_are_rejected_without_hooks() -> None:
    effects: list[str] = []

    class EffectfulRun(dq9.RunConsumedV1):
        def as_dict(self) -> dict[str, object]:
            effects.append("run-as-dict")
            return {}

    class EffectfulSnapshot(dq9.LifecycleSnapshotV1):
        def as_dict(self) -> dict[str, object]:
            effects.append("snapshot-as-dict")
            return {}

    snapshot = consumed_snapshot_v1()
    assert snapshot.run_consumed is not None
    hostile_run = EffectfulRun(
        **{
            field.name: getattr(snapshot.run_consumed, field.name)
            for field in fields(snapshot.run_consumed)
        }
    )
    with pytest.raises(LifecycleContractError, match="RUN_RECORD_INVALID"):
        validate_lifecycle_v1(replace(snapshot, run_consumed=hostile_run))
    assert effects == []

    hostile_snapshot = EffectfulSnapshot(
        **{field.name: getattr(snapshot, field.name) for field in fields(snapshot)}
    )
    with pytest.raises(LifecycleContractError, match="SNAPSHOT_TYPE_INVALID"):
        validate_lifecycle_v1(hostile_snapshot)
    assert effects == []


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (
            b'{"schema":"a","schema":"b"}',
            "JSON_DUPLICATE_KEY",
        ),
        (b'{"value":NaN}', "JSON_NONFINITE_NUMBER"),
        (b'{"value":Infinity}', "JSON_NONFINITE_NUMBER"),
        (b'{"value":1.5}', "JSON_FLOAT_FORBIDDEN"),
        (b"\xef\xbb\xbf{}", "JSON_BOM_FORBIDDEN"),
        (b"[]", "OBJECT_REQUIRED"),
        (b"{} {}", "JSON_SYNTAX_INVALID"),
        (b'{"value":' + b"9" * 10_000 + b"}", "JSON_SYNTAX_INVALID"),
        (b"\xff", "JSON_UTF8_INVALID"),
    ],
)
def test_strict_json_boundary_rejects_ambiguous_inputs(payload: bytes, code: str) -> None:
    with pytest.raises(LifecycleContractError, match=code):
        parse_lifecycle_snapshot_v1(payload)


def test_json_unknown_field_and_bool_as_integer_fail_closed() -> None:
    document = known_answer_snapshot_v1().as_dict()
    document["unexpected"] = True
    with pytest.raises(LifecycleContractError, match="FIELD_SET_INVALID"):
        parse_lifecycle_snapshot_v1(json.dumps(document).encode("utf-8"))

    document = known_answer_snapshot_v1().as_dict()
    run = document["runConsumed"]
    assert isinstance(run, dict)
    run["runCount"] = True
    with pytest.raises(LifecycleContractError, match="INTEGER_REQUIRED"):
        parse_lifecycle_snapshot_v1(json.dumps(document).encode("utf-8"))


def test_json_size_limit_fails_before_parse() -> None:
    with pytest.raises(LifecycleContractError, match="JSON_SIZE_INVALID"):
        parse_lifecycle_snapshot_v1(b"{" + b" " * 131_072 + b"}")


def test_validator_core_has_no_effectful_dependencies() -> None:
    source_path = Path(__file__).with_name("validator.py")
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    forbidden_modules = {
        "datetime",
        "os",
        "pathlib",
        "random",
        "requests",
        "secrets",
        "socket",
        "subprocess",
        "time",
        "urllib",
    }
    forbidden_calls = {"__import__", "eval", "exec", "open"}
    imported: set[str] = set()
    called: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported.add(node.module.split(".", 1)[0])
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            called.add(node.func.id)
    assert imported.isdisjoint(forbidden_modules)
    assert called.isdisjoint(forbidden_calls)
