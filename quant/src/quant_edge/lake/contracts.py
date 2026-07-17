from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from quant_edge.errors import ContractValueError

INT64_MIN = -(1 << 63)
INT64_MAX = (1 << 63) - 1
UINT64_MAX = (1 << 64) - 1
UTC_NS_MIN = 1_262_304_000_000_000_000
UTC_NS_MAX = 4_102_444_800_000_000_000
MAX_DECIMAL_COEFFICIENT = (10**38) - 1
MAX_QUALITY_REASON_CODES = 32
MAX_OBSERVED_QUALITY_REASON_CODES = 24

_DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_PATH_SEGMENT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_CONTRACT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$")
_REASON_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_QUALITY_ASSESSMENT_TOKEN = object()
_ENGINE_REASON_CODES = frozenset(
    {
        "COMPLETE_PROOF",
        "COMPLETENESS_NOT_PROVEN",
        "EXPLICITLY_UNAVAILABLE",
        "KNOWN_GAP",
        "PARTIAL_EVIDENCE",
        "RECONSTRUCTING",
        "REQUIRED_FACT_UNKNOWN",
        "SAMPLED_EVIDENCE",
        "STALE_EVIDENCE",
        "SYNTHETIC_EVIDENCE",
    }
)


def require_strict_int(
    value: object,
    *,
    field: str,
    minimum: int = INT64_MIN,
    maximum: int = INT64_MAX,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError(f"{field} must be an integer")
    if not minimum <= value <= maximum:
        raise ContractValueError(f"{field} is outside [{minimum}, {maximum}]")
    return value


def require_path_segment(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _PATH_SEGMENT_PATTERN.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be a strict ASCII path segment")
    return value


def require_contract_id(value: object, *, field: str) -> str:
    if (
        not isinstance(value, str)
        or value in (".", "..")
        or _CONTRACT_ID_PATTERN.fullmatch(value) is None
    ):
        raise ContractValueError(f"{field} must be a bounded ASCII contract identifier")
    return value


def require_reason_code(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _REASON_PATTERN.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be an uppercase reason code")
    return value


def require_bool_or_none(value: object, *, field: str) -> bool | None:
    if value is not None and not isinstance(value, bool):
        raise ContractValueError(f"{field} must be boolean or null")
    return value


@dataclass(frozen=True, slots=True)
class DigestV1:
    hexdigest: str
    algorithm: str = "SHA256"

    def __post_init__(self) -> None:
        if self.algorithm != "SHA256":
            raise ContractValueError("digest algorithm must be SHA256")
        if _DIGEST_PATTERN.fullmatch(self.hexdigest) is None:
            raise ContractValueError("digest must be 64 lowercase hexadecimal characters")

    def to_bytes(self) -> bytes:
        return bytes.fromhex(self.hexdigest)


@dataclass(frozen=True, slots=True)
class ExactScaledValueV1:
    coefficient: int
    scale: int
    unit_id: str

    def __post_init__(self) -> None:
        require_strict_int(
            self.coefficient,
            field="coefficient",
            minimum=-MAX_DECIMAL_COEFFICIENT,
            maximum=MAX_DECIMAL_COEFFICIENT,
        )
        require_strict_int(self.scale, field="scale", minimum=0, maximum=38)
        require_contract_id(self.unit_id, field="unit_id")


@dataclass(frozen=True, slots=True)
class InstrumentIdentityV1:
    """Explicit instrument and unit identity for exact market arithmetic."""

    instrument_id: str
    base_size_unit_id: str
    quote_price_unit_id: str

    def __post_init__(self) -> None:
        require_contract_id(self.instrument_id, field="instrument_id")
        require_contract_id(self.base_size_unit_id, field="base_size_unit_id")
        require_contract_id(self.quote_price_unit_id, field="quote_price_unit_id")

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseSizeUnitId": self.base_size_unit_id,
            "instrumentId": self.instrument_id,
            "quotePriceUnitId": self.quote_price_unit_id,
        }


class TimestampUnit(StrEnum):
    MILLISECOND = "MILLISECOND"
    MICROSECOND = "MICROSECOND"
    NANOSECOND = "NANOSECOND"


class TimestampBasis(StrEnum):
    DECLARED = "DECLARED"
    INFERRED = "INFERRED"


_TIMESTAMP_MULTIPLIERS: dict[TimestampUnit, int] = {
    TimestampUnit.MILLISECOND: 1_000_000,
    TimestampUnit.MICROSECOND: 1_000,
    TimestampUnit.NANOSECOND: 1,
}


@dataclass(frozen=True, slots=True)
class RawTimestampV1:
    raw: int
    unit: TimestampUnit
    basis: TimestampBasis

    def __post_init__(self) -> None:
        require_strict_int(self.raw, field="raw timestamp")
        if not isinstance(self.unit, TimestampUnit):
            raise ContractValueError("timestamp unit must be an explicit TimestampUnit")
        if not isinstance(self.basis, TimestampBasis):
            raise ContractValueError("timestamp basis must be an explicit TimestampBasis")
        normalized = self.raw * _TIMESTAMP_MULTIPLIERS[self.unit]
        if not UTC_NS_MIN <= normalized <= UTC_NS_MAX:
            raise ContractValueError("timestamp is outside the frozen plausible UTC range")

    @property
    def normalized_ns(self) -> int:
        return self.raw * _TIMESTAMP_MULTIPLIERS[self.unit]


class QualityState(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    GAPPED = "GAPPED"
    STALE = "STALE"
    RECONSTRUCTING = "RECONSTRUCTING"
    SAMPLED = "SAMPLED"
    UNAVAILABLE = "UNAVAILABLE"
    SYNTHETIC = "SYNTHETIC"
    UNKNOWN = "UNKNOWN"


QUALITY_STATE_ORDER: tuple[QualityState, ...] = (
    QualityState.COMPLETE,
    QualityState.PARTIAL,
    QualityState.GAPPED,
    QualityState.STALE,
    QualityState.RECONSTRUCTING,
    QualityState.SAMPLED,
    QualityState.UNAVAILABLE,
    QualityState.SYNTHETIC,
    QualityState.UNKNOWN,
)


@dataclass(frozen=True, slots=True)
class QualityFactsV1:
    available: bool | None
    synthetic: bool
    gap: bool
    stale: bool
    reconstructing: bool
    sampled: bool
    partial: bool
    complete_proven: bool | None
    observed_reasons: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        require_bool_or_none(self.available, field="available")
        require_bool_or_none(self.complete_proven, field="complete_proven")
        for field_name in ("synthetic", "gap", "stale", "reconstructing", "sampled", "partial"):
            if not isinstance(getattr(self, field_name), bool):
                raise ContractValueError(f"{field_name} must be boolean")
        if (
            not isinstance(self.observed_reasons, tuple)
            or len(self.observed_reasons) > MAX_OBSERVED_QUALITY_REASON_CODES
        ):
            raise ContractValueError(
                "observed_reasons must be a tuple of at most "
                f"{MAX_OBSERVED_QUALITY_REASON_CODES} items, reserving engine reason capacity"
            )
        normalized = tuple(
            sorted(
                {
                    require_reason_code(reason, field="observed_reasons")
                    for reason in self.observed_reasons
                }
            )
        )
        if normalized != self.observed_reasons:
            raise ContractValueError("observed_reasons must be sorted and unique")
        if _ENGINE_REASON_CODES.intersection(self.observed_reasons):
            raise ContractValueError("observed_reasons cannot assert engine-owned quality reasons")
        if self.available is False and self.complete_proven is True:
            raise ContractValueError("unavailable evidence cannot be proven complete")
        if self.synthetic and self.complete_proven is True:
            raise ContractValueError("synthetic evidence cannot claim COMPLETE")
        if self.partial and self.complete_proven is True:
            raise ContractValueError("partial evidence cannot be proven complete")


@dataclass(frozen=True, slots=True, init=False)
class ResearchQualityAssessmentV1:
    state: QualityState
    reason_codes: tuple[str, ...]

    def __init__(
        self,
        state: QualityState,
        reason_codes: tuple[str, ...],
        *,
        _token: object | None = None,
    ) -> None:
        if _token is not _QUALITY_ASSESSMENT_TOKEN:
            raise ContractValueError("research quality assessments must be engine-derived")
        object.__setattr__(self, "state", state)
        object.__setattr__(self, "reason_codes", reason_codes)
        if not isinstance(self.state, QualityState):
            raise ContractValueError("quality state must be a QualityState")
        if (
            not isinstance(self.reason_codes, tuple)
            or len(self.reason_codes) > MAX_QUALITY_REASON_CODES
        ):
            raise ContractValueError(
                f"reason_codes must be a tuple of at most {MAX_QUALITY_REASON_CODES} items"
            )
        normalized = tuple(
            sorted(
                {require_reason_code(reason, field="reason_codes") for reason in self.reason_codes}
            )
        )
        if normalized != self.reason_codes:
            raise ContractValueError("reason_codes must be sorted and unique")
        engine_precedence = (
            ("EXPLICITLY_UNAVAILABLE", QualityState.UNAVAILABLE),
            ("SYNTHETIC_EVIDENCE", QualityState.SYNTHETIC),
            ("KNOWN_GAP", QualityState.GAPPED),
            ("RECONSTRUCTING", QualityState.RECONSTRUCTING),
            ("STALE_EVIDENCE", QualityState.STALE),
            ("SAMPLED_EVIDENCE", QualityState.SAMPLED),
            ("PARTIAL_EVIDENCE", QualityState.PARTIAL),
            ("COMPLETENESS_NOT_PROVEN", QualityState.PARTIAL),
            ("REQUIRED_FACT_UNKNOWN", QualityState.UNKNOWN),
            ("COMPLETE_PROOF", QualityState.COMPLETE),
        )
        engine_state = next(
            (candidate for reason, candidate in engine_precedence if reason in reason_codes),
            None,
        )
        if engine_state is None or engine_state is not self.state:
            raise ContractValueError("quality state does not match engine-owned reason precedence")


def _restore_quality_assessment(
    state: QualityState,
    reason_codes: tuple[str, ...],
) -> ResearchQualityAssessmentV1:
    """Restore a manifest-validated stored assessment without exposing caller assertion."""

    return ResearchQualityAssessmentV1(
        state=state,
        reason_codes=reason_codes,
        _token=_QUALITY_ASSESSMENT_TOKEN,
    )


def derive_quality(facts: QualityFactsV1) -> ResearchQualityAssessmentV1:
    reasons = set(facts.observed_reasons)
    flags = (
        (facts.available is False, "EXPLICITLY_UNAVAILABLE"),
        (facts.synthetic, "SYNTHETIC_EVIDENCE"),
        (facts.gap, "KNOWN_GAP"),
        (facts.reconstructing, "RECONSTRUCTING"),
        (facts.stale, "STALE_EVIDENCE"),
        (facts.sampled, "SAMPLED_EVIDENCE"),
        (facts.partial, "PARTIAL_EVIDENCE"),
        (facts.available is None or facts.complete_proven is None, "REQUIRED_FACT_UNKNOWN"),
    )
    reasons.update(code for active, code in flags if active)

    if facts.available is False:
        state = QualityState.UNAVAILABLE
    elif facts.synthetic:
        state = QualityState.SYNTHETIC
    elif facts.gap:
        state = QualityState.GAPPED
    elif facts.reconstructing:
        state = QualityState.RECONSTRUCTING
    elif facts.stale:
        state = QualityState.STALE
    elif facts.sampled:
        state = QualityState.SAMPLED
    elif facts.partial or facts.complete_proven is False:
        state = QualityState.PARTIAL
        if not facts.partial:
            reasons.add("COMPLETENESS_NOT_PROVEN")
    elif facts.available is None or facts.complete_proven is None:
        state = QualityState.UNKNOWN
    else:
        state = QualityState.COMPLETE
        reasons.add("COMPLETE_PROOF")
    return _restore_quality_assessment(state, tuple(sorted(reasons)))


class EvidencePosture(StrEnum):
    LIVE = "LIVE"
    REPLAY = "REPLAY"
    SYNTHETIC = "SYNTHETIC"


@dataclass(frozen=True, slots=True)
class ReferenceMarketEvidenceRowV1:
    """Q02 reference row for sources with an authoritative exchange event timestamp.

    Sources without E/T must not substitute a receive clock. They require a later,
    separately versioned nullable-source-time schema with an explicit ordering basis.
    """

    record_id: str
    source_id: str
    source_endpoint: str
    venue: str
    product: str
    event_kind: str
    symbol: str
    base_asset_id: str
    quote_asset_id: str
    instrument_version: str
    stream_id: str
    event_time: RawTimestampV1
    trade_time: RawTimestampV1 | None
    receive_wall_time: RawTimestampV1 | None
    receive_monotonic_ns: int | None
    normalization_time_ns: int
    persistence_time_ns: int
    session_id: str
    sequence_first: int | None
    sequence_last: int | None
    raw_payload_digest: DigestV1
    posture: EvidencePosture
    duplicate: bool
    late: bool
    quality: ResearchQualityAssessmentV1
    price: ExactScaledValueV1 | None
    quantity: ExactScaledValueV1 | None

    def __post_init__(self) -> None:
        for field_name in (
            "record_id",
            "source_id",
            "source_endpoint",
            "symbol",
            "base_asset_id",
            "quote_asset_id",
            "instrument_version",
            "stream_id",
            "session_id",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        for field_name in ("venue", "product", "event_kind"):
            require_path_segment(getattr(self, field_name), field=field_name)
        if not isinstance(self.event_time, RawTimestampV1):
            raise ContractValueError(
                "event_time must be a RawTimestampV1 in the event-timestamped-only V1 schema"
            )
        for field_name in ("trade_time", "receive_wall_time"):
            timestamp = getattr(self, field_name)
            if timestamp is not None and not isinstance(timestamp, RawTimestampV1):
                raise ContractValueError(f"{field_name} must be RawTimestampV1 or null")
        if self.receive_monotonic_ns is not None:
            require_strict_int(
                self.receive_monotonic_ns,
                field="receive_monotonic_ns",
                minimum=0,
            )
        require_strict_int(
            self.normalization_time_ns,
            field="normalization_time_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        require_strict_int(
            self.persistence_time_ns,
            field="persistence_time_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        if self.normalization_time_ns > self.persistence_time_ns:
            raise ContractValueError("normalization_time_ns must not follow persistence_time_ns")
        if (self.sequence_first is None) != (self.sequence_last is None):
            raise ContractValueError("sequence_first and sequence_last must be paired")
        if self.sequence_first is not None and self.sequence_last is not None:
            first = require_strict_int(
                self.sequence_first,
                field="sequence_first",
                minimum=0,
                maximum=UINT64_MAX,
            )
            last = require_strict_int(
                self.sequence_last,
                field="sequence_last",
                minimum=0,
                maximum=UINT64_MAX,
            )
            if first > last:
                raise ContractValueError("sequence_first must not exceed sequence_last")
        if not isinstance(self.raw_payload_digest, DigestV1):
            raise ContractValueError("raw_payload_digest must be DigestV1")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be an EvidencePosture")
        if not isinstance(self.duplicate, bool) or not isinstance(self.late, bool):
            raise ContractValueError("duplicate and late must be boolean")
        if not isinstance(self.quality, ResearchQualityAssessmentV1):
            raise ContractValueError("quality must be ResearchQualityAssessmentV1")
        synthetic_quality = "SYNTHETIC_EVIDENCE" in self.quality.reason_codes
        if (self.posture is EvidencePosture.SYNTHETIC) != synthetic_quality:
            raise ContractValueError(
                "synthetic posture and engine-derived synthetic reason must agree"
            )
        for field_name in ("price", "quantity"):
            value = getattr(self, field_name)
            if value is not None and not isinstance(value, ExactScaledValueV1):
                raise ContractValueError(f"{field_name} must be ExactScaledValueV1 or null")
        if self.price is not None and self.price.unit_id != self.quote_asset_id:
            raise ContractValueError("price unit must match quote_asset_id")
        if self.quantity is not None and self.quantity.unit_id != self.base_asset_id:
            raise ContractValueError("quantity unit must match base_asset_id")
        if self.quality.state is QualityState.UNAVAILABLE and (
            self.price is not None or self.quantity is not None
        ):
            raise ContractValueError("unavailable evidence cannot contain numeric observations")

    @property
    def canonical_order_key(self) -> tuple[int, int, int, str, str, int, int, str]:
        receive_is_null = int(self.receive_wall_time is None)
        receive_ns = 0 if self.receive_wall_time is None else self.receive_wall_time.normalized_ns
        sequence_is_null = int(self.sequence_first is None)
        sequence = 0 if self.sequence_first is None else self.sequence_first
        return (
            self.event_time.normalized_ns,
            receive_is_null,
            receive_ns,
            self.session_id,
            self.stream_id,
            sequence_is_null,
            sequence,
            self.record_id,
        )


@dataclass(frozen=True, slots=True)
class PartitionKeyV1:
    schema_version: str
    venue: str
    product: str
    event_kind: str
    utc_date: str
    symbol_shard: str

    def __post_init__(self) -> None:
        for field_name in (
            "schema_version",
            "venue",
            "product",
            "event_kind",
            "symbol_shard",
        ):
            require_path_segment(getattr(self, field_name), field=field_name)
        if not isinstance(self.utc_date, str):
            raise ContractValueError("utc_date must be canonical YYYY-MM-DD")
        try:
            parsed = date.fromisoformat(self.utc_date)
        except ValueError as error:
            raise ContractValueError("utc_date must be canonical YYYY-MM-DD") from error
        if parsed.isoformat() != self.utc_date:
            raise ContractValueError("utc_date must be canonical YYYY-MM-DD")

    def relative_partition_path(self, *, dataset_id: str, revision_id: str) -> str:
        dataset = require_path_segment(dataset_id, field="dataset_id")
        revision = require_path_segment(revision_id, field="revision_id")
        return "/".join(
            (
                "datasets",
                dataset,
                "revisions",
                revision,
                "partitions",
                self.schema_version,
                self.venue,
                self.product,
                self.event_kind,
                self.utc_date,
                f"{self.symbol_shard}.parquet",
            )
        )
