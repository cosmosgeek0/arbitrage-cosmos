import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  USDM_LISTEN_KEY_LIFETIME_MS,
  USDM_PRIVATE_CONNECTION_LIFETIME_MS,
  USDM_PRIVATE_DOCUMENTARY_CONTRACTS,
  USDM_PRIVATE_DEFAULT_ACCOUNT_REALM_ID,
  USDM_PRIVATE_EVENT_KINDS,
  USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES,
  USDM_PRIVATE_LIFECYCLE_PHASES,
  USDM_PRIVATE_MATRIX_SHA256,
  USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS,
  USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS,
  USDM_PRIVATE_ROUTE_CLASSES,
  USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS,
  createInitialUsdmPrivateLifecycleState,
  createPrivateLifecycleWitness,
  mapUsdmPrivateEventSemantics,
  reduceUsdmPrivateLifecycle as reduceUsdmPrivateLifecycleRaw,
  validateUsdmPrivateLifecycleState,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';
import {
  createUsdmRealmBoundRevision,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/usdmLifecycle.js';

const T0 = 1_800_000_000_000;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const ACCOUNT_REALM = 'account-realm-synthetic-a';
const OTHER_ACCOUNT_REALM = 'account-realm-synthetic-b';

const OFFICIAL_ACCOUNT_UPDATE_FIXTURE = Object.freeze({
  e: 'ACCOUNT_UPDATE',
  E: T0 + 1_000,
  T: T0 + 900,
  a: Object.freeze({
    m: 'ORDER',
    B: Object.freeze([Object.freeze({ a: 'USDT', wb: '25.00000000', cw: '25.00000000', bc: '0.00000000' })]),
    P: Object.freeze([Object.freeze({
      s: 'BTCUSDT', pa: '0.001', ep: '50000.0', cr: '0', up: '0.10',
      mt: 'cross', iw: '0', ps: 'BOTH',
    })]),
  }),
});

const OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE = Object.freeze({
  e: 'ORDER_TRADE_UPDATE',
  E: T0 + 1_100,
  T: T0 + 1_000,
  o: Object.freeze({
    s: 'BTCUSDT', c: 'synthetic-order-1', S: 'BUY', o: 'LIMIT', f: 'GTC',
    q: '0.001', p: '50000.0', ap: '50000.0', sp: '0', x: 'TRADE', X: 'FILLED',
    i: 101, l: '0.001', z: '0.001', L: '50000.0', N: 'USDT', n: '0.01000000',
    t: 202, b: '0', a: '0', m: false, R: false, wt: 'CONTRACT_PRICE',
    ot: 'LIMIT', ps: 'BOTH', cp: false, pP: false, rp: '0.10', pm: 'NONE',
    gtd: 0, V: 'EXPIRE_MAKER',
  }),
});

const OFFICIAL_TRADE_LITE_FIXTURE = Object.freeze({
  e: 'TRADE_LITE',
  E: T0 + 1_200,
  T: T0 + 1_100,
  s: 'BTCUSDT',
  q: '0.001',
  p: '50000.0',
  m: false,
  c: 'synthetic-order-1',
  S: 'BUY',
  L: '50000.0',
  l: '0.001',
  t: 202,
  i: 101,
});

function reduceUsdmPrivateLifecycle(state, action) {
  return reduceUsdmPrivateLifecycleRaw(state, {
    accountRealmId: state?.accountRealmId ?? ACCOUNT_REALM,
    ...action,
  });
}

function eventRevision({
  accountRealmId = ACCOUNT_REALM,
  generation = 1,
  eventKind = 'ACCOUNT_UPDATE',
  exchangeEventTimeMs = T0 + 1_000,
  transactionTimeMs = T0 + 900,
  receiptTimeMs = T0 + 1_100,
  contentRevision = `usdm_content_${'1'.repeat(32)}`,
  orderExecutionType = eventKind === 'ORDER_TRADE_UPDATE' ? 'NEW' : null,
} = {}) {
  const semantics = mapUsdmPrivateEventSemantics(eventKind, orderExecutionType);
  assert.notEqual(semantics, null, 'revision helper requires closed USD-M event semantics');
  return createUsdmRealmBoundRevision('usdm_event', accountRealmId, {
    generation,
    eventKind,
    contentRevision,
    exchangeEventTimeMs,
    transactionTimeMs,
    ...semantics,
    receiptTimeMs,
  });
}

function restRevision({
  accountRealmId = ACCOUNT_REALM,
  generation = 1,
  reconciledAtMs = T0 + 100,
  validUntilMs = reconciledAtMs + 1_000,
  throughExchangeEventTimeMs = reconciledAtMs,
  throughEventRevision = null,
} = {}) {
  return createUsdmRealmBoundRevision('usdm_rest', accountRealmId, {
    generation,
    reconciledAtMs,
    validUntilMs,
    throughExchangeEventTimeMs,
    throughEventRevision,
  });
}

function canonicalStateValue(value) {
  if (Array.isArray(value)) return value.map(canonicalStateValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.keys(value).sort().map((field) => [field, canonicalStateValue(value[field])]);
}

function withRecomputedUsdmStateCommitment(value) {
  const state = structuredClone(value);
  const content = Object.keys(state)
    .filter((field) => field !== 'stateContentRevision')
    .sort()
    .map((field) => [field, canonicalStateValue(state[field])]);
  state.stateContentRevision = `usdm_state_${createHash('sha256')
    .update(JSON.stringify(['L05_USDM_PRIVATE_STATE_CONTENT_V1', content]))
    .digest('hex')}`;
  return state;
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function assertNoAuthority(state) {
  assert.equal(state.sendEligible, false);
  assert.equal(state.externalActionAuthorization, 'NONE');
  assert.equal(state.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(state.accountReadAuthorized, false);
  assert.equal(state.mutationAuthorized, false);
  assert.equal(state.reconciliationAuthority, 'NONE');
  assert.equal(state.capitalAuthority, 'NONE');
  assert.equal(state.riskAuthority, 'NONE');
  for (const readinessField of ['ready', 'readiness', 'tradeReady', 'entryReady']) {
    assert.equal(Object.hasOwn(state, readinessField), false);
  }
}

function expectApplied(result) {
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.reasonCode, undefined);
  assertDeeplyFrozen(result);
  assertNoAuthority(result.state);
  const validated = validateUsdmPrivateLifecycleState(result.state);
  assert.notEqual(validated, null, 'every applied state must pass the exported validator');
  assert.deepEqual(validated, result.state);
  return result.state;
}

function expectRejected(result, reasonCode) {
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, reasonCode);
  assertDeeplyFrozen(result);
  if (result.state !== null) assertNoAuthority(result.state);
  return result.state;
}

function initial(at = T0, accountRealmId = ACCOUNT_REALM) {
  return createInitialUsdmPrivateLifecycleState(at, accountRealmId);
}

function postLease(state = initial(), at = T0, leaseGeneration = 1) {
  return expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_POST_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration,
    observedAtMs: at,
  }));
}

function putLease(state, at, leaseGeneration = state.leaseGeneration) {
  return expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration,
    observedAtMs: at,
  }));
}

function openConnection(
  state = postLease(),
  contractId = USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
  at = state.lastEvaluatedAtMs,
  generation = state.generation + 1,
  reconnectBeforeMs = at + 23 * HOUR_MS,
) {
  return expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'CONNECTION_OPENED',
    contractId,
    generation,
    observedAtMs: at,
    reconnectBeforeMs,
  }));
}

function authenticate(state, at = state.lastEvaluatedAtMs + 1) {
  return expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'ROUTE_AUTHENTICATED',
    contractId: state.routeContractId,
    generation: state.generation,
    observedAtMs: at,
  }));
}

function subscribe(state, at = state.lastEvaluatedAtMs + 1) {
  return expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'STREAM_SUBSCRIBED',
    contractId: state.routeContractId,
    generation: state.generation,
    observedAtMs: at,
  }));
}

function subscribedState(contractId = USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute) {
  return subscribe(authenticate(openConnection(postLease(), contractId)));
}

function privateEvent(state, overrides = {}) {
  const eventKind = overrides.eventKind ?? 'ACCOUNT_UPDATE';
  const orderExecutionType = Object.hasOwn(overrides, 'orderExecutionType')
    ? overrides.orderExecutionType
    : eventKind === 'ORDER_TRADE_UPDATE' ? 'NEW' : null;
  const semantics = mapUsdmPrivateEventSemantics(eventKind, orderExecutionType) ?? {
    semanticCategory: 'OTHER',
    orderExecutionType: null,
    isFill: false,
  };
  const action = {
    kind: 'PRIVATE_EVENT_OBSERVED',
    generation: state.generation,
    eventKind,
    ...semantics,
    exchangeEventTimeMs: T0 + 1_000,
    transactionTimeMs: T0 + 900,
    receiptTimeMs: T0 + 1_100,
    contentRevision: `usdm_content_${'1'.repeat(32)}`,
    ...overrides,
  };
  if (!Object.hasOwn(action, 'eventRevision')) {
    const revisionSemantics = mapUsdmPrivateEventSemantics(
      action.eventKind,
      action.orderExecutionType,
    );
    action.eventRevision = revisionSemantics === null
      ? eventRevision()
      : createUsdmRealmBoundRevision('usdm_event', state.accountRealmId, {
          generation: action.generation,
          eventKind: action.eventKind,
          contentRevision: action.contentRevision,
          exchangeEventTimeMs: action.exchangeEventTimeMs,
          transactionTimeMs: action.transactionTimeMs,
          ...revisionSemantics,
          receiptTimeMs: action.receiptTimeMs,
        });
  }
  return reduceUsdmPrivateLifecycle(state, action);
}

function ownerRestCut(state, overrides = {}) {
  const reconciledAtMs = state.lastEvaluatedAtMs + 100;
  const action = {
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED',
    generation: state.generation,
    reconciledAtMs,
    validUntilMs: reconciledAtMs + 1_000,
    throughExchangeEventTimeMs: state.lastExchangeEventTimeMs ?? reconciledAtMs,
    throughEventRevision: state.recentEventMarkers.at(-1)?.eventRevision ?? null,
    ...overrides,
  };
  if (!Object.hasOwn(action, 'reconciliationRevision')) {
    action.reconciliationRevision = createUsdmRealmBoundRevision(
      'usdm_rest',
      state.accountRealmId,
      {
        generation: action.generation,
        reconciledAtMs: action.reconciledAtMs,
        validUntilMs: action.validUntilMs,
        throughExchangeEventTimeMs: action.throughExchangeEventTimeMs,
        throughEventRevision: action.throughEventRevision,
      },
    );
  }
  return reduceUsdmPrivateLifecycle(state, action);
}

