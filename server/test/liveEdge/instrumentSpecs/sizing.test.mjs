import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';
import {
  BINANCE_FILTER_REFERENCE_SCHEMA,
  L04_BINANCE_MATRIX_SHA256,
  L04_EXCHANGE_INFO_CONTRACT_IDS,
  deriveFilterReferenceEvidenceRevision,
  deriveInstrumentEvidenceRevision,
  deriveInstrumentRevision,
  deriveRegistryRevision,
  deriveSnapshotRevision,
  normalizeRuntimeInstrumentRegistry,
  preflightInstrumentSizing,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';

const RECEIVED_AT_MS = 5_000;
const VALID_UNTIL_MS = 15_000;
const EVALUATED_AT_MS = 10_000;
const REFERENCE_VALID_UNTIL_MS = 14_000;
const CONFIG = Object.freeze({
  ...RUNTIME_UNIVERSE_DEFAULTS,
  configurationVersion: 'l04-sizing-test-v1',
  universePolicy: Object.freeze({ ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy }),
});
const SNAPSHOT_CACHE = new WeakMap();

function canonicalDecimal(value) {
  const [wholeInput, fractionInput = ''] = value.split('.');
  const whole = wholeInput.replace(/^0+(?=\d)/, '');
  const fraction = fractionInput.replace(/0+$/, '');
  if (/^0+$/.test(whole) && fraction.length === 0) return '0';
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function filter(filterType, values) {
  return Object.freeze({ filterType, ...values });
}

function priceFilter({ min = '0.01', max = '1000000', tick = '0.01' } = {}) {
  return filter('PRICE_FILTER', { minPrice: min, maxPrice: max, tickSize: tick });
}

function lotFilter({ min = '0.001', max = '1000', step = '0.001' } = {}) {
  return filter('LOT_SIZE', { minQty: min, maxQty: max, stepSize: step });
}

function marketLotFilter({ min = '0.01', max = '100', step = '0.01' } = {}) {
  return filter('MARKET_LOT_SIZE', { minQty: min, maxQty: max, stepSize: step });
}

function minimumNotional({ minimum = '0.001', applyToMarket = true, avgPriceMins = 5 } = {}) {
  return filter('MIN_NOTIONAL', {
    minNotional: minimum,
    applyToMarket,
    avgPriceMins,
  });
}

function usdmMinimumNotional(minimum = '0.001') {
  return filter('MIN_NOTIONAL', { notional: minimum });
}

function notionalFilter({
  minimum = '0.001', maximum = '1000000',
  applyMinToMarket = true, applyMaxToMarket = true,
  avgPriceMins = 5,
} = {}) {
  return filter('NOTIONAL', {
    minNotional: minimum,
    applyMinToMarket,
    maxNotional: maximum,
    applyMaxToMarket,
    avgPriceMins,
  });
}

function percentPrice({ down = '0.8', up = '1.2', usdm = false } = {}) {
  return filter('PERCENT_PRICE', usdm
    ? { multiplierUp: up, multiplierDown: down, multiplierDecimal: 4 }
    : { multiplierUp: up, multiplierDown: down, avgPriceMins: 5 });
}

function percentPriceBySide({
  bidDown = '0.8', bidUp = '1.2', askDown = '0.7', askUp = '1.3',
} = {}) {
  return filter('PERCENT_PRICE_BY_SIDE', {
    bidMultiplierUp: bidUp,
    bidMultiplierDown: bidDown,
    askMultiplierUp: askUp,
    askMultiplierDown: askDown,
    avgPriceMins: 5,
  });
}

function maxOrders(limit = 10) {
  return filter('MAX_NUM_ORDERS', { maxNumOrders: limit });
}

function instrument({
  product = 'SPOT',
  symbol = 'BTCUSDT',
  baseAsset = 'BTC',
  quoteAsset = 'USDT',
  status = 'TRADING',
  receivedAtMs = RECEIVED_AT_MS,
  validUntilMs = VALID_UNTIL_MS,
  filters = [priceFilter(), lotFilter(), minimumNotional()],
  advertisedOrderTypes = ['LIMIT', 'MARKET'],
  allowedTimeInForce = product === 'USD_M_PERPETUAL'
    ? ['FOK', 'GTC', 'GTD', 'GTX', 'IOC', 'RPI']
    : ['FOK', 'GTC', 'IOC'],
} = {}) {
  return {
    product,
    environment: 'PRODUCTION',
    symbol,
    baseAsset,
    quoteAsset,
    status,
    advertisedOrderTypes,
    allowedTimeInForce,
    filters,
    receivedAtMs,
    validUntilMs,
  };
}

function snapshot(fixture = instrument(), overrides = {}) {
  if (Object.keys(overrides).length === 0) {
    const cached = SNAPSHOT_CACHE.get(fixture);
    if (cached !== undefined) return cached;
  }
  const usdm = fixture.product === 'USD_M_PERPETUAL';
  const source = usdm ? 'USD_M_PERPETUAL' : 'SPOT';
  const row = usdm
    ? {
      symbol: fixture.symbol,
      pair: fixture.symbol,
      contractType: 'PERPETUAL',
      deliveryDate: 4_133_404_800_000,
      onboardDate: 0,
      status: fixture.status,
      baseAsset: fixture.baseAsset,
      quoteAsset: fixture.quoteAsset,
      marginAsset: fixture.quoteAsset,
      pricePrecision: 8,
      quantityPrecision: 8,
      baseAssetPrecision: 8,
      quotePrecision: 8,
      underlyingType: 'COIN',
      underlyingSubType: [],
      orderTypes: fixture.advertisedOrderTypes,
      timeInForce: fixture.allowedTimeInForce,
      filters: fixture.filters,
    }
    : {
      symbol: fixture.symbol,
      status: fixture.status,
      baseAsset: fixture.baseAsset,
      baseAssetPrecision: 8,
      quoteAsset: fixture.quoteAsset,
      quotePrecision: 8,
      quoteAssetPrecision: 8,
      baseCommissionPrecision: 8,
      quoteCommissionPrecision: 8,
      orderTypes: fixture.advertisedOrderTypes,
      isSpotTradingAllowed: true,
      isMarginTradingAllowed: fixture.product === 'MARGIN',
      permissionSets: fixture.product === 'MARGIN' ? [['MARGIN']] : [['SPOT']],
      filters: fixture.filters,
    };
  const parsed = parseExchangeInformation(
    { timezone: 'UTC', serverTime: fixture.receivedAtMs - 1, exchangeFilters: [], symbols: [row] },
    {
      source,
      sourceId: RUNTIME_UNIVERSE_SOURCE_IDS[source],
      dataset: source === 'SPOT' ? 'spot.exchange_info' : 'usd_m.exchange_info',
      receivedTimeMs: fixture.receivedAtMs,
      evaluatedAtMs: fixture.receivedAtMs,
      config: CONFIG,
    },
  );
  assert.equal(parsed.listings.length, 1, 'sizing fixture must remain parseable owner evidence');
  const normalized = normalizeRuntimeInstrumentRegistry({
    matrixSha256: L04_BINANCE_MATRIX_SHA256,
    contractId: L04_EXCHANGE_INFO_CONTRACT_IDS[fixture.product],
    product: fixture.product,
    environment: 'PRODUCTION',
    evaluatedAtMs: overrides.evaluatedAtMs ?? EVALUATED_AT_MS,
    maximumAgeMs: fixture.validUntilMs - fixture.receivedAtMs,
    metadata: [parsed.listings[0].metadata],
  });
  assert.equal(normalized.ok, true, normalized.reasonCodes?.join(','));
  if (Object.keys(overrides).length === 0) SNAPSHOT_CACHE.set(fixture, normalized.snapshot);
  return normalized.snapshot;
}

function windowRequirement(avgPriceMins) {
  return avgPriceMins === 0
    ? { kind: 'LAST_PRICE', averagingWindowMins: 0 }
    : { kind: 'WEIGHTED_AVERAGE', averagingWindowMins: avgPriceMins };
}

function expectedReferenceRequirement(registry, orderType) {
  const spec = registry.instruments[0];
  if (orderType === 'MARKET' && spec.product === 'USD_M_PERPETUAL') {
    return { kind: 'MARK_PRICE', averagingWindowMins: null };
  }
  const requirements = [];
  if (orderType === 'MARKET') {
    for (const candidate of spec.filters) {
      if (candidate.filterType === 'MIN_NOTIONAL' && candidate.values.applyToMarket === true) {
        requirements.push(windowRequirement(candidate.values.avgPriceMins));
      }
      if (candidate.filterType === 'NOTIONAL'
        && (candidate.values.applyMinToMarket === true || candidate.values.applyMaxToMarket === true)) {
        requirements.push(windowRequirement(candidate.values.avgPriceMins));
      }
    }
    if (requirements.length === 0) requirements.push(windowRequirement(0));
  } else {
    for (const candidate of spec.filters) {
      if (candidate.filterType !== 'PERCENT_PRICE'
        && candidate.filterType !== 'PERCENT_PRICE_BY_SIDE') continue;
      requirements.push(spec.product === 'USD_M_PERPETUAL'
        ? { kind: 'MARK_PRICE', averagingWindowMins: null }
        : windowRequirement(candidate.values.avgPriceMins));
    }
  }
  if (requirements.length === 0) return null;
  const first = requirements[0];
  assert.ok(requirements.every((entry) => entry.kind === first.kind
    && entry.averagingWindowMins === first.averagingWindowMins),
  'fixture reference requirements must not conflict');
  return first;
}

function referenceEvidence(registry, {
  price = '1',
  kind = 'MARK_PRICE',
  averagingWindowMins = null,
  observedAtMs = EVALUATED_AT_MS - 1,
  validUntilMs = REFERENCE_VALID_UNTIL_MS,
  sourceTruthId = 'runtime-filter-reference:test-v1',
  producer = 'INTELLIGENCE_RUNTIME',
  product = registry.instruments[0].product,
  symbol = registry.instruments[0].symbol,
  instrumentRevision = registry.instruments[0].instrumentRevision,
  documentaryAuthority = 'DOCUMENTARY_EVIDENCE_ONLY',
  externalActionAuthorization = 'NONE',
  actionAuthority = 'NONE_RECORD_ONLY',
  evidenceRevision,
} = {}) {
  const projection = {
    schema: BINANCE_FILTER_REFERENCE_SCHEMA,
    producer,
    product,
    symbol,
    instrumentRevision,
    kind,
    averagingWindowMins,
    price: canonicalDecimal(price),
    observedAtMs,
    validUntilMs,
    sourceTruthId,
    documentaryAuthority,
    externalActionAuthorization,
    actionAuthority,
  };
  return {
    ...projection,
    evidenceRevision: evidenceRevision ?? deriveFilterReferenceEvidenceRevision(projection),
  };
}

function freezeDeep(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) freezeDeep(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function coherentlyMutateSnapshot(registry, mutate) {
  const cloned = structuredClone(registry);
  mutate(cloned, cloned.instruments[0]);
  for (const entry of cloned.instruments) {
    entry.instrumentRevision = deriveInstrumentRevision(cloned.matrixSha256, entry);
    entry.sourceEvidenceRevision = deriveInstrumentEvidenceRevision(entry);
  }
  cloned.registryRevision = deriveRegistryRevision(cloned);
  cloned.snapshotRevision = deriveSnapshotRevision(cloned);
  return freezeDeep(cloned);
}

function request(registry, overrides = {}) {
  const spec = registry.instruments[0];
  const output = {
    symbol: spec.symbol,
    instrumentRevision: spec.instrumentRevision,
    side: 'BUY',
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    requestedPrice: '1',
    referencePrice: null,
    requestedQuantity: '1',
    notionalAsset: 'USDT',
    approvedNotional: '100',
    intendedExposure: '100',
    evaluatedAtMs: EVALUATED_AT_MS,
    ...overrides,
  };
  if (typeof output.referencePrice === 'string') {
    const requirement = expectedReferenceRequirement(registry, output.orderType);
    assert.notEqual(requirement, null, 'a raw fixture reference price must have a filter requirement');
    output.referencePrice = referenceEvidence(registry, {
      ...requirement,
      price: output.referencePrice,
      observedAtMs: Math.max(0, output.evaluatedAtMs - 1),
      validUntilMs: output.evaluatedAtMs + 4_000,
    });
  }
  return output;
}

function run(spec, overrides = {}, snapshotOverrides = {}) {
  const registry = snapshot(spec, snapshotOverrides);
  return preflightInstrumentSizing(registry, request(registry, overrides));
}

function assertBlocked(result, ...reasonCodes) {
  assert.equal(result.staticState, 'BLOCKED');
  for (const reasonCode of reasonCodes) {
    assert.ok(result.reasonCodes.includes(reasonCode), `${reasonCode} absent from ${result.reasonCodes.join(',')}`);
  }
  assert.equal(result.sendEligible, false);
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(result.actionAuthority, 'NONE_RECORD_ONLY');
}

function assertPass(result) {
  assert.equal(result.staticState, 'PASS', result.reasonCodes.join(','));
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.sendEligible, false);
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(result.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(result.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.match(result.sourceEvidenceRevision, /^l04-instrument-source-evidence:/);
  assert.match(result.registryRevision, /^l04-instrument-registry:/);
  assert.match(result.snapshotRevision, /^l04-instrument-registry-snapshot:/);
  assert.equal(result.notionalAsset, 'USDT');
  assert.equal(typeof result.evaluatedAtMs, 'number');
  assert.equal(typeof result.instrumentValidUntilMs, 'number');
  assert.ok(result.evaluatedAtMs <= result.instrumentValidUntilMs);
  if (result.referenceEvidenceRevision === null) {
    assert.equal(result.referenceObservedAtMs, null);
    assert.equal(result.referenceValidUntilMs, null);
  } else {
    assert.equal(typeof result.referenceObservedAtMs, 'number');
    assert.equal(typeof result.referenceValidUntilMs, 'number');
    assert.ok(result.referenceObservedAtMs <= result.referenceValidUntilMs);
    assert.ok(result.evaluatedAtMs >= result.referenceObservedAtMs - 2_000);
    assert.ok(result.evaluatedAtMs <= result.referenceValidUntilMs);
    assert.ok(result.referenceValidUntilMs - result.referenceObservedAtMs <= 5_000);
  }
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function parseDecimal(value) {
  const [whole, fraction = ''] = value.split('.');
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function compareDecimals(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * (10n ** BigInt(scale - a.scale));
  const bv = b.coefficient * (10n ** BigInt(scale - b.scale));
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function formatDecimal(coefficient, scale) {
  if (coefficient === 0n) return '0';
  let digits = coefficient.toString().padStart(scale + 1, '0');
  if (scale > 0) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return canonicalDecimal(digits);
}

function multiplyDecimals(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  return formatDecimal(a.coefficient * b.coefficient, a.scale + b.scale);
}

function fromHundredths(value) {
  return formatDecimal(BigInt(value), 2);
}

test('LIMIT prices pass exact boundaries and price is never auto-adjusted', () => {
  const spec = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [
      priceFilter({ min: '0.05', max: '1', tick: '0.01' }),
      lotFilter({ min: '0.01', max: '100', step: '0.01' }),
      usdmMinimumNotional(),
    ],
  });
  for (const price of ['0.05', '0.06', '1']) {
    const result = run(spec, { requestedPrice: price, requestedQuantity: '1' });
    assertPass(result);
    assert.equal(result.requestedPrice, canonicalDecimal(price));
    assert.equal(result.validationPrice, canonicalDecimal(price));
    assert.ok(result.transformations.every((entry) => !('price' in entry)));
  }
  assertBlocked(run(spec, { requestedPrice: '0.049' }), 'PRICE_BELOW_MINIMUM');
  assertBlocked(run(spec, { requestedPrice: '1.01' }), 'PRICE_ABOVE_MAXIMUM');
  const offTick = run(spec, { requestedPrice: '0.055' });
  assertBlocked(offTick, 'PRICE_TICK_MISALIGNED');
  assert.equal(offTick.requestedPrice, '0.055');
  assert.equal(offTick.resultQuantity, null);
  assert.deepEqual(offTick.transformations, []);
});

test('zero PRICE_FILTER minimum and maximum independently disable only those bounds', () => {
  const spec = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [
      priceFilter({ min: '0', max: '0', tick: '0.01' }),
      lotFilter(),
      usdmMinimumNotional(),
    ],
  });
  const result = run(spec, { requestedPrice: '1000.12', requestedQuantity: '0.001' });
  assertPass(result);
  assert.equal(result.requestedPrice, '1000.12');
  assert.equal(result.resultQuantity, '0.001');
  assert.equal(result.resultNotional, '1.00012');
});

test('the fixed USDT canary rejects genuine non-USDT Spot and USD-M instruments', () => {
  const fixtures = [
    instrument({
      product: 'SPOT', symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC',
    }),
    instrument({
      product: 'USD_M_PERPETUAL', symbol: 'ETHUSDC', baseAsset: 'ETH', quoteAsset: 'USDC',
      filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
    }),
  ];
  for (const fixture of fixtures) {
    const registry = snapshot(fixture);
    assert.equal(registry.instruments[0].quoteAsset, fixture.quoteAsset);
    const result = preflightInstrumentSizing(registry, request(registry));
    assertBlocked(result, 'CANARY_QUOTE_ASSET_NOT_USDT');
    assert.equal(result.notionalAsset, null);
    assert.equal(result.evaluatedAtMs, EVALUATED_AT_MS);
    assert.equal(result.instrumentValidUntilMs, VALID_UNTIL_MS);
  }
});

test('every request binds the canary arithmetic to an exact USDT notional asset', () => {
  const registry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  }));
  const valid = request(registry);
  const accepted = preflightInstrumentSizing(registry, valid);
  assertPass(accepted);
  assert.equal(accepted.notionalAsset, 'USDT');
  assert.equal(accepted.sourceEvidenceRevision, registry.instruments[0].sourceEvidenceRevision);
  assert.equal(accepted.registryRevision, registry.registryRevision);
  assert.equal(accepted.snapshotRevision, registry.snapshotRevision);

  const missing = { ...valid };
  delete missing.notionalAsset;
  assertBlocked(preflightInstrumentSizing(registry, missing), 'STATIC_PREFLIGHT_INPUT_REJECTED');
  for (const notionalAsset of ['BTC', 'USDC', '', null, 0]) {
    const result = preflightInstrumentSizing(registry, { ...valid, notionalAsset });
    assertBlocked(result, 'NOTIONAL_ASSET_NOT_USDT');
    assert.equal(result.notionalAsset, null);
  }
});

