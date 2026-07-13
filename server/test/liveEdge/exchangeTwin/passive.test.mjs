import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reduceExchangeTwinEvent,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  T0,
  allowedRateDecision,
  baselineEvents,
  event,
  feeEvidence,
  orderByFixtureId,
  orderFixture,
  passingPreflight,
  scenarioInput,
} from './fixtures.mjs';

function passiveVenueState(fixture) {
  const events = baselineEvents(fixture, {
    bids: [{ price: '98', quantity: '0.1' }],
    asks: [{ price: '100', quantity: '0.1' }],
    includePrivate: false,
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  return runExchangeTwinScenario(scenarioInput({ fixture, events }));
}

test('quote removal alone never fills a passive order', () => {
  const fixture = orderFixture({
    price: '98',
    quantity: '0.02',
    queueTruth: 'ESTIMATED',
    queueAheadQuantity: '0.01',
  });
  const venueState = passiveVenueState(fixture);
  const prior = orderByFixtureId(venueState);
  assert.equal(prior.venueStatus, 'NEW');
  assert.equal(prior.filledQuantity, '0');

  const delta = event('BOOK_DELTA', 9, T0 + 21, {
    product: fixture.product,
    symbol: fixture.symbol,
    bookRevision: `book-revision:${'f'.repeat(24)}`,
    previousBookRevision: venueState.book.bookRevision,
    sourceSequence: venueState.book.sourceSequence + 1,
    observedAtMs: T0 + 21,
    validUntilMs: T0 + 10_000,
    bidUpdates: [{ price: '98', quantity: '0' }],
    askUpdates: [],
  }, { sourceSequence: venueState.book.sourceSequence + 1 });
  const changed = reduceExchangeTwinEvent(venueState, delta);
  const order = orderByFixtureId(changed);
  assert.equal(order.filledQuantity, '0');
  assert.deepEqual(order.fills, []);
  assert.equal(order.queueAheadRemaining, '0.01');
});

test('explicit trade-through consumes queue ahead before filling the passive twin order', () => {
  const fixture = orderFixture({
    price: '99',
    quantity: '0.02',
    queueTruth: 'ESTIMATED',
    queueAheadQuantity: '0.02',
  });
  const venueState = passiveVenueState(fixture);
  const firstTrade = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: fixture.product,
    symbol: fixture.symbol,
    tradeRevision: `trade-revision:${'1'.repeat(24)}`,
    price: '98',
    quantity: '0.015',
    aggressorSide: 'SELL',
    feeEvidence: feeEvidence(),
  });
  const afterFirst = reduceExchangeTwinEvent(venueState, firstTrade);
  assert.equal(orderByFixtureId(afterFirst).queueAheadRemaining, '0.005');
  assert.equal(orderByFixtureId(afterFirst).filledQuantity, '0');

  const secondTrade = event('TRADE_EVIDENCE', 10, T0 + 22, {
    product: fixture.product,
    symbol: fixture.symbol,
    tradeRevision: `trade-revision:${'2'.repeat(24)}`,
    price: '98',
    quantity: '0.0125',
    aggressorSide: 'SELL',
    feeEvidence: feeEvidence(),
  });
  const afterSecond = reduceExchangeTwinEvent(afterFirst, secondTrade);
  const order = orderByFixtureId(afterSecond);
  assert.equal(order.queueAheadRemaining, '0');
  assert.equal(order.filledQuantity, '0.0075');
  assert.equal(order.remainingQuantity, '0.0125');
  assert.equal(order.venueStatus, 'PARTIALLY_FILLED');
  assert.equal(order.fills[0].liquidityRole, 'MAKER');
  assert.equal(order.fills[0].price, '99');
});

test('UNKNOWN queue truth never becomes an exact passive fill', () => {
  const fixture = orderFixture({
    price: '99', quantity: '0.01', queueTruth: 'UNKNOWN', queueAheadQuantity: null,
  });
  const venueState = passiveVenueState(fixture);
  const trade = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: fixture.product,
    symbol: fixture.symbol,
    tradeRevision: `trade-revision:${'3'.repeat(24)}`,
    price: '99', quantity: '0.1', aggressorSide: 'SELL', feeEvidence: null,
  });
  const order = orderByFixtureId(reduceExchangeTwinEvent(venueState, trade));
  assert.equal(order.queueAheadRemaining, null);
  assert.equal(order.filledQuantity, '0');
  assert.deepEqual(order.fills, []);
});

test('ambiguous simultaneous arrivals do not allocate shared depth; explicit source order conserves it', () => {
  const first = orderFixture({
    fixtureId: 'fixture-order-0001', quantity: '0.02', price: '100', timeInForce: 'IOC',
  });
  const second = orderFixture({
    fixtureId: 'fixture-order-0002',
    quantity: '0.02',
    price: '100',
    timeInForce: 'IOC',
  });
  const shared = baselineEvents(first, {
    asks: [{ price: '100', quantity: '0.03' }],
    includePrivate: false,
  }).filter((candidate) => !['HTTP_DELIVERY'].includes(candidate.kind));
  const events = [
    ...shared,
    event('PREFLIGHT_EVIDENCE', 10, T0 + 20, {
      fixtureId: second.fixtureId, ...passingPreflight(second),
    }),
    event('RATE_DECISION', 11, T0 + 3, {
      fixtureId: second.fixtureId, ...allowedRateDecision(second),
    }),
    event('PLACE_DISPATCH', 12, T0 + 10, { fixtureId: second.fixtureId }),
    event('VENUE_ARRIVAL', 13, T0 + 20, {
      fixtureId: second.fixtureId, feeEvidence: feeEvidence(),
    }),
  ];
  const ambiguous = runExchangeTwinScenario(scenarioInput({
    fixture: first,
    events,
    overrides: { fixtures: [first, second] },
  }));
  assert.equal(ambiguous.orderingTruth, 'AMBIGUOUS');
  assert.equal(orderByFixtureId(ambiguous, first.fixtureId).filledQuantity, '0');
  assert.equal(orderByFixtureId(ambiguous, second.fixtureId).filledQuantity, '0');
  assert.equal(ambiguous.book.asks[0].quantity, '0.03');

  const orderedKinds = new Set(['PREFLIGHT_EVIDENCE', 'RATE_DECISION', 'PLACE_DISPATCH', 'VENUE_ARRIVAL']);
  const orderedEvents = events.map((candidate) => !orderedKinds.has(candidate.kind)
    ? candidate
    : event(
      candidate.kind,
      candidate.sequence,
      candidate.occurredAtMs,
      candidate.payload,
      { sourceSequence: candidate.payload.fixtureId === first.fixtureId ? 1 : 2 },
    ));
  const state = runExchangeTwinScenario(scenarioInput({
    fixture: first,
    events: orderedEvents,
    overrides: { fixtures: [first, second] },
  }));
  const firstOrder = orderByFixtureId(state, first.fixtureId);
  const secondOrder = orderByFixtureId(state, second.fixtureId);
  assert.equal(firstOrder.filledQuantity, '0.02');
  assert.equal(secondOrder.filledQuantity, '0.01');
  assert.equal(secondOrder.expiredQuantity, '0.01');
  assert.equal(state.book.asks.length, 0);
});
