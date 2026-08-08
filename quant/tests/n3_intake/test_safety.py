from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import quant_edge.n3_intake as n3_intake

QUANT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = QUANT_ROOT / "src" / "quant_edge" / "n3_intake"

FORBIDDEN_IMPORT_ROOTS = frozenset(
    {
        "aiohttp",
        "anyio",
        "asyncio",
        "ftplib",
        "glob",
        "http",
        "httpx",
        "importlib",
        "os",
        "random",
        "requests",
        "secrets",
        "shutil",
        "smtplib",
        "socket",
        "ssl",
        "subprocess",
        "tempfile",
        "time",
        "trio",
        "urllib",
        "websockets",
    }
)
FORBIDDEN_DIRECT_CALLS = frozenset(
    {
        "__import__",
        "compile",
        "eval",
        "exec",
        "open",
    }
)
FORBIDDEN_EFFECT_CALLS = frozenset(
    {
        "absolute",
        "chmod",
        "chown",
        "cwd",
        "exists",
        "getenv",
        "glob",
        "hardlink_to",
        "home",
        "is_dir",
        "is_file",
        "iterdir",
        "lstat",
        "mkdir",
        "open",
        "read_bytes",
        "read_text",
        "rename",
        "replace",
        "resolve",
        "rglob",
        "rmdir",
        "stat",
        "symlink_to",
        "touch",
        "unlink",
        "utcnow",
        "walk",
        "write_bytes",
        "write_text",
    }
)
EXPECTED_PUBLIC_API = (
    "AcceptanceState",
    "ArtifactPinV1",
    "ArtifactRole",
    "DecisionState",
    "PacketRole",
    "PinnedDocumentV1",
    "adapt_smeta1_n3_bridge",
    "bridge_to_canonical_bytes",
    "decision_to_canonical_bytes",
    "evaluate_intake",
    "render_bridge_fable5",
    "render_fable5",
)


def _source_paths() -> tuple[Path, ...]:
    paths = tuple(sorted(SOURCE_ROOT.glob("*.py")))
    assert paths
    return paths


def _import_roots(tree: ast.AST) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", maxsplit=1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            roots.add(node.module.split(".", maxsplit=1)[0])
    return roots


def test_n3_sources_have_no_ambient_effect_authority() -> None:
    for path in _source_paths():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        forbidden_imports = _import_roots(tree) & FORBIDDEN_IMPORT_ROOTS
        assert not forbidden_imports, f"{path.name}: forbidden imports {forbidden_imports}"

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "pathlib":
                assert {alias.name for alias in node.names} <= {"PurePosixPath"}, (
                    f"{path.name}: only lexical PurePosixPath is allowed"
                )
            elif isinstance(node, ast.Import) and any(
                alias.name == "pathlib" for alias in node.names
            ):
                raise AssertionError(f"{path.name}: module-level pathlib access is forbidden")

            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    assert node.func.id not in FORBIDDEN_DIRECT_CALLS, (
                        f"{path.name}: forbidden dynamic/effect call {node.func.id}"
                    )
                elif isinstance(node.func, ast.Attribute):
                    assert node.func.attr not in FORBIDDEN_EFFECT_CALLS, (
                        f"{path.name}: forbidden ambient effect call .{node.func.attr}"
                    )

            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                assert not (node.value.id == "os" and node.attr in {"environ", "getenv"}), (
                    f"{path.name}: ambient environment access is forbidden"
                )


def test_n3_package_import_is_inert_and_silent() -> None:
    completed = subprocess.run(
        [sys.executable, "-c", "import quant_edge.n3_intake"],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert completed.returncode == 0
    assert completed.stdout == ""
    assert completed.stderr == ""


def test_n3_public_api_is_exact_and_excludes_constructible_decisions() -> None:
    assert tuple(n3_intake.__all__) == EXPECTED_PUBLIC_API
    assert "IntakeDecisionV1" not in n3_intake.__all__
    assert "CandidateAssessmentV1" not in n3_intake.__all__
    assert "aggregate_decision" not in n3_intake.__all__
    assert "_aggregate_results" not in n3_intake.__all__


def test_accepted_native_bridge_does_not_call_the_synthetic_evaluator() -> None:
    source = (SOURCE_ROOT / "bridge.py").read_text(encoding="utf-8")

    assert "adapt_result" not in source
    assert "evaluate_intake" not in source
    assert "S1C_N3_RESULT_V1" not in source
