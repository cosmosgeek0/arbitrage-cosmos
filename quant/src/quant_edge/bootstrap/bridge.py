from __future__ import annotations

import hashlib
import re
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Final

import pyarrow as pa  # type: ignore[import-untyped]

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)
from quant_edge.primitives import require_utc_millis

FORWARD_CAPTURE_SCHEMA_ID: Final = "Q03ForwardCaptureEnvelopeV1"
FORWARD_CAPTURE_SCHEMA_VERSION: Final = "v1"
FORWARD_CAPTURE_PRODUCER_OWNER: Final = "intelligenceRuntime"
FORWARD_CAPTURE_QUEUE_POLICY: Final = "DROP_NEW"
PAYLOAD_SCHEMA_VERSION: Final = "v1"
SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID: Final = "BinanceSpotBookTickerHashPayloadV1"
SPOT_TRADE_PAYLOAD_SCHEMA_ID: Final = "BinanceSpotTradeHashPayloadV1"
USD_M_DEPTH_DELTA_PAYLOAD_SCHEMA_ID: Final = "BinanceUsdMDepthDeltaHashPayloadV1"
MAX_SEQUENCE_DIGITS: Final = 64
MAX_STREAM_LENGTH: Final = 2_048
MAX_SOURCE_RECORD_IDS: Final = 128
MAX_REASON_CODES: Final = 32
MAX_QUEUE_CAPACITY: Final = 65_536

_SEQUENCE_PATTERN = re.compile(r"^(?:0|[1-9][0-9]{0,63})$")
_EVENT_KIND_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class ForwardProduct(StrEnum):
    SPOT = "SPOT"
    USD_M_PERPETUAL = "USD_M_PERPETUAL"


class ForwardEndpointClass(StrEnum):
    PUBLIC = "PUBLIC"
    MARKET = "MARKET"


class PartitionOrderBasis(StrEnum):
    SOURCE_EVENT_TIME = "SOURCE_EVENT_TIME"
    SOURCE_TRANSACTION_TIME = "SOURCE_TRANSACTION_TIME"
    RECEIVE_WALL_TIME_AND_ORDINAL = "RECEIVE_WALL_TIME_AND_ORDINAL"


class RealDeliveryState(StrEnum):
    MISSING = "MISSING"


class IntegrationState(StrEnum):
    BLOCKED = "BLOCKED"


class CompatibilityState(StrEnum):
    COMPATIBLE = "COMPATIBLE"
    INCOMPATIBLE = "INCOMPATIBLE"


class CapturePosture(StrEnum):
    SYNTHETIC_FIXTURE = "SYNTHETIC_FIXTURE"


class PayloadEvidencePosture(StrEnum):
    HASH_BOUND_ONLY = "HASH_BOUND_ONLY"


class PayloadMaterializationState(StrEnum):
    MATERIALIZED_MISSING = "MATERIALIZED_MISSING"


class QueueOfferState(StrEnum):
    ENQUEUED = "ENQUEUED"
    DROPPED_NEW = "DROPPED_NEW"


_SUPPORTED_PAYLOAD_SCHEMAS: Final[
    Mapping[tuple[ForwardProduct, ForwardEndpointClass, str], str]
] = MappingProxyType(
    {
        (ForwardProduct.SPOT, ForwardEndpointClass.PUBLIC, "BOOK_TICKER"): (
            SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID
        ),
        (ForwardProduct.SPOT, ForwardEndpointClass.PUBLIC, "TRADE"): (SPOT_TRADE_PAYLOAD_SCHEMA_ID),
        (
            ForwardProduct.USD_M_PERPETUAL,
            ForwardEndpointClass.PUBLIC,
            "DEPTH_DELTA",
        ): USD_M_DEPTH_DELTA_PAYLOAD_SCHEMA_ID,
    }
)


