import importlib
import importlib.metadata
import subprocess
import sys
from pathlib import Path

QUANT_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = QUANT_ROOT / "src" / "quant_edge"


def test_package_import_is_inert_and_exports_only_research_primitives() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import quant_edge; print(quant_edge.__version__); print(','.join(quant_edge.__all__))",
        ],
        check=False,
        capture_output=True,
        text=True,
        cwd=QUANT_ROOT,
        timeout=10,
    )
    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout.splitlines() == [
        "0.1.0",
        "Clock,DeterministicRandom,FixedClock,RandomSource,ResearchConfig,make_research_config,seed_fixture_bytes",
    ]


def test_domain_modules_contain_no_ambient_io_or_randomness_seam() -> None:
    forbidden = (
        "os.environ",
        "os.getenv",
        "getenv(",
        "time.time",
        "datetime.now",
        "datetime.utcnow",
        "random.",
        "import random",
        "import socket",
        "import requests",
        "import httpx",
        "Path(",
        "open(",
    )
    domain_paths = [
        path for path in PACKAGE_ROOT.glob("*.py") if path.name not in {"__main__.py", "cli.py"}
    ]
    assert domain_paths
    for path in domain_paths:
        text = path.read_text(encoding="utf-8")
        assert not [needle for needle in forbidden if needle in text], path


def test_immediate_frameworks_import_at_exact_locked_versions() -> None:
    expected = {
        "duckdb": "1.5.4",
        "polars": "1.42.1",
        "pyarrow": "25.0.0",
        "quant-edge-research": "0.1.0",
    }
    for distribution, version in expected.items():
        assert importlib.metadata.version(distribution) == version
    for module in ("duckdb", "polars", "pyarrow"):
        assert importlib.import_module(module) is not None
