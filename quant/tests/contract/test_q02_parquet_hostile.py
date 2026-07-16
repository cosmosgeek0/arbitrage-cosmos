from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]
import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake import manifest as manifest_module
from quant_edge.lake import parquet as subject
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityFactsV1,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)
from quant_edge.lake.manifest import ParentRevisionV1, sha256_digest
from quant_edge.lake.parquet import (
    LakeIntegrityError,
    PartitionBundleV1,
    RevisionBuildSpecV1,
    ValidatedEvidenceTableV1,
    build_partition_bundle,
    validate_partition_bundle,
)

pytestmark = pytest.mark.contract

BASE_NS = 1_783_814_400_000_000_000


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _timestamp(offset_ns: int = 0) -> RawTimestampV1:
    return RawTimestampV1(
        raw=BASE_NS + offset_ns,
        unit=TimestampUnit.NANOSECOND,
        basis=TimestampBasis.DECLARED,
    )


def _row(index: int = 0) -> ReferenceMarketEvidenceRowV1:
    return ReferenceMarketEvidenceRowV1(
        record_id=f"record_{index}",
        source_id="q02_fixture",
        source_endpoint="synthetic_replay",
        venue="BINANCE",
        product="SPOT",
        event_kind="TRADE",
        symbol="BTCUSDT",
        base_asset_id="BTC",
        quote_asset_id="USDT",
        instrument_version="v1",
        stream_id="stream_1",
        event_time=_timestamp(index),
        trade_time=None,
        receive_wall_time=_timestamp(100 + index),
        receive_monotonic_ns=1_000 + index,
        normalization_time_ns=BASE_NS + 1_000_000,
        persistence_time_ns=BASE_NS + 2_000_000,
        session_id="session_1",
        sequence_first=index,
        sequence_last=index,
        raw_payload_digest=_digest(f"payload-{index}"),
        posture=EvidencePosture.SYNTHETIC,
        duplicate=False,
        late=False,
        quality=derive_quality(
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
        ),
        price=ExactScaledValueV1(10_000 + index, 2, "USDT"),
        quantity=ExactScaledValueV1(1_000 + index, 3, "BTC"),
    )


def _key() -> PartitionKeyV1:
    return PartitionKeyV1(
        schema_version="v1",
        venue="BINANCE",
        product="SPOT",
        event_kind="TRADE",
        utc_date="2026-07-12",
        symbol_shard="BTCUSDT",
    )


def _revision() -> RevisionBuildSpecV1:
    return RevisionBuildSpecV1(
        dataset_id="q02_fixture",
        revision_id="revision_1",
        published_at_ns=BASE_NS + 3_000_000,
        dependency_lock_digest=_digest("dependency-lock"),
        code_profile_digest=_digest("code-profile"),
        config_digest=_digest("config-profile"),
        producer_activity_id="q02.hostile-test",
        truth_posture=EvidencePosture.SYNTHETIC,
    )


def _bundle(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...] | None = None,
) -> PartitionBundleV1:
    return build_partition_bundle(
        (_row(),) if rows is None else rows,
        key=_key(),
        revision=_revision(),
    )


def _table_from_mapping(mapping: dict[str, object]) -> pa.Table:
    return pa.Table.from_pylist([mapping])


@pytest.mark.parametrize(
    "changes",
    [
        {"dataset_id": "../escape"},
        {"revision_id": ".."},
        {"published_at_ns": True},
        {"dependency_lock_digest": "not-a-digest"},
        {"code_profile_digest": "not-a-digest"},
        {"config_digest": "not-a-digest"},
        {"producer_activity_id": "../activity"},
        {"truth_posture": "REPLAY"},
        {"parent_revision": "not-a-parent"},
    ],
)
def test_revision_build_spec_rejects_invalid_field_types(changes: dict[str, object]) -> None:
    with pytest.raises(ContractValueError):
        replace(_revision(), **changes)  # type: ignore[arg-type]


