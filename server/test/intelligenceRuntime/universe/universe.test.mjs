import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalJson,
  stableId,
  validateTruthMetadata,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  BinancePublicUniverseAdapter,
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';

const T0 = 1_800_000_000_000;
const SPOT_PATH = '/api/v3/exchangeInfo';
const USD_M_PATH = '/fapi/v1/exchangeInfo';

class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
}

class FixtureTransport {
  constructor() {
    this.calls = [];
    this.queues = new Map([[SPOT_PATH, []], [USD_M_PATH, []]]);
  }

  enqueue(path, result) {
    const queue = this.queues.get(path);
    if (!queue) throw new Error(`unknown fixture path: ${path}`);
    queue.push(result);
  }

  async request(request) {
    this.calls.push(structuredClone(request));
    const queue = this.queues.get(request.path);
    if (!queue || queue.length === 0) throw new Error(`no response queued for ${request.path}`);
    const result = queue.shift();
    if (result instanceof Error) throw result;
    return result;
  }
}

function response(body, receiveTimeMs = T0, status = 200) {
  return { status, headers: {}, body, receiveTimeMs };
}

function spotFilters(overrides = {}) {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: overrides.minPrice ?? '0.00010000',
      maxPrice: overrides.maxPrice ?? '1000000.00000000',
      tickSize: overrides.tickSize ?? '0.00010000',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: overrides.minQty ?? '0.01000000',
      maxQty: overrides.maxQty ?? '9000000.00000000',
      stepSize: overrides.stepSize ?? '0.01000000',
    },
    {
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.00000000',
      maxQty: '1000000.00000000',
      stepSize: '0.00000000',
    },
    {
      filterType: 'NOTIONAL',
      minNotional: overrides.minNotional ?? '5.00000000',
      applyMinToMarket: true,
      maxNotional: overrides.maxNotional ?? '10000000.00000000',
      applyMaxToMarket: false,
      avgPriceMins: 5,
    },
  ];
}

function futuresFilters(overrides = {}) {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: overrides.minPrice ?? '0.001',
      maxPrice: overrides.maxPrice ?? '1000000',
      tickSize: overrides.tickSize ?? '0.001',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: overrides.minQty ?? '0.001',
      maxQty: overrides.maxQty ?? '1000000',
      stepSize: overrides.stepSize ?? '0.001',
    },
    {
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.001',
      maxQty: '250000',
      stepSize: '0.001',
    },
    {
      filterType: 'MIN_NOTIONAL',
      notional: overrides.minNotional ?? '5',
    },
  ];
}

function spotRow(symbol, baseAsset, overrides = {}) {
  return {
    symbol,
    status: 'TRADING',
    baseAsset,
    baseAssetPrecision: 8,
    quoteAsset: 'USDT',
    quotePrecision: 8,
    quoteAssetPrecision: 8,
    baseCommissionPrecision: 8,
    quoteCommissionPrecision: 8,
    orderTypes: ['LIMIT', 'MARKET'],
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    permissionSets: [['SPOT']],
    filters: spotFilters(),
    ...overrides,
  };
}

function futuresRow(symbol, baseAsset, overrides = {}) {
  return {
    symbol,
    pair: symbol,
    contractType: 'PERPETUAL',
    deliveryDate: 4_133_404_800_000,
    onboardDate: T0 - 365 * 24 * 60 * 60_000,
    status: 'TRADING',
    baseAsset,
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 6,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: 'COIN',
    underlyingSubType: ['Layer-1'],
    orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC'],
    filters: futuresFilters(),
    ...overrides,
  };
}

function exchangeInfo(symbols) {
  return {
    timezone: 'UTC',
    serverTime: T0 - 10,
    rateLimits: [],
    exchangeFilters: [],
    symbols,
  };
}

function enqueuePair(transport, spotSymbols, futuresSymbols, receiveTimeMs = T0) {
  transport.enqueue(SPOT_PATH, response(exchangeInfo(spotSymbols), receiveTimeMs));
  transport.enqueue(USD_M_PATH, response(exchangeInfo(futuresSymbols), receiveTimeMs));
}

function adapterFixture(config = {}) {
  const clock = new ManualClock();
  const transport = new FixtureTransport();
  const adapter = new BinancePublicUniverseAdapter({ transport, clock, config });
  return { adapter, clock, transport };
}

function instrumentId(productFamily, symbol, baseAsset, overrides = {}) {
  return stableId('instrument', {
    venue: 'BINANCE',
    productFamily,
    symbol,
    pair: overrides.pair ?? symbol,
    baseAsset,
    quoteAsset: overrides.quoteAsset ?? 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  });
}

function metadata(snapshot, source, symbol) {
  return snapshot.metadata.find((entry) => entry.source === source && entry.symbol === symbol);
}

function listingChange(snapshot, source, symbol) {
  return snapshot.listingChanges.find((entry) => entry.source === source && entry.symbol === symbol);
}

