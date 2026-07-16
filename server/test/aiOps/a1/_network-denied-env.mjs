import assert from 'node:assert/strict';
import { after } from 'node:test';

import { installEgressTripwire } from '../../systemIntegration/fixtures/egress-tripwire.mjs';

assert.ok(process.permission, 'focused AI Ops tests require the Node Permission Model');
assert.equal(process.env.AI_OPS_OS_NETWORK_DENY, '1', 'focused AI Ops tests require the sandbox-exec deny-network wrapper');

const tripwire = installEgressTripwire({ maximumAttempts: 128 });

after(() => {
  tripwire.assertNoAttempts('AI Ops focused contract suite');
  tripwire.restore();
});

export async function loadContracts() {
  return import('../../../dist/aiOps/contracts/index.js');
}

export function assertNetworkPermissionDenied() {
  assert.equal(process.env.AI_OPS_OS_NETWORK_DENY, '1');
  assert.deepEqual(tripwire.snapshot().attempts, []);
}
