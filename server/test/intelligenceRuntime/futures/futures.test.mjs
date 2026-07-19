import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_LIQUIDATION_SAMPLING,
  FUTURES_STREAMS,
  FUTURES_RUNTIME_HARD_LIMITS,
  FuturesRuntimeAdapter,
  decodeUsdMBookTicker,
  decodeUsdMContractInfo,
  decodeUsdMLiquidationContext,
  decodeUsdMMarkFunding,
  serializeFuturesRuntimeSnapshot,
} from '../../../dist/intelligenceRuntime/futures/index.js';

const EVENT = 1_720_000_000_000;
const RECEIVE = EVENT + 100;

class ManualClock {
  constructor(now = RECEIVE) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
}

function book(overrides = {}) {
  return {
    e: 'bookTicker', E: EVENT, T: EVENT + 10, s: 'BTCUSDT', ps: 'BTCUSDT', st: 1,
    u: '90071992547409935', b: '60000', B: '2', a: '60001', A: '3',
    ...overrides,
  };
}

function mark(overrides = {}) {
  return {
    e: 'markPriceUpdate', E: EVENT, s: 'BTCUSDT', st: 1,
    p: '60010', i: '60005', P: '60007', ap: '60008', r: '0.0001', T: EVENT + 28_800_000,
    ...overrides,
  };
}

function contract(overrides = {}) {
  return {
    e: 'contractInfo', E: EVENT, s: 'BTCUSDT', st: 1,
    ct: 'PERPETUAL', dt: 4_133_404_800_000, ot: 1_666_594_800_000, cs: 'TRADING',
    ...overrides,
  };
}

function liquidation(overrides = {}) {
  return {
    e: 'forceOrder', E: EVENT, ps: 'BTCUSDT', st: 1,
    o: {
      s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '2', p: '59900', ap: '59890',
      X: 'FILLED', l: '1', z: '1.5', T: EVENT + 10,
    },
    ...overrides,
  };
}

const resolver = {
  resolve(identity) {
    const quoteAsset = identity.pair.endsWith('USDT') ? 'USDT' : identity.pair.endsWith('USDC') ? 'USDC' : null;
    if (quoteAsset === null) return null;
    return {
      venue: 'BINANCE', productFamily: 'USD_M_PERPETUAL', symbol: identity.symbol, pair: identity.pair,
      baseAsset: identity.pair.slice(0, -quoteAsset.length), quoteAsset, contractType: 'PERPETUAL',
    };
  },
};

function connectedAdapter(feed, options = {}) {
  const clock = new ManualClock();
  const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: resolver, ...options });
  const generation = adapter.start(feed);
  assert.equal(adapter.connected(feed, generation), true);
  return { adapter, clock, generation };
}

function source(snapshot, adapter, feed) {
  const sourceId = adapter.sourceDefinition(feed).sourceId;
  return snapshot.sources.find((entry) => entry.sourceId === sourceId);
}

test('current Futures stream descriptors use the tiered public and market hosts', () => {
  assert.equal(FUTURES_STREAMS.BOOK_TICKER.url, 'wss://fstream.binance.com/public/ws/!bookTicker');
  assert.equal(FUTURES_STREAMS.MARK_FUNDING.url, 'wss://fstream.binance.com/market/ws/!markPrice@arr@1s');
  assert.equal(FUTURES_STREAMS.CONTRACT_INFO.url, 'wss://fstream.binance.com/market/ws/!contractInfo');
  assert.equal(FUTURES_STREAMS.LIQUIDATION.url, 'wss://fstream.binance.com/market/ws/!forceOrder@arr');
  assert.equal(Object.values(FUTURES_STREAMS).some((entry) => entry.url.includes('fstream.binance.com/ws/')), false);
});

test('every configurable Futures retention, frame, time, and retry knob has a hard ceiling', () => {
  const clock = new ManualClock();
  const cases = [
    ['maximumSymbols', FUTURES_RUNTIME_HARD_LIMITS.maximumSymbols],
    ['maximumLiquidations', FUTURES_RUNTIME_HARD_LIMITS.maximumLiquidations],
    ['maximumRecordsPerMessage', FUTURES_RUNTIME_HARD_LIMITS.maximumRecordsPerMessage],
    ['maximumContractBrackets', FUTURES_RUNTIME_HARD_LIMITS.maximumContractBrackets],
    ['maximumFutureSkewMs', FUTURES_RUNTIME_HARD_LIMITS.maximumFutureSkewMs],
    ['symbolStaleAfterMs', FUTURES_RUNTIME_HARD_LIMITS.symbolStaleAfterMs],
    ['evidenceMaxAgeMs', FUTURES_RUNTIME_HARD_LIMITS.evidenceMaxAgeMs],
    ['retryCeiling', FUTURES_RUNTIME_HARD_LIMITS.retryCeiling],
  ];
  for (const [field, maximum] of cases) {
    assert.throws(
      () => new FuturesRuntimeAdapter(clock, { [field]: maximum + 1 }),
      new RegExp(`${field} exceeds hard maximum`),
    );
  }

  for (const [field, maximum] of [
    ['maximumRecordsPerMessage', FUTURES_RUNTIME_HARD_LIMITS.maximumRecordsPerMessage],
    ['maximumContractBrackets', FUTURES_RUNTIME_HARD_LIMITS.maximumContractBrackets],
    ['maximumFutureSkewMs', FUTURES_RUNTIME_HARD_LIMITS.maximumFutureSkewMs],
  ]) {
    const decoded = decodeUsdMBookTicker(book(), RECEIVE, { [field]: maximum + 1 });
    assert.equal(decoded.observations.length, 0);
    assert.equal(decoded.issues[0].field, field);
  }
});

