from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

from quant_edge.labels.disposition import EventDisposition
from quant_edge.labels.outcomes import HORIZON_GRID_NS
from quant_edge.labels.series import _ALLOWED_POSTURES
from quant_edge.labels.stages import StageLabel
from quant_edge.lake.contracts import EvidencePosture

QUANT_ROOT = Path(__file__).resolve().parents[2]
LABEL_SOURCES = tuple(
    QUANT_ROOT / "src" / "quant_edge" / "labels" / name
    for name in (
        "__init__.py",
        "rational.py",
        "series.py",
        "identity.py",
        "outcomes.py",
        "stages.py",
        "basis.py",
        "disposition.py",
        "controls.py",
        "manifest.py",
    )
)
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q05_label_campaign.py"

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
    "import aiohttp",
    "websocket",
    "urlopen",
    "http://",
    "https://",
    "server.src",
    "intelligenceruntime.",
    "api_key",
    "secret_key",
    "withdraw",
    "borrow(",
    "repay(",
    "place_order",
    "submit_order",
    "sqlite",
    "write_table",
    "write_dataset",
    "parquetwriter",
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


def test_labels_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.labels"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_labels_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in LABEL_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: {forbidden_imports}"


def test_campaign_script_has_no_network_or_ambient_time() -> None:
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
    assert _import_roots(source) & FORBIDDEN_IMPORT_ROOTS == {"pathlib"}


def test_directive_vocabularies_are_exact() -> None:
    assert [stage.value for stage in StageLabel] == [
        "DORMANT",
        "IGNITION",
        "EARLY_EXPANSION",
        "CONTINUATION",
        "EXHAUSTION",
        "FADE",
        "UNWIND",
        "DISORDER",
        "NO_EVENT",
        "UNKNOWN",
    ]
    assert [disposition.value for disposition in EventDisposition] == [
        "ACTED",
        "REJECTED",
        "EXPIRED",
        "MISSED",
        "QUIET_CONTROL",
        "DATA_INVALID",
    ]
    second = 1_000_000_000
    assert (
        1 * second,
        5 * second,
        15 * second,
        30 * second,
        60 * second,
        300 * second,
        900 * second,
        3_600 * second,
    ) == HORIZON_GRID_NS


def test_labels_accept_only_synthetic_and_replay_evidence() -> None:
    assert frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY}) == _ALLOWED_POSTURES
    assert EvidencePosture.LIVE not in _ALLOWED_POSTURES
