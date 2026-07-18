#!/usr/bin/env node
import {
  X_OK,
  accessSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUANT_PYTEST_SELECTORS,
  QUANT_RESEARCH_COMMANDS,
  resolveQuantCommand,
  validatePytestReport,
} from './quant-command-contract.mjs';
import { spawnRunnerChild, superviseRunnerChild } from './runner-process-tree.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const QUANT = path.join(ROOT, 'quant');
const VENV = path.join(QUANT, '.venv');
const BIN = process.platform === 'win32' ? path.join(VENV, 'Scripts') : path.join(VENV, 'bin');
const PYTHON = path.join(BIN, process.platform === 'win32' ? 'python.exe' : 'python');
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const EXPECTED_PYTEST_FILES = 158;
const EXPECTED_PYTEST_TESTS = 3_063;

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

function discoverPythonFiles() {
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith('.py')) {
        found.push(path.relative(QUANT, candidate).split(path.sep).join('/'));
      }
    }
  };
  for (const directory of ['src', 'tests', 'scripts']) visit(path.join(QUANT, directory));
  return found.sort();
}

function expandPytestSelectors(selectors) {
  const expanded = [];
  for (const selector of selectors) {
    const normalized = selector.split('/').join(path.sep);
    const absolute = path.resolve(QUANT, normalized);
    if (absolute !== QUANT && !absolute.startsWith(`${QUANT}${path.sep}`)) {
      throw new TypeError(`QUANT_PYTEST_SELECTOR_OUTSIDE_ROOT:${selector}`);
    }
    if (!selector.includes('*')) {
      if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) {
        throw new TypeError(`QUANT_PYTEST_SELECTOR_INVALID:${selector}`);
      }
      expanded.push(selector);
      continue;
    }
    const directory = path.posix.dirname(selector);
    const basename = path.posix.basename(selector);
    if (basename.indexOf('*') !== basename.lastIndexOf('*') || basename.includes('?')) {
      throw new TypeError(`QUANT_PYTEST_SELECTOR_GLOB_INVALID:${selector}`);
    }
    const escaped = basename
      .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
      .replace('*', '.*');
    const pattern = new RegExp(`^${escaped}$`, 'u');
    const matched = readdirSync(path.join(QUANT, directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => `${directory}/${entry.name}`)
      .sort();
    if (matched.length === 0) throw new TypeError(`QUANT_PYTEST_SELECTOR_EMPTY:${selector}`);
    expanded.push(...matched);
  }
  if (new Set(expanded).size !== expanded.length) throw new TypeError('QUANT_PYTEST_SELECTOR_DUPLICATE');
  return expanded;
}

function recursiveRelativeFiles(root) {
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) found.push(path.relative(root, candidate).split(path.sep).join('/'));
      else throw new TypeError(`QUANT_RESEARCH_OUTPUT_TYPE_INVALID:${entry.name}`);
    }
  };
  visit(root);
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

