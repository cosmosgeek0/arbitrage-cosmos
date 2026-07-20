import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductRuntimeSupervisorEnvelope,
  projectProductMaterialEventPage,
} from '../../../dist/productIntegration/runtime/index.js';
import {
  T0,
  makeOpsInterlock,
  makeOpsReadback,
  makeRead,
  makeSupervisor,
} from './testSupport.mjs';

function envelope(snapshot) {
  return buildProductRuntimeSupervisorEnvelope({
    applicationStartOk: true,
    opsReadback: makeOpsReadback(),
    opsIntakeInterlock: makeOpsInterlock(),
    snapshot,
    materialEvents: projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 })),
    traces: [],
    nowMs: T0,
  });
}

test('MIS-063 Product health preserves every per-component operational dimension', () => {
  const source = makeSupervisor();
  const components = source.components.map((component) => component.componentId === 'public-spot-source'
    ? Object.freeze({
      ...component,
      processingLagMs: 17,
      retry: Object.freeze({
        state: 'BACKING_OFF', attempt: 2, ceiling: 9, delayMs: 750,
        retryAtMs: T0 + 750, cooldownUntilMs: null,
      }),
      dataQuality: Object.freeze({
        state: 'DEGRADED', invalidCount: 2, duplicateCount: 1,
        outOfOrderCount: 0, sequenceGapCount: 1, observedAtMs: T0 - 50,
      }),
      checkpoint: Object.freeze({ state: 'CURRENT', revision: 'spot-cp-7', persistedAtMs: T0 - 200 }),
      restartCount: 3,
    })
    : component);
  const projection = envelope(makeSupervisor({ components: Object.freeze(components) }));
  const spot = projection.components.find((component) => component.componentId === 'public-spot-source');

  assert.deepEqual({
    freshness: spot.freshnessState,
    lag: spot.processingLagMs,
    backlog: spot.queueDepth,
    drops: spot.droppedCount,
    quality: spot.dataQualityState,
    invalid: spot.dataQualityInvalidCount,
    duplicate: spot.dataQualityDuplicateCount,
    outOfOrder: spot.dataQualityOutOfOrderCount,
    gaps: spot.dataQualitySequenceGapCount,
    qualityObservedAt: spot.dataQualityObservedAtMs,
    retry: spot.retryState,
    retryAttempt: spot.retryAttempt,
    retryCeiling: spot.retryCeiling,
    backoff: spot.backoffMs,
    retryAt: spot.retryAtMs,
    cooldownUntil: spot.cooldownUntilMs,
    dependencies: spot.dependencyIds,
    checkpoint: spot.checkpointState,
    checkpointRevision: spot.checkpointRevision,
    checkpointPersistedAt: spot.checkpointPersistedAtMs,
    restart: spot.restartState,
    generation: spot.generation,
    restartCount: spot.restartCount,
  }, {
    freshness: 'FRESH', lag: 17, backlog: 0, drops: 0,
    quality: 'DEGRADED', invalid: 2, duplicate: 1, outOfOrder: 0, gaps: 1,
    qualityObservedAt: T0 - 50,
    retry: 'BACKING_OFF', retryAttempt: 2, retryCeiling: 9, backoff: 750,
    retryAt: T0 + 750, dependencies: [], checkpoint: 'CURRENT',
    cooldownUntil: null, checkpointRevision: 'spot-cp-7', checkpointPersistedAt: T0 - 200,
    restart: 'RESTARTED', generation: 1, restartCount: 3,
  });
});

test('Product health carries canonical service-readiness disposition without policy inference', () => {
  const source = makeSupervisor();
  const projection = envelope(source);

  assert.equal(projection.components.length, 14);
  for (const component of projection.components) {
    const canonical = source.components.find((candidate) => candidate.componentId === component.componentId);
    assert.deepEqual(component.serviceReadiness, canonical.serviceReadiness);
    assert.notStrictEqual(component.serviceReadiness, canonical.serviceReadiness);
  }

  const q = projection.components.find((component) => component.componentId === 'q-inference');
  assert.equal(q.observedLifecycle, 'BLOCKED');
  assert.equal(q.capability, 'NOT_CONFIGURED');
  assert.equal(q.truthLabel, 'UNAVAILABLE');
  assert.equal(q.blockerCode, 'FRESHNESS_NOT_REPORTED');
  assert.deepEqual(q.serviceReadiness, {
    basis: 'PUBLIC_DATA',
    expected: true,
    observed: true,
    requiredForServiceReadiness: false,
    excludedFromServiceReadiness: true,
    waiver: {
      id: 'READINESS-CLUSTER-001-Q-INFERENCE',
      scope: 'KEYLESS_PUBLIC_DATA_VALIDATE_ONLY',
      mode: 'VALIDATE_ONLY',
      reason: 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED',
      owner: 'cosmosgeek',
      expiresAt: '2026-10-18T00:00:00Z',
      status: 'VALID',
    },
  });
});

