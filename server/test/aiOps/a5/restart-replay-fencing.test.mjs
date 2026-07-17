import assert from 'node:assert/strict';
import test from 'node:test';

import { scenarioById } from '../../../../fixtures/aiOps/a5/campaign-catalog.mjs';
import { evaluateOracle } from '../../../../fixtures/aiOps/a5/oracles.mjs';
import { buildReferenceTrace } from '../../../../fixtures/aiOps/a5/reference-harness.mjs';

test('durable restart resumes from checkpoint without chat memory', () => {
  const scenario = scenarioById(25);
  const trace = buildReferenceTrace(scenario);
  assert.equal(trace.scenarioProof.workflow.checkpointUsed, true);
  assert.equal(trace.scenarioProof.workflow.chatMemoryUsed, false);
  assert.equal(trace.scenarioProof.workflow.checkpointByteStable, true);
  assert.equal(trace.scenarioProof.workflow.nextActionReproduced, true);
  assert.equal(evaluateOracle('O-DURABLE-RESUME', scenario, trace).pass, true);
});

test('workflow-version and SHA gates block incompatible history resume', () => {
  for (const id of [73, 112]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.workflow.resumeAllowed, false);
    assert.equal(evaluateOracle('O-DURABLE-RESUME', scenario, trace).pass, true);
  }
});

test('redrive and callback replay preserve durable global budgets and one transition', () => {
  for (const id of [60, 111]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.workflow.globalAttemptUsageBefore, trace.scenarioProof.workflow.globalAttemptUsageAfter);
    assert.equal(trace.scenarioProof.workflow.globalCostUsageBeforeMicrounits, trace.scenarioProof.workflow.globalCostUsageAfterMicrounits);
    assert.equal(trace.scenarioProof.workflow.globalBudgetReset, false);
    if (scenario.oracleIds.includes('O-IDEMPOTENCY')) {
      assert.equal(evaluateOracle('O-IDEMPOTENCY', scenario, trace).pass, true);
    }
    assert.equal(evaluateOracle('O-DURABLE-RESUME', scenario, trace).pass, true);
  }
});

test('stale, changed, replayed, or burst approval cannot advance the workflow', () => {
  for (const id of [37, 46, 59, 94, 116]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.approval.valid, false);
    assert.equal(trace.scenarioProof.approval.scopeExpanded, false);
    assert.equal(evaluateOracle('O-APPROVAL-BINDING', scenario, trace).pass, true);
  }
});

test('two executors produce one current-epoch fixture transition and reject stale fencing', () => {
  for (const id of [28, 29, 30, 81, 84]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.ok(trace.scenarioProof.fencing.attemptedEpochs.length >= 1);
    assert.ok(trace.scenarioProof.fencing.winnerCount <= 1);
    assert.ok(trace.scenarioProof.fencing.committedEpochs.every((epoch) => epoch === trace.scenarioProof.fencing.currentEpoch));
    assert.equal(trace.scenarioProof.delivery.liveMutationCount, 0);
    assert.equal(evaluateOracle('O-FENCING', scenario, trace).pass, true);
  }
});

test('context-hash mismatch and poisoned shared ancestry fail closed', () => {
  const contextScenario = scenarioById(103);
  const contextTrace = buildReferenceTrace(contextScenario);
  assert.equal(contextTrace.scenarioProof.context.modelSessionStarted, false);
  assert.equal(evaluateOracle('O-CONTEXT-BINDING', contextScenario, contextTrace).pass, true);

  const ancestryScenario = scenarioById(75);
  const ancestryTrace = buildReferenceTrace(ancestryScenario);
  assert.equal(ancestryTrace.scenarioProof.context.poisonedAncestryBlocked, true);
  assert.equal(evaluateOracle('O-CONTEXT-BINDING', ancestryScenario, ancestryTrace).pass, true);
});