def test_revision_build_spec_rejects_cross_dataset_and_self_parents() -> None:
    cross_dataset = ParentRevisionV1("another_dataset", "revision_0", _digest("parent-1"))
    self_parent = ParentRevisionV1("q02_fixture", "revision_1", _digest("parent-2"))
    valid_parent = ParentRevisionV1("q02_fixture", "revision_0", _digest("parent-3"))

    with pytest.raises(ContractValueError, match="same dataset"):
        replace(_revision(), parent_revision=cross_dataset)
    with pytest.raises(ContractValueError, match="parent itself"):
        replace(_revision(), parent_revision=self_parent)
    assert replace(_revision(), parent_revision=valid_parent).parent_revision == valid_parent


def test_partition_bundle_digest_property_and_validator_only_token_resist_tampering() -> None:
    bundle = _bundle()
    assert bundle.expected_manifest_digest == sha256_digest(bundle.manifest_bytes)

    table = subject._table_from_rows((_row(),))
    with pytest.raises(ContractValueError, match="validator-only"):
        ValidatedEvidenceTableV1(table, bundle.manifest, (_row(),), _token=object())

    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    assert validated.manifest == bundle.manifest
    assert validated.rows == (_row(),)
    assert validated.row_count == 1
    assert validated._arrow_table_for_fixed_query().num_rows == 1
    object.__setattr__(
        validated,
        "_ValidatedEvidenceTableV1__token",
        object(),
    )
    with pytest.raises(LakeIntegrityError, match="token is invalid"):
        validated._arrow_table_for_fixed_query()


def test_validated_wrapper_is_immutable_and_seals_table_rows_and_manifest_slots() -> None:
    bundle = _bundle()

    table_tampered = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    forged_row = replace(_row(), record_id="forged_record")
    forged_table = subject._table_from_rows((forged_row,))
    with pytest.raises(ContractValueError, match="immutable"):
        table_tampered._ValidatedEvidenceTableV1__table = forged_table
    object.__setattr__(
        table_tampered,
        "_ValidatedEvidenceTableV1__table",
        forged_table,
    )
    with pytest.raises(LakeIntegrityError, match="seal is invalid"):
        table_tampered._arrow_table_for_fixed_query()

    rows_tampered = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    object.__setattr__(
        rows_tampered,
        "_ValidatedEvidenceTableV1__rows",
        (forged_row,),
    )
    with pytest.raises(LakeIntegrityError, match="seal is invalid"):
        _ = rows_tampered.rows

    manifest_tampered = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    other_manifest = _bundle((forged_row,)).manifest
    object.__setattr__(
        manifest_tampered,
        "_ValidatedEvidenceTableV1__manifest",
        other_manifest,
    )
    with pytest.raises(LakeIntegrityError, match="seal is invalid"):
        _ = manifest_tampered.manifest

    row_object_tampered = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    object.__setattr__(row_object_tampered.rows[0], "record_id", "forged_record")
    with pytest.raises(LakeIntegrityError, match="seal is invalid"):
        _ = row_object_tampered.row_count


def test_optional_scaled_value_maps_to_three_explicit_nulls() -> None:
    assert subject._scaled_fields(None) == (None, None, None)
    assert (
        subject._scaled_from_mapping(
            {
                "price_coefficient": None,
                "price_scale": None,
                "price_unit": None,
            },
            "price",
        )
        is None
    )


def test_row_set_rejects_empty_overbound_and_non_contract_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ContractValueError, match="zero-row"):
        subject._validate_rows((), _key())

    monkeypatch.setattr(subject, "MAX_PARTITION_ROWS", 1)
    with pytest.raises(ContractValueError, match="row count exceeds"):
        subject._validate_rows((_row(0), _row(1)), _key())

    with pytest.raises(ContractValueError, match="ReferenceMarketEvidenceRowV1"):
        subject._validate_rows(cast(Any, ("not-a-row",)), _key())


