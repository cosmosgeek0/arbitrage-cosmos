import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARGIN_RISK_DEFAULT_ACCOUNT_REALM_ID,
  USDM_PRIVATE_DOCUMENTARY_CONTRACTS,
  createInitialMarginRiskLifecycleState,
  createInitialSpotPrivateLifecycleState,
  createInitialUsdmPrivateLifecycleState,
  createSpotRealmBoundRevision,
  createPrivateLifecycleWitness,
  reduceSpotPrivateLifecycle,
  reduceUsdmPrivateLifecycle,
  requiredLifecycleProductsForPosture,
  validatePrivateLifecycleWitness,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';
import {
  createUsdmRealmBoundRevision,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/usdmLifecycle.js';

const T0 = 1_800_000_000_000;
const ACCOUNT_REALM = 'account-realm-synthetic-a';

function assertNoAuthority(value) {
  assert.equal(value.sendEligible, false);
  assert.equal(value.accountReadAuthority, 'NONE');
  assert.equal(value.mutationAuthority, 'NONE');
  assert.equal(value.reconciliationAuthority, 'NONE');
  assert.equal(value.capitalAuthority, 'NONE');
  assert.equal(value.riskAuthority, 'NONE');
  assert.equal(value.externalActionAuthorization, 'NONE');
  assert.equal(value.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(value.gapFreeSequenceProven, false);
  assert.equal(value.runtimeWired, false);
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function spotApply(state, observation) {
  const result = reduceSpotPrivateLifecycle(state, observation);
  assert.equal(result.accepted, true, JSON.stringify(result.issues));
  return result.state;
}

function canonicalSpotEvent(event) {
  return {
    ...event,
    eventRevision: createSpotRealmBoundRevision('spot_event', event.accountRealmId, {
      generation: event.generation,
      eventKind: event.eventKind,
      contentRevision: event.contentRevision,
      exchangeEventTimeMs: event.exchangeEventTimeMs,
      receiptTimeMs: event.receiptTimeMs,
    }),
  };
}

function canonicalSpotCut(cut) {
  return {
    ...cut,
    reconciliationRevision: createSpotRealmBoundRevision('spot_rest', cut.accountRealmId, {
      generation: cut.generation,
      reconciledAtMs: cut.reconciledAtMs,
      validUntilMs: cut.validUntilMs,
      throughEventRevision: cut.throughEventRevision,
      throughExchangeEventTimeMs: cut.throughExchangeEventTimeMs,
    }),
  };
}

function canonicalUsdmEvent(event) {
  const contentRevision = event.contentRevision ?? `usdm_content_${'1'.repeat(32)}`;
  return {
    ...event,
    contentRevision,
    eventRevision: createUsdmRealmBoundRevision('usdm_event', event.accountRealmId, {
      generation: event.generation,
      eventKind: event.eventKind,
      contentRevision,
      exchangeEventTimeMs: event.exchangeEventTimeMs,
      transactionTimeMs: event.transactionTimeMs,
      semanticCategory: event.semanticCategory,
      orderExecutionType: event.orderExecutionType,
      isFill: event.isFill,
      receiptTimeMs: event.receiptTimeMs,
    }),
  };
}

function canonicalUsdmCut(cut) {
  return {
    ...cut,
    reconciliationRevision: createUsdmRealmBoundRevision('usdm_rest', cut.accountRealmId, {
      generation: cut.generation,
      reconciledAtMs: cut.reconciledAtMs,
      validUntilMs: cut.validUntilMs,
      throughEventRevision: cut.throughEventRevision,
      throughExchangeEventTimeMs: cut.throughExchangeEventTimeMs,
    }),
  };
}

function currentSpotState(
  accountRealmId = ACCOUNT_REALM,
  reconnectPlannedAtMs = T0 + 82_800_000,
) {
  const generation = 1;
  const contentRevision = 'spot_content_00000000000000000000000000000011';
  let state = createInitialSpotPrivateLifecycleState(accountRealmId);
  state = spotApply(state, {
    kind: 'CONNECTION_OPENED', accountRealmId, generation,
    observedAtMs: T0 - 300, connectedAtMs: T0 - 300,
    reconnectPlannedAtMs,
    sessionActiveSubscriptionCount: 0, sessionLifetimeSubscriptionCount: 0,
  });
  state = spotApply(state, {
    kind: 'SIGNATURE_SUBSCRIPTION_ACCEPTED', accountRealmId, generation,
    observedAtMs: T0 - 250, subscriptionId: 11,
    sessionActiveSubscriptionCount: 1, sessionLifetimeSubscriptionCount: 1,
  });
  const event = canonicalSpotEvent({
    kind: 'PRIVATE_EVENT_OBSERVED', accountRealmId, generation,
    eventKind: 'ACCOUNT', contentRevision,
    exchangeEventTimeMs: T0 - 200, receiptTimeMs: T0 - 150,
  });
  state = spotApply(state, event);
  return spotApply(state, canonicalSpotCut({
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId, generation,
    reconciledAtMs: T0, validUntilMs: T0 + 1_000,
    throughEventRevision: event.eventRevision,
    throughExchangeEventTimeMs: T0 - 200,
  }));
}

function usdmApply(state, action) {
  const result = reduceUsdmPrivateLifecycle(state, action);
  assert.equal(result.applied, true, JSON.stringify(result));
  return result.state;
}

function currentUsdmState(
  accountRealmId = ACCOUNT_REALM,
  reconnectBeforeMs = T0 + 82_800_000,
) {
  let state = createInitialUsdmPrivateLifecycleState(T0 - 500, accountRealmId);
  state = usdmApply(state, {
    kind: 'LEASE_POST_OBSERVED', accountRealmId,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1, observedAtMs: T0 - 500,
  });
  state = usdmApply(state, {
    kind: 'CONNECTION_OPENED', accountRealmId,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1, observedAtMs: T0 - 400,
    reconnectBeforeMs,
  });
  state = usdmApply(state, {
    kind: 'ROUTE_AUTHENTICATED', accountRealmId,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1, observedAtMs: T0 - 350,
  });
  state = usdmApply(state, {
    kind: 'STREAM_SUBSCRIBED', accountRealmId,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1, observedAtMs: T0 - 300,
  });
  state = usdmApply(state, canonicalUsdmEvent({
    kind: 'PRIVATE_EVENT_OBSERVED', accountRealmId, generation: 1,
    eventKind: 'ACCOUNT_UPDATE', semanticCategory: 'ACCOUNT',
    orderExecutionType: null, isFill: false,
    exchangeEventTimeMs: T0 - 200, transactionTimeMs: T0 - 220,
    receiptTimeMs: T0 - 150,
  }));
  return usdmApply(state, canonicalUsdmCut({
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId, generation: 1,
    reconciledAtMs: T0, validUntilMs: T0 + 1_000,
    throughEventRevision: state.recentEventMarkers.at(-1).eventRevision,
    throughExchangeEventTimeMs: T0 - 200,
  }));
}

function spotStateBeforeExclusiveDisconnect() {
  const connectedAtMs = T0;
  const hardDisconnectAtMs = connectedAtMs + 86_400_000;
  const generation = 1;
  let state = createInitialSpotPrivateLifecycleState(ACCOUNT_REALM);
  state = spotApply(state, {
    kind: 'CONNECTION_OPENED', accountRealmId: ACCOUNT_REALM, generation,
    observedAtMs: connectedAtMs, connectedAtMs,
    reconnectPlannedAtMs: hardDisconnectAtMs - 1,
    sessionActiveSubscriptionCount: 0, sessionLifetimeSubscriptionCount: 0,
  });
  state = spotApply(state, {
    kind: 'SIGNATURE_SUBSCRIPTION_ACCEPTED', accountRealmId: ACCOUNT_REALM,
    generation, observedAtMs: connectedAtMs + 1, subscriptionId: 12,
    sessionActiveSubscriptionCount: 1, sessionLifetimeSubscriptionCount: 1,
  });
  state = spotApply(state, canonicalSpotCut({
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId: ACCOUNT_REALM,
    generation,
    reconciledAtMs: hardDisconnectAtMs - 1,
    validUntilMs: hardDisconnectAtMs + 100,
    throughEventRevision: null, throughExchangeEventTimeMs: null,
  }));
  return { state, hardDisconnectAtMs };
}

function usdmStateBeforeExclusiveDisconnect() {
  const hourMs = 3_600_000;
  const connectionValidUntilMs = T0 + 24 * hourMs;
  let state = createInitialUsdmPrivateLifecycleState(T0, ACCOUNT_REALM);
  state = usdmApply(state, {
    kind: 'LEASE_POST_OBSERVED', accountRealmId: ACCOUNT_REALM,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost,
    leaseGeneration: 1, observedAtMs: T0,
  });
  state = usdmApply(state, {
    kind: 'CONNECTION_OPENED', accountRealmId: ACCOUNT_REALM,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1, observedAtMs: T0,
    reconnectBeforeMs: connectionValidUntilMs - 1,
  });
  state = usdmApply(state, {
    kind: 'ROUTE_AUTHENTICATED', accountRealmId: ACCOUNT_REALM,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1, observedAtMs: T0,
  });
  state = usdmApply(state, {
    kind: 'STREAM_SUBSCRIBED', accountRealmId: ACCOUNT_REALM,
    contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute,
    generation: 1, observedAtMs: T0,
  });
  for (let hour = 1; hour <= 23; hour += 1) {
    state = usdmApply(state, {
      kind: 'LEASE_PUT_OBSERVED', accountRealmId: ACCOUNT_REALM,
      contractId: USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut,
      leaseGeneration: 1, observedAtMs: T0 + hour * hourMs,
    });
  }
  state = usdmApply(state, canonicalUsdmEvent({
    kind: 'PRIVATE_EVENT_OBSERVED', accountRealmId: ACCOUNT_REALM, generation: 1,
    eventKind: 'ACCOUNT_UPDATE', semanticCategory: 'ACCOUNT',
    orderExecutionType: null, isFill: false,
    exchangeEventTimeMs: connectionValidUntilMs - 2,
    transactionTimeMs: connectionValidUntilMs - 3,
    receiptTimeMs: connectionValidUntilMs - 2,
  }));
  state = usdmApply(state, canonicalUsdmCut({
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId: ACCOUNT_REALM,
    generation: 1,
    reconciledAtMs: connectionValidUntilMs - 1,
    validUntilMs: connectionValidUntilMs + 100,
    throughEventRevision: state.recentEventMarkers.at(-1).eventRevision,
    throughExchangeEventTimeMs: connectionValidUntilMs - 2,
  }));
  return { state, connectionValidUntilMs };
}

test('Spot and USD-M witnesses retain complete validated states and derive ready digests', () => {
  for (const state of [currentSpotState(), currentUsdmState()]) {
    const witness = createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 });
    assert.equal(witness.acceptableForOwnerComparison, true);
    assert.equal(witness.comparisonPosture, 'OWNER_COMPARISON_READY');
    assert.equal(witness.accountRealmId, ACCOUNT_REALM);
    assert.deepEqual(witness.state, state);
    assert.match(witness.stateContentRevision, /^l05lcstate_[0-9a-f]{64}$/);
    assert.match(witness.lifecycleRevision, /^l05lifecycle_[0-9a-f]{64}$/);
    assert.deepEqual(validatePrivateLifecycleWitness(structuredClone(witness)), witness);
    assertNoAuthority(witness);
    assertDeeplyFrozen(witness);
  }
});

test('planned reconnect deadlines block owner comparison even while transport state remains connected', () => {
  const spot = createPrivateLifecycleWitness({
    state: currentSpotState(ACCOUNT_REALM, T0 - 100),
    evaluatedAtMs: T0,
  });
  const usdm = createPrivateLifecycleWitness({
    state: currentUsdmState(ACCOUNT_REALM, T0 - 100),
    evaluatedAtMs: T0,
  });
  assert.equal(spot.state.connected, true);
  assert.equal(usdm.state.connected, true);
  assert.equal(spot.acceptableForOwnerComparison, false);
  assert.equal(usdm.acceptableForOwnerComparison, false);
  assert.ok(spot.reasonCodes.includes('SPOT_PRIVATE_RECONNECT_DUE'));
  assert.ok(usdm.reasonCodes.includes('USDM_PRIVATE_RECONNECT_DUE'));
});

test('witness evaluation cannot precede canonical lifecycle observation time', () => {
  for (const state of [currentSpotState(), currentUsdmState()]) {
    const witness = createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 - 1 });
    assert.equal(witness.observedAtMs, T0);
    assert.equal(witness.acceptableForOwnerComparison, false);
    assert.ok(witness.reasonCodes.includes('PRIVATE_LIFECYCLE_EVALUATION_PRECEDES_STATE'));
  }
});

