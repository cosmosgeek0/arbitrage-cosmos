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
  const queueBackedBid = fixture.queueAheadQuantity !== null && fixture.queueAheadQuantity !== '0'
    ? [{ price: fixture.price, quantity: fixture.queueAheadQuantity }]
    : [{ price: '98', quantity: '0.1' }];
  const events = baselineEvents(fixture, {
    bids: queueBackedBid,
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
  assert.equal(order.fills[0].feeAmount, '0.0001485');
  assert.equal(order.fills[0].feeAsset, 'USDT');
  assert.equal(order.fills[0].quoteEquivalentFee, '0.0001485');
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

test('queue-ahead estimate cannot exceed visible same-price depth', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-queue-contradiction-0001', price: '99', quantity: '0.01',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0.2',
  });
  const events = baselineEvents(fixture, {
    bids: [{ price: '99', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
    includePrivate: false,
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const order = orderByFixtureId(
    runExchangeTwinScenario(scenarioInput({ fixture, events })),
    fixture.fixtureId,
  );
  assert.equal(order.venueStatus, 'BLOCKED');
  assert.ok(order.blockedReasonCodes.includes('QUEUE_EVIDENCE_CONTRADICTS_BOOK'));
  assert.equal(order.filledQuantity, '0');
});

test('trade revisions are idempotent by content and conflicting reuse fails closed', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-trade-revision-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const venueState = passiveVenueState(fixture);
  const first = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: fixture.product, symbol: fixture.symbol,
    tradeRevision: `trade-idempotent:${'4'.repeat(24)}`,
    price: '99', quantity: '0.01', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
  });
  const once = reduceExchangeTwinEvent(venueState, first);
  const replay = event('TRADE_EVIDENCE', 10, T0 + 22, first.payload);
  assert.strictEqual(reduceExchangeTwinEvent(once, replay), once);
  const conflict = event('TRADE_EVIDENCE', 11, T0 + 23, {
    ...first.payload, quantity: '0.02',
  });
  assert.throws(() => reduceExchangeTwinEvent(once, conflict), /trade revision content conflict/);
});

