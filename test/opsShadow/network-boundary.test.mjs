import assert from 'node:assert/strict';
import test from 'node:test';

const tripwireKey = Symbol.for('cosmos.test.network-egress-tripwire.v1');

test('canonical repository network tripwire is preloaded', () => {
  assert.equal(globalThis[tripwireKey], true);
});

test('external fetch is rejected before transport', async () => {
  assert.equal(globalThis[tripwireKey], true);
  await assert.rejects(
    fetch('https://ops-shadow-probe.invalid/never-send'),
    (error) => error?.code === 'ERR_TEST_NETWORK_EGRESS_BLOCKED'
      && /PROHIBITED_EXTERNAL_EGRESS/u.test(error.message),
  );
});
