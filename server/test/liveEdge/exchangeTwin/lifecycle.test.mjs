import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkpointExchangeTwin,
  createExchangeTwinState,
  deriveTwinCalibrationRevision,
  deriveTwinRecordedOutcomeContentRevision,
  reduceExchangeTwinEvent,
  restoreExchangeTwin,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  T0,
  allowedRateDecision,
  baselineEvents,
  cancelArrivalEvidence,
  cancelFixture,
  event,
  feeEvidence,
  orderByFixtureId,
  orderFixture,
  passingPreflight,
  rateOwnerEvidence,
  scenarioInput,
} from './fixtures.mjs';

function replaceEvent(events, kind, create) {
  return events.map((candidate) => candidate.kind === kind ? create(candidate) : candidate);
}

function runThroughVenue(fixture, options = {}) {
  const events = baselineEvents(fixture, { ...options, includePrivate: false })
    .filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const state = runExchangeTwinScenario(scenarioInput({ fixture, events }));
  return { events, state, order: orderByFixtureId(state, fixture.fixtureId) };
}

test('status, preflight and L03 rate evidence block synthetic arrival fail-closed', () => {
  for (const status of ['CANCEL_ONLY', 'HALT', 'BREAK', 'END_OF_DAY', 'UNKNOWN']) {
    const fixture = orderFixture();
    const events = replaceEvent(baselineEvents(fixture), 'SYMBOL_STATUS', (prior) => event(
      'SYMBOL_STATUS', prior.sequence, prior.occurredAtMs,
      { ...prior.payload, status },
    ));
    const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));
    assert.equal(order.venueStatus, 'BLOCKED', status);
    assert.ok(order.blockedReasonCodes.includes(`SYMBOL_${status}`), status);
    assert.equal(order.filledQuantity, '0', status);
  }

  for (const requestOverride of [
    { requestedQuantity: '0.0305' },
    { approvedNotional: '0.01', intendedExposure: '0.01' },
  ]) {
    const fixture = orderFixture();
    const events = replaceEvent(baselineEvents(fixture), 'PREFLIGHT_EVIDENCE', (prior) => event(
      'PREFLIGHT_EVIDENCE', prior.sequence, prior.occurredAtMs,
      { fixtureId: fixture.fixtureId, ...passingPreflight(fixture, requestOverride) },
    ));
    const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));
    assert.equal(order.venueStatus, 'BLOCKED');
    assert.ok(order.blockedReasonCodes.includes('PREFLIGHT_NOT_EXACT'));
  }

  for (const reason of [
    'CAPACITY_UNKNOWN', 'CAPACITY_WINDOW_MISMATCH', 'USAGE_UNKNOWN', 'BUDGET_EXHAUSTED',
    'COOLDOWN', 'CIRCUIT_OPEN', 'CLOCK_REGRESSION',
  ]) {
    const rateEvidence = rateOwnerEvidence({ mode: reason, atMs: T0 + 3 });
    const fixture = orderFixture({ rateEvidence });
    const events = replaceEvent(baselineEvents(fixture), 'RATE_DECISION', (prior) => event(
      'RATE_DECISION', prior.sequence, prior.occurredAtMs,
      { fixtureId: fixture.fixtureId, ...rateEvidence },
    ));
    const state = runExchangeTwinScenario(scenarioInput({ fixture, events }));
    const order = orderByFixtureId(state);
    assert.equal(order.venueStatus, 'BLOCKED', reason);
    assert.ok(order.blockedReasonCodes.includes('RATE_NOT_RESERVED'), reason);
    assert.equal(state.rateDecisions[0].decision.reason, reason);
  }
});

test('fixture assets cannot diverge from the L04 registry instrument identity', () => {
  const fixture = orderFixture({ baseAsset: 'ETH' });
  const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture })));

  assert.equal(order.venueStatus, 'BLOCKED');
  assert.ok(order.blockedReasonCodes.includes('PREFLIGHT_NOT_EXACT'));
  assert.equal(order.filledQuantity, '0');
});

