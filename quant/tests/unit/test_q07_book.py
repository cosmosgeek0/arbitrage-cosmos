from __future__ import annotations

from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.micro.bookfeat import (
    BAND_LEVELS,
    band_flow_feature,
    batch_depth_resiliency,
    book_slope_imbalance_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    vwap_spread_at_size_feature,
)
from quant_edge.micro.equivalence import run_micro_equivalence
from quant_edge.micro.inputs import LadderSnapshotV1, ladder_from_book_view

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
A = 10**38  # one aligned price/size unit
FP_ONE = 10**12

Levels = tuple[tuple[int, int], ...]


def ladder(offset_s: int, ordinal: int, *, bids: Levels, asks: Levels) -> LadderSnapshotV1:
    return ladder_from_book_view(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        bids=tuple((price * A, size * A) for price, size in bids),
        asks=tuple((price * A, size * A) for price, size in asks),
    )


def bid_ladder(offset_s: int, ordinal: int, depth: int) -> LadderSnapshotV1:
    """A one-level bid book whose band depth is exactly `depth` size units."""

    bids: Levels = ((100, depth),) if depth > 0 else ()
    return ladder(offset_s, ordinal, bids=bids, asks=())


class TestBandFlow:
    def test_golden_delta(self) -> None:
        implementation = band_flow_feature()
        first = ladder(1, 1, bids=((100, 5), (99, 4)), asks=((101, 3), (102, 6)))
        second = ladder(2, 2, bids=((100, 7), (99, 4)), asks=((101, 3), (102, 4)))

        assert implementation.batch((first,)) is None
        value = implementation.batch((first, second))
        assert value is not None
        assert value.mantissa == 4 * FP_ONE  # (11 - 9) - (7 - 9)

        streaming = implementation.make_streaming()
        assert streaming.update(first) is None
        assert streaming.update(second) == value
        assert streaming.last_update_ops == BAND_LEVELS

    def test_band_is_capped_at_five_levels(self) -> None:
        implementation = band_flow_feature()
        deep_bids: Levels = tuple((100 - index, 1) for index in range(7))
        first = ladder(1, 1, bids=deep_bids, asks=())
        second = ladder(2, 2, bids=deep_bids[:5], asks=())

        # Levels beyond the top five never counted, so the flow is exactly zero.
        assert implementation.batch((first, second)) == FixedPointV1(0)

    def test_streaming_equivalence(self) -> None:
        implementation = band_flow_feature()
        snapshots = tuple(
            ladder(
                index + 1,
                index + 1,
                bids=((100, 1 + (7 * index) % 13), (99, 2 + (3 * index) % 5)),
                asks=((101, 1 + (5 * index) % 11),),
            )
            for index in range(24)
        )

        report = run_micro_equivalence(implementation, snapshots)

        assert report.passed
        assert report.max_update_ops == BAND_LEVELS


class TestCumulativeBandImbalance:
    def test_golden_values(self) -> None:
        implementation = cumulative_band_imbalance_feature()
        balanced = ladder(1, 1, bids=((100, 5), (99, 4)), asks=((101, 3), (102, 6)))
        tilted = ladder(2, 2, bids=((100, 7), (99, 4)), asks=((101, 3), (102, 4)))

        assert implementation.batch((balanced,)) == FixedPointV1(0)  # (9 - 9) / 18
        value = implementation.batch((tilted,))
        assert value is not None
        assert value.mantissa == 222_222_222_222  # (11 - 7) / 18 = 2/9

        empty = LadderSnapshotV1(event_time_ns=BASE_NS, ordinal=1, bids=(), asks=())
        assert implementation.batch((empty,)) is None
        streaming = implementation.make_streaming()
        assert streaming.update(empty) is None
        assert streaming.last_update_ops == BAND_LEVELS

    def test_streaming_equivalence(self) -> None:
        implementation = cumulative_band_imbalance_feature()
        snapshots = tuple(
            ladder(
                index + 1,
                index + 1,
                bids=((100, 1 + (11 * index) % 17),),
                asks=((101, 1 + (7 * index) % 9), (102, 3)),
            )
            for index in range(24)
        )

        report = run_micro_equivalence(implementation, snapshots)

        assert report.passed