def _require_bounded_text(value: object, *, field: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ContractValueError(f"{field} must be non-empty text of at most {maximum} characters")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ContractValueError(f"{field} must be valid UTF-8 text") from error
    return value


def _require_sequence_id(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SEQUENCE_PATTERN.fullmatch(value) is None:
        raise ContractValueError(
            f"{field} must be a canonical unsigned decimal string of at most "
            f"{MAX_SEQUENCE_DIGITS} digits"
        )
    return value


def _require_event_kind(value: object) -> str:
    if not isinstance(value, str) or _EVENT_KIND_PATTERN.fullmatch(value) is None:
        raise ContractValueError("kind must be a bounded uppercase event identifier")
    return value


def _payload_schema_id(
    product: ForwardProduct,
    endpoint: ForwardEndpointClass,
    kind: str,
) -> str:
    schema_id = _SUPPORTED_PAYLOAD_SCHEMAS.get((product, endpoint, kind))
    if schema_id is None:
        raise ContractValueError(
            f"unsupported Q03 payload schema for {product.value}/{endpoint.value}/{kind}"
        )
    return schema_id


def _require_bytes(value: object, *, field: str) -> bytes:
    if type(value) is not bytes or not value:
        raise ContractValueError(f"{field} must be non-empty immutable bytes")
    return value


def _require_ns(value: object, *, field: str, utc: bool) -> int:
    minimum = UTC_NS_MIN if utc else 0
    maximum = UTC_NS_MAX if utc else INT64_MAX
    return require_strict_int(value, field=field, minimum=minimum, maximum=maximum)


def _ms_to_ns(value: int | None) -> int | None:
    return None if value is None else value * 1_000_000


@dataclass(frozen=True, slots=True)
class CanonicalRuntimeSequenceV1:
    """Read-only projection of canonical ``RuntimeSequence``."""

    first: str
    last: str
    previous: str | None

    def __post_init__(self) -> None:
        first = _require_sequence_id(self.first, field="sequence.first")
        last = _require_sequence_id(self.last, field="sequence.last")
        if int(first) > int(last):
            raise ContractValueError("sequence.first must not exceed sequence.last")
        if self.previous is not None:
            previous = _require_sequence_id(self.previous, field="sequence.previous")
            if int(previous) > int(last):
                raise ContractValueError("sequence.previous must not exceed sequence.last")

    def as_mapping(self) -> dict[str, object]:
        return {"first": self.first, "last": self.last, "previous": self.previous}


@dataclass(frozen=True, slots=True)
class CanonicalRuntimeSourceEventV1:
    """Pure fixture projection of the canonical RuntimeSourceEvent owner type."""

    source_id: str
    connection_generation: int
    product_family: ForwardProduct
    endpoint_class: ForwardEndpointClass
    stream: str
    source_event_time_ms: int | None
    source_transaction_time_ms: int | None
    receive_time_ms: int
    sequence: CanonicalRuntimeSequenceV1 | None
    correlation_id: str

    def __post_init__(self) -> None:
        require_contract_id(self.source_id, field="source_id")
        require_strict_int(
            self.connection_generation,
            field="connection_generation",
            minimum=0,
            maximum=INT64_MAX,
        )
        if not isinstance(self.product_family, ForwardProduct):
            raise ContractValueError("product_family must be an explicit ForwardProduct")
        if not isinstance(self.endpoint_class, ForwardEndpointClass):
            raise ContractValueError("endpoint_class must be a public read-only endpoint class")
        _require_bounded_text(self.stream, field="stream", maximum=MAX_STREAM_LENGTH)
        if self.source_event_time_ms is not None:
            require_utc_millis(self.source_event_time_ms, field="source_event_time_ms")
        if self.source_transaction_time_ms is not None:
            require_utc_millis(
                self.source_transaction_time_ms,
                field="source_transaction_time_ms",
            )
        require_utc_millis(self.receive_time_ms, field="receive_time_ms")
        if self.sequence is not None and not isinstance(self.sequence, CanonicalRuntimeSequenceV1):
            raise ContractValueError("sequence must be CanonicalRuntimeSequenceV1 or null")
        require_contract_id(self.correlation_id, field="correlation_id")

    def as_identity_mapping(self) -> dict[str, object]:
        return {
            "connectionGeneration": self.connection_generation,
            "correlationId": self.correlation_id,
            "endpointClass": self.endpoint_class.value,
            "productFamily": self.product_family.value,
            "receiveTimeMs": self.receive_time_ms,
            "sequence": None if self.sequence is None else self.sequence.as_mapping(),
            "sourceEventTimeMs": self.source_event_time_ms,
            "sourceId": self.source_id,
            "sourceTransactionTimeMs": self.source_transaction_time_ms,
            "stream": self.stream,
        }


@dataclass(frozen=True, slots=True)
class CanonicalNormalizedEvidenceV1:
    """Typed metadata projection of canonical ``NormalizedEvidence`` truth."""

    evidence_id: str
    kind: str
    instrument_id: str
    symbol: str
    product_family: ForwardProduct
    source_id: str
    endpoint_class: ForwardEndpointClass
    schema_version: str
    producer_version: str
    configuration_version: str
    source_event_time_ms: int | None
    source_transaction_time_ms: int | None
    received_time_ms: int
    sequence: CanonicalRuntimeSequenceV1 | None
    source_record_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.evidence_id, field="evidence_id")
        _require_event_kind(self.kind)
        require_contract_id(self.instrument_id, field="instrument_id")
        _require_bounded_text(self.symbol, field="symbol", maximum=128)
        if not isinstance(self.product_family, ForwardProduct):
            raise ContractValueError("product_family must be an explicit ForwardProduct")
        require_contract_id(self.source_id, field="source_id")
        if not isinstance(self.endpoint_class, ForwardEndpointClass):
            raise ContractValueError("endpoint_class must be a public read-only endpoint class")
        for field_name in ("schema_version", "producer_version", "configuration_version"):
            require_contract_id(getattr(self, field_name), field=field_name)
        if self.source_event_time_ms is not None:
            require_utc_millis(self.source_event_time_ms, field="source_event_time_ms")
        if self.source_transaction_time_ms is not None:
            require_utc_millis(
                self.source_transaction_time_ms,
                field="source_transaction_time_ms",
            )
        require_utc_millis(self.received_time_ms, field="received_time_ms")
        if self.sequence is not None and not isinstance(self.sequence, CanonicalRuntimeSequenceV1):
            raise ContractValueError("sequence must be CanonicalRuntimeSequenceV1 or null")
        if (
            not isinstance(self.source_record_ids, tuple)
            or not self.source_record_ids
            or len(self.source_record_ids) > MAX_SOURCE_RECORD_IDS
        ):
            raise ContractValueError(
                f"source_record_ids must be a tuple of 1..{MAX_SOURCE_RECORD_IDS} identifiers"
            )
        normalized = tuple(
            sorted(
                {
                    require_contract_id(record_id, field="source_record_ids")
                    for record_id in self.source_record_ids
                }
            )
        )
        if normalized != self.source_record_ids:
            raise ContractValueError("source_record_ids must be sorted and unique")

    def as_identity_mapping(self) -> dict[str, object]:
        return {
            "configurationVersion": self.configuration_version,
            "endpointClass": self.endpoint_class.value,
            "evidenceId": self.evidence_id,
            "instrumentId": self.instrument_id,
            "kind": self.kind,
            "producerVersion": self.producer_version,
            "productFamily": self.product_family.value,
            "receivedTimeMs": self.received_time_ms,
            "schemaVersion": self.schema_version,
            "sequence": None if self.sequence is None else self.sequence.as_mapping(),
            "sourceEventTimeMs": self.source_event_time_ms,
            "sourceId": self.source_id,
            "sourceRecordIds": list(self.source_record_ids),
            "sourceTransactionTimeMs": self.source_transaction_time_ms,
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class QCaptureSidecarV1:
    """Q-only fields absent from the canonical operational owner envelopes."""

    session_id: str
    receive_monotonic_ns: int
    receive_ordinal: int
    processing_time_ns: int
    persistence_time_ns: int
    gap_count: int = 0
    drop_count: int = 0
    restart_count: int = 0
    observed_reason_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        require_contract_id(self.session_id, field="session_id")
        _require_ns(self.receive_monotonic_ns, field="receive_monotonic_ns", utc=False)
        require_strict_int(
            self.receive_ordinal,
            field="receive_ordinal",
            minimum=0,
            maximum=INT64_MAX,
        )
        processing = _require_ns(self.processing_time_ns, field="processing_time_ns", utc=True)
        persistence = _require_ns(
            self.persistence_time_ns,
            field="persistence_time_ns",
            utc=True,
        )
        if processing > persistence:
            raise ContractValueError("processing_time_ns must not exceed persistence_time_ns")
        for field_name in ("gap_count", "drop_count", "restart_count"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=0,
                maximum=INT64_MAX,
            )
        if (
            not isinstance(self.observed_reason_codes, tuple)
            or len(self.observed_reason_codes) > MAX_REASON_CODES - 3
        ):
            raise ContractValueError(
                f"observed_reason_codes must be a tuple of at most {MAX_REASON_CODES - 3} items"
            )
        normalized = tuple(
            sorted(
                {
                    require_reason_code(reason, field="observed_reason_codes")
                    for reason in self.observed_reason_codes
                }
            )
        )
        if normalized != self.observed_reason_codes:
            raise ContractValueError("observed_reason_codes must be sorted and unique")

    def as_identity_mapping(self) -> dict[str, object]:
        return {
            "dropCount": self.drop_count,
            "gapCount": self.gap_count,
            "observedReasonCodes": list(self.observed_reason_codes),
            "persistenceTimeNs": self.persistence_time_ns,
            "processingTimeNs": self.processing_time_ns,
            "receiveMonotonicNs": self.receive_monotonic_ns,
            "receiveOrdinal": self.receive_ordinal,
            "restartCount": self.restart_count,
            "sessionId": self.session_id,
        }


@dataclass(frozen=True, slots=True)
class SpotSequenceV1:
    update_first: str
    update_last: str

    def __post_init__(self) -> None:
        sequence = CanonicalRuntimeSequenceV1(self.update_first, self.update_last, None)
        object.__setattr__(self, "update_first", sequence.first)
        object.__setattr__(self, "update_last", sequence.last)

    def as_mapping(self) -> dict[str, object]:
        return {"updateFirst": self.update_first, "updateLast": self.update_last}


@dataclass(frozen=True, slots=True)
class UsdMSequenceV1:
    update_first: str
    update_last: str
    previous_update_last: str | None

    def __post_init__(self) -> None:
        sequence = CanonicalRuntimeSequenceV1(
            self.update_first,
            self.update_last,
            self.previous_update_last,
        )
        object.__setattr__(self, "update_first", sequence.first)
        object.__setattr__(self, "update_last", sequence.last)
        object.__setattr__(self, "previous_update_last", sequence.previous)

    def as_mapping(self) -> dict[str, object]:
        return {
            "previousUpdateLast": self.previous_update_last,
            "updateFirst": self.update_first,
            "updateLast": self.update_last,
        }


@dataclass(frozen=True, slots=True)
class CaptureQualityEvidenceV1:
    gap_count: int
    drop_count: int
    restart_count: int
    reason_codes: tuple[str, ...]

    def __post_init__(self) -> None:
        for field_name in ("gap_count", "drop_count", "restart_count"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=0,
                maximum=INT64_MAX,
            )
        if not isinstance(self.reason_codes, tuple) or len(self.reason_codes) > MAX_REASON_CODES:
            raise ContractValueError(
                f"reason_codes must be a tuple of at most {MAX_REASON_CODES} items"
            )
        normalized = tuple(
            sorted(
                {require_reason_code(reason, field="reason_codes") for reason in self.reason_codes}
            )
        )
        if normalized != self.reason_codes:
            raise ContractValueError("reason_codes must be sorted and unique")
        required = {
            "SEQUENCE_GAP": self.gap_count > 0,
            "CAPTURE_DROP": self.drop_count > 0,
            "CONNECTION_RESTART": self.restart_count > 0,
        }
        if any(
            (reason in self.reason_codes) is not expected for reason, expected in required.items()
        ):
            raise ContractValueError("quality counters and engine-derived reason codes disagree")

    @property
    def gap_observed(self) -> bool:
        return self.gap_count > 0

    @property
    def drop_observed(self) -> bool:
        return self.drop_count > 0

    @property
    def restart_observed(self) -> bool:
        return self.restart_count > 0

    def as_mapping(self) -> dict[str, object]:
        return {
            "dropCount": self.drop_count,
            "dropObserved": self.drop_observed,
            "gapCount": self.gap_count,
            "gapObserved": self.gap_observed,
            "reasonCodes": list(self.reason_codes),
            "restartCount": self.restart_count,
            "restartObserved": self.restart_observed,
        }


@dataclass(frozen=True, slots=True)
class PayloadSchemaBindingV1:
    """Hash-only payload contract; Q03 never materializes prices, quantities or levels."""

    schema_id: str
    normalized_evidence_digest: DigestV1
    schema_version: str = PAYLOAD_SCHEMA_VERSION
    evidence_posture: PayloadEvidencePosture = PayloadEvidencePosture.HASH_BOUND_ONLY
    materialization_state: PayloadMaterializationState = (
        PayloadMaterializationState.MATERIALIZED_MISSING
    )

    def __post_init__(self) -> None:
        require_contract_id(self.schema_id, field="payload_schema_id")
        if not isinstance(self.normalized_evidence_digest, DigestV1):
            raise ContractValueError("payload normalized evidence binding must be DigestV1")
        if self.schema_version != PAYLOAD_SCHEMA_VERSION:
            raise ContractValueError("unsupported payload schema version")
        if self.evidence_posture is not PayloadEvidencePosture.HASH_BOUND_ONLY:
            raise ContractValueError("Q03 payload evidence must remain HASH_BOUND_ONLY")
        if self.materialization_state is not PayloadMaterializationState.MATERIALIZED_MISSING:
            raise ContractValueError("Q03 payload materialization must remain MATERIALIZED_MISSING")

    def as_mapping(self) -> dict[str, object]:
        return {
            "evidencePosture": self.evidence_posture.value,
            "materializationState": self.materialization_state.value,
            "normalizedEvidenceSha256": self.normalized_evidence_digest.hexdigest,
            "schemaId": self.schema_id,
            "schemaVersion": self.schema_version,
        }


def _capture_id(
    runtime: CanonicalRuntimeSourceEventV1,
    evidence: CanonicalNormalizedEvidenceV1,
    sidecar: QCaptureSidecarV1,
    raw_payload_digest: DigestV1,
    normalized_evidence_digest: DigestV1,
    payload_schema: PayloadSchemaBindingV1,
    quality: CaptureQualityEvidenceV1,
) -> str:
    identity = {
        "authority": {
            "integrationState": IntegrationState.BLOCKED.value,
            "posture": CapturePosture.SYNTHETIC_FIXTURE.value,
            "producerOwner": FORWARD_CAPTURE_PRODUCER_OWNER,
            "realDeliveryState": RealDeliveryState.MISSING.value,
        },
        "digests": {
            "normalizedEvidenceSha256": normalized_evidence_digest.hexdigest,
            "rawPayloadSha256": raw_payload_digest.hexdigest,
        },
        "evidence": evidence.as_identity_mapping(),
        "payloadSchema": payload_schema.as_mapping(),
        "quality": quality.as_mapping(),
        "runtime": runtime.as_identity_mapping(),
        "schema": "Q03ForwardCaptureIdentityV1",
        "schemaVersion": FORWARD_CAPTURE_SCHEMA_VERSION,
        "sidecar": sidecar.as_identity_mapping(),
        "version": 1,
    }
    return f"q03capture:{hashlib.sha256(canonical_json_bytes(identity)).hexdigest()}"


@dataclass(frozen=True, slots=True)
class ForwardCaptureEnvelopeV1:
    capture_id: str
    runtime: CanonicalRuntimeSourceEventV1
    evidence: CanonicalNormalizedEvidenceV1
    sidecar: QCaptureSidecarV1
    partition_order_basis: PartitionOrderBasis
    partition_order_time_ns: int
    spot_sequence: SpotSequenceV1 | None
    usd_m_sequence: UsdMSequenceV1 | None
    raw_payload_digest: DigestV1
    normalized_evidence_digest: DigestV1
    payload_schema: PayloadSchemaBindingV1
    quality: CaptureQualityEvidenceV1
    schema_version: str = FORWARD_CAPTURE_SCHEMA_VERSION
    producer_owner: str = FORWARD_CAPTURE_PRODUCER_OWNER
    posture: CapturePosture = CapturePosture.SYNTHETIC_FIXTURE
    real_delivery_state: RealDeliveryState = RealDeliveryState.MISSING
    integration_state: IntegrationState = IntegrationState.BLOCKED

    def __post_init__(self) -> None:
        require_contract_id(self.capture_id, field="capture_id")
        if not isinstance(self.runtime, CanonicalRuntimeSourceEventV1):
            raise ContractValueError("runtime must be CanonicalRuntimeSourceEventV1")
        if not isinstance(self.evidence, CanonicalNormalizedEvidenceV1):
            raise ContractValueError("evidence must be CanonicalNormalizedEvidenceV1")
        if not isinstance(self.sidecar, QCaptureSidecarV1):
            raise ContractValueError("sidecar must be QCaptureSidecarV1")
        receive_wall_time_ns = self.runtime.receive_time_ms * 1_000_000
        if self.sidecar.processing_time_ns < receive_wall_time_ns:
            raise ContractValueError("processing_time_ns must not precede receive wall time")
        if not isinstance(self.partition_order_basis, PartitionOrderBasis):
            raise ContractValueError("partition_order_basis must be explicit")
        _require_ns(self.partition_order_time_ns, field="partition_order_time_ns", utc=True)
        if (self.spot_sequence is None) == (self.usd_m_sequence is None):
            raise ContractValueError("exactly one product-specific sequence must be present")
        if self.runtime.product_family is ForwardProduct.SPOT:
            if (
                not isinstance(self.spot_sequence, SpotSequenceV1)
                or self.usd_m_sequence is not None
            ):
                raise ContractValueError("Spot envelopes require only SpotSequenceV1")
        elif not isinstance(self.usd_m_sequence, UsdMSequenceV1) or self.spot_sequence is not None:
            raise ContractValueError("USD-M envelopes require only UsdMSequenceV1")
        if not isinstance(self.raw_payload_digest, DigestV1) or not isinstance(
            self.normalized_evidence_digest, DigestV1
        ):
            raise ContractValueError("payload digests must be DigestV1")
        if not isinstance(self.payload_schema, PayloadSchemaBindingV1):
            raise ContractValueError("payload_schema must be PayloadSchemaBindingV1")
        if not isinstance(self.quality, CaptureQualityEvidenceV1):
            raise ContractValueError("quality must be CaptureQualityEvidenceV1")
        _validate_owner_coherence(self.runtime, self.evidence)
        expected_payload_schema_id = _payload_schema_id(
            self.runtime.product_family,
            self.runtime.endpoint_class,
            self.evidence.kind,
        )
        if self.payload_schema.schema_id != expected_payload_schema_id:
            raise ContractValueError("payload schema ID disagrees with product/event truth")
        if self.payload_schema.normalized_evidence_digest != self.normalized_evidence_digest:
            raise ContractValueError(
                "payload schema normalized digest disagrees with envelope evidence"
            )
        expected_order_basis, expected_order_time_ns = _partition_order(
            self.runtime,
            self.evidence,
        )
        if (
            self.partition_order_basis is not expected_order_basis
            or self.partition_order_time_ns != expected_order_time_ns
        ):
            raise ContractValueError("partition order fields disagree with canonical source clocks")
        expected_spot_sequence, expected_usd_m_sequence = _product_sequence(self.runtime)
        if (
            self.spot_sequence != expected_spot_sequence
            or self.usd_m_sequence != expected_usd_m_sequence
        ):
            raise ContractValueError(
                "product sequence fields disagree with canonical owner evidence"
            )
        if self.quality != _quality(self.sidecar):
            raise ContractValueError("quality fields disagree with the Q capture sidecar")
        expected_capture_id = _capture_id(
            self.runtime,
            self.evidence,
            self.sidecar,
            self.raw_payload_digest,
            self.normalized_evidence_digest,
            self.payload_schema,
            self.quality,
        )
        if self.capture_id != expected_capture_id:
            raise ContractValueError("capture_id disagrees with the immutable capture identity")
        if self.schema_version != FORWARD_CAPTURE_SCHEMA_VERSION:
            raise ContractValueError("unsupported forward capture schema version")
        if self.producer_owner != FORWARD_CAPTURE_PRODUCER_OWNER:
            raise ContractValueError("forward capture cannot claim a different producer owner")
        if self.posture is not CapturePosture.SYNTHETIC_FIXTURE:
            raise ContractValueError("Q03 forward evidence must remain synthetic fixture evidence")
        if self.real_delivery_state is not RealDeliveryState.MISSING:
            raise ContractValueError("real Q delivery remains MISSING in Q03")
        if self.integration_state is not IntegrationState.BLOCKED:
            raise ContractValueError("real Q integration remains BLOCKED in Q03")

    @property
    def canonical_order_key(self) -> tuple[int, int, int, str, str, str]:
        return (
            self.partition_order_time_ns,
            self.runtime.connection_generation,
            self.sidecar.receive_ordinal,
            self.sidecar.session_id,
            self.runtime.stream,
            self.capture_id,
        )

    @property
    def source_trade_time_ms(self) -> int | None:
        """Preserve transaction time as trade time only for trade evidence."""

        if self.evidence.kind == "TRADE":
            return self.runtime.source_transaction_time_ms
        return None

    @property
    def source_update_time_ms(self) -> int | None:
        """Preserve transaction time as update time only for depth evidence."""

        if self.evidence.kind in {"DEPTH_DELTA", "DEPTH_SNAPSHOT"}:
            return self.runtime.source_transaction_time_ms
        return None

    def as_mapping(self) -> dict[str, object]:
        return {
            "captureId": self.capture_id,
            "correlationId": self.runtime.correlation_id,
            "digests": {
                "normalizedEvidenceSha256": self.normalized_evidence_digest.hexdigest,
                "rawPayloadSha256": self.raw_payload_digest.hexdigest,
            },
            "endpointClass": self.runtime.endpoint_class.value,
            "evidenceId": self.evidence.evidence_id,
            "integrationState": self.integration_state.value,
            "kind": self.evidence.kind,
            "ordering": {
                "basis": self.partition_order_basis.value,
                "partitionOrderTimeNs": self.partition_order_time_ns,
                "receiveOrdinal": self.sidecar.receive_ordinal,
            },
            "payloadSchema": self.payload_schema.as_mapping(),
            "posture": self.posture.value,
            "producerOwner": self.producer_owner,
            "productFamily": self.runtime.product_family.value,
            "quality": self.quality.as_mapping(),
            "realDeliveryState": self.real_delivery_state.value,
            "runtime": {
                "connectionGeneration": self.runtime.connection_generation,
                "receiveTimeMs": self.runtime.receive_time_ms,
                "sourceEventTimeMs": self.runtime.source_event_time_ms,
                "sourceId": self.runtime.source_id,
                "sourceTransactionTimeMs": self.runtime.source_transaction_time_ms,
                "stream": self.runtime.stream,
            },
            "semanticSourceClocks": {
                "sourceTradeTimeMs": self.source_trade_time_ms,
                "sourceUpdateTimeMs": self.source_update_time_ms,
            },
            "schemaVersion": self.schema_version,
            "sequence": {
                "spot": None if self.spot_sequence is None else self.spot_sequence.as_mapping(),
                "usdM": None if self.usd_m_sequence is None else self.usd_m_sequence.as_mapping(),
            },
            "sidecar": {
                "persistenceTimeNs": self.sidecar.persistence_time_ns,
                "processingTimeNs": self.sidecar.processing_time_ns,
                "receiveMonotonicNs": self.sidecar.receive_monotonic_ns,
                "sessionId": self.sidecar.session_id,
            },
            "sourceRecordIds": list(self.evidence.source_record_ids),
            "symbol": self.evidence.symbol,
        }

    def as_arrow_mapping(self) -> dict[str, object]:
        spot = self.spot_sequence
        usd_m = self.usd_m_sequence
        return {
            "capture_id": self.capture_id,
            "schema_version": self.schema_version,
            "producer_owner": self.producer_owner,
            "posture": self.posture.value,
            "real_delivery_state": self.real_delivery_state.value,
            "integration_state": self.integration_state.value,
            "source_id": self.runtime.source_id,
            "endpoint_class": self.runtime.endpoint_class.value,
            "product_family": self.runtime.product_family.value,
            "stream": self.runtime.stream,
            "connection_generation": self.runtime.connection_generation,
            "correlation_id": self.runtime.correlation_id,
            "evidence_id": self.evidence.evidence_id,
            "kind": self.evidence.kind,
            "instrument_id": self.evidence.instrument_id,
            "symbol": self.evidence.symbol,
            "source_event_time_ms": self.runtime.source_event_time_ms,
            "source_event_time_ns": _ms_to_ns(self.runtime.source_event_time_ms),
            "source_transaction_time_ms": self.runtime.source_transaction_time_ms,
            "source_transaction_time_ns": _ms_to_ns(self.runtime.source_transaction_time_ms),
            "source_trade_time_ms": self.source_trade_time_ms,
            "source_trade_time_ns": _ms_to_ns(self.source_trade_time_ms),
            "source_update_time_ms": self.source_update_time_ms,
            "source_update_time_ns": _ms_to_ns(self.source_update_time_ms),
            "receive_wall_time_ms": self.runtime.receive_time_ms,
            "receive_wall_time_ns": _ms_to_ns(self.runtime.receive_time_ms),
            "receive_monotonic_ns": self.sidecar.receive_monotonic_ns,
            "receive_ordinal": self.sidecar.receive_ordinal,
            "processing_time_ns": self.sidecar.processing_time_ns,
            "persistence_time_ns": self.sidecar.persistence_time_ns,
            "partition_order_basis": self.partition_order_basis.value,
            "partition_order_time_ns": self.partition_order_time_ns,
            "payload_schema_id": self.payload_schema.schema_id,
            "payload_schema_version": self.payload_schema.schema_version,
            "payload_evidence_posture": self.payload_schema.evidence_posture.value,
            "payload_materialization_state": self.payload_schema.materialization_state.value,
            "payload_normalized_evidence_sha256": (
                self.payload_schema.normalized_evidence_digest.to_bytes()
            ),
            "session_id": self.sidecar.session_id,
            "spot_sequence": None
            if spot is None
            else {"update_first": spot.update_first, "update_last": spot.update_last},
            "usd_m_sequence": None
            if usd_m is None
            else {
                "update_first": usd_m.update_first,
                "update_last": usd_m.update_last,
                "previous_update_last": usd_m.previous_update_last,
            },
            "raw_payload_sha256": self.raw_payload_digest.to_bytes(),
            "normalized_evidence_sha256": self.normalized_evidence_digest.to_bytes(),
            "gap_count": self.quality.gap_count,
            "drop_count": self.quality.drop_count,
            "restart_count": self.quality.restart_count,
            "gap_observed": self.quality.gap_observed,
            "drop_observed": self.quality.drop_observed,
            "restart_observed": self.quality.restart_observed,
            "quality_reason_codes": list(self.quality.reason_codes),
        }


@dataclass(frozen=True, slots=True)
class BridgeCompatibilityV1:
    producer_owner: str
    semantic_mi_bridge: CompatibilityState
    operational_capture: CompatibilityState
    real_delivery_state: RealDeliveryState
    integration_state: IntegrationState
    missing_operational_fields: tuple[str, ...]
    queue_policy: str
    authority: str

    def __post_init__(self) -> None:
        if self.producer_owner != FORWARD_CAPTURE_PRODUCER_OWNER:
            raise ContractValueError("bridge compatibility must name the canonical producer owner")
        if self.semantic_mi_bridge is not CompatibilityState.COMPATIBLE:
            raise ContractValueError("the normalized MI bridge is fixture-compatible")
        if self.operational_capture is not CompatibilityState.INCOMPATIBLE:
            raise ContractValueError(
                "the current operational capture is intentionally incompatible"
            )
        if self.real_delivery_state is not RealDeliveryState.MISSING:
            raise ContractValueError("real delivery remains MISSING")
        if self.integration_state is not IntegrationState.BLOCKED:
            raise ContractValueError("integration remains BLOCKED")
        normalized = tuple(sorted(set(self.missing_operational_fields)))
        if not normalized or normalized != self.missing_operational_fields:
            raise ContractValueError("missing operational fields must be sorted and unique")
        if self.queue_policy != FORWARD_CAPTURE_QUEUE_POLICY:
            raise ContractValueError("Q capture queue policy must be DROP_NEW")
        if self.authority != "READ_ONLY_RESEARCH_FIXTURE":
            raise ContractValueError("bridge compatibility conveys no operational authority")


SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY: Final = BridgeCompatibilityV1(
    producer_owner=FORWARD_CAPTURE_PRODUCER_OWNER,
    semantic_mi_bridge=CompatibilityState.COMPATIBLE,
    operational_capture=CompatibilityState.INCOMPATIBLE,
    real_delivery_state=RealDeliveryState.MISSING,
    integration_state=IntegrationState.BLOCKED,
    missing_operational_fields=(
        "gapDropRestartEvidence",
        "persistenceTimeNs",
        "processingTimeNs",
        "qDeliveryPort",
        "receiveMonotonicNs",
        "receiveOrdinal",
    ),
    queue_policy=FORWARD_CAPTURE_QUEUE_POLICY,
    authority="READ_ONLY_RESEARCH_FIXTURE",
)


def _validate_owner_coherence(
    runtime: CanonicalRuntimeSourceEventV1,
    evidence: CanonicalNormalizedEvidenceV1,
) -> None:
    if runtime.source_id != evidence.source_id:
        raise ContractValueError("runtime and normalized evidence source_id disagree")
    if runtime.product_family is not evidence.product_family:
        raise ContractValueError("runtime and normalized evidence product_family disagree")
    if runtime.endpoint_class is not evidence.endpoint_class:
        raise ContractValueError("runtime and normalized evidence endpoint_class disagree")
    if runtime.source_event_time_ms != evidence.source_event_time_ms:
        raise ContractValueError("runtime and normalized evidence source event clocks disagree")
    if runtime.source_transaction_time_ms != evidence.source_transaction_time_ms:
        raise ContractValueError("runtime and normalized evidence transaction clocks disagree")
    if runtime.receive_time_ms != evidence.received_time_ms:
        raise ContractValueError("runtime and normalized evidence receive clocks disagree")
    if runtime.sequence is None or evidence.sequence is None:
        if runtime.sequence is not evidence.sequence:
            raise ContractValueError("runtime and normalized evidence sequence presence disagrees")
        return
    if runtime.product_family is ForwardProduct.SPOT:
        if runtime.sequence.previous is not None or evidence.sequence.previous is not None:
            raise ContractValueError("Spot sequence evidence must not impersonate USD-M pu")
        if (runtime.sequence.first, runtime.sequence.last) != (
            evidence.sequence.first,
            evidence.sequence.last,
        ):
            raise ContractValueError("runtime and normalized evidence sequence ranges disagree")
        return
    if (
        runtime.sequence.first,
        runtime.sequence.last,
        runtime.sequence.previous,
    ) != (
        evidence.sequence.first,
        evidence.sequence.last,
        evidence.sequence.previous,
    ):
        raise ContractValueError(
            "runtime and normalized evidence USD-M U/u/pu sequence truth disagrees"
        )
    if (
        runtime.product_family is ForwardProduct.USD_M_PERPETUAL
        and runtime.endpoint_class is ForwardEndpointClass.PUBLIC
        and evidence.kind == "DEPTH_DELTA"
        and runtime.sequence.previous is None
    ):
        raise ContractValueError("USD-M public depth delta requires non-null pu evidence")


def _partition_order(
    runtime: CanonicalRuntimeSourceEventV1,
    evidence: CanonicalNormalizedEvidenceV1,
) -> tuple[PartitionOrderBasis, int]:
    if runtime.product_family is ForwardProduct.SPOT and evidence.kind == "BOOK_TICKER":
        if (
            runtime.source_event_time_ms is not None
            or runtime.source_transaction_time_ms is not None
        ):
            raise ContractValueError(
                "Spot bookTicker source event and transaction clocks must be null"
            )
        return (
            PartitionOrderBasis.RECEIVE_WALL_TIME_AND_ORDINAL,
            runtime.receive_time_ms * 1_000_000,
        )
    if runtime.source_transaction_time_ms is not None:
        return (
            PartitionOrderBasis.SOURCE_TRANSACTION_TIME,
            runtime.source_transaction_time_ms * 1_000_000,
        )
    if runtime.source_event_time_ms is not None:
        return (
            PartitionOrderBasis.SOURCE_EVENT_TIME,
            runtime.source_event_time_ms * 1_000_000,
        )
    return (
        PartitionOrderBasis.RECEIVE_WALL_TIME_AND_ORDINAL,
        runtime.receive_time_ms * 1_000_000,
    )


def _product_sequence(
    runtime: CanonicalRuntimeSourceEventV1,
) -> tuple[SpotSequenceV1 | None, UsdMSequenceV1 | None]:
    if runtime.sequence is None:
        raise ContractValueError("Q03 forward fixture events require explicit sequence evidence")
    if runtime.product_family is ForwardProduct.SPOT:
        return SpotSequenceV1(runtime.sequence.first, runtime.sequence.last), None
    return None, UsdMSequenceV1(
        runtime.sequence.first,
        runtime.sequence.last,
        runtime.sequence.previous,
    )


def _quality(sidecar: QCaptureSidecarV1) -> CaptureQualityEvidenceV1:
    reason_codes = set(sidecar.observed_reason_codes)
    if sidecar.gap_count > 0:
        reason_codes.add("SEQUENCE_GAP")
    if sidecar.drop_count > 0:
        reason_codes.add("CAPTURE_DROP")
    if sidecar.restart_count > 0:
        reason_codes.add("CONNECTION_RESTART")
    return CaptureQualityEvidenceV1(
        gap_count=sidecar.gap_count,
        drop_count=sidecar.drop_count,
        restart_count=sidecar.restart_count,
        reason_codes=tuple(sorted(reason_codes)),
    )


def adapt_runtime_evidence_fixture(
    runtime: CanonicalRuntimeSourceEventV1,
    evidence: CanonicalNormalizedEvidenceV1,
    sidecar: QCaptureSidecarV1,
    *,
    raw_payload_bytes: bytes,
    normalized_evidence_bytes: bytes,
) -> ForwardCaptureEnvelopeV1:
    """Build a deterministic Q-only fixture; this performs no delivery or storage effect."""

    if not isinstance(runtime, CanonicalRuntimeSourceEventV1):
        raise ContractValueError("runtime must be CanonicalRuntimeSourceEventV1")
    if not isinstance(evidence, CanonicalNormalizedEvidenceV1):
        raise ContractValueError("evidence must be CanonicalNormalizedEvidenceV1")
    if not isinstance(sidecar, QCaptureSidecarV1):
        raise ContractValueError("sidecar must be QCaptureSidecarV1")
    raw = _require_bytes(raw_payload_bytes, field="raw_payload_bytes")
    normalized = _require_bytes(normalized_evidence_bytes, field="normalized_evidence_bytes")
    receive_ns = runtime.receive_time_ms * 1_000_000
    if sidecar.processing_time_ns < receive_ns:
        raise ContractValueError("processing_time_ns must not precede receive wall time")
    _validate_owner_coherence(runtime, evidence)
    payload_schema_id = _payload_schema_id(
        runtime.product_family,
        runtime.endpoint_class,
        evidence.kind,
    )
    order_basis, order_time_ns = _partition_order(runtime, evidence)
    spot_sequence, usd_m_sequence = _product_sequence(runtime)
    raw_digest = DigestV1(hashlib.sha256(raw).hexdigest())
    normalized_digest = DigestV1(hashlib.sha256(normalized).hexdigest())
    quality = _quality(sidecar)
    payload_schema = PayloadSchemaBindingV1(
        schema_id=payload_schema_id,
        normalized_evidence_digest=normalized_digest,
    )
    capture_id = _capture_id(
        runtime,
        evidence,
        sidecar,
        raw_digest,
        normalized_digest,
        payload_schema,
        quality,
    )
    return ForwardCaptureEnvelopeV1(
        capture_id=capture_id,
        runtime=runtime,
        evidence=evidence,
        sidecar=sidecar,
        partition_order_basis=order_basis,
        partition_order_time_ns=order_time_ns,
        spot_sequence=spot_sequence,
        usd_m_sequence=usd_m_sequence,
        raw_payload_digest=raw_digest,
        normalized_evidence_digest=normalized_digest,
        payload_schema=payload_schema,
        quality=quality,
    )


@dataclass(frozen=True, slots=True)
class QueueOfferResultV1:
    state: QueueOfferState
    depth: int
    capacity: int
    dropped_total: int

    @property
    def accepted(self) -> bool:
        return self.state is QueueOfferState.ENQUEUED


class DropNewCaptureQueue:
    """Bounded, synchronous queue that never waits or evicts retained owner events."""

    __slots__ = ("__capacity", "__dropped_total", "__items")

    def __init__(self, capacity: int) -> None:
        self.__capacity = require_strict_int(
            capacity,
            field="capacity",
            minimum=1,
            maximum=MAX_QUEUE_CAPACITY,
        )
        self.__dropped_total = 0
        self.__items: deque[ForwardCaptureEnvelopeV1] = deque()

    @property
    def capacity(self) -> int:
        return self.__capacity

    @property
    def depth(self) -> int:
        return len(self.__items)

    @property
    def dropped_total(self) -> int:
        return self.__dropped_total

    def try_offer(self, envelope: ForwardCaptureEnvelopeV1) -> QueueOfferResultV1:
        if not isinstance(envelope, ForwardCaptureEnvelopeV1):
            raise ContractValueError("queue accepts only ForwardCaptureEnvelopeV1")
        if len(self.__items) >= self.__capacity:
            self.__dropped_total += 1
            return QueueOfferResultV1(
                state=QueueOfferState.DROPPED_NEW,
                depth=len(self.__items),
                capacity=self.__capacity,
                dropped_total=self.__dropped_total,
            )
        self.__items.append(envelope)
        return QueueOfferResultV1(
            state=QueueOfferState.ENQUEUED,
            depth=len(self.__items),
            capacity=self.__capacity,
            dropped_total=self.__dropped_total,
        )

    def drain(self, maximum: int) -> tuple[ForwardCaptureEnvelopeV1, ...]:
        bounded = require_strict_int(
            maximum,
            field="maximum",
            minimum=0,
            maximum=self.__capacity,
        )
        return tuple(self.__items.popleft() for _ in range(min(bounded, len(self.__items))))


def _forward_schema_metadata() -> dict[bytes, bytes]:
    values = {
        b"q.capture_posture": CapturePosture.SYNTHETIC_FIXTURE.value.encode(),
        b"q.contract_id": FORWARD_CAPTURE_SCHEMA_ID.encode(),
        b"q.integration_state": IntegrationState.BLOCKED.value.encode(),
        b"q.nullable_source_time": b"TRUE",
        b"q.partition_order": (
            b"TIME+CONNECTION_GENERATION+RECEIVE_ORDINAL+SESSION+STREAM+CAPTURE_ID"
        ),
        b"q.payload_materialization_state": (
            PayloadMaterializationState.MATERIALIZED_MISSING.value.encode()
        ),
        b"q.payload_posture": PayloadEvidencePosture.HASH_BOUND_ONLY.value.encode(),
        b"q.payload_schemas": (
            f"SPOT/BOOK_TICKER={SPOT_BOOK_TICKER_PAYLOAD_SCHEMA_ID}|"
            f"SPOT/TRADE={SPOT_TRADE_PAYLOAD_SCHEMA_ID}|"
            f"USD_M_PERPETUAL/DEPTH_DELTA={USD_M_DEPTH_DELTA_PAYLOAD_SCHEMA_ID}"
        ).encode(),
        b"q.producer_owner": FORWARD_CAPTURE_PRODUCER_OWNER.encode(),
        b"q.real_delivery_state": RealDeliveryState.MISSING.value.encode(),
        b"q.schema_version": FORWARD_CAPTURE_SCHEMA_VERSION.encode(),
        b"q.semantic_source_clocks": (
            b"EVENT|TRADE_FROM_TRANSACTION_FOR_TRADE|UPDATE_FROM_TRANSACTION_FOR_DEPTH"
        ),
        b"q.sequence_contract": b"SPOT_U_U|USD_M_U_U_PU",
        b"q.storage_authority": b"NONE",
    }
    return dict(sorted(values.items()))


FORWARD_CAPTURE_SCHEMA: Final = pa.schema(
    [
        pa.field("capture_id", pa.string(), nullable=False),
        pa.field("schema_version", pa.string(), nullable=False),
        pa.field("producer_owner", pa.string(), nullable=False),
        pa.field("posture", pa.string(), nullable=False),
        pa.field("real_delivery_state", pa.string(), nullable=False),
        pa.field("integration_state", pa.string(), nullable=False),
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("endpoint_class", pa.string(), nullable=False),
        pa.field("product_family", pa.string(), nullable=False),
        pa.field("stream", pa.string(), nullable=False),
        pa.field("connection_generation", pa.int64(), nullable=False),
        pa.field("correlation_id", pa.string(), nullable=False),
        pa.field("evidence_id", pa.string(), nullable=False),
        pa.field("kind", pa.string(), nullable=False),
        pa.field("instrument_id", pa.string(), nullable=False),
        pa.field("symbol", pa.string(), nullable=False),
        pa.field("source_event_time_ms", pa.int64(), nullable=True),
        pa.field("source_event_time_ns", pa.int64(), nullable=True),
        pa.field("source_transaction_time_ms", pa.int64(), nullable=True),
        pa.field("source_transaction_time_ns", pa.int64(), nullable=True),
        pa.field("source_trade_time_ms", pa.int64(), nullable=True),
        pa.field("source_trade_time_ns", pa.int64(), nullable=True),
        pa.field("source_update_time_ms", pa.int64(), nullable=True),
        pa.field("source_update_time_ns", pa.int64(), nullable=True),
        pa.field("receive_wall_time_ms", pa.int64(), nullable=False),
        pa.field("receive_wall_time_ns", pa.int64(), nullable=False),
        pa.field("receive_monotonic_ns", pa.int64(), nullable=False),
        pa.field("receive_ordinal", pa.int64(), nullable=False),
        pa.field("processing_time_ns", pa.int64(), nullable=False),
        pa.field("persistence_time_ns", pa.int64(), nullable=False),
        pa.field("partition_order_basis", pa.string(), nullable=False),
        pa.field("partition_order_time_ns", pa.int64(), nullable=False),
        pa.field("payload_schema_id", pa.string(), nullable=False),
        pa.field("payload_schema_version", pa.string(), nullable=False),
        pa.field("payload_evidence_posture", pa.string(), nullable=False),
        pa.field("payload_materialization_state", pa.string(), nullable=False),
        pa.field("payload_normalized_evidence_sha256", pa.binary(32), nullable=False),
        pa.field("session_id", pa.string(), nullable=False),
        pa.field(
            "spot_sequence",
            pa.struct(
                [
                    pa.field("update_first", pa.string(), nullable=False),
                    pa.field("update_last", pa.string(), nullable=False),
                ]
            ),
            nullable=True,
        ),
        pa.field(
            "usd_m_sequence",
            pa.struct(
                [
                    pa.field("update_first", pa.string(), nullable=False),
                    pa.field("update_last", pa.string(), nullable=False),
                    pa.field("previous_update_last", pa.string(), nullable=False),
                ]
            ),
            nullable=True,
        ),
        pa.field("raw_payload_sha256", pa.binary(32), nullable=False),
        pa.field("normalized_evidence_sha256", pa.binary(32), nullable=False),
        pa.field("gap_count", pa.int64(), nullable=False),
        pa.field("drop_count", pa.int64(), nullable=False),
        pa.field("restart_count", pa.int64(), nullable=False),
        pa.field("gap_observed", pa.bool_(), nullable=False),
        pa.field("drop_observed", pa.bool_(), nullable=False),
        pa.field("restart_observed", pa.bool_(), nullable=False),
        pa.field(
            "quality_reason_codes",
            pa.list_(pa.field("element", pa.string(), nullable=False)),
            nullable=False,
        ),
    ],
    metadata=_forward_schema_metadata(),
)

FORWARD_CAPTURE_SCHEMA_FINGERPRINT: Final = DigestV1(
    hashlib.sha256(FORWARD_CAPTURE_SCHEMA.serialize().to_pybytes()).hexdigest()
)


def forward_capture_arrow_schema() -> pa.Schema:
    """Return the immutable versioned schema; this does not create a store or write bytes."""

    return FORWARD_CAPTURE_SCHEMA
