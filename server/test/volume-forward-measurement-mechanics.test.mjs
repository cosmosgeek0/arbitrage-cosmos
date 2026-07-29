#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOLUME_FORWARD_MEASUREMENT_AUTHORITY,
  VOLUME_FORWARD_MEASUREMENT_LIMITS,
  applyVolumeForwardDepthInput,
  buildVolumeForwardDetectorProposalBinding,
  buildVolumeForwardMeasurementPolicy,
  buildVolumeForwardPointInTimeControls,
  createVolumeForwardDepthState,
  parseVolumeForwardDepthSnapshot,
  parseVolumeForwardExchangeInfo,
  parseVolumeForwardPublicPayload,
  validateVolumeForwardDetectorProposalBinding,
  validateVolumeForwardMeasurementPolicy,
} from '../dist/engine/volume/forwardMeasurement.js';

const SYMBOL = 'BTCUSDT';
const GENERATION = 7;
const POLICY_FROZEN_AT_MS = 1_900_000_000_000;
const OUTCOME_OPENS_AT_MS = POLICY_FROZEN_AT_MS + 60_000;
const OUTCOME_CLOSES_AT_MS = OUTCOME_OPENS_AT_MS + 86_400_000;
const EVIDENCE_CLOSES_AT_MS = OUTCOME_CLOSES_AT_MS + 62_000;
const DEFAULT_RECEIVED_AT_MS = POLICY_FROZEN_AT_MS + 10_000;
const CONFIGURATION_DIGEST = `sha256:${'a'.repeat(64)}`;
const FILTER_DIGEST = `sha256:${'b'.repeat(64)}`;
const KILL_STATE_DIGEST = `sha256:${'c'.repeat(64)}`;

function policyInput(overrides = {}) {
  return {
    policyId: 'volume-forward-policy-0001',
    policyRevision: 1,
    symbol: SYMBOL,
    frozenAtMs: POLICY_FROZEN_AT_MS,
    outcomeOpensAtMs: OUTCOME_OPENS_AT_MS,
    outcomeClosesAtMs: OUTCOME_CLOSES_AT_MS,
    evidenceClosesAtMs: EVIDENCE_CLOSES_AT_MS,
    streams: [
      'btcusdt@aggTrade',
      'btcusdt@trade',
      'btcusdt@bookTicker',
      'btcusdt@depth@100ms',
    ],
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
    ...overrides,
  };
}

function parse(payload, {
  generation = GENERATION,
  receivedMonotonicNs = '1000000',
  receivedAtMs = DEFAULT_RECEIVED_AT_MS,
  stream = null,
  sourceStream = stream ?? streamForPayload(payload),
} = {}) {
  return parseVolumeForwardPublicPayload({
    rawPayload: JSON.stringify(stream === null ? payload : { stream, data: payload }),
    generation,
    receivedMonotonicNs,
    receivedAtMs,
    sourceStream,
  });
}

function streamForPayload(payload) {
  if (payload.e === 'aggTrade') return 'btcusdt@aggTrade';
  if (payload.e === 'trade') return 'btcusdt@trade';
  if (payload.e === 'depthUpdate') return 'btcusdt@depth@100ms';
  return 'btcusdt@bookTicker';
}

function depthEvent({
  firstUpdateId,
  finalUpdateId,
  bids = [],
  asks = [],
  generation = GENERATION,
  receivedMonotonicNs,
  eventTimeMs = POLICY_FROZEN_AT_MS + 1_000,
  receivedAtMs = POLICY_FROZEN_AT_MS + 2_000,
  stream = 'btcusdt@depth@100ms',
} = {}) {
  return {
    kind: 'DEPTH_DIFF',
    generation,
    receivedMonotonicNs,
    eventTimeMs,
    symbol: SYMBOL,
    firstUpdateId,
    finalUpdateId,
    bids,
    asks,
    receivedAtMs,
    stream,
  };
}

function depthSnapshot({
  lastUpdateId,
  bids,
  asks,
  generation = GENERATION,
  receivedMonotonicNs,
  receivedAtMs = POLICY_FROZEN_AT_MS + 2_000,
} = {}) {
  return {
    kind: 'DEPTH_SNAPSHOT',
    generation,
    receivedMonotonicNs,
    symbol: SYMBOL,
    lastUpdateId,
    bids,
    asks,
    receivedAtMs,
  };
}

function createDepthState() {
  return createVolumeForwardDepthState({
    symbol: SYMBOL,
    generation: GENERATION,
  });
}

function apply(state, input) {
  return applyVolumeForwardDepthInput(state, input);
}

function exchangeInfoPayload(filters) {
  return {
    timezone: 'UTC',
    symbols: [{
      symbol: SYMBOL,
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      isSpotTradingAllowed: true,
      orderTypes: ['LIMIT', 'MARKET'],
      permissions: ['SPOT'],
      filters,
    }],
  };
}

function requiredFilters(notionalType = 'NOTIONAL') {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: '0.01000000',
      maxPrice: '1000000.00000000',
      tickSize: '0.01000000',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: '0.00001000',
      maxQty: '100.00000000',
      stepSize: '0.00001000',
    },
    notionalType === 'NOTIONAL'
      ? {
          filterType: 'NOTIONAL',
          minNotional: '5.00000000',
          maxNotional: '1000000.00000000',
          applyMinToMarket: true,
          applyMaxToMarket: false,
          avgPriceMins: 5,
        }
      : {
          filterType: 'MIN_NOTIONAL',
          minNotional: '5.00000000',
          applyToMarket: true,
          avgPriceMins: 5,
        },
  ];
}

