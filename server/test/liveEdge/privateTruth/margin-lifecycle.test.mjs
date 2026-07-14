import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARGIN_RISK_CONNECTION_LIFETIME_MS,
  MARGIN_RISK_CONTINUITY_POSTURES,
  MARGIN_RISK_DEFAULT_ACCOUNT_REALM_ID,
  MARGIN_RISK_DOCUMENTARY_CONTRACTS,
  MARGIN_RISK_EVENT_KINDS,
  MARGIN_RISK_LEASE_LIFETIME_MS,
  MARGIN_RISK_LIFECYCLE_PHASES,
  MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS,
  MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS,
  createInitialMarginRiskLifecycleState,
  createMarginRiskRealmBoundRevision,
  createMarginRiskLifecycleState,
  reduceMarginRiskLifecycle,
  validateMarginRiskLifecycleState,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/marginLifecycle.js';

const T0 = 1_800_000_000_000;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const ACCOUNT_REALM_A = 'account-realm-synthetic-a';
const ACCOUNT_REALM_B = 'account-realm-synthetic-b';

function contentRevision(index = 1) {
  return `mrisk_content_${index.toString(16).padStart(32, '0')}`;
}

function revision(exchangeEventTimeMs = T0 + 1_000, {
  accountRealmId = ACCOUNT_REALM_A,
  generation = 1,
  eventKind = 'MARGIN_LEVEL_STATUS_CHANGE',
  contentRevision: sanitizedContentRevision = contentRevision(),
  receiptTimeMs = T0 + 1_100,
} = {}) {
  return createMarginRiskRealmBoundRevision(
    accountRealmId,
    generation,
    eventKind,
    sanitizedContentRevision,
    exchangeEventTimeMs,
    receiptTimeMs,
  );
}

function expectApplied(result) {
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.reasonCode, undefined);
  const validated = validateMarginRiskLifecycleState(result.state);
  assert.notEqual(validated, null, 'every applied state must pass the exported validator');
  assert.deepEqual(validated, result.state);
  assertDeeplyFrozen(result);
  return result.state;
}

function expectRejected(result, reasonCode) {
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, reasonCode);
  return result.state;
}

function initial(at = T0, accountRealmId = ACCOUNT_REALM_A) {
  return createInitialMarginRiskLifecycleState(at, accountRealmId);
}

function postLease(state = initial(), at = T0, leaseGeneration = 1) {
  return expectApplied(reduceMarginRiskLifecycle(state, {
    kind: 'LEASE_POST_OBSERVED',
    accountRealmId: state.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration,
    observedAtMs: at,
  }));
}

function renewLease(state, at, leaseGeneration = state.leaseGeneration) {
  return expectApplied(reduceMarginRiskLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    accountRealmId: state.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration,
    observedAtMs: at,
  }));
}

function openConnection(
  state = postLease(),
  routeContractId = MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute,
  at = T0,
  generation = state.generation + 1,
) {
  return expectApplied(reduceMarginRiskLifecycle(state, {
    kind: 'CONNECTION_OPENED',
    accountRealmId: state.accountRealmId,
    contractId: routeContractId,
    generation,
    observedAtMs: at,
  }));
}

function observeRisk(state, overrides = {}) {
  const event = {
    kind: 'RISK_EVENT_OBSERVED',
    accountRealmId: state.accountRealmId,
    generation: state.generation,
    eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
    contentRevision: contentRevision(),
    exchangeEventTimeMs: T0 + 1_000,
    receiptTimeMs: T0 + 1_100,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'eventRevision')) {
    event.eventRevision = revision(event.exchangeEventTimeMs, {
      accountRealmId: event.accountRealmId,
      generation: state.generation,
      eventKind: event.eventKind,
      contentRevision: event.contentRevision,
      receiptTimeMs: event.receiptTimeMs,
    });
  }
  return reduceMarginRiskLifecycle(state, event);
}

function assertRiskOnlyUnavailable(state) {
  assert.equal(state.purpose, 'CROSS_MARGIN_RISK_ONLY');
  assert.equal(state.accountTradingStreamAvailability, 'UNAVAILABLE_DOCUMENTARY_CONTRACT_INCOMPLETE');
  assert.equal(state.accountCompleteness, 'UNAVAILABLE_RISK_STREAM_NOT_ACCOUNT_TRUTH');
  assert.equal(state.orderCompleteness, 'UNAVAILABLE_RISK_STREAM_NOT_ORDER_TRUTH');
  assert.equal(state.tradeCompleteness, 'UNAVAILABLE_RISK_STREAM_NOT_TRADE_TRUTH');
  assert.equal(state.liabilityCompleteness, 'UNAVAILABLE_RISK_EVENT_NOT_RECONCILIATION');
  assert.equal(state.restReconciliationCompleteness, 'UNAVAILABLE');
  assert.equal(state.sequenceCompleteness, 'UNKNOWN_NO_CONTRACT_SEQUENCE');
  assert.equal(state.closeDisposition, 'BLOCKED_OFFICIAL_DOC_CONFLICT');
}

