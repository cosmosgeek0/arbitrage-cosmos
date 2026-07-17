from __future__ import annotations

import pytest

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.errors import ContractValueError
from quant_edge.labels.basis import (
    BasisConstruction,
    BasisCostAssumptionV1,
    BasisDefinitionV1,
    BasisLabelV1,
    BorrowAssumptionV1,
    BorrowKnownness,
    FundingEventV1,
    compute_basis_label,
)
from quant_edge.labels.controls import ControlMatchSpecV1, WindowFactsV1, match_controls
from quant_edge.labels.disposition import (
    WindowQualityFactsV1,
    derive_disposition,
)
from quant_edge.labels.identity import SampleIdentityV1, VersionSetV1, make_sample_identity
from quant_edge.labels.manifest import make_manifest_member
from quant_edge.labels.outcomes import (
    BarrierSpecV1,
    CostScenarioV1,
    OutcomeDefinitionV1,
    OutcomeStatus,
    SampleOutcomesV1,
    compute_sample_outcomes,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    PricePointV1,
    QuotePointV1,
    SeriesKind,
)
from quant_edge.labels.stages import (
    StageDefinitionV1,
    StageEvidenceV1,
    generate_stage,
)
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
DAY_NS = 86_400_000_000_000

MARKET_IDENTITY = InstrumentIdentityV1(
    instrument_id="test-binance-spot-BNBUSDT",
    base_size_unit_id="BNB",
    quote_price_unit_id="USDT",
)


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


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


def _price_series(
    points: tuple[PricePointV1, ...],
    *,
    series_id: str = "series-1",
    end_s: int = 7_200,
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol="BNBUSDT",
        instrument=InstrumentIdentityV1(
            instrument_id=f"test-{series_id}",
            base_size_unit_id="BNB",
            quote_price_unit_id="USDT",
        ),
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=(),
    )


def _quote_series(
    points: tuple[QuotePointV1, ...],
    *,
    end_s: int = 7_200,
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id="series-q",
        symbol="BNBUSDT",
        instrument=MARKET_IDENTITY,
        kind=SeriesKind.EXECUTABLE_QUOTES,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
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


def _versions() -> VersionSetV1:
    return VersionSetV1(
        dataset_version="ds-v1",
        feature_version="feat-v1",
        label_definition_version="label-v1",
        cost_assumption_version="cost-v1",
        execution_assumption_version="exec-v1",
    )


def _sample() -> SampleIdentityV1:
    return make_sample_identity(
        event_id="event-1",
        cohort_id="cohort-1",
        instrument=_instrument(),
        feature_lookback_start_ns=BASE_NS - 60 * SECOND_NS,
        feature_cutoff_ns=BASE_NS,
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + 3_600 * SECOND_NS,
        source_completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        source_completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        versions=_versions(),
    )


def _compute(series: EvidenceSeriesV1) -> SampleOutcomesV1:
    return compute_sample_outcomes(
        _sample(),
        series,
        definition=OutcomeDefinitionV1(
            definition_version="outcome-v1",
            max_reference_staleness_ns=60 * SECOND_NS,
        ),
        barriers=BarrierSpecV1(
            spec_version="barrier-v1",
            up_ratio=make_ratio(1, 200),
            down_ratio=make_ratio(-1, 200),
        ),
        cost_scenarios=(
            CostScenarioV1(
                scenario_version="cost-a",
                total_cost_ratio=make_ratio(1, 1_000),
                submission_latency_ns=2 * SECOND_NS,
            ),
        ),
    )


class TestOutcomeEdges:
    def test_cost_scenario_serializes_exactly(self) -> None:
        scenario = CostScenarioV1(
            scenario_version="cost-a",
            total_cost_ratio=make_ratio(1, 1_000),
            submission_latency_ns=2 * SECOND_NS,
        )

        assert scenario.as_mapping() == {
            "scenarioVersion": "cost-a",
            "submissionLatencyNs": str(2 * SECOND_NS),
            "totalCostRatio": {"denominator": "1000", "numerator": "1"},
        }

    def test_depth_deterioration_cannot_be_claimed(self) -> None:
        outcomes = _compute(_price_series((_point(-10, 10_000, 1),)))
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
                executable_capacity_status=OutcomeStatus.UNAVAILABLE,
                depth_deterioration_status=OutcomeStatus.AVAILABLE,
            )

    def test_first_passage_ignores_points_beyond_the_label_interval(self) -> None:
        points = (
            _point(-10, 10_000, 1),
            _point(5, 10_001, 2),
            _point(4_000, 12_000, 3),
        )
        passage = _compute(_price_series(points)).first_passage

        assert passage.status is OutcomeStatus.CENSORED
        assert passage.censor_time_ns == BASE_NS + 3_600 * SECOND_NS

    def test_stale_quote_reference_disables_spreads(self) -> None:
        quotes = (
            _quote(-90, 9_900, 10_100, 1),
            _quote(5, 9_990, 10_210, 2),
        )
        outcomes = _compute(_quote_series(quotes))

        assert all(outcome.status is OutcomeStatus.UNAVAILABLE for outcome in outcomes.spreads)

    def test_spread_censoring_over_incomplete_quotes(self) -> None:
        quotes = (
            _quote(-10, 9_900, 10_100, 1),
            _quote(5, 9_990, 10_210, 2),
        )
        outcomes = _compute(_quote_series(quotes, end_s=90))
        spreads = {outcome.horizon_ns: outcome for outcome in outcomes.spreads}

        assert spreads[60 * SECOND_NS].status is OutcomeStatus.AVAILABLE
        late = spreads[300 * SECOND_NS]
        assert late.status is OutcomeStatus.CENSORED
        assert late.censor_time_ns == BASE_NS + 90 * SECOND_NS


