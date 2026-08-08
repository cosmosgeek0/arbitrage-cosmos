"""Focused valid and hostile fixtures for the DQ-4 origin validator."""

# ruff: noqa: PT009

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast
from unittest import mock

from . import origin_validator

PACKET_PATH = "quant/research/packet"
ANCHOR_REF = "refs/tags/dq4-pre-run"
SOURCE_REF = "refs/heads/research/packet"
TRACKING_REF = "refs/remotes/origin/research/packet"


@dataclass
class Fixture:
    repo: Path
    manifest_path: Path
    manifest: dict[str, Any]
    base_commit: str
    pre_run_commit: str
    sealed_commit: str

    def write_manifest(self) -> None:
        self.manifest_path.write_text(
            json.dumps(self.manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


def _git(repo: Path, *args: str, input_text: str | None = None) -> str:
    completed = subprocess.run(
        ["git", "-C", os.fspath(repo), *args],
        check=True,
        input=input_text,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "GIT_AUTHOR_NAME": "DQ4 Fixture",
            "GIT_AUTHOR_EMAIL": "dq4@example.invalid",
            "GIT_COMMITTER_NAME": "DQ4 Fixture",
            "GIT_COMMITTER_EMAIL": "dq4@example.invalid",
            "LC_ALL": "C",
        },
    )
    return completed.stdout.strip()


def _write(repo: Path, relative_path: str, content: bytes) -> None:
    target = repo / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


def _commit_all(repo: Path, message: str) -> str:
    _git(repo, "add", "--all")
    _git(repo, "commit", "--quiet", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def _tree(repo: Path, commit: str) -> str:
    return _git(repo, "rev-parse", f"{commit}^{{tree}}")


def _blob(repo: Path, commit: str, path: str) -> str:
    return _git(repo, "rev-parse", f"{commit}:{path}")


def _blob_bytes(repo: Path, oid: str) -> bytes:
    completed = subprocess.run(
        ["git", "-C", os.fspath(repo), "cat-file", "blob", oid],
        check=True,
        capture_output=True,
    )
    return completed.stdout


def _binding(repo: Path, commit: str, path: str, stage: str) -> dict[str, str]:
    oid = _blob(repo, commit, path)
    return {
        "path": path,
        "stage": stage,
        "blobOid": oid,
        "sha256": hashlib.sha256(_blob_bytes(repo, oid)).hexdigest(),
    }


def _create_fixture(root: Path) -> Fixture:
    repo = root / "source"
    repo.mkdir()
    subprocess.run(
        ["git", "init", "--quiet", "--initial-branch=research/packet", os.fspath(repo)],
        check=True,
        capture_output=True,
    )
    _git(repo, "config", "user.name", "DQ4 Fixture")
    _git(repo, "config", "user.email", "dq4@example.invalid")
    _write(repo, "README.md", b"fixture repository\n")
    base_commit = _commit_all(repo, "base")

    protocol_path = f"{PACKET_PATH}/protocol.v1.json"
    sources_path = f"{PACKET_PATH}/sources.v1.json"
    result_path = f"{PACKET_PATH}/result.v1.json"
    _write(repo, protocol_path, b'{"frozen":true}\n')
    _write(repo, sources_path, b'{"source":"public"}\n')
    pre_run_commit = _commit_all(repo, "freeze packet")
    _git(repo, "tag", "dq4-pre-run", pre_run_commit)

    _write(repo, result_path, b'{"verdict":"NO_GO"}\n')
    sealed_commit = _commit_all(repo, "seal result")
    _git(repo, "remote", "add", "origin", "https://example.invalid/research.git")
    _git(repo, "update-ref", TRACKING_REF, sealed_commit)

    files = [
        _binding(repo, pre_run_commit, protocol_path, "pre_run"),
        _binding(repo, sealed_commit, result_path, "post_run"),
        _binding(repo, pre_run_commit, sources_path, "pre_run"),
    ]
    files.sort(key=lambda item: item["path"])
    manifest: dict[str, Any] = {
        "schema": origin_validator.SCHEMA,
        "objectFormat": _git(repo, "rev-parse", "--show-object-format=storage"),
        "packetPath": PACKET_PATH,
        "baseCommit": base_commit,
        "preRun": {
            "commit": pre_run_commit,
            "tree": _tree(repo, pre_run_commit),
            "anchorRef": ANCHOR_REF,
        },
        "sealed": {
            "commit": sealed_commit,
            "tree": _tree(repo, sealed_commit),
        },
        "origin": {
            "remote": "origin",
            "sourceRef": SOURCE_REF,
            "trackingRef": TRACKING_REF,
            "expectedCommit": sealed_commit,
        },
        "files": files,
    }
    fixture = Fixture(
        repo=repo,
        manifest_path=root / "proof.v1.json",
        manifest=manifest,
        base_commit=base_commit,
        pre_run_commit=pre_run_commit,
        sealed_commit=sealed_commit,
    )
    fixture.write_manifest()
    return fixture


def _fake_oid(fixture: Fixture, character: str) -> str:
    length = 40 if fixture.manifest["objectFormat"] == "sha1" else 64
    return character * length


def _commit_tree(repo: Path, tree: str, parent: str, message: str) -> str:
    return _git(repo, "commit-tree", tree, "-p", parent, input_text=f"{message}\n")


def _update_sealed(fixture: Fixture, commit: str) -> None:
    fixture.manifest["sealed"]["commit"] = commit
    fixture.manifest["sealed"]["tree"] = _tree(fixture.repo, commit)
    fixture.manifest["origin"]["expectedCommit"] = commit
    _git(fixture.repo, "update-ref", TRACKING_REF, commit)


def _relocate_and_poison(fixture: Fixture) -> Fixture:
    relocated = fixture.repo.parent / "relocated"
    subprocess.run(
        ["git", "clone", "--quiet", "--no-local", os.fspath(fixture.repo), os.fspath(relocated)],
        check=True,
        capture_output=True,
    )
    relocated_manifest = relocated / "proof.v1.json"
    shutil.copyfile(fixture.manifest_path, relocated_manifest)
    return Fixture(
        repo=relocated,
        manifest_path=relocated_manifest,
        manifest=fixture.manifest,
        base_commit=fixture.base_commit,
        pre_run_commit=fixture.pre_run_commit,
        sealed_commit=fixture.sealed_commit,
    )


def _relocate_bare(fixture: Fixture) -> Fixture:
    bare = fixture.repo.parent / "bare.git"
    subprocess.run(
        [
            "git",
            "clone",
            "--bare",
            "--quiet",
            "--no-local",
            os.fspath(fixture.repo),
            os.fspath(bare),
        ],
        check=True,
        capture_output=True,
    )
    _git(
        bare,
        "config",
        "--replace-all",
        "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/origin/*",
    )
    _git(bare, "update-ref", TRACKING_REF, fixture.sealed_commit)
    bare_manifest = fixture.repo.parent / "bare-proof.v1.json"
    shutil.copyfile(fixture.manifest_path, bare_manifest)
    return Fixture(
        repo=bare,
        manifest_path=bare_manifest,
        manifest=fixture.manifest,
        base_commit=fixture.base_commit,
        pre_run_commit=fixture.pre_run_commit,
        sealed_commit=fixture.sealed_commit,
    )


def _relocate_shared(fixture: Fixture) -> Fixture:
    shared = fixture.repo.parent / "shared"
    subprocess.run(
        ["git", "clone", "--quiet", "--shared", os.fspath(fixture.repo), os.fspath(shared)],
        check=True,
        capture_output=True,
    )
    shared_manifest = fixture.repo.parent / "shared-proof.v1.json"
    shutil.copyfile(fixture.manifest_path, shared_manifest)
    return Fixture(
        repo=shared,
        manifest_path=shared_manifest,
        manifest=fixture.manifest,
        base_commit=fixture.base_commit,
        pre_run_commit=fixture.pre_run_commit,
        sealed_commit=fixture.sealed_commit,
    )


def _git_dir(repo: Path) -> Path:
    value = Path(_git(repo, "rev-parse", "--git-dir"))
    return value if value.is_absolute() else repo / value


def _external_pack_symlink(fixture: Fixture) -> None:
    _git(fixture.repo, "gc", "--quiet", "--prune=now")
    pack_dir = _git_dir(fixture.repo) / "objects" / "pack"
    external_pack = fixture.repo.parent / "external-pack"
    pack_dir.rename(external_pack)
    pack_dir.symlink_to(external_pack, target_is_directory=True)


def _external_common_config_symlink(fixture: Fixture) -> None:
    config = _git_dir(fixture.repo) / "config"
    external_config = fixture.repo.parent / "external-common.config"
    config.rename(external_config)
    config.symlink_to(external_config)


def _external_dot_git_symlink(fixture: Fixture) -> None:
    dot_git = fixture.repo / ".git"
    external_git = fixture.repo.parent / "external-dot-git"
    dot_git.rename(external_git)
    dot_git.symlink_to(external_git, target_is_directory=True)


def _external_absolute_gitfile(fixture: Fixture) -> None:
    dot_git = fixture.repo / ".git"
    external_git = fixture.repo.parent / "external-gitfile-target"
    dot_git.rename(external_git)
    dot_git.write_text(f"gitdir: {external_git}\n", encoding="utf-8")


def _external_bare_gitfile(fixture: Fixture) -> None:
    _git(fixture.repo, "config", "core.bare", "true")
    dot_git = fixture.repo / ".git"
    external_git = fixture.repo.parent / "external-bare-gitfile-target"
    dot_git.rename(external_git)
    dot_git.write_text(f"gitdir: {external_git}\n", encoding="utf-8")


def _worktree_absolute_include(fixture: Fixture) -> None:
    include_path = fixture.repo.parent / "worktree-include.config"
    include_path.write_text("[dq4]\n\tfixture = true\n", encoding="utf-8")
    _git(fixture.repo, "config", "extensions.worktreeConfig", "true")
    _git(
        fixture.repo,
        "config",
        "--worktree",
        "include.path",
        os.fspath(include_path),
    )


def _add_absolute_root(fixture: Fixture) -> None:
    fixture.manifest["repositoryRoot"] = "/private/tmp/obsolete-worktree"


def _missing_pre_run(fixture: Fixture) -> None:
    fixture.manifest["preRun"]["commit"] = _fake_oid(fixture, "0")


def _blob_pre_run(fixture: Fixture) -> None:
    fixture.manifest["preRun"]["commit"] = fixture.manifest["files"][0]["blobOid"]


def _amended_sibling(fixture: Fixture) -> None:
    sibling = _commit_tree(
        fixture.repo,
        fixture.manifest["preRun"]["tree"],
        fixture.base_commit,
        "amended pre-run sibling",
    )
    fixture.manifest["preRun"]["commit"] = sibling
    _git(fixture.repo, "update-ref", ANCHOR_REF, sibling)


def _divergent_pre_run(fixture: Fixture) -> None:
    divergent_parent = _commit_tree(
        fixture.repo,
        fixture.manifest["preRun"]["tree"],
        fixture.base_commit,
        "divergent parent",
    )
    divergent = _commit_tree(
        fixture.repo,
        fixture.manifest["preRun"]["tree"],
        divergent_parent,
        "divergent pre-run child",
    )
    fixture.manifest["preRun"]["commit"] = divergent
    _git(fixture.repo, "update-ref", ANCHOR_REF, divergent)


def _install_replace_ref(fixture: Fixture) -> None:
    _git(
        fixture.repo,
        "update-ref",
        f"refs/replace/{fixture.pre_run_commit}",
        fixture.base_commit,
    )


def _delete_anchor(fixture: Fixture) -> None:
    _git(fixture.repo, "update-ref", "-d", ANCHOR_REF)


def _move_anchor(fixture: Fixture) -> None:
    _git(fixture.repo, "update-ref", ANCHOR_REF, fixture.base_commit)


def _remove_origin(fixture: Fixture) -> None:
    del fixture.manifest["origin"]


def _exclude_origin_source_ref(fixture: Fixture) -> None:
    _git(
        fixture.repo,
        "config",
        "--add",
        "remote.origin.fetch",
        f"^{SOURCE_REF}",
    )


def _absolute_config_include(fixture: Fixture) -> None:
    _git(fixture.repo, "config", "--unset-all", "remote.origin.fetch")
    include_path = fixture.repo.parent / "origin-include.config"
    include_path.write_text(
        '[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
        encoding="utf-8",
    )
    _git(fixture.repo, "config", "include.path", os.fspath(include_path))


def _delete_origin_ref(fixture: Fixture) -> None:
    _git(fixture.repo, "update-ref", "-d", TRACKING_REF)


def _move_origin_ref(fixture: Fixture) -> None:
    _git(fixture.repo, "update-ref", TRACKING_REF, fixture.pre_run_commit)


def _escape_path(fixture: Fixture) -> None:
    fixture.manifest["files"][0]["path"] = "../escaped.json"


def _append_symlink(fixture: Fixture) -> None:
    link_path = fixture.repo / PACKET_PATH / "linked-result.json"
    link_path.symlink_to("../../outside-result.json")
    commit = _commit_all(fixture.repo, "hostile symlink")
    _update_sealed(fixture, commit)
    binding = _binding(fixture.repo, commit, f"{PACKET_PATH}/linked-result.json", "post_run")
    fixture.manifest["files"].append(binding)
    fixture.manifest["files"].sort(key=lambda item: item["path"])


def _append_unlisted_file(fixture: Fixture) -> None:
    _write(fixture.repo, f"{PACKET_PATH}/unbound.json", b'{"unbound":true}\n')
    commit = _commit_all(fixture.repo, "hostile unbound output")
    _update_sealed(fixture, commit)


def _corrupt_sha256(fixture: Fixture) -> None:
    fixture.manifest["files"][0]["sha256"] = "0" * 64


MUTATIONS: dict[str, Callable[[Fixture], None]] = {
    "add_absolute_repository_root": _add_absolute_root,
    "move_pack_store_behind_absolute_symlink": _external_pack_symlink,
    "move_common_config_behind_absolute_symlink": _external_common_config_symlink,
    "move_dot_git_directory_behind_absolute_symlink": _external_dot_git_symlink,
    "move_dot_git_to_absolute_gitfile": _external_absolute_gitfile,
    "move_bare_classified_dot_git_to_absolute_gitfile": _external_bare_gitfile,
    "add_worktree_scoped_absolute_include": _worktree_absolute_include,
    "replace_pre_run_with_missing_oid": _missing_pre_run,
    "replace_pre_run_with_blob_oid": _blob_pre_run,
    "replace_pre_run_with_anchored_sibling": _amended_sibling,
    "replace_pre_run_with_divergent_commit": _divergent_pre_run,
    "install_replace_ref": _install_replace_ref,
    "delete_pre_run_anchor": _delete_anchor,
    "move_pre_run_anchor": _move_anchor,
    "remove_origin_binding": _remove_origin,
    "exclude_origin_source_ref": _exclude_origin_source_ref,
    "move_origin_mapping_to_absolute_config_include": _absolute_config_include,
    "delete_origin_tracking_ref": _delete_origin_ref,
    "move_origin_tracking_ref": _move_origin_ref,
    "escape_packet_path": _escape_path,
    "append_symlink_to_sealed_packet": _append_symlink,
    "append_unlisted_file_to_sealed_packet": _append_unlisted_file,
    "corrupt_manifest_sha256": _corrupt_sha256,
}


class OriginValidatorTests(unittest.TestCase):
    maxDiff = None

    def _case_matrix(self) -> list[dict[str, Any]]:
        matrix_path = Path(__file__).with_name("fixtures") / "cases.v1.json"
        parsed = json.loads(matrix_path.read_text(encoding="utf-8"))
        self.assertEqual(parsed["schema"], "cosmos.dq4.origin-proof-fixtures.v1")
        return cast(list[dict[str, Any]], parsed["cases"])

    def test_valid_and_hostile_fixture_matrix(self) -> None:
        for case in self._case_matrix():
            with self.subTest(case=case["id"]), tempfile.TemporaryDirectory() as raw:
                fixture = _create_fixture(Path(raw))
                mutation = case["mutation"]
                if mutation == "relocate_and_poison_inherited_git_environment":
                    fixture = _relocate_and_poison(fixture)
                    poison = {
                        "GIT_DIR": "/does/not/exist",
                        "GIT_WORK_TREE": "/does/not/exist",
                        "GIT_OBJECT_DIRECTORY": "/does/not/exist",
                        "GIT_ALTERNATE_OBJECT_DIRECTORIES": "/does/not/exist",
                        "GIT_INDEX_FILE": "/does/not/exist",
                    }
                elif mutation == "relocate_to_complete_bare_repository":
                    fixture = _relocate_bare(fixture)
                    poison = {}
                elif mutation == "relocate_with_shared_object_alternate":
                    fixture = _relocate_shared(fixture)
                    poison = {}
                else:
                    MUTATIONS[mutation](fixture)
                    poison = {}
                fixture.write_manifest()
                with mock.patch.dict(os.environ, poison, clear=False):
                    receipt, exit_code = origin_validator.validate(
                        fixture.repo, fixture.manifest_path
                    )
                self.assertEqual(exit_code, case["expectedExitCode"])
                self.assertEqual(receipt["reasonCode"], case["expectedReasonCode"])
                rendered = json.dumps(receipt, sort_keys=True)
                self.assertNotIn(raw, rendered)
                self.assertNotIn("example.invalid", rendered)

    def test_valid_receipt_is_deterministic_and_complete(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            fixture = _create_fixture(Path(raw))
            first, first_exit = origin_validator.validate(fixture.repo, fixture.manifest_path)
            second, second_exit = origin_validator.validate(fixture.repo, fixture.manifest_path)
            self.assertEqual((first, first_exit), (second, second_exit))
            self.assertEqual(first_exit, 0)
            self.assertEqual(first["status"], "PASS")
            self.assertEqual(first["proof"]["sealedCommit"], fixture.sealed_commit)
            self.assertEqual(first["proof"]["fileCount"], 3)

    def test_malformed_and_duplicate_json_fail_closed(self) -> None:
        hostile_json_documents = (
            (b'{"schema":"cosmos.dq4.origin-proof.v1","schema":"cosmos.dq4.origin-proof.v1"}'),
            (
                b'{"schema":"cosmos.dq4.origin-proof.v1","nested":'
                + (b"[" * 10_000)
                + b"0"
                + (b"]" * 10_000)
                + b"}"
            ),
            b" " * (origin_validator.MAX_MANIFEST_BYTES + 1),
        )
        for hostile_json in hostile_json_documents:
            with self.subTest(size=len(hostile_json)), tempfile.TemporaryDirectory() as raw:
                fixture = _create_fixture(Path(raw))
                fixture.manifest_path.write_bytes(hostile_json)
                receipt, exit_code = origin_validator.validate(fixture.repo, fixture.manifest_path)
                self.assertEqual(exit_code, 1)
                self.assertEqual(receipt["reasonCode"], "ORIGIN_PROOF_MANIFEST_JSON_INVALID")

    def test_multi_fault_manifest_uses_frozen_precedence(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            fixture = _create_fixture(Path(raw))
            fixture.manifest["objectFormat"] = "unsupported"
            fixture.manifest["files"][0]["path"] = "../escaped.json"
            fixture.write_manifest()
            receipt, exit_code = origin_validator.validate(fixture.repo, fixture.manifest_path)
            self.assertEqual(exit_code, 1)
            self.assertEqual(receipt["reasonCode"], "ORIGIN_PROOF_PATH_INVALID")

    def test_manifest_symlink_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            fixture = _create_fixture(Path(raw))
            link = Path(raw) / "proof-link.v1.json"
            link.symlink_to(fixture.manifest_path.name)
            receipt, exit_code = origin_validator.validate(fixture.repo, link)
            self.assertEqual(exit_code, 1)
            self.assertEqual(receipt["reasonCode"], "ORIGIN_PROOF_SYMLINK_FORBIDDEN")

    def test_policy_and_implementation_reason_codes_match(self) -> None:
        policy_path = Path(__file__).with_name("policy.v1.json")
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        self.assertEqual(policy["reasonCodes"], list(origin_validator.REASON_CODES))
        phases = policy["rejectionPrecedence"]
        self.assertEqual(
            [phase["phase"] for phase in phases],
            [
                "manifestRead",
                "manifestContract",
                "repository",
                "objects",
                "refs",
                "ancestry",
                "packetFiles",
            ],
        )
        for phase in phases:
            self.assertEqual(len(phase["codes"]), len(set(phase["codes"])))
            self.assertTrue(set(phase["codes"]).issubset(origin_validator.REASON_CODES))

    def test_cli_emits_one_canonical_line_and_stable_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            fixture = _create_fixture(Path(raw))
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = origin_validator.main(
                    [
                        "--repo",
                        os.fspath(fixture.repo),
                        "--manifest",
                        os.fspath(fixture.manifest_path),
                    ]
                )
            lines = stdout.getvalue().splitlines()
            self.assertEqual(exit_code, 0)
            self.assertEqual(len(lines), 1)
            parsed = json.loads(lines[0])
            self.assertEqual(parsed["reasonCode"], origin_validator.ORIGIN_PROOF_VALID)
            self.assertNotIn(raw, lines[0])

    def test_cli_invocation_failure_is_stable(self) -> None:
        for arguments in ([], ["--help"], ["--unknown"]):
            with self.subTest(arguments=arguments):
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    exit_code = origin_validator.main(arguments)
                self.assertEqual(exit_code, 2)
                self.assertEqual(len(stdout.getvalue().splitlines()), 1)
                self.assertEqual(
                    json.loads(stdout.getvalue())["reasonCode"],
                    "ORIGIN_PROOF_INVOCATION_INVALID",
                )


if __name__ == "__main__":
    unittest.main()
