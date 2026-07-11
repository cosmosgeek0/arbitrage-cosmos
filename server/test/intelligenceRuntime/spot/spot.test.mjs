import test from 'node:test';
import assert from 'node:assert/strict';

import { stableId } from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  SPOT_REDUCER_POLICY_LIMITS,
  SpotBackpressureBuffer,
  SpotBroadReducer,
} from '../../../dist/intelligenceRuntime/spot/index.js';

const T0 = 1_720_000_000_000;

class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
  advance(delta) { this.now += delta; }
}

function instrument(symbol, baseAsset) {
  const seed = {
    venue: 'BINANCE',
    productFamily: 'SPOT',
    symbol,
    pair: symbol,
    baseAsset,
    quoteAsset: 'USDT',
    contractType: null,
    sourceMarketType: null,
  };
  return { instrumentId: stableId('instrument', seed), ...seed };
}

const UNIVERSE = Object.freeze([
  instrument('BTCUSDT', 'BTC'),
  instrument('ETHUSDT', 'ETH'),
  instrument('QUIETUSDT', 'QUIET'),
]);

function ticker(symbol, eventTimeMs, overrides = {}) {
  return {
    e: '24hrMiniTicker', E: eventTimeMs, s: symbol,
    c: '100', o: '80', h: '110', l: '70', v: '1000', q: '100000',
    ...overrides,
  };
}

function book(symbol, updateId, overrides = {}) {
  return { u: String(updateId), s: symbol, b: '99', B: '2', a: '101', A: '3', ...overrides };
}

function trade(symbol, aggregateId, firstId, lastId, transactionTimeMs, overrides = {}) {
  return {
    e: 'aggTrade', E: transactionTimeMs - 10, s: symbol, a: String(aggregateId),
    p: '100.5', q: '0.2', f: String(firstId), l: String(lastId),
    T: transactionTimeMs, m: false, ...overrides,
  };
}

function reducer(clock = new ManualClock(), policy = {}) {
  const value = new SpotBroadReducer({ clock, universe: UNIVERSE, policy });
  value.beginGeneration(1);
  return value;
}

test('full mini-ticker array becomes explicit rolling-24h observations', () => {
  const clock = new ManualClock();
  const value = reducer(clock);
  const raw = UNIVERSE.map((entry, index) => ticker(entry.symbol, T0, {
    c: String(100 + index), h: String(110 + index), q: String(100_000 + index),
  }));
  const result = value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: raw });
  assert.equal(result.state, 'ACCEPTED');
  assert.equal(result.fullUniverseFrame, true);
  assert.equal(result.acceptedRecords, 3);
  assert.equal(result.changedOnlySemantics, true);
  assert.equal(result.observations[0].window, 'ROLLING_24H');
  assert.equal(result.observations[0].quoteVolume24h, 100_000);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].correlationId, result.correlationId);
  assert.equal(result.events[0].payload.id, result.observations[0].id);
  assert.equal(result.events[0].stream, '!miniTicker@arr');
  assert.equal('quoteVolume1s' in result.observations[0], false);
  assert.equal('activity' in result.observations[0], false);
  const snapshot = value.snapshot();
  assert.equal(snapshot.observedState, 'LIVE');
  assert.equal(snapshot.tickerVolumeWindow, 'ROLLING_24H');
  assert.equal(snapshot.symbols.length, 3);
  assert.equal(snapshot.sources[0].completeness, 'COMPLETE');
  assert.deepEqual(snapshot.coverage, {
    state: 'COMPLETE',
    configuredSymbols: 3,
    observedSymbols: 3,
    freshSymbols: 3,
    staleSymbols: 0,
    unseenSymbols: 0,
    established: true,
    establishedAtMs: T0,
    establishedGeneration: 1,
  });
});

test('current UTF-8 Binance Spot symbols remain valid through universe, broad ticker, and bounded focus ingress', () => {
  const clock = new ManualClock();
  const symbol = '币安人生USDT';
  const value = new SpotBroadReducer({ clock, universe: [instrument(symbol, '币安人生')] });
  value.beginGeneration(1);
  const broad = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker(symbol, T0)],
  });
  assert.equal(broad.acceptedRecords, 1);
  assert.equal(value.ingestBookTicker({
    generation: 1,
    receiveTimeMs: T0,
    symbol,
    payload: book(symbol, 1),
  }).state, 'ACCEPTED');
  assert.equal(value.ingestAggTrade({
    generation: 1,
    receiveTimeMs: T0,
    symbol,
    payload: trade(symbol, 1, 1, 1, T0),
  }).state, 'ACCEPTED');
  assert.equal(value.snapshot().symbols[0].instrument.symbol, symbol);
});

test('changed-symbol-only arrays retain dormant universe symbols and prior truth', () => {
  const clock = new ManualClock();
  const value = reducer(clock);
  value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: UNIVERSE.map((entry) => ticker(entry.symbol, T0)),
  });
  clock.advance(1_000);
  const changed = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.now,
    payload: [ticker('BTCUSDT', clock.now, { c: '105' })],
  });
  assert.equal(changed.state, 'ACCEPTED');
  assert.equal(changed.fullUniverseFrame, false);
  const snapshot = value.snapshot();
  assert.equal(snapshot.quietSymbolsRetained, true);
  assert.deepEqual(snapshot.symbols.map((entry) => entry.instrument.symbol), ['BTCUSDT', 'ETHUSDT', 'QUIETUSDT']);
  assert.equal(snapshot.symbols.find((entry) => entry.instrument.symbol === 'QUIETUSDT').ticker24h.lastPrice, 100);
  assert.equal(snapshot.sources[0].completeness, 'COMPLETE');
  assert.equal(snapshot.coverage.state, 'COMPLETE');
});