function nodeByBase(snapshot, baseAsset) {
  return snapshot.graph.nodes.find((entry) => entry.baseAsset === baseAsset);
}

test('construction is inert and an explicit tick uses only the injected public exchange-info transport', async () => {
  const { adapter, transport } = adapterFixture();
  assert.equal(adapter.snapshot(), null);
  assert.deepEqual(transport.calls, []);
  enqueuePair(transport, [], []);

  const first = adapter.tick();
  const second = adapter.tick();
  assert.strictEqual(first, second);
  const snapshot = await first;

  assert.equal(snapshot.graph.nodes.length, 0);
  assert.equal(transport.calls.length, 2);
  assert.deepEqual(transport.calls.map((call) => ({
    method: call.method,
    baseUrl: call.baseUrl,
    path: call.path,
    query: call.query,
  })), [
    { method: 'GET', baseUrl: 'https://data-api.binance.vision', path: SPOT_PATH, query: {} },
    { method: 'GET', baseUrl: 'https://fapi.binance.com', path: USD_M_PATH, query: {} },
  ]);
  assert.equal(transport.calls[0].sourceId, RUNTIME_UNIVERSE_SOURCE_IDS.SPOT);
  assert.equal(transport.calls[1].sourceId, RUNTIME_UNIVERSE_SOURCE_IDS.USD_M_PERPETUAL);
});

test('initial join preserves canonical identities, exact rules, all five slices, and independent operator states', async () => {
  const { adapter, transport } = adapterFixture();
  enqueuePair(
    transport,
    [spotRow('QUIETUSDT', 'QUIET')],
    [futuresRow('QUIETUSDT', 'QUIET')],
  );
  const snapshot = await adapter.tick();

  assert.equal(snapshot.graph.nodes.length, 1);
  assert.deepEqual(snapshot.graph.sourceStates, {
    SPOT: 'COMPLETE',
    USD_M_PERPETUAL: 'COMPLETE',
    MARGIN: 'UNAVAILABLE',
    BORROW: 'UNAVAILABLE',
    COVERAGE: 'UNAVAILABLE',
  });
  const node = snapshot.graph.nodes[0];
  assert.equal(node.spot.instrument.instrumentId, instrumentId('SPOT', 'QUIETUSDT', 'QUIET'));
  assert.equal(node.usdMPerpetual.instrument.instrumentId, instrumentId('USD_M_PERPETUAL', 'QUIETUSDT', 'QUIET'));
  assert.equal(node.spot.rules.tickSize, 0.0001);
  assert.equal(node.spot.rules.quantityStep, 0.01);
  assert.equal(node.spot.rules.minimumNotional, 5);
  assert.equal(node.usdMPerpetual.rules.tickSize, 0.001);
  assert.equal(node.usdMPerpetual.rules.quantityStep, 0.001);
  assert.equal(node.usdMPerpetual.rules.minimumNotional, 5);
  assert.equal(node.quoteVolume, null);
  assert.equal(node.quoteVolume24hUsd, null);
  assert.equal(node.activity, 'UNKNOWN');
  assert.equal(node.visibility.state, 'VISIBLE');
  assert.equal(node.publicData.state, 'UNKNOWN');
  assert.equal(node.focusEligibility.state, 'UNKNOWN');
  const view = snapshot.nodes[0];
  assert.equal(view.visibility.state, 'VISIBLE');
  assert.equal(view.coverage.publicData.state, 'UNKNOWN');
  assert.equal(view.focusEligibility.state, 'UNKNOWN');
  assert.equal(view.tradeability.state, 'UNKNOWN');
  assert.ok(view.tradeability.reasonCodes.includes('EXCHANGE_INFO_ONLY_LIVE_TRADEABILITY_UNPROVEN'));
  assert.equal(snapshot.diff.changes.filter((entry) => entry.kind === 'ADDED').length, 1);
  assert.ok(snapshot.metadata.every((entry) => validateTruthMetadata(entry.truth).ok));
  assert.equal(validateTruthMetadata(snapshot.graph.truth).ok, true);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.graph));
});

test('quiet and inactive symbols remain visible without fabricated dormant activity or tradeability', async () => {
  const { adapter, transport } = adapterFixture();
  enqueuePair(transport, [spotRow('SLEEPUSDT', 'SLEEP', {
    status: 'BREAK',
    isSpotTradingAllowed: false,
  })], []);
  const snapshot = await adapter.tick();
  const node = nodeByBase(snapshot, 'SLEEP');

  assert.ok(node);
  assert.equal(node.visibility.state, 'VISIBLE');
  assert.equal(node.activity, 'UNKNOWN');
  assert.equal(node.spot.marketAvailability, 'INACTIVE');
  assert.equal(node.usdMPerpetual, null);
  const view = snapshot.nodes.find((entry) => entry.nodeId === node.id);
  assert.equal(view.tradeability.state, 'BLOCKED');
  assert.ok(view.tradeability.reasonCodes.includes('SPOT_STATUS_INACTIVE'));
  assert.ok(view.tradeability.reasonCodes.includes('USD_M_PERPETUAL_LEG_MISSING'));
});

