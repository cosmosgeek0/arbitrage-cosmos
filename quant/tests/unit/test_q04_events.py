from __future__ import annotations

import pytest

from quant_edge.book.events import (
    MAX_SPOT_SNAPSHOT_LEVELS_PER_SIDE,
    MAX_UPDATES_PER_DELTA,
    MAX_USD_M_SNAPSHOT_LEVELS_PER_SIDE,
    ReceiveClocksV1,
    SnapshotProvenanceV1,
    SpotDepthDeltaV1,
    SpotDepthSnapshotV1,
    UsdMDepthDeltaV1,
    UsdMDepthSnapshotV1,
)
from quant_edge.book.levels import PriceLevelUpdateV1, parse_price_level_update
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture

EVENT_MS = 1_772_000_000_000
WALL_MS = 1_772_000_000_050
MONO_NS = 5_000_000_000


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


def _receive(ordinal: int = 1) -> ReceiveClocksV1:
    return ReceiveClocksV1(
        session_id="session-1",
        stream_id="bnbusdt@depth",
        connection_generation=1,
        receive_ordinal=ordinal,
        receive_wall_time_ms=WALL_MS,
        receive_monotonic_ns=MONO_NS,
    )


def _provenance(intent_id: str = "q04intent:a") -> SnapshotProvenanceV1:
    return SnapshotProvenanceV1(
        intent_id=intent_id,
        acquired_wall_time_ms=WALL_MS,
        acquired_monotonic_ns=MONO_NS,
        posture=EvidencePosture.SYNTHETIC,
    )


def _spot_delta(**overrides: object) -> SpotDepthDeltaV1:
    fields: dict[str, object] = {
        "symbol": "BNBUSDT",
        "event_time_ms": EVENT_MS,
        "first_update_id": 157,
        "final_update_id": 160,
        "bids": (_update("0.0024", "10"),),
        "asks": (_update("0.0026", "100"),),
        "receive": _receive(),
        "posture": EvidencePosture.SYNTHETIC,
    }
    fields.update(overrides)
    return SpotDepthDeltaV1(**fields)  # type: ignore[arg-type]


def _usd_m_delta(**overrides: object) -> UsdMDepthDeltaV1:
    fields: dict[str, object] = {
        "symbol": "BTCUSDT",
        "event_time_ms": EVENT_MS,
        "transaction_time_ms": EVENT_MS - 1,
        "first_update_id": 157,
        "final_update_id": 160,
        "previous_final_update_id": 149,
        "bids": (_update("7403.89", "1"),),
        "asks": (_update("7405.96", "2"),),
        "receive": _receive(),
        "posture": EvidencePosture.REPLAY,
    }
    fields.update(overrides)
    return UsdMDepthDeltaV1(**fields)  # type: ignore[arg-type]


class TestReceiveClocks:
    def test_valid_clocks_serialize_exactly(self) -> None:
        clocks = _receive()

        assert clocks.as_mapping() == {
            "connectionGeneration": 1,
            "receiveMonotonicNs": MONO_NS,
            "receiveOrdinal": 1,
            "receiveWallTimeMs": WALL_MS,
            "sessionId": "session-1",
            "streamId": "bnbusdt@depth",
        }

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("session_id", ""),
            ("stream_id", ""),
            ("connection_generation", -1),
            ("receive_ordinal", True),
            ("receive_wall_time_ms", 5),
            ("receive_monotonic_ns", -1),
        ],
    )
    def test_rejects_invalid_fields(self, field: str, value: object) -> None:
        fields: dict[str, object] = {
            "session_id": "session-1",
            "stream_id": "bnbusdt@depth",
            "connection_generation": 1,
            "receive_ordinal": 1,
            "receive_wall_time_ms": WALL_MS,
            "receive_monotonic_ns": MONO_NS,
        }
        fields[field] = value
        with pytest.raises(ContractValueError):
            ReceiveClocksV1(**fields)  # type: ignore[arg-type]

    def test_rejects_unencodable_stream_text(self) -> None:
        with pytest.raises(ContractValueError):
            ReceiveClocksV1(
                session_id="session-1",
                stream_id="\ud800",
                connection_generation=1,
                receive_ordinal=1,
                receive_wall_time_ms=WALL_MS,
                receive_monotonic_ns=MONO_NS,
            )


