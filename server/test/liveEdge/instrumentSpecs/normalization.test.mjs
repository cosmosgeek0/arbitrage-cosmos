import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  stableId,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';
import {
  L04_BINANCE_MATRIX_SHA256,
  L04_EXCHANGE_INFO_CONTRACT_IDS,
  normalizeRuntimeInstrumentRegistry,
  validateInstrumentRegistrySnapshot,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';

const T0 = 1_800_000_000_000;
const MAXIMUM_AGE_MS = 60_000;
const CONFIG = Object.freeze({
  ...RUNTIME_UNIVERSE_DEFAULTS,
  configurationVersion: 'l04-normalization-test-v1',
  universePolicy: Object.freeze({ ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy }),
});

function spotFilters(overrides = {}) {
  return overrides.filters ?? [
    {
      filterType: 'PRICE_FILTER',
      minPrice: overrides.minPrice ?? '0.01000000',
      maxPrice: overrides.maxPrice ?? '1000000.00000000',
      tickSize: overrides.tickSize ?? '0.01000000',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: overrides.minQty ?? '0.00001000',
      maxQty: overrides.maxQty ?? '9000.00000000',
      stepSize: overrides.stepSize ?? '0.00001000',
    },
    {
      filterType: 'NOTIONAL',
      minNotional: overrides.minNotional ?? '5.00000000',
      applyMinToMarket: true,
      maxNotional: overrides.maxNotional ?? '100000.00000000',
      applyMaxToMarket: false,
      avgPriceMins: 5,
    },
  ];
}

function fullSpotFilters() {
  return [
    ...spotFilters(),
    {
      filterType: 'PERCENT_PRICE',
      multiplierUp: '1.2000',
      multiplierDown: '0.8000',
      avgPriceMins: 5,
    },
    {
      filterType: 'PERCENT_PRICE_BY_SIDE',
      bidMultiplierUp: '1.1000',
      bidMultiplierDown: '0.9000',
      askMultiplierUp: '1.1500',
      askMultiplierDown: '0.8500',
      avgPriceMins: 5,
    },
    {
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.00001000',
      maxQty: '1000.00000000',
      stepSize: '0.00001000',
    },
    { filterType: 'ICEBERG_PARTS', limit: 10 },
    { filterType: 'MAX_NUM_ORDERS', maxNumOrders: 200 },
    { filterType: 'MAX_NUM_ALGO_ORDERS', maxNumAlgoOrders: 5 },
    { filterType: 'MAX_NUM_ICEBERG_ORDERS', maxNumIcebergOrders: 5 },
    { filterType: 'MAX_POSITION', maxPosition: '50.00000000' },
    {
      filterType: 'TRAILING_DELTA',
      minTrailingAboveDelta: 10,
      maxTrailingAboveDelta: 2000,
      minTrailingBelowDelta: 10,
      maxTrailingBelowDelta: 2000,
    },
    { filterType: 'MAX_NUM_ORDER_AMENDS', maxNumOrderAmends: 10 },
    { filterType: 'MAX_NUM_ORDER_LISTS', maxNumOrderLists: 10 },
  ];
}

function usdMFilters(overrides = {}) {
  return overrides.filters ?? [
    {
      filterType: 'PRICE_FILTER',
      minPrice: overrides.minPrice ?? '0.100',
      maxPrice: overrides.maxPrice ?? '1000000.000',
      tickSize: overrides.tickSize ?? '0.100',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: overrides.minQty ?? '0.001',
      maxQty: overrides.maxQty ?? '1000.000',
      stepSize: overrides.stepSize ?? '0.001',
    },
    {
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.001',
      maxQty: '250.000',
      stepSize: '0.001',
    },
    {
      filterType: 'PERCENT_PRICE',
      multiplierUp: '1.0500',
      multiplierDown: '0.9500',
      multiplierDecimal: overrides.multiplierDecimal ?? '4',
    },
    { filterType: 'MIN_NOTIONAL', notional: overrides.minNotional ?? '5.000' },
    { filterType: 'MAX_NUM_ORDERS', limit: 200 },
  ];
}

function spotRow(symbol = 'BTCUSDT', overrides = {}) {
  const baseAsset = overrides.baseAsset ?? symbol.slice(0, -4);
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

function usdMRow(symbol = 'BTCUSDT', overrides = {}) {
  const baseAsset = overrides.baseAsset ?? symbol.slice(0, -4);
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
    pricePrecision: 3,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: 'COIN',
    underlyingSubType: ['Layer-1'],
    orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC'],
    filters: usdMFilters(),
    ...overrides,
  };
}

function parseMetadata(source, rows, options = {}) {
  const receivedTimeMs = options.receivedTimeMs ?? T0;
  const evaluatedAtMs = options.evaluatedAtMs ?? receivedTimeMs;
  const parsed = parseExchangeInformation(
    { timezone: 'UTC', serverTime: receivedTimeMs - 10, exchangeFilters: [], symbols: rows },
    {
      source,
      sourceId: RUNTIME_UNIVERSE_SOURCE_IDS[source],
      dataset: source === 'SPOT' ? 'spot.exchange_info' : 'usd_m.exchange_info',
      receivedTimeMs,
      evaluatedAtMs,
      config: CONFIG,
    },
  );
  assert.equal(parsed.listings.length, rows.length, 'fixture rows must remain parseable owner evidence');
  return parsed.listings.map((listing) => structuredClone(listing.metadata));
}

function registryInput(product, metadata, overrides = {}) {
  return {
    matrixSha256: L04_BINANCE_MATRIX_SHA256,
    contractId: L04_EXCHANGE_INFO_CONTRACT_IDS[product],
    product,
    environment: 'PRODUCTION',
    evaluatedAtMs: T0,
    maximumAgeMs: MAXIMUM_AGE_MS,
    metadata,
    ...overrides,
  };
}

function ownerSemanticMetadata(metadata) {
  return {
    source: metadata.source,
    symbol: metadata.symbol,
    pair: metadata.pair,
    baseAsset: metadata.baseAsset,
    quoteAsset: metadata.quoteAsset,
    status: metadata.status,
    tradingAllowed: metadata.tradingAllowed,
    contractType: metadata.contractType,
    onboardDateMs: metadata.onboardDateMs,
    deliveryDateMs: metadata.deliveryDateMs,
    marginAsset: metadata.marginAsset,
    underlyingType: metadata.underlyingType,
    underlyingSubType: metadata.underlyingSubType,
    orderTypes: metadata.orderTypes,
    timeInForce: metadata.timeInForce,
    permissionSets: metadata.permissionSets,
    precisions: metadata.precisions,
    filters: metadata.filters,
    includedInUniverse: metadata.includedInUniverse,
    exclusionReasonCodes: metadata.exclusionReasonCodes,
  };
}

function rebindOwnerIdentity(metadata) {
  metadata.id = stableId('runtime-listing-record', {
    source: metadata.source,
    symbol: metadata.symbol,
  });
  metadata.fingerprint = stableId('runtime-listing-metadata', ownerSemanticMetadata(metadata));
  metadata.truth.provenance.sourceRecordIds = [stableId('runtime-exchange-info-row', {
    source: metadata.source,
    fingerprint: metadata.fingerprint,
  })];
  return metadata;
}

function normalizeRows(product, rows, overrides = {}) {
  const source = product === 'USD_M_PERPETUAL' ? 'USD_M_PERPETUAL' : 'SPOT';
  return normalizeRuntimeInstrumentRegistry(registryInput(
    product,
    parseMetadata(source, rows, overrides.parseOptions),
    overrides.input,
  ));
}

function assertRejected(result, reasonCode = 'INSTRUMENT_METADATA_REJECTED') {
  assert.deepEqual(result, { ok: false, reasonCodes: [reasonCode] });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasonCodes), true);
}