test('measurement policy is frozen before outcomes and preserves default-OFF, kill-ON, no-authority controls', () => {
  const policy = buildVolumeForwardMeasurementPolicy(policyInput());

  assert.equal(validateVolumeForwardMeasurementPolicy(policy), true);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.config), true);
  assert.equal(Object.isFrozen(policy.streams), true);
  assert.equal(policy.frozenAtMs < policy.outcomeOpensAtMs, true);
  assert.equal(policy.outcomeOpensAtMs < policy.outcomeClosesAtMs, true);
  assert.equal(policy.outcomeClosesAtMs <= policy.evidenceClosesAtMs, true);
  assert.equal(policy.config.enabled, false);
  assert.equal(policy.config.killSwitchEngaged, true);

  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.enabled, false);
  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.killSwitchEngaged, true);
  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.executionAuthority, 'NONE');
  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.submitAuthority, 'NONE');
  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.casAuthority, 'NONE');
  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.privateCalls, 0);
  assert.equal(VOLUME_FORWARD_MEASUREMENT_AUTHORITY.signedCalls, 0);
});

test('measurement policy rejects outcome access at or before the freeze boundary and any armed controls', () => {
  for (const input of [
    policyInput({ outcomeOpensAtMs: POLICY_FROZEN_AT_MS }),
    policyInput({ outcomeOpensAtMs: POLICY_FROZEN_AT_MS - 1 }),
    policyInput({ outcomeClosesAtMs: OUTCOME_OPENS_AT_MS }),
    policyInput({ evidenceClosesAtMs: OUTCOME_CLOSES_AT_MS - 1 }),
    policyInput({ evidenceClosesAtMs: Date.UTC(2101, 0, 1) }),
    policyInput({ config: { enabled: true, killSwitchEngaged: true } }),
    policyInput({ config: { enabled: false, killSwitchEngaged: false } }),
  ]) {
    assert.throws(() => buildVolumeForwardMeasurementPolicy(input));
  }
  assert.doesNotThrow(() => buildVolumeForwardMeasurementPolicy(policyInput({
    evidenceClosesAtMs: OUTCOME_CLOSES_AT_MS,
  })));
});

test('measurement policy exact shape and digest bind the exclusive evidence horizon', () => {
  const base = policyInput();
  const policy = buildVolumeForwardMeasurementPolicy(base);
  const extended = buildVolumeForwardMeasurementPolicy(policyInput({
    evidenceClosesAtMs: EVIDENCE_CLOSES_AT_MS + 1,
  }));
  assert.notEqual(policy.policyDigest, extended.policyDigest);

  const {
    evidenceClosesAtMs: _missingEvidenceClose,
    ...missingEvidenceClose
  } = base;
  const inherited = Object.assign(
    Object.create({ inherited: true }),
    base,
  );
  let getterReads = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, 'evidenceClosesAtMs', {
    enumerable: true,
    get() {
      getterReads += 1;
      return EVIDENCE_CLOSES_AT_MS;
    },
  });
  for (const input of [
    missingEvidenceClose,
    { ...base, extra: true },
    inherited,
    new Proxy(base, {}),
    accessor,
  ]) {
    assert.throws(() => buildVolumeForwardMeasurementPolicy(input));
  }
  assert.equal(getterReads, 0);

  const {
    evidenceClosesAtMs: _omittedFromBuiltPolicy,
    ...builtWithoutEvidenceClose
  } = policy;
  assert.equal(
    validateVolumeForwardMeasurementPolicy(builtWithoutEvidenceClose),
    false,
  );
  assert.equal(validateVolumeForwardMeasurementPolicy({
    ...policy,
    evidenceClosesAtMs: EVIDENCE_CLOSES_AT_MS + 1,
  }), false);
});

test('measurement policy requires the exact bounded four-stream Volume source set', () => {
  assert.throws(() => buildVolumeForwardMeasurementPolicy(policyInput({
    streams: ['btcusdt@aggTrade'],
  })));
  assert.throws(() => buildVolumeForwardMeasurementPolicy(policyInput({
    streams: [
      ...policyInput().streams,
      'btcusdt@depth',
    ],
  })));
  assert.throws(() => buildVolumeForwardMeasurementPolicy(policyInput({
    streams: [
      'btcusdt@aggTrade',
      'btcusdt@trade',
      'btcusdt@bookTicker',
      'ethusdt@depth@100ms',
    ],
  })));
  assert.throws(() => buildVolumeForwardMeasurementPolicy(policyInput({
    symbol: '１２３４５６',
  })));
});

test('parser accepts raw and combined aggTrade payloads without converting source decimal strings', () => {
  const payload = {
    e: 'aggTrade',
    E: 1_900_000_000_101,
    s: SYMBOL,
    a: 12345,
    p: '0.00123000',
    q: '100.00000000',
    f: 100,
    l: 105,
    T: 1_900_000_000_100,
    m: true,
    M: true,
  };

  const raw = parse(payload);
  const combined = parse(payload, { stream: 'btcusdt@aggTrade' });

  for (const parsed of [raw, combined]) {
    assert.equal(parsed.kind, 'AGG_TRADE');
    assert.equal(parsed.symbol, SYMBOL);
    assert.equal(parsed.aggregateTradeId, 12345);
    assert.equal(parsed.firstTradeId, 100);
    assert.equal(parsed.lastTradeId, 105);
    assert.equal(parsed.price, '0.00123000');
    assert.equal(parsed.quantity, '100.00000000');
    assert.equal(parsed.eventTimeMs, payload.E);
    assert.equal(parsed.tradeTimeMs, payload.T);
    assert.equal(parsed.buyerIsMaker, true);
    assert.equal(parsed.generation, GENERATION);
    assert.equal(parsed.receivedMonotonicNs, '1000000');
  }
});

