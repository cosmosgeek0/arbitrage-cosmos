import assert from 'node:assert/strict';
import test from 'node:test';

import { drillDefinition } from './lib/constants.mjs';
import { installNetworkDeny } from './lib/network-deny.mjs';
import { buildReceipt, digest, validateReceipt } from './lib/receipt.mjs';
import { runDrill, verifyPassReceiptAgainstExecution } from './lib/runner.mjs';

function clone(value) {
  return structuredClone(value);
}

test('receipt validator rejects forged greens and forbidden nested claims', async () => {
  const definition = drillDefinition('source-loss');
  const valid = await runDrill('source-loss');
  assert.equal(validateReceipt(valid, definition), true);

  const mutations = [
    (receipt) => { receipt.assertions.items[0].pass = false; },
    (receipt) => { receipt.ownerEvidenceDigestSha256 = '0'.repeat(64); },
    (receipt) => { receipt.cockpitProjection.acceptanceStatus = 'ACCEPTED'; },
    (receipt) => { receipt.cockpitProjection.authority = 'LIVE'; },
    (receipt) => { receipt.scenarioIds = ['I00-10']; },
    (receipt) => { receipt.command = ['node', 'wrong.mjs']; },
    (receipt) => { receipt.limitations = []; },
    (receipt) => { receipt.insertionRequestIds = []; },
    (receipt) => { receipt.effects.networkAttempts = 1; },
    (receipt) => { receipt.assertions.items.at(-1).id = receipt.assertions.items[0].id; },
    (receipt) => { receipt.assertions.items.at(-1).id = 'UNKNOWN_ASSERTION'; },
  ];
  for (const mutate of mutations) {
    const forged = clone(valid);
    mutate(forged);
    assert.throws(() => validateReceipt(forged, definition));
  }

  const falseExpectedFailure = clone(valid);
  falseExpectedFailure.ownerEvidence.expectedFailureObserved = false;
  falseExpectedFailure.expectedFailureObserved = false;
  falseExpectedFailure.ownerEvidenceDigestSha256 = digest(falseExpectedFailure.ownerEvidence);
  assert.throws(() => validateReceipt(falseExpectedFailure, definition), /FALSE_GREEN_OR_FALSE_RED/);

  const forgedEvidence = clone(valid);
  forgedEvidence.ownerEvidence.evidenceChecks.sourceLossBlocks = false;
  forgedEvidence.ownerEvidenceDigestSha256 = digest(forgedEvidence.ownerEvidence);
  assert.throws(() => validateReceipt(forgedEvidence, definition), /FALSE_GREEN_OR_FALSE_RED/);

  const forgedBinding = clone(valid);
  forgedBinding.ownerEvidence.contractBindings.unavailableBlock = false;
  forgedBinding.ownerEvidenceDigestSha256 = digest(forgedBinding.ownerEvidence);
  assert.throws(() => validateReceipt(forgedBinding, definition), /FALSE_GREEN_OR_FALSE_RED/);

  const forgedExecutionOwner = clone(valid);
  forgedExecutionOwner.ownerEvidence.runtimeExecutions[0].owner = 'OPS_EXTERNAL_WATCHDOG';
  forgedExecutionOwner.ownerEvidenceDigestSha256 = digest(forgedExecutionOwner.ownerEvidence);
  assert.throws(() => validateReceipt(forgedExecutionOwner, definition), /FALSE_GREEN_OR_FALSE_RED/);

  const wholesaleFabrication = clone(valid);
  wholesaleFabrication.ownerEvidence = {
    expectedFailureObserved: true,
    runtimeExecutions: clone(definition.runtimeExecutionPlan),
    contractBindings: { unavailableBlock: true },
    evidenceChecks: { totallyForged: true },
    scenarios: clone(valid.ownerEvidence.scenarios),
  };
  wholesaleFabrication.ownerEvidenceDigestSha256 = digest(wholesaleFabrication.ownerEvidence);
  assert.throws(() => validateReceipt(wholesaleFabrication, definition), /FALSE_GREEN_OR_FALSE_RED/);

  const forgedStructuredProjection = clone(valid);
  forgedStructuredProjection.ownerEvidence.sourceLossProjection = { readiness: 'READY', truthLabel: 'LIVE' };
  forgedStructuredProjection.ownerEvidenceDigestSha256 = digest(forgedStructuredProjection.ownerEvidence);
  assert.equal(validateReceipt(forgedStructuredProjection, definition), true);
  await assert.rejects(
    verifyPassReceiptAgainstExecution(forgedStructuredProjection),
    /RUNBOOK_SHADOW_RECEIPT_EXECUTION_MISMATCH/,
  );
});

test('a failed expected-failure observation returns a valid red receipt', async () => {
  const definition = drillDefinition('source-loss');
  const valid = await runDrill('source-loss');
  const ownerEvidence = clone(valid.ownerEvidence);
  ownerEvidence.expectedFailureObserved = false;
  const failed = buildReceipt({
    definition,
    injectedAtMs: valid.injectedAtMs,
    assertions: valid.assertions.items,
    ownerEvidence,
    networkAttempts: 0,
    errorCode: null,
  });
  assert.equal(failed.result, 'FAIL');
  assert.equal(failed.exitCode, 1);
  assert.equal(validateReceipt(failed, definition), true);
});

test('unknown drill identifiers fail closed', async () => {
  await assert.rejects(runDrill('unknown-drill'), /RUNBOOK_SHADOW_DRILL_NOT_FOUND/);
});

test('network constructors are denied, counted, and can produce a valid red receipt', async () => {
  const deny = installNetworkDeny();
  try {
    assert.throws(() => new globalThis.WebSocket('ws:'), /RUNBOOK_SHADOW_NETWORK_FORBIDDEN/);
    assert.throws(() => globalThis.fetch('about:blank'), /RUNBOOK_SHADOW_NETWORK_FORBIDDEN/);
    assert.equal(deny.attempts(), 2);
  } finally {
    deny.restore();
  }

  const definition = drillDefinition('source-loss');
  const valid = await runDrill('source-loss');
  const assertions = clone(valid.assertions.items);
  const zeroEffect = assertions.find((assertion) => assertion.id === 'ZERO_EFFECT');
  zeroEffect.pass = false;
  zeroEffect.observed.networkAttempts = 1;
  const red = buildReceipt({
    definition,
    injectedAtMs: valid.injectedAtMs,
    assertions,
    ownerEvidence: valid.ownerEvidence,
    networkAttempts: 1,
    errorCode: 'RUNBOOK_SHADOW_NETWORK_FORBIDDEN',
  });
  assert.equal(red.result, 'FAIL');
  assert.equal(red.exitCode, 1);
  assert.equal(red.effects.networkAttempts, 1);
  assert.equal(validateReceipt(red, definition), true);
});
