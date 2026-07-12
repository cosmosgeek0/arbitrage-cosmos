from __future__ import annotations

import hashlib
import os
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import duckdb
import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake import query as query_module
from quant_edge.lake import store as store_module
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
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
from quant_edge.lake.manifest import DatasetRevisionManifestV1, ParentRevisionV1, sha256_digest
from quant_edge.lake.parquet import (
    LakeIntegrityError,
    PartitionBundleV1,
    RevisionBuildSpecV1,
    ValidatedEvidenceTableV1,
    build_partition_bundle,
    validate_partition_bundle,
)
from quant_edge.lake.query import (
    MAX_QUERY_ROWS,
    FixedQueryV1,
    QueryBoundaryError,
    QueryKind,
    _open_hardened_connection,
    run_fixed_query,
)
from quant_edge.lake.store import (
    ImmutableLakeStore,
    LakeStoreError,
    RevisionState,
    _directory_identity,
    _read_bounded_regular_at,
    _read_descriptor_exact,
    _verify_directory_chain_identity,
    _verify_linked_artifact_at,
    _write_exclusive_at,
)

pytestmark = pytest.mark.contract

BASE_NS = 1_783_814_400_000_000_000
DATASET_ID = "q02_hostile_fixture"


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _row() -> ReferenceMarketEvidenceRowV1:
    timestamp = RawTimestampV1(
        raw=BASE_NS,
        unit=TimestampUnit.NANOSECOND,
        basis=TimestampBasis.DECLARED,
    )
    return ReferenceMarketEvidenceRowV1(
        record_id="synthetic_record",
        source_id="synthetic_source",
        source_endpoint="synthetic_endpoint",
        venue="synthetic_venue",
        product="synthetic_product",
        event_kind="synthetic_event",
        symbol="synthetic_symbol",
        base_asset_id="synthetic_base",
        quote_asset_id="synthetic_quote",
        instrument_version="v1",
        stream_id="synthetic_stream",
        event_time=timestamp,
        trade_time=None,
        receive_wall_time=None,
        receive_monotonic_ns=None,
        normalization_time_ns=BASE_NS + 1,
        persistence_time_ns=BASE_NS + 2,
        session_id="synthetic_session",
        sequence_first=None,
        sequence_last=None,
        raw_payload_digest=_digest("synthetic-payload"),
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
        price=ExactScaledValueV1(1, 0, "synthetic_quote"),
        quantity=None,
    )


def _bundle(
    revision_id: str = "rev1",
    *,
    parent: ParentRevisionV1 | None = None,
    parent_artifacts: tuple[DigestV1, ...] = (),
    published_at_ns: int = BASE_NS + 10,
) -> PartitionBundleV1:
    return build_partition_bundle(
        (_row(),),
        key=PartitionKeyV1(
            schema_version="v1",
            venue="synthetic_venue",
            product="synthetic_product",
            event_kind="synthetic_event",
            utc_date="2026-07-12",
            symbol_shard="synthetic_shard",
        ),
        revision=RevisionBuildSpecV1(
            dataset_id=DATASET_ID,
            revision_id=revision_id,
            published_at_ns=published_at_ns,
            dependency_lock_digest=_digest("lock"),
            code_profile_digest=_digest("code"),
            config_digest=_digest("config"),
            producer_activity_id="q02.hostile.fixture",
            truth_posture=EvidencePosture.SYNTHETIC,
            parent_revision=parent,
        ),
        parent_artifact_digests=parent_artifacts,
    )


def _validated() -> ValidatedEvidenceTableV1:
    bundle = _bundle()
    return validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=bundle.expected_manifest_digest,
    )


def _lake(tmp_path: Path) -> tuple[Path, ImmutableLakeStore]:
    root = tmp_path / "lake"
    root.mkdir()
    return root, ImmutableLakeStore(root)


def _revision_path(root: Path, revision_id: str) -> Path:
    return root / "datasets" / DATASET_ID / "revisions" / revision_id


@pytest.mark.parametrize("kind", ["WINDOW", 1, None])
def test_fixed_query_rejects_non_enum_kind(kind: object) -> None:
    with pytest.raises(ContractValueError, match="kind must be QueryKind"):
        FixedQueryV1(kind=cast(QueryKind, kind), limit=1)


@pytest.mark.parametrize("limit", [True, False, "1", 1.0, None])
def test_fixed_query_rejects_non_integer_limit(limit: object) -> None:
    with pytest.raises(ContractValueError, match="limit must be an integer"):
        FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=cast(int, limit))


@pytest.mark.parametrize("limit", [0, -1, MAX_QUERY_ROWS + 1])
def test_fixed_query_rejects_out_of_range_limit(limit: int) -> None:
    with pytest.raises(ContractValueError, match="limit must be between"):
        FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=limit)


@pytest.mark.parametrize(
    ("start", "end", "venue"),
    [
        (BASE_NS, None, None),
        (None, BASE_NS, None),
        (True, BASE_NS, None),
        (BASE_NS, False, None),
        ("0", BASE_NS, None),
        (BASE_NS, 1.0, None),
    ],
)
def test_window_query_requires_exact_integer_bounds(
    start: object,
    end: object,
    venue: str | None,
) -> None:
    with pytest.raises(ContractValueError, match="exact integer event-time bounds"):
        FixedQueryV1(
            kind=QueryKind.WINDOW,
            limit=1,
            start_event_time_ns=cast(int, start),
            end_event_time_ns=cast(int, end),
            venue=venue,
        )