test('cold changed-only frames warm cumulatively, preserve established quiet coverage, and expose staleness', () => {
  const clock = new ManualClock();
  const universe = [instrument('BTCUSDT', 'BTC'), instrument('ETHUSDT', 'ETH')];
  const value = new SpotBroadReducer({ clock, universe, policy: { tickerMaximumAgeMs: 5 } });
  value.beginGeneration(1);

  const btcOnly = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0)],
  });
  assert.equal(btcOnly.state, 'ACCEPTED');
  assert.equal(btcOnly.fullUniverseFrame, false);
  let snapshot = value.snapshot();
  assert.equal(snapshot.observedState, 'LIVE');
  assert.equal(snapshot.sources[0].completeness, 'PARTIAL');
  assert.deepEqual(snapshot.coverage, {
    state: 'WARMING',
    configuredSymbols: 2,
    observedSymbols: 1,
    freshSymbols: 1,
    staleSymbols: 0,
    unseenSymbols: 1,
    established: false,
    establishedAtMs: null,
    establishedGeneration: null,
  });

  clock.advance(1);
  const ethOnly = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.now,
    payload: [ticker('ETHUSDT', clock.now)],
  });
  assert.equal(ethOnly.fullUniverseFrame, false);
  snapshot = value.snapshot();
  assert.equal(snapshot.sources[0].completeness, 'COMPLETE');
  assert.deepEqual(snapshot.coverage, {
    state: 'COMPLETE',
    configuredSymbols: 2,
    observedSymbols: 2,
    freshSymbols: 2,
    staleSymbols: 0,
    unseenSymbols: 0,
    established: true,
    establishedAtMs: T0 + 1,
    establishedGeneration: 1,
  });

  clock.advance(1);
  value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.now,
    payload: [ticker('BTCUSDT', clock.now, { c: '101' })],
  });
  snapshot = value.snapshot();
  assert.equal(snapshot.sources[0].completeness, 'COMPLETE');
  assert.equal(snapshot.coverage.state, 'COMPLETE');
  assert.equal(snapshot.symbols.find((entry) => entry.instrument.symbol === 'ETHUSDT').ticker24h.connectionGeneration, 1);

  clock.advance(10);
  value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.now,
    payload: [ticker('BTCUSDT', clock.now, { c: '102' })],
  });
  snapshot = value.snapshot();
  assert.equal(snapshot.observedState, 'LIVE');
  assert.equal(snapshot.sources[0].completeness, 'PARTIAL');
  assert.deepEqual(snapshot.coverage, {
    state: 'STALE',
    configuredSymbols: 2,
    observedSymbols: 2,
    freshSymbols: 1,
    staleSymbols: 1,
    unseenSymbols: 0,
    established: true,
    establishedAtMs: T0 + 1,
    establishedGeneration: 1,
  });
});

test('warm reconnect retains established quiet coverage while a cold generation stays partial', () => {
  const universe = [instrument('BTCUSDT', 'BTC'), instrument('ETHUSDT', 'ETH')];
  const warmClock = new ManualClock();
  const warm = new SpotBroadReducer({ clock: warmClock, universe });
  warm.beginGeneration(1);
  warm.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0), ticker('ETHUSDT', T0)],
  });
  warmClock.advance(1);
  warm.beginGeneration(2);
  let snapshot = warm.snapshot();
  assert.equal(snapshot.sources[0].completeness, 'MISSING');
  assert.equal(snapshot.coverage.state, 'COMPLETE');
  warm.ingestMiniTickerFrame({
    generation: 2,
    receiveTimeMs: warmClock.now,
    payload: [ticker('BTCUSDT', warmClock.now, { c: '101' })],
  });
  snapshot = warm.snapshot();
  assert.equal(snapshot.sources[0].completeness, 'COMPLETE');
  assert.equal(snapshot.coverage.state, 'COMPLETE');
  assert.equal(snapshot.coverage.establishedGeneration, 1);
  assert.equal(snapshot.symbols.find((entry) => entry.instrument.symbol === 'ETHUSDT').ticker24h.connectionGeneration, 1);

  const coldClock = new ManualClock();
  const cold = new SpotBroadReducer({ clock: coldClock, universe });
  cold.beginGeneration(1);
  cold.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0)],
  });
  coldClock.advance(1);
  cold.beginGeneration(2);
  cold.ingestMiniTickerFrame({
    generation: 2,
    receiveTimeMs: coldClock.now,
    payload: [ticker('BTCUSDT', coldClock.now, { c: '101' })],
  });
  snapshot = cold.snapshot();
  assert.equal(snapshot.sources[0].completeness, 'PARTIAL');
  assert.deepEqual(snapshot.coverage, {
    state: 'WARMING',
    configuredSymbols: 2,
    observedSymbols: 1,
    freshSymbols: 1,
    staleSymbols: 0,
    unseenSymbols: 1,
    established: false,
    establishedAtMs: null,
    establishedGeneration: null,
  });
});