class TestIdentityEdges:
    def test_direct_construction_type_checks(self) -> None:
        sample = _sample()
        with pytest.raises(ContractValueError):
            SampleIdentityV1(
                sample_id=sample.sample_id,
                event_id=sample.event_id,
                cohort_id=sample.cohort_id,
                instrument="instrument",  # type: ignore[arg-type]
                feature_lookback_start_ns=sample.feature_lookback_start_ns,
                feature_cutoff_ns=sample.feature_cutoff_ns,
                label_start_ns=sample.label_start_ns,
                label_end_ns=sample.label_end_ns,
                horizon_ns=sample.horizon_ns,
                source_completeness_start_ns=sample.source_completeness_start_ns,
                source_completeness_end_ns=sample.source_completeness_end_ns,
                versions=sample.versions,
            )
        with pytest.raises(ContractValueError):
            SampleIdentityV1(
                sample_id=sample.sample_id,
                event_id=sample.event_id,
                cohort_id=sample.cohort_id,
                instrument=sample.instrument,
                feature_lookback_start_ns=sample.feature_lookback_start_ns,
                feature_cutoff_ns=sample.feature_cutoff_ns,
                label_start_ns=sample.label_start_ns,
                label_end_ns=sample.label_start_ns,
                horizon_ns=1,
                source_completeness_start_ns=sample.source_completeness_start_ns,
                source_completeness_end_ns=sample.source_completeness_end_ns,
                versions=sample.versions,
            )
        with pytest.raises(ContractValueError):
            SampleIdentityV1(
                sample_id=sample.sample_id,
                event_id=sample.event_id,
                cohort_id=sample.cohort_id,
                instrument=sample.instrument,
                feature_lookback_start_ns=sample.feature_lookback_start_ns,
                feature_cutoff_ns=sample.feature_cutoff_ns,
                label_start_ns=sample.label_start_ns,
                label_end_ns=sample.label_end_ns,
                horizon_ns=sample.horizon_ns,
                source_completeness_start_ns=sample.source_completeness_start_ns,
                source_completeness_end_ns=sample.source_completeness_end_ns,
                versions="versions",  # type: ignore[arg-type]
            )


class TestManifestEdges:
    def test_member_builder_type_checks(self) -> None:
        outcomes = _compute(_price_series((_point(-10, 10_000, 1),)))
        disposition = derive_disposition(
            sample_id=outcomes.sample.sample_id,
            event_id=outcomes.sample.event_id,
            quality=WindowQualityFactsV1(
                gap_row_count=0,
                duplicate_row_count=0,
                completeness_known=True,
            ),
            is_control_window=False,
        )
        stage = generate_stage(
            StageEvidenceV1(
                baseline_bucket_counts=(2,),
                window_bucket_counts=(2,),
                net_return_sign=0,
                window_complete=True,
                disorder_observed=False,
            ),
            StageDefinitionV1(
                definition_version="stage-v1",
                dormant_max_count=1,
                ignition_ratio=make_ratio(3, 1),
                continuation_floor_ratio=make_ratio(2, 1),
                fade_ceiling_ratio=make_ratio(1, 2),
            ),
        )
        with pytest.raises(ContractValueError):
            make_manifest_member(
                outcomes=outcomes,
                disposition="disposition",  # type: ignore[arg-type]
                stage=stage,
                control_window_ids=(),
            )
        with pytest.raises(ContractValueError):
            make_manifest_member(
                outcomes=outcomes,
                disposition=disposition,
                stage="stage",  # type: ignore[arg-type]
                control_window_ids=(),
            )


