from __future__ import annotations

import hashlib
import itertools
from collections import Counter
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import cast

import duckdb
import pyarrow as pa  # type: ignore[import-untyped]
import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UINT64_MAX,
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
    DatasetRevisionManifestV1,
    ParentRevisionV1,
    RetentionClass,
    sha256_digest,
)
from quant_edge.lake.parquet import (
    LakeIntegrityError,
    PartitionBundleV1,
    RevisionBuildSpecV1,
    ValidatedEvidenceTableV1,
    build_partition_bundle,
    validate_partition_bundle,
)
from quant_edge.lake.query import (
    FixedQueryV1,
    QueryKind,
    _open_hardened_connection,
    run_fixed_query,
)
from quant_edge.lake.retention import RetentionAction, plan_retention
from quant_edge.lake.store import ImmutableLakeStore, LakeStoreError, RevisionState

pytestmark = pytest.mark.contract

BASE_NS = 1_783_814_400_000_000_000
UTC_DATE = "2026-07-12"
DATASET_ID = "q02_synthetic_evidence"


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _quality(state: QualityState) -> ResearchQualityAssessmentV1:
    return derive_quality(
        QualityFactsV1(
            available=True,
            synthetic=True,
            gap=state is QualityState.GAPPED,
            stale=state is QualityState.STALE,
            reconstructing=False,
            sampled=False,
            partial=state is QualityState.PARTIAL,
            complete_proven=False,
        )
    )


def _timestamp(offset_ns: int) -> RawTimestampV1:
    return RawTimestampV1(
        raw=BASE_NS + offset_ns,
        unit=TimestampUnit.NANOSECOND,
        basis=TimestampBasis.DECLARED,
    )


def _row(
    record_id: str,
    *,
    event_offset_ns: int,
    receive_offset_ns: int | None,
    trade_offset_ns: int | None,
    session_id: str,
    stream_id: str,
    sequence: int | None,
    state: QualityState,
    price: ExactScaledValueV1 | None,
    quantity: ExactScaledValueV1 | None,
    duplicate: bool = False,
    late: bool = False,
) -> ReferenceMarketEvidenceRowV1:
    return ReferenceMarketEvidenceRowV1(
        record_id=record_id,
        source_id="q02_fixture",
        source_endpoint="replay_trades_v1",
        venue="BINANCE",
        product="SPOT",
        event_kind="TRADE",
        symbol="BTCUSDT",
        base_asset_id="BTC",
        quote_asset_id="USDT",
        instrument_version="v1",
        stream_id=stream_id,
        event_time=_timestamp(event_offset_ns),
        trade_time=None if trade_offset_ns is None else _timestamp(trade_offset_ns),
        receive_wall_time=(None if receive_offset_ns is None else _timestamp(receive_offset_ns)),
        receive_monotonic_ns=None if receive_offset_ns is None else 100_000 + receive_offset_ns,
        normalization_time_ns=BASE_NS + 1_000_000,
        persistence_time_ns=BASE_NS + 2_000_000,
        session_id=session_id,
        sequence_first=sequence,
        sequence_last=sequence,
        raw_payload_digest=_digest(f"payload-{record_id}"),
        posture=EvidencePosture.SYNTHETIC,
        duplicate=duplicate,
        late=late,
        quality=_quality(state),
        price=price,
        quantity=quantity,
    )


def _rows() -> tuple[ReferenceMarketEvidenceRowV1, ...]:
    maximum_decimal = (10**38) - 1
    return (
        _row(
            "record_c",
            event_offset_ns=10,
            receive_offset_ns=None,
            trade_offset_ns=None,
            session_id="session_b",
            stream_id="stream_a",
            sequence=None,
            state=QualityState.PARTIAL,
            price=None,
            quantity=ExactScaledValueV1(-9_876_543_210, 8, "BTC"),
            late=True,
        ),
        _row(
            "record_a",
            event_offset_ns=0,
            receive_offset_ns=300,
            trade_offset_ns=0,
            session_id="session_a",
            stream_id="stream_b",
            sequence=2,
            state=QualityState.COMPLETE,
            price=ExactScaledValueV1(maximum_decimal, 38, "USDT"),
            quantity=ExactScaledValueV1(1, 0, "BTC"),
        ),
        _row(
            "record_d",
            event_offset_ns=10,
            receive_offset_ns=20,
            trade_offset_ns=9,
            session_id="session_b",
            stream_id="stream_a",
            sequence=1,
            state=QualityState.STALE,
            price=ExactScaledValueV1(-1, 18, "USDT"),
            quantity=None,
        ),
        _row(
            "record_b",
            event_offset_ns=0,
            receive_offset_ns=100,
            trade_offset_ns=None,
            session_id="session_a",
            stream_id="stream_a",
            sequence=1,
            state=QualityState.GAPPED,
            price=ExactScaledValueV1(123_456_789_012_345_678, 8, "USDT"),
            quantity=ExactScaledValueV1(25_000_000, 8, "BTC"),
            duplicate=True,
        ),
    )