test('complete refreshes deterministically report new listings, status changes, and delistings', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [spotRow('ALPHAUSDT', 'ALPHA')], []);
  await adapter.tick();

  clock.set(T0 + 1);
  enqueuePair(transport, [spotRow('ALPHAUSDT', 'ALPHA'), spotRow('NEWUSDT', 'NEW')], [], T0 + 1);
  const added = await adapter.tick();
  assert.equal(listingChange(added, 'SPOT', 'NEWUSDT').kind, 'ADDED');
  assert.ok(listingChange(added, 'SPOT', 'NEWUSDT').reasonCodes.includes('LISTING_ADDED'));
  assert.equal(added.diff.changes.filter((entry) => entry.kind === 'ADDED').length, 1);

  clock.set(T0 + 2);
  enqueuePair(transport, [
    spotRow('ALPHAUSDT', 'ALPHA', { status: 'BREAK', isSpotTradingAllowed: false }),
    spotRow('NEWUSDT', 'NEW'),
  ], [], T0 + 2);
  const changed = await adapter.tick();
  assert.equal(listingChange(changed, 'SPOT', 'ALPHAUSDT').kind, 'CHANGED');
  assert.ok(listingChange(changed, 'SPOT', 'ALPHAUSDT').reasonCodes.includes('STATUS_CHANGED'));
  assert.equal(nodeByBase(changed, 'ALPHA').spot.marketAvailability, 'INACTIVE');
  assert.ok(changed.diff.changes.some((entry) => entry.kind === 'CHANGED'));

  clock.set(T0 + 3);
  enqueuePair(transport, [spotRow('ALPHAUSDT', 'ALPHA', {
    status: 'BREAK',
    isSpotTradingAllowed: false,
  })], [], T0 + 3);
  const removed = await adapter.tick();
  assert.equal(listingChange(removed, 'SPOT', 'NEWUSDT').kind, 'REMOVED');
  assert.ok(listingChange(removed, 'SPOT', 'NEWUSDT').reasonCodes.includes('LISTING_REMOVED_FROM_COMPLETE_REFRESH'));
  assert.equal(nodeByBase(removed, 'NEW'), undefined);
  assert.equal(removed.diff.changes.filter((entry) => entry.kind === 'REMOVED').length, 1);
});

test('canonical duplicate listing rows collapse deterministically with an explicit failure', async () => {
  const { adapter, transport } = adapterFixture();
  enqueuePair(transport, [
    spotRow('ALIASUSDT', 'ALIAS'),
    spotRow(' aliasusdt ', ' alias ', { quoteAsset: ' usdt ' }),
  ], []);
  const snapshot = await adapter.tick();

  assert.equal(snapshot.graph.nodes.length, 1);
  assert.equal(snapshot.metadata.filter((entry) => entry.source === 'SPOT').length, 1);
  assert.ok(snapshot.graph.nodes[0].aliases.includes('ALIASUSDT'));
  assert.ok(snapshot.failures.some((failure) => failure.code === 'DUPLICATE_EVENT'));
});

test('Spot-only and Perpetual-only markets remain independently visible with honest missing-leg state', async () => {
  const { adapter, transport } = adapterFixture();
  enqueuePair(
    transport,
    [spotRow('SPOTONLYUSDT', 'SPOTONLY')],
    [futuresRow('PERPONLYUSDT', 'PERPONLY')],
  );
  const snapshot = await adapter.tick();

  assert.equal(snapshot.graph.nodes.length, 2);
  const spotOnly = nodeByBase(snapshot, 'SPOTONLY');
  const perpOnly = nodeByBase(snapshot, 'PERPONLY');
  assert.ok(spotOnly.spot);
  assert.equal(spotOnly.usdMPerpetual, null);
  assert.equal(perpOnly.spot, null);
  assert.ok(perpOnly.usdMPerpetual);
  const spotView = snapshot.nodes.find((entry) => entry.nodeId === spotOnly.id);
  const perpView = snapshot.nodes.find((entry) => entry.nodeId === perpOnly.id);
  assert.ok(spotView.tradeability.reasonCodes.includes('USD_M_PERPETUAL_LEG_MISSING'));
  assert.ok(perpView.tradeability.reasonCodes.includes('SPOT_LEG_MISSING'));
  assert.equal(spotView.tradeability.state, 'UNKNOWN');
  assert.equal(perpView.tradeability.state, 'UNKNOWN');
});

