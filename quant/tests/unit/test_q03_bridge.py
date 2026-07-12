from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import cast

import pyarrow as pa  # type: ignore[import-untyped]
import pytest

from quant_edge.bootstrap.bridge import (
    FORWARD_CAPTURE_PRODUCER_OWNER,
    FORWARD_CAPTURE_QUEUE_POLICY,
    FORWARD_CAPTURE_SCHEMA,
    FORWARD_CAPTURE_SCHEMA_FINGERPRINT,
    FORWARD_CAPTURE_SCHEMA_ID,
    FORWARD_CAPTURE_SCHEMA_VERSION,
    MAX_QUEUE_CAPACITY,
    PAYLOAD_SCHEMA_VERSION,
    SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY,
    SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID,
    SPOT_TRADE_PAYLOAD_SCHEMA_ID,
    USD_M_DEPTH_DELTA_PAYLOAD_SCHEMA_ID,
    BridgeCompatibilityV1,
    CanonicalNormalizedEvidenceV1,
    CanonicalRuntimeSequenceV1,
    CanonicalRuntimeSourceEventV1,
    CapturePosture,
    CaptureQualityEvidenceV1,
    CompatibilityState,
    DropNewCaptureQueue,
    ForwardCaptureEnvelopeV1,
    ForwardEndpointClass,
    ForwardProduct,
    IntegrationState,
    PartitionOrderBasis,
    PayloadEvidencePosture,
    PayloadMaterializationState,
    PayloadSchemaBindingV1,
    QCaptureSidecarV1,
    QueueOfferState,
    RealDeliveryState,
    SpotSequenceV1,
    UsdMSequenceV1,
    _capture_id,
    adapt_runtime_evidence_fixture,
    forward_capture_arrow_schema,
)
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import INT64_MAX, UTC_NS_MAX, DigestV1

RECEIVE_MS = 1_783_814_400_000
RECEIVE_NS = RECEIVE_MS * 1_000_000


def _sequence(
    first: str = "42",
    last: str = "42",
    previous: str | None = None,
) -> CanonicalRuntimeSequenceV1:
    return CanonicalRuntimeSequenceV1(first=first, last=last, previous=previous)


def _runtime(
    *,
    product: ForwardProduct = ForwardProduct.SPOT,
    event_ms: int | None = None,
    transaction_ms: int | None = None,
    sequence: CanonicalRuntimeSequenceV1 | None = None,
    generation: int = 3,
) -> CanonicalRuntimeSourceEventV1:
    if sequence is None:
        sequence = _sequence(previous="41" if product is ForwardProduct.USD_M_PERPETUAL else None)
    return CanonicalRuntimeSourceEventV1(
        source_id="binance.public.book",
        connection_generation=generation,
        product_family=product,
        endpoint_class=ForwardEndpointClass.PUBLIC,
        stream="btcusdt@bookTicker",
        source_event_time_ms=event_ms,
        source_transaction_time_ms=transaction_ms,
        receive_time_ms=RECEIVE_MS,
        sequence=sequence,
        correlation_id="correlation.1",
    )


def _evidence(
    runtime: CanonicalRuntimeSourceEventV1,
    *,
    kind: str = "BOOK_TICKER",
    sequence: CanonicalRuntimeSequenceV1 | None = None,
) -> CanonicalNormalizedEvidenceV1:
    return CanonicalNormalizedEvidenceV1(
        evidence_id="evidence.1",
        kind=kind,
        instrument_id="binance.spot.BTCUSDT"
        if runtime.product_family is ForwardProduct.SPOT
        else "binance.usdm.BTCUSDT",
        symbol="BTCUSDT",
        product_family=runtime.product_family,
        source_id=runtime.source_id,
        endpoint_class=runtime.endpoint_class,
        schema_version="1",
        producer_version="evidence-normalizer-1",
        configuration_version="evidence-default-1",
        source_event_time_ms=runtime.source_event_time_ms,
        source_transaction_time_ms=runtime.source_transaction_time_ms,
        received_time_ms=runtime.receive_time_ms,
        sequence=runtime.sequence if sequence is None else sequence,
        source_record_ids=("record.1",),
    )


def _sidecar(
    *,
    ordinal: int = 7,
    gap_count: int = 0,
    drop_count: int = 0,
    restart_count: int = 0,
) -> QCaptureSidecarV1:
    return QCaptureSidecarV1(
        session_id="session.1",
        receive_monotonic_ns=55,
        receive_ordinal=ordinal,
        processing_time_ns=RECEIVE_NS + 10,
        persistence_time_ns=RECEIVE_NS + 20,
        gap_count=gap_count,
        drop_count=drop_count,
        restart_count=restart_count,
        observed_reason_codes=("OWNER_PARTIAL",),
    )


