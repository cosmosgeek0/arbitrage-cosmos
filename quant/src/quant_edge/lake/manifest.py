from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import cast

from quant_edge.canonical import (
    canonical_json_bytes,
    parse_canonical_object,
    require_exact_keys,
)
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.lake.contracts import (
    QUALITY_STATE_ORDER,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    PartitionKeyV1,
    QualityState,
    require_contract_id,
    require_path_segment,
    require_strict_int,
)

MANIFEST_SCHEMA = "DatasetRevisionManifestV1"
MANIFEST_VERSION = 1
MAX_MANIFEST_BYTES = 1_048_576
MAX_PARENT_ARTIFACT_DIGESTS = 128
MAX_SOURCE_SESSIONS = 4_096


class RevisionKind(StrEnum):
    INITIAL = "INITIAL"
    CORRECTION = "CORRECTION"


class RetentionClass(StrEnum):
    PRESERVE = "PRESERVE"
    RAW_EXPIRABLE = "RAW_EXPIRABLE"
    DERIVED_REBUILDABLE = "DERIVED_REBUILDABLE"


def _require_dict(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise CanonicalJsonError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _require_str(value: object, *, path: str) -> str:
    if not isinstance(value, str):
        raise CanonicalJsonError(f"{path} must be a string")
    return value


def _require_optional_str(value: object, *, path: str) -> str | None:
    if value is None:
        return None
    return _require_str(value, path=path)


def _require_decimal_int(value: object, *, path: str, minimum: int, maximum: int) -> int:
    text = _require_str(value, path=path)
    if text == "0":
        parsed = 0
    elif text.startswith("-"):
        if len(text) < 2 or text[1] == "0" or not text[1:].isdigit():
            raise CanonicalJsonError(f"{path} must be a canonical decimal integer string")
        parsed = -int(text[1:])
    else:
        if text.startswith("0") or not text.isdigit():
            raise CanonicalJsonError(f"{path} must be a canonical decimal integer string")
        parsed = int(text)
    try:
        return require_strict_int(parsed, field=path, minimum=minimum, maximum=maximum)
    except ContractValueError as error:
        raise CanonicalJsonError(str(error)) from error


def _digest(value: object, *, path: str) -> DigestV1:
    try:
        return DigestV1(_require_str(value, path=path))
    except ContractValueError as error:
        raise CanonicalJsonError(f"{path}: {error}") from error


def _segment(value: object, *, path: str) -> str:
    try:
        return require_path_segment(value, field=path)
    except ContractValueError as error:
        raise CanonicalJsonError(str(error)) from error


def _contract_id(value: object, *, path: str) -> str:
    try:
        return require_contract_id(value, field=path)
    except ContractValueError as error:
        raise CanonicalJsonError(str(error)) from error


@dataclass(frozen=True, slots=True)
class ParentRevisionV1:
    dataset_id: str
    revision_id: str
    manifest_digest: DigestV1

    def __post_init__(self) -> None:
        require_path_segment(self.dataset_id, field="parent dataset_id")
        require_path_segment(self.revision_id, field="parent revision_id")
        if not isinstance(self.manifest_digest, DigestV1):
            raise ContractValueError("parent manifest_digest must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "datasetId": self.dataset_id,
            "manifestSha256": self.manifest_digest.hexdigest,
            "revisionId": self.revision_id,
        }


@dataclass(frozen=True, slots=True)
class PartitionManifestEntryV1:
    key: PartitionKeyV1
    relative_path: str
    artifact_digest: DigestV1
    byte_count: int
    row_count: int
    event_time_min_ns: int
    event_time_max_ns: int
    receive_time_min_ns: int | None
    receive_time_max_ns: int | None
    source_sessions: tuple[str, ...]
    quality_counts: tuple[tuple[QualityState, int], ...]
    gap_count: int
    duplicate_count: int
    late_count: int
    parent_artifact_digests: tuple[DigestV1, ...]
    retention_class: RetentionClass
    expires_at_ns: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.key, PartitionKeyV1):
            raise ContractValueError("partition key must be PartitionKeyV1")
        if not isinstance(self.artifact_digest, DigestV1):
            raise ContractValueError("artifact_digest must be DigestV1")
        require_strict_int(self.byte_count, field="byte_count", minimum=1, maximum=67_108_864)
        require_strict_int(self.row_count, field="row_count", minimum=1, maximum=1_000_000)
        for field_name in ("event_time_min_ns", "event_time_max_ns"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            )
        if self.event_time_min_ns > self.event_time_max_ns:
            raise ContractValueError("event time bounds are reversed")
        if (self.receive_time_min_ns is None) != (self.receive_time_max_ns is None):
            raise ContractValueError("receive time bounds must be paired")
        if self.receive_time_min_ns is not None and self.receive_time_max_ns is not None:
            require_strict_int(
                self.receive_time_min_ns,
                field="receive_time_min_ns",
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            )
            require_strict_int(
                self.receive_time_max_ns,
                field="receive_time_max_ns",
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            )
            if self.receive_time_min_ns > self.receive_time_max_ns:
                raise ContractValueError("receive time bounds are reversed")
        if (
            not isinstance(self.source_sessions, tuple)
            or not 1 <= len(self.source_sessions) <= MAX_SOURCE_SESSIONS
        ):
            raise ContractValueError(
                f"source_sessions must contain 1..{MAX_SOURCE_SESSIONS} immutable items"
            )
        for session in self.source_sessions:
            require_contract_id(session, field="source session")
        if self.source_sessions != tuple(sorted(set(self.source_sessions))):
            raise ContractValueError("source_sessions must be non-empty, sorted and unique")
        if not isinstance(self.quality_counts, tuple):
            raise ContractValueError("quality_counts must be an immutable tuple")
        if any(type(item) is not tuple or len(item) != 2 for item in self.quality_counts):
            raise ContractValueError("quality_counts entries must be immutable two-item tuples")
        if tuple(state for state, _count in self.quality_counts) != QUALITY_STATE_ORDER:
            raise ContractValueError("quality_counts must contain all states in frozen order")
        for state, count in self.quality_counts:
            if not isinstance(state, QualityState):
                raise ContractValueError("quality_counts keys must be QualityState")
            require_strict_int(count, field=f"quality count {state}", minimum=0)
        if sum(count for _state, count in self.quality_counts) != self.row_count:
            raise ContractValueError("quality_counts must sum to row_count")
        for field_name in ("gap_count", "duplicate_count", "late_count"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=0,
                maximum=self.row_count,
            )
        if (
            not isinstance(self.parent_artifact_digests, tuple)
            or len(self.parent_artifact_digests) > MAX_PARENT_ARTIFACT_DIGESTS
        ):
            raise ContractValueError("parent_artifact_digests must be a bounded immutable tuple")
        if any(not isinstance(item, DigestV1) for item in self.parent_artifact_digests):
            raise ContractValueError("parent_artifact_digests must contain DigestV1")
        hashes = tuple(item.hexdigest for item in self.parent_artifact_digests)
        if hashes != tuple(sorted(set(hashes))):
            raise ContractValueError("parent_artifact_digests must be sorted and unique")
        if not isinstance(self.retention_class, RetentionClass):
            raise ContractValueError("retention_class must be RetentionClass")
        if self.expires_at_ns is not None:
            require_strict_int(
                self.expires_at_ns,
                field="expires_at_ns",
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            )
        if self.retention_class is RetentionClass.PRESERVE and self.expires_at_ns is not None:
            raise ContractValueError("PRESERVE partitions cannot expire")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactSha256": self.artifact_digest.hexdigest,
            "byteCount": str(self.byte_count),
            "duplicateCount": str(self.duplicate_count),
            "eventTimeMaxNs": str(self.event_time_max_ns),
            "eventTimeMinNs": str(self.event_time_min_ns),
            "expiresAtNs": None if self.expires_at_ns is None else str(self.expires_at_ns),
            "gapCount": str(self.gap_count),
            "key": {
                "eventKind": self.key.event_kind,
                "product": self.key.product,
                "schemaVersion": self.key.schema_version,
                "symbolShard": self.key.symbol_shard,
                "utcDate": self.key.utc_date,
                "venue": self.key.venue,
            },
            "lateCount": str(self.late_count),
            "parentArtifactSha256": [item.hexdigest for item in self.parent_artifact_digests],
            "qualityCounts": {state.value: str(count) for state, count in self.quality_counts},
            "receiveTimeMaxNs": (
                None if self.receive_time_max_ns is None else str(self.receive_time_max_ns)
            ),
            "receiveTimeMinNs": (
                None if self.receive_time_min_ns is None else str(self.receive_time_min_ns)
            ),
            "relativePath": self.relative_path,
            "retentionClass": self.retention_class.value,
            "rowCount": str(self.row_count),
            "sourceSessions": list(self.source_sessions),
        }