function assertBlockedFilter(result, filterType, state, reasonCode, expectedCount = 1) {
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.normalizationState, 'BLOCKED_SOURCE');
  assert.ok(instrument.lossCodes.includes(reasonCode));
  const filters = instrument.filters.filter((candidate) => candidate.filterType === filterType);
  assert.equal(filters.length, expectedCount);
  for (const filter of filters) {
    assert.equal(filter.state, state);
    assert.ok(filter.reasonCodes.includes(reasonCode));
    assert.match(filter.sourceContentSha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.isFrozen(filter), true);
    assert.equal(Object.isFrozen(filter.reasonCodes), true);
    assert.equal(Object.isFrozen(filter.values), true);
  }
  assert.equal(instrument.externalActionAuthorization, 'NONE');
  assert.equal(instrument.actionAuthority, 'NONE_RECORD_ONLY');
  return filters;
}

function assertMissingFilter(result, filterType, reasonCode) {
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.normalizationState, 'BLOCKED_SOURCE');
  assert.ok(instrument.lossCodes.includes(reasonCode));
  assert.equal(instrument.filters.some((candidate) => candidate.filterType === filterType), false);
}

function assertDeeplyFrozen(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    assert.equal(Object.isFrozen(current), true);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if (Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
    }
  }
}

function filterByType(instrument, filterType) {
  const filter = instrument.filters.find((candidate) => candidate.filterType === filterType);
  assert.ok(filter, `expected ${filterType}`);
  return filter;
}

test('Spot owner metadata normalizes to a deeply frozen static-only documentary snapshot', () => {
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT', { filters: fullSpotFilters() })]);
  assert.equal(result.ok, true);
  assertDeeplyFrozen(result);
  const { snapshot } = result;
  const instrument = snapshot.instruments[0];
  assert.equal(snapshot.schema, 'BINANCE_INSTRUMENT_REGISTRY_V1');
  assert.equal(snapshot.product, 'SPOT');
  assert.equal(snapshot.environment, 'PRODUCTION');
  assert.equal(snapshot.contractId, 'SPOT_EXCHANGE_INFO_FILTERS');
  assert.equal(snapshot.matrixSha256, L04_BINANCE_MATRIX_SHA256);
  assert.equal(snapshot.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.equal(snapshot.externalActionAuthorization, 'NONE');
  assert.equal(snapshot.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(instrument.normalizationState, 'READY_STATIC_ONLY');
  assert.equal(instrument.tradingAllowed, true);
  assert.equal(instrument.contractSize, null);
  assert.equal(instrument.externalActionAuthorization, 'NONE');
  assert.match(instrument.instrumentRevision, /^l04-instrument-spec:/);
  assert.match(snapshot.registryRevision, /^l04-instrument-registry:/);
  assert.deepEqual(instrument.advertisedOrderTypes, ['LIMIT', 'MARKET']);
  assert.deepEqual(instrument.staticOrderTypes, ['LIMIT', 'MARKET']);
  assert.ok(instrument.lossCodes.includes('EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED'));
  assert.ok(instrument.lossCodes.includes('TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE'));
  assert.ok(instrument.lossCodes.includes('MAX_ASSET_PRIVATE_FILTER_UNAVAILABLE'));
  assert.ok(instrument.lossCodes.includes('SPOT_EXECUTION_RULES_UNAVAILABLE'));
  assert.ok(instrument.lossCodes.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));
});

test('filter decimals preserve exact raw strings and expose canonical exact values', () => {
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({
      minPrice: '0000.01000000',
      maxPrice: '001000000.00000000',
      tickSize: '0000.01000000',
      minQty: '000.00001000',
      maxQty: '009000.00000000',
      stepSize: '000.00001000',
      minNotional: '0005.00000000',
      maxNotional: '0100000.00000000',
    }),
  })]);
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  const price = filterByType(instrument, 'PRICE_FILTER');
  const lot = filterByType(instrument, 'LOT_SIZE');
  const notional = filterByType(instrument, 'NOTIONAL');
  assert.deepEqual(price.values.minPrice, { raw: '0000.01000000', canonical: '0.01' });
  assert.deepEqual(price.values.maxPrice, { raw: '001000000.00000000', canonical: '1000000' });
  assert.deepEqual(lot.values.stepSize, { raw: '000.00001000', canonical: '0.00001' });
  assert.deepEqual(notional.values.minNotional, { raw: '0005.00000000', canonical: '5' });
});

test('very large and very small decimals remain exact without exponent conversion or precision loss', () => {
  const smallest = `0.${'0'.repeat(78)}1`;
  const largest = '9'.repeat(80);
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({
      minPrice: smallest,
      maxPrice: largest,
      tickSize: smallest,
      minQty: smallest,
      maxQty: largest,
      stepSize: smallest,
    }),
  })]);
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.deepEqual(filterByType(instrument, 'PRICE_FILTER').values.minPrice, {
    raw: smallest,
    canonical: smallest,
  });
  assert.deepEqual(filterByType(instrument, 'PRICE_FILTER').values.maxPrice, {
    raw: largest,
    canonical: largest,
  });
  assert.deepEqual(filterByType(instrument, 'LOT_SIZE').values.stepSize, {
    raw: smallest,
    canonical: smallest,
  });
});

