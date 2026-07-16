import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS,
  SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS,
  SPOT_PRIVATE_MATRIX_SHA256,
  SPOT_SIGNATURE_LIFECYCLE_CONTRACT,
  createInitialSpotPrivateLifecycleState,
  createSpotRealmBoundRevision,
  reduceSpotPrivateLifecycle,
  validateSpotSignatureLifecycleState,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/spotLifecycle.js';
import {
  createPrivateLifecycleWitness,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/lifecycleBinding.js';

const T0 = 1_800_000_000_000;
const HOUR_MS = 60 * 60 * 1_000;
const CONNECTION_LIFETIME_MS = 24 * HOUR_MS;
const ACCOUNT_REALM_ID = 'account-realm-synthetic-a';

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function initial() {
  return createInitialSpotPrivateLifecycleState();
}

function connection(overrides = {}) {
  return {
    kind: 'CONNECTION_OPENED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0,
    connectedAtMs: T0,
    reconnectPlannedAtMs: T0 + 23 * HOUR_MS,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 0,
    ...overrides,
  };
}

function subscription(overrides = {}) {
  return {
    kind: 'SIGNATURE_SUBSCRIPTION_ACCEPTED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 1,
    subscriptionId: 7,
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 1,
    ...overrides,
  };
}

function logout(overrides = {}) {
  return {
    kind: 'SESSION_LOGOUT_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 2,
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 1,
    ...overrides,
  };
}

function targetedUnsubscribe(overrides = {}) {
  return {
    kind: 'UNSUBSCRIBE_ACCEPTED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 3,
    scope: 'TARGETED',
    subscriptionId: 7,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 1,
    ...overrides,
  };
}

function unsubscribeAll(overrides = {}) {
  return {
    kind: 'UNSUBSCRIBE_ACCEPTED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 3,
    scope: 'ALL',
    subscriptionId: null,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 1,
    ...overrides,
  };
}

function termination(overrides = {}) {
  return {
    kind: 'EVENT_STREAM_TERMINATED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 4,
    exchangeEventTimeMs: T0 + 3,
    subscriptionId: 7,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 1,
    ...overrides,
  };
}

function revision(prefix, index) {
  return `${prefix}_${index.toString(16).padStart(32, '0')}`;
}

function canonicalStateValue(value) {
  if (Array.isArray(value)) return value.map(canonicalStateValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.keys(value).sort().map((field) => [field, canonicalStateValue(value[field])]);
}

function withRecomputedSpotStateCommitment(value) {
  const state = structuredClone(value);
  const content = Object.keys(state)
    .filter((field) => field !== 'stateContentRevision')
    .sort()
    .map((field) => [field, canonicalStateValue(state[field])]);
  state.stateContentRevision = `spot_state_${createHash('sha256')
    .update(JSON.stringify(['L05_SPOT_PRIVATE_STATE_CONTENT_V1', content]))
    .digest('hex')}`;
  return state;
}

function privateEvent(index, overrides = {}) {
  const event = {
    kind: 'PRIVATE_EVENT_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    eventKind: 'ACCOUNT',
    contentRevision: revision('spot_content', index),
    exchangeEventTimeMs: T0 + 10 + index,
    receiptTimeMs: T0 + 10 + index,
    ...overrides,
  };
  return {
    ...event,
    eventRevision: Object.hasOwn(overrides, 'eventRevision')
      ? overrides.eventRevision
      : createSpotRealmBoundRevision('spot_event', event.accountRealmId, {
          generation: event.generation,
          eventKind: event.eventKind,
          contentRevision: event.contentRevision,
          exchangeEventTimeMs: event.exchangeEventTimeMs,
          receiptTimeMs: event.receiptTimeMs,
        }),
  };
}

function restCut(index, throughMarker = null, overrides = {}) {
  const cut = {
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    reconciledAtMs: T0 + 100 + index,
    validUntilMs: T0 + 200 + index,
    throughEventRevision: throughMarker?.eventRevision ?? null,
    throughExchangeEventTimeMs: throughMarker?.exchangeEventTimeMs ?? null,
    ...overrides,
  };
  return {
    ...cut,
    reconciliationRevision: Object.hasOwn(overrides, 'reconciliationRevision')
      ? overrides.reconciliationRevision
      : createSpotRealmBoundRevision('spot_rest', cut.accountRealmId, {
          generation: cut.generation,
          reconciledAtMs: cut.reconciledAtMs,
          validUntilMs: cut.validUntilMs,
          throughEventRevision: cut.throughEventRevision,
          throughExchangeEventTimeMs: cut.throughExchangeEventTimeMs,
        }),
  };
}

function apply(state, event) {
  const result = reduceSpotPrivateLifecycle(state, event);
  assert.equal(result.accepted, true, JSON.stringify(result.issues));
  const validated = validateSpotSignatureLifecycleState(result.state);
  assert.notEqual(validated, null, 'every accepted reducer state must validate');
  assert.deepEqual(validated, result.state);
  assertDeeplyFrozen(result);
  assertNoAuthority(result);
  return result.state;
}

function reject(state, event, code) {
  const result = reduceSpotPrivateLifecycle(state, event);
  assert.equal(result.accepted, false);
  assert.ok(result.issues.some((issue) => issue.code === code), JSON.stringify(result.issues));
  const validated = validateSpotSignatureLifecycleState(result.state);
  assert.notEqual(validated, null, 'every rejected reducer state must validate');
  assert.deepEqual(validated, result.state);
  assertDeeplyFrozen(result);
  assertNoAuthority(result);
  return result;
}

function connectedState(overrides = {}) {
  return apply(initial(), connection(overrides));
}

function subscribedState(connectionOverrides = {}, subscriptionOverrides = {}) {
  return apply(connectedState(connectionOverrides), subscription(subscriptionOverrides));
}

function assertNoAuthority(result) {
  assert.equal(result.sendEligible, false);
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(result.actionAuthority, 'NONE_RECORD_ONLY');
  const state = result.state;
  assert.equal(state.sendEligible, false);
  assert.equal(state.externalActionAuthorization, 'NONE');
  assert.equal(state.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(state.truthAuthority, 'EVIDENCE_ONLY');
  assert.equal(state.accountReadAuthorized, false);
  assert.equal(state.mutationAuthorized, false);
  assert.equal(state.capitalAuthority, 'NONE');
  assert.equal(state.riskAuthority, 'NONE');
  assert.equal(state.reconciliationAuthority, 'NONE');
  assert.equal(state.sequenceCompleteness, 'UNKNOWN_NO_GLOBAL_SEQUENCE');
  assert.equal(Object.hasOwn(state, 'ready'), false);
  assert.equal(Object.hasOwn(state, 'tradeReady'), false);
}

test('initial Spot signature lifecycle state is exact, frozen, and non-authoritative', () => {
  const state = initial();
  assert.deepEqual(state, {
    schema: 'SPOT_SIGNATURE_PRIVATE_STREAM_LIFECYCLE_V1',
    sourceRevision: 'L02-BINANCE-2026-07-12',
    matrixSha256: '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac',
    accountRealmId: ACCOUNT_REALM_ID,
    stateContentRevision: state.stateContentRevision,
    product: 'SPOT',
    environment: 'PRODUCTION',
    realm: 'PRIVATE_USER_DATA',
    contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE',
    routeClass: 'WEBSOCKET_API',
    subscriptionMethod: 'userDataStream.subscribe.signature',
    signatureKeyType: 'HMAC',
    encoding: 'JSON_TEXT',
    timestampUnit: 'MILLISECONDS',
    connectionLifetimeMs: 86_400_000,
    maximumActiveSubscriptions: 1_000,
    maximumLifetimeSubscriptions: 65_535,
    sessionAuthenticated: false,
    connected: false,
    signatureAuthorized: false,
    subscribed: false,
    generation: null,
    connectedAtMs: null,
    reconnectPlannedAtMs: null,
    hardDisconnectAtMs: null,
    reconnectDue: false,
    lastObservedAtMs: null,
    lastExchangeEventTimeMs: null,
    subscriptionId: null,
    pendingTerminationSubscriptionId: null,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 0,
    integrityPosture: 'CLEAN',
    qualityPosture: 'CLEAN',
    lastQualityLossAtMs: null,
    lastTransition: 'INITIAL',
    lastDisconnectReason: null,
    connectionCount: 0,
    reconnectCount: 0,
    unsubscribeCount: 0,
    terminationCount: 0,
    logoutCount: 0,
    serverShutdownCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    malformedCount: 0,
    staleGenerationEventCount: 0,
    conflictingEventCount: 0,
    observedPrivateEventCount: 0,
    unretainedPrivateEventObservationCount: 0,
    privateEventDuplicateObservationCount: 0,
    privateEventConflictObservationCount: 0,
    eventWatermarks: [],
    recentEventMarkers: [],
    dedupeCoverageTruncated: false,
    lastPrivateEventMarker: null,
    lastAccountEventMarker: null,
    lastOrderEventMarker: null,
    lastFillEventMarker: null,
    lastContinuityBreakAtMs: null,
    ownerRestCut: null,
    restReconciliationFreshness: 'UNAVAILABLE',
    restReconciliationLagMs: null,
    continuityPosture: 'UNPROVED',
    sequenceCompleteness: 'UNKNOWN_NO_GLOBAL_SEQUENCE',
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    truthAuthority: 'EVIDENCE_ONLY',
    sendEligible: false,
    accountReadAuthorized: false,
    mutationAuthorized: false,
    capitalAuthority: 'NONE',
    riskAuthority: 'NONE',
    reconciliationAuthority: 'NONE',
  });
  assert.deepEqual(SPOT_SIGNATURE_LIFECYCLE_CONTRACT, {
    schema: 'SPOT_SIGNATURE_PRIVATE_STREAM_LIFECYCLE_V1',
    sourceRevision: 'L02-BINANCE-2026-07-12',
    matrixSha256: '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac',
    product: 'SPOT',
    environment: 'PRODUCTION',
    realm: 'PRIVATE_USER_DATA',
    contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE',
    routeClass: 'WEBSOCKET_API',
    subscriptionMethod: 'userDataStream.subscribe.signature',
    signatureKeyType: 'HMAC',
    encoding: 'JSON_TEXT',
    timestampUnit: 'MILLISECONDS',
    connectionLifetimeMs: 86_400_000,
    maximumActiveSubscriptions: 1_000,
    maximumLifetimeSubscriptions: 65_535,
    sessionAuthentication: 'NOT_USED_FOR_SIGNATURE_SUBSCRIPTION',
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
  });
  assertDeeplyFrozen(state);
  assert.match(state.stateContentRevision, /^spot_state_[0-9a-f]{64}$/);
  assertDeeplyFrozen(SPOT_SIGNATURE_LIFECYCLE_CONTRACT);
  assert.equal(SPOT_PRIVATE_MATRIX_SHA256,
    '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac');
  assert.throws(() => { state.connected = true; }, TypeError);
});

test('constructor and total validator bind the exact matrix and namespaced account realm', () => {
  const custom = createInitialSpotPrivateLifecycleState('account.prod.synthetic-b');
  assert.equal(custom.accountRealmId, 'account.prod.synthetic-b');
  assert.equal(custom.matrixSha256, SPOT_PRIVATE_MATRIX_SHA256);
  assert.throws(
    () => createInitialSpotPrivateLifecycleState('synthetic-account-without-realm-namespace'),
    /namespaced account-realm/i,
  );

  const validated = validateSpotSignatureLifecycleState(custom);
  assert.deepEqual(validated, custom);
  assertDeeplyFrozen(validated);
  assert.equal(validateSpotSignatureLifecycleState({
    ...custom,
    matrixSha256: '0'.repeat(64),
  }), null);
  assert.equal(validateSpotSignatureLifecycleState({
    ...custom,
    accountRealmId: 'not-a-namespaced-realm',
  }), null);

  let trapCalls = 0;
  const hostile = new Proxy({}, {
    ownKeys() {
      trapCalls += 1;
      throw new Error('validator must not invoke traps');
    },
  });
  assert.equal(validateSpotSignatureLifecycleState(hostile), null);
  assert.equal(trapCalls, 0);
});

test('cross-account and missing-realm observations cannot substitute lifecycle evidence', () => {
  const state = initial();
  const crossAccount = reject(state, connection({
    accountRealmId: 'account-realm-synthetic-b',
  }), 'ACCOUNT_REALM_MISMATCH');
  assert.equal(crossAccount.state.accountRealmId, ACCOUNT_REALM_ID);
  assert.equal(crossAccount.state.connected, false);

  const missingRealm = connection();
  delete missingRealm.accountRealmId;
  reject(state, missingRealm, 'OBSERVATION_INVALID');
});

test('connection, signature authorization, and subscription remain separate state', () => {
  const connected = connectedState();
  assert.equal(connected.connected, true);
  assert.equal(connected.signatureAuthorized, false);
  assert.equal(connected.subscribed, false);
  assert.equal(connected.sessionAuthenticated, false);
  assert.equal(connected.hardDisconnectAtMs, T0 + CONNECTION_LIFETIME_MS);

  const subscribed = apply(connected, subscription());
  assert.equal(subscribed.connected, true);
  assert.equal(subscribed.signatureAuthorized, true);
  assert.equal(subscribed.subscribed, true);
  assert.equal(subscribed.sessionAuthenticated, false);
  assert.equal(subscribed.subscriptionId, 7);
});

test('session logout preserves the selected signature subscription exactly', () => {
  const before = subscribedState();
  const after = apply(before, logout());
  assert.equal(after.connected, true);
  assert.equal(after.signatureAuthorized, true);
  assert.equal(after.subscribed, true);
  assert.equal(after.subscriptionId, 7);
  assert.equal(after.sessionActiveSubscriptionCount, 1);
  assert.equal(after.logoutCount, 1);
  assert.equal(after.lastTransition, 'SESSION_LOGOUT_OBSERVED_SIGNATURE_UNCHANGED');
});

test('logout cannot silently close or alter a signature subscription', () => {
  const before = subscribedState();
  const result = reject(before, logout({
    sessionActiveSubscriptionCount: 0,
  }), 'SESSION_COUNTER_CONFLICT');
  assert.equal(result.state.subscribed, true);
  assert.equal(result.state.subscriptionId, 7);
});

test('targeted unsubscribe and its terminal event do not double-decrement counters', () => {
  const subscribed = subscribedState();
  const stopped = apply(subscribed, targetedUnsubscribe());
  assert.equal(stopped.subscribed, false);
  assert.equal(stopped.signatureAuthorized, true);
  assert.equal(stopped.sessionActiveSubscriptionCount, 0);
  assert.equal(stopped.sessionLifetimeSubscriptionCount, 1);
  assert.equal(stopped.pendingTerminationSubscriptionId, 7);

  const confirmed = apply(stopped, termination());
  assert.equal(confirmed.pendingTerminationSubscriptionId, null);
  assert.equal(confirmed.sessionActiveSubscriptionCount, 0);
  assert.equal(confirmed.sessionLifetimeSubscriptionCount, 1);
  assert.equal(confirmed.terminationCount, 1);
});

test('unsubscribe-all closes the selected subscription and awaits its terminal identity', () => {
  const subscribed = subscribedState();
  const stopped = apply(subscribed, unsubscribeAll());
  assert.equal(stopped.subscribed, false);
  assert.equal(stopped.subscriptionId, null);
  assert.equal(stopped.pendingTerminationSubscriptionId, 7);
  assert.equal(stopped.sessionActiveSubscriptionCount, 0);
  const confirmed = apply(stopped, termination());
  assert.equal(confirmed.pendingTerminationSubscriptionId, null);
});

test('targeted unsubscribe for another account leaves the tracked subscription active', () => {
  const connected = connectedState({
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 1,
  });
  const subscribed = apply(connected, subscription({
    sessionActiveSubscriptionCount: 2,
    sessionLifetimeSubscriptionCount: 2,
  }));
  const after = apply(subscribed, targetedUnsubscribe({
    subscriptionId: 6,
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 2,
  }));
  assert.equal(after.subscribed, true);
  assert.equal(after.subscriptionId, 7);
  assert.equal(after.pendingTerminationSubscriptionId, null);
});

test('unrelated terminal event does not terminate the tracked subscription', () => {
  const connected = connectedState({
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 1,
  });
  const subscribed = apply(connected, subscription({
    sessionActiveSubscriptionCount: 2,
    sessionLifetimeSubscriptionCount: 2,
  }));
  const after = apply(subscribed, termination({
    subscriptionId: 6,
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 2,
  }));
  assert.equal(after.subscribed, true);
  assert.equal(after.subscriptionId, 7);
});

test('missing subscription identity fails closed and degrades attribution', () => {
  const before = subscribedState();
  const result = reduceSpotPrivateLifecycle(before, termination({ subscriptionId: null }));
  assert.equal(result.accepted, true);
  assert.ok(result.issues.some((issue) => issue.code === 'SUBSCRIPTION_ID_UNATTRIBUTED'));
  assert.equal(result.state.subscribed, false);
  assert.equal(result.state.subscriptionId, null);
  assert.equal(result.state.integrityPosture, 'DEGRADED');
  assertNoAuthority(result);
});

test('reconnect marker is exact below and at its injected boundary', () => {
  const before = connectedState();
  const below = apply(before, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0 + 23 * HOUR_MS - 1,
  });
  assert.equal(below.connected, true);
  assert.equal(below.reconnectDue, false);
  const at = apply(below, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0 + 23 * HOUR_MS,
  });
  assert.equal(at.connected, true);
  assert.equal(at.reconnectDue, true);
});

test('reconnectDue is canonically derived on every state and cannot be caller-rewritten', () => {
  const beforeDue = connectedState();
  assert.equal(beforeDue.reconnectDue, false);
  assert.equal(validateSpotSignatureLifecycleState({
    ...beforeDue,
    reconnectDue: true,
  }), null);

  const dueAtMs = T0 + 2;
  const connected = connectedState({ reconnectPlannedAtMs: dueAtMs });
  const dueWithoutClockTick = apply(connected, subscription({ observedAtMs: dueAtMs }));
  assert.equal(dueWithoutClockTick.reconnectDue, true);
  assert.equal(validateSpotSignatureLifecycleState({
    ...dueWithoutClockTick,
    reconnectDue: false,
  }), null);
});

test('24-hour hard lifetime is valid below and closed exactly at the boundary', () => {
  const before = subscribedState();
  const below = apply(before, {
    kind: 'CLOCK_OBSERVED', generation: 1,
    accountRealmId: ACCOUNT_REALM_ID,
    observedAtMs: T0 + CONNECTION_LIFETIME_MS - 1,
  });
  assert.equal(below.connected, true);
  assert.equal(below.subscribed, true);

  const result = reduceSpotPrivateLifecycle(below, {
    kind: 'CLOCK_OBSERVED', generation: 1,
    accountRealmId: ACCOUNT_REALM_ID,
    observedAtMs: T0 + CONNECTION_LIFETIME_MS,
  });
  assert.equal(result.accepted, true);
  assert.ok(result.issues.some((issue) => issue.code === 'CONNECTION_LIFETIME_EXPIRED'));
  assert.equal(result.state.connected, false);
  assert.equal(result.state.signatureAuthorized, false);
  assert.equal(result.state.subscribed, false);
  assert.equal(result.state.lastDisconnectReason, 'CONNECTION_LIFETIME_EXPIRED');
  assertNoAuthority(result);
});

test('canonical validator rejects caller-authored connected state at the hard boundary', () => {
  const below = apply(subscribedState(), {
    kind: 'CLOCK_OBSERVED', generation: 1,
    accountRealmId: ACCOUNT_REALM_ID,
    observedAtMs: T0 + CONNECTION_LIFETIME_MS - 1,
  });
  assert.notEqual(validateSpotSignatureLifecycleState(below), null);
  assert.equal(below.connected, true);

  const forgedAtBoundary = {
    ...below,
    lastObservedAtMs: below.hardDisconnectAtMs,
  };
  assert.equal(validateSpotSignatureLifecycleState(forgedAtBoundary), null);
});

test('hard expiry preempts later subscription observations without a separate clock tick', () => {
  const before = connectedState();
  const result = reject(before, subscription({
    observedAtMs: T0 + CONNECTION_LIFETIME_MS,
  }), 'CONNECTION_LIFETIME_EXPIRED');
  assert.equal(result.state.connected, false);
  assert.equal(result.state.subscribed, false);
});

test('reconnect must be planned strictly after observation and before 24 hours', () => {
  reject(initial(), connection({ reconnectPlannedAtMs: T0 }), 'RECONNECT_PLAN_INVALID');
  reject(initial(), connection({
    reconnectPlannedAtMs: T0 + CONNECTION_LIFETIME_MS,
  }), 'RECONNECT_PLAN_INVALID');
});

test('1,000 active subscription boundary is exact', () => {
  const before = connectedState({
    sessionActiveSubscriptionCount: 999,
    sessionLifetimeSubscriptionCount: 999,
  });
  const at = apply(before, subscription({
    sessionActiveSubscriptionCount: 1_000,
    sessionLifetimeSubscriptionCount: 1_000,
  }));
  assert.equal(at.sessionActiveSubscriptionCount, 1_000);

  const full = connectedState({
    sessionActiveSubscriptionCount: 1_000,
    sessionLifetimeSubscriptionCount: 1_000,
  });
  reject(full, subscription({
    sessionActiveSubscriptionCount: 1_000,
    sessionLifetimeSubscriptionCount: 1_000,
  }), 'ACTIVE_SUBSCRIPTION_LIMIT_REACHED');
});

test('65,535 lifetime subscription boundary is exact', () => {
  const before = connectedState({
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 65_534,
  });
  const at = apply(before, subscription({
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 65_535,
  }));
  assert.equal(at.sessionLifetimeSubscriptionCount, 65_535);

  const full = connectedState({
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 65_535,
  });
  reject(full, subscription({
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 65_535,
  }), 'LIFETIME_SUBSCRIPTION_LIMIT_REACHED');
});

test('counter jumps and lifetime regression fail closed', () => {
  const connected = connectedState();
  reject(connected, subscription({
    sessionActiveSubscriptionCount: 2,
    sessionLifetimeSubscriptionCount: 2,
  }), 'SESSION_COUNTER_CONFLICT');

  const subscribed = apply(connected, subscription());
  reject(subscribed, logout({
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 0,
  }), 'SESSION_COUNTER_CONFLICT');
});

test('same and stale connection generations are rejected while a higher generation resets state', () => {
  const first = subscribedState();
  const duplicate = reject(first, connection({
    observedAtMs: T0 + 2,
    connectedAtMs: T0 + 2,
    reconnectPlannedAtMs: T0 + 22 * HOUR_MS,
  }), 'CONNECTION_ALREADY_OPEN');
  assert.equal(duplicate.state.duplicateCount, 1);

  const second = apply(first, connection({
    generation: 2,
    observedAtMs: T0 + 10,
    connectedAtMs: T0 + 10,
    reconnectPlannedAtMs: T0 + 23 * HOUR_MS,
  }));
  assert.equal(second.generation, 2);
  assert.equal(second.connected, true);
  assert.equal(second.signatureAuthorized, false);
  assert.equal(second.subscribed, false);
  assert.equal(second.connectionCount, 2);
  assert.equal(second.reconnectCount, 1);

  reject(second, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0 + 11,
  }, 'GENERATION_INVALID');
});

