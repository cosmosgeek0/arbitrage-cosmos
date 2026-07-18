import assert from 'node:assert/strict';
import test from 'node:test';

import {
  probeRuntimeSource,
  probeSystemComponent,
} from '../../../dist/systemIntegration/adapters/index.js';

const NOW = 1_820_000_000_000;

function sourceSnapshot(overrides = {}) {
  return {
    sourceId: 'spot-public-source',
    transportKind: 'INJECTED',
    endpointClass: 'MARKET',
    productFamily: 'SPOT',
    desiredState: 'RUNNING',
    observedState: 'BACKING_OFF',
    connectionGeneration: 4,
    connectedAtMs: NOW - 2_000,
    lastMessageSourceTimeMs: NOW - 800,
    lastMessageReceiveTimeMs: NOW - 700,
    lastProcessedTimeMs: NOW - 650,
    messageAgeMs: 700,
    processingLagMs: 50,
    messageCount: 30,
    invalidCount: 2,
    duplicateCount: 1,
    outOfOrderCount: 3,
    sequenceGapCount: 1,
    droppedCount: 5,
    coalescedCount: 2,
    reconnectCount: 3,
    backoff: { attempt: 2, ceiling: 8, delayMs: 500, retryAtMs: NOW + 500, cooldownUntilMs: null },
    rateBudget: {
      state: 'AVAILABLE', usedWeight: null, limit: null, intervalMs: null,
      resetsAtMs: null, retryAfterMs: null, observedAtMs: NOW - 100,
    },
    lastError: {
      code: 'SOCKET_CLOSED', message: 'public socket closed', retryable: true,
      observedAtMs: NOW - 200, recommendedAction: 'Wait for bounded reconnect.',
    },
    recommendedAction: 'Wait for bounded reconnect.',
    authority: 'PARTIAL',
    completeness: 'PARTIAL',
    snapshotTimeMs: NOW,
    ...overrides,
  };
}

function probe(value) {
  return probeRuntimeSource({
    nowMs: NOW,
    correlationId: 'cor-operational-health',
    safeCurrentState: 'READ_ONLY',
    componentId: 'public-spot-source',
    expectedSourceId: 'spot-public-source',
    owner: 'INTELLIGENCE_RUNTIME',
    ownerPath: 'server/src/intelligenceRuntime',
    acquisitionAuthority: 'SYNTHETIC_TEST',
    maxAgeMs: 2_000,
    dependencies: [],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'SYNTHETIC_ONLY'],
    supportedControls: ['RESTART_COMPONENT'],
    port: { readRuntimeSourceProbe: () => value },
  });
}

test('MIS-044 canonical source snapshots preserve lag, quality, retry/backoff, checkpoint and restart truth', () => {
  const result = probe({
    source: sourceSnapshot(),
    queue: { depth: 7, capacity: 20, dropped: 5, coalesced: 2, observedAtMs: NOW, resyncRequired: true },
    observation: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.component.processingLagMs, 50);
  assert.deepEqual(result.value.component.retry, {
    state: 'BACKING_OFF', attempt: 2, ceiling: 8, delayMs: 500,
    retryAtMs: NOW + 500, cooldownUntilMs: null,
  });
  assert.deepEqual(result.value.component.dataQuality, {
    state: 'DEGRADED', invalidCount: 2, duplicateCount: 1,
    outOfOrderCount: 3, sequenceGapCount: 1, observedAtMs: NOW,
  });
  assert.deepEqual(result.value.component.checkpoint, {
    state: 'UNAVAILABLE', revision: null, persistedAtMs: null,
  });
  assert.equal(result.value.component.restartCount, 3);
  assert.deepEqual(result.value.component.dependencies, []);
});

test('MIS-044 absent owner evidence remains explicit UNKNOWN or UNAVAILABLE', () => {
  const result = probe(null);
  assert.equal(result.ok, true);
  assert.equal(result.value.component.processingLagMs, null);
  assert.equal(result.value.component.retry.state, 'UNAVAILABLE');
  assert.equal(result.value.component.dataQuality.state, 'UNAVAILABLE');
  assert.equal(result.value.component.checkpoint.state, 'UNAVAILABLE');
});

test('MIS-044 an owner may publish bounded UNKNOWN without fabricating operational values', () => {
  const unknown = {
    state: 'UNKNOWN', attempt: null, ceiling: null, delayMs: null,
    retryAtMs: null, cooldownUntilMs: null,
  };
  const result = probeSystemComponent({
    nowMs: NOW,
    correlationId: 'cor-structural-health',
    safeCurrentState: 'READ_ONLY',
    componentId: 'market-intelligence',
    owner: 'MARKET_INTELLIGENCE',
    ownerPath: 'server/src/intelligenceFoundation',
    dependencies: ['intelligence-runtime'],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED'],
    supportedControls: [],
    port: {
      readComponentProbe: () => ({
        desiredState: 'RUNNING', phase: 'DEGRADED', domainObservedState: 'UNKNOWN',
        readiness: 'DEGRADED', authority: 'UNAVAILABLE', completeness: 'UNAVAILABLE',
        sourceTimestamp: null, lastReceiveAtMs: null, lastProcessAtMs: null,
        lastSuccessAtMs: null, processingLagMs: null, retry: unknown,
        dataQuality: {
          state: 'UNKNOWN', invalidCount: null, duplicateCount: null,
          outOfOrderCount: null, sequenceGapCount: null, observedAtMs: null,
        },
        checkpoint: { state: 'UNKNOWN', revision: null, persistedAtMs: null },
        queue: null, lastFailure: null, blockerCodes: ['OWNER_TRUTH_UNKNOWN'],
        generation: 1, restartCount: 0, capitalExposed: false,
        operatorAttentionRequired: true, truthLabel: 'UNAVAILABLE',
      }),
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.retry, unknown);
  assert.equal(result.value.dataQuality.state, 'UNKNOWN');
  assert.equal(result.value.checkpoint.state, 'UNKNOWN');
});
