"""Portable deterministic replay validation for explicit source-access evidence."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import Enum, StrEnum
from typing import NoReturn, Protocol, cast

SCHEMA_V1 = "dq14.source-access-replay.v1"
AUTHORITY_NONE = "NONE"
PROOF_LIMITATION_V1 = (
    "Supplied-ledger consistency only; facade bypass, rebuilt ledger truncation "
    "or editing, role truth, content provenance, historical access, profitability, "
    "and operational authority are not proven."
)

MAX_CANONICAL_JSON_BYTES = 8 * 1024 * 1024
MAX_JSON_DEPTH = 64
MAX_JSON_NODES = 100_000
MAX_ARCHIVES = 2_500
MAX_MEMBERS = 5_999
MAX_TOTAL_SOURCES = 6_000
MAX_EVENTS = 50_000
MAX_VERIFIERS = 64
MAX_ID_LENGTH = 96
MAX_SOURCE_REF_LENGTH = 1_024
MAX_MEMBER_NAME_LENGTH = 4_096
MAX_BYTE_COUNT = (1 << 63) - 1

_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:@+-]*\Z")
_SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")
_DRIVE_RE = re.compile(r"[A-Za-z]:")


class SourceRole(StrEnum):
    """Frozen source role supplied by the pre-run inventory."""

    DEVELOPMENT = "DEVELOPMENT"
    EMBARGO = "EMBARGO"
    HOLDOUT = "HOLDOUT"


class EventKind(StrEnum):
    """Irreversible explicit access transitions."""

    OPEN_ATTEMPTED = "OPEN_ATTEMPTED"
    OPENED = "OPENED"
    OPEN_FAILED = "OPEN_FAILED"
    DECOMPRESS_ATTEMPTED = "DECOMPRESS_ATTEMPTED"
    DECOMPRESSED = "DECOMPRESSED"
    DECOMPRESS_FAILED = "DECOMPRESS_FAILED"
    READ_ATTEMPTED = "READ_ATTEMPTED"
    READ_COMPLETE = "READ_COMPLETE"
    READ_FAILED = "READ_FAILED"


class AccessStage(StrEnum):
    """Derived source-access stage."""

    UNOPENED = "UNOPENED"
    OPEN_ATTEMPTED = "OPEN_ATTEMPTED"
    OPENED = "OPENED"
    DECOMPRESS_ATTEMPTED = "DECOMPRESS_ATTEMPTED"
    DECOMPRESSED = "DECOMPRESSED"
    READ_ATTEMPTED = "READ_ATTEMPTED"
    READ_COMPLETE = "READ_COMPLETE"


class HoldoutState(StrEnum):
    """Derived aggregate state of all declared holdout sources."""

    NOT_PRESENT = "NOT_PRESENT"
    UNOPENED = "UNOPENED"
    OPEN_ATTEMPTED = "OPEN_ATTEMPTED"
    OPENED = "OPENED"
    DECOMPRESS_ATTEMPTED = "DECOMPRESS_ATTEMPTED"
    DECOMPRESSED = "DECOMPRESSED"
    READ_ATTEMPTED = "READ_ATTEMPTED"
    READ_COMPLETE = "READ_COMPLETE"


class HoldoutGate(StrEnum):
    """Policy-neutral holdout signal carried by a replay receipt."""

    NOT_PRESENT = "NOT_PRESENT"
    UNOPENED = "UNOPENED"
    ACCESSED_NON_GREEN = "ACCESSED_NON_GREEN"


class VerifierVerdict(StrEnum):
    """Only exact replay agreement is accepted."""

    REPLAY_MATCH = "REPLAY_MATCH"


class ReplayValidationError(ValueError):
    """Stable fail-closed validation error."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}")


class _Projectable(Protocol):
    def to_payload_v1(self) -> dict[str, object]: ...


def _fail(code: str, detail: str) -> NoReturn:
    raise ReplayValidationError(code, detail)


def _require_exact_int(value: object, *, field_name: str, minimum: int = 0) -> int:
    if type(value) is not int:
        _fail("SCHEMA_INVALID", f"{field_name} must be an integer")
    integer = value
    if integer < minimum or integer > MAX_BYTE_COUNT:
        _fail("CARDINALITY_INVALID", f"{field_name} is out of bounds")
    return integer


def _require_exact_bool(value: object, *, field_name: str) -> bool:
    if type(value) is not bool:
        _fail("SCHEMA_INVALID", f"{field_name} must be a boolean")
    return value


def _require_id(value: object, *, field_name: str) -> str:
    if not isinstance(value, str):
        _fail("SCHEMA_INVALID", f"{field_name} must be a string")
    if not 1 <= len(value) <= MAX_ID_LENGTH or _ID_RE.fullmatch(value) is None:
        _fail("IDENTIFIER_INVALID", f"{field_name} is not a bounded portable ID")
    return value


def _require_sha256(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or _SHA256_RE.fullmatch(value) is None:
        _fail("DIGEST_INVALID", f"{field_name} must be lowercase SHA-256 hex")
    return value


def _require_enum(value: object, enum_type: type[Enum], *, field_name: str) -> None:
    if type(value) is not enum_type:
        _fail("SCHEMA_INVALID", f"{field_name} must be {enum_type.__name__}")


def _require_artifact_type(value: object, artifact_type: type[object], *, field_name: str) -> None:
    if type(value) is not artifact_type:
        _fail("SCHEMA_INVALID", f"{field_name} must be {artifact_type.__name__}")


def _require_portable_text(value: object, *, field_name: str, limit: int) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= limit:
        _fail("SOURCE_REF_INVALID", f"{field_name} has invalid length or type")
    if not value.isascii() or any(
        ord(character) < 0x20 or ord(character) > 0x7E for character in value
    ):
        _fail(
            "SOURCE_REF_INVALID",
            f"{field_name} must use the frozen printable-ASCII subset",
        )
    return value


def _require_source_ref(value: object) -> str:
    source_ref = _require_portable_text(value, field_name="source_ref", limit=MAX_SOURCE_REF_LENGTH)
    if (
        source_ref.startswith(("/", "\\"))
        or "\\" in source_ref
        or _DRIVE_RE.match(source_ref) is not None
    ):
        _fail("SOURCE_REF_INVALID", "source_ref must be relative POSIX form")
    parts = source_ref.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        _fail("SOURCE_REF_INVALID", "source_ref contains an empty or dot segment")
    return source_ref


def _require_member_name(value: object) -> str:
    member_name = _require_portable_text(
        value, field_name="member_name", limit=MAX_MEMBER_NAME_LENGTH
    )
    if member_name.startswith(("/", "\\")) or "\\" in member_name:
        _fail("SOURCE_REF_INVALID", "member_name must use relative POSIX form")
    if _DRIVE_RE.match(member_name) is not None:
        _fail("SOURCE_REF_INVALID", "member_name must not contain a drive prefix")
    parts = member_name.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        _fail("SOURCE_REF_INVALID", "member_name contains an empty or dot segment")
    return member_name


def _walk_json(value: object, *, depth: int = 0, nodes: list[int] | None = None) -> None:
    if nodes is None:
        nodes = [0]
    nodes[0] += 1
    if nodes[0] > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
        _fail("CANONICAL_JSON_INVALID", "JSON structure exceeds frozen bounds")
    if value is None or type(value) in {bool, int, str}:
        if type(value) is int and abs(value) > MAX_BYTE_COUNT:
            _fail("CANONICAL_JSON_INVALID", "JSON integer exceeds frozen bounds")
        if isinstance(value, str):
            try:
                value.encode("utf-8")
            except UnicodeEncodeError:
                _fail("CANONICAL_JSON_INVALID", "JSON contains an invalid surrogate")
        return
    if isinstance(value, float):
        _fail("CANONICAL_JSON_INVALID", "floating-point JSON values are forbidden")
    if type(value) is list:
        for item in cast(list[object], value):
            _walk_json(item, depth=depth + 1, nodes=nodes)
        return
    if type(value) is tuple:
        for item in cast(tuple[object, ...], value):
            _walk_json(item, depth=depth + 1, nodes=nodes)
        return
    if type(value) is dict:
        for key, item in value.items():
            if not isinstance(key, str) or not key.isascii():
                _fail(
                    "CANONICAL_JSON_INVALID",
                    "JSON object keys must be ASCII strings in the frozen subset",
                )
            _walk_json(key, depth=depth + 1, nodes=nodes)
            _walk_json(item, depth=depth + 1, nodes=nodes)
        return
    _fail("CANONICAL_JSON_INVALID", f"unsupported JSON value {type(value).__name__}")


def canonical_json_bytes_v1(value: object) -> bytes:
    """Render the frozen no-float JSON subset deterministically."""

    _walk_json(value)
    try:
        rendered = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError, RecursionError) as error:
        _fail("CANONICAL_JSON_INVALID", str(error))
    if len(rendered) > MAX_CANONICAL_JSON_BYTES:
        _fail("CANONICAL_JSON_INVALID", "canonical JSON exceeds frozen byte bound")
    return rendered