def test_row_set_rejects_duplicate_ids_and_duplicate_total_order_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    duplicate_id = replace(_row(1), record_id=_row(0).record_id)
    with pytest.raises(ContractValueError, match="duplicate record_id"):
        subject._validate_rows((_row(0), duplicate_id), _key())

    monkeypatch.setattr(
        ReferenceMarketEvidenceRowV1,
        "canonical_order_key",
        property(lambda _row: (BASE_NS, BASE_NS, "session", "stream", 0, "collision")),
    )
    with pytest.raises(ContractValueError, match="duplicate canonical order key"):
        subject._validate_rows((_row(0), _row(1)), _key())


def test_row_set_accepts_explicit_absence_of_optional_receive_timestamp() -> None:
    row = replace(_row(), receive_wall_time=None, receive_monotonic_ns=None)
    assert subject._validate_rows((row,), _key()) == (row,)


def test_builder_rejects_mutable_row_collections() -> None:
    with pytest.raises(ContractValueError, match="immutable tuple"):
        build_partition_bundle(
            [_row()],  # type: ignore[arg-type]
            key=_key(),
            revision=_revision(),
        )


@pytest.mark.parametrize(
    ("rows", "key", "message"),
    [
        ((replace(_row(), venue="COINBASE"),), _key(), "identity"),
        ((_row(),), replace(_key(), utc_date="2026-07-13"), "UTC date"),
    ],
)
def test_row_set_rejects_partition_mismatch(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...],
    key: PartitionKeyV1,
    message: str,
) -> None:
    with pytest.raises(ContractValueError, match=message):
        subject._validate_rows(rows, key)


def test_distinct_explicit_event_trade_and_receive_units_round_trip_exactly() -> None:
    row = replace(
        _row(),
        event_time=RawTimestampV1(
            raw=BASE_NS // 1_000,
            unit=TimestampUnit.MICROSECOND,
            basis=TimestampBasis.DECLARED,
        ),
        trade_time=RawTimestampV1(
            raw=BASE_NS // 1_000_000,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
        receive_wall_time=RawTimestampV1(
            raw=BASE_NS + 100,
            unit=TimestampUnit.NANOSECOND,
            basis=TimestampBasis.DECLARED,
        ),
    )
    bundle = _bundle((row,))
    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )

    assert validated.rows == (row,)
    restored = validated.rows[0]
    assert restored.event_time.raw == BASE_NS // 1_000
    assert restored.event_time.unit is TimestampUnit.MICROSECOND
    assert restored.trade_time is not None
    assert restored.trade_time.raw == BASE_NS // 1_000_000
    assert restored.trade_time.unit is TimestampUnit.MILLISECOND
    assert restored.receive_wall_time is not None
    assert restored.receive_wall_time.raw == BASE_NS + 100
    assert restored.receive_wall_time.unit is TimestampUnit.NANOSECOND


def test_same_semantic_timestamp_column_rejects_mixed_units_across_rows() -> None:
    millisecond_event = replace(
        _row(1),
        event_time=RawTimestampV1(
            raw=BASE_NS // 1_000_000,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
    )

    with pytest.raises(ContractValueError, match="partition columns: event_time"):
        subject._validate_rows((_row(0), millisecond_event), _key())


def test_canonical_colon_and_dotted_session_id_builds_and_validates_end_to_end() -> None:
    row = replace(_row(), session_id="session:alpha.v1")
    bundle = _bundle((row,))

    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )

    assert validated.rows == (row,)
    assert validated.manifest.partition.source_sessions == ("session:alpha.v1",)


def test_builder_rejects_unsupported_schema_and_truth_posture_mismatch() -> None:
    with pytest.raises(ContractValueError, match="schema version"):
        build_partition_bundle(
            (_row(),),
            key=replace(_key(), schema_version="v2"),
            revision=_revision(),
        )

    with pytest.raises(ContractValueError, match="truth posture"):
        build_partition_bundle(
            (_row(),),
            key=_key(),
            revision=replace(_revision(), truth_posture=EvidencePosture.LIVE),
        )