test('merged all-symbol book payload accepts only numeric st=1 and preserves ps', () => {
  const decoded = decodeUsdMBookTicker([
    book(),
    book({ s: 'BTCUSD_PERP', ps: 'BTCUSD', st: 2 }),
    book({ s: 'ETHUSDT', ps: 'ETHUSDT', st: '1' }),
  ], RECEIVE);
  assert.equal(decoded.observations.length, 1);
  assert.equal(decoded.ignored.length, 1);
  assert.equal(decoded.ignored[0].reason, 'COIN_M_ST2');
  assert.equal(decoded.issues.length, 1);
  assert.equal(decoded.issues[0].field, 'st');
  assert.equal(decoded.observations[0].pair, 'BTCUSDT');
  assert.equal(decoded.observations[0].sourceMarketType, 1);
});

test('current UTF-8 USD-M symbols decode and resolve without losing identity', () => {
  const symbol = '币安人生USDT';
  const payload = book({ s: symbol, ps: symbol });
  const decoded = decodeUsdMBookTicker(payload, RECEIVE);
  assert.equal(decoded.issues.length, 0);
  assert.equal(decoded.observations[0].symbol, symbol);

  const { adapter, generation } = connectedAdapter('BOOK_TICKER');
  const result = adapter.ingest('BOOK_TICKER', generation, payload, RECEIVE);
  assert.equal(result.accepted, 1);
  assert.equal(result.normalized[0].status, 'NORMALIZED');
  assert.equal(
    adapter.snapshot(RECEIVE).symbols.some((entry) => entry.symbol === symbol),
    true,
  );
});

test('book decoder preserves event, transaction, receive, bid/ask, and never invents last', () => {
  const value = decodeUsdMBookTicker(JSON.stringify({ stream: '!bookTicker', data: book() }), RECEIVE).observations[0];
  assert.equal(value.sourceEventTimeMs, EVENT);
  assert.equal(value.sourceTransactionTimeMs, EVENT + 10);
  assert.equal(value.receiveTimeMs, RECEIVE);
  assert.equal(value.bidPrice, 60_000);
  assert.equal(value.askPrice, 60_001);
  assert.equal(value.lastPrice, null);
  assert.equal(value.updateId, '90071992547409935');
  assert.deepEqual(value.rawRecord, book());
});

test('combined envelopes must match the selected feed stream', () => {
  const decoded = decodeUsdMBookTicker({ stream: '!markPrice@arr@1s', data: book() }, RECEIVE);
  assert.equal(decoded.observations.length, 0);
  assert.equal(decoded.issues[0].field, 'stream');
  assert.match(decoded.issues[0].message, /!bookTicker/);
});

test('mark/funding decoder keeps mark, index, next funding, interval, and last roles separate', () => {
  const value = decodeUsdMMarkFunding(mark({ fundingIntervalHours: 8 }), RECEIVE).observations[0];
  assert.equal(value.pair, 'BTCUSDT');
  assert.equal(value.pairAuthority, 'SYMBOL_ONLY_REQUIRES_RESOLUTION');
  assert.equal(Object.hasOwn(value.rawRecord, 'ps'), false, 'current official mark payload does not publish ps');
  assert.equal(value.markPrice, 60_010);
  assert.equal(value.indexPrice, 60_005);
  assert.equal(value.estimatedSettlementPrice, 60_007);
  assert.equal(value.fundingRate, 0.0001);
  assert.equal(value.fundingIntervalHours, 8);
  assert.equal(value.nextFundingTimeMs, EVENT + 28_800_000);
  assert.equal(value.sourceTransactionTimeMs, null, 'mark stream T is next funding time, not transaction time');
  assert.equal(value.lastPrice, null);
});

test('current official symbol-only mark and contract payloads require injected pair confirmation without fabricating ps', () => {
  const decodedMark = decodeUsdMMarkFunding(mark(), RECEIVE);
  const decodedContract = decodeUsdMContractInfo(contract(), RECEIVE);
  assert.equal(decodedMark.issues.length, 0);
  assert.equal(decodedContract.issues.length, 0);
  assert.deepEqual(decodedMark.observations.map((entry) => entry.pairAuthority), ['SYMBOL_ONLY_REQUIRES_RESOLUTION']);
  assert.deepEqual(decodedContract.observations.map((entry) => entry.pairAuthority), ['SYMBOL_ONLY_REQUIRES_RESOLUTION']);
  assert.equal(Object.hasOwn(decodedMark.observations[0].rawRecord, 'ps'), false);
  assert.equal(Object.hasOwn(decodedContract.observations[0].rawRecord, 'ps'), false);

  const unresolved = new FuturesRuntimeAdapter(new ManualClock());
  const unresolvedGeneration = unresolved.start('MARK_FUNDING');
  unresolved.connected('MARK_FUNDING', unresolvedGeneration);
  const rejected = unresolved.ingest('MARK_FUNDING', unresolvedGeneration, mark(), RECEIVE);
  assert.equal(rejected.accepted, 0);
  assert.equal(rejected.invalid, 1);
  assert.ok(rejected.issues.some((entry) => entry.code === 'IDENTITY_CONFLICT'));

  const { adapter, generation } = connectedAdapter('MARK_FUNDING');
  const accepted = adapter.ingest('MARK_FUNDING', generation, mark(), RECEIVE);
  assert.equal(accepted.accepted, 1);
  assert.equal(accepted.normalized.every((entry) => entry.status === 'NORMALIZED'), true);
  assert.equal(adapter.snapshot(RECEIVE).symbols[0].pairAuthority, 'INJECTED_RESOLVER');
});

