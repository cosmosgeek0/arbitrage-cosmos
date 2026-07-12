from __future__ import annotations

import pytest

from quant_edge.book.engine import (
    BookAnomalyKind,
    BookAnomalyV1,
    BookEffect,
    BookEngineConfigV1,
    BookLifecycleState,
    DeltaDisposition,
    DeltaDispositionV1,
    LocalBookEngine,
    QualityTransitionV1,
    SnapshotDisposition,
    SnapshotDispositionV1,
    SnapshotRequestIntentV1,
    spot_book_engine,
)
from quant_edge.book.events import (
    ReceiveClocksV1,
    SnapshotProvenanceV1,
    SpotDepthDeltaV1,
    SpotDepthSnapshotV1,
    UsdMDepthDeltaV1,
)
from quant_edge.book.levels import PriceLevelUpdateV1, parse_price_level_update
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import INT64_MAX, EvidencePosture, QualityState

EVENT_MS = 1_772_000_000_000
WALL_MS = 1_772_000_000_050
MONO_NS = 5_000_000_000
PROC_NS = 1_772_000_000_000_000_000


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


def _engine(*, max_levels: int = 16, max_buffered: int = 8) -> LocalBookEngine:
    return spot_book_engine(
        "BNBUSDT",
        expected_posture=EvidencePosture.SYNTHETIC,
        max_levels_per_side=max_levels,
        max_buffered_deltas=max_buffered,
    )


def _delta(
    first: int,
    last: int,
    *,
    ordinal: int,
    bids: tuple[PriceLevelUpdateV1, ...] = (_update("1.0", "5"),),
    asks: tuple[PriceLevelUpdateV1, ...] = (_update("2.0", "5"),),
    session_id: str = "session-1",
    generation: int = 1,
    symbol: str = "BNBUSDT",
    posture: EvidencePosture = EvidencePosture.SYNTHETIC,
    monotonic_ns: int | None = None,
) -> SpotDepthDeltaV1:
    return SpotDepthDeltaV1(
        symbol=symbol,
        event_time_ms=EVENT_MS + ordinal,
        first_update_id=first,
        final_update_id=last,
        bids=bids,
        asks=asks,
        receive=ReceiveClocksV1(
            session_id=session_id,
            stream_id="bnbusdt@depth",
            connection_generation=generation,
            receive_ordinal=ordinal,
            receive_wall_time_ms=WALL_MS + ordinal,
            receive_monotonic_ns=(
                MONO_NS + ordinal * 1_000 if monotonic_ns is None else monotonic_ns
            ),
        ),
        posture=posture,
    )


