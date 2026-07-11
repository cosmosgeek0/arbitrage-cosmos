import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  stableId,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  buildUniverseGraph,
  createUniversePolicy,
} from '../../../dist/intelligenceFoundation/universe/index.js';

const bridgeModule = process.env.INTELLIGENCE_RUNTIME_SOURCE_TEST === '1'
  ? '../../../src/intelligenceRuntime/bridge/index.ts'
  : '../../../dist/intelligenceRuntime/bridge/index.js';
const {
  IntelligenceRuntimeBridge,
  projectRequestedFeature,
} = await import(bridgeModule);
const runtimeUniverseModule = process.env.INTELLIGENCE_RUNTIME_SOURCE_TEST === '1'
  ? '../../../src/intelligenceRuntime/universe/shardedGraph.ts'
  : '../../../dist/intelligenceRuntime/universe/shardedGraph.js';
const { buildRuntimeUniverseGraph } = await import(runtimeUniverseModule);

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
  advance(ms = 1) { this.now += ms; }
}

function instrument(symbol, productFamily = 'SPOT') {
  const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  return {
    instrumentId: stableId('bridge-test-instrument', { symbol, productFamily }),
    venue: 'BINANCE',
    productFamily,
    symbol,
    pair: symbol,
    baseAsset,
    quoteAsset: 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  };
}

function truth(atMs, options = {}) {
  const state = options.state ?? 'FRESH';
  const complete = options.complete ?? true;
  const eventTimeMs = options.eventTimeMs ?? atMs;
  const sourceId = options.sourceId ?? 'bridge-test-public';
  return {
    schemaVersion: '1',
    producerVersion: 'bridge-test-1',
    configurationVersion: 'bridge-test-config-1',
    featureVersion: null,
    authority: {
      kind: options.authorityKind ?? 'EXCHANGE_PRIMARY',
      sourceId,
      dataset: options.dataset ?? 'public-market-test',
      endpointClass: options.endpointClass ?? 'MARKET',
    },
    provenance: {
      sourceRecordIds: options.sourceRecordIds ?? [`source-${eventTimeMs}`],
      sourceSet: [sourceId],
      transforms: options.transforms ?? [],
    },
    temporal: {
      sourceEventTimeMs: eventTimeMs,
      sourceTransactionTimeMs: eventTimeMs,
      receivedTimeMs: atMs,
      sequence: options.sequence ?? null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: atMs,
      ageMs: atMs - eventTimeMs,
      maxAgeMs: options.maxAgeMs ?? 60_000,
      state,
    },
    completeness: {
      state: complete ? 'COMPLETE' : 'PARTIAL',
      observedFields: complete ? ['payload'] : [],
      missingFields: complete ? [] : ['payload.optional'],
      reasonCodes: complete ? [] : ['PARTIAL_TEST_FIXTURE'],
    },
  };
}

function unavailableTruth(atMs, sourceId) {
  return {
    schemaVersion: '1',
    producerVersion: 'bridge-test-1',
    configurationVersion: 'bridge-test-config-1',
    featureVersion: null,
    authority: {
      kind: 'EXCHANGE_PRIMARY', sourceId, dataset: 'unavailable-test-source', endpointClass: 'MARKET',
    },
    provenance: { sourceRecordIds: [], sourceSet: [sourceId], transforms: [] },
    temporal: {
      sourceEventTimeMs: null, sourceTransactionTimeMs: null, receivedTimeMs: atMs, sequence: null,
    },
    freshness: {
      basis: 'UNAVAILABLE', evaluatedAtMs: atMs, ageMs: null, maxAgeMs: null, state: 'UNAVAILABLE',
    },
    completeness: {
      state: 'MISSING', observedFields: [], missingFields: ['records'], reasonCodes: ['SOURCE_UNAVAILABLE'],
    },
  };
}

function listing(identity, atMs) {
  return {
    id: stableId('bridge-test-listing', identity),
    kind: identity.productFamily === 'SPOT' ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument: identity,
    tradingStatus: 'TRADING',
    tradingAllowed: true,
    aliases: [identity.symbol],
    rules: {
      minimumPrice: null,
      maximumPrice: null,
      tickSize: null,
      minimumQuantity: null,
      maximumQuantity: null,
      quantityStep: null,
      minimumNotional: null,
      maximumNotional: null,
    },
    quoteVolume: null,
    quoteVolume24hUsd: null,
    truth: truth(atMs, { sourceId: `listing-${identity.productFamily.toLowerCase()}` }),
  };
}

function universe(atMs = T0, options = {}) {
  const symbol = options.symbol ?? 'BTCUSDT';
  const spot = instrument(symbol, 'SPOT');
  const perpetual = instrument(symbol, 'USD_M_PERPETUAL');
  const hasFutures = options.hasFutures ?? true;
  return buildUniverseGraph({
    observedAtMs: atMs,
    spot: {
      source: 'SPOT', state: 'COMPLETE', records: [listing(spot, atMs)], truth: truth(atMs, { sourceId: 'spot-listings' }),
    },
    usdMPerpetual: hasFutures
      ? {
          source: 'USD_M_PERPETUAL', state: 'COMPLETE', records: [listing(perpetual, atMs)], truth: truth(atMs, { sourceId: 'futures-listings' }),
        }
      : {
          source: 'USD_M_PERPETUAL', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'futures-listings'),
        },
    margin: { source: 'MARGIN', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'margin-listings') },
    borrow: { source: 'BORROW', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'borrow-public-forbidden') },
    coverage: { source: 'COVERAGE', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'coverage') },
  }, {
    configurationVersion: 'bridge-test-universe-1',
    requirePublicDataForFocus: false,
  });
}

