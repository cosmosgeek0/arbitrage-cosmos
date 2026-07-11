import test from 'node:test';
import assert from 'node:assert/strict';

const snapshotModule = await import(process.env.RUNTIME_SNAPSHOT_SOURCE_TEST === '1'
  ? '../../../src/intelligenceRuntime/snapshot/index.ts'
  : '../../../dist/intelligenceRuntime/snapshot/index.js');
const foundationTopologyModule = await import(process.env.RUNTIME_SNAPSHOT_SOURCE_TEST === '1'
  ? '../../../src/intelligenceFoundation/topology/index.ts'
  : '../../../dist/intelligenceFoundation/topology/index.js');
const {
  buildRuntimeIntelligenceSnapshot,
  runtimeComponentId,
  serializeRuntimeIntelligenceSnapshot,
} = snapshotModule;
const {
  createIntelligenceTopologyCatalog,
  intelligenceComponentId,
} = foundationTopologyModule;

const NOW = 1_720_000_000_000;
const AVAILABLE_BUDGET = Object.freeze({
  state: 'AVAILABLE', usedWeight: 10, limit: 1_200, intervalMs: 60_000,
  resetsAtMs: NOW + 30_000, retryAfterMs: null, observedAtMs: NOW - 50,
});

function source(sourceId, component, overrides = {}) {
  const base = {
    sourceId,
    transportKind: 'WEBSOCKET',
    endpointClass: 'MARKET',
    productFamily: component === 'SPOT_BROAD' ? 'SPOT' : 'USD_M_PERPETUAL',
    desiredState: 'RUNNING',
    observedState: 'LIVE',
    connectionGeneration: 1,
    connectedAtMs: NOW - 10_000,
    lastMessageSourceTimeMs: NOW - 120,
    lastMessageReceiveTimeMs: NOW - 100,
    lastProcessedTimeMs: NOW - 90,
    messageAgeMs: 100,
    processingLagMs: 10,
    messageCount: 100,
    invalidCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    droppedCount: 0,
    coalescedCount: 0,
    reconnectCount: 0,
    backoff: { attempt: 0, ceiling: 10, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    rateBudget: AVAILABLE_BUDGET,
    lastError: null,
    recommendedAction: 'No action required.',
    authority: 'COMPLETE',
    completeness: 'COMPLETE',
    snapshotTimeMs: NOW,
    ...overrides,
  };
  return {
    component,
    capability: component === 'SPOT_BROAD' ? 'Spot broad ticker' : 'USD-M broad mark and book',
    criticality: 'CORE',
    source: base,
  };
}

function queue(overrides = {}) {
  return {
    capacity: 100, maximumEntryBytes: 1_024, maximumRetainedBytes: 100_000,
    retainedBytes: 4_000, highWatermarkRetainedBytes: 20_000,
    depth: 4, highWatermark: 20, enqueuedCount: 40, dequeuedCount: 36,
    droppedCount: 0, coalescedCount: 2, overflowCount: 0, oversizeDropCount: 0, resyncRequired: false,
    ...overrides,
  };
}

function lag(p95LagMs, p99LagMs) {
  const stats = {
    sampleCount: 10, retainedSamples: 10, lastLagMs: p95LagMs,
    maximumLagMs: p99LagMs, p50LagMs: 5, p95LagMs, p99LagMs,
  };
  return { sources: {}, global: stats, maximumSources: 8, samplesPerSource: 32, rejectedSourceCount: 0 };
}

function universe() {
  const graphNode = { spot: { id: 'spot-listing' }, usdMPerpetual: { id: 'futures-listing' } };
  return {
    id: 'universe:one', observedAtMs: NOW, graph: { nodes: [graphNode] }, diff: {},
    sources: {
      SPOT: { source: 'SPOT', state: 'COMPLETE', attemptedAtMs: NOW, lastResponseTimeMs: NOW, lastCompleteResponseTimeMs: NOW, retainedListingCount: 1, stale: false, failures: [], truth: {} },
      USD_M_PERPETUAL: { source: 'USD_M_PERPETUAL', state: 'COMPLETE', attemptedAtMs: NOW, lastResponseTimeMs: NOW, lastCompleteResponseTimeMs: NOW, retainedListingCount: 1, stale: false, failures: [], truth: {} },
    },
    metadata: [], listingChanges: [], failures: [],
    nodes: [{
      nodeId: 'market:btc-usdt', canonicalMarket: 'BTC/USDT', aliases: ['BTCUSDT'],
      visibility: { state: 'VISIBLE', reasonCodes: [] },
      coverage: {
        publicData: { state: 'AVAILABLE', evidenceKinds: [], reasonCodes: [] },
        focusedData: { state: 'AVAILABLE', evidenceKinds: [], reasonCodes: [] },
      },
      focusEligibility: { state: 'ELIGIBLE', reasonCodes: [] },
      tradeability: { state: 'UNKNOWN', spot: 'ACTIVE', usdMPerpetual: 'ACTIVE', reasonCodes: [] },
    }],
  };
}

function spot() {
  return {
    sourceId: 'binance-spot-market-stream', observedState: 'LIVE', connectionGeneration: 1,
    connectedAtMs: NOW - 10_000, lastTransportReceiveTimeMs: NOW - 100,
    lastUsefulReceiveTimeMs: NOW - 100, lastProcessedTimeMs: NOW - 90,
    messageAgeMs: 100, processingLagMs: 10, changedOnlySemantics: true,
    quietSymbolsRetained: true, tickerVolumeWindow: 'ROLLING_24H', sources: [],
    symbols: [{
      instrument: { venue: 'BINANCE', productFamily: 'SPOT', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
      ticker24h: {}, tickerFreshness: 'FRESH', bookTicker: {}, bookFreshness: 'FRESH',
      recentTrades: [{}], tradeFreshness: 'FRESH',
    }],
    metrics: {},
    backpressure: {
      capacity: 64, maximumPayloadBytes: 1024, depth: 0, acceptedCount: 10, coalescedCount: 0,
      droppedCount: 0, capacityDropCount: 0, oversizeDropCount: 0, invalidPayloadDropCount: 0,
      outOfOrderReplacementDropCount: 0, oldGenerationDropCount: 0, miniTickerFrameDropCount: 0,
      replaceableKinds: ['BOOK_TICKER'], nonReplaceableKinds: ['MINI_TICKER', 'AGG_TRADE'],
      overflowPolicy: 'DROP_NEW_AND_COUNT',
    },
    snapshotTimeMs: NOW,
  };
}

function futures() {
  const fresh = { generation: 1, ageMs: 100, freshness: 'FRESH', observation: {} };
  return {
    snapshotTimeMs: NOW, sources: [], liquidations: [], symbolCapacity: 10, liquidationCapacity: 10,
    symbols: [{
      symbol: 'BTCUSDT', pair: 'BTCUSDT', sourceMarketType: 1, marketSegment: 'USD_M', productFamily: 'USD_M_PERPETUAL',
      prices: { bidPrice: 60_000, askPrice: 60_001, lastPrice: null, markPrice: 60_000, indexPrice: 59_999, estimatedSettlementPrice: null },
      fundingRate: 0.0001, fundingIntervalHours: 8, nextFundingTimeMs: NOW + 1_000,
      book: fresh, markFunding: fresh, contract: fresh, lastUsefulReceiveTimeMs: NOW - 100,
    }],
  };
}

function healthyInput(overrides = {}) {
  return {
    snapshotTimeMs: NOW,
    configurationVersion: 'runtime-test-v1',
    sources: [source('spot-source', 'SPOT_BROAD'), source('futures-source', 'FUTURES_BROAD')],
    universe: universe(),
    spot: spot(),
    futures: futures(),
    ...overrides,
  };
}

test('healthy captured inputs produce an exact green read model', () => {
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput());
  assert.equal(snapshot.observedState, 'HEALTHY');
  assert.equal(snapshot.desiredState, 'RUNNING');
  assert.equal(snapshot.blockerCount, 0);
  assert.equal(snapshot.warningCount, 0);
  assert.equal(snapshot.universe.total, 1);
  assert.equal(snapshot.universe.paired, 1);
  assert.equal(snapshot.spot.freshTicker, 1);
  assert.equal(snapshot.futures.freshMark, 1);
  assert.equal(snapshot.futures.fundingKnown, 1);
  assert.equal(snapshot.lastSuccessTimeMs, NOW);
  assert.equal(snapshot.authority, 'READ_ONLY_DERIVED');
  assert.equal(snapshot.mutationAuthority, 'NONE');
});

test('warming is lower precedence than degradation and blocking', () => {
  const warming = source('spot-source', 'SPOT_BROAD', { observedState: 'WARMING', lastProcessedTimeMs: null });
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [warming, source('futures-source', 'FUTURES_BROAD')],
  }));
  assert.equal(snapshot.observedState, 'WARMING');
  assert.ok(snapshot.warnings.some((entry) => entry.code === 'SOURCE_WARMING' && entry.impact === 'WARMING'));
});

