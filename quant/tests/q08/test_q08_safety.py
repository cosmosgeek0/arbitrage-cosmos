from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import pytest

QUANT_ROOT = Path(__file__).resolve().parents[2]
DERIVATIVES_DIR = QUANT_ROOT / "src" / "quant_edge" / "derivatives"
LIBRARY_MODULES = (
    "__init__.py",
    "references.py",
    "costs.py",
    "borrow.py",
    "executable.py",
    "funding.py",
    "sampled.py",
    "openinterest.py",
    "liquidations.py",
    "basis_path.py",
    "bar_features.py",
    "statespace.py",
    "convergence.py",
    "cross_market.py",
    "leadlag.py",
)
CAMPAIGN_MODULE = DERIVATIVES_DIR / "campaign.py"

pytestmark = pytest.mark.contract

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


def test_the_module_inventory_is_exact() -> None:
    observed = sorted(path.name for path in DERIVATIVES_DIR.glob("*.py"))
    assert observed == sorted((*LIBRARY_MODULES, "campaign.py"))


def test_derivatives_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.derivatives"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_library_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for name in LIBRARY_MODULES:
        source = (DERIVATIVES_DIR / name).read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{name}: {forbidden_imports}"


def test_campaign_module_is_the_only_composition_boundary() -> None:
    source = CAMPAIGN_MODULE.read_text(encoding="utf-8")
    lowered = source.lower()
    needles = (
        "socket",
        "requests",
        "httpx",
        "urlopen",
        "http://",
        "https://",
        "websocket",
        "datetime.now",
        "time.time",
        "os.environ",
        "getenv",
    )
    hits = [needle for needle in needles if needle in lowered]
    assert not hits, hits
    # The campaign may touch the filesystem and argv, nothing else.
    assert _import_roots(source) & FORBIDDEN_IMPORT_ROOTS == {"pathlib"}


def test_executable_constructions_never_touch_indicative_references() -> None:
    """Structural distinctness: the executable module cannot consume mid/mark/
    index references and the reference module cannot consume quotes."""

    executable_source = (DERIVATIVES_DIR / "executable.py").read_text(encoding="utf-8")
    assert "ReferenceSetV1" not in executable_source
    assert "ReferencePriceV1" not in executable_source
    assert "reference_difference" not in executable_source
    references_source = (DERIVATIVES_DIR / "references.py").read_text(encoding="utf-8")
    assert "SizedQuoteV1" not in references_source
    assert "QuotePointV1" not in references_source


def test_no_derivatives_module_imports_production_or_model_frameworks() -> None:
    for path in sorted(DERIVATIVES_DIR.glob("*.py")):
        roots = _import_roots(path.read_text(encoding="utf-8"))
        assert not roots & {"server", "packages", "web"}, path.name
        assert not roots & {"sklearn", "torch", "lightgbm", "xgboost", "catboost"}, path.name


def test_library_docstrings_never_claim_validated_alpha() -> None:
    banned = ("tradable alpha is", "is a validated model", "proven edge", "guaranteed")
    for name in LIBRARY_MODULES:
        lowered = (DERIVATIVES_DIR / name).read_text(encoding="utf-8").lower()
        hits = [phrase for phrase in banned if phrase in lowered]
        assert not hits, f"{name}: {hits}"
