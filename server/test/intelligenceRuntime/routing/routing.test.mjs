import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stableId,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  BINANCE_SOURCE_FACTS,
  normalizeBookTicker,
  normalizeContext,
  normalizeDepth,
  normalizeTrade,
} from '../../../dist/intelligenceFoundation/evidence/index.js';
import {
  buildUniverseGraph,
} from '../../../dist/intelligenceFoundation/universe/index.js';

const sourceMode = process.env.INTELLIGENCE_RUNTIME_SOURCE_TEST === '1';
const runtimeModule = (name) => sourceMode
  ? new URL(`../../../src/intelligenceRuntime/${name}/index.ts`, import.meta.url).href
  : new URL(`../../../dist/intelligenceRuntime/${name}/index.js`, import.meta.url).href;
const [{ IntelligenceRuntimeBridge }, { VolumeEvidenceRouter }] = await Promise.all([
  import(runtimeModule('bridge')),
  import(runtimeModule('routing')),
]);

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  advance(ms) { this.now += ms; }
}

function instrument(productFamily = 'SPOT', symbol = 'BTCUSDT') {
  const baseAsset = symbol.slice(0, -4);
  const identity = {
    venue: 'BINANCE',
    productFamily,
    symbol,
    pair: symbol,
    baseAsset,
    quoteAsset: 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  };
  return { instrumentId: stableId('instrument', identity), ...identity };
}

function sourceTruth(sourceKey, atMs, id, options = {}) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  const maxAgeMs = options.maxAgeMs ?? 1_000;
  return {
    schemaVersion: '1',
    producerVersion: 'routing-test-1',
    configurationVersion: 'routing-test-1',
    featureVersion: null,
    authority: {
      kind: fact.productFamily === 'ANY' ? 'CONTEXTUAL' : 'EXCHANGE_PRIMARY',
      sourceId: fact.sourceId,
      dataset: fact.dataset,
      endpointClass: fact.endpointClass,
    },
    provenance: { sourceRecordIds: [id], sourceSet: [fact.sourceId], transforms: ['routing-test-fixture'] },
    temporal: {
      sourceEventTimeMs: atMs,
      sourceTransactionTimeMs: atMs,
      receivedTimeMs: atMs,
      sequence: options.sequence ?? null,
    },
    freshness: {
      basis: fact.freshnessBasis, evaluatedAtMs: atMs, ageMs: 0, maxAgeMs, state: options.freshness ?? 'FRESH',
    },
    completeness: {
      state: options.completeness ?? 'COMPLETE',
      observedFields: ['fixture'],
      missingFields: options.completeness === 'PARTIAL' ? ['fixture.optional'] : [],
      reasonCodes: options.completeness === 'PARTIAL' ? ['FIXTURE_PARTIAL'] : [],
    },
  };
}

function listingTruth(atMs, sourceId) {
  return {
    schemaVersion: '1', producerVersion: 'routing-test-1', configurationVersion: 'routing-test-1', featureVersion: null,
    authority: { kind: 'EXCHANGE_PRIMARY', sourceId, dataset: 'routing-test-listing', endpointClass: 'INJECTED' },
    provenance: { sourceRecordIds: [sourceId], sourceSet: [sourceId], transforms: [] },
    temporal: { sourceEventTimeMs: atMs, sourceTransactionTimeMs: atMs, receivedTimeMs: atMs, sequence: null },
    freshness: { basis: 'SOURCE_EVENT_TIME', evaluatedAtMs: atMs, ageMs: 0, maxAgeMs: 60_000, state: 'FRESH' },
    completeness: { state: 'COMPLETE', observedFields: ['fixture'], missingFields: [], reasonCodes: [] },
  };
}

function unavailableTruth(atMs, sourceId) {
  return {
    ...listingTruth(atMs, sourceId),
    temporal: { sourceEventTimeMs: null, sourceTransactionTimeMs: null, receivedTimeMs: atMs, sequence: null },
    freshness: { basis: 'UNAVAILABLE', evaluatedAtMs: atMs, ageMs: null, maxAgeMs: null, state: 'UNAVAILABLE' },
    completeness: { state: 'MISSING', observedFields: [], missingFields: ['records'], reasonCodes: ['SOURCE_UNAVAILABLE'] },
  };
}

function normalized(result) {
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.failures));
  return result.value;
}

function normalizationContext(sourceKey, symbol, receivedTimeMs, previousSequence = null) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  const productFamily = fact.productFamily === 'ANY' ? 'SPOT' : fact.productFamily;
  const identity = instrument(productFamily, symbol);
  return {
    sourceKey,
    sourceId: fact.sourceId,
    endpointClass: fact.endpointClass,
    instrument: {
      productFamily: identity.productFamily,
      symbol: identity.symbol,
      pair: identity.pair,
      baseAsset: identity.baseAsset,
      quoteAsset: identity.quoteAsset,
      contractType: identity.contractType,
    },
    receivedTimeMs,
    evaluatedAtMs: T0,
    maxAgeMs: 1_000,
    previousSequence,
  };
}

function canonicalTrade(sourceKey, symbol, sequence, eventTimeMs, receivedTimeMs = eventTimeMs + 2, previousSequence = null) {
  const raw = {
    e: 'aggTrade', E: eventTimeMs, T: eventTimeMs + 1, s: symbol,
    a: String(sequence), f: String(sequence), l: String(sequence),
    p: '100', q: '2', m: false,
    ...(sourceKey === 'USD_M_AGG_TRADE' ? { ps: symbol, st: 1, nq: '2' } : {}),
  };
  return normalized(normalizeTrade(raw, normalizationContext(sourceKey, symbol, receivedTimeMs, previousSequence)));
}

function canonicalSpotBook(symbol, sequence, receivedTimeMs) {
  return normalized(normalizeBookTicker({
    u: String(sequence), s: symbol, b: '99.9', B: '10', a: '100.1', A: '12',
  }, normalizationContext('SPOT_BOOK_TICKER', symbol, receivedTimeMs)));
}

function canonicalUsdMBook(symbol, sequence, eventTimeMs, transactionTimeMs, receivedTimeMs) {
  return normalized(normalizeBookTicker({
    e: 'bookTicker', E: eventTimeMs, T: transactionTimeMs,
    s: symbol, ps: symbol, st: 1, u: String(sequence),
    b: '99.9', B: '10', a: '100.1', A: '12',
  }, normalizationContext('USD_M_BOOK_TICKER', symbol, receivedTimeMs)));
}

function canonicalSpotDepthSnapshot(symbol, sequence, receivedTimeMs) {
  return normalized(normalizeDepth({
    lastUpdateId: String(sequence),
    bids: [['99.9', '10']], asks: [['100.1', '10']], requestedLimit: 100,
  }, normalizationContext('SPOT_DEPTH_SNAPSHOT', symbol, receivedTimeMs)));
}

function canonicalSpotDepthDelta(symbol, first, last, eventTimeMs, receivedTimeMs) {
  return normalized(normalizeDepth({
    e: 'depthUpdate', E: eventTimeMs, s: symbol,
    U: String(first), u: String(last), b: [['99.9', '9']], a: [['100.1', '9']],
  }, normalizationContext('SPOT_DEPTH_DELTA', symbol, receivedTimeMs)));
}

function canonicalUsdMDepthSnapshot(symbol, sequence, eventTimeMs, transactionTimeMs, receivedTimeMs) {
  return normalized(normalizeDepth({
    lastUpdateId: String(sequence), E: eventTimeMs, T: transactionTimeMs,
    bids: [['99.9', '10']], asks: [['100.1', '10']], requestedLimit: 100,
  }, normalizationContext('USD_M_DEPTH_SNAPSHOT', symbol, receivedTimeMs)));
}

function canonicalUsdMDepthDelta(sourceKey, symbol, first, last, previous, eventTimeMs, transactionTimeMs, receivedTimeMs) {
  return normalized(normalizeDepth({
    e: 'depthUpdate', E: eventTimeMs, T: transactionTimeMs,
    s: symbol, ps: symbol, st: 1,
    U: String(first), u: String(last), pu: String(previous),
    b: [['99.9', '9']], a: [['100.1', '9']],
  }, normalizationContext(sourceKey, symbol, receivedTimeMs, { last: String(previous) })));
}

function canonicalContext(eventTimeMs, transactionTimeMs, receivedTimeMs) {
  return normalized(normalizeContext({
    recordId: `context-${eventTimeMs}-${transactionTimeMs}`,
    contextType: 'PUBLIC_NEWS_REGIME',
    scope: 'MARKET',
    values: { regime: 'active', itemCount: 2 },
    sourceEventTimeMs: eventTimeMs,
    sourceTransactionTimeMs: transactionTimeMs,
  }, normalizationContext('CONTEXT_INJECTED', 'BTCUSDT', receivedTimeMs)));
}

