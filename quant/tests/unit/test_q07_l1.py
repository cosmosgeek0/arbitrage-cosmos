from __future__ import annotations

from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import ExactScaledValueV1
from quant_edge.micro.equivalence import run_micro_equivalence
from quant_edge.micro.inputs import TopOfBookPointV1
from quant_edge.micro.l1 import (
    OFI_WINDOW,
    _ofi_term,
    batch_ofi_l1,
    fp_from_aligned,
    fp_from_fraction,
    l1_queue_imbalance_feature,
    microprice_displacement_feature,
    ofi_l1_feature,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
ALIGNED = 10**38  # one size/price unit at alignment scale for scale-2 coefficients
FP_ONE = 10**12


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


def quote(
    offset_s: int,
    ordinal: int,
    *,
    bid: int = 10_000,
    bid_size: int = 500,
    ask: int = 10_010,
    ask_size: int = 300,
) -> TopOfBookPointV1:
    return TopOfBookPointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        bid_price=_scaled(bid),
        bid_size=_scaled(bid_size),
        ask_price=_scaled(ask),
        ask_size=_scaled(ask_size),
    )


class TestFixedPointHelpers:
    def test_fp_from_aligned(self) -> None:
        assert fp_from_aligned(3 * ALIGNED).mantissa == 3 * FP_ONE
        assert fp_from_aligned(-3 * ALIGNED).mantissa == -3 * FP_ONE
        # Half-even at the 10^26 boundary: 0.5 ulp goes to even.
        assert fp_from_aligned(5 * 10**25).mantissa == 0
        assert fp_from_aligned(15 * 10**25).mantissa == 2

    def test_fp_from_fraction(self) -> None:
        assert fp_from_fraction(1, 4).mantissa == 250_000_000_000
        assert fp_from_fraction(-1, 4).mantissa == -250_000_000_000
        assert fp_from_fraction(1, -4).mantissa == -250_000_000_000
        assert fp_from_fraction(-1, -4).mantissa == 250_000_000_000
        assert fp_from_fraction(1, 3).mantissa == 333_333_333_333
        assert fp_from_fraction(1, 8004).mantissa == 124_937_531
        # Ties round half-even in mantissa units.
        assert fp_from_fraction(1, 2 * FP_ONE).mantissa == 0
        assert fp_from_fraction(3, 2 * FP_ONE).mantissa == 2


class TestOfi:
    def test_transition_terms(self) -> None:
        base = quote(1, 1)

        # Equal prices: +Qb_n - Qb_p on bids, -Qa_n + Qa_p on asks.
        assert _ofi_term(base, quote(2, 2, bid_size=700, ask_size=200)) == 3 * ALIGNED
        # Bid improves: only the new bid size enters; the ask side nets to zero.
        assert _ofi_term(base, quote(2, 2, bid=10_005, bid_size=200)) == 2 * ALIGNED
        # Bid retreats: only the previous bid size leaves.
        assert _ofi_term(base, quote(2, 2, bid=9_990, bid_size=900)) == -5 * ALIGNED
        # Ask improves (sell pressure): the new ask size subtracts.
        assert _ofi_term(base, quote(2, 2, ask=10_005, ask_size=400)) == -4 * ALIGNED
        # Ask retreats (buy pressure): the previous ask size returns.
        assert _ofi_term(base, quote(2, 2, ask=10_020, ask_size=900)) == 3 * ALIGNED

    def test_batch_golden_and_window(self) -> None:
        assert batch_ofi_l1((quote(1, 1),)) is None

        pair = (quote(1, 1), quote(2, 2, bid_size=700, ask_size=200))
        batch = batch_ofi_l1(pair)
        assert batch is not None
        assert batch.mantissa == 3 * FP_ONE

        # OFI_WINDOW + 2 points with distinct terms: the first transition ages out.
        points = [quote(1, 1, bid_size=100)]
        points.extend(
            quote(index + 2, index + 2, bid_size=100 * (index + 2) ** 2)
            for index in range(OFI_WINDOW + 1)
        )
        full = batch_ofi_l1(tuple(points))
        windowed = batch_ofi_l1(tuple(points[1:]))
        assert full is not None
        assert windowed is not None
        assert full.mantissa == windowed.mantissa
        expected_aligned = sum(
            _ofi_term(points[index - 1], points[index]) for index in range(2, len(points))
        )
        assert full == fp_from_aligned(expected_aligned)

    def test_streaming_equivalence(self) -> None:
        implementation = ofi_l1_feature()
        points = [quote(1, 1)]
        points.extend(
            quote(index + 2, index + 2, bid_size=500 + 37 * index, ask_size=300 + 11 * index)
            for index in range(OFI_WINDOW + 4)
        )

        report = run_micro_equivalence(implementation, tuple(points))

        assert report.passed
        assert report.status_mismatches == 0
        assert report.max_ulp_deviation == 0
        assert report.max_update_ops == 1
        assert report.compared_values == len(points) - 1


class TestQueueImbalance:
    def test_golden_values(self) -> None:
        implementation = l1_queue_imbalance_feature()

        value = implementation.batch((quote(1, 1),))
        assert value is not None
        assert value.mantissa == 250_000_000_000  # (5 - 3) / 8

        balanced = implementation.batch((quote(1, 1, bid_size=300),))
        assert balanced == FixedPointV1(0)

        streaming = implementation.make_streaming()
        assert streaming.update(quote(1, 1)) == value
        assert streaming.last_update_ops == 1

    def test_streaming_equivalence(self) -> None:
        implementation = l1_queue_imbalance_feature()
        points = tuple(
            quote(index + 1, index + 1, bid_size=100 + 7 * index, ask_size=900 - 13 * index)
            for index in range(24)
        )

        report = run_micro_equivalence(implementation, points)

        assert report.passed
        assert report.compared_values == len(points)


class TestMicropriceDisplacement:
    def test_golden_values(self) -> None:
        implementation = microprice_displacement_feature()

        # micro = (100.00*3 + 100.10*5)/8 = 100.0625; mid = 100.05 -> 1/8004.
        value = implementation.batch((quote(1, 1),))
        assert value == fp_from_fraction(1, 8004)

        # Balanced sizes put the microprice exactly on the mid.
        assert implementation.batch((quote(1, 1, bid_size=300),)) == FixedPointV1(0)

        # More ask than bid size pulls the microprice below the mid.
        below = implementation.batch((quote(1, 1, bid_size=100, ask_size=900),))
        assert below is not None
        assert below.mantissa < 0

    def test_streaming_equivalence(self) -> None:
        implementation = microprice_displacement_feature()
        points = tuple(
            quote(index + 1, index + 1, bid_size=50 + 31 * index, ask_size=800 - 17 * index)
            for index in range(24)
        )

        report = run_micro_equivalence(implementation, points)

        assert report.passed
        assert report.max_update_ops == 1