class TestStageAndControlSerialization:
    def test_stage_definition_and_assignment_serialize(self) -> None:
        definition = StageDefinitionV1(
            definition_version="stage-v1",
            dormant_max_count=1,
            ignition_ratio=make_ratio(3, 1),
            continuation_floor_ratio=make_ratio(2, 1),
            fade_ceiling_ratio=make_ratio(1, 2),
        )
        assignment = generate_stage(
            StageEvidenceV1(
                baseline_bucket_counts=(2,),
                window_bucket_counts=(2,),
                net_return_sign=0,
                window_complete=True,
                disorder_observed=False,
            ),
            definition,
        )

        assert definition.as_mapping()["definitionVersion"] == "stage-v1"
        assert assignment.as_mapping()["stage"] == assignment.stage.value

    def test_window_facts_and_spec_serialize(self) -> None:
        facts = WindowFactsV1(
            window_id="w-1",
            symbol="BNBUSDT",
            window_start_ns=BASE_NS,
            window_end_ns=BASE_NS + SECOND_NS,
            row_count=1,
            value_range_ratio=make_ratio(1, 2),
            regime_id="regime-a",
            completeness_known=True,
            gap_row_count=0,
        )
        spec = ControlMatchSpecV1(
            match_version="match-v1",
            liquidity_bucket_edges=(10,),
            volatility_bucket_edges=(make_ratio(1, 2),),
            time_of_day_bucket_ns=DAY_NS,
            funding_cycle_ns=DAY_NS // 3,
            max_controls=1,
        )

        assert facts.as_mapping()["windowId"] == "w-1"
        assert spec.as_mapping()["matchVersion"] == "match-v1"
        with pytest.raises(ContractValueError):
            ControlMatchSpecV1(
                match_version="match-v1",
                liquidity_bucket_edges=(10,),
                volatility_bucket_edges=(),
                time_of_day_bucket_ns=DAY_NS,
                funding_cycle_ns=DAY_NS,
                max_controls=1,
            )

    def test_funding_cycle_mismatch_is_reachable_with_coarse_day_buckets(self) -> None:
        sample = _sample()
        spec = ControlMatchSpecV1(
            match_version="match-v1",
            liquidity_bucket_edges=(10, 100, 1_000),
            volatility_bucket_edges=(make_ratio(1, 200), make_ratio(1, 20)),
            time_of_day_bucket_ns=DAY_NS,
            funding_cycle_ns=DAY_NS // 3,
            max_controls=4,
        )

        def _facts(window_id: str, offset_s: int) -> WindowFactsV1:
            start = BASE_NS + offset_s * SECOND_NS
            return WindowFactsV1(
                window_id=window_id,
                symbol="BNBUSDT",
                window_start_ns=start,
                window_end_ns=start + 600 * SECOND_NS,
                row_count=120,
                value_range_ratio=make_ratio(1, 100),
                regime_id="regime-a",
                completeness_known=True,
                gap_row_count=0,
            )

        candidate = _facts("candidate-1", -90_000)
        shifted = _facts("pool-shifted", -90_000 - 30_000)

        result = match_controls(sample, candidate, (shifted,), spec)

        assert dict(result.rejection_counts)["FUNDING_CYCLE_MISMATCH"] == 1


def _basis_definition() -> BasisDefinitionV1:
    return BasisDefinitionV1(
        definition_version="basis-v1",
        max_reference_staleness_ns=60 * SECOND_NS,
        partial_convergence_fraction=make_ratio(1, 2),
        full_convergence_fraction=make_ratio(1, 10),
    )


def _basis_costs() -> BasisCostAssumptionV1:
    return BasisCostAssumptionV1(
        assumption_version="fees-v1",
        per_leg_fee=make_ratio(1, 1_000),
        entry_slippage=make_ratio(0, 1),
        exit_slippage=make_ratio(0, 1),
        recovery_cost=make_ratio(0, 1),
    )


