from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.book.events import (
    BookDelta,
    BookSnapshot,
    SpotDepthDeltaV1,
    SpotDepthSnapshotV1,
    UsdMDepthDeltaV1,
    UsdMDepthSnapshotV1,
)
from quant_edge.book.levels import (
    BookSide,
    LadderUpdateOutcome,
    PriceLadder,
    PriceLevelUpdateV1,
)
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    QualityState,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)

BOOK_ENGINE_SCHEMA_VERSION: Final = "q04.book.engine.v1"
SNAPSHOT_BOUNDARY_OWNER: Final = "intelligenceRuntime"
SNAPSHOT_INTENT_AUTHORITY: Final = "READ_ONLY_RESEARCH_INTENT"
MAX_BUFFERED_DELTAS_LIMIT: Final = 65_536
MAX_LEVELS_PER_SIDE_LIMIT: Final = 65_536
MAX_ANOMALY_DETAIL_LENGTH: Final = 256
MAX_RETAINED_INTENT_IDS: Final = 1_024


class BookLifecycleState(StrEnum):
    CREATED = "CREATED"
    AWAITING_SNAPSHOT = "AWAITING_SNAPSHOT"
    SNAPSHOT_APPLIED = "SNAPSHOT_APPLIED"
    SYNCED = "SYNCED"


class BookAnomalyKind(StrEnum):
    FORWARD_GAP = "FORWARD_GAP"
    PU_MISMATCH = "PU_MISMATCH"
    SNAPSHOT_BRIDGE_GAP = "SNAPSHOT_BRIDGE_GAP"
    STALE_SNAPSHOT = "STALE_SNAPSHOT"
    INVALID_SNAPSHOT = "INVALID_SNAPSHOT"
    UNSOLICITED_SNAPSHOT = "UNSOLICITED_SNAPSHOT"
    SUPERSEDED_SNAPSHOT = "SUPERSEDED_SNAPSHOT"
    UNMATCHED_SNAPSHOT = "UNMATCHED_SNAPSHOT"
    RECONNECT = "RECONNECT"
    BUFFER_OVERFLOW = "BUFFER_OVERFLOW"
    CROSSED_BOOK = "CROSSED_BOOK"
    BOOK_CAPACITY_EXCEEDED = "BOOK_CAPACITY_EXCEEDED"


class DeltaDisposition(StrEnum):
    APPLIED = "APPLIED"
    BUFFERED = "BUFFERED"
    IGNORED_STALE = "IGNORED_STALE"
    DISCARDED_PRE_SNAPSHOT = "DISCARDED_PRE_SNAPSHOT"
    RESYNC_TRIGGER = "RESYNC_TRIGGER"


class SnapshotDisposition(StrEnum):
    APPLIED = "APPLIED"
    REJECTED_STALE = "REJECTED_STALE"
    REJECTED_BRIDGE_GAP = "REJECTED_BRIDGE_GAP"
    REJECTED_INVALID = "REJECTED_INVALID"
    IGNORED_UNSOLICITED = "IGNORED_UNSOLICITED"
    IGNORED_SUPERSEDED = "IGNORED_SUPERSEDED"
    IGNORED_UNMATCHED = "IGNORED_UNMATCHED"


class _DeltaAction(StrEnum):
    APPLY = "APPLY"
    IGNORE_STALE = "IGNORE_STALE"
    DISCARD_PRE_SNAPSHOT = "DISCARD_PRE_SNAPSHOT"


@dataclass(frozen=True, slots=True)
class BookEngineConfigV1:
    product: ForwardProduct
    symbol: str
    expected_posture: EvidencePosture
    max_levels_per_side: int
    max_buffered_deltas: int
    schema_version: str = BOOK_ENGINE_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.product, ForwardProduct):
            raise ContractValueError("product must be an explicit ForwardProduct")
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.expected_posture, EvidencePosture) or (
            self.expected_posture not in (EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY)
        ):
            raise ContractValueError("expected_posture must be SYNTHETIC or REPLAY")
        require_strict_int(
            self.max_levels_per_side,
            field="max_levels_per_side",
            minimum=1,
            maximum=MAX_LEVELS_PER_SIDE_LIMIT,
        )
        require_strict_int(
            self.max_buffered_deltas,
            field="max_buffered_deltas",
            minimum=1,
            maximum=MAX_BUFFERED_DELTAS_LIMIT,
        )
        if self.schema_version != BOOK_ENGINE_SCHEMA_VERSION:
            raise ContractValueError("unsupported book engine schema version")

    @property
    def book_key(self) -> str:
        return f"{self.product.value}:{self.symbol}"

    def as_mapping(self) -> dict[str, object]:
        return {
            "bookKey": self.book_key,
            "expectedPosture": self.expected_posture.value,
            "maxBufferedDeltas": self.max_buffered_deltas,
            "maxLevelsPerSide": self.max_levels_per_side,
            "product": self.product.value,
            "schemaVersion": self.schema_version,
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class QualityTransitionV1:
    engine_step: int
    book_key: str
    from_quality: QualityState
    to_quality: QualityState
    from_lifecycle: BookLifecycleState
    to_lifecycle: BookLifecycleState
    reason_code: str
    book_update_id: int | None
    processing_time_ns: int

    def __post_init__(self) -> None:
        require_reason_code(self.reason_code, field="reason_code")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bookKey": self.book_key,
            "bookUpdateId": self.book_update_id,
            "effect": "QUALITY_TRANSITION",
            "engineStep": self.engine_step,
            "fromLifecycle": self.from_lifecycle.value,
            "fromQuality": self.from_quality.value,
            "processingTimeNs": self.processing_time_ns,
            "reasonCode": self.reason_code,
            "toLifecycle": self.to_lifecycle.value,
            "toQuality": self.to_quality.value,
        }


