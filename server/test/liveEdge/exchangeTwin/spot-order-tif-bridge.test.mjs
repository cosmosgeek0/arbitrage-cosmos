import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from '../../../dist/foundation/contracts/index.js';
import {
  bindSpotOrderTifCapability,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  checkpointExchangeTwin,
  reduceExchangeTwinEvent,
  restoreExchangeTwin,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateExchangeTwinSpotOrderTifPreflight,
} from '../../../dist/liveEdge/adapters/exchangeTwin/ownerEvidence.js';
import {
  T0,
  baselineEvents,
  event,
  feeEvidence,
  orderByFixtureId,
  orderFixture,
  passingPreflight,
  scenarioInput,
} from './fixtures.mjs';

function revision(prefix, value) {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function rehashState(value) {
  const { outcomeRevision: _outcome, stateRevision: _state, ...material } = value;
  const semantic = {
    scenarioId: material.scenarioId,
    modelRevision: material.modelRevision,
    seed: material.seed,
    product: material.product,
    symbol: material.symbol,
    symbolStatus: material.symbolStatus,
    symbolStatusRevision: material.symbolStatusRevision,
    symbolStatusObservedAtMs: material.symbolStatusObservedAtMs,
    symbolStatusValidUntilMs: material.symbolStatusValidUntilMs,
    book: material.book,
    orders: material.orders,
    crashed: material.crashed,
    activeCrashId: material.activeCrashId,
    orderingTruth: material.orderingTruth,
    ambiguousDomains: material.ambiguousDomains,
  };
  const outcomeRevision = revision('l07outcome_', semantic);
  return {
    ...material,
    outcomeRevision,
    stateRevision: revision('l07state_', { ...material, outcomeRevision }),
  };
}

function deepFreeze(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function spotLimitFixture(overrides = {}) {
  return orderFixture({
    product: 'SPOT',
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    price: '101',
    quantity: '0.03',
    ...overrides,
  });
}

function capabilityPayload(fixture, {
  registrySnapshot,
  request = {},
  expectedCapabilityRevision,
} = {}) {
  const ownerInput = deepFreeze(passingPreflight(fixture, {
    ...(registrySnapshot === undefined ? {} : { registrySnapshot }),
    ...request,
  }));
  const current = bindSpotOrderTifCapability(
    ownerInput.registrySnapshot,
    ownerInput.sizingRequest,
  );
  if (!current.ok && expectedCapabilityRevision === undefined) {
    throw new Error(`test owner input did not produce a capability: ${current.reasonCodes.join(',')}`);
  }
  return {
    ...ownerInput,
    expectedCapabilityRevision: expectedCapabilityRevision
      ?? current.binding.capabilityRevision,
  };
}

function withSpotCapabilityPreflight(events, fixture, options = {}) {
  const payload = capabilityPayload(fixture, options);
  return events.map((candidate) => candidate.kind === 'PREFLIGHT_EVIDENCE'
    ? event('SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE', candidate.sequence, candidate.occurredAtMs, {
      fixtureId: fixture.fixtureId,
      ...payload,
    }, { sourceSequence: candidate.sourceSequence })
    : candidate);
}

function spotEvents(fixture, baseline = {}, bridge = {}) {
  return withSpotCapabilityPreflight(baselineEvents(fixture, baseline), fixture, bridge);
}

function runSpot(fixture, baseline = {}, bridge = {}) {
  return runExchangeTwinScenario(scenarioInput({
    fixture,
    events: spotEvents(fixture, baseline, bridge),
  }));
}

test('exact L08.1 Spot BUY LIMIT GTC crosses the L07 seam while legacy Spot stays blocked and USD-M still fills', () => {
  const spot = spotLimitFixture({ price: '100', quantity: '0.1' });
  const book = { asks: [{ price: '100', quantity: '0.1' }] };
  const legacy = orderByFixtureId(runExchangeTwinScenario(scenarioInput({
    fixture: spot,
    events: baselineEvents(spot, book),
  })));
  assert.equal(legacy.venueStatus, 'BLOCKED');
  assert.equal(legacy.filledQuantity, '0');
  assert.deepEqual(legacy.blockedReasonCodes, ['PREFLIGHT_NOT_EXACT']);

  const bridgedState = runSpot(spot, book);
  const bridged = orderByFixtureId(bridgedState);
  assert.equal(bridged.venueStatus, 'FILLED');
  assert.equal(bridged.filledQuantity, '0.1');
  assert.deepEqual(bridged.blockedReasonCodes, []);
  assert.equal(bridged.fixture.simulationAuthority, 'SYNTHETIC_FIXTURE');
  assert.equal(bridged.fixture.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(bridged.fixture.externalActionAuthorization, 'NONE');
  assert.equal(bridgedState.preflights[0].ownerEvidenceKind, 'L081_SPOT_LIMIT_TIF');
  assert.equal(bridgedState.preflights[0].result.ok, true);
  assert.equal(
    bridgedState.preflights[0].expectedCapabilityRevision,
    bridgedState.preflights[0].result.binding.capabilityRevision,
  );
  assert.equal(bridgedState.preflights[0].result.binding.sendEligible, false);

  const usdm = orderFixture({
    product: 'USD_M_PERPETUAL', side: 'SELL', price: '99', quantity: '0.03',
    timeInForce: 'GTC',
  });
  const usdmOrder = orderByFixtureId(runExchangeTwinScenario(scenarioInput({
    fixture: usdm,
    events: baselineEvents(usdm, { bids: [{ price: '99', quantity: '0.03' }] }),
  })));
  assert.equal(usdmOrder.venueStatus, 'FILLED');
  assert.equal(usdmOrder.filledQuantity, '0.03');
});

test('Spot LIMIT GTC, IOC and FOK reuse the accepted conservative L07 mechanics exactly', () => {
  for (const vector of [
    { tif: 'GTC', asks: [{ price: '100', quantity: '0.01' }], status: 'PARTIALLY_FILLED', filled: '0.01', remaining: '0.02', expired: '0' },
    { tif: 'IOC', asks: [{ price: '100', quantity: '0.01' }], status: 'EXPIRED', filled: '0.01', remaining: '0', expired: '0.02' },
    { tif: 'FOK', asks: [{ price: '100', quantity: '0.01' }], status: 'EXPIRED', filled: '0', remaining: '0', expired: '0.03' },
    { tif: 'FOK', asks: [{ price: '100', quantity: '0.03' }], status: 'FILLED', filled: '0.03', remaining: '0', expired: '0' },
  ]) {
    const fixture = spotLimitFixture({ timeInForce: vector.tif, price: '100' });
    const order = orderByFixtureId(runSpot(fixture, { asks: vector.asks }));
    assert.equal(order.venueStatus, vector.status, vector.tif);
    assert.equal(order.filledQuantity, vector.filled, vector.tif);
    assert.equal(order.remainingQuantity, vector.remaining, vector.tif);
    assert.equal(order.expiredQuantity, vector.expired, vector.tif);
    if (vector.tif === 'FOK') {
      assert.ok(order.filledQuantity === '0' || order.filledQuantity === fixture.quantity);
    }
  }

  const sell = spotLimitFixture({ side: 'SELL', price: '100', quantity: '0.03' });
  const sellOrder = orderByFixtureId(runSpot(sell, {
    bids: [{ price: '101', quantity: '0.01' }, { price: '100', quantity: '0.02' }],
    asks: [{ price: '102', quantity: '0.1' }],
  }));
  assert.equal(sellOrder.venueStatus, 'FILLED');
  assert.deepEqual(sellOrder.fills.map(({ price, quantity }) => ({ price, quantity })), [
    { price: '101', quantity: '0.01' },
    { price: '100', quantity: '0.02' },
  ]);
});

test('Spot GTC can rest and fill only from explicit trade-through evidence', () => {
  const fixture = spotLimitFixture({
    price: '99', quantity: '0.02', queueTruth: 'ESTIMATED', queueAheadQuantity: '0.01',
  });
  const venueEvents = spotEvents(fixture, {
    bids: [{ price: '99', quantity: '0.01' }],
    asks: [{ price: '100', quantity: '0.1' }],
  }).filter((candidate) => candidate.kind !== 'HTTP_DELIVERY');
  const venueState = runExchangeTwinScenario(scenarioInput({ fixture, events: venueEvents }));
  assert.equal(orderByFixtureId(venueState).venueStatus, 'NEW');
  assert.equal(orderByFixtureId(venueState).filledQuantity, '0');

  const trade = event('TRADE_EVIDENCE', 9, T0 + 21, {
    product: 'SPOT', symbol: fixture.symbol,
    tradeRevision: `spot-trade-through:${'a'.repeat(24)}`,
    price: '99', quantity: '0.03', aggressorSide: 'SELL', feeEvidence: feeEvidence(),
  });
  const filled = orderByFixtureId(reduceExchangeTwinEvent(venueState, trade));
  assert.equal(filled.venueStatus, 'FILLED');
  assert.equal(filled.filledQuantity, '0.02');
  assert.equal(filled.fills[0].liquidityRole, 'MAKER');
});

test('expected revision and every exact request axis fail closed instead of forging Spot readiness', () => {
  const fixture = spotLimitFixture();
  const good = capabilityPayload(fixture);
  const otherRevision = `${good.expectedCapabilityRevision.slice(0, -1)}${good.expectedCapabilityRevision.endsWith('0') ? '1' : '0'}`;
  const vectors = [
    { label: 'expected capability revision', bridge: { expectedCapabilityRevision: otherRevision } },
    { label: 'side', bridge: { request: { side: 'SELL' } } },
    { label: 'TIF', bridge: { request: { timeInForce: 'IOC' } } },
    { label: 'price', bridge: { request: { requestedPrice: '100' } } },
    { label: 'quantity', bridge: { request: { requestedQuantity: '0.02' } } },
    { label: 'instrument revision', bridge: { request: { instrumentRevision: 'instrument-revision-mismatch' }, expectedCapabilityRevision: good.expectedCapabilityRevision } },
    { label: 'notional asset', bridge: { request: { notionalAsset: 'USDC' }, expectedCapabilityRevision: good.expectedCapabilityRevision } },
  ];
  for (const vector of vectors) {
    const state = runSpot(fixture, {}, vector.bridge);
    const order = orderByFixtureId(state);
    assert.equal(order.venueStatus, 'BLOCKED', vector.label);
    assert.equal(order.filledQuantity, '0', vector.label);
    assert.ok(order.blockedReasonCodes.includes('PREFLIGHT_NOT_EXACT'), vector.label);
  }

  const tamperedRegistry = structuredClone(good.registrySnapshot);
  tamperedRegistry.instruments[0].sourceEvidenceRevision = 'tampered-source-evidence-revision';
  const tampered = runSpot(fixture, {}, {
    registrySnapshot: tamperedRegistry,
    expectedCapabilityRevision: good.expectedCapabilityRevision,
  });
  assert.equal(orderByFixtureId(tampered).venueStatus, 'BLOCKED');
  assert.equal(tampered.preflights[0].result.ok, false);
});

test('a successful owner-side grid reduction is still not an exact twin preflight', () => {
  const fixture = spotLimitFixture({ quantity: '0.03' });
  const state = runSpot(fixture, {}, { request: { requestedQuantity: '0.0309' } });
  assert.equal(state.preflights[0].result.ok, true);
  assert.equal(state.preflights[0].result.binding.requestedQuantity, '0.0309');
  assert.equal(state.preflights[0].result.binding.resultQuantity, '0.03');
  const order = orderByFixtureId(state);
  assert.equal(order.venueStatus, 'BLOCKED');
  assert.equal(order.filledQuantity, '0');
  assert.ok(order.blockedReasonCodes.includes('PREFLIGHT_NOT_EXACT'));
});

test('owner validity is exclusive and retained evaluation time must equal venue arrival', () => {
  const fixture = spotLimitFixture();
  const current = capabilityPayload(fixture);
  const validUntilMs = current.registrySnapshot.instruments[0].sourceValidUntilMs;
  const equalityRequest = {
    ...current.sizingRequest,
    evaluatedAtMs: validUntilMs,
  };
  const equality = evaluateExchangeTwinSpotOrderTifPreflight(
    current.registrySnapshot,
    equalityRequest,
    validUntilMs,
  );
  assert.equal(equality.ok, false);
  assert.ok(equality.reasonCodes.includes('SPOT_CAPABILITY_SOURCE_EXPIRED'));

  const earlier = capabilityPayload(fixture, { request: { evaluatedAtMs: T0 + 19 } });
  const events = baselineEvents(fixture).map((candidate) => candidate.kind === 'PREFLIGHT_EVIDENCE'
    ? event('SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE', candidate.sequence, candidate.occurredAtMs, {
      fixtureId: fixture.fixtureId,
      ...earlier,
    }, { sourceSequence: candidate.sourceSequence })
    : candidate);
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture, events })),
    /must equal the supplied twin time/,
  );
});

