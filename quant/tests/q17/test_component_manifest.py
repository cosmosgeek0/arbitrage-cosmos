from __future__ import annotations

import copy
import hashlib
import os
import shutil
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.final_proof import components
from quant_edge.final_proof.components import (
    ComponentManifestError,
    build_component_manifest,
    validate_component_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _copy_file(source_root: Path, target_root: Path, relative_path: str) -> None:
    source = source_root / relative_path
    target = target_root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _component_mirror(tmp_path: Path) -> Path:
    mirror = tmp_path / "repo"
    mirror.mkdir()
    paths = {"quant/DIRECTIVE_INPUTS.lock", "quant/TASKS/Q17.md"}
    source_paths: set[str] = set()
    for phase in components._phase_specs():
        paths.update(
            {
                f"quant/RECEIPTS/{phase.phase}.md",
                f"quant/RECEIPTS/{phase.phase}_ACCEPTANCE.md",
                phase.primary_evidence.relative_path,
            }
        )
        if phase.source is not None:
            source_paths.add(phase.source.relative_path)
    for relative_path in sorted(paths):
        _copy_file(REPO_ROOT, mirror, relative_path)
    for relative_path in sorted(source_paths):
        shutil.copytree(REPO_ROOT / relative_path, mirror / relative_path)
    return mirror


def _artifact(
    relative_path: str,
    raw: bytes,
    *,
    media_type: str = "text/markdown",
    schema: str = "TestTextV1",
    version: int | None = 1,
) -> components._ArtifactSpec:
    return components._ArtifactSpec(
        "test.artifact.v1",
        relative_path,
        len(raw),
        hashlib.sha256(raw).hexdigest(),
        media_type,
        schema,
        version,
    )


def _custom_root(tmp_path: Path, relative_path: str, raw: bytes) -> tuple[Path, os.stat_result]:
    root = tmp_path / "root"
    root.mkdir()
    target = root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return components._require_repo_root(root)


def _set_q17_task_status(root: Path, status_line: str) -> bytes:
    task = root / "quant/TASKS/Q17.md"
    lines = task.read_text().splitlines()
    status_indexes = [index for index, line in enumerate(lines) if line.startswith("Status:")]
    assert len(status_indexes) == 1
    lines[status_indexes[0]] = status_line
    raw = ("\n".join(lines) + "\n").encode()
    task.write_bytes(raw)
    return raw


def test_manifest_covers_every_phase_and_preserves_final_truth() -> None:
    manifest = build_component_manifest(REPO_ROOT)
    rows = cast(list[dict[str, object]], manifest["components"])

    assert [row["phase"] for row in rows] == [f"Q{index:02}" for index in range(18)]
    assert all(row["implementationState"] == "ACCEPTED" for row in rows[:17])
    current_task = cast(dict[str, object], manifest["q17CurrentTask"])
    current_status = current_task["semanticStatus"]
    assert current_status in {
        "WORKING",
        "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION",
    }
    expected_state = (
        "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION"
        if current_status == "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION"
        else "ACTIVATED_WORKING"
    )
    assert rows[17]["implementationState"] == expected_state
    assert rows[17]["integrationState"] == "NOT_CONFIGURED"
    assert rows[17]["identities"] == {
        "acceptanceCommit": components.PENDING,
        "acceptanceTree": components.PENDING,
        "implementationCommit": components.PENDING,
        "implementationTree": components.PENDING,
    }
    assert [rows[index]["owner"] for index in range(2, 17)] == [
        f"quant_edge.{name}"
        for name in (
            "lake",
            "bootstrap",
            "book",
            "labels",
            "features",
            "micro",
            "derivatives",
            "regime",
            "models",
            "survival",
            "ensemble",
            "deep",
            "validation",
            "registry_ops",
            "inference",
        )
    ]
    assert all(rows[index]["sourceRoot"] is not None for index in range(2, 17))
    assert rows[0]["sourceRoot"] is None
    assert rows[1]["sourceRoot"] is None
    assert rows[17]["sourceRoot"] is None
    assert manifest["baseCommit"] == components.CANONICAL_BASE
    assert manifest["protocolCommit"] == components.FROZEN_PROTOCOL_COMMIT
    assert manifest["q17Finalization"] == {
        "acceptanceCommitA17": components.PENDING,
        "implementationCommitC17": components.PENDING,
    }
    activation = cast(dict[str, object], manifest["q17Activation"])
    activation_task = cast(dict[str, object], activation["task"])
    current_evidence = cast(dict[str, object], current_task["evidence"])
    assert activation["semanticStatus"] == "WORKING_AT_ACTIVATION"
    assert activation["verificationPosture"] == ("HISTORICAL_COMMIT_PIN_NOT_CURRENT_WORKTREE_BYTES")
    assert activation_task["sha256"] == components.Q17_ACTIVATION_TASK_SHA256
    assert activation_task["bytes"] == components.Q17_ACTIVATION_TASK_BYTES
    assert (
        current_evidence["sha256"]
        == hashlib.sha256((REPO_ROOT / "quant/TASKS/Q17.md").read_bytes()).hexdigest()
    )
    assert rows[17]["evidenceRefs"] == [current_evidence]
    assert manifest["finalPosture"] == {
        "action": "ABSTAIN_UNKNOWN",
        "advisoryOnly": True,
        "calibration": "UNAVAILABLE_MODEL_OUTPUT",
        "currentUniverse": "UNKNOWN",
        "deep": "FAIL_DATA_INSUFFICIENT",
        "edge": "UNAVAILABLE",
        "eventRateTrace": "UNKNOWN",
        "integration": "NOT_CONFIGURED",
        "latencyTarget": "UNKNOWN",
        "model": "UNAVAILABLE_NONLOADABLE",
        "realLabels": "DATA_INSUFFICIENT",
    }


def test_manifest_pins_corrections_merges_and_documentary_conflict() -> None:
    manifest = build_component_manifest(REPO_ROOT)
    rows = {
        cast(str, row["phase"]): row
        for row in cast(list[dict[str, object]], manifest["components"])
    }

    assert len(cast(list[object], rows["Q08"]["corrections"])) == 2
    assert len(cast(list[object], rows["Q15"]["corrections"])) == 2
    assert rows["Q00"]["directorIntegrationCommits"] == []
    assert rows["Q13"]["directorIntegrationCommits"] == ["3ed8e38d65812e2eb8ed6eba19e4eb5084c253d1"]
    assert rows["Q15"]["directorIntegrationCommits"] == [
        "f54180c3a7d014e4d91a0c6b7dc5ea4c3d521754",
        "c070fdaf7dc568448212067dde5e1fb2ecc21356",
    ]
    assert manifest["documentaryConflicts"] == [
        {
            "acceptedArtifactPath": "quant/generated/q10/model_campaign.v1.json",
            "acceptedValue": 7,
            "disposition": "ACCEPTED_ARTIFACT_CONTROLS_DOCUMENTARY_VALUE_NOT_USED",
            "documentaryPath": "quant/RECEIPTS/Q10.md",
            "documentaryValue": 11,
            "field": "study_xgb_quantile:v1.bestTrialIndex",
            "id": "Q10_QUANTILE_BEST_INDEX",
        }
    ]
    assert "Q14_NOT_A_VALIDATION_OF_Q10_OR_Q11" in cast(list[str], rows["Q10"]["limitations"])
    assert manifest["externalDirectorEvidence"] == {
        "launchAcceptance": {
            "ancestryStatus": "NOT_Q_LANE_ANCESTOR",
            "commit": components.EXTERNAL_LAUNCH_ACCEPTANCE_COMMIT,
            "originBranch": "current-main",
            "phase": "Q00",
            "role": "D_LAUNCH_1_AUTHENTIC_LAUNCH_FILE_DIGEST_ACCEPTANCE",
        }
    }


def test_current_task_completion_is_exact_without_relabeling_activation(tmp_path: Path) -> None:
    mirror = _component_mirror(tmp_path)
    complete_raw = _set_q17_task_status(
        mirror,
        "Status: `COMPLETE — READY_FOR_INDEPENDENT_COMMIT_VERIFICATION`",
    )

    manifest = build_component_manifest(mirror)
    rows = cast(list[dict[str, object]], manifest["components"])
    activation = cast(dict[str, object], manifest["q17Activation"])
    current = cast(dict[str, object], manifest["q17CurrentTask"])
    current_evidence = cast(dict[str, object], current["evidence"])

    assert cast(dict[str, object], activation["task"])["sha256"] == (
        components.Q17_ACTIVATION_TASK_SHA256
    )
    assert current == {
        "evidence": {
            "artifactId": "q17.current-task.v1",
            "bytes": len(complete_raw),
            "mediaType": "text/markdown",
            "path": "quant/TASKS/Q17.md",
            "schema": "Q17TaskV1",
            "sha256": hashlib.sha256(complete_raw).hexdigest(),
            "version": 1,
        },
        "semanticStatus": "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION",
    }
    assert rows[17]["evidenceRefs"] == [current_evidence]
    assert rows[17]["implementationState"] == ("COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION")
    assert rows[17]["evidencePosture"] == "COMPOSITION_COMPLETE_PENDING_EXACT_C17"
    assert "NOT_ACCEPTED" in cast(list[str], rows[17]["dispositions"])
    assert rows[17]["identities"] == {
        "acceptanceCommit": components.PENDING,
        "acceptanceTree": components.PENDING,
        "implementationCommit": components.PENDING,
        "implementationTree": components.PENDING,
    }


def test_current_task_rejects_non_exact_status_and_heading(tmp_path: Path) -> None:
    mirror = _component_mirror(tmp_path)
    _set_q17_task_status(mirror, "Status: `DONE`")
    with pytest.raises(ComponentManifestError, match="allowed exact state"):
        build_component_manifest(mirror)

    task = mirror / "quant/TASKS/Q17.md"
    task.write_text(task.read_text().replace("# Q17 —", "# Not Q17 —", 1))
    with pytest.raises(ComponentManifestError, match="heading"):
        build_component_manifest(mirror)


def test_manifest_is_deterministic_and_strictly_validates() -> None:
    first = build_component_manifest(REPO_ROOT)
    second = build_component_manifest(REPO_ROOT)

    assert canonical_json_bytes(first) == canonical_json_bytes(second)
    assert validate_component_manifest(REPO_ROOT, copy.deepcopy(first)) == first


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("duplicate", "phases"),
        ("status", "accepted truth"),
        ("hash", "accepted truth"),
        ("path", "accepted truth"),
        ("posture", "accepted truth"),
    ],
)
def test_validator_rejects_duplicates_forgery_hash_and_traversal(
    mutation: str,
    expected: str,
) -> None:
    manifest = build_component_manifest(REPO_ROOT)
    rows = cast(list[dict[str, object]], manifest["components"])
    if mutation == "duplicate":
        rows[0] = rows[1]
    elif mutation == "status":
        rows[16]["implementationState"] = "PRODUCTION_READY"
    elif mutation == "hash":
        refs = cast(list[dict[str, object]], rows[4]["evidenceRefs"])
        refs[0]["sha256"] = "0" * 64
    elif mutation == "path":
        refs = cast(list[dict[str, object]], rows[3]["evidenceRefs"])
        refs[0]["path"] = "../escape"
    else:
        posture = cast(dict[str, object], manifest["finalPosture"])
        posture["edge"] = "AVAILABLE"

    with pytest.raises(ComponentManifestError, match=expected):
        validate_component_manifest(REPO_ROOT, manifest)