def _envelope(
    *,
    product: ForwardProduct = ForwardProduct.SPOT,
    event_ms: int | None = None,
    transaction_ms: int | None = None,
    sidecar: QCaptureSidecarV1 | None = None,
    kind: str = "BOOK_TICKER",
    generation: int = 3,
) -> ForwardCaptureEnvelopeV1:
    runtime = _runtime(
        product=product,
        event_ms=event_ms,
        transaction_ms=transaction_ms,
        generation=generation,
    )
    return adapt_runtime_evidence_fixture(
        runtime,
        _evidence(runtime, kind=kind),
        _sidecar() if sidecar is None else sidecar,
        raw_payload_bytes=b'{"u":42}',
        normalized_evidence_bytes=b'{"id":"evidence.1"}',
    )


def test_spot_book_ticker_fixture_preserves_nullable_clocks_and_receive_order() -> None:
    first = _envelope(sidecar=_sidecar(ordinal=7))
    second = _envelope(sidecar=_sidecar(ordinal=8))

    assert first.partition_order_basis is PartitionOrderBasis.RECEIVE_WALL_TIME_AND_ORDINAL
    assert first.partition_order_time_ns == RECEIVE_NS
    assert first.runtime.source_event_time_ms is None
    assert first.runtime.source_transaction_time_ms is None
    assert first.source_trade_time_ms is None
    assert first.source_update_time_ms is None
    assert first.spot_sequence == SpotSequenceV1("42", "42")
    assert first.usd_m_sequence is None
    assert first.canonical_order_key < second.canonical_order_key
    assert first.canonical_order_key == (
        RECEIVE_NS,
        3,
        7,
        "session.1",
        "btcusdt@bookTicker",
        first.capture_id,
    )
    assert first.real_delivery_state is RealDeliveryState.MISSING
    assert first.integration_state is IntegrationState.BLOCKED
    assert first.posture is CapturePosture.SYNTHETIC_FIXTURE
    assert first.capture_id != second.capture_id
    assert first.payload_schema == PayloadSchemaBindingV1(
        schema_id=SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID,
        normalized_evidence_digest=first.normalized_evidence_digest,
    )

    mapping = first.as_mapping()
    assert mapping["runtime"] == {
        "connectionGeneration": 3,
        "receiveTimeMs": RECEIVE_MS,
        "sourceEventTimeMs": None,
        "sourceId": "binance.public.book",
        "sourceTransactionTimeMs": None,
        "stream": "btcusdt@bookTicker",
    }
    assert mapping["sequence"] == {
        "spot": {"updateFirst": "42", "updateLast": "42"},
        "usdM": None,
    }
    assert mapping["semanticSourceClocks"] == {
        "sourceTradeTimeMs": None,
        "sourceUpdateTimeMs": None,
    }
    assert mapping["ordering"] == {
        "basis": "RECEIVE_WALL_TIME_AND_ORDINAL",
        "partitionOrderTimeNs": RECEIVE_NS,
        "receiveOrdinal": 7,
    }
    assert mapping["producerOwner"] == FORWARD_CAPTURE_PRODUCER_OWNER
    assert mapping["payloadSchema"] == {
        "evidencePosture": "HASH_BOUND_ONLY",
        "materializationState": "MATERIALIZED_MISSING",
        "normalizedEvidenceSha256": first.normalized_evidence_digest.hexdigest,
        "schemaId": SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID,
        "schemaVersion": PAYLOAD_SCHEMA_VERSION,
    }
    assert mapping["sourceRecordIds"] == ["record.1"]


def test_fixture_digests_and_capture_identity_are_deterministic_and_content_bound() -> None:
    envelope = _envelope()
    replay = _envelope()
    changed_runtime = _runtime()
    changed = adapt_runtime_evidence_fixture(
        changed_runtime,
        _evidence(changed_runtime),
        _sidecar(),
        raw_payload_bytes=b'{"u":43}',
        normalized_evidence_bytes=b'{"id":"evidence.1","u":43}',
    )

    assert replay == envelope
    assert envelope.raw_payload_digest.hexdigest == hashlib.sha256(b'{"u":42}').hexdigest()
    assert (
        envelope.normalized_evidence_digest.hexdigest
        == hashlib.sha256(b'{"id":"evidence.1"}').hexdigest()
    )
    assert changed.capture_id != envelope.capture_id
    assert changed.raw_payload_digest != envelope.raw_payload_digest
    assert changed.normalized_evidence_digest != envelope.normalized_evidence_digest


