#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BINANCE_SPOT_VALIDATE_ONLY_DEFAULTS,
  isBinanceSpotQueryResolution,
  isBinanceSpotValidateOnlyPreparation,
  normalizeBinanceSpotInjectedQueryEvidence,
  prepareBinanceSpotValidateOnlyOrder,
} from '../../../../dist/foundation/exchange/binanceSpotValidateOnlyAdapter/index.js';
import {
  deriveBinanceSpotClientOrderId,
} from '../../../../dist/foundation/exchange/binanceSpot/clientOrderId.js';

const T0 = 1_800_000_000_000;
const PUBLIC_OBSERVED_AT = Object.freeze({
  sourceTimeMs: T0 - 100,
  receivedAtMs: T0 - 50,
  maxAgeMs: 1_000,
  authority: 'SYNTHETIC_TEST',
  completeness: 'COMPLETE',
  sourceId: 'binance.spot.public.fixture',
});
const QUERY_OBSERVED_AT = Object.freeze({
  sourceTimeMs: T0 - 20,
  receivedAtMs: T0 - 10,
  maxAgeMs: 500,
  authority: 'SYNTHETIC_TEST',
  completeness: 'COMPLETE',
  sourceId: 'binance.spot.query.fixture',
});

const CLIENT_ORDER_ID = deriveBinanceSpotClientOrderId({
  planId: 'basis-plan-spot-adapter-fixture',
  legId: 'SPOT_OPEN',
  attempt: 0,
});

const FILTERS = Object.freeze([
  Object.freeze({
    filterType: 'PRICE_FILTER',
    minPrice: '1',
    maxPrice: '1000000',
    tickSize: '0.10',
  }),
  Object.freeze({
    filterType: 'LOT_SIZE',
    minQty: '0.001',
    maxQty: '100',
    stepSize: '0.001',
  }),
  Object.freeze({
    filterType: 'MARKET_LOT_SIZE',
    minQty: '0.001',
    maxQty: '50',
    stepSize: '0.001',
  }),
  Object.freeze({
    filterType: 'MIN_NOTIONAL',
    minNotional: '5',
    applyToMarket: true,
    avgPriceMins: 0,
  }),
]);

const VENUE_EVIDENCE = Object.freeze({
  referencePrice: Object.freeze({
    state: 'SET',
    price: '50000',
    providerTimestampMs: 1_800_000_000_000,
  }),
  fallbackPrices: Object.freeze([]),
  executionRules: Object.freeze([
    Object.freeze({
      ruleType: 'PRICE_RANGE',
      bidLimitMultUp: '1.05',
      bidLimitMultDown: '0.95',
      askLimitMultUp: '1.05',
      askLimitMultDown: '0.95',
    }),
  ]),
});

function snapshot(overrides = {}) {
  return Object.freeze({
    snapshotId: 'spot-public-snapshot-1',
    symbol: 'BTCUSDT',
    tradingStatus: 'TRADING',
    completeness: 'COMPLETE_SUPPORTED_FILTER_SET',
    filterObservedAt: PUBLIC_OBSERVED_AT,
    venueEvidenceObservedAt: PUBLIC_OBSERVED_AT,
    filters: FILTERS,
    venueEvidence: VENUE_EVIDENCE,
    ...overrides,
  });
}

function limitOrder(overrides = {}) {
  return Object.freeze({
    planId: 'basis-plan-spot-adapter-fixture',
    legId: 'SPOT_OPEN',
    attempt: 0,
    symbol: 'BTCUSDT',
    clientOrderId: CLIENT_ORDER_ID,
    side: 'BUY',
    type: 'LIMIT',
    quantity: '0.0100',
    price: '50000.00',
    timeInForce: 'GTC',
    ...overrides,
  });
}

function prepare(overrides = {}) {
  return prepareBinanceSpotValidateOnlyOrder({
    evaluatedAtMs: T0,
    publicSnapshot: snapshot(),
    order: limitOrder(),
    policy: Object.freeze({
      enabled: true,
      killSwitchEngaged: false,
      authority: 'NONE',
    }),
    ...overrides,
  });
}

function assertNoCallableField(value, seen = new Set()) {
  assert.notEqual(typeof value, 'function');
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const item of Object.values(value)) assertNoCallableField(item, seen);
}