def _snapshot(
    last_update_id: int,
    intent_id: str,
    *,
    bids: tuple[PriceLevelUpdateV1, ...] = (_update("1.0", "3"),),
    asks: tuple[PriceLevelUpdateV1, ...] = (_update("2.0", "3"),),
    symbol: str = "BNBUSDT",
    posture: EvidencePosture = EvidencePosture.SYNTHETIC,
) -> SpotDepthSnapshotV1:
    return SpotDepthSnapshotV1(
        symbol=symbol,
        last_update_id=last_update_id,
        bids=bids,
        asks=asks,
        provenance=SnapshotProvenanceV1(
            intent_id=intent_id,
            acquired_wall_time_ms=WALL_MS,
            acquired_monotonic_ns=MONO_NS,
            posture=posture,
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


def _synced_engine(*, max_levels: int = 16, max_buffered: int = 8) -> tuple[LocalBookEngine, int]:
    """Start, buffer one bridging delta, sync via snapshot; returns (engine, next ordinal)."""

    engine = _engine(max_levels=max_levels, max_buffered=max_buffered)
    intent_id = _started(engine)
    engine.on_delta(_delta(100, 102, ordinal=1), processing_time_ns=PROC_NS + 1)
    effects = engine.on_snapshot(
        _snapshot(100, intent_id),
        processing_time_ns=PROC_NS + 2,
    )
    assert engine.view().model_eligible, effects
    return engine, 2


class TestLifecycleContracts:
    def test_start_emits_reconstructing_transition_and_intent(self) -> None:
        engine = _engine()
        effects = engine.start(processing_time_ns=PROC_NS)

        transition = _transitions(effects)[0]
        intent = _intents(effects)[0]
        assert transition.from_quality is QualityState.UNKNOWN
        assert transition.to_quality is QualityState.RECONSTRUCTING
        assert transition.from_lifecycle is BookLifecycleState.CREATED
        assert transition.to_lifecycle is BookLifecycleState.AWAITING_SNAPSHOT
        assert transition.reason_code == "INITIAL_SYNC"
        assert intent.reason_code == "INITIAL_SYNC"
        assert intent.boundary_owner == "intelligenceRuntime"
        assert intent.authority == "READ_ONLY_RESEARCH_INTENT"
        view = engine.view()
        assert not view.model_eligible
        assert view.quality is QualityState.RECONSTRUCTING

    def test_start_twice_is_rejected(self) -> None:
        engine = _engine()
        engine.start(processing_time_ns=PROC_NS)
        with pytest.raises(ContractValueError):
            engine.start(processing_time_ns=PROC_NS + 1)

    def test_evidence_before_start_is_rejected(self) -> None:
        engine = _engine()
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1_000, 1_001, ordinal=1), processing_time_ns=PROC_NS)
        with pytest.raises(ContractValueError):
            engine.on_snapshot(_snapshot(1, "q04intent:x"), processing_time_ns=PROC_NS)

    def test_engine_requires_config_type(self) -> None:
        with pytest.raises(ContractValueError):
            LocalBookEngine("config")  # type: ignore[arg-type]

    def test_processing_clock_is_validated_and_monotonic(self) -> None:
        engine = _engine()
        engine.start(processing_time_ns=PROC_NS)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1, 2, ordinal=1), processing_time_ns=PROC_NS - 1)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1, 2, ordinal=1), processing_time_ns=5)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1, 2, ordinal=1), processing_time_ns="now")  # type: ignore[arg-type]

    def test_step_counter_exhaustion_fails_closed(self) -> None:
        engine = _engine()
        engine.start(processing_time_ns=PROC_NS)
        mangled_step = "_LocalBookEngine__step"
        setattr(engine, mangled_step, INT64_MAX)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1, 2, ordinal=1), processing_time_ns=PROC_NS + 1)

    def test_delta_law_requires_snapshot_identity(self) -> None:
        engine = _engine()
        engine.start(processing_time_ns=PROC_NS)
        mangled_lifecycle = "_LocalBookEngine__lifecycle"
        setattr(engine, mangled_lifecycle, BookLifecycleState.SYNCED)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1, 2, ordinal=1), processing_time_ns=PROC_NS + 1)


