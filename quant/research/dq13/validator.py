from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, NoReturn

SCHEMA_V1: Final = "cosmos.dq13.causal-asof-clock.v1"
RECEIPT_SCHEMA_V1: Final = "cosmos.dq13.causal-asof-clock-receipt.v1"

_RECEIPT_DOMAIN: Final = b"cosmos-dq13-causal-asof-receipt-v1\0"
_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@+\-/]{0,127}$")
_INSTRUMENT_PATTERN: Final = re.compile(r"^[A-Z0-9_]{1,64}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_MAX_US: Final = (1 << 63) - 1
_MAX_ERROR_US: Final = 1_000_000_000
_MAX_SEQUENCE: Final = (1 << 63) - 1
_MAX_REQUIREMENTS: Final = 64
_MAX_OBSERVATIONS: Final = 4096
_MAX_JSON_BYTES: Final = 2_097_152
_US_PER_DAY: Final = 86_400_000_000
_SPOT_ARCHIVE_US_CUTOVER: Final = 1_735_689_600_000_000


class ClockContractError(ValueError):
    """Stable, path-addressed malformed-input failure."""

    def __init__(self, code: str, path: str, detail: str) -> None:
        self.code = code
        self.path = path
        super().__init__(f"{code} at {path}: {detail}")


class TimestampUnit(StrEnum):
    MILLISECOND = "MILLISECOND"
    MICROSECOND = "MICROSECOND"


class Product(StrEnum):
    SPOT = "SPOT"
    USD_M = "USD_M"


class FeedKind(StrEnum):
    KLINE = "KLINE"
    MARK_PRICE = "MARK_PRICE"
    INDEX_PRICE = "INDEX_PRICE"
    FUNDING = "FUNDING"
    CURRENT_EXCHANGE_INFO = "CURRENT_EXCHANGE_INFO"
    CURRENT_FUNDING_INFO = "CURRENT_FUNDING_INFO"


class ObservationShape(StrEnum):
    INTERVAL = "INTERVAL"
    INSTANT = "INSTANT"
    CURRENT_SNAPSHOT = "CURRENT_SNAPSHOT"


class SourceProfile(StrEnum):
    """One documented endpoint/response schema, not a transport family."""

    SPOT_REST_KLINES_MS = "SPOT_REST_KLINES_MS"
    SPOT_REST_KLINES_US = "SPOT_REST_KLINES_US"
    SPOT_WS_KLINE_MS = "SPOT_WS_KLINE_MS"
    SPOT_WS_KLINE_US = "SPOT_WS_KLINE_US"
    SPOT_ARCHIVE_KLINES_PRE_2025_MS = "SPOT_ARCHIVE_KLINES_PRE_2025_MS"
    SPOT_ARCHIVE_KLINES_FROM_2025_US = "SPOT_ARCHIVE_KLINES_FROM_2025_US"
    SPOT_REST_EXCHANGE_INFO_MS = "SPOT_REST_EXCHANGE_INFO_MS"
    USDM_REST_KLINES_MS = "USDM_REST_KLINES_MS"
    USDM_WS_KLINE_MS = "USDM_WS_KLINE_MS"
    USDM_REST_MARK_PRICE_KLINES_MS = "USDM_REST_MARK_PRICE_KLINES_MS"
    USDM_REST_INDEX_PRICE_KLINES_MS = "USDM_REST_INDEX_PRICE_KLINES_MS"
    USDM_WS_MARK_PRICE_MS = "USDM_WS_MARK_PRICE_MS"
    USDM_REST_PREMIUM_INDEX_MS = "USDM_REST_PREMIUM_INDEX_MS"
    USDM_REST_FUNDING_HISTORY_MS = "USDM_REST_FUNDING_HISTORY_MS"
    USDM_REST_EXCHANGE_INFO_MS = "USDM_REST_EXCHANGE_INFO_MS"
    USDM_REST_FUNDING_INFO_MS = "USDM_REST_FUNDING_INFO_MS"


class AvailabilityBasis(StrEnum):
    OBSERVED_RECEIPT = "OBSERVED_RECEIPT"
    FROZEN_RELEASE_EVIDENCE = "FROZEN_RELEASE_EVIDENCE"


class FillState(StrEnum):
    EXECUTED = "EXECUTED"
    NO_FILL = "NO_FILL"


class ValidationStatus(StrEnum):
    VALID = "VALID"
    UNKNOWN = "UNKNOWN"
    INVALID = "INVALID"


class _Order(StrEnum):
    TRUE = "TRUE"
    FALSE = "FALSE"
    UNKNOWN = "UNKNOWN"


class _Transport(StrEnum):
    STREAM = "STREAM"
    REQUEST = "REQUEST"
    ARCHIVE = "ARCHIVE"


class _IssueScope(StrEnum):
    """Whether a rejected contender may be ignored when a valid predecessor exists."""

    RECORD_ONLY = "RECORD_ONLY"
    FEED = "FEED"


@dataclass(frozen=True, slots=True)
class ClockStampV1:
    value: int
    unit: TimestampUnit
    clock_id: str
    max_error_us: int = 0
    sequence: int | None = None


@dataclass(frozen=True, slots=True)
class ClockBoundsV1:
    earliest_us: int
    latest_us: int
    resolution_us: int
    clock_id: str
    sequence: int | None

    def as_dict(self) -> dict[str, object]:
        return {
            "clockId": self.clock_id,
            "earliestUs": self.earliest_us,
            "latestUs": self.latest_us,
            "resolutionUs": self.resolution_us,
            "sequence": self.sequence,
        }


@dataclass(frozen=True, slots=True)
class FeedKeyV1:
    venue: str
    product: Product
    instrument: str
    kind: FeedKind
    interval_id: str | None

    def canonical_id(self) -> str:
        """Collision-free identity; the interval identity is always the final field."""

        interval = self.interval_id if self.interval_id is not None else "-"
        return f"{self.venue}:{self.product.value}:{self.instrument}:{self.kind.value}:{interval}"


@dataclass(frozen=True, slots=True)
class FeedRequirementV1:
    key: FeedKeyV1
    shape: ObservationShape
    max_event_age_us: int | None
    max_availability_age_us: int
    expected_interval_us: int | None


@dataclass(frozen=True, slots=True)
class FeedObservationV1:
    record_id: str
    key: FeedKeyV1
    source_profile: SourceProfile
    shape: ObservationShape
    availability_basis: AvailabilityBasis
    payload_digest: str
    availability_evidence_id: str | None
    availability_evidence_digest: str | None
    event_at: ClockStampV1 | None
    available_at: ClockStampV1 | None
    interval_open: ClockStampV1 | None
    interval_close_inclusive: ClockStampV1 | None
    is_final: bool | None


@dataclass(frozen=True, slots=True)
class DecisionFrameV1:
    schema: str
    decision_id: str
    decision_at: ClockStampV1 | None
    fill_state: FillState
    fill_at: ClockStampV1 | None
    requirements: tuple[FeedRequirementV1, ...]
    observations: tuple[FeedObservationV1, ...]


@dataclass(frozen=True, slots=True)
class FeedSelectionV1:
    key_id: str
    status: ValidationStatus
    reason_codes: tuple[str, ...]
    max_event_age_us: int | None
    max_availability_age_us: int
    selected_record_ids: tuple[str, ...]
    selected_payload_digest: str | None
    source_profile: SourceProfile | None
    availability_basis: AvailabilityBasis | None
    event_bounds: ClockBoundsV1 | None
    availability_bounds: ClockBoundsV1 | None
    availability_evidence_id: str | None
    availability_evidence_digest: str | None
    interval_open_us: int | None
    interval_end_exclusive_us: int | None

    def as_dict(self) -> dict[str, object]:
        return {
            "availabilityBounds": (
                None if self.availability_bounds is None else self.availability_bounds.as_dict()
            ),
            "availabilityEvidenceDigest": self.availability_evidence_digest,
            "availabilityEvidenceId": self.availability_evidence_id,
            "availabilityBasis": (
                None if self.availability_basis is None else self.availability_basis.value
            ),
            "eventBounds": None if self.event_bounds is None else self.event_bounds.as_dict(),
            "intervalEndExclusiveUs": self.interval_end_exclusive_us,
            "intervalOpenUs": self.interval_open_us,
            "keyId": self.key_id,
            "maxAvailabilityAgeUs": self.max_availability_age_us,
            "maxEventAgeUs": self.max_event_age_us,
            "reasonCodes": list(self.reason_codes),
            "selectedPayloadDigest": self.selected_payload_digest,
            "selectedRecordIds": list(self.selected_record_ids),
            "sourceProfile": (None if self.source_profile is None else self.source_profile.value),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class CausalReceiptV1:
    schema: str
    decision_id: str
    status: ValidationStatus
    reason_codes: tuple[str, ...]
    failure_path: str | None
    decision_bounds: ClockBoundsV1 | None
    fill_bounds: ClockBoundsV1 | None
    selections: tuple[FeedSelectionV1, ...]
    authority: str
    consumer_scope: tuple[str, ...]
    historical_reclassification: bool
    receipt_digest: str

    def _payload(self, *, include_digest: bool) -> dict[str, object]:
        return {
            "authority": self.authority,
            "consumerScope": list(self.consumer_scope),
            "decisionBounds": (
                None if self.decision_bounds is None else self.decision_bounds.as_dict()
            ),
            "decisionId": self.decision_id,
            "failurePath": self.failure_path,
            "fillBounds": None if self.fill_bounds is None else self.fill_bounds.as_dict(),
            "historicalReclassification": self.historical_reclassification,
            "reasonCodes": list(self.reason_codes),
            "receiptDigest": self.receipt_digest if include_digest else None,
            "schema": self.schema,
            "selections": [selection.as_dict() for selection in self.selections],
            "status": self.status.value,
        }

    def as_dict(self) -> dict[str, object]:
        return self._payload(include_digest=True)

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes_v1(self.as_dict())


@dataclass(frozen=True, slots=True)
class _EndpointSpec:
    product: Product
    unit: TimestampUnit
    transport: _Transport
    combinations: frozenset[tuple[FeedKind, ObservationShape]]


@dataclass(frozen=True, slots=True)
class _IntervalIdentity:
    step: str
    zone: str
    zone_offset_us: int
    fixed_duration_us: int | None


@dataclass(frozen=True, slots=True)
class _Candidate:
    observation: FeedObservationV1
    event: ClockBoundsV1 | None
    effective: ClockBoundsV1
    available: ClockBoundsV1
    interval_open_us: int | None
    interval_end_exclusive_us: int | None


class _CandidateIssue(Exception):
    def __init__(
        self,
        status: ValidationStatus,
        code: str,
        *,
        scope: _IssueScope = _IssueScope.FEED,
    ) -> None:
        self.status = status
        self.code = code
        self.scope = scope


def _fail(code: str, path: str, detail: str) -> NoReturn:
    raise ClockContractError(code, path, detail)


def canonical_json_bytes_v1(value: object) -> bytes:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (RecursionError, TypeError, ValueError) as error:
        raise ClockContractError(
            "CANONICAL_JSON_INVALID",
            "$",
            "value is outside the frozen JSON domain",
        ) from error
    return f"{encoded}\n".encode("utf-8", errors="strict")


def _strict_int(
    value: object,
    *,
    path: str,
    minimum: int,
    maximum: int,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail("INTEGER_INVALID", path, "must be a strict integer")
    if not minimum <= value <= maximum:
        _fail("INTEGER_OUT_OF_RANGE", path, f"must be in [{minimum}, {maximum}]")
    return value


def _strict_id(value: object, *, path: str) -> str:
    if not isinstance(value, str) or _ID_PATTERN.fullmatch(value) is None:
        _fail("ID_INVALID", path, "must match the frozen ASCII identifier contract")
    return value


def _strict_digest(value: object, *, path: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        _fail("DIGEST_INVALID", path, "must be lowercase SHA-256 hex")
    return value


def _strict_bool_or_none(value: object, *, path: str) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        _fail("BOOLEAN_INVALID", path, "must be boolean or null")
    return value


def _enum[EnumT: StrEnum](enum_type: type[EnumT], value: object, *, path: str) -> EnumT:
    if not isinstance(value, str):
        _fail("ENUM_INVALID", path, "must be a frozen enum string")
    try:
        return enum_type(value)
    except ValueError as error:
        _fail("ENUM_INVALID", path, f"unsupported {enum_type.__name__}")
        raise AssertionError from error


def _checked_enum[EnumT: StrEnum](enum_type: type[EnumT], value: object, *, path: str) -> EnumT:
    """Reject a look-alike string or foreign enum reaching the dataclass entrypoint."""

    if not isinstance(value, enum_type):
        _fail("ENUM_INVALID", path, f"must be a {enum_type.__name__} member")
    return value


def _mapping(
    value: object,
    *,
    path: str,
    required: frozenset[str],
    optional: frozenset[str] = frozenset(),
) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        _fail("MAPPING_REQUIRED", path, "must be an object")
    keys = set(value.keys())
    if any(not isinstance(key, str) for key in keys):
        _fail("KEYSET_INVALID", path, "keys must be strings")
    missing = required - keys
    extra = keys - required - optional
    if missing or extra:
        _fail(
            "KEYSET_INVALID",
            path,
            f"missing={sorted(missing)} extra={sorted(extra)}",
        )
    return value


def _sequence(value: object, *, path: str) -> Sequence[object]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        _fail("SEQUENCE_REQUIRED", path, "must be an array")
    return value


def _parse_stamp(value: object, *, path: str) -> ClockStampV1 | None:
    if value is None:
        return None
    data = _mapping(
        value,
        path=path,
        required=frozenset({"value", "unit", "clockId"}),
        optional=frozenset({"maxErrorUs", "sequence"}),
    )
    max_error = _strict_int(
        data.get("maxErrorUs", 0),
        path=f"{path}.maxErrorUs",
        minimum=0,
        maximum=_MAX_ERROR_US,
    )
    raw_sequence = data.get("sequence")
    parsed_sequence = (
        None
        if raw_sequence is None
        else _strict_int(
            raw_sequence,
            path=f"{path}.sequence",
            minimum=0,
            maximum=_MAX_SEQUENCE,
        )
    )
    return ClockStampV1(
        value=_strict_int(
            data["value"],
            path=f"{path}.value",
            minimum=0,
            maximum=_MAX_US,
        ),
        unit=_enum(TimestampUnit, data["unit"], path=f"{path}.unit"),
        clock_id=_strict_id(data["clockId"], path=f"{path}.clockId"),
        max_error_us=max_error,
        sequence=parsed_sequence,
    )


def _parse_key(value: object, *, path: str) -> FeedKeyV1:
    data = _mapping(
        value,
        path=path,
        required=frozenset({"venue", "product", "instrument", "kind", "intervalId"}),
    )
    interval_value = data["intervalId"]
    interval_id = (
        None if interval_value is None else _strict_id(interval_value, path=f"{path}.intervalId")
    )
    return FeedKeyV1(
        venue=_strict_id(data["venue"], path=f"{path}.venue"),
        product=_enum(Product, data["product"], path=f"{path}.product"),
        instrument=_strict_id(data["instrument"], path=f"{path}.instrument"),
        kind=_enum(FeedKind, data["kind"], path=f"{path}.kind"),
        interval_id=interval_id,
    )


def _parse_requirement(value: object, *, path: str) -> FeedRequirementV1:
    data = _mapping(
        value,
        path=path,
        required=frozenset(
            {
                "key",
                "shape",
                "maxEventAgeUs",
                "maxAvailabilityAgeUs",
                "expectedIntervalUs",
            }
        ),
    )
    raw_event_age = data["maxEventAgeUs"]
    event_age = (
        None
        if raw_event_age is None
        else _strict_int(
            raw_event_age,
            path=f"{path}.maxEventAgeUs",
            minimum=1,
            maximum=_MAX_US,
        )
    )
    raw_interval = data["expectedIntervalUs"]
    expected_interval = (
        None
        if raw_interval is None
        else _strict_int(
            raw_interval,
            path=f"{path}.expectedIntervalUs",
            minimum=1,
            maximum=_MAX_US,
        )
    )
    return FeedRequirementV1(
        key=_parse_key(data["key"], path=f"{path}.key"),
        shape=_enum(ObservationShape, data["shape"], path=f"{path}.shape"),
        max_event_age_us=event_age,
        max_availability_age_us=_strict_int(
            data["maxAvailabilityAgeUs"],
            path=f"{path}.maxAvailabilityAgeUs",
            minimum=1,
            maximum=_MAX_US,
        ),
        expected_interval_us=expected_interval,
    )


def _parse_observation(value: object, *, path: str) -> FeedObservationV1:
    data = _mapping(
        value,
        path=path,
        required=frozenset(
            {
                "recordId",
                "key",
                "sourceProfile",
                "shape",
                "availabilityBasis",
                "payloadDigest",
                "availabilityEvidenceId",
                "availabilityEvidenceDigest",
                "eventAt",
                "availableAt",
                "intervalOpen",
                "intervalCloseInclusive",
                "isFinal",
            }
        ),
    )
    raw_evidence_id = data["availabilityEvidenceId"]
    raw_evidence_digest = data["availabilityEvidenceDigest"]
    return FeedObservationV1(
        record_id=_strict_id(data["recordId"], path=f"{path}.recordId"),
        key=_parse_key(data["key"], path=f"{path}.key"),
        source_profile=_enum(
            SourceProfile,
            data["sourceProfile"],
            path=f"{path}.sourceProfile",
        ),
        shape=_enum(ObservationShape, data["shape"], path=f"{path}.shape"),
        availability_basis=_enum(
            AvailabilityBasis,
            data["availabilityBasis"],
            path=f"{path}.availabilityBasis",
        ),
        payload_digest=_strict_digest(data["payloadDigest"], path=f"{path}.payloadDigest"),
        availability_evidence_id=(
            None
            if raw_evidence_id is None
            else _strict_id(raw_evidence_id, path=f"{path}.availabilityEvidenceId")
        ),
        availability_evidence_digest=(
            None
            if raw_evidence_digest is None
            else _strict_digest(
                raw_evidence_digest,
                path=f"{path}.availabilityEvidenceDigest",
            )
        ),
        event_at=_parse_stamp(data["eventAt"], path=f"{path}.eventAt"),
        available_at=_parse_stamp(data["availableAt"], path=f"{path}.availableAt"),
        interval_open=_parse_stamp(data["intervalOpen"], path=f"{path}.intervalOpen"),
        interval_close_inclusive=_parse_stamp(
            data["intervalCloseInclusive"],
            path=f"{path}.intervalCloseInclusive",
        ),
        is_final=_strict_bool_or_none(data["isFinal"], path=f"{path}.isFinal"),
    )


def _check_unique_requirement_keys(
    requirements: Sequence[FeedRequirementV1],
    *,
    path: str,
) -> None:
    key_ids = [requirement.key.canonical_id() for requirement in requirements]
    if len(key_ids) != len(set(key_ids)):
        _fail("DUPLICATE_REQUIREMENT", path, "required feed keys must be unique")


def frame_from_mapping_v1(value: object) -> DecisionFrameV1:
    data = _mapping(
        value,
        path="$",
        required=frozenset(
            {
                "schema",
                "decisionId",
                "decisionAt",
                "fillState",
                "fillAt",
                "requirements",
                "observations",
            }
        ),
    )
    if data["schema"] != SCHEMA_V1:
        _fail("SCHEMA_MISMATCH", "$.schema", f"must equal {SCHEMA_V1}")
    requirement_values = _sequence(data["requirements"], path="$.requirements")
    observation_values = _sequence(data["observations"], path="$.observations")
    if not 1 <= len(requirement_values) <= _MAX_REQUIREMENTS:
        _fail(
            "REQUIREMENT_COUNT_INVALID",
            "$.requirements",
            f"must contain 1..{_MAX_REQUIREMENTS} entries",
        )
    if len(observation_values) > _MAX_OBSERVATIONS:
        _fail(
            "OBSERVATION_COUNT_INVALID",
            "$.observations",
            f"must contain at most {_MAX_OBSERVATIONS} entries",
        )
    requirements = tuple(
        _parse_requirement(item, path=f"$.requirements[{index}]")
        for index, item in enumerate(requirement_values)
    )
    _check_unique_requirement_keys(requirements, path="$.requirements")
    return DecisionFrameV1(
        schema=SCHEMA_V1,
        decision_id=_strict_id(data["decisionId"], path="$.decisionId"),
        decision_at=_parse_stamp(data["decisionAt"], path="$.decisionAt"),
        fill_state=_enum(FillState, data["fillState"], path="$.fillState"),
        fill_at=_parse_stamp(data["fillAt"], path="$.fillAt"),
        requirements=requirements,
        observations=tuple(
            _parse_observation(item, path=f"$.observations[{index}]")
            for index, item in enumerate(observation_values)
        ),
    )


def _check_stamp_object(stamp: ClockStampV1 | None, *, path: str) -> None:
    if stamp is None:
        return
    if not isinstance(stamp, ClockStampV1):
        _fail("STAMP_INVALID", path, "must be ClockStampV1 or null")
    _strict_int(stamp.value, path=f"{path}.value", minimum=0, maximum=_MAX_US)
    _checked_enum(TimestampUnit, stamp.unit, path=f"{path}.unit")
    _strict_id(stamp.clock_id, path=f"{path}.clockId")
    _strict_int(
        stamp.max_error_us,
        path=f"{path}.maxErrorUs",
        minimum=0,
        maximum=_MAX_ERROR_US,
    )
    if stamp.sequence is not None:
        _strict_int(
            stamp.sequence,
            path=f"{path}.sequence",
            minimum=0,
            maximum=_MAX_SEQUENCE,
        )


def _check_key_object(key: FeedKeyV1, *, path: str) -> None:
    if not isinstance(key, FeedKeyV1):
        _fail("KEY_INVALID", path, "must be FeedKeyV1")
    _strict_id(key.venue, path=f"{path}.venue")
    _checked_enum(Product, key.product, path=f"{path}.product")
    _strict_id(key.instrument, path=f"{path}.instrument")
    _checked_enum(FeedKind, key.kind, path=f"{path}.kind")
    if key.interval_id is not None:
        _strict_id(key.interval_id, path=f"{path}.intervalId")


def _check_requirement_object(requirement: FeedRequirementV1, *, path: str) -> None:
    if not isinstance(requirement, FeedRequirementV1):
        _fail("REQUIREMENT_INVALID", path, "must be FeedRequirementV1")
    _check_key_object(requirement.key, path=f"{path}.key")
    _checked_enum(ObservationShape, requirement.shape, path=f"{path}.shape")
    if requirement.max_event_age_us is not None:
        _strict_int(
            requirement.max_event_age_us,
            path=f"{path}.maxEventAgeUs",
            minimum=1,
            maximum=_MAX_US,
        )
    _strict_int(
        requirement.max_availability_age_us,
        path=f"{path}.maxAvailabilityAgeUs",
        minimum=1,
        maximum=_MAX_US,
    )
    if requirement.expected_interval_us is not None:
        _strict_int(
            requirement.expected_interval_us,
            path=f"{path}.expectedIntervalUs",
            minimum=1,
            maximum=_MAX_US,
        )


def _check_observation_object(observation: FeedObservationV1, *, path: str) -> None:
    if not isinstance(observation, FeedObservationV1):
        _fail("OBSERVATION_INVALID", path, "must be FeedObservationV1")
    _strict_id(observation.record_id, path=f"{path}.recordId")
    _check_key_object(observation.key, path=f"{path}.key")
    _checked_enum(SourceProfile, observation.source_profile, path=f"{path}.sourceProfile")
    _checked_enum(ObservationShape, observation.shape, path=f"{path}.shape")
    _checked_enum(
        AvailabilityBasis,
        observation.availability_basis,
        path=f"{path}.availabilityBasis",
    )
    _strict_digest(observation.payload_digest, path=f"{path}.payloadDigest")
    if observation.availability_evidence_id is not None:
        _strict_id(observation.availability_evidence_id, path=f"{path}.availabilityEvidenceId")
    if observation.availability_evidence_digest is not None:
        _strict_digest(
            observation.availability_evidence_digest,
            path=f"{path}.availabilityEvidenceDigest",
        )
    _check_stamp_object(observation.event_at, path=f"{path}.eventAt")
    _check_stamp_object(observation.available_at, path=f"{path}.availableAt")
    _check_stamp_object(observation.interval_open, path=f"{path}.intervalOpen")
    _check_stamp_object(
        observation.interval_close_inclusive,
        path=f"{path}.intervalCloseInclusive",
    )
    if observation.is_final is not None and not isinstance(observation.is_final, bool):
        _fail("BOOLEAN_INVALID", f"{path}.isFinal", "must be boolean or null")


def _check_frame_object(frame: DecisionFrameV1) -> None:
    """Validate a caller-constructed frame so the dataclass entrypoint stays total."""

    if frame.schema != SCHEMA_V1:
        _fail("SCHEMA_MISMATCH", "$.schema", f"must equal {SCHEMA_V1}")
    _strict_id(frame.decision_id, path="$.decisionId")
    _checked_enum(FillState, frame.fill_state, path="$.fillState")
    _check_stamp_object(frame.decision_at, path="$.decisionAt")
    _check_stamp_object(frame.fill_at, path="$.fillAt")
    if not isinstance(frame.requirements, tuple):
        _fail("SEQUENCE_REQUIRED", "$.requirements", "must be a tuple")
    if not isinstance(frame.observations, tuple):
        _fail("SEQUENCE_REQUIRED", "$.observations", "must be a tuple")
    if not 1 <= len(frame.requirements) <= _MAX_REQUIREMENTS:
        _fail(
            "REQUIREMENT_COUNT_INVALID",
            "$.requirements",
            f"must contain 1..{_MAX_REQUIREMENTS} entries",
        )
    if len(frame.observations) > _MAX_OBSERVATIONS:
        _fail(
            "OBSERVATION_COUNT_INVALID",
            "$.observations",
            f"must contain at most {_MAX_OBSERVATIONS} entries",
        )
    for index, requirement in enumerate(frame.requirements):
        _check_requirement_object(requirement, path=f"$.requirements[{index}]")
    for index, observation in enumerate(frame.observations):
        _check_observation_object(observation, path=f"$.observations[{index}]")
    _check_unique_requirement_keys(frame.requirements, path="$.requirements")


def _normalize(stamp: ClockStampV1, *, path: str) -> ClockBoundsV1:
    if not isinstance(stamp, ClockStampV1):
        _fail("STAMP_INVALID", path, "must be ClockStampV1")
    if not isinstance(stamp.unit, TimestampUnit):
        _fail("ENUM_INVALID", f"{path}.unit", "must be TimestampUnit")
    raw = _strict_int(stamp.value, path=f"{path}.value", minimum=0, maximum=_MAX_US)
    clock_id = _strict_id(stamp.clock_id, path=f"{path}.clockId")
    error = _strict_int(
        stamp.max_error_us,
        path=f"{path}.maxErrorUs",
        minimum=0,
        maximum=_MAX_ERROR_US,
    )
    sequence = (
        None
        if stamp.sequence is None
        else _strict_int(
            stamp.sequence,
            path=f"{path}.sequence",
            minimum=0,
            maximum=_MAX_SEQUENCE,
        )
    )
    resolution = 1000 if stamp.unit is TimestampUnit.MILLISECOND else 1
    scaled = raw * resolution
    latest = scaled + resolution - 1 + error
    earliest = scaled - error
    if earliest < 0 or latest > _MAX_US:
        _fail("TIMESTAMP_OVERFLOW", path, "normalized uncertainty bounds exceed int64 µs")
    return ClockBoundsV1(
        earliest_us=earliest,
        latest_us=latest,
        resolution_us=resolution,
        clock_id=clock_id,
        sequence=sequence,
    )


def _exact_boundary(stamp: ClockStampV1, *, path: str) -> int:
    bounds = _normalize(stamp, path=path)
    if stamp.max_error_us != 0:
        _fail("BOUNDARY_UNCERTAINTY_FORBIDDEN", path, "interval edges must be exact")
    return bounds.earliest_us


def _order_leq(left: ClockBoundsV1, right: ClockBoundsV1) -> _Order:
    if left.latest_us <= right.earliest_us:
        return _Order.TRUE
    if left.earliest_us > right.latest_us:
        return _Order.FALSE
    if left.clock_id == right.clock_id and left.sequence is not None and right.sequence is not None:
        return _Order.TRUE if left.sequence <= right.sequence else _Order.FALSE
    return _Order.UNKNOWN


def _strictly_after(left: ClockBoundsV1, right: ClockBoundsV1) -> bool:
    if left.earliest_us > right.latest_us:
        return True
    return (
        left.clock_id == right.clock_id
        and left.sequence is not None
        and right.sequence is not None
        and left.sequence > right.sequence
        and left.earliest_us <= right.latest_us
        and right.earliest_us <= left.latest_us
    )


def _freshness(
    event: ClockBoundsV1,
    decision: ClockBoundsV1,
    *,
    max_age_us: int,
) -> str:
    earliest_expiry = event.earliest_us + max_age_us
    latest_expiry = event.latest_us + max_age_us
    if earliest_expiry > _MAX_US or latest_expiry > _MAX_US:
        return "AMBIGUOUS"
    if decision.latest_us < earliest_expiry:
        return "FRESH"
    if decision.earliest_us >= latest_expiry:
        return "STALE"
    return "AMBIGUOUS"


_INTERVAL_ZONE_OFFSET_US: Final[dict[str, int]] = {
    "UTC": 0,
    "UTC+08:00": 8 * 3_600_000_000,
}

_FIXED_INTERVAL_US: Final[dict[str, int]] = {
    "1s": 1_000_000,
    "1m": 60_000_000,
    "3m": 180_000_000,
    "5m": 300_000_000,
    "15m": 900_000_000,
    "30m": 1_800_000_000,
    "1h": 3_600_000_000,
    "2h": 7_200_000_000,
    "4h": 14_400_000_000,
    "6h": 21_600_000_000,
    "8h": 28_800_000_000,
    "12h": 43_200_000_000,
    "1d": 86_400_000_000,
    "3d": 259_200_000_000,
    "1w": 604_800_000_000,
}

_CALENDAR_STEPS: Final[frozenset[str]] = frozenset({"1M"})
_CALENDAR_DURATION_US: Final[frozenset[int]] = frozenset(
    {28 * _US_PER_DAY, 29 * _US_PER_DAY, 30 * _US_PER_DAY, 31 * _US_PER_DAY}
)
_SECOND_STEP: Final = "1s"
_FIXED_INTERVAL_PHASE_US: Final[dict[str, int]] = {
    "3d": _US_PER_DAY,
    "1w": 4 * _US_PER_DAY,
}

_KLINE_INTERVAL: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {(FeedKind.KLINE, ObservationShape.INTERVAL)}
)
_MARK_INTERVAL: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {(FeedKind.MARK_PRICE, ObservationShape.INTERVAL)}
)
_INDEX_INTERVAL: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {(FeedKind.INDEX_PRICE, ObservationShape.INTERVAL)}
)
_MARK_INDEX_INSTANT: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {
        (FeedKind.MARK_PRICE, ObservationShape.INSTANT),
        (FeedKind.INDEX_PRICE, ObservationShape.INSTANT),
    }
)
_FUNDING_INSTANT: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {(FeedKind.FUNDING, ObservationShape.INSTANT)}
)
_EXCHANGE_INFO_SNAPSHOT: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {(FeedKind.CURRENT_EXCHANGE_INFO, ObservationShape.CURRENT_SNAPSHOT)}
)
_FUNDING_INFO_SNAPSHOT: Final[frozenset[tuple[FeedKind, ObservationShape]]] = frozenset(
    {(FeedKind.CURRENT_FUNDING_INFO, ObservationShape.CURRENT_SNAPSHOT)}
)