function listing(identity, atMs) {
  return {
    id: stableId('routing-test-listing', identity),
    kind: identity.productFamily === 'SPOT' ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument: identity,
    tradingStatus: 'TRADING',
    tradingAllowed: true,
    aliases: [identity.symbol],
    rules: {
      minimumPrice: null, maximumPrice: null, tickSize: null, minimumQuantity: null,
      maximumQuantity: null, quantityStep: null, minimumNotional: null, maximumNotional: null,
    },
    quoteVolume: null,
    quoteVolume24hUsd: null,
    truth: listingTruth(atMs, `listing-${identity.productFamily}`),
  };
}

function universe(atMs = T0, symbols = ['BTCUSDT']) {
  const spot = symbols.map((symbol) => instrument('SPOT', symbol));
  const perpetual = symbols.map((symbol) => instrument('USD_M_PERPETUAL', symbol));
  return buildUniverseGraph({
    observedAtMs: atMs,
    spot: { source: 'SPOT', state: 'COMPLETE', records: spot.map((identity) => listing(identity, atMs)), truth: listingTruth(atMs, 'spot-listings') },
    usdMPerpetual: { source: 'USD_M_PERPETUAL', state: 'COMPLETE', records: perpetual.map((identity) => listing(identity, atMs)), truth: listingTruth(atMs, 'perp-listings') },
    margin: { source: 'MARGIN', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'margin-listings') },
    borrow: { source: 'BORROW', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'borrow-listings') },
    coverage: { source: 'COVERAGE', state: 'UNAVAILABLE', records: [], truth: unavailableTruth(atMs, 'coverage') },
  }, { configurationVersion: 'routing-test-universe-1', requirePublicDataForFocus: false });
}

function evidence(kind, sourceKey, atMs, fields = {}, options = {}) {
  const productFamily = options.productFamily ?? (sourceKey.startsWith('SPOT_') ? 'SPOT' : 'USD_M_PERPETUAL');
  const identity = options.instrument ?? instrument(productFamily);
  const id = stableId('routing-test-evidence', { kind, sourceKey, atMs, fields, sequence: options.sequence ?? null });
  return {
    id,
    kind,
    instrument: identity,
    truth: sourceTruth(sourceKey, atMs, id, options),
    ...fields,
  };
}

function trade(sourceKey, atMs, sequence, productFamily = 'SPOT', price = 100) {
  return evidence('TRADE', sourceKey, atMs, {
    aggregateTradeId: String(sequence), firstTradeId: String(sequence), lastTradeId: String(sequence),
    price, baseQuantity: 2, quoteQuantity: 2 * price,
    normalBaseQuantityExcludingRpi: productFamily === 'USD_M_PERPETUAL' ? 2 : null,
    aggressorSide: 'BUY',
  }, { productFamily, sequence: { first: String(sequence), last: String(sequence), previous: null } });
}

function book(atMs, identity = undefined, updateId = 10) {
  return evidence('BOOK_TICKER', 'SPOT_BOOK_TICKER', atMs, {
    updateId: String(updateId), bidPrice: 99.9, bidQuantity: 10, askPrice: 100.1, askQuantity: 12,
  }, {
    instrument: identity,
    sequence: { first: String(updateId), last: String(updateId), previous: null },
  });
}

function depth(kind, sourceKey, atMs, first, last = first, previous = null, quantity = 10, identity = undefined) {
  return evidence(kind, sourceKey, atMs, {
    bids: [{ price: 99.9, baseQuantity: quantity }],
    asks: [{ price: 100.1, baseQuantity: quantity }],
    bookScope: 'UNKNOWN', maximumLevelsKnown: 1,
  }, {
    instrument: identity,
    sequence: { first: String(first), last: String(last), previous: previous === null ? null : String(previous) },
  });
}

function mark(atMs, price = 100) {
  return evidence('MARK_PRICE', 'USD_M_MARK_PRICE', atMs, {
    markPrice: price, indexPrice: price - 0.1, estimatedSettlementPrice: null, movingAverageMarkPrice: null,
  });
}

function funding(atMs, rate = 0.0001) {
  return evidence('FUNDING', 'USD_M_MARK_PRICE', atMs, {
    fundingRate: rate, fundingIntervalHours: null, nextFundingTimeMs: atMs + 8 * 60 * 60_000,
    adjustedRateCap: null, adjustedRateFloor: null,
  });
}

function openInterest(atMs, amount = 1_000) {
  return evidence('OPEN_INTEREST', 'USD_M_OPEN_INTEREST', atMs, {
    openInterestBase: amount, openInterestQuoteValue: amount * 100,
    changeBase: null, changeQuoteValue: null, comparisonWindowMs: null,
  });
}

function liquidation(atMs, selection = 'LATEST_PER_SYMBOL') {
  return evidence('LIQUIDATION', 'USD_M_LIQUIDATION', atMs, {
    orderSide: 'SELL', liquidatedPositionSide: 'LONG', orderType: 'LIMIT', timeInForce: 'IOC',
    originalQuantity: 2, filledQuantity: 2, averagePrice: 99,
    sampledPerWindow: true, samplingSelection: selection, sampleWindowMs: 1_000,
  });
}

function context(atMs) {
  return evidence('CONTEXT', 'CONTEXT_INJECTED', atMs, {
    contextType: 'PUBLIC_NEWS_REGIME', scope: 'MARKET', values: { regime: 'active', itemCount: 2 },
  }, { productFamily: 'SPOT' });
}

function rateBudget(state = 'UNKNOWN', atMs = T0) {
  if (state === 'UNKNOWN') {
    return { state, usedWeight: null, limit: null, intervalMs: null, resetsAtMs: null, retryAfterMs: null, observedAtMs: null };
  }
  return {
    state,
    usedWeight: state === 'EXHAUSTED' || state === 'COOLDOWN' ? 1_000 : 1,
    limit: 1_000,
    intervalMs: 60_000,
    resetsAtMs: atMs + 60_000,
    retryAfterMs: state === 'EXHAUSTED' || state === 'COOLDOWN' ? 1_000 : null,
    observedAtMs: atMs,
  };
}

function source(sourceKey, clock, overrides = {}) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  return {
    sourceId: fact.sourceId,
    dataset: fact.dataset,
    endpointClass: fact.endpointClass,
    lifecycle: overrides.lifecycle ?? 'LIVE',
    authority: overrides.authority ?? (sourceKey === 'USD_M_LIQUIDATION' ? 'SAMPLED' : 'COMPLETE'),
    continuity: overrides.continuity ?? 'CONTIGUOUS',
    generation: overrides.generation ?? 1,
    revision: overrides.revision ?? 1,
    bootstrap: overrides.bootstrap ?? 'CONTIGUOUS_OWNER',
    rateBudget: overrides.rateBudget ?? rateBudget(fact.endpointClass === 'REST' ? 'AVAILABLE' : 'UNKNOWN', clock.nowMs()),
    observedAtMs: clock.nowMs(),
  };
}

function harness(bridgeConfig = {}, symbols = ['BTCUSDT'], routerConfig = {}) {
  const clock = new ManualClock();
  const bridge = new IntelligenceRuntimeBridge({
    clock,
    config: { featureBank: { minimumMarketSymbols: 1 }, ...bridgeConfig },
  });
  assert.equal(bridge.updateUniverse(universe(T0, symbols)).accepted, true);
  const calls = [];
  const router = new VolumeEvidenceRouter({
    clock,
    ...routerConfig,
    sink: {
      ingest(batch) {
        calls.push(structuredClone(batch));
        return bridge.ingest(batch);
      },
    },
  });
  return { clock, bridge, calls, router, revisions: new Map() };
}

function route(h, sourceKey, rows, overrides = {}) {
  const generation = overrides.source?.generation ?? 1;
  const revisionKey = `${sourceKey}:${generation}`;
  const revision = overrides.source?.revision ?? ((h.revisions.get(revisionKey) ?? 0) + 1);
  h.revisions.set(revisionKey, Math.max(revision, h.revisions.get(revisionKey) ?? 0));
  return h.router.route({
    correlationId: overrides.correlationId ?? `routing.${sourceKey}.${h.calls.length}`,
    scope: overrides.scope ?? 'BROAD',
    source: source(sourceKey, h.clock, { ...overrides.source, generation, revision }),
    evidence: rows,
  });
}

function capability(snapshot, name) {
  const value = snapshot.capabilities.find((entry) => entry.capability === name);
  assert.ok(value, `missing capability ${name}`);
  return value;
}

