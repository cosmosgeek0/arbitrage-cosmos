from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.registry_ops import recorded_outcomes as recorded_outcome_module
from quant_edge.registry_ops.contracts import ArtifactKind, ArtifactRefV1, OutcomeReality
from quant_edge.registry_ops.passive_fill_receipts import (
    PASSIVE_FILL_CALIBRATION_OWNER_ID,
    PASSIVE_FILL_CALIBRATION_OWNER_REVISION,
    PassiveFillCalibrationCompleteness,
    PassiveFillCalibrationMode,
    PassiveFillHeldOutCalibrationReceiptV1,
)
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
from quant_edge.registry_ops.store import (
    RegistryConflictError,
    ResearchRegistryStore,
)
from quant_edge.survival.contracts import TimeGridV1
from quant_edge.survival.passive_fill import (
    PassiveFillChallengerV1,
    PassiveFillFitConfigV1,
    PassiveFillObservationV1,
    PassiveFillOutcome,
    fit_passive_fill_challenger,
)

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
        maximum_mean_absolute_cost_residual_micros=100,
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
        model_id="recorded-calibration-probe",
        model_revision="l068.recorded-calibration-probe.v1",
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


def passive_fill_training_observations(
    *,
    posture: EvidencePosture = EvidencePosture.REPLAY,
    observed_offset_ms: int = -10_000,
) -> tuple[PassiveFillObservationV1, ...]:
    specs = (
        ("near-fill", 1, PassiveFillOutcome.FILLED, 1, 9, 1),
        ("near-censor", 3, PassiveFillOutcome.RIGHT_CENSORED, 2, 9, 0),
        ("middle-fill", 2, PassiveFillOutcome.FILLED, 5, 9, 5),
        ("middle-censor", 3, PassiveFillOutcome.RIGHT_CENSORED, 4, 9, 0),
        ("deep-fill", 2, PassiveFillOutcome.FILLED, 8, 9, 8),
        ("deep-invalid", 2, PassiveFillOutcome.INVALIDATED, 7, 9, 0),
    )
    return tuple(
        PassiveFillObservationV1(
            observation_id=f"l065.training.{name}",
            event_id=f"l065.training-event.{name}",
            source_revision="l065.recorded-training.v1",
            queue_model_revision="price-time-conservative.v1",
            duration_ns=duration * 1_000_000_000,
            queue_ahead_units=queue_ahead,
            queue_total_units=queue_total,
            executed_ahead_units=executed,
            cancelled_ahead_units=queue_total,
            observed_at_ms=NOW + observed_offset_ms + index,
            outcome=fill_outcome,
            posture=posture,
            quality=QualityState.COMPLETE
            if posture is EvidencePosture.REPLAY
            else QualityState.SYNTHETIC,
        )
        for index, (
            name,
            duration,
            fill_outcome,
            queue_ahead,
            queue_total,
            executed,
        ) in enumerate(specs)
    )


def passive_fill_challenger(
    training: tuple[PassiveFillObservationV1, ...],
) -> PassiveFillChallengerV1:
    config = PassiveFillFitConfigV1(
        model_revision="l065.passive-fill.v1",
        grid=TimeGridV1(
            "l065.passive-fill.grid.v1",
            (1_000_000_000, 2_000_000_000, 3_000_000_000),
        ),
        minimum_observations=4,
        minimum_fills=2,
        maximum_censor_fraction_micros=500_000,
    )
    return fit_passive_fill_challenger(training, config)


def passive_fill_corpus(
    *,
    reality: OutcomeReality = OutcomeReality.REPLAY,
) -> RecordedOutcomeCorpusV1:
    source = corpus(reality=reality)
    return replace(
        source,
        corpus_id="l068.passive-fill-heldout",
        corpus_revision=f"l068.passive-fill-heldout.{reality.value.lower()}.v1",
        records=tuple(
            replace(
                item,
                model_id="passive-fill",
                model_revision="l065.passive-fill.v1",
            )
            for item in source.records
        ),
    )


