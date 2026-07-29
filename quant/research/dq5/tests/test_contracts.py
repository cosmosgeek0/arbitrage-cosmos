from __future__ import annotations

import pytest
from research.dq5.contracts import Dq5InputError, parse_candidate, parse_registry
from research.dq5.tests.support import (
    fixture_bytes,
    fixture_object,
    require_array,
    require_object,
    sealed_intake,
)
from research.dq5.validator import validate_bytes

from quant_edge.canonical import canonical_json_bytes


@pytest.mark.parametrize(
    "raw",
    [
        b'{"coverageComplete":true,"coverageComplete":true,"holdoutOpenEvents":[],"registrations":[],"schemaVersion":"DQ5_REGISTRY_V1"}\n',
        b'{ "coverageComplete":true,"holdoutOpenEvents":[],"registrations":[],'
        b'"schemaVersion":"DQ5_REGISTRY_V1"}\n',
        b'{"coverageComplete":true,"holdoutOpenEvents":[],"registrations":[],"schemaVersion":"DQ5_REGISTRY_V1"}',
        b'{"coverageComplete":true,"holdoutOpenEvents":[],"registrations":[],"schemaVersion":"DQ5_REGISTRY_V1","value":1.5}\n',
        b"\xff\n",
    ],
)
def test_registry_requires_exact_canonical_json(raw: bytes) -> None:
    with pytest.raises(Dq5InputError, match="exact canonical"):
        parse_registry(raw)


def test_candidate_rejects_unknown_keys() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    candidate["outcome"] = "NOT_ALLOWED"

    with pytest.raises(Dq5InputError, match="key mismatch"):
        parse_candidate(canonical_json_bytes(candidate))


def test_candidate_rejects_aggregate_corpus_alias() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    registration = require_object(candidate["registration"])
    window = require_object(require_array(registration["windows"])[0])
    corpus = require_object(window["corpus"])
    corpus["instrumentId"] = "ALL"

    with pytest.raises(Dq5InputError, match="explicit corpus population"):
        parse_candidate(canonical_json_bytes(candidate))


def test_candidate_rejects_unsorted_windows() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    registration = require_object(candidate["registration"])
    windows = require_array(registration["windows"])
    windows.reverse()

    with pytest.raises(Dq5InputError, match="sorted by canonical window key"):
        parse_candidate(canonical_json_bytes(candidate))


def test_same_role_overlap_requires_normalized_windows() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    registration = require_object(candidate["registration"])
    windows = require_array(registration["windows"])
    development = require_object(windows[0])
    duplicate = dict(development)
    duplicate["windowId"] = "DEV-BTC-SECOND"
    duplicate["startMs"] = 1500
    duplicate["endMs"] = 2500
    windows.insert(1, duplicate)

    with pytest.raises(Dq5InputError, match="same-role windows"):
        parse_candidate(canonical_json_bytes(candidate))


def test_open_event_must_reference_a_known_holdout() -> None:
    registry = fixture_object("hostile", "registry_contaminated.json")
    event = require_object(require_array(registry["holdoutOpenEvents"])[0])
    event["holdoutId"] = "HOLDOUT-NOT-REGISTERED"

    with pytest.raises(Dq5InputError, match="must reference a HOLDOUT window"):
        validate_bytes(
            canonical_json_bytes(registry),
            fixture_bytes("hostile", "candidate_false_fresh.json"),
        )


def test_open_event_cannot_exist_without_a_durable_registration() -> None:
    registry = fixture_object("hostile", "registry_candidate_opened.json")
    require_array(registry["pendingRegistrations"]).clear()

    with pytest.raises(Dq5InputError, match="settled or pending"):
        parse_registry(canonical_json_bytes(registry))


def test_every_window_requires_an_immutable_seal_digest() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    registration = require_object(candidate["registration"])
    window = require_object(require_array(registration["windows"])[0])
    window["artifactSha256"] = None

    with pytest.raises(Dq5InputError, match="64 lowercase hexadecimal"):
        parse_candidate(canonical_json_bytes(candidate))


