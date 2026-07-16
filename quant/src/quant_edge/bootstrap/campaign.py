"""Canonical evidence receipt for the explicitly executed Q03 real-sample campaign."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from urllib.parse import urlsplit

from quant_edge.bootstrap.coverage import ARCHIVE_GAP_COUNT_BASIS
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    TimestampUnit,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)
from quant_edge.lake.governance import SourceGateCode

MAX_CAMPAIGN_ROWS = 1_000_000
MAX_CAMPAIGN_BYTES = 67_108_864
_EXPECTED_ARCHIVE_FAILED_GATES = (
    SourceGateCode.STABLE_IDENTITY_MAPPING,
    SourceGateCode.RETENTION_PERMISSION,
)


def _strict_https_url(value: object, *, field: str) -> str:
    if not isinstance(value, str) or value != value.strip() or "\x00" in value:
        raise ContractValueError(f"{field} must be a trimmed URL")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "data.binance.vision"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/data/spot/daily/aggTrades/")
    ):
        raise ContractValueError(f"{field} must be an exact official Binance archive URL")
    return value


def _ordered_reason_codes(value: object, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, tuple) or not value:
        raise ContractValueError(f"{field} must be a non-empty immutable tuple")
    result = tuple(require_reason_code(item, field=field) for item in value)
    if result != tuple(sorted(set(result))):
        raise ContractValueError(f"{field} must be sorted and unique")
    return result


@dataclass(frozen=True, slots=True)
class RealSampleCampaignEvidenceV1:
    """Hashes and bounded measurements only; never raw or row-level market data."""

    archive_url: str
    sidecar_url: str
    source_card_digest: DigestV1
    source_review_failed_gates: tuple[SourceGateCode, ...]
    retrieved_at_ns: int
    archive_digest: DigestV1
    sidecar_digest: DigestV1
    member_digest: DigestV1
    official_checksum: DigestV1
    member_name: str
    archive_byte_count: int
    member_byte_count: int
    row_count: int
    first_source_time_ns: int
    last_source_time_ns: int
    raw_timestamp_unit: TimestampUnit
    invalid_row_count: int
    duplicate_row_count: int
    gap_count: int
    schema_fingerprint: DigestV1
    dependency_lock_digest: DigestV1
    code_profile_digest: DigestV1
    config_digest: DigestV1
    dataset_id: str
    revision_id: str
    partition_digest: DigestV1
    manifest_digest: DigestV1
    q02_schema_fingerprint: DigestV1
    validated_row_count: int
    deterministic_replay_count: int
    coverage_digest: DigestV1
    atlas_digest: DigestV1
    known_omissions: tuple[str, ...]

    def __post_init__(self) -> None:
        archive_url = _strict_https_url(self.archive_url, field="archive_url")
        sidecar_full_url = _strict_https_url(self.sidecar_url, field="sidecar_url")
        sidecar_url = _strict_https_url(
            sidecar_full_url.removesuffix(".CHECKSUM"), field="sidecar_url"
        )
        if self.sidecar_url != f"{sidecar_url}.CHECKSUM" or self.sidecar_url != (
            f"{archive_url}.CHECKSUM"
        ):
            raise ContractValueError("sidecar_url must be the archive URL plus .CHECKSUM")
        if not archive_url.endswith(".zip"):
            raise ContractValueError("archive_url must end in .zip")
        expected_member = archive_url.rsplit("/", 1)[-1].removesuffix(".zip") + ".csv"
        if self.member_name != expected_member:
            raise ContractValueError("member_name must be derived from the official archive URL")
        for field_name in (
            "source_card_digest",
            "archive_digest",
            "sidecar_digest",
            "member_digest",
            "official_checksum",
            "schema_fingerprint",
            "dependency_lock_digest",
            "code_profile_digest",
            "config_digest",
            "partition_digest",
            "manifest_digest",
            "q02_schema_fingerprint",
            "coverage_digest",
            "atlas_digest",
        ):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        if self.official_checksum != self.archive_digest:
            raise ContractValueError("official checksum and retrieved archive digest must agree")
        if self.source_review_failed_gates != _EXPECTED_ARCHIVE_FAILED_GATES:
            raise ContractValueError(
                "archive source review must fail exactly stable identity and retention permission"
            )
        require_strict_int(
            self.retrieved_at_ns,
            field="retrieved_at_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        for field_name in ("archive_byte_count", "member_byte_count"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=1,
                maximum=MAX_CAMPAIGN_BYTES,
            )
        require_strict_int(
            self.row_count,
            field="row_count",
            minimum=1,
            maximum=MAX_CAMPAIGN_ROWS,
        )
        for field_name in ("first_source_time_ns", "last_source_time_ns"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=UTC_NS_MIN,
                maximum=UTC_NS_MAX,
            )
        if self.first_source_time_ns > self.last_source_time_ns:
            raise ContractValueError("source time bounds are reversed")
        if not isinstance(self.raw_timestamp_unit, TimestampUnit):
            raise ContractValueError("raw_timestamp_unit must be explicit")
        for field_name in ("invalid_row_count", "duplicate_row_count", "gap_count"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=0,
                maximum=self.row_count,
            )
        require_contract_id(self.dataset_id, field="dataset_id")
        require_contract_id(self.revision_id, field="revision_id")
        if self.validated_row_count != self.row_count:
            raise ContractValueError("validated row count must equal imported row count")
        require_strict_int(
            self.deterministic_replay_count,
            field="deterministic_replay_count",
            minimum=2,
            maximum=16,
        )
        _ordered_reason_codes(self.known_omissions, field="known_omissions")

    def as_mapping(self) -> dict[str, object]:
        return {
            "archive": {
                "archiveByteCount": str(self.archive_byte_count),
                "archiveSha256": self.archive_digest.hexdigest,
                "archiveUrl": self.archive_url,
                "memberByteCount": str(self.member_byte_count),
                "memberName": self.member_name,
                "memberSha256": self.member_digest.hexdigest,
                "officialChecksumSha256": self.official_checksum.hexdigest,
                "retrievedAtNs": str(self.retrieved_at_ns),
                "sidecarSha256": self.sidecar_digest.hexdigest,
                "sidecarUrl": self.sidecar_url,
            },
            "authority": "RESEARCH_ONLY_NO_ADMISSION",
            "eventAtlasSha256": self.atlas_digest.hexdigest,
            "import": {
                "duplicateRowCount": str(self.duplicate_row_count),
                "firstSourceTimeNs": str(self.first_source_time_ns),
                "gapCount": str(self.gap_count),
                "gapCountBasis": ARCHIVE_GAP_COUNT_BASIS,
                "invalidRowCount": str(self.invalid_row_count),
                "lastSourceTimeNs": str(self.last_source_time_ns),
                "rawTimestampUnit": self.raw_timestamp_unit.value,
                "rowCount": str(self.row_count),
                "schemaFingerprintSha256": self.schema_fingerprint.hexdigest,
            },
            "knownOmissions": list(self.known_omissions),
            "lakeReplay": {
                "codeProfileSha256": self.code_profile_digest.hexdigest,
                "configSha256": self.config_digest.hexdigest,
                "datasetId": self.dataset_id,
                "dependencyLockSha256": self.dependency_lock_digest.hexdigest,
                "deterministicReplayCount": str(self.deterministic_replay_count),
                "manifestSha256": self.manifest_digest.hexdigest,
                "partitionSha256": self.partition_digest.hexdigest,
                "q02SchemaFingerprintSha256": self.q02_schema_fingerprint.hexdigest,
                "revisionId": self.revision_id,
                "temporaryLakeState": "COMMITTED_THEN_DISPOSABLE",
                "validatedRowCount": str(self.validated_row_count),
            },
            "license": {
                "archiveDataLicense": "NOT_EXPLICIT",
                "rawRedistribution": "UNKNOWN_REQUIRES_APPROVAL",
                "repositoryLicenseClaim": "MIT_IN_README_ONLY",
            },
            "rawExternalArtifactsCommitted": False,
            "rowLevelMarketDataCommitted": False,
            "schema": "Q03RealSampleCampaignEvidenceV1",
            "sourceCardSha256": self.source_card_digest.hexdigest,
            "sourceCoverageSha256": self.coverage_digest.hexdigest,
            "sourceReview": {
                "authorityPosture": "REVIEW_ONLY_NO_ADMISSION",
                "failedGateCodes": [gate.value for gate in self.source_review_failed_gates],
                "status": "INELIGIBLE",
            },
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


def render_campaign_markdown(evidence: RealSampleCampaignEvidenceV1) -> str:
    if not isinstance(evidence, RealSampleCampaignEvidenceV1):
        raise ContractValueError("evidence must be RealSampleCampaignEvidenceV1")
    return "\n".join(
        (
            "# Q03 real-sample campaign evidence",
            "",
            "Status: `RESEARCH_ONLY_NO_ADMISSION`",
            "",
            f"- Archive SHA-256: `{evidence.archive_digest.hexdigest}`",
            "- Official checksum matched: "
            f"`{evidence.official_checksum == evidence.archive_digest}`",
            f"- Imported and validated rows: `{evidence.row_count}`",
            f"- Source time ns: `{evidence.first_source_time_ns}..{evidence.last_source_time_ns}`",
            f"- Observed internal ID discontinuities: `{evidence.gap_count}`",
            f"- Q02 partition SHA-256: `{evidence.partition_digest.hexdigest}`",
            f"- Q02 manifest SHA-256: `{evidence.manifest_digest.hexdigest}`",
            f"- Deterministic replays: `{evidence.deterministic_replay_count}`",
            f"- EventAtlas SHA-256: `{evidence.atlas_digest.hexdigest}`",
            "- Raw external artifacts committed: `False`",
            "- Row-level market data committed: `False`",
            "- Real forward bridge coverage: `MISSING/BLOCKED`",
            "- Later outcomes and objective labels: `UNAVAILABLE`",
            "",
        )
    )
