import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalReadModelFromCaptures,
  captureEngineSnapshot,
  probeRuntimeSource,
} from '../../../dist/systemIntegration/adapters/index.js';
import {
  canonicalJson,
  stableHash128Hex,
} from '../../../dist/foundation/contracts/index.js';

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

function captureInput(family, records = {}, overrides = {}) {
  const strategy = family === 'BASIS' ? 'basis' : 'volume_spike';
  const correlationId = family === 'BASIS' ? 'basis-correlation' : 'volume-correlation';
  const proposalId = family === 'BASIS' ? 'basis-proposal-id' : 'volume-proposal-id';
  return {
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
    ...overrides,
  };
}

function capture(family, records = {}, overrides = {}) {
  return captureEngineSnapshot(captureInput(family, records, overrides));
}

async function flushRejectedTurn() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
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
  assert.equal(proposal.evidence.captureRecordRevisionDigest, alias.revisionDigest, 'SC-09 invariant=CANONICAL_EVIDENCE_ANCHORS_REVISION');
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

test('[SC-11] hostile read-model metadata stays an honest structural rejection', () => {
  const invalidNow = buildCanonicalReadModelFromCaptures({
    nowMs: undefined,
    correlationId: 'cor-invalid-now',
    safeCurrentState: 'READ_ONLY',
    basis: null,
    volume: null,
  });
  assert.equal(invalidNow.ok, false, 'SC-11 invariant=INVALID_NOW_REJECTED');
  assert.equal(invalidNow.failureKind, 'STRUCTURAL_INPUT_REJECTION', 'SC-11 invariant=STRUCTURAL_VARIANT');
  assert.equal(invalidNow.structuralFailure.occurredAt, null, 'SC-11 invariant=NO_FORGED_TIME');
  assert.equal(invalidNow.structuralFailure.correlationId, null, 'SC-11 invariant=NO_FORGED_CORRELATION');

  const invalidCorrelation = buildCanonicalReadModelFromCaptures({
    nowMs: NOW,
    correlationId: '',
    safeCurrentState: 'READ_ONLY',
    basis: null,
    volume: null,
  });
  assert.equal(invalidCorrelation.ok, false, 'SC-11 invariant=INVALID_CORRELATION_REJECTED');
  assert.equal(invalidCorrelation.failureKind, 'STRUCTURAL_INPUT_REJECTION', 'SC-11 invariant=CORRELATION_STRUCTURAL_VARIANT');

  let getterReads = 0;
  const accessorInput = {
    correlationId: 'cor-accessor-now',
    safeCurrentState: 'READ_ONLY',
    basis: null,
    volume: null,
  };
  Object.defineProperty(accessorInput, 'nowMs', {
    enumerable: true,
    get() {
      getterReads += 1;
      if (getterReads > 1) throw new Error('adapter reread hostile nowMs getter');
      return undefined;
    },
  });
  const accessorResult = buildCanonicalReadModelFromCaptures(accessorInput);
  assert.equal(accessorResult.failureKind, 'STRUCTURAL_INPUT_REJECTION', 'SC-11 invariant=ACCESSOR_STRUCTURAL_VARIANT');
  assert.equal(getterReads, 0, 'SC-11 invariant=ZERO_ACCESSOR_READS');

  let proxyTraps = 0;
  const proxyInput = new Proxy({ ...CONTEXT, basis: null, volume: null }, {
    get() {
      proxyTraps += 1;
      throw new Error('adapter input Proxy get trap');
    },
    getOwnPropertyDescriptor() {
      proxyTraps += 1;
      throw new Error('adapter input Proxy descriptor trap');
    },
    getPrototypeOf() {
      proxyTraps += 1;
      throw new Error('adapter input Proxy prototype trap');
    },
    ownKeys() {
      proxyTraps += 1;
      throw new Error('adapter input Proxy ownKeys trap');
    },
  });
  const proxyResult = buildCanonicalReadModelFromCaptures(proxyInput);
  assert.equal(proxyResult.failureKind, 'STRUCTURAL_INPUT_REJECTION', 'SC-11 invariant=PROXY_STRUCTURAL_VARIANT');
  assert.equal(proxyTraps, 0, 'SC-11 invariant=ZERO_PROXY_TRAPS');
});

