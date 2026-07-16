from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final, cast

import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.lake.contracts import (
    QUALITY_STATE_ORDER,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityState,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    _restore_quality_assessment,
    require_contract_id,
    require_path_segment,
    require_strict_int,
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

PYARROW_VERSION: Final = "25.0.0"
SCHEMA_ID: Final = "ReferenceMarketEvidenceRowV1"
SCHEMA_VERSION: Final = "v1"
WRITER_PROFILE_ID: Final = "q02_parquet_plain_v1"
ROW_GROUP_SIZE: Final = 4_096
MAX_ROWS_PER_PAGE: Final = 1_024
WRITE_BATCH_SIZE: Final = 1_024
DATA_PAGE_SIZE: Final = 65_536
MAX_PARTITION_BYTES: Final = 67_108_864
MAX_PARTITION_ROWS: Final = 1_000_000


class LakeIntegrityError(QuantEdgeError):
    """Raised when immutable lake evidence fails validation."""


def _schema_metadata() -> dict[bytes, bytes]:
    values = {
        b"q.contract_id": SCHEMA_ID.encode(),
        b"q.numeric_registry": b"ExactScaledValueV1",
        b"q.quality_registry": b"ResearchQualityStateV1",
        b"q.schema_version": SCHEMA_VERSION.encode(),
        b"q.source_time_coverage": b"EVENT_TIMESTAMPED_ONLY",
        b"q.timestamp_contract": b"RawTimestampV1+normalized_ns+UTC",
        b"q.writer_profile": WRITER_PROFILE_ID.encode(),
    }
    return dict(sorted(values.items()))


REFERENCE_SCHEMA: Final = pa.schema(
    [
        pa.field("record_id", pa.string(), nullable=False),
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("source_endpoint", pa.string(), nullable=False),
        pa.field("venue", pa.string(), nullable=False),
        pa.field("product", pa.string(), nullable=False),
        pa.field("event_kind", pa.string(), nullable=False),
        pa.field("symbol", pa.string(), nullable=False),
        pa.field("base_asset_id", pa.string(), nullable=False),
        pa.field("quote_asset_id", pa.string(), nullable=False),
        pa.field("instrument_version", pa.string(), nullable=False),
        pa.field("stream_id", pa.string(), nullable=False),
        pa.field("event_time_raw", pa.int64(), nullable=False),
        pa.field("event_time_unit", pa.string(), nullable=False),
        pa.field("event_time_basis", pa.string(), nullable=False),
        pa.field("event_time_ns", pa.int64(), nullable=False),
        pa.field("event_time_utc", pa.timestamp("ns", tz="UTC"), nullable=False),
        pa.field("trade_time_raw", pa.int64(), nullable=True),
        pa.field("trade_time_unit", pa.string(), nullable=True),
        pa.field("trade_time_basis", pa.string(), nullable=True),
        pa.field("trade_time_ns", pa.int64(), nullable=True),
        pa.field("receive_wall_time_raw", pa.int64(), nullable=True),
        pa.field("receive_wall_time_unit", pa.string(), nullable=True),
        pa.field("receive_wall_time_basis", pa.string(), nullable=True),
        pa.field("receive_wall_time_ns", pa.int64(), nullable=True),
        pa.field("receive_monotonic_ns", pa.int64(), nullable=True),
        pa.field("normalization_time_ns", pa.int64(), nullable=False),
        pa.field("persistence_time_ns", pa.int64(), nullable=False),
        pa.field("session_id", pa.string(), nullable=False),
        pa.field("sequence_first", pa.uint64(), nullable=True),
        pa.field("sequence_last", pa.uint64(), nullable=True),
        pa.field("raw_payload_sha256", pa.binary(32), nullable=False),
        pa.field("posture", pa.string(), nullable=False),
        pa.field("duplicate", pa.bool_(), nullable=False),
        pa.field("late", pa.bool_(), nullable=False),
        pa.field("quality_state", pa.string(), nullable=False),
        pa.field(
            "quality_reasons",
            pa.list_(pa.field("element", pa.string(), nullable=False)),
            nullable=False,
        ),
        pa.field("price_coefficient", pa.decimal128(38, 0), nullable=True),
        pa.field("price_scale", pa.uint8(), nullable=True),
        pa.field("price_unit", pa.string(), nullable=True),
        pa.field("quantity_coefficient", pa.decimal128(38, 0), nullable=True),
        pa.field("quantity_scale", pa.uint8(), nullable=True),
        pa.field("quantity_unit", pa.string(), nullable=True),
    ],
    metadata=_schema_metadata(),
)

SCHEMA_FINGERPRINT: Final = DigestV1(
    hashlib.sha256(REFERENCE_SCHEMA.serialize().to_pybytes()).hexdigest()
)

SORT_ORDER: Final[tuple[tuple[str, str], ...]] = (
    ("event_time_ns", "ascending"),
    ("receive_wall_time_ns", "ascending"),
    ("session_id", "ascending"),
    ("stream_id", "ascending"),
    ("sequence_first", "ascending"),
    ("record_id", "ascending"),
)


@dataclass(frozen=True, slots=True)
class RevisionBuildSpecV1:
    dataset_id: str
    revision_id: str
    published_at_ns: int
    dependency_lock_digest: DigestV1
    code_profile_digest: DigestV1
    config_digest: DigestV1
    producer_activity_id: str
    truth_posture: EvidencePosture
    parent_revision: ParentRevisionV1 | None = None

    def __post_init__(self) -> None:
        require_path_segment(self.dataset_id, field="dataset_id")
        require_path_segment(self.revision_id, field="revision_id")
        require_strict_int(
            self.published_at_ns,
            field="published_at_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        for field_name in (
            "dependency_lock_digest",
            "code_profile_digest",
            "config_digest",
        ):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        require_contract_id(self.producer_activity_id, field="producer_activity_id")
        if not isinstance(self.truth_posture, EvidencePosture):
            raise ContractValueError("truth_posture must be EvidencePosture")
        if self.parent_revision is not None:
            if not isinstance(self.parent_revision, ParentRevisionV1):
                raise ContractValueError("parent_revision must be ParentRevisionV1 or null")
            if self.parent_revision.dataset_id != self.dataset_id:
                raise ContractValueError("parent revision must remain in the same dataset")
            if self.parent_revision.revision_id == self.revision_id:
                raise ContractValueError("revision cannot parent itself")


@dataclass(frozen=True, slots=True)
class PartitionBundleV1:
    partition_bytes: bytes
    manifest_bytes: bytes
    manifest: DatasetRevisionManifestV1

    def __post_init__(self) -> None:
        if type(self.partition_bytes) is not bytes or type(self.manifest_bytes) is not bytes:
            raise ContractValueError("partition and manifest artifacts must be immutable bytes")
        if not isinstance(self.manifest, DatasetRevisionManifestV1):
            raise ContractValueError("bundle manifest must be DatasetRevisionManifestV1")

    @property
    def expected_manifest_digest(self) -> DigestV1:
        return sha256_digest(self.manifest_bytes)


_VALIDATED_TOKEN: Final = object()


class ValidatedEvidenceTableV1:
    """Nominal result returned only after complete manifest and payload validation."""

    __slots__ = ("__manifest", "__rows", "__seal", "__table", "__token")
    __manifest: DatasetRevisionManifestV1
    __rows: tuple[ReferenceMarketEvidenceRowV1, ...]
    __seal: tuple[int, int, str, int, int]
    __table: pa.Table
    __token: object

    def __init__(
        self,
        table: pa.Table,
        manifest: DatasetRevisionManifestV1,
        rows: tuple[ReferenceMarketEvidenceRowV1, ...],
        *,
        _token: object,
    ) -> None:
        if _token is not _VALIDATED_TOKEN:
            raise ContractValueError("ValidatedEvidenceTableV1 is validator-only")
        object.__setattr__(self, "_ValidatedEvidenceTableV1__table", table)
        object.__setattr__(self, "_ValidatedEvidenceTableV1__manifest", manifest)
        object.__setattr__(self, "_ValidatedEvidenceTableV1__rows", rows)
        object.__setattr__(self, "_ValidatedEvidenceTableV1__token", _token)
        object.__setattr__(
            self,
            "_ValidatedEvidenceTableV1__seal",
            self._current_seal(),
        )

    def __setattr__(self, _name: str, _value: object) -> None:
        raise ContractValueError("validated evidence table is immutable")

    def _current_seal(self) -> tuple[int, int, str, int, int]:
        table = object.__getattribute__(self, "_ValidatedEvidenceTableV1__table")
        manifest = object.__getattribute__(self, "_ValidatedEvidenceTableV1__manifest")
        rows = object.__getattribute__(self, "_ValidatedEvidenceTableV1__rows")
        return (id(table), id(manifest), manifest.digest.hexdigest, id(rows), hash(rows))

    def _verify_seal(self) -> None:
        if (
            object.__getattribute__(self, "_ValidatedEvidenceTableV1__token")
            is not _VALIDATED_TOKEN
        ):
            raise LakeIntegrityError("validated table token is invalid")
        if (
            object.__getattribute__(
                self,
                "_ValidatedEvidenceTableV1__seal",
            )
            != self._current_seal()
        ):
            raise LakeIntegrityError("validated table seal is invalid")

    @property
    def manifest(self) -> DatasetRevisionManifestV1:
        self._verify_seal()
        return self.__manifest

    @property
    def rows(self) -> tuple[ReferenceMarketEvidenceRowV1, ...]:
        self._verify_seal()
        return self.__rows

    @property
    def row_count(self) -> int:
        self._verify_seal()
        return len(self.__rows)

    def _arrow_table_for_fixed_query(self) -> pa.Table:
        self._verify_seal()
        return self.__table


def _scaled_fields(
    value: ExactScaledValueV1 | None,
) -> tuple[Decimal | None, int | None, str | None]:
    if value is None:
        return None, None, None
    return Decimal(value.coefficient), value.scale, value.unit_id


def _row_mapping(row: ReferenceMarketEvidenceRowV1) -> dict[str, object]:
    price_coefficient, price_scale, price_unit = _scaled_fields(row.price)
    quantity_coefficient, quantity_scale, quantity_unit = _scaled_fields(row.quantity)
    trade = row.trade_time
    receive = row.receive_wall_time
    return {
        "base_asset_id": row.base_asset_id,
        "duplicate": row.duplicate,
        "event_kind": row.event_kind,
        "event_time_basis": row.event_time.basis.value,
        "event_time_ns": row.event_time.normalized_ns,
        "event_time_raw": row.event_time.raw,
        "event_time_unit": row.event_time.unit.value,
        "event_time_utc": row.event_time.normalized_ns,
        "instrument_version": row.instrument_version,
        "late": row.late,
        "normalization_time_ns": row.normalization_time_ns,
        "persistence_time_ns": row.persistence_time_ns,
        "posture": row.posture.value,
        "price_coefficient": price_coefficient,
        "price_scale": price_scale,
        "price_unit": price_unit,
        "product": row.product,
        "quality_reasons": list(row.quality.reason_codes),
        "quality_state": row.quality.state.value,
        "quantity_coefficient": quantity_coefficient,
        "quantity_scale": quantity_scale,
        "quantity_unit": quantity_unit,
        "quote_asset_id": row.quote_asset_id,
        "raw_payload_sha256": row.raw_payload_digest.to_bytes(),
        "receive_monotonic_ns": row.receive_monotonic_ns,
        "receive_wall_time_basis": None if receive is None else receive.basis.value,
        "receive_wall_time_ns": None if receive is None else receive.normalized_ns,
        "receive_wall_time_raw": None if receive is None else receive.raw,
        "receive_wall_time_unit": None if receive is None else receive.unit.value,
        "record_id": row.record_id,
        "sequence_first": row.sequence_first,
        "sequence_last": row.sequence_last,
        "session_id": row.session_id,
        "source_endpoint": row.source_endpoint,
        "source_id": row.source_id,
        "stream_id": row.stream_id,
        "symbol": row.symbol,
        "trade_time_basis": None if trade is None else trade.basis.value,
        "trade_time_ns": None if trade is None else trade.normalized_ns,
        "trade_time_raw": None if trade is None else trade.raw,
        "trade_time_unit": None if trade is None else trade.unit.value,
        "venue": row.venue,
    }


def _validate_rows(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...], key: PartitionKeyV1
) -> tuple[ReferenceMarketEvidenceRowV1, ...]:
    if not isinstance(rows, tuple):
        raise ContractValueError("rows must be an immutable tuple")
    if not rows:
        raise ContractValueError("a zero-row partition is unavailable, not complete evidence")
    if len(rows) > MAX_PARTITION_ROWS:
        raise ContractValueError("partition row count exceeds the bounded contract")
    if any(not isinstance(row, ReferenceMarketEvidenceRowV1) for row in rows):
        raise ContractValueError("rows must contain ReferenceMarketEvidenceRowV1")
    canonical = tuple(sorted(rows, key=lambda row: row.canonical_order_key))
    ids = tuple(row.record_id for row in canonical)
    if len(ids) != len(set(ids)):
        raise ContractValueError("duplicate record_id in partition")
    order_keys = tuple(row.canonical_order_key for row in canonical)
    if len(order_keys) != len(set(order_keys)):
        raise ContractValueError("duplicate canonical order key in partition")
    timestamp_units: dict[str, set[TimestampUnit]] = {
        "event_time": set(),
        "trade_time": set(),
        "receive_wall_time": set(),
    }
    for row in canonical:
        if (row.venue, row.product, row.event_kind) != (key.venue, key.product, key.event_kind):
            raise ContractValueError("row identity does not match partition key")
        event_date = datetime.fromtimestamp(row.event_time.normalized_ns // 1_000_000_000, UTC)
        if event_date.date().isoformat() != key.utc_date:
            raise ContractValueError("row event time does not match partition UTC date")
        timestamp_units["event_time"].add(row.event_time.unit)
        if row.trade_time is not None:
            timestamp_units["trade_time"].add(row.trade_time.unit)
        if row.receive_wall_time is not None:
            timestamp_units["receive_wall_time"].add(row.receive_wall_time.unit)
    mixed_fields = tuple(field for field, units in timestamp_units.items() if len(units) > 1)
    if mixed_fields:
        raise ContractValueError(
            f"mixed raw timestamp units within partition columns: {', '.join(mixed_fields)}"
        )
    return canonical


def _table_from_rows(rows: tuple[ReferenceMarketEvidenceRowV1, ...]) -> pa.Table:
    if pa.__version__ != PYARROW_VERSION:
        raise ContractValueError(
            f"PyArrow {pa.__version__} does not match writer profile {PYARROW_VERSION}"
        )
    table = pa.Table.from_pylist([_row_mapping(row) for row in rows], schema=REFERENCE_SCHEMA)
    table = table.combine_chunks()
    if not table.schema.equals(REFERENCE_SCHEMA, check_metadata=True):
        raise LakeIntegrityError("constructed Arrow schema does not match the frozen schema")
    return table


def _write_table(table: pa.Table) -> bytes:
    sorting_columns = pq.SortingColumn.from_ordering(
        REFERENCE_SCHEMA,
        list(SORT_ORDER),
        null_placement="at_end",
    )
    sink = pa.BufferOutputStream()
    pq.write_table(
        table,
        sink,
        row_group_size=ROW_GROUP_SIZE,
        version="2.6",
        use_dictionary=False,
        compression="NONE",
        write_statistics=True,
        use_deprecated_int96_timestamps=False,
        coerce_timestamps=None,
        allow_truncated_timestamps=False,
        data_page_size=DATA_PAGE_SIZE,
        flavor=None,
        filesystem=None,
        compression_level=None,
        use_byte_stream_split=False,
        column_encoding="PLAIN",
        data_page_version="1.0",
        use_compliant_nested_type=True,
        encryption_properties=None,
        write_batch_size=WRITE_BATCH_SIZE,
        dictionary_pagesize_limit=1_048_576,
        store_schema=True,
        write_page_index=False,
        write_page_checksum=True,
        sorting_columns=sorting_columns,
        store_decimal_as_integer=False,
        write_time_adjusted_to_utc=False,
        max_rows_per_page=MAX_ROWS_PER_PAGE,
        bloom_filter_options=None,
        use_content_defined_chunking=False,
    )
    result = cast(bytes, sink.getvalue().to_pybytes())
    if not result or len(result) > MAX_PARTITION_BYTES:
        raise ContractValueError("encoded partition exceeds the bounded byte contract")
    return result


def build_partition_bundle(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...],
    *,
    key: PartitionKeyV1,
    revision: RevisionBuildSpecV1,
    retention_class: RetentionClass = RetentionClass.PRESERVE,
    expires_at_ns: int | None = None,
    parent_artifact_digests: tuple[DigestV1, ...] = (),
) -> PartitionBundleV1:
    if key.schema_version != SCHEMA_VERSION:
        raise ContractValueError("partition key schema version is unsupported")
    canonical_rows = _validate_rows(rows, key)
    if any(row.posture is not revision.truth_posture for row in canonical_rows):
        raise ContractValueError("row posture does not match revision truth posture")
    table = _table_from_rows(canonical_rows)
    partition_bytes = _write_table(table)
    artifact_digest = sha256_digest(partition_bytes)
    receive_times = [
        row.receive_wall_time.normalized_ns
        for row in canonical_rows
        if row.receive_wall_time is not None
    ]
    quality_by_state = {
        state: sum(row.quality.state is state for row in canonical_rows)
        for state in QUALITY_STATE_ORDER
    }
    entry = PartitionManifestEntryV1(
        key=key,
        relative_path=key.relative_partition_path(
            dataset_id=revision.dataset_id,
            revision_id=revision.revision_id,
        ),
        artifact_digest=artifact_digest,
        byte_count=len(partition_bytes),
        row_count=len(canonical_rows),
        event_time_min_ns=min(row.event_time.normalized_ns for row in canonical_rows),
        event_time_max_ns=max(row.event_time.normalized_ns for row in canonical_rows),
        receive_time_min_ns=min(receive_times) if receive_times else None,
        receive_time_max_ns=max(receive_times) if receive_times else None,
        source_sessions=tuple(sorted({row.session_id for row in canonical_rows})),
        quality_counts=tuple((state, quality_by_state[state]) for state in QUALITY_STATE_ORDER),
        gap_count=sum("KNOWN_GAP" in row.quality.reason_codes for row in canonical_rows),
        duplicate_count=sum(row.duplicate for row in canonical_rows),
        late_count=sum(row.late for row in canonical_rows),
        parent_artifact_digests=parent_artifact_digests,
        retention_class=retention_class,
        expires_at_ns=expires_at_ns,
    )
    parent_revisions = () if revision.parent_revision is None else (revision.parent_revision,)
    manifest = DatasetRevisionManifestV1(
        dataset_id=revision.dataset_id,
        revision_id=revision.revision_id,
        revision_kind=(
            RevisionKind.INITIAL if revision.parent_revision is None else RevisionKind.CORRECTION
        ),
        published_at_ns=revision.published_at_ns,
        parent_revisions=parent_revisions,
        schema_id=SCHEMA_ID,
        schema_fingerprint=SCHEMA_FINGERPRINT,
        writer_profile_id=WRITER_PROFILE_ID,
        pyarrow_version=PYARROW_VERSION,
        dependency_lock_digest=revision.dependency_lock_digest,
        code_profile_digest=revision.code_profile_digest,
        config_digest=revision.config_digest,
        producer_activity_id=revision.producer_activity_id,
        truth_posture=revision.truth_posture,
        partition=entry,
    )
    manifest_bytes = manifest.to_bytes()
    if len(manifest_bytes) > MAX_MANIFEST_BYTES:
        raise ContractValueError("built manifest exceeds the bounded byte contract")
    return PartitionBundleV1(
        partition_bytes=partition_bytes,
        manifest_bytes=manifest_bytes,
        manifest=manifest,
    )