_PROFILE_SPECS: Final[dict[SourceProfile, _EndpointSpec]] = {
    SourceProfile.SPOT_REST_KLINES_MS: _EndpointSpec(
        Product.SPOT, TimestampUnit.MILLISECOND, _Transport.REQUEST, _KLINE_INTERVAL
    ),
    SourceProfile.SPOT_REST_KLINES_US: _EndpointSpec(
        Product.SPOT, TimestampUnit.MICROSECOND, _Transport.REQUEST, _KLINE_INTERVAL
    ),
    SourceProfile.SPOT_WS_KLINE_MS: _EndpointSpec(
        Product.SPOT, TimestampUnit.MILLISECOND, _Transport.STREAM, _KLINE_INTERVAL
    ),
    SourceProfile.SPOT_WS_KLINE_US: _EndpointSpec(
        Product.SPOT, TimestampUnit.MICROSECOND, _Transport.STREAM, _KLINE_INTERVAL
    ),
    SourceProfile.SPOT_ARCHIVE_KLINES_PRE_2025_MS: _EndpointSpec(
        Product.SPOT, TimestampUnit.MILLISECOND, _Transport.ARCHIVE, _KLINE_INTERVAL
    ),
    SourceProfile.SPOT_ARCHIVE_KLINES_FROM_2025_US: _EndpointSpec(
        Product.SPOT, TimestampUnit.MICROSECOND, _Transport.ARCHIVE, _KLINE_INTERVAL
    ),
    SourceProfile.SPOT_REST_EXCHANGE_INFO_MS: _EndpointSpec(
        Product.SPOT, TimestampUnit.MILLISECOND, _Transport.REQUEST, _EXCHANGE_INFO_SNAPSHOT
    ),
    SourceProfile.USDM_REST_KLINES_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _KLINE_INTERVAL
    ),
    SourceProfile.USDM_WS_KLINE_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.STREAM, _KLINE_INTERVAL
    ),
    SourceProfile.USDM_REST_MARK_PRICE_KLINES_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _MARK_INTERVAL
    ),
    SourceProfile.USDM_REST_INDEX_PRICE_KLINES_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _INDEX_INTERVAL
    ),
    SourceProfile.USDM_WS_MARK_PRICE_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.STREAM, _MARK_INDEX_INSTANT
    ),
    SourceProfile.USDM_REST_PREMIUM_INDEX_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _MARK_INDEX_INSTANT
    ),
    SourceProfile.USDM_REST_FUNDING_HISTORY_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _FUNDING_INSTANT
    ),
    SourceProfile.USDM_REST_EXCHANGE_INFO_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _EXCHANGE_INFO_SNAPSHOT
    ),
    SourceProfile.USDM_REST_FUNDING_INFO_MS: _EndpointSpec(
        Product.USD_M, TimestampUnit.MILLISECOND, _Transport.REQUEST, _FUNDING_INFO_SNAPSHOT
    ),
}