test('defaults remain OFF, kill-switch ON, authority NONE and inert descriptors stay inspectable', () => {
  assert.deepEqual(BINANCE_SPOT_VALIDATE_ONLY_DEFAULTS, {
    enabled: false,
    killSwitchEngaged: true,
    authority: 'NONE',
  });
  const result = prepareBinanceSpotValidateOnlyOrder({
    evaluatedAtMs: T0,
    publicSnapshot: snapshot(),
    order: limitOrder(),
  });
  assert.equal(isBinanceSpotValidateOnlyPreparation(result), true);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.blockingCodes, [
    'VALIDATE_ONLY_DISABLED',
    'KILL_SWITCH_ENGAGED',
  ]);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.sendEligible, false);
  assert.equal(result.transportCapability, 'ABSENT');
  assert.equal(result.wireIntent?.quantity, '0.01');
  assert.equal(result.wireIntent?.price, '50000');
  assert.equal(result.wireIntent?.clientOrderId, CLIENT_ORDER_ID);
  assert.deepEqual(result.queryDescriptor, {
    kind: 'BINANCE_SPOT_SIGNED_QUERY_DESCRIPTOR',
    descriptorVersion: 1,
    venue: 'BINANCE_SPOT',
    method: 'GET',
    path: '/api/v3/order',
    security: 'SIGNED',
    parameters: {
      symbol: 'BTCUSDT',
      origClientOrderId: CLIENT_ORDER_ID,
    },
    transportCapability: 'ABSENT',
  });
  assert.equal(result.priceRangeRisk?.venueAcceptance, 'NOT_CLAIMED');
  assert.equal(result.priceRangeRisk?.enforcementPhase, 'TAKER_EXECUTION');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.wireIntent), true);
  assert.equal(Object.isFrozen(result.queryDescriptor?.parameters), true);
  assertNoCallableField(result);
});

test('hostile accessors and proxies are rejected without invoking getters or traps', () => {
  let getterCalls = 0;
  const getterInput = {};
  Object.defineProperty(getterInput, 'publicSnapshot', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  Object.defineProperty(getterInput, 'order', {
    enumerable: true,
    value: limitOrder(),
  });
  const getterResult = prepareBinanceSpotValidateOnlyOrder(getterInput);
  assert.equal(getterCalls, 0);
  assert.deepEqual(getterResult.blockingCodes, ['INPUT_NOT_PLAIN_DATA']);

  let proxyTrapCalls = 0;
  const proxyInput = new Proxy(
    {
      evaluatedAtMs: T0,
      publicSnapshot: snapshot(),
      order: limitOrder(),
    },
    {
      get() {
        proxyTrapCalls += 1;
        throw new Error('must not execute');
      },
      getPrototypeOf() {
        proxyTrapCalls += 1;
        throw new Error('must not execute');
      },
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('must not execute');
      },
    },
  );
  const proxyResult = prepareBinanceSpotValidateOnlyOrder(proxyInput);
  assert.equal(proxyTrapCalls, 0);
  assert.deepEqual(proxyResult.blockingCodes, ['INPUT_NOT_PLAIN_DATA']);
  assert.equal(isBinanceSpotValidateOnlyPreparation(proxyResult), true);
});

test('symbol state, snapshot completeness, filter mismatch, and deterministic identity fail closed', () => {
  const halted = prepare({
    publicSnapshot: snapshot({ tradingStatus: 'CANCEL_ONLY' }),
  });
  assert.equal(halted.status, 'BLOCKED');
  assert.equal(halted.blockingCodes.includes('SYMBOL_NOT_TRADING'), true);
  assert.equal(halted.wireIntent, null);

  const partial = prepare({
    publicSnapshot: snapshot({ completeness: 'PARTIAL' }),
  });
  assert.equal(partial.blockingCodes.includes('SNAPSHOT_INCOMPLETE'), true);
  assert.equal(partial.wireIntent, null);

  const tickMismatch = prepare({
    order: limitOrder({ price: '50000.01' }),
  });
  assert.equal(
    tickMismatch.blockingCodes.includes('PUBLIC_FILTER_VALIDATION_FAILED'),
    true,
  );
  assert.equal(
    tickMismatch.filterValidation?.failures.some(
      (failure) => failure.code === 'PRICE_TICK_MISMATCH',
    ),
    true,
  );
  assert.equal(tickMismatch.wireIntent, null);

  const wrongIdentity = prepare({
    order: limitOrder({ clientOrderId: 'supplied-but-not-plan-derived' }),
  });
  assert.equal(
    wrongIdentity.blockingCodes.includes('CLIENT_ORDER_ID_MISMATCH'),
    true,
  );
  assert.equal(wrongIdentity.wireIntent, null);
});