test('contract and filter changes retain raw evidence and never substitute precision for tick or step', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [spotRow('METAUSDT', 'META')], [futuresRow('METAUSDT', 'META')]);
  const first = await adapter.tick();
  const initial = metadata(first, 'USD_M_PERPETUAL', 'METAUSDT');

  clock.set(T0 + 1);
  enqueuePair(transport, [spotRow('METAUSDT', 'META')], [futuresRow('METAUSDT', 'META', {
    onboardDate: T0 - 1_000,
    pricePrecision: 1,
    quantityPrecision: 7,
    filters: futuresFilters({ tickSize: '0.010', stepSize: '0.0001', minNotional: '7' }),
  })], T0 + 1);
  const changed = await adapter.tick();
  const current = metadata(changed, 'USD_M_PERPETUAL', 'METAUSDT');
  const change = listingChange(changed, 'USD_M_PERPETUAL', 'METAUSDT');

  assert.notEqual(current.fingerprint, initial.fingerprint);
  assert.equal(change.kind, 'CHANGED');
  assert.ok(change.reasonCodes.includes('CONTRACT_METADATA_CHANGED'));
  assert.ok(change.reasonCodes.includes('FILTER_METADATA_CHANGED'));
  assert.equal(current.precisions.pricePrecision, 1);
  assert.equal(current.precisions.quantityPrecision, 7);
  assert.ok(current.filters.some((filter) => filter.filterType === 'MARKET_LOT_SIZE'));
  assert.equal(nodeByBase(changed, 'META').usdMPerpetual.rules.tickSize, 0.01);
  assert.equal(nodeByBase(changed, 'META').usdMPerpetual.rules.quantityStep, 0.0001);
  assert.equal(nodeByBase(changed, 'META').usdMPerpetual.rules.minimumNotional, 7);
  assert.equal(nodeByBase(changed, 'META').quoteVolume24hUsd, null);
});

test('a Futures contract-type change remains in metadata and removes only the unsupported Perpetual leg', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [spotRow('ROLLUSDT', 'ROLL')], [futuresRow('ROLLUSDT', 'ROLL')]);
  await adapter.tick();

  clock.set(T0 + 1);
  enqueuePair(transport, [spotRow('ROLLUSDT', 'ROLL')], [futuresRow('ROLLUSDT', 'ROLL', {
    contractType: 'CURRENT_QUARTER',
    deliveryDate: T0 + 30 * 24 * 60 * 60_000,
  })], T0 + 1);
  const snapshot = await adapter.tick();
  const current = metadata(snapshot, 'USD_M_PERPETUAL', 'ROLLUSDT');

  assert.equal(current.contractType, 'CURRENT_QUARTER');
  assert.equal(current.includedInUniverse, false);
  assert.ok(current.exclusionReasonCodes.includes('NON_PERPETUAL_CONTRACT_OUTSIDE_FOUNDATION_UNIVERSE'));
  assert.equal(nodeByBase(snapshot, 'ROLL').usdMPerpetual, null);
  assert.ok(listingChange(snapshot, 'USD_M_PERPETUAL', 'ROLLUSDT').reasonCodes.includes('CONTRACT_METADATA_CHANGED'));
  assert.ok(snapshot.diff.changes.some((entry) => entry.kind === 'CHANGED'));
});

test('partial responses and source failures merge valid rows into complete last-known state without false removals', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [
    spotRow('KEEPUSDT', 'KEEP'),
    spotRow('UPDATEUSDT', 'UPDATE'),
  ], [futuresRow('KEEPUSDT', 'KEEP')]);
  await adapter.tick();

  clock.set(T0 + 100);
  transport.enqueue(SPOT_PATH, response(exchangeInfo([
    spotRow('UPDATEUSDT', 'UPDATE', { filters: spotFilters({ tickSize: '0.00100000' }) }),
    { symbol: 'BROKENUSDT', status: 'TRADING', quoteAsset: 'USDT', filters: [] },
  ]), T0 + 100));
  transport.enqueue(USD_M_PATH, new Error('fixture source unavailable'));
  const snapshot = await adapter.tick();

  assert.equal(snapshot.sources.SPOT.state, 'PARTIAL');
  assert.equal(snapshot.sources.USD_M_PERPETUAL.state, 'PARTIAL');
  assert.equal(snapshot.graph.nodes.length, 2);
  assert.ok(nodeByBase(snapshot, 'KEEP').spot);
  assert.ok(nodeByBase(snapshot, 'KEEP').usdMPerpetual);
  assert.equal(nodeByBase(snapshot, 'UPDATE').spot.rules.tickSize, 0.001);
  assert.equal(listingChange(snapshot, 'SPOT', 'KEEPUSDT').kind, 'UNCHANGED');
  assert.equal(listingChange(snapshot, 'USD_M_PERPETUAL', 'KEEPUSDT').kind, 'UNCHANGED');
  assert.ok(!snapshot.listingChanges.some((entry) => entry.kind === 'REMOVED'));
  assert.ok(snapshot.failures.some((failure) => failure.code === 'INVALID_VALUE'));
  assert.ok(snapshot.failures.some((failure) => failure.code === 'UNAVAILABLE'));
  assert.equal(metadata(snapshot, 'SPOT', 'KEEPUSDT').receivedTimeMs, T0);
  assert.equal(metadata(snapshot, 'SPOT', 'UPDATEUSDT').receivedTimeMs, T0 + 100);
});

