from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1
from quant_edge.micro.inputs import (
    JoinedTradeV1,
    LadderLevelV1,
    LadderSeriesV1,
    LadderSnapshotV1,
    TopOfBookPointV1,
    TopOfBookSeriesV1,
    TradePointV1,
    TradeSeriesV1,
    join_trades_with_quotes,
    ladder_from_book_view,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
A = 10**36  # aligned unit for a scale-2 coefficient


def _scaled(coefficient: int, scale: int = 2) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


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


def trade(
    offset_s: int,
    ordinal: int,
    *,
    price: int = 10_005,
    size: int = 100,
    buyer_maker: bool = False,
) -> TradePointV1:
    return TradePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(price),
        size=_scaled(size),
        is_buyer_maker=buyer_maker,
    )


class TestPoints:
    def test_top_of_book_facts(self) -> None:
        point = quote(1, 1)

        assert point.bid_price_aligned == 10_000 * A
        assert point.mid_aligned_x2 == (10_000 + 10_010) * A
        with pytest.raises(ContractValueError):
            quote(1, 1, bid=10_020)
        with pytest.raises(ContractValueError):
            quote(1, 1, bid_size=0)
        with pytest.raises(ContractValueError):
            TopOfBookPointV1(
                event_time_ns=5,
                ordinal=1,
                bid_price=_scaled(1),
                bid_size=_scaled(1),
                ask_price=_scaled(2),
                ask_size=_scaled(1),
            )
        with pytest.raises(ContractValueError):
            TopOfBookPointV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                bid_price=100,  # type: ignore[arg-type]
                bid_size=_scaled(1),
                ask_price=_scaled(2),
                ask_size=_scaled(1),
            )

    def test_trade_facts(self) -> None:
        taker_buy = trade(1, 1, buyer_maker=False)
        taker_sell = trade(1, 1, buyer_maker=True)

        assert taker_buy.taker_is_buyer
        assert not taker_sell.taker_is_buyer
        with pytest.raises(ContractValueError):
            trade(1, 1, size=0)
        with pytest.raises(ContractValueError):
            TradePointV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                price=_scaled(1),
                size=_scaled(1),
                is_buyer_maker="no",  # type: ignore[arg-type]
            )


class TestSeries:
    def test_sequence_laws(self) -> None:
        series = TopOfBookSeriesV1(
            series_id="tob-1",
            symbol="BNBUSDT",
            posture=EvidencePosture.SYNTHETIC,
            points=(quote(1, 1), quote(2, 2)),
        )
        assert len(series.points) == 2
        with pytest.raises(ContractValueError):
            TopOfBookSeriesV1(
                series_id="tob-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.SYNTHETIC,
                points=(quote(2, 1), quote(1, 2)),
            )
        with pytest.raises(ContractValueError):
            TopOfBookSeriesV1(
                series_id="tob-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.SYNTHETIC,
                points=(quote(1, 2), quote(2, 2)),
            )
        with pytest.raises(ContractValueError):
            TopOfBookSeriesV1(
                series_id="tob-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.LIVE,
                points=(quote(1, 1),),
            )
        with pytest.raises(ContractValueError):
            TopOfBookSeriesV1(
                series_id="tob-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.SYNTHETIC,
                points=(),
            )
        with pytest.raises(ContractValueError):
            TradeSeriesV1(
                series_id="trades-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.SYNTHETIC,
                trades=("trade",),  # type: ignore[arg-type]
            )


