from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Protocol, cast

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import scaled_to_aligned
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    ExactScaledValueV1,
    require_contract_id,
    require_strict_int,
)

MAX_ITEMS: Final = 100_000
MAX_LADDER_LEVELS: Final = 5_000

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_scaled(value: object, *, field: str) -> ExactScaledValueV1:
    if not isinstance(value, ExactScaledValueV1):
        raise ContractValueError(f"{field} must be ExactScaledValueV1")
    if value.coefficient <= 0:
        raise ContractValueError(f"{field} must be strictly positive")
    return value


def _require_posture(value: object) -> EvidencePosture:
    if not isinstance(value, EvidencePosture) or value not in _ALLOWED_POSTURES:
        raise ContractValueError(
            "posture must be SYNTHETIC or REPLAY; Q07 owns no live market evidence"
        )
    return value


@dataclass(frozen=True, slots=True)
class TopOfBookPointV1:
    """One L1 observation with sizes (Binance bookTicker shape); never crossed.

    ``ordinal`` is the global receive order shared with trade evidence whenever
    quote and trade streams are joined. It breaks equal-event-time ties without
    consulting future arrivals.
    """

    event_time_ns: int
    ordinal: int
    bid_price: ExactScaledValueV1
    bid_size: ExactScaledValueV1
    ask_price: ExactScaledValueV1
    ask_size: ExactScaledValueV1

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        _require_scaled(self.bid_price, field="bid_price")
        _require_scaled(self.bid_size, field="bid_size")
        _require_scaled(self.ask_price, field="ask_price")
        _require_scaled(self.ask_size, field="ask_size")
        if scaled_to_aligned(self.bid_price) > scaled_to_aligned(self.ask_price):
            raise ContractValueError("top-of-book evidence cannot be crossed")

    @property
    def bid_price_aligned(self) -> int:
        return scaled_to_aligned(self.bid_price)

    @property
    def ask_price_aligned(self) -> int:
        return scaled_to_aligned(self.ask_price)

    @property
    def bid_size_aligned(self) -> int:
        return scaled_to_aligned(self.bid_size)

    @property
    def ask_size_aligned(self) -> int:
        return scaled_to_aligned(self.ask_size)

    @property
    def mid_aligned_x2(self) -> int:
        """Twice the mid, exactly (avoids halving)."""

        return self.bid_price_aligned + self.ask_price_aligned


@dataclass(frozen=True, slots=True)
class TradePointV1:
    """One maker-flagged trade (aggTrades shape); taker buy means not buyer-maker.

    ``ordinal`` is the global receive order shared with quote evidence whenever
    quote and trade streams are joined.
    """

    event_time_ns: int
    ordinal: int
    price: ExactScaledValueV1
    size: ExactScaledValueV1
    is_buyer_maker: bool

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        _require_scaled(self.price, field="price")
        _require_scaled(self.size, field="size")
        if not isinstance(self.is_buyer_maker, bool):
            raise ContractValueError("is_buyer_maker must be boolean")

    @property
    def price_aligned(self) -> int:
        return scaled_to_aligned(self.price)

    @property
    def size_aligned(self) -> int:
        return scaled_to_aligned(self.size)

    @property
    def taker_is_buyer(self) -> bool:
        return not self.is_buyer_maker


class _SequencedItem(Protocol):
    @property
    def event_time_ns(self) -> int: ...

    @property
    def ordinal(self) -> int: ...


def _validate_sequence(
    items: object,
    *,
    field: str,
    item_type: type,
) -> None:
    if not isinstance(items, tuple) or not items or len(items) > MAX_ITEMS:
        raise ContractValueError(f"{field} must be a tuple of 1..{MAX_ITEMS} items")
    previous_time: int | None = None
    previous_ordinal: int | None = None
    for index, item in enumerate(items):
        if not isinstance(item, item_type):
            raise ContractValueError(f"{field}[{index}] must be {item_type.__name__}")
        sequenced = cast(_SequencedItem, item)
        time_ns = sequenced.event_time_ns
        ordinal = sequenced.ordinal
        if previous_time is not None and previous_ordinal is not None:
            if time_ns < previous_time:
                raise ContractValueError(f"{field} must be time-ordered")
            if ordinal <= previous_ordinal:
                raise ContractValueError(f"{field} ordinals must strictly increase")
        previous_time = time_ns
        previous_ordinal = ordinal


@dataclass(frozen=True, slots=True)
class TopOfBookSeriesV1:
    series_id: str
    symbol: str
    posture: EvidencePosture
    points: tuple[TopOfBookPointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.series_id, field="series_id")
        require_contract_id(self.symbol, field="symbol")
        _require_posture(self.posture)
        _validate_sequence(self.points, field="points", item_type=TopOfBookPointV1)


@dataclass(frozen=True, slots=True)
class TradeSeriesV1:
    series_id: str
    symbol: str
    posture: EvidencePosture
    trades: tuple[TradePointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.series_id, field="series_id")
        require_contract_id(self.symbol, field="symbol")
        _require_posture(self.posture)
        _validate_sequence(self.trades, field="trades", item_type=TradePointV1)


