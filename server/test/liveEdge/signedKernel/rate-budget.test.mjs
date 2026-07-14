import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adviseAutomaticReadRetry,
  createRateBudgetState,
  observeRateResponse,
  parseCanonicalBinanceRateHeaders,
  quoteVerifiedEndpointCosts,
  reserveRateBudget,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/rateBudget.js';

const IP = 'egress:prod-a';
const OTHER_IP = 'egress:prod-b';
const ACCOUNT = 'account:execution-a';

function freezeDeep(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) freezeDeep(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function capacity({
  product = 'SPOT', environment = 'PRODUCTION', scopeKind = 'IP', scopeHandle = IP,
  rateKind = 'REQUEST_WEIGHT', interval = 'MINUTE', capacity: limit = 200,
  windowStartedAtMs = 0,
} = {}) {
  const duration = {
    SECOND: 1_000,
    TEN_SECONDS: 10_000,
    MINUTE: 60_000,
    FIVE_MINUTES: 300_000,
    DAY: 86_400_000,
  }[interval];
  return {
    product, environment, scopeKind, scopeHandle, rateKind, interval,
    capacity: limit,
    windowStartedAtMs,
    windowEndsAtMs: windowStartedAtMs + duration,
  };
}

function spotInput(contractId = 'SPOT_OPEN_ORDERS_QUERY', overrides = {}) {
  return {
    contractId,
    product: 'SPOT',
    environment: 'PRODUCTION',
    scopeHandles: { IP, ACCOUNT },
    capacities: [
      capacity(),
      capacity({ scopeKind: 'ACCOUNT', scopeHandle: ACCOUNT, rateKind: 'ORDER_COUNT', capacity: 10 }),
    ],
    atMs: 1_000,
    ...overrides,
  };
}

function usdmOrderInput(overrides = {}) {
  return {
    contractId: 'USDM_ORDER_POST',
    product: 'USD_M_PERPETUAL',
    environment: 'PRODUCTION',
    scopeHandles: { IP, ACCOUNT },
    capacities: [
      capacity({ product: 'USD_M_PERPETUAL' }),
      capacity({
        product: 'USD_M_PERPETUAL', scopeKind: 'ACCOUNT', scopeHandle: ACCOUNT,
        rateKind: 'ORDER_COUNT', interval: 'TEN_SECONDS', capacity: 1,
      }),
      capacity({
        product: 'USD_M_PERPETUAL', scopeKind: 'ACCOUNT', scopeHandle: ACCOUNT,
        rateKind: 'ORDER_COUNT', interval: 'MINUTE', capacity: 10,
      }),
    ],
    atMs: 1_000,
    ...overrides,
  };
}

function costView(contractId, product) {
  return quoteVerifiedEndpointCosts({ contractId, product, environment: 'PRODUCTION' }).costs
    .map((cost) => ({
      kind: cost.rateKind,
      scope: cost.scopeKind,
      interval: cost.claimInterval,
      condition: cost.condition,
      cost: cost.endpointCost,
    }));
}

function observe(state, input, headers, overrides = {}) {
  return observeRateResponse(state, {
    ...input,
    status: 200,
    headers,
    ...overrides,
  });
}

function primeSpot(state = createRateBudgetState(), input = spotInput(), used = '10', atMs = 1_000) {
  const result = observe(state, { ...input, atMs }, { 'X-MBX-USED-WEIGHT-1M': used });
  assert.equal(result.accepted, true);
  return result.state;
}

function primeUsdmOrder(state = createRateBudgetState(), input = usdmOrderInput(), atMs = 1_000) {
  const result = observe(state, { ...input, atMs }, {
    'X-MBX-USED-WEIGHT-1M': '10',
    'X-MBX-ORDER-COUNT-10S': '0',
    'X-MBX-ORDER-COUNT-1M': '0',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.headerTruth, 'VERIFIED');
  return result.state;
}

test('always quotes worst accepted L02 conditional costs and rejects caller-authored condition labels', () => {
  assert.deepEqual(costView('SPOT_TEST_ORDER_POST', 'SPOT'), [
    { kind: 'REQUEST_WEIGHT', scope: 'IP', interval: 'REQUEST', condition: 'COMPUTE_COMMISSION_RATES_TRUE', cost: 20 },
  ]);
  assert.deepEqual(costView('SPOT_OPEN_ORDERS_QUERY', 'SPOT'), [
    { kind: 'REQUEST_WEIGHT', scope: 'IP', interval: 'REQUEST', condition: 'WITHOUT_SYMBOL', cost: 80 },
  ]);
  assert.deepEqual(costView('USDM_OPEN_ORDERS_QUERY', 'USD_M_PERPETUAL'), [
    { kind: 'REQUEST_WEIGHT', scope: 'IP', interval: 'REQUEST', condition: 'WITHOUT_SYMBOL', cost: 40 },
  ]);
  for (const call of [
    () => quoteVerifiedEndpointCosts({
      contractId: 'SPOT_OPEN_ORDERS_QUERY', product: 'SPOT', environment: 'PRODUCTION',
      provedConditions: ['WITH_SYMBOL'],
    }),
    () => reserveRateBudget(createRateBudgetState(), {
      ...spotInput(), provedConditions: ['WITH_SYMBOL'],
    }),
    () => observeRateResponse(createRateBudgetState(), {
      ...spotInput(), provedConditions: ['WITH_SYMBOL'], status: 200, headers: {},
    }),
  ]) assert.throws(call, /unsupported or unsafe fields/);
});

test('pins the accepted L02 matrix to the independent L03 literal and keeps cost separate from capacity', () => {
  const quote = quoteVerifiedEndpointCosts({
    contractId: 'SPOT_OPEN_ORDERS_QUERY', product: 'SPOT', environment: 'PRODUCTION',
  });
  assert.equal(quote.matrixContentSha256, '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac');
  assert.equal(Object.hasOwn(quote.costs[0], 'capacity'), false);
  assert.equal(Object.isFrozen(quote), true);
  assert.throws(
    () => quoteVerifiedEndpointCosts({ contractId: 'USDM_TEST_ORDER_POST', product: 'USD_M_PERPETUAL', environment: 'PRODUCTION' }),
    /not VERIFIED/,
  );
  assert.throws(
    () => quoteVerifiedEndpointCosts({ contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE', product: 'SPOT', environment: 'PRODUCTION' }),
    /REST contract/,
  );
  assert.throws(
    () => quoteVerifiedEndpointCosts({ contractId: 'SPOT_ORDER_POST', product: 'USD_M_PERPETUAL', environment: 'PRODUCTION' }),
    /does not match/,
  );
});

test('empty or missing-header usage is UNKNOWN and blocks until an exact baseline primes the dimension', () => {
  const input = spotInput();
  const initial = createRateBudgetState();
  const blocked = reserveRateBudget(initial, input);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'USAGE_UNKNOWN');
  assert.equal(blocked.state, initial);

  const missing = observe(initial, input, { 'content-type': 'application/json' });
  assert.equal(missing.accepted, false);
  assert.equal(missing.reason, 'USAGE_UNKNOWN');
  assert.equal(missing.headerTruth, 'UNKNOWN');
  assert.equal(missing.state, initial);

  const primed = primeSpot(initial, input);
  const reserved = reserveRateBudget(primed, { ...input, atMs: 1_001 });
  assert.equal(reserved.allowed, true);
  assert.equal(reserved.state.reservations[0].endpointCost, 80);
  assert.equal(reserved.state.reservations[0].capacity, 200);
  assert.equal(reserved.state.reservations[0].key.condition, 'WITHOUT_SYMBOL');
});

test('USD-M request-weight and both order-count dimensions prime and reserve atomically', () => {
  const input = usdmOrderInput();
  const initial = createRateBudgetState();
  assert.equal(reserveRateBudget(initial, input).reason, 'USAGE_UNKNOWN');
  const primed = primeUsdmOrder(initial, input);
  const first = reserveRateBudget(primed, { ...input, atMs: 1_001 });
  assert.equal(first.allowed, true);
  assert.deepEqual(first.state.reservations.map((event) => [event.key.rateKind, event.key.interval, event.endpointCost]), [
    ['ORDER_COUNT', 'MINUTE', 1],
    ['ORDER_COUNT', 'TEN_SECONDS', 1],
    ['REQUEST_WEIGHT', 'MINUTE', 0],
  ]);
  const second = reserveRateBudget(first.state, { ...input, atMs: 1_002 });
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'BUDGET_EXHAUSTED');
  assert.equal(second.state, first.state);
  assert.equal(second.state.reservations.length, 3);

  const missingCapacity = reserveRateBudget(primed, {
    ...input,
    capacities: input.capacities.filter((item) => item.interval !== 'TEN_SECONDS'),
    atMs: 1_001,
  });
  assert.equal(missingCapacity.allowed, false);
  assert.equal(missingCapacity.reason, 'CAPACITY_UNKNOWN');
  assert.equal(missingCapacity.state, primed);
});

test('header observations cannot erase local reservations or accept out-of-order lower counters', () => {
  const input = spotInput();
  const primed = primeSpot(createRateBudgetState(), input, '10');
  const reserved = reserveRateBudget(primed, { ...input, atMs: 1_100 });
  assert.equal(reserved.allowed, true);
  const effectiveNinety = observe(reserved.state, { ...input, atMs: 1_200 }, {
    'X-MBX-USED-WEIGHT-1M': '90',
  });
  assert.equal(effectiveNinety.accepted, true);

  const laterReservation = reserveRateBudget(effectiveNinety.state, { ...input, atMs: 1_300 });
  assert.equal(laterReservation.allowed, true);
  for (const [atMs, used] of [[1_400, '169'], [1_500, '90'], [1_600, '10']]) {
    const lower = observe(laterReservation.state, { ...input, atMs }, {
      'X-MBX-USED-WEIGHT-1M': used,
    });
    assert.equal(lower.accepted, false, used);
    assert.equal(lower.reason, 'HEADER_REGRESSION', used);
    assert.equal(lower.state, laterReservation.state, used);
  }
  const reconciled = observe(laterReservation.state, { ...input, atMs: 1_700 }, {
    'X-MBX-USED-WEIGHT-1M': '170',
  });
  assert.equal(reconciled.accepted, true);
  assert.equal(reconciled.state.headerEvents.at(-1).used, 170);
});

test('a lower counter is valid only in an explicit new aligned window', () => {
  const firstInput = spotInput();
  const high = primeSpot(createRateBudgetState(), firstInput, '190');
  const nextWindowInput = spotInput('SPOT_OPEN_ORDERS_QUERY', {
    atMs: 60_000,
    capacities: [capacity({ windowStartedAtMs: 60_000 })],
  });
  const lower = observe(high, nextWindowInput, { 'X-MBX-USED-WEIGHT-1M': '1' });
  assert.equal(lower.accepted, true);
  assert.equal(lower.state.headerEvents.length, 1);
  assert.equal(lower.state.headerEvents[0].used, 1);
});

test('Spot 429 persists without capacity evidence and gates reservation at the exact non-shortening boundary', () => {
  const input = spotInput();
  const incidentOnly = observeRateResponse(createRateBudgetState(), {
    contractId: input.contractId,
    product: input.product,
    environment: input.environment,
    scopeHandles: input.scopeHandles,
    atMs: 1_000,
    status: 429,
    headers: { 'Retry-After': '5' },
  });
  assert.equal(incidentOnly.accepted, true);
  assert.equal(incidentOnly.reason, 'INCIDENT_RECORDED');
  assert.equal(incidentOnly.nextSafeAtMs, 6_000);
  assert.equal(incidentOnly.state.incidents.length, 1);
  assert.equal(incidentOnly.state.incidents[0].sequence, 1);
  assert.equal(incidentOnly.state.incidents[0].status, 'COOLDOWN');

  const shorter = observeRateResponse(incidentOnly.state, {
    contractId: input.contractId,
    product: input.product,
    environment: input.environment,
    scopeHandles: input.scopeHandles,
    atMs: 2_000,
    status: 429,
    headers: { 'Retry-After': '1' },
  });
  assert.equal(shorter.nextSafeAtMs, 6_000);
  assert.equal(reserveRateBudget(shorter.state, { ...input, atMs: 5_999 }).reason, 'COOLDOWN');
  const boundary = reserveRateBudget(shorter.state, { ...input, atMs: 6_000 });
  assert.equal(boundary.allowed, false);
  assert.equal(boundary.reason, 'USAGE_UNKNOWN');

  const primed = primeSpot(shorter.state, { ...input, atMs: 6_000 }, '10', 6_000);
  assert.equal(reserveRateBudget(primed, { ...input, atMs: 6_001 }).allowed, true);

  const unalignedFirst = observeRateResponse(createRateBudgetState(), {
    contractId: input.contractId,
    product: input.product,
    environment: input.environment,
    scopeHandles: input.scopeHandles,
    atMs: 1_001,
    status: 429,
    headers: { 'Retry-After': '5' },
  });
  const unalignedPreserved = observeRateResponse(unalignedFirst.state, {
    contractId: input.contractId,
    product: input.product,
    environment: input.environment,
    scopeHandles: input.scopeHandles,
    atMs: 2_000,
    status: 429,
    headers: { 'Retry-After': '1' },
  });
  assert.equal(unalignedPreserved.nextSafeAtMs, 6_001);
  assert.equal(
    reserveRateBudget(unalignedPreserved.state, { ...input, atMs: 6_000 }).reason,
    'COOLDOWN',
  );
});

test('USD-M Retry-After stays unproved and 418 remains manual even without capacity evidence', () => {
  const usdInput = {
    contractId: 'USDM_OPEN_ORDERS_QUERY', product: 'USD_M_PERPETUAL', environment: 'PRODUCTION',
    scopeHandles: { IP }, atMs: 1_000,
  };
  const usd = observeRateResponse(createRateBudgetState(), {
    ...usdInput,
    status: 429,
    headers: { 'Retry-After': '5' },
  });
  assert.equal(usd.retryAfterTruth, 'UNPROVED_FOR_PRODUCT');
  assert.equal(usd.nextSafeAtMs, null);
  assert.equal(usd.state.incidents[0].status, 'COOLDOWN');
  const usdReserve = reserveRateBudget(usd.state, {
    ...usdInput,
    capacities: [capacity({ product: 'USD_M_PERPETUAL' })],
    atMs: 2_000,
  });
  assert.equal(usdReserve.reason, 'COOLDOWN');

  const spot = spotInput();
  const banned = observeRateResponse(createRateBudgetState(), {
    contractId: spot.contractId, product: spot.product, environment: spot.environment,
    scopeHandles: spot.scopeHandles, atMs: 1_000, status: 418, headers: { 'Retry-After': '5' },
  });
  assert.equal(banned.state.incidents[0].status, 'OPEN_MANUAL');
  assert.equal(banned.state.incidents[0].httpStatus, 418);
  assert.equal(banned.nextSafeAtMs, null);
  assert.equal(reserveRateBudget(banned.state, { ...spot, atMs: 59_999 }).reason, 'CIRCUIT_OPEN');

  const later429 = observeRateResponse(banned.state, {
    contractId: spot.contractId, product: spot.product, environment: spot.environment,
    scopeHandles: spot.scopeHandles, atMs: 2_000, status: 429, headers: { 'Retry-After': '1' },
  });
  assert.equal(later429.state.incidents[0].status, 'OPEN_MANUAL');
  assert.equal(later429.nextSafeAtMs, null);
});

test('rate incidents are isolated by product, environment and opaque scope handle', () => {
  const aInput = spotInput();
  const incident = observeRateResponse(createRateBudgetState(), {
    contractId: aInput.contractId, product: 'SPOT', environment: 'PRODUCTION',
    scopeHandles: { IP }, atMs: 1_000, status: 429, headers: {},
  });
  assert.equal(reserveRateBudget(incident.state, { ...aInput, atMs: 2_000 }).reason, 'COOLDOWN');

  const bInput = spotInput('SPOT_OPEN_ORDERS_QUERY', {
    scopeHandles: { IP: OTHER_IP },
    capacities: [capacity({ scopeHandle: OTHER_IP })],
  });
  const primedB = observe(incident.state, bInput, { 'X-MBX-USED-WEIGHT-1M': '0' });
  assert.equal(primedB.accepted, true);
  assert.equal(reserveRateBudget(primedB.state, { ...bInput, atMs: 2_001 }).allowed, true);

  const wrongEnvironmentCapacity = reserveRateBudget(createRateBudgetState(), {
    ...aInput,
    capacities: [capacity({ environment: 'TESTNET' })],
  });
  assert.equal(wrongEnvironmentCapacity.reason, 'CAPACITY_UNKNOWN');

  const credentialShapedHandle = 'A'.repeat(64);
  assert.throws(() => reserveRateBudget(createRateBudgetState(), {
    ...aInput,
    scopeHandles: { IP: credentialShapedHandle },
    capacities: [capacity({ scopeHandle: credentialShapedHandle })],
  }), /bounded opaque identifier/);
  assert.throws(() => observeRateResponse(createRateBudgetState(), {
    contractId: aInput.contractId,
    product: aInput.product,
    environment: aInput.environment,
    scopeHandles: { IP: credentialShapedHandle },
    atMs: 1_000,
    status: 429,
    headers: {},
  }), /bounded opaque identifier/);
});

test('state validation rejects forged cost, provenance, identity, action sequence and empty nonzero state', () => {
  const input = spotInput();
  const primed = primeSpot(createRateBudgetState(), input);
  const valid = reserveRateBudget(primed, { ...input, atMs: 1_100 }).state;

  const forgeries = [];
  const lowerCost = structuredClone(valid);
  lowerCost.reservations[0].endpointCost = 6;
  lowerCost.reservations[0].key.condition = 'WITH_SYMBOL';
  forgeries.push(lowerCost);
  const source = structuredClone(valid);
  source.reservations[0].sourceId = 'SPOT_GENERAL_CATALOG_2026_07_12';
  forgeries.push(source);
  const product = structuredClone(valid);
  product.reservations[0].key.product = 'USD_M_PERPETUAL';
  forgeries.push(product);
  const sequence = structuredClone(valid);
  sequence.sequence += 1;
  forgeries.push(sequence);
  const time = structuredClone(valid);
  time.lastEventAtMs += 1;
  forgeries.push(time);
  forgeries.push({
    schema: 'BINANCE_RATE_BUDGET_V2', sequence: 1, lastEventAtMs: 1,
    reservations: [], headerEvents: [], incidents: [],
  });

  for (const forged of forgeries) {
    assert.throws(() => reserveRateBudget(freezeDeep(forged), { ...input, atMs: 1_200 }), /rate|L02|contract|state/i);
  }

  const reconciled = observe(valid, { ...input, atMs: 1_200 }, {
    'X-MBX-USED-WEIGHT-1M': '90',
  }).state;
  const forgedHeaderHistory = structuredClone(reconciled);
  forgedHeaderHistory.headerEvents.at(-1).used = 10;
  assert.throws(
    () => reserveRateBudget(freezeDeep(forgedHeaderHistory), { ...input, atMs: 1_300 }),
    /header history regressed/,
  );

  const incident = observeRateResponse(createRateBudgetState(), {
    contractId: input.contractId, product: input.product, environment: input.environment,
    scopeHandles: { IP }, atMs: 1_000, status: 429, headers: {},
  }).state;
  const missingIncidentSequence = structuredClone(incident);
  delete missingIncidentSequence.incidents[0].sequence;
  assert.throws(() => reserveRateBudget(freezeDeep(missingIncidentSequence), input), /missing|required|incident/i);

  const expiredIncident = structuredClone(incident);
  expiredIncident.incidents[0].nextSafeAtMs = expiredIncident.incidents[0].updatedAtMs;
  assert.throws(() => reserveRateBudget(freezeDeep(expiredIncident), input), /incident/i);
  const nonWholeSecond = structuredClone(incident);
  nonWholeSecond.incidents[0].nextSafeAtMs = nonWholeSecond.incidents[0].updatedAtMs + 1;
  assert.throws(() => reserveRateBudget(freezeDeep(nonWholeSecond), input), /incident/i);
  const overCap = structuredClone(incident);
  overCap.incidents[0].nextSafeAtMs = overCap.incidents[0].updatedAtMs + 259_201_000;
  assert.throws(() => reserveRateBudget(freezeDeep(overCap), input), /incident/i);

  const usdIncident = observeRateResponse(createRateBudgetState(), {
    contractId: 'USDM_OPEN_ORDERS_QUERY', product: 'USD_M_PERPETUAL', environment: 'PRODUCTION',
    scopeHandles: { IP }, atMs: 1_000, status: 429, headers: {},
  }).state;
  const forgedUsdBoundary = structuredClone(usdIncident);
  forgedUsdBoundary.incidents[0].nextSafeAtMs = 6_000;
  assert.throws(() => reserveRateBudget(freezeDeep(forgedUsdBoundary), {
    contractId: 'USDM_OPEN_ORDERS_QUERY', product: 'USD_M_PERPETUAL', environment: 'PRODUCTION',
    scopeHandles: { IP }, capacities: [capacity({ product: 'USD_M_PERPETUAL' })], atMs: 2_000,
  }), /incident/i);
});

test('canonical headers reject unsafe integers, syntax, duplicates, accessors and inherited records', () => {
  assert.deepEqual(parseCanonicalBinanceRateHeaders('SPOT', {
    'X-MBX-USED-WEIGHT-1M': '12',
    'X-MBX-ORDER-COUNT-10S': '3',
    'Retry-After': '5',
  }), {
    observations: [
      { rateKind: 'ORDER_COUNT', scopeKind: 'ACCOUNT', interval: 'TEN_SECONDS', used: 3 },
      { rateKind: 'REQUEST_WEIGHT', scopeKind: 'IP', interval: 'MINUTE', used: 12 },
    ],
    retryAfterTruth: 'VERIFIED',
    retryAfterDeltaMs: 5_000,
  });
  for (const value of [' 1', '1 ', '+1', '-1', '1.0', '1e2', '01', '9007199254740992']) {
    assert.throws(() => parseCanonicalBinanceRateHeaders('SPOT', {
      'X-MBX-USED-WEIGHT-1M': value,
    }), /canonical/, value);
  }
  assert.throws(() => parseCanonicalBinanceRateHeaders('SPOT', {
    'X-MBX-USED-WEIGHT-1M': '1', 'x-mbx-used-weight-1m': '1',
  }), /case-duplicate/);
  assert.throws(() => parseCanonicalBinanceRateHeaders('SPOT', {
    'X-MBX-USED-WEIGHT': '1',
  }), /name is not canonical/);
  const accessor = {};
  Object.defineProperty(accessor, 'X-MBX-USED-WEIGHT-1M', { enumerable: true, get() { throw new Error('secret'); } });
  assert.throws(() => parseCanonicalBinanceRateHeaders('SPOT', accessor), /data properties/);
  assert.throws(() => parseCanonicalBinanceRateHeaders('SPOT', Object.create({ inherited: 'x' })), /plain object/);
});

test('Retry-After accepts only bounded positive Spot delta-seconds', () => {
  for (const value of ['0', ' 5', '5 ', '+5', '1.5', '259201', 'Sun, 06 Nov 1994 08:49:37 GMT']) {
    assert.equal(parseCanonicalBinanceRateHeaders('SPOT', { 'Retry-After': value }).retryAfterTruth, 'UNKNOWN');
  }
  assert.deepEqual(parseCanonicalBinanceRateHeaders('USD_M_PERPETUAL', { 'Retry-After': '5' }), {
    observations: [], retryAfterTruth: 'UNPROVED_FOR_PRODUCT', retryAfterDeltaMs: null,
  });
});

test('clock regression and capacity drift block without mutating accepted state', () => {
  const input = spotInput();
  const primed = primeSpot(createRateBudgetState(), { ...input, atMs: 2_000 }, '10', 2_000);
  const reserved = reserveRateBudget(primed, { ...input, atMs: 2_100 });
  const regression = reserveRateBudget(reserved.state, { ...input, atMs: 2_099 });
  assert.equal(regression.reason, 'CLOCK_REGRESSION');
  assert.equal(regression.state, reserved.state);
  const drift = reserveRateBudget(reserved.state, {
    ...input, capacities: [capacity({ capacity: 201 })], atMs: 2_101,
  });
  assert.equal(drift.reason, 'CAPACITY_UNKNOWN');
  assert.equal(drift.state, reserved.state);

  const incidentWithDrift = observeRateResponse(reserved.state, {
    ...input,
    capacities: [capacity({ capacity: 201 })],
    atMs: 2_101,
    status: 429,
    headers: { 'X-MBX-USED-WEIGHT-1M': '90', 'Retry-After': '5' },
  });
  assert.equal(incidentWithDrift.accepted, true);
  assert.equal(incidentWithDrift.reason, 'INCIDENT_RECORDED');
  assert.equal(incidentWithDrift.headerTruth, 'UNKNOWN');
  assert.equal(incidentWithDrift.state.incidents.length, 1);
  assert.equal(incidentWithDrift.state.headerEvents.length, reserved.state.headerEvents.length);
});

test('automatic retry is bounded read-only only and honors persisted incidents', () => {
  const input = spotInput();
  const primed = primeSpot(createRateBudgetState(), input);
  const readState = reserveRateBudget(primed, { ...input, atMs: 1_100 }).state;
  const base = {
    contractId: input.contractId, product: 'SPOT', environment: 'PRODUCTION',
    scopeHandles: { IP }, atMs: 1_200, outcome: 'NETWORK_FAILURE', attemptsUsed: 1, maximumAttempts: 2,
  };
  assert.deepEqual(adviseAutomaticReadRetry(readState, base), {
    automatic: true, reason: 'READ_ONLY_RETRY', retryAtMs: 1_200, remainingAttempts: 1,
  });
  assert.equal(adviseAutomaticReadRetry(readState, { ...base, outcome: 'AMBIGUOUS' }).reason, 'AMBIGUOUS_BLOCKED');
  assert.equal(adviseAutomaticReadRetry(readState, { ...base, attemptsUsed: 2 }).reason, 'ATTEMPT_LIMIT');
  assert.throws(() => adviseAutomaticReadRetry(readState, { ...base, maximumAttempts: 4 }), /bound/);

  for (const contractId of ['SPOT_ORDER_POST', 'SPOT_TEST_ORDER_POST', 'SPOT_ORDER_CANCEL']) {
    const advice = adviseAutomaticReadRetry(createRateBudgetState(), { ...base, contractId, outcome: 'NOT_SENT' });
    assert.equal(advice.automatic, false, contractId);
    assert.equal(advice.reason, 'MUTATION_BLOCKED', contractId);
  }
  assert.equal(adviseAutomaticReadRetry(createRateBudgetState(), {
    ...base, contractId: 'MARGIN_OPEN_ORDERS_QUERY', product: 'MARGIN',
  }).reason, 'MARGIN_BLOCKED');
  assert.equal(adviseAutomaticReadRetry(createRateBudgetState(), {
    ...base, contractId: 'USDM_LISTEN_KEY_POST', product: 'USD_M_PERPETUAL',
  }).reason, 'PRIVATE_STREAM_BLOCKED');

  assert.equal(adviseAutomaticReadRetry(readState, {
    ...base,
    contractId: 'SPOT_ALL_ORDERS_QUERY',
  }).reason, 'RATE_STATE_UNKNOWN');

  const nearLimitPrimed = primeSpot(createRateBudgetState(), input, '100');
  const effectiveOneEighty = reserveRateBudget(nearLimitPrimed, { ...input, atMs: 1_100 }).state;
  assert.deepEqual(adviseAutomaticReadRetry(effectiveOneEighty, base), {
    automatic: true,
    reason: 'READ_ONLY_RETRY',
    retryAtMs: 60_000,
    remainingAttempts: 1,
  });

  const limited = observeRateResponse(readState, {
    contractId: input.contractId, product: input.product, environment: input.environment,
    scopeHandles: { IP }, atMs: 1_300, status: 429, headers: { 'Retry-After': '5' },
  });
  assert.deepEqual(adviseAutomaticReadRetry(limited.state, {
    ...base, atMs: 1_400, outcome: 'HTTP_429',
  }), {
    automatic: true, reason: 'READ_ONLY_RETRY', retryAtMs: 6_300, remainingAttempts: 1,
  });
  const unknown = observeRateResponse(readState, {
    contractId: input.contractId, product: input.product, environment: input.environment,
    scopeHandles: { IP }, atMs: 1_300, status: 429, headers: {},
  });
  assert.equal(adviseAutomaticReadRetry(unknown.state, {
    ...base, atMs: 1_400, outcome: 'HTTP_429',
  }).reason, 'COOLDOWN_UNKNOWN');
});

test('caller states and results are deeply frozen and independent', () => {
  const a = createRateBudgetState();
  const b = createRateBudgetState();
  const primed = primeSpot(a);
  assert.equal(a.sequence, 0);
  assert.equal(b.sequence, 0);
  assert.equal(primed.sequence, 1);
  assert.equal(Object.isFrozen(primed), true);
  assert.equal(Object.isFrozen(primed.headerEvents), true);
  assert.equal(Object.isFrozen(primed.headerEvents[0].key), true);
  const mutableClone = structuredClone(primed);
  assert.throws(() => reserveRateBudget(mutableClone, { ...spotInput(), atMs: 1_001 }), /deeply frozen/);
  const blocked = reserveRateBudget(primed, { ...spotInput(), capacities: [], atMs: 1_001 });
  assert.equal(blocked.state, primed);
});

test('active and revoked proxies fail closed before any trap is invoked', () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    get() { traps += 1; throw new Error('secret-bearing get trap'); },
    getPrototypeOf() { traps += 1; throw new Error('secret-bearing prototype trap'); },
    ownKeys() { traps += 1; throw new Error('secret-bearing ownKeys trap'); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error('secret-bearing descriptor trap'); },
  });
  assert.throws(() => quoteVerifiedEndpointCosts(hostile), /plain object/);
  assert.throws(() => reserveRateBudget(hostile, {}), /plain object/);
  assert.throws(() => parseCanonicalBinanceRateHeaders('SPOT', hostile), /plain object/);
  assert.throws(() => reserveRateBudget(createRateBudgetState(), {
    ...spotInput(), capacities: hostile,
  }), /bounded array/);
  assert.equal(traps, 0);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(() => quoteVerifiedEndpointCosts(revoked.proxy), /plain object/);
  assert.equal(traps, 0);
});