def parse_canonical_json_v1(data: bytes) -> object:
    """Parse exact canonical JSON, rejecting duplicates, floats, and aliases."""

    if type(data) is not bytes or not 1 <= len(data) <= MAX_CANONICAL_JSON_BYTES:
        _fail("CANONICAL_JSON_INVALID", "input must be bounded bytes")

    def pairs_hook(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                _fail("CANONICAL_JSON_INVALID", f"duplicate object key {key!r}")
            result[key] = value
        return result

    def reject_float(value: str) -> NoReturn:
        _fail("CANONICAL_JSON_INVALID", f"floating-point value {value!r} is forbidden")

    def parse_integer(value: str) -> int:
        integer = int(value)
        if abs(integer) > MAX_BYTE_COUNT:
            _fail("CANONICAL_JSON_INVALID", "JSON integer exceeds frozen bounds")
        return integer

    def reject_constant(value: str) -> NoReturn:
        _fail("CANONICAL_JSON_INVALID", f"non-finite value {value!r} is forbidden")

    try:
        decoded = data.decode("utf-8")
        value = json.loads(
            decoded,
            object_pairs_hook=pairs_hook,
            parse_float=reject_float,
            parse_int=parse_integer,
            parse_constant=reject_constant,
        )
    except ReplayValidationError:
        raise
    except UnicodeDecodeError as error:
        _fail("CANONICAL_JSON_INVALID", f"invalid UTF-8: {error}")
    except json.JSONDecodeError as error:
        _fail("CANONICAL_JSON_INVALID", f"invalid JSON: {error.msg}")
    except (ValueError, RecursionError) as error:
        _fail("CANONICAL_JSON_INVALID", f"invalid bounded JSON: {error}")
    _walk_json(value)
    if canonical_json_bytes_v1(value) != data:
        _fail("CANONICAL_JSON_INVALID", "input is valid JSON but not canonical bytes")
    return value


def _digest_v1(domain: str, payload: object) -> str:
    return hashlib.sha256(
        domain.encode("ascii") + b"\x00" + canonical_json_bytes_v1(payload)
    ).hexdigest()


EVENT_GENESIS_SHA256 = hashlib.sha256(b"DQ14_EVENT_GENESIS_V1").hexdigest()


@dataclass(frozen=True, slots=True)
class MemberInventoryV1:
    """One immutable archive-member identity."""

    member_id: str
    ordinal: int
    member_name: str
    byte_count: int
    content_sha256: str

    def __post_init__(self) -> None:
        _require_id(self.member_id, field_name="member_id")
        _require_exact_int(self.ordinal, field_name="ordinal")
        _require_member_name(self.member_name)
        _require_exact_int(self.byte_count, field_name="member.byte_count")
        _require_sha256(self.content_sha256, field_name="member.content_sha256")

    def to_payload_v1(self) -> dict[str, object]:
        return {
            "byteCount": self.byte_count,
            "contentSha256": self.content_sha256,
            "memberId": self.member_id,
            "memberName": self.member_name,
            "ordinal": self.ordinal,
        }


@dataclass(frozen=True, slots=True)
class ArchiveInventoryV1:
    """One immutable archive identity and its declared members."""

    archive_id: str
    source_ref: str
    role: SourceRole
    byte_count: int
    content_sha256: str
    members: tuple[MemberInventoryV1, ...]

    def __post_init__(self) -> None:
        _require_id(self.archive_id, field_name="archive_id")
        _require_source_ref(self.source_ref)
        _require_enum(self.role, SourceRole, field_name="role")
        _require_exact_int(self.byte_count, field_name="archive.byte_count")
        _require_sha256(self.content_sha256, field_name="archive.content_sha256")
        if type(self.members) is not tuple or not 1 <= len(self.members) <= MAX_MEMBERS:
            _fail("CARDINALITY_INVALID", "archive members exceed frozen bounds")
        for member in self.members:
            _require_artifact_type(member, MemberInventoryV1, field_name="archive.member")
        members = tuple(sorted(self.members, key=lambda member: (member.ordinal, member.member_id)))
        if len({member.member_id for member in members}) != len(members):
            _fail("DUPLICATE_INVENTORY_ID", "member_id repeats within archive")
        if len({member.ordinal for member in members}) != len(members):
            _fail("DUPLICATE_INVENTORY_ID", "member ordinal repeats within archive")
        object.__setattr__(self, "members", members)

    def to_payload_v1(self) -> dict[str, object]:
        return {
            "archiveId": self.archive_id,
            "byteCount": self.byte_count,
            "contentSha256": self.content_sha256,
            "members": [member.to_payload_v1() for member in self.members],
            "role": self.role.value,
            "sourceRef": self.source_ref,
        }


@dataclass(frozen=True, slots=True)
class InventoryV1:
    """Frozen pre-run archive/member inventory."""

    run_id: str
    protocol_sha256: str
    validator_source_sha256: str
    required_verifier_ids: tuple[str, ...]
    archives: tuple[ArchiveInventoryV1, ...]
    inventory_sha256: str = field(init=False)

    def __post_init__(self) -> None:
        _require_id(self.run_id, field_name="run_id")
        _require_sha256(self.protocol_sha256, field_name="protocol_sha256")
        _require_sha256(self.validator_source_sha256, field_name="validator_source_sha256")
        if (
            type(self.required_verifier_ids) is not tuple
            or not 1 <= len(self.required_verifier_ids) <= MAX_VERIFIERS
        ):
            _fail("CARDINALITY_INVALID", "required verifier IDs exceed frozen bounds")
        verifier_ids = tuple(
            sorted(
                _require_id(value, field_name="required_verifier_id")
                for value in self.required_verifier_ids
            )
        )
        if len(set(verifier_ids)) != len(verifier_ids):
            _fail("DUPLICATE_INVENTORY_ID", "required verifier ID repeats")
        if type(self.archives) is not tuple or not 1 <= len(self.archives) <= MAX_ARCHIVES:
            _fail("CARDINALITY_INVALID", "archives exceed frozen bounds")
        for archive in self.archives:
            _require_artifact_type(archive, ArchiveInventoryV1, field_name="inventory.archive")
        archives = tuple(sorted(self.archives, key=lambda archive: archive.archive_id))
        if len({archive.archive_id for archive in archives}) != len(archives):
            _fail("DUPLICATE_INVENTORY_ID", "archive_id repeats")
        if len({archive.source_ref.casefold() for archive in archives}) != len(archives):
            _fail("DUPLICATE_INVENTORY_ID", "source_ref aliases another archive")
        all_member_ids = [member.member_id for archive in archives for member in archive.members]
        if len(set(all_member_ids)) != len(all_member_ids):
            _fail("DUPLICATE_INVENTORY_ID", "member_id repeats across inventory")
        if len(all_member_ids) > MAX_MEMBERS:
            _fail("CARDINALITY_INVALID", "inventory members exceed frozen bounds")
        if len(archives) + len(all_member_ids) > MAX_TOTAL_SOURCES:
            _fail("CARDINALITY_INVALID", "inventory sources exceed frozen bounds")
        digest_roles: dict[str, set[SourceRole]] = {}
        for archive in archives:
            digest_roles.setdefault(archive.content_sha256, set()).add(archive.role)
            for member in archive.members:
                digest_roles.setdefault(member.content_sha256, set()).add(archive.role)
        if any(len(roles) > 1 for roles in digest_roles.values()):
            _fail(
                "ROLE_CONTENT_ALIAS",
                "identical content digest cannot span source roles",
            )
        object.__setattr__(self, "required_verifier_ids", verifier_ids)
        object.__setattr__(self, "archives", archives)
        object.__setattr__(
            self,
            "inventory_sha256",
            _digest_v1("dq14/inventory/v1", self.to_payload_v1(include_digest=False)),
        )

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "archives": [archive.to_payload_v1() for archive in self.archives],
            "protocolSha256": self.protocol_sha256,
            "requiredVerifierIds": list(self.required_verifier_ids),
            "runId": self.run_id,
            "schema": SCHEMA_V1,
            "validatorSourceSha256": self.validator_source_sha256,
        }
        if include_digest:
            payload["inventorySha256"] = self.inventory_sha256
        return payload


