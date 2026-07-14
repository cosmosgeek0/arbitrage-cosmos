import assert from 'node:assert/strict';
import test from 'node:test';

import { projectI00Health } from '../../../dist/systemIntegration/application/health.js';

function supervisor(overrides = {}) {
  return {
    evaluatedAtMs: 1_800_000_000_000,
    overallPosture: 'READY',
    firstRootBlockerComponentId: null,
    components: [{ componentId: 'ledger-persistence' }],
    edges: [],
    summaries: { ledger: { writable: true } },
    ...overrides,
  };
}

function recentAdvance(overrides = {}) {
  return {
    ownerComponentId: 'market-universe',
    observedAtMs: 1_799_999_999_500,
    maxAgeMs: 1_000,
    ...overrides,
  };
}

test('liveness is process-only and does not inherit readiness dependencies', () => {
  assert.equal(projectI00Health('LIVE', supervisor(), true, null).ok, true);
  const degraded = projectI00Health(
    'LIVE',
    supervisor({ summaries: { ledger: { writable: null } }, overallPosture: 'FAILED' }),
    false,
    null,
  );
  assert.equal(degraded.ok, true);
  assert.deepEqual(degraded.reasonCodes, []);
});

test('readiness follows canonical supervisor posture and root blocker', () => {
  const blocked = projectI00Health('READY', supervisor({
    overallPosture: 'DEGRADED',
    firstRootBlockerComponentId: 'public-spot-source',
  }), true, recentAdvance());
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.reasonCodes, ['PRODUCT_POSTURE_DEGRADED', 'ROOT_BLOCKER_PRESENT']);
});

test('readiness fails closed until an owner supplies recent meaningful-advance evidence', () => {
  const missing = projectI00Health('READY', supervisor(), true, null);
  assert.equal(missing.ok, false);
  assert.equal(missing.lastMeaningfulAdvanceAtMs, null);
  assert.deepEqual(missing.reasonCodes, ['MEANINGFUL_ADVANCE_NOT_SUPPLIED']);

  const stale = projectI00Health('READY', supervisor(), true, recentAdvance({ observedAtMs: 1_799_999_998_000 }));
  assert.equal(stale.ok, false);
  assert.equal(stale.meaningfulAdvanceAgeMs, 2_000);
  assert.deepEqual(stale.reasonCodes, ['MEANINGFUL_ADVANCE_STALE']);

  const ready = projectI00Health('READY', supervisor(), true, recentAdvance());
  assert.equal(ready.ok, true);
  assert.equal(ready.meaningfulAdvanceOwnerComponentId, 'market-universe');
  assert.equal(ready.meaningfulAdvanceAgeMs, 500);
});

test('trade readiness remains false even when product readiness is green', () => {
  const projected = projectI00Health('TRADE_READY', supervisor(), true, recentAdvance());
  assert.equal(projected.ok, false);
  assert.equal(projected.executionBarrier, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
  assert.deepEqual(projected.reasonCodes, ['LIVE_EXECUTION_NOT_IMPLEMENTED']);
});