test('Spot bookTicker has receive-time freshness and no fabricated exchange time', () => {
  const clock = new ManualClock(T0 + 10);
  const value = reducer(clock);
  const result = value.ingestBookTicker({
    generation: 1,
    receiveTimeMs: T0,
    symbol: 'BTCUSDT',
    payload: book('BTCUSDT', 44),
  });
  assert.equal(result.state, 'ACCEPTED');
  assert.equal(result.evidence.truth.temporal.sourceEventTimeMs, null);
  assert.equal(result.evidence.truth.temporal.sourceTransactionTimeMs, null);
  assert.equal(result.evidence.truth.temporal.receivedTimeMs, T0);
  assert.equal(result.evidence.truth.freshness.basis, 'RECEIVE_TIME');

  const missingMiniTime = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('ETHUSDT', T0, { E: undefined })],
  });
  assert.equal(missingMiniTime.state, 'REJECTED');
  assert.equal(missingMiniTime.invalidRecords, 1);
});

test('caller correlation survives source event to normalized evidence without provenance mutation', () => {
  const clock = new ManualClock(T0 + 10);
  const value = reducer(clock);
  const mini = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0)],
    correlationId: 'source.spot.frame.1',
  });
  assert.equal(mini.correlationId, 'source.spot.frame.1');
  assert.equal(mini.observations[0].correlationId, 'source.spot.frame.1');

  const normalized = value.ingestBookTicker({
    generation: 1,
    receiveTimeMs: T0,
    symbol: 'BTCUSDT',
    payload: book('BTCUSDT', 1),
    correlationId: 'source.spot.book.1',
  });
  assert.equal(normalized.correlationId, 'source.spot.book.1');
  assert.match(normalized.evidence.id, /^evidence:/);
  assert.deepEqual(normalized.evidence.truth.provenance.transforms, ['normalize-book-ticker-v1']);
  assert.equal('correlationId' in normalized.evidence.truth.provenance, false);
  assert.throws(() => value.ingestBookTicker({
    generation: 1,
    receiveTimeMs: T0,
    symbol: 'ETHUSDT',
    payload: book('ETHUSDT', 1),
    correlationId: 'bad correlation with spaces',
  }), /correlationId/);
});

test('generated mini-ticker correlations include payload truth, not only timestamp and count', () => {
  const left = reducer(new ManualClock());
  const right = reducer(new ManualClock());
  const leftResult = left.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0, { c: '100' })],
  });
  const rightResult = right.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0, { c: '101' })],
  });
  assert.notEqual(leftResult.correlationId, rightResult.correlationId);
  assert.equal(leftResult.events[0].correlationId, leftResult.correlationId);
  assert.equal(rightResult.events[0].correlationId, rightResult.correlationId);
});

test('mini, book, and trade ingress maintain stable independent Wave 0 source snapshots', () => {
  const clock = new ManualClock(T0 + 100);
  const value = reducer(clock);
  value.ingestMiniTickerFrame({
    generation: 1, receiveTimeMs: clock.now, payload: [ticker('BTCUSDT', clock.now)],
  });
  value.ingestBookTicker({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT', payload: book('BTCUSDT', 1),
  });
  value.ingestAggTrade({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT', payload: trade('BTCUSDT', 1, 1, 1, clock.now),
  });
  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.sources.map((source) => source.sourceId), [
    value.sourceDefinition('MINI_TICKER').sourceId,
    value.sourceDefinition('BOOK_TICKER').sourceId,
    value.sourceDefinition('AGG_TRADE').sourceId,
  ]);
  assert.deepEqual(snapshot.sources.map((source) => source.observedState), ['LIVE', 'LIVE', 'LIVE']);
  assert.deepEqual(snapshot.sources.map((source) => source.messageCount), [1, 1, 1]);
  assert.deepEqual(snapshot.sources.map((source) => source.lastMessageReceiveTimeMs), [clock.now, clock.now, clock.now]);
  assert.deepEqual(snapshot.sources.map((source) => source.lastProcessedTimeMs), [clock.now, clock.now, clock.now]);
  assert.equal(snapshot.observedState, snapshot.sources[0].observedState);
});

test('stale book and aggregate-trade evidence remains visible without making either source live', () => {
  const clock = new ManualClock(T0 + 1_000);
  const value = reducer(clock, { bookMaximumAgeMs: 100, tradeMaximumAgeMs: 100 });
  const staleBook = value.ingestBookTicker({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: book('BTCUSDT', 1),
  });
  const staleTrade = value.ingestAggTrade({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT', payload: trade('BTCUSDT', 1, 1, 1, T0),
  });
  assert.equal(staleBook.state, 'ACCEPTED');
  assert.equal(staleBook.evidence.truth.freshness.state, 'STALE');
  assert.equal(staleTrade.state, 'ACCEPTED');
  assert.equal(staleTrade.evidence.truth.freshness.state, 'STALE');
  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.sources.slice(1).map((source) => source.messageCount), [0, 0]);
  assert.deepEqual(snapshot.sources.slice(1).map((source) => source.observedState), ['DEGRADED', 'DEGRADED']);
  assert.deepEqual(snapshot.sources.slice(1).map((source) => source.invalidCount), [1, 1]);
  assert.equal(snapshot.symbols[0].bookFreshness, 'STALE');
  assert.equal(snapshot.symbols[0].tradeFreshness, 'STALE');
});

test('duplicate and out-of-order ticker updates are counted and cannot replace state', () => {
  const clock = new ManualClock();
  const value = reducer(clock);
  value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0)] });
  const duplicate = value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0)] });
  assert.equal(duplicate.state, 'REJECTED');
  assert.equal(duplicate.duplicateRecords, 1);
  const outOfOrder = value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0 - 1)] });
  assert.equal(outOfOrder.state, 'REJECTED');
  assert.equal(outOfOrder.outOfOrderRecords, 1);
  const snapshot = value.snapshot();
  assert.equal(snapshot.metrics.duplicateCount, 1);
  assert.equal(snapshot.metrics.outOfOrderCount, 1);
  assert.equal(snapshot.symbols[0].ticker24h.sourceEventTimeMs, T0);
});