test('registered fresh evidence reaches the one Bridge/FeatureBank and preserves sampled liquidation truth', () => {
  const h = harness();
  assert.ok(h.router.snapshot().capabilities.every((entry) => entry.freshness === 'MISSING'));

  assert.equal(route(h, 'SPOT_AGG_TRADE', [trade('SPOT_AGG_TRADE', T0 - 400, 1)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 300)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 250, 100)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 200, 100, 101)]).state, 'FRESH');
  assert.equal(route(h, 'USD_M_MARK_PRICE', [mark(T0 - 180), funding(T0 - 180)]).state, 'FRESH');
  assert.equal(route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 150)]).state, 'FRESH');
  const liquidationReceipt = route(h, 'USD_M_LIQUIDATION', [liquidation(T0 - 120)]);
  assert.equal(liquidationReceipt.state, 'SAMPLED');
  assert.match(liquidationReceipt.failures.map((failure) => failure.message).join(' '), /sampled latest-per-symbol lower bounds/);
  assert.equal(route(h, 'CONTEXT_INJECTED', [context(T0 - 100)]).state, 'FRESH');

  const snapshot = h.router.snapshot();
  for (const name of [
    'ROLLING_ACTIVITY_FLOW', 'SPREAD_DEPTH_BOOK', 'CROSS_MARKET_LEADERSHIP',
    'OPEN_INTEREST', 'FUNDING', 'VOLATILITY', 'CONTEXT',
  ]) assert.equal(capability(snapshot, name).freshness, 'FRESH', name);
  assert.equal(capability(snapshot, 'LIQUIDATION').completeness, 'SAMPLED');
  assert.ok(capability(snapshot, 'LIQUIDATION').reasonCodes.includes('SAMPLED_LATEST_PER_SYMBOL_LOWER_BOUND'));
  assert.ok(capability(snapshot, 'SPREAD_DEPTH_BOOK').reasonCodes.includes('DEPTH_LEVEL_REMOVAL_CAUSALITY_UNKNOWN'));
  assert.equal(capability(snapshot, 'SOURCE_QUALITY').completeness, 'PARTIAL');
  assert.equal(snapshot.authority, 'EVIDENCE_ONLY');
  assert.equal(snapshot.liveMoneyAuthority, 'NONE');
  // Bridge acceptance implies its sole internal FeatureBank accepted each item
  // before the bounded evidence index retained it.
  assert.equal(h.bridge.snapshot().evidenceIndex.size, 9);

  h.clock.advance(1_001);
  const stale = h.router.snapshot();
  assert.equal(capability(stale, 'ROLLING_ACTIVITY_FLOW').freshness, 'STALE');
  assert.equal(capability(stale, 'CROSS_MARKET_LEADERSHIP').freshness, 'STALE');
  assert.equal(capability(stale, 'OPEN_INTEREST').freshness, 'STALE');
  assert.equal(capability(stale, 'LIQUIDATION').freshness, 'STALE');
  assert.equal(capability(stale, 'CONTEXT').freshness, 'STALE');
});

test('canonical trade continuity and book-ticker monotonicity reject regression and trade gaps', () => {
  const trades = harness();
  assert.equal(route(trades, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 100, T0 - 100),
  ]).state, 'FRESH');
  const forgedTradeSource = canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 101, T0 - 90);
  const forgedTradeCursor = {
    ...forgedTradeSource,
    aggregateTradeId: '99',
    firstTradeId: '99',
    lastTradeId: '99',
  };
  const forgedTradeReceipt = route(trades, 'SPOT_AGG_TRADE', [forgedTradeCursor]);
  assert.equal(forgedTradeReceipt.state, 'REJECTED');
  assert.equal(forgedTradeReceipt.routed, 0);
  assert.ok(forgedTradeReceipt.failures.some((failure) => failure.code === 'INVALID_VALUE'));
  assert.equal(trades.calls.length, 1);

  const missingTradeIdentifier = { ...forgedTradeSource, aggregateTradeId: null };
  const missingTradeIdReceipt = route(trades, 'SPOT_AGG_TRADE', [missingTradeIdentifier]);
  assert.equal(missingTradeIdReceipt.state, 'REJECTED');
  assert.equal(missingTradeIdReceipt.routed, 0);
  assert.ok(missingTradeIdReceipt.failures.some((failure) => failure.code === 'INCOMPLETE_EVIDENCE'));
  assert.equal(trades.calls.length, 1);

  const regressiveTrade = route(trades, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 99, T0 - 90),
  ]);
  assert.equal(regressiveTrade.state, 'OUT_OF_ORDER');
  assert.equal(regressiveTrade.routed, 0);
  const sourceTimeRegression = route(trades, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 101, T0 - 110, T0 - 80),
  ]);
  assert.equal(sourceTimeRegression.state, 'OUT_OF_ORDER');
  assert.equal(sourceTimeRegression.routed, 0);
  const skippedTrade = route(trades, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 105, T0 - 80),
  ]);
  assert.equal(skippedTrade.state, 'SEQUENCE_GAP');
  assert.equal(skippedTrade.routed, 0);
  assert.equal(capability(trades.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  const backfill = [105, 103, 101, 104, 102].map((sequence) => (
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', sequence, T0 - 79)
  ));
  assert.equal(route(trades, 'SPOT_AGG_TRADE', backfill).state, 'FRESH');
  assert.equal(capability(trades.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'FRESH');

  for (const continuity of ['GAP', 'UNKNOWN']) {
    const unanchored = harness();
    const receipt = route(unanchored, 'SPOT_AGG_TRADE', [
      canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 100, T0 - 70),
    ], { source: { continuity } });
    assert.equal(receipt.state, 'SEQUENCE_GAP');
    assert.equal(receipt.routed, 0);
    assert.equal(capability(unanchored.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  }

  const normalizerGap = canonicalTrade(
    'SPOT_AGG_TRADE', 'BTCUSDT', 105, T0 - 60, T0 - 58, { last: '100' },
  );
  assert.equal(normalizerGap.truth.completeness.state, 'PARTIAL');
  assert.ok(normalizerGap.truth.completeness.reasonCodes.includes('SEQUENCE_GAP'));
  const embeddedGap = harness();
  const embeddedGapReceipt = route(embeddedGap, 'SPOT_AGG_TRADE', [normalizerGap]);
  assert.equal(embeddedGapReceipt.state, 'SEQUENCE_GAP');
  assert.equal(embeddedGapReceipt.routed, 0);
  assert.equal(capability(embeddedGap.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');

  const books = harness();
  assert.equal(route(books, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 100, T0 - 100),
  ]).state, 'FRESH');
  const forgedBookSource = canonicalSpotBook('BTCUSDT', 101, T0 - 90);
  const forgedBookReceipt = route(books, 'SPOT_BOOK_TICKER', [{
    ...forgedBookSource,
    updateId: '99',
  }]);
  assert.equal(forgedBookReceipt.state, 'REJECTED');
  assert.equal(forgedBookReceipt.routed, 0);
  assert.ok(forgedBookReceipt.failures.some((failure) => failure.code === 'INVALID_VALUE'));
  assert.equal(books.calls.length, 1);
  const regressiveBook = route(books, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 99, T0 - 90),
  ]);
  assert.equal(regressiveBook.state, 'OUT_OF_ORDER');
  assert.equal(regressiveBook.routed, 0);
  assert.equal(route(books, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 105, T0 - 80),
  ], { source: { continuity: 'UNKNOWN' } }).state, 'FRESH');

  const usdBooks = harness();
  assert.equal(route(usdBooks, 'USD_M_BOOK_TICKER', [
    canonicalUsdMBook('BTCUSDT', 100, T0 - 110, T0 - 100, T0 - 90),
  ]).state, 'FRESH');
  const usdBookTimeRegression = route(usdBooks, 'USD_M_BOOK_TICKER', [
    canonicalUsdMBook('BTCUSDT', 101, T0 - 120, T0 - 110, T0 - 80),
  ]);
  assert.equal(usdBookTimeRegression.state, 'OUT_OF_ORDER');
  assert.equal(usdBookTimeRegression.routed, 0);
});

