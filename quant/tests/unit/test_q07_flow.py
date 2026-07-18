from __future__ import annotations

from decimal import getcontext, localcontext

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.domains import BarV1
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import ExactScaledValueV1
from quant_edge.micro.equivalence import run_micro_equivalence
from quant_edge.micro.flow import (
    FLOW_WINDOW,
    absorption_ratio_feature,
    amihud_illiquidity_feature,
    batch_kyle_slope,
    effective_spread_feature,
    kyle_slope_feature,
    signed_trade_imbalance_feature,
    size_concentration_hhi_feature,
    trade_dispersion_feature,
    trade_intensity_feature,
)
from quant_edge.micro.inputs import JoinedTradeV1, TopOfBookPointV1, TradePointV1
from quant_edge.micro.l1 import fp_from_fraction
from quant_edge.micro.point_process import (
    EVENT_KINDS,
    PUBLIC_REMOVAL_SEMANTICS,
    TRUE_CANCEL_STATUS,
    HawkesSpecV1,
    HawkesStatus,
    PointEventV1,
    PublicEventKind,
    exponential_intensities,
    hawkes_assessment,
    poisson_intensities,
    time_rescaling_residuals,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
FP_ONE = 10**12


def _point_event(ordinal: int, kind: PublicEventKind) -> PointEventV1:
    return PointEventV1(
        event_id=f"point-{ordinal}",
        event_time_ns=BASE_NS + ordinal * SECOND_NS,
        ordinal=ordinal,
        kind=kind,
    )


def _hawkes_spec(*, explosive: bool = False, max_events: int = 4_096) -> HawkesSpecV1:
    zero = FixedPointV1(0)
    alpha = FixedPointV1(FIXED_POINT_SCALE if explosive else FIXED_POINT_SCALE // 5)
    return HawkesSpecV1(
        spec_id="public-flow-v1",
        baselines=(FixedPointV1(FIXED_POINT_SCALE // 10),) * 4,
        excitation=tuple(
            tuple(alpha if row == column else zero for column in range(4)) for row in range(4)
        ),
        decay_per_second=FixedPointV1(FIXED_POINT_SCALE),
        max_events=max_events,
    )


class TestPublicPointProcessFamily:
    def test_public_removal_never_impersonates_true_cancel(self) -> None:
        assert tuple(kind.value for kind in EVENT_KINDS) == (
            "BUY",
            "SELL",
            "ADD",
            "REMOVE_OR_EXECUTE",
        )
        assert TRUE_CANCEL_STATUS == "BLOCKED_DATA"
        assert "do not identify true cancellation" in PUBLIC_REMOVAL_SEMANTICS
        with pytest.raises(ContractValueError, match="true CANCEL is BLOCKED_DATA"):
            PointEventV1("cancel-1", BASE_NS, 0, "CANCEL")  # type: ignore[arg-type]

    def test_poisson_baselines_are_exact_for_all_four_types(self) -> None:
        events = (
            _point_event(1, PublicEventKind.BUY),
            _point_event(2, PublicEventKind.BUY),
            _point_event(3, PublicEventKind.SELL),
            _point_event(4, PublicEventKind.REMOVE_OR_EXECUTE),
        )

        rates = poisson_intensities(events, start_ns=BASE_NS, end_ns=BASE_NS + 5 * SECOND_NS)

        assert tuple(rate.count for rate in rates) == (2, 1, 0, 1)
        assert (rates[0].events_per_second.numerator, rates[0].events_per_second.denominator) == (
            2,
            5,
        )
        assert rates[2].events_per_second.is_zero

    def test_exponential_intensity_is_bounded_recency_weighted_and_deterministic(self) -> None:
        events = (
            _point_event(1, PublicEventKind.BUY),
            _point_event(2, PublicEventKind.BUY),
            _point_event(3, PublicEventKind.SELL),
        )

        first = exponential_intensities(
            events, as_of_ns=BASE_NS + 3 * SECOND_NS, decay_ns=SECOND_NS
        )

        assert first == exponential_intensities(
            events, as_of_ns=BASE_NS + 3 * SECOND_NS, decay_ns=SECOND_NS
        )
        assert 0 < first[0].mantissa < 2 * FIXED_POINT_SCALE
        assert first[1].mantissa == FIXED_POINT_SCALE
        assert first[2].is_zero
        assert first[3].is_zero

    def test_decimal_results_ignore_and_restore_hostile_ambient_precision(self) -> None:
        events = (
            _point_event(1, PublicEventKind.BUY),
            _point_event(2, PublicEventKind.SELL),
            _point_event(3, PublicEventKind.ADD),
        )
        original = getcontext().copy()

        with localcontext() as ambient:
            ambient.prec = 6
            low_precision = (
                exponential_intensities(
                    events,
                    as_of_ns=BASE_NS + 4 * SECOND_NS,
                    decay_ns=3 * SECOND_NS,
                ),
                time_rescaling_residuals(events, spec=_hawkes_spec()),
            )
            assert getcontext().prec == 6

            ambient.prec = 28
            ordinary_precision = (
                exponential_intensities(
                    events,
                    as_of_ns=BASE_NS + 4 * SECOND_NS,
                    decay_ns=3 * SECOND_NS,
                ),
                time_rescaling_residuals(events, spec=_hawkes_spec()),
            )
            assert getcontext().prec == 28

        assert low_precision == ordinary_precision
        assert getcontext().prec == original.prec
        assert getcontext().rounding == original.rounding
        assert getcontext().flags == original.flags
        assert getcontext().traps == original.traps

    def test_stable_multivariate_hawkes_exposes_challenger_intensities(self) -> None:
        events = tuple(_point_event(index, kind) for index, kind in enumerate(EVENT_KINDS, 1))

        assessment = hawkes_assessment(
            events, as_of_ns=BASE_NS + 5 * SECOND_NS, spec=_hawkes_spec()
        )

        assert assessment.status is HawkesStatus.STABLE_CHALLENGER
        assert all(row.numerator < row.denominator for row in assessment.branching_row_sums)
        assert all(value is not None and value.mantissa > 0 for value in assessment.intensities)

    def test_explosive_fit_is_rejected_before_intensity_or_residual_output(self) -> None:
        events = (
            _point_event(1, PublicEventKind.BUY),
            _point_event(2, PublicEventKind.SELL),
        )
        spec = _hawkes_spec(explosive=True)

        assessment = hawkes_assessment(events, as_of_ns=BASE_NS + 3 * SECOND_NS, spec=spec)
        residuals = time_rescaling_residuals(events, spec=spec)

        assert assessment.status is HawkesStatus.REJECTED_EXPLOSIVE
        assert assessment.intensities == (None, None, None, None)
        assert residuals.status is HawkesStatus.REJECTED_EXPLOSIVE
        assert residuals.compensator_increments == ()

    def test_time_rescaling_is_positive_and_hostile_order_and_capacity_fail_closed(self) -> None:
        events = (
            _point_event(1, PublicEventKind.BUY),
            _point_event(2, PublicEventKind.SELL),
            _point_event(3, PublicEventKind.ADD),
        )

        report = time_rescaling_residuals(events, spec=_hawkes_spec())

        assert report.status is HawkesStatus.STABLE_CHALLENGER
        assert len(report.compensator_increments) == 2
        assert all(value.mantissa > 0 for value in report.compensator_increments)
        assert report == time_rescaling_residuals(events, spec=_hawkes_spec())
        with pytest.raises(ContractValueError, match="strictly chronological"):
            poisson_intensities(
                (events[1], events[0]), start_ns=BASE_NS, end_ns=BASE_NS + 4 * SECOND_NS
            )
        with pytest.raises(ContractValueError, match="bounded at 2"):
            hawkes_assessment(
                events, as_of_ns=BASE_NS + 4 * SECOND_NS, spec=_hawkes_spec(max_events=2)
            )


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


def quote_at(offset_s: int, ordinal: int, bid: int, ask: int) -> TopOfBookPointV1:
    return TopOfBookPointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        bid_price=_scaled(bid),
        bid_size=_scaled(100),
        ask_price=_scaled(ask),
        ask_size=_scaled(100),
    )


def joined(
    offset_s: int,
    ordinal: int,
    *,
    size: int = 100,
    price: int = 10_005,
    buy: bool = True,
    bid: int | None = 10_000,
    ask: int = 10_010,
) -> JoinedTradeV1:
    trade = TradePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(price),
        size=_scaled(size),
        is_buyer_maker=not buy,
    )
    prevailing = None if bid is None else quote_at(offset_s, ordinal, bid, ask)
    return JoinedTradeV1(trade=trade, prevailing=prevailing)


class TestSignedTradeImbalance:
    def test_golden_and_window(self) -> None:
        implementation = signed_trade_imbalance_feature()
        trades = (joined(1, 1, size=100, buy=True), joined(2, 2, size=300, buy=False))

        value = implementation.batch(trades)
        assert value is not None
        assert value.mantissa == -FP_ONE // 2  # (1 - 3) / 4

        # A window of pure buys after older sells reads exactly +1.
        many = tuple(
            joined(index + 1, index + 1, size=100, buy=index >= 3)
            for index in range(FLOW_WINDOW + 3)
        )
        saturated = implementation.batch(many)
        assert saturated is not None
        assert saturated.mantissa == FP_ONE

    def test_streaming_equivalence(self) -> None:
        implementation = signed_trade_imbalance_feature()
        trades = tuple(
            joined(index + 1, index + 1, size=100 + 13 * index, buy=index % 3 != 0)
            for index in range(FLOW_WINDOW + 5)
        )

        report = run_micro_equivalence(implementation, trades)

        assert report.passed
        assert report.max_update_ops == 1


class TestTradeIntensity:
    def test_golden_values(self) -> None:
        implementation = trade_intensity_feature()
        trades = (joined(1, 1), joined(2, 2), joined(5, 3))

        assert implementation.batch(trades[:1]) is None
        value = implementation.batch(trades)
        assert value is not None
        assert value.mantissa == FP_ONE // 2  # 2 trades over 4 seconds

        same_instant = (joined(1, 1), joined(1, 2))
        assert implementation.batch(same_instant) is None  # zero span is UNKNOWN

    def test_streaming_equivalence(self) -> None:
        implementation = trade_intensity_feature()
        trades = tuple(
            joined(1 + index * (1 + index % 3), index + 1) for index in range(FLOW_WINDOW + 5)
        )

        report = run_micro_equivalence(implementation, trades)

        assert report.passed


class TestTradeDispersion:
    def test_golden_values(self) -> None:
        implementation = trade_dispersion_feature()
        trades = (joined(1, 1), joined(2, 2), joined(4, 3))

        # Durations 1s and 2s: IoD = (2*5 - 9)/(2*3) seconds = 1/6 s.
        value = implementation.batch(trades)
        assert value == fp_from_fraction(1, 6)

        # Perfectly regular arrivals have exactly zero dispersion.
        regular = (joined(1, 1), joined(3, 2), joined(5, 3), joined(7, 4))
        assert implementation.batch(regular) == FixedPointV1(0)

    def test_unknown_cases(self) -> None:
        implementation = trade_dispersion_feature()

        assert implementation.batch((joined(1, 1), joined(2, 2))) is None  # two trades
        simultaneous = (joined(1, 1), joined(1, 2), joined(1, 3))
        assert implementation.batch(simultaneous) is None  # zero mean inter-arrival

    def test_streaming_equivalence(self) -> None:
        implementation = trade_dispersion_feature()
        offsets = [0]
        for index in range(FLOW_WINDOW + 6):
            offsets.append(offsets[-1] + index % 4)
        trades = tuple(joined(offset, index + 1) for index, offset in enumerate(offsets))

        report = run_micro_equivalence(implementation, trades)

        assert report.passed
        assert report.max_update_ops <= FLOW_WINDOW


class TestSizeConcentration:
    def test_golden_values(self) -> None:
        implementation = size_concentration_hhi_feature()

        value = implementation.batch((joined(1, 1, size=100), joined(2, 2, size=300)))
        assert value is not None
        assert value.mantissa == 625_000_000_000  # (1 + 9) / 16

        single = implementation.batch((joined(1, 1, size=700),))
        assert single == FixedPointV1(FP_ONE)  # one trade is maximal concentration

    def test_streaming_equivalence(self) -> None:
        implementation = size_concentration_hhi_feature()
        trades = tuple(
            joined(index + 1, index + 1, size=100 + 97 * (index % 7))
            for index in range(FLOW_WINDOW + 5)
        )

        report = run_micro_equivalence(implementation, trades)

        assert report.passed


class TestEffectiveSpread:
    def test_golden_values(self) -> None:
        implementation = effective_spread_feature()

        # price 100.10 against mid 100.05: 2 * 0.05 / 100.05 -> wait, doubled law:
        # 2*|2*100.10 - 200.10| / 200.10 = 0.20 / 200.10 = 2/2001.
        value = implementation.batch((joined(1, 1, price=10_010),))
        assert value == fp_from_fraction(2, 2001)

        # A trade exactly on the mid has zero effective spread.
        assert implementation.batch((joined(1, 1, price=10_005),)) == FixedPointV1(0)

        # No prevailing quote is honestly UNKNOWN.
        assert implementation.batch((joined(1, 1, bid=None),)) is None

    def test_streaming_equivalence(self) -> None:
        implementation = effective_spread_feature()
        trades = tuple(
            joined(
                index + 1,
                index + 1,
                price=10_000 + index % 11,
                bid=None if index % 5 == 0 else 10_000,
            )
            for index in range(20)
        )

        report = run_micro_equivalence(implementation, trades)

        assert report.passed
        assert report.max_update_ops == 1


def _kyle_sequence() -> tuple[JoinedTradeV1, ...]:
    """Signed sizes +1, -1, +2 with doubled-mid moves +2, -2, +4: slope exactly 2."""

    return (
        joined(1, 1, size=100, buy=True, bid=10_000, ask=10_010),
        joined(2, 2, size=100, buy=True, bid=10_100, ask=10_110),
        joined(3, 3, size=100, buy=False, bid=10_000, ask=10_010),
        joined(4, 4, size=200, buy=True, bid=10_200, ask=10_210),
    )


class TestKyleSlope:
    def test_golden_slope(self) -> None:
        implementation = kyle_slope_feature()
        trades = _kyle_sequence()

        assert implementation.batch(trades[:3]) is None  # only two pairs
        value = implementation.batch(trades)
        assert value is not None
        assert value.mantissa == 2 * FP_ONE

    def test_zero_flow_variance_is_unknown(self) -> None:
        trades = tuple(
            joined(index + 1, index + 1, size=100, buy=True, bid=10_000 + index, ask=10_010 + index)
            for index in range(5)
        )

        assert batch_kyle_slope(trades) is None

    def test_quote_less_trades_leave_the_pair_set_unchanged(self) -> None:
        implementation = kyle_slope_feature()
        base = _kyle_sequence()
        trades = (base[0], joined(1, 2, bid=None), *base[1:])

        value = implementation.batch(trades)
        assert value is not None
        assert value.mantissa == 2 * FP_ONE

        streaming = implementation.make_streaming()
        assert streaming.update(joined(1, 1, bid=None)) is None
        assert streaming.last_update_ops == 1

    def test_streaming_equivalence(self) -> None:
        implementation = kyle_slope_feature()
        trades = tuple(
            joined(
                index + 1,
                index + 1,
                size=100 + 100 * (index % 4),
                buy=index % 3 != 0,
                bid=None if index % 7 == 0 else 10_000 + 10 * (index % 9),
                ask=10_010 + 10 * (index % 9),
            )
            for index in range(FLOW_WINDOW + 8)
        )

        report = run_micro_equivalence(implementation, trades)

        assert report.passed
        assert report.max_update_ops <= FLOW_WINDOW


class TestAbsorption:
    def test_golden_values(self) -> None:
        implementation = absorption_ratio_feature()
        trades = (
            joined(1, 1, size=100, bid=10_000, ask=10_010),
            joined(2, 2, size=300, bid=10_010, ask=10_020),
        )

        # volume 4, doubled-mid drift 0.20: 4 / (4 + 100 * 0.2) = 1/6.
        value = implementation.batch(trades)
        assert value == fp_from_fraction(1, 6)

        # Zero drift absorbs perfectly: the ratio is exactly one.
        still = (joined(1, 1, size=100), joined(2, 2, size=300))
        assert implementation.batch(still) == FixedPointV1(FP_ONE)

    def test_unknown_cases(self) -> None:
        implementation = absorption_ratio_feature()

        assert implementation.batch((joined(1, 1),)) is None  # single trade
        quoteless = (joined(1, 1, bid=None), joined(2, 2))
        assert implementation.batch(quoteless) is None  # fewer than two mids

    def test_streaming_equivalence(self) -> None:
        implementation = absorption_ratio_feature()
        trades = tuple(
            joined(
                index + 1,
                index + 1,
                size=100 + 50 * (index % 5),
                bid=None if index % 6 == 4 else 10_000 + index % 8,
                ask=10_010 + index % 8,
            )
            for index in range(FLOW_WINDOW + 6)
        )

        report = run_micro_equivalence(implementation, trades)

        assert report.passed
        assert report.max_update_ops <= FLOW_WINDOW


def bar(
    index: int,
    *,
    close: int | None,
    volume: int | None,
    complete: bool = True,
) -> BarV1:
    return BarV1(
        index=index,
        start_ns=BASE_NS + index * SECOND_NS,
        end_ns=BASE_NS + (index + 1) * SECOND_NS,
        point_count=0 if close is None else 2,
        first_value_aligned=close,
        last_value_aligned=close,
        volume_aligned_total=volume,
        complete=complete,
    )


class TestAmihud:
    def test_golden_mean(self) -> None:
        implementation = amihud_illiquidity_feature()
        bars = (
            bar(0, close=100, volume=1),
            bar(1, close=101, volume=2),
            bar(2, close=99, volume=1),
        )

        assert implementation.batch(bars[:1]) is None
        # |1|/(100*2) then |2|/(101*1): mean is 501/40400.
        value = implementation.batch(bars)
        assert value == fp_from_fraction(501, 40_400)

    def test_dirty_bars_are_skipped_honestly(self) -> None:
        implementation = amihud_illiquidity_feature()
        bars = (
            bar(0, close=100, volume=1),
            bar(1, close=105, volume=3, complete=False),  # incomplete: ignored fully
            bar(2, close=None, volume=None),  # empty: ignored fully
            bar(3, close=102, volume=None),  # no volume: moves the close only
            bar(4, close=102, volume=0),  # zero volume: moves the close only
            bar(5, close=100, volume=1),
        )

        value = implementation.batch(bars)

        # The only measurable move is |100 - 102| / (102 * 1).
        assert value == fp_from_fraction(2, 102)

    def test_streaming_equivalence(self) -> None:
        implementation = amihud_illiquidity_feature()
        bars = tuple(
            bar(
                index,
                close=None if index % 9 == 7 else 100 + index % 5,
                volume=index % 4 if index % 6 != 5 else None,
                complete=index % 8 != 6,
            )
            for index in range(FLOW_WINDOW + 8)
        )

        report = run_micro_equivalence(implementation, bars)

        assert report.passed
        assert report.max_update_ops <= FLOW_WINDOW