function keepLeaseThrough(state, throughMs) {
  let current = state;
  while (current.leaseValidUntilMs < throughMs) {
    current = putLease(current, current.leaseValidUntilMs);
  }
  return current;
}

test('initial state binds exact L02 USD-M identity and is inert, immutable, and non-authoritative', () => {
  const state = initial();
  assert.equal(state.schema, 'BINANCE_USDM_PRIVATE_LIFECYCLE_V1');
  assert.equal(state.version, 1);
  assert.equal(state.matrixSha256, '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac');
  assert.equal(state.product, 'USD_M_PERPETUAL');
  assert.equal(state.environment, 'PRODUCTION');
  assert.equal(state.realm, 'PRIVATE_USER_DATA');
  assert.equal(state.accountRealmId, ACCOUNT_REALM);
  assert.equal(state.phase, 'UNCONFIGURED');
  assert.equal(state.leaseGeneration, 0);
  assert.equal(state.leaseDisposition, 'ABSENT');
  assert.equal(state.generation, 0);
  assert.equal(state.connected, false);
  assert.equal(state.authenticated, false);
  assert.equal(state.subscribed, false);
  assert.equal(state.ownerRestCut, null);
  assert.equal(state.restReconciliationFreshness, 'UNAVAILABLE');
  assert.equal(state.continuityPosture, 'UNPROVED');
  assert.equal(state.sequenceCompleteness, 'UNKNOWN_NO_GLOBAL_SEQUENCE');
  assert.deepEqual(state.eventWatermarks, []);
  assert.deepEqual(state.recentEventMarkers, []);
  assert.deepEqual(state.recentEventRevisions, []);
  assert.equal(state.lastAccountEvent, null);
  assert.equal(state.lastOrderEvent, null);
  assert.equal(state.lastFillEvent, null);
  assertNoAuthority(state);
  assertDeeplyFrozen(state);
});

test('constructor rejects ambient-time substitutes and unsafe times', () => {
  assert.equal(USDM_PRIVATE_DEFAULT_ACCOUNT_REALM_ID, ACCOUNT_REALM);
  assert.deepEqual(initial(0), createInitialUsdmPrivateLifecycleState(0));
  assert.equal(initial(T0, OTHER_ACCOUNT_REALM).accountRealmId, OTHER_ACCOUNT_REALM);
  assert.throws(() => createInitialUsdmPrivateLifecycleState(-1), TypeError);
  assert.throws(() => createInitialUsdmPrivateLifecycleState(1.5), TypeError);
  assert.throws(() => createInitialUsdmPrivateLifecycleState(Number.MAX_SAFE_INTEGER + 1), TypeError);
  assert.throws(() => createInitialUsdmPrivateLifecycleState(), TypeError);
  assert.throws(() => createInitialUsdmPrivateLifecycleState(T0, 'plain-account'), TypeError);
});

test('exported validator returns a frozen canonical snapshot or null without throwing', () => {
  const state = initial();
  const validated = validateUsdmPrivateLifecycleState(state);
  assert.deepEqual(validated, state);
  assertDeeplyFrozen(validated);
  assert.equal(validateUsdmPrivateLifecycleState({ ...state, accountRealmId: 'plain-account' }), null);
  assert.equal(validateUsdmPrivateLifecycleState({ ...state, accountRealmId: undefined }), null);
  assert.equal(validateUsdmPrivateLifecycleState(null), null);
});

test('every action is account-scoped and cross-account actions, events, and cuts are fenced', () => {
  const initialState = initial();
  expectRejected(reduceUsdmPrivateLifecycleRaw(initialState, {
    kind: 'LEASE_POST_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0,
  }), 'ACTION_INVALID');
  expectRejected(reduceUsdmPrivateLifecycleRaw(initialState, {
    kind: 'LEASE_POST_OBSERVED',
    accountRealmId: OTHER_ACCOUNT_REALM,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0,
  }), 'ACCOUNT_REALM_MISMATCH');

  const stream = subscribedState();
  expectRejected(reduceUsdmPrivateLifecycleRaw(stream, {
    kind: 'PRIVATE_EVENT_OBSERVED',
    accountRealmId: OTHER_ACCOUNT_REALM,
    generation: stream.generation,
    eventKind: 'ACCOUNT_UPDATE',
    semanticCategory: 'ACCOUNT',
    orderExecutionType: null,
    isFill: false,
    exchangeEventTimeMs: T0 + 100,
    transactionTimeMs: T0 + 90,
    receiptTimeMs: T0 + 110,
    contentRevision: `usdm_content_${'2'.repeat(32)}`,
    eventRevision: eventRevision({
      accountRealmId: OTHER_ACCOUNT_REALM,
      exchangeEventTimeMs: T0 + 100,
      transactionTimeMs: T0 + 90,
      receiptTimeMs: T0 + 110,
      contentRevision: `usdm_content_${'2'.repeat(32)}`,
    }),
  }), 'ACCOUNT_REALM_MISMATCH');
  expectRejected(reduceUsdmPrivateLifecycleRaw(stream, {
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED',
    accountRealmId: OTHER_ACCOUNT_REALM,
    generation: stream.generation,
    reconciliationRevision: restRevision({
      accountRealmId: OTHER_ACCOUNT_REALM,
      reconciledAtMs: T0 + 100,
      validUntilMs: T0 + 1_000,
      throughExchangeEventTimeMs: T0 + 100,
      throughEventRevision: null,
    }),
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 1_000,
    throughExchangeEventTimeMs: T0 + 100,
    throughEventRevision: null,
  }), 'ACCOUNT_REALM_MISMATCH');
  expectRejected(reduceUsdmPrivateLifecycleRaw(stream, {
    kind: 'EVALUATED',
    accountRealmId: OTHER_ACCOUNT_REALM,
    evaluatedAtMs: T0 + 100,
  }), 'ACCOUNT_REALM_MISMATCH');
  assert.equal(validateUsdmPrivateLifecycleState({
    ...stream,
    accountRealmId: 'not-namespaced',
  }), null);
});

test('documentary constants expose only the exact L02 USD-M lease and routed private contracts', () => {
  assert.equal(USDM_PRIVATE_MATRIX_SHA256,
    '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac');
  assert.deepEqual(USDM_PRIVATE_DOCUMENTARY_CONTRACTS, {
    leasePost: 'USDM_LISTEN_KEY_POST',
    leasePut: 'USDM_LISTEN_KEY_PUT',
    leaseDelete: 'USDM_LISTEN_KEY_DELETE',
    rawRoute: 'USDM_WS_PRIVATE_USER_DATA',
    queryRawRoute: 'USDM_WS_PRIVATE_USER_DATA_QUERY_RAW',
    combinedRoute: 'USDM_WS_PRIVATE_USER_DATA_COMBINED',
  });
  assert.deepEqual(USDM_PRIVATE_ROUTE_CLASSES, ['RAW', 'QUERY_RAW', 'COMBINED']);
  assert.deepEqual(USDM_PRIVATE_LIFECYCLE_PHASES, [
    'UNCONFIGURED', 'LEASE_ACTIVE', 'CONNECTED_UNAUTHENTICATED',
    'ROUTE_AUTHENTICATED', 'SUBSCRIBED', 'DISCONNECTED_LEASE_ACTIVE',
    'LEASE_CLOSED', 'LEASE_NOT_FOUND', 'LEASE_EXPIRED', 'CONNECTION_EXPIRED',
  ]);
  assert.equal(USDM_LISTEN_KEY_LIFETIME_MS, HOUR_MS);
  assert.equal(USDM_PRIVATE_CONNECTION_LIFETIME_MS, DAY_MS);
  assert.equal(Object.isFrozen(USDM_PRIVATE_DOCUMENTARY_CONTRACTS), true);
  assert.equal(Object.values(USDM_PRIVATE_DOCUMENTARY_CONTRACTS)
    .some((value) => /^(?:https?|wss?):|\//u.test(value)), false);
});

test('POST establishes a 60-minute lease and active POST extends only that lease generation', () => {
  const first = postLease();
  assert.equal(first.phase, 'LEASE_ACTIVE');
  assert.equal(first.leaseGeneration, 1);
  assert.equal(first.leaseObservedBy, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost);
  assert.equal(first.leaseObservedAtMs, T0);
  assert.equal(first.leaseValidUntilMs, T0 + HOUR_MS);
  assert.equal(first.renewBeforeMs, T0 + HOUR_MS - 1);

  const second = postLease(first, T0 + 1_000, 1);
  assert.equal(second.leaseGeneration, 1);
  assert.equal(second.leaseValidUntilMs, T0 + 1_000 + HOUR_MS);
  assert.equal(second.generation, 0);
});

test('active POST cannot skip generation and an expired lease requires exactly the next generation', () => {
  const state = postLease();
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_POST_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 2,
    observedAtMs: T0 + 1,
  }), 'LEASE_GENERATION_MISMATCH');
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_POST_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0 + HOUR_MS + 1,
  }), 'LEASE_GENERATION_MISMATCH');
  const renewedGeneration = postLease(state, T0 + HOUR_MS + 1, 2);
  assert.equal(renewedGeneration.leaseGeneration, 2);
  assert.equal(renewedGeneration.leaseValidUntilMs, T0 + 2 * HOUR_MS + 1);
});

test('PUT extends lease TTL without extending the independent connection lifetime', () => {
  const connected = openConnection();
  const hardExpiry = connected.connectionValidUntilMs;
  const renewed = putLease(connected, T0 + 30_000);
  assert.equal(renewed.leaseObservedBy, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut);
  assert.equal(renewed.leaseValidUntilMs, T0 + 30_000 + HOUR_MS);
  assert.equal(renewed.connectionValidUntilMs, hardExpiry);
  assert.equal(renewed.generation, 1);
});

test('60-minute lease validity is inclusive at the exact boundary and expires one millisecond later', () => {
  const state = postLease();
  const exact = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + HOUR_MS,
  }));
  assert.equal(exact.leaseDisposition, 'ACTIVE');
  assert.equal(exact.phase, 'LEASE_ACTIVE');

  const beyond = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + HOUR_MS + 1,
  }));
  assert.equal(beyond.leaseDisposition, 'EXPIRED_BY_TIME');
  assert.equal(beyond.phase, 'LEASE_EXPIRED');
  assert.equal(beyond.leaseValidUntilMs, null);
});