test('capability joins cannot cross symbols for leadership or Spot book depth', () => {
  const leadership = harness({}, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(route(leadership, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 100, T0 - 100),
  ]).state, 'FRESH');
  assert.equal(route(leadership, 'USD_M_AGG_TRADE', [
    canonicalTrade('USD_M_AGG_TRADE', 'ETHUSDT', 100, T0 - 90),
  ]).state, 'FRESH');
  const mismatchedLeadership = capability(leadership.router.snapshot(), 'CROSS_MARKET_LEADERSHIP');
  assert.equal(mismatchedLeadership.freshness, 'MISSING');
  assert.equal(mismatchedLeadership.completeness, 'PARTIAL');
  assert.ok(mismatchedLeadership.reasonCodes.includes('CAPABILITY_INSTRUMENT_JOIN_MISSING'));

  const bookDepth = harness({}, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(route(bookDepth, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 100, T0 - 100),
  ]).state, 'FRESH');
  assert.equal(route(bookDepth, 'SPOT_DEPTH_SNAPSHOT', [
    canonicalSpotDepthSnapshot('ETHUSDT', 100, T0 - 90),
  ]).state, 'FRESH');
  const mismatchedBookDepth = capability(bookDepth.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(mismatchedBookDepth.freshness, 'MISSING');
  assert.equal(mismatchedBookDepth.completeness, 'PARTIAL');
  assert.ok(mismatchedBookDepth.reasonCodes.includes('CAPABILITY_INSTRUMENT_JOIN_MISSING'));

  const alternatePriceSources = harness();
  assert.equal(route(alternatePriceSources, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 100, T0 - 100),
  ]).state, 'FRESH');
  assert.equal(route(alternatePriceSources, 'USD_M_AGG_TRADE', [
    canonicalTrade('USD_M_AGG_TRADE', 'BTCUSDT', 100, T0 - 90),
  ]).state, 'FRESH');
  assert.equal(capability(alternatePriceSources.router.snapshot(), 'CROSS_MARKET_LEADERSHIP').freshness, 'FRESH');
  assert.equal(route(alternatePriceSources, 'SPOT_AGG_TRADE', []).state, 'MISSING');
  assert.equal(capability(alternatePriceSources.router.snapshot(), 'CROSS_MARKET_LEADERSHIP').freshness, 'FRESH');

  const missingDepthDelta = harness();
  assert.equal(route(missingDepthDelta, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 100, T0 - 100),
  ]).state, 'FRESH');
  assert.equal(route(missingDepthDelta, 'SPOT_DEPTH_SNAPSHOT', [
    canonicalSpotDepthSnapshot('BTCUSDT', 100, T0 - 99),
  ]).state, 'FRESH');
  assert.equal(capability(missingDepthDelta.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
  assert.equal(route(missingDepthDelta, 'SPOT_DEPTH_DELTA', []).state, 'MISSING');
  assert.equal(capability(missingDepthDelta.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.equal(route(missingDepthDelta, 'SPOT_DEPTH_DELTA', [
    canonicalSpotDepthDelta('BTCUSDT', 101, 101, T0 - 98, T0 - 97),
  ]).state, 'SEQUENCE_GAP');
  assert.equal(route(missingDepthDelta, 'SPOT_DEPTH_SNAPSHOT', [
    canonicalSpotDepthSnapshot('BTCUSDT', 200, T0 - 96),
  ]).state, 'FRESH');
  assert.equal(route(missingDepthDelta, 'SPOT_DEPTH_DELTA', [
    canonicalSpotDepthDelta('BTCUSDT', 201, 201, T0 - 95, T0 - 94),
  ]).state, 'FRESH');
  assert.equal(capability(missingDepthDelta.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('canonical buffered Spot depth bridges a later REST snapshot by sequence rather than mixed clocks', () => {
  const h = harness();
  const snapshot = canonicalSpotDepthSnapshot('BTCUSDT', 100, T0 - 100);
  const bufferedDelta = canonicalSpotDepthDelta('BTCUSDT', 101, 101, T0 - 200, T0 - 50);
  assert.equal(snapshot.truth.temporal.sourceEventTimeMs, null);
  assert.equal(bufferedDelta.truth.temporal.sourceEventTimeMs, T0 - 200);
  assert.ok(bufferedDelta.truth.temporal.receivedTimeMs > snapshot.truth.temporal.receivedTimeMs);
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [snapshot]).state, 'FRESH');
  const bridged = route(h, 'SPOT_DEPTH_DELTA', [bufferedDelta]);
  assert.equal(bridged.state, 'FRESH');
  assert.equal(bridged.routed, 1);
  const driftedBasisSource = canonicalSpotDepthDelta('BTCUSDT', 102, 102, T0 - 250, T0 - 40);
  const driftedBasis = {
    ...driftedBasisSource,
    truth: {
      ...driftedBasisSource.truth,
      freshness: {
        ...driftedBasisSource.truth.freshness,
        basis: 'RECEIVE_TIME',
        ageMs: T0 - driftedBasisSource.truth.temporal.receivedTimeMs,
      },
    },
  };
  const rejectedBasisDrift = route(h, 'SPOT_DEPTH_DELTA', [driftedBasis]);
  assert.equal(rejectedBasisDrift.state, 'REJECTED');
  assert.equal(rejectedBasisDrift.routed, 0);
  assert.ok(rejectedBasisDrift.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));
  const regressiveStreamTime = route(h, 'SPOT_DEPTH_DELTA', [
    canonicalSpotDepthDelta('BTCUSDT', 102, 102, T0 - 250, T0 - 40),
  ]);
  assert.equal(regressiveStreamTime.state, 'OUT_OF_ORDER');
  assert.equal(regressiveStreamTime.routed, 0);
});

test('missing, out-of-order, depth-gap, and resync truth fail closed without fake cancellation claims', () => {
  const h = harness();
  const empty = route(h, 'SPOT_AGG_TRADE', []);
  assert.equal(empty.state, 'MISSING');
  assert.equal(h.calls.length, 0);
  assert.equal(capability(h.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');

  assert.equal(route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 10, 1_000)]).state, 'FRESH');
  const older = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 20, 900)]);
  assert.equal(older.state, 'OUT_OF_ORDER');
  assert.equal(older.routed, 0);
  assert.ok(older.failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT'));

  assert.equal(route(h, 'CONTEXT_INJECTED', [
    canonicalContext(T0 - 200, T0 - 100, T0 - 50),
  ]).state, 'FRESH');
  const regressiveContextEventTime = route(h, 'CONTEXT_INJECTED', [
    canonicalContext(T0 - 300, T0 - 40, T0 - 30),
  ]);
  assert.equal(regressiveContextEventTime.state, 'OUT_OF_ORDER');
  assert.equal(regressiveContextEventTime.routed, 0);
  assert.equal(capability(h.router.snapshot(), 'CONTEXT').lastEvidenceTimeMs, T0 - 200);

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 9, 100)]).state, 'FRESH');
  const gapDelta = depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 8, 102, 103);
  const gap = route(h, 'SPOT_DEPTH_DELTA', [gapDelta]);
  assert.equal(gap.state, 'SEQUENCE_GAP');
  assert.equal(gap.routed, 0);
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.ok(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const fencedGapReplay = route(h, 'SPOT_DEPTH_DELTA', [gapDelta], {
    source: { revision: 1, bootstrap: 'CONTIGUOUS_OWNER' },
  });
  assert.equal(fencedGapReplay.state, 'REJECTED');
  assert.ok(fencedGapReplay.failures.some((failure) => failure.code === 'STALE_SOURCE'));
  assert.ok(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').reasonCodes
    .includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const stillUnsynchronized = route(h, 'SPOT_DEPTH_DELTA', [depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 7, 103, 104)]);
  assert.equal(stillUnsynchronized.state, 'SEQUENCE_GAP');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 6, 200)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 5, 200, 201)]).state, 'FRESH');
  const reasonText = h.router.snapshot().capabilities.flatMap((entry) => entry.reasonCodes).join(' ');
  assert.doesNotMatch(reasonText, /cancell?ation/i);
  assert.match(reasonText, /REMOVAL_CAUSALITY_UNKNOWN/);
});

test('a later Spot depth gap dominates an earlier accepted delta in the same batch until independent resnapshot', () => {
  const h = harness();
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 20)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 19, 100),
  ]).state, 'FRESH');

  const mixed = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 18, 100, 101),
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 17, 103, 104),
  ]);
  assert.equal(mixed.state, 'SEQUENCE_GAP');
  assert.equal(mixed.routed, 1);
  assert.equal(mixed.rejected, 1);
  const afterMixed = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(afterMixed.freshness, 'MISSING');
  assert.equal(afterMixed.completeness, 'PARTIAL');
  assert.ok(afterMixed.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const stillUnsynchronized = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 16, 104, 105),
  ]);
  assert.equal(stillUnsynchronized.state, 'SEQUENCE_GAP');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 15, 200),
  ]).state, 'FRESH');
  const afterSiblingSnapshot = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(afterSiblingSnapshot.freshness, 'MISSING');
  assert.ok(afterSiblingSnapshot.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 14, 200, 201),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
  assert.ok(!capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').reasonCodes
    .includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));
});

