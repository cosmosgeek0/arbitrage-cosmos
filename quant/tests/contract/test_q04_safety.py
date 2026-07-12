from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

from quant_edge.book.engine import (
    SNAPSHOT_BOUNDARY_OWNER,
    SNAPSHOT_INTENT_AUTHORITY,
    SnapshotRequestIntentV1,
    spot_book_engine,
)
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import EvidencePosture

QUANT_ROOT = Path(__file__).resolve().parents[2]
BOOK_SOURCES = (
    QUANT_ROOT / "src" / "quant_edge" / "book" / "__init__.py",
    QUANT_ROOT / "src" / "quant_edge" / "book" / "levels.py",
    QUANT_ROOT / "src" / "quant_edge" / "book" / "events.py",
    QUANT_ROOT / "src" / "quant_edge" / "book" / "engine.py",
    QUANT_ROOT / "src" / "quant_edge" / "book" / "replay.py",
)
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q04_replay_campaign.py"

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


def test_book_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.book"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_book_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in BOOK_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: {forbidden_imports}"


def test_campaign_script_has_no_network_or_ambient_time() -> None:
    source = CAMPAIGN_SCRIPT.read_text(encoding="utf-8")
    lowered = source.lower()
    network_needles = (
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
    hits = [needle for needle in network_needles if needle in lowered]
    assert not hits, hits
    # The script may touch the filesystem it is told to write, nothing else.
    assert _import_roots(source) & FORBIDDEN_IMPORT_ROOTS == {"pathlib"}


def test_snapshot_intents_carry_no_transport_and_no_authority() -> None:
    engine = spot_book_engine(
        "BNBUSDT",
        expected_posture=EvidencePosture.SYNTHETIC,
        max_levels_per_side=4,
        max_buffered_deltas=4,
    )
    effects = engine.start(processing_time_ns=1_772_000_000_000_000_000)
    intent = next(effect for effect in effects if isinstance(effect, SnapshotRequestIntentV1))

    assert intent.boundary_owner == SNAPSHOT_BOUNDARY_OWNER
    assert SNAPSHOT_BOUNDARY_OWNER == "intelligenceRuntime"
    assert intent.authority == SNAPSHOT_INTENT_AUTHORITY
    assert SNAPSHOT_INTENT_AUTHORITY == "READ_ONLY_RESEARCH_INTENT"
    mapping = intent.as_mapping()
    rendered = str(sorted(mapping.items())).lower()
    for needle in ("url", "endpoint", "host", "port", "token", "key", "order", "sign"):
        assert needle not in rendered.replace("bookkey", "").replace("intentid", ""), needle
    try:
        SnapshotRequestIntentV1(
            intent_id=intent.intent_id,
            book_key=intent.book_key,
            symbol=intent.symbol,
            product=ForwardProduct.SPOT,
            engine_step=intent.engine_step,
            request_sequence=intent.request_sequence,
            reason_code=intent.reason_code,
            processing_time_ns=intent.processing_time_ns,
            boundary_owner="qLane",
        )
        raise AssertionError("intents must not claim a different boundary owner")
    except ContractValueError:
        pass
    try:
        SnapshotRequestIntentV1(
            intent_id=intent.intent_id,
            book_key=intent.book_key,
            symbol=intent.symbol,
            product=ForwardProduct.SPOT,
            engine_step=intent.engine_step,
            request_sequence=intent.request_sequence,
            reason_code=intent.reason_code,
            processing_time_ns=intent.processing_time_ns,
            authority="EXECUTE",
        )
        raise AssertionError("intents must not convey operational authority")
    except ContractValueError:
        pass


def test_book_package_exposes_only_synthetic_and_replay_postures() -> None:
    from quant_edge.book.events import _ALLOWED_POSTURES

    expected = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})
    assert expected == _ALLOWED_POSTURES
    assert EvidencePosture.LIVE not in _ALLOWED_POSTURES
