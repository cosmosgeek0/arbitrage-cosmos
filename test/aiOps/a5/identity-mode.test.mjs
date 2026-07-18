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

test('FIX-105 donor expectation is conditional on the exact donor commit and tree', () => {
  const scenario = AI_OPS_IDENTITY_REGRESSION_MATRIX.find((row) => row.item === 'FIX-105');
  assert.ok(scenario);
  const result = classifyAiOpsGitIdentity(scenario.head, AI_OPS_DONOR_IDENTITIES[scenario.lane]);
  assert.equal(result.mode, 'DONOR');
  assert.equal(result.verificationTarget, 'SEALED_DONOR_HISTORY');
});

test('FIX-107 every named AI-Ops lane uses the same commit-tree identity rule', () => {
  const scenario = AI_OPS_IDENTITY_REGRESSION_MATRIX.find((row) => row.item === 'FIX-107');
  assert.ok(scenario);
  assert.deepEqual(scenario.lanes, ['A1', 'A2', 'A5']);
  for (const lane of scenario.lanes) {
    const result = classifyAiOpsGitIdentity(scenario.heads[lane], AI_OPS_DONOR_IDENTITIES[lane]);
    assert.equal(result.mode, 'DONOR', lane);
    assert.equal(result.verificationTarget, 'SEALED_DONOR_HISTORY', lane);
  }
});
