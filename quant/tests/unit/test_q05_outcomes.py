from __future__ import annotations

import pytest

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.errors import ContractValueError
from quant_edge.labels.identity import SampleIdentityV1, VersionSetV1, make_sample_identity
from quant_edge.labels.outcomes import (
    HORIZON_GRID_NS,
    BarrierSpecV1,
    CostedOutcomeV1,
    CostScenarioV1,
    ExcursionOutcomeV1,
    FirstPassageOutcomeV1,
    HorizonOutcomeV1,
    OutcomeDefinitionV1,
    OutcomeStatus,
    PassageBarrier,
    ResidualOutcomeV1,
    SampleOutcomesV1,
    SpreadOutcomeV1,
    compute_sample_outcomes,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    GapIntervalV1,
    PricePointV1,
    QuotePointV1,
    SeriesKind,
)
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _scaled(coefficient: int, scale: int = 2) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


def _point(offset_s: int, coefficient: int, ordinal: int) -> PricePointV1:
    return PricePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(coefficient),
    )


def _quote(offset_s: int, bid: int, ask: int, ordinal: int) -> QuotePointV1:
    return QuotePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        bid=_scaled(bid),
        ask=_scaled(ask),
    )


def _market_identity(symbol: str, *, base_unit: str = "BNB") -> InstrumentIdentityV1:
    return InstrumentIdentityV1(
        instrument_id=f"test-{symbol}",
        base_size_unit_id=base_unit,
        quote_price_unit_id="USDT",
    )


def _series(
    points: tuple[PricePointV1, ...],
    *,
    symbol: str = "BNBUSDT",
    end_s: int = 7_200,
    gaps: tuple[GapIntervalV1, ...] = (),
    series_id: str = "series-1",
    base_unit: str = "BNB",
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol=symbol,
        instrument=_market_identity(symbol, base_unit=base_unit),
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=gaps,
    )


def _quote_series(points: tuple[QuotePointV1, ...]) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id="series-q",
        symbol="BNBUSDT",
        instrument=_market_identity("BNBUSDT"),
        kind=SeriesKind.EXECUTABLE_QUOTES,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        price_points=(),
        quote_points=points,
        known_gaps=(),
    )


def _instrument() -> PointInTimeInstrumentV1:
    return PointInTimeInstrumentV1(
        venue="binance",
        product="spot",
        symbol="BNBUSDT",
        base_asset_id="UNKNOWN_BASE",
        quote_asset_id="UNKNOWN_QUOTE",
        instrument_version="archive-v1",
        observed_at_ns=BASE_NS,
        missing_identity_fields=("base_asset_id", "quote_asset_id"),
    )


def _sample(*, horizon_s: int = 3_600) -> SampleIdentityV1:
    return make_sample_identity(
        event_id="event-1",
        cohort_id="cohort-1",
        instrument=_instrument(),
        feature_lookback_start_ns=BASE_NS - 60 * SECOND_NS,
        feature_cutoff_ns=BASE_NS,
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + horizon_s * SECOND_NS,
        source_completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        source_completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        versions=VersionSetV1(
            dataset_version="ds-v1",
            feature_version="feat-v1",
            label_definition_version="label-v1",
            cost_assumption_version="cost-v1",
            execution_assumption_version="exec-v1",
        ),
    )


def _definition() -> OutcomeDefinitionV1:
    return OutcomeDefinitionV1(
        definition_version="outcome-v1",
        max_reference_staleness_ns=60 * SECOND_NS,
    )


def _barriers() -> BarrierSpecV1:
    return BarrierSpecV1(
        spec_version="barrier-v1",
        up_ratio=make_ratio(1, 200),
        down_ratio=make_ratio(-1, 200),
    )


def _scenarios() -> tuple[CostScenarioV1, ...]:
    return (
        CostScenarioV1(
            scenario_version="cost-a",
            total_cost_ratio=make_ratio(1, 1_000),
            submission_latency_ns=2 * SECOND_NS,
        ),
    )


DEFAULT_POINTS = (
    _point(-10, 10_000, 1),
    _point(1, 10_100, 2),
    _point(30, 9_900, 3),
    _point(3_600, 10_200, 4),
)


def _compute(
    series: EvidenceSeriesV1,
    *,
    sample: SampleIdentityV1 | None = None,
    market_series: EvidenceSeriesV1 | None = None,
) -> SampleOutcomesV1:
    return compute_sample_outcomes(
        sample or _sample(),
        series,
        definition=_definition(),
        barriers=_barriers(),
        cost_scenarios=_scenarios(),
        market_series=market_series,
    )


