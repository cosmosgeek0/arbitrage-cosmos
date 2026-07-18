from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops import recorded_outcomes as recorded_outcome_module
from quant_edge.registry_ops.contracts import ArtifactKind, ArtifactRefV1, OutcomeReality
from quant_edge.registry_ops.recorded_outcomes import (
    CalibrationAuthority,
    RecordedCalibrationPolicyV1,
    RecordedCalibrationReportV1,
    RecordedCalibrationStatus,
    RecordedOutcomeAttestationV1,
    RecordedOutcomeCorpusV1,
    RecordedOutcomeV1,
    RecordedPredictionRegistrationV1,
    evaluate_recorded_calibration,
)
from quant_edge.registry_ops.store import RegistryConflictError, ResearchRegistryStore

NOW = 1_752_000_000_000
DIGEST = DigestV1("a" * 64)


def policy(
    *, authority: CalibrationAuthority = CalibrationAuthority.RESEARCH_ONLY
) -> RecordedCalibrationPolicyV1:
    return RecordedCalibrationPolicyV1(
        policy_revision=f"l068.{authority.value.lower()}.v1",
        authority=authority,
        minimum_records=4,
        maximum_source_revisions=1,
        maximum_brier_micros=20_000,
        maximum_absolute_bias_micros=60_000,
        maximum_mean_absolute_residual_micros=100_000,
        maximum_absolute_cost_residual_micros=100,
        required_cost_unit="quote-notional-micros.v1",
        required_cost_valuation_asset="USDT",
    )


def outcome(
    index: int,
    prediction: int,
    observed: int,
    *,
    reality: OutcomeReality = OutcomeReality.REPLAY,
) -> RecordedOutcomeV1:
    return RecordedOutcomeV1(
        outcome_id=f"l068.outcome.{index:02d}",
        batch_id=f"l068.batch.{index:02d}",
        event_id=f"l068.event.{index:02d}",
        prediction_id=f"l068.prediction.{index:02d}",
        model_id="passive-fill",
        model_revision="l065.passive-fill.v1",
        source_revision="recorded-replay.v1",
        source_artifact_sha256=DIGEST,
        prediction_micros=prediction,
        outcome_micros=observed,
        predicted_cost_micros=100,
        realized_cost_micros=110,
        cost_unit="quote-notional-micros.v1",
        cost_valuation_asset="USDT",
        prediction_cutoff_ms=NOW - 2_000 + index,
        prediction_issued_at_ms=NOW - 1_000 + index,
        observed_at_ms=NOW + index,
        reality=reality,
    )


def corpus(*, reality: OutcomeReality = OutcomeReality.REPLAY) -> RecordedOutcomeCorpusV1:
    return RecordedOutcomeCorpusV1(
        corpus_id="l068.recorded-outcome-corpus",
        corpus_revision=f"l068.{reality.value.lower()}.v1",
        records=(
            outcome(1, 100_000, 0, reality=reality),
            outcome(2, 300_000, 400_000, reality=reality),
            outcome(3, 700_000, 800_000, reality=reality),
            outcome(4, 900_000, 1_000_000, reality=reality),
        ),
    )


def report(*, reality: OutcomeReality = OutcomeReality.REPLAY) -> RecordedCalibrationReportV1:
    return evaluate_recorded_calibration(
        report_id=f"l068.report.{reality.value.lower()}.v1",
        slot_id="passive-fill-calibration",
        corpus=corpus(reality=reality),
        policy=policy(),
    )


def test_absent_outcomes_publish_data_insufficient_without_metrics() -> None:
    empty = RecordedOutcomeCorpusV1(
        corpus_id="l068.empty",
        corpus_revision="l068.empty.v1",
        records=(),
    )
    result = evaluate_recorded_calibration(
        report_id="l068.report.empty",
        slot_id="passive-fill-calibration",
        corpus=empty,
        policy=policy(),
    )
    assert result.status is RecordedCalibrationStatus.DATA_INSUFFICIENT
    assert result.is_promotable is False
    assert result.brier_micros is None
    assert result.bias_micros is None
    assert result.reason_codes == (
        "OUTCOME_REALITY_NOT_AUTHORIZED",
        "RECORDED_OUTCOMES_ABSENT",
        "RECORDED_OUTCOMES_BELOW_MINIMUM",
    )