function universeWithSymbolCount(count, atMs = T0) {
  const spotRecords = [];
  const perpetualRecords = [];
  for (let index = 0; index < count; index += 1) {
    const symbol = `ASSET${index}USDT`;
    spotRecords.push(listing(instrument(symbol, 'SPOT'), atMs));
    perpetualRecords.push(listing(instrument(symbol, 'USD_M_PERPETUAL'), atMs));
  }
  const input = {
    observedAtMs: atMs,
    spot: {
      source: 'SPOT', state: 'COMPLETE', records: spotRecords, truth: truth(atMs, { sourceId: 'spot-listings' }),
    },
    usdMPerpetual: {
      source: 'USD_M_PERPETUAL', state: 'COMPLETE', records: perpetualRecords, truth: truth(atMs, { sourceId: 'futures-listings' }),
    },
    margin: { source: 'MARGIN', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'margin-listings') },
    borrow: { source: 'BORROW', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'borrow-public-forbidden') },
    coverage: { source: 'COVERAGE', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'coverage') },
  };
  const policy = createUniversePolicy({
    configurationVersion: 'bridge-test-universe-many-1',
    requirePublicDataForFocus: false,
  });
  return buildRuntimeUniverseGraph(input, policy, 60_000);
}

function trade(identity, atMs, sequence, options = {}) {
  const price = options.price ?? 50_000 + sequence;
  const baseQuantity = options.baseQuantity ?? 0.1;
  return {
    id: stableId('bridge-test-trade', { instrumentId: identity.instrumentId, atMs, sequence, price, baseQuantity }),
    kind: 'TRADE',
    instrument: identity,
    aggregateTradeId: String(sequence),
    firstTradeId: String(sequence),
    lastTradeId: String(sequence),
    price,
    baseQuantity,
    quoteQuantity: price * baseQuantity,
    normalBaseQuantityExcludingRpi: null,
    aggressorSide: sequence % 2 === 0 ? 'BUY' : 'SELL',
    truth: truth(atMs, {
      eventTimeMs: options.eventTimeMs ?? atMs,
      sourceRecordIds: [`trade-${sequence}`],
      sourceId: identity.productFamily === 'SPOT' ? 'binance-spot-market-stream' : 'binance-futures-market-stream',
      dataset: identity.productFamily === 'SPOT' ? 'spot.aggregate_trade' : 'usd_m.aggregate_trade',
      endpointClass: identity.productFamily === 'SPOT' ? 'PUBLIC' : 'MARKET',
    }),
  };
}

function book(identity, atMs, sequence = 1) {
  return {
    id: stableId('bridge-test-book', { instrumentId: identity.instrumentId, atMs, sequence }),
    kind: 'BOOK_TICKER',
    instrument: identity,
    updateId: String(sequence),
    bidPrice: 49_999,
    bidQuantity: 2,
    askPrice: 50_001,
    askQuantity: 3,
    truth: truth(atMs, {
      sourceRecordIds: [`book-${sequence}`],
      sourceId: identity.productFamily === 'SPOT' ? 'binance-spot-market-stream' : 'binance-futures-public-stream',
      dataset: identity.productFamily === 'SPOT' ? 'spot.book_ticker' : 'usd_m.book_ticker',
      endpointClass: 'PUBLIC',
    }),
  };
}

