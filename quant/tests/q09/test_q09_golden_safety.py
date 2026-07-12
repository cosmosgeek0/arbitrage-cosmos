from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import pytest

from quant_edge.regime.campaign import build_artifacts

QUANT_ROOT = Path(__file__).resolve().parents[2]
REGIME_DIR = QUANT_ROOT / "src" / "quant_edge" / "regime"
LIBRARY_SOURCES = tuple(
    REGIME_DIR / name
    for name in (
        "__init__.py",
        "contracts.py",
        "alphabet.py",
        "cusum.py",
        "page_hinkley.py",
        "pelt.py",
        "bocpd.py",
        "soft_regime.py",
        "anomaly.py",
        "matrix_profile.py",
        "analog.py",
        "metrics.py",
    )
)
CAMPAIGN_SOURCE = REGIME_DIR / "campaign.py"
GOLDEN_PATH = QUANT_ROOT / "generated" / "q09" / "regime_golden_v1.json"
CAMPAIGN_PATH = QUANT_ROOT / "generated" / "q09" / "regime_campaign.v1.json"
MARKDOWN_PATH = QUANT_ROOT / "generated" / "q09" / "regime_campaign.v1.md"

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


def test_regime_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.regime"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_regime_sources_have_no_ambient_network_storage_or_money_authority() -> None:
    for path in LIBRARY_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        forbidden_imports = _import_roots(source) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: {forbidden_imports}"


def test_campaign_module_has_no_network_or_ambient_time() -> None:
    source = CAMPAIGN_SOURCE.read_text(encoding="utf-8")
    lowered = source.lower()
    hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
    assert not hits, hits
    # The campaign writes its committed artifacts, so pathlib alone is expected.
    assert _import_roots(source) & FORBIDDEN_IMPORT_ROOTS == {"pathlib"}


def test_committed_artifacts_equal_in_test_regeneration() -> None:
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    assert GOLDEN_PATH.read_bytes() == fixture_bytes
    assert CAMPAIGN_PATH.read_bytes() == campaign_bytes
    assert MARKDOWN_PATH.read_bytes() == markdown_bytes


def test_campaign_is_byte_deterministic_across_processes(tmp_path: Path) -> None:
    outputs = []
    for run, (cwd, tz, hash_seed) in enumerate(
        (
            (QUANT_ROOT, "UTC", "0"),
            (tmp_path, "Pacific/Kiritimati", "424242"),
        )
    ):
        target = tmp_path / f"run-{run}"
        result = subprocess.run(
            [sys.executable, "-m", "quant_edge.regime.campaign", str(target)],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
            env={
                "PATH": "/usr/bin:/bin",
                "PYTHONHASHSEED": hash_seed,
                "PYTHONPATH": str(QUANT_ROOT / "src"),
                "TZ": tz,
            },
        )
        assert result.returncode == 0, result.stderr
        outputs.append(
            tuple(
                (target / "generated" / "q09" / name).read_bytes()
                for name in (
                    "regime_golden_v1.json",
                    "regime_campaign.v1.json",
                    "regime_campaign.v1.md",
                )
            )
        )
    assert outputs[0] == outputs[1]
    assert outputs[0][0] == GOLDEN_PATH.read_bytes()
    assert outputs[0][1] == CAMPAIGN_PATH.read_bytes()
    assert outputs[0][2] == MARKDOWN_PATH.read_bytes()


def test_campaign_main_usage_error() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "quant_edge.regime.campaign"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 2
    assert "usage" in result.stderr


@pytest.fixture(scope="module", name="golden")
def golden_fixture() -> dict[str, object]:
    loaded = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