@pytest.mark.parametrize(
    ("start", "end", "message"),
    [
        (UTC_NS_MIN - 1, UTC_NS_MIN, "start_event_time_ns"),
        (UTC_NS_MIN, UTC_NS_MAX + 1, "end_event_time_ns"),
        (BASE_NS + 1, BASE_NS, "reversed"),
    ],
)
def test_window_query_rejects_bounds_outside_range_or_order(
    start: int,
    end: int,
    message: str,
) -> None:
    with pytest.raises(ContractValueError, match=message):
        FixedQueryV1(
            kind=QueryKind.WINDOW,
            limit=1,
            start_event_time_ns=start,
            end_event_time_ns=end,
        )


@pytest.mark.parametrize("venue", [".", "..", "/root", "venue/name", "venue\\name", " venue"])
def test_window_query_rejects_unsafe_venue(venue: str) -> None:
    with pytest.raises(ContractValueError, match="strict ASCII path segment"):
        FixedQueryV1(
            kind=QueryKind.WINDOW,
            limit=1,
            start_event_time_ns=BASE_NS,
            end_event_time_ns=BASE_NS,
            venue=venue,
        )


@pytest.mark.parametrize(
    ("start", "end", "venue"),
    [
        (BASE_NS, None, None),
        (None, BASE_NS, None),
        (None, None, "synthetic_venue"),
    ],
)
def test_quality_counts_rejects_every_filter(
    start: int | None,
    end: int | None,
    venue: str | None,
) -> None:
    with pytest.raises(ContractValueError, match="accepts no filters"):
        FixedQueryV1(
            kind=QueryKind.QUALITY_COUNTS,
            limit=1,
            start_event_time_ns=start,
            end_event_time_ns=end,
            venue=venue,
        )


class _Cursor:
    def __init__(self, row: tuple[object, ...] | None = None) -> None:
        self._row = row

    def fetchone(self) -> tuple[object, ...] | None:
        return self._row

    def fetchall(self) -> list[tuple[object, ...]]:
        return [] if self._row is None else [self._row]


class _RunConnection:
    def __init__(
        self,
        *,
        rows: list[tuple[object, ...]] | None = None,
        execute_error: duckdb.Error | None = None,
        unregister_error: duckdb.Error | None = None,
    ) -> None:
        self.rows = [] if rows is None else rows
        self.execute_error = execute_error
        self.unregister_error = unregister_error
        self.registered = False
        self.unregistered = False
        self.closed = False
        self.sql = ""
        self.parameters: list[object] = []

    def register(self, name: str, _table: object) -> _RunConnection:
        assert name == "q_input"
        self.registered = True
        return self

    def execute(self, sql: str, parameters: list[object]) -> _RunConnection:
        if self.execute_error is not None:
            raise self.execute_error
        self.sql = sql
        self.parameters = parameters
        return self

    def fetchall(self) -> list[tuple[object, ...]]:
        return self.rows

    def unregister(self, name: str) -> None:
        assert name == "q_input"
        self.unregistered = True
        if self.unregister_error is not None:
            raise self.unregister_error

    def close(self) -> None:
        self.closed = True


def test_fixed_query_fails_closed_if_duckdb_returns_over_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _RunConnection(rows=[("one",), ("two",)])
    monkeypatch.setattr(query_module, "_open_hardened_connection", lambda: connection)

    with pytest.raises(QueryBoundaryError, match="more rows than the fixed limit"):
        run_fixed_query(
            _validated(),
            FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=1),
        )

    assert connection.registered
    assert connection.unregistered
    assert connection.closed
    assert "ORDER BY quality_state ASC LIMIT ?" in connection.sql
    assert connection.parameters == [1]


def test_fixed_query_wraps_duckdb_failure_and_suppresses_unregister_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _RunConnection(
        execute_error=duckdb.Error("hostile query failure"),
        unregister_error=duckdb.Error("hostile cleanup failure"),
    )
    monkeypatch.setattr(query_module, "_open_hardened_connection", lambda: connection)

    with pytest.raises(QueryBoundaryError, match="fixed DuckDB query failed"):
        run_fixed_query(
            _validated(),
            FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=1),
        )

    assert connection.unregistered
    assert connection.closed


def test_window_query_binds_venue_and_total_order_without_interpolating_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _RunConnection()
    monkeypatch.setattr(query_module, "_open_hardened_connection", lambda: connection)
    query = FixedQueryV1(
        kind=QueryKind.WINDOW,
        limit=7,
        start_event_time_ns=BASE_NS,
        end_event_time_ns=BASE_NS + 1,
        venue="synthetic_venue",
    )

    run_fixed_query(_validated(), query)

    assert "venue = ?" in connection.sql
    assert "synthetic_venue" not in connection.sql
    assert "ORDER BY event_time_ns" in connection.sql
    assert connection.sql.rstrip().endswith("record_id LIMIT ?")
    assert connection.parameters == ["synthetic_venue", BASE_NS, BASE_NS + 1, 7]