test('parser accepts raw and combined trade payloads with their unaggregated trade identity', () => {
  const payload = {
    e: 'trade',
    E: 1_900_000_000_201,
    s: SYMBOL,
    t: 54321,
    p: '65432.10000000',
    q: '0.00001000',
    T: 1_900_000_000_200,
    m: false,
    M: true,
  };

  for (const parsed of [
    parse(payload, { receivedMonotonicNs: '2000000' }),
    parse(payload, {
      stream: 'btcusdt@trade',
      receivedMonotonicNs: '2000000',
    }),
  ]) {
    assert.equal(parsed.kind, 'TRADE');
    assert.equal(parsed.tradeId, 54321);
    assert.equal(parsed.price, '65432.10000000');
    assert.equal(parsed.quantity, '0.00001000');
    assert.equal(parsed.buyerIsMaker, false);
    assert.equal(parsed.receivedMonotonicNs, '2000000');
  }
});

test('parser accepts bookTicker as best-quote evidence while retaining its update id and exact strings', () => {
  const payload = {
    u: 400900217,
    s: SYMBOL,
    b: '65432.10000000',
    B: '1.23000000',
    a: '65432.20000000',
    A: '0.87000000',
  };

  for (const parsed of [
    parse(payload, { stream: 'btcusdt@bookTicker' }),
    parse(payload),
  ]) {
    assert.equal(parsed.kind, 'BOOK_TICKER');
    assert.equal(parsed.updateId, 400900217);
    assert.equal(parsed.bidPrice, '65432.10000000');
    assert.equal(parsed.bidQuantity, '1.23000000');
    assert.equal(parsed.askPrice, '65432.20000000');
    assert.equal(parsed.askQuantity, '0.87000000');
  }
});

test('parser accepts depth diff ranges and retains price/quantity text exactly', () => {
  const payload = {
    e: 'depthUpdate',
    E: 1_900_000_000_301,
    s: SYMBOL,
    U: 157,
    u: 160,
    b: [
      ['65432.10000000', '1.23000000'],
      ['65432.00000000', '0.00000000'],
    ],
    a: [['65432.20000000', '0.87000000']],
  };

  for (const parsed of [
    parse(payload, {
      stream: 'btcusdt@depth@100ms',
      receivedMonotonicNs: '3000000',
    }),
    parse(payload, { receivedMonotonicNs: '3000000' }),
  ]) {
    assert.equal(parsed.kind, 'DEPTH_DIFF');
    assert.equal(parsed.firstUpdateId, 157);
    assert.equal(parsed.finalUpdateId, 160);
    assert.deepEqual(parsed.bids, [
      ['65432.10000000', '1.23000000'],
      ['65432.00000000', '0.00000000'],
    ]);
    assert.deepEqual(parsed.asks, [['65432.20000000', '0.87000000']]);
    assert.equal(parsed.receivedMonotonicNs, '3000000');
  }
});

test('parser rejects malformed decimals, unsupported stream/event mismatches, and non-monotonic clock text', () => {
  const aggTrade = {
    e: 'aggTrade',
    E: 1_900_000_000_101,
    s: SYMBOL,
    a: 12345,
    p: '1e-8',
    q: '100.00000000',
    f: 100,
    l: 105,
    T: 1_900_000_000_100,
    m: true,
    M: true,
  };

  assert.throws(() => parse(aggTrade));
  assert.throws(() => parse({ ...aggTrade, p: '0.00100000' }, {
    stream: 'btcusdt@trade',
  }));
  assert.throws(() => parse({ ...aggTrade, p: '0.00100000' }, {
    receivedMonotonicNs: '-1',
  }));
});

test('raw parser requires explicit stream provenance while exact combined envelopes remain self-describing', () => {
  const payload = {
    e: 'depthUpdate',
    E: POLICY_FROZEN_AT_MS + 100,
    s: SYMBOL,
    U: 10,
    u: 11,
    b: [['100.00', '1.00']],
    a: [['101.00', '2.00']],
  };
  assert.throws(() => parseVolumeForwardPublicPayload({
    rawPayload: JSON.stringify(payload),
    generation: GENERATION,
    receivedMonotonicNs: '10',
    receivedAtMs: POLICY_FROZEN_AT_MS + 200,
  }));

  const combined = parseVolumeForwardPublicPayload({
    rawPayload: JSON.stringify({
      stream: 'btcusdt@depth@100ms',
      data: payload,
    }),
    generation: GENERATION,
    receivedMonotonicNs: '10',
    receivedAtMs: POLICY_FROZEN_AT_MS + 200,
  });
  assert.equal(combined.stream, 'btcusdt@depth@100ms');

  assert.throws(() => parseVolumeForwardPublicPayload({
    rawPayload: JSON.stringify({
      stream: 'btcusdt@depth@100ms',
      data: payload,
    }),
    generation: GENERATION,
    receivedMonotonicNs: '10',
    receivedAtMs: POLICY_FROZEN_AT_MS + 200,
    sourceStream: 'btcusdt@trade',
  }));
  assert.throws(() => parseVolumeForwardPublicPayload({
    rawPayload: JSON.stringify({
      stream: 'btcusdt@depth@100ms',
      data: payload,
      extra: true,
    }),
    generation: GENERATION,
    receivedMonotonicNs: '10',
    receivedAtMs: POLICY_FROZEN_AT_MS + 200,
    sourceStream: 'btcusdt@depth@100ms',
  }));
});