def test_capture_identity_binds_runtime_evidence_sidecar_payload_digests_and_quality() -> None:
    runtime = _runtime(
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
    )
    evidence = _evidence(runtime, kind="TRADE")
    sidecar = _sidecar()

    def build(
        candidate_runtime: CanonicalRuntimeSourceEventV1 = runtime,
        candidate_evidence: CanonicalNormalizedEvidenceV1 = evidence,
        candidate_sidecar: QCaptureSidecarV1 = sidecar,
        *,
        raw: bytes = b"same-raw",
        normalized: bytes = b"same-normalized",
    ) -> ForwardCaptureEnvelopeV1:
        return adapt_runtime_evidence_fixture(
            candidate_runtime,
            candidate_evidence,
            candidate_sidecar,
            raw_payload_bytes=raw,
            normalized_evidence_bytes=normalized,
        )

    baseline = build()
    variants = (
        build(replace(runtime, connection_generation=runtime.connection_generation + 1)),
        build(replace(runtime, stream="btcusdt@aggTrade")),
        build(replace(runtime, correlation_id="correlation.2")),
        build(candidate_evidence=replace(evidence, evidence_id="evidence.2")),
        build(candidate_evidence=replace(evidence, instrument_id="binance.spot.BTCUSDT.v2")),
        build(candidate_evidence=replace(evidence, symbol="BTCUSDT2")),
        build(candidate_evidence=replace(evidence, schema_version="2")),
        build(candidate_evidence=replace(evidence, producer_version="evidence-normalizer-2")),
        build(candidate_evidence=replace(evidence, configuration_version="evidence-default-2")),
        build(candidate_evidence=replace(evidence, source_record_ids=("record.2",))),
        build(candidate_sidecar=replace(sidecar, session_id="session.2")),
        build(candidate_sidecar=replace(sidecar, receive_monotonic_ns=56)),
        build(candidate_sidecar=replace(sidecar, receive_ordinal=8)),
        build(candidate_sidecar=replace(sidecar, processing_time_ns=RECEIVE_NS + 11)),
        build(candidate_sidecar=replace(sidecar, persistence_time_ns=RECEIVE_NS + 21)),
        build(candidate_sidecar=replace(sidecar, gap_count=1)),
        build(raw=b"changed-raw"),
        build(normalized=b"changed-normalized"),
    )
    capture_ids = {candidate.capture_id for candidate in variants}

    assert baseline.capture_id not in capture_ids
    assert len(capture_ids) == len(variants)
    assert variants[15].quality.gap_observed
    assert variants[15].payload_schema.normalized_evidence_digest == (
        variants[15].normalized_evidence_digest
    )


def test_payload_schema_is_explicit_hash_only_product_event_truth() -> None:
    book_ticker = _envelope()
    trade = _envelope(
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        kind="TRADE",
    )
    depth = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        kind="DEPTH_DELTA",
    )

    assert [item.payload_schema.schema_id for item in (book_ticker, trade, depth)] == [
        SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID,
        SPOT_TRADE_PAYLOAD_SCHEMA_ID,
        USD_M_DEPTH_DELTA_PAYLOAD_SCHEMA_ID,
    ]
    for envelope in (book_ticker, trade, depth):
        assert envelope.payload_schema.evidence_posture is PayloadEvidencePosture.HASH_BOUND_ONLY
        assert (
            envelope.payload_schema.materialization_state
            is PayloadMaterializationState.MATERIALIZED_MISSING
        )
        assert (
            envelope.payload_schema.normalized_evidence_digest
            == envelope.normalized_evidence_digest
        )

    with pytest.raises(ContractValueError, match="unsupported Q03 payload schema"):
        _envelope(product=ForwardProduct.USD_M_PERPETUAL, kind="CONTEXT")
    with pytest.raises(ContractValueError, match="unsupported Q03 payload schema"):
        _envelope(product=ForwardProduct.USD_M_PERPETUAL, kind="BOOK_TICKER")
    market_runtime = replace(
        _runtime(
            product=ForwardProduct.USD_M_PERPETUAL,
            event_ms=RECEIVE_MS - 2,
            transaction_ms=RECEIVE_MS - 1,
        ),
        endpoint_class=ForwardEndpointClass.MARKET,
    )
    with pytest.raises(ContractValueError, match="USD_M_PERPETUAL/MARKET/DEPTH_DELTA"):
        adapt_runtime_evidence_fixture(
            market_runtime,
            _evidence(market_runtime, kind="DEPTH_DELTA"),
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )
    with pytest.raises(ContractValueError, match="payload schema ID"):
        replace(
            book_ticker,
            payload_schema=PayloadSchemaBindingV1(
                schema_id=SPOT_TRADE_PAYLOAD_SCHEMA_ID,
                normalized_evidence_digest=book_ticker.normalized_evidence_digest,
            ),
        )
    with pytest.raises(ContractValueError, match="normalized digest"):
        replace(
            book_ticker,
            payload_schema=PayloadSchemaBindingV1(
                schema_id=SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID,
                normalized_evidence_digest=DigestV1("f" * 64),
            ),
        )


@pytest.mark.parametrize(
    "change",
    [
        {"schema_id": "bad/id"},
        {"normalized_evidence_digest": object()},
        {"schema_version": "v2"},
        {"evidence_posture": cast(PayloadEvidencePosture, "MATERIALIZED")},
        {"materialization_state": cast(PayloadMaterializationState, "AVAILABLE")},
    ],
)
def test_payload_schema_binding_cannot_claim_materialized_values(
    change: dict[str, object],
) -> None:
    binding = _envelope().payload_schema

    with pytest.raises(ContractValueError):
        replace(binding, **change)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "change",
    [
        {"partition_order_time_ns": RECEIVE_NS + 123},
        {"partition_order_basis": PartitionOrderBasis.SOURCE_EVENT_TIME},
        {"spot_sequence": SpotSequenceV1("999", "999")},
        {"quality": CaptureQualityEvidenceV1(0, 0, 0, ())},
        {"capture_id": "tampered.capture.id"},
    ],
)
def test_envelope_rejects_forged_adapter_derived_fields(change: dict[str, object]) -> None:
    envelope = _envelope(sidecar=_sidecar(gap_count=1))

    with pytest.raises(ContractValueError):
        replace(envelope, **change)  # type: ignore[arg-type]


