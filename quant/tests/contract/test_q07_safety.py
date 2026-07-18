from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

from quant_edge.micro import SECTION_13_1_DISPOSITIONS, FamilyDisposition
from quant_edge.micro.activity import activity_surprise_feature
from quant_edge.micro.bookfeat import (
    band_flow_feature,
    book_slope_imbalance_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    vwap_spread_at_size_feature,
)
from quant_edge.micro.flow import (
    absorption_ratio_feature,
    amihud_illiquidity_feature,
    effective_spread_feature,
    kyle_slope_feature,
    signed_trade_imbalance_feature,
    size_concentration_hhi_feature,
    trade_dispersion_feature,
    trade_intensity_feature,
)
from quant_edge.micro.l1 import (
    l1_queue_imbalance_feature,
    microprice_displacement_feature,
    ofi_l1_feature,
)

QUANT_ROOT = Path(__file__).resolve().parents[2]
MICRO_SOURCES = tuple(
    QUANT_ROOT / "src" / "quant_edge" / "micro" / name
    for name in (
        "__init__.py",
        "inputs.py",
        "equivalence.py",
        "l1.py",
        "bookfeat.py",
        "flow.py",
        "families.py",
        "activity.py",
    )
)
CAMPAIGN_SCRIPT = QUANT_ROOT / "scripts" / "q07_micro_campaign.py"

ALL_FEATURE_FACTORIES = (
    absorption_ratio_feature,
    activity_surprise_feature,
    amihud_illiquidity_feature,
    band_flow_feature,
    book_slope_imbalance_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    effective_spread_feature,
    kyle_slope_feature,
    l1_queue_imbalance_feature,
    microprice_displacement_feature,
    ofi_l1_feature,
    signed_trade_imbalance_feature,
    size_concentration_hhi_feature,
    trade_dispersion_feature,
    trade_intensity_feature,
    vwap_spread_at_size_feature,
)


def test_the_micro_module_inventory_is_exact() -> None:
    observed = sorted(path.name for path in MICRO_SOURCES[0].parent.glob("*.py"))
    expected = sorted(path.name for path in MICRO_SOURCES)
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


def test_micro_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.micro"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_micro_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in MICRO_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: {forbidden_imports}"


def test_campaign_script_has_no_network_and_timing_stays_out_of_artifacts() -> None:
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
    # `time` exists solely for stdout-only wall-time evidence required by the task;
    # build_artifacts() must stay clock-free so artifacts remain byte-deterministic.
    assert _import_roots(source) & FORBIDDEN_IMPORT_ROOTS == {"pathlib", "time"}
    build_body = source.split("def build_artifacts", maxsplit=1)[1].split("\ndef ", maxsplit=1)[0]
    assert "perf_counter" not in build_body
    assert "time." not in build_body


def test_every_micro_feature_carries_a_complete_card() -> None:
    seen: set[str] = set()
    for factory in ALL_FEATURE_FACTORIES:
        implementation = factory()
        card = implementation.card
        mapping = card.as_mapping()
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
        seen.add(card.feature_id)
        # Machinery claims only: no predictive language in the hypothesis.
        for banned in ("guaranteed", "profitable", "alpha", "edge proven"):
            assert banned not in card.economic_hypothesis.lower()
    assert len(seen) == len(ALL_FEATURE_FACTORIES)


def test_disposition_reasons_never_claim_intent_or_certainty() -> None:
    for record in SECTION_13_1_DISPOSITIONS:
        lowered = record.reason.lower()
        for banned in ("guaranteed", "profitable", "proven edge", "will predict"):
            assert banned not in lowered
        if record.disposition is FamilyDisposition.BLOCKED_DATA:
            assert "cannot" in lowered  # blocked families name the missing evidence
