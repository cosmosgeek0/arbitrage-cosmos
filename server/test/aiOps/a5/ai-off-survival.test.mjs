import assert from 'node:assert/strict';
import test from 'node:test';

import { scenarioById } from '../../../../fixtures/aiOps/a5/campaign-catalog.mjs';
import { evaluateOracle } from '../../../../fixtures/aiOps/a5/oracles.mjs';
import { buildReferenceTrace, simulateAiOffSurvival } from '../../../../fixtures/aiOps/a5/reference-harness.mjs';

test('healthy no-model scenario does not claim a counterfactual physical-removal proof', () => {
  const scenario = scenarioById(1);
  const trace = buildReferenceTrace(scenario);
  assert.equal(trace.aiPlane.faultMode, 'HEALTHY_NO_MODEL_NEEDED');
  assert.equal(trace.aiPlane.aiRemoved, false);
  assert.equal(trace.aiPlane.structuralProof, null);
  assert.equal(trace.aiPlane.structuralProofHash, null);
  assert.equal(trace.aiPlane.removedAdapterCount, 0);
  assert.equal(trace.aiPlane.graphChanged, false);
  assert.equal(evaluateOracle('O-AI-OFF-EQUIVALENCE', scenario, trace).pass, true);
});

test('physical removal of every synthetic AI adapter preserves the product-safety digest', () => {
  const survival = simulateAiOffSurvival();
  assert.equal(survival.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(survival.evidenceTier, 'SYNTHETIC_SCENARIO_SIMULATION');
  assert.ok(survival.aiAdaptersBeforeRemoval.length > 0);
  assert.deepEqual(survival.aiAdaptersAfterRemoval, []);
  assert.ok(survival.providerStates.every(({ state }) => state === 'DIAGNOSTIC_PLANE_UNAVAILABLE'));
  assert.notEqual(survival.beforeGraphHash, survival.afterGraphHash);
  assert.equal(survival.graphChanged, true);
  assert.equal(survival.removedAdapterIds.length, 4);
  assert.deepEqual(survival.aiAdaptersAfterRemoval, []);
  assert.equal(survival.deterministicEvaluationCount, 2);
  assert.deepEqual(survival.beforeProjection, survival.afterProjection);
  assert.equal(survival.projectionByteEquivalent, true);
  assert.equal(survival.productSafetyBeforeDigest, survival.productSafetyAfterDigest);
  assert.equal(survival.networkAttemptCount, 0);
  assert.equal(survival.productEffectCount, 0);
  assert.equal(survival.deterministicOwnersAvailable, true);
  assert.equal(survival.postPortPhysicalRemovalRequired, true);
});

test('provider, gateway, and worker death cannot change deterministic supervision', () => {
  for (const id of [50, 78, 120]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.aiPlane.everyProviderDead, true);
    assert.equal(trace.aiPlane.gatewayDead, true);
    assert.equal(trace.scenarioProof.aiPlane.deterministicOwnersAvailable, true);
    assert.equal(trace.scenarioProof.aiPlane.supervisionChanged, false);
    assert.equal(evaluateOracle('O-AI-OFF-EQUIVALENCE', scenario, trace).pass, true);
  }
});

test('queue, DLQ, WAL, telemetry, policy, audit, and sentinel loss stay visible and block effects', () => {
  for (const id of [61, 62, 63, 65, 71, 88, 109, 110]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.counters.productEffects, 0);
    assert.equal(trace.productEffectCount, 0);
    assert.equal(evaluateOracle('O-FAIL-CLOSED', scenario, trace).pass, true);
  }
});

test('provider outage, quota, cost, and unqualified fallback remain diagnostic-only', () => {
  for (const id of [21, 22, 23, 24, 51, 52, 92, 113, 114]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.provider.failoverOccurred, false);
    assert.equal(evaluateOracle('O-PROVIDER-DEGRADE', scenario, trace).pass, true);
  }
});

test('no-data canary and unqualified failover cannot promote or mutate live state', () => {
  for (const id of [76, 82, 92, 113, 115, 117]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.delivery.promoted, false);
    assert.equal(trace.scenarioProof.provider.failoverOccurred, false);
    assert.equal(trace.scenarioProof.delivery.liveMutationCount, 0);
    assert.equal(evaluateOracle('O-CANARY-FAILOVER', scenario, trace).pass, true);
  }
});

test('invalid policy bundle, credential proxy, endpoint identity, and audit export fail closed', () => {
  for (const id of [107, 108, 109, 110]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.policyAudit.credentialInjected, false);
    assert.equal(trace.scenarioProof.policyAudit.invalidBundleApplied, false);
    assert.equal(trace.scenarioProof.policyAudit.moneyAdjacentEffectBlocked, true);
    assert.equal(evaluateOracle('O-POLICY-CREDENTIAL-AUDIT', scenario, trace).pass, true);
  }
});