test('observation time cannot move backwards within a generation', () => {
  const before = subscribedState();
  const result = reject(before, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0,
  }, 'OBSERVATION_OUT_OF_ORDER');
  assert.equal(result.state.outOfOrderCount, 1);
  assert.equal(result.state.subscribed, true);
});

test('signature rejection is blocking evidence and never changes injected counters', () => {
  const before = connectedState();
  const after = apply(before, {
    kind: 'SIGNATURE_SUBSCRIPTION_REJECTED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 1,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 0,
  });
  assert.equal(after.signatureAuthorized, false);
  assert.equal(after.subscribed, false);
  assert.equal(after.integrityPosture, 'DEGRADED');
});

test('server shutdown immediately makes the selected lifecycle unavailable', () => {
  const before = subscribedState();
  const after = apply(before, {
    kind: 'SERVER_SHUTDOWN_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 2,
    exchangeEventTimeMs: T0 + 1,
  });
  assert.equal(after.connected, false);
  assert.equal(after.signatureAuthorized, false);
  assert.equal(after.subscribed, false);
  assert.equal(after.reconnectDue, true);
  assert.equal(after.lastDisconnectReason, 'SERVER_SHUTDOWN');
  assert.equal(after.serverShutdownCount, 1);
});

test('transport close and planned reconnect both clear connection-local authority', () => {
  for (const reason of ['TRANSPORT_CLOSED', 'PLANNED_RECONNECT']) {
    const before = subscribedState();
    const after = apply(before, {
      kind: 'CONNECTION_CLOSED', accountRealmId: ACCOUNT_REALM_ID,
      generation: 1, observedAtMs: T0 + 2, reason,
    });
    assert.equal(after.connected, false, reason);
    assert.equal(after.signatureAuthorized, false, reason);
    assert.equal(after.subscribed, false, reason);
    assert.equal(after.lastDisconnectReason, reason);
  }
});