def passive_fill_report(
    heldout: RecordedOutcomeCorpusV1,
) -> RecordedCalibrationReportV1:
    return evaluate_recorded_calibration(
        report_id=f"l068.passive-fill-report.{heldout.records[0].reality.value.lower()}.v1",
        slot_id="passive-fill-calibration",
        corpus=heldout,
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
    assert result.mean_absolute_cost_residual_micros == 10
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


def test_store_owned_chronological_receipt_is_the_only_passive_fill_promotion_path(
    tmp_path: Path,
) -> None:
    now = [NOW + 100]
    training = passive_fill_training_observations()
    challenger = passive_fill_challenger(training)
    heldout = passive_fill_corpus()
    heldout_report = passive_fill_report(heldout)
    with ResearchRegistryStore(
        tmp_path,
        passive_fill_calibration_owner_id=PASSIVE_FILL_CALIBRATION_OWNER_ID,
        passive_fill_calibration_owner_revision=PASSIVE_FILL_CALIBRATION_OWNER_REVISION,
        passive_fill_calibration_clock=lambda: now[0],
        passive_fill_calibration_receipt_ttl_ms=10_000,
    ) as store:
        store.record_recorded_calibration_report(heldout_report, corpus=heldout)
        with pytest.raises(RegistryConflictError, match="held-out calibration receipt"):
            store.promote_recorded_calibration(
                report=heldout_report,
                transition_id="l068.passive-fill.bypass.v1",
                expected_generation=0,
                now_ms=now[0],
            )
        receipt = store.record_passive_fill_held_out_calibration_receipt(
            receipt_id="l068.passive-fill-receipt.v1",
            challenger=challenger,
            training_observations=training,
            report=heldout_report,
            corpus=heldout,
            transition_id="l068.passive-fill-promote.v1",
            expected_generation=0,
        )
        assert receipt.completeness is PassiveFillCalibrationCompleteness.COMPLETE
        assert receipt.mode is PassiveFillCalibrationMode.CHRONOLOGICAL_HELD_OUT
        assert receipt.challenger_sha256 == challenger.content_digest
        assert receipt.report_sha256 == heldout_report.content_digest
        assert receipt.corpus_sha256 == heldout.content_digest
        assert (
            store.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
            == receipt
        )
        promoted = store.promote_passive_fill_challenger(
            receipt_revision=receipt.receipt_revision,
            challenger=challenger,
            training_observations=training,
            report=heldout_report,
            corpus=heldout,
        )
        assert promoted.generation == 1
        assert promoted.report_revision == receipt.report_revision
        assert (
            store.promote_passive_fill_challenger(
                receipt_revision=receipt.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
            == promoted
        )

    with ResearchRegistryStore(
        tmp_path,
        passive_fill_calibration_owner_id=PASSIVE_FILL_CALIBRATION_OWNER_ID,
        passive_fill_calibration_owner_revision=PASSIVE_FILL_CALIBRATION_OWNER_REVISION,
        passive_fill_calibration_clock=lambda: now[0],
        passive_fill_calibration_receipt_ttl_ms=10_000,
    ) as restarted:
        assert (
            restarted.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
            == receipt
        )


def test_passive_fill_receipt_rejects_foreign_partial_stale_and_overlapping_evidence(
    tmp_path: Path,
) -> None:
    for suffix, owner_id, owner_revision in (
        (
            "owner",
            "foreign.recorded-outcomes",
            PASSIVE_FILL_CALIBRATION_OWNER_REVISION,
        ),
        (
            "revision",
            PASSIVE_FILL_CALIBRATION_OWNER_ID,
            "l068.recorded-outcomes.v999",
        ),
    ):
        root = tmp_path / suffix
        root.mkdir()
        with pytest.raises(ContractValueError, match="owner identity is not canonical"):
            ResearchRegistryStore(
                root,
                passive_fill_calibration_owner_id=owner_id,
                passive_fill_calibration_owner_revision=owner_revision,
                passive_fill_calibration_clock=lambda: NOW + 100,
                passive_fill_calibration_receipt_ttl_ms=10_000,
            )

    now = [NOW + 100]
    training = passive_fill_training_observations()
    challenger = passive_fill_challenger(training)
    heldout = passive_fill_corpus()
    heldout_report = passive_fill_report(heldout)
    with ResearchRegistryStore(
        tmp_path,
        passive_fill_calibration_owner_id=PASSIVE_FILL_CALIBRATION_OWNER_ID,
        passive_fill_calibration_owner_revision=PASSIVE_FILL_CALIBRATION_OWNER_REVISION,
        passive_fill_calibration_clock=lambda: now[0],
        passive_fill_calibration_receipt_ttl_ms=10_000,
    ) as store:
        store.record_recorded_calibration_report(heldout_report, corpus=heldout)
        receipt = store.record_passive_fill_held_out_calibration_receipt(
            receipt_id="l068.passive-fill-hostile-receipt.v1",
            challenger=challenger,
            training_observations=training,
            report=heldout_report,
            corpus=heldout,
            transition_id="l068.passive-fill-hostile-promote.v1",
            expected_generation=0,
        )
        with pytest.raises(RegistryConflictError, match="not persisted"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=f"sha256:{'f' * 64}",
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
        changed_challenger = replace(
            challenger,
            source_revisions=("caller-forged.revision.v999",),
        )
        with pytest.raises(RegistryConflictError, match="exact training observations"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=changed_challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
        changed_training = (
            replace(training[0], executed_ahead_units=0),
            *training[1:],
        )
        changed_training_challenger = passive_fill_challenger(changed_training)
        with pytest.raises(RegistryConflictError, match="exact evidence"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=changed_training_challenger,
                training_observations=changed_training,
                report=heldout_report,
                corpus=heldout,
            )
        changed_heldout = replace(
            heldout,
            corpus_id="l068.passive-fill-changed-heldout",
            corpus_revision="l068.passive-fill-changed-heldout.v2",
        )
        changed_report = evaluate_recorded_calibration(
            report_id="l068.passive-fill-changed-report.v2",
            slot_id="passive-fill-calibration",
            corpus=changed_heldout,
            policy=policy(),
        )
        store.record_recorded_calibration_report(changed_report, corpus=changed_heldout)
        with pytest.raises(RegistryConflictError, match="exact evidence"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=changed_report,
                corpus=changed_heldout,
            )
        with pytest.raises(ContractValueError, match="mode must be CHRONOLOGICAL_HELD_OUT"):
            replace(receipt, mode=PassiveFillCalibrationMode.RANDOM_SPLIT)
        wrong_version = receipt.as_mapping()
        wrong_version["version"] = 2
        with pytest.raises(ContractValueError, match="schema/version mismatch"):
            PassiveFillHeldOutCalibrationReceiptV1.from_mapping(wrong_version)

        overlapping = replace(
            heldout,
            corpus_id="l068.passive-fill-overlap",
            corpus_revision="l068.passive-fill-overlap.v1",
            records=(
                replace(heldout.records[0], event_id=training[0].event_id),
                *heldout.records[1:],
            ),
        )
        overlapping_report = evaluate_recorded_calibration(
            report_id="l068.passive-fill-overlap-report.v1",
            slot_id="passive-fill-calibration",
            corpus=overlapping,
            policy=policy(),
        )
        with pytest.raises(RegistryConflictError, match="events overlap"):
            store.record_passive_fill_held_out_calibration_receipt(
                receipt_id="l068.passive-fill-overlap-receipt.v1",
                challenger=challenger,
                training_observations=training,
                report=overlapping_report,
                corpus=overlapping,
                transition_id="l068.passive-fill-overlap-promote.v1",
                expected_generation=0,
            )
        late_training = passive_fill_training_observations(observed_offset_ms=-1_000)
        with pytest.raises(RegistryConflictError, match="chronological held-out"):
            store.record_passive_fill_held_out_calibration_receipt(
                receipt_id="l068.passive-fill-late-training.v1",
                challenger=passive_fill_challenger(late_training),
                training_observations=late_training,
                report=heldout_report,
                corpus=heldout,
                transition_id="l068.passive-fill-late-promote.v1",
                expected_generation=0,
            )
        partial_report = evaluate_recorded_calibration(
            report_id="l068.passive-fill-partial.v1",
            slot_id="passive-fill-calibration",
            corpus=replace(
                heldout,
                corpus_id="l068.passive-fill-partial",
                corpus_revision="l068.passive-fill-partial.v1",
                records=heldout.records[:1],
            ),
            policy=policy(),
        )
        with pytest.raises(RegistryConflictError, match="complete research-only"):
            store.record_passive_fill_held_out_calibration_receipt(
                receipt_id="l068.passive-fill-partial-receipt.v1",
                challenger=challenger,
                training_observations=training,
                report=partial_report,
                corpus=replace(
                    heldout,
                    corpus_id="l068.passive-fill-partial",
                    corpus_revision="l068.passive-fill-partial.v1",
                    records=heldout.records[:1],
                ),
                transition_id="l068.passive-fill-partial-promote.v1",
                expected_generation=0,
            )
        synthetic_training = passive_fill_training_observations(posture=EvidencePosture.SYNTHETIC)
        with pytest.raises(RegistryConflictError, match="not research-ready"):
            store.record_passive_fill_held_out_calibration_receipt(
                receipt_id="l068.passive-fill-synthetic-training.v1",
                challenger=passive_fill_challenger(synthetic_training),
                training_observations=synthetic_training,
                report=heldout_report,
                corpus=heldout,
                transition_id="l068.passive-fill-synthetic-training-promote.v1",
                expected_generation=0,
            )
        hypothetical = passive_fill_corpus(reality=OutcomeReality.HYPOTHETICAL)
        hypothetical_report = passive_fill_report(hypothetical)
        with pytest.raises(RegistryConflictError, match="complete research-only"):
            store.record_passive_fill_held_out_calibration_receipt(
                receipt_id="l068.passive-fill-synthetic-heldout.v1",
                challenger=challenger,
                training_observations=training,
                report=hypothetical_report,
                corpus=hypothetical,
                transition_id="l068.passive-fill-synthetic-heldout-promote.v1",
                expected_generation=0,
            )

        partial = replace(
            receipt,
            completeness=PassiveFillCalibrationCompleteness.PARTIAL,
        )
        partial_body = canonical_json_bytes(partial.as_mapping())
        connection = store._require_open()
        connection.execute(
            "UPDATE passive_fill_calibration_receipts SET "
            "receipt_revision=?,body_sha=?,body=? WHERE receipt_id=?",
            (
                partial.receipt_revision,
                partial.content_digest.hexdigest,
                partial_body,
                partial.receipt_id,
            ),
        )
        with pytest.raises(RegistryConflictError, match="exact evidence"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=partial.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
        connection.execute(
            "UPDATE passive_fill_calibration_receipts SET "
            "receipt_revision=?,body_sha=?,body=? WHERE receipt_id=?",
            (
                receipt.receipt_revision,
                receipt.content_digest.hexdigest,
                canonical_json_bytes(receipt.as_mapping()),
                receipt.receipt_id,
            ),
        )
        now[0] = receipt.expires_at_ms + 1
        with pytest.raises(RegistryConflictError, match="stale"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )

        now[0] = receipt.issued_at_ms
        generic = report()
        store.record_recorded_calibration_report(generic, corpus=corpus())
        store.promote_recorded_calibration(
            report=generic,
            transition_id="l068.foreign-generation.v1",
            expected_generation=0,
            now_ms=now[0],
        )
        with pytest.raises(RegistryConflictError, match="generation is stale"):
            store.verify_passive_fill_promotion_authority(
                receipt_revision=receipt.receipt_revision,
                challenger=challenger,
                training_observations=training,
                report=heldout_report,
                corpus=heldout,
            )
