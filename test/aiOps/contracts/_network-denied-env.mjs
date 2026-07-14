import assert from 'node:assert/strict';
import { after } from 'node:test';

import { installEgressTripwire } from '../../../server/test/systemIntegration/fixtures/egress-tripwire.mjs';

assert.ok(process.permission, 'focused AI Ops tests require the Node Permission Model');
assert.equal(process.permission.has('net'), false, 'focused AI Ops tests must run without network permission');

const tripwire = installEgressTripwire({ maximumAttempts: 128 });

after(() => {
  tripwire.assertNoAttempts('AI Ops focused contract suite');
  tripwire.restore();
});

export async function loadContracts() {
  return import('../../../server/dist/aiOps/contracts/index.js');
}

export function assertNetworkPermissionDenied() {
  assert.equal(process.permission.has('net'), false);
  assert.deepEqual(tripwire.snapshot().attempts, []);
}