test('registered-source routing rejects authority-kind drift before ordering or sink work', () => {
  const h = harness();
  const valid = trade('SPOT_AGG_TRADE', T0 - 20, 1);
  const drifted = {
    ...valid,
    truth: {
      ...valid.truth,
      authority: { ...valid.truth.authority, kind: 'CONTEXTUAL' },
    },
  };
  const receipt = route(h, 'SPOT_AGG_TRADE', [drifted]);
  assert.equal(receipt.state, 'REJECTED');
  assert.equal(receipt.routed, 0);
  assert.ok(receipt.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));

  const driftedTradeBasis = {
    ...valid,
    truth: {
      ...valid.truth,
      freshness: { ...valid.truth.freshness, basis: 'SOURCE_EVENT_TIME' },
    },
  };
  const tradeBasisReceipt = route(h, 'SPOT_AGG_TRADE', [driftedTradeBasis]);
  assert.equal(tradeBasisReceipt.state, 'REJECTED');
  assert.equal(tradeBasisReceipt.routed, 0);
  assert.ok(tradeBasisReceipt.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));

  const validSnapshot = depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 19, 100);
  const driftedSnapshotBasis = {
    ...validSnapshot,
    truth: {
      ...validSnapshot.truth,
      freshness: { ...validSnapshot.truth.freshness, basis: 'SOURCE_EVENT_TIME' },
    },
  };
  const snapshotBasisReceipt = route(h, 'SPOT_DEPTH_SNAPSHOT', [driftedSnapshotBasis]);
  assert.equal(snapshotBasisReceipt.state, 'REJECTED');
  assert.equal(snapshotBasisReceipt.routed, 0);
  assert.ok(snapshotBasisReceipt.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));
  assert.equal(h.calls.length, 0);
  assert.equal(h.router.snapshot().series, 0);
});

test('depth resync watermark survives a real Bridge rejection in a mixed gap batch', () => {
  const h = harness({ maximumProvenanceIds: 1 });
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 30)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 29, 100),
  ]).state, 'FRESH');

  const bridgeRejected = depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 28, 100, 101);
  const overboundProvenance = {
    ...bridgeRejected,
    truth: {
      ...bridgeRejected.truth,
      provenance: {
        ...bridgeRejected.truth.provenance,
        transforms: ['routing-test-fixture', 'bridge-budget-rejection'],
      },
    },
  };
  const mixed = route(h, 'SPOT_DEPTH_DELTA', [
    overboundProvenance,
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 27, 103, 104),
  ]);
  assert.equal(mixed.state, 'SEQUENCE_GAP');
  assert.equal(mixed.routed, 0);
  assert.equal(mixed.rejected, 2);
  assert.ok(mixed.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'));
  const afterRejectedCut = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(afterRejectedCut.freshness, 'MISSING');
  assert.ok(afterRejectedCut.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const cannotReusePriorCursor = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 26, 100, 101),
  ]);
  assert.equal(cannotReusePriorCursor.state, 'SEQUENCE_GAP');
  assert.equal(cannotReusePriorCursor.routed, 0);

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 25, 200),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 24, 200, 201),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('trade gap isolation and duplicate reconciliation recover after partial Bridge acceptance', () => {
  const h = harness({ maximumProvenanceIds: 1 });
  const bookEvidence = canonicalSpotBook('BTCUSDT', 100, T0 - 100);
  const depthEvidence = canonicalSpotDepthSnapshot('BTCUSDT', 100, T0 - 99);
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [bookEvidence]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [depthEvidence]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');

  const trade100 = canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 100, T0 - 90);
  const trade101 = canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 101, T0 - 89);
  const trade102 = canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 102, T0 - 88);
  const trade105 = canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 105, T0 - 85);
  assert.equal(route(h, 'SPOT_AGG_TRADE', [trade100]).state, 'FRESH');
  const overbound102 = {
    ...trade102,
    truth: {
      ...trade102.truth,
      provenance: {
        ...trade102.truth.provenance,
        transforms: [...trade102.truth.provenance.transforms, 'bridge-budget-rejection'],
      },
    },
  };
  const mixed = route(h, 'SPOT_AGG_TRADE', [trade101, overbound102, trade105]);
  assert.equal(mixed.state, 'SEQUENCE_GAP');
  assert.equal(mixed.routed, 1);
  assert.ok(mixed.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'));
  assert.equal(capability(h.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');

  const backfill = [
    trade101,
    trade102,
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 103, T0 - 87),
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 104, T0 - 86),
    trade105,
  ];
  const recovered = route(h, 'SPOT_AGG_TRADE', backfill);
  assert.equal(recovered.state, 'FRESH');
  assert.equal(recovered.duplicate, 1);
  assert.equal(recovered.routed, 4);
  assert.equal(capability(h.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('a duplicate pre-gap snapshot cannot clear depth resync truth', () => {
  const h = harness();
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 30)]).state, 'FRESH');
  const originalSnapshot = depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 29, 100);
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [originalSnapshot]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    // A producer-declared continuity gap can retain the same final cursor.
    // Equal event time and sequence make the old snapshot a true Bridge
    // duplicate rather than a temporal or sequence-regression rejection.
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 29, 100, 100),
  ], { source: { continuity: 'GAP' } }).state, 'SEQUENCE_GAP');

  const replay = route(h, 'SPOT_DEPTH_SNAPSHOT', [originalSnapshot]);
  assert.equal(replay.state, 'MISSING');
  assert.equal(replay.routed, 0);
  assert.equal(replay.duplicate, 1);
  const snapshotSourceId = BINANCE_SOURCE_FACTS.SPOT_DEPTH_SNAPSHOT.sourceId;
  const replaySource = h.router.snapshot().sources.find((entry) => entry.sourceId === snapshotSourceId);
  assert.deepEqual([replaySource.revision, replaySource.bootstrapped], [2, false]);
  const afterReplay = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(afterReplay.freshness, 'MISSING');
  assert.ok(afterReplay.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const fencedReplay = route(h, 'SPOT_DEPTH_SNAPSHOT', [originalSnapshot], {
    source: { revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(fencedReplay.state, 'REJECTED');
  assert.ok(fencedReplay.failures.some((failure) => failure.code === 'STALE_SOURCE'));
  assert.ok(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').reasonCodes
    .includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 28, 200),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 27, 200, 201),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('a rejected new-generation pre-gap replay cannot erase the prior depth cursor', () => {
  const h = harness();
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 40)]).state, 'FRESH');
  const originalSnapshot = depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 39, 100);
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [originalSnapshot], {
    source: { generation: 1, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 38, 102, 103),
  ], {
    source: { generation: 1, revision: 1, bootstrap: 'CONTIGUOUS_OWNER', continuity: 'CONTIGUOUS' },
  }).state, 'SEQUENCE_GAP');

  const newGenerationReplay = route(h, 'SPOT_DEPTH_SNAPSHOT', [originalSnapshot], {
    source: { generation: 2, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(newGenerationReplay.state, 'MISSING');
  assert.equal(newGenerationReplay.duplicate, 1);
  assert.equal(h.router.snapshot().sources.find((entry) => (
    entry.sourceId === BINANCE_SOURCE_FACTS.SPOT_DEPTH_SNAPSHOT.sourceId
      && entry.dataset === BINANCE_SOURCE_FACTS.SPOT_DEPTH_SNAPSHOT.dataset
  )).bootstrapped, false);
  assert.ok(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').reasonCodes
    .includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const higherSnapshotReplay = route(h, 'SPOT_DEPTH_SNAPSHOT', [originalSnapshot], {
    source: { generation: 2, revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(higherSnapshotReplay.state, 'OUT_OF_ORDER');
  assert.ok(higherSnapshotReplay.failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT'));
  const lowDelta = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 36, 100, 101),
  ], {
    source: { generation: 1, revision: 2, bootstrap: 'CONTIGUOUS_OWNER', continuity: 'CONTIGUOUS' },
  });
  assert.equal(lowDelta.state, 'SEQUENCE_GAP');
  assert.ok(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').reasonCodes
    .includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));
});

test('depth generation replacement purges only its exact book scope', () => {
  const h = harness();
  assert.equal(route(h, 'USD_M_DEPTH_SNAPSHOT', [
    canonicalUsdMDepthSnapshot('BTCUSDT', 100, T0 - 60, T0 - 59, T0 - 58),
  ], {
    source: { generation: 1, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
  const rpiGap = route(h, 'USD_M_RPI_DEPTH_DELTA', [
    canonicalUsdMDepthDelta(
      'USD_M_RPI_DEPTH_DELTA', 'BTCUSDT', 500, 501, 499,
      T0 - 57, T0 - 56, T0 - 55,
    ),
  ], {
    source: { generation: 1, revision: 1, bootstrap: 'CONTIGUOUS_OWNER', continuity: 'CONTIGUOUS' },
  });
  assert.equal(rpiGap.state, 'SEQUENCE_GAP');
  assert.equal(h.router.snapshot().series, 2);

  assert.equal(route(h, 'USD_M_DEPTH_SNAPSHOT', [
    canonicalUsdMDepthSnapshot('BTCUSDT', 200, T0 - 54, T0 - 53, T0 - 52),
  ], {
    source: { generation: 2, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
  assert.equal(h.router.snapshot().series, 2, 'STANDARD restart must retain the independent RPI gap cursor');

  const rpiStillFenced = route(h, 'USD_M_RPI_DEPTH_DELTA', [
    canonicalUsdMDepthDelta(
      'USD_M_RPI_DEPTH_DELTA', 'BTCUSDT', 502, 503, 501,
      T0 - 51, T0 - 50, T0 - 49,
    ),
  ], {
    source: { generation: 1, revision: 2, bootstrap: 'CONTIGUOUS_OWNER', continuity: 'CONTIGUOUS' },
  });
  assert.equal(rpiStillFenced.state, 'SEQUENCE_GAP');
  assert.ok(rpiStillFenced.failures.some((failure) => (
    failure.code === 'SEQUENCE_GAP' && /requires a newly accepted snapshot/.test(failure.message)
  )));
});

test('a later-received sequence-regressive snapshot cannot replace a depth gap cursor', () => {
  const h = harness();
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 30)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 29, 100),
  ]).state, 'FRESH');

  const paddedRegression = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 28, '000', '001', '100'),
  ]);
  assert.equal(paddedRegression.state, 'OUT_OF_ORDER');
  assert.equal(paddedRegression.routed, 0);

  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 27, 103, 104),
  ]).state, 'SEQUENCE_GAP');

  const regressive = route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 26, 50),
  ]);
  assert.equal(regressive.state, 'OUT_OF_ORDER');
  assert.equal(regressive.routed, 0);
  assert.ok(regressive.failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT'));
  const afterRegressiveSnapshot = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(afterRegressiveSnapshot.freshness, 'MISSING');
  assert.ok(afterRegressiveSnapshot.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  const deltaCannotReplaceSnapshot = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 25, 50, 51),
  ]);
  assert.equal(deltaCannotReplaceSnapshot.state, 'SEQUENCE_GAP');
  assert.equal(deltaCannotReplaceSnapshot.routed, 0);

  const betweenRetainedGapAndLowerDelta = route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 24, 60),
  ]);
  assert.equal(betweenRetainedGapAndLowerDelta.state, 'OUT_OF_ORDER');
  assert.equal(betweenRetainedGapAndLowerDelta.routed, 0);
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 23, 200),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 22, 200, 201),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('a snapshot for another Spot instrument cannot clear the gapped series', () => {
  const h = harness({}, ['BTCUSDT', 'ETHUSDT']);
  const btc = instrument('SPOT', 'BTCUSDT');
  const eth = instrument('SPOT', 'ETHUSDT');
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 30)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 29, 100, 100, null, 10, btc),
  ]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 28, 103, 104, null, 10, btc),
  ]).state, 'SEQUENCE_GAP');

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 27, 200, 200, null, 10, eth),
  ]).state, 'FRESH');
  const afterOtherSeries = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(afterOtherSeries.freshness, 'MISSING');
  assert.ok(afterOtherSeries.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 26, 200, 200, null, 10, btc),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 25, 200, 201, null, 10, btc),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('unknown producer continuity cannot advance a depth cursor', () => {
  const h = harness();
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [book(T0 - 20)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 19, 100),
  ]).state, 'FRESH');

  const unknownContinuity = route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 18, 100, 101),
  ], { source: { continuity: 'UNKNOWN' } });
  assert.equal(unknownContinuity.state, 'SEQUENCE_GAP');
  assert.equal(unknownContinuity.routed, 0);
  const missing = capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK');
  assert.equal(missing.freshness, 'MISSING');
  assert.ok(missing.reasonCodes.includes('DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'));

  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    depth('DEPTH_SNAPSHOT', 'SPOT_DEPTH_SNAPSHOT', T0 - 17, 200),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'SPOT_DEPTH_DELTA', T0 - 16, 200, 201),
  ]).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});

