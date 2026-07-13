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
    assert.ok(order.blockedReasonCodes.includes(`RATE_${reason}`), reason);
    assert.notEqual(order.localTruth, 'ACKNOWLEDGED', reason);
    assert.equal(order.localObservedVenueStatus, 'BLOCKED', reason);
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

test('equal-time status/venue ordering is source-proved or explicitly ambiguous', () => {
  const fixture = orderFixture({ fixtureId: 'fixture-status-venue-race-0001' });
  const base = baselineEvents(fixture, { includePrivate: false })
    .filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const run = (sourceSequence) => runExchangeTwinScenario(scenarioInput({
    fixture,
    events: [...base, event('SYMBOL_STATUS', 9, T0 + 20, {
      product: fixture.product, symbol: fixture.symbol, status: 'HALT',
      evidenceRevision: `status-venue-race:${String(sourceSequence ?? 'x').padEnd(24, '7')}`,
      observedAtMs: T0 + 20, validUntilMs: T0 + 10_000,
    }, sourceSequence === null ? {} : { sourceSequence })],
  }));
  const haltFirst = orderByFixtureId(run(199), fixture.fixtureId);
  assert.equal(haltFirst.venueStatus, 'BLOCKED');
  assert.ok(haltFirst.blockedReasonCodes.includes('SYMBOL_HALT'));
  const venueFirst = orderByFixtureId(run(202), fixture.fixtureId);
  assert.equal(venueFirst.venueStatus, 'FILLED');
  const ambiguous = run(null);
  assert.equal(ambiguous.orderingTruth, 'AMBIGUOUS');
  assert.equal(orderByFixtureId(ambiguous, fixture.fixtureId).filledQuantity, '0');
});

test('incremental ambiguity scans every overlapping event at the candidate timestamp', () => {
  const first = orderFixture({ fixtureId: 'fixture-incremental-race-0001' });
  const second = orderFixture({ fixtureId: 'fixture-incremental-race-0002' });
  const baseline = baselineEvents(first, { includePrivate: false });
  let state = createExchangeTwinState({
    ...scenarioInput({ fixture: first, events: [] }), fixtures: [first, second],
  });
  for (const candidate of [
    baseline.find((item) => item.kind === 'SYMBOL_STATUS'),
    baseline.find((item) => item.kind === 'BOOK_SNAPSHOT'),
    baseline.find((item) => item.kind === 'RATE_DECISION'),
    baseline.find((item) => item.kind === 'PLACE_DISPATCH'),
    event('PREFLIGHT_EVIDENCE', 20, T0 + 19, {
      fixtureId: first.fixtureId, ...passingPreflight(first),
    }),
  ]) state = reduceExchangeTwinEvent(state, candidate);
  state = reduceExchangeTwinEvent(state, event('SYMBOL_STATUS', 21, T0 + 20, {
    product: first.product, symbol: first.symbol, status: 'HALT',
    evidenceRevision: `incremental-halt:${'c'.repeat(24)}`,
    observedAtMs: T0 + 20, validUntilMs: T0 + 10_000,
  }));
  state = reduceExchangeTwinEvent(state, event('PREFLIGHT_EVIDENCE', 22, T0 + 20, {
    fixtureId: second.fixtureId, ...passingPreflight(second),
  }));
  const arrival = event('VENUE_ARRIVAL', 23, T0 + 20, {
    fixtureId: first.fixtureId, feeEvidence: feeEvidence(),
  });
  assert.throws(
    () => reduceExchangeTwinEvent(state, arrival),
    /incremental equal-time event ordering is ambiguous/,
  );
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

test('delayed private delivery preserves stale revision as recovery evidence', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-stale-private-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
    latency: { dispatchToVenueMs: 10, venueToHttpMs: 30, venueToPrivateMs: 20 },
  });
  const { state: venueState, order: arrived } = runThroughVenue(fixture, {
    bids: [{ price: '99', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
  });
  const trade = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: fixture.product, symbol: fixture.symbol,
    tradeRevision: `trade-before-private:${'b'.repeat(24)}`,
    price: '99', quantity: '0.01', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
  });
  const changed = reduceExchangeTwinEvent(venueState, trade);
  const delivery = event('PRIVATE_DELIVERY', 10, T0 + 40, {
    fixtureId: fixture.fixtureId,
    venueRevision: arrived.venueRevision,
  });
  const state = reduceExchangeTwinEvent(changed, delivery);
  const order = orderByFixtureId(state, fixture.fixtureId);
  assert.equal(order.filledQuantity, '0.01');
  assert.equal(order.localTruth, 'RECOVERY_REQUIRED');
  assert.equal(order.localObservedVenueStatus, null);
  assert.ok(order.blockedReasonCodes.includes('STALE_PRIVATE_OBSERVATION'));
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
    quantity: '0.02',
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
  assert.equal(fillFirstOrder.filledQuantity, '0.02');
  assert.equal(fillFirstOrder.venueStatus, 'FILLED');
  const filledCancelAck = reduceExchangeTwinEvent(fillFirst, event(
    'CANCEL_DELIVERY', 13, T0 + 31,
    { fixtureId: fixture.fixtureId, cancelFixtureId: cancel.cancelFixtureId, outcome: 'ACK' },
  ));
  assert.equal(orderByFixtureId(filledCancelAck).localTruth, 'UNKNOWN');
  assert.equal(orderByFixtureId(filledCancelAck).localObservedVenueStatus, null);
  assert.equal(orderByFixtureId(filledCancelAck).recoveryRequired, true);

  const cancelFirst = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, cancelDispatch), cancelArrival),
    tradeAfterCancel,
  );
  const cancelFirstOrder = orderByFixtureId(cancelFirst);
  assert.equal(cancelFirstOrder.filledQuantity, '0');
  assert.equal(cancelFirstOrder.venueStatus, 'CANCELED');
});

