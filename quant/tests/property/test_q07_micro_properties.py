from __future__ import annotations

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.features.domains import BarV1
from quant_edge.lake.contracts import ExactScaledValueV1
from quant_edge.micro.bookfeat import (
    band_flow_feature,
    book_slope_imbalance_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    vwap_spread_at_size_feature,
)
from quant_edge.micro.equivalence import MicroFeatureImplementationV1, run_micro_equivalence
from quant_edge.micro.flow import (
    FLOW_WINDOW,
    absorption_ratio_feature,
    amihud_illiquidity_feature,
    batch_signed_trade_imbalance,
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
    TradePointV1,
    ladder_from_book_view,
)
from quant_edge.micro.l1 import (
    l1_queue_imbalance_feature,
    microprice_displacement_feature,
    ofi_l1_feature,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
A = 10**38
FP_ONE = 10**12

QUOTE_STEPS = st.lists(
    st.tuples(
        st.integers(min_value=0, max_value=5),  # seconds forward
        st.integers(min_value=-40, max_value=40),  # bid move in ticks
        st.integers(min_value=1, max_value=999),  # bid size
        st.integers(min_value=1, max_value=30),  # spread in ticks
        st.integers(min_value=1, max_value=999),  # ask size
    ),
    min_size=1,
    max_size=FLOW_WINDOW + 12,
)

LADDER_STEPS = st.lists(
    st.tuples(
        st.integers(min_value=0, max_value=3),  # bid levels beyond none
        st.integers(min_value=0, max_value=3),  # ask levels beyond none
        st.integers(min_value=-30, max_value=30),  # mid drift in ticks
        st.lists(st.integers(min_value=1, max_value=25), min_size=6, max_size=6),
    ),
    min_size=1,
    max_size=20,
)

TRADE_STEPS = st.lists(
    st.tuples(
        st.integers(min_value=0, max_value=4),  # seconds forward
        st.integers(min_value=1, max_value=500),  # size
        st.booleans(),  # taker buys
        st.booleans(),  # a prevailing quote exists
        st.integers(min_value=-20, max_value=20),  # quote mid drift in ticks
    ),
    min_size=1,
    max_size=FLOW_WINDOW + 10,
)

BAR_STEPS = st.lists(
    st.tuples(
        st.integers(min_value=-50, max_value=50),  # close move
        st.integers(min_value=0, max_value=9),  # volume (0 is honest)
        st.sampled_from(("complete", "incomplete", "empty")),
    ),
    min_size=1,
    max_size=FLOW_WINDOW + 8,
)


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


def _quotes(steps: list[tuple[int, int, int, int, int]]) -> tuple[TopOfBookPointV1, ...]:
    points = []
    offset = 0
    bid = 10_000
    for index, (gap, move, bid_size, spread, ask_size) in enumerate(steps):
        offset += gap
        bid = max(bid + move, 100)
        points.append(
            TopOfBookPointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=index + 1,
                bid_price=_scaled(bid),
                bid_size=_scaled(bid_size),
                ask_price=_scaled(bid + spread),
                ask_size=_scaled(ask_size),
            )
        )
    return tuple(points)


def _ladders(
    steps: list[tuple[int, int, int, list[int]]],
) -> tuple[LadderSnapshotV1, ...]:
    snapshots = []
    best_bid = 10_000
    for index, (extra_bids, extra_asks, drift, sizes) in enumerate(steps):
        best_bid = max(best_bid + drift, 500)
        bids = tuple(((best_bid - level * 3) * A, sizes[level] * A) for level in range(extra_bids))
        asks = tuple(
            ((best_bid + 2 + level * 3) * A, sizes[3 + level] * A) for level in range(extra_asks)
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


def _joined(
    steps: list[tuple[int, int, bool, bool, int]],
) -> tuple[JoinedTradeV1, ...]:
    trades = []
    offset = 0
    mid_bid = 10_000
    for index, (gap, size, buy, quoted, drift) in enumerate(steps):
        offset += gap
        mid_bid = max(mid_bid + drift, 100)
        trade = TradePointV1(
            event_time_ns=BASE_NS + offset * SECOND_NS,
            ordinal=index + 1,
            price=_scaled(mid_bid + 1),
            size=_scaled(size),
            is_buyer_maker=not buy,
        )
        prevailing = (
            TopOfBookPointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=index + 1,
                bid_price=_scaled(mid_bid),
                bid_size=_scaled(7),
                ask_price=_scaled(mid_bid + 2),
                ask_size=_scaled(5),
            )
            if quoted
            else None
        )
        trades.append(JoinedTradeV1(trade=trade, prevailing=prevailing))
    return tuple(trades)


