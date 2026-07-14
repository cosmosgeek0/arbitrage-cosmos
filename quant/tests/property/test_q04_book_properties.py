from __future__ import annotations

from dataclasses import dataclass, field

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.book.engine import (
    BookAnomalyV1,
    BookEffect,
    LocalBookEngine,
    QualityTransitionV1,
    SnapshotRequestIntentV1,
    spot_book_engine,
    usd_m_book_engine,
)
from quant_edge.book.events import (
    BookDelta,
    BookSnapshot,
    ReceiveClocksV1,
    SnapshotProvenanceV1,
    SpotDepthDeltaV1,
    SpotDepthSnapshotV1,
    UsdMDepthDeltaV1,
    UsdMDepthSnapshotV1,
)
from quant_edge.book.levels import PriceLevelUpdateV1, parse_price_level_update
from quant_edge.lake.contracts import EvidencePosture, QualityState

EVENT_MS = 1_772_000_000_000
WALL_MS = 1_772_000_000_050
MONO_NS = 5_000_000_000
PROC_NS = 1_772_000_000_000_000_000

BID_PRICES = ("1.0", "1.1", "1.2", "1.3", "1.4")
ASK_PRICES = ("2.0", "2.1", "2.2", "2.3", "2.4")

# Operation tokens the upstream simulator interprets.
OPS = st.lists(
    st.sampled_from(
        [
            "delta",
            "delta",
            "delta",
            "withhold",
            "redeliver",
            "reconnect",
            "snapshot",
            "snapshot",
            "snapshot_stale",
            "snapshot_wrong_intent",
        ]
    ),
    min_size=1,
    max_size=40,
)


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