test('PUT is accepted at the inclusive lease boundary and rejected beyond it', () => {
  const state = postLease();
  const exact = putLease(state, T0 + HOUR_MS);
  assert.equal(exact.leaseValidUntilMs, T0 + 2 * HOUR_MS);
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: 1,
    observedAtMs: T0 + HOUR_MS + 1,
  }), 'LEASE_EXPIRED');
});

test('PUT requires the exact current generation and PUT contract identity', () => {
  const state = postLease();
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: 2,
    observedAtMs: T0 + 1,
  }), 'LEASE_GENERATION_MISMATCH');
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0 + 1,
  }), 'ACTION_INVALID');
});

test('DELETE closes only the lease while retaining physical connection evidence', () => {
  const state = subscribedState();
  const deleted = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_DELETE_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete,
    leaseGeneration: state.leaseGeneration,
    observedAtMs: T0 + 100,
  }));
  assert.equal(deleted.leaseDisposition, 'CLOSED');
  assert.equal(deleted.phase, 'LEASE_CLOSED');
  assert.equal(deleted.leaseValidUntilMs, null);
  assert.equal(deleted.connected, true);
  assert.equal(deleted.authenticated, false);
  assert.equal(deleted.subscribed, false);
  assert.equal(deleted.closeCount, 1);
});

test('-1125 records an explicit missing lease without recreating it or erasing physical connection evidence', () => {
  const state = subscribedState();
  const missing = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_NOT_FOUND_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: state.leaseGeneration,
    errorCode: -1125,
    observedAtMs: T0 + 100,
  }));
  assert.equal(missing.leaseDisposition, 'NOT_FOUND');
  assert.equal(missing.phase, 'LEASE_NOT_FOUND');
  assert.equal(missing.leaseGeneration, 1);
  assert.equal(missing.connected, true);
  assert.equal(missing.authenticated, false);
  assert.equal(missing.subscribed, false);
  assert.equal(missing.listenKeyNotFoundCount, 1);

  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_NOT_FOUND_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: 1,
    errorCode: -1124,
    observedAtMs: T0 + 100,
  }), 'ACTION_INVALID');
});

test('all three exact USD-M routed private classes open without heuristic fallback', () => {
  const fixtures = [
    [USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute, 'RAW'],
    [USDM_PRIVATE_DOCUMENTARY_CONTRACTS.queryRawRoute, 'QUERY_RAW'],
    [USDM_PRIVATE_DOCUMENTARY_CONTRACTS.combinedRoute, 'COMBINED'],
  ];
  for (const [contractId, routeClass] of fixtures) {
    const state = openConnection(postLease(), contractId);
    assert.equal(state.routeContractId, contractId);
    assert.equal(state.routeClass, routeClass);
    assert.equal(state.phase, 'CONNECTED_UNAUTHENTICATED');
  }
  expectRejected(reduceUsdmPrivateLifecycle(postLease(), {
    kind: 'CONNECTION_OPENED',
    contractId: 'USDM_WS_UNROUTED_PRIVATE_USER_DATA',
    generation: 1,
    observedAtMs: T0,
    reconnectBeforeMs: T0 + 23 * HOUR_MS,
  }), 'ROUTE_CONTRACT_MISMATCH');
});

test('authentication and subscription are distinct exact-route transitions', () => {
  const connected = openConnection();
  expectRejected(reduceUsdmPrivateLifecycle(connected, {
    kind: 'STREAM_SUBSCRIBED',
    contractId: connected.routeContractId,
    generation: connected.generation,
    observedAtMs: T0 + 1,
  }), 'AUTHENTICATION_REQUIRED');

  const authenticated = authenticate(connected);
  assert.equal(authenticated.phase, 'ROUTE_AUTHENTICATED');
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.subscribed, false);
  const subscribed = subscribe(authenticated);
  assert.equal(subscribed.phase, 'SUBSCRIBED');
  assert.equal(subscribed.connected, true);
  assert.equal(subscribed.authenticated, true);
  assert.equal(subscribed.subscribed, true);

  expectRejected(reduceUsdmPrivateLifecycle(connected, {
    kind: 'ROUTE_AUTHENTICATED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.combinedRoute,
    generation: connected.generation,
    observedAtMs: T0 + 1,
  }), 'ROUTE_CONTRACT_MISMATCH');
});

test('reconnect planning must be strictly inside the independent 24-hour connection lifetime', () => {
  const lease = postLease();
  for (const reconnectBeforeMs of [T0, T0 + DAY_MS, T0 + DAY_MS + 1]) {
    expectRejected(reduceUsdmPrivateLifecycle(lease, {
      kind: 'CONNECTION_OPENED',
      contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
      generation: 1,
      observedAtMs: T0,
      reconnectBeforeMs,
    }), 'RECONNECT_PLAN_INVALID');
  }
  const valid = openConnection(lease, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    T0, 1, T0 + DAY_MS - 1);
  assert.equal(valid.reconnectBeforeMs, T0 + DAY_MS - 1);
});

test('planned reconnect marker becomes due without scheduling or closing the connection', () => {
  const connected = openConnection(postLease(), USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    T0, 1, T0 + 30_000);
  const derivedDuringLeaseObservation = putLease(connected, T0 + 30_000);
  assert.equal(derivedDuringLeaseObservation.reconnectDue, true);
  assert.equal(derivedDuringLeaseObservation.connected, true);
  const evaluated = expectApplied(reduceUsdmPrivateLifecycle(connected, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + 30_000,
  }));
  assert.equal(evaluated.reconnectDue, true);
  assert.equal(evaluated.connected, true);
  assert.equal(evaluated.connectionValidUntilMs, T0 + DAY_MS);
});

test('connection expires exactly at 24 hours while a separately renewed lease remains active', () => {
  const connected = openConnection();
  const leaseKeptAlive = keepLeaseThrough(connected, T0 + DAY_MS);
  assert.equal(leaseKeptAlive.leaseValidUntilMs, T0 + DAY_MS);
  const expired = expectApplied(reduceUsdmPrivateLifecycle(leaseKeptAlive, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + DAY_MS,
  }));
  assert.equal(expired.leaseDisposition, 'ACTIVE');
  assert.equal(expired.connected, false);
  assert.equal(expired.phase, 'CONNECTION_EXPIRED');
  assert.equal(expired.reconnectDue, true);
});

test('every bypassing observation normalizes the exclusive connection deadline', () => {
  const deadline = T0 + DAY_MS;
  const makeLive = () => keepLeaseThrough(subscribedState(), deadline);

  const beforePut = putLease(makeLive(), deadline - 1);
  assert.equal(beforePut.connected, true);
  assert.equal(beforePut.phase, 'SUBSCRIBED');

  const exactPut = putLease(makeLive(), deadline);
  assert.equal(exactPut.connected, false);
  assert.equal(exactPut.authenticated, false);
  assert.equal(exactPut.subscribed, false);
  assert.equal(exactPut.disconnectedAtMs, deadline);
  assert.equal(exactPut.phase, 'CONNECTION_EXPIRED');

  const beforeCut = expectApplied(ownerRestCut(makeLive(), {
    reconciledAtMs: deadline - 1,
    validUntilMs: deadline + 100,
    throughExchangeEventTimeMs: deadline - 1,
  }));
  assert.equal(beforeCut.connected, true);
  assert.equal(beforeCut.phase, 'SUBSCRIBED');

  for (const reconciledAtMs of [deadline, deadline + 1]) {
    const exactOrAfter = expectApplied(ownerRestCut(makeLive(), {
      reconciledAtMs,
      validUntilMs: reconciledAtMs + 100,
      throughExchangeEventTimeMs: reconciledAtMs,
    }));
    assert.equal(exactOrAfter.connected, false);
    assert.equal(exactOrAfter.authenticated, false);
    assert.equal(exactOrAfter.subscribed, false);
    assert.equal(exactOrAfter.disconnectedAtMs, reconciledAtMs);
    assert.notEqual(exactOrAfter.phase, 'SUBSCRIBED');
  }

  expectRejected(reduceUsdmPrivateLifecycle(makeLive(), {
    kind: 'LEASE_PUT_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: 1,
    observedAtMs: deadline + 1,
  }), 'LEASE_EXPIRED');
});

test('one millisecond before 24 hours remains connected when the lease is independently fresh', () => {
  const connected = openConnection();
  const leaseKeptAlive = keepLeaseThrough(connected, T0 + DAY_MS);
  const before = expectApplied(reduceUsdmPrivateLifecycle(leaseKeptAlive, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + DAY_MS - 1,
  }));
  assert.equal(before.connected, true);
  assert.equal(before.phase, 'CONNECTED_UNAUTHENTICATED');
  assert.equal(before.connectionValidUntilMs, T0 + DAY_MS);
});

test('current-generation transport close remains recordable after independent lease loss', () => {
  const makeDeleted = () => {
    const state = subscribedState();
    return expectApplied(reduceUsdmPrivateLifecycle(state, {
      kind: 'LEASE_DELETE_OBSERVED',
      contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete,
      leaseGeneration: state.leaseGeneration,
      observedAtMs: T0 + 100,
    }));
  };
  const makeNotFound = () => {
    const state = subscribedState();
    return expectApplied(reduceUsdmPrivateLifecycle(state, {
      kind: 'LEASE_NOT_FOUND_OBSERVED',
      contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
      leaseGeneration: state.leaseGeneration,
      errorCode: -1125,
      observedAtMs: T0 + 100,
    }));
  };
  const makeExpiredByTime = () => expectApplied(reduceUsdmPrivateLifecycle(subscribedState(), {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + HOUR_MS + 1,
  }));
  const makeExpiredByEvent = () => expectApplied(privateEvent(subscribedState(), {
    eventKind: 'listenKeyExpired',
  }));

  for (const makeLeaseLostState of [makeDeleted, makeNotFound, makeExpiredByTime, makeExpiredByEvent]) {
    const leaseLost = makeLeaseLostState();
    assert.equal(leaseLost.connected, true);
    const closed = expectApplied(reduceUsdmPrivateLifecycle(leaseLost, {
      kind: 'CONNECTION_CLOSED',
      generation: leaseLost.generation,
      observedAtMs: leaseLost.lastEvaluatedAtMs + 1,
      reason: 'TRANSPORT_CLOSED',
    }));
    assert.equal(closed.connected, false);
    assert.equal(closed.authenticated, false);
    assert.equal(closed.subscribed, false);
    assert.equal(closed.disconnectedAtMs, leaseLost.lastEvaluatedAtMs + 1);
  }
});