def _timestamp_from_mapping(mapping: dict[str, object], prefix: str) -> RawTimestampV1 | None:
    raw = mapping[f"{prefix}_raw"]
    unit = mapping[f"{prefix}_unit"]
    basis = mapping[f"{prefix}_basis"]
    normalized = mapping[f"{prefix}_ns"]
    if raw is None and unit is None and basis is None and normalized is None:
        return None
    if (
        isinstance(raw, bool)
        or not isinstance(raw, int)
        or not isinstance(unit, str)
        or not isinstance(basis, str)
        or isinstance(normalized, bool)
        or not isinstance(normalized, int)
    ):
        raise LakeIntegrityError(f"{prefix} timestamp columns are incoherent")
    try:
        timestamp = RawTimestampV1(
            raw=raw,
            unit=TimestampUnit(unit),
            basis=TimestampBasis(basis),
        )
    except (ContractValueError, ValueError) as error:
        raise LakeIntegrityError(f"invalid {prefix} timestamp: {error}") from error
    if timestamp.normalized_ns != normalized:
        raise LakeIntegrityError(f"{prefix} raw and normalized timestamps disagree")
    return timestamp


def _scaled_from_mapping(mapping: dict[str, object], prefix: str) -> ExactScaledValueV1 | None:
    coefficient = mapping[f"{prefix}_coefficient"]
    scale = mapping[f"{prefix}_scale"]
    unit = mapping[f"{prefix}_unit"]
    if coefficient is None and scale is None and unit is None:
        return None
    if (
        not isinstance(coefficient, Decimal)
        or not isinstance(scale, int)
        or not isinstance(unit, str)
    ):
        raise LakeIntegrityError(f"{prefix} exact-value columns are incoherent")
    if coefficient != coefficient.to_integral_value():
        raise LakeIntegrityError(f"{prefix} coefficient is not integral")
    try:
        return ExactScaledValueV1(int(coefficient), scale, unit)
    except ContractValueError as error:
        raise LakeIntegrityError(f"invalid {prefix} exact value: {error}") from error


