#!/usr/bin/env node
import {
  X_OK,
  accessSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnRunnerChild, superviseRunnerChild } from './runner-process-tree.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const QUANT = path.join(ROOT, 'quant');
const VENV = path.join(QUANT, '.venv');
const BIN = process.platform === 'win32' ? path.join(VENV, 'Scripts') : path.join(VENV, 'bin');
const PYTHON = path.join(BIN, process.platform === 'win32' ? 'python.exe' : 'python');
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const EXPECTED_PYTEST_FILES = 163;
const EXPECTED_PYTEST_TESTS = 3_152;

const ALLOWED_SKIPS = new Map([
  [
    'tests/q08/test_q08_scope.py::test_the_shard_base_commit_is_an_ancestor',
    'the shard scope law is verifiable only inside the shard git worktree',
  ],
  [
    'tests/q08/test_q08_scope.py::test_every_commit_after_the_shard_base_stays_inside_the_allowlist',
    'the shard scope law is verifiable only inside the shard git worktree',
  ],
  [
    'tests/q08/test_q08_scope.py::test_frozen_paths_are_byte_identical_to_the_shard_base',
    'the shard scope law is verifiable only inside the shard git worktree',
  ],
  [
    'tests/q08/test_q08_scope.py::test_the_worktree_holds_no_staged_out_of_scope_change',
    'the shard scope law is verifiable only inside the shard git worktree',
  ],
  [
    'tests/q15/test_q15_scope.py::test_all_q15_changes_stay_inside_exclusive_write_set',
    'the shard scope law is verifiable only on the shard branch',
  ],
  [
    'tests/q15/test_q15_scope.py::test_branch_and_base_are_exact',
    'the shard scope law is verifiable only on the shard branch',
  ],
]);

function executable(candidate) {
  if (!candidate) return null;
  try {
    accessSync(candidate, X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = executable(path.join(directory, name));
    if (candidate !== null) return candidate;
  }
  return null;
}

function findUv() {
  return executable(process.env.UV_BIN)
    ?? findOnPath(process.platform === 'win32' ? 'uv.exe' : 'uv')
    ?? executable(path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'));
}

function discoverPytestFiles() {
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.startsWith('test_') && entry.name.endsWith('.py')) {
        found.push(path.relative(QUANT, candidate).split(path.sep).join('/'));
      }
    }
  };
  visit(path.join(QUANT, 'tests'));
  return found.sort();
}

function quantEnvironment() {
  const env = { ...process.env, PYTHONHASHSEED: '0' };
  delete env.PYTEST_DISABLE_PLUGIN_AUTOLOAD;
  if (process.platform === 'darwin') {
    const libRoot = path.join(VENV, 'lib');
    const pythonDirectory = existsSync(libRoot)
      ? readdirSync(libRoot).filter((name) => name.startsWith('python')).sort().at(-1)
      : undefined;
    if (pythonDirectory !== undefined) {
      const dylibs = path.join(libRoot, pythonDirectory, 'site-packages', 'sklearn', '.dylibs');
      if (existsSync(path.join(dylibs, 'libomp.dylib'))) {
        env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH
          ? `${dylibs}${path.delimiter}${env.DYLD_LIBRARY_PATH}`
          : dylibs;
      }
    }
  }
  return env;
}

function run(command, args, { env, timeoutMs, capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawnRunnerChild(command, args, {
      cwd: QUANT,
      env: env ?? process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    const deadline = superviseRunnerChild(child, timeoutMs ?? 120_000);
    if (capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString().slice(0, Math.max(0, MAX_CAPTURE_BYTES - stdout.length));
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString().slice(0, Math.max(0, MAX_CAPTURE_BYTES - stderr.length));
      });
    }
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (code, signal) => {
      deadline.finish();
      resolve({ code, signal, stdout, stderr, spawnError, timedOut: deadline.timedOut });
    });
  });
}

const failures = [];
const env = quantEnvironment();

