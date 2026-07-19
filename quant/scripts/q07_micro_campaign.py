"""Deterministic Q07 microstructure campaign and golden-fixture builder.

Usage: ``python scripts/q07_micro_campaign.py OUTPUT_ROOT``

Writes, byte-deterministically and without any network or environment access:

- ``OUTPUT_ROOT/fixtures/q07_micro_golden_v1.json``
- ``OUTPUT_ROOT/generated/q07/micro_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q07/micro_campaign.v1.md``

Host wall-time measurements are printed to stdout as environment-specific evidence;
they never enter the artifacts and are never asserted by any test.

Everything here is SYNTHETIC fixture evidence proving the §13.1 machinery: streaming
and batch implementations agree exactly, update costs stay within their declared
bounds, and every family bullet carries an honest disposition. No feature is claimed
to be predictive, validated or economically valuable.
"""

from __future__ import annotations

import hashlib
import sys
import time
from pathlib import Path

from quant_edge.canonical import canonical_json_bytes
from quant_edge.features.domains import BarV1
from quant_edge.features.registry import FeatureRegistryV1, render_registry_markdown
from quant_edge.lake.contracts import DigestV1, EvidencePosture, ExactScaledValueV1
from quant_edge.micro.activity import (
    ActivityObservationV1,
    activity_surprise_feature,
)
from quant_edge.micro.bookfeat import (
    band_flow_feature,
    book_slope_imbalance_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    vwap_spread_at_size_feature,
)
from quant_edge.micro.equivalence import (
    MicroEquivalenceReportV1,
    MicroFeatureImplementationV1,
    run_micro_equivalence,
)
from quant_edge.micro.families import (
    SECTION_13_1_DISPOSITIONS,
    disposition_table_digest,
    spoof_pattern_semantics,
)
from quant_edge.micro.flow import (
    absorption_ratio_feature,
    amihud_illiquidity_feature,
    effective_spread_feature,
    kyle_slope_feature,
    signed_trade_imbalance_feature,
    size_concentration_hhi_feature,
    trade_dispersion_feature,
    trade_intensity_feature,
)
from quant_edge.micro.inputs import (
    JoinedTradeV1,
    LadderSnapshotV1,
    TopOfBookPointV1,
    TopOfBookSeriesV1,
    TradePointV1,
    TradeSeriesV1,
    join_trades_with_quotes,
    ladder_from_book_view,
)
from quant_edge.micro.l1 import (
    l1_queue_imbalance_feature,
    microprice_displacement_feature,
    ofi_l1_feature,
)
from quant_edge.micro.point_process import (
    PointCoverageStatus,
    PointEventSegmentV1,
    PointEventSemantics,
    PointEventV1,
    PointEvidencePosture,
    PublicEventKind,
    add_intensity_feature,
    cancel_intensity_feature,
)
from quant_edge.randomness import DeterministicRandom

CAMPAIGN_SEED = 20260712
SEEDED_SCENARIOS = 10
BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
ALIGNED = 10**38


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


def _quote(
    offset_s: int, ordinal: int, bid: int, bid_size: int, ask: int, ask_size: int
) -> TopOfBookPointV1:
    return TopOfBookPointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        bid_price=_scaled(bid),
        bid_size=_scaled(bid_size),
        ask_price=_scaled(ask),
        ask_size=_scaled(ask_size),
    )


def _golden_quotes() -> tuple[TopOfBookPointV1, ...]:
    points = []
    bid = 10_000
    for index in range(40):
        bid = max(bid + ((index * 29) % 15 - 7) * 3, 500)
        points.append(
            _quote(
                index,
                index + 1,
                bid,
                100 + (index * 37) % 400,
                bid + 4 + (index * 13) % 9,
                100 + (index * 53) % 400,
            )
        )
    return tuple(points)


def _golden_ladders() -> tuple[LadderSnapshotV1, ...]:
    snapshots = []
    best_bid = 10_000
    for index in range(30):
        best_bid = max(best_bid + ((index * 31) % 13 - 6) * 2, 500)
        bid_count = (index % 6) or 5
        ask_count = ((index + 3) % 6) or 5
        bids = tuple(
            ((best_bid - 2 * level) * ALIGNED, (2 + (index + level * 5) % 14) * ALIGNED)
            for level in range(bid_count)
        )
        asks = tuple(
            ((best_bid + 3 + 2 * level) * ALIGNED, (2 + (index + level * 7) % 14) * ALIGNED)
            for level in range(ask_count)
        )
        snapshots.append(
            ladder_from_book_view(
                event_time_ns=BASE_NS + index * SECOND_NS,
                ordinal=index + 1,
                bids=bids,
                asks=asks,
            )
        )
    return tuple(snapshots)