def test_usd_m_keeps_a_distinct_previous_update_sequence_and_quality_evidence() -> None:
    envelope = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 5,
        transaction_ms=RECEIVE_MS - 4,
        sidecar=_sidecar(gap_count=2, drop_count=3, restart_count=1),
        kind="DEPTH_DELTA",
    )

    assert envelope.spot_sequence is None
    assert envelope.usd_m_sequence == UsdMSequenceV1("42", "42", "41")
    assert envelope.partition_order_basis is PartitionOrderBasis.SOURCE_TRANSACTION_TIME
    assert envelope.partition_order_time_ns == (RECEIVE_MS - 4) * 1_000_000
    assert envelope.quality.gap_observed
    assert envelope.quality.drop_observed
    assert envelope.quality.restart_observed
    assert envelope.quality.reason_codes == (
        "CAPTURE_DROP",
        "CONNECTION_RESTART",
        "OWNER_PARTIAL",
        "SEQUENCE_GAP",
    )
    assert envelope.quality.as_mapping() == {
        "dropCount": 3,
        "dropObserved": True,
        "gapCount": 2,
        "gapObserved": True,
        "reasonCodes": list(envelope.quality.reason_codes),
        "restartCount": 1,
        "restartObserved": True,
    }
    assert envelope.as_mapping()["sequence"] == {
        "spot": None,
        "usdM": {"previousUpdateLast": "41", "updateFirst": "42", "updateLast": "42"},
    }


def test_partition_clock_precedence_is_explicit_without_clock_fabrication() -> None:
    source_event_only = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 5,
        kind="DEPTH_DELTA",
    )
    receive_only = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        kind="DEPTH_DELTA",
    )

    assert source_event_only.partition_order_basis is PartitionOrderBasis.SOURCE_EVENT_TIME
    assert source_event_only.partition_order_time_ns == (RECEIVE_MS - 5) * 1_000_000
    assert receive_only.partition_order_basis is PartitionOrderBasis.RECEIVE_WALL_TIME_AND_ORDINAL
    assert receive_only.partition_order_time_ns == RECEIVE_NS


def test_transaction_clock_is_projected_to_only_the_matching_semantic_clock() -> None:
    trade = _envelope(
        event_ms=RECEIVE_MS - 3,
        transaction_ms=RECEIVE_MS - 2,
        kind="TRADE",
    )
    depth = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        kind="DEPTH_DELTA",
    )
    assert trade.source_trade_time_ms == RECEIVE_MS - 2
    assert trade.source_update_time_ms is None
    assert depth.source_trade_time_ms is None
    assert depth.source_update_time_ms == RECEIVE_MS - 1


