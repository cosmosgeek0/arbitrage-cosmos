import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stableId,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  BINANCE_SOURCE_FACTS,
  normalizeDepth,
  normalizeOpenInterest,
  normalizeTrade,
} from '../../../dist/intelligenceFoundation/evidence/index.js';

import {
  FakeWebSocketTransport,
  ManualClock,
  MINUTE_MS,
  QueueRestTransport,
  T0,
  aggregateTrade,
  derivativesBody,
  exchangeInfo,
  futuresAggregateTrade,
  futuresBookTicker,
  futuresContractInfo,
  futuresExchangeRow,
  futuresLiquidation,
  futuresMarkPrice,
  kline,
  restResponse,
  spotBookTicker,
  spotDepthDelta,
  spotDepthSnapshot,
  spotExchangeRow,
  spotMiniTicker,
} from '../fixtures/binance-public-fixtures.mjs';

const sourceMode = process.env.INTELLIGENCE_RUNTIME_SOURCE_TEST === '1';
const runtimeModule = (name) => sourceMode
  ? new URL(`../../../src/intelligenceRuntime/${name}/index.ts`, import.meta.url).href
  : new URL(`../../../dist/intelligenceRuntime/${name}/index.js`, import.meta.url).href;

const [
  universeRuntime,
  spotRuntime,
  futuresRuntime,
  lifecycleRuntime,
  contractsRuntime,
  bridgeRuntime,
  focusRuntime,
  booksRuntime,
  baselineRuntime,
  derivativesRuntime,
  captureRuntime,
  snapshotRuntime,
] = await Promise.all([
  import(runtimeModule('universe')),
  import(runtimeModule('spot')),
  import(runtimeModule('futures')),
  import(runtimeModule('lifecycle')),
  import(runtimeModule('contracts')),
  import(runtimeModule('bridge')),
  import(runtimeModule('focus')),
  import(runtimeModule('books')),
  import(runtimeModule('baseline')),
  import(runtimeModule('derivatives')),
  import(runtimeModule('capture')),
  import(runtimeModule('snapshot')),
]);

const { BinancePublicUniverseAdapter } = universeRuntime;
const { SpotBroadReducer } = spotRuntime;
const { FuturesRuntimeAdapter } = futuresRuntime;
const { WebSocketSourceRunner } = lifecycleRuntime;
const { sourceDefinition } = contractsRuntime;
const { IntelligenceRuntimeBridge } = bridgeRuntime;
const { FocusSubscriptionAllocator } = focusRuntime;
const { LocalOrderBookReducer } = booksRuntime;
const { BaselineBootstrapScheduler } = baselineRuntime;
const { BinancePublicDerivativesEnricher } = derivativesRuntime;
const { LiveOutcomeCaptureCoordinator } = captureRuntime;
const { buildRuntimeIntelligenceSnapshot } = snapshotRuntime;

const PUBLIC_SYMBOLS = Object.freeze([
  ['BTCUSDT', 'BTC'],
  ['ETHUSDT', 'ETH'],
  ['QUIETUSDT', 'QUIET'],
]);

function normalizeContext(sourceKey, instrument, receiveTimeMs, evaluatedAtMs = receiveTimeMs) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  return {
    sourceKey,
    sourceId: fact.sourceId,
    endpointClass: fact.endpointClass,
    instrument,
    receivedTimeMs: receiveTimeMs,
    evaluatedAtMs,
    maxAgeMs: 60_000,
    maximumFutureSkewMs: 1_000,
    schemaVersion: 'integration-schema-1',
    producerVersion: 'integration-producer-1',
    configurationVersion: 'integration-config-1',
  };
}

function normalized(normalizer, sourceKey, raw, instrument, receiveTimeMs, extra = {}) {
  const result = normalizer(raw, { ...normalizeContext(sourceKey, instrument, receiveTimeMs), ...extra });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.failures));
  return result.value;
}

async function universeFixture(clock = new ManualClock(), symbols = PUBLIC_SYMBOLS) {
  const transport = new QueueRestTransport();
  transport.enqueue('/api/v3/exchangeInfo', restResponse(
    exchangeInfo(symbols.map(([symbol, base]) => spotExchangeRow(symbol, base))),
    clock.nowMs(),
  ));
  transport.enqueue('/fapi/v1/exchangeInfo', restResponse(
    exchangeInfo(symbols.map(([symbol, base]) => futuresExchangeRow(symbol, base))),
    clock.nowMs(),
  ));
  const adapter = new BinancePublicUniverseAdapter({
    clock,
    transport,
    config: { universePolicy: { requirePublicDataForFocus: false } },
  });
  const snapshot = await adapter.tick();
  return { adapter, snapshot, transport };
}

function nodeFor(universe, symbol) {
  const node = universe.graph.nodes.find((entry) => entry.spot?.instrument.symbol === symbol);
  assert.ok(node, `missing universe node ${symbol}`);
  return node;
}

function instrumentFor(universe, symbol, family = 'SPOT') {
  const node = nodeFor(universe, symbol);
  const listing = family === 'SPOT' ? node.spot : node.usdMPerpetual;
  assert.ok(listing, `missing ${family} listing ${symbol}`);
  return listing.instrument;
}

function futuresResolver(universe) {
  const bySymbol = new Map(universe.graph.nodes.flatMap((node) => (
    node.usdMPerpetual ? [[node.usdMPerpetual.instrument.symbol, node.usdMPerpetual.instrument]] : []
  )));
  return {
    resolve(identity) {
      const instrument = bySymbol.get(identity.symbol);
      if (!instrument || instrument.pair !== identity.pair) return null;
      return {
        venue: instrument.venue,
        productFamily: instrument.productFamily,
        symbol: instrument.symbol,
        pair: instrument.pair,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        contractType: instrument.contractType,
      };
    },
  };
}

function spotFixture(clock, universe, policy = {}) {
  const reducer = new SpotBroadReducer({
    clock,
    universe: universe.graph.nodes.flatMap((node) => node.spot ? [node.spot.instrument] : []),
    policy,
  });
  reducer.beginGeneration(1);
  return reducer;
}

function futuresFixture(clock, universe, options = {}) {
  const adapter = new FuturesRuntimeAdapter(clock, {
    instrumentResolver: futuresResolver(universe),
    ...options,
  });
  const generations = adapter.startAll();
  for (const [feed, generation] of Object.entries(generations)) {
    assert.equal(adapter.connected(feed, generation), true);
  }
  return { adapter, generations };
}