function fullPublicEvidence(atMs = T0, options = {}) {
  const symbol = options.symbol ?? 'BTCUSDT';
  const spot = instrument(symbol, 'SPOT');
  const perpetual = instrument(symbol, 'USD_M_PERPETUAL');
  const sequence = { first: '1', last: '1', previous: null };
  return [
    trade(spot, atMs, 1, { price: 50_000, baseQuantity: 0.10 }),
    trade(spot, atMs, 2, { price: 50_010, baseQuantity: 0.11 }),
    trade(spot, atMs, 3, { price: 50_020, baseQuantity: 0.12 }),
    book(spot, atMs),
    {
      id: stableId('bridge-test-depth', { symbol, atMs }),
      kind: 'DEPTH_SNAPSHOT',
      instrument: spot,
      bids: [{ price: 49_999, baseQuantity: 2 }, { price: 49_998, baseQuantity: 3 }],
      asks: [{ price: 50_001, baseQuantity: 2 }, { price: 50_002, baseQuantity: 3 }],
      bookScope: 'UNKNOWN',
      maximumLevelsKnown: 2,
      truth: truth(atMs, {
        sequence,
        sourceRecordIds: ['depth-1'],
        sourceId: 'binance-spot-rest',
        dataset: 'spot.depth_snapshot',
        endpointClass: 'REST',
      }),
    },
    {
      id: stableId('bridge-test-mark', { symbol, atMs }),
      kind: 'MARK_PRICE',
      instrument: perpetual,
      markPrice: 50_000,
      indexPrice: 49_995,
      estimatedSettlementPrice: null,
      movingAverageMarkPrice: null,
      truth: truth(atMs, {
        sourceRecordIds: ['mark-1'], sourceId: 'binance-futures-market-stream', dataset: 'usd_m.mark_price', endpointClass: 'MARKET',
      }),
    },
    {
      id: stableId('bridge-test-funding', { symbol, atMs }),
      kind: 'FUNDING',
      instrument: perpetual,
      fundingRate: 0.0001,
      fundingIntervalHours: 8,
      nextFundingTimeMs: atMs + 8 * 60 * 60_000,
      adjustedRateCap: null,
      adjustedRateFloor: null,
      truth: truth(atMs, {
        sourceRecordIds: ['funding-1'], sourceId: 'binance-futures-market-stream', dataset: 'usd_m.mark_price', endpointClass: 'MARKET',
      }),
    },
    {
      id: stableId('bridge-test-oi', { symbol, atMs }),
      kind: 'OPEN_INTEREST',
      instrument: perpetual,
      openInterestBase: 1_000,
      openInterestQuoteValue: 50_000_000,
      changeBase: 10,
      changeQuoteValue: 500_000,
      comparisonWindowMs: 300_000,
      truth: truth(atMs, {
        sourceRecordIds: ['oi-1'], sourceId: 'binance-futures-rest', dataset: 'usd_m.open_interest', endpointClass: 'REST',
      }),
    },
    {
      id: stableId('bridge-test-liquidation', { symbol, atMs }),
      kind: 'LIQUIDATION',
      instrument: perpetual,
      orderSide: 'SELL',
      liquidatedPositionSide: 'LONG',
      orderType: 'LIMIT',
      timeInForce: 'IOC',
      originalQuantity: 1,
      filledQuantity: 1,
      averagePrice: 49_900,
      sampledPerWindow: true,
      samplingSelection: 'LARGEST_PER_SYMBOL',
      sampleWindowMs: 1_000,
      truth: truth(atMs, {
        sourceRecordIds: ['liquidation-1'], sourceId: 'binance-futures-market-stream', dataset: 'usd_m.liquidation', endpointClass: 'MARKET',
      }),
    },
    {
      id: stableId('bridge-test-context', { symbol, atMs }),
      kind: 'CONTEXT',
      instrument: spot,
      contextType: 'PUBLIC_MARKET_REGIME',
      scope: 'MARKET',
      values: { regime: 'active', breadth: 0.5 },
      truth: truth(atMs, {
        sourceRecordIds: ['context-1'],
        sourceId: 'operator-context-injected',
        dataset: 'market.context',
        endpointClass: 'INJECTED',
        authorityKind: 'CONTEXTUAL',
      }),
    },
  ];
}

function bridgeConfig(overrides = {}) {
  const { attention: attentionOverrides = {}, ...rest } = overrides;
  return {
    attention: {
      minTierDwellMs: {
        UNIVERSE: 0, WATCH: 0, CANDIDATE: 0, FOCUS: 0, DEEP_FOCUS: 0, RELEASED: 0,
      },
      promotionCooldownMs: 0,
      signalHoldMs: 60_000,
      hintStaleAfterMs: 60_000,
      maxFutureHintSkewMs: 0,
      ...attentionOverrides,
    },
    ...rest,
  };
}

function hintPort(clock, identity, root = 'bridge-root-correlation') {
  return {
    portId: 'bridge-test-hints',
    readCandidateHints(atMs) {
      return [{
        id: stableId('bridge-test-hint', { instrumentId: identity.instrumentId, root }),
        strategy: 'volume_spike',
        instrumentId: identity.instrumentId,
        symbol: identity.symbol,
        sourceState: 'FOCUS',
        engineObservedAtMs: atMs,
        priority: 0.95,
        reasonCodes: ['TEST_PUBLIC_SIGNAL'],
        protected: false,
        upstreamCorrelationId: root,
        truth: truth(clock.nowMs(), { sourceId: 'injected-test-hint', sourceRecordIds: ['hint-source'] }),
      }];
    },
  };
}

function prepare(options = {}) {
  const clock = new ManualClock();
  const graph = universe(clock.nowMs(), options);
  const identity = instrument(options.symbol ?? 'BTCUSDT', 'SPOT');
  const bridge = new IntelligenceRuntimeBridge({ clock, config: bridgeConfig(options.config ?? {}) });
  assert.equal(bridge.updateUniverse(graph).accepted, true);
  return { bridge, clock, graph, identity };
}

function promote(bridge, clock, identity, root = 'bridge-root-correlation', maximumTicks = 6) {
  const port = hintPort(clock, identity, root);
  const results = [];
  for (let index = 0; index < maximumTicks; index += 1) {
    results.push(bridge.evaluate({ hintPorts: [port] }));
    if (results.at(-1)?.attentionPlan?.allocations[0]?.tier === 'DEEP_FOCUS') break;
    clock.advance(1);
  }
  return results;
}

test('broad normalized public events feed the feature bank and stable snapshot without authority expansion', () => {
  const { bridge, clock, identity } = prepare();
  const evidence = [trade(identity, clock.nowMs(), 1), book(identity, clock.nowMs())];
  const receipt = bridge.ingest({ correlationId: 'broad-correlation', scope: 'BROAD', evidence });
  assert.equal(receipt.accepted, 2);
  assert.equal(receipt.rejected, 0);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.featureBank.symbolCount, 1);
  assert.equal(snapshot.featureBank.evidenceCount, 2);
  assert.equal(snapshot.evidenceIndex.size, 2);
  assert.equal(snapshot.authority, 'EVIDENCE_ONLY');
  assert.equal(snapshot.liveMoneyAuthority, 'NONE');
  assert.equal(snapshot.createsProposal, false);
  assert.equal(snapshot.createsRiskVerdict, false);
  assert.equal(snapshot.executesAction, false);
});