class TestLadders:
    def test_ladder_laws(self) -> None:
        snapshot = ladder_from_book_view(
            event_time_ns=BASE_NS,
            ordinal=1,
            bids=((10_000 * A, 5 * A), (9_900 * A, 4 * A)),
            asks=((10_010 * A, 3 * A), (10_020 * A, 6 * A)),
        )

        assert snapshot.mid_aligned_x2 == (10_000 + 10_010) * A
        empty = LadderSnapshotV1(event_time_ns=BASE_NS, ordinal=1, bids=(), asks=())
        assert empty.mid_aligned_x2 is None
        with pytest.raises(ContractValueError):
            ladder_from_book_view(
                event_time_ns=BASE_NS,
                ordinal=1,
                bids=((9_900 * A, 5 * A), (10_000 * A, 4 * A)),
                asks=(),
            )
        with pytest.raises(ContractValueError):
            ladder_from_book_view(
                event_time_ns=BASE_NS,
                ordinal=1,
                bids=((10_010 * A, 5 * A),),
                asks=((10_000 * A, 3 * A),),
            )
        with pytest.raises(ContractValueError):
            LadderLevelV1(price_aligned=0, size_aligned=1)
        with pytest.raises(ContractValueError):
            LadderLevelV1(price_aligned=1, size_aligned=0)
        with pytest.raises(ContractValueError):
            LadderLevelV1(price_aligned=True, size_aligned=1)
        with pytest.raises(ContractValueError):
            LadderLevelV1(price_aligned=1, size_aligned=True)
        with pytest.raises(ContractValueError):
            LadderSnapshotV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                bids=("level",),  # type: ignore[arg-type]
                asks=(),
            )
        with pytest.raises(ContractValueError):
            LadderSnapshotV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                bids=[],  # type: ignore[arg-type]
                asks=(),
            )

    def test_ladder_series_laws(self) -> None:
        first = ladder_from_book_view(
            event_time_ns=BASE_NS,
            ordinal=1,
            bids=((10_000 * A, 5 * A),),
            asks=((10_010 * A, 3 * A),),
        )
        second = ladder_from_book_view(
            event_time_ns=BASE_NS + SECOND_NS,
            ordinal=2,
            bids=((9_990 * A, 5 * A),),
            asks=(),
        )
        series = LadderSeriesV1(
            series_id="ladders-1",
            symbol="BNBUSDT",
            posture=EvidencePosture.SYNTHETIC,
            snapshots=(first, second),
        )
        assert len(series.snapshots) == 2
        with pytest.raises(ContractValueError):
            LadderSeriesV1(
                series_id="ladders-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.SYNTHETIC,
                snapshots=(second, first),
            )


class TestJoin:
    def test_as_of_join(self) -> None:
        quotes = TopOfBookSeriesV1(
            series_id="tob-1",
            symbol="BNBUSDT",
            posture=EvidencePosture.SYNTHETIC,
            points=(quote(2, 1), quote(4, 2, bid=10_002)),
        )
        trades = TradeSeriesV1(
            series_id="trades-1",
            symbol="BNBUSDT",
            posture=EvidencePosture.SYNTHETIC,
            trades=(trade(1, 1), trade(3, 2), trade(5, 3)),
        )

        joined = join_trades_with_quotes(trades, quotes)

        assert joined[0].prevailing is None
        assert joined[1].prevailing is quotes.points[0]
        assert joined[2].prevailing is quotes.points[1]
        assert joined[1].event_time_ns == trades.trades[1].event_time_ns
        assert joined[1].ordinal == trades.trades[1].ordinal

    def test_join_contracts(self) -> None:
        quotes = TopOfBookSeriesV1(
            series_id="tob-1",
            symbol="BNBUSDT",
            posture=EvidencePosture.SYNTHETIC,
            points=(quote(2, 1),),
        )
        trades = TradeSeriesV1(
            series_id="trades-1",
            symbol="ETHUSDT",
            posture=EvidencePosture.SYNTHETIC,
            trades=(trade(1, 1),),
        )
        with pytest.raises(ContractValueError):
            join_trades_with_quotes(trades, quotes)
        with pytest.raises(ContractValueError):
            join_trades_with_quotes("trades", quotes)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            join_trades_with_quotes(trades, "quotes")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            JoinedTradeV1(trade="trade", prevailing=None)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            JoinedTradeV1(trade=trade(1, 1), prevailing="quote")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            JoinedTradeV1(trade=trade(1, 1), prevailing=quote(2, 1))