let mode;
try {
  mode = resolveQuantCommand(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

const failures = [];
const env = quantEnvironment();

function succeeded(result) {
  return result.spawnError === null && !result.timedOut && result.code === 0 && result.signal === null;
}

function echoCaptured(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

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

async function runCommandContract() {
  await step('quant-command-contract', process.execPath, [
    '--test', '--test-concurrency=1', '../test/quant-command-surface.test.mjs',
  ], { timeoutMs: 30_000 });
}

async function runPythonPreflight() {
  await step('python-version', PYTHON, ['--version'], { timeoutMs: 30_000 });
  await step('locked-model-imports', PYTHON, [
    '-I', '-c',
    'import optuna, sklearn, xgboost; print(f"optuna={optuna.__version__} sklearn={sklearn.__version__} xgboost={xgboost.__version__}")',
  ], { timeoutMs: 30_000 });
  await step('pip-check', PYTHON, ['-I', '-m', 'pip', 'check'], { timeoutMs: 60_000 });
}

async function runUvChecks() {
  const uv = findUv();
  if (uv === null) {
    failures.push('uv-lock:UV_EXECUTABLE_MISSING:set UV_BIN or add uv to PATH');
    return;
  }
  await step('uv-lock-check', uv, ['lock', '--check', '--offline'], { timeoutMs: 60_000 });
  await step('uv-all-extras-synchronized', uv, [
    'sync', '--locked', '--all-groups', '--all-extras', '--check', '--offline',
  ], { timeoutMs: 120_000 });
}

async function runPytestInventory() {
  const discoveredPytestFiles = discoverPytestFiles();
  const git = findOnPath(process.platform === 'win32' ? 'git.exe' : 'git');
  if (git === null) {
    failures.push('pytest-inventory:GIT_EXECUTABLE_MISSING');
    return;
  }
  const trackedInventory = await step('tracked-pytest-inventory', git, [
    'ls-files', '-z', '--', 'tests/**/test_*.py', 'tests/test_*.py',
  ], { timeoutMs: 30_000, capture: true });
  if (!succeeded(trackedInventory)) return;
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

async function runLint() {
  const initialFailures = failures.length;
  const pythonFiles = discoverPythonFiles();
  await step('ruff-check', path.join(BIN, process.platform === 'win32' ? 'ruff.exe' : 'ruff'), [
    'check', 'src', 'tests', 'scripts',
  ], { timeoutMs: 120_000 });
  await step('ruff-format-check', path.join(BIN, process.platform === 'win32' ? 'ruff.exe' : 'ruff'), [
    'format', '--check', 'src', 'tests', 'scripts',
  ], { timeoutMs: 120_000 });
  if (failures.length === initialFailures) {
    process.stdout.write(`QUANT_RECEIPT command=lint files=${pythonFiles.length} checks=2\n`);
  }
}

async function runTypecheck() {
  const initialFailures = failures.length;
  const pythonFiles = discoverPythonFiles();
  await step('mypy-strict', path.join(BIN, process.platform === 'win32' ? 'mypy.exe' : 'mypy'), [
    '--strict', 'src', 'tests', 'scripts',
  ], { timeoutMs: 300_000 });
  if (failures.length === initialFailures) {
    process.stdout.write(`QUANT_RECEIPT command=typecheck files=${pythonFiles.length} checks=1\n`);
  }
}

const JUNIT_ANALYSIS_SOURCE = String.raw`
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

async function runPytestMode(command, selectors, { expectedTests = null } = {}) {
  const initialFailures = failures.length;
  let selected;
  try {
    selected = expandPytestSelectors(selectors);
  } catch (error) {
    failures.push(`${command}:${error.message}`);
    return null;
  }
  const junitDirectory = mkdtempSync(path.join(tmpdir(), 'cosmos-quant-junit-'));
  const junitPath = path.join(junitDirectory, 'pytest.xml');
  try {
    await step(command, PYTHON, [
      '-m', 'pytest', '-q', '--hypothesis-seed=20260712', `--junitxml=${junitPath}`, ...selected,
    ], { timeoutMs: 900_000 });
    if (!existsSync(junitPath)) {
      failures.push(`${command}:JUNIT_REPORT_MISSING`);
      return null;
    }
    const analyzed = await run(PYTHON, ['-I', '-c', JUNIT_ANALYSIS_SOURCE, junitPath], {
      env,
      timeoutMs: 30_000,
      capture: true,
    });
    if (!succeeded(analyzed)) {
      failures.push(`${command}:JUNIT_ANALYSIS_FAILED:${analyzed.stderr.trim()}`);
      return null;
    }
    let report;
    let totals;
    try {
      report = JSON.parse(analyzed.stdout);
      const allowScopeSkips = command === 'canonical' || command === 'test:all';
      totals = validatePytestReport(report, {
        allowedSkips: allowScopeSkips ? ALLOWED_SKIPS : new Map(),
        requireEveryAllowedSkip: allowScopeSkips,
      });
    } catch (error) {
      failures.push(`${command}:${error.message}`);
      return null;
    }
    if (expectedTests !== null && totals.tests !== expectedTests) {
      failures.push(`${command}:TEST_COUNT=${totals.tests}:EXPECTED_${expectedTests}`);
    }
    for (const skipped of report.skips) {
      process.stdout.write(`QUANT_ALLOWED_SKIP ${skipped.nodeid}: ${ALLOWED_SKIPS.get(skipped.nodeid)}\n`);
    }
    process.stdout.write(
      `QUANT_RECEIPT command=${command} tests=${totals.tests} passed=${totals.passed} ` +
      `failures=${totals.failures} errors=${totals.errors} skipped=${totals.skipped}\n`,
    );
    return failures.length === initialFailures ? totals : null;
  } finally {
    rmSync(junitDirectory, { recursive: true, force: true });
  }
}

async function runRegistry(command = 'registry:verify') {
  const initialFailures = failures.length;
  const result = await step(command, path.join(BIN, process.platform === 'win32' ? 'quant-edge.exe' : 'quant-edge'), [
    'registry-verify', '--registry', 'registry/edge_hypotheses.v1.json', '--map', 'EDGE_HYPOTHESIS_MAP.md',
  ], { timeoutMs: 60_000, capture: true });
  echoCaptured(result);
  if (!succeeded(result)) return;
  try {
    const receipt = JSON.parse(result.stdout);
    if (!Number.isSafeInteger(receipt.familyCount) || receipt.familyCount <= 0
      || receipt.statusCounts === null || typeof receipt.statusCounts !== 'object') {
      throw new TypeError('QUANT_REGISTRY_RECEIPT_INVALID');
    }
    const statusTotal = Object.values(receipt.statusCounts).reduce((sum, value) => {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('QUANT_REGISTRY_STATUS_INVALID');
      return sum + value;
    }, 0);
    if (statusTotal !== receipt.familyCount) throw new TypeError('QUANT_REGISTRY_TOTAL_INCOHERENT');
    if (failures.length === initialFailures) {
      process.stdout.write(`QUANT_RECEIPT command=${command} families=${receipt.familyCount}\n`);
    }
  } catch (error) {
    failures.push(`${command}:${error.message}`);
  }
}

async function runProtocol(command = 'protocol:verify') {
  const initialFailures = failures.length;
  const result = await step(command, path.join(BIN, process.platform === 'win32' ? 'quant-edge.exe' : 'quant-edge'), [
    'protocol-verify', '--repo-root', '..', '--timeout-seconds', '30',
  ], { timeoutMs: 60_000, capture: true });
  echoCaptured(result);
  if (!succeeded(result)) return;
  const match = /(?:^|\n)(\d+)\/(\d+) protocol checks passed(?:\n|$)/u.exec(result.stdout);
  if (match === null || Number(match[1]) <= 0 || match[1] !== match[2]) {
    failures.push(`${command}:QUANT_PROTOCOL_RECEIPT_INVALID`);
  } else if (failures.length === initialFailures) {
    process.stdout.write(`QUANT_RECEIPT command=${command} checks=${match[1]} passed=${match[2]}\n`);
  }
}

async function runResearch(command) {
  const initialFailures = failures.length;
  const specification = QUANT_RESEARCH_COMMANDS[command];
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cosmos-quant-research-'));
  const outputRoots = [path.join(temporaryRoot, 'pass-1'), path.join(temporaryRoot, 'pass-2')];
  try {
    for (const [index, outputRoot] of outputRoots.entries()) {
      await step(`${command}:generator-pass-${index + 1}`, PYTHON, [specification.program, outputRoot], {
        env: { ...env, PYTHONPATH: path.join(QUANT, 'src') },
        timeoutMs: 300_000,
      });
    }
    const expectedArtifacts = [...specification.artifacts].sort();
    for (const [index, outputRoot] of outputRoots.entries()) {
      try {
        const observedArtifacts = recursiveRelativeFiles(outputRoot);
        if (JSON.stringify(observedArtifacts) !== JSON.stringify(expectedArtifacts)) {
          failures.push(`${command}:GENERATOR_PASS_${index + 1}_INVENTORY_MISMATCH`);
          continue;
        }
        for (const artifact of expectedArtifacts) {
          const generatedPath = path.join(outputRoot, artifact);
          const acceptedPath = path.join(QUANT, artifact);
          const generatedInfo = lstatSync(generatedPath);
          const acceptedInfo = lstatSync(acceptedPath);
          if (!generatedInfo.isFile() || generatedInfo.nlink !== 1 || !acceptedInfo.isFile()) {
            failures.push(`${command}:ARTIFACT_TYPE_INVALID:${artifact}`);
          } else if (!readFileSync(generatedPath).equals(readFileSync(acceptedPath))) {
            failures.push(`${command}:ACCEPTED_BYTES_MISMATCH:${artifact}:PASS_${index + 1}`);
          }
        }
      } catch (error) {
        failures.push(`${command}:GENERATOR_PASS_${index + 1}_INVALID:${error.message}`);
      }
    }
    for (const artifact of expectedArtifacts) {
      try {
        if (!readFileSync(path.join(outputRoots[0], artifact)).equals(
          readFileSync(path.join(outputRoots[1], artifact)),
        )) failures.push(`${command}:GENERATOR_NOT_IDEMPOTENT:${artifact}`);
      } catch (error) {
        failures.push(`${command}:IDEMPOTENCE_READ_FAILED:${artifact}:${error.message}`);
      }
    }
    if (failures.length === initialFailures) {
      process.stdout.write(
        `QUANT_RECEIPT command=${command} artifacts=${expectedArtifacts.length} ` +
        `generatorPasses=2 currentByteMatches=${expectedArtifacts.length * 2} ` +
        `idempotentByteMatches=${expectedArtifacts.length}\n`,
      );
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function runScopeGuard() {
  if (process.platform === 'win32') {
    failures.push('q00-scope-guard:BASH_UNAVAILABLE_ON_WINDOWS');
  } else {
    await step('q00-scope-guard', '/bin/bash', ['tests/q00/scope_guard.test.sh'], { timeoutMs: 60_000 });
  }
}

if (mode === 'canonical') {
  await runCommandContract();
  if (!existsSync(PYTHON)) {
    failures.push(`quant-venv:QUANT_VENV_PYTHON_MISSING:${path.relative(ROOT, PYTHON)}`);
  } else {
    await runPythonPreflight();
  }
  await runUvChecks();
  if (existsSync(PYTHON)) {
    await runPytestInventory();
    await runLint();
    await runTypecheck();
    await runPytestMode('canonical', QUANT_PYTEST_SELECTORS['test:all'], {
      expectedTests: EXPECTED_PYTEST_TESTS,
    });
    await runRegistry();
    await runProtocol();
  }
  await runScopeGuard();
} else if (!existsSync(PYTHON)) {
  failures.push(`quant-venv:QUANT_VENV_PYTHON_MISSING:${path.relative(ROOT, PYTHON)}`);
} else if (mode === 'lint') {
  await runLint();
} else if (mode === 'typecheck') {
  await runTypecheck();
} else if (Object.hasOwn(QUANT_PYTEST_SELECTORS, mode)) {
  await runPytestMode(mode, QUANT_PYTEST_SELECTORS[mode]);
} else if (Object.hasOwn(QUANT_RESEARCH_COMMANDS, mode)) {
  await runResearch(mode);
} else if (mode === 'registry:verify') {
  await runRegistry();
} else if (mode === 'protocol:verify') {
  await runProtocol();
}

if (failures.length > 0) {
  const prefix = mode === 'canonical' ? 'QUANT_CANONICAL_FAILURES' : 'QUANT_COMMAND_FAILURES';
  process.stderr.write(`\n${prefix} command=${mode} count=${failures.length}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else if (mode === 'canonical') {
  process.stdout.write('\nQUANT_CANONICAL_GATE PASS\n');
} else {
  process.stdout.write(`\nQUANT_COMMAND_GATE PASS command=${mode}\n`);
}