test('canonical reconnectDue remains blocking when a witness uses an earlier within-skew time', () => {
  const spotState = currentSpotState(ACCOUNT_REALM, T0 - 100);
  const usdmState = currentUsdmState(ACCOUNT_REALM, T0 - 100);
  assert.equal(spotState.reconnectDue, true);
  assert.equal(usdmState.reconnectDue, true);

  const spot = createPrivateLifecycleWitness({ state: spotState, evaluatedAtMs: T0 - 1 });
  const usdm = createPrivateLifecycleWitness({ state: usdmState, evaluatedAtMs: T0 - 1 });
  assert.ok(spot.reasonCodes.includes('SPOT_PRIVATE_RECONNECT_DUE'));
  assert.ok(usdm.reasonCodes.includes('USDM_PRIVATE_RECONNECT_DUE'));
  assert.ok(spot.reasonCodes.includes('PRIVATE_LIFECYCLE_EVALUATION_PRECEDES_STATE'));
  assert.ok(usdm.reasonCodes.includes('PRIVATE_LIFECYCLE_EVALUATION_PRECEDES_STATE'));
  assert.equal(spot.acceptableForOwnerComparison, false);
  assert.equal(usdm.acceptableForOwnerComparison, false);
});

test('planned reconnect deadlines are exclusive witness-validity cutoffs for Spot and USD-M', () => {
  const reconnectAtMs = T0 + 500;
  const spotBefore = createPrivateLifecycleWitness({
    state: currentSpotState(ACCOUNT_REALM, reconnectAtMs),
    evaluatedAtMs: T0,
  });
  const usdmBefore = createPrivateLifecycleWitness({
    state: currentUsdmState(ACCOUNT_REALM, reconnectAtMs),
    evaluatedAtMs: T0,
  });
  for (const witness of [spotBefore, usdmBefore]) {
    assert.equal(witness.validUntilMs, reconnectAtMs - 1);
    assert.equal(witness.acceptableForOwnerComparison, true);
  }

  const spotAtBoundary = createPrivateLifecycleWitness({
    state: currentSpotState(ACCOUNT_REALM, reconnectAtMs),
    evaluatedAtMs: reconnectAtMs,
  });
  const usdmAtBoundary = createPrivateLifecycleWitness({
    state: currentUsdmState(ACCOUNT_REALM, reconnectAtMs),
    evaluatedAtMs: reconnectAtMs,
  });
  assert.equal(spotAtBoundary.validUntilMs, reconnectAtMs - 1);
  assert.equal(usdmAtBoundary.validUntilMs, reconnectAtMs - 1);
  assert.equal(spotAtBoundary.acceptableForOwnerComparison, false);
  assert.equal(usdmAtBoundary.acceptableForOwnerComparison, false);
  assert.ok(spotAtBoundary.reasonCodes.includes('SPOT_PRIVATE_RECONNECT_DUE'));
  assert.ok(usdmAtBoundary.reasonCodes.includes('USDM_PRIVATE_RECONNECT_DUE'));
  assert.ok(spotAtBoundary.reasonCodes.includes('PRIVATE_LIFECYCLE_EXPIRED'));
  assert.ok(usdmAtBoundary.reasonCodes.includes('PRIVATE_LIFECYCLE_EXPIRED'));
});

