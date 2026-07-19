from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops.contracts import OutcomeReality, mapping_digest
from quant_edge.registry_ops.recorded_outcomes import (
    CalibrationAuthority,
    RecordedCalibrationPolicyV1,
    RecordedCalibrationReportV1,
    RecordedComparisonVerdict,
    RecordedOutcomeCorpusV1,
    RecordedOutcomeV1,
    compare_recorded_calibrations,
    evaluate_recorded_calibration,
)
from quant_edge.registry_ops.store import (
    RegistryConflictError,
    RegistryIntegrityError,
    ResearchRegistryStore,
)

NOW = 1_752_100_000_000
SOURCE = DigestV1("b" * 64)
TRUTH = (0, 400_000, 800_000, 1_000_000)


def calibration_policy(*, minimum_records: int = 4) -> RecordedCalibrationPolicyV1:
    return RecordedCalibrationPolicyV1(
        policy_revision="l110.recorded-comparison.v1",
        authority=CalibrationAuthority.RESEARCH_ONLY,
        minimum_records=minimum_records,
        maximum_source_revisions=1,
        maximum_brier_micros=50_000,
        maximum_absolute_bias_micros=150_000,
        maximum_mean_absolute_residual_micros=200_000,
        maximum_mean_absolute_cost_residual_micros=100,
        required_cost_unit="quote-notional-micros.v1",
        required_cost_valuation_asset="USDT",
    )


def calibration_report(
    name: str,
    model_revision: str,
    predictions: tuple[int, ...],
    predicted_cost: int | tuple[int, ...],
    *,
    truth: tuple[int, ...] = TRUTH,
    minimum_records: int = 4,
) -> tuple[RecordedCalibrationReportV1, RecordedOutcomeCorpusV1]:
    predicted_costs = (
        (predicted_cost,) * len(predictions) if isinstance(predicted_cost, int) else predicted_cost
    )
    rows = tuple(
        RecordedOutcomeV1(
            outcome_id=f"l110.outcome.{index:02d}",
            batch_id=f"l110.batch.{index:02d}",
            event_id=f"l110.event.{index:02d}",
            prediction_id=f"l110.prediction.{model_revision}.{index:02d}",
            model_id="recorded-policy-probe",
            model_revision=model_revision,
            source_revision="l110.recorded-replay.v1",
            source_artifact_sha256=SOURCE,
            prediction_micros=predictions[index - 1],
            outcome_micros=truth[index - 1],
            predicted_cost_micros=predicted_costs[index - 1],
            realized_cost_micros=110,
            cost_unit="quote-notional-micros.v1",
            cost_valuation_asset="USDT",
            prediction_cutoff_ms=NOW - 2_000 + index,
            prediction_issued_at_ms=NOW - 1_000 + index,
            observed_at_ms=NOW + index,
            reality=OutcomeReality.REPLAY,
        )
        for index in range(1, len(predictions) + 1)
    )
    corpus = RecordedOutcomeCorpusV1(
        corpus_id=f"l110.corpus.{name}",
        corpus_revision=f"l110.corpus.{name}.v1",
        records=rows,
    )
    return (
        evaluate_recorded_calibration(
            report_id=f"l110.report.{name}.v1",
            slot_id="passive-fill-calibration",
            corpus=corpus,
            policy=calibration_policy(minimum_records=minimum_records),
        ),
        corpus,
    )


def test_same_outcome_challenger_improves_calibration_cost_and_policy(tmp_path: Path) -> None:
    baseline, baseline_corpus = calibration_report(
        "baseline", "passive-fill.baseline.v1", (200_000, 200_000, 600_000, 800_000), 90
    )
    challenger, challenger_corpus = calibration_report(
        "challenger", "passive-fill.challenger.v2", (100_000, 300_000, 700_000, 900_000), 100
    )
    comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.improvement.v1",
        baseline=baseline,
        challenger=challenger,
    )
    assert comparison.verdict is RecordedComparisonVerdict.PASS
    assert comparison.reason_codes == ()
    assert comparison.brier_delta_micros == -30_000
    assert comparison.absolute_bias_delta_micros == -50_000
    assert comparison.mean_absolute_residual_delta_micros == -100_000
    assert comparison.mean_absolute_cost_residual_delta_micros == -10

    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(baseline, corpus=baseline_corpus)
        store.record_recorded_calibration_report(challenger, corpus=challenger_corpus)
        store.record_recorded_calibration_comparison(
            comparison, baseline=baseline, challenger=challenger
        )
        first = store.promote_recorded_calibration(
            report=baseline,
            transition_id="l110.baseline.v1",
            expected_generation=0,
            now_ms=NOW + 100,
        )
        for transition_id, non_monotonic_time in (
            ("l110.challenger.equal-time.v2", NOW + 100),
            ("l110.challenger.backdated-time.v2", NOW - 100),
        ):
            with pytest.raises(RegistryConflictError, match="time must strictly advance"):
                store.promote_recorded_calibration(
                    report=challenger,
                    comparison=comparison,
                    transition_id=transition_id,
                    expected_generation=first.generation,
                    now_ms=non_monotonic_time,
                )
        second = store.promote_recorded_calibration(
            report=challenger,
            comparison=comparison,
            transition_id="l110.challenger.v2",
            expected_generation=first.generation,
            now_ms=NOW + 101,
        )
        assert second.generation == 2
        assert second.report_revision == challenger.report_revision
    with ResearchRegistryStore(tmp_path) as restarted:
        assert restarted.current_recorded_calibration(challenger.slot_id) == second


