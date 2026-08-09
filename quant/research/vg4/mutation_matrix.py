from __future__ import annotations

import ast
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

worktree = Path("/Users/cosmosgeek/.codex/worktrees/c11-72-kline-zip-ingestion")
source_path = worktree / "quant/research/vg4/experiment.py"
test_path = worktree / "quant/research/vg4/test_experiment.py"
init_path = worktree / "quant/research/vg4/__init__.py"
python = "/Users/cosmosgeek/Desktop/Main/quant/.venv/bin/python"
source = source_path.read_text(encoding="utf-8")
tree = ast.parse(source)
if_nodes = [node for node in ast.walk(tree) if isinstance(node, ast.If)]

marker_specs = [
    ("decimalDomain", "outside archive decimal grammar or its domain"),
    ("checksumGrammar", "checksum has an invalid grammar"),
    ("checksumName", "checksum names a different object"),
    ("checksumLaw", "does not match its official checksum"),
    ("timestampFloor", "not a post-2025 microsecond timestamp"),
    ("zipFrozenDigest", "sha256_path(zip_path)"),
    ("checksumFrozenDigest", "sha256_path(checksum_path)"),
    ("zipSize", "exceeds the frozen parser bound"),
    ("memberCardinality", "must contain exactly one regular member"),
    ("memberIdentity", "member identity or size is invalid"),
    ("exactHeader", "KLINE_HEADER"),
    ("rowWidth", "does not have 12 kline fields"),
    ("utcDailyOpen", "not a UTC daily open"),
    ("closeBoundary", "close boundary is invalid"),
    ("archiveMonth", "lies outside its archive month"),
    ("tradeTakerDomain", "invalid trade or taker-volume fields"),
    ("positivePrice", "has a non-positive price"),
    ("ohlcGeometry", "violates OHLC geometry"),
    ("rowCount", "daily row count is outside 1..31"),
    ("uniqueDayOrder", "daily rows are duplicate or unsorted"),
]

selected: list[tuple[str, ast.If]] = []
for name, marker in marker_specs:
    matches: list[ast.If] = []
    for node in if_nodes:
        node_text = ast.get_source_segment(source, node) or ""
        test_text = ast.get_source_segment(source, node.test) or ""
        haystack = test_text if name in {"zipFrozenDigest", "checksumFrozenDigest"} else node_text
        if marker in haystack:
            matches.append(node)
    if len(matches) != 1:
        raise SystemExit(f"MUTATION_HARNESS_TARGET_ERROR {name} matches={len(matches)}")
    selected.append((name, matches[0]))

line_offsets = [0]
for line in source.splitlines(keepends=True):
    line_offsets.append(line_offsets[-1] + len(line))

killed: list[str] = []
survived: list[str] = []
harness_errors: list[str] = []
for index, (name, node) in enumerate(selected, start=1):
    test = node.test
    start = line_offsets[test.lineno - 1] + test.col_offset
    end = line_offsets[test.end_lineno - 1] + test.end_col_offset
    mutated = source[:start] + "False" + source[end:]
    try:
        ast.parse(mutated)
    except SyntaxError:
        harness_errors.append(name)
        print(f"MUTANT {index:02d}/20 {name} HARNESS_ERROR syntax")
        continue

    with tempfile.TemporaryDirectory(prefix=f"vg4-{name}-") as temporary:
        root = Path(temporary)
        package = root / "research/vg4"
        package.mkdir(parents=True)
        (package / "experiment.py").write_text(mutated, encoding="utf-8")
        shutil.copy2(test_path, package / "test_experiment.py")
        shutil.copy2(init_path, package / "__init__.py")
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(root)
        try:
            completed = subprocess.run(
                [python, "-m", "pytest", "-q", str(package / "test_experiment.py")],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired:
            harness_errors.append(name)
            print(f"MUTANT {index:02d}/20 {name} HARNESS_ERROR timeout")
            continue

    if completed.returncode == 1:
        killed.append(name)
        print(f"MUTANT {index:02d}/20 {name} KILLED exit=1")
    elif completed.returncode == 0:
        survived.append(name)
        print(f"MUTANT {index:02d}/20 {name} SURVIVED exit=0")
    else:
        harness_errors.append(name)
        tail = (completed.stdout + completed.stderr).strip().splitlines()[-1:]
        print(
            f"MUTANT {index:02d}/20 {name} HARNESS_ERROR "
            f"exit={completed.returncode} tail={tail}"
        )

print(
    "MUTATION_EVIDENCE "
    f"named={len(selected)} killed={len(killed)} survived={len(survived)} "
    f"harness_errors={len(harness_errors)}"
)
if survived:
    print("SURVIVORS " + ",".join(survived))
if harness_errors:
    print("HARNESS_ERRORS " + ",".join(harness_errors))
raise SystemExit(0 if len(killed) == 20 and not survived and not harness_errors else 1)