def _key() -> PartitionKeyV1:
    return PartitionKeyV1(
        schema_version="v1",
        venue="BINANCE",
        product="SPOT",
        event_kind="TRADE",
        utc_date=UTC_DATE,
        symbol_shard="BTCUSDT",
    )


def _revision(
    revision_id: str = "revision_001",
    *,
    parent: ParentRevisionV1 | None = None,
    published_offset_ns: int = 3_000_000,
) -> RevisionBuildSpecV1:
    return RevisionBuildSpecV1(
        dataset_id=DATASET_ID,
        revision_id=revision_id,
        published_at_ns=BASE_NS + published_offset_ns,
        dependency_lock_digest=_digest("uv-lock-q02"),
        code_profile_digest=_digest("code-profile-q02"),
        config_digest=_digest("config-profile-q02"),
        producer_activity_id="q02_synthetic_builder",
        truth_posture=EvidencePosture.SYNTHETIC,
        parent_revision=parent,
    )


def _bundle(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...] | None = None,
    *,
    revision: RevisionBuildSpecV1 | None = None,
    retention_class: RetentionClass = RetentionClass.PRESERVE,
    expires_at_ns: int | None = None,
    parent_artifacts: tuple[DigestV1, ...] = (),
) -> PartitionBundleV1:
    return build_partition_bundle(
        _rows() if rows is None else rows,
        key=_key(),
        revision=_revision() if revision is None else revision,
        retention_class=retention_class,
        expires_at_ns=expires_at_ns,
        parent_artifact_digests=parent_artifacts,
    )


ManifestMutation = Callable[[dict[str, object], dict[str, object]], None]


def _mutated_manifest(bundle: PartitionBundleV1, mutation: ManifestMutation) -> bytes:
    envelope = parse_canonical_object(bundle.manifest_bytes)
    core = cast(dict[str, object], envelope["core"])
    partition = cast(dict[str, object], core["partition"])
    mutation(core, partition)
    envelope["manifestId"] = hashlib.sha256(canonical_json_bytes(core)).hexdigest()
    return canonical_json_bytes(envelope)


def _file_snapshot(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file() and not path.is_symlink()
    }


def _window_tuple(row: ReferenceMarketEvidenceRowV1) -> tuple[object, ...]:
    return (
        row.record_id,
        row.venue,
        row.product,
        row.event_kind,
        row.symbol,
        row.event_time.normalized_ns,
        None if row.receive_wall_time is None else row.receive_wall_time.normalized_ns,
        row.session_id,
        row.stream_id,
        row.sequence_first,
        row.quality.state.value,
    )


def test_all_input_permutations_produce_identical_partition_and_manifest_bytes() -> None:
    rows = _rows()
    bundles = tuple(_bundle(tuple(permutation)) for permutation in itertools.permutations(rows))

    assert len({bundle.partition_bytes for bundle in bundles}) == 1
    assert len({bundle.manifest_bytes for bundle in bundles}) == 1
    assert len({bundle.expected_manifest_digest for bundle in bundles}) == 1


def test_validated_round_trip_preserves_exact_values_nulls_and_timestamp_contracts() -> None:
    rows = _rows()
    bundle = _bundle(rows)
    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    expected = tuple(sorted(rows, key=lambda row: row.canonical_order_key))

    assert DatasetRevisionManifestV1.from_bytes(bundle.manifest_bytes) == bundle.manifest
    assert validated.rows == expected
    assert validated.row_count == len(rows)
    assert all(row.event_time.unit is TimestampUnit.NANOSECOND for row in validated.rows)
    assert all(row.event_time.basis is TimestampBasis.DECLARED for row in validated.rows)
    assert next(row for row in validated.rows if row.record_id == "record_c").price is None
    assert next(row for row in validated.rows if row.record_id == "record_d").quantity is None
    record_a = next(row for row in validated.rows if row.record_id == "record_a")
    assert record_a.price == ExactScaledValueV1((10**38) - 1, 38, "USDT")
    assert record_a.event_time.normalized_ns == BASE_NS
    assert bundle.manifest.partition.duplicate_count == 1
    assert bundle.manifest.partition.late_count == 1
    assert bundle.manifest.partition.gap_count == 1


