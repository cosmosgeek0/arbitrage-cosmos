import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from '../../../dist/foundation/contracts/index.js';

import {
  checkpointExchangeTwin,
  createExchangeTwinState,
  reduceExchangeTwinEvent,
  restoreExchangeTwin,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  T0,
  baselineEvents,
  event,
  orderFixture,
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

test('event IDs are exact content commitments and replays are idempotent', () => {
  const fixture = orderFixture();
  const status = baselineEvents(fixture)[0];
  const empty = createExchangeTwinState(scenarioInput({ fixture, events: [] }));
  const once = reduceExchangeTwinEvent(empty, status);
  const replayed = reduceExchangeTwinEvent(once, status);
  assert.strictEqual(replayed, once);

  const conflicting = {
    ...status,
    payload: { ...status.payload, status: 'HALT' },
  };
  assert.throws(
    () => reduceExchangeTwinEvent(once, conflicting),
    /content (?:commitment|conflict)/i,
  );
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture, events: [conflicting] })),
    /content commitment/i,
  );
});

test('scenario rejects duplicate IDs or sequences before reduction', () => {
  const fixture = orderFixture();
  const [first, second] = baselineEvents(fixture);
  const firstClone = { ...first, payload: { ...first.payload } };
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture, events: [first, firstClone] })),
    /identity\/sequence is duplicated/,
  );
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({
      fixture,
      events: [first, event(second.kind, first.sequence, second.occurredAtMs, second.payload, {
        sourceSequence: second.sourceSequence,
      })],
    })),
    /identity\/sequence is duplicated/,
  );
});

test('crossed, unsorted, duplicate and overbound book evidence is rejected', () => {
  const fixture = orderFixture();
  for (const [name, bids, asks, pattern] of [
    ['crossed', [{ price: '101', quantity: '1' }], [{ price: '100', quantity: '1' }], /crossed/],
    ['unsorted bids', [{ price: '98', quantity: '1' }, { price: '99', quantity: '1' }], [{ price: '100', quantity: '1' }], /side-correct sorted/],
    ['duplicate ask', [{ price: '98', quantity: '1' }], [{ price: '100', quantity: '1' }, { price: '100.0', quantity: '2' }], /duplicate price/],
  ]) {
    const book = event('BOOK_SNAPSHOT', 1, T0, {
      product: fixture.product,
      symbol: fixture.symbol,
      bookRevision: `book-${name.replaceAll(' ', '-')}:${'1'.repeat(24)}`,
      sourceSequence: 1,
      observedAtMs: T0,
      validUntilMs: T0 + 10_000,
      bids,
      asks,
    }, { sourceSequence: 1 });
    assert.throws(
      () => runExchangeTwinScenario(scenarioInput({ fixture, events: [book] })),
      pattern,
      name,
    );
  }

  const asks = Array.from({ length: 513 }, (_, index) => ({
    price: String(100 + index), quantity: '1',
  }));
  const overbound = event('BOOK_SNAPSHOT', 1, T0, {
    product: fixture.product,
    symbol: fixture.symbol,
    bookRevision: `book-overbound:${'2'.repeat(24)}`,
    sourceSequence: 1,
    observedAtMs: T0,
    validUntilMs: T0 + 10_000,
    bids: [],
    asks,
  }, { sourceSequence: 1 });
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture, events: [overbound] })),
    /book levels are overbound/,
  );
});

test('a gapped delta names book truth unavailable until a fresh snapshot', () => {
  const fixture = orderFixture();
  const snapshotEvent = baselineEvents(fixture)[1];
  const withBook = runExchangeTwinScenario(scenarioInput({ fixture, events: [snapshotEvent] }));
  const gapped = event('BOOK_DELTA', 9, T0 + 2, {
    product: fixture.product,
    symbol: fixture.symbol,
    bookRevision: `book-gapped:${'3'.repeat(24)}`,
    previousBookRevision: 'book-revision:wrong000000000000000000000000',
    sourceSequence: withBook.book.sourceSequence + 2,
    observedAtMs: T0 + 2,
    validUntilMs: T0 + 10_000,
    bidUpdates: [],
    askUpdates: [],
  }, { sourceSequence: withBook.book.sourceSequence + 2 });
  const unavailable = reduceExchangeTwinEvent(withBook, gapped);
  assert.equal(unavailable.book.truth, 'GAPPED');
  assert.deepEqual(unavailable.book.bids, []);
  assert.deepEqual(unavailable.book.asks, []);

  const fresh = event('BOOK_SNAPSHOT', 10, T0 + 3, {
    product: fixture.product,
    symbol: fixture.symbol,
    bookRevision: `book-fresh:${'4'.repeat(24)}`,
    sourceSequence: 500,
    observedAtMs: T0 + 3,
    validUntilMs: T0 + 10_000,
    bids: [{ price: '99', quantity: '1' }],
    asks: [{ price: '100', quantity: '1' }],
  }, { sourceSequence: 500 });
  const restored = reduceExchangeTwinEvent(unavailable, fresh);
  assert.equal(restored.book.truth, 'AVAILABLE');
  assert.equal(restored.book.bookRevision, fresh.payload.bookRevision);

  const historicalReplay = event('BOOK_SNAPSHOT', 11, T0 + 4, {
    ...snapshotEvent.payload,
    sourceSequence: 600,
    observedAtMs: T0 + 4,
  }, { sourceSequence: 600 });
  assert.throws(
    () => reduceExchangeTwinEvent(restored, historicalReplay),
    /replayed|regressed/i,
  );
});