function bridgeConfig(overrides = {}) {
  return {
    attention: {
      minTierDwellMs: {
        UNIVERSE: 0,
        WATCH: 0,
        CANDIDATE: 0,
        FOCUS: 0,
        DEEP_FOCUS: 0,
        RELEASED: 0,
      },
      promotionCooldownMs: 0,
      signalHoldMs: 60_000,
      hintStaleAfterMs: 60_000,
      maxFutureHintSkewMs: 0,
    },
    featureBank: { minimumMarketSymbols: 2 },
    ...overrides,
  };
}

function bridgeFixture(clock, universe, overrides = {}) {
  const bridge = new IntelligenceRuntimeBridge({ clock, config: bridgeConfig(overrides) });
  assert.equal(bridge.updateUniverse(universe.graph).accepted, true);
  return bridge;
}

function candidateHintPort(clock, instrument, root, seedTruth) {
  return {
    portId: `integration-hints-${instrument.symbol.toLowerCase()}`,
    readCandidateHints(atMs) {
      return [{
        id: stableId('integration-candidate-hint', { instrumentId: instrument.instrumentId, root }),
        strategy: 'volume_spike',
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        sourceState: 'FOCUS',
        engineObservedAtMs: atMs,
        priority: 0.95,
        reasonCodes: ['PERSISTENT_PUBLIC_EVIDENCE'],
        protected: false,
        upstreamCorrelationId: root,
        truth: structuredClone(seedTruth),
      }];
    },
  };
}

function promote(bridge, clock, instrument, root, seedTruth, maximumTicks = 8) {
  const port = candidateHintPort(clock, instrument, root, seedTruth);
  const results = [];
  for (let index = 0; index < maximumTicks; index += 1) {
    const result = bridge.evaluate({ hintPorts: [port] });
    results.push(result);
    if (result.attentionPlan?.allocations[0]?.tier === 'DEEP_FOCUS') break;
    clock.advance(1);
  }
  return results;
}

function allocationFeature(artifact, name) {
  return artifact?.featureSnapshot.features.find((entry) => entry.feature === name && entry.value !== null) ?? null;
}

function tradeEvidence(instrument, id, atMs, price, quantity = 1) {
  const futures = instrument.productFamily === 'USD_M_PERPETUAL';
  const raw = futures
    ? futuresAggregateTrade(instrument.symbol, id, atMs, { p: String(price), q: String(quantity), nq: String(quantity) })
    : aggregateTrade(instrument.symbol, id, atMs, { p: String(price), q: String(quantity) });
  return normalized(
    normalizeTrade,
    futures ? 'USD_M_AGG_TRADE' : 'SPOT_AGG_TRADE',
    raw,
    instrument,
    atMs,
  );
}

function sourceEventForDepth(sourceKey, evidence, generation = 1, suffix = '') {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  return Object.freeze({
    sourceId: fact.sourceId,
    connectionGeneration: generation,
    productFamily: evidence.instrument.productFamily,
    endpointClass: fact.endpointClass,
    stream: fact.channel,
    sourceEventTimeMs: evidence.truth.temporal.sourceEventTimeMs,
    sourceTransactionTimeMs: evidence.truth.temporal.sourceTransactionTimeMs,
    receiveTimeMs: evidence.truth.temporal.receivedTimeMs,
    sequence: evidence.truth.temporal.sequence,
    correlationId: `integration.depth.${evidence.instrument.productFamily}.${evidence.truth.temporal.sequence.last}${suffix}`,
    payload: evidence,
  });
}

function bookFixture(clock, instrument) {
  const snapshotEvidence = normalized(
    normalizeDepth,
    'SPOT_DEPTH_SNAPSHOT',
    spotDepthSnapshot(100, clock.nowMs()),
    instrument,
    clock.nowMs(),
  );
  const reducer = new LocalOrderBookReducer({
    sourceId: `runtime.local-book.SPOT.${instrument.symbol}`,
    snapshotSourceId: BINANCE_SOURCE_FACTS.SPOT_DEPTH_SNAPSHOT.sourceId,
    deltaSourceId: BINANCE_SOURCE_FACTS.SPOT_DEPTH_DELTA.sourceId,
    productFamily: 'SPOT',
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    bookScope: 'UNKNOWN',
    snapshotLimit: 10,
    maximumLevelsPerSide: 10,
    maximumBufferedEvents: 8,
    maximumBufferedLevelUpdates: 32,
    maximumRecentFingerprints: 16,
    maximumFlowSamples: 16,
    staleAfterMs: 1_000,
    maximumSnapshotApplyAgeMs: 500,
    maximumFutureSkewMs: 10,
    depthBandsBps: [100, 250],
    flowWindowsMs: [1_000, 5_000],
  }, { clock });
  const request = reducer.beginGeneration(1);
  const snapshotEvent = sourceEventForDepth('SPOT_DEPTH_SNAPSHOT', snapshotEvidence);
  const apply = reducer.applySnapshot({
    connectionGeneration: 1,
    syncEpoch: request.syncEpoch,
    event: snapshotEvent,
  });
  assert.equal(apply.kind, 'SNAPSHOT_ACCEPTED_WAITING_BRIDGE');
  const deltaEvidence = normalized(
    normalizeDepth,
    'SPOT_DEPTH_DELTA',
    spotDepthDelta(100, 101, clock.nowMs()),
    instrument,
    clock.nowMs(),
  );
  const bootstrap = reducer.ingestDelta(sourceEventForDepth('SPOT_DEPTH_DELTA', deltaEvidence));
  assert.equal(bootstrap.kind, 'BOOTSTRAPPED');
  return { reducer, request, snapshotEvidence, deltaEvidence };
}

class MemoryCheckpoint {
  constructor() { this.values = new Map(); }
  async load(id) { return this.values.has(id) ? structuredClone(this.values.get(id)) : null; }
  async save(id, value) { this.values.set(id, structuredClone(value)); }
}

class BaselineBudget {
  constructor(result = null) { this.result = result; this.sequence = 0; this.reservations = []; }
  async reserve(request) {
    this.reservations.push(structuredClone(request));
    if (this.result) return structuredClone(this.result);
    this.sequence += 1;
    return { kind: 'GRANTED', reservationId: `integration-reservation-${this.sequence}` };
  }
  async settle() {}
}