@dataclass(frozen=True, slots=True)
class SourceStateV1:
    """One exact derived archive or member state."""

    source_kind: str
    source_id: str
    archive_id: str
    member_id: str | None
    role: SourceRole
    stage: AccessStage
    failed: bool

    def __post_init__(self) -> None:
        if self.source_kind not in {"ARCHIVE", "MEMBER"}:
            _fail("SCHEMA_INVALID", "source_kind must be ARCHIVE or MEMBER")
        _require_id(self.source_id, field_name="source_id")
        _require_id(self.archive_id, field_name="source.archive_id")
        if self.member_id is not None:
            _require_id(self.member_id, field_name="source.member_id")
        if (self.source_kind == "ARCHIVE") != (self.member_id is None):
            _fail("SCHEMA_INVALID", "source kind and member identity disagree")
        _require_enum(self.role, SourceRole, field_name="source.role")
        _require_enum(self.stage, AccessStage, field_name="source.stage")
        _require_exact_bool(self.failed, field_name="source.failed")

    def to_payload_v1(self) -> dict[str, object]:
        return {
            "archiveId": self.archive_id,
            "failed": self.failed,
            "memberId": self.member_id,
            "role": self.role.value,
            "sourceId": self.source_id,
            "sourceKind": self.source_kind,
            "stage": self.stage.value,
        }


@dataclass(frozen=True, slots=True)
class StageCountV1:
    """Exact derived count for one role/stage coordinate."""

    role: SourceRole
    stage: AccessStage
    count: int

    def __post_init__(self) -> None:
        _require_enum(self.role, SourceRole, field_name="count.role")
        _require_enum(self.stage, AccessStage, field_name="count.stage")
        _require_exact_int(self.count, field_name="count")

    def to_payload_v1(self) -> dict[str, object]:
        return {
            "count": self.count,
            "role": self.role.value,
            "stage": self.stage.value,
        }


@dataclass(frozen=True, slots=True)
class SourceScopeV1:
    """Complete derived terminal source scope."""

    inventory_sha256: str
    event_count: int
    event_tip_sha256: str
    source_states: tuple[SourceStateV1, ...]
    stage_counts: tuple[StageCountV1, ...]
    holdout_state: HoldoutState
    holdout_gate: HoldoutGate
    failure_count: int
    holdout_failure_count: int
    source_scope_sha256: str

    def __post_init__(self) -> None:
        _require_sha256(self.inventory_sha256, field_name="scope.inventory_sha256")
        _require_exact_int(self.event_count, field_name="scope.event_count")
        _require_sha256(self.event_tip_sha256, field_name="scope.event_tip_sha256")
        if type(self.source_states) is not tuple or type(self.stage_counts) is not tuple:
            _fail("SCHEMA_INVALID", "scope collections must be tuples")
        _require_enum(self.holdout_state, HoldoutState, field_name="holdout_state")
        _require_enum(self.holdout_gate, HoldoutGate, field_name="holdout_gate")
        _require_exact_int(self.failure_count, field_name="scope.failure_count")
        _require_exact_int(
            self.holdout_failure_count,
            field_name="scope.holdout_failure_count",
        )
        _require_sha256(self.source_scope_sha256, field_name="source_scope_sha256")

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "eventCount": self.event_count,
            "eventTipSha256": self.event_tip_sha256,
            "failureCount": self.failure_count,
            "holdoutGate": self.holdout_gate.value,
            "holdoutFailureCount": self.holdout_failure_count,
            "holdoutState": self.holdout_state.value,
            "inventorySha256": self.inventory_sha256,
            "sourceStates": [state.to_payload_v1() for state in self.source_states],
            "stageCounts": [count.to_payload_v1() for count in self.stage_counts],
        }
        if include_digest:
            payload["sourceScopeSha256"] = self.source_scope_sha256
        return payload


@dataclass(frozen=True, slots=True)
class PreRunSealV1:
    """Pre-run binding proving an initially empty event ledger."""

    run_id: str
    inventory_sha256: str
    validator_source_sha256: str
    required_verifier_ids: tuple[str, ...]
    event_genesis_sha256: str
    initial_source_scope_sha256: str
    seal_sha256: str

    def __post_init__(self) -> None:
        _require_id(self.run_id, field_name="seal.run_id")
        _require_sha256(self.inventory_sha256, field_name="seal.inventory_sha256")
        _require_sha256(self.validator_source_sha256, field_name="seal.validator_source_sha256")
        if type(self.required_verifier_ids) is not tuple:
            _fail("SCHEMA_INVALID", "seal verifier IDs must be a tuple")
        for verifier_id in self.required_verifier_ids:
            _require_id(verifier_id, field_name="seal.required_verifier_id")
        _require_sha256(self.event_genesis_sha256, field_name="seal.event_genesis_sha256")
        _require_sha256(
            self.initial_source_scope_sha256,
            field_name="seal.initial_source_scope_sha256",
        )
        _require_sha256(self.seal_sha256, field_name="seal.seal_sha256")

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "eventGenesisSha256": self.event_genesis_sha256,
            "initialSourceScopeSha256": self.initial_source_scope_sha256,
            "inventorySha256": self.inventory_sha256,
            "requiredVerifierIds": list(self.required_verifier_ids),
            "runId": self.run_id,
            "validatorSourceSha256": self.validator_source_sha256,
        }
        if include_digest:
            payload["sealSha256"] = self.seal_sha256
        return payload