test('new Spot owner evidence is permutation-stable, checkpointable and rejects rehashed result tampering', () => {
  const fixture = spotLimitFixture();
  const events = spotEvents(fixture);
  const forward = runExchangeTwinScenario(scenarioInput({ fixture, events }));
  const reverse = runExchangeTwinScenario(scenarioInput({ fixture, events: [...events].reverse() }));
  assert.deepEqual(reverse, forward);
  assert.ok(Object.isFrozen(forward));
  assert.ok(Object.isFrozen(forward.preflights));
  assert.ok(Object.isFrozen(forward.preflights[0].result));
  assert.deepEqual(restoreExchangeTwin(checkpointExchangeTwin(forward)), forward);

  const beforeVenueEvents = events.filter((candidate) => ![
    'VENUE_ARRIVAL', 'HTTP_DELIVERY', 'PRIVATE_DELIVERY',
  ].includes(candidate.kind));
  const beforeVenue = runExchangeTwinScenario(scenarioInput({
    fixture,
    events: beforeVenueEvents,
  }));
  const resumed = restoreExchangeTwin(checkpointExchangeTwin(beforeVenue));
  const venue = events.find((candidate) => candidate.kind === 'VENUE_ARRIVAL');
  const afterVenue = reduceExchangeTwinEvent(resumed, venue);
  assert.equal(orderByFixtureId(afterVenue).venueStatus, 'FILLED');

  const forgedPreflight = structuredClone(beforeVenue.preflights[0]);
  forgedPreflight.result.binding.resultNotional = '9';
  const forgedState = rehashState({
    ...beforeVenue,
    preflights: [forgedPreflight],
  });
  const forgedCheckpoint = {
    schema: 'LIVE_EDGE_EXCHANGE_TWIN_CHECKPOINT_V1',
    state: forgedState,
    checkpointRevision: revision('l07checkpoint_', forgedState),
    simulationAuthority: 'SYNTHETIC_FIXTURE',
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  };
  assert.throws(
    () => restoreExchangeTwin(forgedCheckpoint),
    /does not reproduce owner result/,
  );
});

