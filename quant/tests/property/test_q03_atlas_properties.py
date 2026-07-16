from __future__ import annotations

import hashlib

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.bootstrap.atlas import (
    DiscoveryBasis,
    DiscoveryMetric,
    DiscoveryRuleV1,
    EventAtlasV1,
    HistoricalAtlasInputV1,
    build_event_atlas,
)
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    QualityFactsV1,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)

BASE_MS = 1_510_000_000_000
AS_OF_MS = 1_783_814_400_000
WINDOW_NS = 60_000_000_000


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _row(index: int, *, window: int, offset_ms: int, price: int) -> ReferenceMarketEvidenceRowV1:
    event_ms = BASE_MS + window * 60_000 + offset_ms
    return ReferenceMarketEvidenceRowV1(
        record_id=f"row-{index}",
        source_id="binance-public-data",
        source_endpoint="spot-daily-aggTrades",
        venue="binance",
        product="spot",
        event_kind="aggTrades",
        symbol="BNBUSDT",
        base_asset_id="BNB",
        quote_asset_id="USDT",
        instrument_version="archive-contract.v1",
        stream_id="historical-archive",
        event_time=RawTimestampV1(
            raw=event_ms,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
        trade_time=None,
        receive_wall_time=None,
        receive_monotonic_ns=None,
        normalization_time_ns=(AS_OF_MS - 2) * 1_000_000,
        persistence_time_ns=(AS_OF_MS - 1) * 1_000_000,
        session_id="archive-session",
        sequence_first=index,
        sequence_last=index,
        raw_payload_digest=_digest(f"payload-{index}"),
        posture=EvidencePosture.REPLAY,
        duplicate=False,
        late=False,
        quality=derive_quality(
            QualityFactsV1(
                available=True,
                synthetic=False,
                gap=False,
                stale=False,
                reconstructing=False,
                sampled=False,
                partial=True,
                complete_proven=False,
            )
        ),
        price=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
        quantity=ExactScaledValueV1(coefficient=100, scale=3, unit_id="BNB"),
    )


def _build(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...],
    rule: DiscoveryRuleV1,
) -> EventAtlasV1:
    return build_event_atlas(
        revision="event-atlas.q03.property.v1",
        as_of_ms=AS_OF_MS,
        historical=HistoricalAtlasInputV1(
            rows=rows,
            manifest_digest=_digest("manifest"),
            manifest_published_at_ns=AS_OF_MS * 1_000_000,
            coverage_digest=_digest("historical-coverage"),
            invalid_row_count=0,
            known_gap_count=0,
            duplicate_row_count=0,
        ),
        forward_coverage_digest=_digest("forward-coverage"),
        forward_fixture_digest=_digest("forward-fixture"),
        forward_schema_digest=_digest("forward-schema"),
        rules=(rule,),
    )


@settings(max_examples=24, deadline=None)
@seed(20260712)
@given(permutation=st.permutations((0, 1, 2, 3)))
def test_atlas_bytes_are_invariant_to_validated_row_permutation(
    permutation: list[int],
) -> None:
    rows = (
        _row(0, window=0, offset_ms=1, price=10_000),
        _row(1, window=0, offset_ms=2, price=10_100),
        _row(2, window=1, offset_ms=1, price=10_200),
        _row(3, window=1, offset_ms=2, price=10_300),
    )
    rule = DiscoveryRuleV1(
        "absolute.trade-count.property.v1",
        "v1",
        DiscoveryMetric.TRADE_COUNT,
        DiscoveryBasis.ABSOLUTE,
        WINDOW_NS,
        2,
        1,
        0,
    )

    canonical = _build(rows, rule)
    permuted = _build(tuple(rows[index] for index in permutation), rule)

    assert canonical.canonical_bytes() == permuted.canonical_bytes()
    assert canonical.sha256 == permuted.sha256


@settings(max_examples=48, deadline=None)
@seed(20260712)
@given(
    low=st.integers(min_value=1, max_value=10**12),
    delta=st.integers(min_value=0, max_value=10**12),
    threshold_numerator=st.integers(min_value=1, max_value=10**6),
    threshold_denominator=st.integers(min_value=1, max_value=10**6),
)
def test_absolute_price_discovery_is_exact_rational_cross_multiplication(
    low: int,
    delta: int,
    threshold_numerator: int,
    threshold_denominator: int,
) -> None:
    rule = DiscoveryRuleV1(
        "absolute.price-range.property.v1",
        "v1",
        DiscoveryMetric.PRICE_RANGE,
        DiscoveryBasis.ABSOLUTE,
        WINDOW_NS,
        threshold_numerator,
        threshold_denominator,
        0,
    )
    atlas = _build(
        (
            _row(0, window=0, offset_ms=1, price=low),
            _row(1, window=0, offset_ms=2, price=low + delta),
        ),
        rule,
    )

    expected = delta * threshold_denominator >= low * threshold_numerator
    assert (atlas.total_candidate_count == 1) is expected
    assert atlas.total_candidate_count + atlas.total_control_count == 1


@settings(max_examples=32, deadline=None)
@seed(20260712)
@given(
    baseline_a=st.integers(min_value=1, max_value=12),
    baseline_b=st.integers(min_value=1, max_value=12),
    current=st.integers(min_value=1, max_value=24),
    threshold_numerator=st.integers(min_value=1, max_value=8),
    threshold_denominator=st.integers(min_value=1, max_value=8),
)
def test_relative_trade_count_uses_exact_previous_window_mean(
    baseline_a: int,
    baseline_b: int,
    current: int,
    threshold_numerator: int,
    threshold_denominator: int,
) -> None:
    rows: list[ReferenceMarketEvidenceRowV1] = []
    next_id = 0
    for window, count in enumerate((baseline_a, baseline_b, current)):
        for offset in range(count):
            rows.append(_row(next_id, window=window, offset_ms=offset, price=10_000))
            next_id += 1
    rule = DiscoveryRuleV1(
        "relative.trade-count.property.v1",
        "v1",
        DiscoveryMetric.TRADE_COUNT,
        DiscoveryBasis.PREVIOUS_WINDOW_MEAN,
        WINDOW_NS,
        threshold_numerator,
        threshold_denominator,
        2,
    )
    atlas = _build(tuple(rows), rule)
    final = max((*atlas.candidates, *atlas.controls), key=lambda record: record.window_start_ns)

    expected = (
        current * 2 * threshold_denominator >= (baseline_a + baseline_b) * threshold_numerator
    )
    assert (final.inventory_class.value == "CANDIDATE") is expected