def _by_horizon(outcomes: SampleOutcomesV1) -> dict[int, HorizonOutcomeV1]:
    return {outcome.horizon_ns: outcome for outcome in outcomes.horizons}


class TestHorizonOutcomes:
    def test_full_grid_over_complete_evidence(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS))
        horizons = _by_horizon(outcomes)

        assert [outcome.horizon_ns for outcome in outcomes.horizons] == list(HORIZON_GRID_NS)
        assert horizons[SECOND_NS].gross_return == make_ratio(1, 100)
        assert horizons[5 * SECOND_NS].gross_return == make_ratio(1, 100)
        assert horizons[30 * SECOND_NS].gross_return == make_ratio(-1, 100)
        assert horizons[60 * SECOND_NS].gross_return == make_ratio(-1, 100)
        assert horizons[3_600 * SECOND_NS].gross_return == make_ratio(1, 50)
        assert all(outcome.status is OutcomeStatus.AVAILABLE for outcome in outcomes.horizons)
        assert outcomes.outcome_id.startswith("q05outcome:")

    def test_identical_inputs_are_byte_deterministic(self) -> None:
        first = _compute(_series(DEFAULT_POINTS))
        second = _compute(_series(DEFAULT_POINTS))

        assert first.canonical_bytes() == second.canonical_bytes()
        assert first.content_sha256 == second.content_sha256

    def test_horizons_beyond_the_label_interval_are_unavailable(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS), sample=_sample(horizon_s=60))
        horizons = _by_horizon(outcomes)

        assert horizons[60 * SECOND_NS].status is OutcomeStatus.AVAILABLE
        assert horizons[300 * SECOND_NS].status is OutcomeStatus.UNAVAILABLE
        assert horizons[3_600 * SECOND_NS].status is OutcomeStatus.UNAVAILABLE

    def test_stale_or_missing_reference_is_unavailable(self) -> None:
        late_start = (_point(10, 10_000, 1),)
        stale = (_point(-90, 10_000, 1), _point(3_600, 10_200, 2))

        for points in (late_start, stale):
            outcomes = _compute(_series(points))
            assert all(outcome.status is OutcomeStatus.UNAVAILABLE for outcome in outcomes.horizons)
            assert outcomes.excursion.status is OutcomeStatus.UNAVAILABLE
            assert outcomes.first_passage.status is OutcomeStatus.UNAVAILABLE

    def test_gap_in_window_is_data_invalid(self) -> None:
        gap = GapIntervalV1(
            start_ns=BASE_NS + 10 * SECOND_NS,
            end_ns=BASE_NS + 20 * SECOND_NS,
        )
        outcomes = _compute(_series(DEFAULT_POINTS, gaps=(gap,)))
        horizons = _by_horizon(outcomes)

        assert horizons[SECOND_NS].status is OutcomeStatus.AVAILABLE
        assert horizons[30 * SECOND_NS].status is OutcomeStatus.DATA_INVALID
        assert horizons[3_600 * SECOND_NS].status is OutcomeStatus.DATA_INVALID
        assert outcomes.excursion.status is OutcomeStatus.DATA_INVALID
        assert outcomes.first_passage.status is OutcomeStatus.DATA_INVALID

    def test_incomplete_evidence_is_censored(self) -> None:
        points = (_point(-10, 10_000, 1), _point(1, 10_100, 2))
        outcomes = _compute(_series(points, end_s=90))
        horizons = _by_horizon(outcomes)

        assert horizons[60 * SECOND_NS].status is OutcomeStatus.AVAILABLE
        censored = horizons[300 * SECOND_NS]
        assert censored.status is OutcomeStatus.CENSORED
        assert censored.censor_time_ns == BASE_NS + 90 * SECOND_NS
        assert outcomes.excursion.status is OutcomeStatus.CENSORED

    def test_quiet_complete_window_carries_reference_forward(self) -> None:
        points = (_point(-10, 10_000, 1),)
        outcomes = _compute(_series(points))
        horizons = _by_horizon(outcomes)

        assert horizons[SECOND_NS].gross_return == make_ratio(0, 1)
        excursion = outcomes.excursion
        assert excursion.status is OutcomeStatus.AVAILABLE
        assert excursion.max_upside == make_ratio(0, 1)
        assert excursion.max_downside == make_ratio(0, 1)
        assert excursion.time_to_max_upside_ns == 0
        assert excursion.time_to_max_downside_ns == 0