test('book and status changes before venue arrival affect the result', () => {
  const fixture = orderFixture();
  const base = baselineEvents(fixture);
  const unavailable = event('BOOK_UNAVAILABLE', 9, T0 + 19, {
    product: fixture.product,
    symbol: fixture.symbol,
    state: 'UNAVAILABLE',
    evidenceRevision: `book-unavailable:${'f'.repeat(24)}`,
  });
  const halted = event('SYMBOL_STATUS', 10, T0 + 19, {
    product: fixture.product,
    symbol: fixture.symbol,
    status: 'HALT',
    evidenceRevision: `symbol-halt:${'1'.repeat(24)}`,
    observedAtMs: T0 + 19,
    validUntilMs: T0 + 10_000,
  });

  const bookBlocked = orderByFixtureId(runExchangeTwinScenario(
    scenarioInput({ fixture, events: [...base, unavailable] }),
  ));
  assert.equal(bookBlocked.venueStatus, 'BLOCKED');
  assert.ok(bookBlocked.blockedReasonCodes.includes('BOOK_UNAVAILABLE'));

  const statusBlocked = orderByFixtureId(runExchangeTwinScenario(
    scenarioInput({ fixture, events: [...base, halted] }),
  ));
  assert.equal(statusBlocked.venueStatus, 'BLOCKED');
  assert.ok(statusBlocked.blockedReasonCodes.includes('SYMBOL_HALT'));
});

test('status and book validity equality at venue arrival is stale', () => {
  for (const [kind, reason] of [
    ['SYMBOL_STATUS', 'SYMBOL_STATUS_STALE'],
    ['BOOK_SNAPSHOT', 'BOOK_STALE'],
  ]) {
    const fixture = orderFixture();
    const events = baselineEvents(fixture).map((candidate) => candidate.kind !== kind
      ? candidate
      : event(
        candidate.kind,
        candidate.sequence,
        candidate.occurredAtMs,
        { ...candidate.payload, validUntilMs: T0 + 20 },
        { sourceSequence: candidate.sourceSequence },
      ));
    const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));
    assert.equal(order.venueStatus, 'BLOCKED', kind);
    assert.ok(order.blockedReasonCodes.includes(reason), kind);
  }
});

test('HTTP ambiguity preserves local UNKNOWN despite a proved venue fill and never resubmits', () => {
  for (const outcome of ['HTTP_5XX', 'TIMEOUT', 'DISCONNECT']) {
    const fixture = orderFixture();
    const events = baselineEvents(fixture, { httpOutcome: outcome });
    const state = runExchangeTwinScenario(scenarioInput({ fixture, events }));
    const order = orderByFixtureId(state);
    assert.equal(order.venueStatus, 'FILLED', outcome);
    assert.equal(order.localTruth, 'UNKNOWN', outcome);
    assert.equal(order.recoveryRequired, true, outcome);
    assert.equal(events.filter((candidate) => candidate.kind === 'PLACE_DISPATCH').length, 1);
    assert.equal(state.processedEvents.filter((candidate) => candidate.eventId === events[4].eventId).length, 1);
  }
});