@dataclass(frozen=True, slots=True)
class AccessEventV1:
    """One supplied hash-chained access event."""

    run_id: str
    seal_sha256: str
    sequence: int
    prior_event_sha256: str
    kind: EventKind
    access_id: str
    archive_id: str
    member_id: str | None
    observed_byte_count: int | None
    observed_sha256: str | None
    event_sha256: str

    def __post_init__(self) -> None:
        _require_id(self.run_id, field_name="event.run_id")
        _require_sha256(self.seal_sha256, field_name="event.seal_sha256")
        _require_exact_int(self.sequence, field_name="event.sequence", minimum=1)
        _require_sha256(self.prior_event_sha256, field_name="event.prior_event_sha256")
        _require_enum(self.kind, EventKind, field_name="event.kind")
        _require_id(self.access_id, field_name="event.access_id")
        _require_id(self.archive_id, field_name="event.archive_id")
        if self.member_id is not None:
            _require_id(self.member_id, field_name="event.member_id")
        if self.observed_byte_count is not None:
            _require_exact_int(self.observed_byte_count, field_name="event.observed_byte_count")
        if self.observed_sha256 is not None:
            _require_sha256(self.observed_sha256, field_name="event.observed_sha256")
        if (self.observed_byte_count is None) != (self.observed_sha256 is None):
            _fail("SCHEMA_INVALID", "observed byte count and digest must travel together")
        _require_sha256(self.event_sha256, field_name="event.event_sha256")

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "accessId": self.access_id,
            "archiveId": self.archive_id,
            "kind": self.kind.value,
            "memberId": self.member_id,
            "observedByteCount": self.observed_byte_count,
            "observedSha256": self.observed_sha256,
            "priorEventSha256": self.prior_event_sha256,
            "runId": self.run_id,
            "sealSha256": self.seal_sha256,
            "sequence": self.sequence,
        }
        if include_digest:
            payload["eventSha256"] = self.event_sha256
        return payload


@dataclass(frozen=True, slots=True)
class TerminalClaimV1:
    """Caller-supplied terminal claim that must equal replay truth."""

    run_id: str
    seal_sha256: str
    inventory_sha256: str
    event_count: int
    event_tip_sha256: str
    source_scope_sha256: str
    holdout_state: HoldoutState
    holdout_gate: HoldoutGate
    failure_count: int
    holdout_failure_count: int
    result_core_sha256: str
    terminal_claim_sha256: str

    def __post_init__(self) -> None:
        _require_id(self.run_id, field_name="terminal.run_id")
        for field_name, value in (
            ("terminal.seal_sha256", self.seal_sha256),
            ("terminal.inventory_sha256", self.inventory_sha256),
            ("terminal.event_tip_sha256", self.event_tip_sha256),
            ("terminal.source_scope_sha256", self.source_scope_sha256),
            ("terminal.result_core_sha256", self.result_core_sha256),
            ("terminal.terminal_claim_sha256", self.terminal_claim_sha256),
        ):
            _require_sha256(value, field_name=field_name)
        _require_exact_int(self.event_count, field_name="terminal.event_count")
        _require_enum(self.holdout_state, HoldoutState, field_name="holdout_state")
        _require_enum(self.holdout_gate, HoldoutGate, field_name="holdout_gate")
        _require_exact_int(self.failure_count, field_name="terminal.failure_count")
        _require_exact_int(
            self.holdout_failure_count,
            field_name="terminal.holdout_failure_count",
        )

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "eventCount": self.event_count,
            "eventTipSha256": self.event_tip_sha256,
            "failureCount": self.failure_count,
            "holdoutGate": self.holdout_gate.value,
            "holdoutFailureCount": self.holdout_failure_count,
            "holdoutState": self.holdout_state.value,
            "inventorySha256": self.inventory_sha256,
            "resultCoreSha256": self.result_core_sha256,
            "runId": self.run_id,
            "sealSha256": self.seal_sha256,
            "sourceScopeSha256": self.source_scope_sha256,
        }
        if include_digest:
            payload["terminalClaimSha256"] = self.terminal_claim_sha256
        return payload


@dataclass(frozen=True, slots=True)
class VerifierClaimV1:
    """One exact verifier binding over replay-derived evidence."""

    verifier_id: str
    verdict: VerifierVerdict
    run_id: str
    inventory_sha256: str
    seal_sha256: str
    validator_source_sha256: str
    event_count: int
    event_tip_sha256: str
    source_scope_sha256: str
    holdout_state: HoldoutState
    holdout_gate: HoldoutGate
    failure_count: int
    holdout_failure_count: int
    terminal_claim_sha256: str
    replay_evidence_sha256: str
    verifier_claim_sha256: str

    def __post_init__(self) -> None:
        _require_id(self.verifier_id, field_name="verifier_id")
        _require_enum(self.verdict, VerifierVerdict, field_name="verdict")
        _require_id(self.run_id, field_name="verifier.run_id")
        for field_name, value in (
            ("verifier.inventory_sha256", self.inventory_sha256),
            ("verifier.seal_sha256", self.seal_sha256),
            ("verifier.validator_source_sha256", self.validator_source_sha256),
            ("verifier.event_tip_sha256", self.event_tip_sha256),
            ("verifier.source_scope_sha256", self.source_scope_sha256),
            ("verifier.terminal_claim_sha256", self.terminal_claim_sha256),
            ("verifier.replay_evidence_sha256", self.replay_evidence_sha256),
            ("verifier.verifier_claim_sha256", self.verifier_claim_sha256),
        ):
            _require_sha256(value, field_name=field_name)
        _require_exact_int(self.event_count, field_name="verifier.event_count")
        _require_enum(self.holdout_state, HoldoutState, field_name="holdout_state")
        _require_enum(self.holdout_gate, HoldoutGate, field_name="holdout_gate")
        _require_exact_int(self.failure_count, field_name="verifier.failure_count")
        _require_exact_int(
            self.holdout_failure_count,
            field_name="verifier.holdout_failure_count",
        )

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "eventCount": self.event_count,
            "eventTipSha256": self.event_tip_sha256,
            "failureCount": self.failure_count,
            "holdoutGate": self.holdout_gate.value,
            "holdoutFailureCount": self.holdout_failure_count,
            "holdoutState": self.holdout_state.value,
            "inventorySha256": self.inventory_sha256,
            "replayEvidenceSha256": self.replay_evidence_sha256,
            "runId": self.run_id,
            "sealSha256": self.seal_sha256,
            "sourceScopeSha256": self.source_scope_sha256,
            "terminalClaimSha256": self.terminal_claim_sha256,
            "validatorSourceSha256": self.validator_source_sha256,
            "verdict": self.verdict.value,
            "verifierId": self.verifier_id,
        }
        if include_digest:
            payload["verifierClaimSha256"] = self.verifier_claim_sha256
        return payload