test('public source parsing requires a wall receipt and rejects future or unsafe UTC source clocks', () => {
  const payload = {
    e: 'trade',
    E: POLICY_FROZEN_AT_MS + 100,
    s: SYMBOL,
    t: 42,
    p: '100.00',
    q: '1.00',
    T: POLICY_FROZEN_AT_MS + 99,
    m: false,
    M: true,
  };
  assert.throws(() => parseVolumeForwardPublicPayload({
    rawPayload: JSON.stringify(payload),
    generation: GENERATION,
    receivedMonotonicNs: '10',
    sourceStream: 'btcusdt@trade',
  }));
  assert.throws(() => parse({
    ...payload,
    E: Date.UTC(2096, 0, 1),
    T: Date.UTC(2096, 0, 1),
  }, {
    receivedAtMs: POLICY_FROZEN_AT_MS + 200,
  }));
  assert.throws(() => parse(payload, {
    receivedAtMs: Date.UTC(2101, 0, 1),
  }));
});

test('exchangeInfo enforces exact official required-filter shapes and semantics', () => {
  for (const notionalType of ['NOTIONAL', 'MIN_NOTIONAL']) {
    const snapshot = parseVolumeForwardExchangeInfo({
      rawPayload: JSON.stringify(exchangeInfoPayload(
        requiredFilters(notionalType),
      )),
      symbol: SYMBOL,
      generation: GENERATION,
      receivedMonotonicNs: '500',
      receivedAtMs: DEFAULT_RECEIVED_AT_MS,
    });
    assert.equal(snapshot.symbol, SYMBOL);
    assert.equal(snapshot.spotTradingAllowed, true);
    assert.equal(
      snapshot.filters.some((filter) => filter.filterType === notionalType),
      true,
    );
  }
  const disabledPriceBounds = requiredFilters().map((filter) => (
    filter.filterType === 'PRICE_FILTER'
      ? { ...filter, minPrice: '0', maxPrice: '0' }
      : filter
  ));
  assert.doesNotThrow(() => parseVolumeForwardExchangeInfo({
    rawPayload: JSON.stringify(exchangeInfoPayload(disabledPriceBounds)),
    symbol: SYMBOL,
    generation: GENERATION,
    receivedMonotonicNs: '500',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
  }));

  const invalidFilterSets = [
    requiredFilters().filter((filter) => filter.filterType !== 'PRICE_FILTER'),
    requiredFilters().map((filter) => (
      filter.filterType === 'PRICE_FILTER'
        ? { ...filter, tickSize: '0.00000000' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'PRICE_FILTER'
        ? {
            filterType: filter.filterType,
            maxPrice: filter.maxPrice,
            tickSize: filter.tickSize,
          }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'PRICE_FILTER'
        ? { ...filter, minPrice: '20', maxPrice: '10' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'PRICE_FILTER'
        ? { ...filter, minPrice: '1e-8' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'PRICE_FILTER'
        ? { ...filter, undocumented: '1' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'LOT_SIZE'
        ? { ...filter, minQty: '2.0', maxQty: '1.0' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'LOT_SIZE'
        ? { ...filter, stepSize: '1e-8' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'LOT_SIZE'
        ? { ...filter, stepSize: '101', maxQty: '100' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'LOT_SIZE'
        ? {
            filterType: filter.filterType,
            minQty: filter.minQty,
            stepSize: filter.stepSize,
          }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'NOTIONAL'
        ? { ...filter, minNotional: '0' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'NOTIONAL'
        ? {
            filterType: filter.filterType,
            minNotional: filter.minNotional,
            applyMinToMarket: filter.applyMinToMarket,
            applyMaxToMarket: filter.applyMaxToMarket,
            avgPriceMins: filter.avgPriceMins,
          }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'NOTIONAL'
        ? { ...filter, minNotional: '10', maxNotional: '5' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'NOTIONAL'
        ? { ...filter, applyMinToMarket: 'true' }
        : filter
    )),
    requiredFilters().map((filter) => (
      filter.filterType === 'NOTIONAL'
        ? { ...filter, avgPriceMins: 1.5 }
        : filter
    )),
    requiredFilters('MIN_NOTIONAL').map((filter) => (
      filter.filterType === 'MIN_NOTIONAL'
        ? { ...filter, applyToMarket: 'true' }
        : filter
    )),
    requiredFilters('MIN_NOTIONAL').map((filter) => (
      filter.filterType === 'MIN_NOTIONAL'
        ? { ...filter, avgPriceMins: -1 }
        : filter
    )),
    requiredFilters('MIN_NOTIONAL').map((filter) => (
      filter.filterType === 'MIN_NOTIONAL'
        ? { ...filter, maxNotional: '100' }
        : filter
    )),
    [
      ...requiredFilters(),
      ...requiredFilters('MIN_NOTIONAL').slice(-1),
    ],
    [
      ...requiredFilters(),
      { ...requiredFilters()[0] },
    ],
  ];
  for (const filters of invalidFilterSets) {
    assert.throws(() => parseVolumeForwardExchangeInfo({
      rawPayload: JSON.stringify(exchangeInfoPayload(filters)),
      symbol: SYMBOL,
      generation: GENERATION,
      receivedMonotonicNs: '500',
      receivedAtMs: DEFAULT_RECEIVED_AT_MS,
    }));
  }
});

test('exchangeInfo requires authoritative spot-trading boolean despite SPOT legacy metadata', () => {
  const payload = exchangeInfoPayload(requiredFilters());
  payload.symbols[0].isSpotTradingAllowed = false;
  payload.symbols[0].permissions = ['SPOT'];
  payload.symbols[0].permissionSets = [['SPOT']];
  const snapshot = parseVolumeForwardExchangeInfo({
    rawPayload: JSON.stringify(payload),
    symbol: SYMBOL,
    generation: GENERATION,
    receivedMonotonicNs: '500',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
  });
  assert.equal(snapshot.spotTradingAllowed, false);

  payload.symbols[0].isSpotTradingAllowed = 'false';
  assert.throws(() => parseVolumeForwardExchangeInfo({
    rawPayload: JSON.stringify(payload),
    symbol: SYMBOL,
    generation: GENERATION,
    receivedMonotonicNs: '500',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
  }));

  delete payload.symbols[0].isSpotTradingAllowed;
  assert.throws(() => parseVolumeForwardExchangeInfo({
    rawPayload: JSON.stringify(payload),
    symbol: SYMBOL,
    generation: GENERATION,
    receivedMonotonicNs: '500',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
  }));
});

test('exported state and exchangeInfo boundaries reject extra, inherited, proxy, and accessor fields', () => {
  const stateScope = { symbol: SYMBOL, generation: GENERATION };
  const inheritedScope = Object.assign(
    Object.create({ inherited: true }),
    stateScope,
  );
  let scopeGetterReads = 0;
  const accessorScope = { generation: GENERATION };
  Object.defineProperty(accessorScope, 'symbol', {
    enumerable: true,
    get() {
      scopeGetterReads += 1;
      return SYMBOL;
    },
  });
  for (const scope of [
    { ...stateScope, extra: true },
    inheritedScope,
    new Proxy(stateScope, {}),
    accessorScope,
  ]) {
    assert.throws(() => createVolumeForwardDepthState(scope));
  }
  assert.equal(scopeGetterReads, 0);

  const exchangeInput = {
    rawPayload: JSON.stringify(exchangeInfoPayload(requiredFilters())),
    symbol: SYMBOL,
    generation: GENERATION,
    receivedMonotonicNs: '500',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
  };
  const inheritedExchangeInput = Object.assign(
    Object.create({ inherited: true }),
    exchangeInput,
  );
  let exchangeGetterReads = 0;
  const accessorExchangeInput = { ...exchangeInput };
  Object.defineProperty(accessorExchangeInput, 'symbol', {
    enumerable: true,
    get() {
      exchangeGetterReads += 1;
      return SYMBOL;
    },
  });
  for (const input of [
    { ...exchangeInput, extra: true },
    inheritedExchangeInput,
    new Proxy(exchangeInput, {}),
    accessorExchangeInput,
  ]) {
    assert.throws(() => parseVolumeForwardExchangeInfo(input));
  }
  assert.equal(exchangeGetterReads, 0);
});

test('depth parsers reject semantically duplicate numeric prices', () => {
  assert.throws(() => parse({
    e: 'depthUpdate',
    E: POLICY_FROZEN_AT_MS + 100,
    s: SYMBOL,
    U: 10,
    u: 11,
    b: [
      ['100', '1'],
      ['100.0000', '2'],
    ],
    a: [],
  }));
  assert.throws(() => parseVolumeForwardDepthSnapshot({
    rawPayload: JSON.stringify({
      lastUpdateId: 11,
      bids: [
        ['100', '1'],
        ['100.0', '2'],
      ],
      asks: [['101', '1']],
    }),
    symbol: SYMBOL,
    generation: GENERATION,
    receivedMonotonicNs: '501',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
  }));
});

test('detector proposals bind the exact configuration digest and control-capture identity', () => {
  const controls = buildVolumeForwardPointInTimeControls({
    configurationRevision: 'volume_config_v1',
    configurationDigest: CONFIGURATION_DIGEST,
    filterDigest: FILTER_DIGEST,
    killStateDigest: KILL_STATE_DIGEST,
    enabled: false,
    killSwitchEngaged: true,
    capturedAtMs: POLICY_FROZEN_AT_MS + 500,
    receivedMonotonicNs: '4000',
  });
  const input = {
    proposalId: 'proposal_volume_1',
    proposalRevision: 1,
    proposalDigest: 'proposal_digest_1',
    configurationRevision: controls.configurationRevision,
    configurationDigest: controls.configurationDigest,
    controlsCapturedAtMs: controls.capturedAtMs,
    controlsReceivedMonotonicNs: controls.receivedMonotonicNs,
    correlationId: 'correlation_volume_1',
    symbol: SYMBOL,
    direction: 'long',
    updatedTs: POLICY_FROZEN_AT_MS + 600,
    featureObservedAtMs: POLICY_FROZEN_AT_MS + 400,
    expiresAtMs: POLICY_FROZEN_AT_MS + 5_000,
    detectorDecisionDigest: 'detector_decision_1',
    featureDigest: 'feature_digest_1',
    filterDigest: controls.filterDigest,
    killStateDigest: controls.killStateDigest,
    generation: GENERATION,
    receivedMonotonicNs: '5000',
  };
  const binding = buildVolumeForwardDetectorProposalBinding(input, controls);
  assert.equal(binding.configurationDigest, CONFIGURATION_DIGEST);
  assert.equal(binding.controlsCapturedAtMs, controls.capturedAtMs);
  assert.equal(
    binding.controlsReceivedMonotonicNs,
    controls.receivedMonotonicNs,
  );
  assert.equal(
    validateVolumeForwardDetectorProposalBinding(binding, controls),
    true,
  );
  assert.equal(validateVolumeForwardDetectorProposalBinding(binding), false);

  const { configurationDigest: _omitted, ...missingConfigurationDigest } = input;
  assert.throws(() => buildVolumeForwardDetectorProposalBinding(
    missingConfigurationDigest,
    controls,
  ));
  assert.throws(() => buildVolumeForwardDetectorProposalBinding({
    ...input,
    controlsCapturedAtMs: input.updatedTs + 1,
  }, controls));
  assert.throws(() => buildVolumeForwardDetectorProposalBinding({
    ...input,
    controlsReceivedMonotonicNs: '5001',
  }, controls));
  assert.throws(() => buildVolumeForwardDetectorProposalBinding({
    ...input,
    configurationDigest: `sha256:${'d'.repeat(64)}`,
  }, controls));
  assert.throws(() => buildVolumeForwardDetectorProposalBinding({
    ...input,
    controlsReceivedMonotonicNs: '3999',
  }, controls));

  const mismatchedControls = buildVolumeForwardPointInTimeControls({
    ...controls,
    configurationDigest: `sha256:${'d'.repeat(64)}`,
    receivedMonotonicNs: '3999',
  });
  assert.throws(() => buildVolumeForwardDetectorProposalBinding(
    input,
    mismatchedControls,
  ));
  assert.equal(
    validateVolumeForwardDetectorProposalBinding(binding, mismatchedControls),
    false,
  );
});

test('depth reducer rejects malformed direct typed inputs before state transition', () => {
  const valid = depthEvent({
    firstUpdateId: 1,
    finalUpdateId: 2,
    bids: [['100', '1']],
    asks: [['101', '1']],
    receivedMonotonicNs: '1000',
  });
  const { receivedAtMs: _missingWall, ...withoutWall } = valid;
  const malformed = [
    { ...valid, kind: 'UNKNOWN' },
    { ...valid, firstUpdateId: -1 },
    { ...valid, firstUpdateId: 3, finalUpdateId: 2 },
    { ...valid, bids: [['100']] },
    {
      ...valid,
      bids: [
        ['100', '1'],
        ['100.00', '2'],
      ],
    },
    { ...valid, eventTimeMs: valid.receivedAtMs + 1 },
    withoutWall,
    { ...valid, receivedAtMs: Date.UTC(2101, 0, 1) },
    { ...valid, receivedMonotonicNs: '-1' },
    { ...valid, symbol: 'btcusdt' },
    { ...valid, generation: 0 },
    { ...valid, stream: 'btcusdt@trade' },
    { ...valid, unexpected: true },
  ];
  for (const input of malformed) {
    assert.throws(() => apply(createDepthState(), input));
  }

  assert.throws(() => apply(createDepthState(), depthSnapshot({
    lastUpdateId: -1,
    bids: [['100', '1']],
    asks: [['101', '1']],
    receivedMonotonicNs: '1000',
  })));
  assert.throws(() => apply(createDepthState(), {
    kind: 'BOOK_TICKER',
    symbol: SYMBOL,
    updateId: 1,
    bidPrice: '101',
    bidQuantity: '1',
    askPrice: '100',
    askQuantity: '1',
    generation: GENERATION,
    receivedMonotonicNs: '1000',
    receivedAtMs: DEFAULT_RECEIVED_AT_MS,
    stream: 'btcusdt@bookTicker',
  }));
});

test('depth reducer rejects incomplete or forged state books, ranges, buffers, clocks, and status tuples', () => {
  const created = createDepthState();
  const input = depthEvent({
    firstUpdateId: 1,
    finalUpdateId: 1,
    receivedMonotonicNs: '2000',
  });
  const { status: _missingStatus, ...incomplete } = created;
  const snapshotState = apply(created, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [
      ['100', '1'],
      ['99', '1'],
    ],
    asks: [['101', '1']],
  }));
  const bufferedState = apply(created, depthEvent({
    firstUpdateId: 1,
    finalUpdateId: 1,
    receivedMonotonicNs: '1000',
  }));
  let getterReads = 0;
  const accessorState = { ...created };
  Object.defineProperty(accessorState, 'status', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'BUFFERING';
    },
  });
  const hostileStates = [
    incomplete,
    { ...created, extra: true },
    new Proxy(created, {}),
    accessorState,
    { ...created, status: 'SYNCHRONIZED' },
    { ...created, continuity: 'AWAITING_BRIDGE' },
    {
      ...created,
      status: 'FENCED',
      continuity: 'CONTIGUOUS',
      lastInputDisposition: 'REJECTED',
    },
    {
      ...snapshotState,
      continuity: 'AWAITING_SNAPSHOT',
    },
    {
      ...snapshotState,
      bids: [
        ['99', '1'],
        ['100', '1'],
      ],
    },
    {
      ...snapshotState,
      bids: [['101', '1']],
    },
    {
      ...snapshotState,
      status: 'SYNCHRONIZED',
      continuity: 'CONTIGUOUS',
      lastUpdateId: 502,
      sourceRevision: 2,
      updateRanges: [{
        firstUpdateId: 502,
        finalUpdateId: 502,
        eventTimeMs: POLICY_FROZEN_AT_MS + 1_000,
        receivedMonotonicNs: '1000',
      }],
      lastInputDisposition: 'DIFF_APPLIED',
    },
    { ...bufferedState, bufferedDiffCount: 0 },
    { ...bufferedState, lastReceivedMonotonicNs: '999' },
    {
      ...bufferedState,
      lastReceivedMonotonicNs: null,
      lastReceivedAtMs: null,
    },
    { ...created, lastReceivedMonotonicNs: '1' },
  ];
  for (const state of hostileStates) {
    assert.throws(() => apply(state, input));
  }
  assert.equal(getterReads, 0);
});

test('depth bootstrap buffers diffs, discards stale ranges, and accepts the official snapshot bridge', () => {
  let state = createDepthState();

  state = apply(state, depthEvent({
    firstUpdateId: 98,
    finalUpdateId: 100,
    receivedMonotonicNs: '1000',
    receivedAtMs: POLICY_FROZEN_AT_MS + 1_100,
    bids: [['99.50000000', '2.00000000']],
  }));
  assert.equal(state.status, 'BUFFERING');
  assert.equal(state.bufferedDiffCount, 1);

  state = apply(state, depthEvent({
    firstUpdateId: 100,
    finalUpdateId: 102,
    receivedMonotonicNs: '1100',
    receivedAtMs: POLICY_FROZEN_AT_MS + 1_200,
    bids: [['100.10000000', '1.25000000']],
    asks: [['101.00000000', '1.50000000']],
  }));
  assert.equal(state.bufferedDiffCount, 2);

  state = apply(state, depthSnapshot({
    lastUpdateId: 100,
    receivedMonotonicNs: '1200',
    receivedAtMs: POLICY_FROZEN_AT_MS + 1_300,
    bids: [['100.00000000', '1.00000000']],
    asks: [['101.00000000', '2.00000000']],
  }));

  assert.equal(state.status, 'SYNCHRONIZED');
  assert.equal(state.continuity, 'CONTIGUOUS');
  assert.equal(state.lastUpdateId, 102);
  assert.equal(state.bufferedDiffCount, 0);
  assert.deepEqual(state.bids, [
    ['100.10000000', '1.25000000'],
    ['100.00000000', '1.00000000'],
  ]);
  assert.deepEqual(state.asks, [['101.00000000', '1.50000000']]);
  assert.equal(state.lastReceivedMonotonicNs, '1200');
  assert.equal(state.lastReceivedAtMs, POLICY_FROZEN_AT_MS + 1_300);

  const staleAfterSnapshot = apply(state, depthEvent({
    firstUpdateId: 103,
    finalUpdateId: 103,
    receivedMonotonicNs: '1150',
    receivedAtMs: POLICY_FROZEN_AT_MS + 1_250,
  }));
  assert.equal(staleAfterSnapshot.status, 'FENCED');
  assert.equal(
    staleAfterSnapshot.continuity,
    'NON_MONOTONIC_RECEIVE_CLOCK',
  );
  assert.equal(staleAfterSnapshot.lastUpdateId, 102);
});

test('snapshot-only and all-stale bootstrap remain awaiting an official diff-depth bridge', () => {
  let snapshotFirst = apply(createDepthState(), depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [['100', '1']],
    asks: [['101', '1']],
  }));
  assert.equal(snapshotFirst.status, 'BUFFERING');
  assert.equal(snapshotFirst.continuity, 'AWAITING_BRIDGE');
  assert.equal(snapshotFirst.sourceRevision, 1);
  assert.equal(snapshotFirst.updateRanges.length, 0);

  snapshotFirst = apply(snapshotFirst, depthEvent({
    firstUpdateId: 499,
    finalUpdateId: 500,
    receivedMonotonicNs: '1100',
  }));
  assert.equal(snapshotFirst.status, 'BUFFERING');
  assert.equal(snapshotFirst.lastInputDisposition, 'STALE_DIFF_IGNORED');

  snapshotFirst = apply(snapshotFirst, depthEvent({
    firstUpdateId: 500,
    finalUpdateId: 501,
    receivedMonotonicNs: '1200',
  }));
  assert.equal(snapshotFirst.status, 'SYNCHRONIZED');
  assert.equal(snapshotFirst.continuity, 'CONTIGUOUS');
  assert.equal(snapshotFirst.lastUpdateId, 501);

  let allStale = apply(createDepthState(), depthEvent({
    firstUpdateId: 498,
    finalUpdateId: 500,
    receivedMonotonicNs: '1000',
  }));
  allStale = apply(allStale, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1100',
    bids: [['100', '1']],
    asks: [['101', '1']],
  }));
  assert.equal(allStale.status, 'BUFFERING');
  assert.equal(allStale.continuity, 'AWAITING_BRIDGE');
  assert.equal(allStale.bufferedDiffCount, 0);

  let missingBridge = apply(createDepthState(), depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [['100', '1']],
    asks: [['101', '1']],
  }));
  missingBridge = apply(missingBridge, depthEvent({
    firstUpdateId: 502,
    finalUpdateId: 502,
    receivedMonotonicNs: '1100',
  }));
  assert.equal(missingBridge.status, 'GAPPED');
  assert.equal(missingBridge.continuity, 'GAP_DETECTED');
});

