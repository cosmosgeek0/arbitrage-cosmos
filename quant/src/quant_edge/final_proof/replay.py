"""Q17 deterministic replay, corruption, and fail-closed inference proof.

This module composes the accepted Q04 replay and Q16 inference owners.  It does
not reimplement order-book, feature, model, calibration, or protocol behavior.
All time and filesystem roots are explicit inputs; the bytes-level builder is
pure and repeatable.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
from dataclasses import replace
from pathlib import Path, PurePosixPath
from typing import Final, cast

from quant_edge.book.engine import (
    BookAnomalyKind,
    BookAnomalyV1,
    DeltaDisposition,
    DeltaDispositionV1,
    QualityTransitionV1,
)
from quant_edge.book.replay import ReplayScriptV1, run_replay, script_from_mapping
from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.inference.artifacts import build_serving_manifest, load_serving_lineage
from quant_edge.inference.contracts import ServingLineageV1
from quant_edge.inference.pipeline import PipelineResultV1, run_inference_pipeline
from quant_edge.inference.protocol import (
    FROZEN_SCHEMA_SHA256,
    ProtocolBoundaryError,
    ProtocolContractV1,
    protocol_digest,
    protocol_json_bytes,
    strict_json_object,
)


class ReplayProofError(QuantEdgeError):
    """Replay proof input, golden identity, or fail-closed invariant failed."""


MAX_PROOF_INPUT_BYTES: Final = 262_144
_READ_CHUNK_BYTES: Final = 65_536
_MAX_ANCESTOR_DEPTH: Final = 256
_DIRECTORY_OPEN_FLAGS: Final = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_READ_OPEN_FLAGS: Final = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
_EXCLUSIVE_COPY_FLAGS: Final = (
    os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
)
FIXTURE_RELATIVE_PATH: Final = "fixtures/q16_raw_fixture_v1.json"
REQUEST_RELATIVE_PATH: Final = "generated/q16/request_assess.v1.json"
ASSESSMENT_RELATIVE_PATH: Final = "generated/q16/edge_assessment.v1.json"
CAMPAIGN_RELATIVE_PATH: Final = "generated/q16/inference_campaign.v1.json"
CORRUPT_COPY_NAME: Final = "q16_raw_fixture_v1.corrupt.json"

EXPECTED_FIXTURE_SHA256: Final = "0fa1b812d50d668301d25129efb1639a06a71824961f910d046c9935b8580a6f"
EXPECTED_CORRUPTED_FIXTURE_SHA256: Final = (
    "c604d73e2c395fd05b6c6a551532476a6c1cd6070f0632829a1bca199c7da117"
)
EXPECTED_REQUEST_SHA256: Final = "8812d64cd653052871d956ecd23222db9cc9d3bc847cc74d0a02db62142e0e4a"
EXPECTED_ASSESSMENT_SHA256: Final = (
    "10d4a858ac08c29b03ab3df6476b7eb6830359581d00791a229ccd765b369329"
)
EXPECTED_CAMPAIGN_SHA256: Final = "a66c2c1e4e500c90a7aa01a4c35144aed7d83735365f4130a5c66740196946b4"
EXPECTED_PIPELINE_SHA256: Final = "a48da64bd2fe055545c496595d01278cfc74f655f7fb334205162e8a07d4b1a9"
EXPECTED_Q04_REPLAY_SHA256: Final = (
    "57d9e8bf1c15cd6cfb14aa411fda3b5a49e2e39c71e79bcd1bee6731b2532e1d"
)
EXPECTED_Q04_GAP_PREFIX_SHA256: Final = (
    "bbd907587bb4db8af305c5158dcd68474c347fbea252c953f1cfa982be560903"
)
EXPECTED_EXPIRED_ASSESSMENT_SHA256: Final = (
    "dbb8f54a120981163cd61f4e472b7d1193e1e311ba2752d0db5e42a49bf8eaa5"
)
EXPECTED_AMBIGUOUS_ASSESSMENT_SHA256: Final = (
    "297b1ae3867124a04bf7ebb9d055f290a5c00025778d27bb49a490bd5f4ba72a"
)

EXPECTED_EVALUATION_TIME_MS: Final = 1_772_000_000_200
EXPECTED_EXPIRED_EVALUATION_TIME_MS: Final = 1_772_000_060_201
EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS: Final = 1_772_000_000_199

EXPECTED_STAGE_IDENTITIES: Final[tuple[tuple[str, str, str, tuple[str, ...]], ...]] = (
    (
        "RAW",
        "Q16RawInferenceFixtureV1",
        EXPECTED_FIXTURE_SHA256,
        (),
    ),
    (
        "EVIDENCE",
        "MarketEvidenceEnvelopeV1",
        "53f739ce494ad451764174660b207e1890d60b1f62dfef44cf5cf0b5835d639a",
        (EXPECTED_FIXTURE_SHA256,),
    ),
    (
        "FEATURES",
        "Q16FeatureSnapshotV1",
        "ae943d80b2a6d1c6f9e571e2fd397105fed3694575235e20db2d7c6891180833",
        ("53f739ce494ad451764174660b207e1890d60b1f62dfef44cf5cf0b5835d639a",),
    ),
    (
        "MODELS",
        "Q16VerifiedModelStateV1",
        "93b35bf8c2e63c0591dde99fdfea6ea77c350f10096027b6ce61420876f16dda",
        ("ae943d80b2a6d1c6f9e571e2fd397105fed3694575235e20db2d7c6891180833",),
    ),
    (
        "CALIBRATION",
        "Q16CalibrationStateV1",
        "0d246cae13dd0bc8be1d62fe06eae2bad00acfae0c8295ab2603831813e25f0e",
        ("93b35bf8c2e63c0591dde99fdfea6ea77c350f10096027b6ce61420876f16dda",),
    ),
    (
        "ASSESSMENT",
        "EdgeAssessmentEnvelopeV1",
        EXPECTED_ASSESSMENT_SHA256,
        ("0d246cae13dd0bc8be1d62fe06eae2bad00acfae0c8295ab2603831813e25f0e",),
    ),
)

EXPECTED_BLOCKERS: Final[tuple[str, ...]] = (
    "CALIBRATION_UNAVAILABLE",
    "CHAMPION_PAYLOAD_UNAVAILABLE",
    "DEEP_DATA_INSUFFICIENT",
    "DUPLICATE_EVIDENCE_OBSERVED",
    "ECONOMIC_TRUTH_INCOMPLETE",
    "RECONSTRUCTED_EVIDENCE",
    "REGISTRY_POSTURE_ABSTAIN_UNKNOWN",
    "SOURCE_GAP_HISTORY",
)
EXPECTED_MUTATIONS: Final[tuple[str, ...]] = (
    "AMBIGUOUS_LINEAGE",
    "FIXTURE_VERSION",
    "FORWARD_GAP_SEQUENCE",
    "LIFECYCLE_TIMES",
    "SOURCE_FIXTURE_HASH",
)

_SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
_PROOF_FIELDS: Final = frozenset(
    {
        "assessmentEnvelope",
        "assessmentSummary",
        "faults",
        "posture",
        "protocolSchemaSha256",
        "repeatability",
        "schema",
        "status",
        "version",
    }
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ReplayProofError(message)


def _is_exact_bool(value: object, expected: bool) -> bool:
    return type(value) is bool and value is expected


def _is_exact_int(value: object, expected: int) -> bool:
    return type(value) is int and value == expected


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _require_sha256(value: object, *, field: str) -> str:
    _require(isinstance(value, str) and _SHA256_RE.fullmatch(value) is not None, field)
    return cast(str, value)


def _object(value: object, *, field: str) -> dict[str, object]:
    _require(isinstance(value, dict), f"{field} must be an object")
    return cast(dict[str, object], value)


def _array(value: object, *, field: str) -> list[object]:
    _require(isinstance(value, list), f"{field} must be an array")
    return cast(list[object], value)


def _parse(raw: bytes, *, field: str) -> dict[str, object]:
    _require(
        isinstance(raw, bytes) and 0 < len(raw) <= MAX_PROOF_INPUT_BYTES,
        f"{field} bytes are unavailable or exceed the bound",
    )
    try:
        return parse_canonical_object(raw)
    except QuantEdgeError as error:
        raise ReplayProofError(f"{field} bytes are not canonical JSON") from error


def _expected_bytes(raw: bytes, *, field: str, sha256: str) -> dict[str, object]:
    _require(_sha256(raw) == sha256, f"{field} differs from its committed Q16 digest")
    return _parse(raw, field=field)


def _expected_protocol_bytes(raw: bytes, *, field: str, sha256: str) -> dict[str, object]:
    _require(_sha256(raw) == sha256, f"{field} differs from its committed Q16 digest")
    try:
        return strict_json_object(raw, maximum_bytes=MAX_PROOF_INPUT_BYTES)
    except ProtocolBoundaryError as error:
        raise ReplayProofError(f"{field} bytes are not strict protocol JSON") from error


def _identity(info: os.stat_result) -> tuple[int, int]:
    return (info.st_dev, info.st_ino)


def _stable_file_snapshot(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        stat.S_IFMT(info.st_mode),
        info.st_nlink,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _open_real_directory(path: Path, *, field: str) -> int:
    _require(isinstance(path, Path) and path.is_absolute(), f"{field} must be absolute")
    descriptor = -1
    try:
        before = os.stat(path, follow_symlinks=False)
        descriptor = os.open(path, _DIRECTORY_OPEN_FLAGS)
        opened = os.fstat(descriptor)
        after = os.stat(path, follow_symlinks=False)
        _require(
            stat.S_ISDIR(before.st_mode)
            and stat.S_ISDIR(opened.st_mode)
            and stat.S_ISDIR(after.st_mode)
            and _identity(before) == _identity(opened) == _identity(after),
            f"{field} must be an identity-stable real directory",
        )
        result = descriptor
        descriptor = -1
        return result
    except OSError as error:
        raise ReplayProofError(
            f"{field} must be an identity-stable real directory; symlink or race rejected"
        ) from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _relative_parts(value: str) -> tuple[str, ...]:
    _require(
        isinstance(value, str)
        and bool(value)
        and "\\" not in value
        and "\x00" not in value
        and "://" not in value,
        "fixture path must be portable relative POSIX text",
    )
    path = PurePosixPath(value)
    parts = path.parts
    _require(
        not path.is_absolute()
        and bool(parts)
        and all(part not in ("", ".", "..") for part in parts)
        and str(path) == value,
        "fixture path contains traversal or normalization ambiguity",
    )
    return parts


def _close_descriptors(descriptors: tuple[int, ...] | list[int]) -> None:
    for descriptor in reversed(descriptors):
        os.close(descriptor)


def _open_directory_chain(
    root_descriptor: int,
    parts: tuple[str, ...],
    *,
    field: str,
) -> tuple[int, ...]:
    descriptors = [os.dup(root_descriptor)]
    try:
        for part in parts:
            parent = descriptors[-1]
            before = os.stat(part, dir_fd=parent, follow_symlinks=False)
            child = os.open(part, _DIRECTORY_OPEN_FLAGS, dir_fd=parent)
            descriptors.append(child)
            opened = os.fstat(child)
            after = os.stat(part, dir_fd=parent, follow_symlinks=False)
            _require(
                stat.S_ISDIR(before.st_mode)
                and stat.S_ISDIR(opened.st_mode)
                and stat.S_ISDIR(after.st_mode)
                and _identity(before) == _identity(opened) == _identity(after),
                f"{field} parent changed identity",
            )
        return tuple(descriptors)
    except OSError as error:
        _close_descriptors(descriptors)
        raise ReplayProofError(f"{field} parent symlink or race was rejected") from error
    except ReplayProofError:
        _close_descriptors(descriptors)
        raise


def _revalidate_directory_path(path: Path, descriptor: int, *, field: str) -> None:
    try:
        entry = os.stat(path, follow_symlinks=False)
        opened = os.fstat(descriptor)
        _require(
            stat.S_ISDIR(entry.st_mode)
            and stat.S_ISDIR(opened.st_mode)
            and entry.st_nlink > 0
            and opened.st_nlink > 0
            and _identity(entry) == _identity(opened),
            f"{field} root detached or changed identity",
        )
    except OSError as error:
        raise ReplayProofError(f"{field} root link could not be revalidated") from error


def _revalidate_directory_chain(
    descriptors: tuple[int, ...],
    parts: tuple[str, ...],
    *,
    field: str,
) -> None:
    _require(len(descriptors) == len(parts) + 1, f"{field} descriptor chain is malformed")
    try:
        for index, part in enumerate(parts):
            parent = descriptors[index]
            child = descriptors[index + 1]
            entry = os.stat(part, dir_fd=parent, follow_symlinks=False)
            opened = os.fstat(child)
            _require(
                stat.S_ISDIR(entry.st_mode)
                and stat.S_ISDIR(opened.st_mode)
                and entry.st_nlink > 0
                and opened.st_nlink > 0
                and _identity(entry) == _identity(opened),
                f"{field} parent-to-child link changed identity",
            )
    except OSError as error:
        raise ReplayProofError(f"{field} parent-to-child link could not be revalidated") from error


def _read_bounded_descriptor(descriptor: int, *, maximum_bytes: int, field: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = os.read(
            descriptor,
            min(_READ_CHUNK_BYTES, maximum_bytes - total + 1),
        )
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        _require(total <= maximum_bytes, f"{field} exceeds its byte bound")
    return b"".join(chunks)


def _safe_read(root: Path, relative_path: str, *, field: str) -> bytes:
    parts = _relative_parts(relative_path)
    root_descriptor = _open_real_directory(root, field=f"{field} root")
    directory_chain: tuple[int, ...] = ()
    file_descriptor = -1
    try:
        directory_chain = _open_directory_chain(
            root_descriptor,
            parts[:-1],
            field=field,
        )
        parent_descriptor = directory_chain[-1]
        before = os.stat(parts[-1], dir_fd=parent_descriptor, follow_symlinks=False)
        file_descriptor = os.open(
            parts[-1],
            _READ_OPEN_FLAGS,
            dir_fd=parent_descriptor,
        )
        opened = os.fstat(file_descriptor)
        entry_after_open = os.stat(
            parts[-1],
            dir_fd=parent_descriptor,
            follow_symlinks=False,
        )
        _require(
            stat.S_ISREG(before.st_mode)
            and stat.S_ISREG(opened.st_mode)
            and stat.S_ISREG(entry_after_open.st_mode)
            and opened.st_nlink == 1
            and _stable_file_snapshot(before) == _stable_file_snapshot(opened)
            and _stable_file_snapshot(opened) == _stable_file_snapshot(entry_after_open),
            f"{field} must be one identity-stable regular file",
        )
        _require(
            0 < opened.st_size <= MAX_PROOF_INPUT_BYTES,
            f"{field} exceeds its byte bound",
        )
        raw = _read_bounded_descriptor(
            file_descriptor,
            maximum_bytes=MAX_PROOF_INPUT_BYTES,
            field=field,
        )
        _revalidate_directory_path(root, root_descriptor, field=field)
        _revalidate_directory_chain(directory_chain, parts[:-1], field=field)
        final_descriptor = os.fstat(file_descriptor)
        final_entry = os.stat(
            parts[-1],
            dir_fd=parent_descriptor,
            follow_symlinks=False,
        )
        _require(
            len(raw) == opened.st_size
            and stat.S_ISREG(final_descriptor.st_mode)
            and stat.S_ISREG(final_entry.st_mode)
            and final_descriptor.st_nlink == 1
            and final_entry.st_nlink == 1
            and _stable_file_snapshot(opened) == _stable_file_snapshot(final_descriptor)
            and _stable_file_snapshot(final_descriptor) == _stable_file_snapshot(final_entry),
            f"{field} changed during its bounded descriptor read",
        )
        _revalidate_directory_chain(directory_chain, parts[:-1], field=field)
        _revalidate_directory_path(root, root_descriptor, field=field)
        return raw
    except OSError as error:
        raise ReplayProofError(f"{field} symlink or identity race was rejected") from error
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)
        _close_descriptors(directory_chain)
        os.close(root_descriptor)


def _directory_descends_from(
    directory_descriptor: int,
    forbidden_identity: tuple[int, int],
) -> bool:
    current = os.dup(directory_descriptor)
    try:
        for _ in range(_MAX_ANCESTOR_DEPTH):
            current_info = os.fstat(current)
            if _identity(current_info) == forbidden_identity:
                return True
            parent = os.open("..", _DIRECTORY_OPEN_FLAGS, dir_fd=current)
            parent_info = os.fstat(parent)
            if _identity(parent_info) == _identity(current_info):
                os.close(parent)
                return False
            os.close(current)
            current = parent
        raise ReplayProofError("copy_root ancestry exceeds the deterministic bound")
    except OSError as error:
        raise ReplayProofError("copy_root ancestry changed during verification") from error
    finally:
        os.close(current)


def _write_all(descriptor: int, raw: bytes) -> None:
    offset = 0
    while offset < len(raw):
        written = os.write(descriptor, raw[offset:])
        _require(written > 0, "corrupt fixture copy was short-written")
        offset += written


def _write_corrupt_copy(copy_root: Path, raw: bytes, *, forbidden_root: Path) -> bytes:
    copy_descriptor = _open_real_directory(copy_root, field="copy_root")
    forbidden_descriptor = -1
    file_descriptor = -1
    try:
        forbidden_descriptor = _open_real_directory(forbidden_root, field="repo_root")
        forbidden_identity = _identity(os.fstat(forbidden_descriptor))
        _require(
            not _directory_descends_from(copy_descriptor, forbidden_identity),
            "copy_root must remain outside repo_root",
        )
        file_descriptor = os.open(
            CORRUPT_COPY_NAME,
            _EXCLUSIVE_COPY_FLAGS,
            0o600,
            dir_fd=copy_descriptor,
        )
        created = os.fstat(file_descriptor)
        _require(
            stat.S_ISREG(created.st_mode) and created.st_nlink == 1 and created.st_size == 0,
            "corrupt fixture copy is not a unique regular file",
        )
        _write_all(file_descriptor, raw)
        os.fsync(file_descriptor)
        completed = os.fstat(file_descriptor)
        _require(
            _identity(created) == _identity(completed)
            and stat.S_ISREG(completed.st_mode)
            and completed.st_nlink == 1
            and completed.st_size == len(raw),
            "corrupt fixture copy changed identity during write",
        )
        os.lseek(file_descriptor, 0, os.SEEK_SET)
        copied = _read_bounded_descriptor(
            file_descriptor,
            maximum_bytes=MAX_PROOF_INPUT_BYTES,
            field="corrupt fixture copy",
        )
        final_descriptor = os.fstat(file_descriptor)
        final_entry = os.stat(
            CORRUPT_COPY_NAME,
            dir_fd=copy_descriptor,
            follow_symlinks=False,
        )
        _require(
            copied == raw
            and _stable_file_snapshot(completed) == _stable_file_snapshot(final_descriptor)
            and _stable_file_snapshot(final_descriptor) == _stable_file_snapshot(final_entry)
            and not _directory_descends_from(copy_descriptor, forbidden_identity),
            "corrupt fixture copy was swapped or moved inside repo_root",
        )
        return copied
    except OSError as error:
        raise ReplayProofError(
            "corrupt fixture copy exclusive open rejected an existing path, symlink, or race"
        ) from error
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)
        if forbidden_descriptor >= 0:
            os.close(forbidden_descriptor)
        os.close(copy_descriptor)


def _require_direct_child_directory(quant_root: Path, repo_root: Path) -> None:
    _require(
        isinstance(quant_root, Path)
        and isinstance(repo_root, Path)
        and quant_root.is_absolute()
        and repo_root.is_absolute(),
        "quant_root and repo_root must be absolute",
    )
    _require(quant_root.parent == repo_root, "quant_root must be the direct child of repo_root")
    repo_descriptor = _open_real_directory(repo_root, field="repo_root")
    direct_quant_descriptor = -1
    child_chain: tuple[int, ...] = ()
    try:
        direct_quant_descriptor = _open_real_directory(quant_root, field="quant_root")
        child_chain = _open_directory_chain(
            repo_descriptor,
            (quant_root.name,),
            field="quant_root",
        )
        child_descriptor = child_chain[-1]
        _require(
            _identity(os.fstat(child_descriptor)) == _identity(os.fstat(direct_quant_descriptor)),
            "quant_root changed identity relative to repo_root",
        )
        _revalidate_directory_path(repo_root, repo_descriptor, field="repo_root")
        _revalidate_directory_chain(child_chain, (quant_root.name,), field="quant_root")
        _revalidate_directory_path(quant_root, direct_quant_descriptor, field="quant_root")
    finally:
        _close_descriptors(child_chain)
        if direct_quant_descriptor >= 0:
            os.close(direct_quant_descriptor)
        os.close(repo_descriptor)


def _stage_mappings(result: PipelineResultV1) -> list[dict[str, object]]:
    return [stage.as_mapping() for stage in result.stages]


def _expected_stage_mappings() -> list[dict[str, object]]:
    return [
        {
            "parentSha256": list(parents),
            "schema": schema,
            "sha256": digest,
            "stage": stage,
        }
        for stage, schema, digest, parents in EXPECTED_STAGE_IDENTITIES
    ]


def _gap_evidence(raw: dict[str, object]) -> tuple[dict[str, object], int]:
    script = script_from_mapping(raw["spotBookScript"])
    full = run_replay(script)
    _require(
        full.result_digest.hexdigest == EXPECTED_Q04_REPLAY_SHA256,
        "accepted Q04 replay result digest drifted",
    )
    gap = next(
        (
            effect
            for effect in full.effects
            if isinstance(effect, BookAnomalyV1) and effect.kind is BookAnomalyKind.FORWARD_GAP
        ),
        None,
    )
    _require(gap is not None, "accepted Q04 replay has no forward-gap evidence")
    gap_time = cast(BookAnomalyV1, gap).processing_time_ns
    gap_index = next(
        (index for index, step in enumerate(script.steps) if step.processing_time_ns == gap_time),
        -1,
    )
    _require(gap_index > 0, "forward gap is not bound to an accepted replay step")
    prefix = ReplayScriptV1(script.engine_config, script.steps[: gap_index + 1])
    stopped = run_replay(prefix)
    transitions = tuple(
        effect
        for effect in stopped.effects
        if isinstance(effect, QualityTransitionV1) and effect.processing_time_ns == gap_time
    )
    _require(len(transitions) == 2, "forward gap lacks its exact quality transitions")
    quality_path = (
        transitions[0].from_quality.value,
        transitions[0].to_quality.value,
        transitions[1].to_quality.value,
    )
    _require(
        quality_path == ("COMPLETE", "GAPPED", "RECONSTRUCTING"),
        "forward gap did not traverse the fail-closed quality path",
    )
    resync = tuple(
        effect
        for effect in stopped.effects
        if isinstance(effect, DeltaDispositionV1)
        and effect.processing_time_ns == gap_time
        and effect.disposition is DeltaDisposition.RESYNC_TRIGGER
    )
    view = stopped.final_view
    _require(len(resync) == 1, "forward gap did not trigger exactly one resynchronization")
    _require(
        stopped.result_digest.hexdigest == EXPECTED_Q04_GAP_PREFIX_SHA256,
        "accepted Q04 gap-prefix result digest drifted",
    )
    _require(
        not view.model_eligible
        and not view.bids
        and not view.asks
        and view.book_update_id is None
        and view.buffered_deltas == 1,
        "forward-gap intermediate book did not remain unusable",
    )
    _require(full.final_view.model_eligible, "accepted Q04 replay never recovered after the gap")
    return (
        {
            "acceptedScriptHadForwardGap": True,
            "alteredScriptRejectedBeforeAssessment": True,
            "bookUpdateIdUnavailable": True,
            "emptyBookDuringGap": True,
            "finalBookRecovered": True,
            "fullReplaySha256": full.result_digest.hexdigest,
            "gapBookModelEligible": False,
            "gapPrefixReplaySha256": stopped.result_digest.hexdigest,
            "qualityPath": list(quality_path),
            "resyncTriggerObserved": True,
            "sourceGapBlockerPresent": True,
        },
        gap_time,
    )


def corrupt_forward_gap_fixture_bytes(fixture_bytes: bytes) -> bytes:
    """Return a canonical, contract-shaped mutation of the accepted gap event."""

    raw = _expected_bytes(
        fixture_bytes,
        field="raw fixture",
        sha256=EXPECTED_FIXTURE_SHA256,
    )
    _, gap_time = _gap_evidence(raw)
    script = _object(raw["spotBookScript"], field="spotBookScript")
    steps = _array(script["steps"], field="spotBookScript.steps")
    matching = [
        _object(step, field="spotBookScript.steps[]")
        for step in steps
        if isinstance(step, dict) and step.get("processingTimeNs") == gap_time
    ]
    _require(len(matching) == 1, "accepted forward-gap step identity is ambiguous")
    delta = _object(matching[0].get("delta"), field="forward-gap delta")
    final_update_id = delta.get("finalUpdateId")
    _require(
        isinstance(final_update_id, int) and not isinstance(final_update_id, bool),
        "forward-gap final update id is malformed",
    )
    delta["finalUpdateId"] = cast(int, final_update_id) + 1
    corrupted = canonical_json_bytes(raw)
    _require(corrupted != fixture_bytes, "forward-gap corruption did not change fixture bytes")
    script_from_mapping(_parse(corrupted, field="corrupted fixture")["spotBookScript"])
    return corrupted


def _require_safe_assessment(
    assessment: dict[str, object],
    *,
    protocol: ProtocolContractV1,
) -> tuple[str, ...]:
    try:
        protocol.validate_envelope(assessment, maximum_bytes=MAX_PROOF_INPUT_BYTES)
    except ProtocolBoundaryError as error:
        raise ReplayProofError("assessment is not valid under the frozen protocol") from error
    blockers = assessment.get("abstentionReasonCodes")
    _require(isinstance(blockers, list), "assessment blockers must be an array")
    blocker_tuple = tuple(cast(list[str], blockers))
    _require(
        assessment.get("advisoryAction") == "ABSTAIN_UNKNOWN" and bool(blocker_tuple),
        "assessment did not fail closed",
    )
    _require(assessment.get("predictions") == [], "assessment exposed predictions")
    _require(assessment.get("featureAttribution") == [], "assessment exposed attribution")
    _require(assessment.get("grossEstimate") is None, "assessment exposed a gross estimate")
    _require(
        assessment.get("marketStageProbabilities") == {}
        and assessment.get("regimeProbabilities") == {},
        "assessment exposed probabilities",
    )
    _require(
        assessment.get("netExpectedValue") == {"state": "UNKNOWN"},
        "assessment exposed estimated net economics",
    )
    _require(
        assessment.get("oodState") == "UNKNOWN" and assessment.get("driftState") == "UNKNOWN",
        "assessment concealed distribution ambiguity",
    )
    economics = _object(
        assessment.get("economicAssumptionContext"),
        field="economicAssumptionContext",
    )
    _require(economics.get("state") == "HYPOTHETICAL", "economics were not hypothetical")
    return blocker_tuple


def _require_no_model_numbers(result: PipelineResultV1) -> None:
    champion = _object(result.model_state.get("champion"), field="model champion")
    shadows = _array(result.model_state.get("shadowModels"), field="shadow models")
    _require(champion.get("score") is None, "champion exposed a numeric score")
    _require(
        all(_object(row, field="shadow model").get("score") is None for row in shadows),
        "shadow model exposed a numeric score",
    )
    _require(
        result.calibration_state.get("calibratedProbability") is None,
        "calibration exposed a numeric probability",
    )


def _expect_pipeline_rejection(
    raw: dict[str, object],
    *,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    expected_message: str,
) -> None:
    try:
        run_inference_pipeline(raw, lineage=lineage, protocol=protocol)
    except ContractValueError as error:
        _require(expected_message in str(error), "mutation failed at an unexpected boundary")
        return
    raise ReplayProofError("mutation produced an assessment")


def _mutation_rejections(
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    *,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> list[dict[str, object]]:
    version = _parse(fixture_bytes, field="version mutation source")
    version["version"] = 2
    source_hash = _parse(fixture_bytes, field="source-hash mutation source")
    source_hash["sourceFixtureSha256"] = "0" * 64
    lifecycle = _parse(fixture_bytes, field="lifecycle mutation source")
    lifecycle["expiresAtMs"] = lifecycle["generatedAtMs"]
    script = _parse(corrupted_fixture_bytes, field="script mutation source")

    _expect_pipeline_rejection(
        version,
        lineage=lineage,
        protocol=protocol,
        expected_message="schema/version/truth label",
    )
    _expect_pipeline_rejection(
        source_hash,
        lineage=lineage,
        protocol=protocol,
        expected_message="sourceFixtureSha256",
    )
    _expect_pipeline_rejection(
        script,
        lineage=lineage,
        protocol=protocol,
        expected_message="spotBookScript is not the accepted",
    )
    _expect_pipeline_rejection(
        lifecycle,
        lineage=lineage,
        protocol=protocol,
        expected_message="expiry must follow generation",
    )
    try:
        replace(lineage, champion_revision="ambiguous.revision")
    except ContractValueError:
        pass
    else:
        raise ReplayProofError("ambiguous serving lineage retained its accepted seal")

    return [
        {
            "assessmentProduced": False,
            "mutation": mutation,
            "rejected": True,
            "rejectionOwner": (
                "quant_edge.inference.artifacts"
                if mutation == "AMBIGUOUS_LINEAGE"
                else "quant_edge.inference.pipeline"
            ),
        }
        for mutation in EXPECTED_MUTATIONS
    ]


def _require_canonical_golden_request(
    request: dict[str, object],
    raw_fixture: dict[str, object],
) -> None:
    _require(
        set(request) == {"generatedAtMs", "items", "operation", "requestId", "schema", "version"},
        "Q16 request fields are not exact",
    )
    _require(
        request.get("schema") == "Q16LocalInferenceRequestV1"
        and _is_exact_int(request.get("version"), 1)
        and request.get("operation") == "ASSESS"
        and request.get("generatedAtMs") == EXPECTED_EVALUATION_TIME_MS
        and request.get("items") == [raw_fixture],
        "Q16 request does not bind the exact raw fixture and evaluation time",
    )


def build_replay_fault_proof(
    fixture_bytes: bytes,
    request_bytes: bytes,
    assessment_bytes: bytes,
    campaign_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    *,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    evaluation_time_ms: int,
    expired_evaluation_time_ms: int,
    ambiguous_evaluation_time_ms: int,
) -> dict[str, object]:
    """Build the immutable Q17 proof from explicit bytes, lineage, protocol, and clocks."""

    _require(isinstance(lineage, ServingLineageV1), "lineage must be accepted ServingLineageV1")
    _require(isinstance(protocol, ProtocolContractV1), "protocol must be frozen Q/L V1")
    _require(
        protocol.schema_sha256.hexdigest == FROZEN_SCHEMA_SHA256,
        "protocol schema identity drifted",
    )
    raw_first = _expected_bytes(
        fixture_bytes,
        field="raw fixture",
        sha256=EXPECTED_FIXTURE_SHA256,
    )
    raw_second = _parse(fixture_bytes, field="second raw fixture parse")
    request = _expected_protocol_bytes(
        request_bytes,
        field="Q16 request",
        sha256=EXPECTED_REQUEST_SHA256,
    )
    golden_assessment = _expected_protocol_bytes(
        assessment_bytes,
        field="Q16 assessment",
        sha256=EXPECTED_ASSESSMENT_SHA256,
    )
    campaign = _expected_bytes(
        campaign_bytes,
        field="Q16 campaign",
        sha256=EXPECTED_CAMPAIGN_SHA256,
    )
    _require(
        campaign.get("servingManifestSha256") == lineage.manifest_sha256.hexdigest,
        "fresh serving lineage does not match the committed Q16 manifest identity",
    )
    _require_canonical_golden_request(request, raw_first)
    _require(
        evaluation_time_ms == EXPECTED_EVALUATION_TIME_MS
        and expired_evaluation_time_ms == EXPECTED_EXPIRED_EVALUATION_TIME_MS
        and ambiguous_evaluation_time_ms == EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        "injected proof clocks do not match the canonical Q16 lifecycle boundaries",
    )
    expected_corruption = corrupt_forward_gap_fixture_bytes(fixture_bytes)
    _require(
        corrupted_fixture_bytes == expected_corruption
        and _sha256(corrupted_fixture_bytes) == EXPECTED_CORRUPTED_FIXTURE_SHA256,
        "copied corruption is not the deterministic forward-gap mutation",
    )

    first = run_inference_pipeline(
        raw_first,
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=evaluation_time_ms,
    )
    second = run_inference_pipeline(
        raw_second,
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=evaluation_time_ms,
    )
    first_bytes = canonical_json_bytes(first.as_mapping())
    second_bytes = canonical_json_bytes(second.as_mapping())
    golden_pipeline = _object(campaign.get("pipeline"), field="Q16 campaign pipeline")
    golden_pipeline_bytes = canonical_json_bytes(golden_pipeline)
    _require(first_bytes == second_bytes, "independent Q16 runs were not byte identical")
    _require(
        first_bytes == golden_pipeline_bytes and _sha256(first_bytes) == EXPECTED_PIPELINE_SHA256,
        "Q16 pipeline differs from the committed canonical campaign",
    )
    _require(
        protocol_json_bytes(first.assessment) == assessment_bytes
        and first.assessment == golden_assessment,
        "Q16 assessment differs from its committed protocol golden",
    )
    _require(
        _stage_mappings(first) == _expected_stage_mappings()
        and _stage_mappings(second) == _expected_stage_mappings(),
        "Q16 stage digest or parent identity drifted",
    )
    blockers = _require_safe_assessment(first.assessment, protocol=protocol)
    _require(blockers == EXPECTED_BLOCKERS, "Q16 assessment blockers drifted")
    _require_no_model_numbers(first)
    gap, _ = _gap_evidence(raw_first)

    expired = run_inference_pipeline(
        _parse(fixture_bytes, field="expired raw fixture"),
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=expired_evaluation_time_ms,
    )
    expired_blockers = _require_safe_assessment(expired.assessment, protocol=protocol)
    expired_quality = _object(expired.assessment.get("sourceQuality"), field="expired quality")
    _require(
        expired_quality.get("freshness") == "STALE"
        and "ASSESSMENT_EXPIRED" in expired_blockers
        and "SOURCE_STALE" in expired_blockers
        and protocol_digest(expired.assessment).hexdigest == EXPECTED_EXPIRED_ASSESSMENT_SHA256,
        "expired inference did not abstain stale and fail closed",
    )
    ambiguous = run_inference_pipeline(
        _parse(fixture_bytes, field="future-ambiguous raw fixture"),
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=ambiguous_evaluation_time_ms,
    )
    ambiguous_blockers = _require_safe_assessment(ambiguous.assessment, protocol=protocol)
    ambiguous_quality = _object(
        ambiguous.assessment.get("sourceQuality"),
        field="future-ambiguous quality",
    )
    _require(
        ambiguous_quality.get("freshness") == "UNKNOWN"
        and "EVALUATION_PRECEDES_GENERATION" in ambiguous_blockers
        and "SOURCE_TIME_AMBIGUOUS" in ambiguous_blockers
        and protocol_digest(ambiguous.assessment).hexdigest == EXPECTED_AMBIGUOUS_ASSESSMENT_SHA256,
        "future-relative inference did not abstain ambiguous and fail closed",
    )
    mutations = _mutation_rejections(
        fixture_bytes,
        corrupted_fixture_bytes,
        lineage=lineage,
        protocol=protocol,
    )

    proof: dict[str, object] = {
        "assessmentEnvelope": first.assessment,
        "assessmentSummary": {
            "assessmentSha256": first.assessment_sha256.hexdigest,
            "blockers": list(blockers),
            "finalAction": "ABSTAIN_UNKNOWN",
            "grossEstimateAbsent": True,
            "netEconomicsState": "UNKNOWN",
            "predictionsEmpty": True,
            "probabilitiesAbsent": True,
            "protocolValid": True,
            "scoresAbsent": True,
        },
        "faults": {
            "corruption": {
                "copiedBytesSha256": EXPECTED_CORRUPTED_FIXTURE_SHA256,
                "copyFileName": CORRUPT_COPY_NAME,
                "mutation": "FORWARD_GAP_FINAL_UPDATE_ID_PLUS_ONE",
                "originalBytesSha256": EXPECTED_FIXTURE_SHA256,
                "rejectedBeforeAssessment": True,
            },
            "expiration": {
                "assessmentSha256": protocol_digest(expired.assessment).hexdigest,
                "finalAction": "ABSTAIN_UNKNOWN",
                "reasonCodes": ["ASSESSMENT_EXPIRED", "SOURCE_STALE"],
                "sourceFreshness": "STALE",
            },
            "futureAmbiguity": {
                "assessmentSha256": protocol_digest(ambiguous.assessment).hexdigest,
                "finalAction": "ABSTAIN_UNKNOWN",
                "reasonCodes": [
                    "EVALUATION_PRECEDES_GENERATION",
                    "SOURCE_TIME_AMBIGUOUS",
                ],
                "sourceFreshness": "UNKNOWN",
            },
            "mutationRejections": mutations,
            "sequenceGap": gap,
        },
        "posture": "SYNTHETIC_ONLY",
        "protocolSchemaSha256": protocol.schema_sha256.hexdigest,
        "repeatability": {
            "assessmentSha256": first.assessment_sha256.hexdigest,
            "byteIdenticalIndependentRuns": True,
            "committedGoldenMatched": True,
            "pipelineSha256": _sha256(first_bytes),
            "rawFixtureSha256": _sha256(fixture_bytes),
            "requestSha256": _sha256(request_bytes),
            "runCount": 2,
            "stageIdentities": _stage_mappings(first),
        },
        "schema": "Q17ReplayFaultProofV1",
        "status": "PASS_FAIL_CLOSED",
        "version": 1,
    }
    canonical_json_bytes(proof)
    validate_replay_fault_proof(proof, protocol=protocol)
    return proof


def _require_exact(value: dict[str, object], expected: frozenset[str], *, field: str) -> None:
    _require(set(value) == expected, f"{field} fields are not exact")


def validate_replay_fault_proof(
    value: dict[str, object],
    *,
    protocol: ProtocolContractV1,
) -> None:
    """Strictly validate a Q17 replay proof and its frozen assessment evidence."""

    _require(isinstance(value, dict), "replay proof must be an object")
    _require(isinstance(protocol, ProtocolContractV1), "protocol must be frozen Q/L V1")
    _require_exact(value, _PROOF_FIELDS, field="proof")
    _require(
        value.get("schema") == "Q17ReplayFaultProofV1"
        and _is_exact_int(value.get("version"), 1)
        and value.get("posture") == "SYNTHETIC_ONLY"
        and value.get("status") == "PASS_FAIL_CLOSED"
        and value.get("protocolSchemaSha256") == FROZEN_SCHEMA_SHA256,
        "replay proof identity or status is invalid",
    )
    assessment = _object(value.get("assessmentEnvelope"), field="assessmentEnvelope")
    blockers = _require_safe_assessment(assessment, protocol=protocol)
    _require(blockers == EXPECTED_BLOCKERS, "proof assessment blockers are not accepted")
    _require(
        protocol_digest(assessment).hexdigest == EXPECTED_ASSESSMENT_SHA256,
        "proof assessment bytes are not the committed golden",
    )

    summary = _object(value.get("assessmentSummary"), field="assessmentSummary")
    _require_exact(
        summary,
        frozenset(
            {
                "assessmentSha256",
                "blockers",
                "finalAction",
                "grossEstimateAbsent",
                "netEconomicsState",
                "predictionsEmpty",
                "probabilitiesAbsent",
                "protocolValid",
                "scoresAbsent",
            }
        ),
        field="assessmentSummary",
    )
    _require(
        summary.get("assessmentSha256") == EXPECTED_ASSESSMENT_SHA256
        and summary.get("blockers") == list(EXPECTED_BLOCKERS)
        and summary.get("finalAction") == "ABSTAIN_UNKNOWN"
        and summary.get("netEconomicsState") == "UNKNOWN"
        and all(
            _is_exact_bool(summary.get(field), True)
            for field in (
                "grossEstimateAbsent",
                "predictionsEmpty",
                "probabilitiesAbsent",
                "protocolValid",
                "scoresAbsent",
            )
        ),
        "assessment summary is not exact",
    )

    repeatability = _object(value.get("repeatability"), field="repeatability")
    _require_exact(
        repeatability,
        frozenset(
            {
                "assessmentSha256",
                "byteIdenticalIndependentRuns",
                "committedGoldenMatched",
                "pipelineSha256",
                "rawFixtureSha256",
                "requestSha256",
                "runCount",
                "stageIdentities",
            }
        ),
        field="repeatability",
    )
    _require(
        repeatability.get("assessmentSha256") == EXPECTED_ASSESSMENT_SHA256
        and _is_exact_bool(repeatability.get("byteIdenticalIndependentRuns"), True)
        and _is_exact_bool(repeatability.get("committedGoldenMatched"), True)
        and repeatability.get("pipelineSha256") == EXPECTED_PIPELINE_SHA256
        and repeatability.get("rawFixtureSha256") == EXPECTED_FIXTURE_SHA256
        and repeatability.get("requestSha256") == EXPECTED_REQUEST_SHA256
        and _is_exact_int(repeatability.get("runCount"), 2)
        and repeatability.get("stageIdentities") == _expected_stage_mappings(),
        "repeatability evidence is not exact",
    )

    faults = _object(value.get("faults"), field="faults")
    _require_exact(
        faults,
        frozenset(
            {
                "corruption",
                "expiration",
                "futureAmbiguity",
                "mutationRejections",
                "sequenceGap",
            }
        ),
        field="faults",
    )
    corruption = _object(faults.get("corruption"), field="faults.corruption")
    _require_exact(
        corruption,
        frozenset(
            {
                "copiedBytesSha256",
                "copyFileName",
                "mutation",
                "originalBytesSha256",
                "rejectedBeforeAssessment",
            }
        ),
        field="faults.corruption",
    )
    copied_digest = _require_sha256(
        corruption.get("copiedBytesSha256"),
        field="copiedBytesSha256 must be lowercase SHA-256",
    )
    _require(
        copied_digest == EXPECTED_CORRUPTED_FIXTURE_SHA256
        and corruption.get("copyFileName") == CORRUPT_COPY_NAME
        and corruption.get("mutation") == "FORWARD_GAP_FINAL_UPDATE_ID_PLUS_ONE"
        and corruption.get("originalBytesSha256") == EXPECTED_FIXTURE_SHA256
        and _is_exact_bool(corruption.get("rejectedBeforeAssessment"), True),
        "corruption proof is not fail closed",
    )

    expiration = _object(faults.get("expiration"), field="faults.expiration")
    future = _object(faults.get("futureAmbiguity"), field="faults.futureAmbiguity")
    for field, item, digest, freshness, reasons in (
        (
            "expiration",
            expiration,
            EXPECTED_EXPIRED_ASSESSMENT_SHA256,
            "STALE",
            ["ASSESSMENT_EXPIRED", "SOURCE_STALE"],
        ),
        (
            "futureAmbiguity",
            future,
            EXPECTED_AMBIGUOUS_ASSESSMENT_SHA256,
            "UNKNOWN",
            ["EVALUATION_PRECEDES_GENERATION", "SOURCE_TIME_AMBIGUOUS"],
        ),
    ):
        _require_exact(
            item,
            frozenset({"assessmentSha256", "finalAction", "reasonCodes", "sourceFreshness"}),
            field=f"faults.{field}",
        )
        _require(
            item.get("assessmentSha256") == digest
            and item.get("finalAction") == "ABSTAIN_UNKNOWN"
            and item.get("reasonCodes") == reasons
            and item.get("sourceFreshness") == freshness,
            f"{field} proof is not exact",
        )

    sequence = _object(faults.get("sequenceGap"), field="faults.sequenceGap")
    _require_exact(
        sequence,
        frozenset(
            {
                "acceptedScriptHadForwardGap",
                "alteredScriptRejectedBeforeAssessment",
                "bookUpdateIdUnavailable",
                "emptyBookDuringGap",
                "finalBookRecovered",
                "fullReplaySha256",
                "gapBookModelEligible",
                "gapPrefixReplaySha256",
                "qualityPath",
                "resyncTriggerObserved",
                "sourceGapBlockerPresent",
            }
        ),
        field="faults.sequenceGap",
    )
    _require(
        sequence.get("fullReplaySha256") == EXPECTED_Q04_REPLAY_SHA256
        and sequence.get("gapPrefixReplaySha256") == EXPECTED_Q04_GAP_PREFIX_SHA256
        and sequence.get("qualityPath") == ["COMPLETE", "GAPPED", "RECONSTRUCTING"]
        and all(
            _is_exact_bool(sequence.get(field), True)
            for field in (
                "acceptedScriptHadForwardGap",
                "alteredScriptRejectedBeforeAssessment",
                "bookUpdateIdUnavailable",
                "emptyBookDuringGap",
                "finalBookRecovered",
                "resyncTriggerObserved",
                "sourceGapBlockerPresent",
            )
        )
        and _is_exact_bool(sequence.get("gapBookModelEligible"), False),
        "sequence-gap proof is not exact",
    )

    mutations = _array(faults.get("mutationRejections"), field="mutationRejections")
    _require(
        [_object(item, field="mutationRejections[]").get("mutation") for item in mutations]
        == list(EXPECTED_MUTATIONS),
        "mutation rejection inventory is not exact",
    )
    for row in mutations:
        mutation = _object(row, field="mutationRejections[]")
        _require_exact(
            mutation,
            frozenset({"assessmentProduced", "mutation", "rejected", "rejectionOwner"}),
            field="mutationRejections[]",
        )
        expected_owner = (
            "quant_edge.inference.artifacts"
            if mutation.get("mutation") == "AMBIGUOUS_LINEAGE"
            else "quant_edge.inference.pipeline"
        )
        _require(
            _is_exact_bool(mutation.get("assessmentProduced"), False)
            and _is_exact_bool(mutation.get("rejected"), True)
            and mutation.get("rejectionOwner") == expected_owner,
            "semantic mutation did not fail closed",
        )
    canonical_json_bytes(value)


def run_replay_fault_campaign(
    quant_root: Path,
    repo_root: Path,
    copy_root: Path,
    *,
    fixture_relative_path: str = FIXTURE_RELATIVE_PATH,
    evaluation_time_ms: int,
    expired_evaluation_time_ms: int,
    ambiguous_evaluation_time_ms: int,
) -> dict[str, object]:
    """Run the Q17 campaign from real hash-pinned files and an injected copy root."""

    _require_direct_child_directory(quant_root, repo_root)
    quant = quant_root
    repo = repo_root
    fixture_bytes = _safe_read(quant, fixture_relative_path, field="raw fixture")
    request_bytes = _safe_read(quant, REQUEST_RELATIVE_PATH, field="Q16 request")
    assessment_bytes = _safe_read(quant, ASSESSMENT_RELATIVE_PATH, field="Q16 assessment")
    campaign_bytes = _safe_read(quant, CAMPAIGN_RELATIVE_PATH, field="Q16 campaign")
    corrupted = corrupt_forward_gap_fixture_bytes(fixture_bytes)
    copied = _write_corrupt_copy(copy_root, corrupted, forbidden_root=repo)
    _require(copied == corrupted, "corrupt fixture copy changed after exclusive write")
    protocol = ProtocolContractV1.load(repo)
    manifest = build_serving_manifest(quant)
    lineage = load_serving_lineage(quant, manifest)
    return build_replay_fault_proof(
        fixture_bytes,
        request_bytes,
        assessment_bytes,
        campaign_bytes,
        copied,
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=evaluation_time_ms,
        expired_evaluation_time_ms=expired_evaluation_time_ms,
        ambiguous_evaluation_time_ms=ambiguous_evaluation_time_ms,
    )