@dataclass(frozen=True, slots=True)
class ReplayReceiptV1:
    """Fail-closed replay receipt with no operational authority."""

    run_id: str
    inventory_sha256: str
    seal_sha256: str
    validator_source_sha256: str
    event_count: int
    event_tip_sha256: str
    source_scope_sha256: str
    holdout_state: HoldoutState
    holdout_gate: HoldoutGate
    failure_count: int
    holdout_failure_count: int
    terminal_claim_sha256: str
    verifier_claim_sha256s: tuple[str, ...]
    replay_evidence_sha256: str
    authority: str
    proof_limitation: str
    receipt_sha256: str

    def __post_init__(self) -> None:
        _require_id(self.run_id, field_name="receipt.run_id")
        for field_name, value in (
            ("receipt.inventory_sha256", self.inventory_sha256),
            ("receipt.seal_sha256", self.seal_sha256),
            ("receipt.validator_source_sha256", self.validator_source_sha256),
            ("receipt.event_tip_sha256", self.event_tip_sha256),
            ("receipt.source_scope_sha256", self.source_scope_sha256),
            ("receipt.terminal_claim_sha256", self.terminal_claim_sha256),
            ("receipt.replay_evidence_sha256", self.replay_evidence_sha256),
            ("receipt.receipt_sha256", self.receipt_sha256),
        ):
            _require_sha256(value, field_name=field_name)
        _require_exact_int(self.event_count, field_name="receipt.event_count")
        _require_enum(self.holdout_state, HoldoutState, field_name="holdout_state")
        _require_enum(self.holdout_gate, HoldoutGate, field_name="holdout_gate")
        _require_exact_int(self.failure_count, field_name="receipt.failure_count")
        _require_exact_int(
            self.holdout_failure_count,
            field_name="receipt.holdout_failure_count",
        )
        if self.event_count > MAX_EVENTS:
            _fail("CARDINALITY_INVALID", "receipt event count exceeds frozen bound")
        if self.failure_count > MAX_TOTAL_SOURCES or self.holdout_failure_count > MAX_TOTAL_SOURCES:
            _fail("CARDINALITY_INVALID", "receipt failure count exceeds frozen bound")
        if self.holdout_failure_count > self.failure_count:
            _fail(
                "SCHEMA_INVALID",
                "holdout failure count cannot exceed total failure count",
            )
        if (
            self.holdout_state in {HoldoutState.NOT_PRESENT, HoldoutState.UNOPENED}
            and self.holdout_failure_count != 0
        ):
            _fail(
                "SCHEMA_INVALID",
                "unopened or absent holdout cannot carry a failure",
            )
        if (self.event_count == 0) != (self.event_tip_sha256 == EVENT_GENESIS_SHA256):
            _fail("SCHEMA_INVALID", "receipt event count and tip disagree")
        if (
            type(self.verifier_claim_sha256s) is not tuple
            or not 1 <= len(self.verifier_claim_sha256s) <= MAX_VERIFIERS
        ):
            _fail(
                "CARDINALITY_INVALID",
                "receipt verifier digests exceed frozen bounds",
            )
        for digest in self.verifier_claim_sha256s:
            _require_sha256(digest, field_name="receipt.verifier_claim_sha256")
        if len(set(self.verifier_claim_sha256s)) != len(self.verifier_claim_sha256s):
            _fail("SCHEMA_INVALID", "receipt verifier digest repeats")
        if self.authority != AUTHORITY_NONE:
            _fail("SCHEMA_INVALID", "receipt authority must be NONE")
        if self.proof_limitation != PROOF_LIMITATION_V1:
            _fail("SCHEMA_INVALID", "receipt proof limitation is not frozen")
        expected_gate = (
            HoldoutGate.NOT_PRESENT
            if self.holdout_state is HoldoutState.NOT_PRESENT
            else (
                HoldoutGate.UNOPENED
                if self.holdout_state is HoldoutState.UNOPENED and self.holdout_failure_count == 0
                else HoldoutGate.ACCESSED_NON_GREEN
            )
        )
        if self.holdout_gate is not expected_gate:
            _fail("SCHEMA_INVALID", "receipt holdout state and gate disagree")
        expected_digest = _digest_v1(
            "dq14/replay-receipt/v1",
            self.to_payload_v1(include_digest=False),
        )
        if self.receipt_sha256 != expected_digest:
            _fail(
                "RECEIPT_DIGEST_MISMATCH",
                "receipt digest does not bind its exact fields",
            )

    def to_payload_v1(self, *, include_digest: bool = True) -> dict[str, object]:
        payload: dict[str, object] = {
            "authority": self.authority,
            "eventCount": self.event_count,
            "eventTipSha256": self.event_tip_sha256,
            "failureCount": self.failure_count,
            "holdoutGate": self.holdout_gate.value,
            "holdoutFailureCount": self.holdout_failure_count,
            "holdoutState": self.holdout_state.value,
            "inventorySha256": self.inventory_sha256,
            "proofLimitation": self.proof_limitation,
            "replayEvidenceSha256": self.replay_evidence_sha256,
            "runId": self.run_id,
            "sealSha256": self.seal_sha256,
            "sourceScopeSha256": self.source_scope_sha256,
            "terminalClaimSha256": self.terminal_claim_sha256,
            "validatorSourceSha256": self.validator_source_sha256,
            "verifierClaimSha256s": list(self.verifier_claim_sha256s),
        }
        if include_digest:
            payload["receiptSha256"] = self.receipt_sha256
        return payload


_STAGE_RANK: dict[AccessStage, int] = {
    AccessStage.UNOPENED: 0,
    AccessStage.OPEN_ATTEMPTED: 1,
    AccessStage.OPENED: 2,
    AccessStage.DECOMPRESS_ATTEMPTED: 3,
    AccessStage.DECOMPRESSED: 4,
    AccessStage.READ_ATTEMPTED: 5,
    AccessStage.READ_COMPLETE: 6,
}

_EVENT_STAGE: dict[EventKind, AccessStage] = {
    EventKind.OPEN_ATTEMPTED: AccessStage.OPEN_ATTEMPTED,
    EventKind.OPENED: AccessStage.OPENED,
    EventKind.OPEN_FAILED: AccessStage.OPEN_ATTEMPTED,
    EventKind.DECOMPRESS_ATTEMPTED: AccessStage.DECOMPRESS_ATTEMPTED,
    EventKind.DECOMPRESSED: AccessStage.DECOMPRESSED,
    EventKind.DECOMPRESS_FAILED: AccessStage.DECOMPRESS_ATTEMPTED,
    EventKind.READ_ATTEMPTED: AccessStage.READ_ATTEMPTED,
    EventKind.READ_COMPLETE: AccessStage.READ_COMPLETE,
    EventKind.READ_FAILED: AccessStage.READ_ATTEMPTED,
}

_OPEN_EVENTS = {
    EventKind.OPEN_ATTEMPTED,
    EventKind.OPENED,
    EventKind.OPEN_FAILED,
}
_IDENTITY_EVENTS = {EventKind.OPENED, EventKind.DECOMPRESSED, EventKind.READ_COMPLETE}


@dataclass(slots=True)
class _AccessState:
    archive_id: str
    open_kind: EventKind
    member_kinds: dict[str, EventKind] = field(default_factory=dict)
    failed: bool = False


def _scope_from_stages(
    inventory: InventoryV1,
    *,
    event_count: int,
    event_tip_sha256: str,
    archive_stages: Mapping[str, AccessStage],
    member_stages: Mapping[tuple[str, str], AccessStage],
    archive_failures: Mapping[str, bool],
    member_failures: Mapping[tuple[str, str], bool],
) -> SourceScopeV1:
    states: list[SourceStateV1] = []
    for archive in inventory.archives:
        states.append(
            SourceStateV1(
                source_kind="ARCHIVE",
                source_id=archive.archive_id,
                archive_id=archive.archive_id,
                member_id=None,
                role=archive.role,
                stage=archive_stages[archive.archive_id],
                failed=archive_failures[archive.archive_id],
            )
        )
        for member in archive.members:
            states.append(
                SourceStateV1(
                    source_kind="MEMBER",
                    source_id=member.member_id,
                    archive_id=archive.archive_id,
                    member_id=member.member_id,
                    role=archive.role,
                    stage=member_stages[(archive.archive_id, member.member_id)],
                    failed=member_failures[(archive.archive_id, member.member_id)],
                )
            )
    states_tuple = tuple(
        sorted(states, key=lambda state: (state.archive_id, state.member_id or ""))
    )
    counts = tuple(
        StageCountV1(
            role=role,
            stage=stage,
            count=sum(state.role is role and state.stage is stage for state in states_tuple),
        )
        for role in SourceRole
        for stage in AccessStage
    )
    holdout_stages = [state.stage for state in states_tuple if state.role is SourceRole.HOLDOUT]
    failure_count = sum(state.failed for state in states_tuple)
    holdout_failure_count = sum(
        state.failed for state in states_tuple if state.role is SourceRole.HOLDOUT
    )
    if not holdout_stages:
        holdout_state = HoldoutState.NOT_PRESENT
        holdout_gate = HoldoutGate.NOT_PRESENT
    else:
        maximum = max(holdout_stages, key=_STAGE_RANK.__getitem__)
        holdout_state = HoldoutState(maximum.value)
        holdout_gate = (
            HoldoutGate.UNOPENED
            if maximum is AccessStage.UNOPENED
            else HoldoutGate.ACCESSED_NON_GREEN
        )
    payload: dict[str, object] = {
        "eventCount": event_count,
        "eventTipSha256": event_tip_sha256,
        "failureCount": failure_count,
        "holdoutGate": holdout_gate.value,
        "holdoutFailureCount": holdout_failure_count,
        "holdoutState": holdout_state.value,
        "inventorySha256": inventory.inventory_sha256,
        "sourceStates": [state.to_payload_v1() for state in states_tuple],
        "stageCounts": [count.to_payload_v1() for count in counts],
    }
    return SourceScopeV1(
        inventory_sha256=inventory.inventory_sha256,
        event_count=event_count,
        event_tip_sha256=event_tip_sha256,
        source_states=states_tuple,
        stage_counts=counts,
        holdout_state=holdout_state,
        holdout_gate=holdout_gate,
        failure_count=failure_count,
        holdout_failure_count=holdout_failure_count,
        source_scope_sha256=_digest_v1("dq14/source-scope/v1", payload),
    )