def test_arrow_schema_is_versioned_nullable_and_materializes_exact_product_shape() -> None:
    spot = _envelope()
    trade = _envelope(
        event_ms=RECEIVE_MS - 3,
        transaction_ms=RECEIVE_MS - 2,
        kind="TRADE",
    )
    depth = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        kind="DEPTH_DELTA",
    )
    schema = forward_capture_arrow_schema()

    assert schema is FORWARD_CAPTURE_SCHEMA
    assert schema.metadata is not None
    assert schema.metadata[b"q.contract_id"] == FORWARD_CAPTURE_SCHEMA_ID.encode()
    assert schema.metadata[b"q.schema_version"] == FORWARD_CAPTURE_SCHEMA_VERSION.encode()
    assert schema.metadata[b"q.nullable_source_time"] == b"TRUE"
    assert schema.metadata[b"q.semantic_source_clocks"] == (
        b"EVENT|TRADE_FROM_TRANSACTION_FOR_TRADE|UPDATE_FROM_TRANSACTION_FOR_DEPTH"
    )
    assert schema.metadata[b"q.payload_posture"] == b"HASH_BOUND_ONLY"
    assert schema.metadata[b"q.payload_materialization_state"] == b"MATERIALIZED_MISSING"
    assert schema.metadata[b"q.payload_schemas"] == (
        b"SPOT/BOOK_TICKER=BinanceSpotBookTickerHashPayloadV1|"
        b"SPOT/TRADE=BinanceSpotTradeHashPayloadV1|"
        b"USD_M_PERPETUAL/DEPTH_DELTA=BinanceUsdMDepthDeltaHashPayloadV1"
    )
    assert schema.metadata[b"q.storage_authority"] == b"NONE"
    assert schema.field("source_event_time_ms").nullable
    assert schema.field("source_transaction_time_ns").nullable
    assert schema.field("source_trade_time_ms").nullable
    assert schema.field("source_update_time_ns").nullable
    assert not schema.field("receive_wall_time_ns").nullable
    for field_name in (
        "payload_schema_id",
        "payload_schema_version",
        "payload_evidence_posture",
        "payload_materialization_state",
        "payload_normalized_evidence_sha256",
    ):
        assert not schema.field(field_name).nullable
    usd_m_sequence_type = schema.field("usd_m_sequence").type
    assert pa.types.is_struct(usd_m_sequence_type)
    assert not usd_m_sequence_type.field("previous_update_last").nullable
    assert (
        DigestV1(hashlib.sha256(schema.serialize().to_pybytes()).hexdigest())
        == FORWARD_CAPTURE_SCHEMA_FINGERPRINT
    )

    table = pa.Table.from_pylist(
        [spot.as_arrow_mapping(), trade.as_arrow_mapping(), depth.as_arrow_mapping()],
        schema=schema,
    )
    assert table.schema.equals(schema, check_metadata=True)
    rows = table.to_pylist()
    assert rows[0]["source_event_time_ms"] is None
    assert rows[0]["source_trade_time_ms"] is None
    assert rows[0]["source_update_time_ns"] is None
    assert rows[0]["payload_schema_id"] == SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID
    assert rows[0]["payload_schema_version"] == PAYLOAD_SCHEMA_VERSION
    assert rows[0]["payload_evidence_posture"] == "HASH_BOUND_ONLY"
    assert rows[0]["payload_materialization_state"] == "MATERIALIZED_MISSING"
    assert rows[0]["payload_normalized_evidence_sha256"] == (
        spot.normalized_evidence_digest.to_bytes()
    )
    assert rows[0]["spot_sequence"] == {"update_first": "42", "update_last": "42"}
    assert rows[0]["usd_m_sequence"] is None
    assert rows[1]["source_trade_time_ms"] == RECEIVE_MS - 2
    assert rows[1]["source_trade_time_ns"] == (RECEIVE_MS - 2) * 1_000_000
    assert rows[1]["source_update_time_ms"] is None
    assert rows[1]["payload_schema_id"] == SPOT_TRADE_PAYLOAD_SCHEMA_ID
    assert rows[2]["source_trade_time_ms"] is None
    assert rows[2]["source_update_time_ms"] == RECEIVE_MS - 1
    assert rows[2]["source_update_time_ns"] == (RECEIVE_MS - 1) * 1_000_000
    assert rows[2]["payload_schema_id"] == USD_M_DEPTH_DELTA_PAYLOAD_SCHEMA_ID
    assert rows[2]["spot_sequence"] is None
    assert rows[2]["usd_m_sequence"] == {
        "previous_update_last": "41",
        "update_first": "42",
        "update_last": "42",
    }
    assert rows[0]["raw_payload_sha256"] == spot.raw_payload_digest.to_bytes()


def test_spot_mi_shape_is_compatible_but_operational_capture_is_blocked() -> None:
    status = SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY

    assert _envelope().evidence.kind == "BOOK_TICKER"
    assert status.semantic_mi_bridge is CompatibilityState.COMPATIBLE
    assert status.operational_capture is CompatibilityState.INCOMPATIBLE
    assert status.real_delivery_state is RealDeliveryState.MISSING
    assert status.integration_state is IntegrationState.BLOCKED
    assert status.producer_owner == "intelligenceRuntime"
    assert status.queue_policy == FORWARD_CAPTURE_QUEUE_POLICY == "DROP_NEW"
    assert status.authority == "READ_ONLY_RESEARCH_FIXTURE"
    assert status.missing_operational_fields == (
        "gapDropRestartEvidence",
        "persistenceTimeNs",
        "processingTimeNs",
        "qDeliveryPort",
        "receiveMonotonicNs",
        "receiveOrdinal",
    )


def test_drop_new_queue_never_evicts_or_waits_for_retained_capture() -> None:
    first = _envelope(sidecar=_sidecar(ordinal=1))
    second = _envelope(sidecar=_sidecar(ordinal=2))
    queue = DropNewCaptureQueue(capacity=1)

    accepted = queue.try_offer(first)
    dropped = queue.try_offer(second)

    assert accepted.state is QueueOfferState.ENQUEUED
    assert accepted.accepted
    assert accepted.depth == 1
    assert accepted.capacity == queue.capacity == 1
    assert dropped.state is QueueOfferState.DROPPED_NEW
    assert not dropped.accepted
    assert dropped.depth == queue.depth == 1
    assert dropped.dropped_total == queue.dropped_total == 1
    assert queue.drain(0) == ()
    assert queue.depth == 1
    assert queue.drain(1) == (first,)
    assert queue.depth == 0
    assert queue.dropped_total == 1
    assert queue.try_offer(second).accepted
    assert queue.drain(1) == (second,)


