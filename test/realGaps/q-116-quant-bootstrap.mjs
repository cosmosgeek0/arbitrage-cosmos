#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const QUANT = path.join(ROOT, 'quant');
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const BOOTSTRAP = path.join(ROOT, 'test', 'run-quant-bootstrap.mjs');
const README = readFileSync(path.join(QUANT, 'README.md'), 'utf8');
const CANONICAL_GATE = readFileSync(path.join(ROOT, 'test', 'run-quant-gates.mjs'), 'utf8');
const MODEL_TESTS = [
  'tests/contract/test_q10_golden.py',
  'tests/property/test_q10_model_laws.py',
  'tests/unit/test_q10_battery.py',
  'tests/unit/test_q10_engine.py',
  'tests/unit/test_q10_estimators.py',
  'tests/unit/test_q10_studies.py',
];
const EXPECTED_MODEL_TESTS = 41;
const EXPECTED_MODEL_CASES = 44;

function run(command, args, { cwd = ROOT, env = process.env, timeout = 600_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function requireSuccess(label, result) {
  assert.equal(result.error, undefined, `${label} spawn error: ${result.error?.message}`);
  assert.equal(result.signal, null, `${label} signal: ${result.signal}`);
  assert.equal(result.status, 0, `${label} exit: ${result.status}`);
}

function pythonBin(venv) {
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function modelEnvironment(venv) {
  const env = { ...process.env, PYTHONHASHSEED: '0' };
  delete env.PYTEST_DISABLE_PLUGIN_AUTOLOAD;
  if (process.platform === 'darwin') {
    const libRoot = path.join(venv, 'lib');
    const pythonDirectory = readdirSync(libRoot)
      .filter((name) => name.startsWith('python'))
      .sort()
      .at(-1);
    assert.notEqual(pythonDirectory, undefined, 'temporary venv Python library directory missing');
    const dylibs = path.join(libRoot, pythonDirectory, 'site-packages', 'sklearn', '.dylibs');
    env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH
      ? `${dylibs}${path.delimiter}${env.DYLD_LIBRARY_PATH}`
      : dylibs;
  }
  return env;
}

assert.equal(
  PACKAGE.scripts['bootstrap:quant:locked'],
  'node test/run-quant-bootstrap.mjs',
  'root package must expose the stable locked Quant bootstrap',
);
assert.match(README, /npm run bootstrap:quant:locked/u);
assert.match(README, /uv sync --locked --all-groups --all-extras --python 3\.13\.14/u);

const bootstrapSource = readFileSync(BOOTSTRAP, 'utf8');
for (const token of ["'--locked'", "'--all-groups'", "'--all-extras'", "'--python'"]) {
  assert.match(bootstrapSource, new RegExp(token, 'u'), `bootstrap missing ${token}`);
}
assert.match(CANONICAL_GATE, /const EXPECTED_PYTEST_TESTS = 3_063;/u);
assert.match(CANONICAL_GATE, /'sync', '--locked', '--all-groups', '--all-extras', '--check', '--offline'/u);
assert.match(CANONICAL_GATE, /import optuna, sklearn, xgboost/u);
assert.match(CANONICAL_GATE, /pytest-unexpected-skip/u);

const importOrSkipFiles = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(candidate);
    else if (entry.isFile() && entry.name.endsWith('.py')) {
      const source = readFileSync(candidate, 'utf8');
      if (source.includes('pytest.importorskip')) {
        importOrSkipFiles.push(path.relative(QUANT, candidate).split(path.sep).join('/'));
      }
    }
  }
};
visit(path.join(QUANT, 'tests'));
assert.deepEqual(importOrSkipFiles.sort(), MODEL_TESTS, 'all optional-model skip sites must stay explicit');
const declaredModelTests = MODEL_TESTS.reduce((count, relativePath) => {
  const source = readFileSync(path.join(QUANT, relativePath), 'utf8');
  return count + (source.match(/^def test_/gmu)?.length ?? 0);
}, 0);
assert.equal(declaredModelTests, EXPECTED_MODEL_TESTS, 'model test inventory changed');

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cosmos-q116-bootstrap-'));
const fakeUv = path.join(temporaryRoot, process.platform === 'win32' ? 'uv.cmd' : 'uv');
const fakeLog = path.join(temporaryRoot, 'fake-uv.log');
const venv = path.join(temporaryRoot, '.venv');
const junit = path.join(temporaryRoot, 'q10-models.xml');
try {
  if (process.platform !== 'win32') {
    writeFileSync(
      fakeUv,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$Q116_FAKE_LOG"\n' +
      'if [ "$1" = "python" ]; then exit "${Q116_FAKE_PYTHON_EXIT:-0}"; fi\n' +
      'exit "${Q116_FAKE_SYNC_EXIT:-0}"\n',
    );
    chmodSync(fakeUv, 0o700);
    const hostile = run(process.execPath, [BOOTSTRAP], {
      env: { ...process.env, UV_BIN: fakeUv, Q116_FAKE_LOG: fakeLog, Q116_FAKE_PYTHON_EXIT: '23' },
    });
    assert.equal(hostile.status, 23, 'bootstrap must preserve the first uv failure exit');
    assert.equal(
      readFileSync(fakeLog, 'utf8'),
      'python install 3.13.14\n',
      'bootstrap must stop before sync after interpreter failure',
    );

    writeFileSync(fakeLog, '');
    const syncFailure = run(process.execPath, [BOOTSTRAP], {
      env: { ...process.env, UV_BIN: fakeUv, Q116_FAKE_LOG: fakeLog, Q116_FAKE_SYNC_EXIT: '37' },
    });
    assert.equal(syncFailure.status, 37, 'bootstrap must preserve the dependency sync failure exit');
    assert.equal(
      readFileSync(fakeLog, 'utf8'),
      'python install 3.13.14\n' +
      'sync --project quant --locked --all-groups --all-extras --python 3.13.14\n',
      'bootstrap must invoke the exact locked all-extras sync contract',
    );
  }

  const bootstrap = run(process.execPath, [BOOTSTRAP], {
    env: {
      ...process.env,
      UV_OFFLINE: '1',
      UV_PYTHON_DOWNLOADS: 'never',
      UV_PYTHON_INSTALL_BIN: '0',
      UV_PROJECT_ENVIRONMENT: venv,
    },
  });
  requireSuccess('offline clean locked bootstrap', bootstrap);
  assert.match(bootstrap.stdout, /QUANT_LOCKED_BOOTSTRAP PASS/u);

  const python = pythonBin(venv);
  const env = modelEnvironment(venv);
  const imports = run(python, [
    '-I',
    '-c',
    'import optuna, sklearn, xgboost; print(f"{optuna.__version__}|{sklearn.__version__}|{xgboost.__version__}")',
  ], { cwd: QUANT, env, timeout: 60_000 });
  requireSuccess('pinned model imports', imports);
  assert.equal(imports.stdout.trim(), '4.9.0|1.9.0|3.3.0');

  const pytest = run(python, [
    '-I', '-m', 'pytest', '-q', '--hypothesis-seed=20260712', `--junitxml=${junit}`,
    ...MODEL_TESTS,
  ], { cwd: QUANT, env, timeout: 600_000 });
  requireSuccess('Q10 model tests', pytest);

  const analyze = run(python, [
    '-I',
    '-c',
    [
      'import json, sys, xml.etree.ElementTree as ET',
      'root = ET.parse(sys.argv[1]).getroot()',
      'suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))',
      'names = ("tests", "failures", "errors", "skipped")',
      'print(json.dumps({name: sum(int(s.attrib.get(name, "0")) for s in suites) for name in names}, sort_keys=True))',
    ].join('; '),
    junit,
  ], { cwd: QUANT, env, timeout: 30_000 });
  requireSuccess('Q10 JUnit analysis', analyze);
  const totals = JSON.parse(analyze.stdout);
  assert.deepEqual(
    totals,
    { errors: 0, failures: 0, skipped: 0, tests: EXPECTED_MODEL_CASES },
    'all 41 model test functions and their parameterized cases must execute without a skip',
  );
  process.stdout.write(
    `Q116_QUANT_BOOTSTRAP_PASS functions=${EXPECTED_MODEL_TESTS} cases=${EXPECTED_MODEL_CASES} ` +
    'skipped=0 versions=4.9.0,1.9.0,3.3.0\n',
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