test('private-before-HTTP and HTTP-before-private converge without erasing stronger observation', () => {
  const executeDeliveryOrder = ({ venueToPrivateMs, venueToHttpMs }) => {
    const fixture = orderFixture({
      latency: { dispatchToVenueMs: 10, venueToPrivateMs, venueToHttpMs },
    });
    const { events, order: venueOrder } = runThroughVenue(fixture);
    const privateDelivery = event('PRIVATE_DELIVERY', 7, T0 + 20 + venueToPrivateMs, {
      fixtureId: fixture.fixtureId,
      venueRevision: venueOrder.venueRevision,
    });
    const httpDelivery = event('HTTP_DELIVERY', 8, T0 + 20 + venueToHttpMs, {
      fixtureId: fixture.fixtureId,
      outcome: 'ACK',
    });
    return {
      state: runExchangeTwinScenario(scenarioInput({
        fixture,
        events: [...events, privateDelivery, httpDelivery],
      })),
      dispatchCount: events.filter((candidate) => candidate.kind === 'PLACE_DISPATCH').length,
    };
  };
  const privateThenHttp = executeDeliveryOrder({ venueToPrivateMs: 15, venueToHttpMs: 20 });
  const httpThenPrivate = executeDeliveryOrder({ venueToPrivateMs: 20, venueToHttpMs: 15 });
  const left = orderByFixtureId(privateThenHttp.state);
  const right = orderByFixtureId(httpThenPrivate.state);
  assert.equal(left.localTruth, 'OBSERVED');
  assert.equal(right.localTruth, 'OBSERVED');
  assert.equal(left.localObservedVenueStatus, right.localObservedVenueStatus);
  assert.equal(left.venueStatus, right.venueStatus);
  assert.equal(left.filledQuantity, right.filledQuantity);
  assert.equal(privateThenHttp.dispatchCount, 1);
  assert.equal(httpThenPrivate.dispatchCount, 1);
});

test('fill-before-cancel wins while cancel-before-trade prevents a later passive fill', () => {
  const fixture = orderFixture({
    price: '99',
    quantity: '0.02',
    queueTruth: 'ESTIMATED',
    queueAheadQuantity: '0',
  });
  const { state: venueState } = runThroughVenue(fixture, {
    bids: [{ price: '98', quantity: '0.1' }],
    asks: [{ price: '100', quantity: '0.1' }],
  });
  const cancel = cancelFixture(fixture, { cancelFixtureId: 'cancel-fixture-0001' });
  const cancelDispatch = event('CANCEL_DISPATCH', 9, T0 + 25, {
    fixtureId: fixture.fixtureId,
    cancelFixture: cancel,
  });
  const cancelArrival = event('CANCEL_ARRIVAL', 10, T0 + 30,
    cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 30));
  const trade = event('TRADE_EVIDENCE', 11, T0 + 29, {
    product: fixture.product,
    symbol: fixture.symbol,
    tradeRevision: `trade-revision:${'2'.repeat(24)}`,
    price: '99',
    quantity: '0.01',
    aggressorSide: 'SELL',
    feeEvidence: feeEvidence(),
  });
  const tradeAfterCancel = event('TRADE_EVIDENCE', 12, T0 + 31, {
    ...trade.payload,
    tradeRevision: `trade-revision:${'3'.repeat(24)}`,
  });

  const fillFirst = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, cancelDispatch), trade),
    cancelArrival,
  );
  const fillFirstOrder = orderByFixtureId(fillFirst);
  assert.equal(fillFirstOrder.filledQuantity, '0.01');
  assert.equal(fillFirstOrder.venueStatus, 'CANCELED');

  const cancelFirst = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, cancelDispatch), cancelArrival),
    tradeAfterCancel,
  );
  const cancelFirstOrder = orderByFixtureId(cancelFirst);
  assert.equal(cancelFirstOrder.filledQuantity, '0');
  assert.equal(cancelFirstOrder.venueStatus, 'CANCELED');
});

test('crash before venue arrival drops a configured pending placement without consuming depth', () => {
  const fixture = orderFixture();
  const base = baselineEvents(fixture, { includePrivate: false })
    .filter((candidate) => !['VENUE_ARRIVAL', 'HTTP_DELIVERY'].includes(candidate.kind));
  const crash = event('CRASH', 9, T0 + 15, {
    crashId: 'crash-before-venue-0001',
    dropLocalDeliveries: true,
    dropPendingCommands: true,
  });
  const arrival = baselineEvents(fixture, { includePrivate: false })
    .find((candidate) => candidate.kind === 'VENUE_ARRIVAL');
  const state = runExchangeTwinScenario(scenarioInput({ fixture, events: [...base, crash, arrival] }));
  const order = orderByFixtureId(state);
  assert.equal(order.venueStatus, 'NOT_ARRIVED');
  assert.equal(order.filledQuantity, '0');
  assert.equal(state.book.asks[0].quantity, '0.01');
  assert.equal(order.recoveryRequired, true);
});