test('duplicate close is rejected instead of fabricating another transition', () => {
  const closed = apply(connectedState(), {
    kind: 'CONNECTION_CLOSED', generation: 1,
    accountRealmId: ACCOUNT_REALM_ID,
    observedAtMs: T0 + 1, reason: 'TRANSPORT_CLOSED',
  });
  const result = reject(closed, {
    kind: 'CONNECTION_CLOSED', generation: 1,
    accountRealmId: ACCOUNT_REALM_ID,
    observedAtMs: T0 + 2, reason: 'TRANSPORT_CLOSED',
  }, 'CONNECTION_NOT_OPEN');
  assert.equal(result.state.duplicateCount, 1);
});

test('explicit duplicate, out-of-order, and malformed observations are bounded evidence only', () => {
  let state = connectedState();
  for (const [quality, field] of [
    ['DUPLICATE', 'duplicateCount'],
    ['OUT_OF_ORDER', 'outOfOrderCount'],
    ['MALFORMED', 'malformedCount'],
  ]) {
    state = apply(state, {
      kind: 'EVENT_QUALITY_OBSERVED',
      accountRealmId: ACCOUNT_REALM_ID,
      generation: 1,
      observedAtMs: (state.lastObservedAtMs ?? T0) + 1,
      quality,
    });
    assert.equal(state[field], 1);
    assert.equal(state.integrityPosture, 'DEGRADED');
  }
});