@pytest.mark.parametrize(
    ("first", "last", "previous"),
    [
        ("", "1", None),
        ("01", "1", None),
        ("1", "01", None),
        ("-1", "1", None),
        ("1", "1", "01"),
        ("1" * 65, "1" * 65, None),
        ("2", "1", None),
        ("1", "2", "3"),
    ],
)
def test_runtime_sequence_rejects_noncanonical_or_incoherent_ids(
    first: str,
    last: str,
    previous: str | None,
) -> None:
    with pytest.raises(ContractValueError):
        CanonicalRuntimeSequenceV1(first, last, previous)


def test_runtime_sequence_mapping_and_product_sequence_mappings_are_exact() -> None:
    sequence = _sequence("40", "42", "39")
    assert sequence.as_mapping() == {"first": "40", "last": "42", "previous": "39"}
    assert SpotSequenceV1("40", "42").as_mapping() == {
        "updateFirst": "40",
        "updateLast": "42",
    }
    assert UsdMSequenceV1("40", "42", "39").as_mapping() == {
        "previousUpdateLast": "39",
        "updateFirst": "40",
        "updateLast": "42",
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"source_id": "/bad"},
        {"connection_generation": -1},
        {"connection_generation": True},
        {"connection_generation": INT64_MAX + 1},
        {"product_family": "SPOT"},
        {"endpoint_class": "PUBLIC"},
        {"stream": ""},
        {"stream": "x" * 2_049},
        {"stream": "\ud800"},
        {"source_event_time_ms": 1},
        {"source_transaction_time_ms": 1},
        {"receive_time_ms": 1},
        {"sequence": "42"},
        {"correlation_id": "bad/id"},
    ],
)
def test_runtime_projection_rejects_invalid_owner_fields(changes: dict[str, object]) -> None:
    with pytest.raises(ContractValueError):
        replace(_runtime(), **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "changes",
    [
        {"evidence_id": "/bad"},
        {"kind": "book_ticker"},
        {"kind": "A" * 65},
        {"instrument_id": "bad/id"},
        {"symbol": ""},
        {"symbol": "x" * 129},
        {"product_family": "SPOT"},
        {"source_id": "bad/id"},
        {"endpoint_class": "PUBLIC"},
        {"schema_version": "bad/id"},
        {"producer_version": "bad/id"},
        {"configuration_version": "bad/id"},
        {"source_event_time_ms": 1},
        {"source_transaction_time_ms": 1},
        {"received_time_ms": 1},
        {"sequence": "42"},
        {"source_record_ids": []},
        {"source_record_ids": ()},
        {"source_record_ids": tuple(f"record.{index}" for index in range(129))},
        {"source_record_ids": ("bad/id",)},
        {"source_record_ids": ("record.2", "record.1")},
        {"source_record_ids": ("record.1", "record.1")},
    ],
)
def test_normalized_evidence_projection_rejects_invalid_truth_fields(
    changes: dict[str, object],
) -> None:
    runtime = _runtime()
    with pytest.raises(ContractValueError):
        replace(_evidence(runtime), **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "changes",
    [
        {"session_id": "bad/id"},
        {"receive_monotonic_ns": -1},
        {"receive_monotonic_ns": True},
        {"receive_monotonic_ns": INT64_MAX + 1},
        {"receive_ordinal": -1},
        {"receive_ordinal": True},
        {"receive_ordinal": INT64_MAX + 1},
        {"processing_time_ns": 1},
        {"persistence_time_ns": UTC_NS_MAX + 1},
        {"processing_time_ns": RECEIVE_NS + 30},
        {"gap_count": -1},
        {"drop_count": True},
        {"restart_count": INT64_MAX + 1},
        {"observed_reason_codes": []},
        {"observed_reason_codes": tuple(f"REASON_{index}" for index in range(30))},
        {"observed_reason_codes": ("bad",)},
        {"observed_reason_codes": ("Z_REASON", "A_REASON")},
        {"observed_reason_codes": ("A_REASON", "A_REASON")},
    ],
)
def test_q_sidecar_rejects_invalid_or_ambiguous_capture_fields(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(_sidecar(), **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "changes",
    [
        {"gap_count": -1},
        {"drop_count": True},
        {"restart_count": INT64_MAX + 1},
        {"reason_codes": []},
        {"reason_codes": tuple(f"REASON_{index}" for index in range(33))},
        {"reason_codes": ("bad",)},
        {"reason_codes": ("Z_REASON", "A_REASON")},
        {"reason_codes": ("A_REASON", "A_REASON")},
        {"gap_count": 1, "reason_codes": ()},
        {"drop_count": 1, "reason_codes": ()},
        {"restart_count": 1, "reason_codes": ()},
        {"gap_count": 0, "reason_codes": ("SEQUENCE_GAP",)},
        {"drop_count": 0, "reason_codes": ("CAPTURE_DROP",)},
        {"restart_count": 0, "reason_codes": ("CONNECTION_RESTART",)},
    ],
)
def test_capture_quality_cannot_disagree_with_gap_drop_restart_counters(
    changes: dict[str, object],
) -> None:
    base = CaptureQualityEvidenceV1(0, 0, 0, ())
    with pytest.raises(ContractValueError):
        replace(base, **changes)  # type: ignore[arg-type]


def test_owner_coherence_rejects_crossed_runtime_and_normalized_truth() -> None:
    runtime = _runtime()
    evidence = _evidence(runtime)
    invalid_evidence = (
        replace(evidence, source_id="other.source"),
        replace(evidence, product_family=ForwardProduct.USD_M_PERPETUAL),
        replace(evidence, endpoint_class=ForwardEndpointClass.MARKET),
        replace(evidence, source_event_time_ms=RECEIVE_MS - 1),
        replace(evidence, source_transaction_time_ms=RECEIVE_MS - 1),
        replace(evidence, received_time_ms=RECEIVE_MS - 1),
        replace(evidence, sequence=None),
        replace(evidence, sequence=_sequence("43", "43")),
    )
    for candidate in invalid_evidence:
        with pytest.raises(ContractValueError):
            adapt_runtime_evidence_fixture(
                runtime,
                candidate,
                _sidecar(),
                raw_payload_bytes=b"raw",
                normalized_evidence_bytes=b"normalized",
            )

    runtime_without_sequence = replace(runtime, sequence=None)
    evidence_with_sequence = _evidence(runtime)
    with pytest.raises(ContractValueError):
        adapt_runtime_evidence_fixture(
            runtime_without_sequence,
            evidence_with_sequence,
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )


def test_spot_and_usd_m_sequence_semantics_cannot_be_conflated() -> None:
    spot_runtime = replace(_runtime(), sequence=_sequence(previous="41"))
    spot_evidence = _evidence(spot_runtime)
    with pytest.raises(ContractValueError, match="Spot sequence"):
        adapt_runtime_evidence_fixture(
            spot_runtime,
            spot_evidence,
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )

    no_sequence = replace(_runtime(product=ForwardProduct.USD_M_PERPETUAL), sequence=None)
    with pytest.raises(ContractValueError, match="explicit sequence"):
        adapt_runtime_evidence_fixture(
            no_sequence,
            replace(_evidence(no_sequence, kind="DEPTH_DELTA"), sequence=None),
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )


def test_usd_m_owner_coherence_compares_previous_update_pu_exactly() -> None:
    runtime = _runtime(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        sequence=_sequence("42", "43", "41"),
    )
    evidence = _evidence(
        runtime,
        kind="DEPTH_DELTA",
        sequence=_sequence("42", "43", "40"),
    )

    with pytest.raises(ContractValueError, match="U/u/pu"):
        adapt_runtime_evidence_fixture(
            runtime,
            evidence,
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )


def test_usd_m_public_depth_delta_requires_non_null_previous_update_pu() -> None:
    runtime = _runtime(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        sequence=_sequence("42", "43", None),
    )

    with pytest.raises(ContractValueError, match="non-null pu"):
        adapt_runtime_evidence_fixture(
            runtime,
            _evidence(runtime, kind="DEPTH_DELTA"),
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )


def test_spot_book_ticker_rejects_fabricated_exchange_clocks() -> None:
    runtime = _runtime(event_ms=RECEIVE_MS - 1)
    with pytest.raises(ContractValueError, match="must be null"):
        adapt_runtime_evidence_fixture(
            runtime,
            _evidence(runtime),
            _sidecar(),
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )


@pytest.mark.parametrize(
    ("runtime", "evidence", "sidecar", "raw", "normalized"),
    [
        (
            cast(CanonicalRuntimeSourceEventV1, object()),
            _evidence(_runtime()),
            _sidecar(),
            b"r",
            b"n",
        ),
        (_runtime(), cast(CanonicalNormalizedEvidenceV1, object()), _sidecar(), b"r", b"n"),
        (_runtime(), _evidence(_runtime()), cast(QCaptureSidecarV1, object()), b"r", b"n"),
        (_runtime(), _evidence(_runtime()), _sidecar(), b"", b"n"),
        (_runtime(), _evidence(_runtime()), _sidecar(), cast(bytes, bytearray(b"r")), b"n"),
        (_runtime(), _evidence(_runtime()), _sidecar(), b"r", b""),
        (_runtime(), _evidence(_runtime()), _sidecar(), b"r", cast(bytes, bytearray(b"n"))),
    ],
)
def test_adapter_requires_exact_typed_immutable_inputs(
    runtime: CanonicalRuntimeSourceEventV1,
    evidence: CanonicalNormalizedEvidenceV1,
    sidecar: QCaptureSidecarV1,
    raw: bytes,
    normalized: bytes,
) -> None:
    with pytest.raises(ContractValueError):
        adapt_runtime_evidence_fixture(
            runtime,
            evidence,
            sidecar,
            raw_payload_bytes=raw,
            normalized_evidence_bytes=normalized,
        )


def test_adapter_rejects_processing_before_receive_wall_clock() -> None:
    runtime = _runtime()
    sidecar = QCaptureSidecarV1(
        session_id="session.1",
        receive_monotonic_ns=1,
        receive_ordinal=1,
        processing_time_ns=RECEIVE_NS - 1,
        persistence_time_ns=RECEIVE_NS + 1,
    )
    with pytest.raises(ContractValueError, match="must not precede"):
        adapt_runtime_evidence_fixture(
            runtime,
            _evidence(runtime),
            sidecar,
            raw_payload_bytes=b"raw",
            normalized_evidence_bytes=b"normalized",
        )


def test_direct_envelope_rejects_processing_before_receive_with_recomputed_id() -> None:
    envelope = _envelope()
    invalid_sidecar = replace(
        envelope.sidecar,
        processing_time_ns=RECEIVE_NS - 1,
    )
    recomputed_capture_id = _capture_id(
        envelope.runtime,
        envelope.evidence,
        invalid_sidecar,
        envelope.raw_payload_digest,
        envelope.normalized_evidence_digest,
        envelope.payload_schema,
        envelope.quality,
    )

    with pytest.raises(ContractValueError, match="must not precede receive wall time"):
        replace(
            envelope,
            capture_id=recomputed_capture_id,
            sidecar=invalid_sidecar,
        )


@pytest.mark.parametrize("capacity", [0, -1, True, MAX_QUEUE_CAPACITY + 1])
def test_drop_new_queue_capacity_is_strict_and_bounded(capacity: int) -> None:
    with pytest.raises(ContractValueError):
        DropNewCaptureQueue(capacity)


def test_drop_new_queue_rejects_non_capture_and_invalid_drain_bounds() -> None:
    queue = DropNewCaptureQueue(2)
    with pytest.raises(ContractValueError):
        queue.try_offer(cast(ForwardCaptureEnvelopeV1, object()))
    for maximum in (-1, True, 3):
        with pytest.raises(ContractValueError):
            queue.drain(maximum)


@pytest.mark.parametrize(
    "changes",
    [
        {"producer_owner": "other"},
        {"semantic_mi_bridge": CompatibilityState.INCOMPATIBLE},
        {"operational_capture": CompatibilityState.COMPATIBLE},
        {"real_delivery_state": cast(RealDeliveryState, "AVAILABLE")},
        {"integration_state": cast(IntegrationState, "READY")},
        {"missing_operational_fields": ()},
        {"missing_operational_fields": ("z", "a")},
        {"missing_operational_fields": ("a", "a")},
        {"queue_policy": "BLOCK"},
        {"authority": "OPERATIONAL"},
    ],
)
def test_bridge_compatibility_cannot_claim_missing_operational_delivery(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(
            SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY,
            **changes,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"capture_id": "bad/id"},
        {"runtime": object()},
        {"evidence": object()},
        {"sidecar": object()},
        {"partition_order_basis": "RECEIVE_WALL_TIME_AND_ORDINAL"},
        {"partition_order_time_ns": 1},
        {"spot_sequence": None, "usd_m_sequence": None},
        {
            "spot_sequence": SpotSequenceV1("42", "42"),
            "usd_m_sequence": UsdMSequenceV1("42", "42", "41"),
        },
        {"raw_payload_digest": object()},
        {"normalized_evidence_digest": object()},
        {"payload_schema": object()},
        {"quality": object()},
        {"schema_version": "v2"},
        {"producer_owner": "other"},
        {"posture": cast(CapturePosture, "REAL")},
        {"real_delivery_state": cast(RealDeliveryState, "AVAILABLE")},
        {"integration_state": cast(IntegrationState, "READY")},
    ],
)
def test_forward_envelope_cannot_expand_q03_authority(changes: dict[str, object]) -> None:
    with pytest.raises(ContractValueError):
        replace(_envelope(), **changes)  # type: ignore[arg-type]