test('pre-snapshot buffering is fenced by exact event, cumulative-level, and byte budgets', () => {
  let eventBound = createDepthState();
  for (
    let index = 0;
    index < VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferEvents;
    index += 1
  ) {
    eventBound = apply(eventBound, depthEvent({
      firstUpdateId: index,
      finalUpdateId: index,
      receivedMonotonicNs: String(1_000 + index),
    }));
  }
  assert.equal(eventBound.status, 'BUFFERING');
  assert.equal(
    eventBound.bufferedDiffCount,
    VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferEvents,
  );
  eventBound = apply(eventBound, depthEvent({
    firstUpdateId: 999,
    finalUpdateId: 999,
    receivedMonotonicNs: '2000',
  }));
  assert.equal(eventBound.status, 'REQUIRES_CHECKPOINT');
  assert.equal(eventBound.continuity, 'BUFFER_LIMIT_REACHED');

  const halfLevelBudget = (
    VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthLevels / 2
  );
  const levels = Array.from(
    { length: halfLevelBudget },
    (_, index) => [String(index + 1), '1'],
  );
  let levelBound = apply(createDepthState(), depthEvent({
    firstUpdateId: 1,
    finalUpdateId: 1,
    bids: levels,
    asks: levels,
    receivedMonotonicNs: '1000',
  }));
  assert.equal(levelBound.status, 'BUFFERING');
  levelBound = apply(levelBound, depthEvent({
    firstUpdateId: 2,
    finalUpdateId: 2,
    bids: [['99999', '1']],
    receivedMonotonicNs: '1001',
  }));
  assert.equal(levelBound.status, 'REQUIRES_CHECKPOINT');
  assert.equal(levelBound.continuity, 'BUFFER_LIMIT_REACHED');

  const longLevels = Array.from({ length: 4_200 }, (_, index) => [
    `1${String(index).padStart(127, '0')}`,
    '9'.repeat(128),
  ]);
  const byteBound = apply(createDepthState(), depthEvent({
    firstUpdateId: 1,
    finalUpdateId: 1,
    bids: longLevels,
    receivedMonotonicNs: '1000',
  }));
  assert.equal(byteBound.status, 'REQUIRES_CHECKPOINT');
  assert.equal(byteBound.continuity, 'BUFFER_LIMIT_REACHED');
  assert.equal(byteBound.bufferedDiffCount, 0);
});