test('private account, order, and fill events retain exact bounded markers before owner REST', () => {
  let state = subscribedState();
  state = apply(state, privateEvent(1));
  state = apply(state, privateEvent(2, { eventKind: 'ORDER' }));
  state = apply(state, privateEvent(3, { eventKind: 'FILL' }));

  assert.equal(state.observedPrivateEventCount, 3);
  assert.equal(state.recentEventMarkers.length, 3);
  assert.equal(state.lastAccountEventMarker.eventRevision, privateEvent(1).eventRevision);
  assert.equal(state.lastOrderEventMarker.eventRevision,
    privateEvent(2, { eventKind: 'ORDER' }).eventRevision);
  assert.equal(state.lastFillEventMarker.eventRevision,
    privateEvent(3, { eventKind: 'FILL' }).eventRevision);
  assert.equal(state.lastPrivateEventMarker.eventRevision,
    privateEvent(3, { eventKind: 'FILL' }).eventRevision);
  assert.equal(
    state.lastExchangeEventTimeMs,
    state.lastPrivateEventMarker.exchangeEventTimeMs,
  );
  assert.deepEqual(state.eventWatermarks, [
    { eventKind: 'ACCOUNT', exchangeEventTimeMs: T0 + 11 },
    { eventKind: 'FILL', exchangeEventTimeMs: T0 + 13 },
    { eventKind: 'ORDER', exchangeEventTimeMs: T0 + 12 },
  ]);
  assert.equal(state.restReconciliationFreshness, 'UNAVAILABLE');
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');

  state = apply(state, restCut(1, state.lastPrivateEventMarker));
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  assert.equal(state.restReconciliationLagMs, null);
  assert.equal(state.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');
});

test('retained Spot event and owner-cut evidence is exactly account-bound', () => {
  let eventful = apply(subscribedState(), privateEvent(1));
  eventful = apply(eventful, restCut(1, eventful.lastPrivateEventMarker));
  assert.equal(eventful.recentEventMarkers[0].accountRealmId, ACCOUNT_REALM_ID);
  assert.equal(eventful.lastPrivateEventMarker.accountRealmId, ACCOUNT_REALM_ID);
  assert.equal(eventful.ownerRestCut.accountRealmId, ACCOUNT_REALM_ID);

  const retainedMarkerRetag = structuredClone(eventful);
  retainedMarkerRetag.recentEventMarkers[0].accountRealmId = 'account-realm-synthetic-b';
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(retainedMarkerRetag),
  ), null);

  const summaryMarkerRetag = structuredClone(eventful);
  summaryMarkerRetag.lastPrivateEventMarker.accountRealmId = 'account-realm-synthetic-b';
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(summaryMarkerRetag),
  ), null);

  const cutRetag = structuredClone(eventful);
  cutRetag.ownerRestCut.accountRealmId = 'account-realm-synthetic-b';
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(cutRetag),
  ), null);

  assert.equal(validateSpotSignatureLifecycleState(withRecomputedSpotStateCommitment({
    ...eventful,
    accountRealmId: 'account-realm-synthetic-b',
  })), null, 'eventful ready state cannot be top-level retagged');

  const eventless = apply(subscribedState(), restCut(2));
  assert.equal(eventless.restReconciliationFreshness, 'FRESH');
  assert.equal(validateSpotSignatureLifecycleState(withRecomputedSpotStateCommitment({
    ...eventless,
    accountRealmId: 'account-realm-synthetic-b',
  })), null, 'eventless ready state cannot be top-level retagged');
});

test('realm-bound revisions reject coherent account retags and admit a derived custom realm', () => {
  const otherRealm = 'account-realm-synthetic-b';
  const eventful = apply(subscribedState(), privateEvent(1));
  const coherentEventRetag = structuredClone(eventful);
  coherentEventRetag.accountRealmId = otherRealm;
  for (const marker of coherentEventRetag.recentEventMarkers) marker.accountRealmId = otherRealm;
  coherentEventRetag.lastPrivateEventMarker.accountRealmId = otherRealm;
  coherentEventRetag.lastAccountEventMarker.accountRealmId = otherRealm;
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(coherentEventRetag),
  ), null);

  const eventless = apply(subscribedState(), restCut(2));
  const coherentCutRetag = structuredClone(eventless);
  coherentCutRetag.accountRealmId = otherRealm;
  coherentCutRetag.ownerRestCut.accountRealmId = otherRealm;
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(coherentCutRetag),
  ), null);

  let custom = createInitialSpotPrivateLifecycleState(otherRealm);
  custom = apply(custom, connection({ accountRealmId: otherRealm }));
  custom = apply(custom, subscription({ accountRealmId: otherRealm }));
  custom = apply(custom, privateEvent(3, {
    accountRealmId: otherRealm,
  }));
  custom = apply(custom, restCut(3, custom.lastPrivateEventMarker, {
    accountRealmId: otherRealm,
  }));
  assert.notEqual(validateSpotSignatureLifecycleState(custom), null);
});

test('untruncated Spot marker accounting rejects silent pre-capacity deletion', () => {
  let state = subscribedState();
  state = apply(state, privateEvent(1));
  state = apply(state, privateEvent(2));
  state = apply(state, restCut(3, state.lastPrivateEventMarker));
  assert.equal(state.observedPrivateEventCount, 2);
  assert.equal(state.unretainedPrivateEventObservationCount, 0);
  assert.equal(state.recentEventMarkers.length, 2);
  assert.equal(createPrivateLifecycleWitness({
    state,
    evaluatedAtMs: state.lastObservedAtMs,
  }).acceptableForOwnerComparison, true);

  const deleted = structuredClone(state);
  deleted.recentEventMarkers.shift();
  const committedDeletion = withRecomputedSpotStateCommitment(deleted);
  assert.equal(validateSpotSignatureLifecycleState(committedDeletion), null);
  assert.throws(() => createPrivateLifecycleWitness({
    state: committedDeletion,
    evaluatedAtMs: committedDeletion.lastObservedAtMs,
  }), /canonical validator/i);

  const unclassified = structuredClone(state);
  unclassified.observedPrivateEventCount += 1;
  unclassified.unretainedPrivateEventObservationCount += 1;
  const committedUnclassified = withRecomputedSpotStateCommitment(unclassified);
  assert.equal(validateSpotSignatureLifecycleState(committedUnclassified), null,
    'every unretained observation needs a retained duplicate or conflict classification');
  assert.throws(() => createPrivateLifecycleWitness({
    state: committedUnclassified,
    evaluatedAtMs: committedUnclassified.lastObservedAtMs,
  }), /canonical validator/i);

  const unrelatedDuplicate = reject(subscribedState(), subscription({
    observedAtMs: T0 + 2,
  }), 'ACCOUNT_ALREADY_SUBSCRIBED').state;
  const falselyClassified = structuredClone(unrelatedDuplicate);
  falselyClassified.observedPrivateEventCount = 1;
  falselyClassified.unretainedPrivateEventObservationCount = 1;
  assert.equal(falselyClassified.duplicateCount, 1);
  assert.equal(falselyClassified.privateEventDuplicateObservationCount, 0);
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(falselyClassified),
  ), null,
    'an unrelated lifecycle duplicate cannot classify an unretained private event');
});

