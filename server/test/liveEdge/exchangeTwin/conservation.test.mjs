import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkpointExchangeTwin,
  reduceExchangeTwinEvent,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  OWNER_INSTRUMENT_VALID_UNTIL_MS,
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

function venueOnly(fixture, options = {}) {
  const events = baselineEvents(fixture, { ...options, includePrivate: false })
    .filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  return runExchangeTwinScenario(scenarioInput({ fixture, events }));
}

test('one passive trade quantity cannot be reused across multiple twin orders', () => {
  const first = orderFixture({
    fixtureId: 'fixture-passive-0001', price: '99', quantity: '0.02',
    queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const second = orderFixture({
    fixtureId: 'fixture-passive-0002',
    price: '99', quantity: '0.02', queueTruth: 'ESTIMATED', queueAheadQuantity: '0',
  });
  const events = [
    event('SYMBOL_STATUS', 1, T0, {
      product: first.product, symbol: 'BTCUSDT', status: 'TRADING',
      evidenceRevision: `symbol-status:${'1'.repeat(24)}`,
      observedAtMs: T0,
      validUntilMs: T0 + 10_000,
    }),
    event('BOOK_SNAPSHOT', 2, T0 + 1, {
      product: first.product, symbol: 'BTCUSDT', bookRevision: `book-revision:${'2'.repeat(24)}`,
      sourceSequence: 100,
      observedAtMs: T0 + 1,
      validUntilMs: T0 + 10_000,
      bids: [{ price: '98', quantity: '0.1' }], asks: [{ price: '100', quantity: '0.1' }],
    }, { sourceSequence: 100 }),
  ];
  for (const [offset, fixture] of [[0, first], [10, second]]) {
    events.push(
      event('PREFLIGHT_EVIDENCE', 3 + offset, T0 + 20, {
        fixtureId: fixture.fixtureId, ...passingPreflight(fixture),
      }),
      event('RATE_DECISION', 4 + offset, T0 + 3, {
        fixtureId: fixture.fixtureId, ...allowedRateDecision(fixture),
      }),
      event('PLACE_DISPATCH', 5 + offset, T0 + 10, { fixtureId: fixture.fixtureId }),
      event('VENUE_ARRIVAL', 6 + offset, T0 + 20, {
        fixtureId: fixture.fixtureId, feeEvidence: feeEvidence(),
      }),
    );
  }
  events.push(event('TRADE_EVIDENCE', 30, T0 + 21, {
    product: first.product, symbol: 'BTCUSDT', tradeRevision: `trade-revision:${'3'.repeat(24)}`,
    price: '99', quantity: '0.01', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
  }));

  const state = runExchangeTwinScenario(scenarioInput({
    fixture: first,
    events,
    overrides: { fixtures: [first, second] },
  }));
  const totalFilled = state.orders.reduce((sum, order) => sum + Number(order.filledQuantity), 0);
  assert.ok(totalFilled <= 0.01, `one trade unit was reused into ${totalFilled} fill units`);
});

test('a second venue-arrival event cannot execute one fixture twice', () => {
  const fixture = orderFixture({ quantity: '0.01', price: '100', timeInForce: 'GTC' });
  const state = venueOnly(fixture, {
    asks: [{ price: '100', quantity: '0.02' }],
  });
  const duplicateArrival = event('VENUE_ARRIVAL', 9, T0 + 20, {
    fixtureId: fixture.fixtureId,
    feeEvidence: feeEvidence(),
  });
  assert.throws(
    () => reduceExchangeTwinEvent(state, duplicateArrival),
    /venue arrival is duplicated|already arrived|ordering is ambiguous/i,
  );
});

test('regressed book snapshots fail closed while exact replay is idempotent', () => {
  const fixture = orderFixture();
  const snapshot = baselineEvents(fixture)[1];
  const state = runExchangeTwinScenario(scenarioInput({ fixture, events: [snapshot] }));
  assert.strictEqual(reduceExchangeTwinEvent(state, snapshot), state);

  const regressed = event('BOOK_SNAPSHOT', 9, T0 + 2, {
    ...snapshot.payload,
    bookRevision: `book-regressed:${'4'.repeat(24)}`,
    sourceSequence: snapshot.payload.sourceSequence - 1,
    observedAtMs: T0 + 2,
  }, { sourceSequence: snapshot.payload.sourceSequence - 1 });
  assert.throws(
    () => reduceExchangeTwinEvent(state, regressed),
    /regressed|source sequence/i,
  );
});

test('instrument and reference freshness are evaluated at venue arrival and equality is expired', () => {
  const dispatchAtMs = T0 + 10;
  const fixture = orderFixture({
    l06ValidUntilMs: OWNER_INSTRUMENT_VALID_UNTIL_MS + 1_000,
    latency: {
      dispatchToVenueMs: OWNER_INSTRUMENT_VALID_UNTIL_MS - dispatchAtMs,
      venueToHttpMs: 20,
      venueToPrivateMs: 15,
    },
  });
  const events = baselineEvents(fixture)
    .filter((candidate) => candidate.kind !== 'HTTP_DELIVERY')
    .map((candidate) => {
      if (candidate.kind === 'SYMBOL_STATUS' || candidate.kind === 'BOOK_SNAPSHOT') return event(
        candidate.kind,
        candidate.sequence,
        candidate.occurredAtMs,
        { ...candidate.payload, validUntilMs: OWNER_INSTRUMENT_VALID_UNTIL_MS + 1_000 },
        { sourceSequence: candidate.sourceSequence },
      );
      if (candidate.kind === 'PREFLIGHT_EVIDENCE') {
        const ownerEvidence = JSON.parse(JSON.stringify(passingPreflight(fixture, {
          evaluatedAtMs: OWNER_INSTRUMENT_VALID_UNTIL_MS,
        })));
        return event(
          'PREFLIGHT_EVIDENCE', candidate.sequence, OWNER_INSTRUMENT_VALID_UNTIL_MS,
          { fixtureId: fixture.fixtureId, ...ownerEvidence },
        );
      }
      if (candidate.kind === 'VENUE_ARRIVAL') return event(
        'VENUE_ARRIVAL', candidate.sequence, OWNER_INSTRUMENT_VALID_UNTIL_MS,
        { ...candidate.payload, feeEvidence: null },
      );
      return candidate;
    });
  const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));
  assert.equal(order.venueStatus, 'BLOCKED');
  assert.ok(order.blockedReasonCodes.includes('PREFLIGHT_NOT_EXACT'));
});