class TestExcursionAndPassage:
    def test_excursion_values_and_times(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS))
        excursion = outcomes.excursion

        assert excursion.status is OutcomeStatus.AVAILABLE
        assert excursion.max_upside == make_ratio(1, 50)
        assert excursion.max_downside == make_ratio(-1, 100)
        assert excursion.time_to_max_upside_ns == 3_600 * SECOND_NS
        assert excursion.time_to_max_downside_ns == 30 * SECOND_NS

    def test_one_sided_excursion_clamps_at_zero(self) -> None:
        points = (_point(-10, 10_000, 1), _point(5, 10_300, 2))
        excursion = _compute(_series(points)).excursion

        assert excursion.max_upside == make_ratio(3, 100)
        assert excursion.max_downside == make_ratio(0, 1)
        assert excursion.time_to_max_downside_ns == 0

    def test_first_passage_up_and_down(self) -> None:
        up = _compute(_series(DEFAULT_POINTS)).first_passage
        assert up.status is OutcomeStatus.AVAILABLE
        assert up.barrier is PassageBarrier.UP
        assert up.passage_time_ns == BASE_NS + SECOND_NS

        down_points = (_point(-10, 10_000, 1), _point(5, 9_900, 2))
        down = _compute(_series(down_points)).first_passage
        assert down.barrier is PassageBarrier.DOWN
        assert down.passage_time_ns == BASE_NS + 5 * SECOND_NS

    def test_first_passage_censoring(self) -> None:
        quiet = (_point(-10, 10_000, 1), _point(5, 10_001, 2))
        censored_at_end = _compute(_series(quiet)).first_passage
        assert censored_at_end.status is OutcomeStatus.CENSORED
        assert censored_at_end.censor_time_ns == BASE_NS + 3_600 * SECOND_NS

        censored_early = _compute(_series(quiet, end_s=90)).first_passage
        assert censored_early.censor_time_ns == BASE_NS + 90 * SECOND_NS


class TestCostedOutcomes:
    def test_net_and_decay_under_latency(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS))
        costed = {
            outcome.horizon_ns: outcome
            for outcome in outcomes.costed
            if outcome.scenario_version == "cost-a"
        }

        assert costed[SECOND_NS].status is OutcomeStatus.UNAVAILABLE
        five = costed[5 * SECOND_NS]
        assert five.status is OutcomeStatus.AVAILABLE
        assert five.gross_return == make_ratio(0, 1)
        assert five.net_return == make_ratio(-1, 1_000)
        assert five.opportunity_decay == make_ratio(1, 100)

    def test_costed_censoring_and_invalid(self) -> None:
        points = (_point(-10, 10_000, 1), _point(1, 10_100, 2))
        censored = _compute(_series(points, end_s=90)).costed
        assert any(outcome.status is OutcomeStatus.CENSORED for outcome in censored)

        gap = GapIntervalV1(
            start_ns=BASE_NS + 10 * SECOND_NS,
            end_ns=BASE_NS + 20 * SECOND_NS,
        )
        invalid = _compute(_series(DEFAULT_POINTS, gaps=(gap,))).costed
        assert any(outcome.status is OutcomeStatus.DATA_INVALID for outcome in invalid)

    def test_missing_delayed_reference_is_unavailable(self) -> None:
        points = (
            PricePointV1(
                event_time_ns=BASE_NS - 61 * SECOND_NS,
                ordinal=1,
                price=_scaled(10_000),
            ),
            _point(3_600, 10_200, 2),
        )
        series = EvidenceSeriesV1(
            series_id="series-1",
            symbol="BNBUSDT",
            instrument=_market_identity("BNBUSDT"),
            kind=SeriesKind.TRADE_MID_PROXY,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS - 120 * SECOND_NS,
            completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
            price_points=points,
            quote_points=(),
            known_gaps=(),
        )
        outcomes = _compute(series)

        assert all(outcome.status is OutcomeStatus.UNAVAILABLE for outcome in outcomes.costed)


