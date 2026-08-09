"""Hostile deterministic tests for the DQ-14 replay validator."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import replace

import pytest
from research.dq14.validator import (
    AUTHORITY_NONE,
    EVENT_GENESIS_SHA256,
    MAX_ARCHIVES,
    MAX_BYTE_COUNT,
    MAX_EVENTS,
    MAX_MEMBERS,
    PROOF_LIMITATION_V1,
    AccessEventV1,
    AccessStage,
    ArchiveInventoryV1,
    EventKind,
    HoldoutGate,
    HoldoutState,
    InventoryV1,
    MemberInventoryV1,
    PreRunSealV1,
    ReplayValidationError,
    SourceRole,
    SourceScopeV1,
    TerminalClaimV1,
    VerifierClaimV1,
    build_access_event_v1,
    build_terminal_claim_v1,
    build_verifier_claim_v1,
    canonical_json_bytes_v1,
    derive_source_scope_v1,
    freeze_pre_run_v1,
    parse_canonical_json_v1,
    projection_v1,
    validate_replay_v1,
)

PROTOCOL_SHA256 = "1" * 64
VALIDATOR_SHA256 = "2" * 64
RESULT_SHA256 = "3" * 64
DEV_ARCHIVE_SHA256 = "4" * 64
DEV_MEMBER_ZERO_SHA256 = "5" * 64
DEV_MEMBER_ONE_SHA256 = "6" * 64
HOLDOUT_ARCHIVE_SHA256 = "7" * 64
HOLDOUT_MEMBER_SHA256 = "8" * 64
OTHER_SHA256 = "9" * 64


def _member(
    member_id: str,
    ordinal: int,
    member_name: str,
    byte_count: int,
    content_sha256: str,
) -> MemberInventoryV1:
    return MemberInventoryV1(
        member_id=member_id,
        ordinal=ordinal,
        member_name=member_name,
        byte_count=byte_count,
        content_sha256=content_sha256,
    )


def _archives(*, reverse_members: bool = False) -> tuple[ArchiveInventoryV1, ...]:
    development_members: tuple[MemberInventoryV1, ...] = (
        _member("dev-member-0", 0, "samples/repeated.bin", 11, DEV_MEMBER_ZERO_SHA256),
        _member("dev-member-1", 1, "samples/repeated.bin", 13, DEV_MEMBER_ONE_SHA256),
    )
    if reverse_members:
        development_members = tuple(reversed(development_members))
    development = ArchiveInventoryV1(
        archive_id="dev-archive",
        source_ref="sources/development.bundle",
        role=SourceRole.DEVELOPMENT,
        byte_count=101,
        content_sha256=DEV_ARCHIVE_SHA256,
        members=development_members,
    )
    holdout = ArchiveInventoryV1(
        archive_id="holdout-archive",
        source_ref="sources/holdout.bundle",
        role=SourceRole.HOLDOUT,
        byte_count=103,
        content_sha256=HOLDOUT_ARCHIVE_SHA256,
        members=(
            _member(
                "holdout-member-0",
                0,
                "sealed/evaluation.bin",
                17,
                HOLDOUT_MEMBER_SHA256,
            ),
        ),
    )
    return development, holdout


def _inventory(*, permuted: bool = False, holdout: bool = True) -> InventoryV1:
    archives = _archives(reverse_members=permuted)
    if not holdout:
        archives = (archives[0],)
    elif permuted:
        archives = tuple(reversed(archives))
    verifier_ids = (
        ("review-beta", "review-alpha")
        if not permuted
        else (
            "review-alpha",
            "review-beta",
        )
    )
    return InventoryV1(
        run_id="synthetic-run",
        protocol_sha256=PROTOCOL_SHA256,
        validator_source_sha256=VALIDATOR_SHA256,
        required_verifier_ids=verifier_ids,
        archives=archives,
    )


def _append(
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: list[AccessEventV1],
    kind: EventKind,
    *,
    access_id: str = "access-main",
    archive_id: str = "dev-archive",
    member_id: str | None = None,
    observed_byte_count: int | None = None,
    observed_sha256: str | None = None,
) -> AccessEventV1:
    event = build_access_event_v1(
        inventory=inventory,
        seal=seal,
        previous_event=events[-1] if events else None,
        kind=kind,
        access_id=access_id,
        archive_id=archive_id,
        member_id=member_id,
        observed_byte_count=observed_byte_count,
        observed_sha256=observed_sha256,
    )
    events.append(event)
    return event


def _open_archive(
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: list[AccessEventV1],
    *,
    access_id: str = "access-main",
    archive_id: str = "dev-archive",
    byte_count: int = 101,
    content_sha256: str = DEV_ARCHIVE_SHA256,
) -> None:
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_ATTEMPTED,
        access_id=access_id,
        archive_id=archive_id,
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.OPENED,
        access_id=access_id,
        archive_id=archive_id,
        observed_byte_count=byte_count,
        observed_sha256=content_sha256,
    )


def _complete_member_read(
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: list[AccessEventV1],
    *,
    access_id: str = "access-main",
    archive_id: str = "dev-archive",
    member_id: str = "dev-member-0",
    byte_count: int = 11,
    content_sha256: str = DEV_MEMBER_ZERO_SHA256,
) -> None:
    for kind, observed in (
        (EventKind.DECOMPRESS_ATTEMPTED, False),
        (EventKind.DECOMPRESSED, True),
        (EventKind.READ_ATTEMPTED, False),
        (EventKind.READ_COMPLETE, True),
    ):
        _append(
            inventory,
            seal,
            events,
            kind,
            access_id=access_id,
            archive_id=archive_id,
            member_id=member_id,
            observed_byte_count=byte_count if observed else None,
            observed_sha256=content_sha256 if observed else None,
        )


def _development_read() -> tuple[
    InventoryV1, PreRunSealV1, tuple[AccessEventV1, ...], SourceScopeV1
]:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _complete_member_read(inventory, seal, events)
    ledger = tuple(events)
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=ledger)
    return inventory, seal, ledger, scope


def _terminal(
    inventory: InventoryV1,
    seal: PreRunSealV1,
    scope: SourceScopeV1,
) -> TerminalClaimV1:
    return build_terminal_claim_v1(
        inventory=inventory,
        seal=seal,
        claimed_scope=scope,
        result_core_sha256=RESULT_SHA256,
    )


def _verifiers(
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: Iterable[AccessEventV1],
    scope: SourceScopeV1,
    terminal: TerminalClaimV1,
) -> tuple[VerifierClaimV1, ...]:
    ledger = tuple(events)
    return tuple(
        build_verifier_claim_v1(
            verifier_id=verifier_id,
            inventory=inventory,
            seal=seal,
            events=ledger,
            claimed_scope=scope,
            terminal_claim=terminal,
        )
        for verifier_id in inventory.required_verifier_ids
    )


def _assert_error(code: str, operation: Callable[[], object]) -> None:
    with pytest.raises(ReplayValidationError) as captured:
        operation()
    assert captured.value.code == code


def _source_stage(scope: SourceScopeV1, source_id: str) -> AccessStage:
    return next(state.stage for state in scope.source_states if state.source_id == source_id)


def _source_failed(scope: SourceScopeV1, source_id: str) -> bool:
    return next(state.failed for state in scope.source_states if state.source_id == source_id)


def test_happy_empty_replay_is_exact_and_no_authority() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=())
    terminal = _terminal(inventory, seal, scope)
    receipt = validate_replay_v1(
        inventory=inventory,
        seal=seal,
        events=(),
        terminal_claim=terminal,
        verifier_claims=_verifiers(inventory, seal, (), scope, terminal),
    )
    assert receipt.event_count == 0
    assert receipt.event_tip_sha256 == EVENT_GENESIS_SHA256
    assert receipt.holdout_state is HoldoutState.UNOPENED
    assert receipt.holdout_gate is HoldoutGate.UNOPENED
    assert receipt.authority == AUTHORITY_NONE
    assert receipt.proof_limitation == PROOF_LIMITATION_V1
    assert receipt.failure_count == 0
    assert receipt.holdout_failure_count == 0


def test_receipt_rejects_forged_authority_and_digest() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    receipt = validate_replay_v1(
        inventory=inventory,
        seal=seal,
        events=events,
        terminal_claim=terminal,
        verifier_claims=_verifiers(inventory, seal, events, scope, terminal),
    )
    _assert_error(
        "SCHEMA_INVALID",
        lambda: replace(receipt, authority="MONEY"),
    )
    _assert_error(
        "RECEIPT_DIGEST_MISMATCH",
        lambda: replace(receipt, receipt_sha256=OTHER_SHA256),
    )
    _assert_error(
        "CARDINALITY_INVALID",
        lambda: replace(receipt, event_count=MAX_EVENTS + 1),
    )


def test_development_read_leaves_holdout_truthfully_unopened() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    receipt = validate_replay_v1(
        inventory=inventory,
        seal=seal,
        events=events,
        terminal_claim=terminal,
        verifier_claims=_verifiers(inventory, seal, events, scope, terminal),
    )
    assert receipt.holdout_state is HoldoutState.UNOPENED
    assert receipt.holdout_gate is HoldoutGate.UNOPENED
    assert _source_stage(scope, "dev-archive") is AccessStage.READ_COMPLETE
    assert _source_stage(scope, "dev-member-0") is AccessStage.READ_COMPLETE
    assert _source_stage(scope, "holdout-archive") is AccessStage.UNOPENED


def test_duplicate_member_names_are_distinguished_by_ordinal_identity() -> None:
    inventory, _, _, scope = _development_read()
    development = next(
        archive for archive in inventory.archives if archive.archive_id == "dev-archive"
    )
    assert development.members[0].member_name == development.members[1].member_name
    assert development.members[0].ordinal == 0
    assert development.members[1].ordinal == 1
    assert _source_stage(scope, "dev-member-0") is AccessStage.READ_COMPLETE
    assert _source_stage(scope, "dev-member-1") is AccessStage.UNOPENED


def test_member_stage_and_read_success_survive_later_failed_access() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(
        inventory,
        seal,
        events,
        access_id="holdout-first",
        archive_id="holdout-archive",
        byte_count=103,
        content_sha256=HOLDOUT_ARCHIVE_SHA256,
    )
    _complete_member_read(
        inventory,
        seal,
        events,
        access_id="holdout-first",
        archive_id="holdout-archive",
        member_id="holdout-member-0",
        byte_count=17,
        content_sha256=HOLDOUT_MEMBER_SHA256,
    )
    _open_archive(
        inventory,
        seal,
        events,
        access_id="holdout-retry",
        archive_id="holdout-archive",
        byte_count=103,
        content_sha256=HOLDOUT_ARCHIVE_SHA256,
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        access_id="holdout-retry",
        archive_id="holdout-archive",
        member_id="holdout-member-0",
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_FAILED,
        access_id="holdout-retry",
        archive_id="holdout-archive",
        member_id="holdout-member-0",
    )
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=events)
    assert _source_stage(scope, "holdout-archive") is AccessStage.READ_COMPLETE
    assert _source_stage(scope, "holdout-member-0") is AccessStage.READ_COMPLETE
    assert _source_failed(scope, "holdout-archive")
    assert _source_failed(scope, "holdout-member-0")
    assert scope.holdout_state is HoldoutState.READ_COMPLETE
    assert scope.holdout_gate is HoldoutGate.ACCESSED_NON_GREEN
    assert scope.failure_count == 2
    assert scope.holdout_failure_count == 2
    terminal = _terminal(inventory, seal, scope)
    receipt = validate_replay_v1(
        inventory=inventory,
        seal=seal,
        events=events,
        terminal_claim=terminal,
        verifier_claims=_verifiers(inventory, seal, events, scope, terminal),
    )
    assert receipt.holdout_state is HoldoutState.READ_COMPLETE
    assert receipt.holdout_failure_count == 2


def test_holdout_open_attempt_is_non_green() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_ATTEMPTED,
        access_id="holdout-access",
        archive_id="holdout-archive",
    )
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=events)
    assert scope.holdout_state is HoldoutState.OPEN_ATTEMPTED
    assert scope.holdout_gate is HoldoutGate.ACCESSED_NON_GREEN


def test_holdout_open_failure_defeats_unopened() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_ATTEMPTED,
        access_id="holdout-access",
        archive_id="holdout-archive",
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_FAILED,
        access_id="holdout-access",
        archive_id="holdout-archive",
    )
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=events)
    assert scope.holdout_state is HoldoutState.OPEN_ATTEMPTED
    assert scope.holdout_gate is HoldoutGate.ACCESSED_NON_GREEN
    assert scope.holdout_failure_count == 1
    assert _source_failed(scope, "holdout-archive")


def test_no_holdout_inventory_projects_not_present() -> None:
    inventory = _inventory(holdout=False)
    seal = freeze_pre_run_v1(inventory)
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=())
    assert scope.holdout_state is HoldoutState.NOT_PRESENT
    assert scope.holdout_gate is HoldoutGate.NOT_PRESENT


def test_terminal_cannot_claim_opened_when_ledger_is_empty() -> None:
    inventory, seal, events, opened_scope = _development_read()
    empty_scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=())
    false_scope = replace(
        opened_scope,
        event_count=0,
        event_tip_sha256=EVENT_GENESIS_SHA256,
    )
    terminal = _terminal(inventory, seal, false_scope)
    _assert_error(
        "TERMINAL_SOURCE_SCOPE_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=(),
            terminal_claim=terminal,
            verifier_claims=_verifiers(
                inventory, seal, events, opened_scope, _terminal(inventory, seal, opened_scope)
            ),
        ),
    )
    assert empty_scope.source_scope_sha256 != opened_scope.source_scope_sha256


def test_copied_pre_run_unopened_scope_after_read_fails_before_verifier_check() -> None:
    inventory, seal, events, actual_scope = _development_read()
    pre_run_scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=())
    copied_scope = replace(
        pre_run_scope,
        event_count=actual_scope.event_count,
        event_tip_sha256=actual_scope.event_tip_sha256,
    )
    false_terminal = _terminal(inventory, seal, copied_scope)
    _assert_error(
        "TERMINAL_SOURCE_SCOPE_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=false_terminal,
            verifier_claims=(),
        ),
    )


def test_appended_event_after_terminal_claim_fails_tip_binding() -> None:
    inventory, seal, events, full_scope = _development_read()
    shorter_events = events[:-1]
    shorter_scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=shorter_events)
    terminal = _terminal(inventory, seal, shorter_scope)
    _assert_error(
        "TERMINAL_EVENT_TIP_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=_verifiers(
                inventory, seal, events, full_scope, _terminal(inventory, seal, full_scope)
            ),
        ),
    )


def test_terminal_digest_mutation_fails_closed() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = replace(_terminal(inventory, seal, scope), terminal_claim_sha256=OTHER_SHA256)
    _assert_error(
        "TERMINAL_CLAIM_DIGEST_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=(),
        ),
    )


def test_event_sequence_gap_fails() -> None:
    inventory, seal, events, _ = _development_read()
    mutated = (replace(events[0], sequence=2), *events[1:])
    _assert_error(
        "EVENT_SEQUENCE_INVALID",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=mutated),
    )


def test_event_reordering_fails_sequence() -> None:
    inventory, seal, events, _ = _development_read()
    reordered = (events[1], events[0], *events[2:])
    _assert_error(
        "EVENT_SEQUENCE_INVALID",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=reordered),
    )


def test_event_chain_mutation_fails() -> None:
    inventory, seal, events, _ = _development_read()
    mutated = (events[0], replace(events[1], prior_event_sha256=OTHER_SHA256), *events[2:])
    _assert_error(
        "EVENT_CHAIN_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=mutated),
    )


def test_event_body_digest_mutation_fails() -> None:
    inventory, seal, events, _ = _development_read()
    mutated = (replace(events[0], event_sha256=OTHER_SHA256), *events[1:])
    _assert_error(
        "EVENT_DIGEST_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=mutated),
    )


def test_event_bound_to_other_run_fails() -> None:
    inventory, seal, events, _ = _development_read()
    mutated = (replace(events[0], run_id="other-run"), *events[1:])
    _assert_error(
        "EVENT_SEAL_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=mutated),
    )


def test_opened_without_attempt_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(
        inventory,
        seal,
        events,
        EventKind.OPENED,
        observed_byte_count=101,
        observed_sha256=DEV_ARCHIVE_SHA256,
    )
    _assert_error(
        "INVALID_ACCESS_TRANSITION",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_decompress_attempt_before_open_success_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(inventory, seal, events, EventKind.OPEN_ATTEMPTED)
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        member_id="dev-member-0",
    )
    _assert_error(
        "INVALID_ACCESS_TRANSITION",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_decompressed_without_attempt_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESSED,
        member_id="dev-member-0",
        observed_byte_count=11,
        observed_sha256=DEV_MEMBER_ZERO_SHA256,
    )
    _assert_error(
        "INVALID_ACCESS_TRANSITION",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_read_attempt_before_decompression_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.READ_ATTEMPTED,
        member_id="dev-member-0",
    )
    _assert_error(
        "INVALID_ACCESS_TRANSITION",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_read_complete_without_attempt_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        member_id="dev-member-0",
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESSED,
        member_id="dev-member-0",
        observed_byte_count=11,
        observed_sha256=DEV_MEMBER_ZERO_SHA256,
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.READ_COMPLETE,
        member_id="dev-member-0",
        observed_byte_count=11,
        observed_sha256=DEV_MEMBER_ZERO_SHA256,
    )
    _assert_error(
        "INVALID_ACCESS_TRANSITION",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_access_id_cannot_be_reused_for_second_attempt() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(inventory, seal, events, EventKind.OPEN_ATTEMPTED)
    _append(inventory, seal, events, EventKind.OPEN_ATTEMPTED)
    _assert_error(
        "ACCESS_ID_REUSED",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_duplicate_open_success_fails_transition() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.OPENED,
        observed_byte_count=101,
        observed_sha256=DEV_ARCHIVE_SHA256,
    )
    _assert_error(
        "INVALID_ACCESS_TRANSITION",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_access_id_cannot_change_archive() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(inventory, seal, events, EventKind.OPEN_ATTEMPTED)
    _append(
        inventory,
        seal,
        events,
        EventKind.OPENED,
        archive_id="holdout-archive",
        observed_byte_count=103,
        observed_sha256=HOLDOUT_ARCHIVE_SHA256,
    )
    _assert_error(
        "ACCESS_ARCHIVE_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_open_failure_is_absorbing() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(inventory, seal, events, EventKind.OPEN_ATTEMPTED)
    _append(inventory, seal, events, EventKind.OPEN_FAILED)
    _append(
        inventory,
        seal,
        events,
        EventKind.OPENED,
        observed_byte_count=101,
        observed_sha256=DEV_ARCHIVE_SHA256,
    )
    _assert_error(
        "ACCESS_FAILED_ABSORBING",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_member_failure_is_absorbing_for_access() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        member_id="dev-member-0",
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_FAILED,
        member_id="dev-member-0",
    )
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        member_id="dev-member-1",
    )
    _assert_error(
        "ACCESS_FAILED_ABSORBING",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_archive_identity_drift_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(
        inventory,
        seal,
        events,
        byte_count=102,
        content_sha256=DEV_ARCHIVE_SHA256,
    )
    _assert_error(
        "ARCHIVE_IDENTITY_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


@pytest.mark.parametrize(
    ("kind", "byte_count", "content_sha256"),
    [
        (EventKind.DECOMPRESSED, 12, DEV_MEMBER_ZERO_SHA256),
        (EventKind.DECOMPRESSED, 11, OTHER_SHA256),
        (EventKind.READ_COMPLETE, 12, DEV_MEMBER_ZERO_SHA256),
        (EventKind.READ_COMPLETE, 11, OTHER_SHA256),
    ],
)
def test_member_identity_drift_fails(
    kind: EventKind,
    byte_count: int,
    content_sha256: str,
) -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        member_id="dev-member-0",
    )
    if kind is EventKind.READ_COMPLETE:
        _append(
            inventory,
            seal,
            events,
            EventKind.DECOMPRESSED,
            member_id="dev-member-0",
            observed_byte_count=11,
            observed_sha256=DEV_MEMBER_ZERO_SHA256,
        )
        _append(
            inventory,
            seal,
            events,
            EventKind.READ_ATTEMPTED,
            member_id="dev-member-0",
        )
    _append(
        inventory,
        seal,
        events,
        kind,
        member_id="dev-member-0",
        observed_byte_count=byte_count,
        observed_sha256=content_sha256,
    )
    _assert_error(
        "MEMBER_IDENTITY_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_unknown_archive_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_ATTEMPTED,
        archive_id="unknown-archive",
    )
    _assert_error(
        "UNKNOWN_ARCHIVE",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_unknown_member_fails() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _open_archive(inventory, seal, events)
    _append(
        inventory,
        seal,
        events,
        EventKind.DECOMPRESS_ATTEMPTED,
        member_id="unknown-member",
    )
    _assert_error(
        "UNKNOWN_MEMBER",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_success_without_observed_identity_fails_shape() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(inventory, seal, events, EventKind.OPEN_ATTEMPTED)
    _append(inventory, seal, events, EventKind.OPENED)
    _assert_error(
        "EVENT_SHAPE_INVALID",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_attempt_with_observed_identity_fails_shape() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_ATTEMPTED,
        observed_byte_count=101,
        observed_sha256=DEV_ARCHIVE_SHA256,
    )
    _assert_error(
        "EVENT_SHAPE_INVALID",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_open_event_naming_member_fails_shape() -> None:
    inventory = _inventory()
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    _append(
        inventory,
        seal,
        events,
        EventKind.OPEN_ATTEMPTED,
        member_id="dev-member-0",
    )
    _assert_error(
        "EVENT_SHAPE_INVALID",
        lambda: derive_source_scope_v1(inventory=inventory, seal=seal, events=events),
    )


def test_pre_run_seal_from_other_inventory_fails() -> None:
    inventory = _inventory()
    other = replace(inventory, run_id="other-run")
    wrong_seal = freeze_pre_run_v1(other)
    _assert_error(
        "PRE_RUN_SEAL_MISMATCH",
        lambda: derive_source_scope_v1(inventory=inventory, seal=wrong_seal, events=()),
    )


def test_missing_verifier_fails_exact_set() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    claims = _verifiers(inventory, seal, events, scope, terminal)
    _assert_error(
        "VERIFIER_SET_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=claims[:-1],
        ),
    )


def test_duplicate_verifier_fails_exact_set() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    claims = _verifiers(inventory, seal, events, scope, terminal)
    _assert_error(
        "VERIFIER_SET_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=(claims[0], claims[0]),
        ),
    )


def test_unrequired_verifier_fails_exact_set() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    claims = list(_verifiers(inventory, seal, events, scope, terminal))
    claims[0] = build_verifier_claim_v1(
        verifier_id="review-unlisted",
        inventory=inventory,
        seal=seal,
        events=events,
        claimed_scope=scope,
        terminal_claim=terminal,
    )
    _assert_error(
        "VERIFIER_SET_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=claims,
        ),
    )


def test_stale_verifier_binding_fails() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    claims = list(_verifiers(inventory, seal, events, scope, terminal))
    claims[0] = replace(claims[0], event_count=0)
    _assert_error(
        "VERIFIER_CLAIM_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=claims,
        ),
    )


def test_verifier_claim_bound_to_prior_terminal_fails() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    prior_scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=events[:-1])
    prior_terminal = _terminal(inventory, seal, prior_scope)
    stale = build_verifier_claim_v1(
        verifier_id=inventory.required_verifier_ids[0],
        inventory=inventory,
        seal=seal,
        events=events[:-1],
        claimed_scope=prior_scope,
        terminal_claim=prior_terminal,
    )
    claims = list(_verifiers(inventory, seal, events, scope, terminal))
    claims[0] = stale
    _assert_error(
        "VERIFIER_CLAIM_MISMATCH",
        lambda: validate_replay_v1(
            inventory=inventory,
            seal=seal,
            events=events,
            terminal_claim=terminal,
            verifier_claims=claims,
        ),
    )


def test_canonical_json_rejects_duplicate_keys() -> None:
    _assert_error(
        "CANONICAL_JSON_INVALID",
        lambda: parse_canonical_json_v1(b'{"key":1,"key":2}'),
    )


@pytest.mark.parametrize(
    "data",
    [
        b'{"b":1, "a":2}',
        b'{"b":1,"a":2}',
    ],
)
def test_canonical_json_rejects_noncanonical_bytes(data: bytes) -> None:
    _assert_error("CANONICAL_JSON_INVALID", lambda: parse_canonical_json_v1(data))


@pytest.mark.parametrize("data", [b"1.0", b"1e2", b"NaN", b"Infinity"])
def test_canonical_json_rejects_floats_and_nonfinite(data: bytes) -> None:
    _assert_error("CANONICAL_JSON_INVALID", lambda: parse_canonical_json_v1(data))


def test_canonical_json_rejects_integer_beyond_bound() -> None:
    data = str(MAX_BYTE_COUNT + 1).encode("ascii")
    _assert_error("CANONICAL_JSON_INVALID", lambda: parse_canonical_json_v1(data))


def test_bool_is_not_accepted_as_inventory_integer() -> None:
    _assert_error(
        "SCHEMA_INVALID",
        lambda: MemberInventoryV1(
            member_id="member",
            ordinal=True,
            member_name="member.bin",
            byte_count=1,
            content_sha256=DEV_MEMBER_ZERO_SHA256,
        ),
    )


@pytest.mark.parametrize(
    "source_ref",
    [
        "/absolute/source.bundle",
        "C:/source.bundle",
        "sources\\source.bundle",
        "sources/../source.bundle",
        "sources//source.bundle",
        "sources/café.bundle",
    ],
)
def test_source_ref_alias_forms_fail(source_ref: str) -> None:
    _assert_error(
        "SOURCE_REF_INVALID",
        lambda: ArchiveInventoryV1(
            archive_id="archive",
            source_ref=source_ref,
            role=SourceRole.DEVELOPMENT,
            byte_count=1,
            content_sha256=DEV_ARCHIVE_SHA256,
            members=(_member("member", 0, "member.bin", 1, DEV_MEMBER_ZERO_SHA256),),
        ),
    )


def test_casefolded_source_ref_aliases_fail_inventory() -> None:
    first, _ = _archives()
    second = replace(
        first,
        archive_id="second-archive",
        source_ref=first.source_ref.upper(),
    )
    _assert_error(
        "DUPLICATE_INVENTORY_ID",
        lambda: InventoryV1(
            run_id="synthetic-run",
            protocol_sha256=PROTOCOL_SHA256,
            validator_source_sha256=VALIDATOR_SHA256,
            required_verifier_ids=("review-alpha",),
            archives=(first, second),
        ),
    )


def test_content_digest_cannot_alias_across_roles() -> None:
    development, holdout = _archives()
    archive_alias = replace(
        holdout,
        content_sha256=development.content_sha256,
    )
    _assert_error(
        "ROLE_CONTENT_ALIAS",
        lambda: InventoryV1(
            run_id="synthetic-run",
            protocol_sha256=PROTOCOL_SHA256,
            validator_source_sha256=VALIDATOR_SHA256,
            required_verifier_ids=("review-alpha",),
            archives=(development, archive_alias),
        ),
    )
    member_alias = replace(
        holdout,
        members=(
            replace(
                holdout.members[0],
                content_sha256=development.members[0].content_sha256,
            ),
        ),
    )
    _assert_error(
        "ROLE_CONTENT_ALIAS",
        lambda: InventoryV1(
            run_id="synthetic-run",
            protocol_sha256=PROTOCOL_SHA256,
            validator_source_sha256=VALIDATOR_SHA256,
            required_verifier_ids=("review-alpha",),
            archives=(development, member_alias),
        ),
    )
    cross_kind_alias = replace(
        holdout,
        content_sha256=development.members[0].content_sha256,
    )
    _assert_error(
        "ROLE_CONTENT_ALIAS",
        lambda: InventoryV1(
            run_id="synthetic-run",
            protocol_sha256=PROTOCOL_SHA256,
            validator_source_sha256=VALIDATOR_SHA256,
            required_verifier_ids=("review-alpha",),
            archives=(development, cross_kind_alias),
        ),
    )


def test_total_source_bound_fails_before_canonical_hashing() -> None:
    archives = tuple(
        ArchiveInventoryV1(
            archive_id=f"archive-{archive_index}",
            source_ref=f"sources/archive-{archive_index}.bundle",
            role=SourceRole.DEVELOPMENT,
            byte_count=1,
            content_sha256=DEV_ARCHIVE_SHA256,
            members=(
                _member(
                    f"member-{archive_index}-0",
                    0,
                    "first.bin",
                    1,
                    DEV_MEMBER_ZERO_SHA256,
                ),
                _member(
                    f"member-{archive_index}-1",
                    1,
                    "second.bin",
                    1,
                    DEV_MEMBER_ONE_SHA256,
                ),
            ),
        )
        for archive_index in range(MAX_ARCHIVES)
    )
    _assert_error(
        "CARDINALITY_INVALID",
        lambda: InventoryV1(
            run_id="bounded-run",
            protocol_sha256=PROTOCOL_SHA256,
            validator_source_sha256=VALIDATOR_SHA256,
            required_verifier_ids=("review-alpha",),
            archives=archives,
        ),
    )


def test_declared_member_bound_is_sealable() -> None:
    members = tuple(
        _member(
            f"bounded-member-{member_index}",
            member_index,
            f"entries/{member_index}.bin",
            1,
            DEV_MEMBER_ZERO_SHA256,
        )
        for member_index in range(MAX_MEMBERS)
    )
    archive = ArchiveInventoryV1(
        archive_id="bounded-archive",
        source_ref="sources/bounded.bundle",
        role=SourceRole.DEVELOPMENT,
        byte_count=1,
        content_sha256=DEV_ARCHIVE_SHA256,
        members=members,
    )
    inventory = InventoryV1(
        run_id="bounded-run",
        protocol_sha256=PROTOCOL_SHA256,
        validator_source_sha256=VALIDATOR_SHA256,
        required_verifier_ids=("review-alpha",),
        archives=(archive,),
    )
    seal = freeze_pre_run_v1(inventory)
    assert len(inventory.archives[0].members) == MAX_MEMBERS
    assert seal.event_genesis_sha256 == EVENT_GENESIS_SHA256


def test_inventory_permutation_has_identical_digest_and_projection() -> None:
    ordered = _inventory()
    permuted = _inventory(permuted=True)
    assert ordered.inventory_sha256 == permuted.inventory_sha256
    assert projection_v1(ordered) == projection_v1(permuted)
    assert ordered.archives == permuted.archives
    assert ordered.required_verifier_ids == permuted.required_verifier_ids


def test_projection_round_trips_through_canonical_json() -> None:
    inventory, seal, events, scope = _development_read()
    terminal = _terminal(inventory, seal, scope)
    verifier_claims = _verifiers(inventory, seal, events, scope, terminal)
    receipt = validate_replay_v1(
        inventory=inventory,
        seal=seal,
        events=events,
        terminal_claim=terminal,
        verifier_claims=verifier_claims,
    )
    artifacts: tuple[object, ...] = (
        inventory,
        seal,
        *events,
        scope,
        terminal,
        *verifier_claims,
        receipt,
    )
    for artifact in artifacts:
        projected = projection_v1(artifact)
        encoded = canonical_json_bytes_v1(projected)
        assert parse_canonical_json_v1(encoded) == projected


def test_projection_rejects_non_artifact() -> None:
    _assert_error("SCHEMA_INVALID", lambda: projection_v1(object()))


def test_stage_count_projection_is_complete_and_deterministic() -> None:
    _, _, _, scope = _development_read()
    assert len(scope.stage_counts) == len(SourceRole) * len(AccessStage)
    assert sum(count.count for count in scope.stage_counts) == len(scope.source_states)
    assert scope.stage_counts == tuple(
        sorted(
            scope.stage_counts,
            key=lambda item: (
                list(SourceRole).index(item.role),
                list(AccessStage).index(item.stage),
            ),
        )
    )