def test_cost_regression_blocks_even_when_probability_metrics_improve(tmp_path: Path) -> None:
    baseline, baseline_corpus = calibration_report(
        "cost-baseline",
        "passive-fill.cost-baseline.v1",
        (200_000, 200_000, 600_000, 800_000),
        100,
    )
    challenger, challenger_corpus = calibration_report(
        "cost-regression",
        "passive-fill.cost-regression.v2",
        (100_000, 300_000, 700_000, 900_000),
        70,
    )
    comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.cost-regression.v1",
        baseline=baseline,
        challenger=challenger,
    )
    assert comparison.verdict is RecordedComparisonVerdict.FAIL
    assert comparison.reason_codes == ("MEAN_ABSOLUTE_COST_RESIDUAL_REGRESSION",)
    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(baseline, corpus=baseline_corpus)
        store.record_recorded_calibration_report(challenger, corpus=challenger_corpus)
        store.record_recorded_calibration_comparison(
            comparison, baseline=baseline, challenger=challenger
        )
        first = store.promote_recorded_calibration(
            report=baseline,
            transition_id="l110.cost-baseline.v1",
            expected_generation=0,
            now_ms=NOW + 200,
        )
        with pytest.raises(RegistryConflictError, match="does not authorize"):
            store.promote_recorded_calibration(
                report=challenger,
                comparison=comparison,
                transition_id="l110.cost-regression.v2",
                expected_generation=first.generation,
                now_ms=NOW + 201,
            )
        assert store.current_recorded_calibration(baseline.slot_id) == first


def test_changed_outcome_truth_and_missing_comparison_fail_closed(tmp_path: Path) -> None:
    baseline, baseline_corpus = calibration_report(
        "truth-baseline",
        "passive-fill.truth-baseline.v1",
        (200_000, 200_000, 600_000, 800_000),
        90,
    )
    changed_truth, changed_truth_corpus = calibration_report(
        "truth-changed",
        "passive-fill.truth-changed.v2",
        (100_000, 300_000, 700_000, 900_000),
        100,
        truth=(1, *TRUTH[1:]),
    )
    mismatch = compare_recorded_calibrations(
        comparison_id="l110.compare.truth-mismatch.v1",
        baseline=baseline,
        challenger=changed_truth,
    )
    assert mismatch.verdict is RecordedComparisonVerdict.FAIL
    assert "OUTCOME_COHORT_MISMATCH" in mismatch.reason_codes
    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(baseline, corpus=baseline_corpus)
        store.record_recorded_calibration_report(changed_truth, corpus=changed_truth_corpus)
        first = store.promote_recorded_calibration(
            report=baseline,
            transition_id="l110.truth-baseline.v1",
            expected_generation=0,
            now_ms=NOW + 300,
        )
        with pytest.raises(RegistryConflictError, match="requires comparison evidence"):
            store.promote_recorded_calibration(
                report=changed_truth,
                transition_id="l110.missing-comparison.v2",
                expected_generation=first.generation,
                now_ms=NOW + 301,
            )


def test_identical_policy_has_no_strict_improvement_and_forgery_is_rejected(
    tmp_path: Path,
) -> None:
    baseline, baseline_corpus = calibration_report(
        "same-a", "passive-fill.same-a.v1", (100_000, 300_000, 700_000, 900_000), 100
    )
    same, same_corpus = calibration_report(
        "same-b", "passive-fill.same-b.v2", (100_000, 300_000, 700_000, 900_000), 100
    )
    comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.same.v1", baseline=baseline, challenger=same
    )
    assert comparison.verdict is RecordedComparisonVerdict.FAIL
    assert comparison.reason_codes == ("NO_STRICT_IMPROVEMENT",)
    with pytest.raises(ContractValueError, match="PASS comparisons cannot carry reason codes"):
        replace(comparison, verdict=RecordedComparisonVerdict.PASS)
    with pytest.raises(ContractValueError, match="positive regressions"):
        replace(
            comparison,
            verdict=RecordedComparisonVerdict.PASS,
            reason_codes=(),
            brier_delta_micros=1,
            absolute_bias_delta_micros=-1,
            brier_exact_delta_numerator=1,
            absolute_bias_exact_delta_numerator=-1,
        )
    forged = replace(
        comparison,
        verdict=RecordedComparisonVerdict.PASS,
        reason_codes=(),
        brier_delta_micros=-1,
        brier_exact_delta_numerator=-1,
    )
    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(baseline, corpus=baseline_corpus)
        store.record_recorded_calibration_report(same, corpus=same_corpus)
        with pytest.raises(RegistryConflictError, match="exact reports"):
            store.record_recorded_calibration_comparison(forged, baseline=baseline, challenger=same)


