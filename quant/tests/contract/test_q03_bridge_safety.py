from __future__ import annotations

import ast
import inspect
import subprocess
import sys
from pathlib import Path

from quant_edge.bootstrap.bridge import (
    FORWARD_CAPTURE_SCHEMA,
    FORWARD_CAPTURE_SCHEMA_FINGERPRINT,
    SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY,
    CompatibilityState,
    DropNewCaptureQueue,
    IntegrationState,
    RealDeliveryState,
)

QUANT_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_PATH = QUANT_ROOT / "src" / "quant_edge" / "bootstrap" / "bridge.py"


def test_bridge_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.bootstrap.bridge"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_bridge_source_has_no_ambient_network_storage_or_money_authority() -> None:
    source = BRIDGE_PATH.read_text(encoding="utf-8")
    lowered = source.lower()
    forbidden = (
        "os.environ",
        "os.getenv",
        "getenv(",
        "datetime.now",
        "datetime.utcnow",
        "time.time",
        "import random",
        "math.random",
        "import socket",
        "import requests",
        "import httpx",
        "websocket",
        "server.src",
        "intelligenceruntime.",
        "api_key",
        "secret_key",
        "withdraw",
        "borrow(",
        "repay(",
        "place_order",
        "submit_order",
        "open(",
        "write_table",
        "write_dataset",
        "parquetwriter",
    )
    assert not [needle for needle in forbidden if needle in lowered]

    tree = ast.parse(source)
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", maxsplit=1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            roots.add(node.module.split(".", maxsplit=1)[0])
    assert not roots.intersection(
        {
            "asyncio",
            "datetime",
            "duckdb",
            "httpx",
            "os",
            "pathlib",
            "requests",
            "socket",
            "sqlite3",
            "subprocess",
            "time",
            "urllib",
        }
    )


def test_bridge_defines_no_store_transport_or_blocking_queue_surface() -> None:
    module_tree = ast.parse(BRIDGE_PATH.read_text(encoding="utf-8"))
    class_names = {node.name for node in module_tree.body if isinstance(node, ast.ClassDef)}
    assert not {
        "Store",
        "LakeStore",
        "Socket",
        "Transport",
        "Client",
        "Producer",
        "Writer",
    }.intersection(class_names)

    public_queue_methods = {
        name
        for name, member in inspect.getmembers(DropNewCaptureQueue, predicate=inspect.isfunction)
        if not name.startswith("_")
    }
    assert public_queue_methods == {"drain", "try_offer"}
    assert not {"put", "send", "wait", "join", "flush", "persist"}.intersection(
        public_queue_methods
    )


def test_forward_schema_conveys_nullable_clock_and_no_storage_authority() -> None:
    metadata = FORWARD_CAPTURE_SCHEMA.metadata
    assert metadata is not None
    assert metadata[b"q.nullable_source_time"] == b"TRUE"
    assert metadata[b"q.storage_authority"] == b"NONE"
    assert metadata[b"q.real_delivery_state"] == b"MISSING"
    assert metadata[b"q.integration_state"] == b"BLOCKED"
    assert metadata[b"q.payload_posture"] == b"HASH_BOUND_ONLY"
    assert metadata[b"q.payload_materialization_state"] == b"MATERIALIZED_MISSING"
    assert metadata[b"q.payload_schemas"].split(b"|") == [
        b"SPOT/BOOK_TICKER=BinanceSpotBookTickerHashPayloadV1",
        b"SPOT/TRADE=BinanceSpotTradeHashPayloadV1",
        b"USD_M_PERPETUAL/DEPTH_DELTA=BinanceUsdMDepthDeltaHashPayloadV1",
    ]
    assert FORWARD_CAPTURE_SCHEMA.field("source_event_time_ns").nullable
    assert FORWARD_CAPTURE_SCHEMA.field("source_transaction_time_ns").nullable
    assert FORWARD_CAPTURE_SCHEMA.field("source_trade_time_ms").nullable
    assert FORWARD_CAPTURE_SCHEMA.field("source_trade_time_ns").nullable
    assert FORWARD_CAPTURE_SCHEMA.field("source_update_time_ms").nullable
    assert FORWARD_CAPTURE_SCHEMA.field("source_update_time_ns").nullable
    assert not FORWARD_CAPTURE_SCHEMA.field("receive_wall_time_ns").nullable
    assert not FORWARD_CAPTURE_SCHEMA.field("payload_schema_id").nullable
    assert not FORWARD_CAPTURE_SCHEMA.field("payload_normalized_evidence_sha256").nullable
    assert (
        not FORWARD_CAPTURE_SCHEMA.field("usd_m_sequence")
        .type.field("previous_update_last")
        .nullable
    )
    assert not {
        "ask",
        "bid",
        "level",
        "price",
        "quantity",
    }.intersection(FORWARD_CAPTURE_SCHEMA.names)
    assert len(FORWARD_CAPTURE_SCHEMA_FINGERPRINT.to_bytes()) == 32


def test_spot_semantic_bridge_does_not_claim_operational_delivery() -> None:
    status = SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY
    assert status.semantic_mi_bridge is CompatibilityState.COMPATIBLE
    assert status.operational_capture is CompatibilityState.INCOMPATIBLE
    assert status.real_delivery_state is RealDeliveryState.MISSING
    assert status.integration_state is IntegrationState.BLOCKED
    assert "qDeliveryPort" in status.missing_operational_fields
    assert status.authority == "READ_ONLY_RESEARCH_FIXTURE"