function assertNoAuthority(state) {
  assert.equal(state.sendEligible, false);
  assert.equal(state.accountReadAuthority, 'NONE');
  assert.equal(state.mutationAuthority, 'NONE');
  assert.equal(state.reconciliationAuthority, 'NONE');
  assert.equal(state.capitalAuthority, 'NONE');
  assert.equal(state.riskAuthority, 'NONE');
  assert.equal(state.externalActionAuthorization, 'NONE');
  assert.equal(state.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(state.gapFreeSequenceProven, false);
  assert.equal(state.runtimeWired, false);
  assert.equal(state.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.equal(state.truthAuthority, 'EVIDENCE_ONLY');
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function keepLeaseThroughConnectionBoundary(state, evaluationOffset) {
  let current = state;
  const finalRenewalHour = evaluationOffset > DAY_MS ? 24 : 23;
  for (let hour = 1; hour <= finalRenewalHour; hour += 1) {
    current = renewLease(current, T0 + hour * HOUR_MS);
  }
  return current;
}

test('initial state is immutable Cross Margin risk-only evidence with every private truth unavailable', () => {
  const state = initial();
  assert.equal(state.schema, 'BINANCE_MARGIN_RISK_LIFECYCLE_V1');
  assert.equal(state.version, 1);
  assert.equal(state.product, 'MARGIN');
  assert.equal(state.environment, 'PRODUCTION');
  assert.equal(state.realm, 'PRIVATE_RISK_DATA');
  assert.equal(state.accountRealmId, ACCOUNT_REALM_A);
  assert.match(state.accountRealmBindingRevision, /^mrealm_[0-9a-f]{32}$/);
  assert.equal(MARGIN_RISK_DEFAULT_ACCOUNT_REALM_ID, ACCOUNT_REALM_A);
  assert.equal(state.sourceRevision, 'L02-BINANCE-2026-07-12');
  assert.equal(state.matrixSha256, '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac');
  assert.equal(state.phase, 'UNCONFIGURED');
  assert.equal(state.connected, false);
  assert.equal(state.riskEvidenceCompleteness, 'UNAVAILABLE');
  assert.deepEqual(state.recentEventMarkers, []);
  assert.deepEqual(state.recentEventRevisions, []);
  assert.equal(state.dedupeCoverageTruncated, false);
  assert.equal(state.conflictingEventCount, 0);
  assert.equal(state.lastContinuityBreakAtMs, null);
  assert.equal(state.continuityPosture, 'UNPROVED');
  assertRiskOnlyUnavailable(state);
  assertNoAuthority(state);
  assertDeeplyFrozen(state);
});

test('constructor aliases are deterministic and never consult an ambient clock', () => {
  assert.deepEqual(createInitialMarginRiskLifecycleState(), createMarginRiskLifecycleState(0));
  assert.deepEqual(createInitialMarginRiskLifecycleState(T0), createMarginRiskLifecycleState(T0));
  assert.deepEqual(
    createInitialMarginRiskLifecycleState(T0, ACCOUNT_REALM_B),
    createMarginRiskLifecycleState(T0, ACCOUNT_REALM_B),
  );
  assert.equal(createInitialMarginRiskLifecycleState(T0, ACCOUNT_REALM_B).accountRealmId,
    ACCOUNT_REALM_B);
  assert.throws(() => createInitialMarginRiskLifecycleState(-1), TypeError);
  assert.throws(() => createInitialMarginRiskLifecycleState(Number.MAX_SAFE_INTEGER + 1), TypeError);
  for (const invalidRealm of ['', 'synthetic-a', 'account-realm-', ' account-realm-a']) {
    assert.throws(() => createInitialMarginRiskLifecycleState(T0, invalidRealm), TypeError);
  }
});

test('canonical validator returns a detached frozen realm-bound lifecycle witness', () => {
  const state = openConnection(postLease(initial(T0, ACCOUNT_REALM_B)));
  const mutable = {
    ...state,
    recentEventMarkers: [...state.recentEventMarkers],
    recentEventRevisions: [...state.recentEventRevisions],
  };
  const witness = validateMarginRiskLifecycleState(mutable);
  assert.deepEqual(witness, state);
  assert.notEqual(witness, mutable);
  assert.equal(witness.accountRealmId, ACCOUNT_REALM_B);
  assertDeeplyFrozen(witness);
  mutable.accountRealmId = ACCOUNT_REALM_A;
  assert.equal(witness.accountRealmId, ACCOUNT_REALM_B);

  for (const tampered of [
    { ...state, accountRealmId: 'synthetic-b' },
    { ...state, accountRealmId: '' },
    { ...state, accountRealmId: ACCOUNT_REALM_B, extraRealm: ACCOUNT_REALM_A },
  ]) {
    assert.equal(validateMarginRiskLifecycleState(tampered), null);
  }
});

test('realm-bound initial identity, retained markers, and revisions reject account retags', () => {
  const initialA = initial(T0, ACCOUNT_REALM_A);
  const initialB = initial(T0, ACCOUNT_REALM_B);
  assert.notEqual(initialA.accountRealmBindingRevision, initialB.accountRealmBindingRevision);
  assert.equal(validateMarginRiskLifecycleState({
    ...initialA,
    accountRealmId: ACCOUNT_REALM_B,
  }), null, 'an initial witness cannot be top-level retagged');

  const eventful = expectApplied(observeRisk(openConnection()));
  assert.equal(eventful.recentEventMarkers[0].accountRealmId, ACCOUNT_REALM_A);
  assert.equal(validateMarginRiskLifecycleState({
    ...eventful,
    accountRealmId: ACCOUNT_REALM_B,
  }), null, 'an eventful witness cannot be top-level retagged');

  const coherentRetag = structuredClone(eventful);
  coherentRetag.accountRealmId = ACCOUNT_REALM_B;
  coherentRetag.accountRealmBindingRevision = initialB.accountRealmBindingRevision;
  for (const marker of coherentRetag.recentEventMarkers) {
    marker.accountRealmId = ACCOUNT_REALM_B;
  }
  assert.equal(validateMarginRiskLifecycleState(coherentRetag), null,
    'realm-bound retained revisions reject a coherent field retag');

  let customRealm = openConnection(postLease(initial(T0, ACCOUNT_REALM_B)));
  customRealm = expectApplied(observeRisk(customRealm, {
    accountRealmId: ACCOUNT_REALM_B,
  }));
  assert.equal(customRealm.recentEventMarkers[0].accountRealmId, ACCOUNT_REALM_B);
  assert.notEqual(validateMarginRiskLifecycleState(customRealm), null);
  expectRejected(observeRisk(customRealm, {
    accountRealmId: ACCOUNT_REALM_B,
    receiptTimeMs: T0 + 1_200,
    eventRevision: revision(),
  }), 'EVENT_INVALID');

  assert.throws(() => createMarginRiskRealmBoundRevision(
    ACCOUNT_REALM_B, 0, 'MARGIN_LEVEL_STATUS_CHANGE', contentRevision(), T0, T0,
  ), TypeError);
  assert.throws(() => createMarginRiskRealmBoundRevision(
    'synthetic-b', 1, 'MARGIN_LEVEL_STATUS_CHANGE', contentRevision(), T0, T0,
  ), TypeError);
  assert.throws(() => createMarginRiskRealmBoundRevision(
    ACCOUNT_REALM_B, 1, 'MARGIN_LEVEL_STATUS_CHANGE', 'raw-account-risk-payload', T0, T0,
  ), TypeError);
});

test('documentary constants expose only exact current risk POST/PUT, raw/combined, and blocked close IDs', () => {
  assert.deepEqual(MARGIN_RISK_DOCUMENTARY_CONTRACTS, {
    leasePost: 'MARGIN_RISK_LISTEN_KEY_POST',
    leasePut: 'MARGIN_RISK_LISTEN_KEY_PUT',
    closeConflict: 'MARGIN_RISK_LISTEN_KEY_DELETE_CONFLICT',
    rawRoute: 'MARGIN_RISK_WS_RAW',
    combinedRoute: 'MARGIN_RISK_WS_COMBINED',
    accountTradingPost: 'MARGIN_TRADE_LISTEN_TOKEN_POST_UNKNOWN',
    accountTradingSubscribe: 'MARGIN_TRADE_LISTEN_TOKEN_SUBSCRIBE_UNKNOWN',
  });
  assert.deepEqual(MARGIN_RISK_EVENT_KINDS, [
    'MARGIN_LEVEL_STATUS_CHANGE',
    'USER_LIABILITY_CHANGE',
  ]);
  assert.deepEqual(MARGIN_RISK_LIFECYCLE_PHASES, [
    'UNCONFIGURED',
    'LEASE_ACTIVE',
    'CONNECTED_RISK_ONLY',
    'DISCONNECTED_LEASE_UNRESOLVED',
    'LEASE_EXPIRED',
    'CONNECTION_EXPIRED',
  ]);
  assert.deepEqual(MARGIN_RISK_CONTINUITY_POSTURES, [
    'UNPROVED',
    'RECONCILIATION_REQUIRED',
  ]);
  assert.equal(MARGIN_RISK_LEASE_LIFETIME_MS, HOUR_MS);
  assert.equal(MARGIN_RISK_CONNECTION_LIFETIME_MS, DAY_MS);
  assert.equal(Object.isFrozen(MARGIN_RISK_DOCUMENTARY_CONTRACTS), true);
});

test('POST establishes exactly a 60-minute lease and a pre-expiry marker', () => {
  const state = postLease();
  assert.equal(state.phase, 'LEASE_ACTIVE');
  assert.equal(state.leaseGeneration, 1);
  assert.equal(state.leaseObservedBy, MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost);
  assert.equal(state.leaseObservedAtMs, T0);
  assert.equal(state.leaseValidUntilMs, T0 + HOUR_MS);
  assert.equal(state.renewBeforeMs, T0 + HOUR_MS - 1);
  assert.equal(state.connected, false);
  assertRiskOnlyUnavailable(state);
  assertNoAuthority(state);
});

test('POST on an active lease extends the same documentary lease generation', () => {
  const first = postLease();
  const second = postLease(first, T0 + 1_000, 1);
  assert.equal(second.leaseGeneration, 1);
  assert.equal(second.leaseValidUntilMs, T0 + 1_000 + HOUR_MS);
  assert.equal(second.generation, 0);
});

test('POST after lease expiry requires the next lease generation and clears current risk connection evidence', () => {
  const connected = openConnection();
  const next = postLease(connected, T0 + HOUR_MS + 1, 2);
  assert.equal(next.leaseGeneration, 2);
  assert.equal(next.generation, 1);
  assert.equal(next.connected, false);
  assert.equal(next.routeClass, null);
  assert.equal(next.routeContractId, null);
  assert.equal(next.riskEvidenceCompleteness, 'UNAVAILABLE');
  assert.deepEqual(next.recentEventMarkers, []);
  assert.deepEqual(next.recentEventRevisions, []);
});

test('POST rejects skipped or reused expired lease generations', () => {
  const state = postLease();
  expectRejected(postResult(state, T0 + 1, 2), 'LEASE_GENERATION_MISMATCH');
  expectRejected(postResult(state, T0 + HOUR_MS + 1, 1), 'LEASE_GENERATION_MISMATCH');
  expectRejected(postResult(state, T0 + HOUR_MS + 1, 3), 'LEASE_GENERATION_MISMATCH');
});

function postResult(state, at, leaseGeneration) {
  return reduceMarginRiskLifecycle(state, {
    kind: 'LEASE_POST_OBSERVED',
    accountRealmId: state.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration,
    observedAtMs: at,
  });
}

test('PUT extends exactly 60 minutes without changing connection lifetime', () => {
  const connected = openConnection();
  const renewed = renewLease(connected, T0 + 30_000);
  assert.equal(renewed.leaseObservedBy, MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut);
  assert.equal(renewed.leaseValidUntilMs, T0 + 30_000 + HOUR_MS);
  assert.equal(renewed.connectionValidUntilMs, T0 + DAY_MS);
  assert.equal(renewed.generation, 1);
});

test('PUT is accepted at the exact lease boundary and rejected one millisecond later', () => {
  const state = postLease();
  const atBoundary = renewLease(state, T0 + HOUR_MS);
  assert.equal(atBoundary.leaseValidUntilMs, T0 + 2 * HOUR_MS);
  expectRejected(reduceMarginRiskLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    accountRealmId: state.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: 1,
    observedAtMs: T0 + HOUR_MS + 1,
  }), 'LEASE_EXPIRED');
});

test('PUT requires the exact current lease generation and current PUT contract', () => {
  const state = postLease();
  expectRejected(reduceMarginRiskLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    accountRealmId: state.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut,
    leaseGeneration: 2,
    observedAtMs: T0 + 1,
  }), 'LEASE_GENERATION_MISMATCH');
  expectRejected(reduceMarginRiskLifecycle(state, {
    kind: 'LEASE_PUT_OBSERVED',
    accountRealmId: state.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1,
    observedAtMs: T0 + 1,
  }), 'EVENT_INVALID');
});

