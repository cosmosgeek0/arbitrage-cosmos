from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

from quant_edge.canonical import parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
ENSEMBLE_DIR = QUANT_ROOT / "src" / "quant_edge" / "ensemble"
ENSEMBLE_SOURCES = tuple(sorted(ENSEMBLE_DIR.glob("*.py")))
SCRIPT = QUANT_ROOT / "scripts" / "q12_ensemble_campaign.py"
PACKAGE_INIT = ENSEMBLE_DIR / "__init__.py"

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
FORBIDDEN_INTERNAL_PREFIXES = (
    "quant_edge.deep",
    "quant_edge.registry_ops",
    "quant_edge.capital",
    "quant_edge.execution",
    "quant_edge.ledger",
    "quant_edge.risk",
    "quant_edge.strategy",
    "server",
)

FORBIDDEN_NEEDLES = (
    "os.environ",
    "os.getenv",
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
    "urlopen",
    "server.src",
    "api_key",
    "secret_key",
    "private_key",
    "place_order",
    "submit_order",
    "cancel_order",
    "withdraw(",
    "transfer(",
    "sqlite",
    "pickle",
    "joblib",
)


def _import_modules(source: str) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules.add(node.module)
    return modules


def _top_level_function_parameters(path: Path, function_name: str) -> tuple[tuple[str, str], ...]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    function = next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name
    )
    return (
        *((argument.arg, "POSITIONAL_ONLY") for argument in function.args.posonlyargs),
        *((argument.arg, "POSITIONAL_OR_KEYWORD") for argument in function.args.args),
        *((argument.arg, "KEYWORD_ONLY") for argument in function.args.kwonlyargs),
    )


def _literal_string_sequence(path: Path, assignment_name: str) -> tuple[str, ...]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assignment = next(
        node
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == assignment_name for target in node.targets
        )
    )
    value = ast.literal_eval(assignment.value)
    assert isinstance(value, list)
    assert all(isinstance(item, str) for item in value)
    return tuple(value)


def test_q12_package_import_is_inert_and_silent() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import quant_edge.ensemble"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_q12_domain_has_no_ambient_network_storage_secret_or_money_authority() -> None:
    assert ENSEMBLE_SOURCES
    for path in ENSEMBLE_SOURCES:
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        hits = [needle for needle in FORBIDDEN_NEEDLES if needle in lowered]
        assert not hits, f"{path.name}: {hits}"
        modules = _import_modules(source)
        forbidden_roots = {
            module
            for module in modules
            if module.split(".", maxsplit=1)[0] in FORBIDDEN_IMPORT_ROOTS
        }
        forbidden_internal = {
            module
            for module in modules
            if any(
                module == prefix or module.startswith(f"{prefix}.")
                for prefix in FORBIDDEN_INTERNAL_PREFIXES
            )
        }
        assert not forbidden_roots, f"{path.name}: {forbidden_roots}"
        assert not forbidden_internal, f"{path.name}: {forbidden_internal}"


def test_public_dataclass_annotations_do_not_expose_float_contract_fields() -> None:
    for path in ENSEMBLE_SOURCES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, ast.ClassDef):
                continue
            is_dataclass = any(
                (
                    isinstance(decorator, ast.Call)
                    and getattr(decorator.func, "id", None) == "dataclass"
                )
                or getattr(decorator, "id", None) == "dataclass"
                for decorator in node.decorator_list
            )
            if not is_dataclass:
                continue
            for statement in node.body:
                if isinstance(statement, ast.AnnAssign):
                    rendered = ast.unparse(statement.annotation)
                    assert "float" not in rendered, f"{path.name}:{node.name}.{rendered}"