_UTC_INTERVAL_ZONE: Final[frozenset[str]] = frozenset({"UTC"})
_SPOT_SHIFTED_INTERVAL_ZONES: Final[frozenset[str]] = frozenset({"UTC", "UTC+08:00"})
_PROFILE_INTERVAL_ZONES: Final[dict[SourceProfile, frozenset[str]]] = {
    SourceProfile.SPOT_REST_KLINES_MS: _SPOT_SHIFTED_INTERVAL_ZONES,
    SourceProfile.SPOT_REST_KLINES_US: _SPOT_SHIFTED_INTERVAL_ZONES,
    SourceProfile.SPOT_WS_KLINE_MS: _SPOT_SHIFTED_INTERVAL_ZONES,
    SourceProfile.SPOT_WS_KLINE_US: _SPOT_SHIFTED_INTERVAL_ZONES,
    SourceProfile.SPOT_ARCHIVE_KLINES_PRE_2025_MS: _UTC_INTERVAL_ZONE,
    SourceProfile.SPOT_ARCHIVE_KLINES_FROM_2025_US: _UTC_INTERVAL_ZONE,
    SourceProfile.USDM_REST_KLINES_MS: _UTC_INTERVAL_ZONE,
    SourceProfile.USDM_WS_KLINE_MS: _UTC_INTERVAL_ZONE,
    SourceProfile.USDM_REST_MARK_PRICE_KLINES_MS: _UTC_INTERVAL_ZONE,
    SourceProfile.USDM_REST_INDEX_PRICE_KLINES_MS: _UTC_INTERVAL_ZONE,
}