@dataclass(frozen=True, slots=True)
class SnapshotRequestIntentV1:
    """Pure request intent addressed to the canonical runtime; carries no transport."""

    intent_id: str
    book_key: str
    symbol: str
    product: ForwardProduct
    engine_step: int
    request_sequence: int
    reason_code: str
    processing_time_ns: int
    boundary_owner: str = SNAPSHOT_BOUNDARY_OWNER
    authority: str = SNAPSHOT_INTENT_AUTHORITY

    def __post_init__(self) -> None:
        require_contract_id(self.intent_id, field="intent_id")
        require_reason_code(self.reason_code, field="reason_code")
        if self.boundary_owner != SNAPSHOT_BOUNDARY_OWNER:
            raise ContractValueError("snapshot intents must name the canonical boundary owner")
        if self.authority != SNAPSHOT_INTENT_AUTHORITY:
            raise ContractValueError("snapshot intents convey no operational authority")

    def as_mapping(self) -> dict[str, object]:
        return {
            "authority": self.authority,
            "bookKey": self.book_key,
            "boundaryOwner": self.boundary_owner,
            "effect": "SNAPSHOT_REQUEST_INTENT",
            "engineStep": self.engine_step,
            "intentId": self.intent_id,
            "processingTimeNs": self.processing_time_ns,
            "product": self.product.value,
            "reasonCode": self.reason_code,
            "requestSequence": self.request_sequence,
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class BookAnomalyV1:
    engine_step: int
    book_key: str
    kind: BookAnomalyKind
    detail: str
    processing_time_ns: int

    def __post_init__(self) -> None:
        if not isinstance(self.kind, BookAnomalyKind):
            raise ContractValueError("kind must be BookAnomalyKind")
        if (
            not isinstance(self.detail, str)
            or not self.detail
            or len(self.detail) > MAX_ANOMALY_DETAIL_LENGTH
        ):
            raise ContractValueError("anomaly detail must be bounded non-empty text")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bookKey": self.book_key,
            "detail": self.detail,
            "effect": "BOOK_ANOMALY",
            "engineStep": self.engine_step,
            "kind": self.kind.value,
            "processingTimeNs": self.processing_time_ns,
        }


@dataclass(frozen=True, slots=True)
class DeltaDispositionV1:
    engine_step: int
    book_key: str
    disposition: DeltaDisposition
    first_update_id: int
    final_update_id: int
    previous_final_update_id: int | None
    receive_ordinal: int
    inserted_levels: int
    replaced_levels: int
    removed_levels: int
    removed_absent_levels: int
    processing_time_ns: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "bookKey": self.book_key,
            "disposition": self.disposition.value,
            "effect": "DELTA_DISPOSITION",
            "engineStep": self.engine_step,
            "finalUpdateId": self.final_update_id,
            "firstUpdateId": self.first_update_id,
            "insertedLevels": self.inserted_levels,
            "previousFinalUpdateId": self.previous_final_update_id,
            "processingTimeNs": self.processing_time_ns,
            "receiveOrdinal": self.receive_ordinal,
            "removedAbsentLevels": self.removed_absent_levels,
            "removedLevels": self.removed_levels,
            "replacedLevels": self.replaced_levels,
        }


@dataclass(frozen=True, slots=True)
class SnapshotDispositionV1:
    engine_step: int
    book_key: str
    disposition: SnapshotDisposition
    intent_id: str
    last_update_id: int
    bid_levels: int
    ask_levels: int
    replayed_applied: int
    replayed_discarded: int
    processing_time_ns: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "askLevels": self.ask_levels,
            "bidLevels": self.bid_levels,
            "bookKey": self.book_key,
            "disposition": self.disposition.value,
            "effect": "SNAPSHOT_DISPOSITION",
            "engineStep": self.engine_step,
            "intentId": self.intent_id,
            "lastUpdateId": self.last_update_id,
            "processingTimeNs": self.processing_time_ns,
            "replayedApplied": self.replayed_applied,
            "replayedDiscarded": self.replayed_discarded,
        }


BookEffect = (
    QualityTransitionV1
    | SnapshotRequestIntentV1
    | BookAnomalyV1
    | DeltaDispositionV1
    | SnapshotDispositionV1
)


