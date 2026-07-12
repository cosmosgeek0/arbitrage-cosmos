from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.lake import manifest as manifest_module
from quant_edge.lake.contracts import (
    QUALITY_STATE_ORDER,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityFactsV1,
    QualityState,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    ResearchQualityAssessmentV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)
from quant_edge.lake.manifest import (
    MAX_MANIFEST_BYTES,
    DatasetRevisionManifestV1,
    ParentRevisionV1,
    PartitionManifestEntryV1,
    RetentionClass,
    RevisionKind,
    sha256_digest,
)

AS_OF_NS = 1_783_814_400_000_000_000


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _quality_counts(
    *,
    row_count: int = 1,
    state: QualityState = QualityState.SYNTHETIC,
) -> tuple[tuple[QualityState, int], ...]:
    return tuple((item, row_count if item is state else 0) for item in QUALITY_STATE_ORDER)


def _key() -> PartitionKeyV1:
    return PartitionKeyV1(
        schema_version="v1",
        venue="binance",
        product="spot",
        event_kind="trade",
        utc_date="2026-07-12",
        symbol_shard="BTCUSDT",
    )


def _entry(
    *,
    revision_id: str = "r1",
    retention_class: RetentionClass = RetentionClass.PRESERVE,
    expires_at_ns: int | None = None,
) -> PartitionManifestEntryV1:
    key = _key()
    return PartitionManifestEntryV1(
        key=key,
        relative_path=key.relative_partition_path(dataset_id="market", revision_id=revision_id),
        artifact_digest=_digest(f"artifact-{revision_id}"),
        byte_count=4_096,
        row_count=1,
        event_time_min_ns=AS_OF_NS - 2_000,
        event_time_max_ns=AS_OF_NS - 1_000,
        receive_time_min_ns=AS_OF_NS - 1_900,
        receive_time_max_ns=AS_OF_NS - 900,
        source_sessions=("session1",),
        quality_counts=_quality_counts(),
        gap_count=0,
        duplicate_count=0,
        late_count=0,
        parent_artifact_digests=(),
        retention_class=retention_class,
        expires_at_ns=expires_at_ns,
    )


def _parent(*, dataset_id: str = "market", revision_id: str = "r0") -> ParentRevisionV1:
    return ParentRevisionV1(
        dataset_id=dataset_id,
        revision_id=revision_id,
        manifest_digest=_digest(f"manifest-{dataset_id}-{revision_id}"),
    )


def _manifest(
    *,
    revision_id: str = "r1",
    revision_kind: RevisionKind = RevisionKind.INITIAL,
    retention_class: RetentionClass = RetentionClass.PRESERVE,
    expires_at_ns: int | None = None,
) -> DatasetRevisionManifestV1:
    parents = () if revision_kind is RevisionKind.INITIAL else (_parent(),)
    return DatasetRevisionManifestV1(
        dataset_id="market",
        revision_id=revision_id,
        revision_kind=revision_kind,
        published_at_ns=AS_OF_NS,
        parent_revisions=parents,
        schema_id="ReferenceMarketEvidenceRowV1",
        schema_fingerprint=_digest("schema"),
        writer_profile_id="q02.parquet.v1",
        pyarrow_version="25.0.0",
        dependency_lock_digest=_digest("lock"),
        code_profile_digest=_digest("code"),
        config_digest=_digest("config"),
        producer_activity_id="activity.q02",
        truth_posture=EvidencePosture.SYNTHETIC,
        partition=_entry(
            revision_id=revision_id,
            retention_class=retention_class,
            expires_at_ns=expires_at_ns,
        ),
    )


def _timestamp(ns: int) -> RawTimestampV1:
    return RawTimestampV1(
        raw=ns,
        unit=TimestampUnit.NANOSECOND,
        basis=TimestampBasis.DECLARED,
    )