test('all current Spot filter families normalize in deterministic filterType order with flags', () => {
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT', { filters: fullSpotFilters() })]);
  assert.equal(result.ok, true);
  const filters = result.snapshot.instruments[0].filters;
  assert.deepEqual(filters.map((filter) => filter.filterType), [...filters.map((filter) => filter.filterType)].sort());
  assert.equal(filterByType(result.snapshot.instruments[0], 'MAX_NUM_ORDERS').privateTruthRequired, true);
  assert.equal(filterByType(result.snapshot.instruments[0], 'MAX_POSITION').privateTruthRequired, true);
  assert.equal(filterByType(result.snapshot.instruments[0], 'PERCENT_PRICE').dynamicReferenceRequired, true);
  assert.equal(filterByType(result.snapshot.instruments[0], 'PERCENT_PRICE_BY_SIDE').dynamicReferenceRequired, true);
  assert.equal(filterByType(result.snapshot.instruments[0], 'PRICE_FILTER').dynamicReferenceRequired, false);
});

test('USD-M perpetual owner metadata normalizes current regular-route static capabilities', () => {
  const result = normalizeRows('USD_M_PERPETUAL', [usdMRow('ETHUSDT', {
    baseAsset: 'ETH',
    orderTypes: ['TRAILING_STOP_MARKET', 'LIMIT', 'MARKET', 'STOP'],
    timeInForce: ['RPI', 'GTD', 'GTC'],
  })]);
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.product, 'USD_M_PERPETUAL');
  assert.equal(instrument.contractId, 'USDM_EXCHANGE_INFO_FILTERS');
  assert.equal(instrument.contractType, 'PERPETUAL');
  assert.equal(instrument.tradingAllowed, null);
  assert.deepEqual(instrument.advertisedOrderTypes, ['LIMIT', 'MARKET', 'STOP', 'TRAILING_STOP_MARKET']);
  assert.deepEqual(instrument.staticOrderTypes, ['LIMIT', 'MARKET']);
  assert.deepEqual(instrument.allowedTimeInForce, ['GTC', 'GTD', 'RPI']);
  assert.ok(instrument.lossCodes.includes('USD_M_CONTRACT_SIZE_UNAVAILABLE'));
  assert.ok(instrument.lossCodes.includes('USD_M_ALGO_ROUTE_CAPABILITY_NOT_REGULAR_ORDER_AUTHORITY'));
  const percent = filterByType(instrument, 'PERCENT_PRICE');
  assert.equal(percent.values.multiplierDecimal, 4);
  assert.equal(percent.dynamicReferenceRequired, true);
  assert.equal(filterByType(instrument, 'MAX_NUM_ORDERS').values.limit, 200);
});

test('USD-M multiplierDecimal accepts the current integer representation without inventing decimals', () => {
  const stringResult = normalizeRows('USD_M_PERPETUAL', [usdMRow('BTCUSDT')]);
  const numberResult = normalizeRows('USD_M_PERPETUAL', [usdMRow('BTCUSDT', {
    filters: usdMFilters({ multiplierDecimal: 4 }),
  })]);
  assert.equal(stringResult.ok, true);
  assert.equal(numberResult.ok, true);
  assert.equal(filterByType(stringResult.snapshot.instruments[0], 'PERCENT_PRICE').values.multiplierDecimal, 4);
  assert.equal(filterByType(numberResult.snapshot.instruments[0], 'PERCENT_PRICE').values.multiplierDecimal, 4);
});

test('Margin reuses Spot public metadata but remains blocked on separate owner truth', () => {
  const result = normalizeRows('MARGIN', [spotRow('BTCUSDT', {
    isMarginTradingAllowed: true,
    permissionSets: [['MARGIN']],
  })]);
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.product, 'MARGIN');
  assert.equal(instrument.contractId, 'MARGIN_EXCHANGE_INFO_FILTERS');
  assert.equal(instrument.normalizationState, 'BLOCKED_OWNER_TRUTH');
  assert.equal(instrument.tradingAllowed, null);
  assert.deepEqual(instrument.permissionSets, [['MARGIN']]);
  for (const loss of [
    'MARGIN_IS_MARGIN_TRADING_ALLOWED_UNAVAILABLE',
    'MARGIN_PAIR_ELIGIBILITY_JOIN_UNAVAILABLE',
    'MARGIN_RESTRICTIONS_UNAVAILABLE',
    'MARGIN_ACCOUNT_PERMISSION_UNAVAILABLE',
  ]) assert.ok(instrument.lossCodes.includes(loss));
  assert.equal(instrument.externalActionAuthorization, 'NONE');
});

test('Margin never treats Spot trading permissionSets as Margin eligibility', () => {
  for (const permissionSets of [[['SPOT']], [['MARGIN']], [['SPOT'], ['MARGIN']]]) {
    const result = normalizeRows('MARGIN', [spotRow('BTCUSDT', { permissionSets })]);
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.instruments[0].normalizationState, 'BLOCKED_OWNER_TRUTH');
    assert.equal(result.snapshot.instruments[0].tradingAllowed, null);
  }
});

test('semantic revisions remain stable while receipt and evaluation change evidence revisions', () => {
  const first = normalizeRows('SPOT', [spotRow('BTCUSDT')]);
  const second = normalizeRuntimeInstrumentRegistry(registryInput(
    'SPOT',
    parseMetadata('SPOT', [spotRow('BTCUSDT')], { receivedTimeMs: T0 + 1_000 }),
    { evaluatedAtMs: T0 + 1_000 },
  ));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.snapshot.instruments[0].instrumentRevision, second.snapshot.instruments[0].instrumentRevision);
  assert.equal(first.snapshot.registryRevision, second.snapshot.registryRevision);
  assert.notEqual(first.snapshot.instruments[0].sourceEvidenceRevision, second.snapshot.instruments[0].sourceEvidenceRevision);
  assert.notEqual(first.snapshot.snapshotRevision, second.snapshot.snapshotRevision);
  assert.notEqual(first.snapshot.instruments[0].sourceReceivedAtMs, second.snapshot.instruments[0].sourceReceivedAtMs);
  assert.notEqual(first.snapshot.instruments[0].sourceValidUntilMs, second.snapshot.instruments[0].sourceValidUntilMs);
  assert.notEqual(first.snapshot.evaluatedAtMs, second.snapshot.evaluatedAtMs);
});