@dataclass(frozen=True, slots=True)
class BookViewV1:
    book_key: str
    symbol: str
    product: ForwardProduct
    lifecycle: BookLifecycleState
    quality: QualityState
    model_eligible: bool
    book_update_id: int | None
    engine_step: int
    buffered_deltas: int
    bids: tuple[PriceLevelUpdateV1, ...]
    asks: tuple[PriceLevelUpdateV1, ...]
    counters: tuple[tuple[str, int], ...]

    def as_mapping(self) -> dict[str, object]:
        return {
            "asks": [update.as_mapping() for update in self.asks],
            "bids": [update.as_mapping() for update in self.bids],
            "bookKey": self.book_key,
            "bookUpdateId": self.book_update_id,
            "bufferedDeltas": self.buffered_deltas,
            "counters": dict(self.counters),
            "engineStep": self.engine_step,
            "lifecycle": self.lifecycle.value,
            "modelEligible": self.model_eligible,
            "product": self.product.value,
            "quality": self.quality.value,
            "symbol": self.symbol,
        }


_ANOMALY_REASON_CODES: Final[dict[BookAnomalyKind, str]] = {
    BookAnomalyKind.FORWARD_GAP: "SEQUENCE_GAP",
    BookAnomalyKind.PU_MISMATCH: "SEQUENCE_GAP",
    BookAnomalyKind.SNAPSHOT_BRIDGE_GAP: "SNAPSHOT_BRIDGE_GAP",
    BookAnomalyKind.STALE_SNAPSHOT: "STALE_SNAPSHOT",
    BookAnomalyKind.INVALID_SNAPSHOT: "INVALID_SNAPSHOT",
    BookAnomalyKind.RECONNECT: "CONNECTION_RESTART",
    BookAnomalyKind.BUFFER_OVERFLOW: "BUFFER_OVERFLOW",
    BookAnomalyKind.CROSSED_BOOK: "CROSSED_BOOK",
    BookAnomalyKind.BOOK_CAPACITY_EXCEEDED: "BOOK_CAPACITY_EXCEEDED",
}