test('the production-sized 452-symbol public universe graph is accepted without truncation', () => {
  const clock = new ManualClock();
  const bridge = new IntelligenceRuntimeBridge({ clock, config: bridgeConfig() });
  const graph = universeWithSymbolCount(452, clock.nowMs());
  assert.equal(graph.nodes.length, 452, canonicalJson(graph.failures.slice(0, 4)));
  const receipt = bridge.updateUniverse(graph);
  assert.deepEqual(receipt, {
    accepted: true,
    graphId: graph.id,
    nodeCount: 452,
    failure: null,
  });
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.universeGraphId, graph.id);
  assert.equal(snapshot.universeNodeCount, 452);
});

test('oversized universe aliases and failures are rejected transactionally without replacing prior good truth', () => {
  const clock = new ManualClock();
  const good = universe(clock.nowMs());
  const graphLimit = Math.max(64 * 1024, Buffer.byteLength(canonicalJson(good), 'utf8') + 1_024);
  const bridge = new IntelligenceRuntimeBridge({
    clock,
    config: bridgeConfig({ maximumUniverseGraphBytes: graphLimit }),
  });
  assert.equal(bridge.updateUniverse(good).accepted, true);

  const oversizedAlias = structuredClone(good);
  oversizedAlias.id = 'oversized-alias-graph';
  oversizedAlias.aliases[0].alias = 'A'.repeat(graphLimit);
  const aliasReceipt = bridge.updateUniverse(oversizedAlias);
  assert.equal(aliasReceipt.accepted, false);
  assert.equal(aliasReceipt.failure.code, 'BUDGET_EXHAUSTED');
  assert.equal(bridge.snapshot().universeGraphId, good.id);

  const oversizedFailures = structuredClone(good);
  oversizedFailures.id = 'oversized-failure-graph';
  oversizedFailures.failures = [{
    id: 'oversized-quality-failure',
    code: 'INVALID_VALUE',
    component: 'bridge-test',
    message: 'F'.repeat(graphLimit),
    retryable: false,
    field: 'universe',
    evidenceIds: [],
  }];
  const failureReceipt = bridge.updateUniverse(oversizedFailures);
  assert.equal(failureReceipt.accepted, false);
  assert.equal(failureReceipt.failure.code, 'BUDGET_EXHAUSTED');
  assert.equal(bridge.snapshot().universeGraphId, good.id);
  assert.equal(bridge.snapshot().universeNodeCount, good.nodes.length);
});

test('universe observation rollback is rejected and the newest accepted graph remains authoritative', () => {
  const clock = new ManualClock();
  const bridge = new IntelligenceRuntimeBridge({ clock, config: bridgeConfig() });
  const first = universe(clock.nowMs());
  assert.equal(bridge.updateUniverse(first).accepted, true);

  clock.advance(10);
  const latest = universe(clock.nowMs(), { symbol: 'ETHUSDT' });
  assert.equal(bridge.updateUniverse(latest).accepted, true);
  const rollback = bridge.updateUniverse(first);
  assert.equal(rollback.accepted, false);
  assert.equal(rollback.failure.code, 'OUT_OF_ORDER_EVENT');
  assert.equal(bridge.snapshot().universeGraphId, latest.id);
  assert.equal(bridge.snapshot().universeNodeCount, latest.nodes.length);
});

test('private borrow facts and future evidence are rejected before entering retained intelligence state', () => {
  const { bridge, clock, identity } = prepare();
  const borrowIdentity = {
    instrumentId: stableId('bridge-test-borrow-instrument', { asset: 'BTC' }),
    venue: 'BINANCE',
    productFamily: 'BORROW',
    symbol: 'BTC',
    pair: null,
    baseAsset: 'BTC',
    quoteAsset: null,
    contractType: null,
    sourceMarketType: null,
  };
  const privateBorrow = {
    id: stableId('bridge-test-borrow', { atMs: clock.nowMs() }),
    kind: 'BORROW',
    instrument: borrowIdentity,
    asset: 'BTC',
    eligibility: 'UNKNOWN',
    availability: 'UNKNOWN',
    systemAvailableAmount: null,
    accountBorrowLimit: null,
    hourlyInterestRateDecimal: null,
    inventoryAmount: null,
    truth: truth(clock.nowMs(), { sourceRecordIds: ['borrow-1'] }),
  };
  const futureTrade = trade(identity, clock.nowMs() + 10, 99);
  const receipt = bridge.ingest({
    correlationId: 'forbidden-input-root',
    scope: 'FOCUSED',
    evidence: [privateBorrow, futureTrade],
  });
  assert.equal(receipt.accepted, 0);
  assert.equal(receipt.rejected, 2);
  assert.ok(receipt.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));
  assert.ok(receipt.failures.some((failure) => failure.code === 'NO_LOOK_AHEAD_VIOLATION'));
  assert.equal(bridge.snapshot().evidenceIndex.size, 0);
});