def test_table_builder_rejects_unpinned_pyarrow_and_schema_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pa, "__version__", "24.0.0")
    with pytest.raises(ContractValueError, match="does not match writer profile"):
        subject._table_from_rows((_row(),))
    monkeypatch.undo()

    class _DriftedSchema:
        def equals(self, _other: object, *, check_metadata: bool) -> bool:
            assert check_metadata is True
            return False

    class _DriftedTable:
        schema = _DriftedSchema()

        def combine_chunks(self) -> _DriftedTable:
            return self

    fake_pa = SimpleNamespace(
        __version__=subject.PYARROW_VERSION,
        Table=SimpleNamespace(from_pylist=lambda _rows, schema: _DriftedTable()),
    )
    monkeypatch.setattr(subject, "pa", fake_pa)
    with pytest.raises(LakeIntegrityError, match="frozen schema"):
        subject._table_from_rows((_row(),))


def test_writer_rejects_empty_and_overbound_encoded_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = subject._table_from_rows((_row(),))

    class _EmptyBuffer:
        def to_pybytes(self) -> bytes:
            return b""

    class _EmptySink:
        def getvalue(self) -> _EmptyBuffer:
            return _EmptyBuffer()

    monkeypatch.setattr(pa, "BufferOutputStream", _EmptySink)
    monkeypatch.setattr(pq, "write_table", lambda *_args, **_kwargs: None)
    with pytest.raises(ContractValueError, match="bounded byte contract"):
        subject._write_table(table)
    monkeypatch.undo()

    monkeypatch.setattr(subject, "MAX_PARTITION_BYTES", 1)
    with pytest.raises(ContractValueError, match="bounded byte contract"):
        subject._write_table(table)


@pytest.mark.parametrize(
    ("mapping", "prefix", "message"),
    [
        (
            {
                "event_time_raw": True,
                "event_time_unit": "NANOSECOND",
                "event_time_basis": "DECLARED",
                "event_time_ns": BASE_NS,
            },
            "event_time",
            "incoherent",
        ),
        (
            {
                "event_time_raw": BASE_NS,
                "event_time_unit": "SECOND",
                "event_time_basis": "DECLARED",
                "event_time_ns": BASE_NS,
            },
            "event_time",
            "invalid event_time timestamp",
        ),
        (
            {
                "event_time_raw": BASE_NS,
                "event_time_unit": "NANOSECOND",
                "event_time_basis": "DECLARED",
                "event_time_ns": BASE_NS + 1,
            },
            "event_time",
            "disagree",
        ),
    ],
)
def test_timestamp_decoder_rejects_incoherent_invalid_and_lossy_columns(
    mapping: dict[str, object],
    prefix: str,
    message: str,
) -> None:
    with pytest.raises(LakeIntegrityError, match=message):
        subject._timestamp_from_mapping(mapping, prefix)


