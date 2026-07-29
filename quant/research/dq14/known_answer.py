"""Deterministic synthetic known answer for the DQ-14 replay contract."""

from __future__ import annotations

import hashlib

from research.dq14.validator import (
    AccessEventV1,
    ArchiveInventoryV1,
    EventKind,
    InventoryV1,
    MemberInventoryV1,
    SourceRole,
    build_access_event_v1,
    build_terminal_claim_v1,
    build_verifier_claim_v1,
    derive_source_scope_v1,
    freeze_pre_run_v1,
    validate_replay_v1,
)


def _sha256(label: str) -> str:
    return hashlib.sha256(label.encode("ascii")).hexdigest()


def known_answer_projection_v1() -> dict[str, object]:
    """Return a stable synthetic development-read/holdout-unopened projection."""

    development_member = MemberInventoryV1(
        member_id="development-bars",
        ordinal=0,
        member_name="bars.csv",
        byte_count=128,
        content_sha256=_sha256("development-member"),
    )
    holdout_member = MemberInventoryV1(
        member_id="holdout-bars",
        ordinal=0,
        member_name="bars.csv",
        byte_count=144,
        content_sha256=_sha256("holdout-member"),
    )
    development_archive = ArchiveInventoryV1(
        archive_id="development-archive",
        source_ref="synthetic/development.zip",
        role=SourceRole.DEVELOPMENT,
        byte_count=256,
        content_sha256=_sha256("development-archive"),
        members=(development_member,),
    )
    holdout_archive = ArchiveInventoryV1(
        archive_id="holdout-archive",
        source_ref="synthetic/holdout.zip",
        role=SourceRole.HOLDOUT,
        byte_count=288,
        content_sha256=_sha256("holdout-archive"),
        members=(holdout_member,),
    )
    inventory = InventoryV1(
        run_id="known-answer-run",
        protocol_sha256=_sha256("protocol"),
        validator_source_sha256=_sha256("validator-source"),
        required_verifier_ids=("known-answer-verifier",),
        archives=(holdout_archive, development_archive),
    )
    seal = freeze_pre_run_v1(inventory)
    events: list[AccessEventV1] = []
    event_specs = (
        (EventKind.OPEN_ATTEMPTED, None, None, None),
        (
            EventKind.OPENED,
            None,
            development_archive.byte_count,
            development_archive.content_sha256,
        ),
        (EventKind.DECOMPRESS_ATTEMPTED, development_member.member_id, None, None),
        (
            EventKind.DECOMPRESSED,
            development_member.member_id,
            development_member.byte_count,
            development_member.content_sha256,
        ),
        (EventKind.READ_ATTEMPTED, development_member.member_id, None, None),
        (
            EventKind.READ_COMPLETE,
            development_member.member_id,
            development_member.byte_count,
            development_member.content_sha256,
        ),
    )
    for kind, member_id, byte_count, content_sha256 in event_specs:
        event = build_access_event_v1(
            inventory=inventory,
            seal=seal,
            previous_event=events[-1] if events else None,
            kind=kind,
            access_id="development-access",
            archive_id=development_archive.archive_id,
            member_id=member_id,
            observed_byte_count=byte_count,
            observed_sha256=content_sha256,
        )
        events.append(event)
    scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=events)
    terminal = build_terminal_claim_v1(
        inventory=inventory,
        seal=seal,
        claimed_scope=scope,
        result_core_sha256=_sha256("result-core"),
    )
    verifier = build_verifier_claim_v1(
        verifier_id="known-answer-verifier",
        inventory=inventory,
        seal=seal,
        events=events,
        claimed_scope=scope,
        terminal_claim=terminal,
    )
    receipt = validate_replay_v1(
        inventory=inventory,
        seal=seal,
        events=events,
        terminal_claim=terminal,
        verifier_claims=(verifier,),
    )
    return {
        "authority": receipt.authority,
        "eventSha256s": [event.event_sha256 for event in events],
        "eventTipSha256": receipt.event_tip_sha256,
        "failureCount": receipt.failure_count,
        "holdoutGate": receipt.holdout_gate.value,
        "holdoutFailureCount": receipt.holdout_failure_count,
        "holdoutState": receipt.holdout_state.value,
        "inventorySha256": inventory.inventory_sha256,
        "receiptSha256": receipt.receipt_sha256,
        "replayEvidenceSha256": receipt.replay_evidence_sha256,
        "sealSha256": seal.seal_sha256,
        "sourceScopeSha256": scope.source_scope_sha256,
        "sourceStates": [
            {
                "archiveId": state.archive_id,
                "failed": state.failed,
                "memberId": state.member_id,
                "stage": state.stage.value,
            }
            for state in scope.source_states
        ],
        "terminalClaimSha256": terminal.terminal_claim_sha256,
        "validatorSourceSha256": inventory.validator_source_sha256,
        "verifierClaimSha256": verifier.verifier_claim_sha256,
    }
