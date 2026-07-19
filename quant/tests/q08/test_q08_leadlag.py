from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.derivatives.cross_market import (
    AssetReturnV1,
    CrossMarketBarV1,
    CrossMarketPartitionV1,
    CrossMarketPosture,
    CrossMarketSpecV1,
    CrossVenueDirection,
    EvidenceStatus,
    LeadershipVerdict,
    ResearchStatus,
    TimestampSemantics,
    VenueResearchSeriesV1,
    cross_sectional_report,
    dynamic_beta,
    evaluate_cross_market_research,
)
from quant_edge.derivatives.leadlag import (
    EVIDENCE_ONLY,
    MAX_LAG_BARS,
    LagCorrelationV1,
    LeadLagReportV1,
    LeadLagVerdict,
    lead_lag_report,
    leg_feature_series,
)
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare
from quant_edge.labels.series import EvidenceSeriesV1, PricePointV1, QuotePointV1, SeriesKind
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)
from quant_edge.validation.multiplicity import TrialStatus

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
BAR_NS = 10 * SECOND_NS

# A deterministic move pattern with enough sign variety for correlations.
MOVES = [7, -3, 5, -8, 2, 9, -4, 6, -1, 3, -7, 8, 4, -6, 1, -2, 5, -9, 3, 6]
RETURN_COHORT = "q076-cross-section-v1"
RETURN_AS_OF_NS = BASE_NS + 100 * SECOND_NS


def _asset_return(
    asset_id: str,
    sector_id: str,
    value: ExactRatioV1 | None,
    *,
    cohort_id: str = RETURN_COHORT,
    as_of_ns: int = RETURN_AS_OF_NS,
) -> AssetReturnV1:
    return AssetReturnV1(asset_id, sector_id, cohort_id, as_of_ns, value)


def _a_ofi(index: int) -> int:
    return (index * 17) % 23 - 11


def _b_ofi(index: int) -> int:
    return (index * 7) % 19 - 9


def _a_return(index: int) -> int:
    return (index * 13) % 17 - 8


def _b_return(index: int) -> int:
    if index == 0:
        return 0
    return 3 * _a_ofi(index - 1) + (index * 5) % 7 - 3


def _research_series(
    venue_id: str,
    *,
    count: int = 200,
    base_asset_id: str = "bnb",
    late_by_ns: int = 0,
    missing_indices: frozenset[int] = frozenset(),
    selection_source_multiplier: int = 1,
) -> VenueResearchSeriesV1:
    is_a = venue_id == "venue-a"
    bars: list[CrossMarketBarV1] = []
    for index in range(count):
        start_ns = BASE_NS + index * BAR_NS
        ofi_value = _a_ofi(index) if is_a else _b_ofi(index)
        if is_a and index >= 100:
            ofi_value *= selection_source_multiplier
        return_value = _a_return(index) if is_a else _b_return(index)
        bars.append(
            CrossMarketBarV1(
                bar_index=index,
                start_ns=start_ns,
                end_ns=start_ns + BAR_NS,
                available_ns=start_ns + BAR_NS + late_by_ns,
                ofi=None if index in missing_indices else make_ratio(ofi_value, 1),
                return_value=(None if index in missing_indices else make_ratio(return_value, 1)),
            )
        )
    return VenueResearchSeriesV1(
        venue_id=venue_id,
        instrument_id=f"{venue_id}-bnb-usdt-spot",
        base_asset_id=base_asset_id,
        quote_asset_id="usdt",
        product_id="spot",
        ofi_feature_id="ofi_l1:v1",
        return_feature_id="bar_return:v1",
        source_id=f"{venue_id}-public-replay",
        source_revision="revision-v1",
        source_sha256=DigestV1(("a" if is_a else "b") * 64),
        posture=CrossMarketPosture.SYNTHETIC_RESEARCH_ONLY,
        timestamp_semantics=TimestampSemantics.CANONICAL_AVAILABILITY_TIME,
        bar_width_ns=BAR_NS,
        max_clock_uncertainty_ns=0,
        bars=tuple(bars),
    )