def _initial_scope_v1(inventory: InventoryV1) -> SourceScopeV1:
    return _scope_from_stages(
        inventory,
        event_count=0,
        event_tip_sha256=EVENT_GENESIS_SHA256,
        archive_stages={archive.archive_id: AccessStage.UNOPENED for archive in inventory.archives},
        member_stages={
            (archive.archive_id, member.member_id): AccessStage.UNOPENED
            for archive in inventory.archives
            for member in archive.members
        },
        archive_failures={archive.archive_id: False for archive in inventory.archives},
        member_failures={
            (archive.archive_id, member.member_id): False
            for archive in inventory.archives
            for member in archive.members
        },
    )


def freeze_pre_run_v1(inventory: InventoryV1) -> PreRunSealV1:
    """Freeze the inventory, verifier set, genesis, and all-unopened scope."""

    _require_artifact_type(inventory, InventoryV1, field_name="inventory")
    initial_scope = _initial_scope_v1(inventory)
    payload: dict[str, object] = {
        "eventGenesisSha256": EVENT_GENESIS_SHA256,
        "initialSourceScopeSha256": initial_scope.source_scope_sha256,
        "inventorySha256": inventory.inventory_sha256,
        "requiredVerifierIds": list(inventory.required_verifier_ids),
        "runId": inventory.run_id,
        "validatorSourceSha256": inventory.validator_source_sha256,
    }
    return PreRunSealV1(
        run_id=inventory.run_id,
        inventory_sha256=inventory.inventory_sha256,
        validator_source_sha256=inventory.validator_source_sha256,
        required_verifier_ids=inventory.required_verifier_ids,
        event_genesis_sha256=EVENT_GENESIS_SHA256,
        initial_source_scope_sha256=initial_scope.source_scope_sha256,
        seal_sha256=_digest_v1("dq14/pre-run-seal/v1", payload),
    )


def _validate_seal_v1(inventory: InventoryV1, seal: PreRunSealV1) -> None:
    _require_artifact_type(inventory, InventoryV1, field_name="inventory")
    _require_artifact_type(seal, PreRunSealV1, field_name="seal")
    expected = freeze_pre_run_v1(inventory)
    if seal != expected:
        _fail("PRE_RUN_SEAL_MISMATCH", "seal is not the exact inventory pre-run seal")


def build_access_event_v1(
    *,
    inventory: InventoryV1,
    seal: PreRunSealV1,
    previous_event: AccessEventV1 | None,
    kind: EventKind,
    access_id: str,
    archive_id: str,
    member_id: str | None = None,
    observed_byte_count: int | None = None,
    observed_sha256: str | None = None,
) -> AccessEventV1:
    """Build one canonical event; replay still validates transition legality."""

    _validate_seal_v1(inventory, seal)
    _require_enum(kind, EventKind, field_name="kind")
    if previous_event is not None:
        _require_artifact_type(previous_event, AccessEventV1, field_name="previous_event")
    sequence = 1 if previous_event is None else previous_event.sequence + 1
    prior_event_sha256 = (
        seal.event_genesis_sha256 if previous_event is None else previous_event.event_sha256
    )
    payload: dict[str, object] = {
        "accessId": access_id,
        "archiveId": archive_id,
        "kind": kind.value,
        "memberId": member_id,
        "observedByteCount": observed_byte_count,
        "observedSha256": observed_sha256,
        "priorEventSha256": prior_event_sha256,
        "runId": inventory.run_id,
        "sealSha256": seal.seal_sha256,
        "sequence": sequence,
    }
    return AccessEventV1(
        run_id=inventory.run_id,
        seal_sha256=seal.seal_sha256,
        sequence=sequence,
        prior_event_sha256=prior_event_sha256,
        kind=kind,
        access_id=access_id,
        archive_id=archive_id,
        member_id=member_id,
        observed_byte_count=observed_byte_count,
        observed_sha256=observed_sha256,
        event_sha256=_digest_v1("dq14/access-event/v1", payload),
    )


def _validate_event_shape(event: AccessEventV1) -> None:
    if event.kind in _OPEN_EVENTS:
        if event.member_id is not None:
            _fail("EVENT_SHAPE_INVALID", "open event must not name a member")
    elif event.member_id is None:
        _fail("EVENT_SHAPE_INVALID", "member event must name a member")
    if event.kind in _IDENTITY_EVENTS:
        if event.observed_byte_count is None or event.observed_sha256 is None:
            _fail("EVENT_SHAPE_INVALID", "successful event requires observed identity")
    elif event.observed_byte_count is not None or event.observed_sha256 is not None:
        _fail("EVENT_SHAPE_INVALID", "attempt/failure must not claim observed identity")


def _verify_event_digest(event: AccessEventV1) -> None:
    expected = _digest_v1("dq14/access-event/v1", event.to_payload_v1(include_digest=False))
    if event.event_sha256 != expected:
        _fail("EVENT_DIGEST_MISMATCH", "event digest does not bind its body")


def _raise_transition(expected: str, event: AccessEventV1) -> NoReturn:
    _fail(
        "INVALID_ACCESS_TRANSITION",
        f"{event.kind.value} requires {expected} for access {event.access_id}",
    )


