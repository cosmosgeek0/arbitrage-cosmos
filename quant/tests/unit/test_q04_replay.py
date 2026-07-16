from __future__ import annotations

import pytest

from quant_edge.book.engine import (
    BookEngineConfigV1,
    SnapshotRequestIntentV1,
)
from quant_edge.book.events import (
    ReceiveClocksV1,
    SnapshotProvenanceV1,
    SpotDepthDeltaV1,
    SpotDepthSnapshotV1,
)
from quant_edge.book.levels import PriceLevelUpdateV1, parse_price_level_update
from quant_edge.book.replay import (
    MAX_REPLAY_STEPS,
    ReplayScriptV1,
    ReplayStepKind,
    ReplayStepV1,
    run_replay,
    script_from_mapping,
)
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture

EVENT_MS = 1_772_000_000_000
WALL_MS = 1_772_000_000_050
MONO_NS = 5_000_000_000
PROC_NS = 1_772_000_000_000_000_000


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


def _config() -> BookEngineConfigV1:
    return BookEngineConfigV1(
        product=ForwardProduct.SPOT,
        symbol="BNBUSDT",
        expected_posture=EvidencePosture.SYNTHETIC,
        max_levels_per_side=8,
        max_buffered_deltas=8,
    )


def _delta(first: int, last: int, *, ordinal: int) -> SpotDepthDeltaV1:
    return SpotDepthDeltaV1(
        symbol="BNBUSDT",
        event_time_ms=EVENT_MS + ordinal,
        first_update_id=first,
        final_update_id=last,
        bids=(_update("1.0", "5"),),
        asks=(_update("2.0", "5"),),
        receive=ReceiveClocksV1(
            session_id="session-1",
            stream_id="bnbusdt@depth",
            connection_generation=1,
            receive_ordinal=ordinal,
            receive_wall_time_ms=WALL_MS + ordinal,
            receive_monotonic_ns=MONO_NS + ordinal,
        ),
        posture=EvidencePosture.SYNTHETIC,
    )


def _snapshot(last_update_id: int, intent_id: str) -> SpotDepthSnapshotV1:
    return SpotDepthSnapshotV1(
        symbol="BNBUSDT",
        last_update_id=last_update_id,
        bids=(_update("1.0", "3"),),
        asks=(_update("2.0", "3"),),
        provenance=SnapshotProvenanceV1(
            intent_id=intent_id,
            acquired_wall_time_ms=WALL_MS,
            acquired_monotonic_ns=MONO_NS,
            posture=EvidencePosture.SYNTHETIC,
        ),
    )


def _script() -> ReplayScriptV1:
    """One full sync/stream/gap/resync spot script with engine-derived intent ids."""

    from quant_edge.book.engine import LocalBookEngine

    config = _config()
    probe = LocalBookEngine(config)
    start_effects = probe.start(processing_time_ns=PROC_NS)
    first_intent = next(
        effect for effect in start_effects if isinstance(effect, SnapshotRequestIntentV1)
    )
    probe.on_delta(_delta(100, 102, ordinal=1), processing_time_ns=PROC_NS + 1)
    probe.on_snapshot(_snapshot(100, first_intent.intent_id), processing_time_ns=PROC_NS + 2)
    gap_effects = probe.on_delta(_delta(120, 125, ordinal=2), processing_time_ns=PROC_NS + 3)
    retry_intent = next(
        effect for effect in gap_effects if isinstance(effect, SnapshotRequestIntentV1)
    )
    return ReplayScriptV1(
        engine_config=config,
        steps=(
            ReplayStepV1(kind=ReplayStepKind.START, processing_time_ns=PROC_NS),
            ReplayStepV1(
                kind=ReplayStepKind.DELTA,
                processing_time_ns=PROC_NS + 1,
                delta=_delta(100, 102, ordinal=1),
            ),
            ReplayStepV1(
                kind=ReplayStepKind.SNAPSHOT,
                processing_time_ns=PROC_NS + 2,
                snapshot=_snapshot(100, first_intent.intent_id),
            ),
            ReplayStepV1(
                kind=ReplayStepKind.DELTA,
                processing_time_ns=PROC_NS + 3,
                delta=_delta(120, 125, ordinal=2),
            ),
            ReplayStepV1(
                kind=ReplayStepKind.SNAPSHOT,
                processing_time_ns=PROC_NS + 4,
                snapshot=_snapshot(121, retry_intent.intent_id),
            ),
        ),
    )