class TestIdentityValidation:
    def test_wrong_product_symbol_and_posture_are_rejected(self) -> None:
        engine = _engine()
        _started(engine)
        usd_m = UsdMDepthDeltaV1(
            symbol="BNBUSDT",
            event_time_ms=EVENT_MS,
            transaction_time_ms=EVENT_MS,
            first_update_id=1,
            final_update_id=2,
            previous_final_update_id=0,
            bids=(),
            asks=(),
            receive=ReceiveClocksV1(
                session_id="session-1",
                stream_id="bnbusdt@depth",
                connection_generation=1,
                receive_ordinal=1,
                receive_wall_time_ms=WALL_MS,
                receive_monotonic_ns=MONO_NS,
            ),
            posture=EvidencePosture.SYNTHETIC,
        )
        with pytest.raises(ContractValueError):
            engine.on_delta(usd_m, processing_time_ns=PROC_NS + 1)
        with pytest.raises(ContractValueError):
            engine.on_delta(
                _delta(1, 2, ordinal=1, symbol="ETHUSDT"),
                processing_time_ns=PROC_NS + 1,
            )
        with pytest.raises(ContractValueError):
            engine.on_delta(
                _delta(1, 2, ordinal=1, posture=EvidencePosture.REPLAY),
                processing_time_ns=PROC_NS + 1,
            )
        with pytest.raises(ContractValueError):
            engine.on_snapshot(
                _snapshot(1, "q04intent:x", symbol="ETHUSDT"),
                processing_time_ns=PROC_NS + 1,
            )
        with pytest.raises(ContractValueError):
            engine.on_snapshot(
                _snapshot(1, "q04intent:x", posture=EvidencePosture.REPLAY),
                processing_time_ns=PROC_NS + 1,
            )

    def test_spot_engine_rejects_usd_m_snapshot(self) -> None:
        from quant_edge.book.events import UsdMDepthSnapshotV1

        engine = _engine()
        _started(engine)
        usd_m_snapshot = UsdMDepthSnapshotV1(
            symbol="BNBUSDT",
            last_update_id=1,
            message_output_time_ms=EVENT_MS,
            transaction_time_ms=EVENT_MS,
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
            engine.on_snapshot(usd_m_snapshot, processing_time_ns=PROC_NS + 1)


class TestSynchronization:
    def test_official_buffered_overlap_synchronization(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(
            _delta(150, 152, ordinal=1, bids=(_update("0.9", "9"),)),
            processing_time_ns=PROC_NS + 1,
        )
        engine.on_delta(
            _delta(153, 155, ordinal=2, bids=(_update("1.0", "7"),), asks=()),
            processing_time_ns=PROC_NS + 2,
        )
        engine.on_delta(
            _delta(156, 158, ordinal=3, bids=(), asks=(_update("2.0", "8"),)),
            processing_time_ns=PROC_NS + 3,
        )

        effects = engine.on_snapshot(_snapshot(154, intent_id), processing_time_ns=PROC_NS + 4)

        records = _delta_records(effects)
        assert [record.disposition for record in records] == [
            DeltaDisposition.DISCARDED_PRE_SNAPSHOT,
            DeltaDisposition.APPLIED,
            DeltaDisposition.APPLIED,
        ]
        snapshot_record = _snapshot_records(effects)[0]
        assert snapshot_record.disposition is SnapshotDisposition.APPLIED
        assert snapshot_record.replayed_applied == 2
        assert snapshot_record.replayed_discarded == 1
        reasons = [transition.reason_code for transition in _transitions(effects)]
        assert reasons == ["SNAPSHOT_ACCEPTED", "SYNC_VALIDATED"]
        view = engine.view()
        assert view.model_eligible
        assert view.quality is QualityState.COMPLETE
        assert view.book_update_id == 158
        assert [level.quantity.text for level in view.bids] == ["7"]
        assert [level.quantity.text for level in view.asks] == ["8"]

    def test_stale_snapshot_is_rejected_and_retried(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(_delta(200, 202, ordinal=1), processing_time_ns=PROC_NS + 1)

        effects = engine.on_snapshot(_snapshot(150, intent_id), processing_time_ns=PROC_NS + 2)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.STALE_SNAPSHOT
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.REJECTED_STALE
        retry_intent = _intents(effects)[0]
        assert retry_intent.reason_code == "STALE_SNAPSHOT"
        assert not engine.view().model_eligible

        accepted = engine.on_snapshot(
            _snapshot(201, retry_intent.intent_id),
            processing_time_ns=PROC_NS + 3,
        )
        assert engine.view().model_eligible, accepted

    def test_snapshot_between_buffered_events_is_rejected_as_bridge_gap(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(_delta(150, 152, ordinal=1), processing_time_ns=PROC_NS + 1)
        engine.on_delta(_delta(160, 162, ordinal=2), processing_time_ns=PROC_NS + 2)

        effects = engine.on_snapshot(_snapshot(155, intent_id), processing_time_ns=PROC_NS + 3)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.SNAPSHOT_BRIDGE_GAP
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.REJECTED_BRIDGE_GAP
        assert not engine.view().model_eligible

    def test_snapshot_with_empty_buffer_waits_for_bridge_evidence(self) -> None:
        engine = _engine()
        intent_id = _started(engine)

        effects = engine.on_snapshot(_snapshot(500, intent_id), processing_time_ns=PROC_NS + 1)

        transition = _transitions(effects)[0]
        assert transition.reason_code == "SNAPSHOT_ACCEPTED"
        assert transition.to_lifecycle is BookLifecycleState.SNAPSHOT_APPLIED
        view = engine.view()
        assert not view.model_eligible
        assert view.quality is QualityState.RECONSTRUCTING
        assert view.bids == ()

        stale = engine.on_delta(_delta(498, 500, ordinal=1), processing_time_ns=PROC_NS + 2)
        assert _delta_records(stale)[0].disposition is DeltaDisposition.DISCARDED_PRE_SNAPSHOT
        assert not engine.view().model_eligible

        bridging = engine.on_delta(_delta(500, 503, ordinal=2), processing_time_ns=PROC_NS + 3)
        assert _delta_records(bridging)[0].disposition is DeltaDisposition.APPLIED
        assert [t.reason_code for t in _transitions(bridging)] == ["SYNC_VALIDATED"]
        assert engine.view().model_eligible

    def test_snapshot_bridge_gap_on_live_delta_forces_new_snapshot(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_snapshot(_snapshot(500, intent_id), processing_time_ns=PROC_NS + 1)

        effects = engine.on_delta(_delta(502, 504, ordinal=1), processing_time_ns=PROC_NS + 2)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.SNAPSHOT_BRIDGE_GAP
        assert _delta_records(effects)[0].disposition is DeltaDisposition.RESYNC_TRIGGER
        assert engine.view().buffered_deltas == 1
        assert not engine.view().model_eligible

    def test_mid_replay_gap_rebuffers_remaining_stream_evidence(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_delta(_delta(155, 157, ordinal=1), processing_time_ns=PROC_NS + 1)
        engine.on_delta(_delta(161, 163, ordinal=2), processing_time_ns=PROC_NS + 2)
        engine.on_delta(_delta(164, 166, ordinal=3), processing_time_ns=PROC_NS + 3)

        effects = engine.on_snapshot(_snapshot(155, intent_id), processing_time_ns=PROC_NS + 4)

        records = _delta_records(effects)
        assert [record.disposition for record in records] == [
            DeltaDisposition.APPLIED,
            DeltaDisposition.RESYNC_TRIGGER,
            DeltaDisposition.BUFFERED,
        ]
        assert _anomalies(effects)[0].kind is BookAnomalyKind.FORWARD_GAP
        snapshot_record = _snapshot_records(effects)[0]
        assert snapshot_record.disposition is SnapshotDisposition.APPLIED
        assert snapshot_record.replayed_applied == 1
        view = engine.view()
        assert not view.model_eligible
        assert view.buffered_deltas == 2

        retry_intent = _intents(effects)[-1]
        resynced = engine.on_snapshot(
            _snapshot(161, retry_intent.intent_id),
            processing_time_ns=PROC_NS + 5,
        )
        assert engine.view().model_eligible, resynced
        assert engine.view().book_update_id == 166


class TestStreaming:
    def test_contiguous_and_overlapping_events_apply(self) -> None:
        engine, ordinal = _synced_engine()
        applied = engine.on_delta(
            _delta(103, 105, ordinal=ordinal + 1, bids=(_update("1.1", "4"),)),
            processing_time_ns=PROC_NS + 10,
        )
        assert _delta_records(applied)[0].disposition is DeltaDisposition.APPLIED

        overlap = engine.on_delta(
            _delta(104, 107, ordinal=ordinal + 2, asks=(_update("2.1", "6"),)),
            processing_time_ns=PROC_NS + 11,
        )
        assert _delta_records(overlap)[0].disposition is DeltaDisposition.APPLIED
        view = engine.view()
        assert view.book_update_id == 107
        assert view.model_eligible

    def test_stale_events_are_ignored_without_resync(self) -> None:
        engine, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(90, 95, ordinal=ordinal + 1),
            processing_time_ns=PROC_NS + 10,
        )

        assert _delta_records(effects)[0].disposition is DeltaDisposition.IGNORED_STALE
        assert _anomalies(effects) == []
        assert engine.view().model_eligible

    def test_forward_gap_follows_the_full_gapped_resync_law(self) -> None:
        engine, ordinal = _synced_engine()
        gap_delta = _delta(120, 125, ordinal=ordinal + 1)

        effects = engine.on_delta(gap_delta, processing_time_ns=PROC_NS + 10)

        anomaly = _anomalies(effects)[0]
        assert anomaly.kind is BookAnomalyKind.FORWARD_GAP
        transitions = _transitions(effects)
        assert [t.to_quality for t in transitions] == [
            QualityState.GAPPED,
            QualityState.RECONSTRUCTING,
        ]
        assert transitions[0].from_quality is QualityState.COMPLETE
        assert transitions[0].reason_code == "SEQUENCE_GAP"
        intent = _intents(effects)[0]
        assert intent.reason_code == "SEQUENCE_GAP"
        assert _delta_records(effects)[0].disposition is DeltaDisposition.RESYNC_TRIGGER
        view = engine.view()
        assert not view.model_eligible
        assert view.bids == ()
        assert view.asks == ()
        assert view.book_update_id is None
        assert view.buffered_deltas == 1

        resynced = engine.on_snapshot(
            _snapshot(120, intent.intent_id),
            processing_time_ns=PROC_NS + 11,
        )
        assert engine.view().model_eligible, resynced
        assert engine.view().book_update_id == 125

    def test_zero_quantity_removals_track_absent_levels(self) -> None:
        engine, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(
                103,
                104,
                ordinal=ordinal + 1,
                bids=(_update("1.0", "0"),),
                asks=(_update("3.5", "0"),),
            ),
            processing_time_ns=PROC_NS + 10,
        )

        record = _delta_records(effects)[0]
        assert record.disposition is DeltaDisposition.APPLIED
        assert record.removed_levels == 1
        assert record.removed_absent_levels == 1
        assert engine.view().model_eligible

    def test_crossed_book_fails_closed(self) -> None:
        engine, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(103, 104, ordinal=ordinal + 1, bids=(_update("2.5", "1"),)),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.CROSSED_BOOK
        assert _delta_records(effects)[0].disposition is DeltaDisposition.RESYNC_TRIGGER
        assert not engine.view().model_eligible

    def test_locked_book_is_also_crossed(self) -> None:
        engine, ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(103, 104, ordinal=ordinal + 1, bids=(_update("2.0", "1"),)),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.CROSSED_BOOK

    def test_ladder_capacity_fails_closed(self) -> None:
        engine, ordinal = _synced_engine(max_levels=2)
        effects = engine.on_delta(
            _delta(
                103,
                104,
                ordinal=ordinal + 1,
                bids=(_update("0.8", "1"), _update("0.9", "1")),
                asks=(),
            ),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.BOOK_CAPACITY_EXCEEDED
        assert not engine.view().model_eligible


class TestReceiveClockLaw:
    def test_receive_ordinal_must_strictly_increase(self) -> None:
        engine = _engine()
        _started(engine)
        engine.on_delta(_delta(1_000, 1_001, ordinal=5), processing_time_ns=PROC_NS + 1)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1_002, 1_003, ordinal=5), processing_time_ns=PROC_NS + 2)
        with pytest.raises(ContractValueError):
            engine.on_delta(_delta(1_002, 1_003, ordinal=4), processing_time_ns=PROC_NS + 3)

    def test_receive_monotonic_must_not_regress(self) -> None:
        engine = _engine()
        _started(engine)
        engine.on_delta(
            _delta(1_000, 1_001, ordinal=5, monotonic_ns=MONO_NS),
            processing_time_ns=PROC_NS + 1,
        )
        with pytest.raises(ContractValueError):
            engine.on_delta(
                _delta(1_002, 1_003, ordinal=6, monotonic_ns=MONO_NS - 1),
                processing_time_ns=PROC_NS + 2,
            )

    def test_connection_generation_must_not_regress(self) -> None:
        engine = _engine()
        _started(engine)
        engine.on_delta(
            _delta(1_000, 1_001, ordinal=5, generation=3),
            processing_time_ns=PROC_NS + 1,
        )
        with pytest.raises(ContractValueError):
            engine.on_delta(
                _delta(1_002, 1_003, ordinal=6, generation=2),
                processing_time_ns=PROC_NS + 2,
            )

    def test_reconnect_from_synced_discards_book_and_rebuffers(self) -> None:
        engine, _ordinal = _synced_engine()
        effects = engine.on_delta(
            _delta(200, 202, ordinal=1, generation=2),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.RECONNECT
        transitions = _transitions(effects)
        assert [t.to_quality for t in transitions] == [
            QualityState.GAPPED,
            QualityState.RECONSTRUCTING,
        ]
        assert transitions[0].reason_code == "CONNECTION_RESTART"
        assert _intents(effects)[0].reason_code == "CONNECTION_RESTART"
        assert _delta_records(effects)[0].disposition is DeltaDisposition.BUFFERED
        view = engine.view()
        assert not view.model_eligible
        assert view.buffered_deltas == 1

    def test_reconnect_while_awaiting_restarts_the_buffer(self) -> None:
        engine = _engine()
        _started(engine)
        engine.on_delta(_delta(100, 101, ordinal=1), processing_time_ns=PROC_NS + 1)
        effects = engine.on_delta(
            _delta(300, 301, ordinal=1, session_id="session-2"),
            processing_time_ns=PROC_NS + 2,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.RECONNECT
        assert _transitions(effects) == []
        assert engine.view().buffered_deltas == 1

    def test_reconnect_from_snapshot_applied_reconstructs(self) -> None:
        engine = _engine()
        intent_id = _started(engine)
        engine.on_snapshot(_snapshot(500, intent_id), processing_time_ns=PROC_NS + 1)
        engine.on_delta(_delta(498, 500, ordinal=1), processing_time_ns=PROC_NS + 2)

        effects = engine.on_delta(
            _delta(600, 601, ordinal=1, generation=2),
            processing_time_ns=PROC_NS + 3,
        )

        transitions = _transitions(effects)
        assert [t.to_quality for t in transitions] == [QualityState.RECONSTRUCTING]
        assert transitions[0].from_lifecycle is BookLifecycleState.SNAPSHOT_APPLIED
        assert transitions[0].reason_code == "CONNECTION_RESTART"


class TestBufferBounds:
    def test_buffer_overflow_restarts_synchronization(self) -> None:
        engine = _engine(max_buffered=2)
        _started(engine)
        engine.on_delta(_delta(100, 101, ordinal=1), processing_time_ns=PROC_NS + 1)
        engine.on_delta(_delta(102, 103, ordinal=2), processing_time_ns=PROC_NS + 2)

        effects = engine.on_delta(_delta(104, 105, ordinal=3), processing_time_ns=PROC_NS + 3)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.BUFFER_OVERFLOW
        assert _intents(effects)[0].reason_code == "BUFFER_OVERFLOW"
        assert _delta_records(effects)[0].disposition is DeltaDisposition.BUFFERED
        assert engine.view().buffered_deltas == 1


class TestSnapshotRouting:
    def test_unsolicited_snapshot_is_ignored(self) -> None:
        engine, _ = _synced_engine()
        effects = engine.on_snapshot(
            _snapshot(999, "q04intent:unsolicited"),
            processing_time_ns=PROC_NS + 10,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.UNSOLICITED_SNAPSHOT
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.IGNORED_UNSOLICITED
        assert engine.view().model_eligible

    def test_superseded_snapshot_is_ignored(self) -> None:
        engine = _engine()
        first_intent = _started(engine)
        engine.on_delta(_delta(200, 202, ordinal=1), processing_time_ns=PROC_NS + 1)
        rejected = engine.on_snapshot(
            _snapshot(150, first_intent),
            processing_time_ns=PROC_NS + 2,
        )
        retry_intent = _intents(rejected)[0].intent_id

        effects = engine.on_snapshot(_snapshot(210, first_intent), processing_time_ns=PROC_NS + 3)

        assert _anomalies(effects)[0].kind is BookAnomalyKind.SUPERSEDED_SNAPSHOT
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.IGNORED_SUPERSEDED
        assert not engine.view().model_eligible

        accepted = engine.on_snapshot(_snapshot(201, retry_intent), processing_time_ns=PROC_NS + 4)
        assert engine.view().model_eligible, accepted

    def test_retained_intent_identities_are_bounded(self) -> None:
        from quant_edge.book.engine import MAX_RETAINED_INTENT_IDS

        engine = _engine()
        first_intent = _started(engine)
        engine.on_delta(_delta(1_000, 1_002, ordinal=1), processing_time_ns=PROC_NS + 1)
        outstanding = first_intent
        recent = first_intent
        for index in range(MAX_RETAINED_INTENT_IDS + 1):
            effects = engine.on_snapshot(
                _snapshot(400, outstanding),
                processing_time_ns=PROC_NS + 2 + index,
            )
            recent = outstanding
            outstanding = _intents(effects)[0].intent_id

        evicted = engine.on_snapshot(
            _snapshot(999, first_intent),
            processing_time_ns=PROC_NS + 5_000,
        )
        assert _anomalies(evicted)[0].kind is BookAnomalyKind.UNMATCHED_SNAPSHOT

        superseded = engine.on_snapshot(
            _snapshot(999, recent),
            processing_time_ns=PROC_NS + 5_001,
        )
        assert _anomalies(superseded)[0].kind is BookAnomalyKind.SUPERSEDED_SNAPSHOT

        accepted = engine.on_snapshot(
            _snapshot(1_001, outstanding),
            processing_time_ns=PROC_NS + 5_002,
        )
        assert engine.view().model_eligible, accepted

    def test_unmatched_snapshot_is_ignored(self) -> None:
        engine = _engine()
        _started(engine)
        effects = engine.on_snapshot(
            _snapshot(210, "q04intent:never-issued"),
            processing_time_ns=PROC_NS + 1,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.UNMATCHED_SNAPSHOT
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.IGNORED_UNMATCHED
        assert not engine.view().model_eligible


class TestSnapshotValidation:
    @pytest.mark.parametrize(
        ("bids", "asks"),
        [
            ((_update("1.0", "1"), _update("1.1", "1")), (_update("2.0", "1"),)),
            ((_update("1.0", "1"),), (_update("2.1", "1"), _update("2.0", "1"))),
            ((_update("1.0", "0"),), (_update("2.0", "1"),)),
            ((_update("1.0", "1"),), (_update("2.0", "0"),)),
            ((_update("2.0", "1"),), (_update("1.0", "1"),)),
            ((_update("2.0", "1"),), (_update("2.0", "1"),)),
        ],
    )
    def test_invalid_snapshots_are_rejected(
        self,
        bids: tuple[PriceLevelUpdateV1, ...],
        asks: tuple[PriceLevelUpdateV1, ...],
    ) -> None:
        engine = _engine()
        intent_id = _started(engine)

        effects = engine.on_snapshot(
            _snapshot(100, intent_id, bids=bids, asks=asks),
            processing_time_ns=PROC_NS + 1,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.INVALID_SNAPSHOT
        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.REJECTED_INVALID
        assert _intents(effects)[0].reason_code == "INVALID_SNAPSHOT"
        assert not engine.view().model_eligible

    def test_snapshot_larger_than_configured_ladder_is_invalid(self) -> None:
        engine = _engine(max_levels=1)
        intent_id = _started(engine)

        effects = engine.on_snapshot(
            _snapshot(
                100,
                intent_id,
                bids=(_update("1.1", "1"), _update("1.0", "1")),
                asks=(_update("2.0", "1"),),
            ),
            processing_time_ns=PROC_NS + 1,
        )

        assert _anomalies(effects)[0].kind is BookAnomalyKind.INVALID_SNAPSHOT

    def test_one_sided_snapshots_are_acceptable(self) -> None:
        engine = _engine()
        intent_id = _started(engine)

        effects = engine.on_snapshot(
            _snapshot(100, intent_id, bids=(), asks=(_update("2.0", "1"),)),
            processing_time_ns=PROC_NS + 1,
        )

        assert _snapshot_records(effects)[0].disposition is SnapshotDisposition.APPLIED


class TestEffectContracts:
    def test_anomaly_record_contract(self) -> None:
        from quant_edge.book.engine import BookAnomalyV1

        with pytest.raises(ContractValueError):
            BookAnomalyV1(
                engine_step=1,
                book_key="SPOT:BNBUSDT",
                kind="FORWARD_GAP",  # type: ignore[arg-type]
                detail="detail",
                processing_time_ns=PROC_NS,
            )
        with pytest.raises(ContractValueError):
            BookAnomalyV1(
                engine_step=1,
                book_key="SPOT:BNBUSDT",
                kind=BookAnomalyKind.FORWARD_GAP,
                detail="",
                processing_time_ns=PROC_NS,
            )
        with pytest.raises(ContractValueError):
            BookAnomalyV1(
                engine_step=1,
                book_key="SPOT:BNBUSDT",
                kind=BookAnomalyKind.FORWARD_GAP,
                detail="x" * 257,
                processing_time_ns=PROC_NS,
            )
        with pytest.raises(ContractValueError):
            BookAnomalyV1(
                engine_step=1,
                book_key="SPOT:BNBUSDT",
                kind=BookAnomalyKind.FORWARD_GAP,
                detail=7,  # type: ignore[arg-type]
                processing_time_ns=PROC_NS,
            )


class TestViewAndConfig:
    def test_view_exposes_levels_only_when_model_eligible(self) -> None:
        engine, _ = _synced_engine()
        view = engine.view()

        assert view.model_eligible
        assert view.bids
        assert view.asks
        mapping = view.as_mapping()
        assert mapping["modelEligible"] is True
        assert mapping["quality"] == "COMPLETE"
        assert isinstance(mapping["counters"], dict)

    def test_config_contracts(self) -> None:
        config = BookEngineConfigV1(
            product=ForwardProduct.SPOT,
            symbol="BNBUSDT",
            expected_posture=EvidencePosture.SYNTHETIC,
            max_levels_per_side=4,
            max_buffered_deltas=4,
        )
        assert config.book_key == "SPOT:BNBUSDT"
        assert config.as_mapping()["bookKey"] == "SPOT:BNBUSDT"
        assert LocalBookEngine(config).config is config
        with pytest.raises(ContractValueError):
            BookEngineConfigV1(
                product="SPOT",  # type: ignore[arg-type]
                symbol="BNBUSDT",
                expected_posture=EvidencePosture.SYNTHETIC,
                max_levels_per_side=4,
                max_buffered_deltas=4,
            )
        with pytest.raises(ContractValueError):
            BookEngineConfigV1(
                product=ForwardProduct.SPOT,
                symbol="BNBUSDT",
                expected_posture=EvidencePosture.LIVE,
                max_levels_per_side=4,
                max_buffered_deltas=4,
            )
        with pytest.raises(ContractValueError):
            BookEngineConfigV1(
                product=ForwardProduct.SPOT,
                symbol="BNBUSDT",
                expected_posture=EvidencePosture.SYNTHETIC,
                max_levels_per_side=0,
                max_buffered_deltas=4,
            )
        with pytest.raises(ContractValueError):
            BookEngineConfigV1(
                product=ForwardProduct.SPOT,
                symbol="BNBUSDT",
                expected_posture=EvidencePosture.SYNTHETIC,
                max_levels_per_side=4,
                max_buffered_deltas=0,
            )
        with pytest.raises(ContractValueError):
            BookEngineConfigV1(
                product=ForwardProduct.SPOT,
                symbol="BNBUSDT",
                expected_posture=EvidencePosture.SYNTHETIC,
                max_levels_per_side=4,
                max_buffered_deltas=4,
                schema_version="q99",
            )