def _row() -> ReferenceMarketEvidenceRowV1:
    quality = derive_quality(
        QualityFactsV1(
            available=True,
            synthetic=True,
            gap=False,
            stale=False,
            reconstructing=False,
            sampled=False,
            partial=False,
            complete_proven=False,
        )
    )
    return ReferenceMarketEvidenceRowV1(
        record_id="record1",
        source_id="public_source",
        source_endpoint="public_endpoint",
        venue="binance",
        product="spot",
        event_kind="trade",
        symbol="BTCUSDT",
        base_asset_id="BTC",
        quote_asset_id="USDT",
        instrument_version="v1",
        stream_id="stream1",
        event_time=_timestamp(AS_OF_NS - 2_000),
        trade_time=_timestamp(AS_OF_NS - 2_100),
        receive_wall_time=_timestamp(AS_OF_NS - 1_900),
        receive_monotonic_ns=10,
        normalization_time_ns=AS_OF_NS - 1_800,
        persistence_time_ns=AS_OF_NS - 1_700,
        session_id="session1",
        sequence_first=7,
        sequence_last=8,
        raw_payload_digest=_digest("payload"),
        posture=EvidencePosture.SYNTHETIC,
        duplicate=False,
        late=False,
        quality=quality,
        price=ExactScaledValueV1(123_450, 2, "USDT"),
        quantity=ExactScaledValueV1(25, 3, "BTC"),
    )


def _set_path(envelope: dict[str, object], path: tuple[str, ...], value: object) -> None:
    target = envelope
    for component in path[:-1]:
        target = cast(dict[str, object], target[component])
    target[path[-1]] = value


def _reject_path(
    path: tuple[str, ...],
    value: object,
    *,
    correction: bool = False,
) -> None:
    manifest = (
        _manifest(revision_id="r2", revision_kind=RevisionKind.CORRECTION)
        if correction
        else _manifest()
    )
    envelope = manifest.as_mapping()
    _set_path(envelope, path, value)
    with pytest.raises(CanonicalJsonError):
        DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))


def test_private_manifest_decoders_reject_unreachable_python_shapes() -> None:
    assert manifest_module._require_dict({"ok": 1}, path="value") == {"ok": 1}
    with pytest.raises(CanonicalJsonError, match="object"):
        manifest_module._require_dict([], path="value")
    with pytest.raises(CanonicalJsonError, match="object"):
        manifest_module._require_dict({1: "not-a-string-key"}, path="value")

    assert manifest_module._require_str("value", path="value") == "value"
    with pytest.raises(CanonicalJsonError, match="string"):
        manifest_module._require_str(1, path="value")
    assert manifest_module._require_optional_str(None, path="value") is None
    assert manifest_module._require_optional_str("value", path="value") == "value"
    with pytest.raises(CanonicalJsonError, match="string"):
        manifest_module._require_optional_str(False, path="value")


def test_private_decimal_decoder_covers_canonical_sign_and_range_rules() -> None:
    assert manifest_module._require_decimal_int("0", path="n", minimum=-1, maximum=1) == 0
    assert manifest_module._require_decimal_int("-1", path="n", minimum=-1, maximum=1) == -1
    assert manifest_module._require_decimal_int("1", path="n", minimum=-1, maximum=1) == 1
    for value in (1, "", "-", "-0", "-01", "-x", "01", "+1", "1.0", "x"):
        with pytest.raises(CanonicalJsonError):
            manifest_module._require_decimal_int(value, path="n", minimum=-1, maximum=1)
    for value in ("-2", "2"):
        with pytest.raises(CanonicalJsonError, match="outside"):
            manifest_module._require_decimal_int(value, path="n", minimum=-1, maximum=1)


