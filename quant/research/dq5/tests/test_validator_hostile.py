from __future__ import annotations

import pytest
from research.dq5.contracts import (
    Candidate,
    CorpusIdentity,
    Dq5InputError,
    Registration,
    Registry,
    Window,
    WindowRole,
    parse_candidate,
)
from research.dq5.tests.support import (
    fixture_bytes,
    fixture_object,
    require_array,
    require_int,
    require_object,
    require_string,
    sealed_fixture_intake,
    sealed_intake,
)
from research.dq5.validator import (
    Dq5ReasonCode,
    ValidationStatus,
    _validate_intake,
    validate_bytes,
)


def _codes(registry_name: str, candidate_name: str) -> set[Dq5ReasonCode]:
    report = validate_bytes(
        *sealed_fixture_intake(
            "hostile" if registry_name.startswith("registry_") else "valid",
            registry_name,
            "hostile",
            candidate_name,
        ),
    )
    assert report.status is ValidationStatus.REJECTED
    return set(report.reason_codes)


def test_false_fresh_fixture_detects_every_global_reuse_class() -> None:
    codes = _codes("registry_contaminated.json", "candidate_false_fresh.json")

    assert codes == {
        Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
        Dq5ReasonCode.CORPUS_WINDOW_REUSED_ACROSS_FAMILY,
        Dq5ReasonCode.HOLDOUT_ID_REUSED,
        Dq5ReasonCode.HOLDOUT_SHARED,
        Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY,
        Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED,
        Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE,
    }


def test_internal_development_holdout_intersection_defeats_freshness() -> None:
    report = validate_bytes(
        *sealed_fixture_intake(
            "valid",
            "registry_empty.json",
            "hostile",
            "candidate_internal_overlap.json",
        )
    )

    assert set(report.reason_codes) == {
        Dq5ReasonCode.CANDIDATE_DEVELOPMENT_HOLDOUT_OVERLAP,
        Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
        Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE,
    }


def test_candidate_open_attempt_is_irreversible_non_green_evidence() -> None:
    report = validate_bytes(
        fixture_bytes("hostile", "registry_candidate_opened.json"),
        fixture_bytes("hostile", "candidate_opened.json"),
    )

    assert set(report.reason_codes) == {
        Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED,
        Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE,
    }


def test_rejected_opened_candidate_can_settle_without_poisoning_future_intake() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    pending_registry = fixture_object("hostile", "registry_candidate_opened.json")
    pending_report = validate_bytes(
        *sealed_intake(pending_registry, candidate),
    )

    settled_registry = fixture_object("hostile", "registry_candidate_opened.json")
    pending = require_array(settled_registry["pendingRegistrations"])
    registrations = require_array(settled_registry["registrations"])
    registrations.extend(pending)
    pending.clear()

    settled_report = validate_bytes(
        *sealed_intake(settled_registry, candidate),
    )

    assert pending_report.status is ValidationStatus.ELIGIBLE_FOR_INTAKE
    assert pending_report.reason_codes == ()
    assert settled_report.status is ValidationStatus.ELIGIBLE_FOR_INTAKE
    assert settled_report.reason_codes == ()


def test_other_pending_candidate_participates_in_global_reuse_checks() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    pending_candidate = fixture_object("hostile", "candidate_false_fresh.json")
    pending_registration = require_object(pending_candidate["registration"])
    pending_registration["familyId"] = "FAMILY-PENDING"
    pending_registration["researchId"] = "PENDING-A"
    require_array(registry["pendingRegistrations"]).append(pending_registration)

    report = validate_bytes(
        *sealed_intake(registry, candidate),
    )

    assert set(report.reason_codes) == {
        Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
        Dq5ReasonCode.CORPUS_WINDOW_REUSED_ACROSS_FAMILY,
        Dq5ReasonCode.HOLDOUT_SHARED,
        Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY,
        Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE,
    }


def test_same_id_pending_rival_cannot_mask_the_exact_candidate() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    candidate_registration = require_object(candidate["registration"])
    rival = fixture_object("valid", "candidate_adjacent.json")
    rival_registration = require_object(rival["registration"])
    rival_registration["researchId"] = require_string(candidate_registration["researchId"])
    rival_registration["familyId"] = "FAMILY-A"
    rival_registration["protocolSha256"] = "a" * 64
    for raw_window in require_array(rival_registration["windows"]):
        corpus = require_object(require_object(raw_window)["corpus"])
        corpus["instrumentId"] = "ETHUSDT"
    require_array(registry["pendingRegistrations"]).append(rival_registration)

    report = validate_bytes(*sealed_intake(registry, candidate))

    assert report.reason_codes == (Dq5ReasonCode.RESEARCH_ID_REUSED,)
    assert report.status is ValidationStatus.REJECTED