def derive_source_scope_v1(
    *,
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: Iterable[AccessEventV1],
) -> SourceScopeV1:
    """Replay the complete explicit ledger and derive exact source truth."""

    _validate_seal_v1(inventory, seal)
    ledger = tuple(events)
    if len(ledger) > MAX_EVENTS:
        _fail("CARDINALITY_INVALID", "event ledger exceeds frozen bounds")
    for event in ledger:
        _require_artifact_type(event, AccessEventV1, field_name="event")
    archives = {archive.archive_id: archive for archive in inventory.archives}
    members = {
        (archive.archive_id, member.member_id): member
        for archive in inventory.archives
        for member in archive.members
    }
    archive_stages = {archive.archive_id: AccessStage.UNOPENED for archive in inventory.archives}
    member_stages = dict.fromkeys(members, AccessStage.UNOPENED)
    archive_failures = dict.fromkeys(archives, False)
    member_failures = dict.fromkeys(members, False)
    accesses: dict[str, _AccessState] = {}
    prior = seal.event_genesis_sha256
    for expected_sequence, event in enumerate(ledger, start=1):
        if event.sequence != expected_sequence:
            _fail("EVENT_SEQUENCE_INVALID", "event sequences must be contiguous from one")
        if event.prior_event_sha256 != prior:
            _fail("EVENT_CHAIN_MISMATCH", "event prior digest does not match ledger tip")
        if event.run_id != inventory.run_id or event.seal_sha256 != seal.seal_sha256:
            _fail("EVENT_SEAL_MISMATCH", "event is bound to another run or seal")
        _verify_event_digest(event)
        _validate_event_shape(event)
        archive = archives.get(event.archive_id)
        if archive is None:
            _fail("UNKNOWN_ARCHIVE", f"unknown archive {event.archive_id}")
        access = accesses.get(event.access_id)
        if event.kind is EventKind.OPEN_ATTEMPTED:
            if access is not None:
                _fail("ACCESS_ID_REUSED", f"access ID {event.access_id} was already used")
            access = _AccessState(archive_id=event.archive_id, open_kind=EventKind.OPEN_ATTEMPTED)
            accesses[event.access_id] = access
        else:
            if access is None:
                _raise_transition("OPEN_ATTEMPTED", event)
            if access.archive_id != event.archive_id:
                _fail("ACCESS_ARCHIVE_MISMATCH", "access ID changed archive identity")
            if access.failed:
                _fail("ACCESS_FAILED_ABSORBING", "events after failure are forbidden")
        if event.kind is EventKind.OPENED:
            if access.open_kind is not EventKind.OPEN_ATTEMPTED:
                _raise_transition("OPEN_ATTEMPTED", event)
            if (
                event.observed_byte_count != archive.byte_count
                or event.observed_sha256 != archive.content_sha256
            ):
                _fail("ARCHIVE_IDENTITY_MISMATCH", "observed archive identity drifted")
            access.open_kind = EventKind.OPENED
        elif event.kind is EventKind.OPEN_FAILED:
            if access.open_kind is not EventKind.OPEN_ATTEMPTED:
                _raise_transition("OPEN_ATTEMPTED", event)
            access.open_kind = EventKind.OPEN_FAILED
            access.failed = True
            archive_failures[event.archive_id] = True
        elif event.kind not in _OPEN_EVENTS:
            if access.open_kind is not EventKind.OPENED:
                _raise_transition("OPENED", event)
            member_id = cast(str, event.member_id)
            member = members.get((event.archive_id, member_id))
            if member is None:
                _fail("UNKNOWN_MEMBER", f"unknown member {member_id}")
            previous_kind = access.member_kinds.get(member_id)
            if event.kind is EventKind.DECOMPRESS_ATTEMPTED:
                if previous_kind is not None:
                    _raise_transition("no prior member transition", event)
            elif event.kind in {
                EventKind.DECOMPRESSED,
                EventKind.DECOMPRESS_FAILED,
            }:
                if previous_kind is not EventKind.DECOMPRESS_ATTEMPTED:
                    _raise_transition("DECOMPRESS_ATTEMPTED", event)
            elif event.kind is EventKind.READ_ATTEMPTED:
                if previous_kind is not EventKind.DECOMPRESSED:
                    _raise_transition("DECOMPRESSED", event)
            elif (
                event.kind in {EventKind.READ_COMPLETE, EventKind.READ_FAILED}
                and previous_kind is not EventKind.READ_ATTEMPTED
            ):
                _raise_transition("READ_ATTEMPTED", event)
            if event.kind in {EventKind.DECOMPRESSED, EventKind.READ_COMPLETE} and (
                event.observed_byte_count != member.byte_count
                or event.observed_sha256 != member.content_sha256
            ):
                _fail("MEMBER_IDENTITY_MISMATCH", "observed member identity drifted")
            access.member_kinds[member_id] = event.kind
            member_key = (event.archive_id, member_id)
            member_stage = _EVENT_STAGE[event.kind]
            if _STAGE_RANK[member_stage] > _STAGE_RANK[member_stages[member_key]]:
                member_stages[member_key] = member_stage
            if event.kind in {EventKind.DECOMPRESS_FAILED, EventKind.READ_FAILED}:
                access.failed = True
                member_failures[member_key] = True
                archive_failures[event.archive_id] = True
        stage = _EVENT_STAGE[event.kind]
        if _STAGE_RANK[stage] > _STAGE_RANK[archive_stages[event.archive_id]]:
            archive_stages[event.archive_id] = stage
        prior = event.event_sha256
    return _scope_from_stages(
        inventory,
        event_count=len(ledger),
        event_tip_sha256=prior,
        archive_stages=archive_stages,
        member_stages=member_stages,
        archive_failures=archive_failures,
        member_failures=member_failures,
    )


def build_terminal_claim_v1(
    *,
    inventory: InventoryV1,
    seal: PreRunSealV1,
    claimed_scope: SourceScopeV1,
    result_core_sha256: str,
) -> TerminalClaimV1:
    """Build a claim over a supplied scope; validation decides whether it is true."""

    _validate_seal_v1(inventory, seal)
    _require_artifact_type(claimed_scope, SourceScopeV1, field_name="claimed_scope")
    _require_sha256(result_core_sha256, field_name="result_core_sha256")
    payload: dict[str, object] = {
        "eventCount": claimed_scope.event_count,
        "eventTipSha256": claimed_scope.event_tip_sha256,
        "failureCount": claimed_scope.failure_count,
        "holdoutGate": claimed_scope.holdout_gate.value,
        "holdoutFailureCount": claimed_scope.holdout_failure_count,
        "holdoutState": claimed_scope.holdout_state.value,
        "inventorySha256": inventory.inventory_sha256,
        "resultCoreSha256": result_core_sha256,
        "runId": inventory.run_id,
        "sealSha256": seal.seal_sha256,
        "sourceScopeSha256": claimed_scope.source_scope_sha256,
    }
    return TerminalClaimV1(
        run_id=inventory.run_id,
        seal_sha256=seal.seal_sha256,
        inventory_sha256=inventory.inventory_sha256,
        event_count=claimed_scope.event_count,
        event_tip_sha256=claimed_scope.event_tip_sha256,
        source_scope_sha256=claimed_scope.source_scope_sha256,
        holdout_state=claimed_scope.holdout_state,
        holdout_gate=claimed_scope.holdout_gate,
        failure_count=claimed_scope.failure_count,
        holdout_failure_count=claimed_scope.holdout_failure_count,
        result_core_sha256=result_core_sha256,
        terminal_claim_sha256=_digest_v1("dq14/terminal-claim/v1", payload),
    )


def _replay_evidence_sha256(
    *,
    seal: PreRunSealV1,
    events: tuple[AccessEventV1, ...],
    scope: SourceScopeV1,
    terminal_claim: TerminalClaimV1,
) -> str:
    return _digest_v1(
        "dq14/replay-evidence/v1",
        {
            "eventSha256s": [event.event_sha256 for event in events],
            "sealSha256": seal.seal_sha256,
            "sourceScopeSha256": scope.source_scope_sha256,
            "terminalClaimSha256": terminal_claim.terminal_claim_sha256,
        },
    )