def _golden_joined() -> tuple[JoinedTradeV1, ...]:
    quotes = TopOfBookSeriesV1(
        series_id="q07-golden-quotes",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        points=_golden_quotes(),
    )
    trades = TradeSeriesV1(
        series_id="q07-golden-trades",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        trades=tuple(
            TradePointV1(
                event_time_ns=BASE_NS + (index * 39 // 32) * SECOND_NS,
                ordinal=index + 1,
                price=_scaled(10_000 + (index * 17) % 23),
                size=_scaled(50 + (index * 41) % 450),
                is_buyer_maker=index % 3 == 0,
            )
            for index in range(32)
        ),
    )
    return join_trades_with_quotes(trades, quotes)


def _golden_bars() -> tuple[BarV1, ...]:
    bars = []
    close = 10_000
    for index in range(30):
        close = max(close + ((index * 43) % 17 - 8) * 5, 500)
        empty = index % 9 == 7
        bars.append(
            BarV1(
                index=index,
                start_ns=BASE_NS + index * SECOND_NS,
                end_ns=BASE_NS + (index + 1) * SECOND_NS,
                point_count=0 if empty else 2,
                first_value_aligned=None if empty else close,
                last_value_aligned=None if empty else close,
                volume_aligned_total=None if empty else (index * 7) % 12,
                complete=index % 8 != 5,
            )
        )
    return tuple(bars)


def _golden_activity() -> tuple[ActivityObservationV1, ...]:
    return tuple(
        ActivityObservationV1(
            observation_id=f"q07-golden-activity-{index:02d}",
            event_time_ns=BASE_NS + index * SECOND_NS,
            ordinal=index,
            trades=2 + (index * 7) % 19,
            quote_updates=3 + (index * 11) % 23,
            spread_ticks=1 + index % 3,
            bid_depth=100 + (index * 13) % 80,
            ask_depth=100 + (index * 17) % 80,
            peer_activity=5 + (index * 5) % 29,
        )
        for index in range(40)
    )


def _golden_point_segments() -> tuple[PointEventSegmentV1, ...]:
    segments: list[PointEventSegmentV1] = []
    for segment_index in range(12):
        start_ns = BASE_NS + segment_index * 12 * SECOND_NS
        kinds = (
            ()
            if segment_index == 5
            else (
                PublicEventKind.ADD,
                PublicEventKind.CANCEL,
                PublicEventKind.BUY,
                PublicEventKind.CANCEL,
            )
        )
        segments.append(
            PointEventSegmentV1(
                segment_id=f"q07-golden-point-{segment_index:02d}",
                source_id="q07-golden-public-lifecycle",
                source_revision="synthetic-v1",
                source_sha256=DigestV1("7" * 64),
                posture=PointEvidencePosture.SYNTHETIC_RESEARCH_ONLY,
                coverage=PointCoverageStatus.COMPLETE,
                semantics=PointEventSemantics.PUBLIC_ORDER_LIFECYCLE,
                start_ns=start_ns,
                end_ns=start_ns + 10 * SECOND_NS,
                events=tuple(
                    PointEventV1(
                        event_id=f"q07-golden-point-{segment_index:02d}-{ordinal:02d}",
                        event_time_ns=start_ns + ordinal * SECOND_NS,
                        ordinal=ordinal,
                        kind=kind,
                    )
                    for ordinal, kind in enumerate(kinds, 1)
                ),
            )
        )
    return tuple(segments)


def _seeded_quotes(rng: DeterministicRandom) -> tuple[TopOfBookPointV1, ...]:
    points = []
    bid = 5_000 + int(rng.next_u64() % 10_000)
    offset = 0
    for index in range(20 + int(rng.next_u64() % 21)):
        offset += int(rng.next_u64() % 4)
        bid = max(bid + int(rng.next_u64() % 81) - 40, 500)
        points.append(
            _quote(
                offset + index,  # index keeps event times strictly increasing
                index + 1,
                bid,
                1 + int(rng.next_u64() % 900),
                bid + 1 + int(rng.next_u64() % 30),
                1 + int(rng.next_u64() % 900),
            )
        )
    return tuple(points)


def _seeded_ladders(rng: DeterministicRandom) -> tuple[LadderSnapshotV1, ...]:
    snapshots = []
    best_bid = 5_000 + int(rng.next_u64() % 10_000)
    for index in range(15 + int(rng.next_u64() % 16)):
        best_bid = max(best_bid + int(rng.next_u64() % 41) - 20, 500)
        bids = tuple(
            (
                (best_bid - 1 - 2 * level) * ALIGNED,
                (1 + int(rng.next_u64() % 24)) * ALIGNED,
            )
            for level in range(int(rng.next_u64() % 7))
        )
        asks = tuple(
            (
                (best_bid + 1 + 2 * level) * ALIGNED,
                (1 + int(rng.next_u64() % 24)) * ALIGNED,
            )
            for level in range(int(rng.next_u64() % 7))
        )
        snapshots.append(
            ladder_from_book_view(
                event_time_ns=BASE_NS + index * SECOND_NS,
                ordinal=index + 1,
                bids=bids,
                asks=asks,
            )
        )
    return tuple(snapshots)


def _seeded_joined(rng: DeterministicRandom) -> tuple[JoinedTradeV1, ...]:
    trades = []
    offset = 0
    price = 5_000 + int(rng.next_u64() % 10_000)
    for index in range(20 + int(rng.next_u64() % 21)):
        offset += int(rng.next_u64() % 3)
        price = max(price + int(rng.next_u64() % 41) - 20, 200)
        trade = TradePointV1(
            event_time_ns=BASE_NS + offset * SECOND_NS,
            ordinal=index + 1,
            price=_scaled(price),
            size=_scaled(1 + int(rng.next_u64() % 800)),
            is_buyer_maker=rng.next_u64() % 2 == 0,
        )
        prevailing = None
        if rng.next_u64() % 5 != 0:
            prevailing = _quote(
                offset,
                index + 1,
                max(price - 1 - int(rng.next_u64() % 5), 100),
                1 + int(rng.next_u64() % 500),
                price + 1 + int(rng.next_u64() % 5),
                1 + int(rng.next_u64() % 500),
            )
        trades.append(JoinedTradeV1(trade=trade, prevailing=prevailing))
    return tuple(trades)


def _seeded_bars(rng: DeterministicRandom) -> tuple[BarV1, ...]:
    bars = []
    close = 5_000 + int(rng.next_u64() % 10_000)
    for index in range(15 + int(rng.next_u64() % 16)):
        close = max(close + int(rng.next_u64() % 101) - 50, 200)
        empty = rng.next_u64() % 8 == 0
        bars.append(
            BarV1(
                index=index,
                start_ns=BASE_NS + index * SECOND_NS,
                end_ns=BASE_NS + (index + 1) * SECOND_NS,
                point_count=0 if empty else 1,
                first_value_aligned=None if empty else close,
                last_value_aligned=None if empty else close,
                volume_aligned_total=None if empty else int(rng.next_u64() % 15),
                complete=rng.next_u64() % 7 != 0,
            )
        )
    return tuple(bars)


def _seeded_activity(rng: DeterministicRandom) -> tuple[ActivityObservationV1, ...]:
    return tuple(
        ActivityObservationV1(
            observation_id=f"q07-seeded-activity-{index:02d}",
            event_time_ns=BASE_NS + index * SECOND_NS,
            ordinal=index,
            trades=1 + int(rng.next_u64() % 40),
            quote_updates=1 + int(rng.next_u64() % 50),
            spread_ticks=int(rng.next_u64() % 5),
            bid_depth=1 + int(rng.next_u64() % 500),
            ask_depth=1 + int(rng.next_u64() % 500),
            peer_activity=1 + int(rng.next_u64() % 70),
        )
        for index in range(20 + int(rng.next_u64() % 21))
    )


def _seeded_point_segments(
    rng: DeterministicRandom,
) -> tuple[PointEventSegmentV1, ...]:
    segments: list[PointEventSegmentV1] = []
    lifecycle_kinds = (
        PublicEventKind.BUY,
        PublicEventKind.SELL,
        PublicEventKind.ADD,
        PublicEventKind.CANCEL,
    )
    for segment_index in range(8 + int(rng.next_u64() % 9)):
        start_ns = BASE_NS + segment_index * 12 * SECOND_NS
        event_count = int(rng.next_u64() % 8)
        segments.append(
            PointEventSegmentV1(
                segment_id=f"q07-seeded-point-{segment_index:02d}",
                source_id="q07-seeded-public-lifecycle",
                source_revision="synthetic-v1",
                source_sha256=DigestV1("8" * 64),
                posture=PointEvidencePosture.SYNTHETIC_RESEARCH_ONLY,
                coverage=PointCoverageStatus.COMPLETE,
                semantics=PointEventSemantics.PUBLIC_ORDER_LIFECYCLE,
                start_ns=start_ns,
                end_ns=start_ns + 10 * SECOND_NS,
                events=tuple(
                    PointEventV1(
                        event_id=f"q07-seeded-point-{segment_index:02d}-{ordinal:02d}",
                        event_time_ns=start_ns + ordinal * SECOND_NS,
                        ordinal=ordinal,
                        kind=lifecycle_kinds[int(rng.next_u64() % len(lifecycle_kinds))],
                    )
                    for ordinal in range(1, event_count + 1)
                ),
            )
        )
    return tuple(segments)


def _quote_features() -> tuple[MicroFeatureImplementationV1[TopOfBookPointV1], ...]:
    return (ofi_l1_feature(), l1_queue_imbalance_feature(), microprice_displacement_feature())


def _ladder_features() -> tuple[MicroFeatureImplementationV1[LadderSnapshotV1], ...]:
    return (
        band_flow_feature(),
        cumulative_band_imbalance_feature(),
        book_slope_imbalance_feature(),
        depth_resiliency_feature(),
        vwap_spread_at_size_feature(),
    )


def _trade_features() -> tuple[MicroFeatureImplementationV1[JoinedTradeV1], ...]:
    return (
        signed_trade_imbalance_feature(),
        trade_intensity_feature(),
        trade_dispersion_feature(),
        size_concentration_hhi_feature(),
        effective_spread_feature(),
        kyle_slope_feature(),
        absorption_ratio_feature(),
    )


def _activity_features() -> tuple[MicroFeatureImplementationV1[ActivityObservationV1], ...]:
    return (activity_surprise_feature(),)


def _point_features() -> tuple[MicroFeatureImplementationV1[PointEventSegmentV1], ...]:
    return (add_intensity_feature(), cancel_intensity_feature())


def _run_all(
    quotes: tuple[TopOfBookPointV1, ...],
    ladders: tuple[LadderSnapshotV1, ...],
    joined: tuple[JoinedTradeV1, ...],
    bars: tuple[BarV1, ...],
    activity: tuple[ActivityObservationV1, ...],
    point_segments: tuple[PointEventSegmentV1, ...],
) -> list[MicroEquivalenceReportV1]:
    reports: list[MicroEquivalenceReportV1] = []
    reports.extend(run_micro_equivalence(impl, quotes) for impl in _quote_features())
    reports.extend(run_micro_equivalence(impl, ladders) for impl in _ladder_features())
    reports.extend(run_micro_equivalence(impl, joined) for impl in _trade_features())
    reports.append(run_micro_equivalence(amihud_illiquidity_feature(), bars))
    reports.extend(run_micro_equivalence(impl, activity) for impl in _activity_features())
    reports.extend(run_micro_equivalence(impl, point_segments) for impl in _point_features())
    return reports


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    all_cards = [impl.card for impl in _quote_features()]
    all_cards.extend(impl.card for impl in _ladder_features())
    all_cards.extend(impl.card for impl in _trade_features())
    all_cards.append(amihud_illiquidity_feature().card)
    all_cards.extend(impl.card for impl in _activity_features())
    all_cards.extend(impl.card for impl in _point_features())
    registry = FeatureRegistryV1(
        registry_version="q07-micro-v1",
        cards=tuple(sorted(all_cards, key=lambda card: card.feature_id)),
    )

    golden_reports = _run_all(
        _golden_quotes(),
        _golden_ladders(),
        _golden_joined(),
        _golden_bars(),
        _golden_activity(),
        _golden_point_segments(),
    )
    for report in golden_reports:
        if not report.passed:
            raise ValueError(f"golden equivalence failed for {report.feature_id}")

    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    max_ulp_by_feature: dict[str, int] = {}
    max_ops_by_feature: dict[str, int] = {}
    scenario_summaries = []
    for index in range(SEEDED_SCENARIOS):
        quotes = _seeded_quotes(rng)
        ladders = _seeded_ladders(rng)
        joined = _seeded_joined(rng)
        bars = _seeded_bars(rng)
        activity = _seeded_activity(rng)
        point_segments = _seeded_point_segments(rng)
        for report in _run_all(quotes, ladders, joined, bars, activity, point_segments):
            if not report.passed:
                raise ValueError(
                    f"seeded equivalence failed for {report.feature_id} in scenario {index}"
                )
            max_ulp_by_feature[report.feature_id] = max(
                max_ulp_by_feature.get(report.feature_id, 0),
                report.max_ulp_deviation,
            )
            max_ops_by_feature[report.feature_id] = max(
                max_ops_by_feature.get(report.feature_id, 0),
                report.max_update_ops,
            )
        scenario_summaries.append(
            {
                "activityObservations": len(activity),
                "bars": len(bars),
                "joinedTrades": len(joined),
                "ladders": len(ladders),
                "pointSegments": len(point_segments),
                "quotes": len(quotes),
                "scenario": index,
            }
        )

    fixture = {
        "dispositionSha256": disposition_table_digest().hexdigest,
        "dispositionTable": [record.as_mapping() for record in SECTION_13_1_DISPOSITIONS],
        "goldenReports": [report.as_mapping() for report in golden_reports],
        "registry": registry.as_mapping(),
        "registrySha256": registry.content_digest.hexdigest,
        "schema": "Q07MicroGoldenFixtureV1",
        "spoofPatternSemantics": spoof_pattern_semantics(),
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture)
    campaign = {
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "maxUlpByFeature": dict(sorted(max_ulp_by_feature.items())),
        "maxUpdateOpsByFeature": dict(sorted(max_ops_by_feature.items())),
        "schema": "Q07MicroCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "seededScenarios": scenario_summaries,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign)
    lines = [
        render_registry_markdown(registry),
        "## Section 13.1 dispositions",
        "",
        "| Bullet | Disposition | Implemented features |",
        "| --- | --- | --- |",
    ]
    lines.extend(
        f"| {record.bullet_id} | {record.disposition.value} | "
        f"{', '.join(record.implemented_features) or '—'} |"
        for record in SECTION_13_1_DISPOSITIONS
    )
    lines.extend(
        [
            "",
            "## Campaign evidence (synthetic only)",
            "",
            f"- Seed: `{CAMPAIGN_SEED}`",
            f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
            f"- Disposition table SHA-256: `{disposition_table_digest().hexdigest}`",
            f"- Seeded scenarios: {SEEDED_SCENARIOS}, all equivalence reports passed",
            "- Max update ops by feature: "
            + ", ".join(f"`{k}`={v}" for k, v in sorted(max_ops_by_feature.items())),
            "",
            f"> {spoof_pattern_semantics()}",
            "",
        ]
    )
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def _time_streaming[ItemT](
    implementation: MicroFeatureImplementationV1[ItemT],
    items: tuple[ItemT, ...],
) -> str:
    """Host wall time for one full streaming pass; stdout-only evidence."""

    streaming = implementation.make_streaming()
    started = time.perf_counter_ns()
    for item in items:
        streaming.update(item)
    elapsed = time.perf_counter_ns() - started
    return f"wall-ns {implementation.card.feature_id} items={len(items)} streaming={elapsed}"


def wall_time_evidence() -> list[str]:
    """Environment-specific wall-time lines; never in artifacts, never asserted."""

    quotes = _golden_quotes()
    ladders = _golden_ladders()
    joined = _golden_joined()
    bars = _golden_bars()
    activity = _golden_activity()
    point_segments = _golden_point_segments()
    lines = ["# environment-specific wall-time evidence (non-deterministic, informational)"]
    lines.extend(_time_streaming(impl, quotes) for impl in _quote_features())
    lines.extend(_time_streaming(impl, ladders) for impl in _ladder_features())
    lines.extend(_time_streaming(impl, joined) for impl in _trade_features())
    lines.append(_time_streaming(amihud_illiquidity_feature(), bars))
    lines.extend(_time_streaming(impl, activity) for impl in _activity_features())
    lines.extend(_time_streaming(impl, point_segments) for impl in _point_features())
    return lines


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q07_micro_campaign.py OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    fixture_path = output_root / "fixtures" / "q07_micro_golden_v1.json"
    campaign_path = output_root / "generated" / "q07" / "micro_campaign.v1.json"
    markdown_path = output_root / "generated" / "q07" / "micro_campaign.v1.md"
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(fixture_bytes)
    campaign_path.write_bytes(campaign_bytes)
    markdown_path.write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    for line in wall_time_evidence():
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
