from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import cast

from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import CanonicalJsonError

REGISTRY_SCHEMA_VERSION = "DQ5_REGISTRY_V1"
CANDIDATE_SCHEMA_VERSION = "DQ5_CANDIDATE_V1"

MAX_REGISTRATIONS = 2_048
MAX_CORPORA = 4_096
MAX_WINDOWS_PER_REGISTRATION = 1_024
MAX_TOTAL_REGISTRY_WINDOWS = 32_768
MAX_OPEN_EVENTS = 8_192
MAX_UTC_MILLIS = 4_102_444_800_000

_IDENTIFIER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._:+-]{0,127}$")
_DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_AMBIGUOUS_CORPUS_IDENTIFIERS = frozenset(
    {
        "AGGREGATE",
        "ALL",
        "ANY",
        "GLOBAL",
        "MULTI",
        "UNKNOWN",
        "UNSPECIFIED",
    }
)


class Dq5InputError(ValueError):
    """Stable structural-input failure with a bounded field path."""

    def __init__(self, path: str, reason: str) -> None:
        super().__init__(f"{path}: {reason}")
        self.path = path
        self.reason = reason


class WindowRole(StrEnum):
    DEVELOPMENT = "DEVELOPMENT"
    HOLDOUT = "HOLDOUT"


class OpenEventType(StrEnum):
    OPEN_ATTEMPTED = "OPEN_ATTEMPTED"
    OPENED = "OPENED"


@dataclass(frozen=True, slots=True)
class CorpusIdentity:
    provider_id: str
    venue_id: str
    product_id: str
    instrument_id: str

    @property
    def key(self) -> tuple[str, str, str, str]:
        return (
            self.provider_id,
            self.venue_id,
            self.product_id,
            self.instrument_id,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "instrumentId": self.instrument_id,
            "productId": self.product_id,
            "providerId": self.provider_id,
            "venueId": self.venue_id,
        }


@dataclass(frozen=True, slots=True)
class Window:
    window_id: str
    corpus: CorpusIdentity
    artifact_sha256: str
    role: WindowRole
    holdout_id: str | None
    start_ms: int
    end_ms: int

    @property
    def sort_key(self) -> tuple[object, ...]:
        return (
            *self.corpus.key,
            self.start_ms,
            self.end_ms,
            self.role.value,
            self.holdout_id or "",
            self.window_id,
        )

    @property
    def content_key(self) -> tuple[object, ...]:
        return (*self.sort_key, self.artifact_sha256)

    def overlaps(self, other: Window) -> bool:
        return self.corpus == other.corpus and max(self.start_ms, other.start_ms) < min(
            self.end_ms, other.end_ms
        )


@dataclass(frozen=True, slots=True)
class Registration:
    research_id: str
    family_id: str
    protocol_sha256: str
    fresh_holdout_claim: bool
    windows: tuple[Window, ...]

    @property
    def sort_key(self) -> tuple[object, ...]:
        return (
            self.research_id,
            self.family_id,
            self.protocol_sha256,
            self.fresh_holdout_claim,
            tuple(window.content_key for window in self.windows),
        )

    @property
    def holdout_ids(self) -> frozenset[str]:
        return frozenset(
            window.holdout_id
            for window in self.windows
            if window.role is WindowRole.HOLDOUT and window.holdout_id is not None
        )

    def first_window_for_holdout(self, holdout_id: str) -> Window:
        for window in self.windows:
            if window.holdout_id == holdout_id:
                return window
        raise AssertionError("validated holdout identity must resolve")


@dataclass(frozen=True, slots=True)
class OpenEvent:
    event_id: str
    research_id: str
    holdout_id: str
    event_type: OpenEventType
    recorded_at_ms: int
    receipt_sha256: str

    @property
    def sort_key(self) -> tuple[object, ...]:
        return (
            self.research_id,
            self.holdout_id,
            self.recorded_at_ms,
            self.event_type.value,
            self.event_id,
        )


