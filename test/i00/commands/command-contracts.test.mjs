import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const OWNER_GATED = resolve(ROOT, 'test/i00/owner-gated-command.mjs');
const OPS_COMMAND = resolve(ROOT, 'test/i00/ops-command.mjs');
const STATUS_SCHEMA = JSON.parse(readFileSync(resolve(import.meta.dirname, 'command-status.schema.v1.json'), 'utf8'));

function invoke(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: '/',
      FORBIDDEN_PRIVATE_SECRET: 'must-never-be-observed',
    },
  });
}

function jsonOutput(result) {
  const text = (result.stdout || result.stderr).trim();
  assert.notEqual(text, '');
  assert.doesNotMatch(text, /must-never-be-observed/);
  const document = JSON.parse(text);
  for (const required of STATUS_SCHEMA.required) assert.ok(Object.hasOwn(document, required), required);
  for (const key of Object.keys(document)) assert.ok(Object.hasOwn(STATUS_SCHEMA.properties, key), `unexpected status key ${key}`);
  assert.equal(document.schemaVersion, STATUS_SCHEMA.properties.schemaVersion.const);
  assert.ok(STATUS_SCHEMA.properties.status.enum.includes(document.status));
  assert.equal(document.mutationPerformed, false);
  return document;
}

test('private and signed commands are always data-only OWNER_GATED exit 2', () => {
  for (const [capability, reasonCode] of [
    ['PRIVATE_READ', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'],
    ['SIGNED_TEST', 'SIGNED_TEST_AUTHORIZATION_REQUIRED'],
  ]) {
    const result = invoke(OWNER_GATED, [capability]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(jsonOutput(result), {
      schemaVersion: 'i00.command-status.v1',
      status: 'OWNER_GATED',
      capability,
      reasonCode,
      mutationPerformed: false,
    });
  }
});

test('owner-gated dispatcher rejects every unsupported invocation without echoing input', () => {
  for (const args of [[], ['PRIVATE_READ', 'extra'], ['DEPLOYMENT'], ['must-never-be-observed']]) {
    const result = invoke(OWNER_GATED, args);
    assert.equal(result.status, 1);
    assert.equal(jsonOutput(result).status, 'BLOCKED');
  }
});

test('owner-gated dispatcher contains no environment, network, or subprocess access', () => {
  const source = readFileSync(OWNER_GATED, 'utf8');
  for (const forbidden of [
    'process.env', 'child_process', 'node:http', 'node:https', 'node:net',
    'node:tls', 'node:dns', 'fetch(', 'WebSocket',
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden owner-gated token ${forbidden}`);
  }
});

test('ops wrapper refuses missing or ambiguous safe inputs without execution', () => {
  const missing = invoke(OPS_COMMAND, ['backup']);
  assert.equal(missing.status, 2);
  assert.equal(jsonOutput(missing).reasonCode, 'EXPLICIT_SAFE_INPUTS_REQUIRED');

  const untrusted = invoke(OPS_COMMAND, ['release-preflight', '--release', '/tmp/release']);
  assert.equal(untrusted.status, 2);
  assert.equal(jsonOutput(untrusted).reasonCode, 'RELEASE_TRUST_INPUT_REQUIRED');

  const ambiguous = invoke(OPS_COMMAND, [
    'release-preflight', '--release', '/tmp/release', '--allow-simulation',
    '--trusted-build-public-key', '/tmp/public.pem',
  ]);
  assert.equal(ambiguous.status, 1);
  assert.equal(jsonOutput(ambiguous).reasonCode, 'AMBIGUOUS_RELEASE_TRUST_MODE');
});

test('backup and restore plans are simulation-only and use an allowlisted environment', () => {
  const cases = [
    [
      ['backup', '--config', '/tmp/i00.env', '--simulation-root', '/tmp/sim', '--donor-root', '/tmp/donor', '--plan'],
      'LOCAL_SIMULATION_BACKUP_ONLY',
    ],
    [
      [
        'restore-test', '--backup', '/tmp/backup', '--target', '/tmp/restore',
        '--config', '/tmp/i00.env', '--simulation-root', '/tmp/sim',
        '--donor-root', '/tmp/donor', '--plan',
      ],
      'ISOLATED_LOCAL_SIMULATION_RESTORE_ONLY',
    ],
  ];
  for (const [args, safetyClass] of cases) {
    const result = invoke(OPS_COMMAND, args);
    assert.equal(result.status, 0, result.stderr);
    const plan = jsonOutput(result);
    assert.equal(plan.status, 'PLAN_VALID_NO_EXECUTION');
    assert.equal(plan.safetyClass, safetyClass);
    assert.equal(plan.executable, '/bin/bash');
    assert.ok(plan.arguments.includes('--simulation'));
    assert.deepEqual(plan.childEnvironmentKeys, ['DONOR_ROOT', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']);
    assert.doesNotMatch(JSON.stringify(plan), /authorization|systemctl|release-switch|rollback-switch|aws/i);
  }
});

test('release and deployment plans invoke validation-only owners', () => {
  const release = invoke(OPS_COMMAND, [
    'release-preflight', '--release', '/tmp/release', '--allow-simulation', '--plan',
  ]);
  assert.equal(release.status, 0, release.stderr);
  const releasePlan = jsonOutput(release);
  assert.match(releasePlan.arguments[0], /ops\/i00\/bin\/validate-release\.mjs$/);
  assert.ok(releasePlan.arguments.includes('--allow-simulation'));

  for (const operation of ['deploy-preflight', 'rollback-preflight']) {
    const mode = operation.startsWith('deploy') ? 'deploy' : 'rollback';
    const result = invoke(OPS_COMMAND, [
      operation,
      '--release', '/tmp/release',
      '--host', '/tmp/host.json',
      '--supervisor', '/tmp/supervisor.json',
      '--now', '2026-07-14T00:00:00Z',
      '--max-host-age-sec', '300',
      '--max-supervisor-age-sec', '120',
      '--required-supervisor-window-sec', '130',
      '--plan',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const plan = jsonOutput(result);
    assert.match(plan.arguments[0], /ops\/i00\/bin\/preflight\.mjs$/);
    assert.equal(plan.arguments[plan.arguments.indexOf('--mode') + 1], mode);
    assert.equal(plan.safetyClass, `${mode.toUpperCase()}_PREFLIGHT_NO_MUTATION`);
    assert.doesNotMatch(JSON.stringify(plan), /systemctl|release-switch|rollback-switch|aws/i);
  }
});

test('ops wrapper rejects relative paths, unknown flags, and unknown operations', () => {
  const relative = invoke(OPS_COMMAND, [
    'release-preflight', '--release', 'relative', '--allow-simulation', '--plan',
  ]);
  assert.equal(relative.status, 1);
  assert.equal(jsonOutput(relative).reasonCode, 'ABSOLUTE_PATH_REQUIRED');

  const unknownFlag = invoke(OPS_COMMAND, [
    'backup', '--config', '/tmp/env', '--simulation-root', '/tmp/sim',
    '--donor-root', '/tmp/donor', '--authorization', '/tmp/auth', '--plan',
  ]);
  assert.equal(unknownFlag.status, 1);
  assert.equal(jsonOutput(unknownFlag).reasonCode, 'INVALID_ARGUMENTS');

  const unknownOperation = invoke(OPS_COMMAND, ['deploy']);
  assert.equal(unknownOperation.status, 1);
  assert.equal(jsonOutput(unknownOperation).reasonCode, 'UNSUPPORTED_OPERATION');
});

test('ops wrapper hardcodes shell-free execution and contains no mutation owner', () => {
  const source = readFileSync(OPS_COMMAND, 'utf8');
  assert.match(source, /shell:\s*false/);
  for (const forbidden of ['release-switch.sh', 'rollback-switch.sh', 'systemctl', 'aws ']) {
    assert.equal(source.includes(forbidden), false, `forbidden ops wrapper token ${forbidden}`);
  }
});