test('unchanged exact input deterministically reproduces all semantic and evidence revisions', () => {
  const input = registryInput('SPOT', parseMetadata('SPOT', [spotRow('BTCUSDT')]));
  const first = normalizeRuntimeInstrumentRegistry(input);
  const replay = normalizeRuntimeInstrumentRegistry(input);
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  const firstInstrument = first.snapshot.instruments[0];
  const replayInstrument = replay.snapshot.instruments[0];
  assert.equal(firstInstrument.instrumentRevision, replayInstrument.instrumentRevision);
  assert.equal(firstInstrument.sourceEvidenceRevision, replayInstrument.sourceEvidenceRevision);
  assert.equal(first.snapshot.registryRevision, replay.snapshot.registryRevision);
  assert.equal(first.snapshot.snapshotRevision, replay.snapshot.snapshotRevision);
  assert.deepEqual(first.snapshot, replay.snapshot);
});

test('snapshot validator rejects evaluatedAt timestamp tampering without a revised snapshot identity', () => {
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT')]);
  assert.equal(result.ok, true);
  assert.equal(validateInstrumentRegistrySnapshot(result.snapshot), result.snapshot);
  const tampered = Object.freeze({
    ...result.snapshot,
    evaluatedAtMs: result.snapshot.evaluatedAtMs + 1,
  });
  assert.throws(
    () => validateInstrumentRegistrySnapshot(tampered),
    /snapshot revision mismatch/,
  );
});

test('raw documentary decimal changes revise identity even when canonical values are equal', () => {
  const first = normalizeRows('SPOT', [spotRow('BTCUSDT')]);
  const second = normalizeRows('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({ minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' }),
  })]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(
    filterByType(first.snapshot.instruments[0], 'PRICE_FILTER').values.minPrice.canonical,
    filterByType(second.snapshot.instruments[0], 'PRICE_FILTER').values.minPrice.canonical,
  );
  assert.notEqual(first.snapshot.instruments[0].sourceFingerprint, second.snapshot.instruments[0].sourceFingerprint);
  assert.notEqual(first.snapshot.instruments[0].instrumentRevision, second.snapshot.instruments[0].instrumentRevision);
});

test('status content changes separate instrument revisions while receipt-only changes do not', () => {
  const trading = normalizeRows('SPOT', [spotRow('BTCUSDT')]);
  const breakStatus = normalizeRows('SPOT', [spotRow('BTCUSDT', { status: 'BREAK' })]);
  assert.equal(trading.ok, true);
  assert.equal(breakStatus.ok, true);
  assert.notEqual(trading.snapshot.instruments[0].instrumentRevision, breakStatus.snapshot.instruments[0].instrumentRevision);
});

test('metadata input order does not affect sorted instrument order or registry revision', () => {
  const rows = [spotRow('ETHUSDT', { baseAsset: 'ETH' }), spotRow('BTCUSDT', { baseAsset: 'BTC' })];
  const forward = normalizeRows('SPOT', rows);
  const reverse = normalizeRows('SPOT', [...rows].reverse());
  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  assert.deepEqual(forward.snapshot.instruments.map((instrument) => instrument.symbol), ['BTCUSDT', 'ETHUSDT']);
  assert.deepEqual(reverse.snapshot.instruments.map((instrument) => instrument.symbol), ['BTCUSDT', 'ETHUSDT']);
  assert.equal(forward.snapshot.registryRevision, reverse.snapshot.registryRevision);
});

test('normalization snapshots input and never mutates owner metadata', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  const before = structuredClone(metadata);
  const input = registryInput('SPOT', metadata);
  const result = normalizeRuntimeInstrumentRegistry(input);
  assert.equal(result.ok, true);
  assert.deepEqual(metadata, before);
  assert.equal(Object.isFrozen(metadata), false);
  assert.equal(Object.isFrozen(input), false);
});

for (const [name, override, code] of [
  ['matrix digest', { matrixSha256: '0'.repeat(64) }, 'MATRIX_HASH_MISMATCH'],
  ['contract scope', { contractId: 'USDM_EXCHANGE_INFO_FILTERS' }, 'CONTRACT_SCOPE_MISMATCH'],
  ['product', { product: 'OPTIONS' }, 'PRODUCT_INVALID'],
  ['environment', { environment: 'TESTNET' }, 'ENVIRONMENT_INVALID'],
]) {
  test(`wrong ${name} is rejected before metadata normalization`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
    assertRejected(normalizeRuntimeInstrumentRegistry({ ...registryInput('SPOT', metadata), ...override }), code);
  });
}

test('cross-product owner metadata source mismatch is rejected', () => {
  const spotMetadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  const usdMetadata = parseMetadata('USD_M_PERPETUAL', [usdMRow('BTCUSDT')]);
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('USD_M_PERPETUAL', spotMetadata)));
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', usdMetadata)));
});

for (const [name, product, source, row, mutate] of [
  ['pair', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.pair = 'ETHUSDT'; }],
  ['symbol', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.symbol = 'ETHUSDT'; }],
  ['contractType', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.contractType = 'PERPETUAL'; }],
  ['tradingAllowed', 'USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT'), (metadata) => { metadata.tradingAllowed = true; }],
]) {
  test(`coherently rebound owner ${name} mutation cannot bypass product identity invariants`, () => {
    const metadata = parseMetadata(source, [row]);
    mutate(metadata[0]);
    rebindOwnerIdentity(metadata[0]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput(product, metadata)));
  });
}

for (const [form, field, value] of [
  ['internal whitespace', 'symbol', 'BTC USDT'],
  ['internal whitespace', 'pair', 'BTC USDT'],
  ['internal whitespace', 'baseAsset', 'BT C'],
  ['internal whitespace', 'quoteAsset', 'US DT'],
  ['lowercase', 'symbol', 'btcusdt'],
  ['lowercase', 'pair', 'btcusdt'],
  ['lowercase', 'baseAsset', 'btc'],
  ['lowercase', 'quoteAsset', 'usdt'],
  ['NFD', 'symbol', `A\u030aUSDT`],
  ['NFD', 'pair', `A\u030aUSDT`],
  ['NFD', 'baseAsset', `A\u030a`],
  ['NFD', 'quoteAsset', `U\u0308SDT`],
]) {
  test(`coherently rebound ${form} owner ${field} token is rejected`, () => {
    if (form === 'NFD') {
      assert.equal(value, value.normalize('NFD'));
      assert.notEqual(value, value.normalize('NFC'));
    }
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
    metadata[0][field] = value;
    rebindOwnerIdentity(metadata[0]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
  });
}

test('uppercase NFC Unicode Runtime instrument identity remains valid', () => {
  const unicodeBase = '\u00c5';
  const unicodeSymbol = `${unicodeBase}USDT`;
  assert.equal(unicodeBase, unicodeBase.normalize('NFC'));
  assert.equal(unicodeBase, unicodeBase.toUpperCase());
  const result = normalizeRows('SPOT', [spotRow(unicodeSymbol, { baseAsset: unicodeBase })]);
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.normalizationState, 'READY_STATIC_ONLY');
  assert.equal(instrument.symbol, unicodeSymbol);
  assert.equal(instrument.pair, unicodeSymbol);
  assert.equal(instrument.baseAsset, unicodeBase);
  assert.equal(instrument.quoteAsset, 'USDT');
});