function baselineFixture(clock, rows) {
  const calls = [];
  const batches = [];
  const scheduler = new BaselineBootstrapScheduler({
    clock,
    history: {
      async fetch(request) {
        calls.push(structuredClone(request));
        return { kind: 'SUCCESS', rows: structuredClone(rows), hasMore: false, receiveTimeMs: clock.nowMs(), actualWeight: 2 };
      },
    },
    weightBudget: new BaselineBudget(),
    checkpoint: new MemoryCheckpoint(),
    sink: { async write(batch) { batches.push(structuredClone(batch)); } },
  });
  return { scheduler, calls, batches };
}

function baselinePlan(symbol, startMs, endMs, minimumSamples = 1) {
  return {
    name: 'integration-baseline',
    version: '1',
    items: [{
      symbol,
      instrumentId: `instrument:${symbol}`,
      productFamily: 'SPOT',
      feature: 'activity_baseline',
      featureVersion: 'activity-baseline-1',
      interval: '1m',
      requestedStartTimeMs: startMs,
      targetEndTimeMs: endMs,
      minimumSamples,
      listedAtMs: startMs - 365 * 24 * 60 * MINUTE_MS,
      delistedAtMs: null,
      listingState: 'ACTIVE',
    }],
  };
}

class DerivativesBudget {
  constructor(denied = false) { this.denied = denied; this.used = 0; }
  reserve(weight, atMs) {
    if (this.denied) {
      return { allowed: false, retryAtMs: atMs + 500, reason: 'COOLDOWN', budget: this.snapshot(atMs) };
    }
    this.used += weight;
    return { allowed: true, retryAtMs: null, reason: 'AVAILABLE', budget: this.snapshot(atMs) };
  }
  observeResponse(input) { return this.snapshot(input.observedAtMs); }
  snapshot(atMs = T0) {
    return {
      state: this.denied ? 'COOLDOWN' : 'AVAILABLE',
      usedWeight: this.used,
      limit: 1_000,
      intervalMs: 60_000,
      resetsAtMs: atMs + 60_000,
      retryAfterMs: this.denied ? 500 : null,
      observedAtMs: atMs,
    };
  }
}

function derivativesFixture(clock, denied = false) {
  const budget = new DerivativesBudget(denied);
  const calls = [];
  const transport = {
    async request(request) {
      calls.push(structuredClone(request));
      return {
        status: 200,
        headers: { 'X-MBX-USED-WEIGHT-1M': String(calls.length) },
        body: derivativesBody(request, clock.nowMs()),
        receiveTimeMs: clock.nowMs(),
      };
    },
  };
  const enricher = new BinancePublicDerivativesEnricher({ clock, rateBudget: budget, transport });
  return { enricher, budget, calls };
}

class MemoryCaptureStorage {
  constructor() { this.value = null; }
  async load() { return this.value === null ? null : structuredClone(this.value); }
  async save(_id, value) { this.value = structuredClone(value); }
}

function capturePolicy(referenceEvidenceId, horizonMs = 1_000) {
  return {
    horizonMs,
    direction: 'UP',
    movedThresholdPct: 5,
    terminalMaxAgeMs: horizonMs,
    requiredMetricFields: ['forwardReturnPct', 'laterMoved'],
    referenceEvidenceId,
    priceBasis: 'TRADE',
  };
}

function focusCapability(universe, symbol) {
  const node = nodeFor(universe, symbol);
  return {
    attentionInstrumentId: node.spot.instrument.instrumentId,
    symbol,
    spot: node.spot.instrument,
    usdMPerpetual: node.usdMPerpetual?.instrument ?? null,
  };
}

function focusAllocation(id, symbol, requestedEvidence = ['TRADE'], overrides = {}) {
  return {
    id: `allocation:${id}`,
    instrumentId: id,
    symbol,
    tier: overrides.tier ?? 'FOCUS',
    desiredTier: overrides.desiredTier ?? overrides.tier ?? 'FOCUS',
    enteredAtMs: overrides.enteredAtMs ?? T0 - 100,
    lastChangedAtMs: overrides.lastChangedAtMs ?? T0 - 100,
    protected: overrides.protected ?? false,
    promotionReasons: [],
    demotionReasons: [],
    requestedEvidence,
    requestedFeatures: [],
    priority: overrides.priority ?? 0.5,
    hintIds: [],
    lastSignalAtMs: overrides.lastSignalAtMs ?? T0 - 1,
    cooldownUntilMs: null,
    candidateOpenedAtMs: null,
    focusEligibility: { state: 'ELIGIBLE', reasonCodes: [] },
    sourceQuality: 'HEALTHY',
    truth: {},
  };
}

function focusPlan(allocations, id = 'integration-focus-plan') {
  return {
    id,
    atMs: T0,
    configurationVersion: 'integration',
    allocations,
    candidates: [],
    requests: [],
    ignoredHints: [],
    hintPortFailures: [],
    tierCounts: { UNIVERSE: 0, WATCH: 0, CANDIDATE: 0, FOCUS: allocations.length, DEEP_FOCUS: 0, RELEASED: 0 },
    truth: {},
  };
}

function focusHarness({ allocations, capabilities, protectedSymbols = [], config = {} }) {
  const clock = new ManualClock();
  const state = { plan: focusPlan(allocations), capabilities, protectedSymbols };
  const allocator = new FocusSubscriptionAllocator({
    clock,
    attentionPlans: { readAttentionPlan: () => state.plan },
    capabilities: { readCapabilities: () => state.capabilities },
    deliveries: { readDeliveredEvidence: () => [] },
    protectedSymbols: { protectedSymbols: () => state.protectedSymbols },
  }, config);
  return { clock, state, allocator };
}

function activateFocus(harness, route = 'SPOT_MARKET') {
  const connectionId = harness.allocator.connectionIds(route)[0];
  harness.allocator.updateConnection({ route, connectionId, generation: 1, state: 'AVAILABLE' });
  return connectionId;
}

function acceptFocus(harness, command) {
  assert.equal(harness.allocator.acknowledge({
    ...command,
    accepted: true,
    observedAtMs: harness.clock.nowMs(),
  }), true);
}

