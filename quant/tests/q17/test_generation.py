from __future__ import annotations

import hashlib
import os
import runpy
import stat
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Protocol, cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import QuantEdgeError
from quant_edge.final_proof import generation
from quant_edge.final_proof.benchmark import validate_q17_benchmark as _validate_q17_benchmark
from quant_edge.final_proof.generation import (
    Q17ArtifactError,
    build_q17_artifacts,
    preflight_q17_output_directory,
    validate_q17_artifact_directory,
    validate_security_scope,
    write_q17_artifacts,
)
from quant_edge.final_proof.replay import ReplayProofError

QUANT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = QUANT_ROOT.parent
GENERATED = QUANT_ROOT / "generated" / "q17"


class _CampaignMain(Protocol):
    __globals__: dict[str, object]

    def __call__(self, argv: list[str], /) -> int: ...


def _raw_artifacts() -> dict[str, bytes]:
    return {path.name: path.read_bytes() for path in sorted(GENERATED.iterdir())}


def _parsed(name: str, raw: dict[str, bytes] | None = None) -> dict[str, object]:
    source = _raw_artifacts() if raw is None else raw
    return parse_canonical_object(source[name])


def _replay(raw: dict[str, bytes] | None = None) -> dict[str, object]:
    return generation._join_replay(
        _parsed("end_to_end_proof.v1.json", raw),
        _parsed("fault_campaign.v1.json", raw),
    )


def _refresh_manifest_row(raw: dict[str, bytes], name: str) -> None:
    manifest = _parsed("artifact_manifest.v1.json", raw)
    rows = cast(list[dict[str, object]], manifest["artifacts"])
    relative = f"generated/q17/{name}"
    row = next(item for item in rows if item["relativePath"] == relative)
    row["byteLength"] = len(raw[name])
    row["sha256"] = hashlib.sha256(raw[name]).hexdigest()
    raw["artifact_manifest.v1.json"] = canonical_json_bytes(manifest)


def _mutate_json(
    raw: dict[str, bytes],
    name: str,
    mutate: Callable[[dict[str, object]], None],
) -> None:
    value = _parsed(name, raw)
    mutate(value)
    raw[name] = canonical_json_bytes(value)
    _refresh_manifest_row(raw, name)


def _write_set() -> dict[str, bytes]:
    return {f"generated/q17/{name}": f"Q17:{name}\n".encode() for name in generation._ALL_NAMES}


def _empty_repo(tmp_path: Path) -> Path:
    repo_root = tmp_path / "repo"
    (repo_root / "quant" / "generated").mkdir(parents=True)
    return repo_root


def _write_exact_directory(directory: Path) -> None:
    directory.mkdir(parents=True)
    for name in generation._ALL_NAMES:
        path = directory / name
        path.write_bytes(f"Q17:{name}\n".encode())
        path.chmod(0o644)