def _rows_from_table(table: pa.Table) -> tuple[ReferenceMarketEvidenceRowV1, ...]:
    try:
        utc_values = cast(list[int], table["event_time_utc"].cast(pa.int64()).to_pylist())
        mappings = cast(
            list[dict[str, object]],
            table.drop(["event_time_utc"]).to_pylist(),
        )
    except (pa.ArrowException, ValueError) as error:
        raise LakeIntegrityError("decoded Arrow values cannot be converted losslessly") from error
    rows: list[ReferenceMarketEvidenceRowV1] = []
    for index, mapping in enumerate(mappings):
        event_time = _timestamp_from_mapping(mapping, "event_time")
        if event_time is None:
            raise LakeIntegrityError("event_time cannot be null")
        if index >= len(utc_values) or utc_values[index] != event_time.normalized_ns:
            raise LakeIntegrityError("event_time_utc disagrees with event_time_ns")
        raw_digest = mapping["raw_payload_sha256"]
        reasons = mapping["quality_reasons"]
        if not isinstance(raw_digest, bytes) or not isinstance(reasons, list):
            raise LakeIntegrityError("digest or quality reasons have invalid decoded types")
        try:
            quality = _restore_quality_assessment(
                QualityState(cast(str, mapping["quality_state"])),
                tuple(cast(list[str], reasons)),
            )
            row = ReferenceMarketEvidenceRowV1(
                record_id=cast(str, mapping["record_id"]),
                source_id=cast(str, mapping["source_id"]),
                source_endpoint=cast(str, mapping["source_endpoint"]),
                venue=cast(str, mapping["venue"]),
                product=cast(str, mapping["product"]),
                event_kind=cast(str, mapping["event_kind"]),
                symbol=cast(str, mapping["symbol"]),
                base_asset_id=cast(str, mapping["base_asset_id"]),
                quote_asset_id=cast(str, mapping["quote_asset_id"]),
                instrument_version=cast(str, mapping["instrument_version"]),
                stream_id=cast(str, mapping["stream_id"]),
                event_time=event_time,
                trade_time=_timestamp_from_mapping(mapping, "trade_time"),
                receive_wall_time=_timestamp_from_mapping(mapping, "receive_wall_time"),
                receive_monotonic_ns=cast(int | None, mapping["receive_monotonic_ns"]),
                normalization_time_ns=cast(int, mapping["normalization_time_ns"]),
                persistence_time_ns=cast(int, mapping["persistence_time_ns"]),
                session_id=cast(str, mapping["session_id"]),
                sequence_first=cast(int | None, mapping["sequence_first"]),
                sequence_last=cast(int | None, mapping["sequence_last"]),
                raw_payload_digest=DigestV1(raw_digest.hex()),
                posture=EvidencePosture(cast(str, mapping["posture"])),
                duplicate=cast(bool, mapping["duplicate"]),
                late=cast(bool, mapping["late"]),
                quality=quality,
                price=_scaled_from_mapping(mapping, "price"),
                quantity=_scaled_from_mapping(mapping, "quantity"),
            )
        except (ContractValueError, ValueError, TypeError) as error:
            raise LakeIntegrityError(f"decoded row violates contract: {error}") from error
        rows.append(row)
    return tuple(rows)