test('stale source age blocks the instrument without fabricating invalid metadata', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata, {
    evaluatedAtMs: T0 + MAXIMUM_AGE_MS + 1,
  }));
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.normalizationState, 'BLOCKED_SOURCE');
  assert.ok(instrument.lossCodes.includes('SOURCE_STALE_OR_UNAVAILABLE'));
  assert.equal(instrument.sourceValidUntilMs, T0 + MAXIMUM_AGE_MS);
});

test('source clock skew beyond the bounded tolerance blocks the instrument', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')], { receivedTimeMs: T0 + 2_001 });
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.instruments[0].normalizationState, 'BLOCKED_SOURCE');
  assert.ok(result.snapshot.instruments[0].lossCodes.includes('SOURCE_CLOCK_SKEWED'));
});

test('non-TRADING Spot status is retained as evidence and blocks static readiness', () => {
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT', { status: 'BREAK' })]);
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.status, 'BREAK');
  assert.equal(instrument.normalizationState, 'BLOCKED_SOURCE');
  assert.ok(instrument.lossCodes.includes('SYMBOL_NOT_TRADING'));
});

test('Spot tradingAllowed false or unavailable blocks proof of Spot trading', () => {
  const denied = normalizeRows('SPOT', [spotRow('BTCUSDT', { isSpotTradingAllowed: false })]);
  const unknown = normalizeRows('SPOT', [spotRow('ETHUSDT', { baseAsset: 'ETH', isSpotTradingAllowed: undefined })]);
  assert.equal(denied.ok, true);
  assert.equal(unknown.ok, true);
  for (const result of [denied, unknown]) {
    assert.equal(result.snapshot.instruments[0].normalizationState, 'BLOCKED_SOURCE');
    assert.ok(result.snapshot.instruments[0].lossCodes.includes('SPOT_TRADING_NOT_PROVED'));
  }
});

test('owner truth marked incomplete remains a blocked source', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { permissionSets: ['SPOT'] })]);
  assert.equal(metadata[0].truth.completeness.state, 'PARTIAL');
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.instruments[0].normalizationState, 'BLOCKED_SOURCE');
  assert.ok(result.snapshot.instruments[0].lossCodes.includes('SOURCE_INCOMPLETE'));
});

test('duplicate symbols reject the whole registry', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', [metadata[0], structuredClone(metadata[0])])), 'DUPLICATE_SYMBOL');
});

test('duplicate symbol identity with conflicting content also rejects the whole registry', () => {
  const first = parseMetadata('SPOT', [spotRow('BTCUSDT')])[0];
  const conflicting = parseMetadata('SPOT', [spotRow('BTCUSDT', { status: 'BREAK' })])[0];
  assert.notEqual(first.fingerprint, conflicting.fingerprint);
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', [first, conflicting])), 'DUPLICATE_SYMBOL');
});

test('unknown Spot filters remain explicit, content-bound, unsupported, and non-actionable', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', {
    filters: [...spotFilters(), { filterType: 'NEW_UNDOCUMENTED_FILTER', value: '1' }],
  })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const [filter] = assertBlockedFilter(
    result,
    'NEW_UNDOCUMENTED_FILTER',
    'BLOCKED_UNSUPPORTED',
    'UNSUPPORTED_CURRENT_SPOT_FILTER_NEW_UNDOCUMENTED_FILTER',
  );
  assert.deepEqual(filter.values, {});
});

for (const [name, filters, filterType] of [
  ['extra filter field', spotFilters().map((filter) => filter.filterType === 'PRICE_FILTER' ? { ...filter, surprise: '1' } : filter), 'PRICE_FILTER'],
  ['numeric decimal', spotFilters({ minPrice: 0.01 }), 'PRICE_FILTER'],
  ['exponent decimal', spotFilters({ minPrice: '1e-2' }), 'PRICE_FILTER'],
  ['signed decimal', spotFilters({ minPrice: '+0.01' }), 'PRICE_FILTER'],
  ['leading-dot decimal', spotFilters({ minPrice: '.01' }), 'PRICE_FILTER'],
  ['trailing-dot decimal', spotFilters({ minPrice: '1.' }), 'PRICE_FILTER'],
  ['negative decimal', spotFilters({ minPrice: '-0.01' }), 'PRICE_FILTER'],
  ['zero positive notional', spotFilters({ minNotional: '0' }), 'NOTIONAL'],
]) {
  test(`Spot ${name} remains explicit malformed evidence and blocks the spec`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
    const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
    const [filter] = assertBlockedFilter(
      result,
      filterType,
      'BLOCKED_MALFORMED',
      `MALFORMED_FILTER_${filterType}`,
    );
    assert.deepEqual(filter.values, {});
  });
}

test('duplicate Spot filters remain separately content-bound and block the spec', () => {
  const filters = [...spotFilters(), spotFilters()[0]];
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const duplicates = assertBlockedFilter(
    result,
    'PRICE_FILTER',
    'BLOCKED_DUPLICATE',
    'DUPLICATE_FILTER_PRICE_FILTER',
    2,
  );
  assert.equal(new Set(duplicates.map((filter) => filter.sourceContentSha256)).size, 1);
});

test('conflicting duplicate Spot filters retain distinct documentary content digests', () => {
  const filters = [...spotFilters(), { ...spotFilters()[0], tickSize: '0.02000000' }];
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const duplicates = assertBlockedFilter(
    result,
    'PRICE_FILTER',
    'BLOCKED_DUPLICATE',
    'DUPLICATE_FILTER_PRICE_FILTER',
    2,
  );
  assert.equal(new Set(duplicates.map((filter) => filter.sourceContentSha256)).size, 2);
});

for (const [name, filters, missingType, reasonCode] of [
  ['PRICE_FILTER', spotFilters().filter((filter) => filter.filterType !== 'PRICE_FILTER'), 'PRICE_FILTER', 'REQUIRED_FILTER_PRICE_FILTER_MISSING'],
  ['LOT_SIZE', spotFilters().filter((filter) => filter.filterType !== 'LOT_SIZE'), 'LOT_SIZE', 'REQUIRED_FILTER_LOT_SIZE_MISSING'],
  ['notional', spotFilters().filter((filter) => filter.filterType !== 'NOTIONAL'), 'NOTIONAL', 'REQUIRED_SPOT_FAMILY_NOTIONAL_FILTER_MISSING'],
]) {
  test(`missing Spot ${name} stays explicit and blocks the spec`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
    assertMissingFilter(
      normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)),
      missingType,
      reasonCode,
    );
  });
}