test('depth reducer accepts contiguous and overlapping coverage and deletes zero-quantity levels', () => {
  let state = createDepthState();
  state = apply(state, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [
      ['100.00000000', '1.00000000'],
      ['99.00000000', '2.00000000'],
    ],
    asks: [
      ['101.00000000', '3.00000000'],
      ['102.00000000', '4.00000000'],
    ],
  }));
  state = apply(state, depthEvent({
    firstUpdateId: 501,
    finalUpdateId: 502,
    receivedMonotonicNs: '1100',
    bids: [['100.00000000', '1.50000000']],
  }));
  assert.equal(state.lastUpdateId, 502);

  state = apply(state, depthEvent({
    firstUpdateId: 502,
    finalUpdateId: 504,
    receivedMonotonicNs: '1200',
    bids: [['99.00000000', '0.00000000']],
    asks: [['101.00000000', '0.00000000']],
  }));

  assert.equal(state.status, 'SYNCHRONIZED');
  assert.equal(state.continuity, 'CONTIGUOUS');
  assert.equal(state.lastUpdateId, 504);
  assert.deepEqual(state.bids, [['100.00000000', '1.50000000']]);
  assert.deepEqual(state.asks, [['102.00000000', '4.00000000']]);
});

test('depth reducer fails closed on a sequence gap and does not silently accept later updates', () => {
  let state = createDepthState();
  state = apply(state, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [['100.00000000', '1.00000000']],
    asks: [['101.00000000', '1.00000000']],
  }));
  state = apply(state, depthEvent({
    firstUpdateId: 501,
    finalUpdateId: 501,
    receivedMonotonicNs: '1100',
  }));
  state = apply(state, depthEvent({
    firstUpdateId: 503,
    finalUpdateId: 503,
    receivedMonotonicNs: '1200',
  }));

  assert.equal(state.status, 'GAPPED');
  assert.equal(state.continuity, 'GAP_DETECTED');
  assert.equal(state.lastUpdateId, 501);

  const afterGap = apply(state, depthEvent({
    firstUpdateId: 502,
    finalUpdateId: 504,
    receivedMonotonicNs: '1300',
  }));
  assert.equal(afterGap.status, 'GAPPED');
  assert.equal(afterGap.lastUpdateId, 501);
});