def test_external_manifest_anchor_and_all_integrity_layers_fail_closed() -> None:
    bundle = _bundle()
    validator_without_anchor = cast(Callable[..., object], validate_partition_bundle)
    with pytest.raises(TypeError):
        validator_without_anchor(bundle.partition_bytes, bundle.manifest_bytes)
    with pytest.raises(ContractValueError, match="external expected manifest"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=cast(DigestV1, None),
        )

    with pytest.raises(LakeIntegrityError, match="manifest substitution"):
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=_digest("wrong-trust-anchor"),
        )

    substituted = _bundle(revision=_revision("revision_substituted"))
    with pytest.raises(LakeIntegrityError, match="manifest substitution"):
        validate_partition_bundle(
            bundle.partition_bytes,
            substituted.manifest_bytes,
            expected_manifest_digest=bundle.expected_manifest_digest,
        )

    corrupted_payload = bytearray(bundle.partition_bytes)
    corrupted_payload[len(corrupted_payload) // 2] ^= 0x01
    for invalid_payload in (bytes(corrupted_payload), bundle.partition_bytes[:-1]):
        with pytest.raises(LakeIntegrityError):
            validate_partition_bundle(
                invalid_payload,
                bundle.manifest_bytes,
                expected_manifest_digest=bundle.expected_manifest_digest,
            )

    corrupt_manifest = b" " + bundle.manifest_bytes
    with pytest.raises(LakeIntegrityError, match="manifest validation"):
        validate_partition_bundle(
            bundle.partition_bytes,
            corrupt_manifest,
            expected_manifest_digest=sha256_digest(corrupt_manifest),
        )

    def wrong_schema(core: dict[str, object], _partition: dict[str, object]) -> None:
        core["schemaId"] = "DifferentEvidenceSchemaV1"

    schema_manifest = _mutated_manifest(bundle, wrong_schema)
    with pytest.raises(LakeIntegrityError, match="schema identity"):
        validate_partition_bundle(
            bundle.partition_bytes,
            schema_manifest,
            expected_manifest_digest=sha256_digest(schema_manifest),
        )

    def wrong_count(_core: dict[str, object], partition: dict[str, object]) -> None:
        partition["rowCount"] = "5"
        quality_counts = cast(dict[str, object], partition["qualityCounts"])
        quality_counts[QualityState.SYNTHETIC.value] = "5"

    count_manifest = _mutated_manifest(bundle, wrong_count)
    with pytest.raises(LakeIntegrityError, match="row count mismatch"):
        validate_partition_bundle(
            bundle.partition_bytes,
            count_manifest,
            expected_manifest_digest=sha256_digest(count_manifest),
        )


def test_store_is_manifest_last_immutable_and_requires_external_read_anchor(tmp_path: Path) -> None:
    root = tmp_path / "lake"
    root.mkdir()
    store = ImmutableLakeStore(root)
    bundle = _bundle()

    assert store.revision_state(DATASET_ID, "revision_001") is RevisionState.ABSENT
    manifest_digest = store.publish(bundle)
    committed_snapshot = _file_snapshot(root)
    assert manifest_digest == bundle.expected_manifest_digest
    assert store.revision_state(DATASET_ID, "revision_001") is RevisionState.UNVERIFIED
    assert (
        store.revision_state(
            DATASET_ID,
            "revision_001",
            expected_manifest_digest=manifest_digest,
        )
        is RevisionState.COMMITTED
    )
    assert store.read(
        DATASET_ID,
        "revision_001",
        expected_manifest_digest=manifest_digest,
    ).rows == tuple(sorted(_rows(), key=lambda row: row.canonical_order_key))

    with pytest.raises(LakeIntegrityError, match="trust anchor"):
        store.read(
            DATASET_ID,
            "revision_001",
            expected_manifest_digest=_digest("substituted-store-anchor"),
        )
    with pytest.raises(LakeStoreError, match="already exists"):
        store.publish(bundle)
    assert _file_snapshot(root) == committed_snapshot

    incomplete = root / "datasets" / DATASET_ID / "revisions" / "revision_incomplete"
    incomplete.mkdir(parents=True)
    (incomplete / "payload.only").write_bytes(bundle.partition_bytes)
    assert store.revision_state(DATASET_ID, "revision_incomplete") is RevisionState.INCOMPLETE
    with pytest.raises(LakeStoreError, match=r"manifest\.json"):
        store.read(
            DATASET_ID,
            "revision_incomplete",
            expected_manifest_digest=bundle.expected_manifest_digest,
        )

    for revision_id, as_symlink in (("revision_manifest_dir", False), ("revision_link", True)):
        revision = root / "datasets" / DATASET_ID / "revisions" / revision_id
        revision.mkdir()
        manifest_path = revision / "manifest.json"
        if as_symlink:
            manifest_path.symlink_to(incomplete / "payload.only")
        else:
            manifest_path.mkdir()
        assert store.revision_state(DATASET_ID, revision_id) is RevisionState.CORRUPT


def test_store_rejects_unsafe_roots_ids_paths_and_symlink_components(tmp_path: Path) -> None:
    with pytest.raises(ContractValueError, match="absolute"):
        ImmutableLakeStore(Path("relative-lake"))
    with pytest.raises(LakeStoreError, match="pre-exist"):
        ImmutableLakeStore(tmp_path / "missing")

    real_root = tmp_path / "real-root"
    real_root.mkdir()
    linked_root = tmp_path / "linked-root"
    linked_root.symlink_to(real_root, target_is_directory=True)
    with pytest.raises(LakeStoreError, match="non-symlink"):
        ImmutableLakeStore(linked_root)

    store = ImmutableLakeStore(real_root)
    for bad_id in (".", "..", "../escape", "slash/id", "back\\slash"):
        with pytest.raises(ContractValueError):
            store.revision_state(bad_id, "revision_001")

    symlink_root = tmp_path / "symlink-chain-root"
    outside = tmp_path / "outside"
    symlink_root.mkdir()
    outside.mkdir()
    (symlink_root / "datasets").symlink_to(outside, target_is_directory=True)
    with pytest.raises(LakeStoreError, match="unsafe"):
        ImmutableLakeStore(symlink_root).publish(_bundle())
    assert _file_snapshot(outside) == {}


def test_correction_is_a_new_revision_with_bound_lineage_and_old_bytes_unchanged(
    tmp_path: Path,
) -> None:
    root = tmp_path / "lake"
    root.mkdir()
    store = ImmutableLakeStore(root)
    original = _bundle()
    original_digest = store.publish(original)
    original_revision_root = root / "datasets" / DATASET_ID / "revisions" / "revision_001"
    original_snapshot = _file_snapshot(original_revision_root)

    parent = ParentRevisionV1(DATASET_ID, "revision_001", original_digest)
    corrected_rows = tuple(
        replace(
            row,
            price=ExactScaledValueV1(42_000_000_000, 8, "USDT"),
            raw_payload_digest=_digest("corrected-record-a"),
        )
        if row.record_id == "record_a"
        else row
        for row in _rows()
    )
    correction = _bundle(
        corrected_rows,
        revision=_revision(
            "revision_002",
            parent=parent,
            published_offset_ns=4_000_000,
        ),
        retention_class=RetentionClass.RAW_EXPIRABLE,
        expires_at_ns=BASE_NS + 5_000_000,
        parent_artifacts=(original.manifest.partition.artifact_digest,),
    )
    correction_digest = store.publish(correction)

    assert correction.manifest.partition.relative_path != original.manifest.partition.relative_path
    assert correction.partition_bytes != original.partition_bytes
    assert _file_snapshot(original_revision_root) == original_snapshot
    assert store.read(
        DATASET_ID,
        "revision_001",
        expected_manifest_digest=original_digest,
    ).rows == tuple(sorted(_rows(), key=lambda row: row.canonical_order_key))
    assert store.read(
        DATASET_ID,
        "revision_002",
        expected_manifest_digest=correction_digest,
    ).rows == tuple(sorted(corrected_rows, key=lambda row: row.canonical_order_key))

    complete_tree = _file_snapshot(root)
    decisions = plan_retention(
        (original.manifest, correction.manifest),
        as_of_ns=BASE_NS + 6_000_000,
        deletion_permission_known=True,
        dependencies_preserved=True,
    )
    assert tuple(decision.action for decision in decisions) == (
        RetentionAction.RETAIN,
        RetentionAction.EXPIRE_PAYLOAD_PRESERVE_MANIFEST,
    )
    assert all(decision.preserve_manifest and decision.preserve_lineage for decision in decisions)
    assert _file_snapshot(root) == complete_tree

    wrong_parent = ParentRevisionV1(DATASET_ID, "revision_001", _digest("wrong-parent"))
    invalid_correction = _bundle(
        corrected_rows,
        revision=_revision(
            "revision_003",
            parent=wrong_parent,
            published_offset_ns=7_000_000,
        ),
        parent_artifacts=(original.manifest.partition.artifact_digest,),
    )
    with pytest.raises(LakeStoreError, match="parent manifest digest"):
        store.publish(invalid_correction)
    assert store.revision_state(DATASET_ID, "revision_003") is RevisionState.ABSENT


def test_fixed_queries_match_python_reference_and_reject_raw_sql_or_arrow() -> None:
    bundle = _bundle()
    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    ordered = tuple(sorted(_rows(), key=lambda row: row.canonical_order_key))
    window = FixedQueryV1(
        kind=QueryKind.WINDOW,
        start_event_time_ns=BASE_NS,
        end_event_time_ns=BASE_NS + 10,
        limit=100,
    )
    result = run_fixed_query(validated, window)

    assert result.rows == tuple(_window_tuple(row) for row in ordered)
    assert tuple(row[0] for row in result.rows) == tuple(row.record_id for row in ordered)
    expected_counts = tuple(sorted(Counter(row.quality.state.value for row in ordered).items()))
    counts = run_fixed_query(
        validated,
        FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=len(QualityState)),
    )
    assert counts.rows == expected_counts

    injection_looking_bound = FixedQueryV1(
        kind=QueryKind.WINDOW,
        start_event_time_ns=BASE_NS,
        end_event_time_ns=BASE_NS + 10,
        venue="BINANCE--OR_1_1",
        limit=100,
    )
    assert run_fixed_query(validated, injection_looking_bound).rows == ()

    with pytest.raises(ContractValueError, match="never SQL"):
        run_fixed_query(validated, cast(FixedQueryV1, "SELECT * FROM q_input"))
    with pytest.raises(ContractValueError, match="validator-returned"):
        run_fixed_query(cast(ValidatedEvidenceTableV1, pa.table({"record_id": ["raw"]})), window)
    with pytest.raises(ContractValueError, match="validator-only"):
        ValidatedEvidenceTableV1(
            pa.table({"record_id": ["forged"]}),
            bundle.manifest,
            (),
            _token=object(),
        )