test('quantity boundaries are exact and every automatic transformation only reduces size', () => {
  const spec = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter({ min: '0.1', max: '2', step: '0.1' }), usdmMinimumNotional()],
  });
  for (const quantity of ['0.1', '2']) {
    const result = run(spec, { requestedQuantity: quantity });
    assertPass(result);
    assert.equal(result.resultQuantity, quantity);
  }

  const capped = run(spec, { requestedQuantity: '2.09' });
  assertPass(capped);
  assert.equal(capped.resultQuantity, '2');
  assert.deepEqual(capped.transformations, [{
    kind: 'MAX_QUANTITY_REDUCTION', from: '2.09', to: '2', filterType: 'LOT_SIZE',
  }]);

  const floored = run(spec, { requestedQuantity: '0.19' });
  assertPass(floored);
  assert.equal(floored.resultQuantity, '0.1');
  assert.deepEqual(floored.transformations, [{
    kind: 'GRID_REDUCTION', from: '0.19', to: '0.1', filterType: 'LOT_SIZE',
  }]);

  const below = run(spec, { requestedQuantity: '0.09' });
  assertBlocked(below, 'QUANTITY_BELOW_GRID_ORIGIN');
  assert.equal(below.requestedQuantity, '0.09');
  assert.equal(below.resultQuantity, '0.09');
  assert.ok(compareDecimals(below.resultQuantity, below.requestedQuantity) <= 0);
});