function websocketRunner(clock = new ManualClock(1_000)) {
  const transport = new FakeWebSocketTransport();
  const definition = sourceDefinition({
    capability: 'integration-public-feed',
    streamOrPath: 'btcusdt@bookTicker',
    transportKind: 'WEBSOCKET',
    endpointClass: 'PUBLIC',
    productFamily: 'SPOT',
    silentAfterMs: 100,
    staleAfterMs: 500,
    maximumFutureSkewMs: 10,
    retryCeiling: 2,
    authority: 'COMPLETE',
  });
  const accepted = [];
  const runner = new WebSocketSourceRunner({
    definition,
    url: 'wss://example.invalid/ws/integration',
    maximumMessageBytes: 64 * 1024,
    queueCapacity: 4,
    openTimeoutMs: 100,
    rotationAfterMs: 10_000,
    stableConnectionMs: 100,
    backoff: { baseDelayMs: 100, maximumDelayMs: 400, retryCeiling: 2, cooldownMs: 500, jitterRatio: 0 },
    controlThrottle: { maximumMessages: 2, intervalMs: 1_000 },
  }, {
    clock,
    jitter: { next: () => 0.5 },
    transport,
    decoder(data, context) {
      if (!data || typeof data !== 'object') return null;
      return {
        payload: data,
        stream: 'btcusdt@bookTicker',
        sourceEventTimeMs: context.receiveTimeMs,
        sourceTransactionTimeMs: null,
        sequence: null,
        correlationId: `integration-event-${context.receiveTimeMs}`,
        queueMode: 'REPLACEABLE',
        coalescingKey: 'BTCUSDT',
      };
    },
    sink: { accept: (event) => accepted.push(event) },
  });
  return { runner, transport, accepted };
}

function assertNoAuthority(output) {
  const forbiddenKeys = new Set(['tradeProposal', 'riskApproval', 'orderPlan', 'executionAction']);
  const forbiddenValues = new Set(['PLACE_ORDER', 'EXECUTE_ORDER', 'APPROVE_RISK', 'SUBMIT_PROPOSAL']);
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string') assert.equal(forbiddenValues.has(value), false, value);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, key);
      visit(entry);
    }
  };
  visit(output);
}

function undefinedPaths(value, path = '$', output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => undefinedPaths(entry, `${path}[${index}]`, output));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) output.push(`${path}.${key}`);
      else undefinedPaths(entry, `${path}.${key}`, output);
    }
  }
  return output;
}

test('1. all sources healthy and advancing across the public metadata-to-capture chain', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const btcSpot = instrumentFor(universe, 'BTCUSDT');

  const spot = spotFixture(clock, universe);
  const mini = spot.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.nowMs(),
    payload: PUBLIC_SYMBOLS.map(([symbol]) => spotMiniTicker(symbol, clock.nowMs())),
    correlationId: 'integration.spot.mini.1',
  });
  assert.equal(mini.state, 'ACCEPTED');
  const spotBook = spot.ingestBookTicker({
    generation: 1,
    receiveTimeMs: clock.nowMs(),
    symbol: 'BTCUSDT',
    payload: spotBookTicker('BTCUSDT', 1),
    correlationId: 'integration.spot.book.1',
  });
  const spotTrades = [1, 2, 3].map((id) => spot.ingestAggTrade({
    generation: 1,
    receiveTimeMs: clock.nowMs(),
    symbol: 'BTCUSDT',
    payload: aggregateTrade('BTCUSDT', id, clock.nowMs(), { p: String(100 + id), q: '2' }),
    correlationId: `integration.spot.trade.${id}`,
  }));

  const { adapter: futures, generations } = futuresFixture(clock, universe);
  const futuresBook = futures.ingest('BOOK_TICKER', generations.BOOK_TICKER, futuresBookTicker(), clock.nowMs());
  const futuresMark = futures.ingest('MARK_FUNDING', generations.MARK_FUNDING, futuresMarkPrice(), clock.nowMs());
  futures.ingest('CONTRACT_INFO', generations.CONTRACT_INFO, futuresContractInfo(), clock.nowMs());
  const liquidation = futures.ingest('LIQUIDATION', generations.LIQUIDATION, futuresLiquidation(), clock.nowMs());

  const localBook = bookFixture(clock, btcSpot);
  const derivatives = derivativesFixture(clock);
  await derivatives.enricher.refresh(['BTCUSDT']);
  assert.equal(derivatives.enricher.ingestLiquidation(liquidation.events[0]).accepted, true);

  const baselineStart = T0 - 3 * MINUTE_MS;
  const baseline = baselineFixture(clock, [kline(baselineStart), kline(baselineStart + MINUTE_MS), kline(baselineStart + 2 * MINUTE_MS)]);
  await baseline.scheduler.initialize(baselinePlan('BTCUSDT', baselineStart, T0));
  const baselineSnapshot = await baseline.scheduler.tick();
  assert.equal(baselineSnapshot.items[0].state, 'COMPLETE');

  const bridge = bridgeFixture(clock, universe);
  const evidence = [
    ...spotTrades.map((entry) => entry.evidence),
    localBook.deltaEvidence,
    ...futuresBook.normalized.flatMap((entry) => entry.evidence ? [entry.evidence] : []),
    ...futuresMark.normalized.flatMap((entry) => entry.evidence ? [entry.evidence] : []),
  ];
  assert.equal(bridge.ingest({ correlationId: 'integration.full.chain', scope: 'FOCUSED', evidence }).accepted, evidence.length);
  const promoted = promote(bridge, clock, btcSpot, 'integration.full.chain', spotTrades[0].evidence.truth);
  const candidate = promoted.find((result) => result.freezeRequests.length > 0);
  assert.ok(candidate, 'bridge never emitted the observed capture request');

  const state = { plan: candidate.attentionPlan };
  const focus = new FocusSubscriptionAllocator({
    clock,
    attentionPlans: { readAttentionPlan: () => state.plan },
    capabilities: { readCapabilities: () => universe.graph.nodes.map((node) => focusCapability(universe, node.spot.instrument.symbol)) },
    deliveries: { readDeliveredEvidence: () => [] },
    protectedSymbols: { protectedSymbols: () => [] },
  });
  for (const route of ['SPOT_MARKET', 'USD_M_PUBLIC', 'USD_M_MARKET']) {
    const connectionId = focus.connectionIds(route)[0];
    focus.updateConnection({ route, connectionId, generation: 1, state: 'AVAILABLE' });
  }
  const focusResult = focus.reconcile();
  assert.ok(focusResult.commands.length > 0 || focusResult.snapshot.counts.reusedBroad > 0);

  const capture = new LiveOutcomeCaptureCoordinator({ clock, storage: new MemoryCaptureStorage() });
  const freezeRequest = candidate.freezeRequests[0];
  const runtimeSnapshotTimeMs = clock.nowMs();
  clock.set(freezeRequest.input.triggerTimeMs);
  const reference = freezeRequest.input.evidence.find((entry) => entry.kind === 'TRADE');
  assert.ok(reference);
  const requiredSourceIds = [...new Set(freezeRequest.input.evidence.map((entry) => entry.truth.authority.sourceId))];
  const captureReceipt = capture.trigger({
    triggerRequestId: freezeRequest.id,
    symbol: 'BTCUSDT',
    correlationIds: freezeRequest.correlationIds,
    requiredSourceIds,
    freezeInput: freezeRequest.input,
    postWindowMs: 1_000,
    outcomePolicies: [capturePolicy(reference.id)],
  });
  assert.equal(captureReceipt.state, 'CREATED', JSON.stringify(captureReceipt.failure));
  clock.set(runtimeSnapshotTimeMs);

  const spotSnapshot = spot.snapshot(clock.nowMs());
  const futuresSnapshot = futures.snapshot(clock.nowMs());
  assert.ok(spotSnapshot.sources.every((source) => source.observedState === 'LIVE'));
  assert.ok(futuresSnapshot.sources.every((source) => source.observedState === 'LIVE'));
  const sourceInputs = [
    ...spotSnapshot.sources.map((source) => ({ component: 'SPOT_BROAD', capability: source.sourceId, criticality: 'CORE', source })),
    ...futuresSnapshot.sources.map((source) => ({ component: 'FUTURES_BROAD', capability: source.sourceId, criticality: 'CORE', source })),
  ];
  const runtimeSnapshot = buildRuntimeIntelligenceSnapshot({
    snapshotTimeMs: clock.nowMs(),
    configurationVersion: 'integration-runtime-1',
    sources: sourceInputs,
    universe,
    spot: spotSnapshot,
    futures: futuresSnapshot,
    focus: focusResult.snapshot,
    books: [localBook.reducer.snapshot(clock.nowMs())],
    baseline: baselineSnapshot,
    derivatives: derivatives.enricher.snapshot(['BTCUSDT']),
    bridge: bridge.snapshot(),
    capture: capture.snapshot(),
  });
  assert.equal(runtimeSnapshot.desiredState, 'RUNNING');
  assert.ok(runtimeSnapshot.topology.nodes.length > 0);
  assert.ok(runtimeSnapshot.topology.edges.length > 0);
  assert.equal(runtimeSnapshot.mutationAuthority, 'NONE');
  assert.equal(bridge.snapshot().liveMoneyAuthority, 'NONE');
  assert.equal(bridge.snapshot().createsProposal, false);
  assert.equal(bridge.snapshot().createsRiskVerdict, false);
  assert.equal(bridge.snapshot().executesAction, false);
  assertNoAuthority({ runtimeSnapshot, bridge: bridge.snapshot(), capture: capture.snapshot() });
});