test('Spot retention truncation is directly blocking lifecycle evidence after an exact owner cut', () => {
  let state = currentSpotState();
  for (let index = 2; index <= 65; index += 1) {
    state = spotApply(state, canonicalSpotEvent({
      kind: 'PRIVATE_EVENT_OBSERVED', accountRealmId: ACCOUNT_REALM, generation: 1,
      eventKind: 'ACCOUNT',
      contentRevision: `spot_content_${index.toString(16).padStart(32, '0')}`,
      exchangeEventTimeMs: T0 + index,
      receiptTimeMs: T0 + index,
    }));
  }
  state = spotApply(state, canonicalSpotCut({
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId: ACCOUNT_REALM,
    generation: 1,
    reconciledAtMs: T0 + 100,
    validUntilMs: T0 + 1_100,
    throughEventRevision: state.lastPrivateEventMarker.eventRevision,
    throughExchangeEventTimeMs: state.lastPrivateEventMarker.exchangeEventTimeMs,
  }));
  const witness = createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 + 100 });
  assert.equal(witness.state.dedupeCoverageTruncated, true);
  assert.equal(witness.acceptableForOwnerComparison, false);
  assert.ok(witness.reasonCodes.includes('SPOT_PRIVATE_EVENT_RETENTION_TRUNCATED'));
  assert.ok(witness.reasonCodes.includes('SPOT_PRIVATE_STREAM_DEGRADED'));
});