test('non-borrow evidence is still rejected unless its authority tuple is an allowlisted public source fact', () => {
  const { bridge, clock, identity } = prepare();
  const disguisedPrivate = trade(identity, clock.nowMs(), 1);
  disguisedPrivate.truth.authority = {
    kind: 'OPERATOR_SUPPLIED',
    sourceId: 'binance-margin-user-data-rest',
    dataset: 'margin.max_borrowable',
    endpointClass: 'REST',
  };
  disguisedPrivate.truth.provenance.sourceSet = ['binance-margin-user-data-rest'];
  const receipt = bridge.ingest({ correlationId: 'disguised-private-root', scope: 'BROAD', evidence: [disguisedPrivate] });
  assert.equal(receipt.accepted, 0);
  assert.equal(receipt.rejected, 1);
  assert.equal(receipt.failures[0].code, 'WRONG_ENDPOINT_CLASS');
  assert.equal(bridge.snapshot().featureBank.evidenceCount, 0);
});

test('focus path consumes injected hints, filters private enrichment, builds intelligence, and emits observed freeze request', () => {
  const { bridge, clock, identity } = prepare();
  const evidence = fullPublicEvidence(clock.nowMs());
  assert.equal(bridge.ingest({ correlationId: 'bridge-root-correlation', scope: 'FOCUSED', evidence }).accepted, evidence.length);
  const results = promote(bridge, clock, identity);
  const candidateTick = results.find((result) => result.attentionPlan?.requests.some((request) => request.toTier === 'CANDIDATE'));
  assert.ok(candidateTick);
  assert.equal(candidateTick.artifacts.length, 1);
  assert.equal(candidateTick.freezeRequests.length, 1);
  assert.equal(candidateTick.freezeRequests[0].input.candidateDisposition, 'OBSERVED');
  assert.equal(candidateTick.freezeRequests[0].authority, 'OUTCOME_CAPTURE_REQUEST_ONLY');
  const focus = results.find((result) => result.attentionPlan?.allocations[0]?.tier === 'FOCUS');
  assert.ok(focus);
  assert.ok(focus.attentionPlan.allocations[0].requestedEvidence.includes('BORROW'));
  assert.ok(!focus.publicAttention.allocations[0].requestedEvidence.includes('BORROW'));
  assert.deepEqual(focus.publicAttention.allocations[0].excludedEvidence, ['BORROW']);
  assert.ok(focus.publicAttention.allocations[0].reasonCodes.includes('PRIVATE_ENDPOINT_FORBIDDEN'));
});

test('candidate transition remains pending until evidence is sufficient, then emits exactly one current-time freeze', () => {
  const { bridge, clock, identity } = prepare();
  const results = promote(bridge, clock, identity, 'pending-freeze-root');
  const candidateTick = results.find((result) => result.attentionPlan?.requests.some((request) => request.toTier === 'CANDIDATE'));
  assert.ok(candidateTick);
  assert.equal(candidateTick.artifacts.length, 0);
  assert.equal(candidateTick.freezeRequests.length, 0);
  assert.equal(bridge.snapshot().pendingCandidateTriggers.length, 1);

  bridge.ingest({
    correlationId: 'pending-freeze-root',
    scope: 'FOCUSED',
    evidence: [trade(identity, clock.nowMs(), 1), book(identity, clock.nowMs())],
  });
  const port = hintPort(clock, identity, 'pending-freeze-root');
  const sufficient = bridge.evaluate({ hintPorts: [port] });
  assert.equal(sufficient.artifacts.length, 1);
  assert.equal(sufficient.freezeRequests.length, 1);
  assert.equal(sufficient.freezeRequests[0].input.triggerTimeMs, clock.nowMs());
  assert.equal(sufficient.freezeRequests[0].input.evidenceCutoffTimeMs, clock.nowMs());
  assert.deepEqual(bridge.snapshot().pendingCandidateTriggers, []);
  assert.equal(bridge.evaluate({ hintPorts: [port] }).freezeRequests.length, 0);
});

test('declared stale source quality caps observation at WATCH and never creates an artifact', () => {
  const { bridge, clock, identity } = prepare();
  bridge.ingest({ correlationId: 'stale-root', scope: 'BROAD', evidence: [trade(identity, clock.nowMs(), 1)] });
  const port = hintPort(clock, identity, 'stale-root');
  let result;
  for (let index = 0; index < 5; index += 1) {
    result = bridge.evaluate({
      hintPorts: [port],
      sourceQuality: [{ instrumentId: identity.instrumentId, sourceQuality: { state: 'STALE', reasonCodes: ['TEST_STALE'] } }],
    });
    clock.advance(1);
  }
  assert.equal(result.attentionPlan.allocations[0].tier, 'WATCH');
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.freezeRequests, []);
});

test('missing Futures remains explicit and thesis lead market is UNKNOWN rather than zero-filled', () => {
  const { bridge, clock, identity } = prepare({ hasFutures: false });
  bridge.ingest({
    correlationId: 'spot-only-root',
    scope: 'FOCUSED',
    evidence: [trade(identity, clock.nowMs(), 1), book(identity, clock.nowMs())],
  });
  const results = promote(bridge, clock, identity, 'spot-only-root');
  const artifact = results.flatMap((result) => result.artifacts)[0];
  assert.ok(artifact);
  assert.equal(artifact.thesis.leadMarket, 'UNKNOWN');
  assert.ok(artifact.thesis.reasonCodes.includes('LEAD_MARKET_UNAVAILABLE'));
  const perpetual = artifact.featureSnapshot.features.filter((feature) => feature.feature.startsWith('perpetual_'));
  assert.ok(perpetual.length > 0);
  assert.ok(perpetual.every((feature) => feature.value === null));
});

