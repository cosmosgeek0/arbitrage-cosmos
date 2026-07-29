from __future__ import annotations

import ast
from pathlib import Path

import research.dq5 as dq5
from research.dq5.tests.support import DQ5_ROOT

from quant_edge.canonical import parse_canonical_object

_PURE_MODULES = ("contracts.py", "validator.py", "__init__.py")
_PURE_FORBIDDEN_IMPORTS = frozenset(
    {
        "datetime",
        "http",
        "os",
        "pathlib",
        "random",
        "secrets",
        "socket",
        "subprocess",
        "time",
        "urllib",
    }
)
_PACKAGE_FORBIDDEN_IMPORTS = frozenset({"http", "socket", "subprocess", "urllib"})
_FORBIDDEN_METADATA_KEYS = frozenset(
    {
        "archivePath",
        "dataPath",
        "datasetPath",
        "outcomePath",
        "path",
        "url",
    }
)


def _import_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", maxsplit=1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            roots.add(node.module.split(".", maxsplit=1)[0])
    return roots


def _assert_no_forbidden_keys(value: object) -> None:
    if isinstance(value, list):
        for item in value:
            _assert_no_forbidden_keys(item)
        return
    if not isinstance(value, dict):
        return
    assert _FORBIDDEN_METADATA_KEYS.isdisjoint(value)
    for item in value.values():
        _assert_no_forbidden_keys(item)


def test_pure_validator_has_no_ambient_or_effectful_imports() -> None:
    for filename in _PURE_MODULES:
        assert _PURE_FORBIDDEN_IMPORTS.isdisjoint(_import_roots(DQ5_ROOT / filename))


def test_package_has_no_network_or_subprocess_imports() -> None:
    for path in DQ5_ROOT.glob("*.py"):
        assert _PACKAGE_FORBIDDEN_IMPORTS.isdisjoint(_import_roots(path))


def test_fixtures_carry_only_metadata_not_data_or_outcome_paths() -> None:
    for path in sorted((DQ5_ROOT / "fixtures").rglob("*.json")):
        _assert_no_forbidden_keys(parse_canonical_object(path.read_bytes()))


def test_only_byte_validating_entry_point_is_public() -> None:
    assert dq5.__all__ == [
        "Dq5InputError",
        "Dq5ReasonCode",
        "ValidationReport",
        "parse_candidate",
        "parse_registry",
        "validate_bytes",
    ]
    assert not hasattr(dq5, "validate_intake")