def test_private_typed_decoders_translate_contract_errors_to_canonical_errors() -> None:
    expected = _digest("expected")
    assert manifest_module._digest(expected.hexdigest, path="digest") == expected
    assert manifest_module._segment("segment", path="segment") == "segment"
    assert manifest_module._contract_id("schema.v1", path="identifier") == "schema.v1"

    for value in (1, "g" * 64):
        with pytest.raises(CanonicalJsonError):
            manifest_module._digest(value, path="digest")
    for value in (1, "../escape"):
        with pytest.raises(CanonicalJsonError):
            manifest_module._segment(value, path="segment")
    for value in (1, ".", "bad/path"):
        with pytest.raises(CanonicalJsonError):
            manifest_module._contract_id(value, path="identifier")

    assert expected.to_bytes() == bytes.fromhex(expected.hexdigest)
    assert sha256_digest(b"payload") == DigestV1(hashlib.sha256(b"payload").hexdigest())
    with pytest.raises(ContractValueError, match="algorithm"):
        DigestV1(expected.hexdigest, algorithm="SHA512")
    with pytest.raises(ContractValueError, match="64 lowercase"):
        DigestV1("A" * 64)


def test_parent_revision_rejects_wrong_segments_and_digest_type() -> None:
    parent = _parent()
    for changes in (
        {"dataset_id": "../market"},
        {"revision_id": "."},
        {"manifest_digest": cast(DigestV1, "0" * 64)},
    ):
        with pytest.raises(ContractValueError):
            replace(parent, **changes)


def test_partition_entry_rejects_wrong_identity_bounds_and_receive_pairs() -> None:
    entry = _entry()
    for changes in (
        {"key": cast(PartitionKeyV1, object())},
        {"artifact_digest": cast(DigestV1, "0" * 64)},
        {"byte_count": False},
        {"byte_count": 0},
        {"byte_count": 67_108_865},
        {"row_count": False},
        {"row_count": 0},
        {"row_count": 1_000_001},
        {"event_time_min_ns": cast(int, "not-an-int")},
        {"event_time_min_ns": UTC_NS_MIN - 1},
        {"event_time_max_ns": UTC_NS_MAX + 1},
        {"event_time_min_ns": AS_OF_NS, "event_time_max_ns": AS_OF_NS - 1},
        {"receive_time_min_ns": None},
        {"receive_time_max_ns": None},
        {"receive_time_min_ns": cast(int, "not-an-int")},
        {"receive_time_min_ns": UTC_NS_MIN - 1},
        {"receive_time_max_ns": UTC_NS_MAX + 1},
        {"receive_time_min_ns": AS_OF_NS, "receive_time_max_ns": AS_OF_NS - 1},
    ):
        with pytest.raises(ContractValueError):
            replace(entry, **changes)


def test_partition_entry_rejects_hostile_sessions_quality_and_counters() -> None:
    entry = _entry()
    string_state_counts = tuple(
        (
            cast(QualityState, state.value if state is QualityState.COMPLETE else state),
            count,
        )
        for state, count in entry.quality_counts
    )
    wrong_order = list(entry.quality_counts)
    wrong_order[0], wrong_order[1] = wrong_order[1], wrong_order[0]
    negative_count = list(entry.quality_counts)
    negative_count[0] = (QualityState.COMPLETE, -1)
    boolean_count = list(entry.quality_counts)
    boolean_count[0] = (QualityState.COMPLETE, cast(int, True))
    wrong_sum = list(entry.quality_counts)
    synthetic_index = QUALITY_STATE_ORDER.index(QualityState.SYNTHETIC)
    wrong_sum[synthetic_index] = (QualityState.SYNTHETIC, 0)

    for changes in (
        {"source_sessions": ()},
        {"source_sessions": ("bad/path",)},
        {"source_sessions": cast(tuple[str, ...], (1,))},
        {"source_sessions": ("session2", "session1")},
        {"source_sessions": ("session1", "session1")},
        {"quality_counts": string_state_counts},
        {"quality_counts": tuple(wrong_order)},
        {"quality_counts": tuple(negative_count)},
        {"quality_counts": tuple(boolean_count)},
        {"quality_counts": tuple(wrong_sum)},
        {"gap_count": -1},
        {"gap_count": 2},
        {"duplicate_count": False},
        {"duplicate_count": 2},
        {"late_count": -1},
        {"late_count": 2},
    ):
        with pytest.raises(ContractValueError):
            replace(entry, **changes)