test('2. dormant symbol remains quiet while changed-array truth is retained', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spot = spotFixture(clock, universe);
  spot.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.nowMs(),
    payload: PUBLIC_SYMBOLS.map(([symbol]) => spotMiniTicker(symbol, clock.nowMs())),
  });
  const before = spot.snapshot().symbols.find((entry) => entry.instrument.symbol === 'QUIETUSDT').ticker24h;
  clock.advance(1_000);
  const changed = spot.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.nowMs(),
    payload: [spotMiniTicker('BTCUSDT', clock.nowMs(), { c: '105' })],
  });
  const quiet = spot.snapshot().symbols.find((entry) => entry.instrument.symbol === 'QUIETUSDT');
  assert.equal(changed.events.some((entry) => entry.payload.instrument.symbol === 'QUIETUSDT'), false);
  assert.deepEqual(quiet.ticker24h, before);
  assert.equal(spot.snapshot().quietSymbolsRetained, true);
});

test('3. persistent Spot-led wakeup is promoted only through the injected candidate-hint port', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spotInstrument = instrumentFor(universe, 'BTCUSDT', 'SPOT');
  const perpInstrument = instrumentFor(universe, 'BTCUSDT', 'USD_M_PERPETUAL');
  const evidence = [
    tradeEvidence(spotInstrument, 1, T0 - 400, 100, 5),
    tradeEvidence(perpInstrument, 1, T0 - 400, 100, 1),
    tradeEvidence(spotInstrument, 2, T0 - 300, 103, 5),
    tradeEvidence(spotInstrument, 3, T0 - 200, 104, 5),
    tradeEvidence(perpInstrument, 2, T0 - 100, 103, 1),
  ];
  const bridge = bridgeFixture(clock, universe);
  bridge.ingest({ correlationId: 'integration.persistent.spot', scope: 'FOCUSED', evidence });
  const results = promote(bridge, clock, spotInstrument, 'integration.persistent.spot', evidence[0].truth);
  assert.ok(results.some((result) => result.attentionPlan.allocations.some((entry) => ['CANDIDATE', 'FOCUS', 'DEEP_FOCUS'].includes(entry.tier))));
  assert.ok(results.some((result) => result.artifacts.length > 0));
  assert.equal(bridge.snapshot().createsProposal, false);
});

test('4. one isolated large print is not promoted without persistent candidate evidence', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spotInstrument = instrumentFor(universe, 'BTCUSDT');
  const bridge = bridgeFixture(clock, universe);
  const isolated = tradeEvidence(spotInstrument, 99, T0, 100, 1_000_000);
  bridge.ingest({ correlationId: 'integration.one.print', scope: 'BROAD', evidence: [isolated] });
  const result = bridge.evaluate();
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.freezeRequests.length, 0);
  assert.equal(result.attentionPlan.allocations.some((entry) => ['CANDIDATE', 'FOCUS', 'DEEP_FOCUS'].includes(entry.tier)), false);
});