@dataclass
class _Upstream:
    """Deterministic exchange-truth simulator that feeds a book engine."""

    product: str
    sequence: int = 1_000
    previous_final: int = 999
    bids: dict[str, str] = field(default_factory=lambda: {"1.2": "5"})
    asks: dict[str, str] = field(default_factory=lambda: {"2.2": "5"})
    ordinal: int = 0
    generation: int = 1
    monotonic_ns: int = MONO_NS
    history: list[BookDelta] = field(default_factory=list)
    outstanding_intent: str | None = None
    resync_required: bool = True
    processing_ns: int = PROC_NS
    mutation_counter: int = 0

    def next_processing_ns(self) -> int:
        self.processing_ns += 1
        return self.processing_ns

    def _receive(self) -> ReceiveClocksV1:
        self.ordinal += 1
        self.monotonic_ns += 1_000
        return ReceiveClocksV1(
            session_id="session-1",
            stream_id="depth-stream",
            connection_generation=self.generation,
            receive_ordinal=self.ordinal,
            receive_wall_time_ms=WALL_MS + self.ordinal,
            receive_monotonic_ns=self.monotonic_ns,
        )

    def _mutate_truth(
        self,
    ) -> tuple[
        tuple[PriceLevelUpdateV1, ...],
        tuple[PriceLevelUpdateV1, ...],
    ]:
        self.mutation_counter += 1
        counter = self.mutation_counter
        bid_price = BID_PRICES[counter % len(BID_PRICES)]
        ask_price = ASK_PRICES[(counter // 2) % len(ASK_PRICES)]
        bid_quantity = "0" if counter % 7 == 3 else str((counter % 9) + 1)
        ask_quantity = "0" if counter % 5 == 2 else str((counter % 6) + 1)
        if bid_quantity == "0":
            self.bids.pop(bid_price, None)
        else:
            self.bids[bid_price] = bid_quantity
        if ask_quantity == "0":
            self.asks.pop(ask_price, None)
        else:
            self.asks[ask_price] = ask_quantity
        return (
            (_update(bid_price, bid_quantity),),
            (_update(ask_price, ask_quantity),),
        )

    def make_delta(self) -> BookDelta:
        bids, asks = self._mutate_truth()
        first = self.sequence + 1
        last = first + (self.mutation_counter % 3)
        previous = self.previous_final
        self.sequence = last
        self.previous_final = last
        if self.product == "SPOT":
            delta: BookDelta = SpotDepthDeltaV1(
                symbol="BNBUSDT",
                event_time_ms=EVENT_MS + self.ordinal + 1,
                first_update_id=first,
                final_update_id=last,
                bids=bids,
                asks=asks,
                receive=self._receive(),
                posture=EvidencePosture.SYNTHETIC,
            )
        else:
            delta = UsdMDepthDeltaV1(
                symbol="BNBUSDT",
                event_time_ms=EVENT_MS + self.ordinal + 1,
                transaction_time_ms=EVENT_MS + self.ordinal,
                first_update_id=first,
                final_update_id=last,
                previous_final_update_id=previous,
                bids=bids,
                asks=asks,
                receive=self._receive(),
                posture=EvidencePosture.SYNTHETIC,
            )
        self.history.append(delta)
        return delta

    def redeliver(self) -> BookDelta | None:
        if not self.history:
            return None
        original = self.history[len(self.history) // 2]
        receive = self._receive()
        if isinstance(original, SpotDepthDeltaV1):
            return SpotDepthDeltaV1(
                symbol=original.symbol,
                event_time_ms=original.event_time_ms,
                first_update_id=original.first_update_id,
                final_update_id=original.final_update_id,
                bids=original.bids,
                asks=original.asks,
                receive=receive,
                posture=original.posture,
            )
        return UsdMDepthDeltaV1(
            symbol=original.symbol,
            event_time_ms=original.event_time_ms,
            transaction_time_ms=original.transaction_time_ms,
            first_update_id=original.first_update_id,
            final_update_id=original.final_update_id,
            previous_final_update_id=original.previous_final_update_id,
            bids=original.bids,
            asks=original.asks,
            receive=receive,
            posture=original.posture,
        )

    def _levels(self, side: dict[str, str], *, descending: bool) -> tuple[PriceLevelUpdateV1, ...]:
        ordered = sorted(
            side.items(),
            key=lambda item: _update(item[0], "1").price.aligned,
            reverse=descending,
        )
        return tuple(_update(price, quantity) for price, quantity in ordered)

    def make_snapshot(self, intent_id: str, *, stale_by: int = 0) -> BookSnapshot:
        last_update_id = self.sequence - stale_by
        provenance = SnapshotProvenanceV1(
            intent_id=intent_id,
            acquired_wall_time_ms=WALL_MS + self.ordinal + 1,
            acquired_monotonic_ns=self.monotonic_ns + 1,
            posture=EvidencePosture.SYNTHETIC,
        )
        if self.product == "SPOT":
            return SpotDepthSnapshotV1(
                symbol="BNBUSDT",
                last_update_id=last_update_id,
                bids=self._levels(self.bids, descending=True),
                asks=self._levels(self.asks, descending=False),
                provenance=provenance,
            )
        return UsdMDepthSnapshotV1(
            symbol="BNBUSDT",
            last_update_id=last_update_id,
            message_output_time_ms=EVENT_MS + self.ordinal + 10,
            transaction_time_ms=EVENT_MS + self.ordinal + 9,
            bids=self._levels(self.bids, descending=True),
            asks=self._levels(self.asks, descending=False),
            provenance=provenance,
        )

    def observe(self, effects: tuple[BookEffect, ...]) -> None:
        for effect in effects:
            if isinstance(effect, SnapshotRequestIntentV1):
                self.outstanding_intent = effect.intent_id


_RESYNC_KINDS = frozenset(
    {
        "FORWARD_GAP",
        "PU_MISMATCH",
        "SNAPSHOT_BRIDGE_GAP",
        "RECONNECT",
        "CROSSED_BOOK",
        "BOOK_CAPACITY_EXCEEDED",
        "BUFFER_OVERFLOW",
    }
)


def _engine(product: str) -> LocalBookEngine:
    if product == "SPOT":
        return spot_book_engine(
            "BNBUSDT",
            expected_posture=EvidencePosture.SYNTHETIC,
            max_levels_per_side=16,
            max_buffered_deltas=64,
        )
    return usd_m_book_engine(
        "BNBUSDT",
        expected_posture=EvidencePosture.SYNTHETIC,
        max_levels_per_side=16,
        max_buffered_deltas=64,
    )


def _check_view_invariants(engine: LocalBookEngine, upstream: _Upstream) -> None:
    view = engine.view()
    assert view.model_eligible == (view.quality is QualityState.COMPLETE)
    if not view.model_eligible:
        assert view.bids == ()
        assert view.asks == ()
    if upstream.resync_required:
        assert not view.model_eligible
    if view.model_eligible and view.book_update_id == upstream.sequence:
        assert {level.price.text: level.quantity.text for level in view.bids} == upstream.bids
        assert {level.price.text: level.quantity.text for level in view.asks} == upstream.asks


def _observe_anomalies(upstream: _Upstream, effects: tuple[BookEffect, ...]) -> None:
    for effect in effects:
        if isinstance(effect, BookAnomalyV1) and effect.kind.value in _RESYNC_KINDS:
            upstream.resync_required = True
        if isinstance(effect, QualityTransitionV1) and effect.to_quality is QualityState.COMPLETE:
            assert effect.reason_code == "SYNC_VALIDATED"
            assert effect.from_quality is QualityState.RECONSTRUCTING
            upstream.resync_required = False


def _drive(product: str, ops: list[str]) -> None:
    engine = _engine(product)
    upstream = _Upstream(product=product)
    effects = engine.start(processing_time_ns=upstream.next_processing_ns())
    upstream.observe(effects)
    _observe_anomalies(upstream, effects)
    _check_view_invariants(engine, upstream)

    for op in ops:
        effects = ()
        if op == "delta":
            effects = engine.on_delta(
                upstream.make_delta(),
                processing_time_ns=upstream.next_processing_ns(),
            )
        elif op == "withhold":
            upstream.make_delta()  # exchange truth advances; the event is never delivered
        elif op == "redeliver":
            redelivered = upstream.redeliver()
            if redelivered is not None:
                effects = engine.on_delta(
                    redelivered,
                    processing_time_ns=upstream.next_processing_ns(),
                )
        elif op == "reconnect":
            upstream.generation += 1
            effects = engine.on_delta(
                upstream.make_delta(),
                processing_time_ns=upstream.next_processing_ns(),
            )
        elif op == "snapshot" and upstream.outstanding_intent is not None:
            effects = engine.on_snapshot(
                upstream.make_snapshot(upstream.outstanding_intent),
                processing_time_ns=upstream.next_processing_ns(),
            )
        elif op == "snapshot_stale" and upstream.outstanding_intent is not None:
            effects = engine.on_snapshot(
                upstream.make_snapshot(upstream.outstanding_intent, stale_by=50),
                processing_time_ns=upstream.next_processing_ns(),
            )
        elif op == "snapshot_wrong_intent":
            effects = engine.on_snapshot(
                upstream.make_snapshot("q04intent:never-issued"),
                processing_time_ns=upstream.next_processing_ns(),
            )
        upstream.observe(effects)
        _observe_anomalies(upstream, effects)
        _check_view_invariants(engine, upstream)

    # Settlement: keep answering the newest outstanding intent and delivering fresh
    # deltas; a lawful engine must converge to COMPLETE and equal exchange truth.
    for _ in range(6):
        view = engine.view()
        if view.model_eligible and view.book_update_id == upstream.sequence:
            break
        if not view.model_eligible and upstream.outstanding_intent is not None:
            effects = engine.on_snapshot(
                upstream.make_snapshot(upstream.outstanding_intent),
                processing_time_ns=upstream.next_processing_ns(),
            )
            upstream.observe(effects)
            _observe_anomalies(upstream, effects)
            _check_view_invariants(engine, upstream)
        effects = engine.on_delta(
            upstream.make_delta(),
            processing_time_ns=upstream.next_processing_ns(),
        )
        upstream.observe(effects)
        _observe_anomalies(upstream, effects)
        _check_view_invariants(engine, upstream)
    view = engine.view()
    assert view.model_eligible
    assert view.book_update_id == upstream.sequence
    assert {level.price.text: level.quantity.text for level in view.bids} == upstream.bids
    assert {level.price.text: level.quantity.text for level in view.asks} == upstream.asks


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(ops=OPS)
def test_spot_gap_campaigns_never_expose_an_unsynchronized_book(ops: list[str]) -> None:
    _drive("SPOT", ops)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(ops=OPS)
def test_usd_m_gap_campaigns_never_expose_an_unsynchronized_book(ops: list[str]) -> None:
    _drive("USD_M_PERPETUAL", ops)


@settings(max_examples=40, deadline=None)
@seed(20260712)
@given(
    integer_part=st.integers(min_value=0, max_value=10**18),
    fraction_digits=st.integers(min_value=0, max_value=12),
    fraction_value=st.integers(min_value=0, max_value=10**12 - 1),
)
def test_decimal_alignment_orders_like_rational_comparison(
    integer_part: int,
    fraction_digits: int,
    fraction_value: int,
) -> None:
    from quant_edge.book.levels import parse_book_decimal

    if fraction_digits == 0:
        text = str(integer_part)
    else:
        fraction = str(fraction_value % (10**fraction_digits)).rjust(fraction_digits, "0")
        text = f"{integer_part}.{fraction}"
    reference = parse_book_decimal("1.5", field="value", allow_zero=True)
    parsed = parse_book_decimal(text, field="value", allow_zero=True)

    scaled_parsed = parsed.coefficient * 10**reference.scale
    scaled_reference = reference.coefficient * 10**parsed.scale
    assert (parsed.aligned < reference.aligned) == (scaled_parsed < scaled_reference)
    assert (parsed.aligned == reference.aligned) == (scaled_parsed == scaled_reference)