async function step(label, command, args, options = {}) {
  process.stdout.write(`\nQuant gate: ${label}\n`);
  const result = await run(command, args, { env, ...options });
  if (result.spawnError !== null) failures.push(`${label}:SPAWN_ERROR:${result.spawnError.message}`);
  if (result.timedOut) failures.push(`${label}:TIMEOUT_MS:${options.timeoutMs ?? 120_000}`);
  if (result.code !== 0 || result.signal !== null) {
    failures.push(`${label}:EXIT_CODE=${String(result.code)}:SIGNAL=${String(result.signal)}`);
  }
  return result;
}

if (!existsSync(PYTHON)) {
  failures.push(`quant-venv:QUANT_VENV_PYTHON_MISSING:${path.relative(ROOT, PYTHON)}`);
} else {
  await step('python-version', PYTHON, ['--version'], { timeoutMs: 30_000 });
  await step('locked-model-imports', PYTHON, [
    '-I', '-c',
    'import optuna, sklearn, xgboost; print(f"optuna={optuna.__version__} sklearn={sklearn.__version__} xgboost={xgboost.__version__}")',
  ], { timeoutMs: 30_000 });
  await step('pip-check', PYTHON, ['-I', '-m', 'pip', 'check'], { timeoutMs: 60_000 });
}

const uv = findUv();
if (uv === null) {
  failures.push('uv-lock:UV_EXECUTABLE_MISSING:set UV_BIN or add uv to PATH');
} else {
  await step('uv-lock-check', uv, ['lock', '--check', '--offline'], { timeoutMs: 60_000 });
  await step('uv-all-extras-synchronized', uv, [
    'sync', '--locked', '--all-groups', '--all-extras', '--check', '--offline',
  ], { timeoutMs: 120_000 });
}