test('5. Spot leads while Futures lags in the bridge feature evidence', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spotInstrument = instrumentFor(universe, 'BTCUSDT');
  const perpInstrument = instrumentFor(universe, 'BTCUSDT', 'USD_M_PERPETUAL');
  const evidence = [
    tradeEvidence(spotInstrument, 1, T0 - 400, 100),
    tradeEvidence(perpInstrument, 1, T0 - 400, 100),
    tradeEvidence(spotInstrument, 2, T0 - 300, 103),
    tradeEvidence(perpInstrument, 2, T0 - 100, 103),
  ];
  const bridge = bridgeFixture(clock, universe);
  bridge.ingest({ correlationId: 'integration.spot.lead', scope: 'FOCUSED', evidence });
  const artifact = promote(bridge, clock, spotInstrument, 'integration.spot.lead', evidence[0].truth)
    .flatMap((entry) => entry.artifacts)[0];
  assert.ok(artifact);
  assert.equal(allocationFeature(artifact, 'spot_perpetual_lead_market').value, 'SPOT');
  assert.ok(allocationFeature(artifact, 'spot_perpetual_lead_lag_ms').value > 0);
});

test('6. Futures, open-interest, and current sampled liquidation context can lead together without private data', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spotInstrument = instrumentFor(universe, 'BTCUSDT');
  const perpInstrument = instrumentFor(universe, 'BTCUSDT', 'USD_M_PERPETUAL');
  const seedOi = normalized(
    normalizeOpenInterest,
    'USD_M_OPEN_INTEREST_HISTORY',
    { symbol: 'BTCUSDT', sumOpenInterest: '130', sumOpenInterestValue: '13000', timestamp: T0 - 500 },
    perpInstrument,
    T0 - 500,
  );
  const earlierOi = normalized(
    normalizeOpenInterest,
    'USD_M_OPEN_INTEREST_HISTORY',
    { symbol: 'BTCUSDT', sumOpenInterest: '120', sumOpenInterestValue: '12000', timestamp: T0 - 300 },
    perpInstrument,
    T0 - 300,
    { previousOpenInterest: seedOi },
  );
  const currentOi = normalized(
    normalizeOpenInterest,
    'USD_M_OPEN_INTEREST_HISTORY',
    { symbol: 'BTCUSDT', sumOpenInterest: '90', sumOpenInterestValue: '9000', timestamp: T0 - 100 },
    perpInstrument,
    T0 - 100,
    { previousOpenInterest: earlierOi },
  );
  const evidence = [
    tradeEvidence(perpInstrument, 1, T0 - 400, 100),
    tradeEvidence(spotInstrument, 1, T0 - 400, 100),
    tradeEvidence(perpInstrument, 2, T0 - 300, 104),
    tradeEvidence(spotInstrument, 2, T0 - 100, 103),
    earlierOi,
    currentOi,
  ];
  const bridge = bridgeFixture(clock, universe);
  bridge.ingest({ correlationId: 'integration.futures.lead', scope: 'FOCUSED', evidence });
  const artifact = promote(bridge, clock, spotInstrument, 'integration.futures.lead', evidence[0].truth)
    .flatMap((entry) => entry.artifacts)[0];
  assert.ok(artifact);
  assert.equal(allocationFeature(artifact, 'spot_perpetual_lead_market').value, 'PERPETUAL');
  const openInterestChanges = artifact.featureSnapshot.features
    .filter((entry) => entry.feature === 'open_interest_base_change_pct' && typeof entry.value === 'number')
    .map((entry) => entry.value);
  assert.ok(openInterestChanges.some((value) => value < 0), JSON.stringify(openInterestChanges));

  const { adapter: futures, generations } = futuresFixture(clock, universe);
  const liquidation = futures.ingest('LIQUIDATION', generations.LIQUIDATION, futuresLiquidation(), clock.nowMs());
  const derivatives = derivativesFixture(clock);
  assert.equal(derivatives.enricher.ingestLiquidation(liquidation.events[0]).accepted, true);
  const fact = derivatives.enricher.snapshot(['BTCUSDT']).facts.find((entry) => entry.kind === 'LIQUIDATION_CONTEXT');
  assert.equal(fact.value.samplingSelection, 'LATEST_PER_SYMBOL');
  assert.equal(fact.source.access, 'PUBLIC_STREAM_INPUT');
});

test('7. market-wide movement is distinguished from symbol-specific residual behavior', async () => {
  const run = async (btcEnd, ethEnd, root) => {
    const clock = new ManualClock();
    const { snapshot: universe } = await universeFixture(clock, PUBLIC_SYMBOLS.slice(0, 2));
    const btc = instrumentFor(universe, 'BTCUSDT');
    const eth = instrumentFor(universe, 'ETHUSDT');
    const evidence = [
      tradeEvidence(btc, 1, T0 - 300, 100),
      tradeEvidence(btc, 2, T0 - 100, btcEnd),
      tradeEvidence(eth, 1, T0 - 300, 100),
      tradeEvidence(eth, 2, T0 - 100, ethEnd),
    ];
    const bridge = bridgeFixture(clock, universe);
    bridge.ingest({ correlationId: root, scope: 'FOCUSED', evidence });
    const artifact = promote(bridge, clock, btc, root, evidence[0].truth).flatMap((entry) => entry.artifacts)[0];
    return {
      market: allocationFeature(artifact, 'market_spot_return_pct').value,
      specific: allocationFeature(artifact, 'symbol_specific_return_pct').value,
    };
  };
  const broad = await run(105, 105, 'integration.market.broad');
  const specific = await run(110, 100, 'integration.market.specific');
  assert.equal(broad.market, 5);
  assert.equal(broad.specific, 0);
  assert.equal(specific.market, 5);
  assert.equal(specific.specific, 5);
});

test('8. broad socket open but silent is never healthy', () => {
  const clock = new ManualClock(1_000);
  const h = websocketRunner(clock);
  h.runner.start();
  h.transport.connections[0].emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  clock.set(1_100);
  assert.equal(h.runner.snapshot().source.observedState, 'SILENT');
  assert.equal(h.runner.snapshot().source.messageCount, 0);
  h.runner.stop();
});