@pytest.mark.parametrize(
    ("relative_path", "kind"),
    [
        ("quant/fixtures/q06_feature_golden_v1.json", "tamper"),
        ("quant/generated/q10/model_campaign.v1.json", "tamper"),
        ("quant/RECEIPTS/Q15_ACCEPTANCE.md", "symlink"),
        ("quant/src/quant_edge/lake/store.py", "source-tamper"),
        ("quant/src/quant_edge/book/injected.py", "source-addition"),
        ("quant/src/quant_edge/book/native.so", "source-unexpected-file"),
        ("quant/src/quant_edge/book/nested", "source-directory"),
        ("quant/src/quant_edge/book/linked.py", "source-symlink"),
    ],
)
def test_current_byte_tamper_symlink_and_source_inventory_fail_closed(
    tmp_path: Path,
    relative_path: str,
    kind: str,
) -> None:
    mirror = _component_mirror(tmp_path)
    target = mirror / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    if kind == "symlink":
        target.unlink()
        target.symlink_to(REPO_ROOT / relative_path)
    elif kind == "source-directory":
        target.mkdir()
    elif kind == "source-symlink":
        target.symlink_to(REPO_ROOT / "quant/src/quant_edge/book/engine.py")
    elif kind == "source-addition":
        target.write_text("VALUE = 1\n")
    elif kind == "source-unexpected-file":
        target.write_bytes(b"native")
    else:
        target.write_bytes(target.read_bytes() + b"\n")

    with pytest.raises(ComponentManifestError):
        build_component_manifest(mirror)