test('stale one-symbol data stays visible but cannot make the source green', () => {
  const clock = new ManualClock(T0 + 1_000);
  const value = reducer(clock, {
    tickerMaximumAgeMs: 100,
    sourceSilentAfterMs: 100,
    sourceStaleAfterMs: 500,
  });
  const stale = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.now,
    payload: [ticker('BTCUSDT', T0)],
  });
  assert.equal(stale.state, 'PARTIAL');
  assert.equal(stale.staleRecords, 1);
  const snapshot = value.snapshot();
  assert.equal(snapshot.symbols[0].tickerFreshness, 'STALE');
  assert.notEqual(snapshot.observedState, 'LIVE');
  assert.equal(snapshot.metrics.staleInputCount, 1);
});

test('connected source without a useful changed-array message becomes SILENT', () => {
  const clock = new ManualClock();
  const value = reducer(clock, { sourceSilentAfterMs: 50, sourceStaleAfterMs: 100 });
  assert.equal(value.snapshot().observedState, 'WARMING');
  value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [] });
  clock.advance(50);
  assert.equal(value.snapshot().observedState, 'SILENT');
  assert.equal(value.snapshot().lastUsefulReceiveTimeMs, null);
});

test('a formerly live global source becomes STALE when useful frames stop', () => {
  const clock = new ManualClock();
  const value = reducer(clock, { sourceSilentAfterMs: 50, sourceStaleAfterMs: 100 });
  value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0)] });
  assert.equal(value.snapshot().observedState, 'LIVE');
  clock.advance(100);
  assert.equal(value.snapshot().observedState, 'STALE');
});

test('bounded backpressure retains official mini-ticker arrays as atomic non-replaceable frames', () => {
  const buffer = new SpotBackpressureBuffer(2);
  assert.equal(buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0), ticker('ETHUSDT', T0)], correlationId: 'spot.frame.1',
  }).state, 'ACCEPTED');
  assert.equal(buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0 + 1,
    payload: [ticker('BTCUSDT', T0 + 1, { c: '101' })], correlationId: 'spot.frame.2',
  }).state, 'ACCEPTED');
  assert.equal(buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0 + 2,
    payload: [ticker('ETHUSDT', T0 + 2)], correlationId: 'spot.frame.3',
  }).state, 'DROPPED');
  const snapshot = buffer.snapshot();
  assert.deepEqual(snapshot.replaceableKinds, ['BOOK_TICKER']);
  assert.deepEqual(snapshot.nonReplaceableKinds, ['MINI_TICKER', 'AGG_TRADE']);
  assert.equal(snapshot.depth, 2);
  assert.equal(snapshot.coalescedCount, 0);
  assert.equal(snapshot.droppedCount, 1);
  assert.equal(snapshot.miniTickerFrameDropCount, 1);
  assert.equal(snapshot.capacityDropCount, 1);
  assert.equal(snapshot.oversizeDropCount, 0);
  const drained = buffer.drain();
  assert.equal(drained[0].correlationId, 'spot.frame.1');
  assert.equal(drained[0].payload.length, 2);
  assert.equal(drained[1].correlationId, 'spot.frame.2');
});

test('default payload bound admits a realistic official all-market mini-ticker frame above 64 KiB', () => {
  const buffer = new SpotBackpressureBuffer(1);
  const frame = Array.from({ length: 1_000 }, (_, index) => ticker(`S${index}USDT`, T0));
  assert.ok(new TextEncoder().encode(JSON.stringify(frame)).byteLength > 65_536);
  const offered = buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0, payload: frame,
  });
  assert.equal(offered.state, 'ACCEPTED');
  assert.equal(buffer.drain()[0].payload.length, 1_000);
});

test('newer replaceable book state moves to the chronological tail and older replacement is rejected', () => {
  const buffer = new SpotBackpressureBuffer(3);
  assert.equal(buffer.offer({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0,
    payload: book('BTCUSDT', 1), correlationId: 'book.1',
  }).state, 'ACCEPTED');
  assert.equal(buffer.offer({
    kind: 'AGG_TRADE', symbol: 'ETHUSDT', generation: 1, receiveTimeMs: T0 + 1,
    payload: trade('ETHUSDT', 1, 1, 1, T0 + 1), correlationId: 'trade.1',
  }).state, 'ACCEPTED');
  assert.equal(buffer.offer({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0 + 2,
    payload: book('BTCUSDT', 2), correlationId: 'book.2',
  }).state, 'COALESCED');
  const older = buffer.offer({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0 + 1,
    payload: book('BTCUSDT', 3), correlationId: 'book.older',
  });
  assert.deepEqual([older.state, older.reason], ['DROPPED', 'OUT_OF_ORDER_REPLACEMENT']);
  const drained = buffer.drain();
  assert.deepEqual(drained.map((entry) => entry.correlationId), ['trade.1', 'book.2']);
  const snapshot = buffer.snapshot();
  assert.equal(snapshot.coalescedCount, 1);
  assert.equal(snapshot.outOfOrderReplacementDropCount, 1);
  assert.equal(snapshot.droppedCount, 1);
});