@pytest.mark.parametrize(
    ("coefficient", "scale", "unit", "message"),
    [
        (1, 2, "USDT", "incoherent"),
        (Decimal("1.5"), 2, "USDT", "not integral"),
        (Decimal(1), 39, "USDT", "invalid price exact value"),
    ],
)
def test_scaled_decoder_rejects_incoherent_fractional_and_out_of_contract_values(
    coefficient: object,
    scale: object,
    unit: object,
    message: str,
) -> None:
    mapping = {
        "price_coefficient": coefficient,
        "price_scale": scale,
        "price_unit": unit,
    }
    with pytest.raises(LakeIntegrityError, match=message):
        subject._scaled_from_mapping(mapping, "price")


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("null-event", "event_time cannot be null"),
        ("utc-disagrees", "event_time_utc disagrees"),
        ("digest-type", "digest or quality reasons"),
        ("reasons-type", "digest or quality reasons"),
        ("row-contract", "decoded row violates contract"),
    ],
)
def test_mutated_arrow_values_fail_closed_before_becoming_evidence(
    mutation: str,
    message: str,
) -> None:
    mapping = subject._row_mapping(_row())
    if mutation == "null-event":
        for field in (
            "event_time_raw",
            "event_time_unit",
            "event_time_basis",
            "event_time_ns",
            "event_time_utc",
        ):
            mapping[field] = None
    elif mutation == "utc-disagrees":
        mapping["event_time_utc"] = BASE_NS + 1
    elif mutation == "digest-type":
        mapping["raw_payload_sha256"] = "not-bytes"
    elif mutation == "reasons-type":
        mapping["quality_reasons"] = "not-a-list"
    elif mutation == "row-contract":
        mapping["record_id"] = "../escape"
    else:
        raise AssertionError(f"unhandled mutation: {mutation}")

    with pytest.raises(LakeIntegrityError, match=message):
        subject._rows_from_table(_table_from_mapping(mapping))


def test_arrow_conversion_exception_is_wrapped_as_integrity_failure() -> None:
    class _BrokenTable:
        def __getitem__(self, _name: str) -> object:
            raise pa.ArrowInvalid("hostile decoded buffer")

    with pytest.raises(LakeIntegrityError, match="cannot be converted losslessly"):
        subject._rows_from_table(cast(Any, _BrokenTable()))


def _metadata_double(
    bundle: PartitionBundleV1,
) -> tuple[SimpleNamespace, SimpleNamespace, SimpleNamespace, list[SimpleNamespace]]:
    real_file = pq.ParquetFile(pa.BufferReader(bundle.partition_bytes))
    real_metadata = real_file.metadata
    assert real_metadata is not None
    real_group = real_metadata.row_group(0)
    columns = [
        SimpleNamespace(
            compression=real_group.column(index).compression,
            has_dictionary_page=real_group.column(index).has_dictionary_page,
            encodings=real_group.column(index).encodings,
            statistics=real_group.column(index).statistics,
        )
        for index in range(real_group.num_columns)
    ]
    group = SimpleNamespace(
        num_rows=real_group.num_rows,
        sorting_columns=real_group.sorting_columns,
        num_columns=real_group.num_columns,
        column=lambda index: columns[index],
    )
    metadata = SimpleNamespace(
        created_by=real_metadata.created_by,
        format_version=real_metadata.format_version,
        num_rows=real_metadata.num_rows,
        num_row_groups=real_metadata.num_row_groups,
        row_group=lambda _index: group,
    )
    parquet_file = SimpleNamespace(metadata=metadata, schema_arrow=real_file.schema_arrow)
    return parquet_file, metadata, group, columns


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("missing-metadata", "metadata is missing"),
        ("writer", "writer identity"),
        ("format", "format version"),
        ("rows", "row count"),
        ("group-count", "row-group count"),
        ("schema", "schema or metadata"),
        ("fingerprint", "schema fingerprint"),
        ("group-rows", "row-group layout"),
        ("sorting", "sorting declaration"),
        ("compression", "encoding profile"),
        ("dictionary", "encoding profile"),
        ("encoding", "unexpected Parquet encoding"),
        ("statistics", "statistics are missing"),
    ],
)
def test_parquet_metadata_profile_rejects_every_dishonest_declaration(
    mutation: str,
    message: str,
) -> None:
    bundle = _bundle()
    parquet_file, metadata, group, columns = _metadata_double(bundle)
    manifest = bundle.manifest

    if mutation == "missing-metadata":
        parquet_file.metadata = None
    elif mutation == "writer":
        metadata.created_by = "untrusted-writer"
    elif mutation == "format":
        metadata.format_version = "1.0"
    elif mutation == "rows":
        metadata.num_rows += 1
    elif mutation == "group-count":
        metadata.num_row_groups += 1
    elif mutation == "schema":
        parquet_file.schema_arrow = pa.schema([])
    elif mutation == "fingerprint":
        manifest = replace(manifest, schema_fingerprint=_digest("wrong-schema"))
    elif mutation == "group-rows":
        group.num_rows -= 1
    elif mutation == "sorting":
        group.sorting_columns = ()
    elif mutation == "compression":
        columns[0].compression = "GZIP"
    elif mutation == "dictionary":
        columns[0].has_dictionary_page = True
    elif mutation == "encoding":
        columns[0].encodings = (*columns[0].encodings, "DELTA_BINARY_PACKED")
    elif mutation == "statistics":
        columns[0].statistics = None
    else:
        raise AssertionError(f"unhandled mutation: {mutation}")

    with pytest.raises(LakeIntegrityError, match=message):
        subject._validate_parquet_metadata(cast(Any, parquet_file), manifest)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("writer_profile_id", "another_writer_profile"),
        ("pyarrow_version", "24.0.0"),
    ],
)
def test_validator_rejects_manifest_writer_profile_drift(field: str, value: str) -> None:
    bundle = _bundle()
    manifest = (
        replace(bundle.manifest, writer_profile_id=value)
        if field == "writer_profile_id"
        else replace(bundle.manifest, pyarrow_version=value)
    )
    manifest_bytes = manifest.to_bytes()

    with pytest.raises(LakeIntegrityError, match="writer profile mismatch"):
        validate_partition_bundle(
            bundle.partition_bytes,
            manifest_bytes,
            expected_manifest_digest=sha256_digest(manifest_bytes),
        )


