from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

from quant_edge.features.domains import BarDomain
from quant_edge.features.primitives import v1_features
from quant_edge.features.registry import FeatureCardV1

QUANT_ROOT = Path(__file__).resolve().parents[2]
FEATURE_SOURCES = tuple(
    QUANT_ROOT / "src" / "quant_edge" / "features" / name
    for name in (
        "__init__.py",
        "fixedpoint.py",
        "domains.py",
        "baselines.py",
        "registry.py",
        "values.py",
        "primitives.py",
        "harness.py",
        "diagnostics.py",
    )
)
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q06_feature_campaign.py"

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


def test_features_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.features"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_feature_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in FEATURE_SOURCES:
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


def test_every_v1_feature_carries_a_complete_card() -> None:
    for implementation in v1_features():
        card = implementation.card
        assert isinstance(card, FeatureCardV1)
        mapping = card.as_mapping()
        # Every §12 field is present and non-empty in the serialized card.
        for key in (
            "batchReference",
            "computationalCost",
            "domain",
            "economicHypothesis",
            "expectedFailureModes",
            "incrementalUpdateRule",
            "inputs",
            "missingBehavior",
            "name",
            "normalizationCohort",
            "provenance",
            "staleBehavior",
            "streamingImplementation",
            "testBinding",
            "unitId",
            "version",
            "windowLaw",
        ):
            assert mapping[key] not in (None, "", []), key
        assert card.domain in BarDomain
        # Machinery claims only: no predictive language in the hypothesis.
        for banned in ("guaranteed", "profitable", "alpha", "edge proven"):
            assert banned not in card.economic_hypothesis.lower()