def test_partition_entry_rejects_hostile_parent_hashes_and_retention() -> None:
    entry = _entry()
    first, second = sorted((_digest("first"), _digest("second")), key=lambda item: item.hexdigest)
    for changes in (
        {"parent_artifact_digests": (cast(DigestV1, "0" * 64),)},
        {"parent_artifact_digests": (second, first)},
        {"parent_artifact_digests": (first, first)},
        {"retention_class": cast(RetentionClass, "PRESERVE")},
        {"expires_at_ns": cast(int, False)},
        {"expires_at_ns": UTC_NS_MIN - 1},
        {"expires_at_ns": UTC_NS_MAX + 1},
        {"expires_at_ns": AS_OF_NS},
    ):
        with pytest.raises(ContractValueError):
            replace(entry, **changes)


def test_dataset_manifest_rejects_hostile_top_level_contract_values() -> None:
    manifest = _manifest()
    for changes in (
        {"dataset_id": "../market"},
        {"revision_id": "."},
        {"revision_kind": cast(RevisionKind, "INITIAL")},
        {"published_at_ns": cast(int, False)},
        {"published_at_ns": UTC_NS_MIN - 1},
        {"published_at_ns": UTC_NS_MAX + 1},
        {"schema_id": "."},
        {"writer_profile_id": "."},
        {"pyarrow_version": "."},
        {"producer_activity_id": "."},
        {"schema_fingerprint": cast(DigestV1, "0" * 64)},
        {"dependency_lock_digest": cast(DigestV1, "0" * 64)},
        {"code_profile_digest": cast(DigestV1, "0" * 64)},
        {"config_digest": cast(DigestV1, "0" * 64)},
        {"truth_posture": cast(EvidencePosture, "REPLAY")},
        {"partition": cast(PartitionManifestEntryV1, object())},
        {"partition": replace(manifest.partition, relative_path="../escape.parquet")},
    ):
        with pytest.raises(ContractValueError):
            replace(manifest, **changes)


def test_dataset_manifest_rejects_hostile_parent_lineage() -> None:
    initial = _manifest()
    with pytest.raises(ContractValueError, match="INITIAL"):
        replace(initial, parent_revisions=(_parent(),))

    correction = _manifest(revision_id="r2", revision_kind=RevisionKind.CORRECTION)
    for parents in (
        (),
        (_parent(), _parent(revision_id="other")),
        (cast(ParentRevisionV1, object()),),
        (_parent(dataset_id="other"),),
        (_parent(revision_id="r2"),),
    ):
        with pytest.raises(ContractValueError):
            replace(correction, parent_revisions=parents)


def test_reference_row_residual_type_guards_and_missing_order_sentinels() -> None:
    row = _row()
    for changes in (
        {"event_time": cast(RawTimestampV1, object())},
        {"trade_time": cast(RawTimestampV1, object())},
        {"receive_wall_time": cast(RawTimestampV1, object())},
        {"posture": cast(EvidencePosture, "REPLAY")},
        {"quality": cast(ResearchQualityAssessmentV1, object())},
    ):
        with pytest.raises(ContractValueError):
            replace(row, **changes)

    missing = replace(
        row,
        trade_time=None,
        receive_wall_time=None,
        receive_monotonic_ns=None,
        sequence_first=None,
        sequence_last=None,
    )
    assert missing.canonical_order_key[1:3] == (1, 0)
    assert missing.canonical_order_key[5:7] == (1, 0)


