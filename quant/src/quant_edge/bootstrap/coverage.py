"""Canonical Q03 source-coverage and immutable archive-revision evidence.

The records in this module describe what was observed, what is unknown, and what a
source cannot provide.  They do not discover archive paths, fetch bytes, admit a source,
or mutate a lake revision.  All acquisition time and every digest are caller supplied.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Final
from urllib.parse import urlsplit

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    DigestV1,
    RawTimestampV1,
    TimestampBasis,
    TimestampUnit,
    require_contract_id,
    require_strict_int,
)
from quant_edge.primitives import require_utc_millis

MAX_COVERAGE_ENTRIES: Final = 4_096
MAX_OMISSIONS: Final = 64
ARCHIVE_GAP_COUNT_BASIS: Final = "ADJACENT_AGGREGATE_OR_UNDERLYING_TRADE_ID_DISCONTINUITY"
_LEAF_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$")
_OMISSION_PATTERN: Final = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_FORBIDDEN_URL_CHARACTERS: Final = frozenset("|<>`\\")


class CoverageAvailability(StrEnum):
    """Whether a capability/measurement was actually observed."""

    OBSERVED = "OBSERVED"
    UNKNOWN = "UNKNOWN"
    UNAVAILABLE = "UNAVAILABLE"


class ArchiveReplacementStatus(StrEnum):
    """Point-in-time archive replacement evidence, never a permanence claim."""

    OBSERVED_AT_RETRIEVAL = "OBSERVED_AT_RETRIEVAL"
    REPLACEMENT_STATUS_UNKNOWN = "REPLACEMENT_STATUS_UNKNOWN"
    SUPERSEDED_BY_CHECKSUM_CHANGE = "SUPERSEDED_BY_CHECKSUM_CHANGE"


class RepositoryLicensePosture(StrEnum):
    MIT_IN_README_ONLY = "MIT_IN_README_ONLY"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    UNKNOWN = "UNKNOWN"


class ArchiveDataLicensePosture(StrEnum):
    NOT_EXPLICIT = "NOT_EXPLICIT"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    UNKNOWN = "UNKNOWN"


class RawRedistributionPosture(StrEnum):
    UNKNOWN_REQUIRES_APPROVAL = "UNKNOWN_REQUIRES_APPROVAL"
    PROHIBITED = "PROHIBITED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class RetentionPosture(StrEnum):
    LOCAL_DERIVED_ONLY = "LOCAL_DERIVED_ONLY"
    INTERFACE_ONLY = "INTERFACE_ONLY"
    UNKNOWN = "UNKNOWN"


class RevisionComparisonStatus(StrEnum):
    SAME_IMMUTABLE_REVISION = "SAME_IMMUTABLE_REVISION"
    NEW_IMMUTABLE_REVISION_REQUIRED = "NEW_IMMUTABLE_REVISION_REQUIRED"


def _require_sha256(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise ContractValueError(f"{field} must be a lowercase SHA-256 digest")
    try:
        return DigestV1(value).hexdigest
    except ContractValueError as error:
        raise ContractValueError(f"{field} must be a lowercase SHA-256 digest") from error


def _require_optional_sha256(value: object, *, field: str) -> str | None:
    if value is None:
        return None
    return _require_sha256(value, field=field)


def _require_https_url(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ContractValueError(f"{field} must be a normalized HTTPS URL")
    try:
        value.encode("ascii", errors="strict")
    except UnicodeEncodeError as error:
        raise ContractValueError(f"{field} must be an ASCII HTTPS URL") from error
    if any(character.isspace() or character in _FORBIDDEN_URL_CHARACTERS for character in value):
        raise ContractValueError(f"{field} contains an unsafe URL character")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/")
        or "/../" in parsed.path
        or "/./" in parsed.path
        or parsed.path.endswith("/..")
        or parsed.path.endswith("/.")
    ):
        raise ContractValueError(f"{field} must be a closed, credential-free HTTPS URL")
    return value


def _require_optional_https_url(value: object, *, field: str) -> str | None:
    if value is None:
        return None
    return _require_https_url(value, field=field)


def _require_leaf_name(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _LEAF_PATTERN.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be a bounded ASCII leaf name")
    return value


def _require_utc_date(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise ContractValueError(f"{field} must be an ISO UTC date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ContractValueError(f"{field} must be an ISO UTC date") from error
    if parsed.isoformat() != value:
        raise ContractValueError(f"{field} must be a canonical ISO UTC date")
    return value


def _require_omissions(values: object) -> tuple[str, ...]:
    if not isinstance(values, tuple) or not 1 <= len(values) <= MAX_OMISSIONS:
        raise ContractValueError("known_omissions must be a non-empty bounded immutable tuple")
    for value in values:
        if not isinstance(value, str) or _OMISSION_PATTERN.fullmatch(value) is None:
            raise ContractValueError("known_omissions must use uppercase controlled codes")
    if values != tuple(sorted(set(values))):
        raise ContractValueError("known_omissions must be sorted and unique")
    return values


@dataclass(frozen=True, slots=True)
class CountEvidenceV1:
    """A count whose missing state cannot be confused with a measured zero."""

    availability: CoverageAvailability
    value: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.availability, CoverageAvailability):
            raise ContractValueError("count availability must be CoverageAvailability")
        if self.availability is CoverageAvailability.OBSERVED:
            if self.value is None:
                raise ContractValueError("an observed count requires a value")
            require_strict_int(self.value, field="observed count", minimum=0, maximum=INT64_MAX)
        elif self.value is not None:
            raise ContractValueError("an UNKNOWN/UNAVAILABLE count must keep value null")

    def as_mapping(self) -> dict[str, object]:
        return {
            "availability": self.availability.value,
            "value": None if self.value is None else str(self.value),
        }


@dataclass(frozen=True, slots=True)
class SourceTimeRangeV1:
    """Raw source-time bounds with their explicit per-file unit and basis."""

    availability: CoverageAvailability
    unit: TimestampUnit | None
    basis: TimestampBasis | None
    first_raw: int | None
    last_raw: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.availability, CoverageAvailability):
            raise ContractValueError("source-time availability must be CoverageAvailability")
        if self.availability is CoverageAvailability.OBSERVED:
            if not isinstance(self.unit, TimestampUnit) or not isinstance(
                self.basis, TimestampBasis
            ):
                raise ContractValueError("observed source time requires an explicit unit and basis")
            if self.first_raw is None or self.last_raw is None:
                raise ContractValueError("observed source time requires both raw bounds")
            first = RawTimestampV1(raw=self.first_raw, unit=self.unit, basis=self.basis)
            last = RawTimestampV1(raw=self.last_raw, unit=self.unit, basis=self.basis)
            if first.raw > last.raw:
                raise ContractValueError("source-time bounds must be nondecreasing")
        elif any(
            value is not None for value in (self.unit, self.basis, self.first_raw, self.last_raw)
        ):
            raise ContractValueError("UNKNOWN/UNAVAILABLE source time must keep all facts null")

    def as_mapping(self) -> dict[str, object]:
        return {
            "availability": self.availability.value,
            "basis": None if self.basis is None else self.basis.value,
            "firstRaw": None if self.first_raw is None else str(self.first_raw),
            "lastRaw": None if self.last_raw is None else str(self.last_raw),
            "unit": None if self.unit is None else self.unit.value,
        }


@dataclass(frozen=True, slots=True)
class SourceLicenseEvidenceV1:
    """License/retention observations without upgrading access into permission."""

    repository_license: RepositoryLicensePosture
    archive_data_license: ArchiveDataLicensePosture
    raw_redistribution: RawRedistributionPosture
    retention_posture: RetentionPosture
    evidence_sha256: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.repository_license, RepositoryLicensePosture):
            raise ContractValueError("repository_license must be RepositoryLicensePosture")
        if not isinstance(self.archive_data_license, ArchiveDataLicensePosture):
            raise ContractValueError("archive_data_license must be ArchiveDataLicensePosture")
        if not isinstance(self.raw_redistribution, RawRedistributionPosture):
            raise ContractValueError("raw_redistribution must be RawRedistributionPosture")
        if not isinstance(self.retention_posture, RetentionPosture):
            raise ContractValueError("retention_posture must be RetentionPosture")
        if not isinstance(self.evidence_sha256, tuple) or not self.evidence_sha256:
            raise ContractValueError("license evidence must be a non-empty immutable digest tuple")
        validated = tuple(
            _require_sha256(value, field=f"evidence_sha256[{index}]")
            for index, value in enumerate(self.evidence_sha256)
        )
        if validated != tuple(sorted(set(validated))):
            raise ContractValueError("license evidence digests must be sorted and unique")

    def as_mapping(self) -> dict[str, object]:
        return {
            "archiveDataLicense": self.archive_data_license.value,
            "evidenceSha256": list(self.evidence_sha256),
            "rawRedistribution": self.raw_redistribution.value,
            "repositoryLicense": self.repository_license.value,
            "retentionPosture": self.retention_posture.value,
        }


def archive_source_revision_sha256(*, source_url: str, official_checksum_sha256: str) -> str:
    """Bind a mutable URL to the exact publisher checksum observed at retrieval."""

    normalized_url = _require_https_url(source_url, field="source_url")
    checksum = _require_sha256(official_checksum_sha256, field="official_checksum_sha256")
    identity = {
        "officialChecksumSha256": checksum,
        "schema": "ArchiveSourceRevisionIdentityV1",
        "sourceUrl": normalized_url,
        "version": 1,
    }
    return hashlib.sha256(canonical_json_bytes(identity)).hexdigest()


@dataclass(frozen=True, slots=True)
class CoverageEntryV1:
    """One product/event/date capability observation and its immutable revision facts."""

    venue: str
    product: str
    event_kind: str
    utc_date: str
    availability: CoverageAvailability
    source_url: str | None
    checksum_url: str | None
    retrieved_at_ms: int | None
    official_checksum_sha256: str | None
    sidecar_bytes_sha256: str | None
    artifact_sha256: str | None
    member_name: str | None
    member_sha256: str | None
    artifact_bytes: CountEvidenceV1
    member_bytes: CountEvidenceV1
    row_count: CountEvidenceV1
    schema_id: str | None
    schema_fingerprint: str | None
    source_time: SourceTimeRangeV1
    gap_count: CountEvidenceV1
    invalid_count: CountEvidenceV1
    duplicate_count: CountEvidenceV1
    replacement_status: ArchiveReplacementStatus
    license: SourceLicenseEvidenceV1
    known_omissions: tuple[str, ...]

    def __post_init__(self) -> None:
        for field_name in ("venue", "product", "event_kind"):
            require_contract_id(getattr(self, field_name), field=field_name)
        _require_utc_date(self.utc_date, field="utc_date")
        if not isinstance(self.availability, CoverageAvailability):
            raise ContractValueError("availability must be CoverageAvailability")
        source_url = _require_optional_https_url(self.source_url, field="source_url")
        checksum_url = _require_optional_https_url(self.checksum_url, field="checksum_url")
        if (source_url is None) != (checksum_url is None):
            raise ContractValueError("source and checksum URLs must be present or absent together")
        if source_url is not None and checksum_url != f"{source_url}.CHECKSUM":
            raise ContractValueError("checksum_url must be the adjacent .CHECKSUM sidecar")
        for field_name in (
            "official_checksum_sha256",
            "sidecar_bytes_sha256",
            "artifact_sha256",
            "member_sha256",
            "schema_fingerprint",
        ):
            _require_optional_sha256(getattr(self, field_name), field=field_name)
        for field_name in (
            "artifact_bytes",
            "member_bytes",
            "row_count",
            "gap_count",
            "invalid_count",
            "duplicate_count",
        ):
            if not isinstance(getattr(self, field_name), CountEvidenceV1):
                raise ContractValueError(f"{field_name} must be CountEvidenceV1")
        if not isinstance(self.source_time, SourceTimeRangeV1):
            raise ContractValueError("source_time must be SourceTimeRangeV1")
        if not isinstance(self.replacement_status, ArchiveReplacementStatus):
            raise ContractValueError("replacement_status must be ArchiveReplacementStatus")
        if not isinstance(self.license, SourceLicenseEvidenceV1):
            raise ContractValueError("license must be SourceLicenseEvidenceV1")
        _require_omissions(self.known_omissions)

        if self.availability is CoverageAvailability.OBSERVED:
            if source_url is None:
                raise ContractValueError("observed coverage requires source and checksum URLs")
            required = (
                self.retrieved_at_ms,
                self.official_checksum_sha256,
                self.sidecar_bytes_sha256,
                self.artifact_sha256,
                self.member_name,
                self.member_sha256,
                self.schema_id,
                self.schema_fingerprint,
            )
            if any(value is None for value in required):
                raise ContractValueError("observed coverage requires complete immutable evidence")
            require_utc_millis(self.retrieved_at_ms, field="retrieved_at_ms")
            _require_leaf_name(self.member_name, field="member_name")
            require_contract_id(self.schema_id, field="schema_id")
            if self.official_checksum_sha256 != self.artifact_sha256:
                raise ContractValueError("artifact digest must match the official checksum")
            for field_name in (
                "artifact_bytes",
                "member_bytes",
                "row_count",
                "invalid_count",
                "duplicate_count",
            ):
                value = getattr(self, field_name)
                if value.availability is not CoverageAvailability.OBSERVED:
                    raise ContractValueError(f"observed coverage requires observed {field_name}")
            if self.source_time.availability is not CoverageAvailability.OBSERVED:
                raise ContractValueError("observed coverage requires observed source-time bounds")
            if self.replacement_status is ArchiveReplacementStatus.REPLACEMENT_STATUS_UNKNOWN:
                raise ContractValueError(
                    "observed bytes require a point-in-time replacement status"
                )
        else:
            if any(
                value is not None
                for value in (
                    self.retrieved_at_ms,
                    self.official_checksum_sha256,
                    self.sidecar_bytes_sha256,
                    self.artifact_sha256,
                    self.member_name,
                    self.member_sha256,
                    self.schema_id,
                    self.schema_fingerprint,
                )
            ):
                raise ContractValueError("missing coverage cannot carry observed artifact facts")
            for field_name in (
                "artifact_bytes",
                "member_bytes",
                "row_count",
                "gap_count",
                "invalid_count",
                "duplicate_count",
            ):
                if getattr(self, field_name).availability is not self.availability:
                    raise ContractValueError(
                        "missing coverage metrics must preserve the entry missingness state"
                    )
            if self.source_time.availability is not self.availability:
                raise ContractValueError(
                    "missing source time must preserve the entry missingness state"
                )
            if self.replacement_status is not ArchiveReplacementStatus.REPLACEMENT_STATUS_UNKNOWN:
                raise ContractValueError("missing coverage has unknown replacement status")

    @property
    def source_revision_sha256(self) -> str | None:
        if self.source_url is None or self.official_checksum_sha256 is None:
            return None
        return archive_source_revision_sha256(
            source_url=self.source_url,
            official_checksum_sha256=self.official_checksum_sha256,
        )

    @property
    def capability_key(self) -> tuple[str, str, str, str]:
        return (self.venue, self.product, self.event_kind, self.utc_date)

    def as_mapping(self) -> dict[str, object]:
        gap_count_basis = None
        if (
            self.availability is CoverageAvailability.OBSERVED
            and self.gap_count.availability is CoverageAvailability.OBSERVED
            and self.event_kind == "aggTrades"
        ):
            gap_count_basis = ARCHIVE_GAP_COUNT_BASIS
        return {
            "artifactBytes": self.artifact_bytes.as_mapping(),
            "artifactSha256": self.artifact_sha256,
            "availability": self.availability.value,
            "checksumUrl": self.checksum_url,
            "duplicateCount": self.duplicate_count.as_mapping(),
            "eventKind": self.event_kind,
            "gapCount": self.gap_count.as_mapping(),
            "gapCountBasis": gap_count_basis,
            "invalidCount": self.invalid_count.as_mapping(),
            "knownOmissions": list(self.known_omissions),
            "license": self.license.as_mapping(),
            "memberBytes": self.member_bytes.as_mapping(),
            "memberName": self.member_name,
            "memberSha256": self.member_sha256,
            "officialChecksumSha256": self.official_checksum_sha256,
            "product": self.product,
            "replacementStatus": self.replacement_status.value,
            "retrievedAtMs": self.retrieved_at_ms,
            "rowCount": self.row_count.as_mapping(),
            "schemaFingerprint": self.schema_fingerprint,
            "schemaId": self.schema_id,
            "sidecarBytesSha256": self.sidecar_bytes_sha256,
            "sourceRevisionSha256": self.source_revision_sha256,
            "sourceTime": self.source_time.as_mapping(),
            "sourceUrl": self.source_url,
            "utcDate": self.utc_date,
            "venue": self.venue,
        }


@dataclass(frozen=True, slots=True)
class CoverageMatrixV1:
    """A bounded exact coverage matrix and deterministic human projection."""

    matrix_revision: str
    as_of_ms: int
    entries: tuple[CoverageEntryV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.matrix_revision, field="matrix_revision")
        require_utc_millis(self.as_of_ms, field="as_of_ms")
        if (
            not isinstance(self.entries, tuple)
            or not 1 <= len(self.entries) <= MAX_COVERAGE_ENTRIES
        ):
            raise ContractValueError("entries must be a non-empty bounded immutable tuple")
        if any(not isinstance(entry, CoverageEntryV1) for entry in self.entries):
            raise ContractValueError("entries must contain only CoverageEntryV1 records")
        keys = tuple(entry.capability_key for entry in self.entries)
        if keys != tuple(sorted(set(keys))):
            raise ContractValueError("coverage entries must have sorted unique capability keys")
        for entry in self.entries:
            if entry.availability is not CoverageAvailability.OBSERVED:
                continue
            if entry.retrieved_at_ms is None:
                raise ContractValueError("observed coverage lost its retrieval time")
            if entry.retrieved_at_ms > self.as_of_ms:
                raise ContractValueError(
                    "observed coverage retrieval time must not follow the matrix as-of time"
                )

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfMs": self.as_of_ms,
            "authorityPosture": "RESEARCH_EVIDENCE_ONLY",
            "entries": [entry.as_mapping() for entry in self.entries],
            "matrixRevision": self.matrix_revision,
            "schema": "SourceCoverageMatrixV1",
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()


def compare_archive_revisions(
    previous: CoverageEntryV1,
    current: CoverageEntryV1,
) -> RevisionComparisonStatus:
    """Require a new immutable revision when one URL's official checksum changes."""

    if not isinstance(previous, CoverageEntryV1) or not isinstance(current, CoverageEntryV1):
        raise ContractValueError("revision comparison requires CoverageEntryV1 records")
    if previous.source_url is None or current.source_url is None:
        raise ContractValueError("revision comparison requires observed source URLs")
    if previous.source_url != current.source_url:
        raise ContractValueError("revision comparison applies only to the same source URL")
    if previous.source_revision_sha256 is None or current.source_revision_sha256 is None:
        raise ContractValueError("revision comparison requires official checksums")
    if previous.source_revision_sha256 == current.source_revision_sha256:
        return RevisionComparisonStatus.SAME_IMMUTABLE_REVISION
    return RevisionComparisonStatus.NEW_IMMUTABLE_REVISION_REQUIRED