def test_forward_envelope_requires_the_product_specific_sequence_variant() -> None:
    spot = _envelope()
    usd_m = _envelope(
        product=ForwardProduct.USD_M_PERPETUAL,
        event_ms=RECEIVE_MS - 2,
        transaction_ms=RECEIVE_MS - 1,
        kind="DEPTH_DELTA",
    )
    with pytest.raises(ContractValueError, match="Spot envelopes"):
        replace(spot, spot_sequence=None, usd_m_sequence=UsdMSequenceV1("42", "42", "41"))
    with pytest.raises(ContractValueError, match="USD-M envelopes"):
        replace(usd_m, spot_sequence=SpotSequenceV1("42", "42"), usd_m_sequence=None)


def test_bridge_compatibility_constructor_accepts_only_the_frozen_q03_truth() -> None:
    status = BridgeCompatibilityV1(
        producer_owner=FORWARD_CAPTURE_PRODUCER_OWNER,
        semantic_mi_bridge=CompatibilityState.COMPATIBLE,
        operational_capture=CompatibilityState.INCOMPATIBLE,
        real_delivery_state=RealDeliveryState.MISSING,
        integration_state=IntegrationState.BLOCKED,
        missing_operational_fields=("fieldA",),
        queue_policy=FORWARD_CAPTURE_QUEUE_POLICY,
        authority="READ_ONLY_RESEARCH_FIXTURE",
    )
    assert status.missing_operational_fields == ("fieldA",)
