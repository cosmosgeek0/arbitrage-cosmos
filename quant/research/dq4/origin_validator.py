#!/usr/bin/env python3
"""Validate a sealed research packet from Git objects, refs, and byte bindings.

The proof manifest is deliberately checkout-independent. Runtime repository and
manifest paths are operational inputs; neither is admitted into the proof.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Final, NoReturn, cast

SCHEMA: Final = "cosmos.dq4.origin-proof.v1"
RECEIPT_SCHEMA: Final = "cosmos.dq4.origin-proof-receipt.v1"
MAX_MANIFEST_BYTES: Final = 1_048_576

ORIGIN_PROOF_VALID: Final = "ORIGIN_PROOF_VALID"
REASON_CODES: Final[tuple[str, ...]] = (
    ORIGIN_PROOF_VALID,
    "ORIGIN_PROOF_INVOCATION_INVALID",
    "ORIGIN_PROOF_ENVIRONMENT_ERROR",
    "ORIGIN_PROOF_MANIFEST_JSON_INVALID",
    "ORIGIN_PROOF_SCHEMA_UNSUPPORTED",
    "ORIGIN_PROOF_FIELD_ROSTER_INVALID",
    "ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY",
    "ORIGIN_PROOF_PATH_INVALID",
    "ORIGIN_PROOF_SYMLINK_FORBIDDEN",
    "ORIGIN_PROOF_OBJECT_FORMAT_MISMATCH",
    "ORIGIN_PROOF_OBJECT_ID_INVALID",
    "ORIGIN_PROOF_BASE_OBJECT_MISSING",
    "ORIGIN_PROOF_BASE_OBJECT_NOT_COMMIT",
    "ORIGIN_PROOF_PRE_RUN_OBJECT_MISSING",
    "ORIGIN_PROOF_PRE_RUN_OBJECT_NOT_COMMIT",
    "ORIGIN_PROOF_SEALED_OBJECT_MISSING",
    "ORIGIN_PROOF_SEALED_OBJECT_NOT_COMMIT",
    "ORIGIN_PROOF_PRE_RUN_TREE_MISMATCH",
    "ORIGIN_PROOF_SEALED_TREE_MISMATCH",
    "ORIGIN_PROOF_REPLACEMENT_OBJECT_PRESENT",
    "ORIGIN_PROOF_SHALLOW_REPOSITORY",
    "ORIGIN_PROOF_PRE_RUN_REF_UNBOUND",
    "ORIGIN_PROOF_PRE_RUN_REF_MISSING",
    "ORIGIN_PROOF_PRE_RUN_REF_MOVED",
    "ORIGIN_PROOF_ORIGIN_REF_UNBOUND",
    "ORIGIN_PROOF_ORIGIN_REF_MISSING",
    "ORIGIN_PROOF_ORIGIN_REF_MOVED",
    "ORIGIN_PROOF_BASE_NOT_ANCESTOR",
    "ORIGIN_PROOF_PRE_RUN_OBJECT_AMENDED",
    "ORIGIN_PROOF_PRE_RUN_NOT_ANCESTOR",
    "ORIGIN_PROOF_INPUT_ROSTER_MISMATCH",
    "ORIGIN_PROOF_INPUT_BINDING_MISMATCH",
)

_TOP_LEVEL_FIELDS: Final = frozenset(
    {
        "schema",
        "objectFormat",
        "packetPath",
        "baseCommit",
        "preRun",
        "sealed",
        "origin",
        "files",
    }
)
_PRE_RUN_FIELDS: Final = frozenset({"commit", "tree", "anchorRef"})
_SEALED_FIELDS: Final = frozenset({"commit", "tree"})
_ORIGIN_FIELDS: Final = frozenset({"remote", "sourceRef", "trackingRef", "expectedCommit"})
_FILE_FIELDS: Final = frozenset({"path", "stage", "blobOid", "sha256"})
_WINDOWS_ABSOLUTE_RE: Final = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")
_REMOTE_NAME_RE: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class DuplicateKeyError(ValueError):
    """Raised when JSON repeats an object key."""


class Rejection(Exception):
    """A deterministic proof rejection."""

    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


class EnvironmentFailure(Exception):
    """An inability to evaluate the proof safely."""


class InvocationFailure(Exception):
    """Invalid command-line input."""


class StrictArgumentParser(argparse.ArgumentParser):
    """Argument parser that never prints host paths or exits the interpreter."""

    def error(self, message: str) -> NoReturn:
        raise InvocationFailure(message)


@dataclass(frozen=True)
class GitResult:
    returncode: int
    stdout: bytes
    stderr: bytes


@dataclass(frozen=True)
class FileBinding:
    path: str
    stage: str
    blob_oid: str
    sha256: str


@dataclass(frozen=True)
class Proof:
    object_format: str
    packet_path: str
    base_commit: str
    pre_run_commit: str
    pre_run_tree: str
    pre_run_anchor_ref: str
    sealed_commit: str
    sealed_tree: str
    origin_remote: str
    origin_source_ref: str
    origin_tracking_ref: str
    origin_expected_commit: str
    files: tuple[FileBinding, ...]
    manifest_sha256: str


def _reject(reason_code: str) -> NoReturn:
    if reason_code not in REASON_CODES:
        raise AssertionError(f"unknown reason code: {reason_code}")
    raise Rejection(reason_code)


def _pairs_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(key)
        result[key] = value
    return result


def _load_manifest(manifest_path: Path) -> tuple[Mapping[str, Any], str]:
    descriptor = -1
    try:
        if manifest_path.is_symlink():
            _reject("ORIGIN_PROOF_SYMLINK_FORBIDDEN")
        flags = os.O_RDONLY
        for flag_name in ("O_CLOEXEC", "O_NOFOLLOW", "O_NONBLOCK"):
            flags |= cast(int, getattr(os, flag_name, 0))
        descriptor = os.open(manifest_path, flags)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            _reject("ORIGIN_PROOF_MANIFEST_JSON_INVALID")
        if metadata.st_size > MAX_MANIFEST_BYTES:
            _reject("ORIGIN_PROOF_MANIFEST_JSON_INVALID")
        with os.fdopen(descriptor, "rb", closefd=True) as stream:
            descriptor = -1
            raw = stream.read(MAX_MANIFEST_BYTES + 1)
    except Rejection:
        raise
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            _reject("ORIGIN_PROOF_SYMLINK_FORBIDDEN")
        raise EnvironmentFailure from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if len(raw) > MAX_MANIFEST_BYTES:
        _reject("ORIGIN_PROOF_MANIFEST_JSON_INVALID")
    try:
        parsed = json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=_pairs_without_duplicates,
            parse_constant=lambda _value: _reject("ORIGIN_PROOF_MANIFEST_JSON_INVALID"),
        )
    except Rejection:
        raise
    except (
        DuplicateKeyError,
        RecursionError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        ValueError,
    ):
        _reject("ORIGIN_PROOF_MANIFEST_JSON_INVALID")
    if not isinstance(parsed, dict):
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")
    manifest = cast(Mapping[str, Any], parsed)
    try:
        canonical = json.dumps(
            manifest,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (RecursionError, TypeError, ValueError):
        _reject("ORIGIN_PROOF_MANIFEST_JSON_INVALID")
    return manifest, hashlib.sha256(canonical).hexdigest()


def _contains_absolute_dependency(value: Any) -> bool:
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, str) and (
            current.startswith("/")
            or current.lower().startswith("file://")
            or _WINDOWS_ABSOLUTE_RE.match(current) is not None
        ):
            return True
        if isinstance(current, list):
            pending.extend(current)
        elif isinstance(current, dict):
            pending.extend(current.values())
    return False


def _require_exact_fields(value: Any, fields: frozenset[str]) -> Mapping[str, Any]:
    if not isinstance(value, dict) or frozenset(value) != fields:
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")
    return cast(Mapping[str, Any], value)


def _require_string(value: Any) -> str:
    if not isinstance(value, str) or not value:
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")
    return value


def _valid_relative_path(value: str) -> bool:
    if (
        not value
        or "\\" in value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return False
    path = PurePosixPath(value)
    return (
        not path.is_absolute()
        and value == path.as_posix()
        and all(part not in {"", ".", ".."} for part in path.parts)
    )


def _oid_pattern(object_format: str) -> re.Pattern[str]:
    lengths = {"sha1": 40, "sha256": 64}
    length = lengths.get(object_format)
    if length is None:
        _reject("ORIGIN_PROOF_OBJECT_FORMAT_MISMATCH")
    return re.compile(rf"^[0-9a-f]{{{length}}}$")


def _parse_manifest(manifest: Mapping[str, Any], manifest_sha256: str) -> Proof:
    if _contains_absolute_dependency(manifest):
        _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
    if manifest.get("schema") != SCHEMA:
        _reject("ORIGIN_PROOF_SCHEMA_UNSUPPORTED")

    origin_value = manifest.get("origin")
    if not isinstance(origin_value, dict) or not _ORIGIN_FIELDS.issubset(origin_value):
        _reject("ORIGIN_PROOF_ORIGIN_REF_UNBOUND")
    origin_remote_value = origin_value.get("remote")
    origin_source_value = origin_value.get("sourceRef")
    origin_tracking_value = origin_value.get("trackingRef")
    origin_expected_value = origin_value.get("expectedCommit")
    sealed_value = manifest.get("sealed")
    sealed_commit_value = sealed_value.get("commit") if isinstance(sealed_value, dict) else None
    if (
        not isinstance(origin_remote_value, str)
        or _REMOTE_NAME_RE.fullmatch(origin_remote_value) is None
        or not isinstance(origin_source_value, str)
        or not origin_source_value.startswith("refs/heads/")
        or not isinstance(origin_tracking_value, str)
        or not origin_tracking_value.startswith(f"refs/remotes/{origin_remote_value}/")
        or not isinstance(origin_expected_value, str)
        or not origin_expected_value
        or origin_expected_value != sealed_commit_value
    ):
        _reject("ORIGIN_PROOF_ORIGIN_REF_UNBOUND")
    pre_run_value = manifest.get("preRun")
    if not isinstance(pre_run_value, dict) or "anchorRef" not in pre_run_value:
        _reject("ORIGIN_PROOF_PRE_RUN_REF_UNBOUND")
    anchor_value = pre_run_value.get("anchorRef")
    if not isinstance(anchor_value, str) or not anchor_value.startswith("refs/tags/"):
        _reject("ORIGIN_PROOF_PRE_RUN_REF_UNBOUND")

    top = _require_exact_fields(manifest, _TOP_LEVEL_FIELDS)
    pre_run = _require_exact_fields(top["preRun"], _PRE_RUN_FIELDS)
    sealed = _require_exact_fields(top["sealed"], _SEALED_FIELDS)
    origin = _require_exact_fields(top["origin"], _ORIGIN_FIELDS)
    files_value = top["files"]
    if not isinstance(files_value, list) or not files_value:
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")

    object_format = _require_string(top["objectFormat"])
    packet_path = _require_string(top["packetPath"])
    base_commit = _require_string(top["baseCommit"])
    pre_run_commit = _require_string(pre_run["commit"])
    pre_run_tree = _require_string(pre_run["tree"])
    sealed_commit = _require_string(sealed["commit"])
    sealed_tree = _require_string(sealed["tree"])
    origin_expected_commit = _require_string(origin["expectedCommit"])
    pre_run_anchor_ref = _require_string(pre_run["anchorRef"])
    origin_remote = _require_string(origin["remote"])
    origin_source_ref = _require_string(origin["sourceRef"])
    origin_tracking_ref = _require_string(origin["trackingRef"])
    if origin_expected_commit != sealed_commit:
        _reject("ORIGIN_PROOF_ORIGIN_REF_UNBOUND")

    raw_files: list[tuple[str, str, str, str]] = []
    for raw_binding in files_value:
        binding = _require_exact_fields(raw_binding, _FILE_FIELDS)
        path = _require_string(binding["path"])
        stage = _require_string(binding["stage"])
        blob_oid = _require_string(binding["blobOid"])
        sha256 = _require_string(binding["sha256"])
        if stage not in {"pre_run", "post_run"}:
            _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")
        raw_files.append((path, stage, blob_oid, sha256))

    paths = [path for path, _stage, _blob_oid, _sha256 in raw_files]
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")
    if not any(stage == "pre_run" for _path, stage, _blob_oid, _sha256 in raw_files):
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")
    if not any(stage == "post_run" for _path, stage, _blob_oid, _sha256 in raw_files):
        _reject("ORIGIN_PROOF_FIELD_ROSTER_INVALID")

    if not _valid_relative_path(packet_path) or not packet_path.startswith("quant/research/"):
        _reject("ORIGIN_PROOF_PATH_INVALID")
    if any(
        not _valid_relative_path(path)
        or path == packet_path
        or not path.startswith(f"{packet_path}/")
        for path in paths
    ):
        _reject("ORIGIN_PROOF_PATH_INVALID")

    oid_pattern = _oid_pattern(object_format)
    oid_values = (
        base_commit,
        pre_run_commit,
        pre_run_tree,
        sealed_commit,
        sealed_tree,
        origin_expected_commit,
    )
    if any(oid_pattern.fullmatch(value) is None for value in oid_values):
        _reject("ORIGIN_PROOF_OBJECT_ID_INVALID")

    files: list[FileBinding] = []
    for path, stage, blob_oid, sha256 in raw_files:
        if oid_pattern.fullmatch(blob_oid) is None or re.fullmatch(r"[0-9a-f]{64}", sha256) is None:
            _reject("ORIGIN_PROOF_OBJECT_ID_INVALID")
        files.append(FileBinding(path, stage, blob_oid, sha256))

    return Proof(
        object_format=object_format,
        packet_path=packet_path,
        base_commit=base_commit,
        pre_run_commit=pre_run_commit,
        pre_run_tree=pre_run_tree,
        pre_run_anchor_ref=pre_run_anchor_ref,
        sealed_commit=sealed_commit,
        sealed_tree=sealed_tree,
        origin_remote=origin_remote,
        origin_source_ref=origin_source_ref,
        origin_tracking_ref=origin_tracking_ref,
        origin_expected_commit=origin_expected_commit,
        files=tuple(files),
        manifest_sha256=manifest_sha256,
    )


def _git_environment() -> dict[str, str]:
    environment = {
        key: os.environ[key] for key in ("PATH", "SystemRoot", "TMPDIR") if key in os.environ
    }
    environment.update(
        {
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_LITERAL_PATHSPECS": "1",
            "GIT_NO_LAZY_FETCH": "1",
            "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_PAGER": "cat",
            "GIT_TERMINAL_PROMPT": "0",
            "LANG": "C",
            "LC_ALL": "C",
        }
    )
    return environment


def _run_git(repo: Path, *args: str) -> GitResult:
    git = shutil.which("git", path=os.environ.get("PATH"))
    if git is None:
        raise EnvironmentFailure
    try:
        completed = subprocess.run(
            [git, "--no-replace-objects", "-C", os.fspath(repo), *args],
            check=False,
            capture_output=True,
            env=_git_environment(),
            timeout=30,
        )
    except OSError as exc:
        raise EnvironmentFailure from exc
    return GitResult(completed.returncode, completed.stdout, completed.stderr)


def _git_stdout(repo: Path, *args: str) -> str:
    result = _run_git(repo, *args)
    if result.returncode != 0:
        raise EnvironmentFailure
    try:
        return result.stdout.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as exc:
        raise EnvironmentFailure from exc


def _common_git_dir(repo: Path) -> Path:
    common_dir = Path(_git_stdout(repo, "rev-parse", "--git-common-dir"))
    if not common_dir.is_absolute():
        common_dir = repo / common_dir
    try:
        return common_dir.resolve(strict=True)
    except OSError as exc:
        raise EnvironmentFailure from exc


def _git_path(repo: Path, name: str) -> Path:
    path = Path(_git_stdout(repo, "rev-parse", "--git-path", name))
    return path if path.is_absolute() else repo / path


def _tree_contains_symlink(root: Path) -> bool:
    pending = [root]
    try:
        while pending:
            directory = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    if entry.is_symlink():
                        return True
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(Path(entry.path))
    except OSError as exc:
        raise EnvironmentFailure from exc
    return False


def _config_has_include(repo: Path, *scope_args: str) -> bool:
    includes = _run_git(
        repo,
        "config",
        *scope_args,
        "--no-includes",
        "--get-regexp",
        "^include",
    )
    if includes.returncode not in {0, 1}:
        raise EnvironmentFailure
    return bool(includes.stdout.strip())


def _check_git_directory_containment(repo: Path, bare_repository: bool) -> Path:
    common_dir = _common_git_dir(repo)
    try:
        git_dir = Path(_git_stdout(repo, "rev-parse", "--absolute-git-dir")).resolve(strict=True)
        if bare_repository:
            supplied_repo = repo.resolve(strict=True)
            if supplied_repo != git_dir or git_dir != common_dir or _tree_contains_symlink(git_dir):
                _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
            return common_dir

        top_level = Path(_git_stdout(repo, "rev-parse", "--show-toplevel")).resolve(strict=True)
        dot_git = top_level / ".git"
        if dot_git.is_symlink() or not dot_git.is_dir():
            _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
        contained_git_dir = dot_git.resolve(strict=True)
        if (
            not git_dir.is_relative_to(contained_git_dir)
            or not common_dir.is_relative_to(contained_git_dir)
            or _tree_contains_symlink(contained_git_dir)
        ):
            _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
    except Rejection:
        raise
    except OSError as exc:
        raise EnvironmentFailure from exc
    return common_dir


def _check_external_repository_dependencies(repo: Path, bare_repository: bool) -> None:
    common_dir = _check_git_directory_containment(repo, bare_repository)
    objects_dir = common_dir / "objects"
    common_config = common_dir / "config"
    worktree_config = _git_path(repo, "config.worktree")
    try:
        if common_config.is_symlink() or worktree_config.is_symlink() or objects_dir.is_symlink():
            _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
        if _tree_contains_symlink(objects_dir):
            _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
        for name in ("alternates", "http-alternates"):
            alternate_file = objects_dir / "info" / name
            if alternate_file.is_file() and alternate_file.stat().st_size > 0:
                _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
    except Rejection:
        raise
    except OSError as exc:
        raise EnvironmentFailure from exc
    if _config_has_include(repo, "--local"):
        _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")
    if worktree_config.is_file() and _config_has_include(
        repo, "--file", os.fspath(worktree_config)
    ):
        _reject("ORIGIN_PROOF_ABSOLUTE_WORKTREE_DEPENDENCY")


def _check_repository(repo: Path, proof: Proof) -> None:
    inside_worktree = _git_stdout(repo, "rev-parse", "--is-inside-work-tree")
    bare_value = _git_stdout(repo, "rev-parse", "--is-bare-repository")
    if inside_worktree != "true" and bare_value != "true":
        raise EnvironmentFailure
    _check_external_repository_dependencies(repo, bare_value == "true")
    storage_format = _git_stdout(repo, "rev-parse", "--show-object-format=storage")
    if storage_format != proof.object_format:
        _reject("ORIGIN_PROOF_OBJECT_FORMAT_MISMATCH")
    if _git_stdout(repo, "rev-parse", "--is-shallow-repository") == "true":
        _reject("ORIGIN_PROOF_SHALLOW_REPOSITORY")


def _check_commit(repo: Path, oid: str, missing_code: str, type_code: str) -> None:
    exists = _run_git(repo, "cat-file", "-e", oid)
    if exists.returncode != 0:
        _reject(missing_code)
    object_type = _run_git(repo, "cat-file", "-t", oid)
    if object_type.returncode != 0:
        raise EnvironmentFailure
    if object_type.stdout != b"commit\n":
        _reject(type_code)


def _check_history_overrides(repo: Path) -> None:
    replacements = _run_git(repo, "for-each-ref", "--format=%(refname)", "refs/replace/")
    if replacements.returncode != 0:
        raise EnvironmentFailure
    if replacements.stdout.strip():
        _reject("ORIGIN_PROOF_REPLACEMENT_OBJECT_PRESENT")
    common_dir = _common_git_dir(repo)
    try:
        grafts = common_dir / "info" / "grafts"
        if grafts.is_file() and grafts.stat().st_size:
            _reject("ORIGIN_PROOF_REPLACEMENT_OBJECT_PRESENT")
    except Rejection:
        raise
    except OSError as exc:
        raise EnvironmentFailure from exc


def _check_ref_name(repo: Path, ref_name: str, unbound_code: str) -> None:
    result = _run_git(repo, "check-ref-format", ref_name)
    if result.returncode != 0:
        _reject(unbound_code)


def _resolve_ref_commit(
    repo: Path,
    ref_name: str,
    missing_code: str,
    moved_code: str,
    expected_commit: str,
) -> None:
    resolved = _run_git(repo, "show-ref", "--verify", "--hash", ref_name)
    if resolved.returncode in {1, 128}:
        _reject(missing_code)
    if resolved.returncode != 0:
        raise EnvironmentFailure
    symbolic = _run_git(repo, "symbolic-ref", "--quiet", ref_name)
    if symbolic.returncode == 0:
        _reject(moved_code)
    if symbolic.returncode not in {1, 128}:
        raise EnvironmentFailure
    try:
        resolved_oid = resolved.stdout.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError as exc:
        raise EnvironmentFailure from exc
    if resolved_oid != expected_commit:
        _reject(moved_code)


def _refspec_maps(refspec: str, source_ref: str, tracking_ref: str) -> bool:
    candidate = refspec.removeprefix("+")
    if candidate.startswith("^") or ":" not in candidate:
        return False
    source_pattern, destination_pattern = candidate.split(":", maxsplit=1)
    if source_pattern.count("*") != destination_pattern.count("*"):
        return False
    if "*" not in source_pattern:
        return source_pattern == source_ref and destination_pattern == tracking_ref
    if source_pattern.count("*") != 1:
        return False
    source_prefix, source_suffix = source_pattern.split("*")
    if not source_ref.startswith(source_prefix) or not source_ref.endswith(source_suffix):
        return False
    middle_end = len(source_ref) - len(source_suffix) if source_suffix else len(source_ref)
    wildcard = source_ref[len(source_prefix) : middle_end]
    return destination_pattern.replace("*", wildcard) == tracking_ref


def _negative_refspec_matches(refspec: str, source_ref: str) -> bool:
    if not refspec.startswith("^"):
        return False
    pattern = refspec[1:]
    if ":" in pattern or pattern.count("*") > 1:
        return False
    if "*" not in pattern:
        return pattern == source_ref
    prefix, suffix = pattern.split("*")
    return source_ref.startswith(prefix) and source_ref.endswith(suffix)


def _check_origin_binding(repo: Path, proof: Proof) -> None:
    _check_ref_name(repo, proof.origin_source_ref, "ORIGIN_PROOF_ORIGIN_REF_UNBOUND")
    _check_ref_name(repo, proof.origin_tracking_ref, "ORIGIN_PROOF_ORIGIN_REF_UNBOUND")
    refspecs = _run_git(
        repo,
        "config",
        "--local",
        "--no-includes",
        "--get-all",
        f"remote.{proof.origin_remote}.fetch",
    )
    if refspecs.returncode not in {0, 1}:
        raise EnvironmentFailure
    try:
        decoded_refspecs = refspecs.stdout.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as exc:
        raise EnvironmentFailure from exc
    if any(
        _negative_refspec_matches(refspec, proof.origin_source_ref) for refspec in decoded_refspecs
    ) or not any(
        _refspec_maps(refspec, proof.origin_source_ref, proof.origin_tracking_ref)
        for refspec in decoded_refspecs
    ):
        _reject("ORIGIN_PROOF_ORIGIN_REF_UNBOUND")
    _resolve_ref_commit(
        repo,
        proof.origin_tracking_ref,
        "ORIGIN_PROOF_ORIGIN_REF_MISSING",
        "ORIGIN_PROOF_ORIGIN_REF_MOVED",
        proof.origin_expected_commit,
    )


def _check_ancestry(repo: Path, ancestor: str, descendant: str, reason_code: str) -> None:
    result = _run_git(repo, "merge-base", "--is-ancestor", ancestor, descendant)
    if result.returncode == 1:
        _reject(reason_code)
    if result.returncode != 0:
        raise EnvironmentFailure


def _commit_parents(repo: Path, commit: str) -> tuple[str, ...]:
    line = _git_stdout(repo, "rev-list", "--parents", "-n", "1", commit)
    fields = line.split()
    if not fields or fields[0] != commit:
        raise EnvironmentFailure
    return tuple(fields[1:])


def _check_pre_run_ancestry(repo: Path, proof: Proof) -> None:
    result = _run_git(
        repo,
        "merge-base",
        "--is-ancestor",
        proof.pre_run_commit,
        proof.sealed_commit,
    )
    if result.returncode == 0:
        return
    if result.returncode != 1:
        raise EnvironmentFailure
    claimed_parents = _commit_parents(repo, proof.pre_run_commit)
    sealed_history = _run_git(
        repo,
        "rev-list",
        "--parents",
        proof.sealed_commit,
        f"^{proof.base_commit}",
    )
    if sealed_history.returncode != 0:
        raise EnvironmentFailure
    try:
        lines = sealed_history.stdout.decode("ascii", errors="strict").splitlines()
    except UnicodeDecodeError as exc:
        raise EnvironmentFailure from exc
    for line in lines:
        fields = line.split()
        if fields and tuple(fields[1:]) == claimed_parents:
            _reject("ORIGIN_PROOF_PRE_RUN_OBJECT_AMENDED")
    _reject("ORIGIN_PROOF_PRE_RUN_NOT_ANCESTOR")


def _tree_oid(repo: Path, commit: str) -> str:
    return _git_stdout(
        repo,
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{commit}^{{tree}}",
    )


def _packet_tree(repo: Path, commit: str, packet_path: str) -> dict[str, tuple[str, str]]:
    result = _run_git(
        repo,
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        commit,
        "--",
        packet_path,
    )
    if result.returncode != 0:
        raise EnvironmentFailure
    entries: dict[str, tuple[str, str]] = {}
    try:
        records = result.stdout.split(b"\0")
        for record in records:
            if not record:
                continue
            metadata, raw_path = record.split(b"\t", maxsplit=1)
            mode, object_type, oid = metadata.decode("ascii").split(" ")
            path = raw_path.decode("utf-8", errors="strict")
            if mode == "120000":
                _reject("ORIGIN_PROOF_SYMLINK_FORBIDDEN")
            if object_type != "blob" or mode not in {"100644", "100755"}:
                _reject("ORIGIN_PROOF_INPUT_ROSTER_MISMATCH")
            entries[path] = (oid, mode)
    except Rejection:
        raise
    except (UnicodeDecodeError, ValueError) as exc:
        raise EnvironmentFailure from exc
    return entries


def _blob_sha256(repo: Path, oid: str) -> str:
    result = _run_git(repo, "cat-file", "blob", oid)
    if result.returncode != 0:
        raise EnvironmentFailure
    return hashlib.sha256(result.stdout).hexdigest()


def _check_file_bindings(repo: Path, proof: Proof) -> None:
    pre_tree = _packet_tree(repo, proof.pre_run_commit, proof.packet_path)
    sealed_tree = _packet_tree(repo, proof.sealed_commit, proof.packet_path)
    pre_bindings = {binding.path: binding for binding in proof.files if binding.stage == "pre_run"}
    all_bindings = {binding.path: binding for binding in proof.files}
    if set(pre_tree) != set(pre_bindings) or set(sealed_tree) != set(all_bindings):
        _reject("ORIGIN_PROOF_INPUT_ROSTER_MISMATCH")
    for path, binding in all_bindings.items():
        sealed_oid, _sealed_mode = sealed_tree[path]
        if sealed_oid != binding.blob_oid:
            _reject("ORIGIN_PROOF_INPUT_BINDING_MISMATCH")
        if binding.stage == "pre_run":
            pre_oid, pre_mode = pre_tree[path]
            _sealed_oid, sealed_mode = sealed_tree[path]
            if pre_oid != binding.blob_oid or pre_mode != sealed_mode:
                _reject("ORIGIN_PROOF_INPUT_BINDING_MISMATCH")
        if _blob_sha256(repo, binding.blob_oid) != binding.sha256:
            _reject("ORIGIN_PROOF_INPUT_BINDING_MISMATCH")


def _evaluate(repo: Path, proof: Proof) -> Mapping[str, Any]:
    _check_repository(repo, proof)
    _check_commit(
        repo,
        proof.base_commit,
        "ORIGIN_PROOF_BASE_OBJECT_MISSING",
        "ORIGIN_PROOF_BASE_OBJECT_NOT_COMMIT",
    )
    _check_commit(
        repo,
        proof.pre_run_commit,
        "ORIGIN_PROOF_PRE_RUN_OBJECT_MISSING",
        "ORIGIN_PROOF_PRE_RUN_OBJECT_NOT_COMMIT",
    )
    _check_commit(
        repo,
        proof.sealed_commit,
        "ORIGIN_PROOF_SEALED_OBJECT_MISSING",
        "ORIGIN_PROOF_SEALED_OBJECT_NOT_COMMIT",
    )
    if _tree_oid(repo, proof.pre_run_commit) != proof.pre_run_tree:
        _reject("ORIGIN_PROOF_PRE_RUN_TREE_MISMATCH")
    if _tree_oid(repo, proof.sealed_commit) != proof.sealed_tree:
        _reject("ORIGIN_PROOF_SEALED_TREE_MISMATCH")
    _check_history_overrides(repo)

    _check_ref_name(repo, proof.pre_run_anchor_ref, "ORIGIN_PROOF_PRE_RUN_REF_UNBOUND")
    _resolve_ref_commit(
        repo,
        proof.pre_run_anchor_ref,
        "ORIGIN_PROOF_PRE_RUN_REF_MISSING",
        "ORIGIN_PROOF_PRE_RUN_REF_MOVED",
        proof.pre_run_commit,
    )
    _check_origin_binding(repo, proof)
    _check_ancestry(
        repo,
        proof.base_commit,
        proof.pre_run_commit,
        "ORIGIN_PROOF_BASE_NOT_ANCESTOR",
    )
    _check_pre_run_ancestry(repo, proof)
    _check_file_bindings(repo, proof)

    return {
        "schema": RECEIPT_SCHEMA,
        "status": "PASS",
        "reasonCode": ORIGIN_PROOF_VALID,
        "proof": {
            "baseCommit": proof.base_commit,
            "preRunCommit": proof.pre_run_commit,
            "sealedCommit": proof.sealed_commit,
            "sealedTree": proof.sealed_tree,
            "packetPath": proof.packet_path,
            "originSourceRef": proof.origin_source_ref,
            "originTrackingRef": proof.origin_tracking_ref,
            "fileCount": len(proof.files),
            "manifestSha256": proof.manifest_sha256,
        },
    }


def _failure_receipt(status: str, reason_code: str) -> Mapping[str, str]:
    return {
        "schema": RECEIPT_SCHEMA,
        "status": status,
        "reasonCode": reason_code,
    }


def validate(repo: Path, manifest_path: Path) -> tuple[Mapping[str, Any], int]:
    """Validate one proof without network access.

    Returns a stable receipt and process-style exit code: 0 valid, 1 rejected,
    2 invocation or environment failure.
    """

    try:
        manifest, manifest_sha256 = _load_manifest(manifest_path)
        proof = _parse_manifest(manifest, manifest_sha256)
        return _evaluate(repo, proof), 0
    except Rejection as rejection:
        return _failure_receipt("REJECTED", rejection.reason_code), 1
    except (EnvironmentFailure, OSError, subprocess.SubprocessError):
        return _failure_receipt("ERROR", "ORIGIN_PROOF_ENVIRONMENT_ERROR"), 2


def _parser() -> StrictArgumentParser:
    parser = StrictArgumentParser(
        prog="origin-validator",
        description="Validate a sealed research packet from portable Git proof.",
        add_help=False,
    )
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--manifest", type=Path, required=True)
    return parser


def _print_receipt(receipt: Mapping[str, Any]) -> None:
    print(
        json.dumps(
            receipt,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = _parser().parse_args(argv)
    except (InvocationFailure, SystemExit):
        _print_receipt(_failure_receipt("ERROR", "ORIGIN_PROOF_INVOCATION_INVALID"))
        return 2
    receipt, exit_code = validate(
        cast(Path, arguments.repo),
        cast(Path, arguments.manifest),
    )
    _print_receipt(receipt)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