test('9. stale Spot with fresh Futures remains explicitly asymmetric', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spot = spotFixture(clock, universe, {
    tickerMaximumAgeMs: 10,
    sourceSilentAfterMs: 10,
    sourceStaleAfterMs: 20,
  });
  spot.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [spotMiniTicker('BTCUSDT', T0)] });
  clock.set(T0 + 21);
  const { adapter: futures, generations } = futuresFixture(clock, universe);
  futures.ingest('BOOK_TICKER', generations.BOOK_TICKER, futuresBookTicker('BTCUSDT', clock.nowMs()), clock.nowMs());
  const spotState = spot.snapshot().sources.find((entry) => entry.sourceId === spot.sourceDefinition('MINI_TICKER').sourceId);
  const futuresState = futures.snapshot().sources.find((entry) => entry.sourceId === futures.sourceDefinition('BOOK_TICKER').sourceId);
  assert.equal(spotState.observedState, 'STALE');
  assert.equal(futuresState.observedState, 'LIVE');
});

test('10. stale Futures with fresh Spot remains explicitly asymmetric', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const { adapter: futures, generations } = futuresFixture(clock, universe, { symbolStaleAfterMs: 10 });
  futures.ingest('BOOK_TICKER', generations.BOOK_TICKER, futuresBookTicker('BTCUSDT', T0), T0);
  clock.set(T0 + 20);
  const spot = spotFixture(clock, universe);
  spot.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: clock.nowMs(), payload: [spotMiniTicker('BTCUSDT', clock.nowMs())] });
  const futureSymbol = futures.snapshot().symbols.find((entry) => entry.symbol === 'BTCUSDT');
  const spotState = spot.snapshot().sources.find((entry) => entry.sourceId === spot.sourceDefinition('MINI_TICKER').sourceId);
  assert.equal(futureSymbol.book.freshness, 'STALE');
  assert.equal(spotState.observedState, 'LIVE');
});

test('11. duplicate and out-of-order events never replace accepted state', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const spot = spotFixture(clock, universe);
  const first = spot.ingestBookTicker({ generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: spotBookTicker('BTCUSDT', 10) });
  clock.advance(1);
  const duplicate = spot.ingestBookTicker({ generation: 1, receiveTimeMs: clock.nowMs(), symbol: 'BTCUSDT', payload: spotBookTicker('BTCUSDT', 10) });
  const older = spot.ingestBookTicker({ generation: 1, receiveTimeMs: clock.nowMs(), symbol: 'BTCUSDT', payload: spotBookTicker('BTCUSDT', 9) });
  assert.equal(first.state, 'ACCEPTED');
  assert.equal(duplicate.state, 'REJECTED');
  assert.equal(older.state, 'REJECTED');
  assert.equal(spot.snapshot().metrics.duplicateCount, 1);
  assert.equal(spot.snapshot().metrics.outOfOrderCount, 1);
  assert.equal(spot.snapshot().symbols.find((entry) => entry.instrument.symbol === 'BTCUSDT').bookTicker.updateId, '10');
});

test('12. depth sequence gap invalidates the local book and requests resync', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const book = bookFixture(clock, instrumentFor(universe, 'BTCUSDT'));
  clock.advance(1);
  const gapEvidence = normalized(
    normalizeDepth,
    'SPOT_DEPTH_DELTA',
    spotDepthDelta(103, 103, clock.nowMs(), { b: [['99.7', '2']] }),
    instrumentFor(universe, 'BTCUSDT'),
    clock.nowMs(),
  );
  const result = book.reducer.ingestDelta(sourceEventForDepth('SPOT_DEPTH_DELTA', gapEvidence, 1, '.gap'));
  assert.equal(result.kind, 'RESYNC_REQUIRED');
  assert.equal(result.resyncRequest.reason, 'SEQUENCE_GAP');
  assert.equal(book.reducer.snapshot().phase, 'BUFFERING');
});

test('13. focus budget exhaustion yields deterministic replacement after the lease', () => {
  const a = focusAllocation('a', 'AAAUSDT', ['TRADE'], { priority: 0.5 });
  const b = focusAllocation('b', 'BBBUSDT', ['TRADE'], { priority: 0.9 });
  const capabilities = [
    { attentionInstrumentId: 'a', symbol: 'AAAUSDT', spot: { instrumentId: 'spot:a', venue: 'BINANCE', productFamily: 'SPOT', symbol: 'AAAUSDT', pair: 'AAAUSDT', baseAsset: 'AAA', quoteAsset: 'USDT', contractType: null, sourceMarketType: null }, usdMPerpetual: null },
    { attentionInstrumentId: 'b', symbol: 'BBBUSDT', spot: { instrumentId: 'spot:b', venue: 'BINANCE', productFamily: 'SPOT', symbol: 'BBBUSDT', pair: 'BBBUSDT', baseAsset: 'BBB', quoteAsset: 'USDT', contractType: null, sourceMarketType: null }, usdMPerpetual: null },
  ];
  const config = { maximumTotalStreams: 1, minimumLeaseMs: 1, routes: { SPOT_MARKET: { maximumConnections: 1, maximumStreamsPerConnection: 1 } } };
  const h = focusHarness({ allocations: [a], capabilities, config });
  activateFocus(h);
  const initial = h.allocator.reconcile();
  assert.deepEqual(initial.commands[0].params, ['aaausdt@aggTrade']);
  acceptFocus(h, initial.commands[0]);
  h.state.plan = focusPlan([a, b], 'replacement-plan');
  h.clock.advance(2);
  const replacement = h.allocator.reconcile();
  const rejected = replacement.snapshot.requirements.find((entry) => entry.attentionInstrumentId === 'a');
  assert.equal(replacement.commands[0].method, 'UNSUBSCRIBE');
  assert.ok(rejected === undefined || rejected.reasonCodes.includes('STREAM_BUDGET_EXHAUSTED'));
  acceptFocus(h, replacement.commands[0]);
  const subscribe = h.allocator.reconcile();
  assert.deepEqual(subscribe.commands[0].params, ['bbbusdt@aggTrade']);
});

