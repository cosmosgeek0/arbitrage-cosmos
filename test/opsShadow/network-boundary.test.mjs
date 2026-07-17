import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOCUSED_COMMAND_SPECS,
  LOOPBACK_ONLY_SANDBOX_PROFILE,
  validateLoopbackCurlArgs,
} from './contract.mjs';

const tripwireKey = Symbol.for('cosmos.test.network-egress-tripwire.v1');

test('canonical repository network tripwire is preloaded', () => {
  assert.equal(globalThis[tripwireKey], true);
  assert.equal(process.env.PORT_OPS_NETWORK_MODE, 'DENY_ALL');
});

test('external fetch is rejected before transport', async () => {
  assert.equal(globalThis[tripwireKey], true);
  await assert.rejects(
    fetch('https://port-ops-probe.invalid/never-send'),
    (error) => error?.code === 'ERR_TEST_NETWORK_EGRESS_BLOCKED'
      && /PROHIBITED_EXTERNAL_EGRESS/u.test(error.message),
  );
});

test('supporting curl shim admits one exact numeric-loopback HTTP URL and rejects bypasses', () => {
  assert.deepEqual(
    validateLoopbackCurlArgs(['-fsS', '-m', '2', '-o', '/dev/null', 'http://127.0.0.1:8080/api/health']),
    { valid: true, reason: null },
  );
  for (const args of [
    ['http://127.example.invalid:8080/'],
    ['http://127.0.0.1.example.invalid:8080/'],
    ['http://localhost:8080/'],
    ['https://127.0.0.1:8080/'],
    ['http://127.0.0.1/'],
    ['-L', 'http://127.0.0.1:8080/'],
    ['--resolve', 'example.invalid:8080:127.0.0.1', 'http://127.0.0.1:8080/'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1:8081/'],
  ]) {
    assert.equal(validateLoopbackCurlArgs(args).valid, false, args.join(' '));
  }
});

test('supporting kernel profile permits only loopback plus the fixed portable ps inspection exception', () => {
  assert.equal(
    LOOPBACK_ONLY_SANDBOX_PROFILE,
    '(version 1)(allow default)(deny network*)(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))(allow process-exec (with no-sandbox) (literal "/bin/ps"))',
  );
  assert.equal((LOOPBACK_ONLY_SANDBOX_PROFILE.match(/with no-sandbox/gu) ?? []).length, 1);
  assert.equal((LOOPBACK_ONLY_SANDBOX_PROFILE.match(/literal "\/bin\/ps"/gu) ?? []).length, 1);
  for (const spec of FOCUSED_COMMAND_SPECS.filter((entry) => entry.evidenceKind.includes('LOOPBACK'))) {
    assert.equal(spec.args[1], LOOPBACK_ONLY_SANDBOX_PROFILE);
  }
});
