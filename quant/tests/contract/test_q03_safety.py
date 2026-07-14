from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

QUANT_ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP_ROOT = QUANT_ROOT / "src" / "quant_edge" / "bootstrap"
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q03_real_sample.py"


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imports.add(node.module)
    return imports


def test_all_q03_library_imports_are_inert_silent_and_network_free() -> None:
    modules = tuple(
        f"quant_edge.bootstrap.{path.stem}"
        for path in sorted(BOOTSTRAP_ROOT.glob("*.py"))
        if path.stem != "__init__"
    )
    statement = "; ".join(f"import {module}" for module in modules)
    result = subprocess.run(
        [sys.executable, "-c", statement],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""
    forbidden_imports = {
        "aiohttp",
        "asyncio",
        "http.client",
        "httpx",
        "requests",
        "socket",
        "sqlite3",
        "urllib.request",
        "websockets",
    }
    for path in sorted(BOOTSTRAP_ROOT.glob("*.py")):
        assert not _imports(path).intersection(forbidden_imports), path


def test_q03_library_has_no_ambient_state_production_registration_or_money_surface() -> None:
    forbidden_text = (
        "os.environ",
        "os.getenv",
        "getenv(",
        "datetime.now",
        "datetime.utcnow",
        "time.time",
        "import random",
        "math.random",
        "api_key",
        "secret_key",
        "place_order",
        "submit_order",
        "withdraw(",
        "repay(",
        "register_source",
        "open_websocket",
        "rest_poller",
    )
    forbidden_public_names = {
        "borrow",
        "connect",
        "download",
        "execute_order",
        "label",
        "model",
        "place_order",
        "poll",
        "register",
        "repay",
        "withdraw",
    }
    for path in sorted(BOOTSTRAP_ROOT.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        assert not [needle for needle in forbidden_text if needle in lowered], path
        tree = ast.parse(source)
        public_names = {
            node.name.lower()
            for node in ast.walk(tree)
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and not node.name.startswith("_")
        }
        assert not public_names.intersection(forbidden_public_names), path


def test_real_campaign_script_has_no_network_or_environment_client() -> None:
    imports = _imports(CAMPAIGN_SCRIPT)
    source = CAMPAIGN_SCRIPT.read_text(encoding="utf-8").lower()

    assert not imports.intersection(
        {
            "aiohttp",
            "http.client",
            "httpx",
            "requests",
            "socket",
            "urllib.request",
            "websockets",
        }
    )
    assert "os.environ" not in source
    assert "os.getenv" not in source
    assert "api_key" not in source
    assert "secret_key" not in source
    assert "curl" not in source
    assert "network acquisition remains an operator action" in source