test('MARKET orders intersect LOT_SIZE and MARKET_LOT_SIZE without silently using LIMIT rules only', () => {
  const spec = instrument({
    filters: [
      priceFilter(),
      lotFilter({ min: '0.001', max: '100', step: '0.001' }),
      marketLotFilter({ min: '0.01', max: '1.5', step: '0.01' }),
      minimumNotional(),
    ],
  });
  const market = (quantity) => run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '1', requestedQuantity: quantity,
  });

  const floored = market('1.257');
  assertPass(floored);
  assert.match(floored.referenceEvidenceRevision, /^l04-filter-reference:/);
  assert.equal(floored.resultQuantity, '1.25');
  assert.ok(floored.transformations.some((entry) => entry.filterType === 'MARKET_LOT_SIZE'));

  const capped = market('2');
  assertPass(capped);
  assert.equal(capped.resultQuantity, '1.5');
  assert.ok(capped.transformations.some((entry) => entry.kind === 'MAX_QUANTITY_REDUCTION'
    && entry.filterType === 'MARKET_LOT_SIZE'));

  const limit = run(spec, { requestedQuantity: '2' });
  assertBlocked(limit, 'TIME_IN_FORCE_NOT_ADVERTISED');
  assert.ok(limit.externalRequirements.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));

  assertBlocked(marketLotMissingReference(spec), 'FILTER_REFERENCE_EVIDENCE_REQUIRED');
  assertBlocked(run(spec, {
    orderType: 'MARKET', timeInForce: 'GTC', requestedPrice: null, referencePrice: '1',
  }), 'MARKET_TIME_IN_FORCE_MUST_BE_NULL');
  assertBlocked(run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: '1', referencePrice: '1',
  }), 'MARKET_REQUESTED_PRICE_MUST_BE_NULL');
});