test('crash during cancel drops a configured pending cancel without inventing venue effect', () => {
  const fixture = orderFixture({ price: '99', quantity: '0.01' });
  const { state: venueState } = runThroughVenue(fixture, {
    bids: [{ price: '98', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
  });
  const cancel = cancelFixture(fixture, { cancelFixtureId: 'cancel-crash-0001' });
  const cancelDispatch = event('CANCEL_DISPATCH', 9, T0 + 25, {
    fixtureId: fixture.fixtureId, cancelFixture: cancel,
  });
  const crash = event('CRASH', 10, T0 + 27, {
    crashId: 'crash-during-cancel-0001',
    dropLocalDeliveries: true,
    dropPendingCommands: true,
  });
  const cancelArrival = event('CANCEL_ARRIVAL', 11, T0 + 30,
    cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 30));
  const state = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, cancelDispatch), crash),
    cancelArrival,
  );
  const order = orderByFixtureId(state);
  assert.equal(order.venueStatus, 'NEW');
  assert.equal(order.filledQuantity, '0');
  assert.equal(order.recoveryRequired, true);
});

test('dropped cancel delivery remains UNKNOWN and requires reconciliation', () => {
  const fixture = orderFixture({ price: '99', quantity: '0.01' });
  const { state: venueState } = runThroughVenue(fixture, {
    bids: [{ price: '98', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
  });
  const cancel = cancelFixture(fixture, { cancelFixtureId: 'cancel-fixture-0001' });
  const cancelDispatch = event('CANCEL_DISPATCH', 9, T0 + 25, {
    fixtureId: fixture.fixtureId, cancelFixture: cancel,
  });
  const cancelArrival = event('CANCEL_ARRIVAL', 10, T0 + 30,
    cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 30));
  const dropped = event('CANCEL_DELIVERY', 11, T0 + 31, {
    fixtureId: fixture.fixtureId, cancelFixtureId: 'cancel-fixture-0001', outcome: 'DROPPED',
  });
  const state = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, cancelDispatch), cancelArrival),
    dropped,
  );
  const order = orderByFixtureId(state);
  assert.equal(order.venueStatus, 'CANCELED');
  assert.equal(order.localTruth, 'UNKNOWN');
  assert.equal(order.recoveryRequired, true);
});

test('CANCEL_ONLY blocks new placement but admits an exact synthetic cancel fixture', () => {
  const fixture = orderFixture({ price: '99', quantity: '0.01' });
  const { state: venueState } = runThroughVenue(fixture, {
    bids: [{ price: '98', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
  });
  const cancelOnly = event('SYMBOL_STATUS', 9, T0 + 21, {
    product: fixture.product,
    symbol: fixture.symbol,
    status: 'CANCEL_ONLY',
    evidenceRevision: `symbol-cancel-only:${'7'.repeat(24)}`,
    observedAtMs: T0 + 21,
    validUntilMs: T0 + 10_000,
  });
  const cancel = cancelFixture(fixture, {
    cancelFixtureId: 'cancel-only-fixture-0001',
    rateAtMs: T0 + 23,
    dispatchToVenueMs: 1,
  });
  const cancelDispatch = event('CANCEL_DISPATCH', 10, T0 + 22, {
    fixtureId: fixture.fixtureId, cancelFixture: cancel,
  });
  const cancelArrival = event('CANCEL_ARRIVAL', 11, T0 + 23,
    cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 23));
  const state = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, cancelOnly), cancelDispatch),
    cancelArrival,
  );
  assert.equal(orderByFixtureId(state).venueStatus, 'CANCELED');
});