test('stale source failures retain the last-known universe while making freshness, rules, and availability unknown', async () => {
  const { adapter, clock, transport } = adapterFixture({ sourceStaleAfterMs: 100 });
  enqueuePair(transport, [spotRow('STALEUSDT', 'STALE')], [futuresRow('STALEUSDT', 'STALE')]);
  await adapter.tick();

  clock.set(T0 + 101);
  transport.enqueue(SPOT_PATH, new Error('spot unavailable'));
  transport.enqueue(USD_M_PATH, new Error('futures unavailable'));
  const snapshot = await adapter.tick();
  const node = nodeByBase(snapshot, 'STALE');

  assert.equal(snapshot.sources.SPOT.state, 'PARTIAL');
  assert.equal(snapshot.sources.SPOT.stale, true);
  assert.equal(snapshot.sources.SPOT.truth.freshness.state, 'STALE');
  assert.equal(snapshot.sources.USD_M_PERPETUAL.stale, true);
  assert.ok(node);
  assert.equal(node.spot.marketAvailability, 'UNKNOWN');
  assert.equal(node.usdMPerpetual.marketAvailability, 'UNKNOWN');
  assert.equal(node.spot.rules.tickSize, null);
  assert.equal(node.usdMPerpetual.rules.quantityStep, null);
  assert.ok(!snapshot.listingChanges.some((entry) => entry.kind === 'REMOVED'));
});

test('future receipt timestamps are rejected without replacing the last-known complete snapshot', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [spotRow('TIMEUSDT', 'TIME')], []);
  await adapter.tick();

  clock.set(T0 + 1);
  transport.enqueue(SPOT_PATH, response(exchangeInfo([]), T0 + 2));
  transport.enqueue(USD_M_PATH, response(exchangeInfo([]), T0 + 2));
  const snapshot = await adapter.tick();

  assert.ok(nodeByBase(snapshot, 'TIME'));
  assert.equal(snapshot.sources.SPOT.state, 'PARTIAL');
  assert.ok(snapshot.failures.some((failure) => failure.code === 'TIMESTAMP_SKEW'));
  assert.ok(!snapshot.listingChanges.some((entry) => entry.kind === 'REMOVED'));
});

test('partial merge capacity preserves complete last-known rows and reports every bounded drop as one stable failure', async () => {
  const { adapter, clock, transport } = adapterFixture({
    maximumSymbolsPerSource: 2,
    universePolicy: { maxRecordsPerSource: 2 },
  });
  enqueuePair(transport, [spotRow('AUSDT', 'A'), spotRow('BUSDT', 'B')], []);
  await adapter.tick();

  clock.set(T0 + 1);
  const incompleteRules = spotFilters().filter((filter) => filter.filterType !== 'NOTIONAL');
  enqueuePair(transport, [
    spotRow('AUSDT', 'A', { filters: incompleteRules }),
    spotRow('CUSDT', 'C'),
  ], [], T0 + 1);
  const snapshot = await adapter.tick();
  const spotSymbols = snapshot.metadata
    .filter((entry) => entry.source === 'SPOT')
    .map((entry) => entry.symbol);

  assert.deepEqual(spotSymbols, ['AUSDT', 'BUSDT']);
  assert.equal(snapshot.sources.SPOT.retainedListingCount, 2);
  assert.equal(snapshot.sources.SPOT.state, 'PARTIAL');
  assert.equal(nodeByBase(snapshot, 'C'), undefined);
  assert.ok(snapshot.failures.some((failure) =>
    failure.code === 'BUDGET_EXHAUSTED' && failure.field?.endsWith('partialMergeCapacity')));
  assert.ok(!snapshot.listingChanges.some((entry) => entry.symbol === 'CUSDT'));
  assert.ok(!snapshot.listingChanges.some((entry) => entry.kind === 'REMOVED'));
});

test('an anomalous empty 200 response cannot mass-delete a prior complete universe', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [spotRow('SAFEUSDT', 'SAFE')], [futuresRow('SAFEUSDT', 'SAFE')]);
  const complete = await adapter.tick();
  assert.equal(complete.graph.nodes.length, 1);

  clock.set(T0 + 1);
  enqueuePair(transport, [], [], T0 + 1);
  const guarded = await adapter.tick();

  assert.equal(guarded.graph.nodes.length, 1);
  assert.ok(nodeByBase(guarded, 'SAFE').spot);
  assert.ok(nodeByBase(guarded, 'SAFE').usdMPerpetual);
  assert.equal(guarded.sources.SPOT.state, 'PARTIAL');
  assert.equal(guarded.sources.USD_M_PERPETUAL.state, 'PARTIAL');
  assert.ok(guarded.failures.some((failure) =>
    failure.code === 'INCOMPLETE_EVIDENCE' && /empty successful exchangeInfo/.test(failure.message)));
  assert.ok(!guarded.listingChanges.some((entry) => entry.kind === 'REMOVED'));
});

