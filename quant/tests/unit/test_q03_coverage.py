from __future__ import annotations

import hashlib
from dataclasses import FrozenInstanceError, replace

import pytest

from quant_edge.bootstrap.coverage import (
    ARCHIVE_GAP_COUNT_BASIS,
    ArchiveDataLicensePosture,
    ArchiveReplacementStatus,
    CountEvidenceV1,
    CoverageAvailability,
    CoverageEntryV1,
    CoverageMatrixV1,
    RawRedistributionPosture,
    RepositoryLicensePosture,
    RetentionPosture,
    RevisionComparisonStatus,
    SourceLicenseEvidenceV1,
    SourceTimeRangeV1,
    archive_source_revision_sha256,
    compare_archive_revisions,
    render_coverage_matrix_markdown,
    verify_coverage_matrix_markdown,
)
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import TimestampBasis, TimestampUnit

AS_OF_MS = 1_783_814_400_000
SOURCE_URL = (
    "https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip"
)
CHECKSUM = "2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893"
README_SHA256 = "085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6"
OMISSIONS = tuple(
    sorted(
        (
            "BORROW_TRUTH_UNAVAILABLE",
            "CAUSAL_INTENT_UNAVAILABLE",
            "COMPLETE_LIQUIDATION_FLOW_UNAVAILABLE",
            "FULL_SEQUENCED_L2_UNAVAILABLE",
            "LIVE_LATENCY_UNAVAILABLE",
            "LOCAL_RECEIVE_CLOCK_UNAVAILABLE",
            "QUEUE_POSITION_UNAVAILABLE",
        )
    )
)


def _count(value: int) -> CountEvidenceV1:
    return CountEvidenceV1(CoverageAvailability.OBSERVED, value)


def _missing_count(state: CoverageAvailability) -> CountEvidenceV1:
    return CountEvidenceV1(state, None)


def _license() -> SourceLicenseEvidenceV1:
    return SourceLicenseEvidenceV1(
        repository_license=RepositoryLicensePosture.MIT_IN_README_ONLY,
        archive_data_license=ArchiveDataLicensePosture.NOT_EXPLICIT,
        raw_redistribution=RawRedistributionPosture.UNKNOWN_REQUIRES_APPROVAL,
        retention_posture=RetentionPosture.LOCAL_DERIVED_ONLY,
        evidence_sha256=(README_SHA256,),
    )


def _observed_entry() -> CoverageEntryV1:
    return CoverageEntryV1(
        venue="BINANCE",
        product="SPOT",
        event_kind="aggTrades",
        utc_date="2017-11-06",
        availability=CoverageAvailability.OBSERVED,
        source_url=SOURCE_URL,
        checksum_url=f"{SOURCE_URL}.CHECKSUM",
        retrieved_at_ms=AS_OF_MS,
        official_checksum_sha256=CHECKSUM,
        sidecar_bytes_sha256=hashlib.sha256(
            f"{CHECKSUM}  BNBUSDT-aggTrades-2017-11-06.zip\n".encode()
        ).hexdigest(),
        artifact_sha256=CHECKSUM,
        member_name="BNBUSDT-aggTrades-2017-11-06.csv",
        member_sha256="a" * 64,
        artifact_bytes=_count(12_440),
        member_bytes=_count(49_263),
        row_count=_count(832),
        schema_id="binance.spot.daily.aggTrades.csv.v1",
        schema_fingerprint="b" * 64,
        source_time=SourceTimeRangeV1(
            availability=CoverageAvailability.OBSERVED,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
            first_raw=1_509_940_463_590,
            last_raw=1_510_012_550_791,
        ),
        gap_count=_missing_count(CoverageAvailability.UNKNOWN),
        invalid_count=_count(0),
        duplicate_count=_count(0),
        replacement_status=ArchiveReplacementStatus.OBSERVED_AT_RETRIEVAL,
        license=_license(),
        known_omissions=OMISSIONS,
    )


def _missing_entry(
    state: CoverageAvailability,
    *,
    event_kind: str,
    source_url: str | None = None,
) -> CoverageEntryV1:
    missing = _missing_count(state)
    return CoverageEntryV1(
        venue="BINANCE",
        product="SPOT",
        event_kind=event_kind,
        utc_date="2017-11-06",
        availability=state,
        source_url=source_url,
        checksum_url=None if source_url is None else f"{source_url}.CHECKSUM",
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
        source_time=SourceTimeRangeV1(state, None, None, None, None),
        gap_count=missing,
        invalid_count=missing,
        duplicate_count=missing,
        replacement_status=ArchiveReplacementStatus.REPLACEMENT_STATUS_UNKNOWN,
        license=_license(),
        known_omissions=OMISSIONS,
    )