test('depth reducer fences stale monotonic receive times and foreign connection generations', () => {
  let state = createDepthState();
  state = apply(state, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '2000',
    bids: [['100.00000000', '1.00000000']],
    asks: [['101.00000000', '1.00000000']],
  }));

  const staleClock = apply(state, depthEvent({
    firstUpdateId: 501,
    finalUpdateId: 501,
    receivedMonotonicNs: '1999',
  }));
  assert.equal(staleClock.status, 'FENCED');
  assert.equal(staleClock.continuity, 'NON_MONOTONIC_RECEIVE_CLOCK');
  assert.equal(staleClock.lastUpdateId, 500);

  const foreignGeneration = apply(state, depthEvent({
    generation: GENERATION + 1,
    firstUpdateId: 501,
    finalUpdateId: 501,
    receivedMonotonicNs: '2001',
  }));
  assert.equal(foreignGeneration.status, 'FENCED');
  assert.equal(foreignGeneration.continuity, 'GENERATION_MISMATCH');
  assert.equal(foreignGeneration.lastUpdateId, 500);
});

test('depth reducer rejects a crossed book instead of publishing synchronized depth', () => {
  let state = createDepthState();
  state = apply(state, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [['100.00000000', '1.00000000']],
    asks: [['101.00000000', '1.00000000']],
  }));
  state = apply(state, depthEvent({
    firstUpdateId: 501,
    finalUpdateId: 501,
    receivedMonotonicNs: '1100',
    bids: [['102.00000000', '1.00000000']],
  }));

  assert.equal(state.status, 'INVALID_BOOK');
  assert.equal(state.continuity, 'CROSSED_BOOK');
  assert.equal(state.lastUpdateId, 500);
});