test('connection close and reopen advance only connection generation and reset stream evidence', () => {
  const observed = expectApplied(privateEvent(subscribedState()));
  const closed = expectApplied(reduceUsdmPrivateLifecycle(observed, {
    kind: 'CONNECTION_CLOSED',
    generation: 1,
    observedAtMs: T0 + 2_000,
    reason: 'PLANNED_RECONNECT',
  }));
  assert.equal(closed.connected, false);
  assert.equal(closed.phase, 'DISCONNECTED_LEASE_ACTIVE');
  assert.equal(closed.reconnectDue, true);

  const reopened = openConnection(closed, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.combinedRoute,
    T0 + 2_100, 2, T0 + 23 * HOUR_MS);
  assert.equal(reopened.generation, 2);
  assert.equal(reopened.leaseGeneration, 1);
  assert.equal(reopened.reconnectCount, 1);
  assert.equal(reopened.lastPrivateEventKind, null);
  assert.deepEqual(reopened.recentEventRevisions, []);
  assert.equal(reopened.observedEventCount, 0);
  assert.equal(reopened.dedupeCoverageTruncated, false);
  assert.equal(reopened.continuityPosture, 'RECONCILIATION_REQUIRED');

  expectRejected(reduceUsdmPrivateLifecycle(reopened, {
    kind: 'CONNECTION_OPENED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 3,
    observedAtMs: T0 + 2_200,
    reconnectBeforeMs: T0 + 23 * HOUR_MS,
  }), 'CONNECTION_ALREADY_OPEN');
});

test('stale-generation events are fenced and future generations fail closed', () => {
  const first = subscribedState();
  const closed = expectApplied(reduceUsdmPrivateLifecycle(first, {
    kind: 'CONNECTION_CLOSED',
    generation: 1,
    observedAtMs: T0 + 100,
    reason: 'TRANSPORT_CLOSED',
  }));
  const reopened = subscribe(authenticate(openConnection(closed,
    USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute, T0 + 200, 2, T0 + 23 * HOUR_MS)));

  const stale = expectApplied(privateEvent(reopened, {
    generation: 1,
    receiptTimeMs: T0 + 300,
  }));
  assert.equal(stale.staleGenerationEventCount, 1);
  assert.equal(stale.lastPrivateEventKind, null);
  assert.equal(stale.observedEventCount, 0);

  expectRejected(privateEvent(reopened, {
    generation: 3,
    receiptTimeMs: T0 + 300,
  }), 'CONNECTION_GENERATION_MISMATCH');

  expectRejected(reduceUsdmPrivateLifecycle(reopened, {
    kind: 'PRIVATE_EVENT_OBSERVED', generation: 0,
    eventKind: 'ACCOUNT_UPDATE', semanticCategory: 'ACCOUNT',
    orderExecutionType: null, isFill: false,
    exchangeEventTimeMs: T0 + 250, transactionTimeMs: T0 + 240,
    receiptTimeMs: T0 + 300,
    contentRevision: `usdm_content_${'3'.repeat(32)}`,
    eventRevision: `usdm_event_${'3'.repeat(32)}`,
  }), 'ACTION_INVALID');
  expectRejected(privateEvent(reopened, {
    generation: 1,
    semanticCategory: 'ORDER',
    receiptTimeMs: T0 + 300,
  }), 'ACTION_INVALID');
  expectRejected(privateEvent(reopened, {
    generation: 1,
    exchangeEventTimeMs: T0 + 2_301,
    receiptTimeMs: T0 + 300,
  }), 'EVENT_TIME_IN_FUTURE');
  expectRejected(privateEvent(reopened, {
    generation: 1,
    receiptTimeMs: T0 + 300,
    arbitraryPrivatePayload: 'forbidden',
  }), 'ACTION_INVALID');
});

test('stale-generation observation after lease expiry normalizes the emitted lease state', () => {
  const first = subscribedState();
  const closed = expectApplied(reduceUsdmPrivateLifecycle(first, {
    kind: 'CONNECTION_CLOSED',
    generation: 1,
    observedAtMs: T0 + 100,
    reason: 'TRANSPORT_CLOSED',
  }));
  const reopened = subscribe(authenticate(openConnection(closed,
    USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute, T0 + 200, 2, T0 + 23 * HOUR_MS)));
  const normalized = expectApplied(privateEvent(reopened, {
    generation: 1,
    receiptTimeMs: T0 + HOUR_MS + 1,
  }));
  assert.equal(normalized.staleGenerationEventCount, 1);
  assert.equal(normalized.leaseDisposition, 'EXPIRED_BY_TIME');
  assert.equal(normalized.leaseValidUntilMs, null);
  assert.equal(normalized.phase, 'LEASE_EXPIRED');
  assert.equal(normalized.connected, true);
  assert.equal(normalized.authenticated, false);
  assert.equal(normalized.subscribed, false);

  const physicalClose = expectApplied(reduceUsdmPrivateLifecycle(normalized, {
    kind: 'CONNECTION_CLOSED',
    generation: 2,
    observedAtMs: T0 + HOUR_MS + 2,
    reason: 'TRANSPORT_CLOSED',
  }));
  assert.equal(physicalClose.connected, false);
});

test('current official USD-M event union is closed and every named kind is reducible', () => {
  assert.deepEqual(USDM_PRIVATE_EVENT_KINDS, [
    'ACCOUNT_CONFIG_UPDATE', 'ACCOUNT_UPDATE', 'ALGO_UPDATE',
    'CONDITIONAL_ORDER_TRIGGER_REJECT', 'GRID_UPDATE', 'MARGIN_CALL',
    'ORDER_TRADE_UPDATE', 'STRATEGY_UPDATE', 'TRADE_LITE', 'listenKeyExpired',
  ]);
  for (const [index, eventKind] of USDM_PRIVATE_EVENT_KINDS.entries()) {
    const state = subscribedState();
    const next = expectApplied(privateEvent(state, {
      eventKind,
      exchangeEventTimeMs: T0 + 1_000 + index,
      transactionTimeMs: T0 + 900 + index,
      receiptTimeMs: T0 + 1_100 + index,
    }));
    assert.equal(next.lastPrivateEventKind, eventKind);
    assert.equal(next.observedEventCount, 1);
  }
});

test('non-empty official-shaped synthetic event fixtures map to closed account/order/fill semantics', () => {
  assert.deepEqual(USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES, ['ACCOUNT', 'ORDER', 'FILL', 'OTHER']);
  assert.equal(OFFICIAL_ACCOUNT_UPDATE_FIXTURE.a.B.length, 1);
  assert.equal(OFFICIAL_ACCOUNT_UPDATE_FIXTURE.a.P.length, 1);
  assert.equal(Object.keys(OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.o).length > 10, true);
  assert.equal(Object.keys(OFFICIAL_TRADE_LITE_FIXTURE).length > 8, true);
  assert.deepEqual(mapUsdmPrivateEventSemantics(OFFICIAL_ACCOUNT_UPDATE_FIXTURE.e, null), {
    semanticCategory: 'ACCOUNT', orderExecutionType: null, isFill: false,
  });
  assert.deepEqual(mapUsdmPrivateEventSemantics(
    OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.e,
    OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.o.x,
  ), {
    semanticCategory: 'ORDER', orderExecutionType: 'TRADE', isFill: true,
  });
  assert.deepEqual(mapUsdmPrivateEventSemantics(OFFICIAL_TRADE_LITE_FIXTURE.e, null), {
    semanticCategory: 'FILL', orderExecutionType: null, isFill: true,
  });
  assert.deepEqual(mapUsdmPrivateEventSemantics('ORDER_TRADE_UPDATE', 'NEW'), {
    semanticCategory: 'ORDER', orderExecutionType: 'NEW', isFill: false,
  });
  assert.equal(mapUsdmPrivateEventSemantics('ORDER_TRADE_UPDATE', 'UNKNOWN'), null);
  assert.equal(mapUsdmPrivateEventSemantics('UNKNOWN_EVENT', null), null);
});

test('ACCOUNT_UPDATE, ORDER_TRADE_UPDATE, and TRADE_LITE maintain distinct immutable markers', () => {
  const account = expectApplied(privateEvent(subscribedState(), {
    eventKind: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.e,
    exchangeEventTimeMs: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.E,
    transactionTimeMs: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.T,
    receiptTimeMs: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.E + 100,
  }));
  const accountRevision = account.lastAccountEvent.eventRevision;
  assert.equal(accountRevision, eventRevision({
    eventKind: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.e,
    exchangeEventTimeMs: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.E,
    transactionTimeMs: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.T,
    receiptTimeMs: OFFICIAL_ACCOUNT_UPDATE_FIXTURE.E + 100,
  }));
  assert.equal(account.lastAccountEvent.semanticCategory, 'ACCOUNT');
  assert.equal(account.lastOrderEvent, null);
  assert.equal(account.lastFillEvent, null);
  assert.equal(account.lastAccountEvent.accountRealmId, ACCOUNT_REALM);

  const newOrder = expectApplied(privateEvent(account, {
    eventKind: 'ORDER_TRADE_UPDATE',
    orderExecutionType: 'NEW',
    semanticCategory: 'ORDER',
    isFill: false,
    exchangeEventTimeMs: T0 + 1_100,
    transactionTimeMs: T0 + 1_000,
    receiptTimeMs: T0 + 1_200,
  }));
  const newOrderRevision = newOrder.lastOrderEvent.eventRevision;
  assert.notEqual(newOrderRevision, accountRevision);
  assert.equal(newOrder.lastFillEvent, null);
  assert.equal(newOrder.lastAccountEvent.eventRevision, accountRevision);

  const filledOrder = expectApplied(privateEvent(newOrder, {
    eventKind: OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.e,
    orderExecutionType: OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.o.x,
    exchangeEventTimeMs: OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.E + 100,
    transactionTimeMs: OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.T + 100,
    receiptTimeMs: OFFICIAL_ORDER_TRADE_UPDATE_FIXTURE.E + 200,
  }));
  const filledOrderRevision = filledOrder.lastFillEvent.eventRevision;
  assert.equal(filledOrder.lastOrderEvent.eventRevision, filledOrderRevision);
  assert.notEqual(filledOrderRevision, newOrderRevision);
  assert.equal(filledOrder.lastFillEvent.orderExecutionType, 'TRADE');

  const tradeLite = expectApplied(privateEvent(filledOrder, {
    eventKind: OFFICIAL_TRADE_LITE_FIXTURE.e,
    exchangeEventTimeMs: OFFICIAL_TRADE_LITE_FIXTURE.E + 200,
    transactionTimeMs: OFFICIAL_TRADE_LITE_FIXTURE.T + 200,
    receiptTimeMs: OFFICIAL_TRADE_LITE_FIXTURE.E + 300,
  }));
  assert.equal(tradeLite.lastOrderEvent.eventRevision, filledOrderRevision);
  assert.notEqual(tradeLite.lastFillEvent.eventRevision, filledOrderRevision);
  assert.equal(tradeLite.lastFillEvent.semanticCategory, 'FILL');
  assertDeeplyFrozen(tradeLite.lastAccountEvent);
  assertDeeplyFrozen(tradeLite.lastOrderEvent);
  assertDeeplyFrozen(tradeLite.lastFillEvent);
  assertNoAuthority(tradeLite);
  assert.equal(validateUsdmPrivateLifecycleState({
    ...tradeLite,
    accountRealmId: OTHER_ACCOUNT_REALM,
  }), null);
});