test('required stopped sources block, while an explicitly non-required stopped runtime is truthfully STOPPED', () => {
  const stoppedSpot = source('spot-source', 'SPOT_BROAD', {
    desiredState: 'STOPPED', observedState: 'STOPPED', lastMessageReceiveTimeMs: null,
    lastProcessedTimeMs: null, messageCount: 0, messageAgeMs: null, processingLagMs: null,
  });
  const stoppedFutures = source('futures-source', 'FUTURES_BROAD', {
    desiredState: 'STOPPED', observedState: 'STOPPED', lastMessageReceiveTimeMs: null,
    lastProcessedTimeMs: null, messageCount: 0, messageAgeMs: null, processingLagMs: null,
  });
  const stoppedSpotSnapshot = { ...spot(), observedState: 'STOPPED', lastProcessedTimeMs: null };
  const required = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [stoppedSpot, stoppedFutures],
    spot: stoppedSpotSnapshot,
  }));
  assert.equal(required.desiredState, 'RUNNING');
  assert.equal(required.observedState, 'BLOCKED');
  assert.ok(required.blockers.some((entry) => entry.code === 'REQUIRED_SOURCE_STOPPED'));
  assert.ok(required.blockers.some((entry) => entry.code === 'REQUIRED_COMPONENT_STOPPED'));

  const stopped = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [stoppedSpot, stoppedFutures],
    spot: stoppedSpotSnapshot,
    policy: { requiredComponents: [] },
  }));
  assert.equal(stopped.desiredState, 'STOPPED');
  assert.equal(stopped.observedState, 'STOPPED');
  assert.equal(stopped.blockerCount, 0);
});