test('content revisions reject timestamp-tie retained-order and owner-cut rewrites', () => {
  let state = subscribedState();
  state = apply(state, privateEvent(4, {
    eventKind: 'ACCOUNT', exchangeEventTimeMs: T0 + 10, receiptTimeMs: T0 + 20,
  }));
  state = apply(state, privateEvent(5, {
    eventKind: 'ORDER', exchangeEventTimeMs: T0 + 10, receiptTimeMs: T0 + 20,
  }));
  state = apply(state, restCut(4, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 30, validUntilMs: T0 + 100,
  }));
  assert.equal(state.lastPrivateEventMarker.eventKind, 'ORDER');
  assert.equal(createPrivateLifecycleWitness({
    state,
    evaluatedAtMs: T0 + 30,
  }).acceptableForOwnerComparison, true);

  const rewound = structuredClone(state);
  rewound.recentEventMarkers.reverse();
  rewound.lastPrivateEventMarker = structuredClone(rewound.lastAccountEventMarker);
  rewound.lastExchangeEventTimeMs = rewound.lastAccountEventMarker.exchangeEventTimeMs;
  rewound.ownerRestCut.throughEventRevision = rewound.lastAccountEventMarker.eventRevision;
  rewound.ownerRestCut.throughExchangeEventTimeMs =
    rewound.lastAccountEventMarker.exchangeEventTimeMs;
  const committedRewind = withRecomputedSpotStateCommitment(rewound);
  assert.equal(validateSpotSignatureLifecycleState(committedRewind), null);
  assert.throws(() => createPrivateLifecycleWitness({
    state: committedRewind,
    evaluatedAtMs: T0 + 30,
  }), /canonical validator/i);
});

test('mixed private classifications close exactly at the bounded observation counter', () => {
  const ordinary = apply(subscribedState(), privateEvent(70));
  assert.equal(
    withRecomputedSpotStateCommitment(ordinary).stateContentRevision,
    ordinary.stateContentRevision,
    'test commitment reconstruction matches the internal canonical commitment',
  );
  const nearCap = withRecomputedSpotStateCommitment({
    ...ordinary,
    observedPrivateEventCount: 999_999,
    unretainedPrivateEventObservationCount: 999_998,
    privateEventDuplicateObservationCount: 499_999,
    privateEventConflictObservationCount: 499_999,
    duplicateCount: 499_999,
    conflictingEventCount: 499_999,
    dedupeCoverageTruncated: true,
    integrityPosture: 'DEGRADED',
    qualityPosture: 'CURRENT_GENERATION_DEGRADED',
    lastQualityLossAtMs: ordinary.lastObservedAtMs,
  });
  assert.notEqual(validateSpotSignatureLifecycleState(nearCap), null);

  const atCap = apply(nearCap, privateEvent(70));
  assert.equal(atCap.observedPrivateEventCount, 1_000_000);
  assert.equal(atCap.unretainedPrivateEventObservationCount, 999_999);
  assert.equal(atCap.privateEventDuplicateObservationCount, 500_000);
  const bounded = reject(atCap, privateEvent(70, {
    contentRevision: revision('spot_content', 71),
  }), 'COUNTER_LIMIT_REACHED');
  assert.equal(bounded.state.observedPrivateEventCount, 1_000_000);
  assert.equal(bounded.state.privateEventConflictObservationCount, 499_999);
});

test('content-derived owner cut rejects coherent removal of all retained event truth', () => {
  let state = apply(subscribedState(), privateEvent(41));
  state = apply(state, restCut(41, state.lastPrivateEventMarker));
  assert.equal(createPrivateLifecycleWitness({
    state,
    evaluatedAtMs: state.lastObservedAtMs,
  }).acceptableForOwnerComparison, true);

  const erased = structuredClone(state);
  erased.recentEventMarkers = [];
  erased.eventWatermarks = [];
  erased.lastPrivateEventMarker = null;
  erased.lastAccountEventMarker = null;
  erased.lastOrderEventMarker = null;
  erased.lastFillEventMarker = null;
  erased.lastExchangeEventTimeMs = null;
  erased.observedPrivateEventCount = 0;
  erased.unretainedPrivateEventObservationCount = 0;
  erased.ownerRestCut.throughEventRevision = null;
  erased.ownerRestCut.throughExchangeEventTimeMs = null;
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(erased),
  ), null,
    'same owner-cut revision cannot rewrite an eventful cut into an eventless cut');
});

test('Spot generation and retained quality provenance cannot be coherently rewritten', () => {
  let state = apply(subscribedState(), privateEvent(51));
  state = apply(state, restCut(51, state.lastPrivateEventMarker));

  const generationRetag = structuredClone(state);
  generationRetag.generation = 2;
  for (const marker of generationRetag.recentEventMarkers) marker.generation = 2;
  generationRetag.lastPrivateEventMarker.generation = 2;
  generationRetag.lastAccountEventMarker.generation = 2;
  generationRetag.ownerRestCut.generation = 2;
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(generationRetag),
  ), null,
    'event and owner-cut revisions bind the observed connection generation');

  const reportedQuality = (quality) => apply(state, {
    kind: 'EVENT_QUALITY_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: state.lastObservedAtMs + 1, quality,
  });
  let stale = apply(state, connection({
    generation: 2,
    observedAtMs: state.lastObservedAtMs + 1,
    connectedAtMs: state.lastObservedAtMs + 1,
    reconnectPlannedAtMs: state.lastObservedAtMs + 23 * HOUR_MS,
  }));
  stale = apply(stale, subscription({
    generation: 2,
    observedAtMs: stale.lastObservedAtMs + 1,
  }));
  stale = apply(stale, privateEvent(52, {
    generation: 1,
    exchangeEventTimeMs: stale.lastObservedAtMs + 1,
    receiptTimeMs: stale.lastObservedAtMs + 1,
  }));

  for (const [label, degraded, counter] of [
    ['duplicate', reportedQuality('DUPLICATE'), 'duplicateCount'],
    ['out-of-order', reportedQuality('OUT_OF_ORDER'), 'outOfOrderCount'],
    ['malformed', reportedQuality('MALFORMED'), 'malformedCount'],
    ['conflict', reportedQuality('CONFLICT'), 'conflictingEventCount'],
    ['stale-generation', stale, 'staleGenerationEventCount'],
  ]) {
    assert.equal(degraded[ counter ], 1, label);
    assert.equal(degraded.qualityPosture, 'CURRENT_GENERATION_DEGRADED', label);
    assert.notEqual(degraded.lastQualityLossAtMs, null, label);

    const hidden = structuredClone(degraded);
    hidden[counter] = 0;
    hidden.integrityPosture = 'CLEAN';
    assert.equal(validateSpotSignatureLifecycleState(
      withRecomputedSpotStateCommitment(hidden),
    ), null,
      `${label} retained quality timestamp and posture prevent counter clearing`);

    const erasedProvenance = structuredClone(degraded);
    erasedProvenance.lastQualityLossAtMs = null;
    erasedProvenance.qualityPosture = 'CLEAN';
    assert.equal(validateSpotSignatureLifecycleState(
      withRecomputedSpotStateCommitment(erasedProvenance),
    ), null,
      `${label} counter prevents quality provenance clearing`);
  }
});

test('Spot integrity is canonical and an uncovered continuity break cannot be rewritten CLEAN', () => {
  const uncovered = connectedState();
  assert.notEqual(uncovered.lastContinuityBreakAtMs, null);
  assert.equal(uncovered.integrityPosture, 'DEGRADED');
  assert.equal(validateSpotSignatureLifecycleState({
    ...uncovered,
    integrityPosture: 'CLEAN',
  }), null);

  const covered = apply(uncovered, restCut(8));
  assert.equal(covered.integrityPosture, 'CLEAN');
  assert.equal(validateSpotSignatureLifecycleState({
    ...covered,
    integrityPosture: 'DEGRADED',
  }), null, 'caller cannot rewrite canonical recovered integrity either');

  const degraded = apply(covered, {
    kind: 'EVENT_QUALITY_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: covered.lastObservedAtMs + 1,
    quality: 'OUT_OF_ORDER',
  });
  assert.equal(degraded.integrityPosture, 'DEGRADED');
  assert.equal(validateSpotSignatureLifecycleState({
    ...degraded,
    integrityPosture: 'CLEAN',
  }), null);
});

test('last exchange event time is exactly the canonical last private marker or null', () => {
  const withoutPrivateEvent = subscribedState();
  assert.equal(withoutPrivateEvent.lastExchangeEventTimeMs, null);
  assert.equal(validateSpotSignatureLifecycleState({
    ...withoutPrivateEvent,
    lastExchangeEventTimeMs: T0,
  }), null);

  const withPrivateEvent = apply(withoutPrivateEvent, privateEvent(1));
  assert.equal(
    withPrivateEvent.lastExchangeEventTimeMs,
    withPrivateEvent.lastPrivateEventMarker.exchangeEventTimeMs,
  );
  assert.equal(validateSpotSignatureLifecycleState({
    ...withPrivateEvent,
    lastExchangeEventTimeMs: withPrivateEvent.lastExchangeEventTimeMs + 1,
  }), null);
});