for (const [name, filters, filterType, reasonCode] of [
  ['price bounds', spotFilters({ minPrice: '2', maxPrice: '1' }), 'PRICE_FILTER', 'PRICE_FILTER_MINIMUM_EXCEEDS_MAXIMUM'],
  ['quantity bounds', spotFilters({ minQty: '2', maxQty: '1' }), 'LOT_SIZE', 'LOT_SIZE_MINIMUM_EXCEEDS_MAXIMUM'],
  ['notional bounds', spotFilters({ minNotional: '20', maxNotional: '10' }), 'NOTIONAL', 'NOTIONAL_MINIMUM_EXCEEDS_MAXIMUM'],
]) {
  test(`contradictory Spot ${name} preserve exact values but block the spec`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
    const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
    const [filter] = assertBlockedFilter(result, filterType, 'BLOCKED_CONTRADICTORY', reasonCode);
    assert.notDeepEqual(filter.values, {});
  });
}

test('PERCENT_PRICE multiplierDown above multiplierUp is explicit contradictory evidence', () => {
  const filters = [
    ...spotFilters(),
    {
      filterType: 'PERCENT_PRICE',
      multiplierUp: '1.1000',
      multiplierDown: '1.2000',
      avgPriceMins: 5,
    },
  ];
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const [filter] = assertBlockedFilter(
    result,
    'PERCENT_PRICE',
    'BLOCKED_CONTRADICTORY',
    'PERCENT_PRICE_MULTIPLIER_DOWN_EXCEEDS_UP',
  );
  assert.equal(filter.values.multiplierDown.canonical, '1.2');
  assert.equal(filter.values.multiplierUp.canonical, '1.1');
});

for (const [side, bidMultiplierUp, bidMultiplierDown, askMultiplierUp, askMultiplierDown, reasonCode] of [
  ['bid', '1.1000', '1.2000', '1.1500', '0.8500', 'PERCENT_PRICE_BY_SIDE_BID_DOWN_EXCEEDS_UP'],
  ['ask', '1.1000', '0.9000', '1.0500', '1.1500', 'PERCENT_PRICE_BY_SIDE_ASK_DOWN_EXCEEDS_UP'],
]) {
  test(`PERCENT_PRICE_BY_SIDE ${side} down above up is explicit contradictory evidence`, () => {
    const filters = [
      ...spotFilters(),
      {
        filterType: 'PERCENT_PRICE_BY_SIDE',
        bidMultiplierUp,
        bidMultiplierDown,
        askMultiplierUp,
        askMultiplierDown,
        avgPriceMins: 5,
      },
    ];
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters })]);
    const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
    const [filter] = assertBlockedFilter(
      result,
      'PERCENT_PRICE_BY_SIDE',
      'BLOCKED_CONTRADICTORY',
      reasonCode,
    );
    assert.equal(filter.reasonCodes.length, 1);
  });
}

test('PRICE_FILTER zero may disable bounds individually while a positive tick remains active', () => {
  const result = normalizeRows('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({ minPrice: '0', maxPrice: '0', tickSize: '0.01' }),
  })]);
  assert.equal(result.ok, true);
  const price = filterByType(result.snapshot.instruments[0], 'PRICE_FILTER');
  assert.equal(price.state, 'ACTIVE');
  assert.equal(price.values.minPrice.canonical, '0');
  assert.equal(price.values.maxPrice.canonical, '0');
  assert.equal(price.values.tickSize.canonical, '0.01');
});

test('disabled PRICE_FILTER tick remains explicit and non-actionable', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({ tickSize: '0' }),
  })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const [filter] = assertBlockedFilter(
    result,
    'PRICE_FILTER',
    'BLOCKED_DISABLED',
    'PRICE_FILTER_TICK_DISABLED',
  );
  assert.equal(filter.values.tickSize.canonical, '0');
});

test('zero LOT_SIZE step remains explicit disabled evidence and non-actionable', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({ stepSize: '0' }),
  })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const [filter] = assertBlockedFilter(
    result,
    'LOT_SIZE',
    'BLOCKED_DISABLED',
    'LOT_SIZE_STEP_DISABLED',
  );
  assert.equal(filter.values.stepSize.canonical, '0');
});

for (const [name, filters, filterType, reasonCode] of [
  ['unknown NOTIONAL filter', [...usdMFilters(), { filterType: 'NOTIONAL', minNotional: '5', maxNotional: '10' }], 'NOTIONAL', 'UNSUPPORTED_CURRENT_USD_M_PERPETUAL_FILTER_NOTIONAL'],
  ['removed MAX_NUM_ALGO_ORDERS filter', [...usdMFilters(), { filterType: 'MAX_NUM_ALGO_ORDERS', limit: 5 }], 'MAX_NUM_ALGO_ORDERS', 'UNSUPPORTED_CURRENT_USD_M_PERPETUAL_FILTER_MAX_NUM_ALGO_ORDERS'],
]) {
  test(`USD-M ${name} remains explicit unsupported evidence and blocks the spec`, () => {
    const metadata = parseMetadata('USD_M_PERPETUAL', [usdMRow('BTCUSDT', { filters })]);
    const result = normalizeRuntimeInstrumentRegistry(registryInput('USD_M_PERPETUAL', metadata));
    const [filter] = assertBlockedFilter(result, filterType, 'BLOCKED_UNSUPPORTED', reasonCode);
    assert.deepEqual(filter.values, {});
  });
}

for (const [name, filters, filterType] of [
  ['numeric price decimal', usdMFilters({ minPrice: 0.1 }), 'PRICE_FILTER'],
  ['exponent quantity decimal', usdMFilters({ stepSize: '1e-3' }), 'LOT_SIZE'],
  ['zero MIN_NOTIONAL', usdMFilters({ minNotional: '0' }), 'MIN_NOTIONAL'],
  ['negative multiplierDecimal', usdMFilters({ multiplierDecimal: '-1' }), 'PERCENT_PRICE'],
]) {
  test(`USD-M ${name} remains explicit malformed evidence and blocks the spec`, () => {
    const metadata = parseMetadata('USD_M_PERPETUAL', [usdMRow('BTCUSDT', { filters })]);
    const result = normalizeRuntimeInstrumentRegistry(registryInput('USD_M_PERPETUAL', metadata));
    const [filter] = assertBlockedFilter(
      result,
      filterType,
      'BLOCKED_MALFORMED',
      `MALFORMED_FILTER_${filterType}`,
    );
    assert.deepEqual(filter.values, {});
  });
}

