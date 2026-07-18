"""Q14 safety contract: the validation package conveys no ambient or money authority."""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

QUANT_ROOT = Path(__file__).resolve().parents[2]
VALIDATION_SOURCES = tuple(
    QUANT_ROOT / "src" / "quant_edge" / "validation" / name
    for name in (
        "__init__.py",
        "samples.py",
        "splits.py",
        "metrics.py",
        "controls.py",
        "bootstrap.py",
        "normal.py",
        "multiplicity.py",
        "dsr.py",
        "stress.py",
        "leakage.py",
        "comparison.py",
        "feature_diagnostics.py",
    )
)
CAMPAIGN_SCRIPT = QUANT_ROOT / "tests" / "q14" / "q14_validation_campaign.py"

FORBIDDEN_NEEDLES = (
    "os.environ",
    "os.getenv",
    "getenv(",
    "datetime.now",
    "datetime.utcnow",
    "time.time",
    "time.monotonic",
    "perf_counter",
    "import random",
    "import secrets",
    "import socket",
    "import requests",
    "import httpx",
    "websocket",
    "urlopen",
    "http://",
    "https://",
    "server.src",
    "intelligenceruntime.",
    "api_key",
    "secret_key",
    "withdraw",
    "place_order",
    "submit_order",
    "sqlite",
    "write_table",
    "write_dataset",
    "float(",
)
FORBIDDEN_IMPORT_ROOTS = frozenset(
    {
        "asyncio",
        "datetime",
        "duckdb",
        "httpx",
        "os",
        "pathlib",
        "polars",
        "pyarrow",
        "random",
        "requests",
        "secrets",
        "socket",
        "sqlite3",
        "ssl",
        "subprocess",
        "threading",
        "time",
        "urllib",
    }
)


def _import_roots(source: str) -> set[str]:
    tree = ast.parse(source)
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", maxsplit=1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            roots.add(node.module.split(".", maxsplit=1)[0])
    return roots


def test_validation_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.validation"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_validation_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in VALIDATION_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: {forbidden_imports}"


def test_campaign_script_has_no_network_or_ambient_time() -> None:
    source = CAMPAIGN_SCRIPT.read_text(encoding="utf-8")
    lowered = source.lower()
    hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
    assert not hits, hits
    # The campaign writer needs pathlib/sys for its explicit output boundary; every
    # other forbidden root stays forbidden.
    campaign_allowed = {"pathlib"}
    forbidden_imports = (_import_roots(source) & FORBIDDEN_IMPORT_ROOTS) - campaign_allowed
    assert not forbidden_imports, forbidden_imports


def test_public_numeric_contracts_carry_no_float_annotations() -> None:
    for path in VALIDATION_SOURCES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.AnnAssign) and isinstance(node.annotation, ast.Name):
                assert node.annotation.id != "float", f"{path.name}: float field"
            if isinstance(node, ast.FunctionDef):
                for argument in node.args.args + node.args.kwonlyargs:
                    annotation = argument.annotation
                    if isinstance(annotation, ast.Name):
                        assert annotation.id != "float", f"{path.name}:{node.name}: float parameter"
                returns = node.returns
                if isinstance(returns, ast.Name):
                    assert returns.id != "float", f"{path.name}:{node.name}: float return"
