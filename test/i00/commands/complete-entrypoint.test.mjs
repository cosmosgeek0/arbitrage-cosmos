import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENTRYPOINT = resolve(ROOT, 'test/i00/complete-acceptance.mjs');

function invoke(args, extraEnvironment = {}) {
  return spawnSync(process.execPath, [ENTRYPOINT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      PATH: `${resolve(process.execPath, '..')}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: '/',
      TMPDIR: '/tmp',
      TZ: 'UTC',
      LC_ALL: 'C',
      CI: '1',
      ...extraEnvironment,
    },
  });
}

function executableFixture(root, name = process.platform === 'win32' ? 'uv.exe' : 'uv') {
  const executable = resolve(root, name);
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  return executable;
}

test('complete entrypoint delegates plan-only without running acceptance', () => {
  const result = invoke(['--plan']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'PLAN_ONLY');
  assert.equal(plan.externalActions, 'NONE');
  assert.ok(plan.requires.includes('explicit --uv <absolute-path-to-uv> for --run'));
  const ids = plan.steps.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === 'root_test').length, 1);
  assert.equal(ids.filter((id) => id === 'repository_test_all').length, 1);
  assert.equal(ids.filter((id) => id === 'ops_all_local').length, 1);
  assert.equal(ids.filter((id) => id === 'ops_i00_all_local').length, 1);
  assert.equal(ids.filter((id) => id === 'q_current_gate').length, 1);
  assert.equal(ids.includes('q_exact_donor_q17'), false);
  assert.equal(ids.includes('q_exact_donor_all'), false);
  const qCurrent = plan.steps.find((step) => step.id === 'q_current_gate');
  assert.equal(qCurrent.kind, 'Q_CURRENT');
  assert.deepEqual(qCurrent.command, ['node', 'test/run-quant-gates.mjs']);

  const commands = plan.steps.map((step) => step.command.join(' '));
  for (const duplicate of [
    'npm run typecheck',
    'npm run build',
    'npm run test:protocol',
    'npm run test:integration:scenarios',
    'npm run test:product-assurance',
    'npm run test:i00:proof',
  ]) {
    assert.equal(commands.includes(duplicate), false, duplicate);
  }
});

test('complete entrypoint defaults to plan-only and never starts acceptance without explicit run intent', () => {
  const result = invoke([]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'PLAN_ONLY');
  assert.equal(plan.externalActions, 'NONE');
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /(?:^|\s)(?:npm test|npm run test:all|pytest|bash ops\/tests\/|LOCAL_PROXY_SOAK_FAILED)(?:\s|$)/,
  );
});

test('complete entrypoint validates explicit uv only in run mode', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'i00-entry-uv-plan-'));
  try {
    const result = invoke(['--plan', `--uv=${resolve(temp, 'absent')}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).mode, 'PLAN_ONLY');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('complete entrypoint rejects conflicting modes before delegation', () => {
  const result = invoke(['--plan', '--validate-only']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXACTLY_ONE_MODE_REQUIRED/);
  assert.equal(result.stdout, '');
});

test('validate-only with missing receipts fails quickly and never starts suites', () => {
  const result = invoke(['--validate-only']);
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /(?:^|\s)npm test(?:\s|$)|test:all|pytest|ops\/tests\/run-all/);
});

test('complete entrypoint run mode rejects missing explicit uv without ambient fallback', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'i00-entry-uv-missing-'));
  try {
    const ambientUv = executableFixture(temp);
    const result = invoke(['--run'], { UV_BIN: ambientUv });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /UV/u);
    assert.doesNotMatch(result.stderr, /Q_VENV_REQUIRED|BROWSER_RECEIPT_REQUIRED/u);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('complete entrypoint run mode rejects an invalid explicit uv without ambient fallback', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'i00-entry-uv-invalid-'));
  try {
    const ambientUv = executableFixture(temp, 'ambient-uv');
    const invalidUv = resolve(temp, 'absent', process.platform === 'win32' ? 'uv.exe' : 'uv');
    const result = invoke(['--run', `--uv=${invalidUv}`], { UV_BIN: ambientUv });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /UV/u);
    assert.doesNotMatch(result.stderr, /Q_VENV_REQUIRED|BROWSER_RECEIPT_REQUIRED/u);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('complete entrypoint passes an accepted explicit uv to the run delegate', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'i00-entry-uv-pass-'));
  try {
    const explicitUv = executableFixture(temp);
    const result = invoke(['--run', '--uv', explicitUv]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Q_VENV_REQUIRED/u);
    assert.doesNotMatch(result.stderr, /UV_(?:INPUT|EXECUTABLE|PATH).*(?:INVALID|REQUIRED)/u);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('complete entrypoint is delegation-only and shell-free', () => {
  const source = readFileSync(ENTRYPOINT, 'utf8');
  assert.match(source, /performance\/local-acceptance\.mjs/);
  assert.match(source, /shell:\s*false/);
  assert.match(source, /validateUvExecutableInput\(explicitOptionValue\(supplied, 'uv'\)\)/);
  assert.match(source, /prependUvToPath\(SEALED_ENVIRONMENT, uv\.executablePath\)/);
  assert.doesNotMatch(source, /process\.env\.UV_BIN|userInfo|homedir|localUvExecutable/u);
  for (const forbidden of [
    'npm test', 'test:all', 'pytest', 'ops/tests/run-all.sh',
    'ops/tests/i00/run-all.sh', 'local-proxy-soak.mjs',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
