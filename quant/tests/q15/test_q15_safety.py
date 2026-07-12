from __future__ import annotations

import ast
from pathlib import Path

Q15_SOURCE = Path(__file__).resolve().parents[2] / "src" / "quant_edge" / "registry_ops"


def _modules() -> tuple[Path, ...]:
    return tuple(sorted(Q15_SOURCE.glob("*.py")))


def test_no_network_env_wall_clock_random_or_q12_imports() -> None:
    forbidden_roots = {
        "asyncio",
        "http",
        "requests",
        "random",
        "socket",
        "time",
        "urllib",
        "websockets",
    }
    for path in _modules():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] not in forbidden_roots for alias in node.names)
                assert all("ensemble" not in alias.name for alias in node.names)
            if isinstance(node, ast.ImportFrom) and node.module:
                assert node.module.split(".")[0] not in forbidden_roots
                assert "ensemble" not in node.module
                assert "calibration" not in node.module
            if isinstance(node, ast.Attribute):
                assert not (
                    isinstance(node.value, ast.Name)
                    and node.value.id == "os"
                    and node.attr in {"environ", "getenv"}
                )
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in {"eval", "exec", "compile"}


def test_sqlite_effect_is_isolated_to_explicit_store_adapter() -> None:
    sqlite_importers = []
    for path in _modules():
        tree = ast.parse(path.read_text())
        if any(
            isinstance(node, (ast.Import, ast.ImportFrom))
            and (
                (
                    isinstance(node, ast.Import)
                    and any(alias.name == "sqlite3" for alias in node.names)
                )
                or (isinstance(node, ast.ImportFrom) and node.module == "sqlite3")
            )
            for node in ast.walk(tree)
        ):
            sqlite_importers.append(path.name)
    assert sqlite_importers == ["store.py"]


def test_public_contracts_contain_no_float_literals() -> None:
    tree = ast.parse((Q15_SOURCE / "contracts.py").read_text())
    floats = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, float)
    ]
    assert floats == []


def test_no_private_exchange_or_money_authority_imports() -> None:
    forbidden = (
        "binance",
        "capital",
        "execution",
        "foundation.risk",
        "loan",
        "order",
        "private",
        "transfer",
        "withdraw",
    )
    for path in _modules():
        tree = ast.parse(path.read_text())
        imported: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.extend(alias.name.lower() for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.append(node.module.lower())
        assert not any(token in module for token in forbidden for module in imported)
