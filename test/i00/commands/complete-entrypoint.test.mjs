import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENTRYPOINT = resolve(ROOT, 'test/i00/complete-acceptance.mjs');

function invoke(args) {
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
    },
  });
}

test('complete entrypoint delegates plan-only without running acceptance', () => {
  const result = invoke(['--plan']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'PLAN_ONLY');
  assert.equal(plan.externalActions, 'NONE');
  const ids = plan.steps.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === 'root_test').length, 1);
  assert.equal(ids.filter((id) => id === 'repository_test_all').length, 1);
  assert.equal(ids.filter((id) => id === 'ops_all_local').length, 1);
  assert.equal(ids.filter((id) => id === 'ops_i00_all_local').length, 1);

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

test('complete entrypoint is delegation-only and shell-free', () => {
  const source = readFileSync(ENTRYPOINT, 'utf8');
  assert.match(source, /performance\/local-acceptance\.mjs/);
  assert.match(source, /shell:\s*false/);
  for (const forbidden of [
    'npm test', 'test:all', 'pytest', 'ops/tests/run-all.sh',
    'ops/tests/i00/run-all.sh', 'local-proxy-soak.mjs',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