test('one-print noise reaches frozen forensics and is blocked without becoming a proposal verdict', () => {
  const { bridge, clock, identity } = prepare();
  bridge.ingest({ correlationId: 'one-print-root', scope: 'FOCUSED', evidence: [trade(identity, clock.nowMs(), 1)] });
  const results = promote(bridge, clock, identity, 'one-print-root');
  const artifact = results.flatMap((result) => result.artifacts)[0];
  assert.ok(artifact);
  const check = artifact.forensics.checks.find((entry) => entry.check === 'ONE_PRINT_OR_CONCENTRATED_SPIKE');
  assert.equal(check.verdict, 'FAIL');
  assert.equal(artifact.forensics.tradeability.state, 'BLOCKED');
  assert.equal(bridge.snapshot().createsRiskVerdict, false);
});

test('full public thesis input retains every public evidence class and exact feature projection semantics', () => {
  const { bridge, clock, identity } = prepare();
  const evidence = fullPublicEvidence(clock.nowMs());
  bridge.ingest({ correlationId: 'full-input-root', scope: 'FOCUSED', evidence });
  const results = promote(bridge, clock, identity, 'full-input-root');
  const artifact = results.flatMap((result) => result.artifacts)[0];
  assert.ok(artifact);
  assert.deepEqual(
    [...new Set(evidence.map((record) => record.kind))].sort(),
    ['BOOK_TICKER', 'CONTEXT', 'DEPTH_SNAPSHOT', 'FUNDING', 'LIQUIDATION', 'MARK_PRICE', 'OPEN_INTEREST', 'TRADE'],
  );
  assert.equal(artifact.evidenceIds.length, evidence.length);
  assert.ok(artifact.thesis.id.length > 0);
  assert.ok(artifact.forensics.id.length > 0);
  assert.equal(bridge.config.thesis.bindings.spotArrivalAcceleration, 'spot_trade_arrival_acceleration');
  assert.equal(projectRequestedFeature('absorption_evidence').status, 'NON_EQUIVALENT');
  assert.equal(projectRequestedFeature('price_acceleration_15s').status, 'UNAVAILABLE');
  assert.deepEqual(projectRequestedFeature('spot_perpetual_lead_lag').featureNames, [
    'spot_perpetual_lead_market', 'spot_perpetual_lead_lag_ms',
  ]);
});

test('conflicting duplicate evidence is rejected without attaching its root, while exact duplicate root union stays bounded', () => {
  const { bridge, clock, identity } = prepare({ config: { maximumCorrelationRootsPerEntry: 2 } });
  const original = trade(identity, clock.nowMs(), 1);
  assert.equal(bridge.ingest({ correlationId: 'root-b', scope: 'BROAD', evidence: [original] }).accepted, 1);
  const conflicting = structuredClone(original);
  conflicting.price += 1;
  conflicting.quoteQuantity = conflicting.price * conflicting.baseQuantity;
  const conflict = bridge.ingest({ correlationId: 'root-a', scope: 'BROAD', evidence: [conflicting] });
  assert.equal(conflict.rejected, 1);
  assert.equal(conflict.duplicate, 0);
  assert.ok(conflict.failures.some((failure) => failure.code === 'INVALID_VALUE'));
  bridge.ingest({ correlationId: 'root-c', scope: 'BROAD', evidence: [original] });
  bridge.ingest({ correlationId: 'root-d', scope: 'BROAD', evidence: [original] });
  const link = bridge.snapshot().correlationIndex.links.find((entry) => entry.id === original.id);
  assert.deepEqual(link.correlationIds, ['root-b', 'root-c']);
  assert.ok(!link.correlationIds.includes('root-a'));
  assert.ok(link.correlationIds.length <= bridge.config.maximumCorrelationRootsPerEntry);
  assert.equal(bridge.snapshot().featureBank.evidenceCount, 1);
});

test('raw hint batches are bounded before any hint lineage is created', () => {
  const { bridge, clock, identity } = prepare({
    config: { attention: { maxHintsPerPlan: 2, maxHintsPerInstrument: 2 } },
  });
  const base = hintPort(clock, identity, 'oversized-hint-root').readCandidateHints(clock.nowMs())[0];
  const oversizedPort = {
    portId: 'oversized-hints',
    readCandidateHints() {
      return [0, 1, 2].map((index) => ({ ...structuredClone(base), id: `${base.id}:${index}` }));
    },
  };
  const result = bridge.evaluate({ hintPorts: [oversizedPort] });
  assert.equal(result.attentionPlan.hintPortFailures.length, 1);
  assert.equal(result.attentionPlan.allocations[0].tier, 'UNIVERSE');
  assert.ok(!bridge.snapshot().correlationIndex.links.some((entry) => entry.stage === 'HINT'));
});

test('one bounded runtime correlation root remains continuous through evidence, feature, attention, thesis, and freeze', () => {
  const { bridge, clock, identity } = prepare();
  bridge.ingest({
    correlationId: 'continuous-root',
    scope: 'FOCUSED',
    evidence: [trade(identity, clock.nowMs(), 1), book(identity, clock.nowMs())],
  });
  const results = promote(bridge, clock, identity, 'continuous-root');
  const candidateTick = results.find((result) => result.freezeRequests.length > 0);
  assert.ok(candidateTick);
  const artifact = candidateTick.artifacts[0];
  assert.ok(artifact.correlationIds.includes('continuous-root'));
  assert.ok(candidateTick.freezeRequests[0].correlationIds.includes('continuous-root'));
  const links = bridge.snapshot().correlationIndex.links;
  for (const stage of ['SOURCE', 'EVIDENCE', 'FEATURE', 'HINT', 'ATTENTION', 'CANDIDATE', 'THESIS', 'FORENSICS', 'FREEZE_REQUEST']) {
    assert.ok(links.some((link) => link.stage === stage && link.correlationIds.includes('continuous-root')), stage);
  }
});

