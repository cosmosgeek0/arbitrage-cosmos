from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.book.levels import PriceLevelUpdateV1
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    UINT64_MAX,
    EvidencePosture,
    require_contract_id,
    require_strict_int,
)
from quant_edge.primitives import require_utc_millis

MAX_UPDATES_PER_DELTA: Final = 10_000
MAX_SPOT_SNAPSHOT_LEVELS_PER_SIDE: Final = 5_000
MAX_USD_M_SNAPSHOT_LEVELS_PER_SIDE: Final = 1_000
MAX_STREAM_ID_LENGTH: Final = 2_048

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


def _require_stream_id(value: object, *, field: str) -> str:
    """Stream names carry ``@`` separators, so they are bounded text, not contract ids."""

    if not isinstance(value, str) or not value or len(value) > MAX_STREAM_ID_LENGTH:
        raise ContractValueError(
            f"{field} must be non-empty text of at most {MAX_STREAM_ID_LENGTH} characters"
        )
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ContractValueError(f"{field} must be valid UTF-8 text") from error
    return value


def _require_update_id(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=0, maximum=UINT64_MAX)


def _require_posture(value: object, *, field: str) -> EvidencePosture:
    if not isinstance(value, EvidencePosture) or value not in _ALLOWED_POSTURES:
        raise ContractValueError(
            f"{field} must be SYNTHETIC or REPLAY; Q04 owns no live market evidence"
        )
    return value


def _require_level_updates(
    value: object,
    *,
    field: str,
    maximum: int,
) -> tuple[PriceLevelUpdateV1, ...]:
    if not isinstance(value, tuple) or len(value) > maximum:
        raise ContractValueError(f"{field} must be a tuple of at most {maximum} level updates")
    seen: set[tuple[int, int]] = set()
    for index, update in enumerate(value):
        if not isinstance(update, PriceLevelUpdateV1):
            raise ContractValueError(f"{field}[{index}] must be PriceLevelUpdateV1")
        key = update.price.numeric_key
        if key in seen:
            raise ContractValueError(f"{field}[{index}] repeats a price inside one message")
        seen.add(key)
    return value


@dataclass(frozen=True, slots=True)
class ReceiveClocksV1:
    """Injected local receive truth; the engine never reads an ambient clock."""

    session_id: str
    stream_id: str
    connection_generation: int
    receive_ordinal: int
    receive_wall_time_ms: int
    receive_monotonic_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.session_id, field="session_id")
        _require_stream_id(self.stream_id, field="stream_id")
        require_strict_int(
            self.connection_generation,
            field="connection_generation",
            minimum=0,
            maximum=INT64_MAX,
        )
        require_strict_int(
            self.receive_ordinal,
            field="receive_ordinal",
            minimum=0,
            maximum=INT64_MAX,
        )
        require_utc_millis(self.receive_wall_time_ms, field="receive_wall_time_ms")
        require_strict_int(
            self.receive_monotonic_ns,
            field="receive_monotonic_ns",
            minimum=0,
            maximum=INT64_MAX,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "connectionGeneration": self.connection_generation,
            "receiveMonotonicNs": self.receive_monotonic_ns,
            "receiveOrdinal": self.receive_ordinal,
            "receiveWallTimeMs": self.receive_wall_time_ms,
            "sessionId": self.session_id,
            "streamId": self.stream_id,
        }