test('missing rule filters and fields grade rows partial while explicit exchange zeroes remain authoritative zeroes', async () => {
  const missing = adapterFixture();
  enqueuePair(missing.transport, [spotRow('MISSINGUSDT', 'MISSING', {
    filters: [
      { filterType: 'PRICE_FILTER', minPrice: '0.1', maxPrice: '10' },
      { filterType: 'LOT_SIZE', minQty: '1', maxQty: '100' },
    ],
  })], []);
  const partial = await missing.adapter.tick();
  const missingMetadata = metadata(partial, 'SPOT', 'MISSINGUSDT');
  const missingNode = nodeByBase(partial, 'MISSING');

  assert.equal(partial.sources.SPOT.state, 'PARTIAL');
  assert.equal(missingMetadata.truth.completeness.state, 'PARTIAL');
  assert.ok(missingMetadata.truth.completeness.missingFields.includes('filters.PRICE_FILTER.tickSize'));
  assert.ok(missingMetadata.truth.completeness.missingFields.includes('filters.LOT_SIZE.stepSize'));
  assert.ok(missingMetadata.truth.completeness.missingFields.includes('filters.NOTIONAL'));
  assert.equal(missingNode.spot.rules.tickSize, null);
  assert.equal(missingNode.spot.rules.quantityStep, null);
  assert.equal(missingNode.spot.rules.minimumNotional, null);

  const zero = adapterFixture();
  enqueuePair(zero.transport, [spotRow('ZEROUSDT', 'ZERO', {
    filters: [
      { filterType: 'PRICE_FILTER', minPrice: '0', maxPrice: '0', tickSize: '0' },
      { filterType: 'LOT_SIZE', minQty: '0', maxQty: '0', stepSize: '0' },
      { filterType: 'MIN_NOTIONAL', minNotional: '0' },
    ],
  })], []);
  const completeZero = await zero.adapter.tick();
  const zeroNode = nodeByBase(completeZero, 'ZERO');
  assert.equal(completeZero.sources.SPOT.state, 'COMPLETE');
  assert.equal(zeroNode.spot.rules.minimumPrice, 0);
  assert.equal(zeroNode.spot.rules.maximumPrice, 0);
  assert.equal(zeroNode.spot.rules.tickSize, 0);
  assert.equal(zeroNode.spot.rules.minimumQuantity, 0);
  assert.equal(zeroNode.spot.rules.quantityStep, 0);
  assert.equal(zeroNode.spot.rules.minimumNotional, 0);
});

test('accepted receipts must follow the current attempt and remain monotonic across accepted responses', async () => {
  const attemptFloor = adapterFixture();
  enqueuePair(attemptFloor.transport, [spotRow('CLOCKUSDT', 'CLOCK')], [futuresRow('CLOCKUSDT', 'CLOCK')]);
  await attemptFloor.adapter.tick();
  attemptFloor.clock.set(T0 + 10);
  enqueuePair(
    attemptFloor.transport,
    [spotRow('REPLACEUSDT', 'REPLACE')],
    [futuresRow('REPLACEUSDT', 'REPLACE')],
    T0 + 9,
  );
  const rejectedBeforeAttempt = await attemptFloor.adapter.tick();
  assert.ok(nodeByBase(rejectedBeforeAttempt, 'CLOCK'));
  assert.equal(nodeByBase(rejectedBeforeAttempt, 'REPLACE'), undefined);
  assert.equal(rejectedBeforeAttempt.sources.SPOT.lastResponseTimeMs, T0);
  assert.ok(rejectedBeforeAttempt.failures.some((failure) => failure.code === 'TIMESTAMP_SKEW'));

  class SequenceClock {
    constructor(values) { this.values = [...values]; }
    nowMs() {
      if (this.values.length === 0) throw new Error('clock fixture exhausted');
      return this.values.shift();
    }
  }
  const transport = new FixtureTransport();
  const clock = new SequenceClock([T0, T0 + 10, T0 + 5, T0 + 10]);
  const adapter = new BinancePublicUniverseAdapter({ transport, clock });
  enqueuePair(transport, [spotRow('MONOUSDT', 'MONO')], [futuresRow('MONOUSDT', 'MONO')], T0 + 10);
  await adapter.tick();
  enqueuePair(transport, [spotRow('REGRESSUSDT', 'REGRESS')], [futuresRow('REGRESSUSDT', 'REGRESS')], T0 + 5);
  const rejectedRegression = await adapter.tick();
  assert.ok(nodeByBase(rejectedRegression, 'MONO'));
  assert.equal(nodeByBase(rejectedRegression, 'REGRESS'), undefined);
  assert.equal(rejectedRegression.sources.SPOT.lastResponseTimeMs, T0 + 10);
  assert.ok(rejectedRegression.failures.some((failure) => failure.code === 'TIMESTAMP_SKEW'));
});