test('listenKeyExpired invalidates the lease but does not fabricate a physical disconnect', () => {
  const state = subscribedState();
  const expired = expectApplied(privateEvent(state, {
    eventKind: 'listenKeyExpired',
  }));
  assert.equal(expired.leaseDisposition, 'EXPIRED_BY_EVENT');
  assert.equal(expired.phase, 'LEASE_EXPIRED');
  assert.equal(expired.connected, true);
  assert.equal(expired.authenticated, false);
  assert.equal(expired.subscribed, false);
  assert.equal(expired.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('an out-of-order listenKeyExpired is quality evidence and cannot revoke newer lease truth', () => {
  const first = expectApplied(privateEvent(subscribedState(), {
    eventKind: 'ACCOUNT_UPDATE',
    exchangeEventTimeMs: T0 + 2_000,
    transactionTimeMs: T0 + 1_900,
    receiptTimeMs: T0 + 2_100,
  }));
  const olderExpiry = expectApplied(privateEvent(first, {
    eventKind: 'listenKeyExpired',
    exchangeEventTimeMs: T0 + 1_000,
    transactionTimeMs: T0 + 900,
    receiptTimeMs: T0 + 2_200,
  }));
  assert.equal(olderExpiry.outOfOrderEventCount, 1);
  assert.equal(olderExpiry.leaseDisposition, 'ACTIVE');
  assert.equal(olderExpiry.leaseValidUntilMs, T0 + HOUR_MS);
  assert.equal(olderExpiry.lastPrivateEventKind, 'ACCOUNT_UPDATE');
  assert.equal(olderExpiry.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('listenKeyExpired older than or equal to a newer keepalive cannot revoke that lease', () => {
  const makeRenewed = () => putLease(subscribedState(), T0 + 100);
  for (const [index, exchangeEventTimeMs] of [T0 + 99, T0 + 100].entries()) {
    const renewed = makeRenewed();
    const staleExpiry = expectApplied(privateEvent(renewed, {
      eventKind: 'listenKeyExpired',
      exchangeEventTimeMs,
      transactionTimeMs: null,
      receiptTimeMs: T0 + 200,
    }));
    assert.equal(staleExpiry.leaseDisposition, 'ACTIVE');
    assert.equal(staleExpiry.leaseObservedAtMs, T0 + 100);
    assert.equal(staleExpiry.outOfOrderEventCount, 1);
    assert.equal(staleExpiry.lastPrivateEventKind, null);
    assert.equal(staleExpiry.continuityPosture, 'RECONCILIATION_REQUIRED');
  }

  const newerExpiry = expectApplied(privateEvent(makeRenewed(), {
    eventKind: 'listenKeyExpired',
    exchangeEventTimeMs: T0 + 101,
    transactionTimeMs: null,
    receiptTimeMs: T0 + 200,
  }));
  assert.equal(newerExpiry.leaseDisposition, 'EXPIRED_BY_EVENT');
  assert.equal(newerExpiry.lastPrivateEventKind, 'listenKeyExpired');
});

test('exact duplicate events are counted without refreshing event truth', () => {
  const first = expectApplied(privateEvent(subscribedState()));
  const duplicate = expectApplied(privateEvent(first));
  assert.equal(duplicate.observedEventCount, 2);
  assert.equal(duplicate.duplicateEventCount, 1);
  assert.equal(duplicate.lastReceiptTimeMs, T0 + 1_100);
  assert.equal(duplicate.recentEventRevisions.length, 1);

  const conflicting = expectApplied(privateEvent(duplicate, {
    contentRevision: `usdm_content_${'2'.repeat(32)}`,
  }));
  assert.equal(conflicting.observedEventCount, 3);
  assert.equal(conflicting.conflictingEventCount, 1);
  assert.equal(conflicting.recentEventMarkers.length, 1);
  assert.equal(conflicting.recentEventMarkers[0].contentRevision,
    `usdm_content_${'1'.repeat(32)}`);
  assert.equal(conflicting.continuityPosture, 'RECONCILIATION_REQUIRED');
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment({
      ...conflicting,
      lastQualityLossAtMs: null,
      qualityPosture: 'CLEAN',
    }),
  ), null, 'a retained conflict counter prevents erasing quality provenance');
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment({
      ...conflicting,
      conflictingEventCount: 0,
    }),
  ), null, 'retained quality provenance prevents erasing its conflict counter');
});

test('content-derived revisions reject semantic and receipt-validity rewrites', () => {
  const first = expectApplied(privateEvent(subscribedState()));
  const canonicalRevision = first.lastAccountEvent.eventRevision;
  for (const rewrite of [
    { eventKind: 'ORDER_TRADE_UPDATE', receiptTimeMs: T0 + 1_200 },
    { receiptTimeMs: T0 + 1_200 },
  ]) {
    expectRejected(privateEvent(first, {
      ...rewrite,
      eventRevision: canonicalRevision,
    }), 'ACTION_INVALID');
  }
  assert.equal(first.observedEventCount, 1);
  assert.equal(first.conflictingEventCount, 0);
});

test('same-type and cross-type out-of-order events never replace newer truth', () => {
  const first = expectApplied(privateEvent(subscribedState()));
  const sameType = expectApplied(privateEvent(first, {
    exchangeEventTimeMs: T0 + 999,
    transactionTimeMs: T0 + 899,
    receiptTimeMs: T0 + 1_200,
  }));
  assert.equal(sameType.outOfOrderEventCount, 1);
  assert.equal(sameType.lastExchangeEventTimeMs, T0 + 1_000);

  const crossType = expectApplied(privateEvent(sameType, {
    eventKind: 'ORDER_TRADE_UPDATE',
    exchangeEventTimeMs: T0 + 998,
    transactionTimeMs: T0 + 898,
    receiptTimeMs: T0 + 1_300,
  }));
  assert.equal(crossType.outOfOrderEventCount, 2);
  assert.equal(crossType.lastPrivateEventKind, 'ACCOUNT_UPDATE');
  assert.equal(crossType.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('malformed observations degrade continuity and unknown private-event enums fail closed', () => {
  const state = subscribedState();
  const malformed = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'MALFORMED_EVENT_OBSERVED',
    generation: state.generation,
    receiptTimeMs: T0 + 500,
  }));
  assert.equal(malformed.malformedEventCount, 1);
  assert.equal(malformed.observedEventCount, 0);
  assert.equal(malformed.lastPrivateEventKind, null);
  assert.equal(malformed.dedupeCoverageTruncated, true);

  expectRejected(privateEvent(malformed, {
    eventKind: 'FUTURE_UNDOCUMENTED_EVENT',
    receiptTimeMs: T0 + 1_100,
  }), 'ACTION_INVALID');
  assert.equal(malformed.malformedEventCount, 1);
  assert.equal(malformed.observedEventCount, 0);
  assert.equal(malformed.lastPrivateEventKind, null);
  assert.equal(malformed.dedupeCoverageTruncated, true);
  assert.equal(malformed.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('future-skew boundary is inclusive and one millisecond beyond fails closed', () => {
  const state = subscribedState();
  const receiptTimeMs = T0 + 1_000;
  const exact = expectApplied(privateEvent(state, {
    exchangeEventTimeMs: receiptTimeMs + USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS,
    transactionTimeMs: receiptTimeMs + USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS,
    receiptTimeMs,
  }));
  assert.equal(exact.observedEventCount, 1);

  expectRejected(privateEvent(state, {
    exchangeEventTimeMs: receiptTimeMs + USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS + 1,
    transactionTimeMs: null,
    receiptTimeMs,
  }), 'EVENT_TIME_IN_FUTURE');
  expectRejected(privateEvent(state, {
    exchangeEventTimeMs: receiptTimeMs,
    transactionTimeMs: receiptTimeMs + USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS + 1,
    receiptTimeMs,
  }), 'EVENT_TIME_IN_FUTURE');
});

test('future-skew arithmetic fails closed before safe-integer overflow', () => {
  const maximumTime = Number.MAX_SAFE_INTEGER;
  const start = maximumTime - DAY_MS;
  let state = postLease(initial(start), start);
  state = openConnection(
    state,
    USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    start,
    1,
    maximumTime - HOUR_MS,
  );
  state = authenticate(state, start + 1);
  state = subscribe(state, start + 2);
  state = keepLeaseThrough(state, maximumTime);
  const receiptTimeMs = maximumTime - 1_000;
  expectRejected(privateEvent(state, {
    exchangeEventTimeMs: receiptTimeMs,
    transactionTimeMs: receiptTimeMs,
    receiptTimeMs,
  }), 'TIME_OVERFLOW');
});

test('bounded dedupe coverage truncates explicitly and cannot claim continuity', () => {
  let state = subscribedState();
  let stateAtCapacity;
  let firstRevision;
  for (let index = 0; index <= USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS; index += 1) {
    state = expectApplied(privateEvent(state, {
      exchangeEventTimeMs: T0 + 1_000 + index,
      transactionTimeMs: T0 + 900 + index,
      receiptTimeMs: T0 + 1_100 + index,
    }));
    if (index === 0) firstRevision = state.recentEventRevisions[0];
    if (index + 1 === USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS) {
      stateAtCapacity = state;
    }
  }
  assert.equal(stateAtCapacity.dedupeCoverageTruncated, true);
  assert.equal(stateAtCapacity.continuityPosture, 'RECONCILIATION_REQUIRED');
  assert.equal(state.observedEventCount, USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS + 1);
  assert.equal(state.recentEventRevisions.length, USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS);
  assert.equal(state.recentEventMarkers.length, USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS);
  assert.equal(state.recentEventRevisions.includes(firstRevision), false);
  assert.equal(state.dedupeCoverageTruncated, true);
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');

  const coveringCut = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 2_000,
    validUntilMs: T0 + 3_000,
    throughExchangeEventTimeMs: state.lastExchangeEventTimeMs,
  }));
  assert.equal(coveringCut.restReconciliationFreshness, 'FRESH');
  assert.equal(coveringCut.dedupeCoverageTruncated, true);
  assert.equal(coveringCut.continuityPosture, 'RECONCILIATION_REQUIRED');

  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...state,
    dedupeCoverageTruncated: false,
  })), null, 'a caller cannot clear proven retention loss');
});

