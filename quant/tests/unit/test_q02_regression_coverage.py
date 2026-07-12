from __future__ import annotations

import argparse
import io
import json
import runpy
import shutil
import sys
from pathlib import Path

import pytest

from quant_edge import cli
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import CanonicalJsonError, QuantEdgeError


def test_canonical_parser_translates_json_decoder_recursion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def recurse(*_args: object, **_kwargs: object) -> object:
        raise RecursionError("synthetic decoder recursion")

    monkeypatch.setattr(json, "loads", recurse)
    with pytest.raises(CanonicalJsonError, match="nesting exceeds"):
        parse_canonical_object(b"{}\n")


def test_read_bounded_regular_file_rejects_symlink_directory_and_declared_size(
    tmp_path: Path,
) -> None:
    target = tmp_path / "target"
    target.write_bytes(b"x")
    link = tmp_path / "link"
    link.symlink_to(target)
    with pytest.raises(QuantEdgeError, match="symbolic link"):
        cli._read_bounded_regular_file(link, max_bytes=8, label="fixture")
    with pytest.raises(QuantEdgeError, match="regular file"):
        cli._read_bounded_regular_file(tmp_path, max_bytes=8, label="fixture")
    with pytest.raises(QuantEdgeError, match="exceeds 0 bytes"):
        cli._read_bounded_regular_file(target, max_bytes=0, label="fixture")


def test_read_bounded_regular_file_rechecks_actual_read_bound(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "race"
    path.write_bytes(b"x")
    real_open = Path.open

    def oversized_open(self: Path, *_args: object, **_kwargs: object) -> io.BytesIO:
        assert self == path
        return io.BytesIO(b"xx")

    monkeypatch.setattr(Path, "open", oversized_open)
    with pytest.raises(QuantEdgeError, match="exceeds 1 bytes"):
        cli._read_bounded_regular_file(path, max_bytes=1, label="fixture")
    monkeypatch.setattr(Path, "open", real_open)


def test_registry_command_rejects_non_utf8_map(tmp_path: Path) -> None:
    registry = tmp_path / "registry.json"
    map_path = tmp_path / "map.md"
    registry.write_bytes(b"{}\n")
    map_path.write_bytes(b"\xff")
    args = argparse.Namespace(registry=str(registry), map_path=str(map_path))
    with pytest.raises(QuantEdgeError, match="valid UTF-8"):
        cli._registry_command(args)


def test_protocol_command_rejects_identity_before_execution(tmp_path: Path) -> None:
    first = next(iter(cli._FROZEN_PROTOCOL_SHA256))
    artifact = tmp_path / first
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_bytes(b"wrong")
    args = argparse.Namespace(repo_root=str(tmp_path), timeout_seconds=30)
    with pytest.raises(QuantEdgeError, match="identity mismatch"):
        cli._protocol_command(args)


def test_protocol_command_requires_node_after_identity_checks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    args = argparse.Namespace(repo_root=str(repo_root), timeout_seconds=30)
    with pytest.raises(QuantEdgeError, match="node executable is unavailable"):
        cli._protocol_command(args)


def test_module_entrypoint_delegates_to_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "quant-edge",
            "config",
            "--run-id",
            "entrypoint",
            "--as-of-ms",
            "1783814400000",
            "--seed",
            "1",
            "--truth-posture",
            "SYNTHETIC",
        ],
    )
    with pytest.raises(SystemExit) as captured:
        runpy.run_module("quant_edge.__main__", run_name="__main__")
    assert captured.value.code == 0