class TestSpreadAndResidual:
    def test_price_series_has_no_spread_truth(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS))

        assert all(outcome.status is OutcomeStatus.UNAVAILABLE for outcome in outcomes.spreads)
        assert outcomes.executable_capacity_status is OutcomeStatus.UNAVAILABLE
        assert outcomes.depth_deterioration_status is OutcomeStatus.UNAVAILABLE

    def test_quote_series_spread_and_mid_returns(self) -> None:
        quotes = (
            _quote(-10, 9_900, 10_100, 1),
            _quote(5, 9_990, 10_210, 2),
        )
        outcomes = _compute(_quote_series(quotes))
        horizons = _by_horizon(outcomes)
        spreads = {outcome.horizon_ns: outcome for outcome in outcomes.spreads}

        assert horizons[SECOND_NS].gross_return == make_ratio(0, 1)
        assert horizons[5 * SECOND_NS].gross_return == make_ratio(1, 100)
        spread = spreads[5 * SECOND_NS]
        assert spread.status is OutcomeStatus.AVAILABLE
        assert spread.entry_spread == make_ratio(2, 100)
        assert spread.exit_spread == make_ratio(220, 10_100)
        assert spread.spread_change == make_ratio(220 * 100 - 2 * 10_100, 100 * 10_100)
        assert spread.executable_return == make_ratio(9_990 - 10_100, 10_100)
        assert spreads[SECOND_NS].entry_spread == spreads[SECOND_NS].exit_spread

    def test_residuals_require_a_market_series(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS))
        assert all(outcome.status is OutcomeStatus.UNAVAILABLE for outcome in outcomes.residuals)

    def test_residuals_subtract_market_returns(self) -> None:
        market_points = (
            _point(-10, 20_000, 1),
            _point(1, 20_100, 2),
        )
        market = _series(market_points, series_id="series-m")
        outcomes = _compute(_series(DEFAULT_POINTS), market_series=market)
        residuals = {outcome.horizon_ns: outcome for outcome in outcomes.residuals}

        one = residuals[SECOND_NS]
        assert one.status is OutcomeStatus.AVAILABLE
        assert one.sample_return == make_ratio(1, 100)
        assert one.market_return == make_ratio(1, 200)
        assert one.residual_return == make_ratio(1, 200)

    def test_residual_status_combination(self) -> None:
        market_points = (_point(-10, 20_000, 1), _point(1, 20_100, 2))
        market_censored = _series(market_points, end_s=90, series_id="series-m")
        outcomes = _compute(_series(DEFAULT_POINTS), market_series=market_censored)
        residuals = {outcome.horizon_ns: outcome for outcome in outcomes.residuals}

        assert residuals[SECOND_NS].status is OutcomeStatus.AVAILABLE
        late = residuals[300 * SECOND_NS]
        assert late.status is OutcomeStatus.CENSORED
        assert late.censor_time_ns == BASE_NS + 90 * SECOND_NS

        gap = GapIntervalV1(
            start_ns=BASE_NS + 10 * SECOND_NS,
            end_ns=BASE_NS + 20 * SECOND_NS,
        )
        market_invalid = _series(market_points, gaps=(gap,), series_id="series-m")
        invalid = _compute(_series(DEFAULT_POINTS), market_series=market_invalid)
        assert any(outcome.status is OutcomeStatus.DATA_INVALID for outcome in invalid.residuals)