test('caller annotations cannot downgrade canonical Spot/Futures criticality', () => {
  const downgraded = source('spot-source', 'SPOT_BROAD', { observedState: 'STALE', messageAgeMs: 60_000 });
  downgraded.criticality = 'OPTIONAL';
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [downgraded, source('futures-source', 'FUTURES_BROAD')],
  }));
  assert.equal(snapshot.sources.find((entry) => entry.sourceId === 'spot-source').criticality, 'CORE');
  assert.equal(snapshot.observedState, 'BLOCKED');
  assert.ok(snapshot.blockers.some((entry) => entry.code === 'SOURCE_STALE' && entry.sourceId === 'spot-source'));
});

test('observation timestamps alone never advance lastSuccessTimeMs', () => {
  const noSuccessUniverse = universe();
  noSuccessUniverse.sources.SPOT.lastCompleteResponseTimeMs = null;
  noSuccessUniverse.sources.USD_M_PERPETUAL.lastCompleteResponseTimeMs = null;
  const warmingSpot = source('spot-source', 'SPOT_BROAD', {
    observedState: 'WARMING', lastMessageReceiveTimeMs: null, lastProcessedTimeMs: null,
    messageCount: 0, messageAgeMs: null, processingLagMs: null,
  });
  const warmingFutures = source('futures-source', 'FUTURES_BROAD', {
    observedState: 'WARMING', lastMessageReceiveTimeMs: null, lastProcessedTimeMs: null,
    messageCount: 0, messageAgeMs: null, processingLagMs: null,
  });
  const warmingSpotSnapshot = {
    ...spot(), observedState: 'WARMING', lastProcessedTimeMs: null,
    symbols: spot().symbols.map((entry) => ({
      ...entry, tickerFreshness: 'UNSEEN', bookFreshness: 'UNSEEN', tradeFreshness: 'UNSEEN',
    })),
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [warmingSpot, warmingFutures],
    universe: noSuccessUniverse,
    spot: warmingSpotSnapshot,
  }));
  assert.equal(snapshot.lastSuccessTimeMs, null);
  assert.equal(snapshot.components.find((entry) => entry.key === 'UNIVERSE').lastSuccessTimeMs, null);
  assert.equal(snapshot.components.find((entry) => entry.key === 'FUTURES_BROAD').lastSuccessTimeMs, null);
});

test('silent and stale core streams can never be represented as green', () => {
  for (const observedState of ['SILENT', 'STALE']) {
    const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
      sources: [
        source('spot-source', 'SPOT_BROAD', { observedState, messageAgeMs: 60_000 }),
        source('futures-source', 'FUTURES_BROAD'),
      ],
    }));
    assert.equal(snapshot.observedState, 'BLOCKED');
    assert.ok(snapshot.blockers.some((entry) => entry.code === `SOURCE_${observedState}`));
  }
});

test('public REST rate-limit state degrades without inventing a blocker', () => {
  const budget = { ...AVAILABLE_BUDGET, state: 'EXHAUSTED', usedWeight: 1_200, retryAfterMs: null };
  const rest = source('spot-source', 'SPOT_BROAD', {
    transportKind: 'REST', rateBudget: budget,
  });
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [rest, source('futures-source', 'FUTURES_BROAD')],
  }));
  assert.equal(snapshot.observedState, 'DEGRADED');
  assert.equal(snapshot.operations.restBudgets.exhausted, 1);
  assert.equal(snapshot.operations.restBudgets.worstUtilization, 1);
  assert.ok(snapshot.warnings.some((entry) => entry.code === 'REST_BUDGET_EXHAUSTED'));
});