test('[SC-12] capture boundary snapshots metadata and port descriptors without invoking hostile code', () => {
  let wholeInputTraps = 0;
  const wholeInputProxy = new Proxy(captureInput('BASIS'), {
    get() {
      wholeInputTraps += 1;
      throw new Error('whole capture input get trap');
    },
    getOwnPropertyDescriptor() {
      wholeInputTraps += 1;
      throw new Error('whole capture input descriptor trap');
    },
    getPrototypeOf() {
      wholeInputTraps += 1;
      throw new Error('whole capture input prototype trap');
    },
    ownKeys() {
      wholeInputTraps += 1;
      throw new Error('whole capture input ownKeys trap');
    },
  });
  const wholeInputResult = captureEngineSnapshot(wholeInputProxy);
  assert.equal(wholeInputResult.failureKind, 'STRUCTURAL_INPUT_REJECTION', 'SC-12 invariant=WHOLE_INPUT_STRUCTURAL_REJECTION');
  assert.equal(wholeInputResult.structuralFailure.occurredAt, null, 'SC-12 invariant=WHOLE_INPUT_NO_FORGED_TIME');
  assert.equal(wholeInputTraps, 0, 'SC-12 invariant=WHOLE_INPUT_ZERO_TRAPS');

  let familyGetterReads = 0;
  const familyAccessorInput = captureInput('BASIS');
  Object.defineProperty(familyAccessorInput, 'family', {
    enumerable: true,
    get() {
      familyGetterReads += 1;
      throw new Error('family accessor invoked');
    },
  });
  const familyAccessorResult = captureEngineSnapshot(familyAccessorInput);
  assert.equal(familyAccessorResult.ok, false, 'SC-12 invariant=FAMILY_ACCESSOR_REJECTED');
  assert.equal('failureKind' in familyAccessorResult, false, 'SC-12 invariant=TRUSTED_METADATA_USES_STRUCTURED_FAILURE');
  assert.equal(familyAccessorResult.failure.occurredAt, NOW, 'SC-12 invariant=TRUSTED_TIME_PRESERVED');
  assert.equal(familyAccessorResult.failure.correlationId, CONTEXT.correlationId, 'SC-12 invariant=TRUSTED_CORRELATION_PRESERVED');
  assert.equal(familyGetterReads, 0, 'SC-12 invariant=FAMILY_ACCESSOR_ZERO_READS');

  const customPrototypeCaptureInput = Object.assign(
    Object.create({ inherited: true }),
    captureInput('BASIS'),
  );
  const customPrototypeCaptureResult = captureEngineSnapshot(customPrototypeCaptureInput);
  assert.equal(customPrototypeCaptureResult.ok, false, 'SC-12 invariant=CUSTOM_PROTOTYPE_OUTER_REJECTED');
  assert.equal('failureKind' in customPrototypeCaptureResult, false, 'SC-12 invariant=CUSTOM_PROTOTYPE_OUTER_HAS_TRUSTED_METADATA');
  assert.equal(customPrototypeCaptureResult.failure.occurredAt, NOW, 'SC-12 invariant=CUSTOM_PROTOTYPE_OUTER_TRUSTED_TIME');
  assert.equal(customPrototypeCaptureResult.failure.correlationId, CONTEXT.correlationId, 'SC-12 invariant=CUSTOM_PROTOTYPE_OUTER_TRUSTED_CORRELATION');

  const arrayCaptureInput = Object.assign([], captureInput('BASIS'));
  const arrayCaptureResult = captureEngineSnapshot(arrayCaptureInput);
  assert.equal(arrayCaptureResult.ok, false, 'SC-12 invariant=ARRAY_OUTER_REJECTED');
  assert.equal('failureKind' in arrayCaptureResult, false, 'SC-12 invariant=ARRAY_OUTER_HAS_TRUSTED_METADATA');
  assert.equal(arrayCaptureResult.failure.occurredAt, NOW, 'SC-12 invariant=ARRAY_OUTER_TRUSTED_TIME');

  let portTraps = 0;
  const hostilePort = new Proxy({
    readDecisions: () => [],
    readProposals: () => [],
  }, {
    get() {
      portTraps += 1;
      throw new Error('capture port get trap');
    },
    getOwnPropertyDescriptor() {
      portTraps += 1;
      throw new Error('capture port descriptor trap');
    },
    getPrototypeOf() {
      portTraps += 1;
      throw new Error('capture port prototype trap');
    },
    ownKeys() {
      portTraps += 1;
      throw new Error('capture port ownKeys trap');
    },
  });
  const portResult = captureEngineSnapshot(captureInput('BASIS', {}, { port: hostilePort }));
  assert.equal(portResult.ok, false, 'SC-12 invariant=PORT_PROXY_REJECTED');
  assert.equal(portResult.failure.occurredAt, NOW, 'SC-12 invariant=PORT_FAILURE_TRUSTED_TIME');
  assert.equal(portTraps, 0, 'SC-12 invariant=PORT_PROXY_ZERO_TRAPS');

  let methodGetterReads = 0;
  const accessorPort = { readProposals: () => [] };
  Object.defineProperty(accessorPort, 'readDecisions', {
    enumerable: true,
    get() {
      methodGetterReads += 1;
      throw new Error('port method accessor invoked');
    },
  });
  const methodResult = captureEngineSnapshot(captureInput('BASIS', {}, { port: accessorPort }));
  assert.equal(methodResult.ok, false, 'SC-12 invariant=PORT_METHOD_ACCESSOR_REJECTED');
  assert.equal(methodGetterReads, 0, 'SC-12 invariant=PORT_METHOD_ACCESSOR_ZERO_READS');

  let resultArrayTraps = 0;
  const hostileResultArray = new Proxy([], {
    get() {
      resultArrayTraps += 1;
      throw new Error('port result array get trap');
    },
    getOwnPropertyDescriptor() {
      resultArrayTraps += 1;
      throw new Error('port result array descriptor trap');
    },
    getPrototypeOf() {
      resultArrayTraps += 1;
      throw new Error('port result array prototype trap');
    },
    ownKeys() {
      resultArrayTraps += 1;
      throw new Error('port result array ownKeys trap');
    },
  });
  const resultArrayResult = captureEngineSnapshot(captureInput('BASIS', {}, {
    port: { readDecisions: () => hostileResultArray, readProposals: () => [] },
  }));
  assert.equal(resultArrayResult.ok, false, 'SC-12 invariant=PORT_RESULT_PROXY_REJECTED');
  assert.equal(resultArrayResult.failure.code, 'ENGINE_CAPTURE_PORT_INVALID', 'SC-12 invariant=PORT_RESULT_NAMED_FAILURE');
  assert.equal(resultArrayTraps, 0, 'SC-12 invariant=PORT_RESULT_PROXY_ZERO_TRAPS');
});