def test_validator_rejects_manifest_size_and_external_hash_substitution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _bundle()
    with pytest.raises(ContractValueError, match="external expected manifest"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=cast(Any, "not-a-digest"),
        )
    with pytest.raises(LakeIntegrityError, match="manifest substitution"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=_digest("substituted-anchor"),
        )

    monkeypatch.setattr(manifest_module, "MAX_MANIFEST_BYTES", 1)
    with pytest.raises(LakeIntegrityError, match="manifest validation failed"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )


def test_validator_rejects_manifest_schema_byte_count_and_artifact_hash_drift() -> None:
    bundle = _bundle()
    schema_manifest = replace(bundle.manifest, schema_id="DifferentEvidenceSchemaV1")
    schema_bytes = schema_manifest.to_bytes()
    with pytest.raises(LakeIntegrityError, match="schema identity mismatch"):
        validate_partition_bundle(
            bundle.partition_bytes,
            schema_bytes,
            expected_manifest_digest=sha256_digest(schema_bytes),
        )

    count_partition = replace(
        bundle.manifest.partition,
        byte_count=bundle.manifest.partition.byte_count + 1,
    )
    count_manifest = replace(bundle.manifest, partition=count_partition)
    count_bytes = count_manifest.to_bytes()
    with pytest.raises(LakeIntegrityError, match="partition byte count mismatch"):
        validate_partition_bundle(
            bundle.partition_bytes,
            count_bytes,
            expected_manifest_digest=sha256_digest(count_bytes),
        )

    hash_partition = replace(
        bundle.manifest.partition,
        artifact_digest=_digest("substituted-artifact"),
    )
    hash_manifest = replace(bundle.manifest, partition=hash_partition)
    hash_bytes = hash_manifest.to_bytes()
    with pytest.raises(LakeIntegrityError, match="partition SHA-256 mismatch"):
        validate_partition_bundle(
            bundle.partition_bytes,
            hash_bytes,
            expected_manifest_digest=sha256_digest(hash_bytes),
        )


def test_validator_rejects_empty_and_overbound_partition_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _bundle()
    with pytest.raises(LakeIntegrityError, match="outside the bounded contract"):
        validate_partition_bundle(
            b"",
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )

    monkeypatch.setattr(subject, "MAX_PARTITION_BYTES", 1)
    with pytest.raises(LakeIntegrityError, match="outside the bounded contract"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )


