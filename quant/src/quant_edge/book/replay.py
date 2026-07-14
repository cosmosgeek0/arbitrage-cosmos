from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.book.engine import (
    BookEffect,
    BookEngineConfigV1,
    BookViewV1,
    LocalBookEngine,
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
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, EvidencePosture

REPLAY_SCRIPT_SCHEMA: Final = "Q04ReplayScriptV1"
REPLAY_RESULT_SCHEMA: Final = "Q04ReplayResultV1"
MAX_REPLAY_STEPS: Final = 100_000


class ReplayStepKind(StrEnum):
    START = "START"
    DELTA = "DELTA"
    SNAPSHOT = "SNAPSHOT"


@dataclass(frozen=True, slots=True)
class ReplayStepV1:
    kind: ReplayStepKind
    processing_time_ns: int
    delta: BookDelta | None = None
    snapshot: BookSnapshot | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, ReplayStepKind):
            raise ContractValueError("step kind must be ReplayStepKind")
        if isinstance(self.processing_time_ns, bool) or not isinstance(
            self.processing_time_ns, int
        ):
            raise ContractValueError("processing_time_ns must be an integer")
        has_delta = self.delta is not None
        has_snapshot = self.snapshot is not None
        if self.kind is ReplayStepKind.START:
            if has_delta or has_snapshot:
                raise ContractValueError("START steps carry no payload")
        elif self.kind is ReplayStepKind.DELTA:
            if not isinstance(self.delta, SpotDepthDeltaV1 | UsdMDepthDeltaV1) or has_snapshot:
                raise ContractValueError("DELTA steps carry exactly one delta payload")
        elif not isinstance(self.snapshot, SpotDepthSnapshotV1 | UsdMDepthSnapshotV1) or has_delta:
            raise ContractValueError("SNAPSHOT steps carry exactly one snapshot payload")

    def as_mapping(self) -> dict[str, object]:
        mapping: dict[str, object] = {
            "kind": self.kind.value,
            "processingTimeNs": self.processing_time_ns,
        }
        if self.delta is not None:
            mapping["delta"] = self.delta.as_mapping()
        if self.snapshot is not None:
            mapping["snapshot"] = self.snapshot.as_mapping()
        return mapping