def test_repo_root_and_paths_are_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(ComponentManifestError, match="absolute"):
        build_component_manifest(Path("."))
    with pytest.raises(ComponentManifestError, match="absent"):
        build_component_manifest(tmp_path / "missing")
    file_root = tmp_path / "file"
    file_root.write_text("not a directory")
    with pytest.raises(ComponentManifestError, match="non-symlink directory"):
        build_component_manifest(file_root)
    link = tmp_path / "link"
    link.symlink_to(REPO_ROOT, target_is_directory=True)
    with pytest.raises(ComponentManifestError, match="non-symlink directory"):
        build_component_manifest(link)
    for path in ("", "../x", "/x", "a//b", "a/./b", "a\\b", "https://x", "a\x00b"):
        with pytest.raises(ComponentManifestError):
            components._safe_parts(path)


def test_artifact_contract_rejects_size_digest_schema_version_and_text(tmp_path: Path) -> None:
    raw = b"# valid\n"
    root, root_before = _custom_root(tmp_path, "evidence.md", raw)
    spec = _artifact("evidence.md", raw)
    mapping, parsed = components._artifact_mapping(root, root_before, spec)
    assert mapping["sha256"] == hashlib.sha256(raw).hexdigest()
    assert parsed is None

    bad_specs = (
        replace(spec, byte_length=1),
        replace(spec, sha256="0" * 64),
        replace(spec, sha256="BAD"),
    )
    for bad in bad_specs:
        with pytest.raises(ComponentManifestError):
            components._artifact_mapping(root, root_before, bad)

    (root / "evidence.md").write_bytes(b"not a heading")
    no_heading = _artifact("evidence.md", b"not a heading")
    with pytest.raises(ComponentManifestError, match="heading"):
        components._artifact_mapping(root, root_before, no_heading)
    (root / "evidence.md").write_bytes(b"\xff")
    invalid_utf8 = _artifact("evidence.md", b"\xff")
    with pytest.raises(ComponentManifestError, match="UTF-8"):
        components._artifact_mapping(root, root_before, invalid_utf8)

    json_cases = (
        (b'{"schema":"S","version":1}\n', "S", 1, None),
        (b'{"schema":"S","version":1}', "S", 1, None),
        (b'{"schema":"S","schema":"S","version":1}\n', "S", 1, "canonical"),
        (b'{"schema":"S","version":1}\n', "X", 1, "schema"),
        (b'{"schema":"S","version":1}\n', "S", 2, "version"),
    )
    for index, (json_raw, schema, version, error) in enumerate(json_cases):
        relative = f"case-{index}.json"
        (root / relative).write_bytes(json_raw)
        json_spec = _artifact(
            relative,
            json_raw,
            media_type="application/json",
            schema=schema,
            version=version,
        )
        if error is None:
            _, value = components._artifact_mapping(root, root_before, json_spec)
            assert value == {"schema": "S", "version": 1}
        else:
            with pytest.raises(ComponentManifestError, match=error):
                components._artifact_mapping(root, root_before, json_spec)