def test_opposite_signed_cost_residuals_do_not_cancel() -> None:
    baseline, _ = calibration_report(
        "cost-cancellation-baseline",
        "passive-fill.cost-cancellation-baseline.v1",
        (100_000, 300_000, 700_000, 900_000),
        (10, 210, 10, 210),
    )
    challenger, _ = calibration_report(
        "cost-cancellation-challenger",
        "passive-fill.cost-cancellation-challenger.v2",
        (100_000, 300_000, 700_000, 900_000),
        (60, 160, 60, 160),
    )
    assert baseline.mean_absolute_cost_residual_micros == 100
    assert challenger.mean_absolute_cost_residual_micros == 50
    comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.cost-cancellation.v1",
        baseline=baseline,
        challenger=challenger,
    )
    assert comparison.verdict is RecordedComparisonVerdict.PASS
    assert comparison.mean_absolute_cost_residual_delta_micros == -50

    fractional, _ = calibration_report(
        "cost-fractional",
        "passive-fill.cost-fractional.v1",
        (100_000, 300_000, 700_000, 900_000),
        (111, 110, 110, 110),
    )
    assert fractional.mean_absolute_cost_residual_micros == 1


def test_exact_brier_regression_cannot_hide_behind_rounded_tie(
    tmp_path: Path,
) -> None:
    truth = (1_000, 1_000)
    baseline, baseline_corpus = calibration_report(
        "submicro-brier-baseline",
        "passive-fill.submicro-brier-baseline.v1",
        (500, 500),
        110,
        truth=truth,
        minimum_records=2,
    )
    challenger, challenger_corpus = calibration_report(
        "submicro-brier-regression",
        "passive-fill.submicro-brier-regression.v2",
        (1, 1_001),
        110,
        truth=truth,
        minimum_records=2,
    )
    assert baseline.brier_micros == challenger.brier_micros == 1
    assert baseline.bias_micros == 500
    assert challenger.bias_micros == 499
    comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.submicro-brier-regression.v1",
        baseline=baseline,
        challenger=challenger,
    )
    assert comparison.brier_delta_micros == 0
    assert comparison.absolute_bias_delta_micros == -1
    assert comparison.brier_exact_delta_numerator is not None
    assert comparison.brier_exact_delta_numerator > 0
    assert comparison.verdict is RecordedComparisonVerdict.FAIL
    assert comparison.reason_codes == ("BRIER_REGRESSION",)

    with ResearchRegistryStore(tmp_path) as store:
        forged_baseline = replace(
            baseline,
            brier_numerator_micros_squared=(
                baseline.brier_numerator_micros_squared + 1
                if baseline.brier_numerator_micros_squared is not None
                else None
            ),
        )
        with pytest.raises(RegistryConflictError, match="exact corpus evaluation"):
            store.record_recorded_calibration_report(
                forged_baseline,
                corpus=baseline_corpus,
            )
        store.record_recorded_calibration_report(baseline, corpus=baseline_corpus)
        store.record_recorded_calibration_report(challenger, corpus=challenger_corpus)
        store.record_recorded_calibration_comparison(
            comparison,
            baseline=baseline,
            challenger=challenger,
        )
        first = store.promote_recorded_calibration(
            report=baseline,
            transition_id="l110.submicro-brier-baseline.v1",
            expected_generation=0,
            now_ms=NOW + 600,
        )
        with pytest.raises(RegistryConflictError, match="does not authorize"):
            store.promote_recorded_calibration(
                report=challenger,
                comparison=comparison,
                transition_id="l110.submicro-brier-regression.v2",
                expected_generation=first.generation,
                now_ms=NOW + 601,
            )