test('delivery-style partial mark remains useful without manufacturing funding', () => {
  const decoded = decodeUsdMMarkFunding(mark({ r: '', T: 0, P: '0', ap: '0' }), RECEIVE);
  assert.equal(decoded.issues.length, 0);
  assert.equal(decoded.observations.length, 1);
  assert.equal(decoded.observations[0].completeness, 'PARTIAL');
  assert.equal(decoded.observations[0].fundingRate, null);
  assert.equal(decoded.observations[0].nextFundingTimeMs, null);
  assert.ok(decoded.observations[0].missingFields.includes('fundingRate'));
});

test('Futures event time is mandatory and malformed prices are rejected', () => {
  const missingEvent = decodeUsdMBookTicker(book({ E: undefined }), RECEIVE);
  assert.equal(missingEvent.observations.length, 0);
  assert.equal(missingEvent.issues[0].field, 'E');
  const malformed = decodeUsdMMarkFunding(mark({ p: 'NaN' }), RECEIVE);
  assert.equal(malformed.observations.length, 0);
  assert.equal(malformed.issues[0].field, 'p');
});

test('partial merged arrays retain valid members and report invalid members', () => {
  const decoded = decodeUsdMMarkFunding([
    mark(),
    mark({ s: 'ETHUSDT', ps: 'ETHUSDT', p: '-1' }),
    null,
  ], RECEIVE);
  assert.equal(decoded.observations.length, 1);
  assert.equal(decoded.issues.length, 2);
  assert.equal(decoded.complete, false);
});

test('contract info preserves status, identity, dates, and conditional bracket updates', () => {
  const withoutBrackets = decodeUsdMContractInfo(contract(), RECEIVE).observations[0];
  assert.equal(withoutBrackets.contractStatus, 'TRADING');
  assert.equal(withoutBrackets.contractType, 'PERPETUAL');
  assert.equal(withoutBrackets.brackets, null);
  const withBrackets = decodeUsdMContractInfo(contract({
    bks: [{ bs: 2, bnf: 5000, bnc: 25000, mmr: 0.025, cf: 75, mi: 11, ma: 20 }, { bs: 1, bnf: 0, bnc: 5000, mmr: 0.01, cf: 0, mi: 21, ma: 50 }],
  }), RECEIVE).observations[0];
  assert.deepEqual(withBrackets.brackets.map((entry) => entry.bracket), [1, 2]);
  assert.equal(withBrackets.pair, 'BTCUSDT');
});

test('valid non-perpetual USD-M contract info is filtered without a perpetual identity claim', () => {
  const decoded = decodeUsdMContractInfo(contract({
    s: 'BTCUSDT_260925', ps: 'BTCUSDT', ct: 'CURRENT_QUARTER', dt: EVENT + 1_000_000,
  }), RECEIVE);
  assert.equal(decoded.observations.length, 0);
  assert.equal(decoded.issues.length, 0);
  assert.equal(decoded.ignored[0].reason, 'NON_PERPETUAL_USD_M');

  const { adapter, generation } = connectedAdapter('CONTRACT_INFO');
  const result = adapter.ingest('CONTRACT_INFO', generation, contract({
    s: 'BTCUSDT_260925', ps: 'BTCUSDT', ct: 'CURRENT_QUARTER', dt: EVENT + 1_000_000,
  }), RECEIVE);
  assert.equal(result.accepted, 0);
  assert.equal(result.ignored, 1);
  assert.equal(adapter.snapshot().symbols.length, 0);
  assert.equal(source(adapter.snapshot(), adapter, 'CONTRACT_INFO').messageCount, 0);
});

test('record and contract-bracket bounds apply before member normalization with explicit overflow', () => {
  const records = decodeUsdMBookTicker([book(), null, book({ s: 'ETHUSDT', ps: 'ETHUSDT' })], RECEIVE, {
    maximumRecordsPerMessage: 1,
  });
  assert.equal(records.observations.length, 1);
  assert.equal(records.overflow.records, 2);
  assert.equal(records.issues.filter((entry) => entry.code === 'MALFORMED_PAYLOAD').length, 0);
  assert.equal(records.issues[0].code, 'CAPACITY_EXCEEDED');

  const brackets = Array.from({ length: 3 }, (_, index) => ({
    bs: index + 1, bnf: index * 100, bnc: (index + 1) * 100, mmr: 0.01, cf: 0, mi: 1, ma: 10,
  }));
  const boundedBrackets = decodeUsdMContractInfo(contract({ bks: brackets }), RECEIVE, {
    maximumContractBrackets: 2,
  });
  assert.equal(boundedBrackets.observations.length, 0);
  assert.equal(boundedBrackets.overflow.contractBrackets, 1);
  assert.equal(boundedBrackets.issues[0].code, 'CAPACITY_EXCEEDED');
});