@dataclass(frozen=True, slots=True)
class ReplayScriptV1:
    engine_config: BookEngineConfigV1
    steps: tuple[ReplayStepV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.engine_config, BookEngineConfigV1):
            raise ContractValueError("engine_config must be BookEngineConfigV1")
        if (
            not isinstance(self.steps, tuple)
            or not self.steps
            or len(self.steps) > MAX_REPLAY_STEPS
        ):
            raise ContractValueError(f"steps must be a tuple of 1..{MAX_REPLAY_STEPS} replay steps")
        for index, step in enumerate(self.steps):
            if not isinstance(step, ReplayStepV1):
                raise ContractValueError(f"steps[{index}] must be ReplayStepV1")
        if self.steps[0].kind is not ReplayStepKind.START:
            raise ContractValueError("the first replay step must be START")

    def as_mapping(self) -> dict[str, object]:
        return {
            "engine": self.engine_config.as_mapping(),
            "schema": REPLAY_SCRIPT_SCHEMA,
            "steps": [step.as_mapping() for step in self.steps],
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def script_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


@dataclass(frozen=True, slots=True)
class ReplayResultV1:
    script_digest: DigestV1
    engine_config: BookEngineConfigV1
    effects: tuple[BookEffect, ...]
    final_view: BookViewV1

    def as_mapping(self) -> dict[str, object]:
        return {
            "effects": [effect.as_mapping() for effect in self.effects],
            "engine": self.engine_config.as_mapping(),
            "finalView": self.final_view.as_mapping(),
            "schema": REPLAY_RESULT_SCHEMA,
            "scriptSha256": self.script_digest.hexdigest,
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def result_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


def run_replay(script: ReplayScriptV1) -> ReplayResultV1:
    """Execute a replay script deterministically; identical scripts yield identical bytes."""

    if not isinstance(script, ReplayScriptV1):
        raise ContractValueError("script must be ReplayScriptV1")
    engine = LocalBookEngine(script.engine_config)
    effects: list[BookEffect] = []
    for step in script.steps:
        # The step contract binds kind to payload: START carries none, DELTA exactly a
        # delta and SNAPSHOT exactly a snapshot.
        delta = step.delta
        snapshot = step.snapshot
        if delta is not None:
            effects.extend(engine.on_delta(delta, processing_time_ns=step.processing_time_ns))
        elif snapshot is not None:
            effects.extend(engine.on_snapshot(snapshot, processing_time_ns=step.processing_time_ns))
        else:
            effects.extend(engine.start(processing_time_ns=step.processing_time_ns))
    return ReplayResultV1(
        script_digest=script.script_digest,
        engine_config=script.engine_config,
        effects=tuple(effects),
        final_view=engine.view(),
    )


# -- strict mapping parsers ----------------------------------------------------------


def _require_mapping(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ContractValueError(f"{field} must be a JSON object")
    return value


def _require_exact_keys(
    mapping: dict[str, object],
    *,
    field: str,
    keys: frozenset[str],
) -> None:
    observed = set(mapping)
    if observed != keys:
        missing = ",".join(sorted(keys - observed)) or "-"
        unexpected = ",".join(sorted(observed - keys)) or "-"
        raise ContractValueError(
            f"{field} keys are not exact: missing={missing} unexpected={unexpected}"
        )


def _get_int(mapping: dict[str, object], key: str, *, field: str) -> int:
    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError(f"{field}.{key} must be an integer")
    return value


def _get_str(mapping: dict[str, object], key: str, *, field: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise ContractValueError(f"{field}.{key} must be a string")
    return value


def _parse_levels(
    value: object,
    *,
    field: str,
) -> tuple[PriceLevelUpdateV1, ...]:
    if not isinstance(value, list):
        raise ContractValueError(f"{field} must be a JSON array")
    updates: list[PriceLevelUpdateV1] = []
    for index, entry in enumerate(value):
        entry_field = f"{field}[{index}]"
        mapping = _require_mapping(entry, field=entry_field)
        _require_exact_keys(mapping, field=entry_field, keys=frozenset({"price", "quantity"}))
        updates.append(
            parse_price_level_update(
                mapping["price"],
                mapping["quantity"],
                field=entry_field,
            )
        )
    return tuple(updates)


def _parse_posture(value: str, *, field: str) -> EvidencePosture:
    for posture in (EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY):
        if value == posture.value:
            return posture
    raise ContractValueError(f"{field} must be SYNTHETIC or REPLAY")


def _parse_product(value: str, *, field: str) -> ForwardProduct:
    for product in ForwardProduct:
        if value == product.value:
            return product
    raise ContractValueError(f"{field} must be an explicit ForwardProduct")


_RECEIVE_KEYS: Final = frozenset(
    {
        "connectionGeneration",
        "receiveMonotonicNs",
        "receiveOrdinal",
        "receiveWallTimeMs",
        "sessionId",
        "streamId",
    }
)


def _parse_receive(value: object, *, field: str) -> ReceiveClocksV1:
    mapping = _require_mapping(value, field=field)
    _require_exact_keys(mapping, field=field, keys=_RECEIVE_KEYS)
    return ReceiveClocksV1(
        session_id=_get_str(mapping, "sessionId", field=field),
        stream_id=_get_str(mapping, "streamId", field=field),
        connection_generation=_get_int(mapping, "connectionGeneration", field=field),
        receive_ordinal=_get_int(mapping, "receiveOrdinal", field=field),
        receive_wall_time_ms=_get_int(mapping, "receiveWallTimeMs", field=field),
        receive_monotonic_ns=_get_int(mapping, "receiveMonotonicNs", field=field),
    )


_SPOT_DELTA_KEYS: Final = frozenset(
    {
        "asks",
        "bids",
        "eventTimeMs",
        "finalUpdateId",
        "firstUpdateId",
        "posture",
        "product",
        "receive",
        "symbol",
    }
)
_USD_M_DELTA_KEYS: Final = _SPOT_DELTA_KEYS | {"previousFinalUpdateId", "transactionTimeMs"}


def _parse_delta(value: object, *, field: str) -> BookDelta:
    mapping = _require_mapping(value, field=field)
    product = _parse_product(_get_str(mapping, "product", field=field), field=f"{field}.product")
    if product is ForwardProduct.SPOT:
        _require_exact_keys(mapping, field=field, keys=_SPOT_DELTA_KEYS)
        return SpotDepthDeltaV1(
            symbol=_get_str(mapping, "symbol", field=field),
            event_time_ms=_get_int(mapping, "eventTimeMs", field=field),
            first_update_id=_get_int(mapping, "firstUpdateId", field=field),
            final_update_id=_get_int(mapping, "finalUpdateId", field=field),
            bids=_parse_levels(mapping["bids"], field=f"{field}.bids"),
            asks=_parse_levels(mapping["asks"], field=f"{field}.asks"),
            receive=_parse_receive(mapping["receive"], field=f"{field}.receive"),
            posture=_parse_posture(
                _get_str(mapping, "posture", field=field),
                field=f"{field}.posture",
            ),
        )
    _require_exact_keys(mapping, field=field, keys=_USD_M_DELTA_KEYS)
    return UsdMDepthDeltaV1(
        symbol=_get_str(mapping, "symbol", field=field),
        event_time_ms=_get_int(mapping, "eventTimeMs", field=field),
        transaction_time_ms=_get_int(mapping, "transactionTimeMs", field=field),
        first_update_id=_get_int(mapping, "firstUpdateId", field=field),
        final_update_id=_get_int(mapping, "finalUpdateId", field=field),
        previous_final_update_id=_get_int(mapping, "previousFinalUpdateId", field=field),
        bids=_parse_levels(mapping["bids"], field=f"{field}.bids"),
        asks=_parse_levels(mapping["asks"], field=f"{field}.asks"),
        receive=_parse_receive(mapping["receive"], field=f"{field}.receive"),
        posture=_parse_posture(
            _get_str(mapping, "posture", field=field),
            field=f"{field}.posture",
        ),
    )


_PROVENANCE_KEYS: Final = frozenset(
    {"acquiredMonotonicNs", "acquiredWallTimeMs", "intentId", "posture"}
)


def _parse_provenance(value: object, *, field: str) -> SnapshotProvenanceV1:
    mapping = _require_mapping(value, field=field)
    _require_exact_keys(mapping, field=field, keys=_PROVENANCE_KEYS)
    return SnapshotProvenanceV1(
        intent_id=_get_str(mapping, "intentId", field=field),
        acquired_wall_time_ms=_get_int(mapping, "acquiredWallTimeMs", field=field),
        acquired_monotonic_ns=_get_int(mapping, "acquiredMonotonicNs", field=field),
        posture=_parse_posture(
            _get_str(mapping, "posture", field=field),
            field=f"{field}.posture",
        ),
    )


_SPOT_SNAPSHOT_KEYS: Final = frozenset(
    {"asks", "bids", "lastUpdateId", "product", "provenance", "symbol"}
)
_USD_M_SNAPSHOT_KEYS: Final = _SPOT_SNAPSHOT_KEYS | {
    "messageOutputTimeMs",
    "transactionTimeMs",
}


def _parse_snapshot(value: object, *, field: str) -> BookSnapshot:
    mapping = _require_mapping(value, field=field)
    product = _parse_product(_get_str(mapping, "product", field=field), field=f"{field}.product")
    if product is ForwardProduct.SPOT:
        _require_exact_keys(mapping, field=field, keys=_SPOT_SNAPSHOT_KEYS)
        return SpotDepthSnapshotV1(
            symbol=_get_str(mapping, "symbol", field=field),
            last_update_id=_get_int(mapping, "lastUpdateId", field=field),
            bids=_parse_levels(mapping["bids"], field=f"{field}.bids"),
            asks=_parse_levels(mapping["asks"], field=f"{field}.asks"),
            provenance=_parse_provenance(mapping["provenance"], field=f"{field}.provenance"),
        )
    _require_exact_keys(mapping, field=field, keys=_USD_M_SNAPSHOT_KEYS)
    return UsdMDepthSnapshotV1(
        symbol=_get_str(mapping, "symbol", field=field),
        last_update_id=_get_int(mapping, "lastUpdateId", field=field),
        message_output_time_ms=_get_int(mapping, "messageOutputTimeMs", field=field),
        transaction_time_ms=_get_int(mapping, "transactionTimeMs", field=field),
        bids=_parse_levels(mapping["bids"], field=f"{field}.bids"),
        asks=_parse_levels(mapping["asks"], field=f"{field}.asks"),
        provenance=_parse_provenance(mapping["provenance"], field=f"{field}.provenance"),
    )


_ENGINE_KEYS: Final = frozenset(
    {
        "bookKey",
        "expectedPosture",
        "maxBufferedDeltas",
        "maxLevelsPerSide",
        "product",
        "schemaVersion",
        "symbol",
    }
)


def _parse_engine_config(value: object, *, field: str) -> BookEngineConfigV1:
    mapping = _require_mapping(value, field=field)
    _require_exact_keys(mapping, field=field, keys=_ENGINE_KEYS)
    config = BookEngineConfigV1(
        product=_parse_product(
            _get_str(mapping, "product", field=field),
            field=f"{field}.product",
        ),
        symbol=_get_str(mapping, "symbol", field=field),
        expected_posture=_parse_posture(
            _get_str(mapping, "expectedPosture", field=field),
            field=f"{field}.expectedPosture",
        ),
        max_levels_per_side=_get_int(mapping, "maxLevelsPerSide", field=field),
        max_buffered_deltas=_get_int(mapping, "maxBufferedDeltas", field=field),
    )
    if mapping["bookKey"] != config.book_key:
        raise ContractValueError(f"{field}.bookKey disagrees with the derived book key")
    if mapping["schemaVersion"] != config.schema_version:
        raise ContractValueError(f"{field}.schemaVersion is unsupported")
    return config


_STEP_BASE_KEYS: Final = frozenset({"kind", "processingTimeNs"})


def _parse_step(value: object, *, field: str) -> ReplayStepV1:
    mapping = _require_mapping(value, field=field)
    kind_text = _get_str(mapping, "kind", field=field)
    if kind_text == ReplayStepKind.START.value:
        _require_exact_keys(mapping, field=field, keys=_STEP_BASE_KEYS)
        return ReplayStepV1(
            kind=ReplayStepKind.START,
            processing_time_ns=_get_int(mapping, "processingTimeNs", field=field),
        )
    if kind_text == ReplayStepKind.DELTA.value:
        _require_exact_keys(mapping, field=field, keys=_STEP_BASE_KEYS | {"delta"})
        return ReplayStepV1(
            kind=ReplayStepKind.DELTA,
            processing_time_ns=_get_int(mapping, "processingTimeNs", field=field),
            delta=_parse_delta(mapping["delta"], field=f"{field}.delta"),
        )
    if kind_text == ReplayStepKind.SNAPSHOT.value:
        _require_exact_keys(mapping, field=field, keys=_STEP_BASE_KEYS | {"snapshot"})
        return ReplayStepV1(
            kind=ReplayStepKind.SNAPSHOT,
            processing_time_ns=_get_int(mapping, "processingTimeNs", field=field),
            snapshot=_parse_snapshot(mapping["snapshot"], field=f"{field}.snapshot"),
        )
    raise ContractValueError(f"{field}.kind must be START, DELTA or SNAPSHOT")


_SCRIPT_KEYS: Final = frozenset({"engine", "schema", "steps", "version"})


def script_from_mapping(value: object) -> ReplayScriptV1:
    mapping = _require_mapping(value, field="script")
    _require_exact_keys(mapping, field="script", keys=_SCRIPT_KEYS)
    if mapping["schema"] != REPLAY_SCRIPT_SCHEMA or mapping["version"] != 1:
        raise ContractValueError("script schema/version are unsupported")
    steps_value = mapping["steps"]
    if not isinstance(steps_value, list):
        raise ContractValueError("script.steps must be a JSON array")
    steps = tuple(
        _parse_step(entry, field=f"script.steps[{index}]")
        for index, entry in enumerate(steps_value)
    )
    return ReplayScriptV1(
        engine_config=_parse_engine_config(mapping["engine"], field="script.engine"),
        steps=steps,
    )
