from __future__ import annotations

import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from quant_edge.survival.campaign import build_artifacts

QUANT_ROOT = Path(__file__).resolve().parents[2]
SURVIVAL_DIR = QUANT_ROOT / "src" / "quant_edge" / "survival"
LIBRARY_SOURCES = tuple(
    SURVIVAL_DIR / name
    for name in (
        "__init__.py",
        "contracts.py",
        "km.py",
        "competing.py",
        "hazard_model.py",
        "metrics.py",
        "targets.py",
    )
)
CAMPAIGN_SOURCE = SURVIVAL_DIR / "campaign.py"
GOLDEN_PATH = QUANT_ROOT / "generated" / "q11" / "survival_golden_v1.json"
CAMPAIGN_PATH = QUANT_ROOT / "generated" / "q11" / "survival_campaign.v1.json"
MARKDOWN_PATH = QUANT_ROOT / "generated" / "q11" / "survival_campaign.v1.md"

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


def test_survival_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.survival"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_survival_sources_have_no_ambient_network_storage_or_money_authority() -> None:
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
            [sys.executable, "-m", "quant_edge.survival.campaign", str(target)],
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
                (target / "generated" / "q11" / name).read_bytes()
                for name in (
                    "survival_golden_v1.json",
                    "survival_campaign.v1.json",
                    "survival_campaign.v1.md",
                )
            )
        )
    assert outputs[0] == outputs[1]
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    assert outputs[0] == (fixture_bytes, campaign_bytes, markdown_bytes)


def test_golden_fixture_records_measured_acceptance_evidence() -> None:
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert golden["schema"] == "Q11SurvivalGoldenV1"
    assert golden["evidencePosture"] == "SYNTHETIC_ONLY"
    # Hand-verified survival values are present in the committed fixture.
    km_points = golden["kaplanMeier"]["curve"]["points"]
    assert km_points[0]["survival"]["mantissa"] == "857142857143"
    assert km_points[-1]["survival"]["mantissa"] == "448179271709"
    # The AJ end state conserves probability: 0 + 7/18 + 11/18 = 1.
    aj = golden["aalenJohansen"]["estimate"]
    assert aj["overallSurvival"]["points"][-1]["survival"]["mantissa"] == "0"
    # The thin stratum is UNKNOWN everywhere and the unseen stratum is None.
    assert golden["hazardModel"]["predictions"]["THIN"]["knownBins"] == 0
    assert golden["hazardModel"]["unseenStratumIsUnknown"] is True
    # The oracle passes and the deliberately miscalibrated predictor fails.
    verdicts = golden["metrics"]["verdicts"]
    assert verdicts["pass"]["verdict"] == "PASS"
    assert verdicts["fail"]["verdict"] == "FAIL"
    assert verdicts["fail"]["reasons"] == [
        "CALIBRATION_ERROR_EXCEEDS_BUDGET",
        "CONCORDANCE_BELOW_BUDGET",
        "INTEGRATED_BRIER_EXCEEDS_BUDGET",
    ]
    # The same-group law is exercised and measured in the golden concordance.
    assert golden["metrics"]["concordance"]["perfect"]["excludedSameGroup"] >= 1


def test_campaign_measurements_pass_the_declared_budget() -> None:
    campaign = json.loads(CAMPAIGN_PATH.read_text(encoding="utf-8"))
    assert campaign["schema"] == "Q11SurvivalCampaignV1"
    assert campaign["seed"] == "20260712"
    assert campaign["evidencePosture"] == "SYNTHETIC_ONLY"
    assert campaign["budgetVerdict"]["verdict"]["verdict"] == "PASS"
    # KM recovers the known generating survival within a measured gap.
    gap = int(campaign["estimatorRecovery"]["maxAbsSurvivalGap"]["mantissa"])
    assert 0 < gap < 80_000_000_000  # < 0.08 against the known truth
    # The stratified model beats the marginal predictor on integrated Brier.
    model_ibs = int(campaign["modelEvaluation"]["brier"]["modelAny"]["integrated"]["mantissa"])
    marginal_ibs = int(
        campaign["modelEvaluation"]["brier"]["marginalAny"]["integrated"]["mantissa"]
    )
    assert model_ibs < marginal_ibs
    # Concordance of model risk scores is measured and better than chance.
    concordance = int(campaign["modelEvaluation"]["concordance"]["concordance"]["mantissa"])
    assert concordance > 700_000_000_000
    # Competing-risk conservation survives quantization to within one ulp.
    assert campaign["competing"]["quantizedConservationDefectUlps"] <= 1
    # The fixture hash binds the campaign to the committed golden.
    golden_bytes = GOLDEN_PATH.read_bytes()
    assert campaign["fixtureSha256"] == hashlib.sha256(golden_bytes).hexdigest()
