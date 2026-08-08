from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake.contracts import (
    PACKET_ROLE_ORDER,
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    DecisionState,
    GitOidV1,
    PinnedDocumentV1,
)
from quant_edge.n3_intake.intake import evaluate_intake
from quant_edge.n3_intake.renderer import decision_to_canonical_bytes, render_fable5

_FIXTURE_DIRECTORY = Path(__file__).resolve().parent / "fixtures"
_REGISTRY_FIXTURE = "s_meta1_registry.json"
_RESULT_FIXTURES = (
    (ArtifactRole.E1, "e1_result.json"),
    (ArtifactRole.VE1, "ve1_result.json"),
    (ArtifactRole.S1C, "s1c_result.json"),
    (ArtifactRole.S1D, "s1d_result.json"),
    (ArtifactRole.S1E, "s1e_result.json"),
)
_REGISTRY_RAW_SHA256 = "bc8bb002cd87227384a10cc22404cc7561a6b633ced9d3be3e08b0d04b7f5435"
_REGISTRY_PRODUCER_COMMIT = GitOidV1("9" * 40)
_REGISTRY_PRODUCER_TREE = GitOidV1("8" * 40)


def _fixture_bytes(filename: str) -> bytes:
    return (_FIXTURE_DIRECTORY / filename).read_bytes()


def _sha256(raw: bytes) -> DigestV1:
    return DigestV1(hashlib.sha256(raw).hexdigest())


def _acceptance_sha256(raw: bytes) -> DigestV1:
    return DigestV1(hashlib.sha256(b"N3I1_ACCEPTANCE_V1\0" + raw).hexdigest())


def _pinned_document(
    *,
    role: ArtifactRole,
    filename: str,
    raw: bytes,
    producer_commit: GitOidV1,
    producer_tree: GitOidV1,
    acceptance: AcceptanceState = AcceptanceState.PENDING,
    raw_sha256: DigestV1 | None = None,
) -> PinnedDocumentV1:
    return PinnedDocumentV1(
        pin=ArtifactPinV1(
            role=role,
            raw_sha256=_sha256(raw) if raw_sha256 is None else raw_sha256,
            byte_length=len(raw),
            producer_commit=producer_commit,
            producer_tree=producer_tree,
            relative_path=f"quant/research/n3i1/fixtures/{filename}",
            acceptance=acceptance,
            acceptance_sha256=(
                _acceptance_sha256(raw) if acceptance is AcceptanceState.ACCEPTED else None
            ),
        ),
        raw=raw,
    )


def _registry_document(
    *,
    raw: bytes | None = None,
    acceptance: AcceptanceState = AcceptanceState.PENDING,
) -> PinnedDocumentV1:
    exact_raw = _fixture_bytes(_REGISTRY_FIXTURE) if raw is None else raw
    return _pinned_document(
        role=ArtifactRole.S_META1,
        filename=_REGISTRY_FIXTURE,
        raw=exact_raw,
        producer_commit=_REGISTRY_PRODUCER_COMMIT,
        producer_tree=_REGISTRY_PRODUCER_TREE,
        acceptance=acceptance,
    )


def _result_document(
    role: ArtifactRole,
    filename: str,
    *,
    raw: bytes | None = None,
    acceptance: AcceptanceState = AcceptanceState.PENDING,
) -> PinnedDocumentV1:
    exact_raw = _fixture_bytes(filename) if raw is None else raw
    body = json.loads(exact_raw)
    provenance = body["provenance"]
    return _pinned_document(
        role=role,
        filename=filename,
        raw=exact_raw,
        producer_commit=GitOidV1(provenance["producerCommit"]),
        producer_tree=GitOidV1(provenance["producerTree"]),
        acceptance=acceptance,
    )


def _fixture_packet(
    *,
    acceptance: AcceptanceState = AcceptanceState.PENDING,
) -> tuple[PinnedDocumentV1, tuple[PinnedDocumentV1, ...]]:
    return (
        _registry_document(acceptance=acceptance),
        tuple(
            _result_document(role, filename, acceptance=acceptance)
            for role, filename in _RESULT_FIXTURES
        ),
    )