_SERVICEABLE: Final[frozenset[tuple[Product, FeedKind, ObservationShape]]] = frozenset(
    (spec.product, kind, shape)
    for spec in _PROFILE_SPECS.values()
    for kind, shape in spec.combinations
)

_SETTLED_FUNDING_PROFILE: Final = SourceProfile.USDM_REST_FUNDING_HISTORY_MS
_SNAPSHOT_KINDS: Final[frozenset[FeedKind]] = frozenset(
    {FeedKind.CURRENT_EXCHANGE_INFO, FeedKind.CURRENT_FUNDING_INFO}
)


def _interval_identity(interval_id: str, *, path: str) -> _IntervalIdentity:
    """Parse `<step>@<zone>`; identity is collision-free across alignments."""

    step, separator, zone = interval_id.partition("@")
    if not separator:
        _fail(
            "INTERVAL_ID_INVALID",
            path,
            "interval identity must declare '<step>@<zone>' alignment",
        )
    offset = _INTERVAL_ZONE_OFFSET_US.get(zone)
    if offset is None:
        _fail(
            "INTERVAL_ZONE_UNSUPPORTED",
            path,
            "v1 accepts UTC or UTC+08:00 kline alignment only",
        )
    fixed = _FIXED_INTERVAL_US.get(step)
    if fixed is None and step not in _CALENDAR_STEPS:
        _fail(
            "INTERVAL_STEP_UNSUPPORTED",
            path,
            "step is outside the documented Binance kline interval set",
        )
    return _IntervalIdentity(
        step=step,
        zone=zone,
        zone_offset_us=offset,
        fixed_duration_us=fixed,
    )


