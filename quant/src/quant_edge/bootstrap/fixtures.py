"""Deterministic synthetic-only forward bridge fixtures for the Q03 atlas tier."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from quant_edge.bootstrap.bridge import (
    FORWARD_CAPTURE_SCHEMA_FINGERPRINT,
    SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY,
    BridgeCompatibilityV1,
    CanonicalNormalizedEvidenceV1,
    CanonicalRuntimeSequenceV1,
    CanonicalRuntimeSourceEventV1,
    ForwardCaptureEnvelopeV1,
    ForwardEndpointClass,
    ForwardProduct,
    QCaptureSidecarV1,
    adapt_runtime_evidence_fixture,
)
from quant_edge.bootstrap.sources import (
    RUNTIME_BRIDGE_TYPES_SHA256,
    RUNTIME_CAPTURE_TYPES_SHA256,
    RUNTIME_CONTRACT_SHA256,
    RUNTIME_FUTURES_TYPES_SHA256,
    RUNTIME_SPOT_TYPES_SHA256,
)
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1

FOUNDATION_CONTRACT_TYPES_SHA256 = (
    "7eb6b169cdf3a2d59e2ceccc000c8c9668d79a3b2aac6fbbe21c32e836f5d60d"
)


@dataclass(frozen=True, slots=True)
class ForwardFixtureSetV1:
    envelopes: tuple[ForwardCaptureEnvelopeV1, ...]
    schema_fingerprint: DigestV1 = FORWARD_CAPTURE_SCHEMA_FINGERPRINT
    compatibility: BridgeCompatibilityV1 = SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY

    def __post_init__(self) -> None:
        if not isinstance(self.envelopes, tuple) or len(self.envelopes) != 3:
            raise ContractValueError("Q03 requires exactly three immutable forward fixtures")
        if any(not isinstance(item, ForwardCaptureEnvelopeV1) for item in self.envelopes):
            raise ContractValueError("forward fixtures must contain ForwardCaptureEnvelopeV1")
        keys = tuple(item.canonical_order_key for item in self.envelopes)
        if keys != tuple(sorted(set(keys))):
            raise ContractValueError("forward fixtures must be sorted with unique order keys")
        families = tuple(
            (item.runtime.product_family.value, item.evidence.kind) for item in self.envelopes
        )
        if set(families) != {
            ("SPOT", "BOOK_TICKER"),
            ("SPOT", "TRADE"),
            ("USD_M_PERPETUAL", "DEPTH_DELTA"),
        }:
            raise ContractValueError("forward fixtures must cover the fixed Q03 product/event set")
        if self.schema_fingerprint != FORWARD_CAPTURE_SCHEMA_FINGERPRINT:
            raise ContractValueError("fixture set must bind the exact forward schema fingerprint")
        if self.compatibility != SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY:
            raise ContractValueError("fixture set must preserve the exact bridge compatibility")

    def as_mapping(self) -> dict[str, object]:
        compatibility = self.compatibility
        runtime_digests = tuple(
            sorted(
                {
                    FOUNDATION_CONTRACT_TYPES_SHA256,
                    RUNTIME_BRIDGE_TYPES_SHA256,
                    RUNTIME_CAPTURE_TYPES_SHA256,
                    RUNTIME_CONTRACT_SHA256,
                    RUNTIME_FUTURES_TYPES_SHA256,
                    RUNTIME_SPOT_TYPES_SHA256,
                }
            )
        )
        return {
            "authority": "READ_ONLY_RESEARCH_FIXTURE",
            "compatibility": {
                "integrationState": compatibility.integration_state.value,
                "missingOperationalFields": list(compatibility.missing_operational_fields),
                "operationalCapture": compatibility.operational_capture.value,
                "producerOwner": compatibility.producer_owner,
                "queuePolicy": compatibility.queue_policy,
                "realDeliveryState": compatibility.real_delivery_state.value,
                "semanticMiBridge": compatibility.semantic_mi_bridge.value,
            },
            "fixtures": [item.as_mapping() for item in self.envelopes],
            "notice": (
                "SYNTHETIC_ONLY: contract fixtures are not observed market evidence and do not "
                "prove real Q delivery."
            ),
            "realMarketCoverage": "MISSING/BLOCKED",
            "runtimeTypeSha256": list(runtime_digests),
            "schema": "Q03ForwardFixtureSetV1",
            "schemaFingerprintSha256": self.schema_fingerprint.hexdigest,
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


def _runtime_and_evidence(
    *,
    source_id: str,
    product: ForwardProduct,
    endpoint: ForwardEndpointClass,
    stream: str,
    kind: str,
    symbol: str,
    generation: int,
    source_event_ms: int | None,
    source_transaction_ms: int | None,
    receive_ms: int,
    sequence: CanonicalRuntimeSequenceV1,
    ordinal: int,
) -> tuple[CanonicalRuntimeSourceEventV1, CanonicalNormalizedEvidenceV1, QCaptureSidecarV1]:
    suffix = f"{product.value.lower()}.{kind.lower()}.{ordinal}"
    runtime = CanonicalRuntimeSourceEventV1(
        source_id=source_id,
        connection_generation=generation,
        product_family=product,
        endpoint_class=endpoint,
        stream=stream,
        source_event_time_ms=source_event_ms,
        source_transaction_time_ms=source_transaction_ms,
        receive_time_ms=receive_ms,
        sequence=sequence,
        correlation_id=f"q03.synthetic.correlation.{suffix}",
    )
    evidence = CanonicalNormalizedEvidenceV1(
        evidence_id=f"q03.synthetic.evidence.{suffix}",
        kind=kind,
        instrument_id=f"q03.synthetic.instrument.{symbol}",
        symbol=symbol,
        product_family=product,
        source_id=source_id,
        endpoint_class=endpoint,
        schema_version="foundation.v1",
        producer_version="intelligenceRuntime.fixture.v1",
        configuration_version="q03.fixture.v1",
        source_event_time_ms=source_event_ms,
        source_transaction_time_ms=source_transaction_ms,
        received_time_ms=receive_ms,
        sequence=sequence,
        source_record_ids=(f"q03.synthetic.source.{suffix}",),
    )
    sidecar = QCaptureSidecarV1(
        session_id=f"q03.synthetic.session.{generation}",
        receive_monotonic_ns=1_000_000 + ordinal,
        receive_ordinal=ordinal,
        processing_time_ns=receive_ms * 1_000_000 + 100,
        persistence_time_ns=receive_ms * 1_000_000 + 200,
        gap_count=1 if kind == "DEPTH_DELTA" else 0,
        drop_count=1 if kind == "DEPTH_DELTA" else 0,
        restart_count=1 if kind == "DEPTH_DELTA" else 0,
        observed_reason_codes=("SYNTHETIC_FIXTURE_ONLY",),
    )
    return runtime, evidence, sidecar


def build_q03_forward_fixture_set() -> ForwardFixtureSetV1:
    base_ms = 1_783_814_400_000
    inputs = (
        _runtime_and_evidence(
            source_id="binance-spot-market-stream",
            product=ForwardProduct.SPOT,
            endpoint=ForwardEndpointClass.PUBLIC,
            stream="bnbusdt@bookTicker",
            kind="BOOK_TICKER",
            symbol="BNBUSDT",
            generation=1,
            source_event_ms=None,
            source_transaction_ms=None,
            receive_ms=base_ms,
            sequence=CanonicalRuntimeSequenceV1("42", "42", None),
            ordinal=1,
        ),
        _runtime_and_evidence(
            source_id="binance-spot-market-stream",
            product=ForwardProduct.SPOT,
            endpoint=ForwardEndpointClass.PUBLIC,
            stream="bnbusdt@aggTrade",
            kind="TRADE",
            symbol="BNBUSDT",
            generation=1,
            source_event_ms=base_ms,
            source_transaction_ms=base_ms,
            receive_ms=base_ms + 1,
            sequence=CanonicalRuntimeSequenceV1("100", "101", None),
            ordinal=2,
        ),
        _runtime_and_evidence(
            source_id="binance-usdm-public-depth",
            product=ForwardProduct.USD_M_PERPETUAL,
            endpoint=ForwardEndpointClass.PUBLIC,
            stream="bnbusdt@depth@100ms",
            kind="DEPTH_DELTA",
            symbol="BNBUSDT",
            generation=2,
            source_event_ms=base_ms + 2,
            source_transaction_ms=base_ms + 2,
            receive_ms=base_ms + 3,
            sequence=CanonicalRuntimeSequenceV1("200", "201", "199"),
            ordinal=0,
        ),
    )
    envelopes = tuple(
        sorted(
            (
                adapt_runtime_evidence_fixture(
                    runtime,
                    evidence,
                    sidecar,
                    raw_payload_bytes=canonical_json_bytes(
                        {"fixture": evidence.evidence_id, "raw": True}
                    ),
                    normalized_evidence_bytes=canonical_json_bytes(
                        {"fixture": evidence.evidence_id, "normalized": True}
                    ),
                )
                for runtime, evidence, sidecar in inputs
            ),
            key=lambda item: item.canonical_order_key,
        )
    )
    return ForwardFixtureSetV1(envelopes=envelopes)