function marketLotMissingReference(spec) {
  return run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null, referencePrice: null,
  });
}

test('incompatible LOT_SIZE and MARKET_LOT_SIZE grids fail closed after sequential reductions', () => {
  const spec = instrument({
    filters: [
      priceFilter(),
      lotFilter({ min: '0', max: '100', step: '0.03' }),
      marketLotFilter({ min: '0', max: '100', step: '0.05' }),
      minimumNotional(),
    ],
  });
  const result = run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '1', requestedQuantity: '1',
  });
  assertBlocked(result, 'FILTER_GRID_INTERSECTION_UNRESOLVED', 'LOT_SIZE_GRID_MISALIGNED');
  assert.equal(result.resultQuantity, '0.95');
  assert.ok(compareDecimals(result.resultQuantity, result.requestedQuantity) < 0);
});

test('effective notional is the exact minimum of approved, intended, official, and fixed canary ceilings', () => {
  const cases = [
    { approved: '7.23', intended: '99', official: '100', expected: '7.23' },
    { approved: '99', intended: '6.67', official: '100', expected: '6.67' },
    { approved: '99', intended: '99', official: '5.55', expected: '5.55' },
    { approved: '99', intended: '99', official: '100', expected: '10' },
  ];
  for (const fixture of cases) {
    const spec = instrument({
      filters: [
        priceFilter(),
        lotFilter({ min: '0.01', max: '100', step: '0.01' }),
        notionalFilter({ maximum: fixture.official }),
      ],
    });
    const result = run(spec, {
      orderType: 'MARKET', timeInForce: null, requestedPrice: null,
      referencePrice: '1', requestedQuantity: '20',
      approvedNotional: fixture.approved, intendedExposure: fixture.intended,
    });
    assertPass(result);
    assert.match(result.referenceEvidenceRevision, /^l04-filter-reference:/);
    assert.equal(result.effectiveNotionalCeiling, fixture.expected);
    assert.equal(result.resultQuantity, fixture.expected);
    assert.equal(result.resultNotional, fixture.expected);
    assert.ok(result.transformations.some((entry) => entry.kind === 'NOTIONAL_CEILING_REDUCTION'));
  }
});

test('notional division rounds quantity down to the grid and rechecks exact post-grid notional', () => {
  const passSpec = instrument({
    filters: [
      priceFilter(),
      lotFilter({ min: '0.01', max: '100', step: '0.01' }),
      minimumNotional({ minimum: '0.01' }),
    ],
  });
  const pass = run(passSpec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '3', requestedQuantity: '20', approvedNotional: '10', intendedExposure: '20',
  });
  assertPass(pass);
  assert.match(pass.referenceEvidenceRevision, /^l04-filter-reference:/);
  assert.equal(pass.effectiveNotionalCeiling, '10');
  assert.equal(pass.resultQuantity, '3.33');
  assert.equal(pass.resultNotional, '9.99');
  assert.deepEqual(pass.transformations.map((entry) => entry.kind), [
    'NOTIONAL_CEILING_REDUCTION', 'GRID_REDUCTION',
  ]);

  const blockedSpec = instrument({
    filters: [
      priceFilter(),
      lotFilter({ min: '0.01', max: '100', step: '0.01' }),
      minimumNotional({ minimum: '10' }),
    ],
  });
  const blocked = run(blockedSpec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '3', requestedQuantity: '20', approvedNotional: '10', intendedExposure: '20',
  });
  assertBlocked(blocked, 'MIN_NOTIONAL_BELOW_MINIMUM');
  assert.equal(blocked.resultQuantity, '3.33');
  assert.equal(blocked.resultNotional, '9.99');
  assert.ok(compareDecimals(blocked.resultNotional, blocked.effectiveNotionalCeiling) <= 0);
});

test('a minimum quantity or notional conflict blocks instead of increasing quantity or capital', () => {
  const spec = instrument({
    filters: [
      priceFilter(),
      lotFilter({ min: '0.1', max: '100', step: '0.1' }),
      minimumNotional({ minimum: '10.1' }),
    ],
  });
  const result = run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '10', requestedQuantity: '1.05',
    approvedNotional: '10', intendedExposure: '10',
  });
  assertBlocked(result, 'MIN_NOTIONAL_BELOW_MINIMUM');
  assert.equal(result.requestedQuantity, '1.05');
  assert.equal(result.resultQuantity, '1');
  assert.equal(result.resultNotional, '10');
  assert.ok(compareDecimals(result.resultQuantity, result.requestedQuantity) <= 0);
  assert.ok(compareDecimals(result.resultNotional, '10') <= 0);
});

test('Spot market applicability flags are honored while unavailable LIMIT TIF stays blocked', () => {
  const spec = instrument({
    filters: [
      priceFilter(), lotFilter(), marketLotFilter(),
      minimumNotional({ minimum: '5', applyToMarket: false }),
      notionalFilter({
        minimum: '6', maximum: '7', applyMinToMarket: false, applyMaxToMarket: false,
      }),
    ],
  });
  const market = run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '1', requestedQuantity: '20', approvedNotional: '100', intendedExposure: '100',
  });
  assertPass(market);
  assert.match(market.referenceEvidenceRevision, /^l04-filter-reference:/);
  assert.equal(market.effectiveNotionalCeiling, '10');
  assert.equal(market.resultNotional, '10');

  const limit = run(spec, {
    requestedPrice: '1', requestedQuantity: '20', approvedNotional: '100', intendedExposure: '100',
  });
  assertBlocked(limit, 'TIME_IN_FORCE_NOT_ADVERTISED');
  assert.ok(limit.externalRequirements.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));

  const applied = instrument({
    filters: [
      priceFilter(), lotFilter(), marketLotFilter(),
      minimumNotional({ minimum: '5', applyToMarket: true }),
      notionalFilter({
        minimum: '6', maximum: '7', applyMinToMarket: true, applyMaxToMarket: true,
      }),
    ],
  });
  const smallMarket = run(applied, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '1', requestedQuantity: '4',
  });
  assertBlocked(smallMarket, 'MIN_NOTIONAL_BELOW_MINIMUM', 'NOTIONAL_BELOW_MINIMUM');
});

test('Spot quantity grids use zero origin while USD-M grids use the documented minimum origin', () => {
  const commonLot = lotFilter({ min: '0.15', max: '10', step: '0.1' });
  const spot = instrument({
    filters: [priceFilter({ min: '0.05', max: '10', tick: '0.1' }), commonLot, minimumNotional()],
  });
  const spotResult = run(spot, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '0.1', requestedQuantity: '0.2',
  });
  assertPass(spotResult);
  assert.match(spotResult.referenceEvidenceRevision, /^l04-filter-reference:/);
  assert.equal(spotResult.resultQuantity, '0.2');

  const usdm = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter({ min: '0.05', max: '10', tick: '0.1' }), commonLot, usdmMinimumNotional()],
  });
  assertBlocked(run(usdm, { requestedPrice: '0.1', requestedQuantity: '0.2' }), 'PRICE_TICK_MISALIGNED');
  const usdmResult = run(usdm, { requestedPrice: '0.15', requestedQuantity: '0.2' });
  assertPass(usdmResult);
  assert.equal(usdmResult.resultQuantity, '0.15');
  assert.deepEqual(usdmResult.transformations, [{
    kind: 'GRID_REDUCTION', from: '0.2', to: '0.15', filterType: 'LOT_SIZE',
  }]);
});