test('retained USD-M quality degradation blocks witness comparison despite a fresh covering cut', () => {
  let state = currentUsdmState();
  state = usdmApply(state, {
    kind: 'MALFORMED_EVENT_OBSERVED', accountRealmId: ACCOUNT_REALM,
    generation: 1, receiptTimeMs: T0 + 1,
  });
  assert.equal(state.qualityPosture, 'CURRENT_GENERATION_DEGRADED');
  assert.equal(state.malformedEventCount, 1);
  const retainedTail = state.recentEventMarkers.at(-1);
  state = usdmApply(state, canonicalUsdmCut({
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId: ACCOUNT_REALM,
    generation: 1, reconciledAtMs: T0 + 2, validUntilMs: T0 + 1_002,
    throughEventRevision: retainedTail.eventRevision,
    throughExchangeEventTimeMs: retainedTail.exchangeEventTimeMs,
  }));
  assert.equal(state.restReconciliationFreshness, 'FRESH');
  assert.equal(state.continuityPosture, 'RECONCILIATION_REQUIRED');

  const witness = createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 + 2 });
  assert.equal(witness.acceptableForOwnerComparison, false);
  assert.equal(witness.comparisonPosture, 'OWNER_COMPARISON_BLOCKED');
  assert.ok(witness.reasonCodes.includes('USDM_OWNER_CUT_DOES_NOT_COVER_EVENTS'));
});