def test_partition_key_rejects_parseable_but_noncanonical_compact_date() -> None:
    with pytest.raises(ContractValueError, match="canonical YYYY-MM-DD"):
        replace(_key(), utc_date="20260712")


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("schema",), "WrongManifestSchema"),
        (("schema",), 1),
        (("version",), True),
        (("version",), "1"),
        (("version",), 2),
        (("core",), []),
        (("core", "datasetId"), 1),
        (("core", "datasetId"), "../market"),
        (("core", "revisionId"), 1),
        (("core", "revisionId"), "."),
        (("core", "revisionKind"), 1),
        (("core", "revisionKind"), "DERIVATION"),
        (("core", "publishedAtNs"), 1),
        (("core", "publishedAtNs"), ""),
        (("core", "publishedAtNs"), "01"),
        (("core", "publishedAtNs"), "-0"),
        (("core", "publishedAtNs"), str(UTC_NS_MIN - 1)),
        (("core", "publishedAtNs"), str(UTC_NS_MAX + 1)),
        (("core", "schemaId"), 1),
        (("core", "schemaId"), "."),
        (("core", "writerProfileId"), 1),
        (("core", "writerProfileId"), "."),
        (("core", "pyarrowVersion"), 1),
        (("core", "pyarrowVersion"), "."),
        (("core", "producerActivityId"), 1),
        (("core", "producerActivityId"), "."),
        (("core", "schemaFingerprint"), 1),
        (("core", "schemaFingerprint"), "bad"),
        (("core", "dependencyLockSha256"), 1),
        (("core", "dependencyLockSha256"), "bad"),
        (("core", "codeProfileSha256"), 1),
        (("core", "codeProfileSha256"), "bad"),
        (("core", "configSha256"), 1),
        (("core", "configSha256"), "bad"),
        (("core", "truthPosture"), 1),
        (("core", "truthPosture"), "INVENTED"),
        (("core", "parentRevisions"), {}),
        (("core", "partition"), []),
        (("core", "partition", "key"), []),
        (("core", "partition", "key", "schemaVersion"), 1),
        (("core", "partition", "key", "schemaVersion"), "../v1"),
        (("core", "partition", "key", "utcDate"), 1),
        (("core", "partition", "key", "utcDate"), "20260712"),
        (("core", "partition", "relativePath"), 1),
        (("core", "partition", "relativePath"), "../escape.parquet"),
        (("core", "partition", "artifactSha256"), 1),
        (("core", "partition", "artifactSha256"), "bad"),
        (("core", "partition", "byteCount"), 1),
        (("core", "partition", "byteCount"), "0"),
        (("core", "partition", "byteCount"), "67108865"),
        (("core", "partition", "rowCount"), 1),
        (("core", "partition", "rowCount"), "0"),
        (("core", "partition", "rowCount"), "1000001"),
        (("core", "partition", "eventTimeMinNs"), 1),
        (("core", "partition", "eventTimeMinNs"), str(UTC_NS_MIN - 1)),
        (("core", "partition", "eventTimeMaxNs"), str(UTC_NS_MAX + 1)),
        (("core", "partition", "eventTimeMinNs"), str(AS_OF_NS)),
        (("core", "partition", "receiveTimeMinNs"), 1),
        (("core", "partition", "receiveTimeMinNs"), None),
        (("core", "partition", "receiveTimeMinNs"), "01"),
        (("core", "partition", "receiveTimeMinNs"), str(UTC_NS_MIN - 1)),
        (("core", "partition", "receiveTimeMaxNs"), 1),
        (("core", "partition", "receiveTimeMaxNs"), None),
        (("core", "partition", "receiveTimeMaxNs"), str(UTC_NS_MAX + 1)),
        (("core", "partition", "sourceSessions"), {}),
        (("core", "partition", "sourceSessions"), []),
        (("core", "partition", "sourceSessions"), [1]),
        (("core", "partition", "sourceSessions"), ["bad/path"]),
        (("core", "partition", "sourceSessions"), ["session2", "session1"]),
        (("core", "partition", "sourceSessions"), ["session1", "session1"]),
        (("core", "partition", "qualityCounts"), []),
        (("core", "partition", "qualityCounts", "COMPLETE"), 1),
        (("core", "partition", "qualityCounts", "COMPLETE"), "-1"),
        (("core", "partition", "qualityCounts", "COMPLETE"), "1"),
        (("core", "partition", "gapCount"), 1),
        (("core", "partition", "gapCount"), "-1"),
        (("core", "partition", "gapCount"), "2"),
        (("core", "partition", "duplicateCount"), "2"),
        (("core", "partition", "lateCount"), "2"),
        (("core", "partition", "parentArtifactSha256"), {}),
        (("core", "partition", "parentArtifactSha256"), [1]),
        (("core", "partition", "parentArtifactSha256"), ["bad"]),
        (("core", "partition", "retentionClass"), 1),
        (("core", "partition", "retentionClass"), "DELETE_ALWAYS"),
        (("core", "partition", "expiresAtNs"), 1),
        (("core", "partition", "expiresAtNs"), "01"),
        (("core", "partition", "expiresAtNs"), str(UTC_NS_MIN - 1)),
        (("core", "partition", "expiresAtNs"), str(AS_OF_NS)),
        (("manifestId",), 1),
        (("manifestId",), "bad"),
        (("manifestId",), "0" * 64),
    ],
)
def test_manifest_parser_rejects_hostile_json_values(
    path: tuple[str, ...],
    value: object,
) -> None:
    _reject_path(path, value)