test('14. protected focus symbol survives eviction pressure', () => {
  const low = focusAllocation('low', 'LOWUSDT', ['TRADE'], { priority: 0.01 });
  const high = focusAllocation('high', 'HIGHUSDT', ['TRADE'], { priority: 0.99 });
  const capabilities = [
    { attentionInstrumentId: 'low', symbol: 'LOWUSDT', spot: { instrumentId: 'spot:low', venue: 'BINANCE', productFamily: 'SPOT', symbol: 'LOWUSDT', pair: 'LOWUSDT', baseAsset: 'LOW', quoteAsset: 'USDT', contractType: null, sourceMarketType: null }, usdMPerpetual: null },
    { attentionInstrumentId: 'high', symbol: 'HIGHUSDT', spot: { instrumentId: 'spot:high', venue: 'BINANCE', productFamily: 'SPOT', symbol: 'HIGHUSDT', pair: 'HIGHUSDT', baseAsset: 'HIGH', quoteAsset: 'USDT', contractType: null, sourceMarketType: null }, usdMPerpetual: null },
  ];
  const h = focusHarness({
    allocations: [high, low],
    capabilities,
    protectedSymbols: ['LOWUSDT'],
    config: { maximumTotalStreams: 1, minimumLeaseMs: 1, routes: { SPOT_MARKET: { maximumConnections: 1, maximumStreamsPerConnection: 1 } } },
  });
  activateFocus(h);
  const initial = h.allocator.reconcile();
  assert.deepEqual(initial.commands[0].params, ['lowusdt@aggTrade']);
  acceptFocus(h, initial.commands[0]);
  h.state.plan = focusPlan([high], 'protected-pressure');
  h.clock.advance(100);
  const preserved = h.allocator.reconcile();
  assert.equal(preserved.commands.length, 0);
  assert.equal(preserved.snapshot.streams[0].protected, true);
  assert.equal(preserved.snapshot.protectedSymbols[0].state, 'PRESERVED');
});

test('15. REST rate limit pauses optional derivatives enrichment without transport work', async () => {
  const clock = new ManualClock();
  const h = derivativesFixture(clock, true);
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.equal(report.rateLimitedCount, 6);
  assert.equal(report.attemptedCount, 0);
  assert.deepEqual(h.calls, []);
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(snapshot.state, 'UNAVAILABLE');
  assert.equal(snapshot.facts.find((entry) => entry.kind === 'OPEN_INTEREST_CURRENT').availability, 'RATE_LIMITED');
});

test('16. partial baseline remains partial when completed history has a gap', async () => {
  const clock = new ManualClock();
  const start = T0 - 3 * MINUTE_MS;
  const h = baselineFixture(clock, [kline(start), kline(start + 2 * MINUTE_MS)]);
  await h.scheduler.initialize(baselinePlan('GAPUSDT', start, T0, 2));
  const snapshot = await h.scheduler.tick();
  assert.equal(snapshot.items[0].state, 'PARTIAL');
  assert.equal(snapshot.items[0].terminal, true);
  assert.equal(snapshot.items[0].gapCount, 1);
  assert.equal(snapshot.items[0].lastReasonCode, 'COMPLETED_HISTORY_HAS_GAPS');
});

test('17. capture freeze has no look-ahead leakage into the pre-event record', async () => {
  const clock = new ManualClock();
  const { snapshot: universe } = await universeFixture(clock);
  const instrument = instrumentFor(universe, 'BTCUSDT');
  const before = tradeEvidence(instrument, 1, T0 - 100, 100);
  const bridge = bridgeFixture(clock, universe);
  bridge.ingest({ correlationId: 'integration.freeze', scope: 'FOCUSED', evidence: [before] });
  const candidate = promote(bridge, clock, instrument, 'integration.freeze', before.truth)
    .find((entry) => entry.freezeRequests.length > 0);
  assert.ok(candidate);
  const freeze = candidate.freezeRequests[0];
  assert.deepEqual(undefinedPaths(freeze.input), []);
  clock.set(freeze.input.triggerTimeMs);
  const capture = new LiveOutcomeCaptureCoordinator({ clock, storage: new MemoryCaptureStorage() });
  const created = capture.trigger({
    triggerRequestId: freeze.id,
    symbol: 'BTCUSDT',
    correlationIds: freeze.correlationIds,
    requiredSourceIds: [before.truth.authority.sourceId],
    freezeInput: freeze.input,
    postWindowMs: 1_000,
    outcomePolicies: [capturePolicy(before.id)],
  });
  assert.equal(created.state, 'CREATED', JSON.stringify(created.failure));
  const future = tradeEvidence(instrument, 2, clock.nowMs() + 1_000, 110);
  clock.advance(1_000);
  assert.equal(capture.ingestEvidence({ evidence: future }).state, 'ACCEPTED');
  capture.tick();
  const snapshot = capture.snapshot().captures[0];
  assert.ok(snapshot.frozenRecord.evidence.every((entry) => entry.truth.temporal.sourceEventTimeMs <= snapshot.triggerTimeMs));
  assert.ok(snapshot.postEvidence.every((entry) => entry.evidence.truth.temporal.sourceEventTimeMs > snapshot.triggerTimeMs));
  assert.equal(snapshot.frozenRecord.evidence.some((entry) => entry.id === future.id), false);
});

test('18. shutdown closes every lifecycle-owned transport and leaves passive components inert', async () => {
  const clock = new ManualClock();
  const runnerHarness = websocketRunner(clock);
  runnerHarness.runner.start();
  const connection = runnerHarness.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: clock.nowMs() });
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: clock.nowMs(), data: { u: 1 } });

  const { snapshot: universe } = await universeFixture(clock);
  const spot = spotFixture(clock, universe);
  const { adapter: futures } = futuresFixture(clock, universe);
  const book = bookFixture(clock, instrumentFor(universe, 'BTCUSDT'));
  const bridge = bridgeFixture(clock, universe);
  const capture = new LiveOutcomeCaptureCoordinator({ clock, storage: new MemoryCaptureStorage() });
  assert.equal(bridge.snapshot().evidenceIndex.size, 0);
  assert.equal(capture.snapshot().activeCaptureCount, 0);

  runnerHarness.runner.stop();
  spot.stop();
  futures.stopAll();
  book.reducer.stop();
  assert.equal(runnerHarness.runner.snapshot().source.observedState, 'STOPPED');
  assert.equal(runnerHarness.runner.snapshot().queue.depth, 0);
  assert.match(connection.closes[0].reason, /stopped/);
  assert.ok(spot.snapshot().sources.every((source) => source.desiredState === 'STOPPED' && source.observedState === 'STOPPED'));
  assert.ok(futures.snapshot().sources.every((source) => source.desiredState === 'STOPPED' && source.observedState === 'STOPPED'));
  assert.equal(book.reducer.snapshot().phase, 'STOPPED');
  assert.equal(bridge.snapshot().liveMoneyAuthority, 'NONE');
});
