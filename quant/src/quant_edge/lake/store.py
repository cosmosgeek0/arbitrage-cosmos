from __future__ import annotations

import os
import stat
from contextlib import suppress
from enum import StrEnum
from pathlib import Path, PurePosixPath

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.lake.contracts import DigestV1, require_path_segment
from quant_edge.lake.manifest import DatasetRevisionManifestV1, RevisionKind, sha256_digest
from quant_edge.lake.parquet import (
    LakeIntegrityError,
    PartitionBundleV1,
    ValidatedEvidenceTableV1,
    validate_partition_bundle,
)


class LakeStoreError(QuantEdgeError):
    """Raised when immutable filesystem publication or access fails closed."""


class RevisionState(StrEnum):
    ABSENT = "ABSENT"
    INCOMPLETE = "INCOMPLETE"
    UNVERIFIED = "UNVERIFIED"
    COMMITTED = "COMMITTED"
    CORRUPT = "CORRUPT"


def _is_real_directory(path: Path) -> bool:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    return stat.S_ISDIR(mode) and not path.is_symlink()


_DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)


def _write_staged_at(directory_fd: int, name: str, raw: bytes) -> int:
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        raise LakeStoreError("exclusive file name is unsafe")
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(name, flags, 0o600, dir_fd=directory_fd)
    try:
        view = memoryview(raw)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise LakeStoreError("exclusive write made no progress")
            view = view[written:]
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def _write_exclusive_at(directory_fd: int, name: str, raw: bytes) -> None:
    descriptor = _write_staged_at(directory_fd, name, raw)
    os.close(descriptor)


def _read_descriptor_exact(descriptor: int, expected_size: int) -> bytes:
    chunks: list[bytes] = []
    offset = 0
    remaining = expected_size + 1
    while True:
        chunk = os.pread(descriptor, min(65_536, remaining), offset)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        offset += len(chunk)
        remaining -= len(chunk)
        if remaining == 0:
            return b"".join(chunks)