test('liquidation context records current latest-per-symbol sampling locally', () => {
  const value = decodeUsdMLiquidationContext(liquidation(), RECEIVE).observations[0];
  assert.equal(CURRENT_LIQUIDATION_SAMPLING.samplingSelection, 'LATEST_PER_SYMBOL');
  assert.equal(value.samplingSelection, 'LATEST_PER_SYMBOL');
  assert.equal(value.sampleWindowMs, 1_000);
  assert.equal(value.completeness, 'SAMPLED');
  assert.equal(value.liquidatedPositionSide, 'LONG');
  assert.equal(value.sourceTransactionTimeMs, EVENT + 10);
  assert.notEqual(value.samplingSelection, 'LARGEST_PER_SYMBOL');
});

test('socket open alone becomes SILENT because only useful st=1 records count', () => {
  const { adapter, clock, generation } = connectedAdapter('MARK_FUNDING');
  const cmOnly = adapter.ingest('MARK_FUNDING', generation, [mark({ s: 'BTCUSD_PERP', ps: 'BTCUSD', st: 2 })], RECEIVE);
  assert.equal(cmOnly.accepted, 0);
  assert.equal(cmOnly.ignored, 1);
  clock.set(RECEIVE + 3_000);
  const snapshot = adapter.snapshot();
  assert.equal(source(snapshot, adapter, 'MARK_FUNDING').observedState, 'SILENT');
});

test('adapter emits correlated foundation evidence without bridge raw reconstruction', () => {
  const clock = new ManualClock();
  const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: resolver });
  const bookGeneration = adapter.start('BOOK_TICKER');
  const markGeneration = adapter.start('MARK_FUNDING');
  adapter.connected('BOOK_TICKER', bookGeneration);
  adapter.connected('MARK_FUNDING', markGeneration);
  const bookResult = adapter.ingest('BOOK_TICKER', bookGeneration, book(), RECEIVE);
  const markResult = adapter.ingest('MARK_FUNDING', markGeneration, mark(), RECEIVE);
  assert.equal(bookResult.normalized.length, 1);
  assert.equal(bookResult.normalized[0].status, 'NORMALIZED');
  assert.equal(bookResult.normalized[0].evidence.kind, 'BOOK_TICKER');
  assert.equal(bookResult.normalized[0].correlationId, bookResult.events[0].correlationId);
  assert.deepEqual(markResult.normalized.map((entry) => entry.evidence?.kind), ['MARK_PRICE', 'FUNDING']);
  assert.ok(markResult.normalized.every((entry) => entry.status === 'NORMALIZED'));
  assert.ok(markResult.normalized.every((entry) => entry.correlationId === markResult.events[0].correlationId));
  assert.deepEqual(markResult.events[0].payload.rawRecord, mark());

  const symbol = adapter.snapshot().symbols[0];
  assert.deepEqual(symbol.prices, {
    bidPrice: 60_000, askPrice: 60_001, lastPrice: null, markPrice: 60_010,
    indexPrice: 60_005, estimatedSettlementPrice: 60_007,
  });
});

test('mark-supplied funding interval stays runtime-local while canonical funding evidence remains valid', () => {
  const { adapter, generation } = connectedAdapter('MARK_FUNDING');
  const result = adapter.ingest('MARK_FUNDING', generation, mark({ fundingIntervalHours: 4 }), RECEIVE);
  assert.equal(result.accepted, 1);
  assert.equal(result.events[0].payload.fundingIntervalHours, 4);
  const funding = result.normalized.find((entry) => entry.evidenceKind === 'FUNDING');
  assert.equal(funding.status, 'NORMALIZED');
  assert.equal(funding.evidence.kind, 'FUNDING');
  assert.equal(funding.evidence.fundingIntervalHours, null);
});

test('stale replay uses authoritative source time for lifecycle, slot, and normalized quality', () => {
  const { adapter, clock, generation } = connectedAdapter('BOOK_TICKER');
  const replayReceiveTime = RECEIVE + 20_000;
  clock.set(replayReceiveTime);
  const result = adapter.ingest('BOOK_TICKER', generation, book(), replayReceiveTime);
  assert.equal(result.accepted, 1);
  assert.equal(result.normalized[0].evidence.truth.freshness.state, 'STALE');
  assert.ok(result.normalized[0].qualityFailures.some((entry) => entry.code === 'STALE_SOURCE'));
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.symbols[0].book.freshness, 'STALE');
  assert.equal(snapshot.symbols[0].book.ageMs, replayReceiveTime - (EVENT + 10));
  assert.equal(source(snapshot, adapter, 'BOOK_TICKER').observedState, 'STALE');
});