test('MARKET without exact L04 reference evidence is fail-closed', () => {
  const fixture = orderFixture({
    orderType: 'MARKET', timeInForce: null, price: null, quantity: '0.01',
  });
  const events = baselineEvents(fixture).map((candidate) => candidate.kind === 'PREFLIGHT_EVIDENCE'
    ? event('PREFLIGHT_EVIDENCE', candidate.sequence, candidate.occurredAtMs, {
      fixtureId: fixture.fixtureId,
      ...passingPreflight(fixture, { referencePrice: null }),
    })
    : candidate);
  const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));
  assert.equal(order.venueStatus, 'BLOCKED');
  assert.ok(order.blockedReasonCodes.includes('PREFLIGHT_NOT_EXACT'));
});

test('fee evidence is exact, bounded and cannot use stale or missing conversion optimistically', () => {
  const fixture = orderFixture({ quantity: '0.01', price: '100' });
  const converted = orderByFixtureId(runExchangeTwinScenario(scenarioInput({
    fixture,
    events: baselineEvents(fixture, {
      asks: [{ price: '100', quantity: '0.01' }],
      fee: feeEvidence({
        chargeBasis: 'BASE_QUANTITY', feeAsset: fixture.baseAsset, takerRate: '0.001',
        quoteConversionRate: '200',
      }),
    }),
  })));
  assert.equal(converted.fills[0].feeAmount, '0.00001');
  assert.equal(converted.fills[0].quoteEquivalentFee, '0.002');

  for (const fee of [
    feeEvidence({ takerRate: '-0.001' }),
    feeEvidence({ validUntilMs: T0 + 20 }),
  ]) {
    assert.throws(
      () => runExchangeTwinScenario(scenarioInput({
        fixture,
        events: baselineEvents(fixture, {
          asks: [{ price: '100', quantity: '0.01' }], fee,
        }),
      })),
      /non-negative|invalid or expired/i,
    );
  }
});