test('missing USD-M MIN_NOTIONAL remains explicit and blocks the spec', () => {
  const filters = usdMFilters().filter((filter) => filter.filterType !== 'MIN_NOTIONAL');
  const metadata = parseMetadata('USD_M_PERPETUAL', [usdMRow('BTCUSDT', { filters })]);
  assertMissingFilter(
    normalizeRuntimeInstrumentRegistry(registryInput('USD_M_PERPETUAL', metadata)),
    'MIN_NOTIONAL',
    'REQUIRED_FILTER_MIN_NOTIONAL_MISSING',
  );
});

test('over-96-digit filter decimals remain explicit malformed evidence', () => {
  const overbound = '1'.repeat(97);
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', {
    filters: spotFilters({ maxPrice: overbound }),
  })]);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  const [filter] = assertBlockedFilter(
    result,
    'PRICE_FILTER',
    'BLOCKED_MALFORMED',
    'MALFORMED_FILTER_PRICE_FILTER',
  );
  assert.match(filter.sourceContentSha256, /^[0-9a-f]{64}$/);
});

test('malformed filter digest and revision are deterministic and separate changed malformed content', () => {
  const normalizeMalformed = (minPrice) => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', {
      filters: spotFilters({ minPrice }),
    })]);
    return normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  };
  const first = normalizeMalformed('1e-2');
  const replay = normalizeMalformed('1e-2');
  const changed = normalizeMalformed('2e-2');
  for (const result of [first, replay, changed]) assert.equal(result.ok, true);
  const firstFilter = filterByType(first.snapshot.instruments[0], 'PRICE_FILTER');
  const replayFilter = filterByType(replay.snapshot.instruments[0], 'PRICE_FILTER');
  const changedFilter = filterByType(changed.snapshot.instruments[0], 'PRICE_FILTER');
  assert.equal(firstFilter.sourceContentSha256, replayFilter.sourceContentSha256);
  assert.equal(first.snapshot.instruments[0].instrumentRevision, replay.snapshot.instruments[0].instrumentRevision);
  assert.notEqual(firstFilter.sourceContentSha256, changedFilter.sourceContentSha256);
  assert.notEqual(first.snapshot.instruments[0].instrumentRevision, changed.snapshot.instruments[0].instrumentRevision);
});

test('exact 128-filter Runtime owner capacity is accepted as bounded explicit evidence', () => {
  const capacityFilters = [
    ...spotFilters(),
    ...Array.from({ length: 125 }, (_, index) => ({
      filterType: `ZZ_CAPACITY_${String(index).padStart(3, '0')}`,
      value: String(index),
    })),
  ];
  assert.equal(capacityFilters.length, 128);
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters: capacityFilters })]);
  assert.equal(metadata[0].filters.length, 128);
  const result = normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata));
  assert.equal(result.ok, true);
  const instrument = result.snapshot.instruments[0];
  assert.equal(instrument.filters.length, 128);
  assert.equal(instrument.normalizationState, 'BLOCKED_SOURCE');
  assert.equal(instrument.filters.filter((filter) => filter.state === 'BLOCKED_UNSUPPORTED').length, 125);
  assert.ok(instrument.lossCodes.includes('UNSUPPORTED_CURRENT_SPOT_FILTER_ZZ_CAPACITY_124'));
});

test('129 filters exceed the exact Runtime owner capacity', () => {
  const capacityFilters = [
    ...spotFilters(),
    ...Array.from({ length: 125 }, (_, index) => ({
      filterType: `ZZ_CAPACITY_${String(index).padStart(3, '0')}`,
      value: String(index),
    })),
  ];
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT', { filters: capacityFilters })]);
  metadata[0].filters.push({
    filterType: 'ZZ_CAPACITY_125',
    values: { filterType: 'ZZ_CAPACITY_125', value: '125' },
  });
  assert.equal(metadata[0].filters.length, 129);
  rebindOwnerIdentity(metadata[0]);
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
});

test('USD-M non-PERPETUAL contract metadata is rejected', () => {
  const metadata = parseMetadata('USD_M_PERPETUAL', [usdMRow('BTCUSDT', { contractType: 'CURRENT_QUARTER' })]);
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('USD_M_PERPETUAL', metadata)));
});

for (const [name, row] of [
  ['unknown Spot order type', spotRow('BTCUSDT', { orderTypes: ['LIMIT', 'PEGGED'] })],
  ['unknown Spot time in force', spotRow('BTCUSDT', { timeInForce: ['GTC', 'GTX'] })],
  ['unknown USD-M order type', usdMRow('BTCUSDT', { orderTypes: ['LIMIT', 'LIQUIDATION'] })],
  ['unknown USD-M time in force', usdMRow('BTCUSDT', { timeInForce: ['GTC', 'PO'] })],
]) {
  test(`${name} fails closed`, () => {
    const source = row.contractType === undefined ? 'SPOT' : 'USD_M_PERPETUAL';
    const product = source === 'SPOT' ? 'SPOT' : 'USD_M_PERPETUAL';
    const metadata = parseMetadata(source, [row]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput(product, metadata)));
  });
}

for (const [name, mutate] of [
  ['owner id', (metadata) => { metadata.id = 'runtime-listing-record:tampered'; }],
  ['owner fingerprint', (metadata) => { metadata.fingerprint = 'runtime-listing-metadata:tampered'; }],
  ['truth received time', (metadata) => { metadata.truth.temporal.receivedTimeMs += 1; }],
  ['truth authority kind', (metadata) => { metadata.truth.authority.kind = 'REPOSITORY_DOCUMENT'; }],
  ['truth endpoint class', (metadata) => { metadata.truth.authority.endpointClass = 'WEBSOCKET_STREAM'; }],
]) {
  test(`tampered ${name} is rejected`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
    mutate(metadata[0]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
  });
}

for (const [name, mutate] of [
  ['sourceRecordIds', (truth) => { truth.provenance.sourceRecordIds = ['runtime-exchange-info-row:000000000000000000000000']; }],
  ['sourceSet', (truth) => { truth.provenance.sourceSet = ['runtime-source:000000000000000000000000']; }],
  ['transforms', (truth) => { truth.provenance.transforms = ['other-owner-transform-v1']; }],
]) {
  test(`wrong truth provenance ${name} is rejected`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
    mutate(metadata[0].truth);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
  });
}