test('equal-time cancel/trade races require distinct source order and honor both directions', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-equal-time-race-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const cancel = cancelFixture(fixture, { cancelFixtureId: 'cancel-equal-time-0001' });
  const base = baselineEvents(fixture, {
    bids: [{ price: '99', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
    includePrivate: false,
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const dispatch = event('CANCEL_DISPATCH', 9, T0 + 25, {
    fixtureId: fixture.fixtureId, cancelFixture: cancel,
  });
  const payloads = {
    cancel: cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 30),
    trade: {
      product: fixture.product, symbol: fixture.symbol,
      tradeRevision: `trade-equal-time:${'a'.repeat(24)}`,
      price: '99', quantity: '0.01', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
    },
  };
  const run = (cancelSequence, tradeSequence) => runExchangeTwinScenario(scenarioInput({
    fixture,
    events: [
      ...base, dispatch,
      event('CANCEL_ARRIVAL', 10, T0 + 30, payloads.cancel,
        cancelSequence === null ? {} : { sourceSequence: cancelSequence }),
      event('TRADE_EVIDENCE', 11, T0 + 30, payloads.trade,
        tradeSequence === null ? {} : { sourceSequence: tradeSequence }),
    ],
  }));
  const tradeFirst = orderByFixtureId(run(20, 10), fixture.fixtureId);
  assert.equal(tradeFirst.filledQuantity, '0.01');
  assert.equal(tradeFirst.venueStatus, 'CANCELED');
  const cancelFirst = orderByFixtureId(run(10, 20), fixture.fixtureId);
  assert.equal(cancelFirst.filledQuantity, '0');
  assert.equal(cancelFirst.venueStatus, 'CANCELED');
  const ambiguous = run(null, null);
  assert.equal(ambiguous.orderingTruth, 'AMBIGUOUS');
  assert.equal(orderByFixtureId(ambiguous, fixture.fixtureId).filledQuantity, '0');
  assert.equal(orderByFixtureId(ambiguous, fixture.fixtureId).recoveryRequired, true);
});

test('equal-time HTTP/private delivery is ambiguous without source order and converges when ordered', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-equal-time-delivery-0001',
    latency: { dispatchToVenueMs: 10, venueToHttpMs: 20, venueToPrivateMs: 20 },
  });
  const venueEvents = baselineEvents(fixture, { includePrivate: false })
    .filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const venueState = runExchangeTwinScenario(scenarioInput({ fixture, events: venueEvents }));
  const venueRevision = orderByFixtureId(venueState, fixture.fixtureId).venueRevision;
  const run = (httpSequence, privateSequence) => runExchangeTwinScenario(scenarioInput({
    fixture,
    events: [
      ...venueEvents,
      event('HTTP_DELIVERY', 9, T0 + 40, {
        fixtureId: fixture.fixtureId, outcome: 'ACK',
      }, httpSequence === null ? {} : { sourceSequence: httpSequence }),
      event('PRIVATE_DELIVERY', 10, T0 + 40, {
        fixtureId: fixture.fixtureId, venueRevision,
      }, privateSequence === null ? {} : { sourceSequence: privateSequence }),
    ],
  }));
  const ambiguous = run(null, null);
  assert.equal(ambiguous.orderingTruth, 'AMBIGUOUS');
  assert.equal(orderByFixtureId(ambiguous, fixture.fixtureId).localTruth, 'UNKNOWN');
  for (const [httpSequence, privateSequence] of [[10, 20], [20, 10]]) {
    const order = orderByFixtureId(run(httpSequence, privateSequence), fixture.fixtureId);
    assert.equal(order.localTruth, 'OBSERVED');
    assert.equal(order.localObservedVenueStatus, 'FILLED');
  }
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

test('crash after partial fill and restore cannot duplicate trade, fill or consumed depth', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-partial-crash-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const { state: venueState } = runThroughVenue(fixture, {
    bids: [{ price: '99', quantity: '0.02' }], asks: [{ price: '100', quantity: '0.1' }],
  });
  const trade = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: fixture.product, symbol: fixture.symbol,
    tradeRevision: `trade-partial-crash:${'9'.repeat(24)}`,
    price: '99', quantity: '0.005', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
  });
  const partial = reduceExchangeTwinEvent(venueState, trade);
  assert.equal(orderByFixtureId(partial, fixture.fixtureId).filledQuantity, '0.005');
  assert.equal(partial.book.bids[0].quantity, '0.015');
  const crash = event('CRASH', 10, T0 + 22, {
    crashId: 'crash-after-partial-0001', dropLocalDeliveries: true, dropPendingCommands: false,
  });
  const restart = event('RESTART', 11, T0 + 30, { crashId: 'crash-after-partial-0001' });
  const restarted = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(partial, crash),
    restart,
  );
  const restored = restoreExchangeTwin(checkpointExchangeTwin(restarted));
  const replayEnvelope = event('TRADE_EVIDENCE', 12, T0 + 31, trade.payload);
  const replayed = reduceExchangeTwinEvent(restored, replayEnvelope);
  assert.strictEqual(replayed, restored);
  const order = orderByFixtureId(replayed, fixture.fixtureId);
  assert.equal(order.filledQuantity, '0.005');
  assert.equal(order.fills.length, 1);
  assert.equal(replayed.book.bids[0].quantity, '0.015');
  assert.equal(order.localTruth, 'RECOVERY_REQUIRED');
});