@dataclass(frozen=True, slots=True)
class Registry:
    coverage_complete: bool
    custody_receipt_sha256: str
    corpora: tuple[CorpusIdentity, ...]
    registrations: tuple[Registration, ...]
    pending_registrations: tuple[Registration, ...]
    holdout_open_events: tuple[OpenEvent, ...]

    @property
    def total_window_count(self) -> int:
        return sum(len(registration.windows) for registration in self.all_registrations)

    @property
    def all_registrations(self) -> tuple[Registration, ...]:
        return (*self.registrations, *self.pending_registrations)


@dataclass(frozen=True, slots=True)
class Candidate:
    registration: Registration


def _exact_keys(
    value: dict[str, object],
    *,
    expected: frozenset[str],
    path: str,
) -> None:
    actual = frozenset(value)
    if actual == expected:
        return
    missing = sorted(expected - actual)
    extra_count = len(actual - expected)
    raise Dq5InputError(path, f"key mismatch; missing={missing}, extraCount={extra_count}")


def _require_object(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise Dq5InputError(path, "must be an object")
    return cast(dict[str, object], value)


def _require_array(value: object, *, path: str, maximum: int) -> list[object]:
    if not isinstance(value, list):
        raise Dq5InputError(path, "must be an array")
    if len(value) > maximum:
        raise Dq5InputError(path, f"exceeds maximum length {maximum}")
    return cast(list[object], value)


def _require_bool(value: object, *, path: str) -> bool:
    if not isinstance(value, bool):
        raise Dq5InputError(path, "must be a boolean")
    return value


def _require_identifier(
    value: object,
    *,
    path: str,
    reject_ambiguous: bool = False,
) -> str:
    if not isinstance(value, str) or _IDENTIFIER_PATTERN.fullmatch(value) is None:
        raise Dq5InputError(path, "must be a bounded uppercase ASCII identifier")
    if reject_ambiguous and value in _AMBIGUOUS_CORPUS_IDENTIFIERS:
        raise Dq5InputError(path, "must identify one explicit corpus population")
    return value


def _require_digest(value: object, *, path: str) -> str:
    if not isinstance(value, str) or _DIGEST_PATTERN.fullmatch(value) is None:
        raise Dq5InputError(path, "must be 64 lowercase hexadecimal SHA-256 characters")
    return value


def _require_millis(value: object, *, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise Dq5InputError(path, "must be an integer UTC millisecond value")
    if not 0 <= value <= MAX_UTC_MILLIS:
        raise Dq5InputError(path, f"must be inside [0, {MAX_UTC_MILLIS}]")
    return value


def _require_schema(value: object, *, expected: str, path: str) -> None:
    if value != expected:
        raise Dq5InputError(path, f"must equal {expected}")


def _parse_corpus(value: object, *, path: str) -> CorpusIdentity:
    raw = _require_object(value, path=path)
    _exact_keys(
        raw,
        expected=frozenset({"providerId", "venueId", "productId", "instrumentId"}),
        path=path,
    )
    return CorpusIdentity(
        provider_id=_require_identifier(
            raw["providerId"], path=f"{path}.providerId", reject_ambiguous=True
        ),
        venue_id=_require_identifier(raw["venueId"], path=f"{path}.venueId", reject_ambiguous=True),
        product_id=_require_identifier(
            raw["productId"], path=f"{path}.productId", reject_ambiguous=True
        ),
        instrument_id=_require_identifier(
            raw["instrumentId"], path=f"{path}.instrumentId", reject_ambiguous=True
        ),
    )


def _parse_window(value: object, *, path: str) -> Window:
    raw = _require_object(value, path=path)
    _exact_keys(
        raw,
        expected=frozenset(
            {
                "windowId",
                "corpus",
                "artifactSha256",
                "role",
                "holdoutId",
                "startMs",
                "endMs",
            }
        ),
        path=path,
    )
    role_raw = raw["role"]
    if not isinstance(role_raw, str):
        raise Dq5InputError(f"{path}.role", "must be DEVELOPMENT or HOLDOUT")
    try:
        role = WindowRole(role_raw)
    except ValueError as error:
        raise Dq5InputError(f"{path}.role", "must be DEVELOPMENT or HOLDOUT") from error

    holdout_raw = raw["holdoutId"]
    holdout_id: str | None
    if role is WindowRole.HOLDOUT:
        holdout_id = _require_identifier(holdout_raw, path=f"{path}.holdoutId")
    else:
        if holdout_raw is not None:
            raise Dq5InputError(f"{path}.holdoutId", "must be null for a DEVELOPMENT window")
        holdout_id = None

    start_ms = _require_millis(raw["startMs"], path=f"{path}.startMs")
    end_ms = _require_millis(raw["endMs"], path=f"{path}.endMs")
    if start_ms >= end_ms:
        raise Dq5InputError(path, "window must be a non-empty half-open interval")

    return Window(
        window_id=_require_identifier(raw["windowId"], path=f"{path}.windowId"),
        corpus=_parse_corpus(raw["corpus"], path=f"{path}.corpus"),
        artifact_sha256=_require_digest(raw["artifactSha256"], path=f"{path}.artifactSha256"),
        role=role,
        holdout_id=holdout_id,
        start_ms=start_ms,
        end_ms=end_ms,
    )


def _check_window_collection(windows: tuple[Window, ...], *, path: str) -> None:
    if tuple(sorted(windows, key=lambda window: window.sort_key)) != windows:
        raise Dq5InputError(path, "must be sorted by canonical window key")
    window_ids = [window.window_id for window in windows]
    if len(set(window_ids)) != len(window_ids):
        raise Dq5InputError(path, "windowId values must be unique")

    by_corpus: dict[CorpusIdentity, list[Window]] = {}
    for window in windows:
        by_corpus.setdefault(window.corpus, []).append(window)
    for corpus_windows in by_corpus.values():
        for index, left in enumerate(corpus_windows):
            for right in corpus_windows[index + 1 :]:
                if right.start_ms >= left.end_ms:
                    break
                if left.role is right.role:
                    raise Dq5InputError(
                        path,
                        "same-role windows must be normalized and non-overlapping",
                    )


def _parse_registration(value: object, *, path: str) -> Registration:
    raw = _require_object(value, path=path)
    _exact_keys(
        raw,
        expected=frozenset(
            {
                "researchId",
                "familyId",
                "protocolSha256",
                "freshHoldoutClaim",
                "windows",
            }
        ),
        path=path,
    )
    window_values = _require_array(
        raw["windows"],
        path=f"{path}.windows",
        maximum=MAX_WINDOWS_PER_REGISTRATION,
    )
    windows = tuple(
        _parse_window(item, path=f"{path}.windows[{index}]")
        for index, item in enumerate(window_values)
    )
    if not any(window.role is WindowRole.DEVELOPMENT for window in windows):
        raise Dq5InputError(f"{path}.windows", "requires at least one DEVELOPMENT window")
    if not any(window.role is WindowRole.HOLDOUT for window in windows):
        raise Dq5InputError(f"{path}.windows", "requires at least one HOLDOUT window")
    _check_window_collection(windows, path=f"{path}.windows")
    return Registration(
        research_id=_require_identifier(raw["researchId"], path=f"{path}.researchId"),
        family_id=_require_identifier(raw["familyId"], path=f"{path}.familyId"),
        protocol_sha256=_require_digest(raw["protocolSha256"], path=f"{path}.protocolSha256"),
        fresh_holdout_claim=_require_bool(
            raw["freshHoldoutClaim"], path=f"{path}.freshHoldoutClaim"
        ),
        windows=windows,
    )


def _parse_registration_list(
    value: object,
    *,
    path: str,
    unique_research_ids: bool,
) -> tuple[Registration, ...]:
    raw_registrations = _require_array(
        value,
        path=path,
        maximum=MAX_REGISTRATIONS,
    )
    registrations = tuple(
        _parse_registration(item, path=f"{path}[{index}]")
        for index, item in enumerate(raw_registrations)
    )
    if tuple(sorted(registrations, key=lambda item: item.sort_key)) != registrations:
        raise Dq5InputError(path, "must be sorted by canonical registration key")
    if unique_research_ids:
        research_ids = [registration.research_id for registration in registrations]
        if len(set(research_ids)) != len(research_ids):
            raise Dq5InputError(path, "researchId values must be unique")
    elif len(set(registrations)) != len(registrations):
        raise Dq5InputError(path, "duplicate pending registration records are forbidden")
    return registrations


def _parse_open_event(value: object, *, path: str) -> OpenEvent:
    raw = _require_object(value, path=path)
    _exact_keys(
        raw,
        expected=frozenset(
            {
                "eventId",
                "researchId",
                "holdoutId",
                "eventType",
                "recordedAtMs",
                "receiptSha256",
            }
        ),
        path=path,
    )
    event_type_raw = raw["eventType"]
    if not isinstance(event_type_raw, str):
        raise Dq5InputError(f"{path}.eventType", "must be OPEN_ATTEMPTED or OPENED")
    try:
        event_type = OpenEventType(event_type_raw)
    except ValueError as error:
        raise Dq5InputError(f"{path}.eventType", "must be OPEN_ATTEMPTED or OPENED") from error
    return OpenEvent(
        event_id=_require_identifier(raw["eventId"], path=f"{path}.eventId"),
        research_id=_require_identifier(raw["researchId"], path=f"{path}.researchId"),
        holdout_id=_require_identifier(raw["holdoutId"], path=f"{path}.holdoutId"),
        event_type=event_type,
        recorded_at_ms=_require_millis(raw["recordedAtMs"], path=f"{path}.recordedAtMs"),
        receipt_sha256=_require_digest(raw["receiptSha256"], path=f"{path}.receiptSha256"),
    )


def _parse_event_list(value: object, *, path: str) -> tuple[OpenEvent, ...]:
    raw_events = _require_array(value, path=path, maximum=MAX_OPEN_EVENTS)
    events = tuple(
        _parse_open_event(item, path=f"{path}[{index}]") for index, item in enumerate(raw_events)
    )
    if tuple(sorted(events, key=lambda event: event.sort_key)) != events:
        raise Dq5InputError(path, "must be sorted by canonical open-event key")
    event_ids = [event.event_id for event in events]
    if len(set(event_ids)) != len(event_ids):
        raise Dq5InputError(path, "eventId values must be unique")
    event_fingerprints = [
        (
            event.research_id,
            event.holdout_id,
            event.event_type,
            event.recorded_at_ms,
            event.receipt_sha256,
        )
        for event in events
    ]
    if len(set(event_fingerprints)) != len(event_fingerprints):
        raise Dq5InputError(path, "duplicate open-event facts are forbidden")
    return events


def _parse_canonical(raw: bytes, *, path: str) -> dict[str, object]:
    try:
        return parse_canonical_object(raw)
    except (CanonicalJsonError, ValueError) as error:
        raise Dq5InputError(path, "must be exact canonical UTF-8 JSON") from error


def parse_registry(raw: bytes) -> Registry:
    parsed = _parse_canonical(raw, path="$registry")
    _exact_keys(
        parsed,
        expected=frozenset(
            {
                "schemaVersion",
                "corpora",
                "coverageComplete",
                "custodyReceiptSha256",
                "pendingRegistrations",
                "registrations",
                "holdoutOpenEvents",
            }
        ),
        path="$registry",
    )
    _require_schema(
        parsed["schemaVersion"],
        expected=REGISTRY_SCHEMA_VERSION,
        path="$registry.schemaVersion",
    )
    raw_corpora = _require_array(
        parsed["corpora"],
        path="$registry.corpora",
        maximum=MAX_CORPORA,
    )
    corpora = tuple(
        _parse_corpus(item, path=f"$registry.corpora[{index}]")
        for index, item in enumerate(raw_corpora)
    )
    if not corpora:
        raise Dq5InputError("$registry.corpora", "requires at least one controlled identity")
    if tuple(sorted(corpora, key=lambda corpus: corpus.key)) != corpora:
        raise Dq5InputError("$registry.corpora", "must be sorted by canonical corpus key")
    if len(set(corpora)) != len(corpora):
        raise Dq5InputError("$registry.corpora", "corpus identities must be unique")
    registrations = _parse_registration_list(
        parsed["registrations"],
        path="$registry.registrations",
        unique_research_ids=True,
    )
    pending_registrations = _parse_registration_list(
        parsed["pendingRegistrations"],
        path="$registry.pendingRegistrations",
        unique_research_ids=False,
    )
    all_registrations = (*registrations, *pending_registrations)
    if len(all_registrations) > MAX_REGISTRATIONS:
        raise Dq5InputError(
            "$registry",
            f"combined registrations exceed maximum {MAX_REGISTRATIONS}",
        )
    total_windows = sum(len(registration.windows) for registration in all_registrations)
    if total_windows > MAX_TOTAL_REGISTRY_WINDOWS:
        raise Dq5InputError(
            "$registry",
            f"total windows exceed maximum {MAX_TOTAL_REGISTRY_WINDOWS}",
        )
    controlled_corpora = frozenset(corpora)
    for registration_index, registration in enumerate(registrations):
        for window_index, window in enumerate(registration.windows):
            if window.corpus not in controlled_corpora:
                raise Dq5InputError(
                    (
                        f"$registry.registrations[{registration_index}]"
                        f".windows[{window_index}].corpus"
                    ),
                    "must reference an identity from the controlled corpus catalog",
                )
    events = _parse_event_list(parsed["holdoutOpenEvents"], path="$registry.holdoutOpenEvents")
    registry = Registry(
        coverage_complete=_require_bool(
            parsed["coverageComplete"], path="$registry.coverageComplete"
        ),
        custody_receipt_sha256=_require_digest(
            parsed["custodyReceiptSha256"],
            path="$registry.custodyReceiptSha256",
        ),
        corpora=corpora,
        registrations=registrations,
        pending_registrations=pending_registrations,
        holdout_open_events=events,
    )
    validate_registry_event_references(registry)
    return registry


def parse_candidate(raw: bytes) -> Candidate:
    parsed = _parse_canonical(raw, path="$candidate")
    _exact_keys(
        parsed,
        expected=frozenset({"schemaVersion", "registration"}),
        path="$candidate",
    )
    _require_schema(
        parsed["schemaVersion"],
        expected=CANDIDATE_SCHEMA_VERSION,
        path="$candidate.schemaVersion",
    )
    registration = _parse_registration(parsed["registration"], path="$candidate.registration")
    return Candidate(registration=registration)


def validate_registry_event_references(registry: Registry) -> None:
    holdouts_by_research: dict[str, set[str]] = {}
    for registration in registry.all_registrations:
        holdouts_by_research.setdefault(registration.research_id, set()).update(
            registration.holdout_ids
        )
    for index, event in enumerate(registry.holdout_open_events):
        holdout_ids = holdouts_by_research.get(event.research_id)
        if holdout_ids is None:
            raise Dq5InputError(
                f"$registry.holdoutOpenEvents[{index}].researchId",
                "must reference a settled or pending registration",
            )
        if event.holdout_id not in holdout_ids:
            raise Dq5InputError(
                f"$registry.holdoutOpenEvents[{index}].holdoutId",
                "must reference a HOLDOUT window in the named registration",
            )


def locate_candidate_pending_record(registry: Registry, candidate: Candidate) -> int:
    """Return the sole pending-record index holding the exact candidate."""
    registration = candidate.registration
    matches = [
        index
        for index, pending in enumerate(registry.pending_registrations)
        if pending == registration
    ]
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise Dq5InputError(
            "$registry.pendingRegistrations",
            "must hold exactly one occurrence of the candidate registration",
        )
    if any(
        pending.research_id == registration.research_id
        for pending in registry.pending_registrations
    ):
        raise Dq5InputError(
            "$candidate.registration",
            "must exactly match its custody-controlled pending registration",
        )
    raise Dq5InputError(
        "$candidate.registration",
        "must be pre-persisted in the registry pendingRegistrations ledger",
    )