def test_parquet_decoder_exception_is_wrapped_as_integrity_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _bundle()

    def _reject_decode(*_args: object, **_kwargs: object) -> object:
        raise pa.ArrowInvalid("hostile parquet footer")

    monkeypatch.setattr(pq, "ParquetFile", _reject_decode)
    with pytest.raises(LakeIntegrityError, match="decode or page-checksum validation"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )


def test_validator_rejects_invalid_decoded_row_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _bundle()
    monkeypatch.setattr(subject, "_rows_from_table", lambda _table: cast(Any, ("not-a-row",)))

    with pytest.raises(LakeIntegrityError, match="decoded row-set validation failed"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )


def test_validator_rejects_noncanonical_decoded_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = (_row(0), _row(1))
    bundle = _bundle(rows)
    canonical = tuple(sorted(rows, key=lambda row: row.canonical_order_key))
    monkeypatch.setattr(subject, "_rows_from_table", lambda _table: tuple(reversed(canonical)))

    with pytest.raises(LakeIntegrityError, match="canonical total order"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )


def _as_explicit_negative_live_row(
    row: ReferenceMarketEvidenceRowV1,
) -> ReferenceMarketEvidenceRowV1:
    live_quality = derive_quality(
        QualityFactsV1(
            available=True,
            synthetic=False,
            gap=False,
            stale=False,
            reconstructing=False,
            sampled=False,
            partial=False,
            complete_proven=True,
        )
    )
    return replace(row, posture=EvidencePosture.LIVE, quality=live_quality)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (_as_explicit_negative_live_row, "truth posture"),
        (
            lambda row: replace(row, session_id="other_session"),
            "bounds, quality or provenance",
        ),
    ],
)
def test_validator_rejects_decoded_posture_and_manifest_summary_mismatch(
    mutation: Callable[[ReferenceMarketEvidenceRowV1], ReferenceMarketEvidenceRowV1],
    message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _bundle()
    mutated_row = mutation(_row())
    monkeypatch.setattr(subject, "_rows_from_table", lambda _table: (mutated_row,))

    with pytest.raises(LakeIntegrityError, match=message):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )


@pytest.mark.parametrize(
    ("option", "value"),
    [
        ("write_page_checksum", False),
        ("write_page_index", True),
        ("data_page_version", "2.0"),
    ],
)
def test_validator_rejects_real_alternate_parquet_writer_profiles(
    option: str,
    value: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_write_table = pq.write_table

    def alternate_write_table(table: object, where: object, **kwargs: object) -> None:
        kwargs[option] = value
        real_write_table(table, where, **kwargs)

    with monkeypatch.context() as context:
        context.setattr(pq, "write_table", alternate_write_table)
        alternate_bundle = _bundle()

    with pytest.raises(LakeIntegrityError, match="exact frozen writer profile"):
        validate_partition_bundle(
            alternate_bundle.partition_bytes,
            alternate_bundle.manifest_bytes,
            expected_manifest_digest=alternate_bundle.expected_manifest_digest,
        )


def test_builder_rejects_a_manifest_exceeding_its_own_reader_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(subject, "MAX_MANIFEST_BYTES", 1)
    with pytest.raises(ContractValueError, match="manifest exceeds"):
        _bundle()


def test_bundle_and_validator_reject_mutable_artifact_buffers() -> None:
    bundle = _bundle()
    with pytest.raises(ContractValueError, match="immutable bytes"):
        PartitionBundleV1(
            bytearray(bundle.partition_bytes),  # type: ignore[arg-type]
            bundle.manifest_bytes,
            bundle.manifest,
        )
    with pytest.raises(ContractValueError, match="immutable bytes"):
        validate_partition_bundle(
            bytearray(bundle.partition_bytes),  # type: ignore[arg-type]
            bundle.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )
    with pytest.raises(ContractValueError, match="bundle manifest"):
        PartitionBundleV1(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            cast(Any, object()),
        )