def _matrix() -> CoverageMatrixV1:
    entries = tuple(
        sorted(
            (
                _observed_entry(),
                _missing_entry(CoverageAvailability.UNKNOWN, event_kind="depth"),
                _missing_entry(CoverageAvailability.UNAVAILABLE, event_kind="liquidation"),
            ),
            key=lambda entry: entry.capability_key,
        )
    )
    return CoverageMatrixV1(
        matrix_revision="q03-source-coverage.2026-07-12.v1",
        as_of_ms=AS_OF_MS,
        entries=entries,
    )


def test_coverage_matrix_is_canonical_content_addressed_and_exactly_projected() -> None:
    matrix = _matrix()
    parsed = parse_canonical_object(matrix.canonical_bytes())
    markdown = render_coverage_matrix_markdown(matrix)

    assert parsed == matrix.as_mapping()
    assert matrix.sha256 == hashlib.sha256(matrix.canonical_bytes()).hexdigest()
    assert "UNKNOWN" in markdown
    assert "UNAVAILABLE" in markdown
    assert "MIT_IN_README_ONLY" in markdown
    assert "UNKNOWN_REQUIRES_APPROVAL" in markdown
    assert CHECKSUM in markdown
    assert str(_observed_entry().source_revision_sha256) in markdown
    assert "Observed internal ID discontinuities" in markdown
    verify_coverage_matrix_markdown(markdown, matrix)
    with pytest.raises(ContractValueError, match="differs"):
        verify_coverage_matrix_markdown(markdown + "manual claim\n", matrix)


def test_url_and_checksum_bind_an_immutable_source_revision() -> None:
    observed = _observed_entry()
    expected = archive_source_revision_sha256(
        source_url=SOURCE_URL,
        official_checksum_sha256=CHECKSUM,
    )
    assert observed.source_revision_sha256 == expected
    assert (
        compare_archive_revisions(observed, replace(observed))
        is RevisionComparisonStatus.SAME_IMMUTABLE_REVISION
    )

    changed_checksum = "f" * 64
    replacement = replace(
        observed,
        official_checksum_sha256=changed_checksum,
        artifact_sha256=changed_checksum,
        sidecar_bytes_sha256="e" * 64,
        replacement_status=ArchiveReplacementStatus.SUPERSEDED_BY_CHECKSUM_CHANGE,
    )
    assert replacement.source_revision_sha256 != observed.source_revision_sha256
    assert (
        compare_archive_revisions(observed, replacement)
        is RevisionComparisonStatus.NEW_IMMUTABLE_REVISION_REQUIRED
    )


@pytest.mark.parametrize("state", [CoverageAvailability.UNKNOWN, CoverageAvailability.UNAVAILABLE])
def test_missing_coverage_never_fabricates_zeroes_or_revision(
    state: CoverageAvailability,
) -> None:
    entry = _missing_entry(state, event_kind=f"missing_{state.value}", source_url=SOURCE_URL)
    assert entry.row_count.value is None
    assert entry.gap_count.value is None
    assert entry.invalid_count.value is None
    assert entry.duplicate_count.value is None
    assert entry.source_revision_sha256 is None
    assert entry.as_mapping()["sourceRevisionSha256"] is None


@pytest.mark.parametrize(
    ("availability", "value"),
    [
        (CoverageAvailability.OBSERVED, None),
        (CoverageAvailability.UNKNOWN, 0),
        (CoverageAvailability.UNAVAILABLE, 0),
        (CoverageAvailability.OBSERVED, -1),
        ("OBSERVED", 0),
    ],
)
def test_count_evidence_rejects_ambiguous_or_invalid_values(
    availability: object,
    value: int | None,
) -> None:
    with pytest.raises(ContractValueError):
        CountEvidenceV1(availability, value)  # type: ignore[arg-type]