test('validator replays untruncated markers and rejects stale semantic rollback', () => {
  const first = expectApplied(privateEvent(subscribedState(), {
    eventKind: 'ACCOUNT_UPDATE',
    exchangeEventTimeMs: T0 + 1_000,
    transactionTimeMs: T0 + 900,
    receiptTimeMs: T0 + 1_100,
  }));
  const second = expectApplied(privateEvent(first, {
    eventKind: 'ACCOUNT_UPDATE',
    exchangeEventTimeMs: T0 + 2_000,
    transactionTimeMs: T0 + 1_900,
    receiptTimeMs: T0 + 2_100,
  }));
  const oldMarker = second.recentEventMarkers[0];
  const rolledBack = {
    ...second,
    lastPrivateEventKind: oldMarker.eventKind,
    lastAccountEvent: oldMarker,
    lastExchangeEventTimeMs: oldMarker.exchangeEventTimeMs,
    lastTransactionTimeMs: oldMarker.transactionTimeMs,
    lastReceiptTimeMs: oldMarker.receiptTimeMs,
    eventWatermarks: [{
      eventKind: oldMarker.eventKind,
      exchangeEventTimeMs: oldMarker.exchangeEventTimeMs,
      transactionTimeMs: oldMarker.transactionTimeMs,
    }],
  };
  const committedRollback = withRecomputedUsdmStateCommitment(rolledBack);
  assert.equal(validateUsdmPrivateLifecycleState(committedRollback), null);
  expectRejected(reduceUsdmPrivateLifecycle(committedRollback, {
    kind: 'EVALUATED',
    evaluatedAtMs: second.lastEvaluatedAtMs + 1,
  }), 'STATE_INVALID');

  for (const forged of [
    { ...second, lastOrderEvent: oldMarker },
    { ...second, lastFillEvent: { ...oldMarker, isFill: true } },
    { ...second, lastReceiptTimeMs: first.lastReceiptTimeMs },
  ]) {
    assert.equal(validateUsdmPrivateLifecycleState(
      withRecomputedUsdmStateCommitment(forged),
    ), null);
  }
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...second,
    recentEventMarkers: [...second.recentEventMarkers].reverse(),
    recentEventRevisions: [...second.recentEventRevisions].reverse(),
  })), null, 'receipt-order evidence cannot be reordered around replay');
});

test('fresh owner REST cut covers observed events only when its generation and stream cut match', () => {
  const state = subscribedState();
  const firstCut = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 1_000,
    throughExchangeEventTimeMs: T0 + 100,
  }));
  assert.equal(firstCut.restReconciliationFreshness, 'FRESH');
  assert.equal(firstCut.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');

  const eventAfterCut = expectApplied(privateEvent(firstCut, {
    exchangeEventTimeMs: T0 + 200,
    transactionTimeMs: T0 + 190,
    receiptTimeMs: T0 + 300,
  }));
  assert.equal(eventAfterCut.restReconciliationFreshness, 'LAGGING_STREAM');
  assert.equal(eventAfterCut.continuityPosture, 'RECONCILIATION_REQUIRED');

  const coveringCut = expectApplied(ownerRestCut(eventAfterCut, {
    reconciledAtMs: T0 + 400,
    validUntilMs: T0 + 1_400,
    throughExchangeEventTimeMs: T0 + 200,
  }));
  assert.equal(coveringCut.restReconciliationFreshness, 'FRESH');
  assert.equal(coveringCut.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');
});

test('USD-M cut may bind any retained marker and remains processable after bounded eviction', () => {
  let state = subscribedState();
  state = expectApplied(privateEvent(state, {
    exchangeEventTimeMs: T0 + 10,
    transactionTimeMs: T0 + 9,
    receiptTimeMs: T0 + 100,
    contentRevision: `usdm_content_${(1).toString(16).padStart(32, '0')}`,
  }));
  const firstMarker = state.recentEventMarkers[0];
  state = expectApplied(privateEvent(state, {
    exchangeEventTimeMs: T0 + 20,
    transactionTimeMs: T0 + 19,
    receiptTimeMs: T0 + 200,
    contentRevision: `usdm_content_${(2).toString(16).padStart(32, '0')}`,
  }));
  state = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 300,
    validUntilMs: T0 + 2_000,
    throughEventRevision: firstMarker.eventRevision,
    throughExchangeEventTimeMs: firstMarker.exchangeEventTimeMs,
  }));
  assert.equal(state.restReconciliationFreshness, 'LAGGING_STREAM');
  assert.equal(state.ownerRestCut.throughEventRevision, firstMarker.eventRevision);

  for (let index = 3; index <= USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS + 1; index += 1) {
    state = expectApplied(privateEvent(state, {
      exchangeEventTimeMs: T0 + 20 + index,
      transactionTimeMs: T0 + 19 + index,
      receiptTimeMs: T0 + 300 + index,
      contentRevision: `usdm_content_${index.toString(16).padStart(32, '0')}`,
    }));
  }
  assert.equal(state.recentEventMarkers.length, USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS);
  assert.equal(state.recentEventMarkers.some(
    (marker) => marker.eventRevision === firstMarker.eventRevision,
  ), false);
  assert.equal(state.ownerRestCut.throughEventRevision, firstMarker.eventRevision);
  assert.equal(state.dedupeCoverageTruncated, true);
  assert.equal(state.restReconciliationFreshness, 'LAGGING_STREAM');
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
  assert.notEqual(validateUsdmPrivateLifecycleState(state), null);
  const evaluated = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'EVALUATED', evaluatedAtMs: state.lastEvaluatedAtMs + 1,
  }));
  assert.equal(evaluated.restReconciliationFreshness, 'LAGGING_STREAM');
});

test('owner cut revision witness blocks coherent deletion of the event it covered', () => {
  const cutOptions = {
    reconciledAtMs: T0 + 1_200,
    validUntilMs: T0 + 2_200,
    throughExchangeEventTimeMs: T0 + 1_000,
  };
  const eventlessControl = expectApplied(ownerRestCut(subscribedState(), cutOptions));
  const observed = expectApplied(privateEvent(subscribedState()));
  const covered = expectApplied(ownerRestCut(observed, cutOptions));
  assert.equal(covered.ownerRestCut.throughEventRevision, observed.recentEventRevisions[0]);

  const coherentlyDeleted = {
    ...covered,
    stateContentRevision: eventlessControl.stateContentRevision,
    lastPrivateEventKind: eventlessControl.lastPrivateEventKind,
    lastAccountEvent: eventlessControl.lastAccountEvent,
    lastOrderEvent: eventlessControl.lastOrderEvent,
    lastFillEvent: eventlessControl.lastFillEvent,
    lastExchangeEventTimeMs: eventlessControl.lastExchangeEventTimeMs,
    lastTransactionTimeMs: eventlessControl.lastTransactionTimeMs,
    lastReceiptTimeMs: eventlessControl.lastReceiptTimeMs,
    eventWatermarks: eventlessControl.eventWatermarks,
    recentEventMarkers: eventlessControl.recentEventMarkers,
    recentEventRevisions: eventlessControl.recentEventRevisions,
    dedupeCoverageTruncated: eventlessControl.dedupeCoverageTruncated,
    observedEventCount: eventlessControl.observedEventCount,
    duplicateEventCount: eventlessControl.duplicateEventCount,
    outOfOrderEventCount: eventlessControl.outOfOrderEventCount,
    conflictingEventCount: eventlessControl.conflictingEventCount,
    malformedEventCount: eventlessControl.malformedEventCount,
    staleGenerationEventCount: eventlessControl.staleGenerationEventCount,
    qualityPosture: eventlessControl.qualityPosture,
    lastQualityLossAtMs: eventlessControl.lastQualityLossAtMs,
  };
  assert.notEqual(validateUsdmPrivateLifecycleState(eventlessControl), null,
    'the independently reduced eventless control remains coherent');
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(coherentlyDeleted),
  ), null,
    'the original cut cannot survive deletion of its bound event revision');
});

test('USD-M owner cuts and retained event markers are exactly account-bound', () => {
  const eventless = expectApplied(ownerRestCut(subscribedState(), {
    throughExchangeEventTimeMs: T0 + 10,
  }));
  assert.equal(eventless.ownerRestCut.accountRealmId, ACCOUNT_REALM);
  assert.equal(eventless.restReconciliationFreshness, 'FRESH');

  const cutRetag = structuredClone(eventless);
  cutRetag.ownerRestCut.accountRealmId = OTHER_ACCOUNT_REALM;
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(cutRetag),
  ), null);
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...eventless,
    accountRealmId: OTHER_ACCOUNT_REALM,
  })), null, 'eventless ready state cannot be top-level retagged');
  const coherentCutRetag = structuredClone(eventless);
  coherentCutRetag.accountRealmId = OTHER_ACCOUNT_REALM;
  coherentCutRetag.ownerRestCut.accountRealmId = OTHER_ACCOUNT_REALM;
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(coherentCutRetag),
  ), null);

  const eventful = expectApplied(privateEvent(subscribedState()));
  assert.equal(eventful.recentEventMarkers[0].accountRealmId, ACCOUNT_REALM);
  const retainedMarkerRetag = structuredClone(eventful);
  retainedMarkerRetag.recentEventMarkers[0].accountRealmId = OTHER_ACCOUNT_REALM;
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(retainedMarkerRetag),
  ), null);
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...eventful,
    accountRealmId: OTHER_ACCOUNT_REALM,
  })), null, 'eventful state cannot be top-level retagged');
  const coherentEventRetag = structuredClone(eventful);
  coherentEventRetag.accountRealmId = OTHER_ACCOUNT_REALM;
  for (const marker of coherentEventRetag.recentEventMarkers) {
    marker.accountRealmId = OTHER_ACCOUNT_REALM;
  }
  coherentEventRetag.lastAccountEvent.accountRealmId = OTHER_ACCOUNT_REALM;
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(coherentEventRetag),
  ), null);

  assert.notEqual(
    eventRevision({ accountRealmId: ACCOUNT_REALM }),
    eventRevision({ accountRealmId: OTHER_ACCOUNT_REALM }),
  );
});