test('identical clocks and inputs produce canonical repeated output and repeated snapshots do not mutate state', () => {
  function run() {
    const { bridge, clock, identity } = prepare();
    const evidence = [trade(identity, clock.nowMs(), 1), book(identity, clock.nowMs())];
    bridge.ingest({ correlationId: 'deterministic-root', scope: 'FOCUSED', evidence });
    const results = promote(bridge, clock, identity, 'deterministic-root');
    const first = bridge.snapshot();
    const second = bridge.snapshot();
    assert.equal(canonicalJson(first), canonicalJson(second));
    return { results, snapshot: first };
  }
  assert.equal(canonicalJson(run()), canonicalJson(run()));
});

test('graph, evidence, hint, and evaluation inputs are never mutated', () => {
  const { bridge, clock, graph, identity } = prepare();
  const evidence = [trade(identity, clock.nowMs(), 1), book(identity, clock.nowMs())];
  const batch = { correlationId: 'mutation-root', scope: 'FOCUSED', evidence };
  const quality = [{ instrumentId: identity.instrumentId, sourceQuality: { state: 'HEALTHY', reasonCodes: ['TEST'] } }];
  const port = hintPort(clock, identity, 'mutation-root');
  const before = structuredClone({ graph, batch, quality, hint: port.readCandidateHints(clock.nowMs()) });
  bridge.ingest(batch);
  bridge.evaluate({ hintPorts: [port], sourceQuality: quality });
  assert.deepEqual({ graph, batch, quality, hint: port.readCandidateHints(clock.nowMs()) }, before);
});

test('evidence, lineage, failures, and artifacts remain inside configured memory bounds', () => {
  const clock = new ManualClock();
  const graph = universe(clock.nowMs());
  const identity = instrument('BTCUSDT', 'SPOT');
  const bridge = new IntelligenceRuntimeBridge({
    clock,
    config: bridgeConfig({
      maximumUniverseNodes: 2,
      maximumEvidenceBatch: 16,
      maximumIndexedEvidence: 4,
      maximumEvidencePerSymbol: 4,
      maximumEvidencePerSymbolKind: 2,
      maximumLineageEntries: 8,
      maximumCorrelationRootsPerEntry: 2,
      maximumArtifacts: 1,
      maximumFailureRecords: 4,
      maximumHintPorts: 1,
      maximumThesisEvidence: 4,
      maximumThesisFeatures: 32,
      featureBank: { maxSymbols: 2, maxRecordsPerKind: 16, baselineCapacity: 16 },
    }),
  });
  assert.equal(bridge.updateUniverse(graph).accepted, true);
  for (let index = 1; index <= 8; index += 1) {
    bridge.ingest({
      correlationId: `bounded-root-${index}`,
      scope: 'BROAD',
      evidence: [trade(identity, clock.nowMs(), index, { price: 50_000 + index })],
    });
    clock.advance(1);
  }
  const snapshot = bridge.snapshot();
  assert.ok(snapshot.evidenceIndex.size <= 4);
  assert.ok(snapshot.evidenceIndex.truncatedSymbols.includes('BTCUSDT'));
  assert.ok(snapshot.correlationIndex.size <= 8);
  assert.ok(snapshot.failures.length <= 4);
  assert.ok(snapshot.artifacts.length <= 1);
});

test('historical bounded eviction remains counted but stops blocking completeness after the active feature window', () => {
  const { bridge, clock, identity } = prepare({
    config: {
      maximumUniverseNodes: 2,
      maximumIndexedEvidence: 4,
      maximumEvidencePerSymbol: 4,
      maximumEvidencePerSymbolKind: 2,
      maximumThesisEvidence: 4,
      maximumThesisFeatures: 32,
      featureBank: { maxSymbols: 2, maxRecordsPerKind: 16, baselineCapacity: 16 },
    },
  });
  bridge.ingest({
    correlationId: 'old-truncation-root',
    scope: 'BROAD',
    evidence: [1, 2, 3].map((sequence) => trade(identity, clock.nowMs(), sequence)),
  });
  let evidenceStats = bridge.snapshot().evidenceIndex;
  assert.ok(evidenceStats.evictedCount > 0);
  assert.deepEqual(evidenceStats.truncatedSymbols, ['BTCUSDT']);

  clock.advance(bridge.config.featureBank.historyRetentionMs + 1);
  assert.equal(bridge.updateUniverse(universe(clock.nowMs())).accepted, true);
  bridge.ingest({
    correlationId: 'current-complete-root',
    scope: 'FOCUSED',
    evidence: [trade(identity, clock.nowMs(), 10), book(identity, clock.nowMs(), 10)],
  });
  evidenceStats = bridge.snapshot().evidenceIndex;
  assert.ok(evidenceStats.evictedCount > 0);
  assert.equal(evidenceStats.historicallyTruncatedSymbolCount, 1);
  assert.deepEqual(evidenceStats.truncatedSymbols, []);
  const artifact = promote(bridge, clock, identity, 'current-complete-root')
    .flatMap((result) => result.artifacts)[0];
  assert.ok(artifact);
});