test('crash after nonterminal venue arrival before ACK preserves the resting order', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-arrived-before-ack-0001', price: '99', quantity: '0.01',
  });
  const { state: venueState } = runThroughVenue(fixture, {
    bids: [{ price: '98', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
  });
  assert.equal(orderByFixtureId(venueState, fixture.fixtureId).venueStatus, 'NEW');
  const crash = event('CRASH', 9, T0 + 21, {
    crashId: 'crash-after-arrival-0001', dropLocalDeliveries: true, dropPendingCommands: false,
  });
  const http = event('HTTP_DELIVERY', 10, T0 + 40, {
    fixtureId: fixture.fixtureId, outcome: 'ACK',
  });
  const restart = event('RESTART', 11, T0 + 50, { crashId: 'crash-after-arrival-0001' });
  const state = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, crash), http),
    restart,
  );
  const order = orderByFixtureId(state, fixture.fixtureId);
  assert.equal(order.venueStatus, 'NEW');
  assert.equal(order.filledQuantity, '0');
  assert.equal(order.localTruth, 'RECOVERY_REQUIRED');
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

test('cancel arrival requires fresh symbol and unexpired L06 owner evidence', () => {
  for (const [mode, expectedReason] of [
    ['L06_EXPIRED', 'CANCEL_L06_EVIDENCE_EXPIRED'],
    ['STATUS_STALE', 'CANCEL_SYMBOL_STATUS_STALE'],
  ]) {
    const fixture = orderFixture({
      fixtureId: `fixture-cancel-freshness-${mode.toLowerCase()}`,
      price: '99', quantity: '0.01',
    });
    const { state: venueState } = runThroughVenue(fixture, {
      bids: [{ price: '98', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
    });
    const cancel = cancelFixture(fixture, {
      cancelFixtureId: `cancel-freshness-${mode.toLowerCase()}`,
      validUntilMs: mode === 'L06_EXPIRED' ? T0 + 30 : T0 + 100,
    });
    let state = venueState;
    if (mode === 'STATUS_STALE') {
      state = reduceExchangeTwinEvent(state, event('SYMBOL_STATUS', 9, T0 + 21, {
        product: fixture.product, symbol: fixture.symbol, status: 'TRADING',
        evidenceRevision: `status-stale:${'8'.repeat(24)}`,
        observedAtMs: T0 + 21, validUntilMs: T0 + 30,
      }));
    }
    const dispatch = event('CANCEL_DISPATCH', 10, T0 + 25, {
      fixtureId: fixture.fixtureId, cancelFixture: cancel,
    });
    const arrival = event('CANCEL_ARRIVAL', 11, T0 + 30,
      cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 30));
    state = reduceExchangeTwinEvent(reduceExchangeTwinEvent(state, dispatch), arrival);
    const order = orderByFixtureId(state, fixture.fixtureId);
    assert.equal(order.venueStatus, 'NEW', mode);
    assert.equal(order.recoveryRequired, true, mode);
    assert.ok(order.blockedReasonCodes.includes(expectedReason), mode);
    state = reduceExchangeTwinEvent(state, event('CANCEL_DELIVERY', 12, T0 + 31, {
      fixtureId: fixture.fixtureId,
      cancelFixtureId: cancel.cancelFixtureId,
      outcome: 'ACK',
    }));
    assert.equal(orderByFixtureId(state, fixture.fixtureId).localTruth, 'UNKNOWN', mode);
    assert.equal(orderByFixtureId(state, fixture.fixtureId).localObservedVenueStatus, null, mode);
    assert.equal(orderByFixtureId(state, fixture.fixtureId).recoveryRequired, true, mode);
  }
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

  const missingLatency = event('COST_OBSERVATION', 11, T0 + 23, {
    fixtureId: fixture.fixtureId,
    evidenceRevision: `latency-cost-missing:${'b'.repeat(24)}`,
    kind: 'LATENCY_MOVEMENT_QUOTE',
    amount: null,
  });
  const missingState = reduceExchangeTwinEvent(state, missingLatency);
  const restored = restoreExchangeTwin(checkpointExchangeTwin(missingState));
  assert.equal(orderByFixtureId(restored).latencyMovementQuote, null);
  assert.equal(
    orderByFixtureId(restored).latencyMovementEvidenceRevision,
    missingLatency.payload.evidenceRevision,
  );
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
    product: predictedState.product,
    symbol: predictedState.symbol,
    quantityAsset: fixture.baseAsset,
    recordedFilledQuantity: '0.02',
  });
  const revisionProjection = {
    modelRevision: predictedState.modelRevision,
    predictedOutcomeRevision: predictedState.outcomeRevision,
    product: predictedState.product,
    symbol: predictedState.symbol,
    quantityAsset: fixture.baseAsset,
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

  for (const [changed, expectedReason] of [
    [{ modelRevision: 'exchange-twin-model:other000000000000000000' }, 'MODEL_REVISION_MISMATCH'],
    [{ sampleCount: 1 }, 'SAMPLE_INSUFFICIENT'],
    [{ validUntilMs: T0 + 50 }, 'EVIDENCE_STALE'],
  ]) {
    const changedProjection = { ...revisionProjection, ...changed };
    const unavailable = compareExchangeTwinOutcome(
      predictedState,
      {
        ...evidence,
        ...changedProjection,
        calibrationRevision: deriveTwinCalibrationRevision(changedProjection),
      },
      T0 + 50,
    );
    assert.equal(unavailable.state, 'UNAVAILABLE');
    assert.ok(unavailable.reasonCodes.includes(expectedReason));
    assert.equal(unavailable.quantityResidual, null);
    assert.equal(unavailable.probability, null);
    assert.equal(unavailable.confidence, null);
  }

  const wrongSymbolRecorded = deriveTwinRecordedOutcomeContentRevision({
    recordedOutcomeRevision,
    product: predictedState.product,
    symbol: 'ETHUSDT',
    quantityAsset: 'ETH',
    recordedFilledQuantity: '0.02',
  });
  const wrongSymbolProjection = {
    ...revisionProjection,
    symbol: 'ETHUSDT',
    quantityAsset: 'ETH',
    recordedContentRevision: wrongSymbolRecorded,
  };
  const wrongSymbol = compareExchangeTwinOutcome(predictedState, {
    ...evidence,
    ...wrongSymbolProjection,
    calibrationRevision: deriveTwinCalibrationRevision(wrongSymbolProjection),
  }, T0 + 50);
  assert.equal(wrongSymbol.state, 'UNAVAILABLE');
  assert.ok(wrongSymbol.reasonCodes.includes('SYMBOL_MISMATCH'));
  assert.ok(wrongSymbol.reasonCodes.includes('QUANTITY_ASSET_MISMATCH'));
});