def test_manifest_parser_rejects_hostile_parent_arrays_and_objects() -> None:
    manifest = _manifest(revision_id="r2", revision_kind=RevisionKind.CORRECTION)

    replacements: tuple[object, ...] = ([], "not-an-object", 1)
    for replacement in replacements:
        envelope = manifest.as_mapping()
        core = cast(dict[str, object], envelope["core"])
        parents = cast(list[object], core["parentRevisions"])
        parents[0] = replacement
        with pytest.raises(CanonicalJsonError):
            DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))

    for field, value in (
        ("datasetId", 1),
        ("datasetId", "../market"),
        ("revisionId", 1),
        ("revisionId", "."),
        ("manifestSha256", 1),
        ("manifestSha256", "bad"),
        ("datasetId", "other"),
        ("revisionId", "r2"),
    ):
        envelope = manifest.as_mapping()
        core = cast(dict[str, object], envelope["core"])
        parents = cast(list[object], core["parentRevisions"])
        parent = cast(dict[str, object], parents[0])
        parent[field] = value
        with pytest.raises(CanonicalJsonError):
            DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))

    for operation in ("missing", "extra"):
        envelope = manifest.as_mapping()
        core = cast(dict[str, object], envelope["core"])
        parents = cast(list[object], core["parentRevisions"])
        parent = cast(dict[str, object], parents[0])
        if operation == "missing":
            del parent["revisionId"]
        else:
            parent["unexpected"] = "value"
        with pytest.raises(CanonicalJsonError, match="key mismatch"):
            DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))


def test_manifest_parser_translates_partition_order_and_parent_hash_violations() -> None:
    base = _manifest()
    first, second = sorted((_digest("first"), _digest("second")), key=lambda item: item.hexdigest)
    for field, value in (
        ("eventTimeMaxNs", str(AS_OF_NS - 3_000)),
        ("receiveTimeMaxNs", str(AS_OF_NS - 2_000)),
        ("parentArtifactSha256", [second.hexdigest, first.hexdigest]),
        ("parentArtifactSha256", [first.hexdigest, first.hexdigest]),
    ):
        envelope = base.as_mapping()
        core = cast(dict[str, object], envelope["core"])
        partition = cast(dict[str, object], core["partition"])
        partition[field] = value
        with pytest.raises(CanonicalJsonError):
            DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))


def test_manifest_parser_accepts_null_receive_bounds_and_explicit_expiry() -> None:
    without_receive = _manifest()
    without_receive = replace(
        without_receive,
        partition=replace(
            without_receive.partition,
            receive_time_min_ns=None,
            receive_time_max_ns=None,
        ),
    )
    assert DatasetRevisionManifestV1.from_bytes(without_receive.to_bytes()) == without_receive

    expiring = _manifest(
        retention_class=RetentionClass.RAW_EXPIRABLE,
        expires_at_ns=AS_OF_NS + 1,
    )
    assert DatasetRevisionManifestV1.from_bytes(expiring.to_bytes()) == expiring


def test_manifest_parser_rejects_oversized_input_before_json_decode() -> None:
    with pytest.raises(CanonicalJsonError, match="maximum byte count"):
        DatasetRevisionManifestV1.from_bytes(b"x" * (MAX_MANIFEST_BYTES + 1))