test('focused coverage reports requested versus delivered and protects capital-linked requirements', () => {
  const focus = {
    planId: 'focus-plan', observedAtMs: NOW,
    requirements: [
      { id: 'r1', symbol: 'BTCUSDT', evidenceKind: 'DEPTH', protected: true, state: 'UNFULFILLED', reasonCodes: ['SOURCE_FAILED'] },
      { id: 'r2', symbol: 'ETHUSDT', evidenceKind: 'AGG_TRADE', protected: false, state: 'READY', reasonCodes: [] },
    ],
    counts: { requirements: 2, readyRequirements: 1, warmingRequirements: 0, unfulfilledRequirements: 1, pendingControlMessages: 2, retainedByHysteresis: 0 },
  };
  const bridge = {
    snapshotTimeMs: NOW, universeNodeCount: 1,
    publicAttention: {
      allocations: [
        { symbol: 'BTCUSDT', protected: true, requestedEvidence: ['DEPTH', 'AGG_TRADE'] },
        { symbol: 'ETHUSDT', protected: false, requestedEvidence: ['AGG_TRADE'] },
      ],
      excludedPrivateEvidenceCount: 0,
    },
    evidenceIndex: { size: 5, capacity: 100, duplicateCount: 0, evictedCount: 0 },
    failureCount: 0, lastSuccessTimeMs: NOW, lastError: null,
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ focus, bridge }));
  assert.equal(snapshot.focus.focusedSymbols, 2);
  assert.equal(snapshot.focus.requestedEvidence, 3);
  assert.equal(snapshot.focus.deliveredEvidence, 1);
  assert.equal(snapshot.focus.protectedUnfulfilled, 1);
  assert.equal(snapshot.observedState, 'BLOCKED');
  assert.ok(snapshot.blockers.some((entry) => entry.code === 'PROTECTED_FOCUS_UNFULFILLED'));
});

test('unprotected focused evidence degradation remains a warning', () => {
  const focus = {
    planId: 'focus-plan', observedAtMs: NOW,
    requirements: [{ id: 'r1', symbol: 'BTCUSDT', evidenceKind: 'DEPTH', protected: false, state: 'UNFULFILLED', reasonCodes: ['BUDGET'] }],
    counts: { requirements: 1, readyRequirements: 0, warmingRequirements: 0, unfulfilledRequirements: 1, pendingControlMessages: 0, retainedByHysteresis: 0 },
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ focus }));
  assert.equal(snapshot.observedState, 'DEGRADED');
  assert.ok(snapshot.warnings.some((entry) => entry.code === 'FOCUSED_EVIDENCE_UNFULFILLED'));
});

test('sequence-gap storms and required resyncs block core evidence', () => {
  const gapped = source('spot-source', 'SPOT_BROAD', { sequenceGapCount: 10 });
  gapped.queue = queue({ resyncRequired: true, droppedCount: 1, overflowCount: 1 });
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [gapped, source('futures-source', 'FUTURES_BROAD')],
  }));
  assert.equal(snapshot.observedState, 'BLOCKED');
  assert.equal(snapshot.operations.queuesRequiringResync, 1);
  assert.equal(snapshot.operations.sourceSequenceGaps, 10);
  assert.ok(snapshot.blockers.some((entry) => entry.code === 'QUEUE_REQUIRES_RESYNC'));
  assert.ok(snapshot.blockers.some((entry) => entry.code === 'SEQUENCE_GAP_STORM'));
});

test('capture truncation is explicit and degrades aggregate health', () => {
  const capture = {
    observedAtMs: NOW, activeCaptures: 1, completedCaptures: 3, incompleteCaptures: 0,
    truncatedCaptures: 2, evictedCaptures: 1, checkpointState: 'SAVED',
    lastSuccessTimeMs: NOW, lastError: null,
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ capture }));
  assert.equal(snapshot.capture.state, 'DEGRADED');
  assert.equal(snapshot.capture.truncated, 2);
  assert.equal(snapshot.observedState, 'DEGRADED');
  assert.ok(snapshot.warnings.some((entry) => entry.code === 'CAPTURE_TRUNCATED'));
});