def test_same_id_pending_rival_remains_visible_to_every_reuse_check() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    rival = fixture_object("valid", "candidate_fresh.json")
    rival_registration = require_object(rival["registration"])
    rival_registration["familyId"] = "FAMILY-A"
    rival_registration["protocolSha256"] = "a" * 64
    require_array(registry["pendingRegistrations"]).append(rival_registration)

    report = validate_bytes(*sealed_intake(registry, candidate))

    assert set(report.reason_codes) == {
        Dq5ReasonCode.RESEARCH_ID_REUSED,
        Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
        Dq5ReasonCode.CORPUS_WINDOW_REUSED_ACROSS_FAMILY,
        Dq5ReasonCode.SEALED_ARTIFACT_REUSED,
        Dq5ReasonCode.SEALED_ARTIFACT_REUSED_ACROSS_FAMILY,
        Dq5ReasonCode.HOLDOUT_ID_REUSED,
        Dq5ReasonCode.HOLDOUT_SHARED,
        Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY,
        Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE,
    }


def test_ambiguous_exact_pending_occurrences_fail_closed() -> None:
    candidate = parse_candidate(fixture_bytes("valid", "candidate_fresh.json"))
    corpus = candidate.registration.windows[0].corpus
    registry = Registry(
        coverage_complete=True,
        custody_receipt_sha256="c" * 64,
        corpora=(corpus,),
        registrations=(),
        pending_registrations=(candidate.registration, candidate.registration),
        holdout_open_events=(),
    )

    with pytest.raises(Dq5InputError, match="exactly one occurrence"):
        _validate_intake(
            registry,
            candidate,
            registry_sha256="0" * 64,
            candidate_sha256="1" * 64,
        )


def test_open_event_taints_every_matching_same_id_pending_proposal() -> None:
    registry = fixture_object("valid", "registry_empty.json")
    candidate = fixture_object("valid", "candidate_fresh.json")
    candidate_registration = require_object(candidate["registration"])
    rival = fixture_object("valid", "candidate_adjacent.json")
    rival_registration = require_object(rival["registration"])
    rival_registration["researchId"] = require_string(candidate_registration["researchId"])
    rival_registration["familyId"] = "FAMILY-A"
    rival_registration["protocolSha256"] = "a" * 64
    rival_windows = require_array(rival_registration["windows"])
    for raw_window in rival_windows:
        corpus = require_object(require_object(raw_window)["corpus"])
        corpus["instrumentId"] = "ETHUSDT"
    rival_holdout = require_object(rival_windows[1])
    rival_holdout["holdoutId"] = "HOLDOUT-NEW-B"
    require_array(registry["pendingRegistrations"]).append(rival_registration)

    event_registry = fixture_object("hostile", "registry_candidate_opened.json")
    event = require_object(require_array(event_registry["holdoutOpenEvents"])[0])
    event["eventId"] = "OPEN-NEW-B-1"
    event["researchId"] = "NEW-B"
    event["holdoutId"] = "HOLDOUT-NEW-B"
    require_array(registry["holdoutOpenEvents"]).append(event)

    report = validate_bytes(*sealed_intake(registry, candidate))

    assert Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED in report.reason_codes
    assert Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE in report.reason_codes
    assert report.status is ValidationStatus.REJECTED


def test_incomplete_global_history_cannot_admit_a_candidate() -> None:
    report = validate_bytes(
        *sealed_fixture_intake(
            "hostile",
            "registry_incomplete.json",
            "valid",
            "candidate_fresh.json",
        )
    )

    assert report.reason_codes == (Dq5ReasonCode.REGISTRY_HISTORY_INCOMPLETE,)
    assert report.status is ValidationStatus.REJECTED


def test_false_or_absent_freshness_claim_is_rejected() -> None:
    candidate = fixture_object("valid", "candidate_fresh.json")
    registration = require_object(candidate["registration"])
    registration["freshHoldoutClaim"] = False

    registry = fixture_object("valid", "registry_empty.json")
    report = validate_bytes(
        *sealed_intake(registry, candidate),
    )

    assert report.reason_codes == (Dq5ReasonCode.FRESH_HOLDOUT_REQUIRED,)


def test_reused_research_identity_rejects_without_inventing_holdout_contamination() -> None:
    candidate = fixture_object("valid", "candidate_adjacent.json")
    registration = require_object(candidate["registration"])
    registration["researchId"] = "HIST-A"

    registry = fixture_object("valid", "registry_adjacent_history.json")
    report = validate_bytes(
        *sealed_intake(registry, candidate),
    )

    assert report.reason_codes == (Dq5ReasonCode.RESEARCH_ID_REUSED,)
    assert report.status is ValidationStatus.REJECTED


def test_holdout_identity_reuse_is_detected_after_window_relabeling() -> None:
    candidate = fixture_object("hostile", "candidate_false_fresh.json")
    registration = require_object(candidate["registration"])
    windows = require_array(registration["windows"])
    for raw_window in windows:
        window = require_object(raw_window)
        corpus = require_object(window["corpus"])
        corpus["instrumentId"] = "SOLUSDT"
        window["startMs"] = require_int(window["startMs"]) + 10_000
        window["endMs"] = require_int(window["endMs"]) + 10_000

    registry = fixture_object("hostile", "registry_contaminated.json")
    report = validate_bytes(
        *sealed_intake(registry, candidate),
    )

    assert Dq5ReasonCode.HOLDOUT_ID_REUSED in report.reason_codes
    assert Dq5ReasonCode.HOLDOUT_SHARED in report.reason_codes
    assert Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY in report.reason_codes
    assert Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED in report.reason_codes
    assert Dq5ReasonCode.CORPUS_WINDOW_OVERLAP not in report.reason_codes
    assert Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE in report.reason_codes