def test_committed_q17_directory_is_exact_and_semantically_current(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_roots: list[Path | None] = []
    original_validate = _validate_q17_benchmark

    def validate_benchmark(
        value: dict[str, object],
        *,
        repo_root: Path | None = None,
        require_actual: bool = True,
        require_current_runtime: bool = True,
    ) -> None:
        observed_roots.append(repo_root)
        original_validate(
            value,
            repo_root=repo_root,
            require_actual=require_actual,
            require_current_runtime=require_current_runtime,
        )

    monkeypatch.setattr(generation, "validate_q17_benchmark", validate_benchmark)
    manifest = validate_q17_artifact_directory(REPO_ROOT)
    assert manifest["schema"] == "Q17ArtifactManifestV1"
    assert manifest["excludedSelf"] == "generated/q17/artifact_manifest.v1.json"
    assert len(cast(list[object], manifest["artifacts"])) == 7
    assert observed_roots == [REPO_ROOT]


def test_builder_reconstructs_committed_bytes_without_remeasuring_benchmark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _raw_artifacts()
    observed_roots: list[Path | None] = []
    original_validate = _validate_q17_benchmark

    def validate_benchmark(
        value: dict[str, object],
        *,
        repo_root: Path | None = None,
        require_actual: bool = True,
        require_current_runtime: bool = True,
    ) -> None:
        observed_roots.append(repo_root)
        original_validate(
            value,
            repo_root=repo_root,
            require_actual=require_actual,
            require_current_runtime=require_current_runtime,
        )

    monkeypatch.setattr(generation, "validate_q17_benchmark", validate_benchmark)
    built = build_q17_artifacts(
        REPO_ROOT,
        replay_proof=_replay(raw),
        research_evidence=_parsed("accepted_research_evidence.v1.json", raw),
        benchmark=_parsed("benchmark.v1.json", raw),
        security_scope=_parsed("security_scope.v1.json", raw),
        component_manifest=_parsed("component_manifest.v1.json", raw),
    )
    assert set(built) == {f"generated/q17/{name}" for name in generation._ALL_NAMES}
    for relative, value in built.items():
        assert value == raw[Path(relative).name]
    assert observed_roots == [REPO_ROOT]


def test_security_scope_is_recomputed_from_current_source_and_frozen_bytes() -> None:
    value = validate_security_scope(REPO_ROOT, _parsed("security_scope.v1.json"))
    scans = cast(dict[str, dict[str, object]], value["securityScan"])
    assert scans["sourceTree"]["clean"] is True
    assert scans["campaignScript"]["clean"] is True
    assert cast(dict[str, object], value["frozenFiles"])["clean"] is False
    declared = cast(dict[str, object], value["declaredC17PathScope"])
    assert declared["clean"] is True
    assert value["scopeEvidenceClass"] == "DECLARED_EXPECTED_C17_INVENTORY"
    assert value["actualStagedCommitScope"] == "NOT_MEASURED_RESERVED_FOR_Q17_RECEIPT"
    assert len(generation.FROZEN_FILE_SHA256) == 9
    assert dict(generation.FROZEN_FILE_SHA256)["package-lock.json"] == (
        "3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf"
    )


@pytest.mark.parametrize(
    "value",
    [None, "", "/absolute.json", "../escape.json", "x\\y.json", "x://y", "benchmark.json"],
)
def test_safe_name_rejects_non_inventory_and_unsafe_paths(value: object) -> None:
    with pytest.raises(Q17ArtifactError, match="artifact path"):
        generation._safe_name(value)


def test_split_replay_rejects_boolean_version_and_cross_artifact_identity() -> None:
    proof = _parsed("end_to_end_proof.v1.json")
    faults = _parsed("fault_campaign.v1.json")
    proof["version"] = True
    with pytest.raises(Q17ArtifactError, match="identity"):
        generation._join_replay(proof, faults)

    proof = _parsed("end_to_end_proof.v1.json")
    faults = _parsed("fault_campaign.v1.json")
    faults["assessmentSha256"] = "0" * 64
    with pytest.raises(Q17ArtifactError, match="inconsistent"):
        generation._join_replay(proof, faults)


def test_security_validator_rejects_bool_alias_and_forged_clean_scan() -> None:
    security = _parsed("security_scope.v1.json")
    security["advisoryOnly"] = 1
    with pytest.raises(Q17ArtifactError, match="identity"):
        validate_security_scope(REPO_ROOT, security)

    security = _parsed("security_scope.v1.json")
    scans = cast(dict[str, dict[str, object]], security["securityScan"])
    scans["sourceTree"]["findingCount"] = True
    with pytest.raises(Q17ArtifactError, match="clean exact"):
        validate_security_scope(REPO_ROOT, security)


def test_strict_helpers_and_security_scope_reject_malformed_truth() -> None:
    with pytest.raises(Q17ArtifactError, match="plain object"):
        generation._object(None, field="value")
    with pytest.raises(Q17ArtifactError, match="plain object"):
        generation._object({1: "not-text"}, field="value")
    with pytest.raises(Q17ArtifactError, match="array"):
        generation._array({}, field="value")
    with pytest.raises(Q17ArtifactError, match="fields are not exact"):
        generation._exact({"extra": True}, set(), field="value")

    security = _parsed("security_scope.v1.json")
    conclusion = cast(dict[str, object], security["conclusion"])
    conclusion["externalNetwork"] = True
    with pytest.raises(Q17ArtifactError, match="not fail-closed"):
        validate_security_scope(REPO_ROOT, security)

    security = _parsed("security_scope.v1.json")
    declared = cast(dict[str, object], security["declaredC17PathScope"])
    declared["changedPathCount"] = cast(int, declared["changedPathCount"]) + 1
    with pytest.raises(Q17ArtifactError, match="recomputed current truth"):
        validate_security_scope(REPO_ROOT, security)


def test_safe_directory_reader_rejects_missing_extra_symlink_and_directory(
    tmp_path: Path,
) -> None:
    directory = tmp_path / "q17"
    directory.mkdir()
    for name in generation._ALL_NAMES:
        (directory / name).write_bytes(b"x")
    assert set(generation._safe_read_directory(directory)) == set(generation._ALL_NAMES)

    (directory / generation._ALL_NAMES[0]).unlink()
    with pytest.raises(Q17ArtifactError, match="inventory"):
        generation._safe_read_directory(directory)
    (directory / generation._ALL_NAMES[0]).write_bytes(b"x")
    (directory / "stray.json").write_bytes(b"x")
    with pytest.raises(Q17ArtifactError, match="inventory"):
        generation._safe_read_directory(directory)
    (directory / "stray.json").unlink()

    target = directory / generation._ALL_NAMES[1]
    target.unlink()
    target.symlink_to(directory / generation._ALL_NAMES[0])
    with pytest.raises(Q17ArtifactError, match="unique bounded regular"):
        generation._safe_read_directory(directory)
    target.unlink()
    target.mkdir()
    with pytest.raises(Q17ArtifactError, match="bounded regular"):
        generation._safe_read_directory(directory)


def test_safe_directory_reader_rejects_root_link_unavailable_and_oversize(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    absent = tmp_path / "absent"
    with pytest.raises(Q17ArtifactError, match="unavailable"):
        generation._safe_read_directory(absent)
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    with pytest.raises(Q17ArtifactError, match="must not use links"):
        generation._safe_read_directory(link)

    for name in generation._ALL_NAMES:
        (real / name).write_bytes(b"xx")
    monkeypatch.setattr(generation, "_MAX_ARTIFACT_BYTES", 1)
    with pytest.raises(Q17ArtifactError, match="bounded regular"):
        generation._safe_read_directory(real)


def test_safe_directory_reader_rejects_open_and_identity_races(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = tmp_path / "q17"
    directory.mkdir()
    for name in generation._ALL_NAMES:
        (directory / name).write_bytes(b"x")
    original_open = os.open

    def denied_open(*args: object, **kwargs: object) -> int:
        raise PermissionError("denied")

    monkeypatch.setattr(os, "open", denied_open)
    with pytest.raises(Q17ArtifactError, match="hierarchy cannot"):
        generation._safe_read_directory(directory)
    monkeypatch.setattr(os, "open", original_open)

    original_fstat = os.fstat
    calls = 0

    def changed_fstat(descriptor: int) -> os.stat_result:
        nonlocal calls
        calls += 1
        observed = original_fstat(descriptor)
        if calls == 1:
            values = list(observed)
            values[stat.ST_INO] += 1
            return os.stat_result(values)
        return observed

    monkeypatch.setattr(os, "fstat", changed_fstat)
    with pytest.raises(Q17ArtifactError, match="root changed while opening"):
        generation._safe_read_directory(directory)


def test_safe_directory_reader_rejects_symlinked_parent_and_special_entries(
    tmp_path: Path,
) -> None:
    real_parent = tmp_path / "real-parent"
    directory = real_parent / "q17"
    _write_exact_directory(directory)
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(real_parent, target_is_directory=True)
    with pytest.raises(Q17ArtifactError, match="must not use links"):
        generation._safe_read_directory(linked_parent / "q17")

    target = directory / generation._ALL_NAMES[0]
    target.unlink()
    target.symlink_to(directory / "absent")
    with pytest.raises(Q17ArtifactError, match="unique bounded regular"):
        generation._safe_read_directory(directory)
    target.unlink()
    os.mkfifo(target)
    with pytest.raises(Q17ArtifactError, match="unique bounded regular"):
        generation._safe_read_directory(directory)


def test_safe_directory_reader_rejects_hardlinks_and_entry_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = tmp_path / "q17"
    _write_exact_directory(directory)
    first = directory / generation._ALL_NAMES[0]
    second = directory / generation._ALL_NAMES[1]
    second.unlink()
    os.link(first, second)
    with pytest.raises(Q17ArtifactError, match="unique bounded regular"):
        generation._safe_read_directory(directory)

    second.unlink()
    second.write_bytes(b"restored")
    original_open = os.open
    replaced = False

    def replace_before_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal replaced
        if path == generation._ALL_NAMES[0] and dir_fd is not None and not replaced:
            replaced = True
            first.unlink()
            first.write_bytes(b"replacement")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", replace_before_open)
    with pytest.raises(Q17ArtifactError, match="replaced while opening"):
        generation._safe_read_directory(directory)


def test_safe_directory_reader_rejects_parent_directory_swap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = tmp_path / "q17"
    parked = tmp_path / "parked"
    _write_exact_directory(directory)
    original_open = os.open
    swapped = False

    def swap_parent_before_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal swapped
        if path == generation._ALL_NAMES[0] and dir_fd is not None and not swapped:
            swapped = True
            directory.rename(parked)
            _write_exact_directory(directory)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", swap_parent_before_open)
    with pytest.raises(Q17ArtifactError, match="hierarchy was replaced"):
        generation._safe_read_directory(directory)


def test_safe_directory_reader_revalidates_every_leaf_after_all_reads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = tmp_path / "q17"
    _write_exact_directory(directory)
    first = directory / generation._ALL_NAMES[0]
    replacement = tmp_path / ".replacement"
    replacement.write_bytes(b"replacement\n")
    replacement.chmod(0o644)
    original_open = os.open
    replaced = False

    def replace_prior_leaf(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal replaced
        if path == generation._ALL_NAMES[1] and dir_fd is not None and not replaced:
            replaced = True
            replacement.replace(first)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", replace_prior_leaf)
    with pytest.raises(Q17ArtifactError, match="identities changed"):
        generation._safe_read_directory(directory)


def test_safe_directory_reader_rejects_same_inode_rewrite_with_restored_mtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = tmp_path / "q17"
    _write_exact_directory(directory)
    first = directory / generation._ALL_NAMES[0]
    original = first.stat()
    original_open = os.open
    rewritten = False

    def rewrite_prior_leaf(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal rewritten
        if path == generation._ALL_NAMES[1] and dir_fd is not None and not rewritten:
            rewritten = True
            first.write_bytes(b"x" * original.st_size)
            first.chmod(0o600)
            first.chmod(0o644)
            os.utime(first, ns=(original.st_atime_ns, original.st_mtime_ns))
            assert first.stat().st_ino == original.st_ino
            assert first.stat().st_mtime_ns == original.st_mtime_ns
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", rewrite_prior_leaf)
    with pytest.raises(Q17ArtifactError, match="identities changed"):
        generation._safe_read_directory(directory)


def test_directory_identity_chain_and_inventory_fail_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plain = tmp_path / "plain"
    plain.write_bytes(b"x")
    with pytest.raises(Q17ArtifactError, match="non-directory"):
        generation._directory_identity(plain.stat())
    with pytest.raises(Q17ArtifactError, match="hierarchy is closed"):
        _ = generation._DirectoryChain(Path("/"), (0, 0)).current_fd
    with pytest.raises(Q17ArtifactError, match="absolute Path"):
        generation._open_directory_chain(Path("relative"))

    original_stat = os.stat

    def denied_stat(
        path: str | bytes | int | os.PathLike[str] | os.PathLike[bytes],
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        raise PermissionError(f"denied: {path!r}")

    monkeypatch.setattr(os, "stat", denied_stat)
    with pytest.raises(Q17ArtifactError, match="cannot be inspected"):
        generation._stat_entry(0, "artifact")
    monkeypatch.setattr(os, "stat", original_stat)

    original_listdir = os.listdir

    def denied_listdir(_path: int) -> list[str]:
        raise PermissionError("denied")

    monkeypatch.setattr(os, "listdir", denied_listdir)
    with pytest.raises(Q17ArtifactError, match="cannot be listed"):
        generation._inspect_inventory(
            0,
            exact=False,
            allow_temps=False,
            require_mode=False,
        )
    monkeypatch.setattr(os, "listdir", lambda _fd: [generation._ALL_NAMES[0]])
    monkeypatch.setattr(
        generation,
        "_stat_entry",
        lambda _fd, _name: None,
    )
    with pytest.raises(Q17ArtifactError, match="changed during inspection"):
        generation._inspect_inventory(
            0,
            exact=False,
            allow_temps=False,
            require_mode=False,
        )
    monkeypatch.setattr(os, "listdir", original_listdir)


def test_directory_chain_append_and_revalidate_failure_matrix(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    child = root / "child"
    child.mkdir(parents=True)
    root_info = root.stat()
    root_fd = os.open(root, generation._DIRECTORY_FLAGS)
    chain = generation._DirectoryChain(
        root,
        generation._directory_identity(root_info),
        [root_fd],
    )
    original_stat = os.stat
    child_stats = 0

    def changed_child_stat(
        path: str | bytes | int | os.PathLike[str] | os.PathLike[bytes],
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        nonlocal child_stats
        observed = original_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)
        if path == "child":
            child_stats += 1
            if child_stats == 2:
                values = list(observed)
                values[stat.ST_INO] += 1
                return os.stat_result(values)
        return observed

    monkeypatch.setattr(os, "stat", changed_child_stat)
    with pytest.raises(Q17ArtifactError, match="changed while opening"):
        chain.append("child")
    monkeypatch.setattr(os, "stat", original_stat)
    chain.close()

    root_fd = os.open(root, generation._DIRECTORY_FLAGS)
    chain = generation._DirectoryChain(
        root,
        generation._directory_identity(root_info),
        [root_fd],
    )
    child_stats = 0

    def fail_after_child_open(
        path: str | bytes | int | os.PathLike[str] | os.PathLike[bytes],
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        nonlocal child_stats
        if path == "child":
            child_stats += 1
            if child_stats == 2:
                raise PermissionError("post-open stat denied")
        return original_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(os, "stat", fail_after_child_open)
    with pytest.raises(Q17ArtifactError, match="cannot be opened safely"):
        chain.append("child")
    monkeypatch.setattr(os, "stat", original_stat)
    chain.close()

    root_fd = os.open(root, generation._DIRECTORY_FLAGS)
    chain = generation._DirectoryChain(
        root,
        (root_info.st_dev, root_info.st_ino + 1),
        [root_fd],
    )
    with pytest.raises(Q17ArtifactError, match="root was replaced"):
        chain.revalidate()
    chain.close()

    other = tmp_path / "other"
    other.mkdir()
    other_fd = os.open(other, generation._DIRECTORY_FLAGS)
    chain = generation._DirectoryChain(
        root,
        generation._directory_identity(root_info),
        [other_fd],
    )
    with pytest.raises(Q17ArtifactError, match="opened directory root changed"):
        chain.revalidate()

    original_fstat = os.fstat

    def denied_fstat(_descriptor: int) -> os.stat_result:
        raise PermissionError("denied")

    normal_fd = os.open(root, generation._DIRECTORY_FLAGS)
    normal = generation._DirectoryChain(
        root,
        generation._directory_identity(root_info),
        [normal_fd],
    )
    monkeypatch.setattr(os, "fstat", denied_fstat)
    with pytest.raises(Q17ArtifactError, match="cannot be revalidated"):
        normal.revalidate()
    monkeypatch.setattr(os, "fstat", original_fstat)
    normal.close()
    chain.close()


def test_safe_directory_reader_rejects_mode_short_read_and_read_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = tmp_path / "q17"
    _write_exact_directory(directory)
    target = directory / generation._ALL_NAMES[0]
    target.chmod(0o755)
    with pytest.raises(Q17ArtifactError, match="regular 0644"):
        generation._safe_read_directory(directory)
    target.chmod(0o644)

    original_read = os.read
    monkeypatch.setattr(os, "read", lambda _descriptor, _size: b"")
    with pytest.raises(Q17ArtifactError, match="changed during bounded read"):
        generation._safe_read_directory(directory)

    def denied_read(_descriptor: int, _size: int) -> bytes:
        raise PermissionError("denied")

    monkeypatch.setattr(os, "read", denied_read)
    with pytest.raises(Q17ArtifactError, match="cannot be opened safely"):
        generation._safe_read_directory(directory)
    monkeypatch.setattr(os, "read", original_read)


def test_writer_requires_exact_prefixed_paths_and_publishes_manifest_last_0644(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    artifacts = _write_set()
    bad = dict(artifacts)
    value = bad.pop("generated/q17/benchmark.v1.json")
    bad["escape/generated/q17/benchmark.v1.json"] = value
    with pytest.raises(Q17ArtifactError, match="paths are not exact"):
        write_q17_artifacts(repo_root, bad)

    output = repo_root / "quant" / "generated" / "q17"
    output.mkdir()
    stale = output / generation._OUTPUT_NAMES[0]
    stale.write_bytes(b"stale")
    stale.chmod(0o755)
    order: list[str] = []
    original_replace = generation._atomic_replace_artifact

    def record_replace(
        chain: generation._DirectoryChain,
        *,
        name: str,
        raw: bytes,
        expected_target: generation._FileIdentity | None,
    ) -> None:
        order.append(name)
        original_replace(
            chain,
            name=name,
            raw=raw,
            expected_target=expected_target,
        )

    monkeypatch.setattr(generation, "_atomic_replace_artifact", record_replace)
    write_q17_artifacts(repo_root, artifacts)
    assert order[-1] == generation._MANIFEST_NAME
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    assert tuple(sorted(path.name for path in output.iterdir())) == generation._ALL_NAMES
    for relative, raw in artifacts.items():
        path = output / relative.removeprefix("generated/q17/")
        assert path.read_bytes() == raw
        assert stat.S_IMODE(path.stat().st_mode) == 0o644


def test_writer_recovers_exact_partial_set_and_stale_owned_temp(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    artifacts = _write_set()
    original_replace = generation._atomic_replace_artifact
    calls = 0

    def fail_third(
        chain: generation._DirectoryChain,
        *,
        name: str,
        raw: bytes,
        expected_target: generation._FileIdentity | None,
    ) -> None:
        nonlocal calls
        calls += 1
        if calls == 3:
            raise Q17ArtifactError("injected publication failure")
        original_replace(
            chain,
            name=name,
            raw=raw,
            expected_target=expected_target,
        )

    monkeypatch.setattr(generation, "_atomic_replace_artifact", fail_third)
    with pytest.raises(Q17ArtifactError, match="injected publication failure"):
        write_q17_artifacts(repo_root, artifacts)
    output = repo_root / "quant" / "generated" / "q17"
    assert {path.name for path in output.iterdir()} == set(generation._OUTPUT_NAMES[:2])

    stale_temp = output / generation._TEMP_NAMES[generation._OUTPUT_NAMES[2]]
    stale_temp.write_bytes(b"")
    monkeypatch.setattr(generation, "_atomic_replace_artifact", original_replace)
    write_q17_artifacts(repo_root, artifacts)
    assert not stale_temp.exists()
    assert generation._safe_read_directory(output) == {
        relative.removeprefix("generated/q17/"): raw for relative, raw in artifacts.items()
    }


def test_writer_cleans_atomic_temp_after_interrupted_write_and_can_resume(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    artifacts = _write_set()
    original_write = os.write

    def interrupted_write(_descriptor: int, _raw: bytes) -> int:
        raise OSError("interrupted")

    monkeypatch.setattr(os, "write", interrupted_write)
    with pytest.raises(Q17ArtifactError, match="cannot be published safely"):
        write_q17_artifacts(repo_root, artifacts)
    output = repo_root / "quant" / "generated" / "q17"
    assert tuple(output.iterdir()) == ()

    monkeypatch.setattr(os, "write", original_write)
    write_q17_artifacts(repo_root, artifacts)
    assert {path.name for path in output.iterdir()} == set(generation._ALL_NAMES)


def test_preflight_and_writer_reject_unsafe_output_ancestry_and_entries(
    tmp_path: Path,
) -> None:
    repo_root = tmp_path / "repo"
    (repo_root / "quant").mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (repo_root / "quant" / "generated").symlink_to(outside, target_is_directory=True)
    with pytest.raises(Q17ArtifactError, match="must not use links"):
        preflight_q17_output_directory(repo_root)
    with pytest.raises(Q17ArtifactError, match="must not use links"):
        write_q17_artifacts(repo_root, _write_set())
    assert tuple(outside.iterdir()) == ()

    (repo_root / "quant" / "generated").unlink()
    (repo_root / "quant" / "generated").mkdir()
    (repo_root / "quant" / "generated" / "q17").symlink_to(
        repo_root / "quant" / "generated" / "missing",
        target_is_directory=True,
    )
    with pytest.raises(Q17ArtifactError, match="real directory"):
        preflight_q17_output_directory(repo_root)
    (repo_root / "quant" / "generated" / "q17").unlink()
    (repo_root / "quant" / "generated" / "q17").mkdir(parents=True)
    output = repo_root / "quant" / "generated" / "q17"
    os.mkfifo(output / generation._ALL_NAMES[0])
    with pytest.raises(Q17ArtifactError, match="unique bounded regular"):
        preflight_q17_output_directory(repo_root)
    with pytest.raises(Q17ArtifactError, match="unique bounded regular"):
        write_q17_artifacts(repo_root, _write_set())


def test_writer_rejects_entry_and_parent_replacement_races(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    artifacts = _write_set()
    write_q17_artifacts(repo_root, artifacts)
    output = repo_root / "quant" / "generated" / "q17"
    original_replace = generation._atomic_replace_artifact
    replaced = False

    def replace_target(
        chain: generation._DirectoryChain,
        *,
        name: str,
        raw: bytes,
        expected_target: generation._FileIdentity | None,
    ) -> None:
        nonlocal replaced
        if not replaced:
            replaced = True
            target = output / name
            target.unlink()
            target.write_bytes(b"raced")
        original_replace(
            chain,
            name=name,
            raw=raw,
            expected_target=expected_target,
        )

    monkeypatch.setattr(generation, "_atomic_replace_artifact", replace_target)
    with pytest.raises(Q17ArtifactError, match="replaced before atomic"):
        write_q17_artifacts(repo_root, artifacts)

    monkeypatch.setattr(generation, "_atomic_replace_artifact", original_replace)
    write_q17_artifacts(repo_root, artifacts)
    parked = repo_root / "quant" / "generated" / "parked"
    swapped = False

    def swap_parent(
        chain: generation._DirectoryChain,
        *,
        name: str,
        raw: bytes,
        expected_target: generation._FileIdentity | None,
    ) -> None:
        nonlocal swapped
        if not swapped:
            swapped = True
            output.rename(parked)
            output.mkdir()
        original_replace(
            chain,
            name=name,
            raw=raw,
            expected_target=expected_target,
        )

    monkeypatch.setattr(generation, "_atomic_replace_artifact", swap_parent)
    with pytest.raises(Q17ArtifactError, match="hierarchy was replaced"):
        write_q17_artifacts(repo_root, artifacts)


def test_writer_uses_nofollow_nonblocking_cloexec_descriptor_flags(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    opened: list[tuple[str, int]] = []
    original_open = os.open

    def record_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        opened.append((os.fsdecode(path), flags))
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", record_open)
    write_q17_artifacts(repo_root, _write_set())
    required = (
        getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0)
    )
    assert required
    assert opened
    assert all(flags & required == required for _path, flags in opened)
    writes = [flags for path, flags in opened if path in generation._TEMP_NAMES.values()]
    assert len(writes) == len(generation._ALL_NAMES)
    assert all(flags & os.O_EXCL and flags & os.O_CREAT for flags in writes)


def test_preflight_creation_and_atomic_publication_failure_matrix(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    preflight_q17_output_directory(repo_root)
    output = repo_root / "quant" / "generated" / "q17"
    output.mkdir()
    preflight_q17_output_directory(repo_root)
    output.rmdir()

    original_mkdir = os.mkdir

    def denied_mkdir(
        _path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> None:
        raise PermissionError(f"denied mode={mode:o} dir_fd={dir_fd}")

    monkeypatch.setattr(os, "mkdir", denied_mkdir)
    with pytest.raises(Q17ArtifactError, match="cannot be created safely"):
        write_q17_artifacts(repo_root, _write_set())
    monkeypatch.setattr(os, "mkdir", original_mkdir)

    chain = generation._open_q17_output(repo_root, create=True)
    assert chain is not None
    name = generation._ALL_NAMES[0]
    temp_name = generation._TEMP_NAMES[name]
    temp_path = output / temp_name
    temp_path.write_bytes(b"stale")
    with pytest.raises(Q17ArtifactError, match="unexpectedly exists"):
        generation._atomic_replace_artifact(
            chain,
            name=name,
            raw=b"proof",
            expected_target=None,
        )
    temp_path.unlink(missing_ok=True)

    original_write_all = generation._write_all

    def oversized_write(descriptor: int, raw: bytes) -> None:
        original_write_all(descriptor, raw + b"x")

    monkeypatch.setattr(generation, "_write_all", oversized_write)
    with pytest.raises(Q17ArtifactError, match="size is inconsistent"):
        generation._atomic_replace_artifact(
            chain,
            name=name,
            raw=b"proof",
            expected_target=None,
        )
    monkeypatch.setattr(generation, "_write_all", original_write_all)

    original_stat_entry = generation._stat_entry
    temp_calls = 0
    foreign = tmp_path / "foreign"
    foreign.write_bytes(b"proof")
    foreign.chmod(0o644)

    def replaced_temp_stat(directory_fd: int, candidate: str) -> os.stat_result | None:
        nonlocal temp_calls
        if candidate == temp_name:
            temp_calls += 1
            if temp_calls == 2:
                return foreign.stat()
        return original_stat_entry(directory_fd, candidate)

    monkeypatch.setattr(generation, "_stat_entry", replaced_temp_stat)
    with pytest.raises(Q17ArtifactError, match="temp was replaced"):
        generation._atomic_replace_artifact(
            chain,
            name=name,
            raw=b"proof",
            expected_target=None,
        )
    monkeypatch.setattr(generation, "_stat_entry", original_stat_entry)

    target = output / name
    target.write_bytes(b"appeared")
    with pytest.raises(Q17ArtifactError, match="appeared during atomic"):
        generation._atomic_replace_artifact(
            chain,
            name=name,
            raw=b"proof",
            expected_target=None,
        )
    target.unlink()

    original_replace = os.replace

    def no_replace(
        _src: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        _dst: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        *,
        src_dir_fd: int | None = None,
        dst_dir_fd: int | None = None,
    ) -> None:
        assert src_dir_fd == dst_dir_fd

    monkeypatch.setattr(os, "replace", no_replace)
    with pytest.raises(Q17ArtifactError, match="publication identity"):
        generation._atomic_replace_artifact(
            chain,
            name=name,
            raw=b"proof",
            expected_target=None,
        )
    monkeypatch.setattr(os, "replace", original_replace)
    chain.close()

    monkeypatch.setattr(os, "write", lambda _descriptor, _raw: 0)
    with pytest.raises(Q17ArtifactError, match="made no progress"):
        generation._write_all(0, b"proof")

    invalid = _write_set()
    invalid["generated/q17/benchmark.v1.json"] = b""
    with pytest.raises(Q17ArtifactError, match="bytes are invalid"):
        write_q17_artifacts(repo_root, invalid)


def test_recoverable_temp_failure_matrix_and_final_readback_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = _empty_repo(tmp_path)
    chain = generation._open_q17_output(repo_root, create=True)
    assert chain is not None
    output = repo_root / "quant" / "generated" / "q17"
    temp_name = generation._TEMP_NAMES[generation._ALL_NAMES[0]]
    temp = output / temp_name
    temp.write_bytes(b"old")
    old_identity = generation._file_identity(temp.stat())
    temp.unlink()
    temp.write_bytes(b"new")
    with pytest.raises(Q17ArtifactError, match="temp was replaced"):
        generation._remove_recoverable_temps(chain, {temp_name: old_identity})

    expected = generation._file_identity(temp.stat())
    original_open = os.open

    def denied_temp_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        if path == temp_name:
            raise PermissionError("denied")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", denied_temp_open)
    with pytest.raises(Q17ArtifactError, match="cannot be opened safely"):
        generation._remove_recoverable_temps(chain, {temp_name: expected})
    monkeypatch.setattr(os, "open", original_open)

    original_unlink = os.unlink

    def denied_unlink(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        *,
        dir_fd: int | None = None,
    ) -> None:
        if path == temp_name:
            raise PermissionError("denied")
        original_unlink(path, dir_fd=dir_fd)

    monkeypatch.setattr(os, "unlink", denied_unlink)
    with pytest.raises(Q17ArtifactError, match="cannot be removed safely"):
        generation._remove_recoverable_temps(chain, {temp_name: expected})

    def ignored_unlink(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        *,
        dir_fd: int | None = None,
    ) -> None:
        if path != temp_name:
            original_unlink(path, dir_fd=dir_fd)

    monkeypatch.setattr(os, "unlink", ignored_unlink)
    with pytest.raises(Q17ArtifactError, match="remained after removal"):
        generation._remove_recoverable_temps(chain, {temp_name: expected})
    monkeypatch.setattr(os, "unlink", original_unlink)
    temp.unlink()
    chain.close()

    original_read_open = generation._read_open_directory
    monkeypatch.setattr(generation, "_read_open_directory", lambda _chain: {})
    with pytest.raises(Q17ArtifactError, match="differ from the write-set"):
        write_q17_artifacts(repo_root, _write_set())
    monkeypatch.setattr(generation, "_read_open_directory", original_read_open)


def test_directory_validator_rejects_manifest_structure_hash_and_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _raw_artifacts()
    manifest = _parsed("artifact_manifest.v1.json", raw)
    manifest["version"] = True
    raw["artifact_manifest.v1.json"] = canonical_json_bytes(manifest)
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="identity"):
        validate_q17_artifact_directory(REPO_ROOT)

    raw = _raw_artifacts()
    manifest = _parsed("artifact_manifest.v1.json", raw)
    rows = cast(list[dict[str, object]], manifest["artifacts"])
    rows.reverse()
    raw["artifact_manifest.v1.json"] = canonical_json_bytes(manifest)
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="inventory"):
        validate_q17_artifact_directory(REPO_ROOT)

    raw = _raw_artifacts()
    manifest = _parsed("artifact_manifest.v1.json", raw)
    rows = cast(list[dict[str, object]], manifest["artifacts"])
    rows[0]["sha256"] = "0" * 64
    raw["artifact_manifest.v1.json"] = canonical_json_bytes(manifest)
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="bytes do not match"):
        validate_q17_artifact_directory(REPO_ROOT)


def test_directory_validator_rejects_noncanonical_manifest_row_path_and_child(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _raw_artifacts()
    raw["artifact_manifest.v1.json"] = b"{"
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="manifest is not canonical"):
        validate_q17_artifact_directory(REPO_ROOT)

    raw = _raw_artifacts()
    manifest = _parsed("artifact_manifest.v1.json", raw)
    rows = cast(list[dict[str, object]], manifest["artifacts"])
    rows[0]["relativePath"] = "accepted_research_evidence.v1.json"
    raw["artifact_manifest.v1.json"] = canonical_json_bytes(manifest)
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="path is not Q17-relative"):
        validate_q17_artifact_directory(REPO_ROOT)

    raw = _raw_artifacts()
    raw["benchmark.v1.json"] = b"{"
    _refresh_manifest_row(raw, "benchmark.v1.json")
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="not canonical JSON: benchmark"):
        validate_q17_artifact_directory(REPO_ROOT)


@pytest.mark.parametrize(
    ("name", "mutate", "message"),
    [
        (
            "end_to_end_proof.v1.json",
            lambda value: value.__setitem__("version", True),
            "identity",
        ),
        (
            "accepted_research_evidence.v1.json",
            lambda value: value.__setitem__("version", True),
            "accepted truth",
        ),
        (
            "benchmark.v1.json",
            lambda value: value.__setitem__("productionClaims", True),
            "benchmark",
        ),
        (
            "security_scope.v1.json",
            lambda value: value.__setitem__("advisoryOnly", 1),
            "identity",
        ),
        (
            "component_manifest.v1.json",
            lambda value: value.__setitem__("version", True),
            "component manifest",
        ),
    ],
)
def test_directory_validator_rejects_semantic_artifact_forgery(
    name: str,
    mutate: Callable[[dict[str, object]], None],
    message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _raw_artifacts()
    _mutate_json(raw, name, mutate)
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(QuantEdgeError, match=message):
        validate_q17_artifact_directory(REPO_ROOT)


def test_directory_validator_rejects_instruction_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _raw_artifacts()
    raw["integration_instructions.md"] += b"drift\n"
    _refresh_manifest_row(raw, "integration_instructions.md")
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="instructions drifted"):
        validate_q17_artifact_directory(REPO_ROOT)


def test_integration_instructions_separate_history_from_current_corrections() -> None:
    instructions = generation._integration_instructions().decode()
    committed = (GENERATED / "integration_instructions.md").read_text()

    assert instructions == committed
    assert "Historical C17/A17 acceptance remains immutable" in instructions
    assert "Current corrected Q16/Q17 bytes are `NOT_ACCEPTED`" in instructions
    assert "historical receipts do not attest current bytes" in instructions
    assert "Accepted local Q16 startup" not in instructions


def test_directory_validator_binds_generator_and_entire_regenerated_manifest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _raw_artifacts()
    manifest = _parsed("artifact_manifest.v1.json", raw)
    manifest["generator"] = "forged.generator:build"
    raw["artifact_manifest.v1.json"] = canonical_json_bytes(manifest)
    monkeypatch.setattr(generation, "_safe_read_directory", lambda _directory: raw)
    with pytest.raises(Q17ArtifactError, match="exact regenerated current truth"):
        validate_q17_artifact_directory(REPO_ROOT)


def test_builder_rejects_research_projection_that_differs_from_current_repo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current = _parsed("accepted_research_evidence.v1.json")
    drifted = deepcopy(current)
    drifted["schema"] = "Q17DriftedResearchEvidenceV1"
    monkeypatch.setattr(generation, "project_research_evidence", lambda _root: drifted)
    with pytest.raises(Q17ArtifactError, match="current repo truth"):
        build_q17_artifacts(
            REPO_ROOT,
            replay_proof=_replay(),
            research_evidence=current,
            benchmark=_parsed("benchmark.v1.json"),
            security_scope=_parsed("security_scope.v1.json"),
            component_manifest=_parsed("component_manifest.v1.json"),
        )


def test_artifact_manifest_is_self_excluding_and_sorted() -> None:
    raw = _raw_artifacts()
    manifest = _parsed("artifact_manifest.v1.json", raw)
    paths = [
        cast(str, cast(dict[str, object], row)["relativePath"])
        for row in cast(list[object], manifest["artifacts"])
    ]
    assert paths == sorted(paths)
    assert "generated/q17/artifact_manifest.v1.json" not in paths
    assert manifest["excludedSelf"] == "generated/q17/artifact_manifest.v1.json"
    assert (
        generation._artifact_manifest(
            {name: value for name, value in raw.items() if name != generation._MANIFEST_NAME}
        )
        == raw[generation._MANIFEST_NAME]
    )


def test_build_rejects_forged_replay_before_writing() -> None:
    replay = deepcopy(_replay())
    replay["version"] = True
    with pytest.raises(ReplayProofError, match="identity"):
        build_q17_artifacts(
            REPO_ROOT,
            replay_proof=replay,
            research_evidence=_parsed("accepted_research_evidence.v1.json"),
            benchmark=_parsed("benchmark.v1.json"),
            security_scope=_parsed("security_scope.v1.json"),
            component_manifest=_parsed("component_manifest.v1.json"),
        )


def test_campaign_preflights_before_work_writes_then_validates_before_printing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    namespace = runpy.run_path(str(QUANT_ROOT / "scripts" / "q17_acceptance_campaign.py"))
    main = cast(_CampaignMain, namespace["main"])
    campaign_globals = main.__globals__
    events: list[str] = []
    artifacts = {"generated/q17/proof": b"proof"}

    def event(name: str, result: object) -> Callable[..., object]:
        def record(*_args: object, **_kwargs: object) -> object:
            events.append(name)
            return result

        return record

    replacements: dict[str, object] = {
        "preflight_q17_output_directory": event("preflight", None),
        "run_replay_fault_campaign": event("replay", {}),
        "project_research_evidence": event("evidence", {}),
        "run_q17_benchmark": event("benchmark", {}),
        "_security_scope": event("security", {}),
        "build_component_manifest": event("components", {}),
        "build_q17_artifacts": event("build", artifacts),
        "write_q17_artifacts": event("write", None),
        "validate_q17_artifact_directory": event("validate", {}),
    }
    for name, replacement in replacements.items():
        monkeypatch.setitem(campaign_globals, name, replacement)

    assert main(["q17_acceptance_campaign.py", str(tmp_path)]) == 0
    assert events == [
        "preflight",
        "replay",
        "evidence",
        "benchmark",
        "security",
        "components",
        "build",
        "write",
        "validate",
    ]
    assert "generated/q17/proof 5 bytes sha256=" in capsys.readouterr().out

    events.clear()

    def fail_validation(*_args: object, **_kwargs: object) -> object:
        events.append("validate-failed")
        raise Q17ArtifactError("post-write validation failed")

    monkeypatch.setitem(
        campaign_globals,
        "validate_q17_artifact_directory",
        fail_validation,
    )
    with pytest.raises(Q17ArtifactError, match="post-write validation failed"):
        main(["q17_acceptance_campaign.py", str(tmp_path)])
    assert capsys.readouterr().out == ""
    assert events[-2:] == ["write", "validate-failed"]