class TestSpotDepthDelta:
    def test_valid_delta_and_mapping(self) -> None:
        delta = _spot_delta()

        assert delta.product is ForwardProduct.SPOT
        mapping = delta.as_mapping()
        assert mapping["firstUpdateId"] == 157
        assert mapping["finalUpdateId"] == 160
        assert mapping["product"] == "SPOT"
        assert "transactionTimeMs" not in mapping
        assert "previousFinalUpdateId" not in mapping

    def test_rejects_inverted_update_range(self) -> None:
        with pytest.raises(ContractValueError):
            _spot_delta(first_update_id=161)

    def test_rejects_live_posture(self) -> None:
        with pytest.raises(ContractValueError):
            _spot_delta(posture=EvidencePosture.LIVE)

    def test_rejects_repeated_price_in_one_message(self) -> None:
        with pytest.raises(ContractValueError):
            _spot_delta(bids=(_update("0.0024", "10"), _update("0.002400", "11")))

    def test_rejects_wrong_payload_types(self) -> None:
        with pytest.raises(ContractValueError):
            _spot_delta(bids=[_update("0.0024", "10")])
        with pytest.raises(ContractValueError):
            _spot_delta(asks=(("0.0026", "100"),))
        with pytest.raises(ContractValueError):
            _spot_delta(receive="clocks")
        with pytest.raises(ContractValueError):
            _spot_delta(symbol="BNB USDT")
        with pytest.raises(ContractValueError):
            _spot_delta(event_time_ms=None)

    def test_rejects_oversized_update_batch(self) -> None:
        updates = tuple(
            _update(f"{index + 1}.0", "1") for index in range(MAX_UPDATES_PER_DELTA + 1)
        )
        with pytest.raises(ContractValueError):
            _spot_delta(bids=updates)

    def test_rejects_negative_or_oversized_update_ids(self) -> None:
        with pytest.raises(ContractValueError):
            _spot_delta(first_update_id=-1, final_update_id=1)
        with pytest.raises(ContractValueError):
            _spot_delta(final_update_id=(1 << 64))


class TestUsdMDepthDelta:
    def test_valid_delta_and_mapping(self) -> None:
        delta = _usd_m_delta()

        assert delta.product is ForwardProduct.USD_M_PERPETUAL
        mapping = delta.as_mapping()
        assert mapping["previousFinalUpdateId"] == 149
        assert mapping["transactionTimeMs"] == EVENT_MS - 1
        assert mapping["product"] == "USD_M_PERPETUAL"

    def test_rejects_missing_clock_or_sequence_truth(self) -> None:
        with pytest.raises(ContractValueError):
            _usd_m_delta(transaction_time_ms=None)
        with pytest.raises(ContractValueError):
            _usd_m_delta(previous_final_update_id=-1)
        with pytest.raises(ContractValueError):
            _usd_m_delta(first_update_id=200)

    def test_rejects_live_posture_and_bad_levels(self) -> None:
        with pytest.raises(ContractValueError):
            _usd_m_delta(posture=EvidencePosture.LIVE)
        with pytest.raises(ContractValueError):
            _usd_m_delta(asks=(_update("1.0", "1"), _update("1.00", "2")))
        with pytest.raises(ContractValueError):
            _usd_m_delta(receive=None)


class TestSnapshotProvenance:
    def test_valid_provenance_mapping(self) -> None:
        provenance = _provenance()

        assert provenance.as_mapping() == {
            "acquiredMonotonicNs": MONO_NS,
            "acquiredWallTimeMs": WALL_MS,
            "intentId": "q04intent:a",
            "posture": "SYNTHETIC",
        }

    def test_rejects_invalid_fields(self) -> None:
        with pytest.raises(ContractValueError):
            _provenance(intent_id="")
        with pytest.raises(ContractValueError):
            SnapshotProvenanceV1(
                intent_id="q04intent:a",
                acquired_wall_time_ms=WALL_MS,
                acquired_monotonic_ns=-1,
                posture=EvidencePosture.SYNTHETIC,
            )
        with pytest.raises(ContractValueError):
            SnapshotProvenanceV1(
                intent_id="q04intent:a",
                acquired_wall_time_ms=WALL_MS,
                acquired_monotonic_ns=MONO_NS,
                posture=EvidencePosture.LIVE,
            )