test('[SC-13] hostile records and bounded evidence become per-record rejects while healthy siblings survive', () => {
  let recordTraps = 0;
  const hostileRecord = new Proxy(decision('basis', 'cor-proxy-record'), {
    get() {
      recordTraps += 1;
      throw new Error('decision Proxy get trap');
    },
    getOwnPropertyDescriptor() {
      recordTraps += 1;
      throw new Error('decision Proxy descriptor trap');
    },
    getPrototypeOf() {
      recordTraps += 1;
      throw new Error('decision Proxy prototype trap');
    },
    ownKeys() {
      recordTraps += 1;
      throw new Error('decision Proxy ownKeys trap');
    },
  });

  let recordGetterReads = 0;
  const accessorRecord = decision('basis', 'cor-accessor-record');
  Object.defineProperty(accessorRecord, 'strategy', {
    enumerable: true,
    get() {
      recordGetterReads += 1;
      throw new Error('decision strategy accessor invoked');
    },
  });

  let evidenceTraps = 0;
  const hostileEvidence = new Proxy({ value: 1 }, {
    get() {
      evidenceTraps += 1;
      throw new Error('evidence Proxy get trap');
    },
    getOwnPropertyDescriptor() {
      evidenceTraps += 1;
      throw new Error('evidence Proxy descriptor trap');
    },
    getPrototypeOf() {
      evidenceTraps += 1;
      throw new Error('evidence Proxy prototype trap');
    },
    ownKeys() {
      evidenceTraps += 1;
      throw new Error('evidence Proxy ownKeys trap');
    },
  });

  let deepEvidence = { leaf: true };
  for (let depth = 0; depth < 40; depth += 1) deepEvidence = { next: deepEvidence };
  const tooManyKeys = Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [`key${index}`, index]));
  const tooLongKey = { ['k'.repeat(1_025)]: true };
  const tooManyNodes = {
    left: Array.from({ length: 9_999 }, () => 0),
    right: Array.from({ length: 9_999 }, () => 0),
  };
  const tooManyBytes = {
    left: 'x'.repeat(262_144),
    right: 'y'.repeat(262_144),
  };

  let proposalRecordTraps = 0;
  const hostileProposalRecord = new Proxy(engineProposal('basis', 'proposal-proxy', 'cor-proposal-proxy'), {
    get() {
      proposalRecordTraps += 1;
      throw new Error('proposal Proxy get trap');
    },
    getOwnPropertyDescriptor() {
      proposalRecordTraps += 1;
      throw new Error('proposal Proxy descriptor trap');
    },
    getPrototypeOf() {
      proposalRecordTraps += 1;
      throw new Error('proposal Proxy prototype trap');
    },
    ownKeys() {
      proposalRecordTraps += 1;
      throw new Error('proposal Proxy ownKeys trap');
    },
  });
  let proposalGetterReads = 0;
  const accessorProposal = engineProposal('basis', 'proposal-accessor', 'cor-proposal-accessor');
  Object.defineProperty(accessorProposal, 'evidence', {
    enumerable: true,
    get() {
      proposalGetterReads += 1;
      throw new Error('proposal evidence accessor invoked');
    },
  });

  const invalidDecisions = [
    hostileRecord,
    accessorRecord,
    decision('basis', 'cor-evidence-proxy', { evidence: hostileEvidence }),
    decision('basis', 'cor-depth-limit', { evidence: deepEvidence }),
    decision('basis', 'cor-array-limit', { evidence: { values: Array.from({ length: 10_001 }, () => 0) } }),
    decision('basis', 'cor-key-count-limit', { evidence: tooManyKeys }),
    decision('basis', 'cor-key-length-limit', { evidence: tooLongKey }),
    decision('basis', 'cor-string-limit', { evidence: { value: 'x'.repeat(262_145) } }),
    decision('basis', 'cor-node-limit', { evidence: tooManyNodes }),
    decision('basis', 'cor-byte-limit', { evidence: tooManyBytes }),
    decision('volume_spike', 'cor-family-mismatch'),
    decision('basis', 'cor-semantic-invalid', { humanReason: 42 }),
  ];
  const invalidProposals = [
    hostileProposalRecord,
    accessorProposal,
    engineProposal('basis', 'proposal-evidence-proxy', 'cor-proposal-evidence-proxy', { evidence: hostileEvidence }),
    engineProposal('basis', 'proposal-semantic-invalid', 'cor-proposal-semantic-invalid', { confidence: 2 }),
  ];
  const captured = capture('BASIS', {
    decisions: [decision('basis', 'cor-healthy-decision'), ...invalidDecisions],
    proposals: [engineProposal('basis', 'proposal-healthy', 'cor-healthy-proposal'), ...invalidProposals],
  }, { recordLimit: 100 });
  assert.equal(captured.ok, true, 'SC-13 invariant=CAPTURE_RETAINS_HEALTHY_SIBLINGS');
  assert.equal(captured.value.snapshot.decisions.length, 1 + invalidDecisions.length, 'SC-13 invariant=DECISION_COUNT_PRESERVED');
  assert.equal(captured.value.snapshot.proposals.length, 1 + invalidProposals.length, 'SC-13 invariant=PROPOSAL_COUNT_PRESERVED');
  assert.equal(captured.value.identities.length, 2, 'SC-13 invariant=ONLY_HEALTHY_IDENTITIES_REPUBLISHED');
  assert.equal(recordTraps, 0, 'SC-13 invariant=DECISION_PROXY_ZERO_TRAPS');
  assert.equal(recordGetterReads, 0, 'SC-13 invariant=DECISION_ACCESSOR_ZERO_READS');
  assert.equal(evidenceTraps, 0, 'SC-13 invariant=EVIDENCE_PROXY_ZERO_TRAPS');
  assert.equal(proposalRecordTraps, 0, 'SC-13 invariant=PROPOSAL_PROXY_ZERO_TRAPS');
  assert.equal(proposalGetterReads, 0, 'SC-13 invariant=PROPOSAL_ACCESSOR_ZERO_READS');

  const combined = buildCanonicalReadModelFromCaptures({ ...CONTEXT, basis: captured.value, volume: null });
  assert.equal(combined.ok, true, 'SC-13 invariant=READ_MODEL_BUILT');
  assert.equal(combined.value.view.basis.presence, 'PRESENT', 'SC-13 invariant=SOURCE_TRUTH_REMAINS_PRESENT');
  assert.equal(combined.value.view.basis.reconciliation.canonicalDecisions, 1, 'SC-13 invariant=HEALTHY_DECISION_VISIBLE');
  assert.equal(combined.value.view.basis.reconciliation.rejectedDecisions, invalidDecisions.length, 'SC-13 invariant=HOSTILE_DECISIONS_BALANCED');
  assert.equal(combined.value.view.basis.reconciliation.canonicalProposals, 1, 'SC-13 invariant=HEALTHY_PROPOSAL_VISIBLE');
  assert.equal(combined.value.view.basis.reconciliation.rejectedProposals, invalidProposals.length, 'SC-13 invariant=HOSTILE_PROPOSALS_BALANCED');
  assert.equal(combined.value.view.reconciliation.balanced, true, 'SC-13 invariant=GLOBAL_RECONCILIATION_BALANCED');
});