for (const [routeContractId, routeClass] of [
  [MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute, 'RAW'],
  [MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute, 'COMBINED'],
]) {
  test(`${routeClass} documentary route establishes only connected risk evidence`, () => {
    const state = openConnection(postLease(), routeContractId);
    assert.equal(state.phase, 'CONNECTED_RISK_ONLY');
    assert.equal(state.routeClass, routeClass);
    assert.equal(state.routeContractId, routeContractId);
    assert.equal(state.connectedAtMs, T0);
    assert.equal(state.connectionValidUntilMs, T0 + DAY_MS);
    assert.equal(state.reconnectBeforeMs, T0 + DAY_MS - 1);
    assertRiskOnlyUnavailable(state);
    assertNoAuthority(state);
  });
}

test('connection open rejects absent lease, wrong route, and non-advancing generation', () => {
  expectRejected(reduceMarginRiskLifecycle(initial(), {
    kind: 'CONNECTION_OPENED',
    accountRealmId: ACCOUNT_REALM_A,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1,
    observedAtMs: T0,
  }), 'LEASE_REQUIRED');
  const leased = postLease();
  expectRejected(reduceMarginRiskLifecycle(leased, {
    kind: 'CONNECTION_OPENED',
    accountRealmId: leased.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.accountTradingSubscribe,
    generation: 1,
    observedAtMs: T0,
  }), 'ROUTE_CONTRACT_MISMATCH');
  const connected = openConnection(leased);
  expectRejected(reduceMarginRiskLifecycle(connected, {
    kind: 'CONNECTION_OPENED',
    accountRealmId: connected.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1,
    observedAtMs: T0 + 1,
  }), 'CONNECTION_GENERATION_MISMATCH');
});

test('account/trading and retired Margin stream contracts cannot be substituted for risk routes', () => {
  const leased = postLease();
  for (const contractId of [
    MARGIN_RISK_DOCUMENTARY_CONTRACTS.accountTradingPost,
    MARGIN_RISK_DOCUMENTARY_CONTRACTS.accountTradingSubscribe,
    'MARGIN_USER_DATA_STREAM_POST_REMOVED',
    'MARGIN_ISOLATED_USER_DATA_STREAM_REMOVED',
  ]) {
    expectRejected(reduceMarginRiskLifecycle(leased, {
      kind: 'CONNECTION_OPENED',
      accountRealmId: leased.accountRealmId,
      contractId,
      generation: 1,
      observedAtMs: T0,
    }), 'ROUTE_CONTRACT_MISMATCH');
  }
});