test('wrong Runtime owner dataset is rejected for Spot and USD-M evidence', () => {
  for (const [product, source, row] of [
    ['SPOT', 'SPOT', spotRow('BTCUSDT')],
    ['USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT')],
  ]) {
    const metadata = parseMetadata(source, [row]);
    metadata[0].truth.authority.dataset = 'other.exchange_info';
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput(product, metadata)));
  }
});

test('wrong but internally consistent Runtime owner sourceId is rejected for Spot and USD-M evidence', () => {
  for (const [product, source, row] of [
    ['SPOT', 'SPOT', spotRow('BTCUSDT')],
    ['USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT')],
  ]) {
    const metadata = parseMetadata(source, [row]);
    const alternate = 'runtime-source:000000000000000000000000';
    metadata[0].truth.authority.sourceId = alternate;
    metadata[0].truth.provenance.sourceSet = [alternate];
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput(product, metadata)));
  }
});

for (const [name, source, product, row, mutate] of [
  ['negative onboardDateMs', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.onboardDateMs = -1; }],
  ['fractional deliveryDateMs', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.deliveryDateMs = 1.5; }],
  ['empty marginAsset', 'USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT'), (metadata) => { metadata.marginAsset = ''; }],
  ['non-string underlyingType', 'USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT'), (metadata) => { metadata.underlyingType = 42; }],
  ['negative precision', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.precisions.baseAssetPrecision = -1; }],
  ['unknown precision field', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.precisions.executionPrecision = 8; }],
]) {
  test(`coherently rebound invalid owner ${name} is rejected`, () => {
    const metadata = parseMetadata(source, [row]);
    mutate(metadata[0]);
    rebindOwnerIdentity(metadata[0]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput(product, metadata)));
  });
}

for (const [name, source, product, row, mutate] of [
  ['underlyingSubType', 'USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT'), (metadata) => { metadata.underlyingSubType = ['ZETA', 'ALPHA']; }],
  ['exclusionReasonCodes', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.exclusionReasonCodes = ['ZETA', 'ALPHA']; }],
  ['orderTypes', 'SPOT', 'SPOT', spotRow('BTCUSDT'), (metadata) => { metadata.orderTypes = ['MARKET', 'LIMIT']; }],
  ['timeInForce', 'USD_M_PERPETUAL', 'USD_M_PERPETUAL', usdMRow('BTCUSDT'), (metadata) => { metadata.timeInForce = ['IOC', 'GTC']; }],
]) {
  test(`coherently rebound unsorted owner ${name} array is rejected`, () => {
    const metadata = parseMetadata(source, [row]);
    mutate(metadata[0]);
    rebindOwnerIdentity(metadata[0]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput(product, metadata)));
  });
}

test('coherently rebound unsorted Runtime filter order is rejected', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  metadata[0].filters.reverse();
  rebindOwnerIdentity(metadata[0]);
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
});

for (const [name, permissionSets] of [
  ['inner permission order', [['SPOT', 'MARGIN']]],
  ['outer permission-set order', [['SPOT'], ['MARGIN']]],
  ['duplicate permission sets', [['SPOT'], ['SPOT']]],
]) {
  test(`coherently rebound unsorted owner ${name} is rejected`, () => {
    const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
    metadata[0].permissionSets = permissionSets;
    rebindOwnerIdentity(metadata[0]);
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
  });
}

test('unexpected metadata and top-level fields are rejected', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  metadata[0].unexpected = true;
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));
  const clean = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  assertRejected(normalizeRuntimeInstrumentRegistry({ ...registryInput('SPOT', clean), unexpected: true }));
});

test('empty, non-array, and overbound metadata collections fail closed', () => {
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', [])), 'METADATA_COUNT_INVALID');
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', {})), 'METADATA_COUNT_INVALID');
  assertRejected(
    normalizeRuntimeInstrumentRegistry(registryInput('SPOT', Array.from({ length: 10_001 }, () => ({})))),
    'METADATA_COUNT_INVALID',
  );
});

test('exact 10,000-metadata capacity crosses the count gate before semantic shape rejection', () => {
  const atBound = Array.from({ length: 10_000 }, () => ({}));
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', atBound)));
});

test('invalid evaluation and maximum-age bounds fail closed', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  for (const override of [
    { evaluatedAtMs: Number.NaN },
    { evaluatedAtMs: 1.5 },
    { maximumAgeMs: 0 },
    { maximumAgeMs: 300_001 },
  ]) assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata, override)));
});

test('accessors are rejected without invoking attacker-controlled getter code', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  let getterCalls = 0;
  const input = registryInput('SPOT', metadata);
  Object.defineProperty(input, 'matrixSha256', {
    configurable: true,
    enumerable: true,
    get() { getterCalls += 1; return L04_BINANCE_MATRIX_SHA256; },
  });
  assertRejected(normalizeRuntimeInstrumentRegistry(input));
  assert.equal(getterCalls, 0);
});

test('proxies are rejected without running proxy traps', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  let trapCalls = 0;
  const proxy = new Proxy(registryInput('SPOT', metadata), {
    ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  assertRejected(normalizeRuntimeInstrumentRegistry(proxy));
  assert.equal(trapCalls, 0);
});

test('symbol keys, non-plain prototypes, cycles, sparse arrays, and named array properties fail closed', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);

  const symbolKey = registryInput('SPOT', metadata);
  symbolKey[Symbol('hidden')] = true;
  assertRejected(normalizeRuntimeInstrumentRegistry(symbolKey));

  const nonPlain = Object.assign(Object.create({ inherited: true }), registryInput('SPOT', metadata));
  assertRejected(normalizeRuntimeInstrumentRegistry(nonPlain));

  const cyclic = registryInput('SPOT', metadata);
  cyclic.self = cyclic;
  assertRejected(normalizeRuntimeInstrumentRegistry(cyclic));

  const sparse = Array(2);
  sparse[0] = metadata[0];
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', sparse)));

  const named = [...metadata];
  named.named = true;
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', named)));

  for (const key of ['01', '4294967295']) {
    const digitLikeNamed = [...metadata];
    Object.defineProperty(digitLikeNamed, key, {
      configurable: true,
      enumerable: true,
      value: metadata[0],
      writable: true,
    });
    assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', digitLikeNamed)));
  }
});

test('non-finite numbers and bidi/control text fail closed', () => {
  const metadata = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  metadata[0].precisions.baseAssetPrecision = Number.POSITIVE_INFINITY;
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', metadata)));

  const bidi = parseMetadata('SPOT', [spotRow('BTCUSDT')]);
  bidi[0].symbol = `BTC\u202eUSDT`;
  assertRejected(normalizeRuntimeInstrumentRegistry(registryInput('SPOT', bidi)));
});
