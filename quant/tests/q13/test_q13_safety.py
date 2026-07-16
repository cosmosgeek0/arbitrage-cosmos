from __future__ import annotations

import ast
from pathlib import Path

DEEP_ROOT = Path(__file__).parents[2] / "src" / "quant_edge" / "deep"


def _modules() -> tuple[Path, ...]:
    return tuple(sorted(DEEP_ROOT.glob("*.py")))


def test_deep_package_has_no_effectful_or_money_authority_imports() -> None:
    forbidden_roots = {
        "aiohttp",
        "asyncio",
        "boto3",
        "httpx",
        "os",
        "requests",
        "socket",
        "subprocess",
        "time",
        "torch",
        "urllib",
    }
    forbidden_fragments = {
        "binance",
        "capital",
        "execution",
        "foundation.risk",
        "loan",
        "order",
        "private",
        "secret",
        "transfer",
        "withdraw",
    }
    seen: set[str] = set()
    for path in _modules():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                seen.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                seen.add(node.module)
    assert not {name.split(".")[0] for name in seen} & forbidden_roots
    assert not {
        fragment
        for fragment in forbidden_fragments
        if any(fragment in imported.lower() for imported in seen)
    }


def test_deep_library_contains_no_training_or_promotion_api() -> None:
    forbidden_calls = {"fit", "fit_transform", "load", "predict", "save", "train"}
    function_names: set[str] = set()
    for path in _modules():
        tree = ast.parse(path.read_text())
        function_names.update(
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        )
    assert not function_names & forbidden_calls
    assert "promote" not in function_names
