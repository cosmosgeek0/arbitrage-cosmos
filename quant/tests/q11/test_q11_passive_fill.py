from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.contracts import TimeGridV1
from quant_edge.survival.passive_fill import (
    PassiveFillChallengerV1,
    PassiveFillFitConfigV1,
    PassiveFillFitStatus,
    PassiveFillObservationV1,
    PassiveFillOutcome,
    PassiveFillStratumStatus,
    QueuePosition,
    fit_passive_fill_challenger,
)

SECOND = 1_000_000_000
GRID = TimeGridV1("l065.passive-fill.grid.v1", (SECOND, 2 * SECOND, 3 * SECOND))
CONFIG = PassiveFillFitConfigV1(
    model_revision="l065.passive-fill.v1",
    grid=GRID,
    minimum_observations=4,
    minimum_fills=2,
    maximum_censor_fraction_micros=500_000,
)


def observation(
    name: str,
    duration: int,
    outcome: PassiveFillOutcome,
    queue_ahead: int,
    queue_total: int,
    executed: int,
    *,
    posture: EvidencePosture = EvidencePosture.REPLAY,
) -> PassiveFillObservationV1:
    return PassiveFillObservationV1(
        observation_id=f"l065.{name}",
        source_revision="recorded-book-outcomes.v1",
        queue_model_revision="price-time-conservative.v1",
        duration_ns=duration * SECOND,
        queue_ahead_units=queue_ahead,
        queue_total_units=queue_total,
        executed_ahead_units=executed,
        cancelled_ahead_units=queue_total,
        outcome=outcome,
        posture=posture,
        quality=QualityState.COMPLETE
        if posture is EvidencePosture.REPLAY
        else QualityState.SYNTHETIC,
    )


def assert_numeric_fit_is_redacted(result: PassiveFillChallengerV1) -> None:
    assert result.strata is not None
    for stratum in result.strata:
        for item in stratum.bins:
            assert item.status.value == "UNKNOWN"
            assert item.fill_hazard is None
            assert item.survival is None
            assert item.fill_cumulative_incidence is None
            assert item.invalidation_cumulative_incidence is None
            assert item.mean_conservative_queue_progress is None


def test_absent_or_thin_recorded_evidence_has_no_fitted_numbers() -> None:
    absent = fit_passive_fill_challenger((), CONFIG)
    assert absent.status is PassiveFillFitStatus.DATA_INSUFFICIENT
    assert absent.strata is None
    assert absent.reason_codes == (
        "FILL_COUNT_BELOW_MINIMUM",
        "OBSERVATION_COUNT_BELOW_MINIMUM",
        "RECORDED_EVIDENCE_ABSENT",
    )
    thin = fit_passive_fill_challenger(
        (observation("thin", 1, PassiveFillOutcome.FILLED, 1, 10, 1),), CONFIG
    )
    assert thin.status is PassiveFillFitStatus.DATA_INSUFFICIENT
    assert thin.strata is not None
    assert thin.strata[0].status is PassiveFillStratumStatus.UNAVAILABLE
    assert all(item.status.value == "UNKNOWN" for item in thin.strata[0].bins)
    assert all(item.fill_hazard is None for item in thin.strata[0].bins)


def test_recorded_fit_is_queue_stratified_and_cancellations_receive_no_credit() -> None:
    result = fit_passive_fill_challenger(
        (
            observation("near-fill", 1, PassiveFillOutcome.FILLED, 1, 9, 1),
            observation("near-censor", 3, PassiveFillOutcome.RIGHT_CENSORED, 2, 9, 0),
            observation("middle-fill", 2, PassiveFillOutcome.FILLED, 5, 9, 5),
            observation("middle-censor", 3, PassiveFillOutcome.RIGHT_CENSORED, 4, 9, 0),
            observation("deep-invalid", 2, PassiveFillOutcome.INVALIDATED, 8, 9, 0),
            observation("deep-fill", 2, PassiveFillOutcome.FILLED, 7, 9, 7),
        ),
        CONFIG,
    )
    assert result.status is PassiveFillFitStatus.CHALLENGER_READY
    assert result.is_promotable is True
    assert result.reason_codes == ()
    assert result.strata is not None
    assert [item.queue_position for item in result.strata] == [
        QueuePosition.NEAR,
        QueuePosition.MIDDLE,
        QueuePosition.DEEP,
    ]
    near = result.strata[0]
    first_bin = near.bins[0]
    assert first_bin.at_risk == 2
    assert first_bin.fill_hazard is not None
    assert first_bin.survival is not None
    assert first_bin.fill_cumulative_incidence is not None
    assert first_bin.invalidation_cumulative_incidence is not None
    assert first_bin.mean_conservative_queue_progress is not None
    assert first_bin.fill_hazard.mantissa == 500_000_000_000
    assert first_bin.survival.mantissa == 500_000_000_000
    assert first_bin.fill_cumulative_incidence.mantissa == 500_000_000_000
    assert first_bin.invalidation_cumulative_incidence.mantissa == 0
    assert near.bins[1].status.value == "UNKNOWN"
    assert near.bins[1].fill_hazard is None
    # A forged huge cancelled-ahead count adds no queue progress.
    assert first_bin.mean_conservative_queue_progress.mantissa == 55_555_555_556