test('ambiguous book evidence remains checkpointable with no false freshness', () => {
  const fixture = orderFixture();
  const status = (sequence, occurredAtMs, suffix) => event('SYMBOL_STATUS', sequence, occurredAtMs, {
    product: fixture.product,
    symbol: fixture.symbol,
    status: 'HALT',
    evidenceRevision: `ambiguous-book-status:${suffix.repeat(24)}`,
    observedAtMs: occurredAtMs,
    validUntilMs: occurredAtMs + 10_000,
  });
  const snapshot = event('BOOK_SNAPSHOT', 2, T0, {
    product: fixture.product,
    symbol: fixture.symbol,
    bookRevision: `ambiguous-book-snapshot:${'b'.repeat(24)}`,
    sourceSequence: 100,
    observedAtMs: T0,
    validUntilMs: T0 + 10_000,
    bids: [{ price: '99', quantity: '0.1' }],
    asks: [{ price: '100', quantity: '0.1' }],
  }, { sourceSequence: 100 });
  const ambiguousSnapshot = runExchangeTwinScenario(scenarioInput({
    fixture,
    events: [status(1, T0, 'a'), snapshot],
  }));
  assert.equal(ambiguousSnapshot.book.truth, 'GAPPED');
  assert.equal(ambiguousSnapshot.book.validUntilMs, null);
  assert.deepEqual(
    restoreExchangeTwin(checkpointExchangeTwin(ambiguousSnapshot)),
    ambiguousSnapshot,
  );

  const deltaAtMs = T0 + 1;
  const delta = event('BOOK_DELTA', 4, deltaAtMs, {
    product: fixture.product,
    symbol: fixture.symbol,
    bookRevision: `ambiguous-book-delta:${'d'.repeat(24)}`,
    previousBookRevision: snapshot.payload.bookRevision,
    sourceSequence: 101,
    observedAtMs: deltaAtMs,
    validUntilMs: deltaAtMs + 10_000,
    bidUpdates: [{ price: '99', quantity: '0.09' }],
    askUpdates: [],
  }, { sourceSequence: 101 });
  const ambiguousDelta = runExchangeTwinScenario(scenarioInput({
    fixture,
    events: [snapshot, status(3, deltaAtMs, 'c'), delta],
  }));
  assert.equal(ambiguousDelta.book.truth, 'GAPPED');
  assert.equal(ambiguousDelta.book.validUntilMs, null);
  assert.deepEqual(
    restoreExchangeTwin(checkpointExchangeTwin(ambiguousDelta)),
    ambiguousDelta,
  );
});

test('hostile graphs fail without invoking accessors or proxy traps', () => {
  const fixture = orderFixture();
  let getterCalls = 0;
  const accessorFixture = { ...fixture };
  Object.defineProperty(accessorFixture, 'quantity', {
    enumerable: true,
    get() { getterCalls += 1; return '1'; },
  });
  assert.throws(
    () => createExchangeTwinState(scenarioInput({ fixture: accessorFixture, events: [] })),
    /enumerable data|accessor/i,
  );
  assert.equal(getterCalls, 0);

  let proxyCalls = 0;
  const proxyFixture = new Proxy(fixture, {
    ownKeys() { proxyCalls += 1; return Reflect.ownKeys(fixture); },
  });
  assert.throws(
    () => createExchangeTwinState(scenarioInput({ fixture: proxyFixture, events: [] })),
    /Proxy|plain data/i,
  );
  assert.equal(proxyCalls, 0);

  const symbolFixture = { ...fixture, [Symbol('secret')]: 'forbidden' };
  assert.throws(
    () => createExchangeTwinState(scenarioInput({ fixture: symbolFixture, events: [] })),
    /symbol keys are forbidden/,
  );

  const inheritedFixture = Object.assign(Object.create({ secret: 'inherited' }), fixture);
  assert.throws(
    () => createExchangeTwinState(scenarioInput({ fixture: inheritedFixture, events: [] })),
    /records must be plain/,
  );

  const sparseEvents = [];
  sparseEvents.length = 2;
  sparseEvents[1] = baselineEvents(fixture)[0];
  assert.throws(
    () => createExchangeTwinState(scenarioInput({ fixture, events: sparseEvents })),
    /sparse, decorated or overbound/,
  );
});