class TestBookSlopeImbalance:
    def test_golden_slopes(self) -> None:
        implementation = book_slope_imbalance_feature()
        # Bid slope 2 and ask slope 3 around mid_x2 = 201: imbalance (2-3)/(2+3).
        snapshot = ladder(1, 1, bids=((100, 5), (99, 4)), asks=((101, 3), (102, 6)))

        value = implementation.batch((snapshot,))
        assert value is not None
        assert value.mantissa == -200_000_000_000

        # A symmetric book has exactly zero slope imbalance.
        symmetric = ladder(2, 2, bids=((100, 3), (99, 6)), asks=((101, 3), (102, 6)))
        assert implementation.batch((symmetric,)) == FixedPointV1(0)

    def test_unknown_cases(self) -> None:
        implementation = book_slope_imbalance_feature()
        streaming = implementation.make_streaming()

        no_mid = ladder(1, 1, bids=((100, 5), (99, 4)), asks=())
        thin_bid = ladder(2, 2, bids=((100, 5),), asks=((101, 3), (102, 6)))
        thin_ask = ladder(3, 3, bids=((100, 5), (99, 4)), asks=((101, 3),))
        for snapshot in (no_mid, thin_bid, thin_ask):
            assert implementation.batch((snapshot,)) is None
            assert streaming.update(snapshot) is None
        assert streaming.last_update_ops == 2 * BAND_LEVELS

    def test_streaming_equivalence(self) -> None:
        implementation = book_slope_imbalance_feature()
        snapshots = tuple(
            ladder(
                index + 1,
                index + 1,
                bids=((100, 1 + (5 * index) % 7), (98, 2 + (3 * index) % 4), (97, 5)),
                asks=((101, 2 + (7 * index) % 5), (103, 1 + index % 3)),
            )
            for index in range(24)
        )

        report = run_micro_equivalence(implementation, snapshots)

        assert report.passed


class TestDepthResiliency:
    def test_recovery_counts_within_horizon(self) -> None:
        implementation = depth_resiliency_feature()
        snapshots = (bid_ladder(1, 1, 10), bid_ladder(2, 2, 4), bid_ladder(3, 3, 9))

        streaming = implementation.make_streaming()
        assert streaming.update(snapshots[0]) is None
        assert streaming.update(snapshots[1]) is None  # depletion opens, no verdict yet
        recovered = streaming.update(snapshots[2])  # 9 >= 9/10 of 10: replenished
        assert recovered is not None
        assert recovered.mantissa == FP_ONE
        assert implementation.batch(snapshots) == recovered

    def test_timeout_counts_as_failure(self) -> None:
        snapshots = tuple(
            bid_ladder(index + 1, index + 1, 10 if index == 0 else 4) for index in range(6)
        )

        value = batch_depth_resiliency(snapshots)

        assert value == FixedPointV1(0)  # the event aged out unrecovered

    def test_zero_depth_never_opens_events(self) -> None:
        empty = LadderSnapshotV1(event_time_ns=BASE_NS, ordinal=1, bids=(), asks=())
        follow = LadderSnapshotV1(event_time_ns=BASE_NS + SECOND_NS, ordinal=2, bids=(), asks=())

        assert batch_depth_resiliency((empty, follow)) is None

    def test_streaming_equivalence_and_ops_bound(self) -> None:
        implementation = depth_resiliency_feature()
        depths = (10, 4, 5, 4, 4, 12, 5, 11, 3, 3, 3, 3, 9, 20, 8, 19, 6, 18, 2, 17)
        snapshots = tuple(
            bid_ladder(index + 1, index + 1, depth) for index, depth in enumerate(depths)
        )

        report = run_micro_equivalence(implementation, snapshots)

        assert report.passed
        assert report.max_update_ops <= implementation.declared_max_update_ops


class TestVwapSpreadAtSize:
    def test_golden_walk(self) -> None:
        implementation = vwap_spread_at_size_feature()
        snapshot = ladder(1, 1, bids=((100, 7), (99, 8)), asks=((101, 6), (102, 6)))

        # buy 6@101 + 4@102 = 1014; sell 7@100 + 3@99 = 997 -> 2*17/2011.
        value = implementation.batch((snapshot,))
        assert value is not None
        assert value.mantissa == 16_907_011_437  # 34/2011 quantized half-even

        streaming = implementation.make_streaming()
        assert streaming.update(snapshot) == value
        assert streaming.last_update_ops == 4

    def test_insufficient_depth_is_unknown(self) -> None:
        implementation = vwap_spread_at_size_feature()
        thin_asks = ladder(1, 1, bids=((100, 7), (99, 8)), asks=((101, 6), (102, 3)))
        thin_bids = ladder(2, 2, bids=((100, 7), (99, 2)), asks=((101, 6), (102, 6)))

        assert implementation.batch((thin_asks,)) is None
        assert implementation.batch((thin_bids,)) is None

    def test_streaming_equivalence(self) -> None:
        implementation = vwap_spread_at_size_feature()
        snapshots = tuple(
            ladder(
                index + 1,
                index + 1,
                bids=((100, 4 + index % 5), (99, 8), (98, 12)),
                asks=((101, 3 + index % 7), (102, 6), (103, 15)),
            )
            for index in range(24)
        )

        report = run_micro_equivalence(implementation, snapshots)

        assert report.passed