test('genuine listenKeyExpired recovery resets and fences prior lease-generation evidence', () => {
  let state = subscribedState();
  state = expectApplied(privateEvent(state, {
    eventKind: 'listenKeyExpired',
    exchangeEventTimeMs: T0 + 1_000,
    transactionTimeMs: null,
    receiptTimeMs: T0 + 1_100,
  }));
  assert.equal(state.leaseDisposition, 'EXPIRED_BY_EVENT');
  assert.equal(state.recentEventMarkers.length, 1);

  state = postLease(state, T0 + 1_101, 2);
  assert.equal(state.leaseDisposition, 'ACTIVE');
  assert.equal(state.connected, false);
  assert.equal(state.lastPrivateEventKind, null);
  assert.equal(state.recentEventMarkers.length, 0);
  assert.equal(state.observedEventCount, 0);
  assert.equal(state.dedupeCoverageTruncated, false);
  assert.equal(state.qualityPosture, 'CLEAN');
  assert.equal(state.lastQualityLossAtMs, null);
  assert.equal(state.ownerRestCut, null);
  assert.notEqual(validateUsdmPrivateLifecycleState(state), null);

  state = openConnection(state, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    T0 + 1_102, 2);
  state = authenticate(state, T0 + 1_103);
  state = subscribe(state, T0 + 1_104);
  state = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 1_105,
    validUntilMs: T0 + 2_105,
    throughExchangeEventTimeMs: T0 + 1_105,
  }));
  const witness = createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 + 1_105 });
  assert.equal(witness.acceptableForOwnerComparison, true);
});

test('eventful reconnect fences old generation and fresh current evidence regains readiness', () => {
  let state = expectApplied(privateEvent(subscribedState()));
  state = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'MALFORMED_EVENT_OBSERVED', generation: 1,
    receiptTimeMs: T0 + 1_101,
  }));
  assert.equal(state.qualityPosture, 'CURRENT_GENERATION_DEGRADED');
  assert.equal(state.malformedEventCount, 1);
  assert.equal(state.lastQualityLossAtMs, T0 + 1_101);
  state = expectApplied(reduceUsdmPrivateLifecycle(state, {
    kind: 'CONNECTION_CLOSED', generation: 1,
    observedAtMs: T0 + 1_102, reason: 'PLANNED_RECONNECT',
  }));
  state = openConnection(state, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    T0 + 1_103, 2);
  assert.equal(state.recentEventMarkers.length, 0);
  assert.equal(state.observedEventCount, 0);
  assert.equal(state.duplicateEventCount, 0);
  assert.equal(state.outOfOrderEventCount, 0);
  assert.equal(state.conflictingEventCount, 0);
  assert.equal(state.malformedEventCount, 0);
  assert.equal(state.staleGenerationEventCount, 0);
  assert.equal(state.dedupeCoverageTruncated, false);
  assert.equal(state.qualityPosture, 'CLEAN');
  assert.equal(state.lastQualityLossAtMs, null);
  assert.equal(state.ownerRestCut, null);
  state = authenticate(state, T0 + 1_104);
  state = subscribe(state, T0 + 1_105);
  state = expectApplied(privateEvent(state, {
    exchangeEventTimeMs: T0 + 1_106,
    transactionTimeMs: T0 + 1_105,
    receiptTimeMs: T0 + 1_107,
  }));
  state = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 1_108,
    validUntilMs: T0 + 2_108,
    throughExchangeEventTimeMs: T0 + 1_106,
  }));
  const witness = createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 + 1_108 });
  assert.equal(witness.acceptableForOwnerComparison, true);
  assert.equal(witness.state.generation, 2);
});

test('owner REST cut observed after lease expiry normalizes lease state without losing the cut', () => {
  const state = subscribedState();
  const normalized = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + HOUR_MS + 1,
    validUntilMs: T0 + HOUR_MS + 1_000,
    throughExchangeEventTimeMs: T0 + 1_000,
  }));
  assert.equal(normalized.leaseDisposition, 'EXPIRED_BY_TIME');
  assert.equal(normalized.leaseValidUntilMs, null);
  assert.equal(normalized.phase, 'LEASE_EXPIRED');
  assert.equal(normalized.connected, true);
  assert.equal(normalized.authenticated, false);
  assert.equal(normalized.subscribed, false);
  assert.equal(normalized.ownerRestCut.reconciliationRevision, restRevision({
    reconciledAtMs: T0 + HOUR_MS + 1,
    validUntilMs: T0 + HOUR_MS + 1_000,
    throughExchangeEventTimeMs: T0 + 1_000,
  }));
  assert.equal(normalized.restReconciliationFreshness, 'FRESH');

  const physicalClose = expectApplied(reduceUsdmPrivateLifecycle(normalized, {
    kind: 'CONNECTION_CLOSED',
    generation: normalized.generation,
    observedAtMs: T0 + HOUR_MS + 2,
    reason: 'REMOTE_CLOSED',
  }));
  assert.equal(physicalClose.connected, false);
});

test('owner REST revisions are content-derived and reject validity rewrites', () => {
  const state = subscribedState();
  const first = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 1_000,
    throughExchangeEventTimeMs: T0 + 50,
  }));
  const originalCut = first.ownerRestCut;
  const duplicate = expectApplied(ownerRestCut(first, {
    reconciliationRevision: originalCut.reconciliationRevision,
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 1_000,
    throughExchangeEventTimeMs: T0 + 50,
  }));
  assert.deepEqual(duplicate.ownerRestCut, originalCut);
  assert.equal(duplicate.ownerRestCut.reconciledAtMs, T0 + 100);
  assert.equal(duplicate.ownerRestCut.validUntilMs, T0 + 1_000);
  assert.equal(duplicate.lastEvaluatedAtMs, T0 + 100);

  for (const conflict of [
    { validUntilMs: T0 + 1_001, throughExchangeEventTimeMs: T0 + 50 },
    { validUntilMs: T0 + 1_000, throughExchangeEventTimeMs: T0 + 51 },
  ]) {
    expectRejected(ownerRestCut(first, {
      reconciliationRevision: originalCut.reconciliationRevision,
      reconciledAtMs: T0 + 200,
      ...conflict,
    }), 'REST_CUT_INVALID');
  }
});

test('owner REST freshness is inclusive at validUntil and stale one millisecond later', () => {
  const state = subscribedState();
  const cut = expectApplied(ownerRestCut(state, {
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 200,
    throughExchangeEventTimeMs: T0 + 100,
  }));
  const exact = expectApplied(reduceUsdmPrivateLifecycle(cut, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + 200,
  }));
  assert.equal(exact.restReconciliationFreshness, 'FRESH');
  const stale = expectApplied(reduceUsdmPrivateLifecycle(cut, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + 201,
  }));
  assert.equal(stale.restReconciliationFreshness, 'STALE');
  assert.equal(stale.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('reconnect generation fences an otherwise fresh owner REST cut', () => {
  const state = subscribedState();
  const cut = expectApplied(ownerRestCut(state));
  const closed = expectApplied(reduceUsdmPrivateLifecycle(cut, {
    kind: 'CONNECTION_CLOSED',
    generation: 1,
    observedAtMs: cut.lastEvaluatedAtMs + 1,
    reason: 'REMOTE_CLOSED',
  }));
  const reopened = openConnection(closed, USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    closed.lastEvaluatedAtMs + 1, 2, T0 + 23 * HOUR_MS);
  assert.equal(reopened.restReconciliationFreshness, 'UNAVAILABLE');
  assert.equal(reopened.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('owner REST observations require a real current connection generation and closed revision shape', () => {
  expectRejected(reduceUsdmPrivateLifecycle(initial(), {
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED',
    generation: 0,
    reconciliationRevision: restRevision(),
    reconciledAtMs: T0 + 1,
    validUntilMs: T0 + 2,
    throughExchangeEventTimeMs: T0,
    throughEventRevision: null,
  }), 'REST_CUT_INVALID');

  const state = subscribedState();
  expectRejected(ownerRestCut(state, {
    reconciliationRevision: 'invalid',
  }), 'REST_CUT_INVALID');
  expectRejected(ownerRestCut(state, {
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 99,
  }), 'REST_CUT_INVALID');
  expectRejected(ownerRestCut(state, {
    reconciledAtMs: T0 + 100,
    throughExchangeEventTimeMs: T0 + 101,
  }), 'REST_CUT_INVALID');
});

test('owner REST validity is bounded and validator rejects future or impossible cuts', () => {
  assert.equal(USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS, 300_000);
  const state = subscribedState();
  const reconciledAtMs = T0 + 100;
  const exactMaximum = expectApplied(ownerRestCut(state, {
    reconciledAtMs,
    validUntilMs: reconciledAtMs + USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS,
    throughExchangeEventTimeMs: reconciledAtMs,
  }));
  assert.equal(exactMaximum.restReconciliationFreshness, 'FRESH');
  expectRejected(ownerRestCut(state, {
    reconciledAtMs,
    validUntilMs: reconciledAtMs + USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS + 1,
    throughExchangeEventTimeMs: reconciledAtMs,
  }), 'REST_CUT_INVALID');

  const futureCut = {
    generation: state.generation,
    reconciledAtMs: state.lastEvaluatedAtMs + 1_000,
    validUntilMs: state.lastEvaluatedAtMs + 2_000,
    throughExchangeEventTimeMs: state.lastEvaluatedAtMs + 1_000,
    throughEventRevision: null,
  };
  futureCut.reconciliationRevision = restRevision(futureCut);
  assert.equal(validateUsdmPrivateLifecycleState({
    ...state,
    ownerRestCut: futureCut,
    restReconciliationFreshness: 'FRESH',
    continuityPosture: 'OWNER_CUT_COVERS_OBSERVED_EVENTS',
  }), null);

  const genesis = initial();
  assert.equal(validateUsdmPrivateLifecycleState({
    ...genesis,
    ownerRestCut: {
      generation: 0,
      reconciliationRevision: restRevision(),
      reconciledAtMs: T0,
      validUntilMs: T0 + 100,
      throughExchangeEventTimeMs: T0,
      throughEventRevision: null,
    },
    restReconciliationFreshness: 'FRESH',
    continuityPosture: 'OWNER_CUT_COVERS_OBSERVED_EVENTS',
  }), null);

  assert.equal(validateUsdmPrivateLifecycleState({
    ...exactMaximum,
    ownerRestCut: { ...exactMaximum.ownerRestCut, generation: state.generation + 1 },
    restReconciliationFreshness: 'GENERATION_MISMATCH',
    continuityPosture: 'RECONCILIATION_REQUIRED',
  }), null);
  assert.equal(validateUsdmPrivateLifecycleState({
    ...exactMaximum,
    ownerRestCut: {
      ...exactMaximum.ownerRestCut,
      validUntilMs: exactMaximum.ownerRestCut.reconciledAtMs
        + USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS + 1,
    },
  }), null);
});

test('closed action shapes reject token, URL, credential, signature, and unknown fields', () => {
  const state = initial();
  const base = {
    kind: 'LEASE_POST_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0,
  };
  for (const forbiddenField of ['listenKey', 'token', 'url', 'credential', 'signature', 'apiKey']) {
    expectRejected(reduceUsdmPrivateLifecycle(state, {
      ...base,
      [forbiddenField]: 'FORBIDDEN_TEST_FIELD',
    }), 'ACTION_INVALID');
  }
  const result = expectApplied(reduceUsdmPrivateLifecycle(state, base));
  const serialized = JSON.stringify(result);
  assert.equal(/(?:https?|wss?):\/\//u.test(serialized), false);
  for (const forbiddenField of ['"listenKey"', '"token"', '"url"', '"credential"', '"signature"', '"apiKey"']) {
    assert.equal(serialized.includes(forbiddenField), false);
  }
});

test('hostile action accessors, proxies, inherited fields, and symbol keys fail without invocation', () => {
  const state = initial();
  let getterReads = 0;
  const accessor = {
    kind: 'LEASE_POST_OBSERVED',
    accountRealmId: ACCOUNT_REALM,
    leaseGeneration: 1,
    observedAtMs: T0,
  };
  Object.defineProperty(accessor, 'contractId', {
    enumerable: true,
    get() {
      getterReads += 1;
      return USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost;
    },
  });
  expectRejected(reduceUsdmPrivateLifecycleRaw(state, accessor), 'ACTION_INVALID');
  assert.equal(getterReads, 0);

  const plain = {
    kind: 'LEASE_POST_OBSERVED',
    accountRealmId: ACCOUNT_REALM,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0,
  };
  expectRejected(reduceUsdmPrivateLifecycleRaw(state, new Proxy(plain, {})), 'ACTION_INVALID');
  expectRejected(reduceUsdmPrivateLifecycleRaw(state, Object.create(plain)), 'ACTION_INVALID');
  expectRejected(reduceUsdmPrivateLifecycleRaw(state, { ...plain, [Symbol('hostile')]: true }),
    'ACTION_INVALID');

  const revocable = Proxy.revocable(plain, {});
  revocable.revoke();
  expectRejected(reduceUsdmPrivateLifecycleRaw(state, revocable.proxy), 'ACTION_INVALID');
});

test('hostile state mutation, unknown fields, proxies, and malformed arrays fail closed', () => {
  const state = initial();
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({ ...state, sendEligible: true }, {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID'), null);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({ ...state, surprise: true }, {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID'), null);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle(new Proxy(state, {}), {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID'), null);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({ ...state, reconnectDue: true }, {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID'), null);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({ ...state, capitalAuthority: 'GRANTED' }, {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID'), null);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({ ...state, riskAuthority: 'GRANTED' }, {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID'), null);

  const activeLease = postLease();
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({
    ...activeLease,
    leaseObservedBy: null,
  }, { kind: 'EVALUATED', evaluatedAtMs: T0 }), 'STATE_INVALID'), null);

  const connected = openConnection(activeLease);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({
    ...connected,
    reconnectDue: true,
  }, { kind: 'EVALUATED', evaluatedAtMs: T0 }), 'STATE_INVALID'), null);

  const named = [];
  named.extra = true;
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({
    ...state,
    recentEventRevisions: named,
  }, { kind: 'EVALUATED', evaluatedAtMs: T0 }), 'STATE_INVALID'), null);

  const sparse = new Array(1);
  assert.equal(expectRejected(reduceUsdmPrivateLifecycle({
    ...state,
    recentEventRevisions: sparse,
  }, { kind: 'EVALUATED', evaluatedAtMs: T0 }), 'STATE_INVALID'), null);
});