def _verify_linked_artifact_at(
    directory_fd: int,
    final_name: str,
    staged_descriptor: int,
    expected_raw: bytes,
) -> None:
    try:
        final_descriptor = os.open(
            final_name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
    except OSError as error:
        raise LakeStoreError("linked immutable artifact cannot be opened safely") from error
    try:
        staged_before = os.fstat(staged_descriptor)
        final_before = os.fstat(final_descriptor)
        expected_identity = (staged_before.st_dev, staged_before.st_ino)
        if (
            not stat.S_ISREG(staged_before.st_mode)
            or not stat.S_ISREG(final_before.st_mode)
            or (final_before.st_dev, final_before.st_ino) != expected_identity
            or staged_before.st_size != len(expected_raw)
            or final_before.st_size != len(expected_raw)
        ):
            raise LakeStoreError("linked immutable artifact identity or size mismatch")
        if (
            _read_descriptor_exact(staged_descriptor, len(expected_raw)) != expected_raw
            or _read_descriptor_exact(final_descriptor, len(expected_raw)) != expected_raw
        ):
            raise LakeStoreError("linked immutable artifact content mismatch")
        staged_after = os.fstat(staged_descriptor)
        final_after = os.fstat(final_descriptor)
        if (staged_after.st_dev, staged_after.st_ino, staged_after.st_size) != (
            staged_before.st_dev,
            staged_before.st_ino,
            staged_before.st_size,
        ) or (final_after.st_dev, final_after.st_ino, final_after.st_size) != (
            final_before.st_dev,
            final_before.st_ino,
            final_before.st_size,
        ):
            raise LakeStoreError("linked immutable artifact changed during verification")
    finally:
        os.close(final_descriptor)


def _read_bounded_regular_at(directory_fd: int, name: str, *, maximum: int) -> bytes:
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        raise LakeStoreError("immutable artifact name is unsafe")
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
    except FileNotFoundError as error:
        raise LakeStoreError(f"required immutable artifact is absent: {name}") from error
    except OSError as error:
        raise LakeStoreError(f"immutable artifact is unsafe or cannot be opened: {name}") from error
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise LakeStoreError(f"immutable artifact is not a real regular file: {name}")
        if info.st_size <= 0 or info.st_size > maximum:
            raise LakeStoreError(f"immutable artifact has invalid bounded size: {name}")
        chunks: list[bytes] = []
        remaining = maximum + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        if (
            after.st_dev != info.st_dev
            or after.st_ino != info.st_ino
            or after.st_size != info.st_size
            or len(raw) != info.st_size
            or len(raw) > maximum
        ):
            raise LakeStoreError("immutable artifact changed or exceeded its bound while reading")
        return raw
    finally:
        os.close(descriptor)


def _open_directory_chain_at(
    start_fd: int,
    parts: tuple[str, ...],
    *,
    create: bool,
) -> int:
    current = os.dup(start_fd)
    try:
        for part in parts:
            require_path_segment(part, field="directory component")
            if create:
                created = False
                try:
                    os.mkdir(part, 0o700, dir_fd=current)
                    created = True
                except FileExistsError:
                    pass
                if created:
                    os.fsync(current)
            next_fd = os.open(part, _DIRECTORY_FLAGS, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise


def _directory_identity(descriptor: int) -> tuple[int, int]:
    info = os.fstat(descriptor)
    if not stat.S_ISDIR(info.st_mode):
        raise LakeStoreError("opened directory descriptor changed type")
    return info.st_dev, info.st_ino


def _verify_directory_chain_identity(
    revision_parent_fd: int,
    revision_id: str,
    revision_identity: tuple[int, int],
    partition_parts: tuple[str, ...],
    partition_identity: tuple[int, int],
) -> None:
    revision_fd = os.open(revision_id, _DIRECTORY_FLAGS, dir_fd=revision_parent_fd)
    try:
        if _directory_identity(revision_fd) != revision_identity:
            raise LakeStoreError("revision directory identity changed during publication")
        partition_fd = _open_directory_chain_at(revision_fd, partition_parts, create=False)
        try:
            if _directory_identity(partition_fd) != partition_identity:
                raise LakeStoreError("partition directory identity changed during publication")
        finally:
            os.close(partition_fd)
    finally:
        os.close(revision_fd)


class ImmutableLakeStore:
    """Explicit manifest-last store; construction and methods perform bounded local I/O."""

    def __init__(self, root: Path) -> None:
        if not isinstance(root, Path) or not root.is_absolute():
            raise ContractValueError("lake root must be an absolute pathlib.Path")
        if not _is_real_directory(root):
            raise LakeStoreError("lake root must pre-exist as a non-symlink directory")
        before = root.lstat()
        descriptor = os.open(root, _DIRECTORY_FLAGS)
        opened = os.fstat(descriptor)
        if opened.st_dev != before.st_dev or opened.st_ino != before.st_ino:
            os.close(descriptor)
            raise LakeStoreError("lake root changed while opening")
        self._root_fd = descriptor

    def __del__(self) -> None:
        with suppress(OSError):
            self.close()

    def __enter__(self) -> ImmutableLakeStore:
        if self._root_fd < 0:
            raise LakeStoreError("lake root descriptor is closed")
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()

    def close(self) -> None:
        descriptor = getattr(self, "_root_fd", -1)
        if descriptor >= 0:
            os.close(descriptor)
            self._root_fd = -1

    def _require_open(self) -> None:
        if self._root_fd < 0:
            raise LakeStoreError("lake root descriptor is closed")

    def _open_chain(self, parts: tuple[str, ...], *, create: bool = False) -> int:
        if self._root_fd < 0:
            raise LakeStoreError("lake root descriptor is closed")
        try:
            return _open_directory_chain_at(self._root_fd, parts, create=create)
        except (FileNotFoundError, NotADirectoryError, OSError) as error:
            raise LakeStoreError("directory chain is absent, unsafe or not a directory") from error

    def _revision_parts(self, dataset_id: str, revision_id: str) -> tuple[str, ...]:
        dataset = require_path_segment(dataset_id, field="dataset_id")
        revision = require_path_segment(revision_id, field="revision_id")
        return ("datasets", dataset, "revisions", revision)

    def _validate_parent(self, manifest: DatasetRevisionManifestV1) -> None:
        if manifest.revision_kind is RevisionKind.INITIAL:
            return
        parent = manifest.parent_revisions[0]
        parent_fd = self._open_chain(self._revision_parts(parent.dataset_id, parent.revision_id))
        try:
            raw = _read_bounded_regular_at(parent_fd, "manifest.json", maximum=1_048_576)
        finally:
            os.close(parent_fd)
        if sha256_digest(raw) != parent.manifest_digest:
            raise LakeStoreError("parent manifest digest does not match immutable lineage")
        try:
            parsed = DatasetRevisionManifestV1.from_bytes(raw)
        except QuantEdgeError as error:
            raise LakeStoreError(f"parent manifest is invalid: {error}") from error
        if (parsed.dataset_id, parsed.revision_id) != (parent.dataset_id, parent.revision_id):
            raise LakeStoreError("parent manifest identity mismatch")
        if manifest.published_at_ns < parsed.published_at_ns:
            raise LakeStoreError("correction publication cannot precede its parent revision")
        if parsed.partition.artifact_digest not in manifest.partition.parent_artifact_digests:
            raise LakeStoreError("correction does not bind its parent partition artifact")
        try:
            self.read(
                parent.dataset_id,
                parent.revision_id,
                expected_manifest_digest=parent.manifest_digest,
            )
        except QuantEdgeError as error:
            raise LakeStoreError(f"parent revision is not completely valid: {error}") from error

    def publish(self, bundle: PartitionBundleV1) -> DigestV1:
        self._require_open()
        if not isinstance(bundle, PartitionBundleV1):
            raise ContractValueError("publish requires PartitionBundleV1")
        try:
            parsed = DatasetRevisionManifestV1.from_bytes(bundle.manifest_bytes)
        except QuantEdgeError as error:
            raise LakeStoreError(f"bundle manifest is invalid: {error}") from error
        if parsed != bundle.manifest:
            raise LakeStoreError("bundle object and canonical manifest bytes disagree")
        expected_digest = sha256_digest(bundle.manifest_bytes)
        validate_partition_bundle(
            bundle.partition_bytes,
            bundle.manifest_bytes,
            expected_manifest_digest=expected_digest,
        )
        self._validate_parent(parsed)

        revision_parent_fd = self._open_chain(
            ("datasets", parsed.dataset_id, "revisions"),
            create=True,
        )
        revision_fd = -1
        partition_directory_fd = -1
        partition_staged_fd = -1
        manifest_staged_fd = -1
        try:
            try:
                os.mkdir(parsed.revision_id, 0o700, dir_fd=revision_parent_fd)
                os.fsync(revision_parent_fd)
            except FileExistsError as error:
                raise LakeStoreError("revision ID already exists and is immutable") from error
            except OSError as error:
                raise LakeStoreError("revision directory could not be created safely") from error
            try:
                revision_fd = os.open(
                    parsed.revision_id,
                    _DIRECTORY_FLAGS,
                    dir_fd=revision_parent_fd,
                )
            except OSError as error:
                raise LakeStoreError("new revision directory could not be opened safely") from error
            revision_identity = _directory_identity(revision_fd)
            partition_parts = PurePosixPath(parsed.partition.relative_path).parts
            expected_prefix = ("datasets", parsed.dataset_id, "revisions", parsed.revision_id)
            if partition_parts[:4] != expected_prefix or len(partition_parts) < 6:
                raise LakeStoreError("partition path is outside its revision")
            commit_marker_link_attempted = False
            try:
                partition_directory_fd = _open_directory_chain_at(
                    revision_fd,
                    tuple(partition_parts[4:-1]),
                    create=True,
                )
                partition_identity = _directory_identity(partition_directory_fd)
                partition_name = partition_parts[-1]
                partition_pending = f".{partition_name}.pending"
                partition_staged_fd = _write_staged_at(
                    partition_directory_fd,
                    partition_pending,
                    bundle.partition_bytes,
                )
                os.link(
                    partition_pending,
                    partition_name,
                    src_dir_fd=partition_directory_fd,
                    dst_dir_fd=partition_directory_fd,
                    follow_symlinks=False,
                )
                _verify_linked_artifact_at(
                    partition_directory_fd,
                    partition_name,
                    partition_staged_fd,
                    bundle.partition_bytes,
                )
                os.unlink(partition_pending, dir_fd=partition_directory_fd)
                os.fsync(partition_directory_fd)
                _verify_directory_chain_identity(
                    revision_parent_fd,
                    parsed.revision_id,
                    revision_identity,
                    tuple(partition_parts[4:-1]),
                    partition_identity,
                )
                manifest_staged_fd = _write_staged_at(
                    revision_fd,
                    "manifest.pending",
                    bundle.manifest_bytes,
                )
                commit_marker_link_attempted = True
                os.link(
                    "manifest.pending",
                    "manifest.json",
                    src_dir_fd=revision_fd,
                    dst_dir_fd=revision_fd,
                    follow_symlinks=False,
                )
                _verify_linked_artifact_at(
                    revision_fd,
                    "manifest.json",
                    manifest_staged_fd,
                    bundle.manifest_bytes,
                )
                os.unlink("manifest.pending", dir_fd=revision_fd)
                os.fsync(revision_fd)
                _verify_directory_chain_identity(
                    revision_parent_fd,
                    parsed.revision_id,
                    revision_identity,
                    tuple(partition_parts[4:-1]),
                    partition_identity,
                )
                final_partition_fd = _open_directory_chain_at(
                    revision_fd,
                    tuple(partition_parts[4:-1]),
                    create=False,
                )
                try:
                    _verify_linked_artifact_at(
                        final_partition_fd,
                        partition_name,
                        partition_staged_fd,
                        bundle.partition_bytes,
                    )
                finally:
                    os.close(final_partition_fd)
                _verify_linked_artifact_at(
                    revision_fd,
                    "manifest.json",
                    manifest_staged_fd,
                    bundle.manifest_bytes,
                )
            except (FileExistsError, OSError, LakeStoreError) as error:
                if commit_marker_link_attempted:
                    raise LakeStoreError(
                        "manifest commit outcome is indeterminate; verify anchored revision state"
                    ) from error
                raise LakeStoreError(
                    "manifest-last publication failed; revision remains incomplete and non-reusable"
                ) from error
        finally:
            if manifest_staged_fd >= 0:
                os.close(manifest_staged_fd)
            if partition_staged_fd >= 0:
                os.close(partition_staged_fd)
            if partition_directory_fd >= 0:
                os.close(partition_directory_fd)
            if revision_fd >= 0:
                os.close(revision_fd)
            os.close(revision_parent_fd)
        return expected_digest

    def read(
        self,
        dataset_id: str,
        revision_id: str,
        *,
        expected_manifest_digest: DigestV1,
    ) -> ValidatedEvidenceTableV1:
        self._require_open()
        revision_fd = self._open_chain(self._revision_parts(dataset_id, revision_id))
        try:
            manifest_bytes = _read_bounded_regular_at(
                revision_fd,
                "manifest.json",
                maximum=1_048_576,
            )
        finally:
            os.close(revision_fd)
        if sha256_digest(manifest_bytes) != expected_manifest_digest:
            raise LakeIntegrityError("external manifest trust anchor mismatch")
        try:
            manifest = DatasetRevisionManifestV1.from_bytes(manifest_bytes)
        except QuantEdgeError as error:
            raise LakeIntegrityError(f"manifest validation failed: {error}") from error
        if (manifest.dataset_id, manifest.revision_id) != (dataset_id, revision_id):
            raise LakeIntegrityError("requested and manifested revision identities differ")
        partition_parts = PurePosixPath(manifest.partition.relative_path).parts
        expected_prefix = ("datasets", dataset_id, "revisions", revision_id)
        if partition_parts[:4] != expected_prefix or len(partition_parts) < 6:
            raise LakeIntegrityError("manifested partition path is outside revision")
        revision_fd = self._open_chain(expected_prefix)
        try:
            partition_directory_fd = _open_directory_chain_at(
                revision_fd,
                tuple(partition_parts[4:-1]),
                create=False,
            )
        except OSError as error:
            os.close(revision_fd)
            raise LakeStoreError("partition directory chain is absent or unsafe") from error
        try:
            partition_bytes = _read_bounded_regular_at(
                partition_directory_fd,
                partition_parts[-1],
                maximum=manifest.partition.byte_count,
            )
        finally:
            os.close(partition_directory_fd)
            os.close(revision_fd)
        return validate_partition_bundle(
            partition_bytes,
            manifest_bytes,
            expected_manifest_digest=expected_manifest_digest,
        )

    def revision_state(
        self,
        dataset_id: str,
        revision_id: str,
        *,
        expected_manifest_digest: DigestV1 | None = None,
    ) -> RevisionState:
        self._require_open()
        try:
            revision_fd = self._open_chain(self._revision_parts(dataset_id, revision_id))
        except LakeStoreError as error:
            cause = error.__cause__
            if isinstance(cause, FileNotFoundError):
                return RevisionState.ABSENT
            return RevisionState.CORRUPT
        try:
            try:
                manifest_info = os.stat(
                    "manifest.json",
                    dir_fd=revision_fd,
                    follow_symlinks=False,
                )
            except FileNotFoundError:
                return RevisionState.INCOMPLETE
            if not stat.S_ISREG(manifest_info.st_mode):
                return RevisionState.CORRUPT
            try:
                manifest_bytes = _read_bounded_regular_at(
                    revision_fd,
                    "manifest.json",
                    maximum=1_048_576,
                )
            except QuantEdgeError:
                return RevisionState.CORRUPT
        finally:
            os.close(revision_fd)
        local_digest = sha256_digest(manifest_bytes)
        try:
            self.read(dataset_id, revision_id, expected_manifest_digest=local_digest)
        except QuantEdgeError:
            return RevisionState.CORRUPT
        if expected_manifest_digest is None:
            return RevisionState.UNVERIFIED
        if local_digest != expected_manifest_digest:
            return RevisionState.CORRUPT
        return RevisionState.COMMITTED