test('aggregate source freshness is based on the oldest retained row and exposes mixed fresh/stale retention', async () => {
  const { adapter, clock, transport } = adapterFixture({ sourceStaleAfterMs: 100 });
  enqueuePair(transport, [spotRow('FRESHUSDT', 'FRESH'), spotRow('OLDUSDT', 'OLD')], []);
  await adapter.tick();

  clock.set(T0 + 101);
  transport.enqueue(SPOT_PATH, response(exchangeInfo([
    spotRow('FRESHUSDT', 'FRESH'),
    spotRow('WRONGUSDT', 'OTHER'),
  ]), T0 + 101));
  transport.enqueue(USD_M_PATH, new Error('fixture source unavailable'));
  const snapshot = await adapter.tick();

  assert.equal(snapshot.sources.SPOT.state, 'PARTIAL');
  assert.equal(snapshot.sources.SPOT.truth.temporal.receivedTimeMs, T0);
  assert.equal(snapshot.sources.SPOT.truth.freshness.state, 'STALE');
  assert.equal(snapshot.sources.SPOT.stale, true);
  assert.ok(snapshot.sources.SPOT.truth.completeness.reasonCodes.includes('RETAINED_ROWS_HAVE_MIXED_FRESHNESS'));
  assert.equal(nodeByBase(snapshot, 'FRESH').spot.marketAvailability, 'ACTIVE');
  assert.equal(nodeByBase(snapshot, 'OLD').spot.marketAvailability, 'UNKNOWN');
  assert.equal(nodeByBase(snapshot, 'OLD').spot.rules.tickSize, null);
});

test('identity tokens are canonicalized and inconsistent symbol/pair/base/quote facts are rejected without guessing', async () => {
  const { adapter, clock, transport } = adapterFixture();
  enqueuePair(transport, [spotRow(' lowerusdt ', ' lower ', {
    quoteAsset: ' usdt ',
    status: ' trading ',
  })], [futuresRow(' lowerusdt ', ' lower ', {
    pair: ' lowerusdt ',
    quoteAsset: ' usdt ',
    contractType: ' perpetual ',
    status: ' trading ',
  })]);
  const canonical = await adapter.tick();
  const node = nodeByBase(canonical, 'LOWER');
  assert.ok(node);
  assert.equal(node.spot.instrument.symbol, 'LOWERUSDT');
  assert.equal(node.spot.instrument.baseAsset, 'LOWER');
  assert.equal(node.spot.instrument.quoteAsset, 'USDT');
  assert.equal(node.usdMPerpetual.instrument.pair, 'LOWERUSDT');
  assert.equal(node.spot.instrument.instrumentId, instrumentId('SPOT', 'LOWERUSDT', 'LOWER'));

  clock.set(T0 + 1);
  enqueuePair(
    transport,
    [spotRow('WRONGUSDT', 'OTHER')],
    [futuresRow('WRONGUSDT', 'OTHER', { pair: 'OTHERUSDT' })],
    T0 + 1,
  );
  const rejected = await adapter.tick();
  assert.ok(nodeByBase(rejected, 'LOWER'));
  assert.equal(nodeByBase(rejected, 'OTHER'), undefined);
  assert.ok(rejected.failures.some((failure) => failure.code === 'INVALID_VALUE'));
  assert.ok(!rejected.listingChanges.some((entry) => entry.kind === 'REMOVED'));
});

test('effective configuration fingerprints include policy, remain stable, and every exposed config collection is frozen', async () => {
  const settings = {
    sourceStaleAfterMs: 123,
    universePolicy: {
      activeSpotStatuses: [' trading ', 'BREAK'],
      allowedQuoteAssetsForFocus: [' usdt '],
    },
  };
  const left = adapterFixture(settings);
  const same = adapterFixture(settings);
  const changed = adapterFixture({ ...settings, sourceStaleAfterMs: 124 });
  const config = left.adapter.config;

  assert.equal(config.configurationVersion, same.adapter.config.configurationVersion);
  assert.notEqual(config.configurationVersion, changed.adapter.config.configurationVersion);
  assert.ok(Object.isFrozen(RUNTIME_UNIVERSE_DEFAULTS));
  assert.ok(Object.isFrozen(RUNTIME_UNIVERSE_DEFAULTS.universePolicy));
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.universePolicy));
  assert.ok(Object.isFrozen(config.universePolicy.activeSpotStatuses));
  assert.ok(Object.isFrozen(config.universePolicy.allowedQuoteAssetsForFocus));
  assert.deepEqual(config.universePolicy.activeSpotStatuses, ['BREAK', 'TRADING']);
  assert.deepEqual(config.universePolicy.allowedQuoteAssetsForFocus, ['USDT']);
  assert.throws(() => config.universePolicy.activeSpotStatuses.push('MUTATE'), TypeError);
  assert.throws(() => { config.sourceStaleAfterMs = 999; }, TypeError);

  enqueuePair(left.transport, [spotRow('CONFIGUSDT', 'CONFIG')], [futuresRow('CONFIGUSDT', 'CONFIG')]);
  const snapshot = await left.adapter.tick();
  assert.equal(snapshot.sources.SPOT.truth.configurationVersion, config.configurationVersion);
  assert.ok(snapshot.metadata.every((entry) => entry.truth.configurationVersion === config.configurationVersion));
  assert.equal(snapshot.graph.configurationVersion, config.configurationVersion);
  assert.equal(snapshot.graph.truth.configurationVersion, config.configurationVersion);
});