def _is_local_month_start(local_us: int) -> bool:
    """True when the local wall clock is exactly midnight on the first of a month."""

    if local_us < 0 or local_us % _US_PER_DAY != 0:
        return False
    days = local_us // _US_PER_DAY + 719_468
    era = days // 146_097
    day_of_era = days - era * 146_097
    year_of_era = (
        day_of_era - day_of_era // 1460 + day_of_era // 36_524 - day_of_era // 146_096
    ) // 365
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
    month_phase = (5 * day_of_year + 2) // 153
    return day_of_year - (153 * month_phase + 2) // 5 + 1 == 1


def _is_fixed_interval_start(open_us: int, identity: _IntervalIdentity) -> bool:
    """Check the frozen Binance local-zone phase for every fixed interval."""

    duration_us = identity.fixed_duration_us
    if duration_us is None:
        return False
    local_us = open_us + identity.zone_offset_us
    phase_us = _FIXED_INTERVAL_PHASE_US.get(identity.step, 0)
    return local_us >= 0 and (local_us - phase_us) % duration_us == 0


def _validate_requirement(requirement: FeedRequirementV1) -> None:
    key = requirement.key
    key_id = key.canonical_id()
    if key.venue != "BINANCE":
        _fail("VENUE_UNSUPPORTED", key_id, "v1 accepts Binance public feeds only")
    if _INSTRUMENT_PATTERN.fullmatch(key.instrument) is None:
        _fail(
            "INSTRUMENT_INVALID",
            key_id,
            "instrument must be an uppercase Binance identifier",
        )
    if requirement.shape is ObservationShape.INTERVAL:
        if key.kind not in {FeedKind.KLINE, FeedKind.MARK_PRICE, FeedKind.INDEX_PRICE}:
            _fail(
                "SHAPE_KIND_MISMATCH",
                key_id,
                "interval shape requires kline, mark-price, or index-price feed",
            )
        if key.interval_id is None:
            _fail(
                "INTERVAL_ID_MISSING",
                key_id,
                "interval feeds require an exact interval identity",
            )
        identity = _interval_identity(key.interval_id, path=key_id)
        serviceable_zones = frozenset(
            zone
            for profile, spec in _PROFILE_SPECS.items()
            if spec.product is key.product and (key.kind, requirement.shape) in spec.combinations
            for zone in _PROFILE_INTERVAL_ZONES.get(profile, frozenset())
        )
        if serviceable_zones and identity.zone not in serviceable_zones:
            _fail(
                "INTERVAL_ZONE_PROFILE_UNSERVICEABLE",
                key_id,
                "no frozen endpoint profile serves this interval zone",
            )
        if key.product is Product.USD_M and identity.step == _SECOND_STEP:
            _fail(
                "USD_M_SECOND_INTERVAL_UNSUPPORTED",
                key_id,
                "USD-M symbol/mark/index one-second klines are endpoint-ambiguous in v1",
            )
        if requirement.expected_interval_us is None:
            _fail(
                "INTERVAL_DURATION_MISSING",
                key_id,
                "every interval feed must declare its exact duration",
            )
        if identity.fixed_duration_us is not None:
            if requirement.expected_interval_us != identity.fixed_duration_us:
                _fail(
                    "INTERVAL_DURATION_DECLARATION_INVALID",
                    key_id,
                    "declared duration contradicts the frozen step duration",
                )
        elif requirement.expected_interval_us not in _CALENDAR_DURATION_US:
            _fail(
                "INTERVAL_DURATION_DECLARATION_INVALID",
                key_id,
                "calendar step duration must be an exact 28..31 day month",
            )
        if requirement.max_event_age_us is None:
            _fail(
                "EVENT_FRESHNESS_MISSING",
                key_id,
                "interval feeds require semantic freshness",
            )
    elif requirement.shape is ObservationShape.INSTANT:
        if key.kind not in {FeedKind.MARK_PRICE, FeedKind.INDEX_PRICE, FeedKind.FUNDING}:
            _fail(
                "SHAPE_KIND_MISMATCH",
                key_id,
                "instant shape requires mark, index, or settled funding",
            )
        if key.interval_id is not None or requirement.expected_interval_us is not None:
            _fail(
                "INTERVAL_FIELDS_FORBIDDEN",
                key_id,
                "instant feeds cannot declare interval fields",
            )
        if requirement.max_event_age_us is None:
            _fail(
                "EVENT_FRESHNESS_MISSING",
                key_id,
                "instant feeds require semantic freshness",
            )
    else:
        if key.kind not in _SNAPSHOT_KINDS:
            _fail(
                "SHAPE_KIND_MISMATCH",
                key_id,
                "current snapshot shape is exchange-info or funding-info only",
            )
        if (
            key.interval_id is not None
            or requirement.expected_interval_us is not None
            or requirement.max_event_age_us is not None
        ):
            _fail(
                "CURRENT_SNAPSHOT_CONTRACT_INVALID",
                key_id,
                "current metadata uses receipt freshness only",
            )
    if (key.product, key.kind, requirement.shape) not in _SERVICEABLE:
        _fail(
            "REQUIREMENT_UNSERVICEABLE",
            key_id,
            "no documented endpoint schema can serve this product/kind/shape",
        )