def test_sequence_nulls_sort_after_the_legal_uint64_maximum() -> None:
    common = {
        "event_offset_ns": 50,
        "receive_offset_ns": 100,
        "trade_offset_ns": None,
        "session_id": "session_a",
        "stream_id": "stream_a",
        "state": QualityState.COMPLETE,
        "price": ExactScaledValueV1(1, 0, "USDT"),
        "quantity": None,
    }
    actual_max = _row("z_actual_max", sequence=UINT64_MAX, **common)  # type: ignore[arg-type]
    null_sequence = _row("a_null", sequence=None, **common)  # type: ignore[arg-type]
    bundle = _bundle((null_sequence, actual_max))
    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    assert tuple(row.record_id for row in validated.rows) == ("z_actual_max", "a_null")
    query = FixedQueryV1(
        kind=QueryKind.WINDOW,
        start_event_time_ns=BASE_NS,
        end_event_time_ns=BASE_NS + 100,
        limit=10,
    )
    result = run_fixed_query(validated, query)
    assert tuple(row[0] for row in result.rows) == ("z_actual_max", "a_null")


def test_raw_hardened_duckdb_denies_io_network_extensions_and_reconfiguration(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "input.csv"
    output_path = tmp_path / "output.csv"
    database_path = tmp_path / "attached.duckdb"
    input_path.write_text("value\n1\n", encoding="utf-8")
    connection = _open_hardened_connection()
    try:
        connection.execute("CREATE TABLE local_sink(value INTEGER)")
        blocked_statements = (
            f"SELECT * FROM read_csv_auto('{input_path.as_posix()}')",
            f"COPY local_sink FROM '{input_path.as_posix()}' (FORMAT CSV, HEADER TRUE)",
            f"COPY (SELECT 1 AS value) TO '{output_path.as_posix()}' (FORMAT CSV)",
            f"ATTACH '{database_path.as_posix()}' AS attached",
            "INSTALL httpfs",
            "LOAD httpfs",
        )
        for statement in blocked_statements:
            with pytest.raises(duckdb.Error) as captured:
                connection.execute(statement).fetchall()
            assert "disabled" in str(captured.value).lower()

        with pytest.raises(duckdb.Error, match="configuration has been locked"):
            connection.execute("SET enable_external_access=true")
        assert connection.execute(
            "SELECT current_setting('enable_external_access')"
        ).fetchone() == (False,)

        with pytest.raises(
            duckdb.Error,
            match="file system operations are disabled by configuration",
        ):
            connection.execute(
                "SELECT * FROM read_csv_auto('https://example.invalid/q02.csv')"
            ).fetchall()
        assert not output_path.exists()
        assert not database_path.exists()
    finally:
        connection.close()