test('backpressure rejects oversized or secret-bearing payloads before retention', () => {
  const buffer = new SpotBackpressureBuffer(2, 64);
  const oversized = buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0,
    payload: { e: '24hrMiniTicker', padding: 'x'.repeat(100) },
  });
  assert.deepEqual([oversized.state, oversized.reason], ['DROPPED', 'PAYLOAD_TOO_LARGE']);
  const secret = buffer.offer({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0,
    payload: { apiKey: 'forbidden' },
  });
  assert.deepEqual([secret.state, secret.reason], ['DROPPED', 'INVALID_PAYLOAD']);
  const snapshot = buffer.snapshot();
  assert.equal(snapshot.depth, 0);
  assert.equal(snapshot.oversizeDropCount, 1);
  assert.equal(snapshot.invalidPayloadDropCount, 1);
});

test('backpressure constructor bounds and aggregate retained bytes are explicit and transactional', () => {
  assert.throws(() => new SpotBackpressureBuffer(Number.MAX_SAFE_INTEGER), /capacity exceeds its hard limit/);
  assert.throws(() => new SpotBackpressureBuffer(1, Number.MAX_SAFE_INTEGER), /maximumPayloadBytes exceeds its hard limit/);
  assert.throws(() => new SpotBackpressureBuffer(1, 64, Number.MAX_SAFE_INTEGER), /maximumRetainedPayloadBytes exceeds its hard limit/);

  const firstPayload = { value: 'a'.repeat(10) };
  const secondPayload = { value: 'b'.repeat(10) };
  const replacementPayload = { value: 'c'.repeat(40) };
  const firstBytes = Buffer.byteLength(JSON.stringify(firstPayload));
  const secondBytes = Buffer.byteLength(JSON.stringify(secondPayload));
  const aggregateLimit = firstBytes + secondBytes + 5;
  const buffer = new SpotBackpressureBuffer(3, 128, aggregateLimit);
  assert.equal(buffer.offer({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0,
    payload: firstPayload, correlationId: 'aggregate.book.old',
  }).state, 'ACCEPTED');
  assert.equal(buffer.offer({
    kind: 'AGG_TRADE', symbol: 'ETHUSDT', generation: 1, receiveTimeMs: T0 + 1,
    payload: secondPayload, correlationId: 'aggregate.trade',
  }).state, 'ACCEPTED');
  const replacement = buffer.offer({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0 + 2,
    payload: replacementPayload, correlationId: 'aggregate.book.new',
  });
  assert.deepEqual([replacement.state, replacement.reason], ['DROPPED', 'AGGREGATE_PAYLOAD_BYTES']);
  let snapshot = buffer.snapshot();
  assert.equal(snapshot.maximumRetainedPayloadBytes, aggregateLimit);
  assert.equal(snapshot.retainedPayloadBytes, firstBytes + secondBytes);
  assert.equal(snapshot.highWaterPayloadBytes, firstBytes + secondBytes);
  assert.equal(snapshot.aggregateByteDropCount, 1);
  assert.equal(snapshot.coalescedCount, 0);
  assert.deepEqual(buffer.drain().map((entry) => entry.correlationId), ['aggregate.book.old', 'aggregate.trade']);
  snapshot = buffer.snapshot();
  assert.equal(snapshot.retainedPayloadBytes, 0);
  assert.equal(snapshot.highWaterPayloadBytes, firstBytes + secondBytes);
});

test('backpressure bounded measurement rejects accessors without executing or retaining them', () => {
  let getterCalls = 0;
  const payload = {};
  Object.defineProperty(payload, 'value', {
    enumerable: true,
    get() { getterCalls += 1; return 'forbidden'; },
  });
  const buffer = new SpotBackpressureBuffer(1, 128);
  const result = buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0, payload,
  });
  assert.deepEqual([result.state, result.reason], ['DROPPED', 'INVALID_PAYLOAD']);
  assert.equal(getterCalls, 0);
  assert.equal(buffer.snapshot().retainedPayloadBytes, 0);
});

test('backpressure validates the message envelope without executing accessors', () => {
  let getterCalls = 0;
  const envelope = {
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0,
  };
  Object.defineProperty(envelope, 'payload', {
    enumerable: true,
    get() { getterCalls += 1; return [ticker('BTCUSDT', T0)]; },
  });
  const buffer = new SpotBackpressureBuffer(1);
  assert.throws(() => buffer.offer(envelope), /enumerable data property/);
  assert.equal(getterCalls, 0);
  assert.equal(buffer.snapshot().depth, 0);
  assert.throws(() => buffer.offer({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0, payload: [], extra: true,
  }), /unknown field extra/);
});

test('reducer queue drains independent full mini-ticker frames without nesting or correlation loss', () => {
  const clock = new ManualClock(T0 + 1);
  const value = reducer(clock, { inboundCapacity: 2 });
  value.enqueue({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0, { c: '100' }), ticker('ETHUSDT', T0)], correlationId: 'spot.queue.1',
  });
  value.enqueue({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0 + 1,
    payload: [ticker('BTCUSDT', T0 + 1, { c: '101' })], correlationId: 'spot.queue.2',
  });
  const results = value.drainBuffered();
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((entry) => entry.correlationId), ['spot.queue.1', 'spot.queue.2']);
  assert.deepEqual(results.map((entry) => entry.acceptedRecords), [2, 1]);
  assert.deepEqual(results.flatMap((entry) => entry.events.map((event) => event.correlationId)), [
    'spot.queue.1', 'spot.queue.1', 'spot.queue.2',
  ]);
  const snapshot = value.snapshot();
  assert.equal(snapshot.symbols[0].ticker24h.lastPrice, 101);
  assert.equal(snapshot.backpressure.depth, 0);
  assert.equal(snapshot.backpressure.coalescedCount, 0);
});

