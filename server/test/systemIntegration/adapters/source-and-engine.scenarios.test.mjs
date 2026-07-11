import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalReadModelFromCaptures,
  captureEngineSnapshot,
  probeRuntimeSource,
} from '../../../dist/systemIntegration/adapters/index.js';

const NOW = 1_810_000_000_000;
const CONTEXT = Object.freeze({
  nowMs: NOW,
  correlationId: 'cor-scenario-harness',
  safeCurrentState: 'READ_ONLY',
});

function runtimeSource(sourceId, overrides = {}) {
  return {
    sourceId,
    transportKind: 'INJECTED',
    endpointClass: 'MARKET',
    productFamily: sourceId.includes('usdm') ? 'USD_M_PERPETUAL' : 'SPOT',
    desiredState: 'RUNNING',
    observedState: 'LIVE',
    connectionGeneration: 3,
    connectedAtMs: NOW - 10_000,
    lastMessageSourceTimeMs: NOW - 120,
    lastMessageReceiveTimeMs: NOW - 100,
    lastProcessedTimeMs: NOW - 90,
    messageAgeMs: 100,
    processingLagMs: 10,
    messageCount: 50,
    invalidCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    droppedCount: 0,
    coalescedCount: 0,
    reconnectCount: 1,
    backoff: { attempt: 0, ceiling: 10, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    rateBudget: {
      state: 'AVAILABLE', usedWeight: null, limit: null, intervalMs: null,
      resetsAtMs: null, retryAfterMs: null, observedAtMs: NOW - 100,
    },
    lastError: null,
    recommendedAction: 'No action required.',
    authority: 'COMPLETE',
    completeness: 'COMPLETE',
    snapshotTimeMs: NOW,
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    quietSymbolsRetained: true,
    retainedSymbols: [{ symbol: 'BTCUSDT', lastActivityAtMs: NOW - 100 }],
    focus: null,
    focusedBooks: [],
    rejectedSignals: [],
    proposalIds: [],
    ...overrides,
  };
}

function reading(sourceId, overrides = {}) {
  return {
    source: runtimeSource(sourceId),
    queue: {
      depth: 0,
      capacity: 100,
      dropped: 0,
      coalesced: 0,
      observedAtMs: NOW,
      resyncRequired: false,
    },
    observation: observation(),
    ...overrides,
  };
}

function sourceProbe(componentId, value) {
  const sourceId = componentId === 'public-spot-source' ? 'spot-public-source' : 'usdm-public-source';
  return probeRuntimeSource({
    ...CONTEXT,
    componentId,
    expectedSourceId: sourceId,
    owner: 'INTELLIGENCE_RUNTIME',
    ownerPath: 'server/src/intelligenceRuntime',
    acquisitionAuthority: 'SYNTHETIC_TEST',
    maxAgeMs: 1_000,
    dependencies: [],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'SYNTHETIC_ONLY'],
    supportedControls: ['SET_COMPONENT_STATE', 'RESTART_COMPONENT'],
    port: { readRuntimeSourceProbe: () => value },
  });
}

function decision(strategy, correlationId, overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    ts: NOW - 150,
    strategy,
    kind: 'proposal',
    rejectCode: null,
    humanReason: 'exact engine decision',
    correlationId,
    evidence: {
      direction: strategy === 'basis' ? 'long_spot_short_perp' : 'long',
      netEdgePct: strategy === 'basis' ? 0.31 : null,
      confidence: 0.72,
      borrowStatus: 'not_needed',
    },
    ...overrides,
  };
}

function engineProposal(strategy, id, correlationId, overrides = {}) {
  return {
    id,
    correlationId,
    strategy,
    symbol: 'BTCUSDT',
    direction: strategy === 'basis' ? 'long_spot_short_perp' : 'long',
    createdTs: NOW - 300,
    updatedTs: NOW - 150,
    status: 'open',
    reason: 'exact source proposal',
    grossEdgePct: 0.5,
    netEdgePct: strategy === 'basis' ? 0.31 : null,
    fundingAdjPct: strategy === 'basis' ? 0.01 : null,
    borrowRequired: false,
    borrowStatus: 'not_needed',
    suggestedNotionalUsd: 100,
    confidence: 0.72,
    invalidation: 'source-owned invalidation',
    evidence: { sourceFact: 'retained' },
    ...overrides,
  };
}

function capture(family, records = {}) {
  const strategy = family === 'BASIS' ? 'basis' : 'volume_spike';
  const correlationId = family === 'BASIS' ? 'basis-correlation' : 'volume-correlation';
  const proposalId = family === 'BASIS' ? 'basis-proposal-id' : 'volume-proposal-id';
  return captureEngineSnapshot({
    ...CONTEXT,
    family,
    sourceId: family === 'BASIS' ? 'engine.basis.snapshot' : 'engine.volume.snapshot',
    snapshotTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    configVersion: family === 'BASIS' ? 'basis-config-v9' : 'volume-config-v4',
    port: {
      readDecisions: () => records.decisions ?? [decision(strategy, correlationId)],
      readProposals: () => records.proposals ?? [engineProposal(strategy, proposalId, correlationId)],
      readRecordRevision: records.readRecordRevision,
    },
  });
}