test('exhausted REST budget, unregistered sources, and wrong liquidation semantics perform no sink work', () => {
  const h = harness();
  const rateLimited = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 10)], {
    source: { rateBudget: rateBudget('COOLDOWN', T0) },
  });
  assert.equal(rateLimited.state, 'RATE_LIMITED');
  assert.equal(rateLimited.routed, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'MISSING');
  assert.ok(capability(h.router.snapshot(), 'OPEN_INTEREST').reasonCodes.includes('PUBLIC_REST_RATE_BUDGET_EXHAUSTED'));

  const wrongSampling = route(h, 'USD_M_LIQUIDATION', [liquidation(T0 - 9, 'LARGEST_PER_SYMBOL')]);
  assert.equal(wrongSampling.state, 'REJECTED');
  assert.equal(wrongSampling.routed, 0);
  assert.equal(h.calls.length, 0);

  const wrongBookScope = route(h, 'USD_M_DEPTH_DELTA', [
    depth('DEPTH_DELTA', 'USD_M_DEPTH_DELTA', T0 - 9, 1, 2, 0),
  ]);
  assert.equal(wrongBookScope.state, 'REJECTED');
  assert.equal(wrongBookScope.routed, 0);
  assert.ok(wrongBookScope.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));
  assert.equal(h.calls.length, 0);

  const valid = openInterest(T0 - 8);
  const unregistered = h.router.route({
    correlationId: 'routing.unregistered',
    scope: 'BROAD',
    source: { ...source('USD_M_OPEN_INTEREST', h.clock), dataset: 'usd_m.forged' },
    evidence: [valid],
  });
  assert.equal(unregistered.state, 'REJECTED');
  assert.ok(unregistered.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));
  assert.equal(h.calls.length, 0);
  assert.equal(h.router.snapshot().rateLimited, 1);
});

test('an over-bound registered cut commits an unbootstrapped revision fence before sink work', () => {
  const h = harness({}, ['BTCUSDT'], { maximumBatch: 1 });
  const sourceId = BINANCE_SOURCE_FACTS.USD_M_OPEN_INTEREST.sourceId;
  assert.equal(route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 100, 1_000)], {
    source: { generation: 9, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
  const callsBeforeOverbound = h.calls.length;

  let rowInspectionAttempts = 0;
  const overboundRows = new Proxy([
    openInterest(T0 - 90, 1_100),
    openInterest(T0 - 80, 1_200),
  ], {
    get(target, property, receiver) {
      if (property === 'every' || property === Symbol.iterator
          || (typeof property === 'string' && /^[0-9]+$/.test(property))) {
        rowInspectionAttempts += 1;
        throw new Error('over-bound evidence rows must not be inspected');
      }
      return Reflect.get(target, property, receiver);
    },
  });
  let overbound;
  assert.doesNotThrow(() => {
    overbound = route(h, 'USD_M_OPEN_INTEREST', overboundRows, {
      source: { generation: 9, revision: 2, bootstrap: 'NONE', continuity: 'UNKNOWN' },
    });
  });
  assert.equal(rowInspectionAttempts, 0);
  assert.equal(overbound.state, 'REJECTED');
  assert.equal(overbound.rejected, 2);
  assert.ok(overbound.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'));
  assert.equal(h.calls.length, callsBeforeOverbound);
  assert.deepEqual(
    [h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped],
    [2, false],
  );
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'MISSING');

  const sameRevisionReplay = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 70, 1_300)], {
    source: { generation: 9, revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(sameRevisionReplay.state, 'REJECTED');
  assert.ok(sameRevisionReplay.failures.some((failure) => failure.code === 'STALE_SOURCE'));
  assert.equal(h.calls.length, callsBeforeOverbound);

  const recovered = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 70, 1_300)], {
    source: { generation: 9, revision: 3, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(recovered.state, 'FRESH');
  assert.equal(h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped, true);
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'FRESH');
});