def _validate_parquet_metadata(
    parquet_file: pq.ParquetFile, manifest: DatasetRevisionManifestV1
) -> None:
    metadata = parquet_file.metadata
    if metadata is None:
        raise LakeIntegrityError("Parquet metadata is missing")
    if metadata.created_by != f"parquet-cpp-arrow version {PYARROW_VERSION}":
        raise LakeIntegrityError("Parquet writer identity mismatch")
    if metadata.format_version != "2.6":
        raise LakeIntegrityError("Parquet format version mismatch")
    if metadata.num_rows != manifest.partition.row_count:
        raise LakeIntegrityError("Parquet row count mismatch")
    expected_groups = (metadata.num_rows + ROW_GROUP_SIZE - 1) // ROW_GROUP_SIZE
    if metadata.num_row_groups != expected_groups:
        raise LakeIntegrityError("Parquet row-group count mismatch")
    if not parquet_file.schema_arrow.equals(REFERENCE_SCHEMA, check_metadata=True):
        raise LakeIntegrityError("Parquet Arrow schema or metadata mismatch")
    if sha256_digest(REFERENCE_SCHEMA.serialize().to_pybytes()) != manifest.schema_fingerprint:
        raise LakeIntegrityError("manifest schema fingerprint mismatch")
    expected_sorting = tuple(
        pq.SortingColumn.from_ordering(
            REFERENCE_SCHEMA,
            list(SORT_ORDER),
            null_placement="at_end",
        )
    )
    remaining = metadata.num_rows
    for index in range(metadata.num_row_groups):
        row_group = metadata.row_group(index)
        expected_rows = min(ROW_GROUP_SIZE, remaining)
        if row_group.num_rows != expected_rows:
            raise LakeIntegrityError("Parquet row-group layout mismatch")
        if tuple(row_group.sorting_columns) != expected_sorting:
            raise LakeIntegrityError("Parquet sorting declaration mismatch")
        remaining -= row_group.num_rows
        for column_index in range(row_group.num_columns):
            column = row_group.column(column_index)
            if column.compression != "UNCOMPRESSED" or column.has_dictionary_page:
                raise LakeIntegrityError("Parquet encoding profile mismatch")
            if not set(column.encodings) <= {"PLAIN", "RLE"}:
                raise LakeIntegrityError("unexpected Parquet encoding")
            if column.statistics is None:
                raise LakeIntegrityError("required Parquet statistics are missing")