test('Spot percent filters cannot bypass missing canonical symbol time-in-force truth', () => {
  const spec = instrument({
    filters: [
      priceFilter({ min: '0', max: '0', tick: '0.01' }), lotFilter(), minimumNotional(),
      percentPrice({ down: '0.9', up: '1.1' }),
    ],
  });
  for (const price of ['90', '100', '110']) {
    const result = run(spec, { requestedPrice: price, referencePrice: '100', requestedQuantity: '0.1' });
    assertBlocked(result, 'TIME_IN_FORCE_NOT_ADVERTISED');
    assert.ok(result.externalRequirements.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));
  }

  const bySide = instrument({
    filters: [
      priceFilter({ min: '0', max: '0', tick: '0.01' }), lotFilter(), minimumNotional(),
      percentPriceBySide(),
    ],
  });
  for (const side of ['BUY', 'SELL']) {
    const result = run(bySide, { side, requestedPrice: '100', referencePrice: '100' });
    assertBlocked(result, 'TIME_IN_FORCE_NOT_ADVERTISED');
    assert.ok(result.externalRequirements.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));
  }
});

test('USD-M percent filter uses the exact side-specific mark-price rule', () => {
  const spec = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [
      priceFilter({ min: '0', max: '0', tick: '0.01' }),
      lotFilter(), usdmMinimumNotional(), percentPrice({ down: '0.8', up: '1.2', usdm: true }),
    ],
  });
  assertPass(run(spec, { side: 'BUY', requestedPrice: '120', referencePrice: '100' }));
  assertBlocked(run(spec, { side: 'BUY', requestedPrice: '120.01', referencePrice: '100' }), 'PRICE_ABOVE_PERCENT_BOUND');
  assertPass(run(spec, { side: 'BUY', requestedPrice: '1', referencePrice: '100' }));
  assertPass(run(spec, { side: 'SELL', requestedPrice: '80', referencePrice: '100' }));
  assertBlocked(run(spec, { side: 'SELL', requestedPrice: '79.99', referencePrice: '100' }), 'PRICE_BELOW_PERCENT_BOUND');
  assertPass(run(spec, { side: 'SELL', requestedPrice: '1000', referencePrice: '100' }));
});

test('reference evidence is closed, revision-bound, fresh, and exact before any market arithmetic', () => {
  const fixture = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), marketLotFilter(), usdmMinimumNotional()],
  });
  const registry = snapshot(fixture);
  const validEvidence = referenceEvidence(registry, {
    kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5000',
  });
  const base = request(registry, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: validEvidence, requestedQuantity: '1',
  });

  const accepted = preflightInstrumentSizing(registry, base);
  assertPass(accepted);
  assert.equal(accepted.validationPrice, '2.5');
  assert.equal(accepted.referenceEvidenceRevision, validEvidence.evidenceRevision);
  assert.match(accepted.referenceEvidenceRevision, /^l04-filter-reference:/);
  assertDeeplyFrozen(accepted);

  const exactMaximumValidity = referenceEvidence(registry, {
    kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5',
    observedAtMs: 9_000, validUntilMs: 14_000,
  });
  const exactMaximumResult = preflightInstrumentSizing(registry, {
    ...base, referencePrice: exactMaximumValidity,
  });
  assertPass(exactMaximumResult);
  assert.equal(exactMaximumResult.referenceObservedAtMs, 9_000);
  assert.equal(exactMaximumResult.referenceValidUntilMs, 14_000);
  assert.equal(exactMaximumResult.referenceEvidenceRevision, exactMaximumValidity.evidenceRevision);

  const overMaximumValidity = referenceEvidence(registry, {
    kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5',
    observedAtMs: 8_999, validUntilMs: 14_000,
  });
  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: overMaximumValidity }),
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
  );

  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: null }),
    'FILTER_REFERENCE_EVIDENCE_REQUIRED',
  );
  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: '2.5' }),
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
  );

  for (const [label, evidence] of [
    ['stale', referenceEvidence(registry, {
      kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5',
      observedAtMs: EVALUATED_AT_MS - 100, validUntilMs: EVALUATED_AT_MS - 1,
    })],
    ['future', referenceEvidence(registry, {
      kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5',
      observedAtMs: EVALUATED_AT_MS + 2_001, validUntilMs: EVALUATED_AT_MS + 3_000,
    })],
    ['wrong instrument revision', referenceEvidence(registry, {
      kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5',
      instrumentRevision: 'l04-instrument-spec:wrong-revision',
    })],
    ['wrong product', referenceEvidence(registry, {
      kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5', product: 'SPOT',
    })],
    ['wrong symbol', referenceEvidence(registry, {
      kind: 'MARK_PRICE', averagingWindowMins: null, price: '2.5', symbol: 'ETHUSDT',
    })],
  ]) {
    const result = preflightInstrumentSizing(registry, { ...base, referencePrice: evidence });
    assertBlocked(result, 'FILTER_REFERENCE_EVIDENCE_REJECTED');
    assert.equal(result.referenceEvidenceRevision, null, label);
  }

  for (const evidence of [
    referenceEvidence(registry, {
      kind: 'WEIGHTED_AVERAGE', averagingWindowMins: 5, price: '2.5',
    }),
    referenceEvidence(registry, {
      kind: 'LAST_PRICE', averagingWindowMins: 0, price: '2.5',
    }),
  ]) {
    assertBlocked(
      preflightInstrumentSizing(registry, { ...base, referencePrice: evidence }),
      'FILTER_REFERENCE_KIND_OR_WINDOW_MISMATCH',
    );
  }

  const invalidMarkWindow = referenceEvidence(registry, {
    kind: 'MARK_PRICE', averagingWindowMins: 1, price: '2.5',
  });
  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: invalidMarkWindow }),
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
  );

  const tampered = { ...validEvidence, price: '2.6' };
  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: tampered }),
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
  );
  const extra = { ...validEvidence, untrusted: true };
  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: extra }),
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
  );

  let getterCalls = 0;
  const accessor = { ...validEvidence };
  Object.defineProperty(accessor, 'price', {
    enumerable: true,
    get() { getterCalls += 1; return '2.5'; },
  });
  assertBlocked(
    preflightInstrumentSizing(registry, { ...base, referencePrice: accessor }),
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
  );
  assert.equal(getterCalls, 0);
});