test('[SC-14] capture identities are closed bounded content-addressed clones and ordinary shape failures retain trusted metadata', () => {
  const basis = capture('BASIS');
  assert.equal(basis.ok, true, 'SC-14 invariant=FIXTURE_CAPTURED');
  const sourceAlias = basis.value.identities[0];
  const mutableAlias = { ...sourceAlias };
  const mutableProjection = {
    ...basis.value,
    identities: [mutableAlias, ...basis.value.identities.slice(1)],
  };
  const cloned = buildCanonicalReadModelFromCaptures({ ...CONTEXT, basis: mutableProjection, volume: null });
  assert.equal(cloned.ok, true, 'SC-14 invariant=MUTABLE_PLAIN_ALIAS_ACCEPTED_BY_VALUE');
  const retainedOwnerId = cloned.value.identities[0].ownerId;
  mutableAlias.ownerId = 'mutated-after-build';
  assert.equal(cloned.value.identities[0].ownerId, retainedOwnerId, 'SC-14 invariant=ALIAS_DOES_NOT_RETAIN_MUTABLE_REFERENCE');
  assert.notEqual(cloned.value.identities[0], mutableAlias, 'SC-14 invariant=ALIAS_CLONED');
  assert.equal(Object.isFrozen(cloned.value.identities[0]), true, 'SC-14 invariant=ALIAS_FROZEN');

  const correlationMismatch = buildCanonicalReadModelFromCaptures({
    ...CONTEXT,
    correlationId: 'cor-different-build-context',
    basis: basis.value,
    volume: null,
  });
  assert.equal(correlationMismatch.ok, false, 'SC-14 invariant=ALIAS_CORRELATION_CONTEXT_MISMATCH_REJECTED');
  assert.equal(correlationMismatch.failure.code, 'ENGINE_IDENTITY_BINDING_INVALID', 'SC-14 invariant=ALIAS_CORRELATION_CONTEXT_NAMED_FAILURE');

  const revisionCapture = capture('BASIS', {
    readRecordRevision: (kind, ownerId) => `${kind.toLowerCase()}-${ownerId}-revision-anchor`,
  });
  assert.equal(revisionCapture.ok, true, 'SC-14 invariant=REVISION_FIXTURE_CAPTURED');
  const revisionAlias = revisionCapture.value.identities[0];
  const changedRevisionAlias = {
    ...revisionAlias,
    revisionDigest: `${revisionAlias.revisionDigest}-changed`,
  };
  const changedRevisionIdentities = [
    changedRevisionAlias,
    ...revisionCapture.value.identities.slice(1),
  ];
  const recomputedIdentityBindingDigest = `engine-identity-binding-${stableHash128Hex(canonicalJson({
    family: revisionCapture.value.family,
    identities: changedRevisionIdentities,
  }))}`;
  const revisionMutation = buildCanonicalReadModelFromCaptures({
    ...CONTEXT,
    basis: {
      ...revisionCapture.value,
      identities: changedRevisionIdentities,
      identityBindingDigest: recomputedIdentityBindingDigest,
    },
    volume: null,
  });
  assert.equal(revisionMutation.ok, false, 'SC-14 invariant=ALIAS_REVISION_MUTATION_REJECTED');
  assert.equal(revisionMutation.failure.code, 'ENGINE_IDENTITY_BINDING_INVALID', 'SC-14 invariant=ALIAS_REVISION_CANONICAL_ANCHOR_NAMED_FAILURE');

  let aliasTraps = 0;
  const aliasProxy = new Proxy({ ...sourceAlias }, {
    get() {
      aliasTraps += 1;
      throw new Error('identity alias get trap');
    },
    getOwnPropertyDescriptor() {
      aliasTraps += 1;
      throw new Error('identity alias descriptor trap');
    },
    getPrototypeOf() {
      aliasTraps += 1;
      throw new Error('identity alias prototype trap');
    },
    ownKeys() {
      aliasTraps += 1;
      throw new Error('identity alias ownKeys trap');
    },
  });
  let aliasGetterReads = 0;
  const aliasAccessor = { ...sourceAlias };
  Object.defineProperty(aliasAccessor, 'systemId', {
    enumerable: true,
    get() {
      aliasGetterReads += 1;
      throw new Error('identity alias accessor invoked');
    },
  });
  const aliasWithSymbol = { ...sourceAlias, [Symbol('hostile')]: true };
  const aliasWithUnknownField = { ...sourceAlias, unknownField: true };
  const aliasWithCustomPrototype = Object.assign(Object.create({ inherited: true }), sourceAlias);
  const aliasWithOversizedId = { ...sourceAlias, systemId: 'x'.repeat(257) };

  for (const [label, invalidAlias] of [
    ['proxy', aliasProxy],
    ['accessor', aliasAccessor],
    ['symbol', aliasWithSymbol],
    ['unknown', aliasWithUnknownField],
    ['custom-prototype', aliasWithCustomPrototype],
    ['oversized', aliasWithOversizedId],
  ]) {
    const result = buildCanonicalReadModelFromCaptures({
      ...CONTEXT,
      basis: { ...basis.value, identities: [invalidAlias, ...basis.value.identities.slice(1)] },
      volume: null,
    });
    assert.equal(result.ok, false, `SC-14 invariant=${label.toUpperCase()}_ALIAS_REJECTED`);
    assert.equal('failureKind' in result, false, `SC-14 invariant=${label.toUpperCase()}_USES_TRUSTED_FAILURE`);
    assert.equal(result.failure.occurredAt, NOW, `SC-14 invariant=${label.toUpperCase()}_TRUSTED_TIME`);
    assert.equal(result.failure.correlationId, CONTEXT.correlationId, `SC-14 invariant=${label.toUpperCase()}_TRUSTED_CORRELATION`);
  }
  assert.equal(aliasTraps, 0, 'SC-14 invariant=ALIAS_PROXY_ZERO_TRAPS');
  assert.equal(aliasGetterReads, 0, 'SC-14 invariant=ALIAS_ACCESSOR_ZERO_READS');

  const forgedAlias = {
    ...sourceAlias,
    owner: 'VOLUME_ENGINE',
    ownerId: 'unrelated-owner',
    canonicalProjectionId: 'cprop_unrelated',
  };
  const forgedResult = buildCanonicalReadModelFromCaptures({
    ...CONTEXT,
    basis: { ...basis.value, identities: [forgedAlias, ...basis.value.identities.slice(1)] },
    volume: null,
  });
  assert.equal(forgedResult.ok, false, 'SC-14 invariant=CROSS_FAMILY_ALIAS_REJECTED');
  assert.equal(forgedResult.failure.code, 'ENGINE_CAPTURE_INPUT_INVALID', 'SC-14 invariant=ALIAS_CONTENT_ADDRESS_NAMED_FAILURE');
  assert.equal(forgedResult.failure.occurredAt, NOW, 'SC-14 invariant=ALIAS_BINDING_TRUSTED_TIME');

  let basisGetterReads = 0;
  const capturedInput = { ...CONTEXT, volume: null };
  Object.defineProperty(capturedInput, 'basis', {
    enumerable: true,
    get() {
      basisGetterReads += 1;
      throw new Error('basis capture accessor invoked');
    },
  });
  const capturedInputResult = buildCanonicalReadModelFromCaptures(capturedInput);
  assert.equal(capturedInputResult.ok, false, 'SC-14 invariant=CAPTURE_ACCESSOR_REJECTED');
  assert.equal('failureKind' in capturedInputResult, false, 'SC-14 invariant=CAPTURE_ACCESSOR_NOT_METADATA_FAILURE');
  assert.equal(capturedInputResult.failure.occurredAt, NOW, 'SC-14 invariant=CAPTURE_ACCESSOR_TRUSTED_TIME');
  assert.equal(capturedInputResult.failure.correlationId, CONTEXT.correlationId, 'SC-14 invariant=CAPTURE_ACCESSOR_TRUSTED_CORRELATION');
  assert.equal(basisGetterReads, 0, 'SC-14 invariant=CAPTURE_ACCESSOR_ZERO_READS');

  const customPrototypeCapturedInput = Object.assign(
    Object.create({ inherited: true }),
    { ...CONTEXT, basis: basis.value, volume: null },
  );
  const customPrototypeCapturedResult = buildCanonicalReadModelFromCaptures(customPrototypeCapturedInput);
  assert.equal(customPrototypeCapturedResult.ok, false, 'SC-14 invariant=CUSTOM_PROTOTYPE_CAPTURE_INPUT_REJECTED');
  assert.equal('failureKind' in customPrototypeCapturedResult, false, 'SC-14 invariant=CUSTOM_PROTOTYPE_CAPTURE_INPUT_HAS_TRUSTED_METADATA');
  assert.equal(customPrototypeCapturedResult.failure.occurredAt, NOW, 'SC-14 invariant=CUSTOM_PROTOTYPE_CAPTURE_INPUT_TRUSTED_TIME');
  assert.equal(customPrototypeCapturedResult.failure.correlationId, CONTEXT.correlationId, 'SC-14 invariant=CUSTOM_PROTOTYPE_CAPTURE_INPUT_TRUSTED_CORRELATION');

  const arrayCapturedInput = Object.assign([], { ...CONTEXT, basis: basis.value, volume: null });
  const arrayCapturedResult = buildCanonicalReadModelFromCaptures(arrayCapturedInput);
  assert.equal(arrayCapturedResult.ok, false, 'SC-14 invariant=ARRAY_CAPTURE_INPUT_REJECTED');
  assert.equal('failureKind' in arrayCapturedResult, false, 'SC-14 invariant=ARRAY_CAPTURE_INPUT_HAS_TRUSTED_METADATA');
  assert.equal(arrayCapturedResult.failure.occurredAt, NOW, 'SC-14 invariant=ARRAY_CAPTURE_INPUT_TRUSTED_TIME');
});