class _SettingConnection:
    def __init__(
        self,
        *,
        overrides: dict[str, object] | None = None,
        execute_error: duckdb.Error | None = None,
    ) -> None:
        self.overrides = {} if overrides is None else overrides
        self.execute_error = execute_error
        self.closed = False

    def execute(self, sql: str) -> _Cursor:
        if self.execute_error is not None:
            raise self.execute_error
        setting = sql.split("'")[1]
        defaults: dict[str, object] = {
            "threads": 1,
            "enable_external_access": False,
            "autoinstall_known_extensions": False,
            "autoload_known_extensions": False,
            "allow_unsigned_extensions": False,
            "allow_community_extensions": False,
            "python_enable_replacements": False,
            "enable_external_file_cache": False,
            "enable_http_metadata_cache": False,
            "allow_persistent_secrets": False,
            "allow_unredacted_secrets": False,
            "scalar_subquery_error_on_multiple_rows": True,
            "lock_configuration": True,
            "max_temp_directory_size": "0 bytes",
            "memory_limit": "61.0 MiB",
        }
        value = self.overrides.get(setting, defaults[setting])
        return _Cursor(None if value is _NO_ROW else (value,))

    def close(self) -> None:
        self.closed = True


_NO_ROW = object()


def test_hardened_connection_wraps_duckdb_connect_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_connect(*_args: object, **_kwargs: object) -> None:
        raise duckdb.Error("connect denied")

    monkeypatch.setattr(duckdb, "connect", fail_connect)
    with pytest.raises(QueryBoundaryError, match="failed to create hardened"):
        _open_hardened_connection()


@pytest.mark.parametrize(
    "overrides",
    [
        {"threads": 2},
        {"threads": _NO_ROW},
        {"max_temp_directory_size": "1.0 KiB"},
        {"max_temp_directory_size": _NO_ROW},
        {"memory_limit": "60.0 MiB"},
    ],
)
def test_hardened_connection_closes_on_setting_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    overrides: dict[str, object],
) -> None:
    connection = _SettingConnection(overrides=overrides)
    monkeypatch.setattr(duckdb, "connect", lambda *_args, **_kwargs: connection)

    with pytest.raises(QueryBoundaryError, match="failed to verify hardened"):
        _open_hardened_connection()

    assert connection.closed


def test_hardened_connection_closes_on_setting_query_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _SettingConnection(execute_error=duckdb.Error("setting read failed"))
    monkeypatch.setattr(duckdb, "connect", lambda *_args, **_kwargs: connection)

    with pytest.raises(QueryBoundaryError, match="failed to verify hardened"):
        _open_hardened_connection()

    assert connection.closed


