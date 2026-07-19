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

function structuralReading(overrides = {}) {
  return {
    desiredState: 'RUNNING',
    phase: 'DEGRADED',
    domainObservedState: 'UNKNOWN',
    readiness: 'DEGRADED',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimestamp: null,
    lastReceiveAtMs: null,
    lastProcessAtMs: null,
    lastSuccessAtMs: null,
    processingLagMs: null,
    retry: {
      state: 'UNKNOWN', attempt: null, ceiling: null, delayMs: null,
      retryAtMs: null, cooldownUntilMs: null,
    },
    dataQuality: {
      state: 'UNKNOWN', invalidCount: null, duplicateCount: null,
      outOfOrderCount: null, sequenceGapCount: null, observedAtMs: null,
    },
    checkpoint: { state: 'UNKNOWN', revision: null, persistedAtMs: null },
    queue: null,
    lastFailure: null,
    blockerCodes: ['OWNER_TRUTH_UNKNOWN'],
    generation: 1,
    restartCount: 0,
    capitalExposed: false,
    operatorAttentionRequired: true,
    truthLabel: 'UNAVAILABLE',
    ...overrides,
  };
}

function probeStructural(value) {
  return probeSystemComponent({
    nowMs: NOW,
    correlationId: 'cor-structural-health',
    safeCurrentState: 'READ_ONLY',
    componentId: 'market-intelligence',
    owner: 'MARKET_INTELLIGENCE',
    ownerPath: 'server/src/intelligenceFoundation',
    dependencies: ['intelligence-runtime'],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED'],
    supportedControls: [],
    port: { readComponentProbe: () => value },
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

test('MIS-044 rejects GOOD quality when the producer supplies no quality evidence', () => {
  const result = probeStructural(structuralReading({
    dataQuality: {
      state: 'GOOD', invalidCount: null, duplicateCount: null,
      outOfOrderCount: null, sequenceGapCount: null, observedAtMs: null,
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'COMPONENT_PROBE_INVALID');
  assert.match(result.failure.message, /dataQuality:DATA_QUALITY_GOOD_EVIDENCE_REQUIRED/);
});

test('MIS-044 rejects BACKING_OFF when the producer supplies no retry evidence', () => {
  const result = probeStructural(structuralReading({
    retry: {
      state: 'BACKING_OFF', attempt: null, ceiling: null, delayMs: null,
      retryAtMs: null, cooldownUntilMs: null,
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'COMPONENT_PROBE_INVALID');
  assert.match(result.failure.message, /retry:RETRY_BACKOFF_EVIDENCE_REQUIRED/);
});

test('MIS-044 retry states obey one exhaustive closed invariant table', () => {
  const valid = {
    IDLE: { state: 'IDLE', attempt: 0, ceiling: 8, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    RETRYING: { state: 'RETRYING', attempt: 1, ceiling: 8, delayMs: 0, retryAtMs: NOW, cooldownUntilMs: null },
    BACKING_OFF: { state: 'BACKING_OFF', attempt: 2, ceiling: 8, delayMs: 500, retryAtMs: NOW + 500, cooldownUntilMs: null },
    COOLDOWN: { state: 'COOLDOWN', attempt: 3, ceiling: 8, delayMs: 500, retryAtMs: NOW + 500, cooldownUntilMs: NOW + 1_000 },
    UNKNOWN: { state: 'UNKNOWN', attempt: null, ceiling: null, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    UNAVAILABLE: { state: 'UNAVAILABLE', attempt: null, ceiling: null, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
  };
  for (const [state, retry] of Object.entries(valid)) {
    assert.equal(probeStructural(structuralReading({ retry })).ok, true, state);
  }

  const invalid = {
    IDLE: { ...valid.IDLE, attempt: 1 },
    RETRYING: { state: 'RETRYING', attempt: null, ceiling: null, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    BACKING_OFF: { ...valid.BACKING_OFF, cooldownUntilMs: NOW + 1_000 },
    COOLDOWN: { ...valid.COOLDOWN, cooldownUntilMs: null },
    UNKNOWN: { ...valid.UNKNOWN, attempt: 0 },
    UNAVAILABLE: { ...valid.UNAVAILABLE, ceiling: 8 },
  };
  for (const [state, retry] of Object.entries(invalid)) {
    const result = probeStructural(structuralReading({ retry }));
    assert.equal(result.ok, false, state);
    assert.match(result.failure.message, /retry:/u, state);
  }

  const liveWithRetry = probe({
    source: sourceSnapshot({
      observedState: 'LIVE',
      completeness: 'COMPLETE',
      invalidCount: 0,
      duplicateCount: 0,
      outOfOrderCount: 0,
      sequenceGapCount: 0,
      backoff: { attempt: 1, ceiling: 8, delayMs: 0, retryAtMs: NOW, cooldownUntilMs: null },
    }),
    queue: null,
    observation: null,
  });
  assert.equal(liveWithRetry.ok, false);
  assert.match(liveWithRetry.failure.message, /retry.state:RETRY_LIVE_CONFLICT/u);
});

test('MIS-044 data-quality and checkpoint states obey exhaustive evidence tables', () => {
  const quality = {
    GOOD: { state: 'GOOD', invalidCount: 0, duplicateCount: 0, outOfOrderCount: 0, sequenceGapCount: 0, observedAtMs: NOW },
    DEGRADED: { state: 'DEGRADED', invalidCount: 1, duplicateCount: 0, outOfOrderCount: 0, sequenceGapCount: 0, observedAtMs: NOW },
    UNKNOWN: { state: 'UNKNOWN', invalidCount: null, duplicateCount: null, outOfOrderCount: null, sequenceGapCount: null, observedAtMs: null },
    UNAVAILABLE: { state: 'UNAVAILABLE', invalidCount: null, duplicateCount: null, outOfOrderCount: null, sequenceGapCount: null, observedAtMs: null },
  };
  for (const [state, dataQuality] of Object.entries(quality)) {
    assert.equal(probeStructural(structuralReading({ completeness: 'COMPLETE', dataQuality })).ok, true, state);
  }
  const invalidQuality = {
    GOOD_MISSING: { ...quality.GOOD, observedAtMs: null },
    GOOD_NONZERO: { ...quality.GOOD, duplicateCount: 1 },
    DEGRADED_MISSING: { ...quality.DEGRADED, sequenceGapCount: null },
    UNKNOWN_VALUE: { ...quality.UNKNOWN, invalidCount: 0 },
    UNAVAILABLE_VALUE: { ...quality.UNAVAILABLE, observedAtMs: NOW },
  };
  for (const [state, dataQuality] of Object.entries(invalidQuality)) {
    const result = probeStructural(structuralReading({ completeness: 'COMPLETE', dataQuality }));
    assert.equal(result.ok, false, state);
    assert.match(result.failure.message, /dataQuality:/u, state);
  }

  const checkpoint = {
    CURRENT: { state: 'CURRENT', revision: 'checkpoint-1', persistedAtMs: NOW },
    DIRTY: { state: 'DIRTY', revision: 'checkpoint-1', persistedAtMs: NOW },
    STALE: { state: 'STALE', revision: 'checkpoint-1', persistedAtMs: NOW },
    MISSING: { state: 'MISSING', revision: null, persistedAtMs: null },
    UNKNOWN: { state: 'UNKNOWN', revision: null, persistedAtMs: null },
    UNAVAILABLE: { state: 'UNAVAILABLE', revision: null, persistedAtMs: null },
  };
  for (const [state, value] of Object.entries(checkpoint)) {
    assert.equal(probeStructural(structuralReading({ checkpoint: value })).ok, true, state);
  }
  const invalidCheckpoint = {
    CURRENT: { ...checkpoint.CURRENT, persistedAtMs: null },
    DIRTY: { ...checkpoint.DIRTY, revision: null },
    STALE: { ...checkpoint.STALE, persistedAtMs: null },
    MISSING: { ...checkpoint.MISSING, revision: 'invented' },
    UNKNOWN: { ...checkpoint.UNKNOWN, persistedAtMs: NOW },
    UNAVAILABLE: { ...checkpoint.UNAVAILABLE, revision: 'invented' },
  };
  for (const [state, value] of Object.entries(invalidCheckpoint)) {
    const result = probeStructural(structuralReading({ checkpoint: value }));
    assert.equal(result.ok, false, state);
    assert.match(result.failure.message, /checkpoint:/u, state);
  }
});

test('MIS-044 probes snapshot exact own data once, reject getters and Proxies, and deep-freeze output', () => {
  const reading = structuralReading({
    completeness: 'COMPLETE',
    retry: { state: 'IDLE', attempt: 0, ceiling: 8, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    dataQuality: { state: 'DEGRADED', invalidCount: 1, duplicateCount: 0, outOfOrderCount: 0, sequenceGapCount: 0, observedAtMs: NOW },
    checkpoint: { state: 'CURRENT', revision: 'checkpoint-1', persistedAtMs: NOW },
  });
  const result = probeStructural(reading);
  assert.equal(result.ok, true);
  reading.retry.attempt = 7;
  reading.dataQuality.invalidCount = 99;
  reading.checkpoint.revision = 'mutated';
  reading.blockerCodes.push('MUTATED');
  assert.deepEqual(result.value.retry, {
    state: 'IDLE', attempt: 0, ceiling: 8, delayMs: null, retryAtMs: null, cooldownUntilMs: null,
  });
  assert.equal(result.value.dataQuality.invalidCount, 1);
  assert.equal(result.value.checkpoint.revision, 'checkpoint-1');
  assert.deepEqual(result.value.blockerCodes, ['COMPONENT_TRUTH_UNAVAILABLE', 'OWNER_TRUTH_UNKNOWN']);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.retry), true);
  assert.equal(Object.isFrozen(result.value.dataQuality), true);
  assert.equal(Object.isFrozen(result.value.checkpoint), true);

  let getterReads = 0;
  const hostileRetry = {};
  Object.defineProperties(hostileRetry, {
    state: { enumerable: true, get() { getterReads += 1; return 'IDLE'; } },
    attempt: { enumerable: true, value: 0 },
    ceiling: { enumerable: true, value: 8 },
    delayMs: { enumerable: true, value: null },
    retryAtMs: { enumerable: true, value: null },
    cooldownUntilMs: { enumerable: true, value: null },
  });
  const hostile = probeStructural(structuralReading({ retry: hostileRetry }));
  assert.equal(hostile.ok, false);
  assert.equal(hostile.failure.code, 'COMPONENT_PROBE_READ_FAILED');
  assert.equal(getterReads, 0);

  let proxyReads = 0;
  const proxied = new Proxy(structuralReading(), {
    get(target, key, receiver) {
      proxyReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const rejectedProxy = probeStructural(proxied);
  assert.equal(rejectedProxy.ok, false);
  assert.equal(rejectedProxy.failure.code, 'COMPONENT_PROBE_READ_FAILED');
  assert.equal(proxyReads, 0);
});