test('[SC-15] rejected Promise port results are observed before synchronous shape rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const decisionPromiseResult = captureEngineSnapshot(captureInput('BASIS', {}, {
      port: {
        readDecisions: () => Promise.reject(new Error('hidden decision-port rejection')),
        readProposals: () => [],
      },
    }));
    assert.equal(decisionPromiseResult.ok, false, 'SC-15 invariant=DECISION_PROMISE_REJECTED_SYNCHRONOUSLY');
    assert.equal(decisionPromiseResult.failure.code, 'ENGINE_CAPTURE_PORT_INVALID', 'SC-15 invariant=DECISION_PROMISE_NAMED_FAILURE');

    const proposalPromiseResult = captureEngineSnapshot(captureInput('BASIS', {}, {
      port: {
        readDecisions: () => [],
        readProposals: () => new Promise((_resolve, reject) => queueMicrotask(() => reject(new Error('hidden proposal-port rejection')))),
      },
    }));
    assert.equal(proposalPromiseResult.ok, false, 'SC-15 invariant=PROPOSAL_PROMISE_REJECTED_SYNCHRONOUSLY');
    assert.equal(proposalPromiseResult.failure.code, 'ENGINE_CAPTURE_PORT_INVALID', 'SC-15 invariant=PROPOSAL_PROMISE_NAMED_FAILURE');

    const revisionPromiseResult = capture('BASIS', {
      readRecordRevision: () => Promise.reject(new Error('hidden revision-port rejection')),
    });
    assert.equal(revisionPromiseResult.ok, true, 'SC-15 invariant=REVISION_PROMISE_DEGRADES_TO_UNAVAILABLE');
    assert.equal(revisionPromiseResult.value.identities.every((identity) => identity.revisionDigest === null), true, 'SC-15 invariant=REVISION_PROMISE_NEVER_FABRICATES_REVISION');
    assert.equal(revisionPromiseResult.losses.filter((loss) => loss.code === 'REVISION_UNAVAILABLE').length, 2, 'SC-15 invariant=REVISION_PROMISE_LOSS_EXPLICIT_PER_RECORD');

    await flushRejectedTurn();
    assert.equal(unhandled.length, 0, 'SC-15 invariant=ZERO_UNHANDLED_PORT_REJECTIONS');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
