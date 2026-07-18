from __future__ import annotations

import pytest

from quant_edge.derivatives.cross_market import (
    AssetReturnV1,
    ChallengeCandidateV1,
    ChallengeStatus,
    EvidenceStatus,
    cross_sectional_report,
    dynamic_beta,
    holm_stability_decisions,
    lead_lag_capabilities,
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
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)

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

    def test_holm_selection_requires_multiplicity_and_half_stability(self) -> None:
        decisions = holm_stability_decisions(
            (
                ChallengeCandidateV1("candidate-a", make_ratio(1, 1_000), 1, 1, 100),
                ChallengeCandidateV1("candidate-b", make_ratio(1, 100), 1, -1, 100),
                ChallengeCandidateV1("candidate-c", make_ratio(1, 10), 1, 1, 100),
            ),
            family_alpha=make_ratio(1, 20),
            min_samples=32,
        )

        assert {item.candidate_id: item.status for item in decisions} == {
            "candidate-a": ChallengeStatus.SELECTED_RESEARCH_ONLY,
            "candidate-b": ChallengeStatus.REJECTED_UNSTABLE,
            "candidate-c": ChallengeStatus.REJECTED_MULTIPLICITY,
        }

    def test_insufficient_challenger_support_cannot_be_selected(self) -> None:
        decision = holm_stability_decisions(
            (ChallengeCandidateV1("candidate-a", make_ratio(1, 10_000), 1, 1, 7),),
            family_alpha=make_ratio(1, 20),
            min_samples=32,
        )[0]

        assert decision.status is ChallengeStatus.DATA_INSUFFICIENT
        with pytest.raises(ContractValueError, match="identifiers must be unique"):
            holm_stability_decisions(
                (
                    ChallengeCandidateV1("candidate-a", make_ratio(1, 100), 1, 1, 50),
                    ChallengeCandidateV1("candidate-a", make_ratio(1, 100), 1, 1, 50),
                ),
                family_alpha=make_ratio(1, 20),
                min_samples=32,
            )

    def test_holm_latches_first_threshold_failure_even_when_support_is_insufficient(self) -> None:
        decisions = holm_stability_decisions(
            (
                ChallengeCandidateV1("insufficient-first", make_ratio(3, 100), 1, 1, 7),
                ChallengeCandidateV1("later-smaller-alpha", make_ratio(4, 100), 1, 1, 100),
            ),
            family_alpha=make_ratio(1, 20),
            min_samples=32,
        )

        assert {item.candidate_id: item.status for item in decisions} == {
            "insufficient-first": ChallengeStatus.DATA_INSUFFICIENT,
            "later-smaller-alpha": ChallengeStatus.REJECTED_MULTIPLICITY,
        }
        assert {item.candidate_id: item.holm_threshold for item in decisions} == {
            "insufficient-first": make_ratio(1, 40),
            "later-smaller-alpha": make_ratio(1, 20),
        }

    def test_only_existing_spot_perp_owner_is_available_on_mounted_data(self) -> None:
        capabilities = lead_lag_capabilities()
        available = tuple(
            item.capability_id
            for item in capabilities
            if item.status is ChallengeStatus.AVAILABLE_EXISTING_OWNER
        )

        assert available == ("spot-perp-leadlag",)
        assert all(
            item.status is ChallengeStatus.BLOCKED_DATA
            for item in capabilities
            if item.capability_id != "spot-perp-leadlag"
        )
        assert any(item.capability_id == "lagged-ofi-transfer" for item in capabilities)
        assert any(item.capability_id == "cross-venue-leadership" for item in capabilities)


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
