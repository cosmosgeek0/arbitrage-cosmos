#!/usr/bin/env python3
"""Execute the explicit Q03 real-sample campaign using caller-supplied local bytes.

Network acquisition remains an operator action outside this script and deterministic tests.
Outputs contain only hashes, counts, schemas and bounded derived registry evidence.
"""

from __future__ import annotations

import argparse
import hashlib
from datetime import UTC, datetime
from pathlib import Path

from quant_edge.bootstrap.archive import (
    ABSOLUTE_MAX_ARCHIVE_BYTES,
    ABSOLUTE_MAX_SIDECAR_BYTES,
    BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT,
    BinanceSpotAggTradesImportV1,
    BinanceSpotAggTradesProvenanceV1,
    import_binance_spot_daily_agg_trades,
)
from quant_edge.bootstrap.atlas import (
    HistoricalAtlasInputV1,
    build_event_atlas,
    render_event_atlas_markdown,
)
from quant_edge.bootstrap.bridge import FORWARD_CAPTURE_SCHEMA_FINGERPRINT
from quant_edge.bootstrap.campaign import (
    RealSampleCampaignEvidenceV1,
    render_campaign_markdown,
)
from quant_edge.bootstrap.coverage import (
    ArchiveDataLicensePosture,
    ArchiveReplacementStatus,
    CountEvidenceV1,
    CoverageAvailability,
    CoverageEntryV1,
    CoverageMatrixV1,
    RawRedistributionPosture,
    RepositoryLicensePosture,
    RetentionPosture,
    SourceLicenseEvidenceV1,
    SourceTimeRangeV1,
    render_coverage_matrix_markdown,
)
from quant_edge.bootstrap.fixtures import build_q03_forward_fixture_set
from quant_edge.bootstrap.sources import (
    BINANCE_ARCHIVE_SOURCE_ID,
    BINANCE_PUBLIC_DATA_README_SHA256,
    RUNTIME_CONTRACT_SHA256,
    TARDIS_REFERENCE_SOURCE_ID,
    TARDIS_TERMS_SHA256,
    materialize_q03_source_reviews,
)
from quant_edge.bootstrap.tardis import build_tardis_capability_interface
from quant_edge.canonical import canonical_json_bytes
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    PartitionKeyV1,
    TimestampBasis,
    TimestampUnit,
)
from quant_edge.lake.manifest import RetentionClass
from quant_edge.lake.parquet import (
    SCHEMA_FINGERPRINT,
    RevisionBuildSpecV1,
    build_partition_bundle,
    validate_partition_bundle,
)
from quant_edge.lake.store import ImmutableLakeStore, RevisionState

ARCHIVE_URL = (
    "https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip"
)
SIDECAR_URL = f"{ARCHIVE_URL}.CHECKSUM"
EXPECTED_ARCHIVE_SHA256 = "2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893"


def _sha256(raw: bytes) -> DigestV1:
    return DigestV1(hashlib.sha256(raw).hexdigest())


def _read_bounded(path: Path, maximum: int) -> bytes:
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise RuntimeError(f"input must be an absolute regular non-symlink file: {path}")
    if not 0 < path.stat().st_size <= maximum:
        raise RuntimeError(f"input size is outside the campaign bound: {path}")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    if not 0 < len(raw) <= maximum or len(raw) != path.stat().st_size:
        raise RuntimeError(f"input changed or exceeded its campaign bound: {path}")
    return raw


def _missing_count(availability: CoverageAvailability) -> CountEvidenceV1:
    return CountEvidenceV1(availability, None)