def _assert_rejected_without_card(
    registry: PinnedDocumentV1,
    results: tuple[PinnedDocumentV1, ...],
    *,
    match: str,
) -> None:
    rendered_cards: list[str] = []
    with pytest.raises(ContractValueError, match=match):
        _evaluate_and_capture_card(registry, results, rendered_cards)
    assert rendered_cards == []


def _evaluate_and_capture_card(
    registry: PinnedDocumentV1,
    results: tuple[PinnedDocumentV1, ...],
    rendered_cards: list[str],
) -> None:
    decision = evaluate_intake(registry, results)
    rendered_cards.append(render_fable5(decision))


def _complete_result_bytes(filename: str, *, no_go: bool = False) -> bytes:
    body = json.loads(_fixture_bytes(filename))
    body["terminalState"] = "PASS"
    body["reasonCodes"] = []
    body["trials"]["observedCount"] = body["trials"]["declaredCount"]
    for state_name in ("multiplicityState", "pboState", "globalTestState", "dsrState"):
        body["trials"][state_name] = "PASS"
    body["holdout"] = {
        "evidenceClass": "SEALED_FORWARD",
        "lowerBound": {"state": "MEASURED", "value": 2},
        "openedAfterFreeze": True,
        "reuseCount": 1,
        "selectionInsideEvaluation": True,
        "singleUse": True,
        "state": "PASS",
    }
    body["economics"] = {
        "actualFeeState": "PASS",
        "capacityUsd": {"state": "MEASURED", "value": 2},
        "costCompleteState": "PASS",
        "makerEntryState": "PASS",
        "maxDrawdownBps": {"state": "MEASURED", "value": 500},
        "net": {"state": "MEASURED", "value": 0 if no_go else 2},
        "regimeCoverageState": "PASS",
        "stressNet": {"state": "MEASURED", "value": 2},
    }
    return canonical_json_bytes(body)


def test_pending_fixture_packet_is_deterministic_unknown() -> None:
    registry, results = _fixture_packet()

    decision = evaluate_intake(registry, results)
    reordered = evaluate_intake(registry, tuple(reversed(results)))

    assert registry.pin.raw_sha256.hexdigest == _REGISTRY_RAW_SHA256
    assert decision.status is DecisionState.UNKNOWN
    assert decision.credible_positive_count is None
    assert decision.authority == "NONE"
    assert tuple(item.role for item in decision.assessments) == PACKET_ROLE_ORDER
    assert len(decision.assessments) == 5
    assert all(item.status is DecisionState.UNKNOWN for item in decision.assessments)
    assert decision.registry_pin == registry.pin
    assert decision.result_pins == tuple(document.pin for document in results)

    machine = decision_to_canonical_bytes(decision)
    machine_body = json.loads(machine)
    fable = render_fable5(decision)
    assert machine == decision_to_canonical_bytes(decision)
    assert machine == decision_to_canonical_bytes(reordered)
    assert b'"crediblePositiveCount":null' in machine
    assert b'"authority":"NONE"' in machine
    assert machine_body["registryPin"] == {
        "acceptanceSha256": None,
        "acceptanceState": "PENDING",
        "byteLength": registry.pin.byte_length,
        "producerCommit": registry.pin.producer_commit.hexdigest,
        "producerTree": registry.pin.producer_tree.hexdigest,
        "rawSha256": registry.pin.raw_sha256.hexdigest,
        "relativePath": registry.pin.relative_path,
        "role": "S_META1",
    }
    assert machine_body["resultPins"] == [
        {
            "acceptanceSha256": None,
            "acceptanceState": "PENDING",
            "byteLength": document.pin.byte_length,
            "producerCommit": document.pin.producer_commit.hexdigest,
            "producerTree": document.pin.producer_tree.hexdigest,
            "rawSha256": document.pin.raw_sha256.hexdigest,
            "relativePath": document.pin.relative_path,
            "role": document.pin.role.value,
        }
        for document in results
    ]
    assert fable == render_fable5(decision)
    assert fable == render_fable5(reordered)
    assert "crediblePositiveCount=null" in fable
    assert "authority=NONE" in fable
    assert "status=`UNKNOWN`" in fable