class TestEngineContracts:
    def test_input_type_and_shape_rejections(self) -> None:
        series = _series(DEFAULT_POINTS)
        sample = _sample()
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                "sample",  # type: ignore[arg-type]
                series,
                definition=_definition(),
                barriers=_barriers(),
                cost_scenarios=_scenarios(),
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                "series",  # type: ignore[arg-type]
                definition=_definition(),
                barriers=_barriers(),
                cost_scenarios=_scenarios(),
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                series,
                definition="definition",  # type: ignore[arg-type]
                barriers=_barriers(),
                cost_scenarios=_scenarios(),
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                series,
                definition=_definition(),
                barriers="barriers",  # type: ignore[arg-type]
                cost_scenarios=_scenarios(),
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                series,
                definition=_definition(),
                barriers=_barriers(),
                cost_scenarios=(),
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                series,
                definition=_definition(),
                barriers=_barriers(),
                cost_scenarios=(_scenarios()[0], _scenarios()[0]),
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                series,
                definition=_definition(),
                barriers=_barriers(),
                cost_scenarios=_scenarios(),
                market_series="market",  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError):
            compute_sample_outcomes(
                sample,
                _series(DEFAULT_POINTS, symbol="ETHUSDT", base_unit="ETH"),
                definition=_definition(),
                barriers=_barriers(),
                cost_scenarios=_scenarios(),
            )

    def test_definition_barrier_and_scenario_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            OutcomeDefinitionV1(definition_version="", max_reference_staleness_ns=1)
        with pytest.raises(ContractValueError):
            OutcomeDefinitionV1(definition_version="v1", max_reference_staleness_ns=0)
        with pytest.raises(ContractValueError):
            OutcomeDefinitionV1(
                definition_version="v1",
                max_reference_staleness_ns=1,
                horizons_ns=(),
            )
        with pytest.raises(ContractValueError):
            OutcomeDefinitionV1(
                definition_version="v1",
                max_reference_staleness_ns=1,
                horizons_ns=(5, 5),
            )
        with pytest.raises(ContractValueError):
            BarrierSpecV1(
                spec_version="v1",
                up_ratio=make_ratio(0, 1),
                down_ratio=make_ratio(-1, 2),
            )
        with pytest.raises(ContractValueError):
            BarrierSpecV1(
                spec_version="v1",
                up_ratio=make_ratio(1, 2),
                down_ratio=make_ratio(0, 1),
            )
        with pytest.raises(ContractValueError):
            BarrierSpecV1(spec_version="v1", up_ratio="up", down_ratio=make_ratio(-1, 2))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            CostScenarioV1(
                scenario_version="v1",
                total_cost_ratio=make_ratio(-1, 2),
                submission_latency_ns=0,
            )
        with pytest.raises(ContractValueError):
            CostScenarioV1(
                scenario_version="v1",
                total_cost_ratio="cost",  # type: ignore[arg-type]
                submission_latency_ns=0,
            )

    def test_record_status_shape_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            HorizonOutcomeV1(
                horizon_ns=1,
                status=OutcomeStatus.AVAILABLE,
                gross_return=None,
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            HorizonOutcomeV1(
                horizon_ns=1,
                status=OutcomeStatus.UNAVAILABLE,
                gross_return=make_ratio(1, 2),
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            HorizonOutcomeV1(
                horizon_ns=1,
                status=OutcomeStatus.CENSORED,
                gross_return=None,
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            HorizonOutcomeV1(
                horizon_ns=1,
                status=OutcomeStatus.AVAILABLE,
                gross_return=make_ratio(1, 2),
                censor_time_ns=BASE_NS,
            )
        with pytest.raises(ContractValueError):
            HorizonOutcomeV1(
                horizon_ns=1,
                status="AVAILABLE",  # type: ignore[arg-type]
                gross_return=make_ratio(1, 2),
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            ExcursionOutcomeV1(
                status=OutcomeStatus.AVAILABLE,
                max_upside=make_ratio(1, 2),
                max_downside=None,
                time_to_max_upside_ns=None,
                time_to_max_downside_ns=None,
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            FirstPassageOutcomeV1(
                status=OutcomeStatus.AVAILABLE,
                barrier=PassageBarrier.UP,
                passage_time_ns=None,
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            CostedOutcomeV1(
                scenario_version="v1",
                horizon_ns=1,
                status=OutcomeStatus.AVAILABLE,
                gross_return=make_ratio(1, 2),
                net_return=None,
                opportunity_decay=None,
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            SpreadOutcomeV1(
                horizon_ns=1,
                status=OutcomeStatus.AVAILABLE,
                entry_spread=make_ratio(1, 2),
                exit_spread=None,
                spread_change=None,
                executable_return=None,
                censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            ResidualOutcomeV1(
                horizon_ns=1,
                status=OutcomeStatus.AVAILABLE,
                sample_return=make_ratio(1, 2),
                market_return=None,
                residual_return=None,
                censor_time_ns=None,
            )

    def test_outcome_identity_is_tamper_evident(self) -> None:
        outcomes = _compute(_series(DEFAULT_POINTS))
        with pytest.raises(ContractValueError):
            SampleOutcomesV1(
                outcome_id="q05outcome:forged",
                sample=outcomes.sample,
                definition=outcomes.definition,
                barriers=outcomes.barriers,
                series_kind=outcomes.series_kind,
                series_digest=outcomes.series_digest,
                pre_cutoff_digest=outcomes.pre_cutoff_digest,
                horizons=outcomes.horizons,
                excursion=outcomes.excursion,
                first_passage=outcomes.first_passage,
                costed=outcomes.costed,
                spreads=outcomes.spreads,
                residuals=outcomes.residuals,
                executable_capacity_status=OutcomeStatus.UNAVAILABLE,
                depth_deterioration_status=OutcomeStatus.UNAVAILABLE,
            )
        with pytest.raises(ContractValueError):
            SampleOutcomesV1(
                outcome_id=outcomes.outcome_id,
                sample=outcomes.sample,
                definition=outcomes.definition,
                barriers=outcomes.barriers,
                series_kind=outcomes.series_kind,
                series_digest=outcomes.series_digest,
                pre_cutoff_digest=outcomes.pre_cutoff_digest,
                horizons=outcomes.horizons,
                excursion=outcomes.excursion,
                first_passage=outcomes.first_passage,
                costed=outcomes.costed,
                spreads=outcomes.spreads,
                residuals=outcomes.residuals,
                executable_capacity_status=OutcomeStatus.AVAILABLE,
                depth_deterioration_status=OutcomeStatus.UNAVAILABLE,
            )