@dataclass(frozen=True, slots=True)
class DatasetRevisionManifestV1:
    dataset_id: str
    revision_id: str
    revision_kind: RevisionKind
    published_at_ns: int
    parent_revisions: tuple[ParentRevisionV1, ...]
    schema_id: str
    schema_fingerprint: DigestV1
    writer_profile_id: str
    pyarrow_version: str
    dependency_lock_digest: DigestV1
    code_profile_digest: DigestV1
    config_digest: DigestV1
    producer_activity_id: str
    truth_posture: EvidencePosture
    partition: PartitionManifestEntryV1

    def __post_init__(self) -> None:
        require_path_segment(self.dataset_id, field="dataset_id")
        require_path_segment(self.revision_id, field="revision_id")
        if not isinstance(self.revision_kind, RevisionKind):
            raise ContractValueError("revision_kind must be RevisionKind")
        require_strict_int(
            self.published_at_ns,
            field="published_at_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        if not isinstance(self.parent_revisions, tuple):
            raise ContractValueError("parent_revisions must be an immutable tuple")
        if self.revision_kind is RevisionKind.INITIAL and self.parent_revisions:
            raise ContractValueError("INITIAL revision cannot have parents")
        if self.revision_kind is RevisionKind.CORRECTION and len(self.parent_revisions) != 1:
            raise ContractValueError("CORRECTION revision requires exactly one parent")
        for parent in self.parent_revisions:
            if not isinstance(parent, ParentRevisionV1):
                raise ContractValueError("parent_revisions must contain ParentRevisionV1")
            if parent.dataset_id != self.dataset_id:
                raise ContractValueError("parent revision must remain in the same dataset")
            if parent.revision_id == self.revision_id:
                raise ContractValueError("revision cannot parent itself")
        require_contract_id(self.schema_id, field="schema_id")
        require_contract_id(self.writer_profile_id, field="writer_profile_id")
        require_contract_id(self.pyarrow_version, field="pyarrow_version")
        require_contract_id(self.producer_activity_id, field="producer_activity_id")
        for field_name in (
            "schema_fingerprint",
            "dependency_lock_digest",
            "code_profile_digest",
            "config_digest",
        ):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        if not isinstance(self.truth_posture, EvidencePosture):
            raise ContractValueError("truth_posture must be EvidencePosture")
        if not isinstance(self.partition, PartitionManifestEntryV1):
            raise ContractValueError("partition must be PartitionManifestEntryV1")
        expected_path = self.partition.key.relative_partition_path(
            dataset_id=self.dataset_id,
            revision_id=self.revision_id,
        )
        if self.partition.relative_path != expected_path:
            raise ContractValueError("partition relative path is not derived from its typed key")

    def core_mapping(self) -> dict[str, object]:
        return {
            "codeProfileSha256": self.code_profile_digest.hexdigest,
            "configSha256": self.config_digest.hexdigest,
            "datasetId": self.dataset_id,
            "dependencyLockSha256": self.dependency_lock_digest.hexdigest,
            "parentRevisions": [parent.as_mapping() for parent in self.parent_revisions],
            "partition": self.partition.as_mapping(),
            "producerActivityId": self.producer_activity_id,
            "publishedAtNs": str(self.published_at_ns),
            "pyarrowVersion": self.pyarrow_version,
            "revisionId": self.revision_id,
            "revisionKind": self.revision_kind.value,
            "schemaFingerprint": self.schema_fingerprint.hexdigest,
            "schemaId": self.schema_id,
            "truthPosture": self.truth_posture.value,
            "writerProfileId": self.writer_profile_id,
        }

    @property
    def manifest_id(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.core_mapping())).hexdigest())

    def as_mapping(self) -> dict[str, object]:
        return {
            "core": self.core_mapping(),
            "manifestId": self.manifest_id.hexdigest,
            "schema": MANIFEST_SCHEMA,
            "version": MANIFEST_VERSION,
        }

    def to_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.to_bytes()).hexdigest())

    @classmethod
    def from_bytes(cls, raw: bytes) -> DatasetRevisionManifestV1:
        if len(raw) > MAX_MANIFEST_BYTES:
            raise CanonicalJsonError("manifest exceeds maximum byte count")
        envelope = parse_canonical_object(raw)
        require_exact_keys(
            envelope,
            expected=("core", "manifestId", "schema", "version"),
            path="$",
        )
        version = envelope["version"]
        if (
            envelope["schema"] != MANIFEST_SCHEMA
            or isinstance(version, bool)
            or not isinstance(version, int)
            or version != MANIFEST_VERSION
        ):
            raise CanonicalJsonError("unsupported manifest schema or version")
        core = _require_dict(envelope["core"], path="$.core")
        require_exact_keys(
            core,
            expected=(
                "codeProfileSha256",
                "configSha256",
                "datasetId",
                "dependencyLockSha256",
                "parentRevisions",
                "partition",
                "producerActivityId",
                "publishedAtNs",
                "pyarrowVersion",
                "revisionId",
                "revisionKind",
                "schemaFingerprint",
                "schemaId",
                "truthPosture",
                "writerProfileId",
            ),
            path="$.core",
        )
        parents_raw = core["parentRevisions"]
        if not isinstance(parents_raw, list):
            raise CanonicalJsonError("$.core.parentRevisions must be an array")
        parents: list[ParentRevisionV1] = []
        for index, raw_parent in enumerate(parents_raw):
            parent = _require_dict(raw_parent, path=f"$.core.parentRevisions[{index}]")
            require_exact_keys(
                parent,
                expected=("datasetId", "manifestSha256", "revisionId"),
                path=f"$.core.parentRevisions[{index}]",
            )
            parents.append(
                ParentRevisionV1(
                    dataset_id=_segment(parent["datasetId"], path="parent.datasetId"),
                    revision_id=_segment(parent["revisionId"], path="parent.revisionId"),
                    manifest_digest=_digest(parent["manifestSha256"], path="parent.manifestSha256"),
                )
            )
        partition = _parse_partition(core["partition"])
        try:
            manifest = cls(
                dataset_id=_segment(core["datasetId"], path="$.core.datasetId"),
                revision_id=_segment(core["revisionId"], path="$.core.revisionId"),
                revision_kind=RevisionKind(_require_str(core["revisionKind"], path="revisionKind")),
                published_at_ns=_require_decimal_int(
                    core["publishedAtNs"],
                    path="publishedAtNs",
                    minimum=UTC_NS_MIN,
                    maximum=UTC_NS_MAX,
                ),
                parent_revisions=tuple(parents),
                schema_id=_contract_id(core["schemaId"], path="schemaId"),
                schema_fingerprint=_digest(core["schemaFingerprint"], path="schemaFingerprint"),
                writer_profile_id=_contract_id(core["writerProfileId"], path="writerProfileId"),
                pyarrow_version=_contract_id(core["pyarrowVersion"], path="pyarrowVersion"),
                dependency_lock_digest=_digest(
                    core["dependencyLockSha256"], path="dependencyLockSha256"
                ),
                code_profile_digest=_digest(core["codeProfileSha256"], path="codeProfileSha256"),
                config_digest=_digest(core["configSha256"], path="configSha256"),
                producer_activity_id=_contract_id(
                    core["producerActivityId"], path="producerActivityId"
                ),
                truth_posture=EvidencePosture(
                    _require_str(core["truthPosture"], path="truthPosture")
                ),
                partition=partition,
            )
        except (ContractValueError, ValueError) as error:
            raise CanonicalJsonError(f"manifest contract violation: {error}") from error
        supplied_manifest_id = _digest(envelope["manifestId"], path="$.manifestId")
        if supplied_manifest_id != manifest.manifest_id:
            raise CanonicalJsonError("manifestId does not match canonical core")
        return manifest