test('malformed and unknown entries make an array partial without dropping quiet symbols', () => {
  const value = reducer();
  const result = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [
      ticker('BTCUSDT', T0),
      ticker('ETHUSDT', T0, { q: 'NaN' }),
      ticker('NEWUSDT', T0),
    ],
  });
  assert.equal(result.state, 'PARTIAL');
  assert.equal(result.acceptedRecords, 1);
  assert.equal(result.invalidRecords, 1);
  assert.equal(result.unknownSymbols, 1);
  const snapshot = value.snapshot();
  assert.equal(snapshot.observedState, 'DEGRADED');
  assert.equal(snapshot.symbols.length, 3);
  assert.equal(snapshot.metrics.invalidCount, 1);
  assert.equal(snapshot.metrics.unknownSymbolCount, 1);
});

test('reconnect generation rejects late frames and accepts only the current generation', () => {
  const clock = new ManualClock();
  const value = reducer(clock);
  value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0)] });
  clock.advance(1);
  assert.equal(value.beginGeneration(2), true);
  const old = value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: clock.now, payload: [ticker('BTCUSDT', clock.now)] });
  assert.equal(old.state, 'IGNORED_GENERATION');
  const current = value.ingestMiniTickerFrame({ generation: 2, receiveTimeMs: clock.now, payload: [ticker('BTCUSDT', clock.now)] });
  assert.equal(current.state, 'ACCEPTED');
  const snapshot = value.snapshot();
  assert.equal(snapshot.connectionGeneration, 2);
  assert.equal(snapshot.metrics.reconnectCount, 1);
  assert.equal(snapshot.metrics.oldGenerationCount, 1);
});

test('ignored and stopped generations never inspect source payloads', () => {
  const value = reducer();
  let getterCalls = 0;
  const frame = [];
  Object.defineProperty(frame, '0', {
    enumerable: true,
    get() { getterCalls += 1; return ticker('BTCUSDT', T0); },
  });
  const evidencePayload = {};
  Object.defineProperty(evidencePayload, 'e', {
    enumerable: true,
    get() { getterCalls += 1; return 'aggTrade'; },
  });
  value.stop();
  const queued = value.enqueue({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0, payload: frame,
  });
  const mini = value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: frame });
  const bookResult = value.ingestBookTicker({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: evidencePayload,
  });
  const tradeResult = value.ingestAggTrade({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: evidencePayload,
  });
  assert.deepEqual([mini.state, bookResult.state, tradeResult.state], [
    'IGNORED_GENERATION', 'IGNORED_GENERATION', 'IGNORED_GENERATION',
  ]);
  assert.deepEqual([queued.state, queued.reason], ['DROPPED', 'IGNORED_GENERATION']);
  assert.equal(getterCalls, 0);
  assert.equal(mini.receivedRecords, 0);
});

test('mini-ticker direct ingress reads only a bounded prefix and identifies overflow by count', () => {
  const makeHugeFrame = (overflowValue) => {
    const frame = [ticker('BTCUSDT', T0)];
    Object.defineProperty(frame, '1', {
      enumerable: true,
      get() { overflowValue.calls += 1; return ticker('ETHUSDT', T0); },
    });
    frame.length = 1_000_000_000;
    return frame;
  };
  const leftOverflow = { calls: 0 };
  const rightOverflow = { calls: 0 };
  const left = reducer(new ManualClock(), { maximumFrameRecords: 1, maximumBufferedPayloadBytes: 512 });
  const right = reducer(new ManualClock(), { maximumFrameRecords: 1, maximumBufferedPayloadBytes: 512 });
  const leftResult = left.ingestMiniTickerFrame({
    generation: 1, receiveTimeMs: T0, payload: makeHugeFrame(leftOverflow),
  });
  const rightResult = right.ingestMiniTickerFrame({
    generation: 1, receiveTimeMs: T0, payload: makeHugeFrame(rightOverflow),
  });
  assert.equal(leftResult.state, 'PARTIAL');
  assert.equal(leftResult.receivedRecords, 1_000_000_000);
  assert.equal(leftResult.acceptedRecords, 1);
  assert.equal(leftResult.droppedRecords, 999_999_999);
  assert.equal(leftResult.correlationId, rightResult.correlationId);
  assert.equal(leftOverflow.calls, 0);
  assert.equal(rightOverflow.calls, 0);
  assert.equal(left.snapshot().metrics.frameOverflowDropCount, 999_999_999);
});

test('direct ingress rejects accessor and oversized admitted payloads before normalization', () => {
  let getterCalls = 0;
  const accessorFrame = [];
  Object.defineProperty(accessorFrame, '0', {
    enumerable: true,
    get() { getterCalls += 1; return ticker('BTCUSDT', T0); },
  });
  const frameReducer = reducer(new ManualClock(), {
    maximumFrameRecords: 1,
    maximumBufferedPayloadBytes: 256,
  });
  const accessorResult = frameReducer.ingestMiniTickerFrame({
    generation: 1, receiveTimeMs: T0, payload: accessorFrame,
  });
  assert.equal(accessorResult.state, 'REJECTED');
  assert.equal(getterCalls, 0);
  assert.equal(frameReducer.snapshot().symbols[0].ticker24h, null);

  const oversizedResult = frameReducer.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0, { q: '1'.repeat(1_000) })],
  });
  assert.equal(oversizedResult.state, 'REJECTED');
  assert.match(oversizedResult.failures[0].message, /maximumBytes|maximumBufferedPayloadBytes/);

  const accessorPayload = {};
  Object.defineProperty(accessorPayload, 'e', {
    enumerable: true,
    get() { getterCalls += 1; return 'aggTrade'; },
  });
  const evidenceResult = frameReducer.ingestAggTrade({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: accessorPayload,
  });
  assert.equal(evidenceResult.state, 'REJECTED');
  assert.equal(evidenceResult.failures[0].field, 'payload');
  assert.equal(getterCalls, 0);
  assert.equal(frameReducer.snapshot().symbols[0].recentTrades.length, 0);
});