def _endpoint_spec(observation: FeedObservationV1) -> _EndpointSpec:
    spec = _PROFILE_SPECS.get(observation.source_profile)
    if spec is None:
        raise _CandidateIssue(ValidationStatus.INVALID, "SOURCE_PROFILE_UNSUPPORTED")
    if observation.key.product is not spec.product:
        raise _CandidateIssue(ValidationStatus.INVALID, "SOURCE_PRODUCT_CONTRADICTION")
    if (
        observation.key.kind is FeedKind.FUNDING
        and observation.source_profile is not _SETTLED_FUNDING_PROFILE
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "SETTLED_FUNDING_SOURCE_INVALID")
    if (observation.key.kind, observation.shape) not in spec.combinations:
        raise _CandidateIssue(ValidationStatus.INVALID, "SOURCE_ENDPOINT_CONTRADICTION")
    return spec


def _check_availability_contract(observation: FeedObservationV1, spec: _EndpointSpec) -> None:
    if (
        spec.transport is _Transport.STREAM
        and observation.availability_basis is not AvailabilityBasis.OBSERVED_RECEIPT
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "STREAM_RECEIPT_REQUIRED")
    if (
        observation.shape is ObservationShape.CURRENT_SNAPSHOT
        and observation.availability_basis is not AvailabilityBasis.OBSERVED_RECEIPT
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "CURRENT_SNAPSHOT_RECEIPT_REQUIRED")
    if observation.available_at is None:
        if (
            observation.availability_evidence_id is not None
            or observation.availability_evidence_digest is not None
        ):
            raise _CandidateIssue(ValidationStatus.INVALID, "AVAILABILITY_EVIDENCE_WITHOUT_CLOCK")
        return
    if (
        observation.availability_evidence_id is None
        or observation.availability_evidence_digest is None
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "AVAILABILITY_EVIDENCE_MISSING")