test('reported duplicate quality cannot be rewound behind a prior owner cut', () => {
  let state = apply(subscribedState(), restCut(75));
  state = apply(state, {
    kind: 'EVENT_QUALITY_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: state.lastObservedAtMs + 1,
    quality: 'DUPLICATE',
  });
  assert.equal(state.duplicateCount, 1);
  assert.equal(state.qualityPosture, 'CURRENT_GENERATION_DEGRADED');
  assert.equal(state.integrityPosture, 'DEGRADED');

  const rewound = structuredClone(state);
  rewound.lastContinuityBreakAtMs = rewound.connectedAtMs;
  rewound.lastQualityLossAtMs = null;
  rewound.qualityPosture = 'CLEAN';
  rewound.integrityPosture = 'CLEAN';
  rewound.continuityPosture = 'OWNER_CUT_COVERS_OBSERVED_EVENTS';
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(rewound),
  ), null);
});

test('REST freshness, stream lag, recovery cut, and expiry boundaries are derived automatically', () => {
  let state = subscribedState();
  state = apply(state, privateEvent(1));
  state = apply(state, restCut(1, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 20,
    validUntilMs: T0 + 50,
  }));
  assert.equal(state.restReconciliationFreshness, 'FRESH');

  state = apply(state, privateEvent(2, {
    exchangeEventTimeMs: T0 + 30,
    receiptTimeMs: T0 + 30,
  }));
  assert.equal(state.restReconciliationFreshness, 'LAGGING_STREAM');
  assert.equal(state.restReconciliationLagMs, 19);
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');

  state = apply(state, restCut(2, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 31,
    validUntilMs: T0 + 50,
  }));
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  assert.equal(state.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');

  state = apply(state, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0 + 50,
  });
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  state = apply(state, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0 + 51,
  });
  assert.equal(state.restReconciliationFreshness, 'STALE');
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('content-derived event identity accepts exact duplicate, rejects rewrites, and records out-of-order evidence', () => {
  let state = subscribedState();
  const first = privateEvent(1);
  state = apply(state, first);
  state = apply(state, first);
  assert.equal(state.duplicateCount, 1);
  assert.equal(state.privateEventDuplicateObservationCount, 1);
  assert.equal(state.unretainedPrivateEventObservationCount, 1);
  assert.equal(state.recentEventMarkers.length, 1);

  state = apply(state, privateEvent(1, {
    contentRevision: revision('spot_content', 98),
  }));
  assert.equal(state.lastTransition, 'PRIVATE_EVENT_CONFLICT');
  assert.equal(state.conflictingEventCount, 1);
  assert.equal(state.privateEventConflictObservationCount, 1);
  assert.equal(state.unretainedPrivateEventObservationCount, 2);
  assert.equal(state.recentEventMarkers.length, 1,
    'same base identity with different sanitized content cannot become a second event');

  const rewritten = reject(state, {
    ...first,
    eventKind: 'ORDER',
    contentRevision: revision('spot_content', 99),
  }, 'PRIVATE_EVENT_INVALID');
  state = rewritten.state;
  assert.equal(state.conflictingEventCount, 1);
  assert.equal(state.recentEventMarkers.length, 1);

  state = apply(state, privateEvent(2, {
    exchangeEventTimeMs: T0 + 10,
    receiptTimeMs: T0 + 14,
  }));
  assert.equal(state.outOfOrderCount, 1);
  assert.equal(state.lastAccountEventMarker.eventRevision, first.eventRevision);

  state = apply(state, privateEvent(3, {
    eventKind: 'ORDER',
    exchangeEventTimeMs: T0 + 1,
    receiptTimeMs: T0 + 15,
  }));
  assert.equal(state.lastOrderEventMarker.eventRevision, privateEvent(3, {
    eventKind: 'ORDER', exchangeEventTimeMs: T0 + 1, receiptTimeMs: T0 + 15,
  }).eventRevision);
  assert.equal(state.lastExchangeEventTimeMs, T0 + 1);
  assert.equal(state.sequenceCompleteness, 'UNKNOWN_NO_GLOBAL_SEQUENCE');
});

test('private event future skew is accepted at and rejected above the exact boundary', () => {
  let state = subscribedState();
  state = apply(state, privateEvent(1, {
    receiptTimeMs: T0 + 20,
    exchangeEventTimeMs: T0 + 2_020,
  }));
  const result = reject(state, privateEvent(2, {
    receiptTimeMs: T0 + 21,
    exchangeEventTimeMs: T0 + 2_022,
  }), 'PRIVATE_EVENT_TIME_IN_FUTURE');
  assert.equal(result.state.recentEventMarkers.length, 1);
  assert.equal(result.state.lastPrivateEventMarker.eventRevision, privateEvent(1, {
    receiptTimeMs: T0 + 20, exchangeEventTimeMs: T0 + 2_020,
  }).eventRevision);
});

test('owner REST cuts require a retained exact through-event and immutable revision meaning', () => {
  let state = apply(subscribedState(), privateEvent(1));
  reject(state, restCut(9, {
    eventRevision: revision('spot_event', 99),
    exchangeEventTimeMs: T0 + 11,
  }, {
    reconciledAtMs: T0 + 20,
    validUntilMs: T0 + 50,
  }), 'REST_RECONCILIATION_CUT_INVALID');

  const cut = restCut(1, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 20,
    validUntilMs: T0 + 50,
  });
  state = apply(state, cut);
  state = apply(state, cut);
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  reject(state, {
    ...cut,
    reconciledAtMs: T0 + 21,
    validUntilMs: T0 + 51,
  }, 'REST_RECONCILIATION_CUT_INVALID');
  reject(state, restCut(2, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 21,
    validUntilMs: T0 + 51,
    throughExchangeEventTimeMs: state.lastPrivateEventMarker.exchangeEventTimeMs + 1,
  }), 'REST_RECONCILIATION_CUT_INVALID');
});

test('owner REST validity is capped at the exact 300-second private-fact boundary', () => {
  assert.equal(SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS, 300_000);
  const base = apply(subscribedState(), privateEvent(1));
  const reconciledAtMs = T0 + 20;
  const boundary = apply(base, restCut(1, base.lastPrivateEventMarker, {
    reconciledAtMs,
    validUntilMs: reconciledAtMs + SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS,
  }));
  assert.equal(boundary.ownerRestCut.validUntilMs,
    reconciledAtMs + SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS);
  assert.notEqual(validateSpotSignatureLifecycleState(boundary), null);

  reject(base, restCut(2, base.lastPrivateEventMarker, {
    reconciledAtMs,
    validUntilMs: reconciledAtMs + SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS + 1,
  }), 'REST_RECONCILIATION_CUT_INVALID');

  const forged = structuredClone(boundary);
  forged.ownerRestCut.validUntilMs += 1;
  assert.equal(validateSpotSignatureLifecycleState(forged), null);
});

test('Spot state commitment rejects coherent multi-field rollback and pre-connection evidence', () => {
  let state = apply(subscribedState(), privateEvent(60));
  state = apply(state, restCut(60, state.lastPrivateEventMarker));
  const rollback = structuredClone(state);
  rollback.observedPrivateEventCount = 0;
  rollback.recentEventMarkers = [];
  rollback.eventWatermarks = [];
  rollback.lastPrivateEventMarker = null;
  rollback.lastAccountEventMarker = null;
  rollback.lastExchangeEventTimeMs = null;
  rollback.ownerRestCut = null;
  rollback.restReconciliationFreshness = 'UNAVAILABLE';
  rollback.continuityPosture = 'RECONCILIATION_REQUIRED';
  assert.equal(validateSpotSignatureLifecycleState(rollback), null,
    'a stale top-level commitment rejects a coherent multi-field rewrite');

  const detachedMarker = structuredClone(state);
  const detachedReceiptTimeMs = state.connectedAtMs - 1;
  const detachedEventRevision = createSpotRealmBoundRevision(
    'spot_event', state.accountRealmId, {
      generation: state.generation,
      eventKind: detachedMarker.recentEventMarkers[0].eventKind,
      contentRevision: detachedMarker.recentEventMarkers[0].contentRevision,
      exchangeEventTimeMs: detachedMarker.recentEventMarkers[0].exchangeEventTimeMs,
      receiptTimeMs: detachedReceiptTimeMs,
    },
  );
  for (const marker of [
    detachedMarker.recentEventMarkers[0],
    detachedMarker.lastPrivateEventMarker,
    detachedMarker.lastAccountEventMarker,
  ]) {
    marker.receiptTimeMs = detachedReceiptTimeMs;
    marker.eventRevision = detachedEventRevision;
  }
  detachedMarker.ownerRestCut.throughEventRevision = detachedEventRevision;
  detachedMarker.ownerRestCut.reconciliationRevision = createSpotRealmBoundRevision(
    'spot_rest', state.accountRealmId, {
      generation: detachedMarker.ownerRestCut.generation,
      reconciledAtMs: detachedMarker.ownerRestCut.reconciledAtMs,
      validUntilMs: detachedMarker.ownerRestCut.validUntilMs,
      throughEventRevision: detachedEventRevision,
      throughExchangeEventTimeMs: detachedMarker.ownerRestCut.throughExchangeEventTimeMs,
    },
  );
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(detachedMarker),
  ), null);
  const detachedCut = structuredClone(state);
  detachedCut.ownerRestCut.reconciledAtMs = state.connectedAtMs - 1;
  detachedCut.ownerRestCut.reconciliationRevision = createSpotRealmBoundRevision(
    'spot_rest', state.accountRealmId, {
      generation: detachedCut.ownerRestCut.generation,
      reconciledAtMs: detachedCut.ownerRestCut.reconciledAtMs,
      validUntilMs: detachedCut.ownerRestCut.validUntilMs,
      throughEventRevision: detachedCut.ownerRestCut.throughEventRevision,
      throughExchangeEventTimeMs: detachedCut.ownerRestCut.throughExchangeEventTimeMs,
    },
  );
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(detachedCut),
  ), null);
  assert.match(state.stateContentRevision, /^spot_state_[0-9a-f]{64}$/);
});

