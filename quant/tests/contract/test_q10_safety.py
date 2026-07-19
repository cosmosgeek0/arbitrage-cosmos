from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

from quant_edge.canonical import parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = QUANT_ROOT / "src" / "quant_edge" / "models"
MODEL_SOURCES = tuple(
    MODELS_DIR / name
    for name in (
        "__init__.py",
        "battery.py",
        "contracts.py",
        "engine.py",
        "estimators.py",
        "focus_budget.py",
        "metrics.py",
        "quantize.py",
        "split.py",
        "studies.py",
        "synthetic.py",
    )
)
PURE_CONTRACT_SOURCES = tuple(
    MODELS_DIR / name for name in ("__init__.py", "contracts.py", "split.py")
)
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q10_model_campaign.py"


def test_the_model_module_inventory_is_exact() -> None:
    observed = sorted(path.name for path in MODELS_DIR.glob("*.py"))
    expected = sorted(path.name for path in MODEL_SOURCES)
    assert observed == expected


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
    "pickle",
    "joblib",
    "write_table",
    "write_dataset",
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


def test_models_package_import_is_inert_and_needs_no_extras() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.models"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_model_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in MODEL_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: {forbidden_imports}"


def test_pure_contract_sources_never_construct_floats() -> None:
    for path in PURE_CONTRACT_SOURCES:
        source = path.read_text(encoding="utf-8")
        assert "float(" not in source, path.name


def test_campaign_script_confines_timing_to_main() -> None:
    source = CAMPAIGN_SCRIPT.read_text(encoding="utf-8")
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
    # `time` exists solely for the stdout-only wall-time evidence in main();
    # build_artifacts() must stay clock-free so artifacts are byte-deterministic.
    tree = ast.parse(source)
    build = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "build_artifacts"
    )
    referenced = {node.id for node in ast.walk(build) if isinstance(node, ast.Name)}
    assert "time" not in referenced


def test_committed_artifacts_are_canonical_and_float_free() -> None:
    # parse_canonical_object enforces the no-float, no-duplicate, canonical-bytes law.
    for path in (
        QUANT_ROOT / "fixtures" / "q10_model_golden_v1.json",
        QUANT_ROOT / "generated" / "q10" / "model_campaign.v1.json",
        QUANT_ROOT / "generated" / "q10" / "dependency_audit_summary.v1.json",
        QUANT_ROOT / "generated" / "q10" / "dependency_license_inventory.v1.json",
    ):
        parse_canonical_object(path.read_bytes())


def test_no_file_model_persistence_interfaces_are_exposed() -> None:
    for path in MODEL_SOURCES:
        source = path.read_text(encoding="utf-8").lower()
        for needle in ("save_model", "dump(", "loads(", "to_json("):
            assert needle not in source, f"{path.name}: {needle}"
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "load_model"
            ):
                continue
            assert len(node.args) == 1
            argument = node.args[0]
            message = f"{path.name}: model loading must use bounded in-memory UBJ bytes"
            assert isinstance(argument, ast.Call), message
            assert isinstance(argument.func, ast.Name), message
            assert argument.func.id == "bytearray", message
            assert len(argument.args) == 1, message