test('queue, processing lag, drops, coalesces, and p95/p99 use bounded worst-case aggregation', () => {
  const spotSource = source('spot-source', 'SPOT_BROAD');
  spotSource.queue = queue({ capacity: 10, depth: 9, highWatermark: 10, droppedCount: 2, coalescedCount: 4, overflowCount: 1 });
  spotSource.lag = lag(900, 1_500);
  const futuresSource = source('futures-source', 'FUTURES_BROAD');
  futuresSource.queue = queue({ capacity: 20, depth: 2, highWatermark: 5, coalescedCount: 3 });
  futuresSource.lag = lag(700, 2_000);
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ sources: [spotSource, futuresSource] }));
  assert.equal(snapshot.operations.queueDepth, 11);
  assert.equal(snapshot.operations.queueCapacity, 30);
  assert.equal(snapshot.operations.queueHighWatermark, 15);
  assert.equal(snapshot.operations.queueDrops, 2);
  assert.equal(snapshot.operations.queueCoalesces, 7);
  assert.equal(snapshot.operations.processingLagWorstP95Ms, 900);
  assert.equal(snapshot.operations.processingLagWorstP99Ms, 2_000);
  assert.equal(snapshot.observedState, 'DEGRADED');
});

test('runtime topology is separate, typed, stable, and only binds to the immutable Foundation catalog', () => {
  const catalog = createIntelligenceTopologyCatalog({ observedAtMs: NOW });
  assert.equal(catalog.ok, true);
  const foundationTopology = catalog.value.snapshot();
  const before = structuredClone(foundationTopology);
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ foundationTopology }));
  assert.deepEqual(foundationTopology, before);
  assert.ok(snapshot.topology.nodes.every((node) => node.id.startsWith('runtime-component:')));
  assert.ok(snapshot.topology.edges.every((edge) => ['DATA', 'EVIDENCE', 'ATTENTION', 'CONTROL', 'RISK', 'OUTCOME'].includes(edge.type)));
  const universeBinding = snapshot.topology.bindings.find((entry) => entry.runtimeNodeId === runtimeComponentId('UNIVERSE'));
  assert.equal(universeBinding.foundationNodeId, intelligenceComponentId('universe'));
  assert.equal(universeBinding.foundationNodePresent, true);
  assert.equal(snapshot.topology.foundationCatalog.staticObservedStatesPreserved, true);
  assert.equal(snapshot.topology.nodes.some((node) => node.id === intelligenceComponentId('universe')), false);
});

test('bounds truncate render detail explicitly without hiding aggregate source counts', () => {
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    policy: { bounds: { maximumSources: 1, maximumTopologyNodes: 3, maximumTopologyEdges: 2, maximumTopologyBindings: 2 } },
  }));
  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.truncatedSources, 1);
  assert.equal(snapshot.operations.sources, 2);
  assert.ok(snapshot.topology.nodes.length <= 3);
  assert.ok(snapshot.topology.edges.length <= 2);
  assert.ok(snapshot.topology.bindings.length <= 2);
  assert.ok(snapshot.topology.truncatedNodes > 0);
});

test('topology truncation is explicit and every retained edge/binding remains referentially closed', () => {
  const catalog = createIntelligenceTopologyCatalog({ observedAtMs: NOW });
  assert.equal(catalog.ok, true);
  const foundationTopology = catalog.value.snapshot();
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    foundationTopology,
    policy: {
      bounds: {
        maximumTopologyNodes: 5,
        maximumTopologyEdges: 2,
        maximumTopologyBindings: 2,
      },
    },
  }));
  assert.equal(snapshot.topology.referentialIntegrity, true);
  assert.ok(snapshot.warnings.some((entry) => entry.code === 'TOPOLOGY_TRUNCATED'));
  const runtimeNodeIds = new Set(snapshot.topology.nodes.map((node) => node.id));
  for (const edge of snapshot.topology.edges) {
    assert.equal(runtimeNodeIds.has(edge.from), true);
    assert.equal(runtimeNodeIds.has(edge.to), true);
  }
  const retainedFoundationNodeIds = new Set(
    [...foundationTopology.nodes].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .slice(0, 5).map((node) => node.id),
  );
  for (const binding of snapshot.topology.bindings) {
    assert.equal(runtimeNodeIds.has(binding.runtimeNodeId), true);
    assert.equal(retainedFoundationNodeIds.has(binding.foundationNodeId), true);
    assert.equal(binding.foundationNodePresent, true);
  }
  assert.equal(snapshot.topology.foundationCatalog.nodeCount, foundationTopology.nodes.length);
  assert.equal(snapshot.topology.foundationCatalog.retainedNodeCount, 5);
  assert.ok(snapshot.topology.foundationCatalog.truncatedNodes > 0);
  assert.ok(snapshot.topology.foundationCatalog.retainedEdgeCount <= 2);
});

test('oversized universe and Foundation graphs fail before traversal', () => {
  const tooLargeUniverse = universe();
  tooLargeUniverse.graph.nodes = Array.from({ length: 16_385 }, () => ({ spot: null, usdMPerpetual: null }));
  assert.throws(
    () => buildRuntimeIntelligenceSnapshot(healthyInput({ universe: tooLargeUniverse })),
    /universe graph nodes exceed/,
  );
  const foundationTopology = { id: 'oversized', nodes: Array.from({ length: 4_097 }, () => ({})), edges: [], truth: {} };
  assert.throws(
    () => buildRuntimeIntelligenceSnapshot(healthyInput({ foundationTopology })),
    /Foundation topology nodes exceed/,
  );
});