test('stale and future public filter or venue evidence cannot produce descriptors', () => {
  const stale = Object.freeze({
    ...PUBLIC_OBSERVED_AT,
    sourceTimeMs: T0 - 2_000,
    receivedAtMs: T0 - 2_000,
    maxAgeMs: 100,
  });
  const staleFilter = prepare({
    publicSnapshot: snapshot({ filterObservedAt: stale }),
  });
  assert.equal(
    staleFilter.blockingCodes.includes('FILTER_EVIDENCE_STALE'),
    true,
  );
  assert.equal(staleFilter.wireIntent, null);

  const future = Object.freeze({
    ...PUBLIC_OBSERVED_AT,
    sourceTimeMs: T0 + 1,
    receivedAtMs: T0 + 1,
  });
  const futureVenue = prepare({
    publicSnapshot: snapshot({ venueEvidenceObservedAt: future }),
  });
  assert.equal(
    futureVenue.blockingCodes.includes('VENUE_EVIDENCE_CLOCK_SKEWED'),
    true,
  );
  assert.equal(futureVenue.wireIntent, null);
});

test('LIMIT and MARKET wire records contain no provider or mutation capability', () => {
  const limit = prepare();
  assert.equal(limit.status, 'VALIDATED');
  assert.equal(limit.blockingCodes.length, 0);

  const marketId = deriveBinanceSpotClientOrderId({
    planId: 'basis-plan-spot-adapter-fixture',
    legId: 'SPOT_CLOSE',
    attempt: 0,
  });
  const market = prepare({
    order: limitOrder({
      legId: 'SPOT_CLOSE',
      clientOrderId: marketId,
      side: 'SELL',
      type: 'MARKET',
      price: null,
      timeInForce: null,
    }),
  });
  assert.equal(market.status, 'VALIDATED');
  assert.deepEqual(
    {
      type: market.wireIntent?.type,
      price: market.wireIntent?.price,
      timeInForce: market.wireIntent?.timeInForce,
      sendCapability: market.wireIntent?.sendCapability,
    },
    {
      type: 'MARKET',
      price: null,
      timeInForce: null,
      sendCapability: 'ABSENT',
    },
  );
  for (const result of [limit, market]) {
    assertNoCallableField(result);
    assert.equal(JSON.stringify(result).includes('/api/v3/order/test'), false);
    assert.equal(JSON.stringify(result).includes('/api/v3/order/cancel'), false);
    assert.equal(Object.hasOwn(result, 'transport'), false);
  }
});

test('query evidence is normalized only when full exchange identity matches', () => {
  const prepared = prepare();
  const observed = normalizeBinanceSpotInjectedQueryEvidence(prepared, {
    evaluatedAtMs: T0,
    mutationKnowledge: 'KNOWN_SUBMITTED',
    evidence: {
      outcome: 'FOUND',
      observedAt: QUERY_OBSERVED_AT,
      symbol: 'BTCUSDT',
      clientOrderId: CLIENT_ORDER_ID,
      venueOrderId: '918273645',
      side: 'BUY',
      type: 'LIMIT',
      quantity: '0.010',
      price: '50000.0',
      executedQuantity: '0.0040',
      status: 'PARTIALLY_FILLED',
    },
  });
  assert.equal(isBinanceSpotQueryResolution(observed), true);
  assert.equal(observed.state, 'OBSERVED');
  assert.equal(observed.recoveryAction, 'NONE');
  assert.equal(observed.observation?.quantity, '0.01');
  assert.equal(observed.observation?.price, '50000');
  assert.equal(observed.observation?.executedQuantity, '0.004');
  assert.equal(observed.resubmitAllowed, false);
  assert.equal(observed.replacementClientOrderId, null);
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.observation), true);

  const mismatched = normalizeBinanceSpotInjectedQueryEvidence(prepared, {
    evaluatedAtMs: T0,
    mutationKnowledge: 'KNOWN_SUBMITTED',
    evidence: {
      outcome: 'FOUND',
      observedAt: QUERY_OBSERVED_AT,
      symbol: 'BTCUSDT',
      clientOrderId: CLIENT_ORDER_ID,
      venueOrderId: '918273645',
      side: 'SELL',
      type: 'LIMIT',
      quantity: '0.01',
      price: '50000',
      executedQuantity: '0',
      status: 'NEW',
    },
  });
  assert.equal(mismatched.state, 'UNKNOWN');
  assert.equal(mismatched.recoveryAction, 'QUERY_REQUIRED');
  assert.deepEqual(mismatched.reasonCodes, ['QUERY_IDENTITY_MISMATCH']);
  assert.equal(mismatched.clientOrderId, CLIENT_ORDER_ID);
  assert.equal(mismatched.resubmitAllowed, false);
});

