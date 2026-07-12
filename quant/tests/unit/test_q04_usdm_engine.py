from __future__ import annotations

import pytest

from quant_edge.book.engine import (
    BookAnomalyKind,
    BookAnomalyV1,
    BookEffect,
    BookLifecycleState,
    DeltaDisposition,
    DeltaDispositionV1,
    LocalBookEngine,
    QualityTransitionV1,
    SnapshotDisposition,
    SnapshotDispositionV1,
    SnapshotRequestIntentV1,
    usd_m_book_engine,
)
from quant_edge.book.events import (
    ReceiveClocksV1,
    SnapshotProvenanceV1,
    SpotDepthSnapshotV1,
    UsdMDepthDeltaV1,
    UsdMDepthSnapshotV1,
)
from quant_edge.book.levels import PriceLevelUpdateV1, parse_price_level_update
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture, QualityState

EVENT_MS = 1_772_000_000_000
WALL_MS = 1_772_000_000_050
MONO_NS = 5_000_000_000
PROC_NS = 1_772_000_000_000_000_000


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


def _engine(*, max_levels: int = 16, max_buffered: int = 8) -> LocalBookEngine:
    return usd_m_book_engine(
        "BTCUSDT",
        expected_posture=EvidencePosture.SYNTHETIC,
        max_levels_per_side=max_levels,
        max_buffered_deltas=max_buffered,
    )


def _delta(
    first: int,
    last: int,
    previous: int,
    *,
    ordinal: int,
    bids: tuple[PriceLevelUpdateV1, ...] = (_update("7403.89", "5"),),
    asks: tuple[PriceLevelUpdateV1, ...] = (_update("7405.96", "5"),),
    generation: int = 1,
) -> UsdMDepthDeltaV1:
    return UsdMDepthDeltaV1(
        symbol="BTCUSDT",
        event_time_ms=EVENT_MS + ordinal,
        transaction_time_ms=EVENT_MS + ordinal - 1,
        first_update_id=first,
        final_update_id=last,
        previous_final_update_id=previous,
        bids=bids,
        asks=asks,
        receive=ReceiveClocksV1(
            session_id="session-1",
            stream_id="btcusdt@depth@100ms",
            connection_generation=generation,
            receive_ordinal=ordinal,
            receive_wall_time_ms=WALL_MS + ordinal,
            receive_monotonic_ns=MONO_NS + ordinal * 1_000,
        ),
        posture=EvidencePosture.SYNTHETIC,
    )


def _snapshot(
    last_update_id: int,
    intent_id: str,
    *,
    bids: tuple[PriceLevelUpdateV1, ...] = (_update("7403.89", "3"),),
    asks: tuple[PriceLevelUpdateV1, ...] = (_update("7405.96", "3"),),
) -> UsdMDepthSnapshotV1:
    return UsdMDepthSnapshotV1(
        symbol="BTCUSDT",
        last_update_id=last_update_id,
        message_output_time_ms=EVENT_MS + 100,
        transaction_time_ms=EVENT_MS + 99,
        bids=bids,
        asks=asks,
        provenance=SnapshotProvenanceV1(
            intent_id=intent_id,
            acquired_wall_time_ms=WALL_MS,
            acquired_monotonic_ns=MONO_NS,
            posture=EvidencePosture.SYNTHETIC,
        ),
    )


def _intents(effects: tuple[BookEffect, ...]) -> list[SnapshotRequestIntentV1]:
    return [effect for effect in effects if isinstance(effect, SnapshotRequestIntentV1)]


def _anomalies(effects: tuple[BookEffect, ...]) -> list[BookAnomalyV1]:
    return [effect for effect in effects if isinstance(effect, BookAnomalyV1)]


def _transitions(effects: tuple[BookEffect, ...]) -> list[QualityTransitionV1]:
    return [effect for effect in effects if isinstance(effect, QualityTransitionV1)]


def _delta_records(effects: tuple[BookEffect, ...]) -> list[DeltaDispositionV1]:
    return [effect for effect in effects if isinstance(effect, DeltaDispositionV1)]


def _snapshot_records(effects: tuple[BookEffect, ...]) -> list[SnapshotDispositionV1]:
    return [effect for effect in effects if isinstance(effect, SnapshotDispositionV1)]


def _started(engine: LocalBookEngine) -> str:
    effects = engine.start(processing_time_ns=PROC_NS)
    return _intents(effects)[0].intent_id


def _synced_engine(*, max_levels: int = 16) -> tuple[LocalBookEngine, int, int]:
    """Sync via one bridging delta; returns (engine, book_update_id, next ordinal)."""

    engine = _engine(max_levels=max_levels)
    intent_id = _started(engine)
    engine.on_delta(_delta(98, 102, 97, ordinal=1), processing_time_ns=PROC_NS + 1)
    effects = engine.on_snapshot(_snapshot(100, intent_id), processing_time_ns=PROC_NS + 2)
    assert engine.view().model_eligible, effects
    return engine, 102, 1