def _basis_borrow() -> BorrowAssumptionV1:
    return BorrowAssumptionV1(
        assumption_version="borrow-v1",
        knownness=BorrowKnownness.UNKNOWN,
        hourly_rate=None,
    )


class TestBasisEdges:
    def test_funding_event_serializes(self) -> None:
        event = FundingEventV1(time_ns=BASE_NS, rate=make_ratio(1, 10_000))

        assert event.as_mapping() == {
            "rate": {"denominator": "10000", "numerator": "1"},
            "timeNs": str(BASE_NS),
        }

    def test_convergence_scan_stops_beyond_the_horizon(self) -> None:
        spot = _price_series(
            (_point(-5, 10_000, 1), _point(60, 10_000, 2)),
            series_id="spot-1",
        )
        perp = _price_series(
            (
                _point(-3, 10_400, 1),
                _point(30, 10_390, 2),
                _point(5_000, 10_000, 3),
            ),
            series_id="perp-1",
        )
        label = compute_basis_label(
            construction=BasisConstruction.NORMAL,
            spot_series=spot,
            perp_series=perp,
            label_start_ns=BASE_NS,
            label_end_ns=BASE_NS + 3_600 * SECOND_NS,
            definition=_basis_definition(),
            costs=_basis_costs(),
            borrow=_basis_borrow(),
            funding_schedule=(),
        )

        # The convergent print at +5000s lies beyond the label interval and must not
        # count; the label right-censors at the horizon instead.
        assert label.full_convergence_time_ns is None
        assert label.convergence_censor_time_ns == BASE_NS + 3_600 * SECOND_NS

    def test_label_type_check_rejections(self) -> None:
        base = compute_basis_label(
            construction=BasisConstruction.NORMAL,
            spot_series=_price_series((_point(-5, 10_000, 1),), series_id="spot-1"),
            perp_series=_price_series((_point(-3, 10_400, 1),), series_id="perp-1"),
            label_start_ns=BASE_NS,
            label_end_ns=BASE_NS + 3_600 * SECOND_NS,
            definition=_basis_definition(),
            costs=_basis_costs(),
            borrow=_basis_borrow(),
            funding_schedule=(),
        )

        def _rebuild(**overrides: object) -> BasisLabelV1:
            fields: dict[str, object] = {
                "construction": base.construction,
                "definition": base.definition,
                "costs": base.costs,
                "borrow": base.borrow,
                "feasibility": base.feasibility,
                "status": base.status,
                "entry_basis": base.entry_basis,
                "net_entry_edge": base.net_entry_edge,
                "partial_convergence_time_ns": base.partial_convergence_time_ns,
                "full_convergence_time_ns": base.full_convergence_time_ns,
                "convergence_censor_time_ns": base.convergence_censor_time_ns,
                "funding_transfer": base.funding_transfer,
                "max_executable_net_edge_status": base.max_executable_net_edge_status,
                "max_executable_net_edge": base.max_executable_net_edge,
            }
            fields.update(overrides)
            return BasisLabelV1(**fields)  # type: ignore[arg-type]

        # A hypothetical valid executable edge (both status and value) is coherent.
        valid_edge = _rebuild(
            max_executable_net_edge_status=OutcomeStatus.AVAILABLE,
            max_executable_net_edge=make_ratio(1, 100),
        )
        assert valid_edge.max_executable_net_edge == make_ratio(1, 100)
        for field, value in (
            ("construction", "NORMAL"),
            ("definition", "definition"),
            ("costs", "costs"),
            ("borrow", "borrow"),
            ("feasibility", "FEASIBLE"),
            ("status", "AVAILABLE"),
            ("net_entry_edge", None),
            ("funding_transfer", None),
            ("max_executable_net_edge", make_ratio(1, 2)),
        ):
            with pytest.raises(ContractValueError):
                _rebuild(**{field: value})
        with pytest.raises(ContractValueError):
            _rebuild(
                partial_convergence_time_ns=None,
                full_convergence_time_ns=None,
                convergence_censor_time_ns=None,
            )
        with pytest.raises(ContractValueError):
            _rebuild(
                max_executable_net_edge_status=OutcomeStatus.AVAILABLE,
                max_executable_net_edge=None,
            )