def test_campaign_build_is_clock_free_and_external_effects_live_only_in_main() -> None:
    source = SCRIPT.read_text(encoding="utf-8")
    lowered = source.lower()
    for needle in (
        "socket",
        "requests",
        "httpx",
        "urlopen",
        "http://",
        "https://",
        "datetime.now",
        "time.time",
        "os.environ",
        "getenv",
    ):
        assert needle not in lowered
    tree = ast.parse(source)
    build = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "build_artifacts"
    )
    referenced = {node.id for node in ast.walk(build) if isinstance(node, ast.Name)}
    assert "time" not in referenced
    assert "Path" not in referenced


def test_q12_artifacts_are_canonical_json_without_float_values() -> None:
    for path in (
        QUANT_ROOT / "fixtures" / "q12_ensemble_golden_v1.json",
        QUANT_ROOT / "generated" / "q12" / "ensemble_campaign.v1.json",
    ):
        parse_canonical_object(path.read_bytes())


def test_q12_does_not_expose_persistence_promotion_or_inference_service_interfaces() -> None:
    for path in ENSEMBLE_SOURCES:
        lowered = path.read_text(encoding="utf-8").lower()
        for needle in (
            "save_model",
            "load_model",
            "champion",
            "promote_model",
            "rollback_model",
            "inference_service",
            "live_execution",
        ):
            assert needle not in lowered, f"{path.name}: {needle}"


def test_q12_public_entrypoints_require_recomputable_bound_evidence() -> None:
    conformal = ENSEMBLE_DIR / "conformal.py"
    calibration = ENSEMBLE_DIR / "calibration.py"
    abstention = ENSEMBLE_DIR / "abstention.py"

    assert _top_level_function_parameters(conformal, "fit_conformal") == (
        ("observations", "POSITIONAL_OR_KEYWORD"),
        ("spec", "POSITIONAL_OR_KEYWORD"),
        ("research_slice", "KEYWORD_ONLY"),
    )
    assert _top_level_function_parameters(conformal, "apply_conformal") == (
        ("model_evidence", "POSITIONAL_OR_KEYWORD"),
        ("lower", "POSITIONAL_OR_KEYWORD"),
        ("upper", "POSITIONAL_OR_KEYWORD"),
        ("observation_id", "KEYWORD_ONLY"),
        ("prediction_time_ns", "KEYWORD_ONLY"),
        ("research_slice", "KEYWORD_ONLY"),
    )
    assert _top_level_function_parameters(calibration, "evaluate_calibrator") == (
        ("model", "KEYWORD_ONLY"),
        ("samples", "KEYWORD_ONLY"),
        ("matrix", "KEYWORD_ONLY"),
        ("fitted", "KEYWORD_ONLY"),
        ("evaluation_fold_ids", "KEYWORD_ONLY"),
    )
    assert _top_level_function_parameters(calibration, "compare_calibrators") == (
        ("samples", "KEYWORD_ONLY"),
        ("matrix", "KEYWORD_ONLY"),
        ("fitted", "KEYWORD_ONLY"),
        ("evaluation_fold_ids", "KEYWORD_ONLY"),
        ("spec", "KEYWORD_ONLY"),
    )
    assert _top_level_function_parameters(calibration, "apply_calibrator") == (
        ("model", "KEYWORD_ONLY"),
        ("evaluation", "KEYWORD_ONLY"),
        ("samples", "KEYWORD_ONLY"),
        ("matrix", "KEYWORD_ONLY"),
        ("fitted", "KEYWORD_ONLY"),
        ("application_fold_ids", "KEYWORD_ONLY"),
    )
    assert _top_level_function_parameters(abstention, "decide_advisory") == (
        ("context", "POSITIONAL_OR_KEYWORD"),
    )

    exports = set(_literal_string_sequence(PACKAGE_INIT, "__all__"))
    assert {
        "BoundAssessmentDecisionV1",
        "BoundCalibratedAssessmentV1",
        "BoundConformalAssessmentV1",
        "BoundConformalModelEvidenceV1",
        "BoundCoverageEvidenceV1",
    }.issubset(exports)
    assert "AssessmentDecisionV1" not in exports