test('authoritative Wave 2/3 snapshot contracts adapt directly without lifecycle calls', () => {
  const baseline = {
    id: 'baseline:one', planId: 'plan', planName: 'plan', planVersion: '1', configurationVersion: '1',
    snapshotTimeMs: NOW, restored: true, activeFetchCount: 0, maximumParallelism: 2,
    focusedDispatchStreak: 0, dispatchSequence: 1, integrationGap: '',
    stateCounts: { PENDING: 0, FETCHING: 0, RATE_LIMITED: 0, RETRY_WAIT: 0, INSUFFICIENT_HISTORY: 0, PARTIAL: 0, STALE: 0, COMPLETE: 1, UNAVAILABLE: 0 },
    totals: { items: 1, acceptedRecords: 400, excludedIncompleteRecords: 1, duplicateRecords: 0, detectedGaps: 0, pages: 4, batches: 4, estimatedWeight: 4, actualWeight: 4 },
    items: [],
  };
  const book = {
    sourceId: 'spot-depth-book', snapshotSourceId: 'spot-depth-rest', deltaSourceId: 'spot-depth-stream',
    productFamily: 'SPOT', instrumentId: 'BTCUSDT', symbol: 'BTCUSDT', bookScope: 'FOCUSED',
    phase: 'LIVE', observedState: 'LIVE', connectionGeneration: 1, syncEpoch: 1, cursor: '10',
    snapshotSequence: null, bids: [], asks: [], bufferedEvents: 0, bufferedLevelUpdates: 0,
    freshnessState: 'FRESH', staleAfterMs: 10_000,
    temporal: { snapshotReceiveTimeMs: NOW - 200, lastDeltaSourceEventTimeMs: NOW - 100, lastDeltaSourceTransactionTimeMs: null, lastDeltaReceiveTimeMs: NOW - 90, lastProcessedTimeMs: NOW - 80, knowledgeTimeMs: NOW - 80, receiveAgeMs: 90, sourceAgeMs: 100, processingLagMs: 10 },
    completeness: { state: 'COMPLETE', sequenceComplete: true, bothSidesPresent: true, retentionTruncated: false, maximumLevelsKnown: 100, unknownBeyondSnapshot: true, reasonCodes: [] },
    metrics: {},
    counters: { bufferedCount: 0, appliedCount: 10, duplicateCount: 0, outOfOrderCount: 0, sequenceGapCount: 0, invalidCount: 0, crossedCount: 0, resyncCount: 1, droppedCount: 0, prunedLevelCount: 0, bootstrapDiscardedCount: 0, flowDroppedCount: 0, metricSinkFailureCount: 0 },
    lastFailure: null, pendingResyncRequest: null, latestCorrelationId: 'c1', provenanceDigest: 'digest', snapshotTimeMs: NOW,
  };
  const derivatives = {
    snapshotTimeMs: NOW, requestedSymbols: ['BTCUSDT'], includedSymbols: ['BTCUSDT'], omittedSymbols: [], state: 'PARTIAL',
    coverage: { requiredFactCount: 1, availableFactCount: 1, staleFactCount: 0, missingFactCount: 0 },
    facts: [
      { id: 'fact:public', kind: 'OPEN_INTEREST_CURRENT', symbol: 'BTCUSDT', source: { sourceId: 'oi', access: 'PUBLIC_NO_KEY' }, receiveTimeMs: NOW - 20, availability: 'AVAILABLE', value: {}, lastError: null },
      { id: 'fact:optional', kind: 'TOP_TRADER_ACCOUNT', symbol: 'BTCUSDT', source: { sourceId: 'top', access: 'API_KEY_REQUIRED' }, receiveTimeMs: null, availability: 'UNAVAILABLE', value: null, lastError: null },
    ],
    disagreements: [], budget: AVAILABLE_BUDGET,
  };
  const bridge = {
    id: 'bridge:one', snapshotTimeMs: NOW, configurationVersion: '1', universeGraphId: 'universe:one', universeNodeCount: 1,
    featureBank: {}, evidenceIndex: { size: 2, capacity: 100, maximumPerSymbol: 10, maximumPerSymbolKind: 4, duplicateCount: 0, evictedCount: 0, truncatedSymbolOverflowCount: 0, truncatedSymbols: [] },
    correlationIndex: {}, attentionPlan: null, publicAttention: null, artifacts: [], failures: [], authority: 'EVIDENCE_ONLY', liveMoneyAuthority: 'NONE', createsProposal: false, createsRiskVerdict: false, executesAction: false,
  };
  const capture = {
    id: 'capture-coordinator:one', snapshotTimeMs: NOW, configurationVersion: '1', checkpointId: 'checkpoint', checkpointGeneration: 1, checkpointDirty: false,
    preRingCount: 1, retainedCaptureCount: 1, activeCaptureCount: 0, completedCaptureCount: 1,
    evictedRingCount: 0, evictedCaptureCount: 0, evictedTriggerTombstoneCount: 0, rings: [],
    captures: [{ finishedAtMs: NOW - 10, completeness: { state: 'COMPLETE' }, truncation: { preTrigger: false, postTrigger: false } }],
    failures: [], authority: 'PUBLIC_EVIDENCE_CAPTURE_ONLY', liveMoneyAuthority: 'NONE',
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ baseline, books: [book], derivatives, bridge, capture }));
  assert.equal(snapshot.baseline.records, 400);
  assert.equal(snapshot.books.live, 1);
  assert.equal(snapshot.books.resyncs, 1);
  assert.equal(snapshot.derivatives.total, 2);
  assert.equal(snapshot.derivatives.fresh, 1);
  assert.equal(snapshot.derivatives.optionalUnavailable, 1);
  assert.equal(snapshot.capture.complete, 1);
  assert.equal(snapshot.capture.checkpointState, 'LOADED');
});