test('unknown and secret-shaped fields cannot enter fixture or event projections', () => {
  const fixture = orderFixture();
  assert.throws(
    () => createExchangeTwinState(scenarioInput({
      fixture: { ...fixture, apiKey: 'not-a-real-key' }, events: [],
    })),
    /must contain exactly|secret-shaped fields are forbidden/,
  );
  const status = baselineEvents(fixture)[0];
  const poisoned = {
    ...status,
    payload: { ...status.payload, authorization: 'Bearer forbidden' },
  };
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture, events: [poisoned] })),
    /must contain exactly/,
  );
});

test('checkpoint and reducer reject tampered state and authority', () => {
  const state = runExchangeTwinScenario(scenarioInput());
  const checkpoint = checkpointExchangeTwin(state);
  assert.throws(
    () => restoreExchangeTwin({
      ...checkpoint,
      state: { ...checkpoint.state, seed: 'tampered-seed-0001' },
    }),
    /checkpoint content mismatch/,
  );
  assert.throws(
    () => restoreExchangeTwin({ ...checkpoint, actionAuthority: 'EXECUTE' }),
    /authority is invalid/,
  );

  const next = event('BOOK_UNAVAILABLE', 99, T0 + 100, {
    product: state.product,
    symbol: state.symbol,
    state: 'UNAVAILABLE',
    evidenceRevision: `book-unavailable:${'5'.repeat(24)}`,
  });
  assert.throws(
    () => reduceExchangeTwinEvent({ ...state, stateRevision: `l07state_${'0'.repeat(64)}` }, next),
    /state revision mismatch/,
  );
  assert.throws(
    () => reduceExchangeTwinEvent({ ...state, actionAuthority: 'EXECUTE' }, next),
    /invalid or authoritative/,
  );

  const forgedState = rehashState({
    ...state,
    orders: [{
      ...state.orders[0],
      fills: [{ ...state.orders[0].fills[0], quantity: '0.02' }],
    }],
  });
  const forgedCheckpoint = {
    ...checkpoint,
    state: forgedState,
    checkpointRevision: revision('l07checkpoint_', forgedState),
  };
  assert.throws(
    () => restoreExchangeTwin(forgedCheckpoint),
    /fill economics|fill sum|quantity conservation/i,
  );

  const overboundFills = Array.from({ length: 1_025 }, (_, index) => ({
    ...state.orders[0].fills[0],
    fillId: `l07fill_${index.toString(16).padStart(64, '0')}`,
  }));
  const overboundState = rehashState({
    ...state,
    orders: [{ ...state.orders[0], fills: overboundFills }],
  });
  assert.throws(
    () => restoreExchangeTwin({
      ...checkpoint,
      state: overboundState,
      checkpointRevision: revision('l07checkpoint_', overboundState),
    }),
    /fills are overbound|fill bound/i,
  );
});

test('one canonical L06 placement identity cannot be cloned into two fixtures', () => {
  const first = orderFixture({ fixtureId: 'fixture-owner-identity-0001' });
  const independent = orderFixture({ fixtureId: 'fixture-owner-identity-0002' });
  const cloned = {
    ...independent,
    l06Snapshot: structuredClone(first.l06Snapshot),
    l06Boundary: structuredClone(first.l06Boundary),
  };
  assert.throws(
    () => createExchangeTwinState({
      ...scenarioInput({ fixture: first, events: [] }),
      fixtures: [first, cloned],
    }),
    /L06 .* identities are duplicated/i,
  );
});

test('exact resource boundaries reject excess fixtures and events', () => {
  const fixtures = Array.from({ length: 33 }, (_, index) => orderFixture({
    fixtureId: `fixture-order-${String(index).padStart(4, '0')}`,
  }));
  assert.throws(
    () => createExchangeTwinState({ ...scenarioInput(), fixtures, events: [] }),
    /fixtures\/events are overbound/,
  );

  const events = Array.from({ length: 2_049 }, (_, index) => event(
    'SYMBOL_STATUS', index + 1, T0 + index,
    {
      product: 'SPOT', symbol: 'BTCUSDT', status: 'TRADING',
      evidenceRevision: `status-${String(index).padStart(4, '0')}:${'4'.repeat(24)}`,
      observedAtMs: T0 + index,
      validUntilMs: T0 + 10_000 + index,
    },
  ));
  assert.throws(
    () => createExchangeTwinState({ ...scenarioInput(), events }),
    /overbound/,
  );
});