test('every lifecycle observation rejects cross-account realm substitution before semantics', () => {
  const state = openConnection();
  const substitutions = [
    {
      kind: 'LEASE_POST_OBSERVED', accountRealmId: ACCOUNT_REALM_B,
      contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost,
      leaseGeneration: 1, observedAtMs: T0 + 1,
    },
    {
      kind: 'LEASE_PUT_OBSERVED', accountRealmId: ACCOUNT_REALM_B,
      contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut,
      leaseGeneration: 1, observedAtMs: T0 + 1,
    },
    {
      kind: 'CONNECTION_OPENED', accountRealmId: ACCOUNT_REALM_B,
      contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute,
      generation: 2, observedAtMs: T0 + 1,
    },
    {
      kind: 'RISK_EVENT_OBSERVED', accountRealmId: ACCOUNT_REALM_B,
      generation: 1, eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
      contentRevision: contentRevision(),
      exchangeEventTimeMs: T0 + 1, receiptTimeMs: T0 + 1,
      eventRevision: revision(T0 + 1),
    },
    {
      kind: 'MALFORMED_EVENT_OBSERVED', accountRealmId: ACCOUNT_REALM_B,
      generation: 1, receiptTimeMs: T0 + 1,
    },
    {
      kind: 'CONNECTION_CLOSED', accountRealmId: ACCOUNT_REALM_B,
      generation: 1, observedAtMs: T0 + 1,
    },
    {
      kind: 'DELETE_CLOSE_REQUESTED', accountRealmId: ACCOUNT_REALM_B,
      contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.closeConflict,
      generation: 1, observedAtMs: T0 + 1,
    },
    { kind: 'EVALUATED', accountRealmId: ACCOUNT_REALM_B, evaluatedAtMs: T0 + 1 },
  ];
  for (const event of substitutions) {
    const result = reduceMarginRiskLifecycle(state, event);
    const returned = expectRejected(result, 'ACCOUNT_REALM_MISMATCH');
    assert.deepEqual(returned, state);
    assert.equal(returned.revision, state.revision);
    assertNoAuthority(returned);
  }
});

test('missing, malformed, and state-substituted account realms fail closed', () => {
  const state = openConnection();
  expectRejected(reduceMarginRiskLifecycle(state, {
    kind: 'EVALUATED',
    evaluatedAtMs: T0 + 1,
  }), 'EVENT_INVALID');
  expectRejected(reduceMarginRiskLifecycle(state, {
    kind: 'EVALUATED',
    accountRealmId: 'synthetic-b',
    evaluatedAtMs: T0 + 1,
  }), 'EVENT_INVALID');

  const tamperedState = { ...state, accountRealmId: ACCOUNT_REALM_B };
  const result = reduceMarginRiskLifecycle(tamperedState, {
    kind: 'EVALUATED',
    accountRealmId: ACCOUNT_REALM_A,
    evaluatedAtMs: T0 + 1,
  });
  expectRejected(result, 'STATE_INVALID');
  assert.equal(result.state, null);

  const invalidState = reduceMarginRiskLifecycle({
    ...state,
    accountRealmId: 'synthetic-a',
  }, {
    kind: 'EVALUATED',
    accountRealmId: ACCOUNT_REALM_A,
    evaluatedAtMs: T0 + 1,
  });
  assert.equal(invalidState.applied, false);
  assert.equal(invalidState.reasonCode, 'STATE_INVALID');
  assert.equal(invalidState.state, null);
});

for (const [offset, expectedPhase, expectedConnected] of [
  [DAY_MS - 1, 'CONNECTED_RISK_ONLY', true],
  [DAY_MS, 'CONNECTION_EXPIRED', false],
  [DAY_MS + 1, 'CONNECTION_EXPIRED', false],
]) {
  test(`24-hour connection evaluates ${offset === DAY_MS ? 'at' : offset < DAY_MS ? 'below' : 'above'} its boundary`, () => {
    let state = openConnection();
    state = keepLeaseThroughConnectionBoundary(state, offset);
    state = expectApplied(reduceMarginRiskLifecycle(state, {
      kind: 'EVALUATED',
      accountRealmId: state.accountRealmId,
      evaluatedAtMs: T0 + offset,
    }));
    assert.equal(state.phase, expectedPhase);
    assert.equal(state.connected, expectedConnected);
    assertNoAuthority(state);
  });
}

test('risk receipt at the exact 24-hour hard lifetime is rejected while lease remains inclusive', () => {
  let state = openConnection();
  state = keepLeaseThroughConnectionBoundary(state, DAY_MS);
  assert.equal(state.leaseValidUntilMs, T0 + DAY_MS);
  const result = observeRisk(state, {
    exchangeEventTimeMs: T0 + DAY_MS,
    receiptTimeMs: T0 + DAY_MS,
  });
  expectRejected(result, 'CONNECTION_EXPIRED');
  assert.equal(result.state.connected, true);
  assert.equal(result.state.leaseValidUntilMs, T0 + DAY_MS);
  assert.equal(result.state.observedEventCount, 0);
});

test('lease renewal remains inclusive at connection hard expiry and normalizes connected false', () => {
  let state = openConnection();
  state = keepLeaseThroughConnectionBoundary(state, DAY_MS);
  const renewed = renewLease(state, T0 + DAY_MS);
  assert.equal(renewed.leaseValidUntilMs, T0 + DAY_MS + HOUR_MS);
  assert.equal(renewed.connectionValidUntilMs, T0 + DAY_MS);
  assert.equal(renewed.connected, false);
  assert.equal(renewed.phase, 'CONNECTION_EXPIRED');
  assertNoAuthority(renewed);
});

for (const [offset, expectedPhase, expectedConnected] of [
  [HOUR_MS - 1, 'CONNECTED_RISK_ONLY', true],
  [HOUR_MS, 'CONNECTED_RISK_ONLY', true],
  [HOUR_MS + 1, 'LEASE_EXPIRED', false],
]) {
  test(`60-minute lease evaluates ${offset === HOUR_MS ? 'at' : offset < HOUR_MS ? 'below' : 'above'} its boundary`, () => {
    const state = expectApplied(reduceMarginRiskLifecycle(openConnection(), {
      kind: 'EVALUATED',
      accountRealmId: ACCOUNT_REALM_A,
      evaluatedAtMs: T0 + offset,
    }));
    assert.equal(state.phase, expectedPhase);
    assert.equal(state.connected, expectedConnected);
  });
}

test('canonical validator rejects connected state beyond the inclusive lease boundary', () => {
  const atBoundary = expectApplied(reduceMarginRiskLifecycle(openConnection(), {
    kind: 'EVALUATED',
    accountRealmId: ACCOUNT_REALM_A,
    evaluatedAtMs: T0 + HOUR_MS,
  }));
  assert.equal(atBoundary.connected, true);
  assert.equal(atBoundary.phase, 'CONNECTED_RISK_ONLY');
  assert.notEqual(validateMarginRiskLifecycleState(atBoundary), null);

  const forgedExpiredConnected = {
    ...atBoundary,
    lastEvaluatedAtMs: atBoundary.leaseValidUntilMs + 1,
    phase: 'LEASE_EXPIRED',
  };
  assert.equal(validateMarginRiskLifecycleState(forgedExpiredConnected), null);
});