def test_accepted_in_memory_packet_preserves_positive_and_no_go_assessments() -> None:
    registry = _registry_document(acceptance=AcceptanceState.ACCEPTED)
    results = tuple(
        _result_document(
            role,
            filename,
            raw=_complete_result_bytes(
                filename,
                no_go=role is ArtifactRole.S1E,
            ),
            acceptance=AcceptanceState.ACCEPTED,
        )
        for role, filename in _RESULT_FIXTURES
    )

    decision = evaluate_intake(registry, results)
    reordered = evaluate_intake(registry, tuple(reversed(results)))

    assert decision.status is DecisionState.VERIFIED_POSITIVE
    assert decision.credible_positive_count == 4
    assert tuple(item.status for item in decision.assessments) == (
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.NO_GO,
    )
    assert decision.assessments[-1].reason_codes == ("NET_BELOW_MINIMUM",)
    assert decision_to_canonical_bytes(decision) == decision_to_canonical_bytes(reordered)
    assert render_fable5(decision) == render_fable5(reordered)


def test_fable5_downgrades_unaccepted_positive_assessments_to_unknown() -> None:
    complete_results = tuple(
        (role, filename, _complete_result_bytes(filename)) for role, filename in _RESULT_FIXTURES
    )

    pending_registry = _registry_document(acceptance=AcceptanceState.PENDING)
    accepted_results = tuple(
        _result_document(
            role,
            filename,
            raw=raw,
            acceptance=AcceptanceState.ACCEPTED,
        )
        for role, filename, raw in complete_results
    )
    registry_pending_decision = evaluate_intake(pending_registry, accepted_results)

    assert all(
        assessment.status is DecisionState.VERIFIED_POSITIVE
        for assessment in registry_pending_decision.assessments
    )
    registry_pending_card = render_fable5(registry_pending_decision)
    assert "assessmentCounts=VERIFIED_POSITIVE:0,NO_GO:0,UNKNOWN:5" in (registry_pending_card)
    assert all(
        f"{role.value}:UNKNOWN:" in registry_pending_card
        for role in ArtifactRole
        if role.value != "S_META1"
    )

    accepted_registry = _registry_document(acceptance=AcceptanceState.ACCEPTED)
    one_pending_result = tuple(
        _result_document(
            role,
            filename,
            raw=raw,
            acceptance=(
                AcceptanceState.PENDING if role is ArtifactRole.E1 else AcceptanceState.ACCEPTED
            ),
        )
        for role, filename, raw in complete_results
    )
    result_pending_decision = evaluate_intake(accepted_registry, one_pending_result)
    result_pending_card = render_fable5(result_pending_decision)

    assert "assessmentCounts=VERIFIED_POSITIVE:4,NO_GO:0,UNKNOWN:1" in (result_pending_card)
    assert "roles=E1:UNKNOWN:" in result_pending_card
    for role in (ArtifactRole.VE1, ArtifactRole.S1C, ArtifactRole.S1D, ArtifactRole.S1E):
        assert f"{role.value}:VERIFIED_POSITIVE:" in result_pending_card


def test_source_reason_code_blocks_otherwise_positive_accepted_packet() -> None:
    registry = _registry_document(acceptance=AcceptanceState.ACCEPTED)
    results: list[PinnedDocumentV1] = []
    for role, filename in _RESULT_FIXTURES:
        body = json.loads(_complete_result_bytes(filename))
        if role is ArtifactRole.E1:
            body["reasonCodes"] = ["REQUIRED_FACT_UNKNOWN"]
        results.append(
            _result_document(
                role,
                filename,
                raw=canonical_json_bytes(body),
                acceptance=AcceptanceState.ACCEPTED,
            )
        )

    packet = tuple(results)
    decision = evaluate_intake(registry, packet)
    reordered = evaluate_intake(registry, tuple(reversed(packet)))

    assert decision.status is DecisionState.UNKNOWN
    assert decision.credible_positive_count is None
    assert tuple(item.status for item in decision.assessments) == (
        DecisionState.UNKNOWN,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
    )
    assert decision.assessments[0].reason_codes == ("SOURCE_REASON_CODES_PRESENT",)
    assert decision.assessments[0].source_reason_codes == ("REQUIRED_FACT_UNKNOWN",)
    assert decision.reason_codes == ("E1_ASSESSMENT_UNKNOWN",)
    assert decision_to_canonical_bytes(decision) == decision_to_canonical_bytes(reordered)
    machine_body = json.loads(decision_to_canonical_bytes(decision))
    assert machine_body["assessments"][0]["sourceReasonCodes"] == ["REQUIRED_FACT_UNKNOWN"]