def build_verifier_claim_v1(
    *,
    verifier_id: str,
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: Iterable[AccessEventV1],
    claimed_scope: SourceScopeV1,
    terminal_claim: TerminalClaimV1,
) -> VerifierClaimV1:
    """Build an exact verifier statement over supplied replay evidence."""

    _require_id(verifier_id, field_name="verifier_id")
    _validate_seal_v1(inventory, seal)
    _require_artifact_type(claimed_scope, SourceScopeV1, field_name="claimed_scope")
    _require_artifact_type(terminal_claim, TerminalClaimV1, field_name="terminal_claim")
    ledger = tuple(events)
    for event in ledger:
        _require_artifact_type(event, AccessEventV1, field_name="event")
    evidence_sha256 = _replay_evidence_sha256(
        seal=seal,
        events=ledger,
        scope=claimed_scope,
        terminal_claim=terminal_claim,
    )
    payload: dict[str, object] = {
        "eventCount": claimed_scope.event_count,
        "eventTipSha256": claimed_scope.event_tip_sha256,
        "failureCount": claimed_scope.failure_count,
        "holdoutGate": claimed_scope.holdout_gate.value,
        "holdoutFailureCount": claimed_scope.holdout_failure_count,
        "holdoutState": claimed_scope.holdout_state.value,
        "inventorySha256": inventory.inventory_sha256,
        "replayEvidenceSha256": evidence_sha256,
        "runId": inventory.run_id,
        "sealSha256": seal.seal_sha256,
        "sourceScopeSha256": claimed_scope.source_scope_sha256,
        "terminalClaimSha256": terminal_claim.terminal_claim_sha256,
        "validatorSourceSha256": inventory.validator_source_sha256,
        "verdict": VerifierVerdict.REPLAY_MATCH.value,
        "verifierId": verifier_id,
    }
    return VerifierClaimV1(
        verifier_id=verifier_id,
        verdict=VerifierVerdict.REPLAY_MATCH,
        run_id=inventory.run_id,
        inventory_sha256=inventory.inventory_sha256,
        seal_sha256=seal.seal_sha256,
        validator_source_sha256=inventory.validator_source_sha256,
        event_count=claimed_scope.event_count,
        event_tip_sha256=claimed_scope.event_tip_sha256,
        source_scope_sha256=claimed_scope.source_scope_sha256,
        holdout_state=claimed_scope.holdout_state,
        holdout_gate=claimed_scope.holdout_gate,
        failure_count=claimed_scope.failure_count,
        holdout_failure_count=claimed_scope.holdout_failure_count,
        terminal_claim_sha256=terminal_claim.terminal_claim_sha256,
        replay_evidence_sha256=evidence_sha256,
        verifier_claim_sha256=_digest_v1("dq14/verifier-claim/v1", payload),
    )


def _validate_terminal_claim(
    *,
    inventory: InventoryV1,
    seal: PreRunSealV1,
    derived_scope: SourceScopeV1,
    terminal_claim: TerminalClaimV1,
) -> None:
    expected = build_terminal_claim_v1(
        inventory=inventory,
        seal=seal,
        claimed_scope=derived_scope,
        result_core_sha256=terminal_claim.result_core_sha256,
    )
    if (
        terminal_claim.source_scope_sha256 == seal.initial_source_scope_sha256
        and derived_scope.source_scope_sha256 != seal.initial_source_scope_sha256
    ):
        _fail(
            "TERMINAL_SOURCE_SCOPE_MISMATCH",
            "pre-run all-unopened scope was copied into a post-access terminal claim",
        )
    if terminal_claim.event_count != derived_scope.event_count or (
        terminal_claim.event_tip_sha256 != derived_scope.event_tip_sha256
    ):
        _fail(
            "TERMINAL_EVENT_TIP_MISMATCH",
            "terminal claim does not bind the complete supplied ledger",
        )
    if (
        terminal_claim.source_scope_sha256 != derived_scope.source_scope_sha256
        or terminal_claim.holdout_state is not derived_scope.holdout_state
        or terminal_claim.holdout_gate is not derived_scope.holdout_gate
        or terminal_claim.failure_count != derived_scope.failure_count
        or terminal_claim.holdout_failure_count != derived_scope.holdout_failure_count
    ):
        _fail(
            "TERMINAL_SOURCE_SCOPE_MISMATCH",
            "terminal sourceScope or holdout claim differs from replay truth",
        )
    if terminal_claim != expected:
        _fail(
            "TERMINAL_CLAIM_DIGEST_MISMATCH",
            "terminal claim fields or digest are not exact",
        )


def validate_replay_v1(
    *,
    inventory: InventoryV1,
    seal: PreRunSealV1,
    events: Iterable[AccessEventV1],
    terminal_claim: TerminalClaimV1,
    verifier_claims: Iterable[VerifierClaimV1],
) -> ReplayReceiptV1:
    """Validate all bindings and return a no-authority receipt or raise."""

    ledger = tuple(events)
    _require_artifact_type(terminal_claim, TerminalClaimV1, field_name="terminal_claim")
    derived_scope = derive_source_scope_v1(inventory=inventory, seal=seal, events=ledger)
    _validate_terminal_claim(
        inventory=inventory,
        seal=seal,
        derived_scope=derived_scope,
        terminal_claim=terminal_claim,
    )
    claims = tuple(verifier_claims)
    for claim in claims:
        _require_artifact_type(claim, VerifierClaimV1, field_name="verifier_claim")
    verifier_ids = tuple(sorted(claim.verifier_id for claim in claims))
    if verifier_ids != inventory.required_verifier_ids:
        _fail(
            "VERIFIER_SET_MISMATCH",
            "verifier claims must exactly equal the frozen required set",
        )
    if len(set(verifier_ids)) != len(verifier_ids):
        _fail("VERIFIER_SET_MISMATCH", "duplicate verifier claim")
    evidence_sha256 = _replay_evidence_sha256(
        seal=seal,
        events=ledger,
        scope=derived_scope,
        terminal_claim=terminal_claim,
    )
    sorted_claims = tuple(sorted(claims, key=lambda claim: claim.verifier_id))
    for claim in sorted_claims:
        expected = build_verifier_claim_v1(
            verifier_id=claim.verifier_id,
            inventory=inventory,
            seal=seal,
            events=ledger,
            claimed_scope=derived_scope,
            terminal_claim=terminal_claim,
        )
        if claim != expected:
            _fail(
                "VERIFIER_CLAIM_MISMATCH",
                f"verifier {claim.verifier_id} does not bind replay truth",
            )
    verifier_digests = tuple(claim.verifier_claim_sha256 for claim in sorted_claims)
    payload: dict[str, object] = {
        "authority": AUTHORITY_NONE,
        "eventCount": derived_scope.event_count,
        "eventTipSha256": derived_scope.event_tip_sha256,
        "failureCount": derived_scope.failure_count,
        "holdoutGate": derived_scope.holdout_gate.value,
        "holdoutFailureCount": derived_scope.holdout_failure_count,
        "holdoutState": derived_scope.holdout_state.value,
        "inventorySha256": inventory.inventory_sha256,
        "proofLimitation": PROOF_LIMITATION_V1,
        "replayEvidenceSha256": evidence_sha256,
        "runId": inventory.run_id,
        "sealSha256": seal.seal_sha256,
        "sourceScopeSha256": derived_scope.source_scope_sha256,
        "terminalClaimSha256": terminal_claim.terminal_claim_sha256,
        "validatorSourceSha256": inventory.validator_source_sha256,
        "verifierClaimSha256s": list(verifier_digests),
    }
    return ReplayReceiptV1(
        run_id=inventory.run_id,
        inventory_sha256=inventory.inventory_sha256,
        seal_sha256=seal.seal_sha256,
        validator_source_sha256=inventory.validator_source_sha256,
        event_count=derived_scope.event_count,
        event_tip_sha256=derived_scope.event_tip_sha256,
        source_scope_sha256=derived_scope.source_scope_sha256,
        holdout_state=derived_scope.holdout_state,
        holdout_gate=derived_scope.holdout_gate,
        failure_count=derived_scope.failure_count,
        holdout_failure_count=derived_scope.holdout_failure_count,
        terminal_claim_sha256=terminal_claim.terminal_claim_sha256,
        verifier_claim_sha256s=verifier_digests,
        replay_evidence_sha256=evidence_sha256,
        authority=AUTHORITY_NONE,
        proof_limitation=PROOF_LIMITATION_V1,
        receipt_sha256=_digest_v1("dq14/replay-receipt/v1", payload),
    )


def projection_v1(value: object) -> object:
    """Return the public canonical projection for a DQ-14 artifact."""

    projectable_types = (
        MemberInventoryV1,
        ArchiveInventoryV1,
        InventoryV1,
        SourceStateV1,
        StageCountV1,
        SourceScopeV1,
        PreRunSealV1,
        AccessEventV1,
        TerminalClaimV1,
        VerifierClaimV1,
        ReplayReceiptV1,
    )
    if type(value) not in projectable_types:
        _fail("SCHEMA_INVALID", "value is not a DQ-14 artifact")
    return cast(_Projectable, value).to_payload_v1()