class TestSpotDepthSnapshot:
    def test_valid_snapshot_carries_no_exchange_clock(self) -> None:
        snapshot = SpotDepthSnapshotV1(
            symbol="BNBUSDT",
            last_update_id=1_027_024,
            bids=(_update("4.00000000", "431.00000000"),),
            asks=(_update("4.00000200", "12.00000000"),),
            provenance=_provenance(),
        )

        mapping = snapshot.as_mapping()
        assert snapshot.product is ForwardProduct.SPOT
        assert mapping["lastUpdateId"] == 1_027_024
        assert "messageOutputTimeMs" not in mapping
        assert "transactionTimeMs" not in mapping

    def test_shape_bounds_are_enforced(self) -> None:
        oversized = tuple(
            _update(f"{index + 1}.0", "1") for index in range(MAX_SPOT_SNAPSHOT_LEVELS_PER_SIDE + 1)
        )
        with pytest.raises(ContractValueError):
            SpotDepthSnapshotV1(
                symbol="BNBUSDT",
                last_update_id=1,
                bids=oversized,
                asks=(),
                provenance=_provenance(),
            )
        with pytest.raises(ContractValueError):
            SpotDepthSnapshotV1(
                symbol="BNBUSDT",
                last_update_id=-1,
                bids=(),
                asks=(),
                provenance=_provenance(),
            )
        with pytest.raises(ContractValueError):
            SpotDepthSnapshotV1(
                symbol="BNBUSDT",
                last_update_id=1,
                bids=(),
                asks=(),
                provenance="provenance",  # type: ignore[arg-type]
            )

    def test_semantically_corrupt_snapshots_remain_representable(self) -> None:
        crossed = SpotDepthSnapshotV1(
            symbol="BNBUSDT",
            last_update_id=7,
            bids=(_update("5.0", "1"),),
            asks=(_update("4.0", "1"),),
            provenance=_provenance(),
        )
        zero_quantity = SpotDepthSnapshotV1(
            symbol="BNBUSDT",
            last_update_id=7,
            bids=(_update("4.0", "0"),),
            asks=(),
            provenance=_provenance(),
        )

        assert crossed.bids[0].price.text == "5.0"
        assert zero_quantity.bids[0].quantity.is_zero


class TestUsdMDepthSnapshot:
    def test_valid_snapshot_preserves_exchange_clocks(self) -> None:
        snapshot = UsdMDepthSnapshotV1(
            symbol="BTCUSDT",
            last_update_id=1_027_024,
            message_output_time_ms=1_589_436_922_972,
            transaction_time_ms=1_589_436_922_959,
            bids=(_update("4.00000000", "431.00000000"),),
            asks=(_update("4.00000200", "12.00000000"),),
            provenance=_provenance(),
        )

        mapping = snapshot.as_mapping()
        assert snapshot.product is ForwardProduct.USD_M_PERPETUAL
        assert mapping["messageOutputTimeMs"] == 1_589_436_922_972
        assert mapping["transactionTimeMs"] == 1_589_436_922_959

    def test_rejects_missing_clocks_and_oversized_sides(self) -> None:
        oversized = tuple(
            _update(f"{index + 1}.0", "1")
            for index in range(MAX_USD_M_SNAPSHOT_LEVELS_PER_SIDE + 1)
        )
        with pytest.raises(ContractValueError):
            UsdMDepthSnapshotV1(
                symbol="BTCUSDT",
                last_update_id=1,
                message_output_time_ms=None,  # type: ignore[arg-type]
                transaction_time_ms=EVENT_MS,
                bids=(),
                asks=(),
                provenance=_provenance(),
            )
        with pytest.raises(ContractValueError):
            UsdMDepthSnapshotV1(
                symbol="BTCUSDT",
                last_update_id=1,
                message_output_time_ms=EVENT_MS,
                transaction_time_ms=5,
                bids=(),
                asks=(),
                provenance=_provenance(),
            )
        with pytest.raises(ContractValueError):
            UsdMDepthSnapshotV1(
                symbol="BTCUSDT",
                last_update_id=1,
                message_output_time_ms=EVENT_MS,
                transaction_time_ms=EVENT_MS,
                bids=(),
                asks=oversized,
                provenance=_provenance(),
            )
        with pytest.raises(ContractValueError):
            UsdMDepthSnapshotV1(
                symbol="BTCUSDT",
                last_update_id=1,
                message_output_time_ms=EVENT_MS,
                transaction_time_ms=EVENT_MS,
                bids=(),
                asks=(),
                provenance="provenance",  # type: ignore[arg-type]
            )