def test_historical_metadata_and_current_task_utf8_guards(tmp_path: Path) -> None:
    invalid = replace(_artifact("evidence.md", b"# valid\n"), byte_length=0)
    with pytest.raises(ComponentManifestError, match="historical"):
        components._pinned_artifact_mapping(invalid)

    root, root_before = _custom_root(tmp_path, "quant/TASKS/Q17.md", b"\xff")
    with pytest.raises(ComponentManifestError, match="UTF-8"):
        components._current_q17_task_mapping(root, root_before)


def test_regular_file_boundary_rejects_absence_links_directories_and_bounds(
    tmp_path: Path,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    with pytest.raises(ComponentManifestError, match="absent"):
        components._read_regular(
            root, root_before, "safe/missing.txt", expected_bytes=None, maximum_bytes=10
        )
    with pytest.raises(ComponentManifestError, match="bounded"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=1
        )
    with pytest.raises(ComponentManifestError, match="size"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=4, maximum_bytes=10
        )
    (root / "safe/directory").mkdir()
    with pytest.raises(ComponentManifestError, match="regular file"):
        components._read_regular(
            root, root_before, "safe/directory", expected_bytes=None, maximum_bytes=10
        )
    (root / "safe/link.txt").symlink_to(root / "safe/file.txt")
    with pytest.raises(ComponentManifestError, match="link"):
        components._read_regular(
            root, root_before, "safe/link.txt", expected_bytes=None, maximum_bytes=10
        )
    os.mkfifo(root / "safe/fifo")
    with pytest.raises(ComponentManifestError, match="regular file"):
        components._read_regular(
            root, root_before, "safe/fifo", expected_bytes=None, maximum_bytes=10
        )

    os.link(root / "safe/file.txt", root / "safe/hardlink.txt")
    with pytest.raises(ComponentManifestError, match="single-link"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_regular_read_wraps_open_error_and_rechecks_live_leaf(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    original_open = os.open

    def fail_leaf_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        if path == "file.txt":
            raise OSError("injected leaf open failure")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", fail_leaf_open)
    with pytest.raises(ComponentManifestError, match="cannot be opened"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )

    monkeypatch.setattr(os, "open", original_open)
    alternate = root / "safe/alternate.txt"
    alternate.write_bytes(b"value")
    original_stat = os.stat

    def substitute_leaf_stat(
        path: str | bytes | int,
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        if path == "file.txt":
            return original_stat(alternate)
        return original_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(os, "stat", substitute_leaf_stat)
    with pytest.raises(ComponentManifestError, match="leaf changed"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_regular_read_rejects_intermediate_parent_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    original_read = os.read
    replaced = False

    def replace_parent(descriptor: int, length: int) -> bytes:
        nonlocal replaced
        if not replaced:
            replaced = True
            (root / "safe").rename(root / "detached")
            (root / "safe").mkdir()
            (root / "safe/file.txt").write_bytes(b"value")
        return original_read(descriptor, length)

    monkeypatch.setattr(os, "read", replace_parent)
    with pytest.raises(ComponentManifestError, match="parent changed"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_regular_read_rejects_atomic_leaf_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    replacement = root / "safe/replacement.txt"
    replacement.write_bytes(b"value")
    original_read = os.read
    replaced = False

    def replace_leaf(descriptor: int, length: int) -> bytes:
        nonlocal replaced
        if not replaced:
            replaced = True
            replacement.replace(root / "safe/file.txt")
        return original_read(descriptor, length)

    monkeypatch.setattr(os, "read", replace_leaf)
    with pytest.raises(ComponentManifestError, match="changed during"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_source_root_and_q10_semantic_guards(tmp_path: Path) -> None:
    root, root_before = _custom_root(tmp_path, "src/one.py", b"VALUE = 1\n")
    rows = {
        "files": [
            {
                "bytes": 10,
                "path": "src/one.py",
                "sha256": hashlib.sha256(b"VALUE = 1\n").hexdigest(),
            }
        ]
    }
    source = components._SourceSpec(
        "src", "src", 1, hashlib.sha256(canonical_json_bytes(rows)).hexdigest()
    )
    assert components._source_mapping(root, root_before, source)["fileCount"] == 1
    (root / "src/__pycache__").mkdir()
    assert components._source_mapping(root, root_before, source)["fileCount"] == 1

    unexpected = root / "src/native.so"
    unexpected.write_bytes(b"native")
    with pytest.raises(ComponentManifestError, match="unexpected child"):
        components._source_mapping(root, root_before, source)
    unexpected.unlink()

    nested = root / "src/nested"
    nested.mkdir()
    with pytest.raises(ComponentManifestError, match="unexpected child"):
        components._source_mapping(root, root_before, source)
    nested.rmdir()

    linked = root / "src/linked.py"
    linked.symlink_to(root / "src/one.py")
    with pytest.raises(ComponentManifestError, match="unexpected child"):
        components._source_mapping(root, root_before, source)
    linked.unlink()

    shutil.rmtree(root / "src/__pycache__")
    (root / "src/__pycache__").symlink_to(root / "src", target_is_directory=True)
    with pytest.raises(ComponentManifestError, match="cache is unsafe"):
        components._source_mapping(root, root_before, source)
    (root / "src/__pycache__").unlink()

    with pytest.raises(ComponentManifestError, match="inventory"):
        components._source_mapping(root, root_before, replace(source, file_count=2))
    with pytest.raises(ComponentManifestError, match="bytes"):
        components._source_mapping(root, root_before, replace(source, seal_sha256="0" * 64))
    with pytest.raises(ComponentManifestError, match="absent"):
        components._source_mapping(root, root_before, replace(source, relative_path="missing"))

    with pytest.raises(ComponentManifestError, match="unavailable"):
        components._require_q10_best_index(None)
    with pytest.raises(ComponentManifestError, match="malformed"):
        components._require_q10_best_index({})
    for summaries in ([], [{"studyId": "study_xgb_quantile:v1", "bestTrialIndex": 8}]):
        with pytest.raises(ComponentManifestError, match="changed"):
            components._require_q10_best_index({"studySummaries": summaries})
    components._require_q10_best_index(
        {
            "studySummaries": [
                {"studyId": "other", "bestTrialIndex": 0},
                {"studyId": "study_xgb_quantile:v1", "bestTrialIndex": 7},
            ]
        }
    )


def test_source_inventory_os_errors_unsafe_root_and_read_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "src/one.py", b"VALUE = 1\n")
    rows = {
        "files": [
            {
                "bytes": 10,
                "path": "src/one.py",
                "sha256": hashlib.sha256(b"VALUE = 1\n").hexdigest(),
            }
        ]
    }
    source = components._SourceSpec(
        "src", "src", 1, hashlib.sha256(canonical_json_bytes(rows)).hexdigest()
    )

    linked = root / "linked"
    linked.symlink_to(root / "src", target_is_directory=True)
    with pytest.raises(ComponentManifestError, match="root is unsafe"):
        components._source_mapping(
            root,
            root_before,
            replace(source, relative_path="linked"),
        )

    original_iterdir = Path.iterdir

    def fail_iterdir(path: Path):  # type: ignore[no-untyped-def]
        if path == root / "src":
            raise OSError("injected inventory failure")
        return original_iterdir(path)

    monkeypatch.setattr(Path, "iterdir", fail_iterdir)
    with pytest.raises(ComponentManifestError, match="inventory is unavailable"):
        components._source_inventory(root / "src")
    monkeypatch.setattr(Path, "iterdir", original_iterdir)

    original_read_regular = components._read_regular

    def touch_after_read(*args: object, **kwargs: object) -> bytes:
        raw = original_read_regular(*args, **kwargs)  # type: ignore[arg-type]
        target = root / "src/one.py"
        current = target.stat()
        os.utime(target, ns=(current.st_atime_ns, current.st_mtime_ns + 1_000_000_000))
        return raw

    monkeypatch.setattr(components, "_read_regular", touch_after_read)
    with pytest.raises(ComponentManifestError, match="inventory changed during read"):
        components._source_mapping(root, root_before, source)


def test_strict_manifest_shape_and_json_safety() -> None:
    valid = build_component_manifest(REPO_ROOT)
    bad_values: tuple[object, ...] = (
        [],
        {1: "bad"},
        {key: value for key, value in valid.items() if key != "schema"},
        {**valid, "components": []},
        {**valid, "components": [*cast(list[object], valid["components"])[:-1], []]},
        {
            **valid,
            "components": [
                *cast(list[object], valid["components"])[:-1],
                {1: "bad"},
            ],
        },
        {
            **valid,
            "components": [
                *cast(list[object], valid["components"])[:-1],
                {"phase": "Q17"},
            ],
        },
    )
    for value in bad_values:
        with pytest.raises(ComponentManifestError):
            validate_component_manifest(REPO_ROOT, value)

    forged = copy.deepcopy(valid)
    forged["version"] = 1.5
    with pytest.raises(ComponentManifestError, match="canonical-JSON-safe"):
        validate_component_manifest(REPO_ROOT, forged)