test('oversized request and reference decimals reject before exact arithmetic', () => {
  const registry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), marketLotFilter(), usdmMinimumNotional()],
  }));
  const limitRequest = request(registry);
  const oversizedDecimals = [
    '1'.repeat(97),
    `0.${'1'.repeat(96)}`,
    '9'.repeat(8_193),
  ];
  for (const field of [
    'requestedPrice', 'requestedQuantity', 'approvedNotional', 'intendedExposure',
  ]) {
    for (const value of oversizedDecimals) {
      const result = preflightInstrumentSizing(registry, { ...limitRequest, [field]: value });
      assertBlocked(result, 'STATIC_PREFLIGHT_INPUT_REJECTED');
    }
  }

  const validReference = referenceEvidence(registry, {
    kind: 'MARK_PRICE', averagingWindowMins: null, price: '1',
  });
  const marketRequest = request(registry, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: validReference,
  });
  for (const price of oversizedDecimals) {
    const result = preflightInstrumentSizing(registry, {
      ...marketRequest,
      referencePrice: { ...validReference, price },
    });
    assertBlocked(result, 'FILTER_REFERENCE_EVIDENCE_REJECTED');
  }
});

test('Spot market reference kind and averaging window come only from current normalized filters', () => {
  const lastFixture = instrument({
    filters: [priceFilter(), lotFilter(), minimumNotional({ avgPriceMins: 0 })],
  });
  const lastRegistry = snapshot(lastFixture);
  const lastRequest = request(lastRegistry, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '2', requestedQuantity: '1',
  });
  assert.equal(lastRequest.referencePrice.kind, 'LAST_PRICE');
  assert.equal(lastRequest.referencePrice.averagingWindowMins, 0);
  const lastResult = preflightInstrumentSizing(lastRegistry, lastRequest);
  assertPass(lastResult);
  assert.equal(lastResult.referenceEvidenceRevision, lastRequest.referencePrice.evidenceRevision);

  const weightedFixture = instrument({
    filters: [priceFilter(), lotFilter(), minimumNotional({ avgPriceMins: 7 })],
  });
  const weightedRegistry = snapshot(weightedFixture);
  const weightedRequest = request(weightedRegistry, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: '2', requestedQuantity: '1',
  });
  assert.equal(weightedRequest.referencePrice.kind, 'WEIGHTED_AVERAGE');
  assert.equal(weightedRequest.referencePrice.averagingWindowMins, 7);
  const weightedResult = preflightInstrumentSizing(weightedRegistry, weightedRequest);
  assertPass(weightedResult);
  assert.equal(weightedResult.referenceEvidenceRevision, weightedRequest.referencePrice.evidenceRevision);

  const wrongWindow = referenceEvidence(weightedRegistry, {
    kind: 'WEIGHTED_AVERAGE', averagingWindowMins: 5, price: '2',
  });
  assertBlocked(
    preflightInstrumentSizing(weightedRegistry, { ...weightedRequest, referencePrice: wrongWindow }),
    'FILTER_REFERENCE_KIND_OR_WINDOW_MISMATCH',
  );

  const conflictingFixture = instrument({
    filters: [
      priceFilter(), lotFilter(),
      minimumNotional({ avgPriceMins: 5 }),
      notionalFilter({ avgPriceMins: 3 }),
    ],
  });
  const conflictingRegistry = snapshot(conflictingFixture);
  const conflict = preflightInstrumentSizing(conflictingRegistry, request(conflictingRegistry, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null,
    referencePrice: null, requestedQuantity: '1',
  }));
  assertBlocked(conflict, 'FILTER_REFERENCE_REQUIREMENTS_CONFLICT');
});

test('revision, source freshness, status, and Margin owner truth all fail closed at exact boundaries', () => {
  const base = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  });
  assertBlocked(run(base, { instrumentRevision: 'stale-revision' }), 'INSTRUMENT_REVISION_MISMATCH');
  assertPass(run(base, { evaluatedAtMs: VALID_UNTIL_MS }));
  assertBlocked(run(base, { evaluatedAtMs: VALID_UNTIL_MS + 1 }), 'SOURCE_STALE');
  assertPass(run(base, { evaluatedAtMs: RECEIVED_AT_MS - 2_000 }));
  assertBlocked(run(base, { evaluatedAtMs: RECEIVED_AT_MS - 2_001 }), 'SOURCE_CLOCK_SKEWED');

  const halted = instrument({
    product: 'USD_M_PERPETUAL', status: 'HALT',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  });
  assertBlocked(run(halted), 'SYMBOL_NOT_TRADING', 'BLOCKED_SOURCE');

  const margin = instrument({
    product: 'MARGIN',
  });
  const marginResult = run(margin);
  assertBlocked(marginResult, 'BLOCKED_OWNER_TRUTH');
  assert.ok(marginResult.externalRequirements.includes('MARGIN_PAIR_ELIGIBILITY_JOIN_UNAVAILABLE'));
  assert.ok(marginResult.externalRequirements.includes('MARGIN_RESTRICTIONS_UNAVAILABLE'));
});

test('static PASS retains named owner gaps and can never become send-eligible', () => {
  const spec = instrument({
    filters: [priceFilter(), lotFilter(), minimumNotional(), maxOrders(25)],
    lossCodes: [
      'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
      'MAX_ASSET_PRIVATE_FILTER_UNAVAILABLE',
      'TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE',
    ],
  });
  const result = run(spec);
  assertBlocked(result, 'TIME_IN_FORCE_NOT_ADVERTISED');
  const marketResult = run(spec, {
    orderType: 'MARKET', timeInForce: null, requestedPrice: null, referencePrice: '1',
  });
  assertPass(marketResult);
  assert.match(marketResult.referenceEvidenceRevision, /^l04-filter-reference:/);
  for (const requirement of [
    'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
    'MAX_ASSET_PRIVATE_FILTER_UNAVAILABLE',
    'MAX_NUM_ORDERS_PRIVATE_OWNER_TRUTH_REQUIRED',
    'SPOT_TIME_IN_FORCE_UNAVAILABLE',
    'TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE',
  ]) assert.ok(marketResult.externalRequirements.includes(requirement));
  assert.equal(marketResult.canaryMaximumNotional, '10');
  assertDeeplyFrozen(marketResult);
  assert.throws(() => { marketResult.sendEligible = true; }, TypeError);
  assert.throws(() => { marketResult.transformations.push({}); }, TypeError);
});

test('coherently rederived blocked filter and Spot permission postures remain non-actionable', () => {
  const usdRegistry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  }));
  const blockedFilterSnapshot = coherentlyMutateSnapshot(usdRegistry, (_snapshot, spec) => {
    const candidate = spec.filters.find((entry) => entry.filterType === 'PRICE_FILTER');
    candidate.state = 'BLOCKED_MALFORMED';
    candidate.reasonCodes = ['MALFORMED_FILTER_PRICE_FILTER'];
    candidate.values = {};
    spec.normalizationState = 'BLOCKED_SOURCE';
    spec.lossCodes = [...new Set([...spec.lossCodes, 'MALFORMED_FILTER_PRICE_FILTER'])].sort();
  });
  const blockedFilter = preflightInstrumentSizing(
    blockedFilterSnapshot,
    request(blockedFilterSnapshot),
  );
  assertBlocked(blockedFilter, 'BLOCKED_SOURCE');
  assert.notEqual(blockedFilter.staticState, 'PASS');

  const spotRegistry = snapshot(instrument());
  const falseTradingSnapshot = coherentlyMutateSnapshot(spotRegistry, (_snapshot, spec) => {
    spec.tradingAllowed = false;
    spec.normalizationState = 'BLOCKED_SOURCE';
    spec.lossCodes = [...new Set([...spec.lossCodes, 'SPOT_TRADING_NOT_PROVED'])].sort();
  });
  const falseTrading = preflightInstrumentSizing(falseTradingSnapshot, request(falseTradingSnapshot));
  assertBlocked(falseTrading, 'BLOCKED_SOURCE');
  assert.notEqual(falseTrading.staticState, 'PASS');
});