test('Spot and USD-M exclusive connection cutoffs expire at the exact boundary', () => {
  const spotBoundary = spotStateBeforeExclusiveDisconnect();
  const spot = createPrivateLifecycleWitness({
    state: spotBoundary.state,
    evaluatedAtMs: spotBoundary.hardDisconnectAtMs,
  });
  assert.equal(spot.validUntilMs, spotBoundary.state.reconnectPlannedAtMs - 1);
  assert.equal(spot.acceptableForOwnerComparison, false);
  assert.ok(spot.reasonCodes.includes('PRIVATE_LIFECYCLE_EXPIRED'));

  const usdmBoundary = usdmStateBeforeExclusiveDisconnect();
  const usdm = createPrivateLifecycleWitness({
    state: usdmBoundary.state,
    evaluatedAtMs: usdmBoundary.connectionValidUntilMs,
  });
  assert.equal(usdm.validUntilMs, usdmBoundary.state.reconnectBeforeMs - 1);
  assert.equal(usdm.acceptableForOwnerComparison, false);
  assert.ok(usdm.reasonCodes.includes('PRIVATE_LIFECYCLE_EXPIRED'));
});

test('witness revisions change with validated state content and cannot be forged', () => {
  const first = createPrivateLifecycleWitness({ state: currentSpotState(), evaluatedAtMs: T0 });
  const secondState = spotApply(currentSpotState(), {
    kind: 'CLOCK_OBSERVED', accountRealmId: ACCOUNT_REALM,
    generation: 1, observedAtMs: T0 + 1,
  });
  const second = createPrivateLifecycleWitness({ state: secondState, evaluatedAtMs: T0 + 1 });
  assert.notEqual(second.stateContentRevision, first.stateContentRevision);
  assert.notEqual(second.lifecycleRevision, first.lifecycleRevision);
  assert.deepEqual(validatePrivateLifecycleWitness(second), second);

  const forged = structuredClone(first);
  forged.lifecycleRevision = 'l05lifecycle_forged';
  assert.throws(() => validatePrivateLifecycleWitness(forged), /canonically reproducible/);
  assert.deepEqual(validatePrivateLifecycleWitness(first), first);
});

