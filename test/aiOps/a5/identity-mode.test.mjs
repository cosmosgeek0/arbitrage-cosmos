import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_OPS_DONOR_IDENTITIES,
  AI_OPS_IDENTITY_REGRESSION_MATRIX,
  classifyAiOpsGitIdentity,
} from './git-identity.mjs';

test('FIX-092 detached integrated identity is selected only from exact commit and tree', () => {
  const scenario = AI_OPS_IDENTITY_REGRESSION_MATRIX.find((row) => row.item === 'FIX-092');
  assert.ok(scenario);
  assert.equal(Object.hasOwn(scenario, 'branch'), false);
  const result = classifyAiOpsGitIdentity(scenario.head, AI_OPS_DONOR_IDENTITIES[scenario.lane]);
  assert.equal(result.mode, scenario.expectedMode);
  assert.equal(result.verificationTarget, scenario.expectedTarget);
});