test('blocked filters cannot retain nonempty or oversized nested value projections', () => {
  const registry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  }));
  for (const [label, values] of [
    ['nonempty blocked values', { retainedDocumentaryValue: '1' }],
    ['oversized nested blocked string', { retainedDocumentaryValue: 'x'.repeat(8_193) }],
  ]) {
    const forged = coherentlyMutateSnapshot(registry, (_snapshot, spec) => {
      const candidate = spec.filters.find((entry) => entry.filterType === 'PRICE_FILTER');
      candidate.state = 'BLOCKED_MALFORMED';
      candidate.reasonCodes = ['MALFORMED_FILTER_PRICE_FILTER'];
      candidate.values = values;
      spec.normalizationState = 'BLOCKED_SOURCE';
      spec.lossCodes = [...new Set([...spec.lossCodes, 'MALFORMED_FILTER_PRICE_FILTER'])].sort();
    });
    const result = preflightInstrumentSizing(forged, request(forged));
    assertBlocked(result, 'STATIC_PREFLIGHT_INPUT_REJECTED');
    assert.notEqual(result.staticState, 'PASS', label);
  }
});

test('timestamp-only receipt forgeries cannot reuse semantic instrument or registry revisions', () => {
  const registry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  }));
  const semanticInstrumentRevision = registry.instruments[0].instrumentRevision;
  const semanticRegistryRevision = registry.registryRevision;
  const sourceEvidenceRevision = registry.instruments[0].sourceEvidenceRevision;
  const snapshotRevision = registry.snapshotRevision;

  const cases = [
    ['snapshot evaluation time', (current) => {
      current.evaluatedAtMs += 1;
    }],
    ['source receipt interval', (_current, spec) => {
      spec.sourceReceivedAtMs += 1;
      spec.sourceValidUntilMs += 1;
    }],
    ['source valid-until only', (_current, spec) => {
      spec.sourceValidUntilMs += 1;
    }],
    ['all receipt timestamps together', (current, spec) => {
      current.evaluatedAtMs += 1;
      spec.sourceReceivedAtMs += 1;
      spec.sourceValidUntilMs += 1;
    }],
  ];

  for (const [label, mutate] of cases) {
    const forged = structuredClone(registry);
    mutate(forged, forged.instruments[0]);
    assert.equal(forged.instruments[0].instrumentRevision, semanticInstrumentRevision, label);
    assert.equal(forged.registryRevision, semanticRegistryRevision, label);
    assert.equal(forged.instruments[0].sourceEvidenceRevision, sourceEvidenceRevision, label);
    assert.equal(forged.snapshotRevision, snapshotRevision, label);
    const immutableForgery = freezeDeep(forged);
    const result = preflightInstrumentSizing(immutableForgery, request(immutableForgery));
    assertBlocked(result, 'STATIC_PREFLIGHT_INPUT_REJECTED');
    assert.notEqual(result.staticState, 'PASS', label);
  }
});

test('coherent revision recomputation cannot bless malformed, forged, duplicate, or incomplete active filters', () => {
  const registry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  }));
  const cases = [
    ['active supported filter with empty values', (_snapshot, spec) => {
      spec.filters.find((entry) => entry.filterType === 'PRICE_FILTER').values = {};
    }],
    ['active supported filter with a falsified exact decimal', (_snapshot, spec) => {
      const price = spec.filters.find((entry) => entry.filterType === 'PRICE_FILTER');
      price.values.minPrice = { raw: '0.01', canonical: '0.02' };
    }],
    ['falsified private-truth flag', (_snapshot, spec) => {
      spec.filters.find((entry) => entry.filterType === 'LOT_SIZE').privateTruthRequired = true;
    }],
    ['falsified dynamic-reference flag', (_snapshot, spec) => {
      spec.filters.find((entry) => entry.filterType === 'MIN_NOTIONAL').dynamicReferenceRequired = false;
    }],
    ['active unknown filter', (_snapshot, spec) => {
      spec.filters.push({
        filterType: 'UNKNOWN_CURRENT_FILTER',
        state: 'ACTIVE',
        reasonCodes: [],
        values: {},
        sourceContentSha256: 'f'.repeat(64),
        privateTruthRequired: false,
        dynamicReferenceRequired: false,
      });
      spec.filters.sort((left, right) => left.filterType.localeCompare(right.filterType)
        || left.sourceContentSha256.localeCompare(right.sourceContentSha256));
    }],
    ['duplicate active filter', (_snapshot, spec) => {
      spec.filters.push(structuredClone(
        spec.filters.find((entry) => entry.filterType === 'PRICE_FILTER'),
      ));
      spec.filters.sort((left, right) => left.filterType.localeCompare(right.filterType)
        || left.sourceContentSha256.localeCompare(right.sourceContentSha256));
    }],
    ['missing mandatory USD-M notional filter', (_snapshot, spec) => {
      spec.filters = spec.filters.filter((entry) => entry.filterType !== 'MIN_NOTIONAL');
    }],
  ];

  for (const [label, mutate] of cases) {
    const adversarial = coherentlyMutateSnapshot(registry, mutate);
    const result = preflightInstrumentSizing(adversarial, request(adversarial));
    assertBlocked(result, 'STATIC_PREFLIGHT_INPUT_REJECTED');
    assert.notEqual(result.staticState, 'PASS', label);
  }
});

test('mandatory loss, capability, maximum-age, and source-time policy survive coherent revision forgery', () => {
  const registry = snapshot(instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  }));
  const mandatoryLosses = [
    'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
    'TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE',
    'USD_M_CONTRACT_SIZE_UNAVAILABLE',
  ];
  assert.deepEqual(registry.instruments[0].lossCodes, mandatoryLosses);
  const cases = [
    ['erased mandatory loss', (_snapshot, spec) => {
      spec.lossCodes = spec.lossCodes.filter((code) => code !== 'USD_M_CONTRACT_SIZE_UNAVAILABLE');
    }],
    ['READY source with extra incomplete loss', (_snapshot, spec) => {
      spec.lossCodes = [...mandatoryLosses, 'SOURCE_INCOMPLETE'].sort();
    }],
    ['READY source with extra stale-or-unavailable loss', (_snapshot, spec) => {
      spec.lossCodes = [...mandatoryLosses, 'SOURCE_STALE_OR_UNAVAILABLE'].sort();
    }],
    ['READY source with extra filter-block loss while filters remain active', (_snapshot, spec) => {
      assert.ok(spec.filters.every((entry) => entry.state === 'ACTIVE'));
      spec.lossCodes = [...mandatoryLosses, 'MALFORMED_FILTER_PRICE_FILTER'].sort();
    }],
    ['falsified static capability posture', (_snapshot, spec) => {
      spec.staticOrderTypes = ['LIMIT'];
    }],
    ['zero snapshot maximum age', (current) => {
      current.maximumAgeMs = 0;
    }],
    ['overbound snapshot maximum age', (current) => {
      current.maximumAgeMs = 300_001;
    }],
    ['source maximum age exceeds snapshot policy', (current, spec) => {
      spec.sourceMaximumAgeMs = current.maximumAgeMs + 1;
      spec.sourceValidUntilMs = spec.sourceReceivedAtMs + spec.sourceMaximumAgeMs;
    }],
    ['source validity does not equal received plus maximum age', (_snapshot, spec) => {
      spec.sourceValidUntilMs += 1;
    }],
    ['ready source is stale at snapshot evaluation', (current, spec) => {
      current.evaluatedAtMs = spec.sourceValidUntilMs + 1;
    }],
    ['ready source exceeds future-skew policy', (current, spec) => {
      current.evaluatedAtMs = spec.sourceReceivedAtMs - 2_001;
    }],
  ];

  for (const [label, mutate] of cases) {
    const adversarial = coherentlyMutateSnapshot(registry, mutate);
    const result = preflightInstrumentSizing(adversarial, request(adversarial));
    assertBlocked(result, 'STATIC_PREFLIGHT_INPUT_REJECTED');
    assert.notEqual(result.staticState, 'PASS', label);
  }
});