def _render_count(value: CountEvidenceV1) -> str:
    if value.availability is CoverageAvailability.OBSERVED:
        return str(value.value)
    return value.availability.value


def render_coverage_matrix_markdown(matrix: CoverageMatrixV1) -> str:
    """Render the exact human-readable projection of the canonical matrix."""

    if not isinstance(matrix, CoverageMatrixV1):
        raise ContractValueError("matrix must be CoverageMatrixV1")
    lines = [
        "# Q03 Source Coverage Matrix",
        "",
        f"Matrix revision: `{matrix.matrix_revision}`",
        f"As-of UTC milliseconds: `{matrix.as_of_ms}`",
        f"Canonical SHA-256: `{matrix.sha256}`",
        "",
        (
            "Authority posture: `RESEARCH_EVIDENCE_ONLY`. `UNKNOWN` and `UNAVAILABLE` are "
            "missingness states, never measured zeroes. A URL is not an immutable revision "
            "without its exact official checksum."
        ),
        "",
        (
            "| Venue | Product | Event | UTC date | Availability | Rows | Observed internal ID "
            "discontinuities | Invalid | Duplicates | Source revision |"
        ),
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for entry in matrix.entries:
        lines.append(
            "| "
            + " | ".join(
                (
                    entry.venue,
                    entry.product,
                    entry.event_kind,
                    entry.utc_date,
                    entry.availability.value,
                    _render_count(entry.row_count),
                    _render_count(entry.gap_count),
                    _render_count(entry.invalid_count),
                    _render_count(entry.duplicate_count),
                    entry.source_revision_sha256 or entry.availability.value,
                )
            )
            + " |"
        )
    for entry in matrix.entries:
        source_time = entry.source_time
        time_text = source_time.availability.value
        if source_time.availability is CoverageAvailability.OBSERVED:
            if source_time.unit is None or source_time.basis is None:
                raise ContractValueError("observed source time lost its validated unit or basis")
            time_text = (
                f"{source_time.first_raw}..{source_time.last_raw} "
                f"{source_time.unit.value}/{source_time.basis.value}"
            )
        lines.extend(
            [
                "",
                f"### `{entry.venue}/{entry.product}/{entry.event_kind}/{entry.utc_date}`",
                "",
                f"- **Source URL:** {entry.source_url or entry.availability.value}",
                (
                    "- **Official checksum:** "
                    f"{entry.official_checksum_sha256 or entry.availability.value}"
                ),
                (
                    f"- **Schema:** {entry.schema_id or entry.availability.value} / "
                    f"{entry.schema_fingerprint or entry.availability.value}"
                ),
                f"- **Raw source time:** {time_text}",
                f"- **Replacement status:** {entry.replacement_status.value}",
                (
                    "- **License/retention:** "
                    f"repository={entry.license.repository_license.value}; "
                    f"archive={entry.license.archive_data_license.value}; "
                    f"redistribution={entry.license.raw_redistribution.value}; "
                    f"retention={entry.license.retention_posture.value}"
                ),
                f"- **Known omissions:** {'; '.join(entry.known_omissions)}",
            ]
        )
    return "\n".join(lines) + "\n"


def verify_coverage_matrix_markdown(markdown: str, matrix: CoverageMatrixV1) -> None:
    if not isinstance(markdown, str) or markdown != render_coverage_matrix_markdown(matrix):
        raise ContractValueError("Markdown differs from the exact coverage-matrix projection")
