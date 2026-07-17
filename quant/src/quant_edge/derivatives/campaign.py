"""Deterministic Q08 derivatives campaign and golden-fixture builder.

Usage: ``python -m quant_edge.derivatives.campaign OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or ambient-time
access:

- ``OUTPUT_ROOT/tests/q08/fixtures/q08_derivatives_golden_v1.json``
- ``OUTPUT_ROOT/generated/q08/derivatives_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q08/derivatives_campaign.v1.md``

This module is the explicit composition boundary of the derivatives package: the
only place with filesystem/argv access. Everything produced is SYNTHETIC fixture
evidence proving the Q08 machinery; no feature is claimed predictive, validated or
economically valuable.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from quant_edge.canonical import canonical_json_bytes
from quant_edge.derivatives.bar_features import q08_features, q08_registry
from quant_edge.derivatives.basis_path import (
    BasisPathV1,
    attribute_leg_changes,
    build_basis_bars,
    build_basis_path,
)
from quant_edge.derivatives.borrow import BorrowObservationV1
from quant_edge.derivatives.convergence import convergence_target, estimate_convergence
from quant_edge.derivatives.costs import (
    CostKind,
    CostStackV1,
    known_component,
    unknown_component,
)
from quant_edge.derivatives.executable import (
    LegKind,
    SizedQuoteV1,
    compute_executable_basis,
    net_executable_edge,
)
from quant_edge.derivatives.funding import (
    FundingEvidenceV1,
    FundingObservationV1,
    funding_change,
    funding_level,
    schedule_interval_verdict,
    time_to_next_funding,
)
from quant_edge.derivatives.leadlag import lead_lag_report
from quant_edge.derivatives.liquidations import (
    LiquidationEventV1,
    LiquidationEvidenceV1,
    LiquidationSide,
    observed_liquidation_count,
    observed_liquidation_notional,
)
from quant_edge.derivatives.openinterest import (
    OpenInterestEvidenceV1,
    OpenInterestObservationV1,
    oi_acceleration,
    oi_change,
    oi_level,
    price_oi_quadrant,
)
from quant_edge.derivatives.references import ReferenceKind
from quant_edge.derivatives.statespace import FixedGainFilterV1, mean_reversion_diagnostic
from quant_edge.features.harness import run_equivalence, streaming_vector, vector_digest
from quant_edge.features.registry import render_registry_markdown
from quant_edge.labels.basis import (
    BasisConstruction,
    BorrowAssumptionV1,
    BorrowKnownness,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import EvidenceSeriesV1, PricePointV1, SeriesKind
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
    QualityState,
)
from quant_edge.randomness import DeterministicRandom

CAMPAIGN_SEED = 20260712
SEEDED_PAIRS = 12
BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
STALENESS_NS = 5 * SECOND_NS
BAR_WIDTH_NS = 10 * SECOND_NS


def _usdt(price: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT")


def _price_series(
    *,
    series_id: str,
    symbol: str,
    prices: list[tuple[int, int]],
    end_offset_s: int,
) -> EvidenceSeriesV1:
    points = tuple(
        PricePointV1(
            event_time_ns=BASE_NS + offset_s * SECOND_NS,
            ordinal=index,
            price=_usdt(price),
        )
        for index, (offset_s, price) in enumerate(prices)
    )
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol=symbol,
        instrument=InstrumentIdentityV1(
            instrument_id=f"synthetic-{series_id}",
            base_size_unit_id="BNB",
            quote_price_unit_id="USDT",
        ),
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + end_offset_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=(),
    )


def _golden_legs() -> tuple[EvidenceSeriesV1, EvidenceSeriesV1]:
    spot_prices = []
    perp_prices = []
    spot = 10_000
    gap = 80
    for index in range(60):
        spot = spot + ((index * 37) % 11 - 5) * 3
        gap = max(gap - 2, -10) if index % 7 != 3 else gap + 5
        spot_prices.append((index * 2, spot))
        perp_prices.append((index * 2 + 1, spot + gap))
    return (
        _price_series(
            series_id="q08-golden-spot",
            symbol="BNBUSDT",
            prices=spot_prices,
            end_offset_s=130,
        ),
        _price_series(
            series_id="q08-golden-perp",
            symbol="BNBUSDT-PERP",
            prices=perp_prices,
            end_offset_s=130,
        ),
    )


def _golden_path() -> BasisPathV1:
    spot_series, perp_series = _golden_legs()
    return build_basis_path(
        path_id="q08-golden-path",
        spot_series=spot_series,
        perp_series=perp_series,
        reference_kind=ReferenceKind.LAST_TRADE,
        max_staleness_ns=STALENESS_NS,
    )


def _golden_executable() -> dict[str, object]:
    as_of = BASE_NS + 10 * SECOND_NS
    spot_quote = SizedQuoteV1(
        leg=LegKind.SPOT,
        instrument=InstrumentIdentityV1(
            instrument_id="synthetic-binance-spot-BNBUSDT",
            base_size_unit_id="BNB",
            quote_price_unit_id="USDT",
        ),
        event_time_ns=as_of - SECOND_NS,
        ordinal=1,
        bid=_usdt(10_000),
        ask=_usdt(10_002),
        bid_size=ExactScaledValueV1(coefficient=5, scale=0, unit_id="BNB"),
        ask_size=ExactScaledValueV1(coefficient=5, scale=0, unit_id="BNB"),
    )
    perp_quote = SizedQuoteV1(
        leg=LegKind.USDM_PERP,
        instrument=InstrumentIdentityV1(
            instrument_id="synthetic-binance-usdm-BNBUSDT",
            base_size_unit_id="BNB",
            quote_price_unit_id="USDT",
        ),
        event_time_ns=as_of - SECOND_NS,
        ordinal=1,
        bid=_usdt(10_060),
        ask=_usdt(10_062),
        bid_size=ExactScaledValueV1(coefficient=5, scale=0, unit_id="BNB"),
        ask_size=ExactScaledValueV1(coefficient=5, scale=0, unit_id="BNB"),
    )
    intended = ExactScaledValueV1(coefficient=2, scale=0, unit_id="BNB")
    known_costs = CostStackV1(
        stack_version="q08-costs-v1",
        components=(
            known_component(CostKind.BORROW_CARRY, 1, 10_000),
            known_component(CostKind.ENTRY_SLIPPAGE, 5, 10_000),
            known_component(CostKind.EXIT_SLIPPAGE, 5, 10_000),
            known_component(CostKind.FUNDING_CARRY, -2, 10_000),
            known_component(CostKind.PER_LEG_FEE, 75, 100_000),
            known_component(CostKind.RECOVERY, 10, 10_000),
        ),
    )
    unknown_costs = CostStackV1(
        stack_version="q08-costs-v1-unknown-borrow-carry",
        components=(
            unknown_component(CostKind.BORROW_CARRY),
            known_component(CostKind.ENTRY_SLIPPAGE, 5, 10_000),
            known_component(CostKind.EXIT_SLIPPAGE, 5, 10_000),
            known_component(CostKind.FUNDING_CARRY, -2, 10_000),
            known_component(CostKind.PER_LEG_FEE, 75, 100_000),
            known_component(CostKind.RECOVERY, 10, 10_000),
        ),
    )
    known_borrow = BorrowObservationV1(
        observed_at_ns=as_of - SECOND_NS,
        assumption=BorrowAssumptionV1(
            assumption_version="q08-borrow-v1",
            knownness=BorrowKnownness.KNOWN_AVAILABLE,
            hourly_rate=make_ratio(1, 100_000),
        ),
        inventory=ExactScaledValueV1(coefficient=100, scale=0, unit_id="BNB"),
        interest_interval_ns=3_600 * SECOND_NS,
        valid_until_ns=as_of + 3_600 * SECOND_NS,
    )
    unknown_borrow = BorrowObservationV1(
        observed_at_ns=as_of - SECOND_NS,
        assumption=BorrowAssumptionV1(
            assumption_version="q08-borrow-v1-unknown",
            knownness=BorrowKnownness.UNKNOWN,
            hourly_rate=None,
        ),
        inventory=None,
        interest_interval_ns=None,
        valid_until_ns=None,
    )

    cases: dict[str, object] = {}
    for name, construction, costs, borrow in (
        ("normalKnown", BasisConstruction.NORMAL, known_costs, known_borrow),
        ("reverseKnown", BasisConstruction.REVERSE, known_costs, known_borrow),
        ("reverseUnknownBorrow", BasisConstruction.REVERSE, known_costs, unknown_borrow),
        ("normalUnknownCost", BasisConstruction.NORMAL, unknown_costs, known_borrow),
    ):
        executable = compute_executable_basis(
            construction=construction,
            spot_quote=spot_quote,
            perp_quote=perp_quote,
            intended_size=intended,
            as_of_ns=as_of,
            max_staleness_ns=STALENESS_NS,
        )
        edge = net_executable_edge(
            executable=executable,
            costs=costs,
            borrow=borrow,
            as_of_ns=as_of,
        )
        cases[name] = {
            "executable": executable.as_mapping(),
            "netEdge": edge.as_mapping(),
        }
    return cases


def _golden_funding() -> dict[str, object]:
    hour = 3_600 * SECOND_NS
    evidence = FundingEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 40 * hour,
        observations=(
            FundingObservationV1(
                event_time_ns=BASE_NS + 8 * hour, ordinal=0, rate=make_ratio(1, 10_000)
            ),
            FundingObservationV1(
                event_time_ns=BASE_NS + 16 * hour, ordinal=1, rate=make_ratio(3, 20_000)
            ),
            FundingObservationV1(
                event_time_ns=BASE_NS + 24 * hour, ordinal=2, rate=make_ratio(-1, 8_000)
            ),
        ),
        schedule_times_ns=(
            BASE_NS + 8 * hour,
            BASE_NS + 16 * hour,
            BASE_NS + 24 * hour,
            BASE_NS + 32 * hour,
        ),
    )
    empty = FundingEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 40 * hour,
        observations=(),
        schedule_times_ns=(),
    )
    as_of = BASE_NS + 25 * hour
    return {
        "change": funding_change(evidence, as_of_ns=as_of, max_staleness_ns=9 * hour).as_mapping(),
        "level": funding_level(evidence, as_of_ns=as_of, max_staleness_ns=9 * hour).as_mapping(),
        "missingLevel": funding_level(
            empty, as_of_ns=as_of, max_staleness_ns=9 * hour
        ).as_mapping(),
        "missingTimeToNext": time_to_next_funding(empty, as_of_ns=as_of).as_mapping(),
        "scheduleVerdict": schedule_interval_verdict(evidence, as_of_ns=as_of).value,
        "timeToNext": time_to_next_funding(evidence, as_of_ns=as_of).as_mapping(),
    }


def _golden_open_interest() -> dict[str, object]:
    evidence = OpenInterestEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        quality=QualityState.SAMPLED,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 130 * SECOND_NS,
        observations=(
            OpenInterestObservationV1(
                event_time_ns=BASE_NS + 10 * SECOND_NS,
                ordinal=0,
                open_interest=ExactScaledValueV1(coefficient=1_000, scale=0, unit_id="CONTRACTS"),
            ),
            OpenInterestObservationV1(
                event_time_ns=BASE_NS + 60 * SECOND_NS,
                ordinal=1,
                open_interest=ExactScaledValueV1(coefficient=1_200, scale=0, unit_id="CONTRACTS"),
            ),
            OpenInterestObservationV1(
                event_time_ns=BASE_NS + 110 * SECOND_NS,
                ordinal=2,
                open_interest=ExactScaledValueV1(coefficient=1_150, scale=0, unit_id="CONTRACTS"),
            ),
        ),
    )
    spot_series, _ = _golden_legs()
    as_of = BASE_NS + 111 * SECOND_NS
    return {
        "acceleration": oi_acceleration(
            evidence, as_of_ns=as_of, max_staleness_ns=120 * SECOND_NS
        ).as_mapping(),
        "change": oi_change(
            evidence, as_of_ns=as_of, max_staleness_ns=120 * SECOND_NS
        ).as_mapping(),
        "level": oi_level(evidence, as_of_ns=as_of, max_staleness_ns=120 * SECOND_NS).as_mapping(),
        "quadrant": price_oi_quadrant(
            price_series=spot_series,
            oi_evidence=evidence,
            window_start_ns=BASE_NS + 10 * SECOND_NS,
            window_end_ns=BASE_NS + 110 * SECOND_NS,
            max_staleness_ns=120 * SECOND_NS,
        ).value,
    }


def _golden_liquidations() -> dict[str, object]:
    evidence = LiquidationEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        quality=QualityState.SAMPLED,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 120 * SECOND_NS,
        events=(
            LiquidationEventV1(
                event_time_ns=BASE_NS + 10 * SECOND_NS,
                ordinal=0,
                side=LiquidationSide.LONG,
                price=_usdt(10_000),
                base_quantity=ExactScaledValueV1(coefficient=3, scale=0, unit_id="BNB"),
            ),
            LiquidationEventV1(
                event_time_ns=BASE_NS + 20 * SECOND_NS,
                ordinal=1,
                side=LiquidationSide.SHORT,
                price=_usdt(10_050),
                base_quantity=ExactScaledValueV1(coefficient=2, scale=0, unit_id="BNB"),
            ),
            LiquidationEventV1(
                event_time_ns=BASE_NS + 30 * SECOND_NS,
                ordinal=2,
                side=LiquidationSide.LONG,
                price=None,
                base_quantity=None,
            ),
        ),
    )
    window_start = BASE_NS
    window_end = BASE_NS + 60 * SECOND_NS
    known_window_end = BASE_NS + 25 * SECOND_NS
    return {
        "count": observed_liquidation_count(
            evidence, window_start_ns=window_start, window_end_ns=window_end
        ).as_mapping(),
        "knownNotional": observed_liquidation_notional(
            evidence, window_start_ns=window_start, window_end_ns=known_window_end
        ).as_mapping(),
        "longCount": observed_liquidation_count(
            evidence,
            window_start_ns=window_start,
            window_end_ns=window_end,
            side=LiquidationSide.LONG,
        ).as_mapping(),
        "unknownNotional": observed_liquidation_notional(
            evidence, window_start_ns=window_start, window_end_ns=window_end
        ).as_mapping(),
    }


def _seeded_pair(
    rng: DeterministicRandom,
    index: int,
) -> tuple[EvidenceSeriesV1, EvidenceSeriesV1]:
    spot_prices: list[tuple[int, int]] = []
    perp_prices: list[tuple[int, int]] = []
    spot = 5_000 + int(rng.next_u64() % 10_000)
    gap = int(rng.next_u64() % 200) - 60
    offset = 0
    count = 8 + int(rng.next_u64() % 50)
    for _ in range(count):
        offset += 1 + int(rng.next_u64() % 6)
        spot = max(spot + int(rng.next_u64() % 121) - 60, 200)
        decay = int(rng.next_u64() % 9) - 3
        gap = gap - decay if abs(gap) > 3 else gap
        spot_prices.append((offset, spot))
        perp_prices.append((offset, max(spot + gap, 100)))
    end_offset = offset + 5
    return (
        _price_series(
            series_id=f"q08-seeded-spot-{index:02d}",
            symbol="BNBUSDT",
            prices=spot_prices,
            end_offset_s=end_offset,
        ),
        _price_series(
            series_id=f"q08-seeded-perp-{index:02d}",
            symbol="BNBUSDT-PERP",
            prices=perp_prices,
            end_offset_s=end_offset,
        ),
    )


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    implementations = q08_features()
    registry = q08_registry()
    golden_path = _golden_path()
    golden_bars = build_basis_bars(
        golden_path,
        wall_width_ns=BAR_WIDTH_NS,
        anchor_ns=BASE_NS,
    )
    golden_reports = []
    golden_vectors = {}
    for implementation in implementations:
        report = run_equivalence(implementation, golden_bars)
        if not report.passed:
            raise ValueError(f"golden equivalence failed for {report.feature_id}")
        golden_reports.append(report.as_mapping())
        golden_vectors[implementation.card.feature_id] = vector_digest(
            streaming_vector(implementation, golden_bars)
        ).hexdigest

    spot_series, perp_series = _golden_legs()
    attributions = attribute_leg_changes(golden_path)
    convergence_estimate = estimate_convergence(
        path=golden_path,
        construction=BasisConstruction.NORMAL,
        definition_version="q08-convergence-v1",
        entry_ordinal=0,
        horizon_end_ns=golden_path.completeness_end_ns,
        threshold_fraction=make_ratio(1, 2),
    )
    target = convergence_target(convergence_estimate)
    filter_steps = FixedGainFilterV1(
        filter_version="q08-fixed-gain-v1",
        gain=make_ratio(1, 4),
    ).run(golden_path)
    diagnostic = mean_reversion_diagnostic(golden_path)
    leadlag = lead_lag_report(
        spot_series=spot_series,
        perp_series=perp_series,
        wall_width_ns=BAR_WIDTH_NS,
        anchor_ns=BASE_NS,
    )

    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    seeded_summaries = []
    max_ulp_by_feature: dict[str, int] = {}
    for index in range(SEEDED_PAIRS):
        seeded_spot, seeded_perp = _seeded_pair(rng, index)
        path = build_basis_path(
            path_id=f"q08-seeded-path-{index:02d}",
            spot_series=seeded_spot,
            perp_series=seeded_perp,
            reference_kind=ReferenceKind.LAST_TRADE,
            max_staleness_ns=10 * SECOND_NS,
        )
        bars = build_basis_bars(path, wall_width_ns=5 * SECOND_NS, anchor_ns=BASE_NS)
        for implementation in implementations:
            report = run_equivalence(implementation, bars)
            if not report.passed:
                raise ValueError(
                    f"seeded equivalence failed for {report.feature_id} on {path.path_id}"
                )
            feature_id = implementation.card.feature_id
            max_ulp_by_feature[feature_id] = max(
                max_ulp_by_feature.get(feature_id, 0),
                report.max_ulp_deviation,
            )
        seeded_summaries.append(
            {
                "attributions": len(attribute_leg_changes(path)),
                "bars": len(bars.bars),
                "pathId": path.path_id,
                "points": len(path.points),
            }
        )

    fixture = {
        "convergenceEstimate": convergence_estimate.as_mapping(),
        "convergenceTarget": None if target is None else target.as_mapping(),
        "executableCases": _golden_executable(),
        "filterFinalStep": filter_steps[-1].as_mapping(),
        "filterSteps": len(filter_steps),
        "funding": _golden_funding(),
        "goldenAttributionCount": len(attributions),
        "goldenAttributionFirst": attributions[0].as_mapping(),
        "goldenPathPoints": len(golden_path.points),
        "goldenReports": golden_reports,
        "goldenVectorSha256": dict(sorted(golden_vectors.items())),
        "leadLag": leadlag.as_mapping(),
        "liquidations": _golden_liquidations(),
        "meanReversion": diagnostic.as_mapping(),
        "openInterest": _golden_open_interest(),
        "registry": registry.as_mapping(),
        "registrySha256": registry.content_digest.hexdigest,
        "schema": "Q08DerivativesGoldenFixtureV1",
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture)
    campaign = {
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "maxUlpByFeature": dict(sorted(max_ulp_by_feature.items())),
        "schema": "Q08DerivativesCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "seededPairs": seeded_summaries,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign)
    markdown = render_registry_markdown(registry)
    lines = [
        markdown,
        "## Campaign evidence (synthetic only)",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        f"- Seeded pairs: {SEEDED_PAIRS}, all equivalence reports passed",
        "- Max ulp deviation by feature: "
        + ", ".join(f"`{k}`={v}" for k, v in sorted(max_ulp_by_feature.items())),
        "- Normal and reverse executable constructions remain distinct; unknown",
        "  borrow, funding or cost components stay UNKNOWN and never become zero.",
        "",
    ]
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m quant_edge.derivatives.campaign OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    fixture_path = output_root / "tests" / "q08" / "fixtures" / "q08_derivatives_golden_v1.json"
    campaign_path = output_root / "generated" / "q08" / "derivatives_campaign.v1.json"
    markdown_path = output_root / "generated" / "q08" / "derivatives_campaign.v1.md"
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(fixture_bytes)
    campaign_path.write_bytes(campaign_bytes)
    markdown_path.write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