def _bars(steps: list[tuple[int, int, str]]) -> tuple[BarV1, ...]:
    bars = []
    close = 10_000
    for index, (move, volume, kind) in enumerate(steps):
        close = max(close + move, 100)
        empty = kind == "empty"
        bars.append(
            BarV1(
                index=index,
                start_ns=BASE_NS + index * SECOND_NS,
                end_ns=BASE_NS + (index + 1) * SECOND_NS,
                point_count=0 if empty else 1,
                first_value_aligned=None if empty else close,
                last_value_aligned=None if empty else close,
                volume_aligned_total=None if empty else volume,
                complete=kind != "incomplete",
            )
        )
    return tuple(bars)


def _assert_equivalent[ItemT](
    implementation: MicroFeatureImplementationV1[ItemT],
    items: tuple[ItemT, ...],
) -> None:
    report = run_micro_equivalence(implementation, items)
    assert report.passed, report.as_mapping()
    assert report.max_ulp_deviation == 0
    assert report.max_update_ops <= implementation.declared_max_update_ops


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(QUOTE_STEPS)
def test_l1_features_stream_exactly_like_batch(
    steps: list[tuple[int, int, int, int, int]],
) -> None:
    points = _quotes(steps)
    for implementation in (
        ofi_l1_feature(),
        l1_queue_imbalance_feature(),
        microprice_displacement_feature(),
    ):
        _assert_equivalent(implementation, points)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(QUOTE_STEPS)
def test_queue_imbalance_is_bounded(steps: list[tuple[int, int, int, int, int]]) -> None:
    implementation = l1_queue_imbalance_feature()
    points = _quotes(steps)
    for index in range(len(points)):
        value = implementation.batch(points[: index + 1])
        assert value is not None
        assert -FP_ONE <= value.mantissa <= FP_ONE


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(LADDER_STEPS)
def test_book_features_stream_exactly_like_batch(
    steps: list[tuple[int, int, int, list[int]]],
) -> None:
    snapshots = _ladders(steps)
    for implementation in (
        band_flow_feature(),
        cumulative_band_imbalance_feature(),
        book_slope_imbalance_feature(),
        depth_resiliency_feature(),
        vwap_spread_at_size_feature(),
    ):
        _assert_equivalent(implementation, snapshots)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(TRADE_STEPS)
def test_flow_features_stream_exactly_like_batch(
    steps: list[tuple[int, int, bool, bool, int]],
) -> None:
    trades = _joined(steps)
    for implementation in (
        signed_trade_imbalance_feature(),
        trade_intensity_feature(),
        trade_dispersion_feature(),
        size_concentration_hhi_feature(),
        effective_spread_feature(),
        kyle_slope_feature(),
        absorption_ratio_feature(),
    ):
        _assert_equivalent(implementation, trades)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(TRADE_STEPS)
def test_signed_imbalance_windows_and_bounds(
    steps: list[tuple[int, int, bool, bool, int]],
) -> None:
    trades = _joined(steps)

    full = batch_signed_trade_imbalance(trades)
    windowed = batch_signed_trade_imbalance(trades[-FLOW_WINDOW:])
    assert full is not None
    assert windowed is not None
    assert full.mantissa == windowed.mantissa
    assert -FP_ONE <= full.mantissa <= FP_ONE


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(TRADE_STEPS)
def test_absorption_and_hhi_stay_in_unit_range(
    steps: list[tuple[int, int, bool, bool, int]],
) -> None:
    trades = _joined(steps)

    hhi = size_concentration_hhi_feature().batch(trades)
    assert hhi is not None
    assert 0 < hhi.mantissa <= FP_ONE

    absorption = absorption_ratio_feature().batch(trades)
    if absorption is not None:
        assert 0 < absorption.mantissa <= FP_ONE


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(BAR_STEPS)
def test_amihud_streams_exactly_and_never_goes_negative(
    steps: list[tuple[int, int, str]],
) -> None:
    bars = _bars(steps)
    implementation = amihud_illiquidity_feature()

    _assert_equivalent(implementation, bars)
    value = implementation.batch(bars)
    if value is not None:
        assert value.mantissa >= 0


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.integers(min_value=1, max_value=900),
    st.integers(min_value=1, max_value=900),
    st.integers(min_value=1, max_value=900),
)
def test_ofi_sign_follows_pure_size_pressure(bid_before: int, bid_after: int, ask: int) -> None:
    implementation = ofi_l1_feature()
    points = tuple(
        TopOfBookPointV1(
            event_time_ns=BASE_NS + index * SECOND_NS,
            ordinal=index + 1,
            bid_price=_scaled(10_000),
            bid_size=_scaled(size),
            ask_price=_scaled(10_010),
            ask_size=_scaled(ask),
        )
        for index, size in enumerate((bid_before, bid_after))
    )

    value = implementation.batch(points)

    assert value is not None
    # With prices pinned, OFI reduces to the bid-size change exactly.
    assert value.mantissa == (bid_after - bid_before) * FP_ONE // 100