test('ambiguous and post-mutation not-found evidence stay UNKNOWN and query-first', () => {
  const prepared = prepare();
  for (const [evidence, mutationKnowledge, expectedReason] of [
    [
      {
        outcome: 'AMBIGUOUS',
        observedAt: QUERY_OBSERVED_AT,
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ORDER_ID,
      },
      'UNCERTAIN',
      'QUERY_AMBIGUOUS',
    ],
    [
      {
        outcome: 'NOT_FOUND',
        observedAt: QUERY_OBSERVED_AT,
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ORDER_ID,
      },
      'UNCERTAIN',
      'QUERY_NOT_FOUND_AFTER_UNCERTAIN_MUTATION',
    ],
    [
      {
        outcome: 'NOT_FOUND',
        observedAt: QUERY_OBSERVED_AT,
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ORDER_ID,
      },
      'KNOWN_SUBMITTED',
      'QUERY_NOT_FOUND_AFTER_MUTATION',
    ],
  ]) {
    const resolution = normalizeBinanceSpotInjectedQueryEvidence(prepared, {
      evaluatedAtMs: T0,
      mutationKnowledge,
      evidence,
    });
    assert.equal(resolution.state, 'UNKNOWN');
    assert.equal(resolution.recoveryAction, 'QUERY_REQUIRED');
    assert.deepEqual(resolution.reasonCodes, [expectedReason]);
    assert.equal(resolution.clientOrderId, CLIENT_ORDER_ID);
    assert.equal(resolution.resubmitAllowed, false);
    assert.equal(resolution.replacementClientOrderId, null);
  }

  const knownAbsent = normalizeBinanceSpotInjectedQueryEvidence(prepared, {
    evaluatedAtMs: T0,
    mutationKnowledge: 'KNOWN_NOT_SUBMITTED',
    evidence: {
      outcome: 'NOT_FOUND',
      observedAt: QUERY_OBSERVED_AT,
      symbol: 'BTCUSDT',
      clientOrderId: CLIENT_ORDER_ID,
    },
  });
  assert.equal(knownAbsent.state, 'ABSENT');
  assert.equal(knownAbsent.recoveryAction, 'NONE');
  assert.equal(knownAbsent.resubmitAllowed, false);
});

test('stale or future query evidence cannot become an order observation', () => {
  const prepared = prepare();
  for (const [observedAt, reason] of [
    [
      Object.freeze({
        ...QUERY_OBSERVED_AT,
        sourceTimeMs: T0 - 2_000,
        receivedAtMs: T0 - 2_000,
        maxAgeMs: 100,
      }),
      'QUERY_EVIDENCE_STALE',
    ],
    [
      Object.freeze({
        ...QUERY_OBSERVED_AT,
        sourceTimeMs: T0 + 1,
        receivedAtMs: T0 + 1,
      }),
      'QUERY_EVIDENCE_CLOCK_SKEWED',
    ],
  ]) {
    const resolution = normalizeBinanceSpotInjectedQueryEvidence(prepared, {
      evaluatedAtMs: T0,
      mutationKnowledge: 'KNOWN_SUBMITTED',
      evidence: {
        outcome: 'FOUND',
        observedAt,
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ORDER_ID,
        venueOrderId: '918273645',
        side: 'BUY',
        type: 'LIMIT',
        quantity: '0.01',
        price: '50000',
        executedQuantity: '0',
        status: 'NEW',
      },
    });
    assert.equal(resolution.state, 'UNKNOWN');
    assert.equal(resolution.observation, null);
    assert.deepEqual(resolution.reasonCodes, [reason]);
  }
});

test('nominal guards reject structural copies and hostile proxies without dereferencing', () => {
  const prepared = prepare();
  const observed = normalizeBinanceSpotInjectedQueryEvidence(prepared, {
    evaluatedAtMs: T0,
    mutationKnowledge: 'KNOWN_NOT_SUBMITTED',
    evidence: {
      outcome: 'NOT_FOUND',
      observedAt: QUERY_OBSERVED_AT,
      symbol: 'BTCUSDT',
      clientOrderId: CLIENT_ORDER_ID,
    },
  });
  assert.equal(
    isBinanceSpotValidateOnlyPreparation(structuredClone(prepared)),
    false,
  );
  assert.equal(isBinanceSpotQueryResolution(structuredClone(observed)), false);

  let trapCalls = 0;
  const proxy = new Proxy(
    {},
    {
      get() {
        trapCalls += 1;
        throw new Error('must not execute');
      },
    },
  );
  assert.equal(isBinanceSpotValidateOnlyPreparation(proxy), false);
  assert.equal(isBinanceSpotQueryResolution(proxy), false);
  assert.equal(trapCalls, 0);
});