class TestReplayStepContract:
    def test_kind_payload_coherence_is_enforced(self) -> None:
        with pytest.raises(ContractValueError):
            ReplayStepV1(
                kind=ReplayStepKind.START,
                processing_time_ns=PROC_NS,
                delta=_delta(1, 2, ordinal=1),
            )
        with pytest.raises(ContractValueError):
            ReplayStepV1(kind=ReplayStepKind.DELTA, processing_time_ns=PROC_NS)
        with pytest.raises(ContractValueError):
            ReplayStepV1(
                kind=ReplayStepKind.DELTA,
                processing_time_ns=PROC_NS,
                delta=_delta(1, 2, ordinal=1),
                snapshot=_snapshot(1, "q04intent:x"),
            )
        with pytest.raises(ContractValueError):
            ReplayStepV1(kind=ReplayStepKind.SNAPSHOT, processing_time_ns=PROC_NS)
        with pytest.raises(ContractValueError):
            ReplayStepV1(kind="START", processing_time_ns=PROC_NS)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            ReplayStepV1(kind=ReplayStepKind.START, processing_time_ns="soon")  # type: ignore[arg-type]

    def test_script_contract(self) -> None:
        step = ReplayStepV1(kind=ReplayStepKind.START, processing_time_ns=PROC_NS)
        with pytest.raises(ContractValueError):
            ReplayScriptV1(engine_config="config", steps=(step,))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            ReplayScriptV1(engine_config=_config(), steps=())
        with pytest.raises(ContractValueError):
            ReplayScriptV1(engine_config=_config(), steps=[step])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            ReplayScriptV1(engine_config=_config(), steps=(step, "step"))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            ReplayScriptV1(
                engine_config=_config(),
                steps=(
                    ReplayStepV1(
                        kind=ReplayStepKind.DELTA,
                        processing_time_ns=PROC_NS,
                        delta=_delta(1, 2, ordinal=1),
                    ),
                ),
            )

    def test_run_replay_requires_script_type(self) -> None:
        with pytest.raises(ContractValueError):
            run_replay("script")  # type: ignore[arg-type]


class TestReplayDeterminism:
    def test_identical_scripts_produce_identical_bytes_and_digests(self) -> None:
        script = _script()
        first = run_replay(script)
        second = run_replay(script)

        assert first.canonical_bytes() == second.canonical_bytes()
        assert first.result_digest == second.result_digest
        assert first.script_digest == script.script_digest
        assert first.final_view.model_eligible
        assert first.final_view.book_update_id == 125

    def test_script_round_trips_through_canonical_mapping(self) -> None:
        script = _script()
        parsed = script_from_mapping(parse_canonical_object(script.canonical_bytes()))

        assert parsed.script_digest == script.script_digest
        assert run_replay(parsed).result_digest == run_replay(script).result_digest

    def test_step_count_bound(self) -> None:
        start = ReplayStepV1(kind=ReplayStepKind.START, processing_time_ns=PROC_NS)
        filler = tuple(
            ReplayStepV1(
                kind=ReplayStepKind.DELTA,
                processing_time_ns=PROC_NS + index + 1,
                delta=_delta(100 + index, 100 + index, ordinal=index + 1),
            )
            for index in range(8)
        )
        script = ReplayScriptV1(engine_config=_config(), steps=(start, *filler))
        assert len(script.steps) <= MAX_REPLAY_STEPS
        oversized = (start,) * (MAX_REPLAY_STEPS + 1)
        with pytest.raises(ContractValueError):
            ReplayScriptV1(engine_config=_config(), steps=oversized)