test('large bounded exchangeInfo bodies avoid whole-body validation traps while top-level, row, and filter secrets remain rejected', () => {
  const { adapter } = adapterFixture({
    maximumSymbolsPerSource: 1_200,
    universePolicy: { maxRecordsPerSource: 1_200 },
  });
  const context = {
    source: 'SPOT',
    sourceId: RUNTIME_UNIVERSE_SOURCE_IDS.SPOT,
    dataset: 'spot.exchange_info',
    receivedTimeMs: T0,
    evaluatedAtMs: T0,
    config: adapter.config,
  };
  const extras = Object.fromEntries(Array.from({ length: 48 }, (_, index) => [`extra${index}`, index]));
  const rows = Array.from({ length: 1_100 }, (_, index) =>
    spotRow(`ASSET${index}USDT`, `ASSET${index}`, extras));
  const parsed = parseExchangeInformation(exchangeInfo(rows), context);

  assert.equal(parsed.complete, true);
  assert.equal(parsed.listings.length, 1_100);
  assert.equal(parsed.listings[0].metadata.truth.temporal.sourceEventTimeMs, null);
  assert.equal(parsed.listings[0].metadata.truth.temporal.receivedTimeMs, T0);

  const topSecret = parseExchangeInformation({
    ...exchangeInfo([spotRow('TOPUSDT', 'TOP')]),
    authorization: 'forbidden fixture',
  }, context);
  assert.equal(topSecret.complete, false);
  assert.ok(topSecret.failures.some((failure) => failure.code === 'SECRET_FIELD_REJECTED'));

  const rowSecret = parseExchangeInformation(exchangeInfo([
    spotRow('ROWUSDT', 'ROW', { apiKey: 'forbidden fixture' }),
  ]), context);
  assert.equal(rowSecret.complete, false);
  assert.equal(rowSecret.listings.length, 0);
  assert.ok(rowSecret.failures.some((failure) => failure.code === 'SECRET_FIELD_REJECTED'));

  const filterSecret = parseExchangeInformation(exchangeInfo([
    spotRow('FILTERUSDT', 'FILTER', {
      filters: [
        ...spotFilters(),
        { filterType: 'EXTRA_FILTER', credentials: 'forbidden fixture' },
      ],
    }),
  ]), context);
  assert.equal(filterSecret.complete, false);
  assert.equal(filterSecret.listings.length, 0);
  assert.ok(filterSecret.failures.some((failure) => failure.code === 'SECRET_FIELD_REJECTED'));
});

test('identical replay is byte-stable and an unchanged full refresh produces only unchanged graph diffs', async () => {
  const left = adapterFixture();
  const right = adapterFixture();
  for (const fixture of [left, right]) {
    enqueuePair(
      fixture.transport,
      [spotRow('DETERMINISTICUSDT', 'DETERMINISTIC')],
      [futuresRow('DETERMINISTICUSDT', 'DETERMINISTIC')],
    );
  }
  const firstLeft = await left.adapter.tick();
  const firstRight = await right.adapter.tick();
  assert.equal(canonicalJson(firstLeft), canonicalJson(firstRight));

  for (const fixture of [left, right]) {
    enqueuePair(
      fixture.transport,
      [spotRow('DETERMINISTICUSDT', 'DETERMINISTIC')],
      [futuresRow('DETERMINISTICUSDT', 'DETERMINISTIC')],
    );
  }
  const secondLeft = await left.adapter.tick();
  const secondRight = await right.adapter.tick();
  assert.equal(canonicalJson(secondLeft), canonicalJson(secondRight));
  assert.ok(secondLeft.diff.changes.length > 0);
  assert.ok(secondLeft.diff.changes.every((entry) => entry.kind === 'UNCHANGED'));
  assert.ok(secondLeft.listingChanges.every((entry) => entry.kind === 'UNCHANGED'));
  assert.equal(secondLeft.graph.id, firstLeft.graph.id);
});