def test_replay_residuals_are_exact_and_promote_only_research_head(tmp_path: Path) -> None:
    result = report()
    assert result.status is RecordedCalibrationStatus.PROMOTION_ELIGIBLE
    assert result.brier_micros == 10_000
    assert result.bias_micros == 50_000
    assert result.mean_absolute_residual_micros == 100_000
    assert result.mean_cost_residual_micros == 10
    assert result.report_revision.startswith("sha256:")

    with ResearchRegistryStore(tmp_path) as store:
        assert (
            store.record_recorded_calibration_report(result, corpus=corpus())
            == result.content_digest
        )
        first = store.promote_recorded_calibration(
            report=result,
            transition_id="l068.promote.replay.v1",
            expected_generation=0,
            now_ms=NOW + 100,
        )
        assert first.authority is CalibrationAuthority.RESEARCH_ONLY
        assert first.generation == 1
        assert store.current_recorded_calibration(result.slot_id) == first
        assert (
            store.promote_recorded_calibration(
                report=result,
                transition_id="l068.promote.replay.v1",
                expected_generation=0,
                now_ms=NOW + 100,
            )
            == first
        )
    with ResearchRegistryStore(tmp_path) as restarted:
        assert restarted.current_recorded_calibration(result.slot_id) == first


def test_hypothetical_or_replay_for_production_cannot_promote(tmp_path: Path) -> None:
    hypothetical = report(reality=OutcomeReality.HYPOTHETICAL)
    assert hypothetical.status is RecordedCalibrationStatus.WRONG_REALITY
    assert "OUTCOME_REALITY_NOT_AUTHORIZED" in hypothetical.reason_codes
    replay_for_production = evaluate_recorded_calibration(
        report_id="l068.report.production-blocked.v1",
        slot_id="passive-fill-production-calibration",
        corpus=corpus(),
        policy=policy(authority=CalibrationAuthority.PRODUCTION),
    )
    assert replay_for_production.status is RecordedCalibrationStatus.WRONG_REALITY
    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(
            hypothetical, corpus=corpus(reality=OutcomeReality.HYPOTHETICAL)
        )
        store.record_recorded_calibration_report(replay_for_production, corpus=corpus())
        for blocked in (hypothetical, replay_for_production):
            with pytest.raises(RegistryConflictError, match="eligible exact-model"):
                store.promote_recorded_calibration(
                    report=blocked,
                    transition_id=f"l068.blocked.{blocked.report_id}",
                    expected_generation=0,
                    now_ms=NOW + 200,
                )
        assert store.current_recorded_calibration(replay_for_production.slot_id) is None


def test_revision_and_identity_are_immutable(tmp_path: Path) -> None:
    result = report()
    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(result, corpus=corpus())
        with pytest.raises(RegistryConflictError, match="exact corpus evaluation"):
            store.record_recorded_calibration_report(
                replace(result, reason_codes=("FORGED",)), corpus=corpus()
            )
        hypothetical = report(reality=OutcomeReality.HYPOTHETICAL)
        forged_status = replace(
            hypothetical,
            status=RecordedCalibrationStatus.PROMOTION_ELIGIBLE,
            reason_codes=(),
        )
        with pytest.raises(RegistryConflictError, match="exact corpus evaluation"):
            store.record_recorded_calibration_report(
                forged_status,
                corpus=corpus(reality=OutcomeReality.HYPOTHETICAL),
            )
        store.promote_recorded_calibration(
            report=result,
            transition_id="l068.promote.immutable.v1",
            expected_generation=0,
            now_ms=NOW + 300,
        )
        with pytest.raises(RegistryConflictError, match="stale"):
            store.promote_recorded_calibration(
                report=result,
                transition_id="l068.promote.stale.v2",
                expected_generation=0,
                now_ms=NOW + 301,
            )