test('validator rejects detached, future, partial, and watermark-incoherent event markers', () => {
  const observed = expectApplied(privateEvent(subscribedState()));
  assert.equal(
    withRecomputedUsdmStateCommitment(observed).stateContentRevision,
    observed.stateContentRevision,
    'test commitment reconstruction matches the internal USD-M commitment',
  );
  const detached = {
    ...observed.lastAccountEvent,
    eventRevision: eventRevision({ receiptTimeMs: T0 + 1_101 }),
  };
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...observed,
    lastAccountEvent: detached,
  })), null);

  const futureReceipt = observed.lastEvaluatedAtMs + 1;
  const futureMarker = {
    ...observed.recentEventMarkers[0],
    receiptTimeMs: futureReceipt,
  };
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...observed,
    recentEventMarkers: [futureMarker],
    lastAccountEvent: futureMarker,
    lastReceiptTimeMs: futureReceipt,
  })), null);
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...observed,
    lastExchangeEventTimeMs: null,
  })), null);
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...observed,
    eventWatermarks: [{
      ...observed.eventWatermarks[0],
      exchangeEventTimeMs: observed.eventWatermarks[0].exchangeEventTimeMs + 1,
    }],
  })), null);
});

test('USD-M state commitment rejects coherent rollback and evidence predating connection', () => {
  const observed = expectApplied(privateEvent(subscribedState()));
  assert.equal(
    withRecomputedUsdmStateCommitment(observed).stateContentRevision,
    observed.stateContentRevision,
    'test commitment reconstruction matches the internal canonical commitment',
  );
  const rollback = structuredClone(observed);
  rollback.lastPrivateEventKind = null;
  rollback.lastAccountEvent = null;
  rollback.lastExchangeEventTimeMs = null;
  rollback.lastTransactionTimeMs = null;
  rollback.lastReceiptTimeMs = null;
  rollback.eventWatermarks = [];
  rollback.recentEventMarkers = [];
  rollback.recentEventRevisions = [];
  rollback.observedEventCount = 0;
  assert.equal(validateUsdmPrivateLifecycleState(rollback), null,
    'a stale top-level commitment rejects a coherent multi-field rewrite');

  const detachedMarker = structuredClone(observed);
  const detachedReceiptTimeMs = observed.connectedAtMs - 1;
  const marker = detachedMarker.recentEventMarkers[0];
  const detachedEventRevision = eventRevision({
    accountRealmId: marker.accountRealmId,
    generation: marker.generation,
    eventKind: marker.eventKind,
    contentRevision: marker.contentRevision,
    exchangeEventTimeMs: marker.exchangeEventTimeMs,
    transactionTimeMs: marker.transactionTimeMs,
    receiptTimeMs: detachedReceiptTimeMs,
    orderExecutionType: marker.orderExecutionType,
  });
  marker.receiptTimeMs = detachedReceiptTimeMs;
  marker.eventRevision = detachedEventRevision;
  detachedMarker.lastAccountEvent.receiptTimeMs = detachedReceiptTimeMs;
  detachedMarker.lastAccountEvent.eventRevision = detachedEventRevision;
  detachedMarker.lastReceiptTimeMs = detachedReceiptTimeMs;
  detachedMarker.recentEventRevisions[0] = detachedEventRevision;
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(detachedMarker),
  ), null);

  const cut = expectApplied(ownerRestCut(subscribedState(), {
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 1_100,
    throughExchangeEventTimeMs: T0 + 100,
  }));
  const detachedCut = structuredClone(cut);
  detachedCut.ownerRestCut.reconciledAtMs = cut.connectedAtMs - 1;
  detachedCut.ownerRestCut.throughExchangeEventTimeMs = cut.connectedAtMs - 1;
  detachedCut.ownerRestCut.reconciliationRevision = restRevision({
    accountRealmId: cut.accountRealmId,
    generation: detachedCut.ownerRestCut.generation,
    reconciledAtMs: detachedCut.ownerRestCut.reconciledAtMs,
    validUntilMs: detachedCut.ownerRestCut.validUntilMs,
    throughEventRevision: null,
    throughExchangeEventTimeMs: detachedCut.ownerRestCut.throughExchangeEventTimeMs,
  });
  assert.equal(validateUsdmPrivateLifecycleState(
    withRecomputedUsdmStateCommitment(detachedCut),
  ), null);
  assert.match(observed.stateContentRevision, /^usdm_state_[0-9a-f]{64}$/);
});

test('validator rejects impossible lease and connection structural combinations', () => {
  const activeLease = postLease();
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...activeLease,
    leaseObservedAtMs: activeLease.lastEvaluatedAtMs + 1,
  })), null);

  const connected = openConnection(activeLease);
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...connected,
    disconnectedAtMs: connected.lastEvaluatedAtMs,
  })), null);
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...connected,
    reconnectCount: connected.reconnectCount + 1,
  })), null);

  const disconnected = expectApplied(reduceUsdmPrivateLifecycle(connected, {
    kind: 'CONNECTION_CLOSED',
    generation: connected.generation,
    observedAtMs: connected.lastEvaluatedAtMs + 1,
    reason: 'REMOTE_CLOSED',
  }));
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...disconnected,
    disconnectedAtMs: null,
  })), null);

  const closedLease = expectApplied(reduceUsdmPrivateLifecycle(activeLease, {
    kind: 'LEASE_DELETE_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete,
    leaseGeneration: activeLease.leaseGeneration,
    observedAtMs: activeLease.lastEvaluatedAtMs + 1,
  }));
  assert.equal(validateUsdmPrivateLifecycleState(withRecomputedUsdmStateCommitment({
    ...closedLease,
    leaseObservedBy: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
  })), null);
});

test('decisions and all retained nested evidence are deeply immutable and prior state is unchanged', () => {
  const before = subscribedState();
  const beforeRevision = before.revision;
  const decision = privateEvent(before);
  const after = expectApplied(decision);
  assert.equal(before.revision, beforeRevision);
  assert.equal(before.lastPrivateEventKind, null);
  assert.equal(after.lastPrivateEventKind, 'ACCOUNT_UPDATE');
  assert.throws(() => {
    after.connected = false;
  }, TypeError);
  assert.throws(() => {
    after.recentEventRevisions.push(eventRevision());
  }, TypeError);
  assert.throws(() => {
    after.recentEventMarkers[0].eventKind = 'MARGIN_CALL';
  }, TypeError);
});

test('time regression, unsafe counters, and exhausted diagnostic bounds fail deterministically', () => {
  const state = postLease();
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 - 1,
  }), 'TIME_REGRESSION');
  expectRejected(reduceUsdmPrivateLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: Number.MAX_SAFE_INTEGER,
    observedAtMs: T0 + 1,
  }), 'ACTION_INVALID');

  const exhausted = Object.freeze({ ...state, revision: 1_000_000 });
  expectRejected(reduceUsdmPrivateLifecycle(exhausted, {
    kind: 'EVALUATED', evaluatedAtMs: T0,
  }), 'STATE_INVALID');
});
