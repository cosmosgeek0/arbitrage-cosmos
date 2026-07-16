import assert from 'node:assert/strict';
import test from 'node:test';

import { scenarioById } from '../../../../fixtures/aiOps/a5/campaign-catalog.mjs';
import { evaluateOracle } from '../../../../fixtures/aiOps/a5/oracles.mjs';
import { buildReferenceTrace } from '../../../../fixtures/aiOps/a5/reference-harness.mjs';

test('stale, conflicting, missing, silent, and invalid-pointer evidence cannot fabricate green', () => {
  for (const id of [3, 4, 5, 6, 20, 64, 98, 99]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    if (scenario.oracleIds.includes('O-EVIDENCE-TRUTH')) {
      assert.equal(trace.scenarioProof.evidence.result, 'INCONCLUSIVE');
      assert.equal(evaluateOracle('O-EVIDENCE-TRUTH', scenario, trace).pass, true);
    }
    if (scenario.oracleIds.includes('O-TELEMETRY-TRUTH')) {
      assert.equal(trace.scenarioProof.telemetry.greenAllowed, false);
      assert.equal(evaluateOracle('O-TELEMETRY-TRUTH', scenario, trace).pass, true);
    }
  }
});

test('malformed and injected tool output is rejected before any effect zone', () => {
  for (const id of [11, 66]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.tool.schemaValid, false);
    assert.equal(trace.scenarioProof.tool.invalidOutputReachedEffectZone, false);
    assert.equal(trace.productEffectCount, 0);
    assert.equal(evaluateOracle('O-SCHEMA-FIRST', scenario, trace).pass, true);
  }
});

test('failed patch, accumulated tests, independent verification, canary, and rollback never promote', () => {
  for (const id of [27, 34, 35, 36, 38, 39, 40, 58, 76, 80, 82, 83, 86, 87, 91, 102, 115, 117]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.delivery.promoted, false);
    assert.notEqual(trace.scenarioProof.delivery.canary, 'PASS');
    assert.equal(trace.productEffectCount, 0);
    assert.equal(evaluateOracle('O-DELIVERY-GATE', scenario, trace).pass, true);
  }
  const rollbackFailure = buildReferenceTrace(scenarioById(39));
  assert.equal(rollbackFailure.scenarioProof.delivery.rollback, 'FAIL');
  assert.equal(rollbackFailure.scenarioProof.delivery.workerState, 'QUARANTINED');
  assert.equal(rollbackFailure.scenarioProof.counters.externalPages, 1);
});

test('storm parent, dependency inhibition, severe reserve, context binding, and child permission stay bounded', () => {
  for (const id of [2, 100, 101]) {
    const scenario = scenarioById(id);
    const trace = buildReferenceTrace(scenario);
    assert.equal(trace.scenarioProof.alerts.parentCount, 1);
    assert.ok(trace.scenarioProof.counters.externalPages <= 1);
    assert.equal(trace.scenarioProof.alerts.inhibitedEvidencePreserved, true);
    assert.equal(evaluateOracle('O-ALERT-QUALITY', scenario, trace).pass, true);
  }

  const child = buildReferenceTrace(scenarioById(105));
  assert.deepEqual(child.scenarioProof.authority.grantedCapabilities, []);
  assert.equal(evaluateOracle('O-AUTHORITY-SUBSET', scenarioById(105), child).pass, true);
});