def _interval_structure(
    observation: FeedObservationV1,
    requirement: FeedRequirementV1,
    spec: _EndpointSpec,
    identity: _IntervalIdentity | None,
) -> tuple[int, int] | None:
    """Validate every supplied interval field; return exact edges when both are present."""

    if identity is None:
        raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_ID_MISSING")
    if identity.zone not in _PROFILE_INTERVAL_ZONES.get(
        observation.source_profile,
        frozenset(),
    ):
        raise _CandidateIssue(
            ValidationStatus.INVALID,
            "SOURCE_INTERVAL_ZONE_CONTRADICTION",
        )
    if spec.transport is _Transport.STREAM:
        if observation.is_final is False:
            raise _CandidateIssue(
                ValidationStatus.UNKNOWN,
                "INTERVAL_NOT_FINAL",
                scope=_IssueScope.RECORD_ONLY,
            )
    else:
        if observation.event_at is not None:
            raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_EVENT_CLOCK_FORBIDDEN")
        if observation.is_final is not None:
            raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_FINAL_FLAG_FORBIDDEN")
    for stamp in (
        observation.event_at,
        observation.interval_open,
        observation.interval_close_inclusive,
    ):
        if stamp is not None and stamp.unit is not spec.unit:
            raise _CandidateIssue(ValidationStatus.INVALID, "SOURCE_UNIT_CONTRADICTION")
    open_stamp = observation.interval_open
    close_stamp = observation.interval_close_inclusive
    if open_stamp is None or close_stamp is None:
        return None
    if open_stamp.clock_id != close_stamp.clock_id or open_stamp.unit is not close_stamp.unit:
        raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_CLOCK_CONTRADICTION")
    open_us = _exact_boundary(open_stamp, path=f"{observation.record_id}.intervalOpen")
    close_us = _exact_boundary(
        close_stamp,
        path=f"{observation.record_id}.intervalCloseInclusive",
    )
    end_us = close_us + (1000 if close_stamp.unit is TimestampUnit.MILLISECOND else 1)
    if end_us > _MAX_US or open_us >= end_us:
        raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_EDGE_INVALID")
    if (
        requirement.expected_interval_us is None
        or end_us - open_us != requirement.expected_interval_us
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_DURATION_INVALID")
    if identity.fixed_duration_us is not None and not _is_fixed_interval_start(
        open_us,
        identity,
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_PHASE_INVALID")
    if identity.fixed_duration_us is None and not (
        _is_local_month_start(open_us + identity.zone_offset_us)
        and _is_local_month_start(end_us + identity.zone_offset_us)
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "INTERVAL_CALENDAR_EDGE_INVALID")
    if (
        observation.source_profile is SourceProfile.SPOT_ARCHIVE_KLINES_PRE_2025_MS
        and open_us >= _SPOT_ARCHIVE_US_CUTOVER
    ) or (
        observation.source_profile is SourceProfile.SPOT_ARCHIVE_KLINES_FROM_2025_US
        and open_us < _SPOT_ARCHIVE_US_CUTOVER
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "SPOT_ARCHIVE_UNIT_EPOCH_INVALID")
    return (open_us, end_us)


def _instant_structure(observation: FeedObservationV1, spec: _EndpointSpec) -> None:
    if (
        observation.interval_open is not None
        or observation.interval_close_inclusive is not None
        or observation.is_final is not None
    ):
        raise _CandidateIssue(ValidationStatus.INVALID, "INSTANT_INTERVAL_FIELDS_FORBIDDEN")
    if observation.event_at is not None and observation.event_at.unit is not spec.unit:
        raise _CandidateIssue(ValidationStatus.INVALID, "SOURCE_UNIT_CONTRADICTION")


def _snapshot_structure(observation: FeedObservationV1) -> None:
    if (
        observation.event_at is not None
        or observation.interval_open is not None
        or observation.interval_close_inclusive is not None
        or observation.is_final is not None
    ):
        raise _CandidateIssue(
            ValidationStatus.INVALID,
            "CURRENT_SNAPSHOT_EVENT_OR_INTERVAL_FORBIDDEN",
        )


def _candidate_for(
    observation: FeedObservationV1,
    requirement: FeedRequirementV1,
    identity: _IntervalIdentity | None,
    decision: ClockBoundsV1,
) -> _Candidate:
    if observation.shape is not requirement.shape:
        raise _CandidateIssue(ValidationStatus.INVALID, "OBSERVATION_SHAPE_MISMATCH")
    spec = _endpoint_spec(observation)
    _check_availability_contract(observation, spec)

    edges: tuple[int, int] | None = None
    if observation.shape is ObservationShape.INTERVAL:
        edges = _interval_structure(observation, requirement, spec, identity)
    elif observation.shape is ObservationShape.INSTANT:
        _instant_structure(observation, spec)
    else:
        _snapshot_structure(observation)

    if observation.available_at is None:
        raise _CandidateIssue(ValidationStatus.UNKNOWN, "AVAILABILITY_TIME_MISSING")
    available = _normalize(observation.available_at, path=f"{observation.record_id}.availableAt")
    presence = _order_leq(available, decision)
    if presence is _Order.FALSE:
        raise _CandidateIssue(
            ValidationStatus.UNKNOWN,
            (
                "CURRENT_SNAPSHOT_BACKFILL_FORBIDDEN"
                if observation.shape is ObservationShape.CURRENT_SNAPSHOT
                else "AVAILABLE_AFTER_DECISION"
            ),
            scope=_IssueScope.RECORD_ONLY,
        )
    if presence is _Order.UNKNOWN:
        raise _CandidateIssue(ValidationStatus.UNKNOWN, "AVAILABILITY_DECISION_ORDER_AMBIGUOUS")

    event: ClockBoundsV1 | None
    interval_open_us: int | None = None
    interval_end_us: int | None = None
    if observation.shape is ObservationShape.CURRENT_SNAPSHOT:
        event = None
        effective = available
    elif observation.shape is ObservationShape.INSTANT:
        if observation.event_at is None:
            raise _CandidateIssue(ValidationStatus.UNKNOWN, "EVENT_TIME_MISSING")
        event = _normalize(observation.event_at, path=f"{observation.record_id}.eventAt")
        effective = event
    else:
        if edges is None:
            raise _CandidateIssue(ValidationStatus.UNKNOWN, "INTERVAL_CLOCK_MISSING")
        if spec.transport is _Transport.STREAM:
            if observation.is_final is None:
                raise _CandidateIssue(ValidationStatus.UNKNOWN, "INTERVAL_FINAL_FLAG_MISSING")
            if observation.event_at is None:
                raise _CandidateIssue(ValidationStatus.UNKNOWN, "INTERVAL_EVENT_CLOCK_MISSING")
            event = _normalize(observation.event_at, path=f"{observation.record_id}.eventAt")
        else:
            event = None
        interval_open_us, interval_end_us = edges
        close_stamp = observation.interval_close_inclusive
        if close_stamp is None:
            raise _CandidateIssue(ValidationStatus.UNKNOWN, "INTERVAL_CLOCK_MISSING")
        effective = ClockBoundsV1(
            earliest_us=interval_end_us,
            latest_us=interval_end_us,
            resolution_us=1,
            clock_id=close_stamp.clock_id,
            sequence=close_stamp.sequence,
        )
        end_available_order = _order_leq(effective, available)
        if end_available_order is _Order.FALSE:
            raise _CandidateIssue(
                ValidationStatus.UNKNOWN,
                "INTERVAL_INCOMPLETE_AT_AVAILABILITY",
                scope=_IssueScope.RECORD_ONLY,
            )
        if end_available_order is _Order.UNKNOWN:
            raise _CandidateIssue(
                ValidationStatus.UNKNOWN,
                "INTERVAL_AVAILABILITY_END_ORDER_AMBIGUOUS",
            )

    if event is not None:
        event_available_order = _order_leq(event, available)
        if event_available_order is _Order.FALSE:
            raise _CandidateIssue(ValidationStatus.UNKNOWN, "EVENT_AFTER_AVAILABILITY")
        if event_available_order is _Order.UNKNOWN:
            raise _CandidateIssue(
                ValidationStatus.UNKNOWN,
                "EVENT_AVAILABILITY_ORDER_AMBIGUOUS",
            )

    if requirement.max_event_age_us is not None:
        event_freshness = _freshness(
            effective,
            decision,
            max_age_us=requirement.max_event_age_us,
        )
        if event_freshness == "STALE":
            raise _CandidateIssue(
                ValidationStatus.UNKNOWN,
                "EVENT_STALE",
                scope=_IssueScope.RECORD_ONLY,
            )
        if event_freshness == "AMBIGUOUS":
            raise _CandidateIssue(ValidationStatus.UNKNOWN, "EVENT_FRESHNESS_AMBIGUOUS")
    availability_freshness = _freshness(
        available,
        decision,
        max_age_us=requirement.max_availability_age_us,
    )
    if availability_freshness == "STALE":
        raise _CandidateIssue(
            ValidationStatus.UNKNOWN,
            "AVAILABILITY_STALE",
            scope=_IssueScope.RECORD_ONLY,
        )
    if availability_freshness == "AMBIGUOUS":
        raise _CandidateIssue(
            ValidationStatus.UNKNOWN,
            "AVAILABILITY_FRESHNESS_AMBIGUOUS",
        )
    return _Candidate(
        observation=observation,
        event=event,
        effective=effective,
        available=available,
        interval_open_us=interval_open_us,
        interval_end_exclusive_us=interval_end_us,
    )


def _same_semantic_candidate(left: _Candidate, right: _Candidate) -> bool:
    return (
        left.observation.payload_digest == right.observation.payload_digest
        and left.observation.source_profile is right.observation.source_profile
        and left.observation.availability_basis is right.observation.availability_basis
        and left.observation.availability_evidence_id == right.observation.availability_evidence_id
        and left.observation.availability_evidence_digest
        == right.observation.availability_evidence_digest
        and left.event == right.event
        and left.effective == right.effective
        and left.available == right.available
        and left.interval_open_us == right.interval_open_us
        and left.interval_end_exclusive_us == right.interval_end_exclusive_us
    )


def _same_effective_instant(left: _Candidate, right: _Candidate) -> bool:
    """Compare semantic time while deliberately excluding ordering sequence."""

    return (
        left.effective.earliest_us == right.effective.earliest_us
        and left.effective.latest_us == right.effective.latest_us
        and left.effective.resolution_us == right.effective.resolution_us
        and left.effective.clock_id == right.effective.clock_id
    )


def _unresolved_selection(
    *,
    requirement: FeedRequirementV1,
    status: ValidationStatus,
    reason_codes: tuple[str, ...],
) -> FeedSelectionV1:
    return FeedSelectionV1(
        key_id=requirement.key.canonical_id(),
        status=status,
        reason_codes=reason_codes,
        max_event_age_us=requirement.max_event_age_us,
        max_availability_age_us=requirement.max_availability_age_us,
        selected_record_ids=(),
        selected_payload_digest=None,
        source_profile=None,
        availability_basis=None,
        event_bounds=None,
        availability_bounds=None,
        availability_evidence_id=None,
        availability_evidence_digest=None,
        interval_open_us=None,
        interval_end_exclusive_us=None,
    )


def _select_requirement(
    requirement: FeedRequirementV1,
    observations: tuple[FeedObservationV1, ...],
    decision: ClockBoundsV1,
) -> FeedSelectionV1:
    key_id = requirement.key.canonical_id()
    identity = (
        _interval_identity(requirement.key.interval_id, path=key_id)
        if requirement.shape is ObservationShape.INTERVAL
        and requirement.key.interval_id is not None
        else None
    )
    matching = tuple(
        observation for observation in observations if observation.key == requirement.key
    )
    if not matching:
        return _unresolved_selection(
            requirement=requirement,
            status=ValidationStatus.UNKNOWN,
            reason_codes=("MISSING_REQUIRED_FEED",),
        )

    records_by_id: dict[str, FeedObservationV1] = {}
    for observation in matching:
        prior = records_by_id.get(observation.record_id)
        if prior is not None and prior != observation:
            return _unresolved_selection(
                requirement=requirement,
                status=ValidationStatus.UNKNOWN,
                reason_codes=("RECORD_ID_CONTRADICTION",),
            )
        records_by_id[observation.record_id] = observation

    candidates: list[_Candidate] = []
    invalid_reasons: set[str] = set()
    feed_unknown: set[str] = set()
    record_unknown: set[str] = set()
    for observation in records_by_id.values():
        try:
            candidates.append(_candidate_for(observation, requirement, identity, decision))
        except _CandidateIssue as issue:
            if issue.status is ValidationStatus.INVALID:
                invalid_reasons.add(issue.code)
            elif issue.scope is _IssueScope.FEED:
                feed_unknown.add(issue.code)
            else:
                record_unknown.add(issue.code)
        except ClockContractError as error:
            invalid_reasons.add(error.code)
    if invalid_reasons:
        return _unresolved_selection(
            requirement=requirement,
            status=ValidationStatus.INVALID,
            reason_codes=tuple(sorted(invalid_reasons)),
        )
    if not candidates:
        return _unresolved_selection(
            requirement=requirement,
            status=ValidationStatus.UNKNOWN,
            reason_codes=tuple(
                sorted(feed_unknown | record_unknown or {"NO_CAUSAL_ASOF_RECORD"}),
            ),
        )

    # A contender that is causally present by the decision but contradictory or
    # unplaceable poisons the feed even when an older candidate is admissible.
    # Only provably future, stale, or partial nonfinal contenders may be ignored.
    unknown_reasons = set(feed_unknown)
    for index, candidate in enumerate(candidates):
        for other in candidates[index + 1 :]:
            if (
                _same_effective_instant(candidate, other)
                and candidate.observation.payload_digest != other.observation.payload_digest
            ):
                unknown_reasons.add("CONTRADICTORY_ASOF_RECORDS")
    maxima = [
        candidate
        for candidate in candidates
        if not any(
            other is not candidate and _strictly_after(other.effective, candidate.effective)
            for other in candidates
        )
    ]
    if not maxima:
        unknown_reasons.add("ASOF_ORDER_CYCLE")
        return _unresolved_selection(
            requirement=requirement,
            status=ValidationStatus.UNKNOWN,
            reason_codes=tuple(sorted(unknown_reasons)),
        )
    first = min(maxima, key=lambda candidate: candidate.observation.record_id)
    if not all(_same_semantic_candidate(first, candidate) for candidate in maxima):
        same_effective = all(_same_effective_instant(candidate, first) for candidate in maxima)
        unknown_reasons.add(
            "CONTRADICTORY_ASOF_RECORDS" if same_effective else "ASOF_ORDER_AMBIGUOUS"
        )
    if unknown_reasons:
        return _unresolved_selection(
            requirement=requirement,
            status=ValidationStatus.UNKNOWN,
            reason_codes=tuple(sorted(unknown_reasons)),
        )
    selected_ids = tuple(sorted(candidate.observation.record_id for candidate in maxima))
    return FeedSelectionV1(
        key_id=key_id,
        status=ValidationStatus.VALID,
        reason_codes=(),
        max_event_age_us=requirement.max_event_age_us,
        max_availability_age_us=requirement.max_availability_age_us,
        selected_record_ids=selected_ids,
        selected_payload_digest=first.observation.payload_digest,
        source_profile=first.observation.source_profile,
        availability_basis=first.observation.availability_basis,
        event_bounds=first.event,
        availability_bounds=first.available,
        availability_evidence_id=first.observation.availability_evidence_id,
        availability_evidence_digest=first.observation.availability_evidence_digest,
        interval_open_us=first.interval_open_us,
        interval_end_exclusive_us=first.interval_end_exclusive_us,
    )


def _make_receipt(
    *,
    decision_id: str,
    status: ValidationStatus,
    reason_codes: tuple[str, ...],
    failure_path: str | None,
    decision_bounds: ClockBoundsV1 | None,
    fill_bounds: ClockBoundsV1 | None,
    selections: tuple[FeedSelectionV1, ...],
) -> CausalReceiptV1:
    provisional = CausalReceiptV1(
        schema=RECEIPT_SCHEMA_V1,
        decision_id=decision_id,
        status=status,
        reason_codes=tuple(sorted(set(reason_codes))),
        failure_path=failure_path,
        decision_bounds=decision_bounds,
        fill_bounds=fill_bounds,
        selections=selections,
        authority="NONE",
        consumer_scope=("FUTURE_S1_VG", "N3_FINAL_CONVERGENCE"),
        historical_reclassification=False,
        receipt_digest="",
    )
    digest = hashlib.sha256(
        _RECEIPT_DOMAIN + canonical_json_bytes_v1(provisional._payload(include_digest=False))
    ).hexdigest()
    return CausalReceiptV1(
        schema=provisional.schema,
        decision_id=provisional.decision_id,
        status=provisional.status,
        reason_codes=provisional.reason_codes,
        failure_path=provisional.failure_path,
        decision_bounds=provisional.decision_bounds,
        fill_bounds=provisional.fill_bounds,
        selections=provisional.selections,
        authority=provisional.authority,
        consumer_scope=provisional.consumer_scope,
        historical_reclassification=provisional.historical_reclassification,
        receipt_digest=digest,
    )


def _invalid_receipt(code: str, *, path: str) -> CausalReceiptV1:
    return _make_receipt(
        decision_id="UNPARSED",
        status=ValidationStatus.INVALID,
        reason_codes=(code,),
        failure_path=path,
        decision_bounds=None,
        fill_bounds=None,
        selections=(),
    )


def _validate_causal_asof_v1(frame: object) -> CausalReceiptV1:
    """Validate one immutable multi-feed decision frame without network or wall-clock access."""

    if not isinstance(frame, DecisionFrameV1):
        return _invalid_receipt("FRAME_INVALID", path="$")
    try:
        _check_frame_object(frame)
        for requirement in frame.requirements:
            _validate_requirement(requirement)
    except ClockContractError as error:
        return _invalid_receipt(error.code, path=error.path)

    if frame.decision_at is None:
        return _make_receipt(
            decision_id=frame.decision_id,
            status=ValidationStatus.UNKNOWN,
            reason_codes=("DECISION_TIME_MISSING",),
            failure_path=None,
            decision_bounds=None,
            fill_bounds=None,
            selections=tuple(
                _unresolved_selection(
                    requirement=requirement,
                    status=ValidationStatus.UNKNOWN,
                    reason_codes=("DECISION_TIME_MISSING",),
                )
                for requirement in sorted(
                    frame.requirements,
                    key=lambda item: item.key.canonical_id(),
                )
            ),
        )
    try:
        decision = _normalize(frame.decision_at, path="$.decisionAt")
        fill = None if frame.fill_at is None else _normalize(frame.fill_at, path="$.fillAt")
    except ClockContractError as error:
        return _invalid_receipt(error.code, path=error.path)

    global_invalid: set[str] = set()
    global_unknown: set[str] = set()
    if frame.fill_state is FillState.EXECUTED:
        if fill is None:
            global_unknown.add("FILL_TIME_MISSING")
        else:
            fill_order = _order_leq(decision, fill)
            if fill_order is _Order.FALSE:
                global_invalid.add("FILL_BEFORE_DECISION")
            elif fill_order is _Order.UNKNOWN:
                global_unknown.add("DECISION_FILL_ORDER_AMBIGUOUS")
    elif fill is not None:
        global_invalid.add("NO_FILL_HAS_FILL_TIME")

    try:
        selections = tuple(
            _select_requirement(requirement, frame.observations, decision)
            for requirement in sorted(frame.requirements, key=lambda item: item.key.canonical_id())
        )
    except ClockContractError as error:
        return _invalid_receipt(error.code, path=error.path)
    selection_invalid = any(
        selection.status is ValidationStatus.INVALID for selection in selections
    )
    selection_unknown = any(
        selection.status is ValidationStatus.UNKNOWN for selection in selections
    )
    if global_invalid or selection_invalid:
        status = ValidationStatus.INVALID
    elif global_unknown or selection_unknown:
        status = ValidationStatus.UNKNOWN
    else:
        status = ValidationStatus.VALID
    reasons = set(global_invalid) | set(global_unknown)
    for selection in selections:
        reasons.update(selection.reason_codes)
    return _make_receipt(
        decision_id=frame.decision_id,
        status=status,
        reason_codes=tuple(sorted(reasons)),
        failure_path=None,
        decision_bounds=decision,
        fill_bounds=fill,
        selections=selections,
    )


def validate_causal_asof_v1(frame: object) -> CausalReceiptV1:
    """Total object entrypoint; unexpected implementation failures fail closed."""

    try:
        return _validate_causal_asof_v1(frame)
    except Exception:
        return _invalid_receipt("VALIDATOR_EXCEPTION", path="$")


def validate_causal_asof_mapping_v1(value: object) -> CausalReceiptV1:
    """Parse a strict v1 mapping and return a total tri-state receipt."""

    try:
        frame = frame_from_mapping_v1(value)
    except ClockContractError as error:
        return _invalid_receipt(error.code, path=error.path)
    except Exception:
        return _invalid_receipt("VALIDATOR_EXCEPTION", path="$")
    return validate_causal_asof_v1(frame)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _fail("JSON_DUPLICATE_KEY", "$", f"duplicate key {key!r}")
        result[key] = value
    return result


def validate_causal_asof_json_v1(data: object) -> CausalReceiptV1:
    """Validate bounded UTF-8 JSON bytes with duplicate-key rejection."""

    if type(data) is not bytes:
        return _invalid_receipt("JSON_BYTES_INVALID", path="$")
    if not data or len(data) > _MAX_JSON_BYTES:
        return _invalid_receipt("JSON_SIZE_INVALID", path="$")
    try:
        text = data.decode("utf-8", errors="strict")
        value = json.loads(
            text,
            parse_constant=lambda token: _fail(
                "JSON_NONFINITE",
                "$",
                f"nonfinite token {token} is forbidden",
            ),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except ClockContractError as error:
        return _invalid_receipt(error.code, path=error.path)
    except RecursionError:
        return _invalid_receipt("JSON_NESTING_INVALID", path="$")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _invalid_receipt("JSON_INVALID", path="$")
    except Exception:
        return _invalid_receipt("VALIDATOR_EXCEPTION", path="$")
    return validate_causal_asof_mapping_v1(value)


__all__ = (
    "RECEIPT_SCHEMA_V1",
    "SCHEMA_V1",
    "AvailabilityBasis",
    "CausalReceiptV1",
    "ClockBoundsV1",
    "ClockContractError",
    "ClockStampV1",
    "DecisionFrameV1",
    "FeedKeyV1",
    "FeedKind",
    "FeedObservationV1",
    "FeedRequirementV1",
    "FeedSelectionV1",
    "FillState",
    "ObservationShape",
    "Product",
    "SourceProfile",
    "TimestampUnit",
    "ValidationStatus",
    "canonical_json_bytes_v1",
    "frame_from_mapping_v1",
    "validate_causal_asof_json_v1",
    "validate_causal_asof_mapping_v1",
    "validate_causal_asof_v1",
)