if (existsSync(PYTHON)) {
  const discoveredPytestFiles = discoverPytestFiles();
  const git = findOnPath(process.platform === 'win32' ? 'git.exe' : 'git');
  if (git === null) {
    failures.push('pytest-inventory:GIT_EXECUTABLE_MISSING');
  } else {
    const trackedInventory = await step('tracked-pytest-inventory', git, [
      'ls-files', '-z', '--', 'tests/**/test_*.py', 'tests/test_*.py',
    ], { timeoutMs: 30_000, capture: true });
    if (trackedInventory.code === 0 && trackedInventory.signal === null && trackedInventory.spawnError === null) {
      const trackedPytestFiles = trackedInventory.stdout.split('\0').filter(Boolean).sort();
      process.stdout.write(
        `QUANT_PYTEST_INVENTORY tracked=${trackedPytestFiles.length} discovered=${discoveredPytestFiles.length}\n`,
      );
      if (trackedPytestFiles.length !== EXPECTED_PYTEST_FILES) {
        failures.push(
          `pytest-inventory:TRACKED_FILE_COUNT=${trackedPytestFiles.length}:EXPECTED_${EXPECTED_PYTEST_FILES}`,
        );
      }
      if (JSON.stringify(trackedPytestFiles) !== JSON.stringify(discoveredPytestFiles)) {
        failures.push('pytest-inventory:TRACKED_AND_DISCOVERED_FILES_DIFFER');
      }
    }
  }

  await step('ruff-check', path.join(BIN, process.platform === 'win32' ? 'ruff.exe' : 'ruff'), [
    'check', 'src', 'tests', 'scripts',
  ], { timeoutMs: 120_000 });
  await step('ruff-format-check', path.join(BIN, process.platform === 'win32' ? 'ruff.exe' : 'ruff'), [
    'format', '--check', 'src', 'tests', 'scripts',
  ], { timeoutMs: 120_000 });
  await step('mypy-strict', path.join(BIN, process.platform === 'win32' ? 'mypy.exe' : 'mypy'), [
    '--strict', 'src', 'tests', 'scripts',
  ], { timeoutMs: 300_000 });

  const junitDirectory = mkdtempSync(path.join(tmpdir(), 'cosmos-quant-junit-'));
  const junitPath = path.join(junitDirectory, 'pytest.xml');
  try {
    await step('pytest', PYTHON, [
      '-m', 'pytest', '-q', '--hypothesis-seed=20260712', `--junitxml=${junitPath}`,
    ], { timeoutMs: 900_000 });

    if (!existsSync(junitPath)) {
      failures.push('pytest-summary:JUNIT_REPORT_MISSING');
    } else {
      const analysisSource = String.raw`
import json
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
totals = {name: sum(int(s.attrib.get(name, "0")) for s in suites) for name in ("tests", "failures", "errors", "skipped")}
skips = []
for case in root.iter("testcase"):
    skipped = case.find("skipped")
    if skipped is None:
        continue
    classname = case.attrib.get("classname", "").replace(".", "/")
    nodeid = f"{classname}.py::{case.attrib.get('name', '')}"
    message = " ".join(filter(None, (skipped.attrib.get("message"), skipped.text))).strip()
    skips.append({"nodeid": nodeid, "message": message})
totals["passed"] = totals["tests"] - totals["failures"] - totals["errors"] - totals["skipped"]
print(json.dumps({"totals": totals, "skips": skips}, sort_keys=True))
`;
      const analyzed = await run(PYTHON, ['-I', '-c', analysisSource, junitPath], {
        env,
        timeoutMs: 30_000,
        capture: true,
      });
      if (analyzed.code !== 0 || analyzed.signal !== null || analyzed.spawnError !== null) {
        failures.push(`pytest-summary:ANALYSIS_FAILED:${analyzed.stderr.trim()}`);
      } else {
        try {
          const report = JSON.parse(analyzed.stdout);
          const totals = report.totals;
          process.stdout.write(
            `QUANT_PYTEST_TOTALS tests=${totals.tests} passed=${totals.passed} failures=${totals.failures} ` +
            `errors=${totals.errors} skipped=${totals.skipped}\n`,
          );
          if (totals.tests !== EXPECTED_PYTEST_TESTS) {
            failures.push(`pytest-summary:TEST_COUNT=${totals.tests}:EXPECTED_${EXPECTED_PYTEST_TESTS}`);
          }
          const observedSkips = new Set();
          for (const skipped of report.skips) {
            const expectedReason = ALLOWED_SKIPS.get(skipped.nodeid);
            if (expectedReason === undefined || !skipped.message.includes(expectedReason)) {
              failures.push(`pytest-unexpected-skip:${skipped.nodeid}:${skipped.message}`);
            } else {
              observedSkips.add(skipped.nodeid);
              process.stdout.write(`QUANT_ALLOWED_SKIP ${skipped.nodeid}: ${expectedReason}\n`);
            }
          }
          for (const expectedSkip of ALLOWED_SKIPS.keys()) {
            if (!observedSkips.has(expectedSkip)) {
              failures.push(`pytest-expected-skip-missing:${expectedSkip}`);
            }
          }
        } catch (error) {
          failures.push(`pytest-summary:INVALID_ANALYSIS_JSON:${error.message}`);
        }
      }
    }
  } finally {
    rmSync(junitDirectory, { recursive: true, force: true });
  }

  await step('registry-verify', path.join(BIN, process.platform === 'win32' ? 'quant-edge.exe' : 'quant-edge'), [
    'registry-verify', '--registry', 'registry/edge_hypotheses.v1.json', '--map', 'EDGE_HYPOTHESIS_MAP.md',
  ], { timeoutMs: 60_000 });
  await step('protocol-verify', path.join(BIN, process.platform === 'win32' ? 'quant-edge.exe' : 'quant-edge'), [
    'protocol-verify', '--repo-root', '..', '--timeout-seconds', '30',
  ], { timeoutMs: 60_000 });
}

if (process.platform === 'win32') {
  failures.push('q00-scope-guard:BASH_UNAVAILABLE_ON_WINDOWS');
} else {
  await step('q00-scope-guard', '/bin/bash', ['tests/q00/scope_guard.test.sh'], { timeoutMs: 60_000 });
}

if (failures.length > 0) {
  process.stderr.write(`\nQUANT_CANONICAL_FAILURES count=${failures.length}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nQUANT_CANONICAL_GATE PASS\n');
}