def test_candidate_cannot_supply_its_own_open_event_history() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    candidate["holdoutOpenEvents"] = []

    with pytest.raises(Dq5InputError, match="key mismatch"):
        parse_candidate(canonical_json_bytes(candidate))


def test_candidate_must_match_its_pending_custody_record() -> None:
    candidate = fixture_object("hostile", "candidate_opened.json")
    registration = require_object(candidate["registration"])
    registration["protocolSha256"] = "e" * 64

    with pytest.raises(Dq5InputError, match="exactly match"):
        validate_bytes(
            fixture_bytes("hostile", "registry_candidate_opened.json"),
            canonical_json_bytes(candidate),
        )


def test_candidate_without_a_pending_custody_record_fails_closed() -> None:
    with pytest.raises(Dq5InputError, match="pre-persisted"):
        validate_bytes(
            fixture_bytes("valid", "registry_empty.json"),
            fixture_bytes("valid", "candidate_fresh.json"),
        )


def test_pending_record_of_another_candidate_does_not_admit_this_one() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    other = fixture_object("valid", "candidate_adjacent.json")
    require_array(registry["pendingRegistrations"]).append(require_object(other["registration"]))

    with pytest.raises(Dq5InputError, match="pre-persisted"):
        validate_bytes(
            canonical_json_bytes(registry),
            fixture_bytes("valid", "candidate_fresh.json"),
        )


def test_pending_proposals_accept_content_distinct_duplicate_research_ids() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    rival = fixture_object("valid", "candidate_adjacent.json")
    rival_registration = require_object(rival["registration"])
    rival_registration["researchId"] = "NEW-B"
    require_array(registry["pendingRegistrations"]).append(rival_registration)

    registry_raw, _ = sealed_intake(registry, candidate)
    parsed = parse_registry(registry_raw)

    assert len(parsed.pending_registrations) == 2
    assert {item.research_id for item in parsed.pending_registrations} == {"NEW-B"}


def test_pending_proposals_require_the_full_canonical_registration_order() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    rival = fixture_object("valid", "candidate_adjacent.json")
    rival_registration = require_object(rival["registration"])
    rival_registration["researchId"] = "NEW-B"
    require_array(registry["pendingRegistrations"]).append(rival_registration)
    sealed_intake(registry, candidate)
    require_array(registry["pendingRegistrations"]).reverse()

    with pytest.raises(Dq5InputError, match="canonical registration key"):
        parse_registry(canonical_json_bytes(registry))


def test_byte_identical_duplicate_pending_records_are_invalid() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    sealed_intake(registry, candidate)
    registry_raw, _ = sealed_intake(registry, candidate)

    with pytest.raises(Dq5InputError, match="duplicate pending registration"):
        parse_registry(registry_raw)


def test_settled_research_ids_remain_unique() -> None:
    registry = fixture_object("valid", "registry_adjacent_history.json")
    registrations = require_array(registry["registrations"])
    registrations.append(registrations[0])

    with pytest.raises(Dq5InputError, match="researchId values must be unique"):
        parse_registry(canonical_json_bytes(registry))


def test_committed_fixtures_are_canonical_and_parseable() -> None:
    parse_registry(fixture_bytes("valid", "registry_empty.json"))
    parse_registry(fixture_bytes("valid", "registry_pending_fresh.json"))
    parse_registry(fixture_bytes("valid", "registry_adjacent_history.json"))
    parse_registry(fixture_bytes("hostile", "registry_contaminated.json"))
    parse_registry(fixture_bytes("hostile", "registry_incomplete.json"))
    parse_registry(fixture_bytes("hostile", "registry_candidate_opened.json"))
    parse_candidate(fixture_bytes("valid", "candidate_fresh.json"))
    parse_candidate(fixture_bytes("valid", "candidate_adjacent.json"))
    parse_candidate(fixture_bytes("hostile", "candidate_alias.json"))
    parse_candidate(fixture_bytes("hostile", "candidate_false_fresh.json"))
    parse_candidate(fixture_bytes("hostile", "candidate_internal_overlap.json"))
    parse_candidate(fixture_bytes("hostile", "candidate_opened.json"))