class LocalBookEngine:
    """Deterministic fail-closed local book state machine over injected evidence.

    The engine owns no transport, clock, environment or randomness. Snapshot needs are
    expressed as :class:`SnapshotRequestIntentV1`; the caller supplies snapshots and
    deltas. A book is model-eligible only while ``SYNCED``/``COMPLETE``.
    """

    __slots__ = (
        "__asks",
        "__bids",
        "__book_update_id",
        "__buffer",
        "__config",
        "__counters",
        "__issued_intent_ids",
        "__last_processing_time_ns",
        "__lifecycle",
        "__outstanding_intent_id",
        "__quality",
        "__receive_state",
        "__request_sequence",
        "__step",
    )

    def __init__(self, config: BookEngineConfigV1) -> None:
        if not isinstance(config, BookEngineConfigV1):
            raise ContractValueError("config must be BookEngineConfigV1")
        self.__config = config
        self.__step = 0
        self.__lifecycle = BookLifecycleState.CREATED
        self.__quality = QualityState.UNKNOWN
        self.__bids = PriceLadder(BookSide.BID, capacity=config.max_levels_per_side)
        self.__asks = PriceLadder(BookSide.ASK, capacity=config.max_levels_per_side)
        self.__buffer: deque[BookDelta] = deque()
        self.__book_update_id: int | None = None
        self.__receive_state: tuple[str, int, int, int] | None = None
        self.__last_processing_time_ns: int | None = None
        self.__request_sequence = 0
        self.__outstanding_intent_id: str | None = None
        # Insertion-ordered and bounded: a very old superseded intent degrades to the
        # equally ignored UNMATCHED classification instead of growing memory forever.
        self.__issued_intent_ids: dict[str, None] = {}
        self.__counters: dict[str, int] = {
            "anomalies_total": 0,
            "applied_deltas": 0,
            "buffered_deltas_total": 0,
            "discarded_pre_snapshot": 0,
            "ignored_stale": 0,
            "intents_issued": 0,
            "quality_transitions": 0,
            "removed_absent_levels_total": 0,
            "resync_triggers": 0,
            "snapshots_applied": 0,
            "snapshots_ignored": 0,
            "snapshots_rejected": 0,
        }

    @property
    def config(self) -> BookEngineConfigV1:
        return self.__config

    # -- public deterministic inputs ------------------------------------------------

    def start(self, *, processing_time_ns: int) -> tuple[BookEffect, ...]:
        self.__begin_step(processing_time_ns)
        if self.__lifecycle is not BookLifecycleState.CREATED:
            raise ContractValueError("start() is valid exactly once")
        effects: list[BookEffect] = []
        self.__transition(
            effects,
            lifecycle=BookLifecycleState.AWAITING_SNAPSHOT,
            quality=QualityState.RECONSTRUCTING,
            reason_code="INITIAL_SYNC",
            processing_time_ns=processing_time_ns,
        )
        effects.append(self.__issue_intent("INITIAL_SYNC", processing_time_ns))
        return tuple(effects)

    def on_delta(self, delta: BookDelta, *, processing_time_ns: int) -> tuple[BookEffect, ...]:
        self.__begin_step(processing_time_ns)
        self.__require_started()
        self.__validate_delta_identity(delta)
        effects: list[BookEffect] = []
        if self.__observe_receive_clocks(delta, effects, processing_time_ns):
            # Reconnect handling already discarded state, buffered the delta and
            # issued a new intent.
            return tuple(effects)
        if self.__lifecycle is BookLifecycleState.AWAITING_SNAPSHOT:
            self.__buffer_delta(delta, effects, processing_time_ns)
            return tuple(effects)
        self.__replay_one(delta, effects, processing_time_ns)
        return tuple(effects)

    def on_snapshot(
        self,
        snapshot: BookSnapshot,
        *,
        processing_time_ns: int,
    ) -> tuple[BookEffect, ...]:
        self.__begin_step(processing_time_ns)
        self.__require_started()
        self.__validate_snapshot_identity(snapshot)
        effects: list[BookEffect] = []
        intent_id = snapshot.provenance.intent_id
        if self.__lifecycle is not BookLifecycleState.AWAITING_SNAPSHOT:
            self.__counters["snapshots_ignored"] += 1
            self.__record_anomaly(
                effects,
                BookAnomalyKind.UNSOLICITED_SNAPSHOT,
                "snapshot arrived without an outstanding request",
                processing_time_ns,
            )
            effects.append(
                self.__snapshot_record(
                    snapshot,
                    SnapshotDisposition.IGNORED_UNSOLICITED,
                    0,
                    0,
                    processing_time_ns,
                )
            )
            return tuple(effects)
        if intent_id != self.__outstanding_intent_id:
            self.__counters["snapshots_ignored"] += 1
            if intent_id in self.__issued_intent_ids:
                self.__record_anomaly(
                    effects,
                    BookAnomalyKind.SUPERSEDED_SNAPSHOT,
                    "snapshot answers a superseded request intent",
                    processing_time_ns,
                )
                disposition = SnapshotDisposition.IGNORED_SUPERSEDED
            else:
                self.__record_anomaly(
                    effects,
                    BookAnomalyKind.UNMATCHED_SNAPSHOT,
                    "snapshot answers an intent this engine never issued",
                    processing_time_ns,
                )
                disposition = SnapshotDisposition.IGNORED_UNMATCHED
            effects.append(self.__snapshot_record(snapshot, disposition, 0, 0, processing_time_ns))
            return tuple(effects)
        invalid_detail = self.__snapshot_invalid_detail(snapshot)
        if invalid_detail is not None:
            self.__reject_snapshot(
                snapshot,
                SnapshotDisposition.REJECTED_INVALID,
                BookAnomalyKind.INVALID_SNAPSHOT,
                invalid_detail,
                effects,
                processing_time_ns,
            )
            return tuple(effects)
        stale_detail = self.__snapshot_stale_detail(snapshot)
        if stale_detail is not None:
            self.__reject_snapshot(
                snapshot,
                SnapshotDisposition.REJECTED_STALE,
                BookAnomalyKind.STALE_SNAPSHOT,
                stale_detail,
                effects,
                processing_time_ns,
            )
            return tuple(effects)
        bridge_detail = self.__snapshot_bridge_gap_detail(snapshot)
        if bridge_detail is not None:
            self.__reject_snapshot(
                snapshot,
                SnapshotDisposition.REJECTED_BRIDGE_GAP,
                BookAnomalyKind.SNAPSHOT_BRIDGE_GAP,
                bridge_detail,
                effects,
                processing_time_ns,
            )
            return tuple(effects)
        self.__accept_snapshot(snapshot, effects, processing_time_ns)
        return tuple(effects)

    def view(self) -> BookViewV1:
        model_eligible = self.__lifecycle is BookLifecycleState.SYNCED
        return BookViewV1(
            book_key=self.__config.book_key,
            symbol=self.__config.symbol,
            product=self.__config.product,
            lifecycle=self.__lifecycle,
            quality=self.__quality,
            model_eligible=model_eligible,
            book_update_id=self.__book_update_id,
            engine_step=self.__step,
            buffered_deltas=len(self.__buffer),
            bids=self.__bids.canonical_levels() if model_eligible else (),
            asks=self.__asks.canonical_levels() if model_eligible else (),
            counters=tuple(sorted(self.__counters.items())),
        )

    # -- product law ----------------------------------------------------------------

    def __delta_action(
        self,
        delta: BookDelta,
    ) -> tuple[_DeltaAction | BookAnomalyKind, str]:
        """Classify one delta; a returned :class:`BookAnomalyKind` demands resync."""

        book_update_id = self.__book_update_id
        if book_update_id is None:
            raise ContractValueError("delta law requires an applied snapshot identity")
        bridged = self.__lifecycle is BookLifecycleState.SYNCED
        if isinstance(delta, SpotDepthDeltaV1):
            if bridged:
                if delta.final_update_id < book_update_id:
                    return (_DeltaAction.IGNORE_STALE, "")
            elif delta.final_update_id <= book_update_id:
                return (_DeltaAction.DISCARD_PRE_SNAPSHOT, "")
            if delta.first_update_id > book_update_id + 1:
                kind = (
                    BookAnomalyKind.FORWARD_GAP if bridged else BookAnomalyKind.SNAPSHOT_BRIDGE_GAP
                )
                return (
                    kind,
                    f"first_update_id {delta.first_update_id} exceeds "
                    f"book_update_id {book_update_id} + 1",
                )
            return (_DeltaAction.APPLY, "")
        if bridged:
            if delta.previous_final_update_id != book_update_id:
                return (
                    BookAnomalyKind.PU_MISMATCH,
                    f"previous_final_update_id {delta.previous_final_update_id} "
                    f"does not equal book_update_id {book_update_id}",
                )
            return (_DeltaAction.APPLY, "")
        if delta.final_update_id < book_update_id:
            return (_DeltaAction.DISCARD_PRE_SNAPSHOT, "")
        if delta.first_update_id > book_update_id:
            return (
                BookAnomalyKind.SNAPSHOT_BRIDGE_GAP,
                f"first_update_id {delta.first_update_id} exceeds "
                f"snapshot last_update_id {book_update_id}",
            )
        return (_DeltaAction.APPLY, "")

    def __snapshot_stale_detail(self, snapshot: BookSnapshot) -> str | None:
        if not isinstance(snapshot, SpotDepthSnapshotV1) or not self.__buffer:
            return None
        first_received = self.__buffer[0].first_update_id
        if snapshot.last_update_id < first_received:
            return (
                f"snapshot last_update_id {snapshot.last_update_id} precedes the first "
                f"buffered first_update_id {first_received}"
            )
        return None

    def __snapshot_bridge_gap_detail(self, snapshot: BookSnapshot) -> str | None:
        last_update_id = snapshot.last_update_id
        if isinstance(snapshot, SpotDepthSnapshotV1):
            for delta in self.__buffer:
                if delta.final_update_id <= last_update_id:
                    continue
                if delta.first_update_id > last_update_id + 1:
                    return (
                        f"first retained buffered first_update_id {delta.first_update_id} "
                        f"exceeds snapshot last_update_id {last_update_id} + 1"
                    )
                return None
            return None
        for delta in self.__buffer:
            if delta.final_update_id < last_update_id:
                continue
            if delta.first_update_id > last_update_id:
                return (
                    f"first retained buffered first_update_id {delta.first_update_id} "
                    f"exceeds snapshot last_update_id {last_update_id}"
                )
            return None
        return None

    def __snapshot_invalid_detail(self, snapshot: BookSnapshot) -> str | None:
        for side_name, side, levels in (
            ("bids", BookSide.BID, snapshot.bids),
            ("asks", BookSide.ASK, snapshot.asks),
        ):
            if len(levels) > self.__config.max_levels_per_side:
                return f"{side_name} exceed the configured ladder capacity"
            previous_aligned: int | None = None
            for level in levels:
                if level.quantity.is_zero:
                    return f"{side_name} contain a zero-quantity level"
                aligned = level.price.aligned
                if previous_aligned is not None:
                    ordered = (
                        aligned < previous_aligned
                        if side is BookSide.BID
                        else aligned > previous_aligned
                    )
                    if not ordered:
                        return f"{side_name} are not strictly best-first ordered"
                previous_aligned = aligned
        if snapshot.bids and snapshot.asks:
            best_bid = snapshot.bids[0].price.aligned
            best_ask = snapshot.asks[0].price.aligned
            if best_bid >= best_ask:
                return "snapshot sides are crossed or locked"
        return None

    # -- internal machinery -----------------------------------------------------------

    def __begin_step(self, processing_time_ns: int) -> None:
        require_strict_int(
            processing_time_ns,
            field="processing_time_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        last = self.__last_processing_time_ns
        if last is not None and processing_time_ns < last:
            raise ContractValueError("processing_time_ns must not regress")
        if self.__step >= INT64_MAX:
            raise ContractValueError("engine step counter exhausted")
        self.__last_processing_time_ns = processing_time_ns
        self.__step += 1

    def __require_started(self) -> None:
        if self.__lifecycle is BookLifecycleState.CREATED:
            raise ContractValueError("start() must run before evidence is offered")

    def __validate_delta_identity(self, delta: BookDelta) -> None:
        if self.__config.product is ForwardProduct.SPOT:
            if not isinstance(delta, SpotDepthDeltaV1):
                raise ContractValueError("a Spot engine accepts only SpotDepthDeltaV1")
        elif not isinstance(delta, UsdMDepthDeltaV1):
            raise ContractValueError("a USD-M engine accepts only UsdMDepthDeltaV1")
        if delta.symbol != self.__config.symbol:
            raise ContractValueError("delta symbol does not match the engine symbol")
        if delta.posture is not self.__config.expected_posture:
            raise ContractValueError("delta posture does not match the engine posture")

    def __validate_snapshot_identity(self, snapshot: BookSnapshot) -> None:
        if self.__config.product is ForwardProduct.SPOT:
            if not isinstance(snapshot, SpotDepthSnapshotV1):
                raise ContractValueError("a Spot engine accepts only SpotDepthSnapshotV1")
        elif not isinstance(snapshot, UsdMDepthSnapshotV1):
            raise ContractValueError("a USD-M engine accepts only UsdMDepthSnapshotV1")
        if snapshot.symbol != self.__config.symbol:
            raise ContractValueError("snapshot symbol does not match the engine symbol")
        if snapshot.provenance.posture is not self.__config.expected_posture:
            raise ContractValueError("snapshot posture does not match the engine posture")

    def __observe_receive_clocks(
        self,
        delta: BookDelta,
        effects: list[BookEffect],
        processing_time_ns: int,
    ) -> bool:
        receive = delta.receive
        incoming = (
            receive.session_id,
            receive.connection_generation,
            receive.receive_ordinal,
            receive.receive_monotonic_ns,
        )
        current = self.__receive_state
        if current is None:
            self.__receive_state = incoming
            return False
        session_id, generation, last_ordinal, last_monotonic = current
        if (receive.session_id, receive.connection_generation) == (session_id, generation):
            if receive.receive_ordinal <= last_ordinal:
                raise ContractValueError(
                    "receive_ordinal must strictly increase within one connection"
                )
            if receive.receive_monotonic_ns < last_monotonic:
                raise ContractValueError(
                    "receive_monotonic_ns must not regress within one connection"
                )
            self.__receive_state = incoming
            return False
        if receive.session_id == session_id and receive.connection_generation < generation:
            raise ContractValueError("connection_generation must not regress in one session")
        self.__record_anomaly(
            effects,
            BookAnomalyKind.RECONNECT,
            "connection identity changed; local book evidence is no longer continuous",
            processing_time_ns,
        )
        self.__abandon_book(effects, BookAnomalyKind.RECONNECT, processing_time_ns)
        self.__buffer.clear()
        self.__receive_state = incoming
        reconnect_reason = _ANOMALY_REASON_CODES[BookAnomalyKind.RECONNECT]
        effects.append(self.__issue_intent(reconnect_reason, processing_time_ns))
        self.__buffer_delta(delta, effects, processing_time_ns)
        return True

    def __buffer_delta(
        self,
        delta: BookDelta,
        effects: list[BookEffect],
        processing_time_ns: int,
    ) -> None:
        if len(self.__buffer) >= self.__config.max_buffered_deltas:
            self.__record_anomaly(
                effects,
                BookAnomalyKind.BUFFER_OVERFLOW,
                "the bounded sync buffer is full; restarting synchronization",
                processing_time_ns,
            )
            self.__buffer.clear()
            effects.append(
                self.__issue_intent(
                    _ANOMALY_REASON_CODES[BookAnomalyKind.BUFFER_OVERFLOW],
                    processing_time_ns,
                )
            )
        self.__buffer.append(delta)
        self.__counters["buffered_deltas_total"] += 1
        effects.append(
            self.__delta_record(delta, DeltaDisposition.BUFFERED, None, processing_time_ns)
        )

    def __apply_delta(
        self,
        delta: BookDelta,
    ) -> tuple[tuple[int, int, int, int], tuple[BookAnomalyKind, str] | None]:
        inserted = replaced = removed = removed_absent = 0
        for ladder, updates in ((self.__bids, delta.bids), (self.__asks, delta.asks)):
            for update in updates:
                outcome = ladder.apply(update)
                if outcome is LadderUpdateOutcome.CAPACITY_EXCEEDED:
                    return (
                        (inserted, replaced, removed, removed_absent),
                        (
                            BookAnomalyKind.BOOK_CAPACITY_EXCEEDED,
                            "a level insert exceeded the configured ladder capacity",
                        ),
                    )
                if outcome is LadderUpdateOutcome.INSERTED:
                    inserted += 1
                elif outcome is LadderUpdateOutcome.REPLACED:
                    replaced += 1
                elif outcome is LadderUpdateOutcome.REMOVED:
                    removed += 1
                else:
                    removed_absent += 1
        best_bid = self.__bids.best_price_aligned()
        best_ask = self.__asks.best_price_aligned()
        if best_bid is not None and best_ask is not None and best_bid >= best_ask:
            return (
                (inserted, replaced, removed, removed_absent),
                (
                    BookAnomalyKind.CROSSED_BOOK,
                    "applying the event crossed or locked the local book",
                ),
            )
        return ((inserted, replaced, removed, removed_absent), None)

    def __resync(
        self,
        trigger: BookDelta,
        kind: BookAnomalyKind,
        detail: str,
        effects: list[BookEffect],
        processing_time_ns: int,
    ) -> None:
        self.__counters["resync_triggers"] += 1
        self.__record_anomaly(effects, kind, detail, processing_time_ns)
        self.__abandon_book(effects, kind, processing_time_ns)
        effects.append(self.__issue_intent(_ANOMALY_REASON_CODES[kind], processing_time_ns))
        effects.append(
            self.__delta_record(trigger, DeltaDisposition.RESYNC_TRIGGER, None, processing_time_ns)
        )
        self.__buffer.append(trigger)
        self.__counters["buffered_deltas_total"] += 1

    def __abandon_book(
        self,
        effects: list[BookEffect],
        kind: BookAnomalyKind,
        processing_time_ns: int,
    ) -> None:
        if self.__lifecycle is BookLifecycleState.SYNCED:
            self.__transition(
                effects,
                lifecycle=BookLifecycleState.AWAITING_SNAPSHOT,
                quality=QualityState.GAPPED,
                reason_code=_ANOMALY_REASON_CODES[kind],
                processing_time_ns=processing_time_ns,
            )
            self.__transition(
                effects,
                lifecycle=BookLifecycleState.AWAITING_SNAPSHOT,
                quality=QualityState.RECONSTRUCTING,
                reason_code="RESYNCHRONIZATION_STARTED",
                processing_time_ns=processing_time_ns,
            )
        elif self.__lifecycle is BookLifecycleState.SNAPSHOT_APPLIED:
            self.__transition(
                effects,
                lifecycle=BookLifecycleState.AWAITING_SNAPSHOT,
                quality=QualityState.RECONSTRUCTING,
                reason_code=_ANOMALY_REASON_CODES[kind],
                processing_time_ns=processing_time_ns,
            )
        self.__bids.clear()
        self.__asks.clear()
        self.__book_update_id = None
        self.__lifecycle = BookLifecycleState.AWAITING_SNAPSHOT

    def __reject_snapshot(
        self,
        snapshot: BookSnapshot,
        disposition: SnapshotDisposition,
        kind: BookAnomalyKind,
        detail: str,
        effects: list[BookEffect],
        processing_time_ns: int,
    ) -> None:
        self.__counters["snapshots_rejected"] += 1
        self.__record_anomaly(effects, kind, detail, processing_time_ns)
        effects.append(self.__snapshot_record(snapshot, disposition, 0, 0, processing_time_ns))
        effects.append(self.__issue_intent(_ANOMALY_REASON_CODES[kind], processing_time_ns))

    def __accept_snapshot(
        self,
        snapshot: BookSnapshot,
        effects: list[BookEffect],
        processing_time_ns: int,
    ) -> None:
        self.__outstanding_intent_id = None
        self.__bids.clear()
        self.__asks.clear()
        for ladder, levels in ((self.__bids, snapshot.bids), (self.__asks, snapshot.asks)):
            for level in levels:
                ladder.apply(level)
        self.__book_update_id = snapshot.last_update_id
        self.__counters["snapshots_applied"] += 1
        self.__transition(
            effects,
            lifecycle=BookLifecycleState.SNAPSHOT_APPLIED,
            quality=QualityState.RECONSTRUCTING,
            reason_code="SNAPSHOT_ACCEPTED",
            processing_time_ns=processing_time_ns,
        )
        pending = tuple(self.__buffer)
        self.__buffer.clear()
        replayed_applied = 0
        replayed_discarded = 0
        resync_started = False
        for delta in pending:
            if resync_started:
                self.__buffer.append(delta)
                self.__counters["buffered_deltas_total"] += 1
                effects.append(
                    self.__delta_record(delta, DeltaDisposition.BUFFERED, None, processing_time_ns)
                )
                continue
            record = self.__replay_one(delta, effects, processing_time_ns)
            if record is None:
                resync_started = True
                continue
            if record.disposition is DeltaDisposition.APPLIED:
                replayed_applied += 1
            else:
                replayed_discarded += 1
        effects.append(
            self.__snapshot_record(
                snapshot,
                SnapshotDisposition.APPLIED,
                replayed_applied,
                replayed_discarded,
                processing_time_ns,
            )
        )

    def __replay_one(
        self,
        delta: BookDelta,
        effects: list[BookEffect],
        processing_time_ns: int,
    ) -> DeltaDispositionV1 | None:
        """Process one live or replayed delta; None means it triggered a resynchronization."""

        action, detail = self.__delta_action(delta)
        if isinstance(action, BookAnomalyKind):
            self.__resync(delta, action, detail, effects, processing_time_ns)
            return None
        if action is _DeltaAction.DISCARD_PRE_SNAPSHOT:
            self.__counters["discarded_pre_snapshot"] += 1
            record = self.__delta_record(
                delta,
                DeltaDisposition.DISCARDED_PRE_SNAPSHOT,
                None,
                processing_time_ns,
            )
            effects.append(record)
            return record
        if action is _DeltaAction.IGNORE_STALE:
            self.__counters["ignored_stale"] += 1
            record = self.__delta_record(
                delta,
                DeltaDisposition.IGNORED_STALE,
                None,
                processing_time_ns,
            )
            effects.append(record)
            return record
        outcome_counts, failure = self.__apply_delta(delta)
        if failure is not None:
            self.__resync(delta, failure[0], failure[1], effects, processing_time_ns)
            return None
        self.__book_update_id = delta.final_update_id
        self.__counters["applied_deltas"] += 1
        self.__counters["removed_absent_levels_total"] += outcome_counts[3]
        record = self.__delta_record(
            delta,
            DeltaDisposition.APPLIED,
            outcome_counts,
            processing_time_ns,
        )
        effects.append(record)
        if self.__lifecycle is BookLifecycleState.SNAPSHOT_APPLIED:
            self.__transition(
                effects,
                lifecycle=BookLifecycleState.SYNCED,
                quality=QualityState.COMPLETE,
                reason_code="SYNC_VALIDATED",
                processing_time_ns=processing_time_ns,
            )
        return record

    def __transition(
        self,
        effects: list[BookEffect],
        *,
        lifecycle: BookLifecycleState,
        quality: QualityState,
        reason_code: str,
        processing_time_ns: int,
    ) -> None:
        # Callers only announce real changes; a same-state call would be a defect, not
        # a case to silently absorb.
        effects.append(
            QualityTransitionV1(
                engine_step=self.__step,
                book_key=self.__config.book_key,
                from_quality=self.__quality,
                to_quality=quality,
                from_lifecycle=self.__lifecycle,
                to_lifecycle=lifecycle,
                reason_code=reason_code,
                book_update_id=self.__book_update_id,
                processing_time_ns=processing_time_ns,
            )
        )
        self.__counters["quality_transitions"] += 1
        self.__lifecycle = lifecycle
        self.__quality = quality

    def __issue_intent(self, reason_code: str, processing_time_ns: int) -> SnapshotRequestIntentV1:
        self.__request_sequence += 1
        identity = {
            "bookKey": self.__config.book_key,
            "engineStep": self.__step,
            "reasonCode": reason_code,
            "requestSequence": self.__request_sequence,
            "schema": "Q04SnapshotRequestIntentIdentityV1",
            "version": 1,
        }
        intent_id = f"q04intent:{hashlib.sha256(canonical_json_bytes(identity)).hexdigest()}"
        self.__outstanding_intent_id = intent_id
        self.__issued_intent_ids[intent_id] = None
        while len(self.__issued_intent_ids) > MAX_RETAINED_INTENT_IDS:
            oldest = next(iter(self.__issued_intent_ids))
            del self.__issued_intent_ids[oldest]
        self.__counters["intents_issued"] += 1
        return SnapshotRequestIntentV1(
            intent_id=intent_id,
            book_key=self.__config.book_key,
            symbol=self.__config.symbol,
            product=self.__config.product,
            engine_step=self.__step,
            request_sequence=self.__request_sequence,
            reason_code=reason_code,
            processing_time_ns=processing_time_ns,
        )

    def __record_anomaly(
        self,
        effects: list[BookEffect],
        kind: BookAnomalyKind,
        detail: str,
        processing_time_ns: int,
    ) -> None:
        self.__counters["anomalies_total"] += 1
        effects.append(
            BookAnomalyV1(
                engine_step=self.__step,
                book_key=self.__config.book_key,
                kind=kind,
                detail=detail,
                processing_time_ns=processing_time_ns,
            )
        )

    def __delta_record(
        self,
        delta: BookDelta,
        disposition: DeltaDisposition,
        outcome_counts: tuple[int, int, int, int] | None,
        processing_time_ns: int,
    ) -> DeltaDispositionV1:
        inserted, replaced, removed, removed_absent = outcome_counts or (0, 0, 0, 0)
        previous = delta.previous_final_update_id if isinstance(delta, UsdMDepthDeltaV1) else None
        return DeltaDispositionV1(
            engine_step=self.__step,
            book_key=self.__config.book_key,
            disposition=disposition,
            first_update_id=delta.first_update_id,
            final_update_id=delta.final_update_id,
            previous_final_update_id=previous,
            receive_ordinal=delta.receive.receive_ordinal,
            inserted_levels=inserted,
            replaced_levels=replaced,
            removed_levels=removed,
            removed_absent_levels=removed_absent,
            processing_time_ns=processing_time_ns,
        )

    def __snapshot_record(
        self,
        snapshot: BookSnapshot,
        disposition: SnapshotDisposition,
        replayed_applied: int,
        replayed_discarded: int,
        processing_time_ns: int,
    ) -> SnapshotDispositionV1:
        return SnapshotDispositionV1(
            engine_step=self.__step,
            book_key=self.__config.book_key,
            disposition=disposition,
            intent_id=snapshot.provenance.intent_id,
            last_update_id=snapshot.last_update_id,
            bid_levels=len(snapshot.bids),
            ask_levels=len(snapshot.asks),
            replayed_applied=replayed_applied,
            replayed_discarded=replayed_discarded,
            processing_time_ns=processing_time_ns,
        )


def spot_book_engine(
    symbol: str,
    *,
    expected_posture: EvidencePosture,
    max_levels_per_side: int,
    max_buffered_deltas: int,
) -> LocalBookEngine:
    return LocalBookEngine(
        BookEngineConfigV1(
            product=ForwardProduct.SPOT,
            symbol=symbol,
            expected_posture=expected_posture,
            max_levels_per_side=max_levels_per_side,
            max_buffered_deltas=max_buffered_deltas,
        )
    )


def usd_m_book_engine(
    symbol: str,
    *,
    expected_posture: EvidencePosture,
    max_levels_per_side: int,
    max_buffered_deltas: int,
) -> LocalBookEngine:
    return LocalBookEngine(
        BookEngineConfigV1(
            product=ForwardProduct.USD_M_PERPETUAL,
            symbol=symbol,
            expected_posture=expected_posture,
            max_levels_per_side=max_levels_per_side,
            max_buffered_deltas=max_buffered_deltas,
        )
    )