test('missing instrument metadata is explicit rather than guessed from symbol text', () => {
  const clock = new ManualClock();
  const adapter = new FuturesRuntimeAdapter(clock);
  const generation = adapter.start('BOOK_TICKER');
  adapter.connected('BOOK_TICKER', generation);
  const result = adapter.ingest('BOOK_TICKER', generation, book(), RECEIVE);
  assert.equal(result.accepted, 1);
  assert.equal(result.normalized[0].status, 'INSTRUMENT_UNAVAILABLE');
  assert.equal(result.normalized[0].evidence, null);
  assert.equal(result.normalized[0].qualityFailures[0].code, 'UNAVAILABLE');
});

test('resolver identities are exact bounded data and malformed seeds cannot make a source live', () => {
  const validSeed = {
    venue: 'BINANCE', productFamily: 'USD_M_PERPETUAL', symbol: 'BTCUSDT', pair: 'BTCUSDT',
    baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL',
  };
  const cases = [
    { ...validSeed, baseAsset: 42 },
    { ...validSeed, quoteAsset: { bad: true } },
    { ...validSeed, apiKey: 'SECRET' },
  ];
  let getterCalls = 0;
  const accessor = { ...validSeed };
  Object.defineProperty(accessor, 'baseAsset', {
    enumerable: true,
    get() { getterCalls += 1; return 'BTC'; },
  });
  cases.push(accessor);
  for (const seed of cases) {
    const clock = new ManualClock();
    const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: { resolve: () => seed } });
    const generation = adapter.start('BOOK_TICKER');
    adapter.connected('BOOK_TICKER', generation);
    const result = adapter.ingest('BOOK_TICKER', generation, book(), RECEIVE);
    assert.equal(result.accepted, 0);
    assert.equal(result.invalid, 1);
    assert.equal(adapter.snapshot().symbols.length, 0);
    assert.equal(source(adapter.snapshot(), adapter, 'BOOK_TICKER').messageCount, 0);
  }
  assert.equal(getterCalls, 0);
});

test('each observation resolves authoritative identity exactly once without resolver TOCTOU', () => {
  let calls = 0;
  const oneShot = {
    resolve(identity) {
      calls += 1;
      if (calls > 1) return null;
      return {
        venue: 'BINANCE', productFamily: 'USD_M_PERPETUAL', symbol: identity.symbol, pair: identity.pair,
        baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL',
      };
    },
  };
  const clock = new ManualClock();
  const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: oneShot });
  const generation = adapter.start('BOOK_TICKER');
  adapter.connected('BOOK_TICKER', generation);
  const result = adapter.ingest('BOOK_TICKER', generation, book(), RECEIVE);
  assert.equal(calls, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.normalized[0].status, 'NORMALIZED');
});

test('resolver callbacks cannot reenter lifecycle or ingest mutations and leave stale generation state', () => {
  const operations = [
    ['start', (adapter) => adapter.start('BOOK_TICKER')],
    ['connected', (adapter, generation) => adapter.connected('BOOK_TICKER', generation, RECEIVE)],
    ['reconnect', (adapter) => adapter.reconnect('BOOK_TICKER')],
    ['stop', (adapter) => adapter.stop('BOOK_TICKER')],
    ['ingest', (adapter, generation) => adapter.ingest('BOOK_TICKER', generation, book(), RECEIVE)],
  ];

  for (const [name, reenter] of operations) {
    const clock = new ManualClock();
    let adapter;
    let generation;
    const reentrantResolver = {
      resolve(identity) {
        reenter(adapter, generation);
        return {
          venue: 'BINANCE', productFamily: 'USD_M_PERPETUAL', symbol: identity.symbol, pair: identity.pair,
          baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL',
        };
      },
    };
    adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: reentrantResolver });
    generation = adapter.start('BOOK_TICKER');
    adapter.connected('BOOK_TICKER', generation);
    let result;
    assert.doesNotThrow(() => {
      result = adapter.ingest('BOOK_TICKER', generation, book(), RECEIVE);
    }, `${name} reentrancy must be contained by the resolver boundary`);
    assert.equal(result.accepted, 0, name);
    assert.equal(result.invalid, 1, name);
    assert.equal(result.issues[0].code, 'IDENTITY_CONFLICT', name);
    const retained = adapter.snapshot();
    const retainedSource = source(retained, adapter, 'BOOK_TICKER');
    assert.equal(retainedSource.connectionGeneration, generation, name);
    assert.equal(retainedSource.desiredState, 'RUNNING', name);
    assert.equal(retainedSource.messageCount, 0, name);
    assert.equal(retained.symbols.length, 0, name);
  }
});