test('crash/restart and checkpoint restore preserve venue effects and require exact owner reconciliation', () => {
  const fixture = orderFixture();
  const { state: venueState, order: venueOrder } = runThroughVenue(fixture);
  const crash = event('CRASH', 9, T0 + 21, {
    crashId: 'crash-fixture-0001', dropLocalDeliveries: true, dropPendingCommands: true,
  });
  const restart = event('RESTART', 10, T0 + 50, { crashId: 'crash-fixture-0001' });
  const restarted = reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, crash), restart);
  const restartedOrder = orderByFixtureId(restarted);
  assert.equal(restartedOrder.filledQuantity, venueOrder.filledQuantity);
  assert.equal(restartedOrder.localTruth, 'RECOVERY_REQUIRED');
  assert.equal(restartedOrder.recoveryRequired, true);

  const checkpoint = checkpointExchangeTwin(restarted);
  const restored = restoreExchangeTwin(checkpoint);
  assert.equal(restored.stateRevision, restarted.stateRevision);
  assert.equal(restored.outcomeRevision, restarted.outcomeRevision);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(restarted)));
  assert.ok(Object.isFrozen(restored));

  const reconciliation = event('RECONCILIATION_OBSERVATION', 11, T0 + 60, {
    fixtureId: fixture.fixtureId,
    ownerObservationRevision: `owner-reconciliation:${'3'.repeat(24)}`,
    observedVenueRevision: restartedOrder.venueRevision,
    observedStatus: restartedOrder.venueStatus,
    observedFilledQuantity: restartedOrder.filledQuantity,
  });
  const reconciled = reduceExchangeTwinEvent(restored, reconciliation);
  const reconciledOrder = orderByFixtureId(reconciled);
  assert.equal(reconciledOrder.localTruth, 'OBSERVED');
  assert.equal(reconciledOrder.recoveryRequired, false);
  assert.equal(reconciledOrder.filledQuantity, venueOrder.filledQuantity);
  assert.equal(reconciledOrder.fills.length, venueOrder.fills.length);
});

test('owner reconciliation mismatch revokes affirmative local truth', () => {
  const fixture = orderFixture();
  const { state: venueState, order: venueOrder } = runThroughVenue(fixture);
  const privateDelivery = event('PRIVATE_DELIVERY', 9, T0 + 35, {
    fixtureId: fixture.fixtureId,
    venueRevision: venueOrder.venueRevision,
  });
  const observed = reduceExchangeTwinEvent(venueState, privateDelivery);
  assert.equal(orderByFixtureId(observed).localTruth, 'OBSERVED');
  const mismatch = event('RECONCILIATION_OBSERVATION', 10, T0 + 40, {
    fixtureId: fixture.fixtureId,
    ownerObservationRevision: `owner-reconciliation:${'8'.repeat(24)}`,
    observedVenueRevision: venueOrder.venueRevision,
    observedStatus: 'CANCELED',
    observedFilledQuantity: venueOrder.filledQuantity,
  });
  const state = reduceExchangeTwinEvent(observed, mismatch);
  const order = orderByFixtureId(state);
  assert.equal(order.localTruth, 'RECOVERY_REQUIRED');
  assert.equal(order.localObservedVenueStatus, null);
  assert.equal(order.recoveryRequired, true);
  assert.ok(order.blockedReasonCodes.includes('OWNER_RECONCILIATION_MISMATCH'));
});