def test_source_time_requires_complete_explicit_raw_semantics() -> None:
    for invalid in (
        SourceTimeRangeV1(CoverageAvailability.UNKNOWN, None, None, None, None),
        SourceTimeRangeV1(CoverageAvailability.UNAVAILABLE, None, None, None, None),
    ):
        assert invalid.first_raw is None
    with pytest.raises(ContractValueError, match="unit and basis"):
        SourceTimeRangeV1(CoverageAvailability.OBSERVED, None, None, 1, 2)
    with pytest.raises(ContractValueError, match="both raw bounds"):
        SourceTimeRangeV1(
            CoverageAvailability.OBSERVED,
            TimestampUnit.MILLISECOND,
            TimestampBasis.DECLARED,
            None,
            None,
        )
    with pytest.raises(ContractValueError, match="nondecreasing"):
        SourceTimeRangeV1(
            CoverageAvailability.OBSERVED,
            TimestampUnit.MILLISECOND,
            TimestampBasis.DECLARED,
            1_510_012_550_791,
            1_509_940_463_590,
        )
    with pytest.raises(ContractValueError, match="keep all facts null"):
        SourceTimeRangeV1(
            CoverageAvailability.UNKNOWN,
            TimestampUnit.MILLISECOND,
            None,
            None,
            None,
        )
    with pytest.raises(ContractValueError, match="CoverageAvailability"):
        SourceTimeRangeV1("UNKNOWN", None, None, None, None)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "mutation",
    [
        {"checksum_url": None},
        {"checksum_url": f"{SOURCE_URL}.sha256"},
        {"retrieved_at_ms": None},
        {"official_checksum_sha256": "f" * 64},
        {"member_name": "../member.csv"},
        {"row_count": CountEvidenceV1(CoverageAvailability.UNKNOWN, None)},
        {"source_time": SourceTimeRangeV1(CoverageAvailability.UNKNOWN, None, None, None, None)},
        {"replacement_status": ArchiveReplacementStatus.REPLACEMENT_STATUS_UNKNOWN},
        {"known_omissions": ()},
        {"known_omissions": ("DUPLICATE", "DUPLICATE")},
        {"known_omissions": ("not-controlled",)},
    ],
)
def test_observed_entry_rejects_incomplete_or_ambiguous_evidence(
    mutation: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(_observed_entry(), **mutation)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "mutation",
    [
        {"utc_date": 20171106},
        {"utc_date": "2017-99-99"},
        {"utc_date": "20171106"},
        {"availability": "OBSERVED"},
        {"artifact_bytes": object()},
        {"source_time": object()},
        {"replacement_status": "OBSERVED_AT_RETRIEVAL"},
        {"license": object()},
        {"source_url": None, "checksum_url": None},
    ],
)
def test_entry_rejects_untyped_contract_fields(mutation: dict[str, object]) -> None:
    with pytest.raises(ContractValueError):
        replace(_observed_entry(), **mutation)  # type: ignore[arg-type]


def test_missing_entry_must_preserve_one_explicit_missingness_state() -> None:
    unknown = _missing_entry(CoverageAvailability.UNKNOWN, event_kind="depth")
    with pytest.raises(ContractValueError, match="cannot carry observed"):
        replace(unknown, schema_id="fabricated.v1")
    with pytest.raises(ContractValueError, match="preserve the entry"):
        replace(unknown, row_count=_missing_count(CoverageAvailability.UNAVAILABLE))
    with pytest.raises(ContractValueError, match="source time"):
        replace(
            unknown,
            source_time=SourceTimeRangeV1(CoverageAvailability.UNAVAILABLE, None, None, None, None),
        )
    with pytest.raises(ContractValueError, match="replacement"):
        replace(unknown, replacement_status=ArchiveReplacementStatus.OBSERVED_AT_RETRIEVAL)


@pytest.mark.parametrize(
    "url",
    [
        "http://data.binance.vision/file.zip",
        "https://user:secret@data.binance.vision/file.zip",
        "https://data.binance.vision/file.zip?mutable=yes",
        "https://data.binance.vision/file.zip#fragment",
        "https://data.binance.vision/../file.zip",
        "https://data.binance.vision/file|bad.zip",
        " https://data.binance.vision/file.zip",
        "https://data.binance.vision/é.zip",
    ],
)
def test_archive_revision_identity_rejects_open_or_ambiguous_urls(url: str) -> None:
    with pytest.raises(ContractValueError):
        archive_source_revision_sha256(source_url=url, official_checksum_sha256=CHECKSUM)


