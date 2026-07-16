import assert from 'node:assert/strict';
import test from 'node:test';

import { drillDocument, EFFECT_EVIDENCE, ZERO_EFFECT } from './lib/constants.mjs';
import { digest, validateReceipt } from './lib/receipt.mjs';
import { runAllDrills, verifyPassReceiptAgainstExecution } from './lib/runner.mjs';

test('all eight drills are deterministic executable zero-effect evidence', async () => {
  const first = await runAllDrills();
  const second = await runAllDrills();
  const definitions = drillDocument().drills;

  assert.deepEqual(second, first);
  assert.equal(first.length, 8);
  assert.equal(new Set(first.map((receipt) => receipt.drillId)).size, 8);
  assert.equal(first.reduce((total, receipt) => total + receipt.assertions.total, 0), 53);

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const receipt = first[index];
    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.expectedFailureObserved, true);
    assert.equal(receipt.assertions.passed, receipt.assertions.total);
    assert.deepEqual(receipt.assertions.items.map((item) => item.id), definition.assertionIds);
    assert(receipt.assertions.items.every((item) => item.pass === true));
    assert.deepEqual(receipt.effects, ZERO_EFFECT);
    assert.deepEqual(receipt.effectEvidence, EFFECT_EVIDENCE);
    assert.deepEqual(receipt.scenarioIds, definition.scenarioIds);
    assert.deepEqual(receipt.ownerEvidence.runtimeExecutions, definition.runtimeExecutionPlan);
    assert.deepEqual(Object.keys(receipt.ownerEvidence.evidenceChecks).sort(), [...definition.evidenceCheckIds].sort());
    assert.deepEqual(Object.keys(receipt.ownerEvidence.contractBindings).sort(), [...definition.contractBindingIds].sort());
    assert(Object.values(receipt.ownerEvidence.evidenceChecks).every((value) => value === true));
    assert(Object.values(receipt.ownerEvidence.contractBindings).every((value) => value === true));
    for (const execution of receipt.ownerEvidence.runtimeExecutions) {
      assert(new Set([
        'CANONICAL_OWNER',
        'PROJECTION_OWNER',
        'MOUNT_OWNER',
        'FOUNDATION_CONTRACT_OWNER',
        'ACCEPTED_EXECUTABLE_HARNESS',
      ]).has(execution.role));
      const expectedOwner = execution.role === 'CANONICAL_OWNER'
        ? definition.projectionContract.canonicalOwner
        : execution.role === 'PROJECTION_OWNER'
          ? definition.projectionContract.projectionOwner
          : execution.role === 'MOUNT_OWNER'
            ? definition.projectionContract.mountOwner
            : execution.role === 'FOUNDATION_CONTRACT_OWNER'
              ? 'FOUNDATION_CONTROL_PLANE'
              : 'I00_ACCEPTANCE_HARNESS';
      assert.equal(execution.owner, expectedOwner);
      assert(execution.module.startsWith('server/'));
      assert(execution.operations.length > 0);
    }
    assert.deepEqual(
      receipt.ownerEvidence.scenarios.map(({ id, terminal }) => ({ id, terminal })),
      definition.scenarioIds.map((id, scenarioIndex) => ({ id, terminal: definition.expectedTerminals[scenarioIndex] })),
    );
    assert.deepEqual(
      receipt.ownerEvidence.scenarios.map(({ startedAtMs }) => startedAtMs),
      definition.scenarioIds.map((_, scenarioIndex) => receipt.injectedAtMs + (scenarioIndex * 10_000)),
    );
    assert.equal(receipt.ownerEvidenceDigestSha256, digest(receipt.ownerEvidence));
    assert.deepEqual(receipt.cockpitProjection, definition.projectionContract);
    assert.equal(validateReceipt(receipt, definition), true);
    assert.equal(await verifyPassReceiptAgainstExecution(receipt), true);
  }
});