@dataclass(frozen=True, slots=True)
class LadderLevelV1:
    price_aligned: int
    size_aligned: int

    def __post_init__(self) -> None:
        if isinstance(self.price_aligned, bool) or not isinstance(self.price_aligned, int):
            raise ContractValueError("price_aligned must be an integer")
        if isinstance(self.size_aligned, bool) or not isinstance(self.size_aligned, int):
            raise ContractValueError("size_aligned must be an integer")
        if self.price_aligned <= 0:
            raise ContractValueError("price_aligned must be strictly positive")
        if self.size_aligned <= 0:
            raise ContractValueError("size_aligned must be strictly positive")


@dataclass(frozen=True, slots=True)
class LadderSnapshotV1:
    """One book-view snapshot: bids best-first descending, asks best-first ascending."""

    event_time_ns: int
    ordinal: int
    bids: tuple[LadderLevelV1, ...]
    asks: tuple[LadderLevelV1, ...]

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        for name, levels, descending in (("bids", self.bids, True), ("asks", self.asks, False)):
            if not isinstance(levels, tuple) or len(levels) > MAX_LADDER_LEVELS:
                raise ContractValueError(f"{name} must be a bounded tuple of ladder levels")
            previous: int | None = None
            for index, level in enumerate(levels):
                if not isinstance(level, LadderLevelV1):
                    raise ContractValueError(f"{name}[{index}] must be LadderLevelV1")
                if previous is not None:
                    ordered = (
                        level.price_aligned < previous
                        if descending
                        else level.price_aligned > previous
                    )
                    if not ordered:
                        raise ContractValueError(f"{name} must be strictly best-first ordered")
                previous = level.price_aligned
        if self.bids and self.asks and self.bids[0].price_aligned >= self.asks[0].price_aligned:
            raise ContractValueError("ladder snapshots cannot be crossed or locked")

    @property
    def mid_aligned_x2(self) -> int | None:
        if not self.bids or not self.asks:
            return None
        return self.bids[0].price_aligned + self.asks[0].price_aligned


@dataclass(frozen=True, slots=True)
class LadderSeriesV1:
    series_id: str
    symbol: str
    posture: EvidencePosture
    snapshots: tuple[LadderSnapshotV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.series_id, field="series_id")
        require_contract_id(self.symbol, field="symbol")
        _require_posture(self.posture)
        _validate_sequence(self.snapshots, field="snapshots", item_type=LadderSnapshotV1)


@dataclass(frozen=True, slots=True)
class JoinedTradeV1:
    """A trade with its prevailing quote; None means honestly no prior quote."""

    trade: TradePointV1
    prevailing: TopOfBookPointV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.trade, TradePointV1):
            raise ContractValueError("trade must be TradePointV1")
        if self.prevailing is not None:
            if not isinstance(self.prevailing, TopOfBookPointV1):
                raise ContractValueError("prevailing must be TopOfBookPointV1 or None")
            if self.prevailing.event_time_ns > self.trade.event_time_ns:
                raise ContractValueError("the prevailing quote cannot postdate the trade")

    @property
    def event_time_ns(self) -> int:
        return self.trade.event_time_ns

    @property
    def ordinal(self) -> int:
        return self.trade.ordinal


def join_trades_with_quotes(
    trades: TradeSeriesV1,
    quotes: TopOfBookSeriesV1,
) -> tuple[JoinedTradeV1, ...]:
    """Join on ``(event_time_ns, global_receive_ordinal)`` without lookahead.

    A quote must strictly precede a trade on that key. Exact cross-stream ties
    are ambiguous and therefore fail closed by retaining the last strictly
    preceding quote.
    """

    if not isinstance(trades, TradeSeriesV1):
        raise ContractValueError("trades must be TradeSeriesV1")
    if not isinstance(quotes, TopOfBookSeriesV1):
        raise ContractValueError("quotes must be TopOfBookSeriesV1")
    if trades.symbol != quotes.symbol:
        raise ContractValueError("trades and quotes must describe one symbol")
    joined: list[JoinedTradeV1] = []
    quote_cursor = 0
    current: TopOfBookPointV1 | None = None
    for trade in trades.trades:
        trade_key = (trade.event_time_ns, trade.ordinal)
        while (
            quote_cursor < len(quotes.points)
            and (
                quotes.points[quote_cursor].event_time_ns,
                quotes.points[quote_cursor].ordinal,
            )
            < trade_key
        ):
            current = quotes.points[quote_cursor]
            quote_cursor += 1
        joined.append(JoinedTradeV1(trade=trade, prevailing=current))
    return tuple(joined)


def ladder_from_book_view(
    *,
    event_time_ns: int,
    ordinal: int,
    bids: tuple[tuple[int, int], ...],
    asks: tuple[tuple[int, int], ...],
) -> LadderSnapshotV1:
    """Build a snapshot from aligned (price, size) pairs, e.g. a Q04 book view."""

    return LadderSnapshotV1(
        event_time_ns=event_time_ns,
        ordinal=ordinal,
        bids=tuple(LadderLevelV1(price_aligned=p, size_aligned=s) for p, s in bids),
        asks=tuple(LadderLevelV1(price_aligned=p, size_aligned=s) for p, s in asks),
    )