test('reconnect fences prior generation events and reconciliation cuts', () => {
  let state = apply(subscribedState(), privateEvent(1));
  state = apply(state, restCut(1, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 20,
    validUntilMs: T0 + 100,
  }));
  state = apply(state, connection({
    generation: 2,
    observedAtMs: T0 + 30,
    connectedAtMs: T0 + 30,
    reconnectPlannedAtMs: T0 + 23 * HOUR_MS,
  }));
  assert.equal(state.ownerRestCut, null);
  assert.equal(state.recentEventMarkers.length, 0);
  assert.equal(state.restReconciliationFreshness, 'UNAVAILABLE');

  const beforeSubscribe = reject(state, privateEvent(2, {
    generation: 2,
    exchangeEventTimeMs: T0 + 31,
    receiptTimeMs: T0 + 31,
  }), 'PRIVATE_EVENT_REQUIRES_SUBSCRIPTION');
  state = apply(beforeSubscribe.state, subscription({
    generation: 2,
    observedAtMs: T0 + 32,
  }));
  state = apply(state, privateEvent(3, {
    generation: 2,
    exchangeEventTimeMs: T0 + 33,
    receiptTimeMs: T0 + 33,
  }));
  assert.equal(state.lastPrivateEventMarker.generation, 2);
  state = apply(state, restCut(2, state.lastPrivateEventMarker, {
    generation: 2,
    reconciledAtMs: T0 + 34,
    validUntilMs: T0 + 100,
  }));
  const currentRevision = state.lastPrivateEventMarker.eventRevision;
  state = apply(state, privateEvent(4, {
    generation: 1,
    exchangeEventTimeMs: T0 + 35,
    receiptTimeMs: T0 + 35,
  }));
  assert.equal(state.lastTransition, 'STALE_GENERATION_EVENT_FENCED');
  assert.equal(state.staleGenerationEventCount, 1);
  assert.equal(state.lastPrivateEventMarker.eventRevision, currentRevision);
  assert.equal(state.ownerRestCut.generation, 2);
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  assert.equal(state.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');
});

test('stale-generation event at the current hard boundary is fenced and disconnects', () => {
  let state = subscribedState();
  const secondConnectedAtMs = T0 + 30;
  state = apply(state, connection({
    generation: 2,
    observedAtMs: secondConnectedAtMs,
    connectedAtMs: secondConnectedAtMs,
    reconnectPlannedAtMs: secondConnectedAtMs + 23 * HOUR_MS,
  }));
  state = apply(state, subscription({
    generation: 2,
    observedAtMs: secondConnectedAtMs + 1,
  }));
  const staleGenerationEventCount = state.staleGenerationEventCount;
  const observedPrivateEventCount = state.observedPrivateEventCount;
  const hardBoundaryMs = state.hardDisconnectAtMs;

  const result = reduceSpotPrivateLifecycle(state, privateEvent(9, {
    generation: 1,
    exchangeEventTimeMs: hardBoundaryMs,
    receiptTimeMs: hardBoundaryMs,
  }));
  assert.equal(result.accepted, true);
  assert.ok(result.issues.some((issue) => issue.code === 'CONNECTION_LIFETIME_EXPIRED'));
  assert.equal(result.state.staleGenerationEventCount, staleGenerationEventCount + 1);
  assert.equal(result.state.observedPrivateEventCount, observedPrivateEventCount + 1);
  assert.equal(result.state.connected, false);
  assert.equal(result.state.signatureAuthorized, false);
  assert.equal(result.state.subscribed, false);
  assert.equal(result.state.reconnectDue, true);
  assert.equal(result.state.lastObservedAtMs, hardBoundaryMs);
  assert.equal(result.state.lastTransition, 'CONNECTION_LIFETIME_EXPIRED');
  assert.equal(result.state.lastDisconnectReason, 'CONNECTION_LIFETIME_EXPIRED');
  assert.notEqual(validateSpotSignatureLifecycleState(result.state), null);
  assertNoAuthority(result);
});

test('genuine Spot generation advance clears current-generation quality evidence and can recover', () => {
  let state = subscribedState();
  const first = privateEvent(40);
  state = apply(state, first);
  state = apply(state, first);
  state = apply(state, privateEvent(40, {
    contentRevision: revision('spot_content', 41),
  }));
  state = apply(state, {
    kind: 'EVENT_QUALITY_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: state.lastObservedAtMs + 1, quality: 'MALFORMED',
  });
  assert.equal(state.qualityPosture, 'CURRENT_GENERATION_DEGRADED');

  const secondConnectedAtMs = state.lastObservedAtMs + 1;
  state = apply(state, connection({
    generation: 2,
    observedAtMs: secondConnectedAtMs,
    connectedAtMs: secondConnectedAtMs,
    reconnectPlannedAtMs: secondConnectedAtMs + 23 * HOUR_MS,
  }));
  for (const field of [
    'duplicateCount', 'outOfOrderCount', 'malformedCount',
    'staleGenerationEventCount', 'conflictingEventCount',
    'observedPrivateEventCount', 'unretainedPrivateEventObservationCount',
    'privateEventDuplicateObservationCount', 'privateEventConflictObservationCount',
  ]) assert.equal(state[field], 0, field);
  assert.equal(state.dedupeCoverageTruncated, false);
  assert.equal(state.lastQualityLossAtMs, null);
  assert.equal(state.qualityPosture, 'CLEAN');
  assert.deepEqual(state.recentEventMarkers, []);
  assert.equal(state.ownerRestCut, null);

  state = apply(state, subscription({
    generation: 2,
    observedAtMs: secondConnectedAtMs + 1,
  }));
  state = apply(state, restCut(42, null, {
    generation: 2,
    reconciledAtMs: secondConnectedAtMs + 2,
    validUntilMs: secondConnectedAtMs + 102,
  }));
  assert.equal(state.integrityPosture, 'CLEAN');
  assert.equal(createPrivateLifecycleWitness({
    state,
    evaluatedAtMs: secondConnectedAtMs + 2,
  }).acceptableForOwnerComparison, true);
});