test('first full resolver identity is pinned and later identity drift is rejected before apply', () => {
  const initial = {
    venue: 'BINANCE', productFamily: 'USD_M_PERPETUAL', symbol: 'BTCUSDT', pair: 'BTCUSDT',
    baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL',
  };
  const driftCases = [
    ['baseAsset', { baseAsset: 'ETH' }],
    ['quoteAsset', { quoteAsset: 'USDC' }],
    ['venue', { venue: 'OTHER' }],
    ['productFamily', { productFamily: 'SPOT' }],
    ['contractType', { contractType: null }],
  ];

  for (const [name, drift] of driftCases) {
    const clock = new ManualClock();
    let current = initial;
    const changingResolver = { resolve: () => current };
    const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: changingResolver });
    const generation = adapter.start('BOOK_TICKER');
    adapter.connected('BOOK_TICKER', generation);
    const first = adapter.ingest('BOOK_TICKER', generation, book({ u: '100' }), RECEIVE);
    assert.equal(first.accepted, 1, name);
    assert.equal(first.normalized[0].evidence.instrument.baseAsset, 'BTC', name);
    assert.equal(first.normalized[0].evidence.instrument.quoteAsset, 'USDT', name);
    const pinnedInstrumentId = first.normalized[0].evidence.instrument.instrumentId;

    current = { ...initial, ...drift };
    clock.set(RECEIVE + 1);
    const rejected = adapter.ingest('BOOK_TICKER', generation, book({
      E: EVENT + 1,
      T: EVENT + 11,
      u: '101',
    }), RECEIVE + 1);
    assert.equal(rejected.accepted, 0, name);
    assert.equal(rejected.invalid, 1, name);
    assert.equal(rejected.normalized.length, 0, name);
    assert.equal(rejected.issues[0].code, 'IDENTITY_CONFLICT', name);
    const retained = adapter.snapshot();
    assert.equal(retained.symbols[0].book.observation.updateId, '100', name);
    assert.equal(source(retained, adapter, 'BOOK_TICKER').messageCount, 1, name);

    current = initial;
    clock.set(RECEIVE + 2);
    const recovered = adapter.ingest('BOOK_TICKER', generation, book({
      E: EVENT + 2,
      T: EVENT + 12,
      u: '102',
    }), RECEIVE + 2);
    assert.equal(recovered.accepted, 1, name);
    assert.equal(recovered.normalized[0].evidence.instrument.instrumentId, pinnedInstrumentId, name);
  }
});

test('stale symbol state and reconnect generation are explicit', () => {
  const { adapter, clock, generation } = connectedAdapter('BOOK_TICKER');
  adapter.ingest('BOOK_TICKER', generation, book(), RECEIVE);
  const nextGeneration = adapter.reconnect('BOOK_TICKER');
  assert.equal(adapter.ingest('BOOK_TICKER', generation, book({ u: '90071992547409936' }), RECEIVE).accepted, 0);
  assert.equal(adapter.snapshot().symbols[0].book.freshness, 'PRIOR_GENERATION');
  adapter.connected('BOOK_TICKER', nextGeneration);
  clock.set(RECEIVE + 1);
  adapter.ingest('BOOK_TICKER', nextGeneration, book({ E: EVENT + 1, T: EVENT + 11, u: '90071992547409936' }), RECEIVE + 1);
  assert.equal(adapter.snapshot().symbols[0].book.freshness, 'FRESH');
  clock.set(RECEIVE + 15_001);
  assert.equal(adapter.snapshot().symbols[0].book.freshness, 'STALE');
});

test('retained semantic and source cursors reject reconnect rollback across every Futures feed', () => {
  const clock = new ManualClock();
  const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: resolver });
  const first = adapter.startAll();
  for (const feed of ['BOOK_TICKER', 'MARK_FUNDING', 'CONTRACT_INFO', 'LIQUIDATION']) {
    adapter.connected(feed, first[feed]);
  }
  assert.equal(adapter.ingest('BOOK_TICKER', first.BOOK_TICKER, book({ u: '100' }), RECEIVE).accepted, 1);
  assert.equal(adapter.ingest('MARK_FUNDING', first.MARK_FUNDING, mark(), RECEIVE).accepted, 1);
  assert.equal(adapter.ingest('CONTRACT_INFO', first.CONTRACT_INFO, contract(), RECEIVE).accepted, 1);
  assert.equal(adapter.ingest('LIQUIDATION', first.LIQUIDATION, liquidation(), RECEIVE).accepted, 1);

  clock.set(RECEIVE + 100);
  const second = {
    BOOK_TICKER: adapter.reconnect('BOOK_TICKER'),
    MARK_FUNDING: adapter.reconnect('MARK_FUNDING'),
    CONTRACT_INFO: adapter.reconnect('CONTRACT_INFO'),
    LIQUIDATION: adapter.reconnect('LIQUIDATION'),
  };
  for (const feed of ['BOOK_TICKER', 'MARK_FUNDING', 'CONTRACT_INFO', 'LIQUIDATION']) {
    adapter.connected(feed, second[feed]);
  }
  assert.equal(adapter.ingest('BOOK_TICKER', second.BOOK_TICKER, book({ E: EVENT - 1, T: EVENT + 9, u: '99' }), clock.now).outOfOrder, 1);
  assert.equal(adapter.ingest('MARK_FUNDING', second.MARK_FUNDING, mark({ E: EVENT - 1, p: '59999' }), clock.now).outOfOrder, 1);
  assert.equal(adapter.ingest('CONTRACT_INFO', second.CONTRACT_INFO, contract({ E: EVENT - 1, cs: 'PRE_SETTLE' }), clock.now).outOfOrder, 1);
  assert.equal(adapter.ingest('LIQUIDATION', second.LIQUIDATION, liquidation({
    E: EVENT - 1,
    o: { ...liquidation().o, S: 'BUY', T: EVENT + 9 },
  }), clock.now).outOfOrder, 1);

  const retained = adapter.snapshot();
  assert.equal(retained.symbols[0].book.observation.updateId, '100');
  assert.equal(retained.symbols[0].markFunding.observation.markPrice, 60_010);
  assert.equal(retained.symbols[0].contract.observation.contractStatus, 'TRADING');
  assert.equal(retained.liquidations.length, 1);
  assert.equal(retained.liquidations[0].observation.orderSide, 'SELL');

  clock.set(RECEIVE + 200);
  const successors = [
    adapter.ingest('BOOK_TICKER', second.BOOK_TICKER, book({ E: EVENT + 1, T: EVENT + 11, u: '101' }), clock.now),
    adapter.ingest('MARK_FUNDING', second.MARK_FUNDING, mark({ E: EVENT + 1, p: '60011' }), clock.now),
    adapter.ingest('CONTRACT_INFO', second.CONTRACT_INFO, contract({ E: EVENT + 1, cs: 'PRE_SETTLE' }), clock.now),
    adapter.ingest('LIQUIDATION', second.LIQUIDATION, liquidation({
      E: EVENT + 1,
      o: { ...liquidation().o, S: 'BUY', T: EVENT + 11 },
    }), clock.now),
  ];
  assert.deepEqual(successors.map((result) => result.accepted), [1, 1, 1, 1]);
  const current = adapter.snapshot();
  assert.equal(current.symbols[0].book.observation.updateId, '101');
  assert.equal(current.symbols[0].markFunding.observation.markPrice, 60_011);
  assert.equal(current.symbols[0].contract.observation.contractStatus, 'PRE_SETTLE');
  assert.equal(current.liquidations.at(-1).observation.orderSide, 'BUY');
  assert.equal(successors[0].events[0].sequence.previous, null, 'a new generation never claims delivery continuity');
});