test('structurally malformed evidence fails before ordering and performs no sink work', () => {
  const h = harness();
  let receipt;
  assert.doesNotThrow(() => {
    receipt = h.router.route({
      correlationId: 'routing.malformed',
      scope: 'BROAD',
      source: source('SPOT_AGG_TRADE', h.clock),
      evidence: [{ id: 'malformed-no-truth' }],
    });
  });
  assert.equal(receipt.state, 'REJECTED');
  assert.equal(receipt.routed, 0);
  assert.equal(receipt.rejected, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(capability(h.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
});

test('malformed and source-mismatched bootstrap claims never latch lifecycle continuity', () => {
  const h = harness();
  const malformed = route(h, 'SPOT_AGG_TRADE', [{ id: 'malformed-bootstrap' }], {
    source: { generation: 5, revision: 1, bootstrap: 'CONTIGUOUS_OWNER' },
  });
  assert.equal(malformed.state, 'REJECTED');
  assert.equal(malformed.routed, 0);
  assert.equal(h.router.snapshot().sources.find((entry) => (
    entry.sourceId === BINANCE_SOURCE_FACTS.SPOT_AGG_TRADE.sourceId
  )).bootstrapped, false);

  const afterMalformedWithoutProof = route(h, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 8, T0 - 100),
  ], { source: { generation: 5, revision: 2, bootstrap: 'NONE' } });
  assert.equal(afterMalformedWithoutProof.state, 'REJECTED');
  assert.ok(afterMalformedWithoutProof.failures.some((failure) => failure.code === 'MISSING_SOURCE'));

  const validTrade = canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 9, T0 - 90);
  const sourceMismatch = {
    ...validTrade,
    truth: {
      ...validTrade.truth,
      authority: { ...validTrade.truth.authority, dataset: 'spot.forged-bootstrap' },
    },
  };
  const mismatched = route(h, 'SPOT_AGG_TRADE', [sourceMismatch], {
    source: { generation: 5, revision: 3, bootstrap: 'CONTIGUOUS_OWNER' },
  });
  assert.equal(mismatched.state, 'REJECTED');
  assert.ok(mismatched.failures.some((failure) => failure.code === 'WRONG_ENDPOINT_CLASS'));
  assert.equal(h.router.snapshot().sources.find((entry) => (
    entry.sourceId === BINANCE_SOURCE_FACTS.SPOT_AGG_TRADE.sourceId
  )).bootstrapped, false);

  const afterMismatchWithoutProof = route(h, 'SPOT_AGG_TRADE', [validTrade], {
    source: { generation: 5, revision: 4, bootstrap: 'NONE' },
  });
  assert.equal(afterMismatchWithoutProof.state, 'REJECTED');
  assert.equal(h.calls.length, 0);

  assert.equal(route(h, 'SPOT_AGG_TRADE', [validTrade], {
    source: { generation: 5, revision: 5, bootstrap: 'CONTIGUOUS_OWNER' },
  }).state, 'FRESH');
  assert.equal(route(h, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 10, T0 - 80),
  ], { source: { generation: 5, revision: 6, bootstrap: 'NONE' } }).state, 'FRESH');
});