test('injected latency and adverse-selection costs remain separate exact axes', () => {
  const fixture = orderFixture();
  const { state: venueState } = runThroughVenue(fixture);
  const latency = event('COST_OBSERVATION', 9, T0 + 21, {
    fixtureId: fixture.fixtureId,
    evidenceRevision: `latency-cost:${'9'.repeat(24)}`,
    kind: 'LATENCY_MOVEMENT_QUOTE',
    amount: '0.0123',
  });
  const adverse = event('COST_OBSERVATION', 10, T0 + 22, {
    fixtureId: fixture.fixtureId,
    evidenceRevision: `adverse-cost:${'a'.repeat(24)}`,
    kind: 'ADVERSE_SELECTION_QUOTE',
    amount: '0.0456',
  });
  const state = reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, latency), adverse);
  const order = orderByFixtureId(state);
  assert.equal(order.latencyMovementQuote, '0.0123');
  assert.equal(order.latencyMovementEvidenceRevision, latency.payload.evidenceRevision);
  assert.equal(order.adverseSelectionQuote, '0.0456');
  assert.equal(order.adverseSelectionEvidenceRevision, adverse.payload.evidenceRevision);
  assert.equal(order.spreadDepthImpactQuote, '0.02');
});

test('non-quote fee without conversion stays null and calibration never fabricates confidence', async () => {
  const { compareExchangeTwinOutcome } = await import('../../../dist/liveEdge/adapters/exchangeTwin/index.js');
  const fixture = orderFixture({ quantity: '0.01', price: '100' });
  const events = baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.01' }],
    fee: feeEvidence({
      chargeBasis: 'BASE_QUANTITY',
      feeAsset: fixture.baseAsset,
      quoteConversionRate: null,
      takerRate: '0.001',
    }),
  });
  const predictedState = runExchangeTwinScenario(scenarioInput({ fixture, events }));
  const order = orderByFixtureId(predictedState);
  assert.equal(order.fills[0].feeAmount, '0.00001');
  assert.equal(order.fills[0].feeAsset, fixture.baseAsset);
  assert.equal(order.fills[0].quoteEquivalentFee, null);

  const recordedOutcomeRevision = `recorded-outcome:${'6'.repeat(24)}`;
  const recordedContentRevision = deriveTwinRecordedOutcomeContentRevision({
    recordedOutcomeRevision,
    recordedFilledQuantity: '0.02',
  });
  const revisionProjection = {
    modelRevision: predictedState.modelRevision,
    predictedOutcomeRevision: predictedState.outcomeRevision,
    recordedContentRevision,
    sampleCount: 10,
    observedAtMs: T0,
    validUntilMs: T0 + 100,
  };
  const evidence = {
    schema: 'TWIN_CALIBRATION_EVIDENCE_V1',
    calibrationRevision: deriveTwinCalibrationRevision(revisionProjection),
    ...revisionProjection,
    recordedOutcomeRevision,
    recordedContentRevision,
    predictedFilledQuantity: order.filledQuantity,
    recordedFilledQuantity: '0.02',
  };
  const comparison = compareExchangeTwinOutcome(predictedState, evidence, T0 + 50);
  assert.equal(comparison.state, 'AVAILABLE');
  assert.equal(comparison.quantityResidual, '0.01');
  assert.equal(comparison.probability, null);
  assert.equal(comparison.confidence, null);
  assert.equal(comparison.simulationAuthority, 'SYNTHETIC_FIXTURE');

  const missing = compareExchangeTwinOutcome(predictedState, null, T0 + 50);
  assert.equal(missing.state, 'UNAVAILABLE');
  assert.deepEqual(missing.reasonCodes, ['EVIDENCE_MISSING']);
  assert.equal(missing.quantityResidual, null);

  for (const changed of [
    { modelRevision: 'exchange-twin-model:other000000000000000000' },
    { sampleCount: 0 },
    { validUntilMs: T0 + 50 },
  ]) {
    const unavailable = compareExchangeTwinOutcome(
      predictedState,
      { ...evidence, ...changed },
      T0 + 50,
    );
    assert.equal(unavailable.state, 'UNAVAILABLE');
    assert.equal(unavailable.quantityResidual, null);
    assert.equal(unavailable.probability, null);
    assert.equal(unavailable.confidence, null);
  }
});