@dataclass(frozen=True, slots=True)
class SpotDepthDeltaV1:
    """Spot diff-depth event: ``E`` plus ``U``/``u``; Spot has no transaction time."""

    symbol: str
    event_time_ms: int
    first_update_id: int
    final_update_id: int
    bids: tuple[PriceLevelUpdateV1, ...]
    asks: tuple[PriceLevelUpdateV1, ...]
    receive: ReceiveClocksV1
    posture: EvidencePosture

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        require_utc_millis(self.event_time_ms, field="event_time_ms")
        first = _require_update_id(self.first_update_id, field="first_update_id")
        last = _require_update_id(self.final_update_id, field="final_update_id")
        if first > last:
            raise ContractValueError("first_update_id must not exceed final_update_id")
        _require_level_updates(self.bids, field="bids", maximum=MAX_UPDATES_PER_DELTA)
        _require_level_updates(self.asks, field="asks", maximum=MAX_UPDATES_PER_DELTA)
        if not isinstance(self.receive, ReceiveClocksV1):
            raise ContractValueError("receive must be ReceiveClocksV1")
        _require_posture(self.posture, field="posture")

    @property
    def product(self) -> ForwardProduct:
        return ForwardProduct.SPOT

    def as_mapping(self) -> dict[str, object]:
        return {
            "asks": [update.as_mapping() for update in self.asks],
            "bids": [update.as_mapping() for update in self.bids],
            "eventTimeMs": self.event_time_ms,
            "finalUpdateId": self.final_update_id,
            "firstUpdateId": self.first_update_id,
            "posture": self.posture.value,
            "product": self.product.value,
            "receive": self.receive.as_mapping(),
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class UsdMDepthDeltaV1:
    """USD-M diff-depth event: ``E``/``T`` plus ``U``/``u``/``pu``."""

    symbol: str
    event_time_ms: int
    transaction_time_ms: int
    first_update_id: int
    final_update_id: int
    previous_final_update_id: int
    bids: tuple[PriceLevelUpdateV1, ...]
    asks: tuple[PriceLevelUpdateV1, ...]
    receive: ReceiveClocksV1
    posture: EvidencePosture

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        require_utc_millis(self.event_time_ms, field="event_time_ms")
        require_utc_millis(self.transaction_time_ms, field="transaction_time_ms")
        first = _require_update_id(self.first_update_id, field="first_update_id")
        last = _require_update_id(self.final_update_id, field="final_update_id")
        if first > last:
            raise ContractValueError("first_update_id must not exceed final_update_id")
        _require_update_id(self.previous_final_update_id, field="previous_final_update_id")
        _require_level_updates(self.bids, field="bids", maximum=MAX_UPDATES_PER_DELTA)
        _require_level_updates(self.asks, field="asks", maximum=MAX_UPDATES_PER_DELTA)
        if not isinstance(self.receive, ReceiveClocksV1):
            raise ContractValueError("receive must be ReceiveClocksV1")
        _require_posture(self.posture, field="posture")

    @property
    def product(self) -> ForwardProduct:
        return ForwardProduct.USD_M_PERPETUAL

    def as_mapping(self) -> dict[str, object]:
        return {
            "asks": [update.as_mapping() for update in self.asks],
            "bids": [update.as_mapping() for update in self.bids],
            "eventTimeMs": self.event_time_ms,
            "finalUpdateId": self.final_update_id,
            "firstUpdateId": self.first_update_id,
            "posture": self.posture.value,
            "previousFinalUpdateId": self.previous_final_update_id,
            "product": self.product.value,
            "receive": self.receive.as_mapping(),
            "symbol": self.symbol,
            "transactionTimeMs": self.transaction_time_ms,
        }


BookDelta = SpotDepthDeltaV1 | UsdMDepthDeltaV1


@dataclass(frozen=True, slots=True)
class SnapshotProvenanceV1:
    """Which request intent a snapshot answers, plus injected acquisition clocks."""

    intent_id: str
    acquired_wall_time_ms: int
    acquired_monotonic_ns: int
    posture: EvidencePosture

    def __post_init__(self) -> None:
        require_contract_id(self.intent_id, field="intent_id")
        require_utc_millis(self.acquired_wall_time_ms, field="acquired_wall_time_ms")
        require_strict_int(
            self.acquired_monotonic_ns,
            field="acquired_monotonic_ns",
            minimum=0,
            maximum=INT64_MAX,
        )
        _require_posture(self.posture, field="posture")

    def as_mapping(self) -> dict[str, object]:
        return {
            "acquiredMonotonicNs": self.acquired_monotonic_ns,
            "acquiredWallTimeMs": self.acquired_wall_time_ms,
            "intentId": self.intent_id,
            "posture": self.posture.value,
        }


@dataclass(frozen=True, slots=True)
class SpotDepthSnapshotV1:
    """Spot REST depth snapshot: ``lastUpdateId`` only; Spot exposes no snapshot clock.

    Construction validates shape and bounds only; book-semantic validity (ordering,
    positive quantities, uncrossed sides) is judged by the engine so corrupt snapshots
    remain representable for fail-closed campaigns.
    """

    symbol: str
    last_update_id: int
    bids: tuple[PriceLevelUpdateV1, ...]
    asks: tuple[PriceLevelUpdateV1, ...]
    provenance: SnapshotProvenanceV1

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        _require_update_id(self.last_update_id, field="last_update_id")
        _require_level_updates(
            self.bids,
            field="bids",
            maximum=MAX_SPOT_SNAPSHOT_LEVELS_PER_SIDE,
        )
        _require_level_updates(
            self.asks,
            field="asks",
            maximum=MAX_SPOT_SNAPSHOT_LEVELS_PER_SIDE,
        )
        if not isinstance(self.provenance, SnapshotProvenanceV1):
            raise ContractValueError("provenance must be SnapshotProvenanceV1")

    @property
    def product(self) -> ForwardProduct:
        return ForwardProduct.SPOT

    def as_mapping(self) -> dict[str, object]:
        return {
            "asks": [update.as_mapping() for update in self.asks],
            "bids": [update.as_mapping() for update in self.bids],
            "lastUpdateId": self.last_update_id,
            "product": self.product.value,
            "provenance": self.provenance.as_mapping(),
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class UsdMDepthSnapshotV1:
    """USD-M REST depth snapshot: ``lastUpdateId`` plus exchange ``E``/``T`` clocks."""

    symbol: str
    last_update_id: int
    message_output_time_ms: int
    transaction_time_ms: int
    bids: tuple[PriceLevelUpdateV1, ...]
    asks: tuple[PriceLevelUpdateV1, ...]
    provenance: SnapshotProvenanceV1

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        _require_update_id(self.last_update_id, field="last_update_id")
        require_utc_millis(self.message_output_time_ms, field="message_output_time_ms")
        require_utc_millis(self.transaction_time_ms, field="transaction_time_ms")
        _require_level_updates(
            self.bids,
            field="bids",
            maximum=MAX_USD_M_SNAPSHOT_LEVELS_PER_SIDE,
        )
        _require_level_updates(
            self.asks,
            field="asks",
            maximum=MAX_USD_M_SNAPSHOT_LEVELS_PER_SIDE,
        )
        if not isinstance(self.provenance, SnapshotProvenanceV1):
            raise ContractValueError("provenance must be SnapshotProvenanceV1")

    @property
    def product(self) -> ForwardProduct:
        return ForwardProduct.USD_M_PERPETUAL

    def as_mapping(self) -> dict[str, object]:
        return {
            "asks": [update.as_mapping() for update in self.asks],
            "bids": [update.as_mapping() for update in self.bids],
            "lastUpdateId": self.last_update_id,
            "messageOutputTimeMs": self.message_output_time_ms,
            "product": self.product.value,
            "provenance": self.provenance.as_mapping(),
            "symbol": self.symbol,
            "transactionTimeMs": self.transaction_time_ms,
        }


BookSnapshot = SpotDepthSnapshotV1 | UsdMDepthSnapshotV1