class TestScriptParser:
    def test_rejects_wrong_shapes(self) -> None:
        script = _script()
        mapping = parse_canonical_object(script.canonical_bytes())

        with pytest.raises(ContractValueError):
            script_from_mapping("script")
        broken_schema = dict(mapping)
        broken_schema["schema"] = "Q99"
        with pytest.raises(ContractValueError):
            script_from_mapping(broken_schema)
        missing_key = {key: value for key, value in mapping.items() if key != "engine"}
        with pytest.raises(ContractValueError):
            script_from_mapping(missing_key)
        extra_key = dict(mapping)
        extra_key["extra"] = 1
        with pytest.raises(ContractValueError):
            script_from_mapping(extra_key)
        non_list_steps = dict(mapping)
        non_list_steps["steps"] = "steps"
        with pytest.raises(ContractValueError):
            script_from_mapping(non_list_steps)

    def test_rejects_bad_engine_and_steps(self) -> None:
        script = _script()
        mapping = parse_canonical_object(script.canonical_bytes())

        def _mutated(path: list[str | int], value: object) -> dict[str, object]:
            import copy

            clone = copy.deepcopy(mapping)
            target: object = clone
            for key in path[:-1]:
                target = target[key]  # type: ignore[index]
            target[path[-1]] = value  # type: ignore[index]
            return clone

        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["engine", "bookKey"], "SPOT:OTHER"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["engine", "schemaVersion"], "q99"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["engine", "product"], "OPTIONS"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["engine", "maxLevelsPerSide"], "8"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["engine", "symbol"], 7))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 0, "kind"], "STOP"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 0], {"kind": "START"}))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 1, "delta", "posture"], "LIVE"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 1, "delta", "product"], "OPTIONS"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 1, "delta", "bids"], "levels"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 1, "delta", "bids", 0], {"price": "1.0"}))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 1, "delta", "receive"], "clocks"))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 1, "delta", "receive", "sessionId"], 5))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 2, "snapshot", "provenance"], []))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 2, "snapshot", "provenance", "intentId"], 5))
        with pytest.raises(ContractValueError):
            script_from_mapping(_mutated(["steps", 2, "snapshot", "product"], "OPTIONS"))

    def test_parses_usd_m_payloads(self) -> None:
        from quant_edge.book.engine import LocalBookEngine, usd_m_book_engine
        from quant_edge.book.events import UsdMDepthDeltaV1, UsdMDepthSnapshotV1

        engine: LocalBookEngine = usd_m_book_engine(
            "BTCUSDT",
            expected_posture=EvidencePosture.SYNTHETIC,
            max_levels_per_side=8,
            max_buffered_deltas=8,
        )
        start_effects = engine.start(processing_time_ns=PROC_NS)
        intent = next(
            effect for effect in start_effects if isinstance(effect, SnapshotRequestIntentV1)
        )
        delta = UsdMDepthDeltaV1(
            symbol="BTCUSDT",
            event_time_ms=EVENT_MS,
            transaction_time_ms=EVENT_MS - 1,
            first_update_id=99,
            final_update_id=103,
            previous_final_update_id=98,
            bids=(_update("7403.89", "1"),),
            asks=(_update("7405.96", "1"),),
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
        snapshot = UsdMDepthSnapshotV1(
            symbol="BTCUSDT",
            last_update_id=100,
            message_output_time_ms=EVENT_MS + 10,
            transaction_time_ms=EVENT_MS + 9,
            bids=(_update("7403.89", "2"),),
            asks=(_update("7405.96", "2"),),
            provenance=SnapshotProvenanceV1(
                intent_id=intent.intent_id,
                acquired_wall_time_ms=WALL_MS,
                acquired_monotonic_ns=MONO_NS,
                posture=EvidencePosture.SYNTHETIC,
            ),
        )
        script = ReplayScriptV1(
            engine_config=BookEngineConfigV1(
                product=ForwardProduct.USD_M_PERPETUAL,
                symbol="BTCUSDT",
                expected_posture=EvidencePosture.SYNTHETIC,
                max_levels_per_side=8,
                max_buffered_deltas=8,
            ),
            steps=(
                ReplayStepV1(kind=ReplayStepKind.START, processing_time_ns=PROC_NS),
                ReplayStepV1(
                    kind=ReplayStepKind.DELTA,
                    processing_time_ns=PROC_NS + 1,
                    delta=delta,
                ),
                ReplayStepV1(
                    kind=ReplayStepKind.SNAPSHOT,
                    processing_time_ns=PROC_NS + 2,
                    snapshot=snapshot,
                ),
            ),
        )

        parsed = script_from_mapping(parse_canonical_object(script.canonical_bytes()))

        assert parsed.script_digest == script.script_digest
        result = run_replay(parsed)
        assert result.final_view.model_eligible
        assert result.final_view.book_update_id == 103