test('bookTicker is not accepted as diff-depth continuity or a synchronized book substitute', () => {
  let state = createDepthState();
  state = apply(state, depthSnapshot({
    lastUpdateId: 500,
    receivedMonotonicNs: '1000',
    bids: [['100.00000000', '1.00000000']],
    asks: [['101.00000000', '1.00000000']],
  }));

  const afterBookTicker = apply(state, {
    kind: 'BOOK_TICKER',
    generation: GENERATION,
    receivedMonotonicNs: '1100',
    symbol: SYMBOL,
    updateId: 999,
    bidPrice: '100.50000000',
    bidQuantity: '1.00000000',
    askPrice: '100.60000000',
    askQuantity: '1.00000000',
    receivedAtMs: POLICY_FROZEN_AT_MS + 2_000,
    stream: 'btcusdt@bookTicker',
  });

  assert.equal(afterBookTicker.status, 'BUFFERING');
  assert.equal(afterBookTicker.continuity, 'AWAITING_BRIDGE');
  assert.equal(afterBookTicker.lastUpdateId, 500);
  assert.deepEqual(afterBookTicker.bids, [['100.00000000', '1.00000000']]);
  assert.deepEqual(afterBookTicker.asks, [['101.00000000', '1.00000000']]);
  assert.equal(afterBookTicker.lastInputDisposition, 'BOOK_TICKER_NOT_DEPTH_PROOF');
});