test('regressed receive time is rejected before state or lifecycle mutation', () => {
  const { adapter, clock, generation } = connectedAdapter('BOOK_TICKER');
  const firstReceiveTime = RECEIVE + 100;
  clock.set(firstReceiveTime);
  adapter.ingest('BOOK_TICKER', generation, book({
    E: EVENT + 50, T: EVENT + 60, u: '10',
  }), firstReceiveTime);
  const before = adapter.snapshot();

  clock.set(RECEIVE + 200);
  const regressed = adapter.ingest('BOOK_TICKER', generation, book({
    E: EVENT + 40, T: EVENT + 50, u: '11', s: 'ETHUSDT', ps: 'ETHUSDT', b: '3000', a: '3001',
  }), RECEIVE + 50);
  assert.equal(regressed.accepted, 0);
  assert.equal(regressed.outOfOrder, 1);
  assert.equal(regressed.issues.some((entry) => entry.code === 'RECEIVE_TIME_REGRESSION'), true);

  const after = adapter.snapshot();
  assert.deepEqual(after.symbols.map((entry) => entry.symbol), ['BTCUSDT']);
  assert.equal(after.symbols[0].book.observation.updateId, before.symbols[0].book.observation.updateId);
  assert.equal(after.symbols[0].lastUsefulReceiveTimeMs, before.symbols[0].lastUsefulReceiveTimeMs);
  assert.equal(source(after, adapter, 'BOOK_TICKER').messageCount, 1);
  assert.equal(source(after, adapter, 'BOOK_TICKER').lastMessageReceiveTimeMs, firstReceiveTime);
});

test('duplicates and out-of-order monotonic book cursors never replace state', () => {
  const { adapter, clock, generation } = connectedAdapter('BOOK_TICKER');
  adapter.ingest('BOOK_TICKER', generation, book({ u: '10' }), RECEIVE);
  clock.set(RECEIVE + 100);
  const duplicate = adapter.ingest('BOOK_TICKER', generation, book({ u: '10' }), RECEIVE + 100);
  const older = adapter.ingest('BOOK_TICKER', generation, book({ E: EVENT - 1, T: EVENT + 9, u: '11' }), RECEIVE + 100);
  assert.equal(duplicate.duplicate, 1);
  assert.equal(older.outOfOrder, 1);
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.symbols[0].book.observation.updateId, '10');
  assert.equal(snapshot.symbols[0].lastUsefulReceiveTimeMs, RECEIVE);
  assert.equal(source(snapshot, adapter, 'BOOK_TICKER').messageCount, 1);
  assert.equal(source(snapshot, adapter, 'BOOK_TICKER').lastMessageReceiveTimeMs, RECEIVE);
});

test('adapter reports pre-decode record overflow and retains only the bounded prefix', () => {
  const { adapter, generation } = connectedAdapter('BOOK_TICKER', { maximumRecordsPerMessage: 1 });
  const result = adapter.ingest('BOOK_TICKER', generation, [
    book(),
    book({ s: 'ETHUSDT', ps: 'ETHUSDT', u: '2', b: '3000', a: '3001' }),
    null,
  ], RECEIVE);
  assert.equal(result.accepted, 1);
  assert.equal(result.overflowRecords, 2);
  assert.equal(result.dropped, 2);
  assert.deepEqual(adapter.snapshot().symbols.map((entry) => entry.symbol), ['BTCUSDT']);
});

