from __future__ import annotations

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.features.baselines import RollingMedianMad
from quant_edge.features.domains import (
    FeaturePointV1,
    FeatureSeriesV1,
    TradeCountBarSpecV1,
    VolumeBarSpecV1,
    WallTimeBarSpecV1,
    build_bars,
)
from quant_edge.features.fixedpoint import FixedPointV1, fp_from_int
from quant_edge.features.harness import run_equivalence, streaming_vector
from quant_edge.features.primitives import v1_features
from quant_edge.features.values import (
    FeatureValueStatus,
    derive_feature_value,
    status_from_quality,
    worst_status,
)
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1, QualityState

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000

PRICE_WALKS = st.lists(
    st.tuples(
        st.integers(min_value=1, max_value=9),  # seconds between points
        st.integers(min_value=-90, max_value=90),  # price move
        st.integers(min_value=0, max_value=50),  # volume
    ),
    min_size=2,
    max_size=80,
)


def _series(moves: list[tuple[int, int, int]]) -> FeatureSeriesV1:
    points = []
    offset = 0
    price = 10_000
    for index, (gap_s, move, volume) in enumerate(moves):
        offset += gap_s
        price = max(price + move, 100)
        points.append(
            FeaturePointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=index + 1,
                value=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
                volume=ExactScaledValueV1(coefficient=volume, scale=0, unit_id="BNB"),
            )
        )
    return FeatureSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + (offset + 5) * SECOND_NS,
        points=tuple(points),
    )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(moves=PRICE_WALKS, width_s=st.integers(min_value=1, max_value=30))
def test_streaming_batch_equivalence_holds_within_declared_tolerance(
    moves: list[tuple[int, int, int]],
    width_s: int,
) -> None:
    series = _series(moves)
    bars = build_bars(
        series,
        WallTimeBarSpecV1(wall_width_ns=width_s * SECOND_NS, anchor_ns=BASE_NS),
    )
    for implementation in v1_features():
        report = run_equivalence(implementation, bars)
        assert report.passed, report.as_mapping()
        # Determinism: identical inputs produce identical vectors.
        assert streaming_vector(implementation, bars) == streaming_vector(implementation, bars)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(moves=PRICE_WALKS, trades=st.integers(min_value=1, max_value=9))
def test_bar_boundary_laws(moves: list[tuple[int, int, int]], trades: int) -> None:
    series = _series(moves)
    trade_bars = build_bars(series, TradeCountBarSpecV1(trades_per_bar=trades))
    volume_bars = build_bars(
        series,
        VolumeBarSpecV1(
            volume_threshold=ExactScaledValueV1(coefficient=25, scale=0, unit_id="BNB")
        ),
    )

    total_points = len(series.points)
    assert sum(bar.point_count for bar in trade_bars.bars) == total_points
    assert sum(bar.point_count for bar in volume_bars.bars) == total_points
    for bar in trade_bars.bars[:-1]:
        assert bar.complete
        assert bar.point_count == trades
    if trade_bars.bars:
        tail = trade_bars.bars[-1]
        assert tail.complete == (tail.point_count == trades)
    for bar in volume_bars.bars:
        if bar.complete:
            assert bar.volume_aligned_total is not None
            assert bar.volume_aligned_total >= 25 * 10**38


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(values=st.lists(st.integers(min_value=-1_000, max_value=1_000), min_size=1, max_size=40))
def test_rolling_median_mad_matches_from_scratch_recompute(values: list[int]) -> None:
    window = 7
    streaming = RollingMedianMad(window)
    for index, value in enumerate(values):
        streaming.push(fp_from_int(value))
        reference = RollingMedianMad(window)
        for tail_value in values[max(0, index + 1 - window) : index + 1]:
            reference.push(fp_from_int(tail_value))
        assert streaming.median() == reference.median()
        assert streaming.mad() == reference.mad()


@settings(max_examples=80, deadline=None)
@seed(20260712)
@given(
    quality=st.sampled_from(list(QualityState)),
    age=st.integers(min_value=0, max_value=100),
    bound=st.integers(min_value=1, max_value=50),
    computed=st.booleans(),
)
def test_quality_propagation_never_upgrades(
    quality: QualityState,
    age: int,
    bound: int,
    computed: bool,
) -> None:
    value = derive_feature_value(
        feature_id="bar_return:v1",
        as_of_ns=BASE_NS + age,
        input_last_event_ns=BASE_NS,
        freshness_bound_ns=bound,
        input_quality=quality,
        computed=FixedPointV1(7) if computed else None,
    )

    floor = status_from_quality(quality)
    statuses = [floor]
    if age > bound:
        statuses.append(FeatureValueStatus.STALE)
    if not computed:
        statuses.append(FeatureValueStatus.UNKNOWN)
    assert value.status is worst_status(tuple(statuses))
    assert (value.value is not None) == (value.status is FeatureValueStatus.AVAILABLE)