def test_exact_cost_regression_and_exact_only_improvement_use_rational_evidence() -> None:
    truth = (1_000, 1_000)
    cost_baseline, _ = calibration_report(
        "submicro-cost-baseline",
        "passive-fill.submicro-cost-baseline.v1",
        (500, 500),
        (109, 110),
        truth=truth,
        minimum_records=2,
    )
    cost_regression, _ = calibration_report(
        "submicro-cost-regression",
        "passive-fill.submicro-cost-regression.v2",
        (600, 600),
        (108, 110),
        truth=truth,
        minimum_records=2,
    )
    assert (
        cost_baseline.mean_absolute_cost_residual_micros
        == cost_regression.mean_absolute_cost_residual_micros
        == 1
    )
    cost_comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.submicro-cost-regression.v1",
        baseline=cost_baseline,
        challenger=cost_regression,
    )
    assert cost_comparison.mean_absolute_cost_residual_delta_micros == 0
    assert cost_comparison.mean_absolute_cost_residual_exact_delta_numerator is not None
    assert cost_comparison.mean_absolute_cost_residual_exact_delta_numerator > 0
    assert cost_comparison.verdict is RecordedComparisonVerdict.FAIL
    assert cost_comparison.reason_codes == ("MEAN_ABSOLUTE_COST_RESIDUAL_REGRESSION",)

    exact_baseline, _ = calibration_report(
        "exact-only-baseline",
        "passive-fill.exact-only-baseline.v1",
        (998, 1_000),
        110,
        truth=truth,
        minimum_records=2,
    )
    exact_challenger, _ = calibration_report(
        "exact-only-challenger",
        "passive-fill.exact-only-challenger.v2",
        (999, 1_000),
        110,
        truth=truth,
        minimum_records=2,
    )
    exact_comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.exact-only-improvement.v1",
        baseline=exact_baseline,
        challenger=exact_challenger,
    )
    assert (
        exact_comparison.brier_delta_micros,
        exact_comparison.absolute_bias_delta_micros,
        exact_comparison.mean_absolute_residual_delta_micros,
        exact_comparison.mean_absolute_cost_residual_delta_micros,
    ) == (0, 0, 0, 0)
    assert exact_comparison.brier_exact_delta_numerator is not None
    assert exact_comparison.brier_exact_delta_numerator < 0
    assert exact_comparison.verdict is RecordedComparisonVerdict.PASS


def test_report_revision_remains_bound_to_exact_persisted_numerators(
    tmp_path: Path,
) -> None:
    truth = (1_000, 1_000)
    baseline, baseline_corpus = calibration_report(
        "persisted-binding-baseline",
        "passive-fill.persisted-binding-baseline.v1",
        (998, 1_000),
        110,
        truth=truth,
        minimum_records=2,
    )
    challenger, challenger_corpus = calibration_report(
        "persisted-binding-challenger",
        "passive-fill.persisted-binding-challenger.v2",
        (999, 1_000),
        110,
        truth=truth,
        minimum_records=2,
    )
    comparison = compare_recorded_calibrations(
        comparison_id="l110.compare.persisted-binding.v1",
        baseline=baseline,
        challenger=challenger,
    )
    assert comparison.verdict is RecordedComparisonVerdict.PASS
    assert baseline.brier_numerator_micros_squared is not None
    resealed_baseline = replace(
        baseline,
        brier_numerator_micros_squared=baseline.brier_numerator_micros_squared + 1,
    )
    resealed_body = canonical_json_bytes(resealed_baseline.as_mapping())
    resealed_sha = mapping_digest(resealed_baseline.as_mapping()).hexdigest

    with ResearchRegistryStore(tmp_path) as store:
        store.record_recorded_calibration_report(baseline, corpus=baseline_corpus)
        store.record_recorded_calibration_report(challenger, corpus=challenger_corpus)
        store.record_recorded_calibration_comparison(
            comparison,
            baseline=baseline,
            challenger=challenger,
        )
        first = store.promote_recorded_calibration(
            report=baseline,
            transition_id="l110.persisted-binding-baseline.v1",
            expected_generation=0,
            now_ms=NOW + 700,
        )
        connection = store._require_open()
        connection.execute(
            "UPDATE recorded_calibration_reports SET body_sha=?,body=? WHERE report_revision=?",
            (resealed_sha, resealed_body, baseline.report_revision),
        )
        connection.commit()

        with pytest.raises(RegistryIntegrityError, match="head and report binding"):
            store.current_recorded_calibration(baseline.slot_id)
        with pytest.raises(RegistryIntegrityError, match="exact persisted report bytes"):
            store.record_recorded_calibration_comparison(
                comparison,
                baseline=baseline,
                challenger=challenger,
            )
        with pytest.raises(RegistryIntegrityError, match="prior report binding"):
            store.promote_recorded_calibration(
                report=challenger,
                comparison=comparison,
                transition_id="l110.persisted-binding-challenger.v2",
                expected_generation=first.generation,
                now_ms=NOW + 701,
            )