def _research_partition() -> CrossMarketPartitionV1:
    return CrossMarketPartitionV1(train_end=100, selection_start=104, selection_end=200)


class TestCrossMarketResearch:
    def test_market_sector_residuals_and_breadth_are_exact(self) -> None:
        report = cross_sectional_report(
            (
                _asset_return("asset-a", "tech", make_ratio(1, 10)),
                _asset_return("asset-b", "tech", make_ratio(-1, 20)),
                _asset_return("asset-c", "defi", make_ratio(1, 5)),
            )
        )

        assert report.status is EvidenceStatus.AVAILABLE
        assert report.known_assets == 3
        assert report.market_return == make_ratio(1, 12)
        assert report.advance_breadth == make_ratio(2, 3)
        assert dict(report.sector_returns) == {
            "defi": make_ratio(1, 5),
            "tech": make_ratio(1, 40),
        }
        assert report.residuals[0].market_residual == make_ratio(1, 60)
        assert report.residuals[0].sector_residual == make_ratio(3, 40)
        assert all(item.market_residual is not None for item in report.residuals)

    def test_unknown_partial_asynchronous_and_duplicate_cross_sections_fail_honestly(self) -> None:
        report = cross_sectional_report((_asset_return("asset-a", "tech", None),))

        assert report.status is EvidenceStatus.UNKNOWN
        assert report.market_return is None
        assert report.advance_breadth is None

        partial = cross_sectional_report(
            (
                _asset_return("asset-a", "tech", make_ratio(1, 10)),
                _asset_return("asset-b", "tech", None),
            )
        )
        assert partial.status is EvidenceStatus.PARTIAL_RESEARCH_ONLY
        assert partial.known_assets == 1
        assert partial.total_assets == 2
        assert partial.market_return is None
        assert partial.advance_breadth is None
        assert partial.sector_returns == ()
        assert all(item.market_residual is None for item in partial.residuals)

        with pytest.raises(ContractValueError, match="sorted and unique"):
            cross_sectional_report(
                (
                    _asset_return("asset-a", "tech", make_ratio(1, 10)),
                    _asset_return("asset-a", "tech", make_ratio(1, 5)),
                )
            )
        with pytest.raises(ContractValueError, match="one cohort_id and as_of_ns"):
            cross_sectional_report(
                (
                    _asset_return("asset-a", "tech", make_ratio(1, 10)),
                    _asset_return(
                        "asset-b",
                        "tech",
                        make_ratio(1, 5),
                        as_of_ns=RETURN_AS_OF_NS + 1,
                    ),
                )
            )

    def test_dynamic_beta_is_exact_bounded_and_zero_variance_is_unknown(self) -> None:
        factor = (make_ratio(-1, 100), make_ratio(0, 1), make_ratio(1, 100))
        asset = (make_ratio(-1, 50), make_ratio(0, 1), make_ratio(1, 50))

        report = dynamic_beta(asset, factor, window=3)
        unknown = dynamic_beta(asset, (make_ratio(1, 10),) * 3, window=3)

        assert report.status is EvidenceStatus.AVAILABLE
        assert report.beta == make_ratio(2, 1)
        assert unknown.status is EvidenceStatus.UNKNOWN
        assert unknown.reason == "ZERO_FACTOR_VARIANCE"
        with pytest.raises(ContractValueError, match="must align"):
            dynamic_beta(asset, factor[:-1], window=3)

    def test_cross_venue_family_is_measured_internally_and_multiplicity_safe(self) -> None:
        report = evaluate_cross_market_research(
            _research_series("venue-a"),
            _research_series("venue-b"),
            partition=_research_partition(),
        )

        assert report.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        assert report.posture is CrossMarketPosture.SYNTHETIC_RESEARCH_ONLY
        assert len(report.transfers) == 8
        assert len(report.granger) == 8
        assert len(report.transfer_entropy) == 8
        assert report.trial_ledger.attempted_count == report.holm.tested_count == 16
        assert report.authority == "NONE"
        assert report.is_promotable is False
        assert report.cost_latency_validated is False
        assert report.leadership is LeadershipVerdict.A_LEADS_RESEARCH_ONLY

    def test_report_provenance_binds_source_revision_digest_and_bar_content(self) -> None:
        series_a = _research_series("venue-a")
        series_b = _research_series("venue-b")
        partition = _research_partition()
        original = evaluate_cross_market_research(series_a, series_b, partition=partition)
        revised = evaluate_cross_market_research(
            replace(series_a, source_revision="revision-v2"),
            series_b,
            partition=partition,
        )
        redigested = evaluate_cross_market_research(
            replace(series_a, source_sha256=DigestV1("c" * 64)),
            series_b,
            partition=partition,
        )
        changed_bar = replace(series_a.bars[10], ofi=make_ratio(999, 1))
        changed_content = evaluate_cross_market_research(
            replace(series_a, bars=(*series_a.bars[:10], changed_bar, *series_a.bars[11:])),
            series_b,
            partition=partition,
        )

        assert original.transfers == revised.transfers == redigested.transfers
        assert original.granger == revised.granger == redigested.granger
        assert original.transfer_entropy == revised.transfer_entropy == redigested.transfer_entropy
        assert (
            len(
                {
                    original.report_revision,
                    revised.report_revision,
                    redigested.report_revision,
                    changed_content.report_revision,
                }
            )
            == 4
        )
        assert revised.provenance.series_a.source_revision == "revision-v2"
        assert redigested.provenance.series_a.source_sha256 == DigestV1("c" * 64)
        assert (
            original.provenance.series_a.series_sha256
            != changed_content.provenance.series_a.series_sha256
        )

    def test_report_revision_binds_window_partition_and_spec_but_not_trial_names(self) -> None:
        series_a = _research_series("venue-a")
        series_b = _research_series("venue-b")
        partition = _research_partition()
        original = evaluate_cross_market_research(series_a, series_b, partition=partition)
        shift_ns = 7 * BAR_NS

        def shifted(series: VenueResearchSeriesV1) -> VenueResearchSeriesV1:
            return replace(
                series,
                bars=tuple(
                    replace(
                        bar,
                        bar_index=bar.bar_index + 7,
                        start_ns=bar.start_ns + shift_ns,
                        end_ns=bar.end_ns + shift_ns,
                        available_ns=bar.available_ns + shift_ns,
                    )
                    for bar in series.bars
                ),
            )

        shifted_window = evaluate_cross_market_research(
            shifted(series_a), shifted(series_b), partition=partition
        )
        repartitioned = evaluate_cross_market_research(
            series_a,
            series_b,
            partition=CrossMarketPartitionV1(100, 105, 200),
        )
        respecified = evaluate_cross_market_research(
            series_a,
            series_b,
            partition=partition,
            spec=CrossMarketSpecV1(familywise_alpha_per_myriad=501),
        )

        assert original.transfers == shifted_window.transfers
        assert original.granger == shifted_window.granger
        assert original.transfer_entropy == shifted_window.transfer_entropy
        assert (
            len(
                {
                    original.report_revision,
                    shifted_window.report_revision,
                    repartitioned.report_revision,
                    respecified.report_revision,
                }
            )
            == 4
        )
        assert shifted_window.provenance.series_a.window_start_ns == BASE_NS + shift_ns
        assert repartitioned.provenance.partition.selection_start == 105
        assert respecified.provenance.spec.familywise_alpha_per_myriad == 501
        expected_trial_ids = tuple(item.trial_id for item in original.granger)
        assert tuple(item.trial_id for item in shifted_window.granger) == expected_trial_ids
        assert tuple(item.trial_id for item in repartitioned.granger) == expected_trial_ids
        assert tuple(item.trial_id for item in respecified.granger) == expected_trial_ids
        with pytest.raises(ContractValueError, match="input_sha256 must bind"):
            replace(original.provenance, input_sha256=DigestV1("f" * 64))
        with pytest.raises(ContractValueError, match="report_revision must bind"):
            replace(
                original,
                report_revision="q076-cross-market-research-v2:" + "0" * 64,
            )

    def test_positive_lag_ofi_transfer_is_stable_across_both_partitions_and_halves(self) -> None:
        report = evaluate_cross_market_research(
            _research_series("venue-a"),
            _research_series("venue-b"),
            partition=_research_partition(),
        )
        transfer = next(
            item
            for item in report.transfers
            if item.direction is CrossVenueDirection.A_TO_B and item.lag_bars == 1
        )

        assert transfer.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        assert transfer.train_slope is not None
        assert transfer.train_slope.numerator > 0
        assert transfer.selection_slope is not None
        assert transfer.selection_slope.numerator > 0
        assert transfer.first_half_slope is not None
        assert transfer.second_half_slope is not None
        assert transfer.stable_sign == 1

    def test_granger_challenger_fits_train_and_scores_selection_without_caller_statistics(
        self,
    ) -> None:
        report = evaluate_cross_market_research(
            _research_series("venue-a"),
            _research_series("venue-b"),
            partition=_research_partition(),
        )
        challenger = next(
            item
            for item in report.granger
            if item.direction is CrossVenueDirection.A_TO_B and item.lag_bars == 1
        )

        assert challenger.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        assert challenger.restricted_sse is not None
        assert challenger.unrestricted_sse is not None
        assert ratio_compare(challenger.restricted_sse, challenger.unrestricted_sse) > 0
        assert challenger.raw_p_value is not None
        assert challenger.selected

    def test_transfer_entropy_is_train_binned_and_finite_sample_bias_corrected(self) -> None:
        original = evaluate_cross_market_research(
            _research_series("venue-a"),
            _research_series("venue-b"),
            partition=_research_partition(),
        )
        hostile_selection = evaluate_cross_market_research(
            _research_series("venue-a", selection_source_multiplier=1_000),
            _research_series("venue-b"),
            partition=_research_partition(),
        )
        first = next(
            item
            for item in original.transfer_entropy
            if item.direction is CrossVenueDirection.A_TO_B and item.lag_bars == 1
        )
        second = next(
            item
            for item in hostile_selection.transfer_entropy
            if item.direction is CrossVenueDirection.A_TO_B and item.lag_bars == 1
        )

        assert first.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        assert first.source_threshold == second.source_threshold
        assert first.target_threshold == second.target_threshold
        assert first.raw_transfer_entropy is not None
        assert first.finite_sample_bias is not None
        assert first.corrected_transfer_entropy is not None
        assert first.finite_sample_bias.mantissa >= 0
        assert first.corrected_transfer_entropy.mantissa <= first.raw_transfer_entropy.mantissa

    def test_late_source_availability_cannot_masquerade_as_leadership(self) -> None:
        report = evaluate_cross_market_research(
            _research_series("venue-a", late_by_ns=4 * BAR_NS),
            _research_series("venue-b"),
            partition=_research_partition(),
        )
        lag_one = next(
            item
            for item in report.transfers
            if item.direction is CrossVenueDirection.A_TO_B and item.lag_bars == 1
        )

        assert lag_one.status is ResearchStatus.UNKNOWN
        assert lag_one.reason == "DATA_INSUFFICIENT"
        assert report.leadership is not LeadershipVerdict.A_LEADS_RESEARCH_ONLY

    def test_missing_rows_reset_support_and_never_become_zero_symbols(self) -> None:
        missing = frozenset(range(0, 190))
        report = evaluate_cross_market_research(
            _research_series("venue-a", missing_indices=missing),
            _research_series("venue-b", missing_indices=missing),
            partition=_research_partition(),
        )

        assert report.status is ResearchStatus.UNKNOWN
        assert all(item.status is ResearchStatus.UNKNOWN for item in report.granger)
        assert all(item.raw_p_value is None for item in report.transfer_entropy)
        assert report.holm.tested_count == 16
        assert report.holm.rejected_trial_ids == ()

    def test_incomparable_instrument_truth_returns_unknown_with_full_trial_ledger(self) -> None:
        report = evaluate_cross_market_research(
            _research_series("venue-a"),
            _research_series("venue-b", base_asset_id="eth"),
            partition=_research_partition(),
        )

        assert report.status is ResearchStatus.UNKNOWN
        assert report.reason == "INSTRUMENT_SEMANTICS_MISMATCH"
        assert report.leadership is LeadershipVerdict.UNKNOWN
        assert report.trial_ledger.count_by_status(TrialStatus.FAILED) == 16
        assert report.holm.tested_count == 16

    def test_singular_and_inadequate_evidence_stays_unknown(self) -> None:
        report = evaluate_cross_market_research(
            _research_series("venue-a", count=24),
            _research_series("venue-b", count=24),
            partition=CrossMarketPartitionV1(8, 10, 24),
        )

        assert report.status is ResearchStatus.UNKNOWN
        assert all(item.status is ResearchStatus.UNKNOWN for item in report.granger)
        assert all(item.status is ResearchStatus.UNKNOWN for item in report.transfer_entropy)
        with pytest.raises(ContractValueError, match="max_lag"):
            CrossMarketSpecV1(max_lag=5)

    def test_bar_chronology_and_capacity_fail_before_analysis(self) -> None:
        series = _research_series("venue-a", count=8)
        with pytest.raises(ContractValueError, match="gap-free index"):
            VenueResearchSeriesV1(
                venue_id=series.venue_id,
                instrument_id=series.instrument_id,
                base_asset_id=series.base_asset_id,
                quote_asset_id=series.quote_asset_id,
                product_id=series.product_id,
                ofi_feature_id=series.ofi_feature_id,
                return_feature_id=series.return_feature_id,
                source_id=series.source_id,
                source_revision=series.source_revision,
                source_sha256=series.source_sha256,
                posture=series.posture,
                timestamp_semantics=series.timestamp_semantics,
                bar_width_ns=series.bar_width_ns,
                max_clock_uncertainty_ns=series.max_clock_uncertainty_ns,
                bars=(series.bars[0], series.bars[2]),
            )
        with pytest.raises(ContractValueError, match="integer width"):
            CrossMarketBarV1(
                bar_index=0,
                start_ns=BASE_NS,
                end_ns=BASE_NS + BAR_NS,
                available_ns=BASE_NS + BAR_NS,
                ofi=make_ratio(1 << 150, 1),
                return_value=make_ratio(1, 1),
            )