test('new event is closed, content-sensitive and restricted to Spot LIMIT', () => {
  const fixture = spotLimitFixture();
  const events = spotEvents(fixture);
  const preflight = events.find((candidate) => candidate.kind === 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE');
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({
      fixture,
      events: events.map((candidate) => candidate === preflight
        ? { ...candidate, payload: { ...candidate.payload, unexpected: true } }
        : candidate),
    })),
    /must contain exactly|content commitment/i,
  );
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({
      fixture,
      events: events.map((candidate) => candidate === preflight
        ? {
          ...candidate,
          payload: {
            ...candidate.payload,
            expectedCapabilityRevision: `${candidate.payload.expectedCapabilityRevision.slice(0, -1)}0`,
          },
        }
        : candidate),
    })),
    /content commitment/i,
  );

  const usdm = orderFixture();
  const dummy = capabilityPayload(fixture);
  const usdmEvents = baselineEvents(usdm).map((candidate) => candidate.kind === 'PREFLIGHT_EVIDENCE'
    ? event('SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE', candidate.sequence, candidate.occurredAtMs, {
      fixtureId: usdm.fixtureId,
      ...dummy,
    }, { sourceSequence: candidate.sourceSequence })
    : candidate);
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture: usdm, events: usdmEvents })),
    /requires a Spot LIMIT fixture/,
  );

  const market = orderFixture({ product: 'SPOT', orderType: 'MARKET', timeInForce: null, price: null });
  const marketEvents = baselineEvents(market).map((candidate) => candidate.kind === 'PREFLIGHT_EVIDENCE'
    ? event('SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE', candidate.sequence, candidate.occurredAtMs, {
      fixtureId: market.fixtureId,
      ...dummy,
    }, { sourceSequence: candidate.sourceSequence })
    : candidate);
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture: market, events: marketEvents })),
    /requires a Spot LIMIT fixture/,
  );
});