test('connection close records disconnect without claiming lease invalidation', () => {
  const connected = openConnection();
  const closed = expectApplied(reduceMarginRiskLifecycle(connected, {
    kind: 'CONNECTION_CLOSED',
    accountRealmId: connected.accountRealmId,
    generation: 1,
    observedAtMs: T0 + 1_000,
  }));
  assert.equal(closed.connected, false);
  assert.equal(closed.phase, 'DISCONNECTED_LEASE_UNRESOLVED');
  assert.equal(closed.disconnectedAtMs, T0 + 1_000);
  assert.equal(closed.leaseValidUntilMs, connected.leaseValidUntilMs);
  assert.equal(closed.closeDisposition, 'BLOCKED_OFFICIAL_DOC_CONFLICT');
});

test('DELETE conflict is a non-mutating rejection and cannot invalidate a lease or connection', () => {
  const prior = openConnection();
  const result = reduceMarginRiskLifecycle(prior, {
    kind: 'DELETE_CLOSE_REQUESTED',
    accountRealmId: prior.accountRealmId,
    contractId: MARGIN_RISK_DOCUMENTARY_CONTRACTS.closeConflict,
    generation: prior.generation,
    observedAtMs: T0 + 1,
  });
  const returned = expectRejected(result, 'DELETE_CONTRACT_CONFLICT');
  assert.deepEqual(returned, prior);
  assert.equal(returned.revision, prior.revision);
  assert.equal(returned.connected, true);
  assert.equal(returned.leaseValidUntilMs, prior.leaseValidUntilMs);
  assertNoAuthority(returned);
});

for (const eventKind of MARGIN_RISK_EVENT_KINDS) {
  test(`${eventKind} produces partial risk evidence but no private completeness`, () => {
    const state = expectApplied(observeRisk(openConnection(), { eventKind }));
    assert.equal(state.riskEvidenceCompleteness, 'PARTIAL_RISK_ONLY');
    assert.equal(state.lastRiskEventKind, eventKind);
    assert.equal(state.observedEventCount, 1);
    assert.deepEqual(state.recentEventMarkers, [{
      accountRealmId: ACCOUNT_REALM_A,
      generation: 1,
      eventRevision: revision(T0 + 1_000, { eventKind }),
      contentRevision: contentRevision(),
      eventKind,
      exchangeEventTimeMs: T0 + 1_000,
      receiptTimeMs: T0 + 1_100,
    }]);
    assert.deepEqual(state.recentEventRevisions, [
      revision(T0 + 1_000, { eventKind }),
    ]);
    assert.equal(state.continuityPosture, 'UNPROVED');
    assertRiskOnlyUnavailable(state);
    assertNoAuthority(state);
  });
}

test('only exact content equality is duplicate; same metadata with different sanitized content conflicts', () => {
  const first = expectApplied(observeRisk(openConnection()));
  const second = expectApplied(observeRisk(first));
  assert.equal(second.observedEventCount, 2);
  assert.equal(second.duplicateEventCount, 1);
  assert.equal(second.conflictingEventCount, 0);
  assert.equal(second.lastReceiptTimeMs, first.lastReceiptTimeMs);
  assert.equal(second.lastExchangeEventTimeMs, first.lastExchangeEventTimeMs);
  assert.deepEqual(second.recentEventMarkers, first.recentEventMarkers);
  assert.equal(second.lastContinuityBreakAtMs, null);
  assert.equal(second.continuityPosture, 'UNPROVED');
  assertRiskOnlyUnavailable(second);

  const conflict = expectApplied(observeRisk(second, {
    contentRevision: contentRevision(2),
  }));
  assert.equal(conflict.observedEventCount, 3);
  assert.equal(conflict.duplicateEventCount, 1);
  assert.equal(conflict.conflictingEventCount, 1);
  assert.deepEqual(conflict.recentEventMarkers, first.recentEventMarkers);
  assert.equal(conflict.lastContinuityBreakAtMs, T0 + 1_100);
  assert.equal(conflict.continuityPosture, 'RECONCILIATION_REQUIRED');

  expectRejected(observeRisk(conflict, {
    contentRevision: contentRevision(3),
    eventRevision: first.recentEventRevisions[0],
  }), 'EVENT_INVALID');
});

test('a later receipt has a distinct identity and advances retained receipt ordering', () => {
  const first = expectApplied(observeRisk(openConnection()));
  const laterReceipt = expectApplied(observeRisk(first, {
    receiptTimeMs: T0 + 2_000,
  }));
  assert.equal(laterReceipt.observedEventCount, 2);
  assert.equal(laterReceipt.duplicateEventCount, 0);
  assert.equal(laterReceipt.recentEventMarkers.length, 2);
  assert.notEqual(laterReceipt.recentEventRevisions[0], laterReceipt.recentEventRevisions[1]);
  assert.equal(laterReceipt.lastReceiptTimeMs, T0 + 2_000);
});

test('same revision cannot rewrite semantic kind, exchange timestamp, or receipt timestamp', () => {
  const first = expectApplied(observeRisk(openConnection(), {
    eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
  }));
  for (const conflictingContent of [
    { eventKind: 'USER_LIABILITY_CHANGE', receiptTimeMs: T0 + 2_000 },
    { exchangeEventTimeMs: T0 + 999, receiptTimeMs: T0 + 2_000 },
    { receiptTimeMs: T0 + 1_200 },
  ]) {
    const conflicting = observeRisk(first, {
      ...conflictingContent,
      eventRevision: first.recentEventRevisions[0],
    });
    const returned = expectRejected(conflicting, 'EVENT_INVALID');
    assert.deepEqual(returned, first);

    const rewrittenMarker = structuredClone(first);
    Object.assign(rewrittenMarker.recentEventMarkers[0], conflictingContent);
    assert.equal(validateMarginRiskLifecycleState(rewrittenMarker), null);
  }
});