def test_caller_declared_real_and_arbitrary_digest_are_not_self_attesting(
    tmp_path: Path,
) -> None:
    real_corpus = corpus(reality=OutcomeReality.REAL)
    unconfigured = evaluate_recorded_calibration(
        report_id="l068.report.real-unconfigured.v1",
        slot_id="passive-fill-production-calibration",
        corpus=real_corpus,
        policy=policy(authority=CalibrationAuthority.PRODUCTION),
    )
    assert unconfigured.status is RecordedCalibrationStatus.NOT_CONFIGURED
    assert unconfigured.is_promotable is False
    assert "OUTCOME_ATTESTATION_REQUIRED" in unconfigured.reason_codes
    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(unconfigured, corpus=real_corpus)
        with pytest.raises(RegistryConflictError, match="eligible exact-model"):
            store.promote_recorded_calibration(
                report=unconfigured,
                transition_id="l068.real-unconfigured.v1",
                expected_generation=0,
                now_ms=NOW + 400,
            )


def test_fractional_probability_errors_cannot_truncate_through_zero_budgets() -> None:
    positive = RecordedOutcomeCorpusV1(
        corpus_id="l068.fractional-positive",
        corpus_revision="l068.fractional-positive.v1",
        records=(
            outcome(1, 0, 1),
            outcome(2, 0, 0),
            outcome(3, 0, 0),
            outcome(4, 0, 0),
        ),
    )
    zero_probability_budget = replace(
        policy(),
        maximum_brier_micros=0,
        maximum_absolute_bias_micros=0,
        maximum_mean_absolute_residual_micros=0,
    )
    positive_report = evaluate_recorded_calibration(
        report_id="l068.report.fractional-positive.v1",
        slot_id="passive-fill-calibration",
        corpus=positive,
        policy=zero_probability_budget,
    )
    assert positive_report.status is RecordedCalibrationStatus.REJECTED
    assert positive_report.brier_micros == 1
    assert positive_report.bias_micros == 1
    assert positive_report.mean_absolute_residual_micros == 1
    assert positive_report.reason_codes == (
        "BIAS_EXCEEDS_BUDGET",
        "BRIER_EXCEEDS_BUDGET",
        "RESIDUAL_EXCEEDS_BUDGET",
    )

    negative = replace(
        positive,
        corpus_id="l068.fractional-negative",
        corpus_revision="l068.fractional-negative.v1",
        records=(
            outcome(1, 1, 0),
            outcome(2, 0, 0),
            outcome(3, 0, 0),
            outcome(4, 0, 0),
        ),
    )
    negative_report = evaluate_recorded_calibration(
        report_id="l068.report.fractional-negative.v1",
        slot_id="passive-fill-calibration",
        corpus=negative,
        policy=zero_probability_budget,
    )
    assert negative_report.bias_micros == -1
    assert negative_report.brier_micros == positive_report.brier_micros
    assert (
        negative_report.mean_absolute_residual_micros
        == positive_report.mean_absolute_residual_micros
    )