test('hostile request records and non-exact money fail closed without invoking accessors', () => {
  const spec = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [priceFilter(), lotFilter(), usdmMinimumNotional()],
  });
  const registry = snapshot(spec);
  const base = request(registry);
  const badDecimals = [1, NaN, Infinity, '-1', '+1', '1e0', ' 1', '1 ', '', '.1', '1.', '1,0', '0'];
  for (const value of badDecimals) {
    const result = preflightInstrumentSizing(registry, { ...base, requestedQuantity: value });
    assertBlocked(result, 'STATIC_PREFLIGHT_INPUT_REJECTED');
  }

  const missing = { ...base };
  delete missing.side;
  assertBlocked(preflightInstrumentSizing(registry, missing), 'STATIC_PREFLIGHT_INPUT_REJECTED');
  assertBlocked(preflightInstrumentSizing(registry, { ...base, extra: true }), 'STATIC_PREFLIGHT_INPUT_REJECTED');
  assertBlocked(preflightInstrumentSizing(registry, []), 'STATIC_PREFLIGHT_INPUT_REJECTED');

  const inherited = Object.assign(Object.create({ forged: true }), base);
  assertBlocked(preflightInstrumentSizing(registry, inherited), 'STATIC_PREFLIGHT_INPUT_REJECTED');

  const withSymbol = { ...base };
  Object.defineProperty(withSymbol, Symbol('forged'), { enumerable: true, value: true });
  assertBlocked(preflightInstrumentSizing(registry, withSymbol), 'STATIC_PREFLIGHT_INPUT_REJECTED');

  const nonEnumerable = { ...base };
  Object.defineProperty(nonEnumerable, 'side', { enumerable: false, value: 'BUY' });
  assertBlocked(preflightInstrumentSizing(registry, nonEnumerable), 'STATIC_PREFLIGHT_INPUT_REJECTED');

  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, 'side', {
    enumerable: true,
    get() { getterCalls += 1; return 'BUY'; },
  });
  assertBlocked(preflightInstrumentSizing(registry, accessor), 'STATIC_PREFLIGHT_INPUT_REJECTED');
  assert.equal(getterCalls, 0);

  let proxyGetCalls = 0;
  const proxied = new Proxy(base, {
    get(target, property, receiver) {
      proxyGetCalls += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assertBlocked(preflightInstrumentSizing(registry, proxied), 'STATIC_PREFLIGHT_INPUT_REJECTED');
  assert.equal(proxyGetCalls, 0);
});

test('precision beyond the bounded exact division scale blocks instead of rounding optimistically', () => {
  const spec = instrument({
    product: 'USD_M_PERPETUAL',
    filters: [
      priceFilter(),
      lotFilter({
        min: '0.0000000000000000000000001',
        max: '100',
        step: '0.0000000000000000000000001',
      }),
      usdmMinimumNotional(),
    ],
  });
  const result = run(spec, {
    requestedPrice: '20',
    requestedQuantity: '1.0000000000000000000000001',
    approvedNotional: '10',
    intendedExposure: '10',
  });
  assertBlocked(result, 'FILTER_SCALE_UNSUPPORTED');
  assert.equal(result.requestedQuantity, '1.0000000000000000000000001');
  assert.equal(result.resultQuantity, '1.0000000000000000000000001');
});

test('deterministic exact property grid proves all sizing and authority invariants', () => {
  const spec = instrument({
    filters: [
      priceFilter({ min: '0', max: '0', tick: '0.01' }),
      lotFilter({ min: '0.01', max: '100', step: '0.01' }),
      notionalFilter({ minimum: '0.001', maximum: '1000' }),
      maxOrders(50),
    ],
    lossCodes: ['EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED'],
  });

  let passes = 0;
  let reductions = 0;
  for (let index = 0; index < 128; index += 1) {
    const requestedPrice = fromHundredths(50 + (index % 200));
    const requestedQuantity = fromHundredths(10 + ((index * 37) % 3_000));
    const approvedNotional = fromHundredths(500 + ((index * 13) % 600));
    const intendedExposure = fromHundredths(450 + ((index * 17) % 650));
    const input = {
      orderType: 'MARKET',
      timeInForce: null,
      requestedPrice: null,
      referencePrice: requestedPrice,
      requestedQuantity,
      approvedNotional,
      intendedExposure,
    };
    const result = run(spec, input);
    assertPass(result);
    assert.match(result.referenceEvidenceRevision, /^l04-filter-reference:/);
    if (index % 16 === 0) {
      assert.deepEqual(result, run(spec, input), `nondeterministic result at property case ${index}`);
    }
    assert.equal(result.resultNotional, multiplyDecimals(result.validationPrice, result.resultQuantity));
    assert.ok(compareDecimals(result.resultQuantity, result.requestedQuantity) <= 0);
    assert.ok(compareDecimals(result.resultNotional, approvedNotional) <= 0);
    assert.ok(compareDecimals(result.resultNotional, intendedExposure) <= 0);
    assert.ok(compareDecimals(result.resultNotional, '10') <= 0);
    assert.ok(compareDecimals(result.resultNotional, result.effectiveNotionalCeiling) <= 0);
    assert.equal(result.sendEligible, false);
    assert.equal(result.externalActionAuthorization, 'NONE');
    assert.ok(result.externalRequirements.includes('MAX_NUM_ORDERS_PRIVATE_OWNER_TRUTH_REQUIRED'));
    let prior = result.requestedQuantity;
    for (const transformation of result.transformations) {
      assert.equal(transformation.from, prior);
      assert.ok(compareDecimals(transformation.to, transformation.from) < 0);
      prior = transformation.to;
      reductions += 1;
    }
    assert.equal(prior, result.resultQuantity);
    assertDeeplyFrozen(result);
    passes += 1;
  }
  assert.equal(passes, 128);
  assert.ok(reductions > 50, `property grid exercised only ${reductions} reductions`);
});