def _usdt(price: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT")


def _market_identity(symbol: str) -> InstrumentIdentityV1:
    return InstrumentIdentityV1(
        instrument_id=f"test-{symbol}",
        base_size_unit_id="BNB",
        quote_price_unit_id="USDT",
    )


def _series(
    series_id: str,
    symbol: str,
    prices: list[int],
    *,
    bars: int,
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol=symbol,
        instrument=_market_identity(symbol),
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + bars * BAR_NS,
        price_points=tuple(
            PricePointV1(
                event_time_ns=BASE_NS + index * BAR_NS + BAR_NS // 2,
                ordinal=index,
                price=_usdt(price),
            )
            for index, price in enumerate(prices)
        ),
        quote_points=(),
        known_gaps=(),
    )


def _walk(moves: list[int], start: int = 10_000) -> list[int]:
    prices = [start]
    for move in moves:
        prices.append(prices[-1] + move * 10)
    return prices


def _shifted_pair(shift_bars: int) -> tuple[EvidenceSeriesV1, EvidenceSeriesV1]:
    """The perp leg repeats the spot leg's moves ``shift_bars`` bars later."""

    spot_prices = _walk(MOVES + [0] * shift_bars)
    perp_prices = _walk([0] * shift_bars + MOVES, start=10_050)
    bars = len(spot_prices)
    return (
        _series("leadlag-spot", "BNBUSDT", spot_prices, bars=bars),
        _series("leadlag-perp", "BNBUSDT-PERP", perp_prices, bars=bars),
    )


class TestLeadLagReport:
    def test_spot_leadership_is_detected_at_the_positive_lag(self) -> None:
        spot_series, perp_series = _shifted_pair(2)
        report = lead_lag_report(
            spot_series=spot_series,
            perp_series=perp_series,
            wall_width_ns=BAR_NS,
            anchor_ns=BASE_NS,
        )
        assert report.verdict is LeadLagVerdict.SPOT_LEADS
        assert report.best_lag_bars == 2
        best = next(c for c in report.correlations if c.lag_bars == 2)
        assert best.signed_r_squared is not None
        # The perp repeats the spot moves from a slightly different level, so the
        # signed r-squared is positive and essentially (not exactly) one.
        assert ratio_compare(best.signed_r_squared, make_ratio(999, 1_000)) > 0
        assert ratio_compare(best.signed_r_squared, make_ratio(1, 1)) <= 0
        assert report.posture_note == EVIDENCE_ONLY

    def test_perp_leadership_mirrors_at_the_negative_lag(self) -> None:
        perp_like, spot_like = _shifted_pair(2)
        report = lead_lag_report(
            spot_series=_series(
                "leadlag-spot",
                "BNBUSDT",
                [point.price.coefficient for point in spot_like.price_points],
                bars=len(spot_like.price_points),
            ),
            perp_series=_series(
                "leadlag-perp",
                "BNBUSDT-PERP",
                [point.price.coefficient for point in perp_like.price_points],
                bars=len(perp_like.price_points),
            ),
            wall_width_ns=BAR_NS,
            anchor_ns=BASE_NS,
        )
        assert report.verdict is LeadLagVerdict.PERP_LEADS
        assert report.best_lag_bars == -2

    def test_identical_legs_are_contemporaneous(self) -> None:
        prices = _walk(MOVES)
        report = lead_lag_report(
            spot_series=_series("leadlag-spot", "BNBUSDT", prices, bars=len(prices)),
            perp_series=_series("leadlag-perp", "BNBUSDT-PERP", prices, bars=len(prices)),
            wall_width_ns=BAR_NS,
            anchor_ns=BASE_NS,
        )
        assert report.verdict is LeadLagVerdict.CONTEMPORANEOUS
        assert report.best_lag_bars == 0
        assert report.stability is not None

    def test_sparse_evidence_stays_unknown(self) -> None:
        prices = _walk(MOVES[:3])
        report = lead_lag_report(
            spot_series=_series("leadlag-spot", "BNBUSDT", prices, bars=len(prices)),
            perp_series=_series("leadlag-perp", "BNBUSDT-PERP", prices, bars=len(prices)),
            wall_width_ns=BAR_NS,
            anchor_ns=BASE_NS,
        )
        assert report.verdict is LeadLagVerdict.UNKNOWN
        assert report.best_lag_bars is None
        assert report.stability is None
        assert all(c.signed_r_squared is None for c in report.correlations)

    def test_every_lag_is_reported_exactly_once(self) -> None:
        spot_series, perp_series = _shifted_pair(1)
        report = lead_lag_report(
            spot_series=spot_series,
            perp_series=perp_series,
            wall_width_ns=BAR_NS,
            anchor_ns=BASE_NS,
        )
        assert [c.lag_bars for c in report.correlations] == list(
            range(-MAX_LAG_BARS, MAX_LAG_BARS + 1)
        )

    def test_stability_reflects_half_agreement(self) -> None:
        long_spot = _walk(([*MOVES, 0, 0]) * 3)
        long_perp = _walk(([0, 0, *MOVES]) * 3, start=10_050)
        report = lead_lag_report(
            spot_series=_series("leadlag-spot", "BNBUSDT", long_spot, bars=len(long_spot)),
            perp_series=_series("leadlag-perp", "BNBUSDT-PERP", long_perp, bars=len(long_perp)),
            wall_width_ns=BAR_NS,
            anchor_ns=BASE_NS,
        )
        if report.stability is not None:
            assert report.stability in (
                make_ratio(0, 1),
                make_ratio(1, 2),
                make_ratio(1, 1),
            )


class TestLegFeatureSeries:
    def test_projects_prices_and_rejects_quotes(self) -> None:
        prices = _walk(MOVES[:5])
        series = _series("leadlag-spot", "BNBUSDT", prices, bars=len(prices))
        projected = leg_feature_series(series, series_id="projected")
        assert projected.symbol == "BNBUSDT"
        assert len(projected.points) == len(prices)
        assert projected.points[0].volume is None
        quotes = EvidenceSeriesV1(
            series_id="quotes",
            symbol="BNBUSDT",
            instrument=_market_identity("BNBUSDT"),
            kind=SeriesKind.EXECUTABLE_QUOTES,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS,
            completeness_end_ns=BASE_NS + BAR_NS,
            price_points=(),
            quote_points=(
                QuotePointV1(
                    event_time_ns=BASE_NS,
                    ordinal=0,
                    bid=_usdt(10_000),
                    ask=_usdt(10_002),
                ),
            ),
            known_gaps=(),
        )
        with pytest.raises(ContractValueError, match="never executable quotes"):
            leg_feature_series(quotes, series_id="projected")
        with pytest.raises(ContractValueError, match="EvidenceSeriesV1"):
            leg_feature_series(None, series_id="projected")  # type: ignore[arg-type]


class TestReportContract:
    def _correlations(self) -> tuple[LagCorrelationV1, ...]:
        return tuple(
            LagCorrelationV1(lag_bars=lag, pair_count=0, signed_r_squared=None)
            for lag in range(-MAX_LAG_BARS, MAX_LAG_BARS + 1)
        )

    def test_verdict_and_lag_law(self) -> None:
        with pytest.raises(ContractValueError, match="names a leader"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.UNKNOWN,
                best_lag_bars=1,
                correlations=self._correlations(),
                stability=None,
                posture_note=EVIDENCE_ONLY,
            )
        with pytest.raises(ContractValueError, match="names a leader"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.SPOT_LEADS,
                best_lag_bars=None,
                correlations=self._correlations(),
                stability=None,
                posture_note=EVIDENCE_ONLY,
            )

    def test_lag_coverage_law(self) -> None:
        with pytest.raises(ContractValueError, match="every lag exactly once"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.UNKNOWN,
                best_lag_bars=None,
                correlations=self._correlations()[:-1],
                stability=None,
                posture_note=EVIDENCE_ONLY,
            )
        with pytest.raises(ContractValueError, match="ordered by lag"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.UNKNOWN,
                best_lag_bars=None,
                correlations=tuple(reversed(self._correlations())),
                stability=None,
                posture_note=EVIDENCE_ONLY,
            )

    def test_evidence_only_posture_is_mandatory(self) -> None:
        with pytest.raises(ContractValueError, match="never alpha"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.UNKNOWN,
                best_lag_bars=None,
                correlations=self._correlations(),
                stability=None,
                posture_note="TRADABLE_ALPHA",
            )

    def test_correlation_contract(self) -> None:
        with pytest.raises(ContractValueError, match="lag_bars"):
            LagCorrelationV1(lag_bars=MAX_LAG_BARS + 1, pair_count=0, signed_r_squared=None)
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            LagCorrelationV1(lag_bars=0, pair_count=2, signed_r_squared=0.5)  # type: ignore[arg-type]
        mapping = LagCorrelationV1(
            lag_bars=1, pair_count=8, signed_r_squared=make_ratio(1, 2)
        ).as_mapping()
        assert mapping["lagBars"] == 1