test('[SC-02] public Spot unavailable while Futures remains live', () => {
  const spot = sourceProbe('public-spot-source', null);
  const futures = sourceProbe('public-usdm-source', reading('usdm-public-source'));
  assert.equal(spot.ok, true, 'SC-02 invariant=SPOT_PROJECTION_EXISTS');
  assert.equal(spot.value.component.readiness, 'BLOCKED', 'SC-02 invariant=SPOT_BLOCKED');
  assert.equal(futures.ok, true, 'SC-02 invariant=FUTURES_PROJECTION_EXISTS');
  assert.equal(futures.value.component.readiness, 'READY', 'SC-02 invariant=FUTURES_REMAINS_READY');
});

test('[SC-03] public Futures unavailable while Spot remains live', () => {
  const spot = sourceProbe('public-spot-source', reading('spot-public-source'));
  const futures = sourceProbe('public-usdm-source', null);
  assert.equal(spot.ok, true, 'SC-03 invariant=SPOT_PROJECTION_EXISTS');
  assert.equal(spot.value.component.readiness, 'READY', 'SC-03 invariant=SPOT_REMAINS_READY');
  assert.equal(futures.ok, true, 'SC-03 invariant=FUTURES_PROJECTION_EXISTS');
  assert.equal(futures.value.component.readiness, 'BLOCKED', 'SC-03 invariant=FUTURES_BLOCKED');
});

test('[SC-04] socket open but silent becomes degraded and stale truth cannot remain ready', () => {
  for (const observedState of ['SILENT', 'STALE']) {
    const value = reading('spot-public-source', {
      source: runtimeSource('spot-public-source', {
        observedState,
        lastMessageSourceTimeMs: NOW - 5_000,
        lastMessageReceiveTimeMs: NOW - 4_900,
        lastProcessedTimeMs: NOW - 4_800,
        messageAgeMs: 4_900,
      }),
    });
    const result = sourceProbe('public-spot-source', value);
    assert.equal(result.ok, true, `SC-04 invariant=${observedState}_PROJECTED`);
    assert.equal(result.value.component.readiness, 'DEGRADED', `SC-04 invariant=${observedState}_NOT_READY`);
    assert.equal(result.value.component.freshness.state, 'STALE', `SC-04 invariant=${observedState}_STALE`);
    assert.equal(result.value.component.truthLabel, 'UNAVAILABLE', `SC-04 invariant=${observedState}_NOT_LIVE_LABEL`);
  }
});

test('[SC-05] sequence gap invalidates focused book truth and retains the resync request', () => {
  const value = reading('spot-public-source', {
    source: runtimeSource('spot-public-source', { observedState: 'DEGRADED', sequenceGapCount: 1, completeness: 'PARTIAL' }),
    queue: {
      depth: 1, capacity: 100, dropped: 0, coalesced: 0, observedAtMs: NOW, resyncRequired: true,
    },
    observation: observation({
      focusedBooks: [{
        sourceId: 'spot-depth-btc',
        symbol: 'BTCUSDT',
        sequenceComplete: false,
        pendingResyncRequestId: 'resync-btc-1',
        reasonCode: 'SEQUENCE_GAP',
      }],
    }),
  });
  const result = sourceProbe('public-spot-source', value);
  assert.equal(result.ok, true, 'SC-05 invariant=GAP_PROJECTED');
  assert.equal(result.value.resyncRequired, true, 'SC-05 invariant=RESYNC_REQUIRED');
  assert.ok(result.value.component.blockerCodes.includes('SEQUENCE_GAP'), 'SC-05 invariant=NAMED_GAP_BLOCKER');
  assert.equal(result.value.observation.focusedBooks[0].sequenceComplete, false, 'SC-05 invariant=BOOK_INVALID');
  assert.equal(result.value.observation.focusedBooks[0].pendingResyncRequestId, 'resync-btc-1', 'SC-05 invariant=REQUEST_RETAINED');
});

test('[SC-06] quiet symbol remains in the universe projection without fabricated activity', () => {
  const result = sourceProbe('public-spot-source', reading('spot-public-source', {
    observation: observation({
      retainedSymbols: [
        { symbol: 'BTCUSDT', lastActivityAtMs: NOW - 100 },
        { symbol: 'QUIETUSDT', lastActivityAtMs: null },
      ],
    }),
  }));
  assert.equal(result.ok, true, 'SC-06 invariant=SOURCE_PROJECTED');
  assert.equal(result.value.observation.quietSymbolsRetained, true, 'SC-06 invariant=QUIET_RETENTION_DECLARED');
  const quiet = result.value.observation.retainedSymbols.find((entry) => entry.symbol === 'QUIETUSDT');
  assert.ok(quiet, 'SC-06 invariant=QUIET_SYMBOL_PRESENT');
  assert.equal(quiet.lastActivityAtMs, null, 'SC-06 invariant=NO_FAKE_ACTIVITY_TIME');
});