test('passive trade allocation is conservative price-time order, not fixture-ID order', () => {
  const worse = orderFixture({
    fixtureId: 'fixture-price-priority-0001', price: '98', quantity: '0.01',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const better = orderFixture({
    fixtureId: 'fixture-price-priority-0002', price: '99', quantity: '0.01',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const events = baselineEvents(worse, {
    bids: [{ price: '99', quantity: '0.1' }, { price: '98', quantity: '0.1' }],
    asks: [{ price: '100', quantity: '0.1' }], includePrivate: false,
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  events.push(
    event('PREFLIGHT_EVIDENCE', 10, T0 + 20, {
      fixtureId: better.fixtureId, ...passingPreflight(better),
    }, { sourceSequence: 202 }),
    event('RATE_DECISION', 11, T0 + 3, {
      fixtureId: better.fixtureId, ...allowedRateDecision(better),
    }),
    event('PLACE_DISPATCH', 12, T0 + 10, { fixtureId: better.fixtureId }),
    event('VENUE_ARRIVAL', 13, T0 + 20, {
      fixtureId: better.fixtureId, feeEvidence: feeEvidence(),
    }, { sourceSequence: 203 }),
    event('TRADE_EVIDENCE', 14, T0 + 21, {
      product: worse.product, symbol: worse.symbol,
      tradeRevision: `trade-price-priority:${'5'.repeat(24)}`,
      price: '98', quantity: '0.01', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
    }),
  );
  const state = runExchangeTwinScenario(scenarioInput({
    fixture: worse, events, overrides: { fixtures: [worse, better] },
  }));
  assert.equal(orderByFixtureId(state, better.fixtureId).filledQuantity, '0.01');
  assert.equal(orderByFixtureId(state, worse.fixtureId).filledQuantity, '0');
});

test('same-price passive arrivals use explicit source order with absolute non-overlapping queue positions', () => {
  const first = orderFixture({
    fixtureId: 'fixture-same-price-first-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0.01',
  });
  const second = orderFixture({
    fixtureId: 'fixture-same-price-second-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0.03',
  });
  const events = baselineEvents(first, {
    bids: [{ price: '99', quantity: '0.1' }],
    asks: [{ price: '100', quantity: '0.1' }],
    includePrivate: false,
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  events.push(
    event('PREFLIGHT_EVIDENCE', 10, T0 + 20, {
      fixtureId: second.fixtureId, ...passingPreflight(second),
    }, { sourceSequence: 202 }),
    event('RATE_DECISION', 11, T0 + 3, {
      fixtureId: second.fixtureId, ...allowedRateDecision(second),
    }),
    event('PLACE_DISPATCH', 12, T0 + 10, { fixtureId: second.fixtureId }),
    event('VENUE_ARRIVAL', 13, T0 + 20, {
      fixtureId: second.fixtureId, feeEvidence: feeEvidence(),
    }, { sourceSequence: 203 }),
    event('TRADE_EVIDENCE', 14, T0 + 21, {
      product: first.product,
      symbol: first.symbol,
      tradeRevision: `trade-same-price-time:${'6'.repeat(24)}`,
      price: '99',
      quantity: '0.04',
      aggressorSide: 'SELL',
      feeEvidence: feeEvidence(),
    }),
  );

  const state = runExchangeTwinScenario(scenarioInput({
    fixture: first,
    events,
    overrides: { fixtures: [second, first] },
  }));
  const firstOrder = orderByFixtureId(state, first.fixtureId);
  const secondOrder = orderByFixtureId(state, second.fixtureId);
  assert.equal(state.orderingTruth, 'PROVED');
  assert.equal(firstOrder.venueArrivalAtMs, secondOrder.venueArrivalAtMs);
  assert.equal(firstOrder.venueArrivalSequence, 201);
  assert.equal(secondOrder.venueArrivalSequence, 203);
  assert.equal(firstOrder.queueAheadRemaining, '0');
  assert.equal(firstOrder.filledQuantity, '0.02');
  assert.equal(secondOrder.queueAheadRemaining, '0');
  assert.equal(secondOrder.filledQuantity, '0.01');
  assert.equal(secondOrder.remainingQuantity, '0.01');
});

test('sell trade-through depletes better bid levels before and through its trade price', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-trade-through-book-0001', price: '98', quantity: '0.02',
    queueTruth: 'UNKNOWN', queueAheadQuantity: null,
  });
  const events = baselineEvents(fixture, {
    bids: [
      { price: '101', quantity: '0.01' },
      { price: '100', quantity: '0.02' },
      { price: '99', quantity: '0.03' },
      { price: '98', quantity: '0.04' },
    ],
    asks: [{ price: '102', quantity: '0.1' }],
    includePrivate: false,
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const venueState = runExchangeTwinScenario(scenarioInput({ fixture, events }));
  const trade = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: fixture.product,
    symbol: fixture.symbol,
    tradeRevision: `trade-through-book:${'7'.repeat(24)}`,
    price: '99',
    quantity: '0.04',
    aggressorSide: 'SELL',
    feeEvidence: feeEvidence(),
  });

  const changed = reduceExchangeTwinEvent(venueState, trade);
  assert.deepEqual(changed.book.bids, [
    { price: '99', quantity: '0.02' },
    { price: '98', quantity: '0.04' },
  ]);
  assert.equal(orderByFixtureId(changed, fixture.fixtureId).filledQuantity, '0');
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
      {
        sourceSequence: (candidate.kind === 'PREFLIGHT_EVIDENCE' ? 10
          : candidate.kind === 'RATE_DECISION' ? 20
            : candidate.kind === 'PLACE_DISPATCH' ? 30 : 40)
          + (candidate.payload.fixtureId === first.fixtureId ? 0 : 1),
      },
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