def test_synthetic_evidence_can_exercise_mechanics_but_cannot_promote() -> None:
    rows = tuple(
        replace(
            item,
            observation_id=f"{item.observation_id}.synthetic",
            posture=EvidencePosture.SYNTHETIC,
            quality=QualityState.SYNTHETIC,
        )
        for item in (
            observation("a", 1, PassiveFillOutcome.FILLED, 1, 9, 1),
            observation("b", 3, PassiveFillOutcome.RIGHT_CENSORED, 2, 9, 0),
            observation("c", 2, PassiveFillOutcome.FILLED, 5, 9, 5),
            observation("d", 3, PassiveFillOutcome.RIGHT_CENSORED, 4, 9, 0),
            observation("e", 2, PassiveFillOutcome.FILLED, 8, 9, 8),
            observation("f", 2, PassiveFillOutcome.INVALIDATED, 7, 9, 0),
        )
    )
    result = fit_passive_fill_challenger(rows, CONFIG)
    assert result.status is PassiveFillFitStatus.SYNTHETIC_ONLY
    assert result.is_promotable is False
    assert result.reason_codes == ("RECORDED_REPLAY_REQUIRED_FOR_PROMOTION",)
    assert result.strata is not None


def test_sparse_strata_use_honest_pooled_fallback_but_never_promote() -> None:
    result = fit_passive_fill_challenger(
        (
            observation("near-fill", 1, PassiveFillOutcome.FILLED, 1, 9, 1),
            observation("near-censor", 3, PassiveFillOutcome.RIGHT_CENSORED, 2, 9, 0),
            observation("middle-only", 2, PassiveFillOutcome.FILLED, 5, 9, 5),
            observation("deep-only", 2, PassiveFillOutcome.INVALIDATED, 8, 9, 0),
        ),
        CONFIG,
    )
    assert result.status is PassiveFillFitStatus.DATA_INSUFFICIENT
    assert result.is_promotable is False
    assert result.reason_codes == ("STRATUM_CALIBRATION_BELOW_MINIMUM",)
    assert result.strata is not None
    assert result.strata[0].status is PassiveFillStratumStatus.CALIBRATED
    assert result.strata[1].status is PassiveFillStratumStatus.POOLED_FALLBACK
    assert result.strata[1].fit_observations == 4
    assert "POOLED_FALLBACK_USED" in result.strata[1].reason_codes


def test_queue_model_revisions_cannot_be_mixed() -> None:
    rows = (
        observation("a", 1, PassiveFillOutcome.FILLED, 1, 9, 1),
        observation("b", 3, PassiveFillOutcome.RIGHT_CENSORED, 2, 9, 0),
        observation("c", 2, PassiveFillOutcome.FILLED, 5, 9, 5),
        observation("d", 3, PassiveFillOutcome.RIGHT_CENSORED, 4, 9, 0),
        observation("e", 2, PassiveFillOutcome.FILLED, 8, 9, 8),
        observation("f", 2, PassiveFillOutcome.INVALIDATED, 7, 9, 0),
    )
    result = fit_passive_fill_challenger(
        (*rows[:-1], replace(rows[-1], queue_model_revision="price-time-conservative.v2")),
        CONFIG,
    )
    assert result.status is PassiveFillFitStatus.UNSTABLE_FIT
    assert result.reason_codes == ("QUEUE_MODEL_REVISION_MIXED",)
    assert_numeric_fit_is_redacted(result)

    fragmented = fit_passive_fill_challenger(
        (*rows[:-1], replace(rows[-1], source_revision="recorded-book-outcomes.v2")),
        replace(CONFIG, maximum_source_revisions=1),
    )
    assert fragmented.status is PassiveFillFitStatus.UNSTABLE_FIT
    assert fragmented.reason_codes == ("SOURCE_REVISION_FRAGMENTED",)
    assert_numeric_fit_is_redacted(fragmented)

    over_censored = fit_passive_fill_challenger(
        rows,
        replace(CONFIG, maximum_censor_fraction_micros=300_000),
    )
    assert over_censored.status is PassiveFillFitStatus.UNSTABLE_FIT
    assert over_censored.reason_codes == ("CENSORING_EXCEEDS_BUDGET",)
    assert_numeric_fit_is_redacted(over_censored)


def test_unstable_and_hostile_observations_fail_closed() -> None:
    censored = tuple(
        observation(f"c{index}", 3, PassiveFillOutcome.RIGHT_CENSORED, index, 10, 0)
        for index in range(4)
    )
    result = fit_passive_fill_challenger(
        censored,
        replace(CONFIG, minimum_fills=1, maximum_censor_fraction_micros=250_000),
    )
    assert result.status is PassiveFillFitStatus.DATA_INSUFFICIENT
    assert result.strata is not None
    assert result.strata[0].status is PassiveFillStratumStatus.UNAVAILABLE
    with pytest.raises(ContractValueError, match="cannot exceed"):
        replace(censored[0], queue_ahead_units=11)
    with pytest.raises(ContractValueError, match="REPLAY observations require COMPLETE"):
        replace(censored[0], quality=QualityState.SYNTHETIC)
    with pytest.raises(ContractValueError, match="unique"):
        fit_passive_fill_challenger((censored[0], censored[0], *censored[2:]), CONFIG)