class TestSynchronization:
    def test_official_drop_bridge_and_pu_chain(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(
            _delta(95, 99, 90, ordinal=1, bids=(_update("7000.0", "9"),), asks=()),
            processing_time_ns=PROC_NS + 1,
        )
        engine.on_delta(
            _delta(98, 102, 99, ordinal=2, bids=(_update("7403.89", "7"),), asks=()),
            processing_time_ns=PROC_NS + 2,
        )
        engine.on_delta(
            _delta(103, 105, 102, ordinal=3, bids=(), asks=(_update("7405.96", "8"),)),
            processing_time_ns=PROC_NS + 3,
        )

        effects = engine.on_snapshot(_snapshot(100, intent_id), processing_time_ns=PROC_NS + 4)

        records = _delta_records(effects)
        assert [record.disposition for record in records] == [
            DeltaDisposition.DISCARDED_PRE_SNAPSHOT,
            DeltaDisposition.APPLIED,
            DeltaDisposition.APPLIED,
        ]
        snapshot_record = _snapshot_records(effects)[0]
        assert snapshot_record.replayed_applied == 2
        assert snapshot_record.replayed_discarded == 1
        view = engine.view()
        assert view.model_eligible
        assert view.book_update_id == 105
        assert [level.quantity.text for level in view.bids] == ["7"]
        assert [level.quantity.text for level in view.asks] == ["8"]
        # The dropped pre-snapshot bid price never entered the book.
        assert all(level.price.text != "7000.0" for level in view.bids)

    def test_event_ending_exactly_at_snapshot_id_is_retained(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(
            _delta(98, 100, 97, ordinal=1, bids=(_update("7403.89", "6"),), asks=()),
            processing_time_ns=PROC_NS + 1,
        )

        effects = engine.on_snapshot(_snapshot(100, intent_id), processing_time_ns=PROC_NS + 2)

        assert _delta_records(effects)[0].disposition is DeltaDisposition.APPLIED
        assert engine.view().model_eligible
        assert engine.view().book_update_id == 100

    def test_snapshot_older_than_retained_buffer_is_a_bridge_gap(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(_delta(101, 104, 96, ordinal=1), processing_time_ns=PROC_NS + 1)

        effects = engine.on_snapshot(_snapshot(100, intent_id), processing_time_ns=PROC_NS + 2)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.SNAPSHOT_BRIDGE_GAP
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.REJECTED_BRIDGE_GAP
        assert not engine.view().model_eligible
        assert engine.view().buffered_deltas == 1

    def test_snapshot_with_empty_buffer_waits_for_bridge_evidence(self) -> None:
        engine = _engine()
        intent_id = _started(engine)

        engine.on_snapshot(_snapshot(500, intent_id), processing_time_ns=PROC_NS + 1)
        view = engine.view()
        assert not view.model_eligible
        assert view.quality is QualityState.RECONSTRUCTING

        dropped = engine.on_delta(_delta(495, 499, 494, ordinal=1), processing_time_ns=PROC_NS + 2)
        assert _delta_records(dropped)[0].disposition is DeltaDisposition.DISCARDED_PRE_SNAPSHOT

        bridging = engine.on_delta(_delta(499, 503, 498, ordinal=2), processing_time_ns=PROC_NS + 3)
        assert _delta_records(bridging)[0].disposition is DeltaDisposition.APPLIED
        assert [t.reason_code for t in _transitions(bridging)] == ["SYNC_VALIDATED"]
        assert engine.view().model_eligible
        assert engine.view().book_update_id == 503

    def test_live_bridge_gap_forces_new_snapshot(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_snapshot(_snapshot(500, intent_id), processing_time_ns=PROC_NS + 1)

        effects = engine.on_delta(_delta(501, 504, 499, ordinal=1), processing_time_ns=PROC_NS + 2)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.SNAPSHOT_BRIDGE_GAP
        assert _delta_records(effects)[0].disposition is DeltaDisposition.RESYNC_TRIGGER
        assert not engine.view().model_eligible


class TestStreaming:
    def test_pu_chain_applies_and_advances(self) -> None:
        engine, book_update_id, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(103, 106, book_update_id, ordinal=ordinal + 1),
            processing_time_ns=PROC_NS + 10,
        )

        assert _delta_records(effects)[0].disposition is DeltaDisposition.APPLIED
        assert engine.view().book_update_id == 106
        assert engine.view().model_eligible

    def test_pu_mismatch_forces_full_resync(self) -> None:
        engine, book_update_id, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(103, 106, book_update_id + 1, ordinal=ordinal + 1),
            processing_time_ns=PROC_NS + 10,
        )

        anomaly = _anomalies(effects)[0]
        assert anomaly.kind is BookAnomalyKind.PU_MISMATCH
        transitions = _transitions(effects)
        assert [t.to_quality for t in transitions] == [
            QualityState.GAPPED,
            QualityState.RECONSTRUCTING,
        ]
        assert _intents(effects)[0].reason_code == "SEQUENCE_GAP"
        assert _delta_records(effects)[0].disposition is DeltaDisposition.RESYNC_TRIGGER
        view = engine.view()
        assert not view.model_eligible
        assert view.bids == ()
        assert view.book_update_id is None

    def test_duplicate_redelivery_is_a_pu_violation_not_a_repair(self) -> None:
        """USD-M law grants no stale-ignore rule: a re-delivered event must resync."""

        engine, book_update_id, ordinal = _synced_engine()
        engine.on_delta(
            _delta(103, 106, book_update_id, ordinal=ordinal + 1),
            processing_time_ns=PROC_NS + 10,
        )

        effects = engine.on_delta(
            _delta(103, 106, book_update_id, ordinal=ordinal + 2),
            processing_time_ns=PROC_NS + 11,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.PU_MISMATCH
        assert not engine.view().model_eligible

    def test_mid_replay_pu_mismatch_rebuffers_remaining(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(_delta(98, 102, 97, ordinal=1), processing_time_ns=PROC_NS + 1)
        engine.on_delta(_delta(103, 105, 101, ordinal=2), processing_time_ns=PROC_NS + 2)
        engine.on_delta(_delta(106, 108, 105, ordinal=3), processing_time_ns=PROC_NS + 3)

        effects = engine.on_snapshot(_snapshot(100, intent_id), processing_time_ns=PROC_NS + 4)

        records = _delta_records(effects)
        assert [record.disposition for record in records] == [
            DeltaDisposition.APPLIED,
            DeltaDisposition.RESYNC_TRIGGER,
            DeltaDisposition.BUFFERED,
        ]
        assert _anomalies(effects)[0].kind is BookAnomalyKind.PU_MISMATCH
        assert engine.view().buffered_deltas == 2
        assert not engine.view().model_eligible

    def test_crossed_book_fails_closed(self) -> None:
        engine, book_update_id, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(
                103,
                106,
                book_update_id,
                ordinal=ordinal + 1,
                bids=(_update("7405.96", "2"),),
                asks=(),
            ),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.CROSSED_BOOK
        assert not engine.view().model_eligible


class TestIdentityAndValidation:
    def test_spot_delta_is_rejected_by_a_usd_m_engine(self) -> None:
        from quant_edge.book.events import SpotDepthDeltaV1

        engine = _engine()
        _started(engine)
        spot_delta = SpotDepthDeltaV1(
            symbol="BTCUSDT",
            event_time_ms=EVENT_MS,
            first_update_id=1,
            final_update_id=2,
            bids=(),
            asks=(),
            receive=ReceiveClocksV1(
                session_id="session-1",
                stream_id="btcusdt@depth@100ms",
                connection_generation=1,
                receive_ordinal=1,
                receive_wall_time_ms=WALL_MS,
                receive_monotonic_ns=MONO_NS,
            ),
            posture=EvidencePosture.SYNTHETIC,
        )
        with pytest.raises(ContractValueError):
            engine.on_delta(spot_delta, processing_time_ns=PROC_NS + 1)

    def test_spot_snapshot_is_rejected_by_a_usd_m_engine(self) -> None:
        engine = _engine()
        _started(engine)
        spot_snapshot = SpotDepthSnapshotV1(
            symbol="BTCUSDT",
            last_update_id=100,
            bids=(),
            asks=(),
            provenance=SnapshotProvenanceV1(
                intent_id="q04intent:x",
                acquired_wall_time_ms=WALL_MS,
                acquired_monotonic_ns=MONO_NS,
                posture=EvidencePosture.SYNTHETIC,
            ),
        )
        with pytest.raises(ContractValueError):
            engine.on_snapshot(spot_snapshot, processing_time_ns=PROC_NS + 1)

    def test_invalid_snapshot_is_rejected_with_new_intent(self) -> None:
        engine = _engine()
        intent_id = _started(engine)

        effects = engine.on_snapshot(
            _snapshot(
                100,
                intent_id,
                bids=(_update("7500.0", "1"),),
                asks=(_update("7400.0", "1"),),
            ),
            processing_time_ns=PROC_NS + 1,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.INVALID_SNAPSHOT
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.REJECTED_INVALID
        assert _intents(effects)[0].reason_code == "INVALID_SNAPSHOT"

    def test_reconnect_discards_book_and_rebuffers(self) -> None:
        engine, _book_update_id, _ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(200, 202, 199, ordinal=1, generation=2),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.RECONNECT
        assert _transitions(effects)[0].from_lifecycle is BookLifecycleState.SYNCED
        assert engine.view().buffered_deltas == 1
        assert not engine.view().model_eligible