test('outcome and checkpoint commitments are sensitive to seed and fee evidence', () => {
  const fixture = orderFixture({ quantity: '0.01', price: '100' });
  const input = scenarioInput({ fixture, events: baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.01' }],
  }) });
  const original = runExchangeTwinScenario(input);
  const changedSeed = runExchangeTwinScenario({ ...input, seed: 'deterministic-seed-0002' });
  assert.notEqual(changedSeed.outcomeRevision, original.outcomeRevision);
  assert.notEqual(changedSeed.stateRevision, original.stateRevision);

  const changedFeeEvents = baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.01' }],
    fee: feeEvidence({ takerRate: '0.002', evidenceRevision: `fee-evidence:${'5'.repeat(24)}` }),
  });
  const changedFee = runExchangeTwinScenario(scenarioInput({ fixture, events: changedFeeEvents }));
  assert.notEqual(changedFee.outcomeRevision, original.outcomeRevision);
  assert.notEqual(checkpointExchangeTwin(changedFee).checkpointRevision,
    checkpointExchangeTwin(original).checkpointRevision);
});

test('bounded integer depth property: fill never exceeds order or explicit liquidity', () => {
  for (let requested = 1; requested <= 8; requested += 1) {
    for (let firstLevel = 0; firstLevel <= 4; firstLevel += 1) {
      const secondLevel = (requested + firstLevel) % 5;
      const fixture = orderFixture({
        fixtureId: `fixture-property-${requested}-${firstLevel}`,
        quantity: `0.0${requested}`,
        price: '101',
        timeInForce: 'IOC',
      });
      const asks = [
        ...(firstLevel === 0 ? [] : [{ price: '100', quantity: `0.0${firstLevel}` }]),
        ...(secondLevel === 0 ? [] : [{ price: '101', quantity: `0.0${secondLevel}` }]),
      ];
      const state = runExchangeTwinScenario(scenarioInput({
        fixture,
        events: baselineEvents(fixture, { asks }),
        overrides: { scenarioId: `scenario-property-${requested}-${firstLevel}` },
      }));
      const order = orderByFixtureId(state, fixture.fixtureId);
      const filled = Number(order.filledQuantity);
      const explicit = (firstLevel + secondLevel) / 100;
      assert.ok(filled <= requested / 100, `${requested}/${firstLevel}: exceeds order`);
      assert.ok(filled <= explicit, `${requested}/${firstLevel}: exceeds depth`);
      assert.equal(
        order.fills.reduce((sum, fill) => sum + Number(fill.quantity), 0),
        filled,
      );
    }
  }
});

test('maximum legal structural snapshot remains serialization-bounded', () => {
  const fixture = orderFixture({ quantity: '0.01', price: '100' });
  const bids = Array.from({ length: 512 }, (_, index) => ({
    price: String(1000 - index), quantity: '1',
  }));
  const asks = Array.from({ length: 512 }, (_, index) => ({
    price: String(1001 + index), quantity: '1',
  }));
  const state = runExchangeTwinScenario(scenarioInput({
    fixture,
    events: baselineEvents(fixture, { bids, asks }),
  }));
  const bytes = Buffer.byteLength(JSON.stringify(checkpointExchangeTwin(state)), 'utf8');
  assert.ok(bytes < 1_048_576, `checkpoint exceeded 1MiB structural bound: ${bytes}`);
});