test('adapter exposes contract bracket overflow without creating symbol state', () => {
  const { adapter, generation } = connectedAdapter('CONTRACT_INFO', { maximumContractBrackets: 1 });
  const result = adapter.ingest('CONTRACT_INFO', generation, contract({
    bks: [
      { bs: 1, bnf: 0, bnc: 100, mmr: 0.01, cf: 0, mi: 1, ma: 10 },
      { bs: 2, bnf: 100, bnc: 200, mmr: 0.02, cf: 1, mi: 1, ma: 5 },
    ],
  }), RECEIVE);
  assert.equal(result.accepted, 0);
  assert.equal(result.overflowContractBrackets, 1);
  assert.equal(result.dropped, 1);
  assert.equal(adapter.snapshot().symbols.length, 0);
});

test('bounded symbol and liquidation retention reports drops deterministically', () => {
  const clock = new ManualClock();
  const adapter = new FuturesRuntimeAdapter(clock, {
    instrumentResolver: resolver, maximumSymbols: 2, maximumLiquidations: 1,
  });
  const bookGeneration = adapter.start('BOOK_TICKER');
  const liquidationGeneration = adapter.start('LIQUIDATION');
  adapter.connected('BOOK_TICKER', bookGeneration);
  adapter.connected('LIQUIDATION', liquidationGeneration);
  adapter.ingest('BOOK_TICKER', bookGeneration, [
    book(),
    book({ s: 'ETHUSDT', ps: 'ETHUSDT', u: '2', b: '3000', a: '3001' }),
  ], RECEIVE);
  const capacity = adapter.ingest('BOOK_TICKER', bookGeneration, book({ s: 'SOLUSDT', ps: 'SOLUSDT', u: '3', b: '100', a: '101' }), RECEIVE);
  assert.equal(capacity.dropped, 1);
  assert.equal(capacity.issues[0].code, 'CAPACITY_EXCEEDED');
  adapter.ingest('LIQUIDATION', liquidationGeneration, liquidation(), RECEIVE);
  adapter.ingest('LIQUIDATION', liquidationGeneration, liquidation({
    E: EVENT + 1,
    o: { ...liquidation().o, S: 'BUY', T: EVENT + 11 },
  }), RECEIVE);
  assert.equal(adapter.snapshot().liquidations.length, 1);
  assert.equal(adapter.snapshot().liquidations[0].observation.orderSide, 'BUY');
});

test('one transport frame advances lifecycle once and uses order-independent maximum accepted source time', () => {
  function run(records) {
    const now = RECEIVE + 10_000;
    const clock = new ManualClock(now);
    const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: resolver });
    const generation = adapter.start('MARK_FUNDING');
    adapter.connected('MARK_FUNDING', generation, now);
    const result = adapter.ingest('MARK_FUNDING', generation, records, now);
    return { result, source: source(adapter.snapshot(now), adapter, 'MARK_FUNDING') };
  }
  const current = mark({ E: RECEIVE + 10_000, s: 'BTCUSDT', p: '60020' });
  const old = mark({ E: EVENT, s: 'ETHUSDT', p: '3000', i: '2999', P: '2999.5', ap: '2999.8' });
  const forward = run([current, old]);
  const reverse = run([old, current]);
  assert.deepEqual([forward.result.accepted, reverse.result.accepted], [2, 2]);
  assert.deepEqual([forward.source.messageCount, reverse.source.messageCount], [1, 1]);
  assert.deepEqual(
    [forward.source.lastMessageSourceTimeMs, reverse.source.lastMessageSourceTimeMs],
    [RECEIVE + 10_000, RECEIVE + 10_000],
  );
  assert.deepEqual([forward.source.observedState, reverse.source.observedState], ['LIVE', 'LIVE']);

  const isolated = run([current, mark({ s: 'ETHUSDT', p: 'NaN' })]);
  assert.equal(isolated.result.accepted, 1);
  assert.equal(isolated.result.invalid, 1);
  assert.equal(isolated.source.messageCount, 1);
  assert.equal(isolated.source.observedState, 'DEGRADED');
});

test('normalization and snapshots are deterministic for repeated injected runs', () => {
  function run() {
    const clock = new ManualClock();
    const adapter = new FuturesRuntimeAdapter(clock, { instrumentResolver: resolver });
    const generations = adapter.startAll();
    adapter.connected('BOOK_TICKER', generations.BOOK_TICKER);
    adapter.connected('MARK_FUNDING', generations.MARK_FUNDING);
    const bookResult = adapter.ingest('BOOK_TICKER', generations.BOOK_TICKER, [book({ s: 'ETHUSDT', ps: 'ETHUSDT', u: '2', b: '3000', a: '3001' }), book()], RECEIVE);
    const markResult = adapter.ingest('MARK_FUNDING', generations.MARK_FUNDING, [mark(), mark({ s: 'ETHUSDT', ps: 'ETHUSDT', p: '3000', i: '2999', P: '2999.5', ap: '2999.8' })], RECEIVE);
    return {
      correlations: [...bookResult.events, ...markResult.events].map((event) => event.correlationId),
      evidenceIds: [...bookResult.normalized, ...markResult.normalized].map((entry) => entry.evidence?.id ?? null),
      snapshot: serializeFuturesRuntimeSnapshot(adapter.snapshot()),
    };
  }
  assert.deepEqual(run(), run());
});