def test_exclusive_writer_rejects_collision_and_no_progress(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    success = tmp_path / "success.pending"
    success_fd = os.open(tmp_path, os.O_RDONLY)
    try:
        _write_exclusive_at(success_fd, success.name, b"complete")
    finally:
        os.close(success_fd)
    assert success.read_bytes() == b"complete"
    assert success.stat().st_mode & 0o222 == 0

    collision = tmp_path / "collision.pending"
    collision.write_bytes(b"already here")
    directory_fd = os.open(tmp_path, os.O_RDONLY)
    try:
        with pytest.raises(FileExistsError):
            _write_exclusive_at(directory_fd, collision.name, b"new bytes")
        assert collision.read_bytes() == b"already here"

        stalled = tmp_path / "stalled.pending"
        monkeypatch.setattr(os, "write", lambda _fd, _raw: 0)
        with pytest.raises(LakeStoreError, match="made no progress"):
            _write_exclusive_at(directory_fd, stalled.name, b"payload")
        assert stalled.exists()
    finally:
        os.close(directory_fd)


def test_linked_artifact_verifier_rejects_absence_content_and_identity_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    staged = tmp_path / "staged"
    staged.write_bytes(b"abc")
    final = tmp_path / "final"
    final.hardlink_to(staged)
    directory_fd = os.open(tmp_path, os.O_RDONLY)
    staged_fd = os.open(staged, os.O_RDONLY)
    try:
        assert _read_descriptor_exact(staged_fd, 2) == b"abc"
        _verify_linked_artifact_at(directory_fd, final.name, staged_fd, b"abc")
        with pytest.raises(LakeStoreError, match="content mismatch"):
            _verify_linked_artifact_at(directory_fd, final.name, staged_fd, b"xyz")

        final.unlink()
        with pytest.raises(LakeStoreError, match="cannot be opened safely"):
            _verify_linked_artifact_at(directory_fd, final.name, staged_fd, b"abc")
        final.hardlink_to(staged)

        real_fstat = os.fstat
        calls = 0

        def drift_after_reads(descriptor: int) -> SimpleNamespace:
            nonlocal calls
            calls += 1
            current = real_fstat(descriptor)
            return SimpleNamespace(
                st_dev=current.st_dev,
                st_ino=current.st_ino + int(calls == 3),
                st_size=current.st_size,
                st_mode=current.st_mode,
            )

        monkeypatch.setattr(os, "fstat", drift_after_reads)
        with pytest.raises(LakeStoreError, match="changed during verification"):
            _verify_linked_artifact_at(directory_fd, final.name, staged_fd, b"abc")
    finally:
        os.close(staged_fd)
        os.close(directory_fd)


@pytest.mark.parametrize("name", ["", ".", "..", "bad/name", "bad\x00name"])
def test_descriptor_relative_file_helpers_reject_unsafe_names(
    tmp_path: Path,
    name: str,
) -> None:
    directory_fd = os.open(tmp_path, os.O_RDONLY)
    try:
        with pytest.raises(LakeStoreError, match="exclusive file name is unsafe"):
            _write_exclusive_at(directory_fd, name, b"payload")
        with pytest.raises(LakeStoreError, match="immutable artifact name is unsafe"):
            _read_bounded_regular_at(directory_fd, name, maximum=8)
    finally:
        os.close(directory_fd)


def test_directory_identity_and_chain_verification_reject_type_or_inode_change(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision_parent = tmp_path / "revisions"
    partition = revision_parent / "rev1" / "partitions"
    partition.mkdir(parents=True)
    parent_fd = os.open(revision_parent, os.O_RDONLY)
    revision_fd = os.open(revision_parent / "rev1", os.O_RDONLY)
    partition_fd = os.open(partition, os.O_RDONLY)
    revision_identity = _directory_identity(revision_fd)
    partition_identity = _directory_identity(partition_fd)
    os.close(revision_fd)
    os.close(partition_fd)
    try:
        with pytest.raises(LakeStoreError, match="revision directory identity changed"):
            _verify_directory_chain_identity(
                parent_fd,
                "rev1",
                (revision_identity[0], revision_identity[1] + 1),
                ("partitions",),
                partition_identity,
            )
        with pytest.raises(LakeStoreError, match="partition directory identity changed"):
            _verify_directory_chain_identity(
                parent_fd,
                "rev1",
                revision_identity,
                ("partitions",),
                (partition_identity[0], partition_identity[1] + 1),
            )

        real_fstat = os.fstat

        def report_regular_file(descriptor: int) -> SimpleNamespace:
            current = real_fstat(descriptor)
            return SimpleNamespace(
                st_dev=current.st_dev,
                st_ino=current.st_ino,
                st_size=current.st_size,
                st_mode=0o100600,
            )

        monkeypatch.setattr(os, "fstat", report_regular_file)
        with pytest.raises(LakeStoreError, match="changed type"):
            _directory_identity(parent_fd)
    finally:
        os.close(parent_fd)


def test_bounded_reader_rejects_type_size_and_open_identity_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory_fd = os.open(tmp_path, os.O_RDONLY)
    directory = tmp_path / "directory"
    directory.mkdir()
    target = tmp_path / "target"
    target.write_bytes(b"abc")
    link = tmp_path / "link"
    link.symlink_to(target)
    empty = tmp_path / "empty"
    empty.touch()
    try:
        with pytest.raises(LakeStoreError, match="absent"):
            _read_bounded_regular_at(directory_fd, "missing", maximum=8)
        with pytest.raises(LakeStoreError, match="not a real regular file"):
            _read_bounded_regular_at(directory_fd, directory.name, maximum=8)
        with pytest.raises(LakeStoreError, match="unsafe or cannot be opened"):
            _read_bounded_regular_at(directory_fd, link.name, maximum=8)
        with pytest.raises(LakeStoreError, match="invalid bounded size"):
            _read_bounded_regular_at(directory_fd, empty.name, maximum=8)
        with pytest.raises(LakeStoreError, match="invalid bounded size"):
            _read_bounded_regular_at(directory_fd, target.name, maximum=2)

        real_fstat = os.fstat
        calls = 0

        def mismatched_fstat(descriptor: int) -> SimpleNamespace:
            nonlocal calls
            calls += 1
            current = real_fstat(descriptor)
            return SimpleNamespace(
                st_dev=current.st_dev,
                st_ino=current.st_ino + int(calls > 1),
                st_size=current.st_size,
                st_mode=current.st_mode,
            )

        monkeypatch.setattr(os, "fstat", mismatched_fstat)
        with pytest.raises(LakeStoreError, match="changed or exceeded"):
            _read_bounded_regular_at(directory_fd, target.name, maximum=3)
    finally:
        os.close(directory_fd)


def test_bounded_reader_rejects_short_and_over_bound_read_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "target"
    target.write_bytes(b"abc")
    directory_fd = os.open(tmp_path, os.O_RDONLY)
    try:
        with monkeypatch.context() as patch:
            chunks = iter((b"ab", b""))
            patch.setattr(os, "read", lambda _fd, _size: next(chunks))
            with pytest.raises(LakeStoreError, match="changed or exceeded"):
                _read_bounded_regular_at(directory_fd, target.name, maximum=3)

        with monkeypatch.context() as patch:
            patch.setattr(os, "read", lambda _fd, _size: b"abcd")
            with pytest.raises(LakeStoreError, match="changed or exceeded"):
                _read_bounded_regular_at(directory_fd, target.name, maximum=3)
    finally:
        os.close(directory_fd)


def test_store_rejects_invalid_root_type(tmp_path: Path) -> None:
    with pytest.raises(ContractValueError, match=r"absolute pathlib\.Path"):
        ImmutableLakeStore(cast(Path, tmp_path.as_posix()))


def test_store_rejects_root_inode_change_during_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "lake"
    root.mkdir()
    real_fstat = os.fstat

    def report_changed_inode(descriptor: int) -> SimpleNamespace:
        current = real_fstat(descriptor)
        return SimpleNamespace(
            st_dev=current.st_dev,
            st_ino=current.st_ino + 1,
            st_size=current.st_size,
            st_mode=current.st_mode,
        )

    monkeypatch.setattr(os, "fstat", report_changed_inode)
    with pytest.raises(LakeStoreError, match="lake root changed while opening"):
        ImmutableLakeStore(root)


def test_store_context_manager_closes_idempotently_and_all_operations_fail_closed(
    tmp_path: Path,
) -> None:
    root = tmp_path / "lake"
    root.mkdir()
    store = ImmutableLakeStore(root)
    with store as entered:
        assert entered is store

    store.close()
    with pytest.raises(LakeStoreError, match="descriptor is closed"):
        store.__enter__()
    with pytest.raises(LakeStoreError, match="descriptor is closed"):
        store.publish(_bundle())
    with pytest.raises(LakeStoreError, match="descriptor is closed"):
        store.read(DATASET_ID, "rev1", expected_manifest_digest=_digest("closed"))
    with pytest.raises(LakeStoreError, match="descriptor is closed"):
        store.revision_state(DATASET_ID, "rev1")
    with pytest.raises(LakeStoreError, match="descriptor is closed"):
        store._open_chain(("datasets",))


def test_store_rejects_missing_and_non_directory_chains(tmp_path: Path) -> None:
    root, store = _lake(tmp_path)
    with pytest.raises(LakeStoreError, match="absent, unsafe or not a directory"):
        store.read(DATASET_ID, "missing", expected_manifest_digest=_digest("missing"))

    (root / "datasets").write_bytes(b"not a directory")
    with pytest.raises(LakeStoreError, match="absent, unsafe or not a directory"):
        store.publish(_bundle())


def test_parent_validation_rejects_absent_invalid_and_identity_mismatched_manifest(
    tmp_path: Path,
) -> None:
    root, store = _lake(tmp_path)

    absent_revision = _revision_path(root, "absent_parent")
    absent_revision.mkdir(parents=True)
    absent_parent = ParentRevisionV1(DATASET_ID, "absent_parent", _digest("absent"))
    with pytest.raises(LakeStoreError, match=r"manifest\.json"):
        store.publish(_bundle("child_absent", parent=absent_parent))

    invalid_bytes = b"{}"
    invalid_revision = _revision_path(root, "invalid_parent")
    invalid_revision.mkdir(parents=True)
    (invalid_revision / "manifest.json").write_bytes(invalid_bytes)
    invalid_parent = ParentRevisionV1(
        DATASET_ID,
        "invalid_parent",
        sha256_digest(invalid_bytes),
    )
    with pytest.raises(LakeStoreError, match="parent manifest is invalid"):
        store.publish(_bundle("child_invalid", parent=invalid_parent))

    actual = _bundle("actual_parent")
    claimed_revision = _revision_path(root, "claimed_parent")
    claimed_revision.mkdir(parents=True)
    (claimed_revision / "manifest.json").write_bytes(actual.manifest_bytes)
    mismatched_parent = ParentRevisionV1(
        DATASET_ID,
        "claimed_parent",
        actual.expected_manifest_digest,
    )
    with pytest.raises(LakeStoreError, match="identity mismatch"):
        store.publish(
            _bundle(
                "child_mismatch",
                parent=mismatched_parent,
                parent_artifacts=(actual.manifest.partition.artifact_digest,),
            )
        )


def test_parent_validation_requires_parent_artifact_binding(tmp_path: Path) -> None:
    _root, store = _lake(tmp_path)
    parent_bundle = _bundle("parent")
    parent_digest = store.publish(parent_bundle)
    parent = ParentRevisionV1(DATASET_ID, "parent", parent_digest)

    with pytest.raises(LakeStoreError, match="does not bind its parent partition"):
        store.publish(_bundle("child", parent=parent, parent_artifacts=()))


def test_parent_validation_rejects_correction_published_before_parent(tmp_path: Path) -> None:
    _root, store = _lake(tmp_path)
    parent_bundle = _bundle("chronology_parent", published_at_ns=BASE_NS + 20)
    parent_digest = store.publish(parent_bundle)
    parent = ParentRevisionV1(DATASET_ID, "chronology_parent", parent_digest)

    with pytest.raises(LakeStoreError, match="cannot precede its parent"):
        store.publish(
            _bundle(
                "chronology_child",
                parent=parent,
                parent_artifacts=(parent_bundle.manifest.partition.artifact_digest,),
                published_at_ns=BASE_NS + 19,
            )
        )


@pytest.mark.parametrize("damage", ["missing", "corrupt", "symlink"])
def test_parent_validation_requires_complete_anchored_parent_payload(
    tmp_path: Path,
    damage: str,
) -> None:
    root, store = _lake(tmp_path)
    parent_bundle = _bundle("damaged_parent")
    parent_digest = store.publish(parent_bundle)
    partition = root / parent_bundle.manifest.partition.relative_path
    if damage == "missing":
        partition.unlink()
    elif damage == "corrupt":
        corrupted = bytearray(partition.read_bytes())
        corrupted[len(corrupted) // 2] ^= 1
        partition.chmod(0o600)
        partition.write_bytes(corrupted)
    else:
        saved = tmp_path / "saved-parent.parquet"
        partition.rename(saved)
        partition.symlink_to(saved)
    parent = ParentRevisionV1(DATASET_ID, "damaged_parent", parent_digest)
    child = _bundle(
        "child_of_damaged_parent",
        parent=parent,
        parent_artifacts=(parent_bundle.manifest.partition.artifact_digest,),
    )

    with pytest.raises(LakeStoreError, match="parent revision is not completely valid"):
        store.publish(child)


def test_publish_rejects_bad_bundle_manifest_and_payload(tmp_path: Path) -> None:
    _root, store = _lake(tmp_path)
    bundle = _bundle()
    with pytest.raises(ContractValueError, match="requires PartitionBundleV1"):
        store.publish(cast(PartitionBundleV1, object()))
    with pytest.raises(LakeStoreError, match="bundle manifest is invalid"):
        store.publish(replace(bundle, manifest_bytes=b"{}"))

    other = _bundle("other")
    with pytest.raises(LakeStoreError, match="canonical manifest bytes disagree"):
        store.publish(replace(bundle, manifest=other.manifest))

    corrupted = bytearray(bundle.partition_bytes)
    corrupted[len(corrupted) // 2] ^= 1
    with pytest.raises(LakeIntegrityError):
        store.publish(replace(bundle, partition_bytes=bytes(corrupted)))


def test_publish_rejects_missing_revision_directory_and_partition_escape(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root, store = _lake(tmp_path)
    real_open = os.open

    def fail_revision_open(path: object, flags: int, *args: object, **kwargs: object) -> int:
        if path == "skip_revision" and flags & getattr(os, "O_DIRECTORY", 0):
            raise OSError("simulated safe revision open failure")
        return real_open(path, flags, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(os, "open", fail_revision_open)
    with pytest.raises(LakeStoreError, match="could not be opened safely"):
        store.publish(_bundle("skip_revision"))


def test_publish_rechecks_partition_path_even_if_manifest_parser_is_compromised(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root, store = _lake(tmp_path)
    bundle = _bundle("forged_publish_path")
    object.__setattr__(bundle.manifest.partition, "relative_path", "outside.parquet")
    monkeypatch.setattr(
        DatasetRevisionManifestV1,
        "from_bytes",
        classmethod(lambda _cls, _raw: bundle.manifest),
    )
    monkeypatch.setattr(store_module, "validate_partition_bundle", lambda *_args, **_kwargs: None)

    with pytest.raises(LakeStoreError, match="partition path is outside its revision"):
        store.publish(bundle)


def test_publish_wraps_revision_directory_creation_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root, store = _lake(tmp_path)
    real_mkdir = os.mkdir

    def fail_revision_mkdir(path: object, *args: object, **kwargs: object) -> None:
        if path == "mkdir_failure":
            raise PermissionError("simulated revision mkdir denial")
        real_mkdir(path, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(os, "mkdir", fail_revision_mkdir)
    with pytest.raises(LakeStoreError, match="revision directory could not be created safely"):
        store.publish(_bundle("mkdir_failure"))


def test_manifest_write_os_failure_leaves_payload_only_incomplete_revision(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, store = _lake(tmp_path)
    bundle = _bundle("incomplete")
    real_write = store_module._write_staged_at
    writes = 0

    def fail_second_write(directory_fd: int, name: str, raw: bytes) -> int:
        nonlocal writes
        writes += 1
        if writes == 2:
            raise OSError("simulated manifest write failure")
        return real_write(directory_fd, name, raw)

    monkeypatch.setattr(store_module, "_write_staged_at", fail_second_write)
    with pytest.raises(LakeStoreError, match="manifest-last publication failed"):
        store.publish(bundle)

    revision = _revision_path(root, "incomplete")
    assert bundle.manifest.partition.relative_path
    assert (root / bundle.manifest.partition.relative_path).is_file()
    assert not (revision / "manifest.json").exists()
    assert store.revision_state(DATASET_ID, "incomplete") is RevisionState.INCOMPLETE


def test_payload_pending_name_replacement_is_detected_before_manifest_commit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, store = _lake(tmp_path)
    bundle = _bundle("payload_pending_race")
    real_link = os.link
    raced = False

    def replace_payload_pending(
        src: str,
        dst: str,
        *,
        src_dir_fd: int | None = None,
        dst_dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> None:
        nonlocal raced
        if src.startswith(".") and src.endswith(".pending") and not raced:
            assert src_dir_fd is not None
            os.unlink(src, dir_fd=src_dir_fd)
            hostile_fd = os.open(
                src,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=src_dir_fd,
            )
            try:
                os.write(hostile_fd, b"MALICIOUS")
            finally:
                os.close(hostile_fd)
            raced = True
        real_link(
            src,
            dst,
            src_dir_fd=src_dir_fd,
            dst_dir_fd=dst_dir_fd,
            follow_symlinks=follow_symlinks,
        )

    monkeypatch.setattr(os, "link", replace_payload_pending)
    with pytest.raises(LakeStoreError, match="revision remains incomplete"):
        store.publish(bundle)

    assert raced
    revision = _revision_path(root, "payload_pending_race")
    assert not (revision / "manifest.json").exists()
    assert store.revision_state(DATASET_ID, "payload_pending_race") is RevisionState.INCOMPLETE


def test_manifest_pending_name_replacement_is_indeterminate_and_corrupt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root, store = _lake(tmp_path)
    bundle = _bundle("manifest_pending_race")
    real_link = os.link
    raced = False

    def replace_manifest_pending(
        src: str,
        dst: str,
        *,
        src_dir_fd: int | None = None,
        dst_dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> None:
        nonlocal raced
        if src == "manifest.pending" and not raced:
            assert src_dir_fd is not None
            os.unlink(src, dir_fd=src_dir_fd)
            hostile_fd = os.open(
                src,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=src_dir_fd,
            )
            try:
                os.write(hostile_fd, b"MALICIOUS")
            finally:
                os.close(hostile_fd)
            raced = True
        real_link(
            src,
            dst,
            src_dir_fd=src_dir_fd,
            dst_dir_fd=dst_dir_fd,
            follow_symlinks=follow_symlinks,
        )

    monkeypatch.setattr(os, "link", replace_manifest_pending)
    with pytest.raises(LakeStoreError, match="outcome is indeterminate"):
        store.publish(bundle)

    assert raced
    assert (
        store.revision_state(
            DATASET_ID,
            "manifest_pending_race",
            expected_manifest_digest=bundle.expected_manifest_digest,
        )
        is RevisionState.CORRUPT
    )


def test_precreated_exact_final_manifest_marker_is_reported_indeterminate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root, store = _lake(tmp_path)
    bundle = _bundle("precreated_exact_marker")
    real_link = os.link
    raced = False

    def precreate_final_marker(
        src: str,
        dst: str,
        *,
        src_dir_fd: int | None = None,
        dst_dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> None:
        nonlocal raced
        if src == "manifest.pending" and not raced:
            assert dst_dir_fd is not None
            marker_fd = os.open(
                dst,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o400,
                dir_fd=dst_dir_fd,
            )
            try:
                os.write(marker_fd, bundle.manifest_bytes)
                os.fsync(marker_fd)
            finally:
                os.close(marker_fd)
            raced = True
        real_link(
            src,
            dst,
            src_dir_fd=src_dir_fd,
            dst_dir_fd=dst_dir_fd,
            follow_symlinks=follow_symlinks,
        )

    monkeypatch.setattr(os, "link", precreate_final_marker)
    with pytest.raises(LakeStoreError, match="outcome is indeterminate"):
        store.publish(bundle)

    assert raced
    assert (
        store.revision_state(
            DATASET_ID,
            "precreated_exact_marker",
            expected_manifest_digest=bundle.expected_manifest_digest,
        )
        is RevisionState.COMMITTED
    )


def test_post_link_fsync_failure_reports_indeterminate_but_anchor_resolves_commit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, store = _lake(tmp_path)
    bundle = _bundle("post_link_fsync")
    marker = _revision_path(root, "post_link_fsync") / "manifest.json"
    real_fsync = os.fsync

    def fail_after_marker_link(descriptor: int) -> None:
        if marker.exists():
            raise OSError("simulated durability acknowledgement failure")
        real_fsync(descriptor)

    monkeypatch.setattr(os, "fsync", fail_after_marker_link)
    with pytest.raises(LakeStoreError, match="outcome is indeterminate"):
        store.publish(bundle)

    monkeypatch.setattr(os, "fsync", real_fsync)
    assert marker.is_file()
    assert (
        store.revision_state(
            DATASET_ID,
            "post_link_fsync",
            expected_manifest_digest=bundle.expected_manifest_digest,
        )
        is RevisionState.COMMITTED
    )
    validated = store.read(
        DATASET_ID,
        "post_link_fsync",
        expected_manifest_digest=bundle.expected_manifest_digest,
    )
    assert validated.manifest == bundle.manifest


def test_fd_relative_publication_cannot_follow_a_concurrent_parent_symlink_swap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, store = _lake(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    real_open_chain = store_module._open_directory_chain_at
    swapped = False

    def swap_after_verified_open(
        start_fd: int,
        parts: tuple[str, ...],
        *,
        create: bool,
    ) -> int:
        nonlocal swapped
        descriptor = real_open_chain(start_fd, parts, create=create)
        if create and parts and parts[0] == "partitions" and not swapped:
            parent = _revision_path(root, "race_safe").joinpath(*parts)
            verified = parent.with_name(f"{parent.name}.verified")
            parent.rename(verified)
            parent.symlink_to(outside, target_is_directory=True)
            swapped = True
        return descriptor

    monkeypatch.setattr(store_module, "_open_directory_chain_at", swap_after_verified_open)
    bundle = _bundle("race_safe")
    with pytest.raises(LakeStoreError, match="manifest-last publication failed"):
        store.publish(bundle)

    assert swapped
    assert not list(outside.iterdir())
    assert store.revision_state(DATASET_ID, "race_safe") is RevisionState.INCOMPLETE
    assert not (_revision_path(root, "race_safe") / "manifest.json").exists()


def test_store_holds_the_verified_root_inode_across_path_replacement(tmp_path: Path) -> None:
    root, store = _lake(tmp_path)
    verified_root = tmp_path / "verified-root"
    outside = tmp_path / "outside-root"
    outside.mkdir()
    root.rename(verified_root)
    root.symlink_to(outside, target_is_directory=True)

    bundle = _bundle("root_inode")
    store.publish(bundle)

    assert not list(outside.iterdir())
    assert (verified_root / bundle.manifest.partition.relative_path).is_file()


def test_read_rejects_invalid_identity_diverted_path_and_corrupt_partition(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, store = _lake(tmp_path)

    invalid_bytes = b"{}"
    invalid_revision = _revision_path(root, "invalid")
    invalid_revision.mkdir(parents=True)
    (invalid_revision / "manifest.json").write_bytes(invalid_bytes)
    with pytest.raises(LakeIntegrityError, match="manifest validation failed"):
        store.read(
            DATASET_ID,
            "invalid",
            expected_manifest_digest=sha256_digest(invalid_bytes),
        )

    other = _bundle("other")
    requested = _revision_path(root, "requested")
    requested.mkdir(parents=True)
    (requested / "manifest.json").write_bytes(other.manifest_bytes)
    with pytest.raises(LakeIntegrityError, match="revision identities differ"):
        store.read(
            DATASET_ID,
            "requested",
            expected_manifest_digest=other.expected_manifest_digest,
        )

    good = _bundle("good")
    good_digest = store.publish(good)
    partition_path = root / good.manifest.partition.relative_path
    corrupted = bytearray(partition_path.read_bytes())
    corrupted[len(corrupted) // 2] ^= 1
    partition_path.chmod(0o600)
    partition_path.write_bytes(corrupted)
    with pytest.raises(LakeIntegrityError, match="partition SHA-256 mismatch"):
        store.read(DATASET_ID, "good", expected_manifest_digest=good_digest)


def test_read_rechecks_partition_path_even_if_manifest_parser_is_compromised(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root, store = _lake(tmp_path)
    bundle = _bundle("forged_read_path")
    digest = store.publish(bundle)
    object.__setattr__(bundle.manifest.partition, "relative_path", "outside.parquet")
    monkeypatch.setattr(
        DatasetRevisionManifestV1,
        "from_bytes",
        classmethod(lambda _cls, _raw: bundle.manifest),
    )

    with pytest.raises(LakeIntegrityError, match="manifested partition path is outside"):
        store.read(DATASET_ID, "forged_read_path", expected_manifest_digest=digest)


def test_read_rejects_symlinked_partition_as_unsafe_artifact(tmp_path: Path) -> None:
    root, store = _lake(tmp_path)
    bundle = _bundle("symlinked_partition")
    digest = store.publish(bundle)
    partition = root / bundle.manifest.partition.relative_path
    saved = tmp_path / "saved.parquet"
    partition.rename(saved)
    partition.symlink_to(saved)

    with pytest.raises(LakeStoreError, match="unsafe or cannot be opened"):
        store.read(DATASET_ID, "symlinked_partition", expected_manifest_digest=digest)


def test_read_rejects_symlinked_partition_directory_chain(tmp_path: Path) -> None:
    root, store = _lake(tmp_path)
    bundle = _bundle("symlinked_partition_directory")
    digest = store.publish(bundle)
    partition_directory = (root / bundle.manifest.partition.relative_path).parent
    saved_directory = tmp_path / "saved-partition-directory"
    partition_directory.rename(saved_directory)
    partition_directory.symlink_to(saved_directory, target_is_directory=True)

    with pytest.raises(LakeStoreError, match="partition directory chain is absent or unsafe"):
        store.read(
            DATASET_ID,
            "symlinked_partition_directory",
            expected_manifest_digest=digest,
        )


def test_revision_state_rejects_unsafe_ids_and_reports_corruption(tmp_path: Path) -> None:
    root, store = _lake(tmp_path)
    with pytest.raises(ContractValueError, match="strict ASCII path segment"):
        store.revision_state("..", "rev1")

    corrupt_revision = _revision_path(root, "not_directory")
    corrupt_revision.parent.mkdir(parents=True)
    corrupt_revision.write_bytes(b"not a directory")
    assert store.revision_state(DATASET_ID, "not_directory") is RevisionState.CORRUPT

    malformed_revision = _revision_path(root, "malformed_manifest")
    malformed_revision.mkdir(parents=True)
    (malformed_revision / "manifest.json").write_bytes(b"{}")
    assert store.revision_state(DATASET_ID, "malformed_manifest") is RevisionState.CORRUPT

    empty_revision = _revision_path(root, "empty_manifest")
    empty_revision.mkdir(parents=True)
    (empty_revision / "manifest.json").touch()
    assert store.revision_state(DATASET_ID, "empty_manifest") is RevisionState.CORRUPT

    bundle = _bundle("committed")
    store.publish(bundle)
    assert (
        store.revision_state(
            DATASET_ID,
            "committed",
            expected_manifest_digest=_digest("wrong-anchor"),
        )
        is RevisionState.CORRUPT
    )


def test_fixed_query_rejects_raw_objects_before_opening_duckdb(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opened = False

    def should_not_open() -> Any:
        nonlocal opened
        opened = True
        raise AssertionError("DuckDB must not open")

    monkeypatch.setattr(query_module, "_open_hardened_connection", should_not_open)
    valid_query = FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=1)
    with pytest.raises(ContractValueError, match="validator-returned"):
        run_fixed_query(cast(ValidatedEvidenceTableV1, object()), valid_query)
    with pytest.raises(ContractValueError, match="never SQL"):
        run_fixed_query(_validated(), cast(FixedQueryV1, "SELECT 1"))
    assert not opened


def test_fixed_query_rejects_uninitialized_validated_wrapper_subclass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ForgedValidated(ValidatedEvidenceTableV1):
        __slots__ = ()

        def _arrow_table_for_fixed_query(self) -> Any:
            return object()

    opened = False

    def should_not_open() -> Any:
        nonlocal opened
        opened = True
        raise AssertionError("DuckDB must not open")

    monkeypatch.setattr(query_module, "_open_hardened_connection", should_not_open)
    forged = object.__new__(ForgedValidated)
    with pytest.raises(ContractValueError, match="validator-returned"):
        run_fixed_query(
            cast(ValidatedEvidenceTableV1, forged),
            FixedQueryV1(kind=QueryKind.QUALITY_COUNTS, limit=1),
        )
    assert not opened