test('[SC-07] dormant-to-active evidence promotion remains bounded by the owner focus capacity', () => {
  const result = sourceProbe('public-spot-source', reading('spot-public-source', {
    observation: observation({
      retainedSymbols: [{ symbol: 'DORMANTUSDT', lastActivityAtMs: NOW - 10 }],
      focus: {
        capacity: 2,
        requestedSymbols: ['DORMANTUSDT'],
        readySymbols: ['DORMANTUSDT'],
        promotionCorrelationIds: ['cor-dormant-wakeup'],
      },
    }),
  }));
  assert.equal(result.ok, true, 'SC-07 invariant=FOCUS_PROJECTED');
  assert.deepEqual(result.value.observation.focus.readySymbols, ['DORMANTUSDT'], 'SC-07 invariant=PROMOTION_RETAINED');
  assert.ok(result.value.observation.focus.readySymbols.length <= result.value.observation.focus.capacity, 'SC-07 invariant=FOCUS_BOUNDED');
  assert.equal(result.value.component.blockerCodes.includes('FOCUS_CAPACITY_EXCEEDED'), false, 'SC-07 invariant=NO_CAPACITY_BREACH');
});

test('[SC-08] one-print noise stays rejected and cannot appear as a proposal', () => {
  const result = sourceProbe('public-spot-source', reading('spot-public-source', {
    observation: observation({
      rejectedSignals: [{ correlationId: 'cor-one-print', symbol: 'NOISEUSDT', code: 'ONE_PRINT_SPIKE' }],
      proposalIds: [],
    }),
  }));
  assert.equal(result.ok, true, 'SC-08 invariant=NOISE_PROJECTED');
  assert.equal(result.value.observation.rejectedSignals[0].code, 'ONE_PRINT_SPIKE', 'SC-08 invariant=NAMED_REJECTION');
  assert.deepEqual(result.value.observation.proposalIds, [], 'SC-08 invariant=ZERO_PROPOSALS');
});

test('[SC-09] Basis proposal preserves engine identity, record revision, config, and correlation', () => {
  const basis = capture('BASIS', {
    readRecordRevision: (kind, ownerId) => `${kind.toLowerCase()}-${ownerId}-rev-3`,
  });
  assert.equal(basis.ok, true, 'SC-09 invariant=BASIS_CAPTURED');
  const combined = buildCanonicalReadModelFromCaptures({ ...CONTEXT, basis: basis.value, volume: null });
  assert.equal(combined.ok, true, 'SC-09 invariant=READ_MODEL_BUILT');
  const proposal = combined.value.view.basis.proposals[0];
  assert.equal(proposal.sourceId, 'basis-proposal-id', 'SC-09 invariant=SOURCE_ID_EXACT');
  assert.equal(proposal.configVersion, 'basis-config-v9', 'SC-09 invariant=CONFIG_REVISION_EXACT');
  assert.equal(combined.value.view.correlationId, CONTEXT.correlationId, 'SC-09 invariant=CORRELATION_EXACT');
  const alias = basis.value.identities.find((entry) => entry.ownerId === 'basis-proposal-id');
  assert.equal(alias.revisionDigest, 'proposal-basis-proposal-id-rev-3', 'SC-09 invariant=RECORD_REVISION_EXACT');
  assert.equal(basis.losses.some((entry) => entry.code === 'REVISION_UNAVAILABLE'), false, 'SC-09 invariant=NO_FALSE_REVISION_LOSS');
});

test('[SC-10] Volume proposal remains advisory under the restricted adapter authority', () => {
  const volume = capture('VOLUME');
  assert.equal(volume.ok, true, 'SC-10 invariant=VOLUME_CAPTURED');
  assert.equal(volume.value.maximumActionAuthority, 'ADVISORY', 'SC-10 invariant=ADVISORY_ONLY');
  assert.equal(volume.value.capitalReservationAuthority, 'NONE', 'SC-10 invariant=NO_RESERVATION_AUTHORITY');
  assert.equal(volume.value.executionAuthority, 'NONE', 'SC-10 invariant=NO_EXECUTION_AUTHORITY');
  const combined = buildCanonicalReadModelFromCaptures({ ...CONTEXT, basis: null, volume: volume.value });
  assert.equal(combined.ok, true, 'SC-10 invariant=READ_MODEL_BUILT');
  assert.equal(combined.value.view.volume.proposals[0].sourceId, 'volume-proposal-id', 'SC-10 invariant=SOURCE_ID_VISIBLE');
});