@pytest.fixture(scope="module", name="campaign")
def campaign_fixture() -> dict[str, object]:
    loaded = json.loads(CAMPAIGN_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


class TestGoldenMeasurements:
    def test_every_golden_detector_detects_both_changes(
        self,
        golden: dict[str, object],
    ) -> None:
        detection = golden["detection"]
        assert isinstance(detection, dict)
        assert sorted(detection) == ["bocpd", "cusum", "pageHinkley"]
        for block in detection.values():
            assert isinstance(block, dict)
            report = block["report"]
            assert isinstance(report, dict)
            assert report["detected"] == [80, 160]
            assert report["missed"] == []
            assert report["falseAlarms"] == []

    def test_golden_delays_are_measured_not_asserted(
        self,
        golden: dict[str, object],
    ) -> None:
        detection = golden["detection"]
        assert isinstance(detection, dict)
        cusum = detection["cusum"]
        bocpd = detection["bocpd"]
        assert isinstance(cusum, dict)
        assert isinstance(bocpd, dict)
        cusum_report = cusum["report"]
        bocpd_report = bocpd["report"]
        assert isinstance(cusum_report, dict)
        assert isinstance(bocpd_report, dict)
        assert cusum_report["delays"] == [0, 0]
        assert bocpd_report["delays"] == [2, 2]

    def test_golden_pelt_recovers_exact_boundaries(
        self,
        golden: dict[str, object],
    ) -> None:
        segmentation = golden["segmentation"]
        assert isinstance(segmentation, dict)
        report = segmentation["report"]
        assert isinstance(report, dict)
        assert report["matched"] == [[80, 80], [160, 160]]
        assert report["missed"] == []
        assert report["spurious"] == []

    def test_golden_anomaly_hits_every_injection_with_no_false_flags(
        self,
        golden: dict[str, object],
    ) -> None:
        anomaly = golden["anomaly"]
        assert isinstance(anomaly, dict)
        measurement = anomaly["measurement"]
        assert isinstance(measurement, dict)
        assert measurement["hits"] == [50, 120, 200]
        assert measurement["missed"] == []
        assert measurement["falseFlags"] == []

    def test_golden_profile_finds_the_planted_motif(
        self,
        golden: dict[str, object],
    ) -> None:
        profile = golden["matrixProfile"]
        assert isinstance(profile, dict)
        entries = profile["entries"]
        assert isinstance(entries, list)
        motif_entry = entries[40]
        assert isinstance(motif_entry, dict)
        assert motif_entry["neighbor"] == 8
        exclusions = profile["exclusions"]
        assert isinstance(exclusions, dict)
        assert exclusions["future"] > 0
        assert exclusions["overlap"] > 0
        assert exclusions["sameEvent"] > 0

    def test_golden_analog_exclusions_cover_every_reason(
        self,
        golden: dict[str, object],
    ) -> None:
        retrieval = golden["analogRetrieval"]
        assert isinstance(retrieval, dict)
        exclusions = retrieval["exclusionCounts"]
        assert isinstance(exclusions, dict)
        assert exclusions == {
            "COHORT": 1,
            "DEGENERATE": 1,
            "FUTURE": 2,
            "OVERLAP": 0,
            "SAME_EVENT": 1,
            "SHAPE": 1,
        }
        neighbors = retrieval["neighbors"]
        assert isinstance(neighbors, list)
        assert [neighbor["recordId"] for neighbor in neighbors if isinstance(neighbor, dict)] == [
            "analog-close-match",
            "analog-weak-match",
            "analog-anti-match",
        ]

    def test_campaign_measures_aggregate_rates_and_exclusions(
        self,
        campaign: dict[str, object],
    ) -> None:
        assert campaign["seed"] == "20260712"
        assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
        detection = campaign["detection"]
        assert isinstance(detection, dict)
        per_detector = detection["perDetector"]
        assert isinstance(per_detector, dict)
        for summary in per_detector.values():
            assert isinstance(summary, dict)
            assert summary["detected"] + summary["missed"] == 33
            assert summary["aggregateFalseAlarmRate"] is not None
        profiles = campaign["matrixProfiles"]
        analogs = campaign["analogs"]
        assert isinstance(profiles, dict)
        assert isinstance(analogs, dict)
        profile_exclusions = profiles["exclusionTotals"]
        analog_exclusions = analogs["exclusionTotals"]
        assert isinstance(profile_exclusions, dict)
        assert isinstance(analog_exclusions, dict)
        assert profile_exclusions["future"] > 0
        assert profile_exclusions["overlap"] > 0
        assert analog_exclusions["FUTURE"] > 0
        assert analog_exclusions["COHORT"] > 0