def test_registered_owner_attestation_binds_exact_production_corpus(tmp_path: Path) -> None:
    real_corpus = corpus(reality=OutcomeReality.REAL)
    prediction_owner_id = "inference.recorded-predictions"
    prediction_owner_revision = "inference.recorded-predictions.v1"
    with ResearchRegistryStore(
        tmp_path,
        recorded_prediction_owner_id=prediction_owner_id,
        recorded_prediction_owner_revision=prediction_owner_revision,
        recorded_prediction_clock=lambda: NOW - 500,
    ) as prediction_store:
        registrations = tuple(
            prediction_store.record_recorded_prediction(record.recorded_prediction)
            for record in real_corpus.records
        )
        assert (
            tuple(
                prediction_store.record_recorded_prediction(record.recorded_prediction)
                for record in real_corpus.records
            )
            == registrations
        )
    attestation = RecordedOutcomeAttestationV1.for_corpus(
        collector_id="foundation.recorded-outcomes",
        collector_revision="foundation.recorded-outcomes.v1",
        prediction_owner_id=prediction_owner_id,
        prediction_owner_revision=prediction_owner_revision,
        corpus=real_corpus,
        prediction_registrations=registrations,
    )
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    body = canonical_json_bytes(attestation.as_mapping())
    artifact_path = artifact_root / "recorded-outcomes-attestation.json"
    artifact_path.write_bytes(body)
    reference = ArtifactRefV1(
        artifact_id="l068.production-owner-attestation.v1",
        kind=ArtifactKind.MODEL_EVIDENCE,
        schema_name="Q15RecordedOutcomeAttestationV1",
        schema_version=1,
        relative_path=artifact_path.name,
        sha256=DigestV1(hashlib.sha256(body).hexdigest()),
        byte_length=len(body),
        media_type="application/json",
    )
    with ResearchRegistryStore(
        tmp_path,
        recorded_outcome_attestation=reference,
        recorded_outcome_artifact_root=artifact_root,
        recorded_prediction_owner_id=prediction_owner_id,
        recorded_prediction_owner_revision=prediction_owner_revision,
        recorded_prediction_clock=lambda: NOW - 400,
    ) as store:
        assert not hasattr(
            recorded_outcome_module,
            "_seal_verified_recorded_outcome_attestation",
        )
        with pytest.raises(RegistryConflictError, match="exact registered artifact"):
            store.evaluate_recorded_calibration(
                report_id="l068.report.real-unregistered.v1",
                slot_id="passive-fill-production-calibration",
                corpus=real_corpus,
                policy=policy(authority=CalibrationAuthority.PRODUCTION),
            )
        store.register_artifact(reference, artifact_root=artifact_root, recorded_at_ms=NOW)
        verified = store.verify_recorded_outcome_attestation(real_corpus)
        assert verified == attestation
        result = store.evaluate_recorded_calibration(
            report_id="l068.report.real-attested.v1",
            slot_id="passive-fill-production-calibration",
            corpus=real_corpus,
            policy=policy(authority=CalibrationAuthority.PRODUCTION),
        )
        assert result.status is RecordedCalibrationStatus.PROMOTION_ELIGIBLE
        store.record_recorded_calibration_report(result, corpus=real_corpus)
        connection = store._require_open()
        connection.execute(
            "DELETE FROM artifacts WHERE artifact_id=?",
            (reference.artifact_id,),
        )
        connection.commit()
        with pytest.raises(RegistryConflictError, match="exact registered artifact"):
            store.promote_recorded_calibration(
                report=result,
                transition_id="l068.real-missing-registration.v1",
                expected_generation=0,
                now_ms=NOW + 499,
            )
        store.register_artifact(
            reference,
            artifact_root=artifact_root,
            recorded_at_ms=NOW + 1,
        )
        promoted = store.promote_recorded_calibration(
            report=result,
            transition_id="l068.real-attested.v1",
            expected_generation=0,
            now_ms=NOW + 500,
        )
        assert promoted.authority is CalibrationAuthority.PRODUCTION
        changed = replace(
            real_corpus,
            corpus_revision="l068.real.changed.v2",
        )
        with pytest.raises(RegistryConflictError, match="exact corpus"):
            store.verify_recorded_outcome_attestation(changed)