test('aggregation is deterministic across input ordering and never mutates captured inputs', () => {
  const leftInput = healthyInput();
  const before = structuredClone(leftInput);
  const left = buildRuntimeIntelligenceSnapshot(leftInput);
  assert.deepEqual(leftInput, before);
  const right = buildRuntimeIntelligenceSnapshot(healthyInput({ sources: [...leftInput.sources].reverse() }));
  assert.equal(left.id, right.id);
  assert.equal(serializeRuntimeIntelligenceSnapshot(left), serializeRuntimeIntelligenceSnapshot(right));
  assert.equal(Object.isFrozen(left), true);
});

test('future snapshot times and duplicate source identities are rejected deterministically', () => {
  assert.throws(
    () => buildRuntimeIntelligenceSnapshot(healthyInput({ spot: { ...spot(), snapshotTimeMs: NOW + 1 } })),
    /cannot be later than snapshotTimeMs/,
  );
  assert.throws(
    () => buildRuntimeIntelligenceSnapshot(healthyInput({
      sources: [source('same-source', 'SPOT_BROAD'), source('same-source', 'FUTURES_BROAD')],
    })),
    /duplicate runtime sourceId/,
  );
});

test('nested component knowledge cannot advance beyond its owning captured cutoff', () => {
  const cases = [
    ['source connection', () => healthyInput({
      sources: [source('spot-source', 'SPOT_BROAD', { snapshotTimeMs: NOW - 100, connectedAtMs: NOW - 50 }), source('futures-source', 'FUTURES_BROAD')],
    })],
    ['source budget', () => healthyInput({
      sources: [source('spot-source', 'SPOT_BROAD', {
        snapshotTimeMs: NOW - 100,
        rateBudget: { ...AVAILABLE_BUDGET, observedAtMs: NOW - 50 },
      }), source('futures-source', 'FUTURES_BROAD')],
    })],
    ['Spot process', () => healthyInput({ spot: { ...spot(), snapshotTimeMs: NOW - 100, lastProcessedTimeMs: NOW - 50 } })],
    ['baseline success', () => healthyInput({ baseline: {
      planId: 'plan', observedAtMs: NOW - 100, stateCounts: {},
      totals: { items: 0, batches: 0, estimatedWeight: 0, actualWeight: 0 },
      restored: false, integrationGap: null, lastSuccessTimeMs: NOW - 50, lastError: null,
    } })],
    ['derivatives fact', () => healthyInput({ derivatives: {
      snapshotTimeMs: NOW - 100, requestedSymbols: ['BTCUSDT'], includedSymbols: ['BTCUSDT'], omittedSymbols: [],
      state: 'PARTIAL', coverage: { requiredFactCount: 1, availableFactCount: 1, staleFactCount: 0, missingFactCount: 0 },
      facts: [{
        id: 'fact', kind: 'OPEN_INTEREST_CURRENT', symbol: 'BTCUSDT',
        source: { sourceId: 'oi', access: 'PUBLIC_NO_KEY' }, receiveTimeMs: NOW - 50,
        evaluatedAtMs: NOW - 100, availability: 'AVAILABLE', value: {}, lastError: null,
      }],
      disagreements: [], budget: { ...AVAILABLE_BUDGET, observedAtMs: NOW - 100 },
    } })],
    ['bridge success', () => healthyInput({ bridge: {
      snapshotTimeMs: NOW - 100, universeNodeCount: 0, publicAttention: null,
      evidenceIndex: { size: 0, capacity: 1, duplicateCount: 0, evictedCount: 0 },
      failureCount: 0, lastSuccessTimeMs: NOW - 50, lastError: null,
    } })],
    ['capture success', () => healthyInput({ capture: {
      observedAtMs: NOW - 100, activeCaptures: 0, completedCaptures: 1, incompleteCaptures: 0,
      truncatedCaptures: 0, evictedCaptures: 0, checkpointState: 'SAVED',
      lastSuccessTimeMs: NOW - 50, lastError: null,
    } })],
  ];
  for (const [name, makeInput] of cases) {
    assert.throws(() => buildRuntimeIntelligenceSnapshot(makeInput()), /cannot be later/, name);
  }
});