def _missing_entry(
    *,
    product: str,
    event_kind: str,
    utc_date: str,
    availability: CoverageAvailability,
    license_evidence: SourceLicenseEvidenceV1,
    omissions: tuple[str, ...],
) -> CoverageEntryV1:
    missing = _missing_count(availability)
    return CoverageEntryV1(
        venue="binance",
        product=product,
        event_kind=event_kind,
        utc_date=utc_date,
        availability=availability,
        source_url=None,
        checksum_url=None,
        retrieved_at_ms=None,
        official_checksum_sha256=None,
        sidecar_bytes_sha256=None,
        artifact_sha256=None,
        member_name=None,
        member_sha256=None,
        artifact_bytes=missing,
        member_bytes=missing,
        row_count=missing,
        schema_id=None,
        schema_fingerprint=None,
        source_time=SourceTimeRangeV1(availability, None, None, None, None),
        gap_count=missing,
        invalid_count=missing,
        duplicate_count=missing,
        replacement_status=ArchiveReplacementStatus.REPLACEMENT_STATUS_UNKNOWN,
        license=license_evidence,
        known_omissions=omissions,
    )


def _coverage_matrix(
    *,
    imported: BinanceSpotAggTradesImportV1,
    archive_byte_count: int,
    source_gap_count: int,
    evaluated_at_ms: int,
    source_research_sha256: str,
) -> CoverageMatrixV1:
    if not isinstance(imported, BinanceSpotAggTradesImportV1):
        raise TypeError("imported must be BinanceSpotAggTradesImportV1")
    archive_license = SourceLicenseEvidenceV1(
        RepositoryLicensePosture.MIT_IN_README_ONLY,
        ArchiveDataLicensePosture.NOT_EXPLICIT,
        RawRedistributionPosture.UNKNOWN_REQUIRES_APPROVAL,
        RetentionPosture.LOCAL_DERIVED_ONLY,
        tuple(sorted((BINANCE_PUBLIC_DATA_README_SHA256, source_research_sha256))),
    )
    runtime_license = SourceLicenseEvidenceV1(
        RepositoryLicensePosture.NOT_APPLICABLE,
        ArchiveDataLicensePosture.NOT_APPLICABLE,
        RawRedistributionPosture.NOT_APPLICABLE,
        RetentionPosture.UNKNOWN,
        (RUNTIME_CONTRACT_SHA256,),
    )
    tardis_license = SourceLicenseEvidenceV1(
        RepositoryLicensePosture.NOT_APPLICABLE,
        ArchiveDataLicensePosture.UNKNOWN,
        RawRedistributionPosture.PROHIBITED,
        RetentionPosture.INTERFACE_ONLY,
        (TARDIS_TERMS_SHA256,),
    )
    observed = CoverageEntryV1(
        venue="binance",
        product="spot",
        event_kind="aggTrades",
        utc_date="2017-11-06",
        availability=CoverageAvailability.OBSERVED,
        source_url=ARCHIVE_URL,
        checksum_url=SIDECAR_URL,
        retrieved_at_ms=evaluated_at_ms,
        official_checksum_sha256=imported.official_checksum.hexdigest,
        sidecar_bytes_sha256=imported.sidecar_digest.hexdigest,
        artifact_sha256=imported.archive_digest.hexdigest,
        member_name=imported.provenance.member_filename,
        member_sha256=imported.member_digest.hexdigest,
        artifact_bytes=CountEvidenceV1(CoverageAvailability.OBSERVED, archive_byte_count),
        member_bytes=CountEvidenceV1(CoverageAvailability.OBSERVED, imported.member_bytes),
        row_count=CountEvidenceV1(CoverageAvailability.OBSERVED, imported.row_count),
        schema_id="BinanceSpotDailyAggTradesCsvV1",
        schema_fingerprint=imported.schema_fingerprint.hexdigest,
        source_time=SourceTimeRangeV1(
            CoverageAvailability.OBSERVED,
            imported.provenance.timestamp_unit,
            TimestampBasis.DECLARED,
            imported.first_source_time.raw,
            imported.last_source_time.raw,
        ),
        gap_count=CountEvidenceV1(CoverageAvailability.OBSERVED, source_gap_count),
        invalid_count=CountEvidenceV1(CoverageAvailability.OBSERVED, 0),
        duplicate_count=CountEvidenceV1(CoverageAvailability.OBSERVED, 0),
        replacement_status=ArchiveReplacementStatus.OBSERVED_AT_RETRIEVAL,
        license=archive_license,
        known_omissions=(
            "ARCHIVE_BOUNDARY_COMPLETENESS_UNKNOWN",
            "ARCHIVE_COMPLETENESS_UNPROVEN",
            "BORROW_TRUTH_UNAVAILABLE",
            "CAUSAL_INTENT_UNAVAILABLE",
            "COMPLETE_L2_UNAVAILABLE",
            "COMPLETE_LIQUIDATION_FLOW_UNAVAILABLE",
            "LIVE_LATENCY_UNAVAILABLE",
            "LOCAL_RECEIVE_CLOCK_UNAVAILABLE",
            "POINT_IN_TIME_IDENTITY_INCOMPLETE",
            "QUEUE_POSITION_UNAVAILABLE",
        ),
    )
    as_of_date = datetime.fromtimestamp(evaluated_at_ms // 1_000, UTC).date().isoformat()
    missing_entries = (
        _missing_entry(
            product="spot",
            event_kind="bookTicker",
            utc_date=as_of_date,
            availability=CoverageAvailability.UNAVAILABLE,
            license_evidence=runtime_license,
            omissions=(
                "EXACT_DECIMAL_DELIVERY_MISSING",
                "PERSISTENCE_CLOCK_MISSING",
                "REAL_Q_DELIVERY_MISSING",
                "RECEIVE_MONOTONIC_CLOCK_MISSING",
                "RECEIVE_ORDINAL_MISSING",
            ),
        ),
        _missing_entry(
            product="usd_m_perpetual",
            event_kind="depthDelta",
            utc_date=as_of_date,
            availability=CoverageAvailability.UNAVAILABLE,
            license_evidence=runtime_license,
            omissions=(
                "EXACT_DECIMAL_DELIVERY_MISSING",
                "REAL_Q_DELIVERY_MISSING",
                "SEQUENCE_COMPLETE_CAPTURE_MISSING",
            ),
        ),
        _missing_entry(
            product="usd_m_perpetual",
            event_kind="tardisHistoricalL2",
            utc_date=as_of_date,
            availability=CoverageAvailability.UNAVAILABLE,
            license_evidence=tardis_license,
            omissions=(
                "LICENSE_ENTITLEMENT_MISSING",
                "RAW_REDISTRIBUTION_PROHIBITED",
                "SUBSCRIPTION_NOT_ACQUIRED",
            ),
        ),
    )
    return CoverageMatrixV1(
        matrix_revision="q03.source.coverage.v1",
        as_of_ms=evaluated_at_ms,
        entries=tuple(sorted((observed, *missing_entries), key=lambda item: item.capability_key)),
    )


def _code_profile(quant_root: Path) -> DigestV1:
    relative_paths = (
        "scripts/q03_real_sample.py",
        "src/quant_edge/bootstrap/archive.py",
        "src/quant_edge/bootstrap/atlas.py",
        "src/quant_edge/bootstrap/bridge.py",
        "src/quant_edge/bootstrap/campaign.py",
        "src/quant_edge/bootstrap/coverage.py",
        "src/quant_edge/bootstrap/fixtures.py",
        "src/quant_edge/bootstrap/sources.py",
        "src/quant_edge/bootstrap/tardis.py",
    )
    mapping = {
        path: hashlib.sha256((quant_root / path).read_bytes()).hexdigest()
        for path in relative_paths
    }
    return _sha256(canonical_json_bytes(mapping))


def _write_outputs(output_dir: Path, artifacts: dict[str, bytes]) -> bytes:
    if not output_dir.is_absolute() or output_dir.exists():
        raise RuntimeError("output directory must be a new absolute path")
    output_dir.mkdir(parents=True)
    index_entries: list[dict[str, object]] = []
    for name in sorted(artifacts):
        raw = artifacts[name]
        (output_dir / name).write_bytes(raw)
        index_entries.append(
            {"byteCount": str(len(raw)), "name": name, "sha256": _sha256(raw).hexdigest}
        )
    index = canonical_json_bytes(
        {
            "artifacts": index_entries,
            "rawExternalArtifactsIncluded": False,
            "schema": "Q03GeneratedArtifactIndexV1",
            "version": 1,
        }
    )
    (output_dir / "artifact_index.v1.json").write_bytes(index)
    return index


def execute(args: argparse.Namespace) -> bytes:
    quant_root = Path(__file__).resolve().parents[1]
    archive_path = Path(args.archive)
    checksum_path = Path(args.checksum)
    lake_root = Path(args.lake_root)
    output_dir = Path(args.output_dir)
    evaluated_at_ms = int(args.retrieved_at_ms)
    source_research_digest = _sha256(
        (quant_root / "docs" / "Q03_SOURCE_CONTRACT_REFRESH.md").read_bytes()
    )

    # This source review is deliberately materialized before archive bytes are read or imported.
    source_reviews = materialize_q03_source_reviews(
        evaluated_at_ms=evaluated_at_ms,
        source_research_sha256=source_research_digest.hexdigest,
    )
    archive_bytes = _read_bounded(archive_path, ABSOLUTE_MAX_ARCHIVE_BYTES)
    checksum_bytes = _read_bounded(checksum_path, ABSOLUTE_MAX_SIDECAR_BYTES)
    if _sha256(archive_bytes).hexdigest != EXPECTED_ARCHIVE_SHA256:
        raise RuntimeError("campaign archive differs from the selected Q03 sample")

    retrieved_at_ns = evaluated_at_ms * 1_000_000
    provenance = BinanceSpotAggTradesProvenanceV1(
        archive_url=ARCHIVE_URL,
        checksum_url=SIDECAR_URL,
        symbol="BNBUSDT",
        base_asset_id="UNKNOWN_BASE",
        quote_asset_id="UNKNOWN_QUOTE",
        utc_date="2017-11-06",
        timestamp_unit=TimestampUnit.MILLISECOND,
        retrieved_at_ns=retrieved_at_ns,
        normalization_time_ns=retrieved_at_ns + 1_000_000,
        persistence_time_ns=retrieved_at_ns + 2_000_000,
        instrument_version="binance.archive.symbol_only.v1",
    )
    imported = import_binance_spot_daily_agg_trades(
        archive_bytes,
        checksum_bytes,
        provenance,
    )
    source_gap_count = imported.discontinuity_count
    coverage = _coverage_matrix(
        imported=imported,
        archive_byte_count=len(archive_bytes),
        source_gap_count=source_gap_count,
        evaluated_at_ms=evaluated_at_ms,
        source_research_sha256=source_research_digest.hexdigest,
    )
    fixtures = build_q03_forward_fixture_set()
    dependency_lock_digest = _sha256((quant_root / "uv.lock").read_bytes())
    code_profile_digest = _code_profile(quant_root)
    config_digest = _sha256(
        canonical_json_bytes(
            {
                "archiveSourceCardSha256": next(
                    source.card.sha256
                    for source in source_reviews.sources
                    if source.card.source_id == BINANCE_ARCHIVE_SOURCE_ID
                ),
                "coverageSha256": coverage.sha256,
                "forwardFixtureSha256": fixtures.sha256.hexdigest,
                "provenance": {
                    "archiveUrl": provenance.archive_url,
                    "baseAssetId": provenance.base_asset_id,
                    "instrumentVersion": provenance.instrument_version,
                    "quoteAssetId": provenance.quote_asset_id,
                    "retrievedAtNs": str(provenance.retrieved_at_ns),
                    "timestampUnit": provenance.timestamp_unit.value,
                },
                "schema": "Q03RealSampleBuildConfigV1",
                "version": 1,
            }
        )
    )
    revision_id = f"r_{imported.archive_digest.hexdigest[:20]}"
    key = PartitionKeyV1(
        schema_version="v1",
        venue="binance",
        product="spot",
        event_kind="aggTrades",
        utc_date="2017-11-06",
        symbol_shard="BNBUSDT",
    )
    revision = RevisionBuildSpecV1(
        dataset_id="binance_spot_aggtrades",
        revision_id=revision_id,
        published_at_ns=retrieved_at_ns + 3_000_000,
        dependency_lock_digest=dependency_lock_digest,
        code_profile_digest=code_profile_digest,
        config_digest=config_digest,
        producer_activity_id="q03.archive-import.v1",
        truth_posture=EvidencePosture.REPLAY,
    )
    parents = tuple(
        sorted(
            (imported.archive_digest, imported.member_digest, imported.sidecar_digest),
            key=lambda digest: digest.hexdigest,
        )
    )
    expiry_ns = retrieved_at_ns + 7 * 86_400_000_000_000
    first_bundle = build_partition_bundle(
        imported.normalized_rows,
        key=key,
        revision=revision,
        retention_class=RetentionClass.RAW_EXPIRABLE,
        expires_at_ns=expiry_ns,
        parent_artifact_digests=parents,
    )
    second_bundle = build_partition_bundle(
        imported.normalized_rows,
        key=key,
        revision=revision,
        retention_class=RetentionClass.RAW_EXPIRABLE,
        expires_at_ns=expiry_ns,
        parent_artifact_digests=parents,
    )
    if first_bundle.partition_bytes != second_bundle.partition_bytes or (
        first_bundle.manifest_bytes != second_bundle.manifest_bytes
    ):
        raise RuntimeError("deterministic replay changed Q02 lake bytes")
    validate_partition_bundle(
        second_bundle.partition_bytes,
        second_bundle.manifest_bytes,
        expected_manifest_digest=second_bundle.expected_manifest_digest,
    )
    if not lake_root.is_absolute() or lake_root.exists():
        raise RuntimeError("lake root must be a new absolute path")
    lake_root.mkdir(parents=True)
    with ImmutableLakeStore(lake_root) as store:
        manifest_digest = store.publish(first_bundle)
        if (
            store.revision_state(
                revision.dataset_id,
                revision.revision_id,
                expected_manifest_digest=manifest_digest,
            )
            is not RevisionState.COMMITTED
        ):
            raise RuntimeError("temporary lake revision did not become COMMITTED")
        validated = store.read(
            revision.dataset_id,
            revision.revision_id,
            expected_manifest_digest=manifest_digest,
        )
    historical = HistoricalAtlasInputV1(
        rows=validated.rows,
        manifest_digest=manifest_digest,
        manifest_published_at_ns=validated.manifest.published_at_ns,
        coverage_digest=DigestV1(coverage.sha256),
        invalid_row_count=0,
        known_gap_count=source_gap_count,
        duplicate_row_count=0,
    )
    latest_visible_ns = max(
        validated.manifest.published_at_ns,
        max(row.normalization_time_ns for row in validated.rows),
        max(row.persistence_time_ns for row in validated.rows),
    )
    atlas_as_of_ms = max(
        evaluated_at_ms,
        (latest_visible_ns + 999_999) // 1_000_000,
    )
    atlas = build_event_atlas(
        revision="q03.event-atlas.v1",
        as_of_ms=atlas_as_of_ms,
        historical=historical,
        forward_coverage_digest=DigestV1(coverage.sha256),
        forward_fixture_digest=fixtures.sha256,
        forward_schema_digest=FORWARD_CAPTURE_SCHEMA_FINGERPRINT,
        max_candidates=256,
        max_controls=256,
    )
    archive_review = next(
        source
        for source in source_reviews.sources
        if source.card.source_id == BINANCE_ARCHIVE_SOURCE_ID
    )
    campaign = RealSampleCampaignEvidenceV1(
        archive_url=ARCHIVE_URL,
        sidecar_url=SIDECAR_URL,
        source_card_digest=DigestV1(archive_review.card.sha256),
        source_review_failed_gates=archive_review.review.failed_gate_codes,
        retrieved_at_ns=retrieved_at_ns,
        archive_digest=imported.archive_digest,
        sidecar_digest=imported.sidecar_digest,
        member_digest=imported.member_digest,
        official_checksum=imported.official_checksum,
        member_name=imported.provenance.member_filename,
        archive_byte_count=len(archive_bytes),
        member_byte_count=imported.member_bytes,
        row_count=imported.row_count,
        first_source_time_ns=imported.first_source_time.normalized_ns,
        last_source_time_ns=imported.last_source_time.normalized_ns,
        raw_timestamp_unit=provenance.timestamp_unit,
        invalid_row_count=0,
        duplicate_row_count=0,
        gap_count=source_gap_count,
        schema_fingerprint=BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT,
        dependency_lock_digest=dependency_lock_digest,
        code_profile_digest=code_profile_digest,
        config_digest=config_digest,
        dataset_id=revision.dataset_id,
        revision_id=revision.revision_id,
        partition_digest=first_bundle.manifest.partition.artifact_digest,
        manifest_digest=manifest_digest,
        q02_schema_fingerprint=SCHEMA_FINGERPRINT,
        validated_row_count=validated.row_count,
        deterministic_replay_count=2,
        coverage_digest=DigestV1(coverage.sha256),
        atlas_digest=DigestV1(atlas.sha256),
        known_omissions=(
            "ARCHIVE_BOUNDARY_COMPLETENESS_UNKNOWN",
            "ARCHIVE_COMPLETENESS_UNPROVEN",
            "BORROW_TRUTH_UNAVAILABLE",
            "CAUSAL_INTENT_UNAVAILABLE",
            "COMPLETE_L2_UNAVAILABLE",
            "COMPLETE_LIQUIDATION_FLOW_UNAVAILABLE",
            "LIVE_LATENCY_UNAVAILABLE",
            "LOCAL_RECEIVE_CLOCK_UNAVAILABLE",
            "QUEUE_POSITION_UNAVAILABLE",
        ),
    )
    artifacts = {
        "event_atlas.v1.json": atlas.canonical_bytes(),
        "event_atlas.v1.md": render_event_atlas_markdown(atlas).encode(),
        "forward_fixtures.v1.json": fixtures.canonical_bytes(),
        "real_sample_campaign.v1.json": campaign.canonical_bytes(),
        "real_sample_campaign.v1.md": render_campaign_markdown(campaign).encode(),
        "source_coverage.v1.json": coverage.canonical_bytes(),
        "source_coverage.v1.md": render_coverage_matrix_markdown(coverage).encode(),
        "source_reviews.v1.json": source_reviews.canonical_bytes(),
    }
    tardis_review = next(
        source
        for source in source_reviews.sources
        if source.card.source_id == TARDIS_REFERENCE_SOURCE_ID
    )
    tardis_interface = build_tardis_capability_interface(
        source_card_digest=DigestV1(tardis_review.card.sha256)
    )
    artifacts["tardis_capability.v1.json"] = tardis_interface.canonical_bytes()
    index = _write_outputs(output_dir, artifacts)
    return canonical_json_bytes(
        {
            "artifactIndexSha256": _sha256(index).hexdigest,
            "atlasSha256": atlas.sha256,
            "campaignSha256": campaign.sha256.hexdigest,
            "manifestSha256": manifest_digest.hexdigest,
            "partitionSha256": first_bundle.manifest.partition.artifact_digest.hexdigest,
            "rowCount": str(imported.row_count),
            "schema": "Q03RealSampleExecutionSummaryV1",
            "version": 1,
        }
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--checksum", required=True)
    parser.add_argument("--lake-root", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--retrieved-at-ms", required=True, type=int)
    args = parser.parse_args()
    print(execute(args).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