def test_revision_comparison_rejects_noncomparable_or_missing_records() -> None:
    observed = _observed_entry()
    missing = _missing_entry(CoverageAvailability.UNKNOWN, event_kind="aggTrades")
    with pytest.raises(ContractValueError, match="requires CoverageEntryV1"):
        compare_archive_revisions(object(), observed)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="observed source URLs"):
        compare_archive_revisions(missing, missing)
    unresolved = _missing_entry(
        CoverageAvailability.UNKNOWN,
        event_kind="aggTrades",
        source_url=SOURCE_URL,
    )
    with pytest.raises(ContractValueError, match="official checksums"):
        compare_archive_revisions(unresolved, unresolved)
    other_url = SOURCE_URL.replace("BNBUSDT", "ETHUSDT")
    with pytest.raises(ContractValueError, match="same source URL"):
        compare_archive_revisions(
            observed,
            replace(observed, source_url=other_url, checksum_url=f"{other_url}.CHECKSUM"),
        )


def test_matrix_rejects_mutability_duplicates_order_and_wrong_members() -> None:
    observed = _observed_entry()
    unknown = _missing_entry(CoverageAvailability.UNKNOWN, event_kind="depth")
    invalid_entries: tuple[object, ...] = (
        [],
        (observed, observed),
        (unknown, observed),
        (observed, object()),
    )
    for entries in invalid_entries:
        with pytest.raises(ContractValueError):
            CoverageMatrixV1(
                matrix_revision="q03-source-coverage.v1",
                as_of_ms=AS_OF_MS,
                entries=entries,  # type: ignore[arg-type]
            )
    with pytest.raises(ContractValueError, match="matrix must"):
        render_coverage_matrix_markdown(object())  # type: ignore[arg-type]
    with pytest.raises(FrozenInstanceError):
        observed.venue = "OTHER"  # type: ignore[misc]


def test_matrix_as_of_cannot_precede_observed_retrieval() -> None:
    observed = _observed_entry()
    with pytest.raises(ContractValueError, match="retrieval time"):
        CoverageMatrixV1(
            matrix_revision="q03-source-coverage.future-retrieval.v1",
            as_of_ms=AS_OF_MS - 1,
            entries=(observed,),
        )

    missing = _missing_entry(CoverageAvailability.UNKNOWN, event_kind="depth")
    matrix = CoverageMatrixV1(
        matrix_revision="q03-source-coverage.missing-only.v1",
        as_of_ms=AS_OF_MS - 1,
        entries=(missing,),
    )
    assert matrix.as_of_ms == AS_OF_MS - 1

    corrupted = _observed_entry()
    object.__setattr__(corrupted, "retrieved_at_ms", None)
    with pytest.raises(ContractValueError, match="lost its retrieval time"):
        CoverageMatrixV1(
            matrix_revision="q03-source-coverage.corrupted-retrieval.v1",
            as_of_ms=AS_OF_MS,
            entries=(corrupted,),
        )


def test_observed_archive_gap_count_has_one_machine_readable_basis() -> None:
    observed = replace(_observed_entry(), gap_count=_count(0))
    assert observed.as_mapping()["gapCountBasis"] == ARCHIVE_GAP_COUNT_BASIS
    assert _observed_entry().as_mapping()["gapCountBasis"] is None, (
        "an unknown gap count cannot claim a measurement basis"
    )


def test_projection_fails_closed_if_validated_nested_time_is_corrupted() -> None:
    observed = _observed_entry()
    object.__setattr__(observed.source_time, "unit", None)
    matrix = CoverageMatrixV1(
        matrix_revision="q03-source-coverage.corruption-test.v1",
        as_of_ms=AS_OF_MS,
        entries=(observed,),
    )
    with pytest.raises(ContractValueError, match="lost its validated unit"):
        render_coverage_matrix_markdown(matrix)


@pytest.mark.parametrize(
    "mutation",
    [
        {"repository_license": "MIT_IN_README_ONLY"},
        {"archive_data_license": "NOT_EXPLICIT"},
        {"raw_redistribution": "UNKNOWN_REQUIRES_APPROVAL"},
        {"retention_posture": "LOCAL_DERIVED_ONLY"},
        {"evidence_sha256": ()},
        {"evidence_sha256": (README_SHA256, README_SHA256)},
        {"evidence_sha256": ("F" * 64,)},
    ],
)
def test_license_evidence_rejects_untyped_or_unanchored_claims(
    mutation: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(_license(), **mutation)  # type: ignore[arg-type]


def test_revision_identity_rejects_untyped_checksum() -> None:
    with pytest.raises(ContractValueError, match="SHA-256"):
        archive_source_revision_sha256(
            source_url=SOURCE_URL,
            official_checksum_sha256=1,  # type: ignore[arg-type]
        )