test('generation progression is exact and rejects huge jumps without work or state mutation', () => {
  const clock = new ManualClock();
  const value = new SpotBroadReducer({ clock, universe: UNIVERSE });
  assert.throws(
    () => value.beginGeneration(Number.MAX_SAFE_INTEGER),
    /advance exactly once/,
  );
  assert.equal(value.snapshot().connectionGeneration, 0);
  assert.deepEqual(value.snapshot().sources.map((source) => source.observedState), ['STOPPED', 'STOPPED', 'STOPPED']);
  assert.equal(value.beginGeneration(1), true);
  value.enqueue({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0)],
  });
  assert.throws(() => value.beginGeneration(3), /advance exactly once/);
  const snapshot = value.snapshot();
  assert.equal(snapshot.connectionGeneration, 1);
  assert.equal(snapshot.backpressure.depth, 1);
  assert.equal(snapshot.backpressure.oldGenerationDropCount, 0);
});

test('reconnect clears and counts queued backlog from older generations before current ingress', () => {
  const clock = new ManualClock();
  const value = reducer(clock, { inboundCapacity: 4 });
  value.enqueue({
    kind: 'MINI_TICKER', generation: 1, receiveTimeMs: T0,
    payload: [ticker('BTCUSDT', T0)], correlationId: 'old.frame',
  });
  value.enqueue({
    kind: 'BOOK_TICKER', symbol: 'BTCUSDT', generation: 1, receiveTimeMs: T0,
    payload: book('BTCUSDT', 1), correlationId: 'old.book',
  });
  clock.advance(1);
  assert.equal(value.beginGeneration(2), true);
  let snapshot = value.snapshot();
  assert.equal(snapshot.backpressure.depth, 0);
  assert.equal(snapshot.backpressure.oldGenerationDropCount, 2);
  assert.equal(snapshot.backpressure.miniTickerFrameDropCount, 1);
  assert.equal(snapshot.metrics.oldGenerationCount, 2);
  assert.deepEqual(snapshot.sources.map((source) => source.droppedCount), [1, 1, 0]);

  value.enqueue({
    kind: 'MINI_TICKER', generation: 2, receiveTimeMs: clock.now,
    payload: [ticker('BTCUSDT', clock.now, { c: '101' })], correlationId: 'current.frame',
  });
  const results = value.drainBuffered();
  assert.equal(results.length, 1);
  assert.equal(results[0].state, 'ACCEPTED');
  assert.equal(results[0].correlationId, 'current.frame');
  snapshot = value.snapshot();
  assert.equal(snapshot.sources[0].connectionGeneration, 2);
  assert.equal(snapshot.sources[0].messageCount, 1);
});

test('aggregate trades use Foundation normalization, bounded retention, and explicit sequence quality', () => {
  const clock = new ManualClock(T0 + 100);
  const value = reducer(clock, { maximumRecentTradesPerSymbol: 2 });
  const first = value.ingestAggTrade({
    generation: 1, receiveTimeMs: T0 + 100, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 1, 1, 1, T0 + 90),
  });
  assert.equal(first.state, 'ACCEPTED');
  assert.deepEqual(first.evidence.truth.temporal, {
    sourceEventTimeMs: T0 + 80,
    sourceTransactionTimeMs: T0 + 90,
    receivedTimeMs: T0 + 100,
    sequence: { first: '1', last: '1', previous: null },
  });

  const duplicate = value.ingestAggTrade({
    generation: 1, receiveTimeMs: T0 + 100, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 1, 1, 1, T0 + 90),
  });
  assert.equal(duplicate.state, 'REJECTED');
  assert.ok(duplicate.failures.some((entry) => entry.code === 'DUPLICATE_EVENT'));

  const gap = value.ingestAggTrade({
    generation: 1, receiveTimeMs: T0 + 100, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 2, 4, 4, T0 + 91),
  });
  assert.equal(gap.state, 'ACCEPTED');
  assert.ok(gap.qualityFailures.some((entry) => entry.code === 'SEQUENCE_GAP'));
  const third = value.ingestAggTrade({
    generation: 1, receiveTimeMs: T0 + 100, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 3, 5, 5, T0 + 92),
  });
  assert.equal(third.state, 'ACCEPTED');
  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.symbols[0].recentTrades.map((entry) => entry.lastTradeId), ['4', '5']);
  assert.equal(snapshot.metrics.sequenceGapCount, 1);
  assert.equal(snapshot.metrics.duplicateCount, 1);
});