def test_hindsight_prediction_receipts_cannot_mint_production_evidence(
    tmp_path: Path,
) -> None:
    real_corpus = corpus(reality=OutcomeReality.REAL)
    owner_id = "inference.recorded-predictions"
    owner_revision = "inference.recorded-predictions.v1"
    late_registrations = tuple(
        RecordedPredictionRegistrationV1(
            owner_id=owner_id,
            owner_revision=owner_revision,
            prediction=record.recorded_prediction,
            registered_at_ms=record.observed_at_ms + 1,
        )
        for record in real_corpus.records
    )
    with pytest.raises(ContractValueError, match="pre-outcome prediction"):
        RecordedOutcomeAttestationV1.for_corpus(
            collector_id="foundation.recorded-outcomes",
            collector_revision="foundation.recorded-outcomes.v1",
            prediction_owner_id=owner_id,
            prediction_owner_revision=owner_revision,
            corpus=real_corpus,
            prediction_registrations=late_registrations,
        )

    forged_registrations = tuple(
        replace(registration, registered_at_ms=NOW - 500) for registration in late_registrations
    )
    forged_attestation = RecordedOutcomeAttestationV1.for_corpus(
        collector_id="foundation.recorded-outcomes",
        collector_revision="foundation.recorded-outcomes.v1",
        prediction_owner_id=owner_id,
        prediction_owner_revision=owner_revision,
        corpus=real_corpus,
        prediction_registrations=forged_registrations,
    )
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    body = canonical_json_bytes(forged_attestation.as_mapping())
    artifact_path = artifact_root / "forged-attestation.json"
    artifact_path.write_bytes(body)
    reference = ArtifactRefV1(
        artifact_id="l068.forged-owner-attestation.v1",
        kind=ArtifactKind.MODEL_EVIDENCE,
        schema_name="Q15RecordedOutcomeAttestationV1",
        schema_version=1,
        relative_path=artifact_path.name,
        sha256=DigestV1(hashlib.sha256(body).hexdigest()),
        byte_length=len(body),
        media_type="application/json",
    )
    with ResearchRegistryStore(
        tmp_path,
        recorded_outcome_attestation=reference,
        recorded_outcome_artifact_root=artifact_root,
        recorded_prediction_owner_id=owner_id,
        recorded_prediction_owner_revision=owner_revision,
        recorded_prediction_clock=lambda: NOW + 1_000,
    ) as store:
        store.register_artifact(reference, artifact_root=artifact_root, recorded_at_ms=NOW)
        with pytest.raises(RegistryConflictError, match="durable pre-outcome prediction"):
            store.evaluate_recorded_calibration(
                report_id="l068.report.hindsight.v1",
                slot_id="passive-fill-production-calibration",
                corpus=real_corpus,
                policy=policy(authority=CalibrationAuthority.PRODUCTION),
            )


def test_duplicate_underlying_event_cannot_hide_behind_another_outcome_id() -> None:
    first = outcome(1, 100_000, 0)
    with pytest.raises(ContractValueError, match="unique underlying event_id"):
        RecordedOutcomeCorpusV1(
            corpus_id="l068.duplicate-event",
            corpus_revision="l068.duplicate-event.v1",
            records=(first, replace(first, outcome_id="l068.outcome.02")),
        )


def test_prediction_lineage_precedes_outcome_and_cost_identity_is_closed() -> None:
    first = outcome(1, 100_000, 0)
    with pytest.raises(ContractValueError, match="precede outcome observation"):
        replace(first, prediction_issued_at_ms=first.observed_at_ms)
    with pytest.raises(ContractValueError, match="must not follow prediction issue"):
        replace(first, prediction_cutoff_ms=first.prediction_issued_at_ms + 1)

    changed_prediction = replace(first, prediction_micros=first.prediction_micros + 1)
    assert changed_prediction.prediction_artifact_sha256 != first.prediction_artifact_sha256
    assert changed_prediction.content_digest != first.content_digest
    assert changed_prediction.outcome_truth_digest == first.outcome_truth_digest
    changed_outcome = replace(first, outcome_micros=first.outcome_micros + 1)
    assert changed_outcome.prediction_artifact_sha256 == first.prediction_artifact_sha256
    assert changed_outcome.outcome_truth_digest != first.outcome_truth_digest

    second = outcome(2, 300_000, 400_000)
    with pytest.raises(ContractValueError, match="unique prediction_id"):
        RecordedOutcomeCorpusV1(
            corpus_id="l068.duplicate-prediction",
            corpus_revision="l068.duplicate-prediction.v1",
            records=(first, replace(second, prediction_id=first.prediction_id)),
        )
    with pytest.raises(ContractValueError, match="one exact cost identity"):
        RecordedOutcomeCorpusV1(
            corpus_id="l068.mixed-cost-identity",
            corpus_revision="l068.mixed-cost-identity.v1",
            records=(first, replace(second, cost_valuation_asset="BTC")),
        )

    blocked = evaluate_recorded_calibration(
        report_id="l068.report.cost-identity-blocked.v1",
        slot_id="passive-fill-calibration",
        corpus=corpus(),
        policy=replace(policy(), required_cost_valuation_asset="USD"),
    )
    assert blocked.status is RecordedCalibrationStatus.REJECTED
    assert "COST_IDENTITY_NOT_AUTHORIZED" in blocked.reason_codes