test('credential-shaped lifecycle additions are rejected before validation or digesting', () => {
  const state = structuredClone(currentUsdmState());
  state.listenKey = 'credential-shaped-value';
  assert.throws(
    () => createPrivateLifecycleWitness({ state, evaluatedAtMs: T0 }),
    /secret-shaped field name/,
  );
});

test('unavailable Spot lifecycle and every Margin risk-only lifecycle remain blocking', () => {
  const unavailable = createPrivateLifecycleWitness({
    state: createInitialSpotPrivateLifecycleState(ACCOUNT_REALM),
    evaluatedAtMs: T0,
  });
  assert.equal(unavailable.acceptableForOwnerComparison, false);
  assert.equal(unavailable.comparisonPosture, 'OWNER_COMPARISON_BLOCKED');
  assert.ok(unavailable.reasonCodes.includes('SPOT_PRIVATE_STREAM_DISCONNECTED'));

  const margin = createPrivateLifecycleWitness({
    state: createInitialMarginRiskLifecycleState(T0, MARGIN_RISK_DEFAULT_ACCOUNT_REALM_ID),
    evaluatedAtMs: T0,
  });
  assert.equal(margin.product, 'MARGIN');
  assert.equal(margin.acceptableForOwnerComparison, false);
  assert.equal(margin.comparisonPosture, 'MARGIN_RISK_ONLY_BLOCKED');
  assert.ok(margin.reasonCodes.includes('MARGIN_RISK_STREAM_NOT_ACCOUNT_TRUTH'));
  assertNoAuthority(unavailable);
  assertNoAuthority(margin);
});

test('posture maps to an exact closed lifecycle product set', () => {
  assert.deepEqual(requiredLifecycleProductsForPosture('SPOT_NEW_EXPOSURE'), ['SPOT']);
  assert.deepEqual(requiredLifecycleProductsForPosture('USDM_NEW_EXPOSURE'), ['USD_M_PERPETUAL']);
  assert.deepEqual(requiredLifecycleProductsForPosture('SPOT_USDM_NEW_EXPOSURE'), [
    'SPOT', 'USD_M_PERPETUAL',
  ]);
  assert.deepEqual(requiredLifecycleProductsForPosture('MARGIN_NEW_EXPOSURE'), ['MARGIN']);
  assert.deepEqual(requiredLifecycleProductsForPosture('SUPERVISION_ONLY'), []);
});
