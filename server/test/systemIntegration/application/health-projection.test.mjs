import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveI00MeaningfulAdvanceEvidence,
  projectI00Health,
} from '../../../dist/systemIntegration/application/health.js';

const EVALUATED_AT_MS = 1_800_000_000_000;

function readyAdvanceOwner(overrides = {}) {
  return {
    componentId: 'market-universe',
    truthLabel: 'LIVE_PUBLIC',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    readiness: 'READY',
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceTimestamp: {
      sourceTimeMs: EVALUATED_AT_MS - 500,
      receivedAtMs: EVALUATED_AT_MS - 450,
      maxAgeMs: 1_000,
      authority: 'LIVE_PUBLIC',
      completeness: 'COMPLETE',
      sourceId: 'test.market-universe',
    },
    freshness: {
      state: 'FRESH',
      ageMs: 500,
      basis: 'SOURCE_TIME',
      effectiveAuthority: 'LIVE_PUBLIC',
      evaluatedAt: EVALUATED_AT_MS,
    },
    ...overrides,
  };
}

function supervisor(overrides = {}) {
  return {
    evaluatedAtMs: EVALUATED_AT_MS,
    overallPosture: 'READY',
    firstRootBlockerComponentId: null,
    components: [{ componentId: 'ledger-persistence' }, readyAdvanceOwner()],
    edges: [],
    summaries: { ledger: { writable: true, schemaCompatibilityState: 'AVAILABLE' } },
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
    supervisor({ summaries: { ledger: { writable: null, schemaCompatibilityState: 'UNAVAILABLE' } }, overallPosture: 'FAILED' }),
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

  const readySupervisor = supervisor();
  const ready = projectI00Health(
    'READY',
    readySupervisor,
    true,
    deriveI00MeaningfulAdvanceEvidence(readySupervisor),
  );
  assert.equal(ready.ok, true);
  assert.equal(ready.meaningfulAdvanceOwnerComponentId, 'market-universe');
  assert.equal(ready.meaningfulAdvanceAgeMs, 500);
});

test('meaningful advance derives only from an exact current canonical public owner in the same supervisor cut', () => {
  const market = readyAdvanceOwner();
  const source = supervisor({ components: [{ componentId: 'ledger-persistence' }, market] });
  assert.deepEqual(deriveI00MeaningfulAdvanceEvidence(source), recentAdvance());

  const usdm = readyAdvanceOwner({ componentId: 'public-usdm-source' });
  const preferred = supervisor({ components: [{ componentId: 'ledger-persistence' }, market, usdm] });
  assert.deepEqual(deriveI00MeaningfulAdvanceEvidence(preferred), {
    ownerComponentId: 'public-usdm-source', observedAtMs: EVALUATED_AT_MS - 500, maxAgeMs: 1_000,
  });

  for (const components of [
    [{ componentId: 'ledger-persistence' }, readyAdvanceOwner({ componentId: 'basis-engine' })],
    [{ componentId: 'ledger-persistence' }, readyAdvanceOwner({ truthLabel: 'UNKNOWN' })],
    [{ componentId: 'ledger-persistence' }, readyAdvanceOwner({ freshness: { ...market.freshness, state: 'STALE' } })],
    [{ componentId: 'ledger-persistence' }, readyAdvanceOwner(), readyAdvanceOwner()],
  ]) {
    const blockedSupervisor = supervisor({ components });
    const advance = deriveI00MeaningfulAdvanceEvidence(blockedSupervisor);
    const projected = projectI00Health('READY', blockedSupervisor, true, advance);
    assert.equal(advance, null);
    assert.equal(projected.ok, false);
    assert.ok(projected.reasonCodes.includes('MEANINGFUL_ADVANCE_NOT_SUPPLIED'));
  }
});

test('readiness fails closed on unavailable or mismatched Ledger schema compatibility', () => {
  for (const state of ['UNAVAILABLE', 'MALFORMED', 'MISMATCH']) {
    const projected = projectI00Health('READY', supervisor({
      summaries: { ledger: { writable: true, schemaCompatibilityState: state } },
    }), true, recentAdvance());
    assert.equal(projected.ok, false);
    assert.ok(projected.reasonCodes.includes(`LEDGER_SCHEMA_COMPATIBILITY_${state}`));
  }
});

test('readiness rejects invented, unavailable, non-ready, and non-current advance owners', () => {
  const invented = projectI00Health(
    'READY',
    supervisor(),
    true,
    recentAdvance({ ownerComponentId: 'invented-owner' }),
  );
  assert.equal(invented.ok, false);
  assert.deepEqual(invented.reasonCodes, ['MEANINGFUL_ADVANCE_OWNER_NOT_FOUND']);

  const unavailable = projectI00Health('READY', supervisor({
    components: [
      { componentId: 'ledger-persistence' },
      readyAdvanceOwner({ truthLabel: 'UNAVAILABLE', authority: 'UNAVAILABLE' }),
    ],
  }), true, recentAdvance());
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.reasonCodes, ['MEANINGFUL_ADVANCE_OWNER_UNAVAILABLE']);

  const nonReady = projectI00Health('READY', supervisor({
    components: [
      { componentId: 'ledger-persistence' },
      readyAdvanceOwner({ readiness: 'DEGRADED' }),
    ],
  }), true, recentAdvance());
  assert.equal(nonReady.ok, false);
  assert.deepEqual(nonReady.reasonCodes, ['MEANINGFUL_ADVANCE_OWNER_NOT_READY']);

  const nonCurrent = projectI00Health('READY', supervisor({
    components: [
      { componentId: 'ledger-persistence' },
      readyAdvanceOwner({
        freshness: {
          state: 'STALE',
          ageMs: 2_000,
          basis: 'SOURCE_TIME',
          effectiveAuthority: 'UNAVAILABLE',
          evaluatedAt: EVALUATED_AT_MS,
        },
      }),
    ],
  }), true, recentAdvance());
  assert.equal(nonCurrent.ok, false);
  assert.deepEqual(nonCurrent.reasonCodes, ['MEANINGFUL_ADVANCE_OWNER_NOT_CURRENT']);
});

test('trade readiness remains false even when product readiness is green', () => {
  const projected = projectI00Health('TRADE_READY', supervisor(), true, recentAdvance());
  assert.equal(projected.ok, false);
  assert.equal(projected.executionBarrier, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
  assert.deepEqual(projected.reasonCodes, ['LIVE_EXECUTION_NOT_IMPLEMENTED']);
});