def test_unregistered_corpus_alias_cannot_evade_the_controlled_taxonomy() -> None:
    report = validate_bytes(
        *sealed_fixture_intake(
            "valid",
            "registry_empty.json",
            "hostile",
            "candidate_alias.json",
        )
    )

    assert report.reason_codes == (Dq5ReasonCode.CORPUS_NOT_REGISTERED,)
    assert report.status is ValidationStatus.REJECTED


def test_exact_sealed_artifact_reuse_is_detected_without_window_overlap() -> None:
    candidate = fixture_object("valid", "candidate_adjacent.json")
    registration = require_object(candidate["registration"])
    development = require_object(require_array(registration["windows"])[0])
    development["artifactSha256"] = "3" * 64

    registry = fixture_object("valid", "registry_adjacent_history.json")
    report = validate_bytes(
        *sealed_intake(registry, candidate),
    )

    assert set(report.reason_codes) == {
        Dq5ReasonCode.SEALED_ARTIFACT_REUSED,
        Dq5ReasonCode.SEALED_ARTIFACT_REUSED_ACROSS_FAMILY,
    }


def test_development_only_cross_family_reuse_rejects_without_mislabeling_holdout() -> None:
    registry = fixture_object("valid", "registry_adjacent_history.json")
    historical = require_object(require_array(registry["registrations"])[0])
    historical_windows = require_array(historical["windows"])
    historical_holdout = require_object(historical_windows[1])
    historical_holdout_corpus = require_object(historical_holdout["corpus"])
    historical_holdout_corpus["instrumentId"] = "ETHUSDT"

    candidate = fixture_object("valid", "candidate_fresh.json")
    candidate_registration = require_object(candidate["registration"])
    candidate_windows = require_array(candidate_registration["windows"])
    candidate_development = require_object(candidate_windows[0])
    candidate_development["startMs"] = 500
    candidate_development["endMs"] = 900

    report = validate_bytes(
        *sealed_intake(registry, candidate),
    )

    assert set(report.reason_codes) == {
        Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
        Dq5ReasonCode.CORPUS_WINDOW_REUSED_ACROSS_FAMILY,
    }


def test_finding_capacity_never_returns_partial_green() -> None:
    corpus = CorpusIdentity(
        provider_id="BINANCE_PUBLIC",
        venue_id="BINANCE",
        product_id="SPOT",
        instrument_id="BTCUSDT",
    )
    historical: list[Registration] = []
    for index in range(1_025):
        research_id = f"HIST-{index:04d}"
        historical.append(
            Registration(
                research_id=research_id,
                family_id="FAMILY-A",
                protocol_sha256="a" * 64,
                fresh_holdout_claim=True,
                windows=(
                    Window(
                        window_id=f"DEV-{index:04d}",
                        corpus=corpus,
                        artifact_sha256=f"{index:064x}",
                        role=WindowRole.DEVELOPMENT,
                        holdout_id=None,
                        start_ms=0,
                        end_ms=1_000,
                    ),
                    Window(
                        window_id=f"HOLD-{index:04d}",
                        corpus=corpus,
                        artifact_sha256=f"{index + 2_048:064x}",
                        role=WindowRole.HOLDOUT,
                        holdout_id=f"HOLDOUT-{index:04d}",
                        start_ms=1_000,
                        end_ms=2_000,
                    ),
                ),
            )
        )
    candidate = Candidate(
        registration=Registration(
            research_id="NEW-CAPACITY",
            family_id="FAMILY-B",
            protocol_sha256="b" * 64,
            fresh_holdout_claim=True,
            windows=(
                Window(
                    window_id="DEV-NEW",
                    corpus=corpus,
                    artifact_sha256="e" * 64,
                    role=WindowRole.DEVELOPMENT,
                    holdout_id=None,
                    start_ms=0,
                    end_ms=2_000,
                ),
                Window(
                    window_id="HOLD-NEW",
                    corpus=corpus,
                    artifact_sha256="f" * 64,
                    role=WindowRole.HOLDOUT,
                    holdout_id="HOLDOUT-NEW",
                    start_ms=0,
                    end_ms=2_000,
                ),
            ),
        ),
    )
    report = _validate_intake(
        Registry(
            coverage_complete=True,
            custody_receipt_sha256="c" * 64,
            corpora=(corpus,),
            registrations=tuple(historical),
            pending_registrations=(candidate.registration,),
            holdout_open_events=(),
        ),
        candidate,
        registry_sha256="0" * 64,
        candidate_sha256="1" * 64,
    )

    assert report.status is ValidationStatus.REJECTED
    assert Dq5ReasonCode.VALIDATION_CAPACITY_EXCEEDED in report.reason_codes