def validate_partition_bundle(
    partition_bytes: bytes,
    manifest_bytes: bytes,
    *,
    expected_manifest_digest: DigestV1,
) -> ValidatedEvidenceTableV1:
    if type(partition_bytes) is not bytes or type(manifest_bytes) is not bytes:
        raise ContractValueError("validator inputs must be immutable bytes")
    if not isinstance(expected_manifest_digest, DigestV1):
        raise ContractValueError("an external expected manifest DigestV1 is required")
    if sha256_digest(manifest_bytes) != expected_manifest_digest:
        raise LakeIntegrityError("manifest substitution or corruption detected")
    try:
        manifest = DatasetRevisionManifestV1.from_bytes(manifest_bytes)
    except QuantEdgeError as error:
        raise LakeIntegrityError(f"manifest validation failed: {error}") from error
    if (
        manifest.writer_profile_id != WRITER_PROFILE_ID
        or manifest.pyarrow_version != PYARROW_VERSION
    ):
        raise LakeIntegrityError("manifest writer profile mismatch")
    if manifest.schema_id != SCHEMA_ID or manifest.schema_fingerprint != SCHEMA_FINGERPRINT:
        raise LakeIntegrityError("manifest schema identity mismatch")
    if not partition_bytes or len(partition_bytes) > MAX_PARTITION_BYTES:
        raise LakeIntegrityError("partition byte count is outside the bounded contract")
    if len(partition_bytes) != manifest.partition.byte_count:
        raise LakeIntegrityError("partition byte count mismatch")
    if sha256_digest(partition_bytes) != manifest.partition.artifact_digest:
        raise LakeIntegrityError("partition SHA-256 mismatch")
    try:
        parquet_file = pq.ParquetFile(
            pa.BufferReader(partition_bytes),
            memory_map=False,
            buffer_size=0,
            pre_buffer=False,
            coerce_int96_timestamp_unit=None,
            thrift_string_size_limit=1_048_576,
            thrift_container_size_limit=65_536,
            page_checksum_verification=True,
            arrow_extensions_enabled=False,
        )
        _validate_parquet_metadata(parquet_file, manifest)
        table = parquet_file.read(use_threads=False).combine_chunks()
    except (pa.ArrowException, OSError) as error:
        raise LakeIntegrityError(
            f"Parquet decode or page-checksum validation failed: {error}"
        ) from error
    rows = _rows_from_table(table)
    try:
        canonical_rows = _validate_rows(rows, manifest.partition.key)
    except ContractValueError as error:
        raise LakeIntegrityError(f"decoded row-set validation failed: {error}") from error
    if canonical_rows != rows:
        raise LakeIntegrityError("decoded rows are not in canonical total order")
    if any(row.posture is not manifest.truth_posture for row in rows):
        raise LakeIntegrityError("decoded row posture disagrees with manifest truth posture")
    entry = manifest.partition
    receive_times = [
        row.receive_wall_time.normalized_ns for row in rows if row.receive_wall_time is not None
    ]
    observed_counts = tuple(
        (state, sum(row.quality.state is state for row in rows)) for state in QUALITY_STATE_ORDER
    )
    observed = (
        len(rows),
        min(row.event_time.normalized_ns for row in rows),
        max(row.event_time.normalized_ns for row in rows),
        min(receive_times) if receive_times else None,
        max(receive_times) if receive_times else None,
        tuple(sorted({row.session_id for row in rows})),
        observed_counts,
        sum("KNOWN_GAP" in row.quality.reason_codes for row in rows),
        sum(row.duplicate for row in rows),
        sum(row.late for row in rows),
    )
    expected = (
        entry.row_count,
        entry.event_time_min_ns,
        entry.event_time_max_ns,
        entry.receive_time_min_ns,
        entry.receive_time_max_ns,
        entry.source_sessions,
        entry.quality_counts,
        entry.gap_count,
        entry.duplicate_count,
        entry.late_count,
    )
    if observed != expected:
        raise LakeIntegrityError("manifest bounds, quality or provenance counts mismatch")
    if _write_table(_table_from_rows(rows)) != partition_bytes:
        raise LakeIntegrityError("Parquet bytes do not match the exact frozen writer profile")
    return ValidatedEvidenceTableV1(table, manifest, rows, _token=_VALIDATED_TOKEN)