test('legacy scenario hashes stay frozen and equal-time unordered Spot capability/arrival blocks explicitly', () => {
  const legacy = runExchangeTwinScenario(scenarioInput());
  assert.equal(legacy.stateRevision, 'l07state_f2d3630b65278c8d8713bcdd601ed657e74eb196b23cfabdbd10516a5ef0c527');
  assert.equal(legacy.outcomeRevision, 'l07outcome_4910340bcb8698f8eaab9de5ac88d70c0e6608482f233b03cc686efdbaf126c5');
  assert.equal(
    checkpointExchangeTwin(legacy).checkpointRevision,
    'l07checkpoint_a9d06b6ad76ea69558b16a41ee3b5c8250c1a09066d4ad8c3de8a3aaa12f6fc4',
  );

  const fixture = spotLimitFixture();
  const unordered = spotEvents(fixture).map((candidate) => (
    candidate.kind === 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE' || candidate.kind === 'VENUE_ARRIVAL'
      ? event(candidate.kind, candidate.sequence, candidate.occurredAtMs, candidate.payload)
      : candidate
  ));
  const state = runExchangeTwinScenario(scenarioInput({ fixture, events: unordered }));
  const order = orderByFixtureId(state);
  assert.equal(state.orderingTruth, 'AMBIGUOUS');
  assert.equal(order.venueStatus, 'BLOCKED');
  assert.ok(order.blockedReasonCodes.includes('EVENT_ORDER_AMBIGUOUS'));
  assert.equal(order.filledQuantity, '0');
});