test('bounded event retention reports truncation and requires a later exact owner cut', () => {
  let state = subscribedState();
  for (let index = 1; index <= SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS; index += 1) {
    state = apply(state, privateEvent(index));
  }
  assert.equal(state.recentEventMarkers.length, SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS);
  assert.equal(state.dedupeCoverageTruncated, true);
  assert.equal(state.integrityPosture, 'DEGRADED');

  state = apply(state, privateEvent(SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS + 1));
  assert.equal(state.recentEventMarkers.length, 64);
  assert.equal(state.recentEventMarkers[0].eventRevision, privateEvent(2).eventRevision);
  assert.equal(state.dedupeCoverageTruncated, true);
  assert.equal(state.integrityPosture, 'DEGRADED');
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');

  const callerClearedIntegrity = structuredClone(state);
  callerClearedIntegrity.integrityPosture = 'CLEAN';
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(callerClearedIntegrity),
  ), null);

  const callerClearedTruncation = structuredClone(state);
  callerClearedTruncation.dedupeCoverageTruncated = false;
  callerClearedTruncation.integrityPosture = 'CLEAN';
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(callerClearedTruncation),
  ), null);

  const callerHidCapacity = structuredClone(callerClearedTruncation);
  callerHidCapacity.recentEventMarkers.shift();
  assert.equal(callerHidCapacity.recentEventMarkers.length, 63);
  assert.equal(validateSpotSignatureLifecycleState(
    withRecomputedSpotStateCommitment(callerHidCapacity),
  ), null);

  state = apply(state, restCut(1, state.lastPrivateEventMarker));
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  assert.equal(state.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');

  state = apply(state, privateEvent(1, { receiptTimeMs: T0 + 110 }));
  assert.equal(state.outOfOrderCount, 1);
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('selected unsubscribe and termination preserve REST freshness but break stream continuity', () => {
  let state = apply(subscribedState(), privateEvent(1));
  state = apply(state, restCut(1, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 20,
    validUntilMs: T0 + 100,
  }));
  state = apply(state, targetedUnsubscribe({ observedAtMs: T0 + 21 }));
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
  state = apply(state, termination({ observedAtMs: T0 + 22, exchangeEventTimeMs: T0 + 21 }));
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');
});

test('termination and shutdown future skew are accepted at and rejected above the exact boundary', () => {
  let stopped = apply(subscribedState(), targetedUnsubscribe());
  const terminatedAtBoundary = apply(stopped, termination({
    exchangeEventTimeMs: T0 + 2_004,
  }));
  assert.equal(terminatedAtBoundary.pendingTerminationSubscriptionId, null);
  assert.equal(terminatedAtBoundary.lastExchangeEventTimeMs, null);

  stopped = apply(subscribedState(), targetedUnsubscribe());
  const futureTermination = reject(stopped, termination({
    exchangeEventTimeMs: T0 + 2_005,
  }), 'EXCHANGE_EVENT_TIME_IN_FUTURE');
  assert.equal(futureTermination.state.pendingTerminationSubscriptionId, 7);
  assert.equal(futureTermination.state.connected, true);

  const shutdownAtBoundary = apply(subscribedState(), {
    kind: 'SERVER_SHUTDOWN_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 2,
    exchangeEventTimeMs: T0 + 2_002,
  });
  assert.equal(shutdownAtBoundary.connected, false);
  assert.equal(shutdownAtBoundary.lastExchangeEventTimeMs, null);

  const futureShutdown = reject(subscribedState(), {
    kind: 'SERVER_SHUTDOWN_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 2,
    exchangeEventTimeMs: T0 + 2_003,
  }, 'EXCHANGE_EVENT_TIME_IN_FUTURE');
  assert.equal(futureShutdown.state.connected, true);
  assert.equal(futureShutdown.state.subscribed, true);
});

test('regressed termination and shutdown times preserve the exchange watermark and degrade continuity', () => {
  let connected = connectedState({
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 1,
  });
  let state = apply(connected, subscription({
    sessionActiveSubscriptionCount: 2,
    sessionLifetimeSubscriptionCount: 2,
  }));
  state = apply(state, privateEvent(1));
  state = apply(state, restCut(1, state.lastPrivateEventMarker, {
    reconciledAtMs: T0 + 20,
    validUntilMs: T0 + 100,
  }));
  assert.equal(state.continuityPosture, 'OWNER_CUT_COVERS_OBSERVED_EVENTS');

  const terminated = reduceSpotPrivateLifecycle(state, termination({
    subscriptionId: 6,
    observedAtMs: T0 + 21,
    exchangeEventTimeMs: T0 + 10,
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 2,
  }));
  assert.equal(terminated.accepted, true);
  assert.ok(terminated.issues.some((issue) => issue.code === 'OBSERVATION_OUT_OF_ORDER'));
  assert.equal(terminated.state.subscribed, true);
  assert.equal(terminated.state.subscriptionId, 7);
  assert.equal(terminated.state.lastExchangeEventTimeMs, T0 + 11);
  assert.equal(terminated.state.outOfOrderCount, 1);
  assert.equal(terminated.state.integrityPosture, 'DEGRADED');
  assert.equal(terminated.state.continuityPosture, 'RECONCILIATION_REQUIRED');
  assertNoAuthority(terminated);

  state = apply(subscribedState(), privateEvent(1));
  const shutdown = reduceSpotPrivateLifecycle(state, {
    kind: 'SERVER_SHUTDOWN_OBSERVED',
    accountRealmId: ACCOUNT_REALM_ID,
    generation: 1,
    observedAtMs: T0 + 12,
    exchangeEventTimeMs: T0 + 10,
  });
  assert.equal(shutdown.accepted, true);
  assert.ok(shutdown.issues.some((issue) => issue.code === 'OBSERVATION_OUT_OF_ORDER'));
  assert.equal(shutdown.state.connected, false);
  assert.equal(shutdown.state.lastTransition, 'SERVER_SHUTDOWN_OBSERVED');
  assert.equal(shutdown.state.lastExchangeEventTimeMs, T0 + 11);
  assert.equal(shutdown.state.outOfOrderCount, 1);
  assert.equal(shutdown.state.integrityPosture, 'DEGRADED');
  assertNoAuthority(shutdown);
});

test('private-event closed shapes and lifecycle marker invariants fail without accessor evaluation', () => {
  const state = subscribedState();
  reject(state, { ...privateEvent(1), extra: true }, 'OBSERVATION_INVALID');
  reject(state, privateEvent(1, { eventRevision: 'not-a-revision' }), 'PRIVATE_EVENT_INVALID');

  let accessed = false;
  const accessor = privateEvent(1);
  Object.defineProperty(accessor, 'contentRevision', {
    enumerable: true,
    get() {
      accessed = true;
      return revision('spot_content', 1);
    },
  });
  reject(state, accessor, 'OBSERVATION_INVALID');
  assert.equal(accessed, false);

  let marked = apply(state, privateEvent(1));
  marked = apply(marked, privateEvent(2, { eventKind: 'ORDER' }));
  const forged = { ...marked, lastPrivateEventMarker: marked.lastAccountEventMarker };
  reject(forged, {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM_ID,
    generation: 1, observedAtMs: T0 + 13,
  }, 'STATE_INVALID');
});

test('unknown fields, inherited fields, arrays, and accessors are rejected without evaluation', () => {
  const state = connectedState();
  reject(state, { ...subscription(), extra: true }, 'OBSERVATION_INVALID');
  reject(state, Object.assign(Object.create({ inherited: true }), subscription()), 'OBSERVATION_INVALID');
  reject(state, [], 'OBSERVATION_INVALID');

  let accessed = false;
  const accessor = subscription();
  Object.defineProperty(accessor, 'subscriptionId', {
    enumerable: true,
    get() {
      accessed = true;
      return 7;
    },
  });
  reject(state, accessor, 'OBSERVATION_INVALID');
  assert.equal(accessed, false);
});

test('proxy observations and proxy state are rejected without invoking traps', () => {
  const state = connectedState();
  let trapCalls = 0;
  const hostile = new Proxy(subscription(), {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not inspect proxy');
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('must not inspect proxy');
    },
  });
  reject(state, hostile, 'OBSERVATION_INVALID');
  assert.equal(trapCalls, 0);

  const proxiedState = new Proxy(state, {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not inspect proxy state');
    },
  });
  const result = reject(proxiedState, subscription(), 'STATE_INVALID');
  assert.equal(result.state.connected, false);
  assert.equal(trapCalls, 0);
});

test('returned state and issues are immutable and cannot be promoted to authority', () => {
  const state = connectedState();
  const result = reject(state, { ...subscription(), forbidden: 'field' }, 'OBSERVATION_INVALID');
  assertDeeplyFrozen(result);
  assert.throws(() => { result.accepted = true; }, TypeError);
  assert.throws(() => { result.state.sendEligible = true; }, TypeError);
  assert.throws(() => { result.issues.push({ code: 'X', message: 'X' }); }, TypeError);
  assertNoAuthority(result);
});

test('lifecycle input shape has no endpoint, token, secret, or generic readiness surface', () => {
  const stateKeys = Object.keys(initial());
  const contractKeys = Object.keys(SPOT_SIGNATURE_LIFECYCLE_CONTRACT);
  for (const forbidden of [
    'endpoint', 'baseUrl', 'url', 'apiKey', 'secret', 'privateKey', 'signature',
    'listenKey', 'listenToken', 'ready', 'tradeReady', 'accountReady',
  ]) {
    assert.equal(stateKeys.includes(forbidden), false, forbidden);
    assert.equal(contractKeys.includes(forbidden), false, forbidden);
  }
});