def test_mixed_fail_and_unknown_peer_blocks_four_positive_roles() -> None:
    registry = _registry_document(acceptance=AcceptanceState.ACCEPTED)
    results: list[PinnedDocumentV1] = []
    for role, filename in _RESULT_FIXTURES:
        body = json.loads(_complete_result_bytes(filename))
        if role is ArtifactRole.S1E:
            body["economics"]["costCompleteState"] = "FAIL"
            body["economics"]["net"] = {"state": "UNKNOWN", "value": None}
        results.append(
            _result_document(
                role,
                filename,
                raw=canonical_json_bytes(body),
                acceptance=AcceptanceState.ACCEPTED,
            )
        )

    decision = evaluate_intake(registry, tuple(results))

    assert decision.status is DecisionState.UNKNOWN
    assert decision.credible_positive_count is None
    assert tuple(item.status for item in decision.assessments) == (
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.VERIFIED_POSITIVE,
        DecisionState.UNKNOWN,
    )
    assert decision.assessments[-1].reason_codes == (
        "COST_COMPLETE_FAIL",
        "NET_UNKNOWN",
    )
    assert decision.reason_codes == ("S1E_ASSESSMENT_UNKNOWN",)


def test_rejected_registry_is_invalid_without_rendering_a_card() -> None:
    _registry, results = _fixture_packet()
    rejected_registry = _registry_document(acceptance=AcceptanceState.REJECTED)

    _assert_rejected_without_card(
        rejected_registry,
        results,
        match="REJECTED registry pin is invalid input",
    )


def test_rejected_result_is_invalid_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    rejected_result = _result_document(
        _RESULT_FIXTURES[0][0],
        _RESULT_FIXTURES[0][1],
        acceptance=AcceptanceState.REJECTED,
    )

    _assert_rejected_without_card(
        registry,
        (rejected_result, *results[1:]),
        match="REJECTED result pin is invalid input",
    )


def test_missing_result_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    _assert_rejected_without_card(
        registry,
        results[:-1],
        match="result role universe differs from registry",
    )


def test_duplicate_result_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    _assert_rejected_without_card(
        registry,
        (*results, results[0]),
        match="duplicate result role",
    )


def test_orphan_result_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    body = json.loads(results[0].raw)
    body["packetRole"] = "ORPHAN"
    orphan = _result_document(
        ArtifactRole.E1,
        "e1_result.json",
        raw=canonical_json_bytes(body),
    )
    _assert_rejected_without_card(
        registry,
        (orphan, *results[1:]),
        match="result.packetRole has an unsupported value",
    )


def test_raw_hash_mismatch_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    bad_result = replace(
        results[0],
        pin=replace(results[0].pin, raw_sha256=DigestV1("0" * 64)),
    )
    _assert_rejected_without_card(
        registry,
        (bad_result, *results[1:]),
        match="raw SHA-256 does not match its pin",
    )


def test_registry_hash_mismatch_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    body = json.loads(results[0].raw)
    body["registrySha256"] = "0" * 64
    bad_result = _result_document(
        ArtifactRole.E1,
        "e1_result.json",
        raw=canonical_json_bytes(body),
    )
    _assert_rejected_without_card(
        registry,
        (bad_result, *results[1:]),
        match="registry_sha256 does not match registry raw bytes",
    )


def test_candidate_outside_frozen_family_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    body = json.loads(results[0].raw)
    body["candidateId"] = "UNREGISTERED_CANDIDATE"
    bad_result = _result_document(
        ArtifactRole.E1,
        "e1_result.json",
        raw=canonical_json_bytes(body),
    )

    _assert_rejected_without_card(
        registry,
        (bad_result, *results[1:]),
        match="candidate",
    )


def test_producer_commit_mismatch_raises_without_rendering_a_card() -> None:
    registry, results = _fixture_packet()
    bad_result = replace(
        results[0],
        pin=replace(results[0].pin, producer_commit=GitOidV1("0" * 40)),
    )
    _assert_rejected_without_card(
        registry,
        (bad_result, *results[1:]),
        match="producerCommit does not match its pin",
    )