test('source operational projections are exact, bounded, detached, and deeply frozen', () => {
  const withExtras = source('spot-source', 'SPOT_BROAD', {
    lastError: {
      code: 'TEST_ERROR', message: 'bounded error', retryable: true, observedAtMs: NOW - 1,
      recommendedAction: 'repair injected source', secret: { token: 'no' },
    },
    rateBudget: { ...AVAILABLE_BUDGET, secret: { token: 'no' } },
  });
  withExtras.queue = queue({ secret: { token: 'no' } });
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({
    sources: [withExtras, source('futures-source', 'FUTURES_BROAD')],
  }));
  const projected = snapshot.sources.find((entry) => entry.sourceId === 'spot-source');
  assert.equal(Object.hasOwn(projected.lastError, 'secret'), false);
  assert.equal(Object.hasOwn(projected.rateBudget, 'secret'), false);
  assert.equal(Object.hasOwn(projected.queue, 'secret'), false);
  assert.equal(Object.isFrozen(projected.lastError), true);
  assert.equal(Object.isFrozen(projected.rateBudget), true);
  assert.equal(Object.isFrozen(projected.queue), true);
});

test('API-key-required derivatives values fail closed instead of becoming fresh public evidence', () => {
  const derivatives = {
    snapshotTimeMs: NOW, requestedSymbols: ['BTCUSDT'], includedSymbols: ['BTCUSDT'], omittedSymbols: [], state: 'PARTIAL',
    coverage: { requiredFactCount: 0, availableFactCount: 0, staleFactCount: 0, missingFactCount: 0 },
    facts: [{
      id: 'forged-keyed', kind: 'TOP_TRADER_ACCOUNT', symbol: 'BTCUSDT',
      source: { sourceId: 'top-trader', access: 'API_KEY_REQUIRED' },
      receiveTimeMs: NOW, evaluatedAtMs: NOW, availability: 'AVAILABLE', value: { ratio: 1 }, lastError: null,
    }],
    disagreements: [], budget: AVAILABLE_BUDGET,
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ derivatives }));
  assert.equal(snapshot.derivatives.fresh, 0);
  assert.equal(snapshot.derivatives.unavailable, 1);
  assert.equal(snapshot.derivatives.optionalUnavailable, 1);
  assert.ok(snapshot.warnings.some((entry) => entry.code === 'DERIVATIVES_PRIVATE_ACCESS_REJECTED'));
});

test('stable failure extras cannot override the owning component observation time', () => {
  const baseline = {
    planId: 'plan', observedAtMs: NOW - 100, stateCounts: {},
    totals: { items: 0, batches: 0, estimatedWeight: 0, actualWeight: 0 },
    restored: false, integrationGap: null, lastSuccessTimeMs: null,
    lastError: {
      id: 'failure:one', code: 'UNAVAILABLE', component: 'baseline', message: 'offline', retryable: true,
      field: null, evidenceIds: [], observedAtMs: NOW + 50, secret: 'no',
    },
  };
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput({ baseline }));
  assert.equal(snapshot.lastError.observedAtMs, NOW - 100);
  assert.equal(snapshot.lastError.message, 'offline');
  assert.equal(Object.hasOwn(snapshot.lastError, 'secret'), false);
});

test('every emitted health and success timestamp stays within the outer runtime cutoff', () => {
  const snapshot = buildRuntimeIntelligenceSnapshot(healthyInput());
  assert.ok(snapshot.lastSuccessTimeMs === null || snapshot.lastSuccessTimeMs <= snapshot.snapshotTimeMs);
  assert.ok(snapshot.lastError === null || snapshot.lastError.observedAtMs === null || snapshot.lastError.observedAtMs <= snapshot.snapshotTimeMs);
  for (const entry of [...snapshot.blockers, ...snapshot.warnings]) {
    assert.ok(entry.observedAtMs === null || entry.observedAtMs <= snapshot.snapshotTimeMs);
  }
  for (const entry of snapshot.components) {
    assert.ok(entry.lastSuccessTimeMs === null || entry.lastSuccessTimeMs <= snapshot.snapshotTimeMs);
  }
});