def _parse_partition(raw: object) -> PartitionManifestEntryV1:
    partition = _require_dict(raw, path="$.core.partition")
    require_exact_keys(
        partition,
        expected=(
            "artifactSha256",
            "byteCount",
            "duplicateCount",
            "eventTimeMaxNs",
            "eventTimeMinNs",
            "expiresAtNs",
            "gapCount",
            "key",
            "lateCount",
            "parentArtifactSha256",
            "qualityCounts",
            "receiveTimeMaxNs",
            "receiveTimeMinNs",
            "relativePath",
            "retentionClass",
            "rowCount",
            "sourceSessions",
        ),
        path="$.core.partition",
    )
    key_raw = _require_dict(partition["key"], path="partition.key")
    require_exact_keys(
        key_raw,
        expected=(
            "eventKind",
            "product",
            "schemaVersion",
            "symbolShard",
            "utcDate",
            "venue",
        ),
        path="partition.key",
    )
    try:
        key = PartitionKeyV1(
            schema_version=_segment(key_raw["schemaVersion"], path="key.schemaVersion"),
            venue=_segment(key_raw["venue"], path="key.venue"),
            product=_segment(key_raw["product"], path="key.product"),
            event_kind=_segment(key_raw["eventKind"], path="key.eventKind"),
            utc_date=_require_str(key_raw["utcDate"], path="key.utcDate"),
            symbol_shard=_segment(key_raw["symbolShard"], path="key.symbolShard"),
        )
        sessions_raw = partition["sourceSessions"]
        if not isinstance(sessions_raw, list):
            raise CanonicalJsonError("sourceSessions must be an array")
        sessions = tuple(_contract_id(item, path="sourceSessions[]") for item in sessions_raw)
        quality_raw = _require_dict(partition["qualityCounts"], path="qualityCounts")
        require_exact_keys(
            quality_raw,
            expected=(state.value for state in QUALITY_STATE_ORDER),
            path="qualityCounts",
        )
        parent_hashes_raw = partition["parentArtifactSha256"]
        if not isinstance(parent_hashes_raw, list):
            raise CanonicalJsonError("parentArtifactSha256 must be an array")
        parent_hashes = tuple(
            _digest(item, path="parentArtifactSha256[]") for item in parent_hashes_raw
        )
        receive_min = _require_optional_str(partition["receiveTimeMinNs"], path="receiveTimeMinNs")
        receive_max = _require_optional_str(partition["receiveTimeMaxNs"], path="receiveTimeMaxNs")
        expires = _require_optional_str(partition["expiresAtNs"], path="expiresAtNs")
        return PartitionManifestEntryV1(
            key=key,
            relative_path=_require_str(partition["relativePath"], path="relativePath"),
            artifact_digest=_digest(partition["artifactSha256"], path="artifactSha256"),
            byte_count=_require_decimal_int(
                partition["byteCount"], path="byteCount", minimum=1, maximum=67_108_864
            ),
            row_count=_require_decimal_int(
                partition["rowCount"], path="rowCount", minimum=1, maximum=1_000_000
            ),
            event_time_min_ns=_require_decimal_int(
                partition["eventTimeMinNs"],
                path="eventTimeMinNs",
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            ),
            event_time_max_ns=_require_decimal_int(
                partition["eventTimeMaxNs"],
                path="eventTimeMaxNs",
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            ),
            receive_time_min_ns=(
                None
                if receive_min is None
                else _require_decimal_int(
                    receive_min,
                    path="receiveTimeMinNs",
                    minimum=UTC_NS_MIN,
                    maximum=UTC_NS_MAX,
                )
            ),
            receive_time_max_ns=(
                None
                if receive_max is None
                else _require_decimal_int(
                    receive_max,
                    path="receiveTimeMaxNs",
                    minimum=UTC_NS_MIN,
                    maximum=UTC_NS_MAX,
                )
            ),
            source_sessions=sessions,
            quality_counts=tuple(
                (
                    state,
                    _require_decimal_int(
                        quality_raw[state.value],
                        path=f"qualityCounts.{state.value}",
                        minimum=0,
                        maximum=1_000_000,
                    ),
                )
                for state in QUALITY_STATE_ORDER
            ),
            gap_count=_require_decimal_int(
                partition["gapCount"], path="gapCount", minimum=0, maximum=1_000_000
            ),
            duplicate_count=_require_decimal_int(
                partition["duplicateCount"],
                path="duplicateCount",
                minimum=0,
                maximum=1_000_000,
            ),
            late_count=_require_decimal_int(
                partition["lateCount"], path="lateCount", minimum=0, maximum=1_000_000
            ),
            parent_artifact_digests=parent_hashes,
            retention_class=RetentionClass(
                _require_str(partition["retentionClass"], path="retentionClass")
            ),
            expires_at_ns=(
                None
                if expires is None
                else _require_decimal_int(
                    expires,
                    path="expiresAtNs",
                    minimum=UTC_NS_MIN,
                    maximum=UTC_NS_MAX,
                )
            ),
        )
    except (ContractValueError, ValueError) as error:
        raise CanonicalJsonError(f"partition contract violation: {error}") from error


def sha256_digest(raw: bytes) -> DigestV1:
    return DigestV1(hashlib.sha256(raw).hexdigest())