test('aggregate trade ID is independently monotonic even when first and last trade IDs advance', () => {
  const clock = new ManualClock(T0 + 100);
  const value = reducer(clock);
  assert.equal(value.ingestAggTrade({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 10, 1, 1, T0 + 90),
  }).state, 'ACCEPTED');
  const repeatedAggregateId = value.ingestAggTrade({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 10, 2, 2, T0 + 91),
  });
  assert.equal(repeatedAggregateId.state, 'REJECTED');
  assert.ok(repeatedAggregateId.failures.some((entry) => entry.code === 'DUPLICATE_EVENT' && entry.field === 'payload.a'));
  const olderAggregateId = value.ingestAggTrade({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 9, 2, 2, T0 + 92),
  });
  assert.equal(olderAggregateId.state, 'REJECTED');
  assert.ok(olderAggregateId.failures.some((entry) => entry.code === 'OUT_OF_ORDER_EVENT' && entry.field === 'payload.a'));
  assert.equal(value.ingestAggTrade({
    generation: 1, receiveTimeMs: clock.now, symbol: 'BTCUSDT',
    payload: trade('BTCUSDT', 11, 2, 2, T0 + 93),
  }).state, 'ACCEPTED');
  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.symbols[0].recentTrades.map((entry) => entry.aggregateTradeId), ['10', '11']);
  assert.equal(snapshot.sources[2].duplicateCount, 1);
  assert.equal(snapshot.sources[2].outOfOrderCount, 1);
});

test('book ticker duplicate and out-of-order cursor failures are counted', () => {
  const clock = new ManualClock(T0 + 10);
  const value = reducer(clock);
  assert.equal(value.ingestBookTicker({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: book('BTCUSDT', 10),
  }).state, 'ACCEPTED');
  const duplicate = value.ingestBookTicker({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: book('BTCUSDT', 10),
  });
  assert.ok(duplicate.failures.some((entry) => entry.code === 'DUPLICATE_EVENT'));
  const older = value.ingestBookTicker({
    generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: book('BTCUSDT', 9),
  });
  assert.ok(older.failures.some((entry) => entry.code === 'OUT_OF_ORDER_EVENT'));
  const snapshot = value.snapshot();
  assert.equal(snapshot.metrics.duplicateCount, 1);
  assert.equal(snapshot.metrics.outOfOrderCount, 1);
});

test('source-wide receive gaps are explicit and frame bounds count overflow', () => {
  const clock = new ManualClock();
  const value = reducer(clock, { sourceGapAfterMs: 50, maximumFrameRecords: 1 });
  value.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: [ticker('BTCUSDT', T0)] });
  clock.advance(100);
  const bounded = value.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: clock.now,
    payload: [ticker('ETHUSDT', clock.now), ticker('QUIETUSDT', clock.now)],
  });
  assert.equal(bounded.state, 'PARTIAL');
  assert.equal(bounded.droppedRecords, 1);
  const snapshot = value.snapshot();
  assert.equal(snapshot.metrics.sourceGapCount, 1);
  assert.equal(snapshot.metrics.sourceGapDurationMs, 100);
  assert.equal(snapshot.metrics.frameOverflowDropCount, 1);
  assert.equal(snapshot.symbols.length, 3);
});

test('identical inputs and injected clocks produce identical normalized snapshots without input mutation', () => {
  const leftClock = new ManualClock();
  const rightClock = new ManualClock();
  const left = reducer(leftClock);
  const right = reducer(rightClock);
  const raw = Object.freeze([
    Object.freeze(ticker('BTCUSDT', T0)),
    Object.freeze(ticker('ETHUSDT', T0)),
  ]);
  left.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: raw });
  right.ingestMiniTickerFrame({ generation: 1, receiveTimeMs: T0, payload: raw });
  const rawBook = Object.freeze(book('BTCUSDT', '90071992547409930'));
  left.ingestBookTicker({ generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: rawBook });
  right.ingestBookTicker({ generation: 1, receiveTimeMs: T0, symbol: 'BTCUSDT', payload: rawBook });
  assert.deepEqual(left.snapshot(), right.snapshot());
  assert.equal(raw[0].c, '100');
  assert.equal(rawBook.b, '99');
});

test('invalid policy and noncanonical universe identities fail before retaining state', () => {
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: UNIVERSE, policy: { maximumFrameRecords: 0 },
  }), /maximumFrameRecords/);
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: [{ ...UNIVERSE[0], instrumentId: 'wrong' }],
  }), /not canonical/);
});

test('policy overrides are exact plain enumerable data without accessor execution', () => {
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: UNIVERSE, policy: { unknownPolicy: 1 },
  }), /unknown field unknownPolicy/);
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: UNIVERSE,
    policy: Object.assign(Object.create({ inherited: true }), { maximumFrameRecords: 1 }),
  }), /plain object/);
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: UNIVERSE,
    policy: { maximumFrameRecords: 1, [Symbol('hidden')]: 2 },
  }), /symbol keys/);
  let getterCalls = 0;
  const accessorPolicy = {};
  Object.defineProperty(accessorPolicy, 'maximumFrameRecords', {
    enumerable: true,
    get() { getterCalls += 1; return 1; },
  });
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: UNIVERSE, policy: accessorPolicy,
  }), /enumerable data property/);
  assert.equal(getterCalls, 0);
});

test('every policy knob has a hard upper bound rather than safe-integer-only allocation', () => {
  for (const [name, maximum] of Object.entries(SPOT_REDUCER_POLICY_LIMITS)) {
    assert.throws(() => new SpotBroadReducer({
      clock: new ManualClock(), universe: UNIVERSE, policy: { [name]: maximum + 1 },
    }), new RegExp(`${name} exceeds its hard limit`));
  }
  assert.throws(() => new SpotBroadReducer({
    clock: new ManualClock(), universe: UNIVERSE, policy: { configurationVersion: 'x'.repeat(129) },
  }), /configurationVersion/);
});