test('out-of-order event is retained for dedupe but cannot overwrite newer risk evidence', () => {
  const first = expectApplied(observeRisk(openConnection(), {
    exchangeEventTimeMs: T0 + 2_000,
    receiptTimeMs: T0 + 2_100,
  }));
  const second = expectApplied(observeRisk(first, {
    exchangeEventTimeMs: T0 + 1_500,
    receiptTimeMs: T0 + 2_200,
  }));
  assert.equal(second.outOfOrderEventCount, 1);
  assert.equal(second.lastExchangeEventTimeMs, first.lastExchangeEventTimeMs);
  assert.equal(second.lastReceiptTimeMs, first.lastReceiptTimeMs);
  assert.deepEqual(second.recentEventRevisions, [
    revision(T0 + 2_000, { receiptTimeMs: T0 + 2_100 }),
    revision(T0 + 1_500, { receiptTimeMs: T0 + 2_200 }),
  ]);
  assert.deepEqual(second.recentEventMarkers, [
    {
      accountRealmId: ACCOUNT_REALM_A,
      generation: 1,
      eventRevision: revision(T0 + 2_000, { receiptTimeMs: T0 + 2_100 }),
      contentRevision: contentRevision(),
      eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
      exchangeEventTimeMs: T0 + 2_000,
      receiptTimeMs: T0 + 2_100,
    },
    {
      accountRealmId: ACCOUNT_REALM_A,
      generation: 1,
      eventRevision: revision(T0 + 1_500, { receiptTimeMs: T0 + 2_200 }),
      contentRevision: contentRevision(),
      eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
      exchangeEventTimeMs: T0 + 1_500,
      receiptTimeMs: T0 + 2_200,
    },
  ]);
  assert.equal(second.lastContinuityBreakAtMs, T0 + 2_200);
  assert.equal(second.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('future-skew boundary is accepted exactly and blocked one millisecond beyond it', () => {
  const connected = openConnection();
  const atBoundary = expectApplied(observeRisk(connected, {
    exchangeEventTimeMs: T0 + 1_000 + MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS,
    receiptTimeMs: T0 + 1_000,
  }));
  assert.equal(atBoundary.observedEventCount, 1);
  const rejected = observeRisk(connected, {
    exchangeEventTimeMs: T0 + 1_000 + MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS + 1,
    receiptTimeMs: T0 + 1_000,
  });
  expectRejected(rejected, 'EVENT_TIME_IN_FUTURE');
  assert.equal(rejected.state.observedEventCount, 0);
});

test('risk observations cannot cross connection generations', () => {
  const connected = openConnection();
  expectRejected(observeRisk(connected, { generation: 0 }), 'CONNECTION_GENERATION_MISMATCH');
  expectRejected(observeRisk(connected, { generation: 2 }), 'CONNECTION_GENERATION_MISMATCH');
});

test('reconnect advances generation, clears current-generation events, and rejects stale observations', () => {
  const first = expectApplied(observeRisk(openConnection()));
  const closed = expectApplied(reduceMarginRiskLifecycle(first, {
    kind: 'CONNECTION_CLOSED',
    accountRealmId: first.accountRealmId,
    generation: 1,
    observedAtMs: T0 + 2_000,
  }));
  const second = openConnection(
    closed,
    MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute,
    T0 + 3_000,
    2,
  );
  assert.equal(second.generation, 2);
  assert.equal(second.reconnectCount, 1);
  assert.equal(second.riskEvidenceCompleteness, 'UNAVAILABLE');
  assert.deepEqual(second.recentEventMarkers, []);
  assert.deepEqual(second.recentEventRevisions, []);
  assert.equal(second.dedupeCoverageTruncated, true);
  assert.equal(validateMarginRiskLifecycleState({
    ...second,
    dedupeCoverageTruncated: false,
  }), null);
  expectRejected(observeRisk(second, {
    generation: 1,
    receiptTimeMs: T0 + 3_100,
  }), 'CONNECTION_GENERATION_MISMATCH');
});

test('event identity cannot be reused or coherently retagged across connection generations', () => {
  const generationOne = expectApplied(observeRisk(openConnection()));
  const generationOneRevision = generationOne.recentEventRevisions[0];
  assert.equal(generationOne.recentEventMarkers[0].generation, 1);
  const coherentTopLevelRetag = structuredClone(generationOne);
  coherentTopLevelRetag.generation = 2;
  coherentTopLevelRetag.recentEventMarkers[0].generation = 2;
  assert.equal(validateMarginRiskLifecycleState(coherentTopLevelRetag), null,
    'top-level and retained generations cannot be coherently retagged');
  const closed = expectApplied(reduceMarginRiskLifecycle(generationOne, {
    kind: 'CONNECTION_CLOSED',
    accountRealmId: generationOne.accountRealmId,
    generation: 1,
    observedAtMs: T0 + 2_000,
  }));
  const generationTwoConnection = openConnection(
    closed,
    MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute,
    T0 + 3_000,
    2,
  );

  expectRejected(observeRisk(generationTwoConnection, {
    exchangeEventTimeMs: T0 + 1_000,
    receiptTimeMs: T0 + 3_100,
    eventRevision: generationOneRevision,
  }), 'EVENT_INVALID');

  const generationTwo = expectApplied(observeRisk(generationTwoConnection, {
    exchangeEventTimeMs: T0 + 1_000,
    receiptTimeMs: T0 + 3_100,
  }));
  assert.equal(generationTwo.recentEventMarkers[0].generation, 2);
  assert.notEqual(generationTwo.recentEventRevisions[0], generationOneRevision);

  const coherentGenerationRewrite = structuredClone(generationTwo);
  coherentGenerationRewrite.recentEventMarkers[0].eventRevision = generationOneRevision;
  coherentGenerationRewrite.recentEventRevisions[0] = generationOneRevision;
  assert.equal(validateMarginRiskLifecycleState(coherentGenerationRewrite), null);

  const markerGenerationRewrite = structuredClone(generationTwo);
  markerGenerationRewrite.recentEventMarkers[0].generation = 1;
  assert.equal(validateMarginRiskLifecycleState(markerGenerationRewrite), null);
});

test('malformed observation degrades a counter but cannot refresh or complete risk truth', () => {
  const connected = openConnection();
  const state = expectApplied(reduceMarginRiskLifecycle(connected, {
    kind: 'MALFORMED_EVENT_OBSERVED',
    accountRealmId: connected.accountRealmId,
    generation: 1,
    receiptTimeMs: T0 + 1_000,
  }));
  assert.equal(state.malformedEventCount, 1);
  assert.equal(state.lastRiskEventKind, null);
  assert.equal(state.lastReceiptTimeMs, null);
  assert.equal(state.riskEvidenceCompleteness, 'UNAVAILABLE');
  assert.equal(state.lastContinuityBreakAtMs, T0 + 1_000);
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
  assert.equal(state.dedupeCoverageTruncated, true);
  assertRiskOnlyUnavailable(state);
});

test('unknown event kinds and unsafe event revisions fail closed', () => {
  const connected = openConnection();
  for (const event of [
    {
      kind: 'RISK_EVENT_OBSERVED', accountRealmId: connected.accountRealmId,
      generation: 1, eventKind: 'executionReport',
      contentRevision: contentRevision(),
      exchangeEventTimeMs: T0 + 1, receiptTimeMs: T0 + 2,
      eventRevision: revision(T0 + 1),
    },
    {
      kind: 'RISK_EVENT_OBSERVED', accountRealmId: connected.accountRealmId,
      generation: 1, eventKind: 'USER_LIABILITY_CHANGE',
      contentRevision: contentRevision(),
      exchangeEventTimeMs: T0 + 1, receiptTimeMs: T0 + 2, eventRevision: 'not-a-revision',
    },
  ]) {
    expectRejected(reduceMarginRiskLifecycle(connected, event), 'EVENT_INVALID');
  }
});

test('bounded semantic retention exposes irreversible dedupe coverage truncation', () => {
  let state = openConnection();
  let stateAtCapacity;
  for (let index = 1; index <= MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS + 1; index += 1) {
    state = expectApplied(observeRisk(state, {
      exchangeEventTimeMs: T0 + index,
      receiptTimeMs: T0 + index,
    }));
    if (index === MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS) stateAtCapacity = state;
  }
  assert.equal(stateAtCapacity.dedupeCoverageTruncated, true);
  assert.equal(stateAtCapacity.continuityPosture, 'RECONCILIATION_REQUIRED');
  assert.equal(state.observedEventCount, 129);
  assert.equal(state.recentEventRevisions.length, 128);
  assert.equal(state.recentEventMarkers.length, 128);
  assert.equal(state.recentEventRevisions[0], revision(T0 + 2, { receiptTimeMs: T0 + 2 }));
  assert.equal(state.recentEventRevisions.at(-1), revision(
    T0 + 129,
    { receiptTimeMs: T0 + 129 },
  ));
  assert.deepEqual(state.recentEventMarkers[0], {
    accountRealmId: ACCOUNT_REALM_A,
    generation: 1,
    eventRevision: revision(T0 + 2, { receiptTimeMs: T0 + 2 }),
    contentRevision: contentRevision(),
    eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
    exchangeEventTimeMs: T0 + 2,
    receiptTimeMs: T0 + 2,
  });
  assert.deepEqual(state.recentEventMarkers.at(-1), {
    accountRealmId: ACCOUNT_REALM_A,
    generation: 1,
    eventRevision: revision(T0 + 129, { receiptTimeMs: T0 + 129 }),
    contentRevision: contentRevision(),
    eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
    exchangeEventTimeMs: T0 + 129,
    receiptTimeMs: T0 + 129,
  });
  assert.equal(state.dedupeCoverageTruncated, true);
  assert.equal(state.lastContinuityBreakAtMs, T0 + 129);
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
  assertDeeplyFrozen(state.recentEventMarkers);
  assertDeeplyFrozen(state.recentEventRevisions);

  const closed = expectApplied(reduceMarginRiskLifecycle(state, {
    kind: 'CONNECTION_CLOSED',
    accountRealmId: state.accountRealmId,
    generation: 1,
    observedAtMs: T0 + 2_000,
  }));
  const reconnected = openConnection(
    closed,
    MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute,
    T0 + 3_000,
    2,
  );
  assert.deepEqual(reconnected.recentEventMarkers, []);
  assert.equal(reconnected.dedupeCoverageTruncated, true);
  assert.equal(reconnected.continuityPosture, 'RECONCILIATION_REQUIRED');

  const nextLease = postLease(reconnected, T0 + HOUR_MS + 1, 2);
  assert.deepEqual(nextLease.recentEventMarkers, []);
  assert.equal(nextLease.dedupeCoverageTruncated, true);
  assert.equal(nextLease.lastContinuityBreakAtMs, T0 + HOUR_MS + 1);
  assert.equal(nextLease.continuityPosture, 'RECONCILIATION_REQUIRED');

  assert.equal(validateMarginRiskLifecycleState({
    ...state,
    dedupeCoverageTruncated: false,
  }), null, 'a caller cannot clear proven retention loss');
});

test('validator replays retained risk markers and rejects a stale latest summary', () => {
  const first = expectApplied(observeRisk(openConnection(), {
    eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
    exchangeEventTimeMs: T0 + 1_000,
    receiptTimeMs: T0 + 1_100,
  }));
  const second = expectApplied(observeRisk(first, {
    eventKind: 'USER_LIABILITY_CHANGE',
    exchangeEventTimeMs: T0 + 2_000,
    receiptTimeMs: T0 + 2_100,
  }));
  const oldMarker = second.recentEventMarkers[0];
  const rolledBack = {
    ...second,
    lastRiskEventKind: oldMarker.eventKind,
    lastExchangeEventTimeMs: oldMarker.exchangeEventTimeMs,
    lastReceiptTimeMs: oldMarker.receiptTimeMs,
  };
  assert.equal(validateMarginRiskLifecycleState(rolledBack), null);
  const result = reduceMarginRiskLifecycle(rolledBack, {
    kind: 'EVALUATED',
    accountRealmId: rolledBack.accountRealmId,
    evaluatedAtMs: second.lastEvaluatedAtMs + 1,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, 'STATE_INVALID');
  assert.equal(result.state, null);
  assert.equal(validateMarginRiskLifecycleState({
    ...second,
    recentEventMarkers: [...second.recentEventMarkers].reverse(),
    recentEventRevisions: [...second.recentEventRevisions].reverse(),
  }), null, 'receipt-order evidence cannot be reordered around replay');
});

test('validator rejects a coherently detached marker received before its connection opened', () => {
  const observed = expectApplied(observeRisk(openConnection()));
  const detachedConnectedAtMs = observed.recentEventMarkers[0].receiptTimeMs + 1;
  const detached = {
    ...observed,
    connectedAtMs: detachedConnectedAtMs,
    connectionValidUntilMs: detachedConnectedAtMs + DAY_MS,
    reconnectBeforeMs: detachedConnectedAtMs + DAY_MS - 1,
    lastEvaluatedAtMs: detachedConnectedAtMs,
  };
  assert.equal(validateMarginRiskLifecycleState(detached), null);
  const result = reduceMarginRiskLifecycle(detached, {
    kind: 'EVALUATED',
    accountRealmId: detached.accountRealmId,
    evaluatedAtMs: detachedConnectedAtMs + 1,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, 'STATE_INVALID');
  assert.equal(result.state, null);
});

test('forged overbound retained-event state is rejected before reduction', () => {
  const valid = openConnection();
  const overbound = {
    ...valid,
    recentEventMarkers: Array.from(
      { length: MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS + 1 },
      (_, index) => ({
        eventRevision: revision(T0 + index + 1),
        eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
        exchangeEventTimeMs: T0 + index + 1,
      }),
    ),
    recentEventRevisions: Array.from(
      { length: MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS + 1 },
      (_, index) => revision(T0 + index + 1),
    ),
    observedEventCount: MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS + 1,
  };
  const result = reduceMarginRiskLifecycle(overbound, {
    kind: 'EVALUATED',
    accountRealmId: overbound.accountRealmId,
    evaluatedAtMs: T0 + 1,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, 'STATE_INVALID');
  assert.equal(result.state, null);
});

test('forged marker identity, semantic fields, and clean continuity claims fail closed', () => {
  const observed = expectApplied(observeRisk(openConnection()));
  const hostileStates = [
    {
      ...observed,
      recentEventRevisions: [revision(T0 + 2_000)],
    },
    {
      ...observed,
      recentEventMarkers: [{
        ...observed.recentEventMarkers[0],
        eventKind: 'FUTURE_UNDOCUMENTED_EVENT',
      }],
    },
    {
      ...observed,
      recentEventMarkers: [{
        ...observed.recentEventMarkers[0],
        exchangeEventTimeMs: T0 + 10_000,
      }],
    },
    {
      ...observed,
      recentEventMarkers: [
        { ...observed.recentEventMarkers[0] },
        { ...observed.recentEventMarkers[0] },
      ],
      recentEventRevisions: [revision(), revision(T0 + 2_000)],
      observedEventCount: 2,
    },
    {
      ...observed,
      conflictingEventCount: 1,
    },
  ];
  for (const hostile of hostileStates) {
    const result = reduceMarginRiskLifecycle(hostile, {
      kind: 'EVALUATED',
      accountRealmId: observed.accountRealmId,
      evaluatedAtMs: T0 + 2_000,
    });
    assert.equal(result.applied, false);
    assert.equal(result.reasonCode, 'STATE_INVALID');
    assert.equal(result.state, null);
  }

});

test('marker accessors are rejected without invocation', () => {
  const observed = expectApplied(observeRisk(openConnection()));
  let invocations = 0;
  const marker = {
    eventRevision: revision(),
    eventKind: 'MARGIN_LEVEL_STATUS_CHANGE',
    get exchangeEventTimeMs() {
      invocations += 1;
      return T0 + 1_000;
    },
  };
  const result = reduceMarginRiskLifecycle({
    ...observed,
    recentEventMarkers: [marker],
  }, {
    kind: 'EVALUATED',
    accountRealmId: observed.accountRealmId,
    evaluatedAtMs: T0 + 2_000,
  });
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, 'STATE_INVALID');
  assert.equal(result.state, null);
  assert.equal(invocations, 0);
});

test('counter bound blocks another event without integer overflow', () => {
  const valid = openConnection();
  const bounded = {
    ...valid,
    observedEventCount: 1_000_000,
    dedupeCoverageTruncated: true,
    lastContinuityBreakAtMs: valid.lastEvaluatedAtMs,
    continuityPosture: 'RECONCILIATION_REQUIRED',
  };
  expectRejected(observeRisk(bounded), 'COUNTER_LIMIT_REACHED');
});

test('accessors are rejected without invocation', () => {
  const connected = openConnection();
  let invocations = 0;
  const event = {
    kind: 'EVALUATED',
    accountRealmId: connected.accountRealmId,
    get evaluatedAtMs() {
      invocations += 1;
      return T0 + 1;
    },
  };
  expectRejected(reduceMarginRiskLifecycle(connected, event), 'EVENT_INVALID');
  assert.equal(invocations, 0);
});

test('active and revoked proxies fail closed without leaking or mutating state', () => {
  const connected = openConnection();
  let trapInvocations = 0;
  const proxy = new Proxy({
    kind: 'EVALUATED', accountRealmId: connected.accountRealmId, evaluatedAtMs: T0 + 1,
  }, {
    get(target, field, receiver) {
      trapInvocations += 1;
      return Reflect.get(target, field, receiver);
    },
  });
  expectRejected(reduceMarginRiskLifecycle(connected, proxy), 'EVENT_INVALID');
  assert.equal(trapInvocations, 0);

  const revoked = Proxy.revocable({
    kind: 'EVALUATED', accountRealmId: connected.accountRealmId, evaluatedAtMs: T0 + 1,
  }, {});
  revoked.revoke();
  expectRejected(reduceMarginRiskLifecycle(connected, revoked.proxy), 'EVENT_INVALID');
});

test('inherited, symbol, sparse, extra, and secret-shaped fields are rejected', () => {
  const connected = openConnection();
  const inherited = Object.create({ evaluatedAtMs: T0 + 1 });
  inherited.kind = 'EVALUATED';
  inherited.accountRealmId = connected.accountRealmId;
  const symbol = {
    kind: 'EVALUATED', accountRealmId: connected.accountRealmId, evaluatedAtMs: T0 + 1,
  };
  symbol[Symbol('extra')] = true;
  const sparse = {
    kind: 'RISK_EVENT_OBSERVED', accountRealmId: connected.accountRealmId,
    generation: 1, eventKind: 'USER_LIABILITY_CHANGE',
  };
  const extra = {
    kind: 'EVALUATED', accountRealmId: connected.accountRealmId,
    evaluatedAtMs: T0 + 1, extra: true,
  };
  const sensitive = 'owner-sensitive-value-never-echo';
  const secretShaped = {
    kind: 'EVALUATED', accountRealmId: connected.accountRealmId,
    evaluatedAtMs: T0 + 1, listenKey: sensitive,
  };
  for (const value of [inherited, symbol, sparse, extra, secretShaped]) {
    const result = reduceMarginRiskLifecycle(connected, value);
    expectRejected(result, 'EVENT_INVALID');
    assert.equal(JSON.stringify(result).includes(sensitive), false);
  }
});

test('forged completeness or authority in prior state is rejected', () => {
  const valid = openConnection();
  for (const forged of [
    { ...valid, accountCompleteness: 'COMPLETE' },
    { ...valid, liabilityCompleteness: 'COMPLETE' },
    { ...valid, restReconciliationCompleteness: 'COMPLETE' },
    { ...valid, gapFreeSequenceProven: true },
    { ...valid, sendEligible: true },
    { ...valid, mutationAuthority: 'GRANTED' },
  ]) {
    const result = reduceMarginRiskLifecycle(forged, {
      kind: 'EVALUATED',
      accountRealmId: valid.accountRealmId,
      evaluatedAtMs: T0 + 1,
    });
    assert.equal(result.applied, false);
    assert.equal(result.reasonCode, 'STATE_INVALID');
    assert.equal(result.state, null);
  }
});

test('outputs detach from accepted mutable marker arrays and remain deeply immutable', () => {
  const valid = expectApplied(observeRisk(openConnection()));
  const marker = { ...valid.recentEventMarkers[0] };
  const markers = [marker];
  const revisions = [...valid.recentEventRevisions];
  const mutableState = {
    ...valid,
    recentEventMarkers: markers,
    recentEventRevisions: revisions,
  };
  const result = reduceMarginRiskLifecycle(mutableState, {
    kind: 'EVALUATED',
    accountRealmId: mutableState.accountRealmId,
    evaluatedAtMs: T0 + 2_000,
  });
  const state = expectApplied(result);
  marker.exchangeEventTimeMs = T0 + 9_999;
  markers.push({ ...marker, eventRevision: revision(T0 + 9_999) });
  revisions.push(revision(T0 + 9_999));
  assert.deepEqual(state.recentEventMarkers, valid.recentEventMarkers);
  assert.deepEqual(state.recentEventRevisions, [revision()]);
  assertDeeplyFrozen(result);
  assertNoAuthority(state);
});

test('time regression and unsafe times fail closed without advancing revision', () => {
  const state = openConnection();
  for (const evaluatedAtMs of [T0 - 1, -1, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    const result = reduceMarginRiskLifecycle(state, {
      kind: 'EVALUATED', accountRealmId: state.accountRealmId, evaluatedAtMs,
    });
    expectRejected(result, evaluatedAtMs === T0 - 1 ? 'TIME_REGRESSION' : 'EVENT_INVALID');
    assert.equal(result.state.revision, state.revision);
  }
});