test('every raw evidence capacity guard rejects before FeatureBank ingestion or evidence lineage', () => {
  const scenarios = [
    {
      name: 'serialized evidence',
      config: { maximumEvidenceBytes: 512 },
      make: (clock, identity) => trade(identity, clock.nowMs(), 1),
    },
    {
      name: 'structural node',
      config: { maximumEvidenceNodes: 16 },
      make: (clock, identity) => trade(identity, clock.nowMs(), 2),
    },
    {
      name: 'string',
      config: { maximumEvidenceStringBytes: 16 },
      make: (clock, identity) => trade(identity, clock.nowMs(), 3),
    },
    {
      name: 'array',
      config: { maximumEvidenceArrayLength: 9, maximumDepthLevels: 50 },
      make: (clock) => {
        const depth = structuredClone(fullPublicEvidence(clock.nowMs())[4]);
        depth.bids = Array.from({ length: 10 }, (_, index) => ({ price: 49_999 - index, baseQuantity: 1 }));
        return depth;
      },
    },
    {
      name: 'nesting-depth',
      config: { maximumEvidenceNestingDepth: 3 },
      make: (clock, identity) => trade(identity, clock.nowMs(), 4),
    },
    {
      name: 'market depth',
      config: { maximumDepthLevels: 1 },
      make: (clock) => structuredClone(fullPublicEvidence(clock.nowMs())[4]),
    },
    {
      name: 'provenance',
      config: { maximumProvenanceIds: 1 },
      make: (clock, identity) => {
        const evidence = trade(identity, clock.nowMs(), 5);
        evidence.truth.provenance.sourceRecordIds.push('second-record');
        return evidence;
      },
    },
  ];
  for (const scenario of scenarios) {
    const { bridge, clock, identity } = prepare({ config: scenario.config });
    const evidence = scenario.make(clock, identity);
    const receipt = bridge.ingest({ correlationId: `capacity-${scenario.name}`, scope: 'BROAD', evidence: [evidence] });
    assert.equal(receipt.accepted, 0, scenario.name);
    assert.equal(receipt.rejected, 1, scenario.name);
    assert.ok(receipt.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'), scenario.name);
    const snapshot = bridge.snapshot();
    assert.equal(snapshot.featureBank.evidenceCount, 0, scenario.name);
    assert.ok(!snapshot.correlationIndex.links.some((entry) => entry.id === evidence.id), scenario.name);
  }
});

test('oversized quality-failure evidence ids collapse to a bounded local failure without retention amplification', () => {
  const { bridge, clock, identity } = prepare({ config: { maximumEvidenceBytes: 2_048 } });
  const valid = trade(identity, clock.nowMs(), 1);
  assert.equal(bridge.ingest({ correlationId: 'prior-good-root', scope: 'BROAD', evidence: [valid] }).accepted, 1);

  const sentinel = 'QUALITY_FAILURE_SENTINEL_';
  const receipt = bridge.ingest({
    correlationId: 'oversized-quality-root',
    scope: 'BROAD',
    evidence: [],
    qualityFailures: [{
      id: 'oversized-input-failure',
      code: 'INVALID_VALUE',
      component: 'upstream-source',
      message: 'source quality failed',
      retryable: false,
      field: 'source',
      evidenceIds: [`${sentinel}${'X'.repeat(4_096)}`],
    }],
  });
  assert.equal(receipt.accepted, 0);
  assert.equal(receipt.failures.length, 1);
  assert.equal(receipt.failures[0].code, 'INVALID_VALUE');
  assert.equal(receipt.failures[0].field, 'qualityFailures');
  assert.ok(Buffer.byteLength(canonicalJson(receipt), 'utf8') < 2_048);
  assert.equal(canonicalJson(receipt).includes(sentinel), false);

  const snapshot = bridge.snapshot();
  assert.equal(snapshot.evidenceIndex.size, 1);
  assert.equal(snapshot.featureBank.evidenceCount, 1);
  assert.equal(canonicalJson(snapshot).includes(sentinel), false);
  assert.ok(snapshot.failures.every((record) => Buffer.byteLength(canonicalJson(record), 'utf8') < 2_048));
});

test('direct oversized evidence is rejected at the raw boundary and cannot perturb prior indexed state', () => {
  const { bridge, clock, identity } = prepare({
    config: {
      maximumEvidenceBytes: 2_048,
      maximumEvidenceStringBytes: 128,
    },
  });
  const valid = trade(identity, clock.nowMs(), 1);
  assert.equal(bridge.ingest({ correlationId: 'direct-prior-good-root', scope: 'BROAD', evidence: [valid] }).accepted, 1);
  const before = bridge.snapshot();

  const huge = trade(identity, clock.nowMs(), 2);
  huge.untrustedTransportMetadata = 'M'.repeat(16_384);
  const receipt = bridge.ingest({
    correlationId: 'direct-oversized-root',
    scope: 'BROAD',
    evidence: [huge],
  });
  assert.equal(receipt.accepted, 0);
  assert.equal(receipt.rejected, 1);
  assert.ok(receipt.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'));
  assert.ok(Buffer.byteLength(canonicalJson(receipt), 'utf8') < 2_048);

  const after = bridge.snapshot();
  assert.equal(after.evidenceIndex.size, before.evidenceIndex.size);
  assert.equal(after.featureBank.evidenceCount, before.featureBank.evidenceCount);
  assert.ok(!after.correlationIndex.links.some((entry) => entry.id === huge.id));
});