test('sink-rejected bootstrap stays MISSING until the whole cut is accepted or duplicate-reconciled', () => {
  const whollyRejected = harness({ maximumProvenanceIds: 1 });
  const normalMark = mark(T0 - 100);
  const overboundMark = {
    ...normalMark,
    truth: {
      ...normalMark.truth,
      provenance: {
        ...normalMark.truth.provenance,
        transforms: [...normalMark.truth.provenance.transforms, 'bridge-budget-rejection'],
      },
    },
  };
  const rejected = route(whollyRejected, 'USD_M_MARK_PRICE', [overboundMark], {
    source: { generation: 3, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(rejected.routed, 0);
  assert.equal(rejected.rejected, 1);
  assert.equal(whollyRejected.router.snapshot().sources.find((entry) => (
    entry.sourceId === BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId
  )).bootstrapped, false);
  assert.equal(route(whollyRejected, 'USD_M_MARK_PRICE', [normalMark], {
    source: { generation: 3, revision: 2, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  }).state, 'REJECTED');
  assert.equal(whollyRejected.calls.length, 1);
  assert.equal(route(whollyRejected, 'USD_M_MARK_PRICE', [normalMark], {
    source: { generation: 3, revision: 3, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');

  const partial = harness({ maximumProvenanceIds: 1 });
  const partialMark = mark(T0 - 80);
  const normalFunding = funding(T0 - 80);
  const overboundFunding = {
    ...normalFunding,
    truth: {
      ...normalFunding.truth,
      provenance: {
        ...normalFunding.truth.provenance,
        transforms: [...normalFunding.truth.provenance.transforms, 'bridge-budget-rejection'],
      },
    },
  };
  const partialReceipt = route(partial, 'USD_M_MARK_PRICE', [partialMark, overboundFunding], {
    source: { generation: 4, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(partialReceipt.state, 'MISSING');
  assert.equal(partialReceipt.routed, 1);
  assert.equal(partialReceipt.rejected, 1);
  assert.equal(partial.router.snapshot().sources.find((entry) => (
    entry.sourceId === BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId
  )).bootstrapped, false);
  assert.equal(capability(partial.router.snapshot(), 'FUNDING').freshness, 'MISSING');
  assert.equal(route(partial, 'USD_M_MARK_PRICE', [normalFunding], {
    source: { generation: 4, revision: 2, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  }).state, 'REJECTED');
  assert.equal(partial.calls.length, 1);

  const reconciled = route(partial, 'USD_M_MARK_PRICE', [partialMark, normalFunding], {
    source: { generation: 4, revision: 3, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(reconciled.routed, 1);
  assert.equal(reconciled.duplicate, 1);
  assert.equal(reconciled.rejected, 0);
  assert.equal(partial.router.snapshot().sources.find((entry) => (
    entry.sourceId === BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId
  )).bootstrapped, true);
  assert.equal(capability(partial.router.snapshot(), 'FUNDING').freshness, 'FRESH');
  assert.equal(route(partial, 'USD_M_MARK_PRICE', [mark(T0 - 70, 101)], {
    source: { generation: 4, revision: 4, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
});

test('an established partial sink cut commits only an unbootstrapped revision fence until explicit recovery', () => {
  const h = harness({ maximumProvenanceIds: 1 });
  const sourceId = BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId;
  const initialMark = mark(T0 - 100, 100);
  const initialFunding = funding(T0 - 100, 0.0001);
  assert.equal(route(h, 'USD_M_MARK_PRICE', [initialMark, initialFunding], {
    source: { generation: 4, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');

  const nextMark = mark(T0 - 80, 101);
  const nextFunding = funding(T0 - 80, 0.0002);
  const overboundFunding = {
    ...nextFunding,
    truth: {
      ...nextFunding.truth,
      provenance: {
        ...nextFunding.truth.provenance,
        transforms: [...nextFunding.truth.provenance.transforms, 'bridge-budget-rejection'],
      },
    },
  };
  const failed = route(h, 'USD_M_MARK_PRICE', [nextMark, overboundFunding], {
    source: {
      generation: 4, revision: 2, lifecycle: 'DEGRADED', bootstrap: 'NONE', continuity: 'UNKNOWN',
    },
  });
  assert.equal(failed.state, 'REJECTED');
  assert.deepEqual([failed.routed, failed.duplicate, failed.rejected], [1, 0, 1]);
  assert.ok(failed.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'));
  assert.deepEqual(
    h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId),
    {
      sourceId,
      dataset: BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.dataset,
      lifecycle: 'DEGRADED',
      generation: 4,
      revision: 2,
      closed: false,
      bootstrapped: false,
    },
  );
  assert.equal(capability(h.router.snapshot(), 'FUNDING').freshness, 'MISSING');

  const callsAfterFailure = h.calls.length;
  const sameRevisionReplay = route(h, 'USD_M_MARK_PRICE', [nextMark, nextFunding], {
    source: { generation: 4, revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(sameRevisionReplay.state, 'REJECTED');
  assert.ok(sameRevisionReplay.failures.some((failure) => failure.code === 'STALE_SOURCE'));
  assert.equal(h.calls.length, callsAfterFailure, 'the failed immutable revision cannot be laundered through replay');

  const recovered = route(h, 'USD_M_MARK_PRICE', [nextMark, nextFunding], {
    source: { generation: 4, revision: 3, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(recovered.state, 'FRESH');
  assert.deepEqual([recovered.routed, recovered.duplicate, recovered.rejected], [1, 1, 0]);
  assert.deepEqual(
    [h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).lifecycle,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped],
    ['LIVE', 3, true],
  );
  assert.equal(capability(h.router.snapshot(), 'FUNDING').freshness, 'FRESH');

  const exactReplay = route(h, 'USD_M_MARK_PRICE', [nextMark, nextFunding], {
    source: { generation: 4, revision: 4, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  });
  assert.equal(exactReplay.state, 'FRESH');
  assert.deepEqual([exactReplay.routed, exactReplay.duplicate, exactReplay.rejected], [0, 2, 0]);
  assert.equal(h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision, 4);
});

test('an established malformed new-generation cut fences replay and recovers only at a higher revision', () => {
  const h = harness();
  const sourceId = BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId;
  assert.equal(route(h, 'USD_M_MARK_PRICE', [mark(T0 - 100), funding(T0 - 100)], {
    source: { generation: 7, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
  const callsBeforeMalformed = h.calls.length;

  const malformed = route(h, 'USD_M_MARK_PRICE', [{ id: 'malformed-established-cut' }], {
    source: {
      generation: 8, revision: 1, lifecycle: 'DEGRADED',
      bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN',
    },
  });
  assert.equal(malformed.state, 'REJECTED');
  assert.deepEqual([malformed.routed, malformed.duplicate, malformed.rejected], [0, 0, 1]);
  assert.ok(malformed.failures.some((failure) => failure.code === 'INVALID_VARIANT'));
  assert.equal(h.calls.length, callsBeforeMalformed);
  assert.deepEqual(
    [h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).lifecycle,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).generation,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped],
    ['DEGRADED', 8, 1, false],
  );
  assert.equal(capability(h.router.snapshot(), 'FUNDING').freshness, 'MISSING');

  const recoveredMark = mark(T0 - 70, 102);
  const recoveredFunding = funding(T0 - 70, 0.0003);
  const sameRevisionReplay = route(h, 'USD_M_MARK_PRICE', [recoveredMark, recoveredFunding], {
    source: { generation: 8, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(sameRevisionReplay.state, 'REJECTED');
  assert.equal(h.calls.length, callsBeforeMalformed);

  const recovered = route(h, 'USD_M_MARK_PRICE', [recoveredMark, recoveredFunding], {
    source: { generation: 8, revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(recovered.state, 'FRESH');
  assert.deepEqual([recovered.routed, recovered.duplicate, recovered.rejected], [2, 0, 0]);
  assert.deepEqual(
    [h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).generation,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped],
    [8, 2, true],
  );
  assert.equal(capability(h.router.snapshot(), 'FUNDING').freshness, 'FRESH');

  const exactReplay = route(h, 'USD_M_MARK_PRICE', [recoveredMark, recoveredFunding], {
    source: { generation: 8, revision: 3, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  });
  assert.equal(exactReplay.state, 'FRESH');
  assert.deepEqual([exactReplay.routed, exactReplay.duplicate, exactReplay.rejected], [0, 2, 0]);
  assert.equal(h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision, 3);
});

test('source generation and revision fences reject delayed pre-close LIVE and require restart bootstrap', () => {
  const h = harness();
  const unproven = route(h, 'USD_M_MARK_PRICE', [mark(T0 - 100)], {
    source: { generation: 7, revision: 40, bootstrap: 'NONE' },
  });
  assert.equal(unproven.state, 'REJECTED');
  assert.equal(unproven.routed, 0);
  assert.ok(unproven.failures.some((failure) => failure.code === 'MISSING_SOURCE'));
  assert.equal(capability(h.router.snapshot(), 'CROSS_MARKET_LEADERSHIP').freshness, 'MISSING');

  const bootstrapped = route(h, 'USD_M_MARK_PRICE', [mark(T0 - 90)], {
    source: { generation: 7, revision: 41, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(bootstrapped.state, 'FRESH');
  const bound = h.router.snapshot().sources.find((entry) => entry.sourceId === BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId);
  assert.deepEqual(
    [bound.generation, bound.revision, bound.closed, bound.bootstrapped],
    [7, 41, false, true],
  );

  const stopped = route(h, 'USD_M_MARK_PRICE', [], {
    source: {
      generation: 7, revision: 42, lifecycle: 'STOPPED', authority: 'UNAVAILABLE',
      bootstrap: 'NONE', continuity: 'UNKNOWN',
    },
  });
  assert.equal(stopped.state, 'MISSING');
  assert.equal(h.router.snapshot().sources.find((entry) => entry.sourceId === bound.sourceId).closed, true);

  const delayed = route(h, 'USD_M_MARK_PRICE', [mark(T0 - 80)], {
    source: { generation: 7, revision: 43, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(delayed.state, 'REJECTED');
  assert.ok(delayed.failures.some((failure) => failure.code === 'STALE_SOURCE'));
  assert.equal(h.calls.length, 1);

  const restartWithoutProof = route(h, 'USD_M_MARK_PRICE', [mark(T0 - 70)], {
    source: { generation: 8, revision: 1, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  });
  assert.equal(restartWithoutProof.state, 'REJECTED');
  assert.equal(capability(h.router.snapshot(), 'CROSS_MARKET_LEADERSHIP').freshness, 'MISSING');
  const restarted = route(h, 'USD_M_MARK_PRICE', [mark(T0 - 60)], {
    source: { generation: 8, revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(restarted.state, 'FRESH');

  const staleRevision = route(h, 'USD_M_MARK_PRICE', [mark(T0 - 50)], {
    source: { generation: 8, revision: 2, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(staleRevision.state, 'REJECTED');
  assert.ok(staleRevision.failures.some((failure) => failure.code === 'STALE_SOURCE'));
});

test('same-revision rejection downgrades an accepted cut until higher explicit bootstrap', () => {
  const h = harness();
  const sourceId = BINANCE_SOURCE_FACTS.USD_M_OPEN_INTEREST.sourceId;
  assert.equal(route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 100, 1_000)], {
    source: { generation: 6, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  }).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'FRESH');
  const callsBeforeReplay = h.calls.length;

  const sameRevision = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 90, 1_100)], {
    source: { generation: 6, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(sameRevision.state, 'REJECTED');
  assert.ok(sameRevision.failures.some((failure) => failure.code === 'STALE_SOURCE'));
  assert.equal(h.calls.length, callsBeforeReplay);
  assert.deepEqual(
    [h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped],
    [1, false],
  );
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'MISSING');

  const noBootstrap = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 80, 1_200)], {
    source: { generation: 6, revision: 2, bootstrap: 'NONE', continuity: 'UNKNOWN' },
  });
  assert.equal(noBootstrap.state, 'REJECTED');
  assert.ok(noBootstrap.failures.some((failure) => failure.code === 'MISSING_SOURCE'));
  assert.equal(h.calls.length, callsBeforeReplay);

  const recovered = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 70, 1_300)], {
    source: { generation: 6, revision: 3, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(recovered.state, 'FRESH');
  assert.equal(h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped, true);
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'FRESH');

  const delayedOlderRevision = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 60, 1_400)], {
    source: { generation: 6, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(delayedOlderRevision.state, 'REJECTED');
  const delayedOlderGeneration = route(h, 'USD_M_OPEN_INTEREST', [openInterest(T0 - 50, 1_500)], {
    source: { generation: 5, revision: 99, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' },
  });
  assert.equal(delayedOlderGeneration.state, 'REJECTED');
  assert.deepEqual(
    [h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).generation,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).revision,
      h.router.snapshot().sources.find((entry) => entry.sourceId === sourceId).bootstrapped],
    [6, 3, true],
  );
  assert.equal(capability(h.router.snapshot(), 'OPEN_INTEREST').freshness, 'FRESH');
});

test('router reconstruction stays MISSING until exact trade and book/depth bootstrap is reproven', () => {
  const h = harness();
  assert.equal(route(h, 'SPOT_AGG_TRADE', [canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 100, T0 - 100)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [canonicalSpotBook('BTCUSDT', 100, T0 - 99)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [canonicalSpotDepthSnapshot('BTCUSDT', 100, T0 - 98)]).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [canonicalSpotDepthDelta('BTCUSDT', 101, 101, T0 - 97, T0 - 96)]).state, 'FRESH');

  h.router = new VolumeEvidenceRouter({ clock: h.clock, sink: h.bridge });
  h.revisions.clear();
  assert.equal(capability(h.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'MISSING');

  const unprovenTrade = route(h, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 102, T0 - 95),
  ], { source: { generation: 2, revision: 1, bootstrap: 'NONE' } });
  assert.equal(unprovenTrade.state, 'REJECTED');
  assert.equal(unprovenTrade.routed, 0);
  assert.equal(route(h, 'SPOT_AGG_TRADE', [
    canonicalTrade('SPOT_AGG_TRADE', 'BTCUSDT', 103, T0 - 94),
  ], { source: { generation: 2, revision: 2, bootstrap: 'CONTIGUOUS_OWNER' } }).state, 'FRESH');

  const unprovenDelta = route(h, 'SPOT_DEPTH_DELTA', [
    canonicalSpotDepthDelta('BTCUSDT', 102, 102, T0 - 93, T0 - 92),
  ], { source: { generation: 2, revision: 1, bootstrap: 'NONE' } });
  assert.equal(unprovenDelta.state, 'REJECTED');
  assert.equal(route(h, 'SPOT_BOOK_TICKER', [
    canonicalSpotBook('BTCUSDT', 200, T0 - 91),
  ], { source: { generation: 2, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' } }).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_SNAPSHOT', [
    canonicalSpotDepthSnapshot('BTCUSDT', 200, T0 - 90),
  ], { source: { generation: 2, revision: 1, bootstrap: 'CURRENT_SNAPSHOT', continuity: 'UNKNOWN' } }).state, 'FRESH');
  assert.equal(route(h, 'SPOT_DEPTH_DELTA', [
    canonicalSpotDepthDelta('BTCUSDT', 201, 201, T0 - 89, T0 - 88),
  ], { source: { generation: 2, revision: 2, bootstrap: 'CONTIGUOUS_OWNER' } }).state, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'ROLLING_ACTIVITY_FLOW').freshness, 'FRESH');
  assert.equal(capability(h.router.snapshot(), 'SPREAD_DEPTH_BOOK').freshness, 'FRESH');
});