test('Product health fails closed when canonical component disposition is absent', () => {
  const source = makeSupervisor();
  const components = source.components.map((component) => component.componentId === 'basis-engine'
    ? Object.freeze(Object.fromEntries(Object.entries(component).filter(([key]) => key !== 'serviceReadiness')))
    : component);
  assert.throws(
    () => envelope(makeSupervisor({ components: Object.freeze(components) })),
    /canonical component service-readiness disposition is missing/u,
  );
});

test('MIS-063 legacy or absent fields project UNKNOWN/UNAVAILABLE, never fabricated zeros', () => {
  const projection = envelope(makeSupervisor());
  const basis = projection.components.find((component) => component.componentId === 'basis-engine');
  assert.equal(basis.processingLagMs, null);
  assert.equal(basis.retryState, 'UNAVAILABLE');
  assert.equal(basis.retryAttempt, null);
  assert.equal(basis.retryCeiling, null);
  assert.equal(basis.cooldownUntilMs, null);
  assert.equal(basis.dataQualityState, 'UNAVAILABLE');
  assert.equal(basis.dataQualityInvalidCount, null);
  assert.equal(basis.dataQualityDuplicateCount, null);
  assert.equal(basis.dataQualityOutOfOrderCount, null);
  assert.equal(basis.dataQualitySequenceGapCount, null);
  assert.equal(basis.dataQualityObservedAtMs, null);
  assert.equal(basis.checkpointState, 'UNAVAILABLE');
  assert.equal(basis.checkpointRevision, null);
  assert.equal(basis.checkpointPersistedAtMs, null);
  assert.equal(basis.restartState, 'NEVER_RESTARTED');
  assert.equal(basis.generation, 1);
  assert.equal(basis.restartCount, 0);
  assert.deepEqual(basis.dependencyIds, sourceDependencies(projection.dashboard, 'basis-engine'));
});

test('MIS-063 blocked state never fabricates restart necessity without explicit owner evidence', () => {
  const source = makeSupervisor();
  const components = source.components.map((component) => component.componentId === 'basis-engine'
    ? Object.freeze({
      ...component,
      phase: 'BLOCKED',
      readiness: 'BLOCKED',
      blockerCodes: Object.freeze(['OWNER_AUTHORIZATION_REQUIRED']),
    })
    : component.componentId === 'volume-engine'
      ? Object.freeze({
        ...component,
        phase: 'BLOCKED',
        readiness: 'BLOCKED',
        blockerCodes: Object.freeze(['OWNER_AUTHORIZATION_REQUIRED', 'SOURCE_RESTART_REQUIRED']),
      })
      : component);
  const projection = envelope(makeSupervisor({ components: Object.freeze(components) }));

  assert.equal(projection.components.find((component) => component.componentId === 'basis-engine').restartState, 'NEVER_RESTARTED');
  const volume = projection.components.find((component) => component.componentId === 'volume-engine');
  assert.equal(volume.restartState, 'RESTART_REQUIRED');
  assert.equal(volume.blockerCode, 'SOURCE_RESTART_REQUIRED');
});

test('MIS-063 contradictory restart counters fail closed before Product publication', () => {
  const source = makeSupervisor();
  const components = source.components.map((component) => component.componentId === 'basis-engine'
    ? Object.freeze({ ...component, generation: 0, restartCount: 1 })
    : component);
  assert.throws(
    () => envelope(makeSupervisor({ components: Object.freeze(components) })),
    /restart count requires a nonzero runtime generation/u,
  );
});

function sourceDependencies(dashboard, componentId) {
  return dashboard.components.find((component) => component.componentId === componentId).dependencies;
}
