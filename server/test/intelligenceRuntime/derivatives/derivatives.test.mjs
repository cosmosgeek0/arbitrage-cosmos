import assert from 'node:assert/strict';
import test from 'node:test';

const derivativesModule = await import(process.env.INTELLIGENCE_RUNTIME_SOURCE_TEST === '1'
  ? '../../../src/intelligenceRuntime/derivatives/index.ts'
  : '../../../dist/intelligenceRuntime/derivatives/index.js');
const {
  BinancePublicDerivativesEnricher,
  DERIVATIVES_LIQUIDATION_INPUT_SOURCE_ID,
  DERIVATIVES_SOURCES,
} = derivativesModule;

class ManualClock {
  constructor(now = 1_000) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
  advance(ms) { this.now += ms; }
}

class FakeBudget {
  constructor() {
    this.denied = false;
    this.used = 0;
    this.observations = [];
    this.snapshotCalls = 0;
  }
  reserve(weight, atMs) {
    if (this.denied) {
      return { allowed: false, retryAtMs: atMs + 500, reason: 'COOLDOWN', budget: this.snapshot(atMs) };
    }
    this.used += weight;
    return { allowed: true, retryAtMs: null, reason: 'AVAILABLE', budget: this.snapshot(atMs) };
  }
  observeResponse(input) {
    this.observations.push(input);
    return this.snapshot(input.observedAtMs);
  }
  snapshot(atMs = 1_000) {
    this.snapshotCalls += 1;
    return {
      state: this.denied ? 'COOLDOWN' : 'AVAILABLE',
      usedWeight: this.used,
      limit: 1_000,
      intervalMs: 60_000,
      resetsAtMs: atMs + 60_000,
      retryAfterMs: this.denied ? 500 : null,
      observedAtMs: atMs,
    };
  }
}

class FakeTransport {
  constructor(clock, responder) {
    this.clock = clock;
    this.responder = responder;
    this.requests = [];
  }
  async request(request) {
    this.requests.push(request);
    const response = await this.responder(request, this.requests.length);
    if (response instanceof Error) throw response;
    return {
      status: response.status ?? 200,
      headers: response.headers ?? { 'X-MBX-USED-WEIGHT-1M': String(this.requests.length) },
      body: response.body,
      receiveTimeMs: response.receiveTimeMs ?? this.clock.nowMs(),
    };
  }
}

function querySymbol(request) {
  return request.query.symbol ?? 'BTCUSDT';
}

function completeBody(request, options = {}) {
  const symbol = querySymbol(request);
  const time = options.time ?? 1_000;
  if (request.path === '/fapi/v1/openInterest') {
    return { symbol, openInterest: options.currentOpenInterest ?? '100', time };
  }
  if (request.path === '/futures/data/openInterestHist') {
    return [{
      symbol,
      sumOpenInterest: options.historicalOpenInterest ?? options.currentOpenInterest ?? '100',
      sumOpenInterestValue: '100000',
      CMCCirculatingSupply: '19000000',
      timestamp: String(time),
    }];
  }
  if (request.path === '/fapi/v1/fundingRate') {
    return options.emptyFundingHistory ? [] : [{ symbol, fundingRate: '0.0001', fundingTime: time, markPrice: '50000' }];
  }
  if (request.path === '/fapi/v1/fundingInfo') {
    return options.emptyFundingInfo ? [] : [{
      symbol: 'BTCUSDT',
      adjustedFundingRateCap: '0.025',
      adjustedFundingRateFloor: '-0.025',
      fundingIntervalHours: 8,
      disclaimer: false,
    }];
  }
  if (request.path === '/futures/data/takerlongshortRatio') {
    return [{ buySellRatio: '1.25', buyVol: '125', sellVol: '100', timestamp: String(time) }];
  }
  if (request.path === '/futures/data/globalLongShortAccountRatio') {
    return [{ symbol, longShortRatio: '1.5', longAccount: '0.6', shortAccount: '0.4', timestamp: String(time) }];
  }
  throw new Error(`unexpected path ${request.path}`);
}

function harness(options = {}) {
  const clock = options.clock ?? new ManualClock();
  const budget = options.budget ?? new FakeBudget();
  const responder = options.responder ?? ((request) => ({ body: completeBody(request, options.bodyOptions) }));
  const transport = options.transport ?? new FakeTransport(clock, responder);
  const enricher = new BinancePublicDerivativesEnricher({
    clock,
    rateBudget: budget,
    transport,
    config: options.config,
  });
  return { clock, budget, transport, enricher };
}

function fact(snapshot, symbol, kind) {
  return snapshot.facts.find((entry) => entry.symbol === symbol && entry.kind === kind);
}

function liquidationEvent(symbol = 'BTCUSDT', atMs = 1_000, generation = 1, overrides = {}) {
  const payloadOverrides = overrides.payload ?? {};
  return {
    sourceId: DERIVATIVES_LIQUIDATION_INPUT_SOURCE_ID,
    connectionGeneration: generation,
    productFamily: 'USD_M_PERPETUAL',
    endpointClass: 'MARKET',
    stream: '!forceOrder@arr',
    sourceEventTimeMs: atMs,
    sourceTransactionTimeMs: atMs,
    receiveTimeMs: atMs,
    sequence: null,
    correlationId: `liq-${symbol.toLowerCase()}-${generation}-${atMs}`,
    payload: {
      kind: 'USD_M_LIQUIDATION_CONTEXT',
      symbol,
      pair: symbol,
      sourceMarketType: 1,
      marketSegment: 'USD_M',
      productFamily: 'USD_M_PERPETUAL',
      rawRecord: {},
      sourceEventTimeMs: atMs,
      sourceTransactionTimeMs: atMs,
      receiveTimeMs: atMs,
      completeness: 'SAMPLED',
      missingFields: [],
      orderSide: 'SELL',
      liquidatedPositionSide: 'LONG',
      orderType: 'LIMIT',
      timeInForce: 'IOC',
      orderStatus: 'FILLED',
      originalQuantity: 2,
      lastFilledQuantity: 2,
      accumulatedFilledQuantity: 2,
      limitPrice: 50_000,
      averagePrice: 49_990,
      sampledPerWindow: true,
      samplingSelection: 'LATEST_PER_SYMBOL',
      sampleWindowMs: 1_000,
      ...payloadOverrides,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'payload')),
  };
}

test('refresh planning is bounded, deterministic, costed, and never plans keyed top-trader endpoints', () => {
  const left = harness({ config: { maximumSymbols: 2 } });
  const right = harness({ config: { maximumSymbols: 2 } });
  const symbols = ['ETHUSDT', 'BTCUSDT', 'BTCUSDT', 'XRPUSDT'];
  const a = left.enricher.planRefresh(symbols);
  const b = right.enricher.planRefresh(symbols);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.includedSymbols, ['BTCUSDT', 'ETHUSDT']);
  assert.deepEqual(a.omittedSymbols, ['XRPUSDT']);
  assert.equal(a.tasks.length, 11);
  assert.equal(a.totalLocalBudgetUnits, 11);
  assert.equal(a.tasks.some((task) => task.source.access !== 'PUBLIC_NO_KEY'), false);
  assert.equal(a.tasks.some((task) => task.source.pathOrStream.includes('topLongShort')), false);
  assert.equal(a.tasks.filter((task) => task.kind === 'FUNDING_INFO').length, 1);
});

test('complete public refresh exposes fresh facts, exact metadata, and optional keyed gaps without weakening broad state', async () => {
  const h = harness();
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.equal(report.results.length, 6);
  assert.equal(report.succeededCount, 6);
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(snapshot.state, 'COMPLETE');
  assert.deepEqual(snapshot.coverage, {
    requiredFactCount: 6,
    availableFactCount: 6,
    staleFactCount: 0,
    missingFactCount: 0,
  });
  const current = fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT');
  assert.equal(current.value.openInterest, 100);
  assert.equal(current.sourceTimeMs, 1_000);
  assert.equal(current.receiveTimeMs, 1_000);
  assert.equal(current.ttlMs, 15_000);
  assert.equal(current.availability, 'AVAILABLE');
  assert.equal(current.completeness, 'COMPLETE');
  assert.equal(current.requestCost.officialIpWeight, 1);
  assert.equal(current.requestCost.chargedBudgetUnits, 1);
  assert.equal(current.lastError, null);
  assert.equal(fact(snapshot, 'BTCUSDT', 'FUNDING_INFO').sourceTimeMs, null);
  assert.equal(fact(snapshot, 'BTCUSDT', 'TOP_TRADER_ACCOUNT').availability, 'UNAVAILABLE');
  assert.equal(fact(snapshot, 'BTCUSDT', 'TOP_TRADER_POSITION').value, null);
  assert.equal(fact(snapshot, 'BTCUSDT', 'LIQUIDATION_CONTEXT').availability, 'UNAVAILABLE');
  assert.equal(snapshot.disagreements[0].state, 'AGREE');
  assert.equal(h.transport.requests.some((request) => request.path.includes('topLongShort')), false);
});

test('zero and known-empty public values remain distinct from unknown facts', async () => {
  const h = harness({ bodyOptions: { currentOpenInterest: '0', historicalOpenInterest: '0', emptyFundingHistory: true, emptyFundingInfo: true } });
  await h.enricher.refresh(['BTCUSDT']);
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT').value.openInterest, 0);
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_HISTORY').value.rows[0].openInterest, 0);
  assert.deepEqual(fact(snapshot, 'BTCUSDT', 'FUNDING_HISTORY').value.rows, []);
  assert.equal(fact(snapshot, 'BTCUSDT', 'FUNDING_INFO').value.adjusted, false);
  assert.equal(fact(snapshot, 'BTCUSDT', 'TOP_TRADER_ACCOUNT').value, null);
  assert.equal(snapshot.disagreements[0].state, 'AGREE');
});

test('rate-budget denial performs no transport work and produces explicit rate-limited facts', async () => {
  const budget = new FakeBudget();
  budget.denied = true;
  const h = harness({ budget });
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.equal(report.rateLimitedCount, 6);
  assert.equal(report.attemptedCount, 0);
  assert.equal(h.transport.requests.length, 0);
  const current = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT');
  assert.equal(current.availability, 'RATE_LIMITED');
  assert.equal(current.value, null);
  assert.equal(current.requestCost.chargedBudgetUnits, 0);
  assert.equal(current.lastError.code, 'RATE_BUDGET_BLOCKED');
});

test('HTTP 429 is charged, observed by the budget port, and isolated to its fact', async () => {
  const h = harness({
    responder: (request) => request.path === '/fapi/v1/openInterest'
      ? { status: 429, headers: { 'Retry-After': '1' }, body: { code: -1003 } }
      : { body: completeBody(request) },
  });
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.equal(report.rateLimitedCount, 1);
  assert.equal(h.budget.observations.some((entry) => entry.status === 429), true);
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT').availability, 'RATE_LIMITED');
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT').requestCost.chargedBudgetUnits, 1);
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_HISTORY').availability, 'AVAILABLE');
  assert.equal(snapshot.state, 'PARTIAL');
});

test('public 403 is access-blocked rather than API-key-required while static top-trader gaps stay explicit', async () => {
  const h = harness({
    responder: (request) => request.path === '/fapi/v1/openInterest'
      ? { status: 403, body: { code: -2015, msg: 'rejected' } }
      : { body: completeBody(request) },
  });
  await h.enricher.refresh(['BTCUSDT']);
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(snapshot.state, 'PARTIAL');
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT').availability, 'UNAVAILABLE');
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT').lastError.code, 'ACCESS_BLOCKED');
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_HISTORY').availability, 'AVAILABLE');
  assert.equal(fact(snapshot, 'BTCUSDT', 'TOP_TRADER_ACCOUNT').lastError.code, 'API_KEY_REQUIRED');
  assert.equal(h.transport.requests.filter((request) => request.path.includes('topLongShort')).length, 0);
});

test('one optional symbol failure produces partial coverage without killing successful symbols', async () => {
  const h = harness({
    responder: (request) => request.path === '/fapi/v1/openInterest' && request.query.symbol === 'ETHUSDT'
      ? { status: 500, body: {} }
      : { body: completeBody(request) },
  });
  await h.enricher.refresh(['ETHUSDT', 'BTCUSDT']);
  const snapshot = h.enricher.snapshot(['ETHUSDT', 'BTCUSDT']);
  assert.equal(snapshot.state, 'PARTIAL');
  assert.equal(fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT').availability, 'AVAILABLE');
  assert.equal(fact(snapshot, 'ETHUSDT', 'OPEN_INTEREST_CURRENT').availability, 'UNAVAILABLE');
  assert.equal(snapshot.coverage.missingFactCount, 1);
});

test('valid rows survive malformed siblings as a partial fact with a bounded error', async () => {
  const h = harness({
    responder: (request) => request.path === '/futures/data/openInterestHist'
      ? { body: [
        { symbol: 'BTCUSDT', sumOpenInterest: '90', sumOpenInterestValue: '90000', timestamp: '1000' },
        { symbol: 'BTCUSDT', sumOpenInterest: 'not-a-number', sumOpenInterestValue: '1', timestamp: '1001' },
      ] }
      : { body: completeBody(request) },
  });
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.equal(report.partialCount, 1);
  const history = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_HISTORY');
  assert.equal(history.availability, 'AVAILABLE');
  assert.equal(history.completeness, 'PARTIAL');
  assert.equal(history.value.rows.length, 1);
  assert.equal(history.lastError.code, 'INVALID_RESPONSE');
});

test('available partial facts become refresh-eligible at the earlier TTL boundary', async () => {
  const h = harness({
    config: { failureRetryMs: 5_000, ttlMs: { OPEN_INTEREST_HISTORY: 100 } },
    responder: (request) => request.path === '/futures/data/openInterestHist'
      ? { body: [
        { symbol: 'BTCUSDT', sumOpenInterest: '90', sumOpenInterestValue: '90000', timestamp: '1000' },
        { symbol: 'BTCUSDT', sumOpenInterest: 'bad', sumOpenInterestValue: '1', timestamp: '1001' },
      ] }
      : { body: completeBody(request) },
  });
  await h.enricher.refresh(['BTCUSDT']);
  const history = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_HISTORY');
  assert.equal(history.availability, 'AVAILABLE');
  assert.equal(history.completeness, 'PARTIAL');
  assert.equal(history.expiresAtMs, 1_100);
  h.clock.set(1_099);
  assert.equal(h.enricher.planRefresh(['BTCUSDT'], 1_099).tasks.some((task) => task.kind === 'OPEN_INTEREST_HISTORY'), false);
  h.clock.set(1_100);
  assert.equal(h.enricher.planRefresh(['BTCUSDT'], 1_100).tasks.some((task) => task.kind === 'OPEN_INTEREST_HISTORY'), true);
});

test('expired cache stays stale with its last value when a refresh fails', async () => {
  let fail = false;
  const h = harness({
    config: { ttlMs: {
      OPEN_INTEREST_CURRENT: 100,
      OPEN_INTEREST_HISTORY: 100,
      FUNDING_HISTORY: 100,
      FUNDING_INFO: 100,
      TAKER_BUY_SELL: 100,
      GLOBAL_LONG_SHORT: 100,
      LIQUIDATION_CONTEXT: 100,
    } },
    responder: (request) => fail ? new Error('offline') : { body: completeBody(request) },
  });
  await h.enricher.refresh(['BTCUSDT']);
  h.clock.set(1_100);
  assert.equal(fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT').availability, 'STALE');
  fail = true;
  await h.enricher.refresh(['BTCUSDT']);
  const current = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT');
  assert.equal(current.availability, 'STALE');
  assert.equal(current.value.openInterest, 100);
  assert.equal(current.lastError.code, 'TRANSPORT_UNAVAILABLE');
  assert.equal(h.enricher.snapshot(['BTCUSDT']).state, 'PARTIAL');
});

test('a newer receipt cannot replace a retained fact with regressed source time', async () => {
  let sourceTime = 1_000;
  const h = harness({
    config: { ttlMs: { OPEN_INTEREST_CURRENT: 100 } },
    responder: (request) => ({ body: completeBody(request, { time: sourceTime }) }),
  });
  await h.enricher.refresh(['BTCUSDT']);
  h.clock.set(1_100);
  sourceTime = 900;
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.equal(report.failedCount, 1);
  const current = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT');
  assert.equal(current.sourceTimeMs, 1_000);
  assert.equal(current.value.openInterest, 100);
  assert.equal(current.availability, 'STALE');
  assert.equal(current.lastError.code, 'TIMESTAMP_SKEW');
});

test('fresh source disagreement is surfaced without substituting either open-interest value', async () => {
  const h = harness({ bodyOptions: { currentOpenInterest: '100', historicalOpenInterest: '50' } });
  await h.enricher.refresh(['BTCUSDT']);
  const disagreement = h.enricher.snapshot(['BTCUSDT']).disagreements[0];
  assert.equal(disagreement.state, 'DISAGREE');
  assert.equal(disagreement.currentValue, 100);
  assert.equal(disagreement.historicalValue, 50);
  assert.equal(disagreement.relativeDifference, 0.5);
});

test('liquidation context accepts only current sampled public stream input and expires by TTL', () => {
  const h = harness({ config: { ttlMs: { LIQUIDATION_CONTEXT: 100 } } });
  const event = liquidationEvent();
  const accepted = h.enricher.ingestLiquidation(event);
  assert.equal(accepted.accepted, true);
  let liquidation = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'LIQUIDATION_CONTEXT');
  assert.equal(liquidation.availability, 'AVAILABLE');
  assert.equal(liquidation.completeness, 'SAMPLED');
  assert.equal(liquidation.value.samplingSelection, 'LATEST_PER_SYMBOL');
  assert.equal(liquidation.requestCost.chargedBudgetUnits, 0);
  const older = h.enricher.ingestLiquidation({ ...event, correlationId: 'liq-old' });
  assert.equal(older.reason, 'OUT_OF_ORDER');
  h.clock.set(1_100);
  liquidation = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'LIQUIDATION_CONTEXT');
  assert.equal(liquidation.availability, 'STALE');
});

test('source-time freshness prevents old REST observations from arriving green while fundingInfo alone uses receive time', async () => {
  const clock = new ManualClock(10_000);
  const h = harness({
    clock,
    config: { ttlMs: { OPEN_INTEREST_CURRENT: 100, FUNDING_INFO: 100 } },
    responder: (request) => ({ body: completeBody(request, { time: 1_000 }), receiveTimeMs: clock.nowMs() }),
  });
  const report = await h.enricher.refresh(['BTCUSDT']);
  assert.ok(report.partialCount >= 1);
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  const current = fact(snapshot, 'BTCUSDT', 'OPEN_INTEREST_CURRENT');
  assert.equal(current.sourceTimeMs, 1_000);
  assert.equal(current.receiveTimeMs, 10_000);
  assert.equal(current.expiresAtMs, 1_100);
  assert.equal(current.availability, 'STALE');
  assert.equal(current.lastError.code, 'STALE_SOURCE');
  assert.ok(current.reasonCodes.includes('SOURCE_TIME_STALE'));
  h.clock.set(14_999);
  assert.equal(h.enricher.planRefresh(['BTCUSDT'], 14_999).tasks.some((task) => task.kind === 'OPEN_INTEREST_CURRENT'), false);
  h.clock.set(15_000);
  assert.equal(h.enricher.planRefresh(['BTCUSDT'], 15_000).tasks.some((task) => task.kind === 'OPEN_INTEREST_CURRENT'), true);
  const fundingInfo = fact(snapshot, 'BTCUSDT', 'FUNDING_INFO');
  assert.equal(fundingInfo.sourceTimeMs, null);
  assert.equal(fundingInfo.expiresAtMs, 10_100);
  assert.equal(fundingInfo.availability, 'AVAILABLE');
});

test('a source-time-invalid retained value cannot be upgraded to stale by a later transport failure', async () => {
  let fail = false;
  const h = harness({
    responder: (request) => {
      if (request.path === '/fapi/v1/fundingRate') {
        return fail ? new Error('offline') : { body: [] };
      }
      return { body: completeBody(request) };
    },
  });
  await h.enricher.refresh(['BTCUSDT']);
  let funding = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'FUNDING_HISTORY');
  assert.equal(funding.availability, 'INVALID');
  assert.deepEqual(funding.value.rows, []);
  assert.ok(funding.reasonCodes.includes('SOURCE_TIME_UNAVAILABLE'));

  fail = true;
  h.clock.advance(5_000);
  await h.enricher.refresh(['BTCUSDT']);
  funding = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'FUNDING_HISTORY');
  assert.equal(funding.availability, 'INVALID');
  assert.deepEqual(funding.value.rows, []);
  assert.ok(funding.reasonCodes.includes('SOURCE_TIME_UNAVAILABLE'));
  assert.ok(funding.reasonCodes.includes('TRANSPORT_UNAVAILABLE'));
});

test('per-kind cache partitions prevent liquidation churn from evicting retained REST truth', async () => {
  const h = harness({ config: { maximumSymbols: 2 } });
  await h.enricher.refresh(['BTCUSDT', 'ETHUSDT']);
  assert.equal(fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT').availability, 'AVAILABLE');
  for (const [offset, symbol] of [['1', 'AAAUSDT'], ['2', 'BBBUSDT'], ['3', 'CCCUSDT']]) {
    h.clock.set(1_000 + Number(offset));
    assert.equal(h.enricher.ingestLiquidation(liquidationEvent(symbol, h.clock.nowMs())).accepted, true);
  }
  assert.equal(fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT').availability, 'AVAILABLE');
  assert.equal(fact(h.enricher.snapshot(['AAAUSDT']), 'AAAUSDT', 'LIQUIDATION_CONTEXT').availability, 'UNAVAILABLE');
  assert.equal(fact(h.enricher.snapshot(['CCCUSDT']), 'CCCUSDT', 'LIQUIDATION_CONTEXT').availability, 'AVAILABLE');
});

test('same-timestamp partition rollover preserves newly written facts and the shared-cost owner', async () => {
  const h = harness({ config: { maximumSymbols: 2 } });
  await h.enricher.refresh(['YYYUSDT', 'ZZZUSDT']);
  await h.enricher.refresh(['AAAUSDT', 'BBBUSDT']);
  const snapshot = h.enricher.snapshot(['AAAUSDT', 'BBBUSDT']);
  for (const symbol of ['AAAUSDT', 'BBBUSDT']) {
    for (const kind of [
      'OPEN_INTEREST_CURRENT', 'OPEN_INTEREST_HISTORY', 'FUNDING_HISTORY',
      'FUNDING_INFO', 'TAKER_BUY_SELL', 'GLOBAL_LONG_SHORT',
    ]) {
      assert.equal(fact(snapshot, symbol, kind).availability, 'AVAILABLE', `${symbol}:${kind}`);
    }
  }
  const fundingInfo = snapshot.facts.filter((entry) => entry.kind === 'FUNDING_INFO');
  assert.equal(fundingInfo.reduce((sum, entry) => sum + entry.requestCost.chargedBudgetUnits, 0), 1);
  assert.equal(fact(snapshot, 'AAAUSDT', 'FUNDING_INFO').requestCost.chargedBudgetUnits, 1);
});

test('liquidation reattribution requires the official source, current generation, and exact sampled semantics', () => {
  const h = harness();
  assert.equal(h.enricher.ingestLiquidation({ ...liquidationEvent(), sourceId: 'runtime-source:forged' }).reason, 'INVALID_SOURCE');
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('BTCUSDT', 1_000, 1, {
    payload: { samplingSelection: 'LARGEST_PER_SYMBOL' },
  })).reason, 'INVALID_SOURCE');
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('BTCUSDT', 1_000, 1, {
    payload: { completeness: 'COMPLETE' },
  })).reason, 'INVALID_SOURCE');
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('BTCUSDT', 1_000, 1, {
    payload: { orderSide: 'BUY', liquidatedPositionSide: 'LONG' },
  })).reason, 'INVALID_SOURCE');
  const missingEventTime = liquidationEvent();
  missingEventTime.sourceEventTimeMs = null;
  missingEventTime.payload.sourceEventTimeMs = null;
  assert.equal(h.enricher.ingestLiquidation(missingEventTime).reason, 'INVALID_TIME');

  h.clock.set(1_001);
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('BTCUSDT', 1_001, 2)).reason, 'ACCEPTED');
  h.clock.set(1_002);
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('ETHUSDT', 1_002, 1)).reason, 'PRIOR_GENERATION');
});

test('generation advance explicitly stales every retained prior-generation liquidation fact', () => {
  const h = harness();
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('BTCUSDT', 1_000, 1)).reason, 'ACCEPTED');
  assert.equal(fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'LIQUIDATION_CONTEXT').availability, 'AVAILABLE');
  h.clock.set(1_001);
  assert.equal(h.enricher.ingestLiquidation(liquidationEvent('ETHUSDT', 1_001, 2)).reason, 'ACCEPTED');
  const btc = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'LIQUIDATION_CONTEXT');
  assert.equal(btc.availability, 'STALE');
  assert.equal(btc.lastError.code, 'PRIOR_GENERATION');
  assert.ok(btc.reasonCodes.includes('PRIOR_GENERATION'));
  assert.equal(fact(h.enricher.snapshot(['ETHUSDT']), 'ETHUSDT', 'LIQUIDATION_CONTEXT').availability, 'AVAILABLE');
});

test('fundingInfo shared request charges one deterministic fact on success and failure', async () => {
  const symbols = ['XRPUSDT', 'ETHUSDT', 'BTCUSDT'];
  const success = harness();
  await success.enricher.refresh(symbols);
  const successFacts = success.enricher.snapshot(symbols).facts.filter((entry) => entry.kind === 'FUNDING_INFO');
  assert.equal(successFacts.reduce((sum, entry) => sum + entry.requestCost.chargedBudgetUnits, 0), 1);
  assert.equal(successFacts.find((entry) => entry.symbol === 'BTCUSDT').requestCost.chargedBudgetUnits, 1);
  assert.ok(successFacts.every((entry) => entry.reasonCodes.includes('SHARED_BATCH_REQUEST')));
  assert.equal(success.transport.requests.filter((request) => request.path === '/fapi/v1/fundingInfo').length, 1);

  const failed = harness({
    responder: (request) => request.path === '/fapi/v1/fundingInfo'
      ? { status: 500, body: {} }
      : { body: completeBody(request) },
  });
  await failed.enricher.refresh(symbols);
  const failedFacts = failed.enricher.snapshot(symbols).facts.filter((entry) => entry.kind === 'FUNDING_INFO');
  assert.equal(failedFacts.reduce((sum, entry) => sum + entry.requestCost.chargedBudgetUnits, 0), 1);
  assert.equal(failedFacts.find((entry) => entry.symbol === 'BTCUSDT').requestCost.chargedBudgetUnits, 1);
  assert.ok(failedFacts.every((entry) => entry.reasonCodes.includes('SHARED_BATCH_REQUEST')));
});

test('source catalog records current public URLs, costs, access, and the keyed gaps', () => {
  assert.equal(DERIVATIVES_SOURCES.OPEN_INTEREST_CURRENT.endpoint, 'https://fapi.binance.com/fapi/v1/openInterest');
  assert.equal(DERIVATIVES_SOURCES.OPEN_INTEREST_HISTORY.officialIpWeight, 0);
  assert.match(DERIVATIVES_SOURCES.FUNDING_HISTORY.sharedLimit, /500 requests/);
  assert.equal(DERIVATIVES_SOURCES.GLOBAL_LONG_SHORT.access, 'PUBLIC_NO_KEY');
  assert.equal(DERIVATIVES_SOURCES.TOP_TRADER_ACCOUNT.access, 'API_KEY_REQUIRED');
  assert.equal(DERIVATIVES_SOURCES.TOP_TRADER_POSITION.access, 'API_KEY_REQUIRED');
  assert.equal(DERIVATIVES_SOURCES.LIQUIDATION_CONTEXT.pathOrStream, '!forceOrder@arr');
  assert.match(DERIVATIVES_SOURCES.LIQUIDATION_CONTEXT.documentationUrl, /api\/ws-streams\/market#all-market-liquidation-order-streams$/);
  assert.match(DERIVATIVES_SOURCES.LIQUIDATION_CONTEXT.notes.join(' '), /latest liquidation per symbol per 1000ms/i);
});

test('requested symbol output is bounded before materialization while preserving deterministic omissions', () => {
  const h = harness({ config: { maximumSymbols: 2 } });
  assert.deepEqual(h.enricher.planRefresh(['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT']).omittedSymbols,
    ['CCCUSDT', 'DDDUSDT']);
  assert.throws(
    () => h.enricher.planRefresh(['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'EEEUSDT']),
    /bounded request limit/,
  );
  let getterCalls = 0;
  const hostile = new Array(5);
  Object.defineProperty(hostile, 0, { enumerable: true, get() { getterCalls += 1; return 'AAAUSDT'; } });
  assert.throws(() => h.enricher.planRefresh(hostile), /bounded request limit/);
  assert.equal(getterCalls, 0);
});

test('plans and snapshots reject future, backdated, and regressed injected time before budget observation', async () => {
  const h = harness();
  await h.enricher.refresh(['BTCUSDT']);
  h.clock.set(1_100);
  const current = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(current.snapshotTimeMs, 1_100);
  const before = JSON.stringify(current);
  const budgetCalls = h.budget.snapshotCalls;
  assert.throws(() => h.enricher.snapshot(['BTCUSDT'], 1_099), /before retained runtime knowledge/);
  assert.throws(() => h.enricher.planRefresh(['BTCUSDT'], 1_101), /after the injected clock/);
  assert.equal(h.budget.snapshotCalls, budgetCalls);
  assert.equal(JSON.stringify(h.enricher.snapshot(['BTCUSDT'])), before);
  h.clock.set(1_099);
  assert.throws(() => h.enricher.snapshot(['BTCUSDT']), /clock cannot regress/);
});

test('rate-budget output is exact, bounded, and cannot leak injected extra fields', () => {
  const budget = new FakeBudget();
  budget.snapshot = (atMs = 1_000) => ({
    state: 'AVAILABLE', usedWeight: 0, limit: 1_000, intervalMs: 60_000,
    resetsAtMs: atMs + 60_000, retryAfterMs: null, observedAtMs: atMs,
    secret: 'must-not-escape',
  });
  const h = harness({ budget });
  const snapshot = h.enricher.snapshot(['BTCUSDT']);
  assert.equal(Object.hasOwn(snapshot.budget, 'secret'), false);
  assert.deepEqual(Object.keys(snapshot.budget).sort(), [
    'intervalMs', 'limit', 'observedAtMs', 'resetsAtMs', 'retryAfterMs', 'state', 'usedWeight',
  ]);
});

test('default plan and snapshot calls tolerate a legitimately advancing injected clock', () => {
  const clock = { now: 1_000, nowMs() { const value = this.now; this.now += 1; return value; } };
  const h = harness({ clock });
  assert.equal(h.enricher.planRefresh(['BTCUSDT']).plannedAtMs, 1_000);
  assert.equal(h.enricher.snapshot(['BTCUSDT']).snapshotTimeMs, 1_001);
});

test('current Unicode Binance market symbols remain valid in public derivatives planning', () => {
  const h = harness();
  const plan = h.enricher.planRefresh(['1000PEPEUSDT', '币USDT']);
  assert.deepEqual(plan.includedSymbols, ['1000PEPEUSDT', '币USDT']);
});

test('response headers are data-only and bounded by count, aggregate, name, and value before budget observation', async () => {
  let getterCalls = 0;
  const accessorHeaders = { 'X-MBX-USED-WEIGHT-1M': '1' };
  Object.defineProperty(accessorHeaders, 'X-HOSTILE', {
    enumerable: true,
    get() { getterCalls += 1; return 'must-not-run'; },
  });
  const tooManyHeaders = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`X-H-${index}`, '1']));
  const oversizedAggregate = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`X-LARGE-${index}`, 'x'.repeat(7_000)]));
  const oversizedName = { [`X-${'N'.repeat(127)}`]: '1' };
  const oversizedValue = { 'X-LARGE': 'x'.repeat(8_193) };

  for (const [label, headers] of [
    ['accessor', accessorHeaders],
    ['count', tooManyHeaders],
    ['aggregate', oversizedAggregate],
    ['name', oversizedName],
    ['value', oversizedValue],
  ]) {
    const h = harness({
      responder: (request) => request.path === '/fapi/v1/openInterest'
        ? { headers, body: completeBody(request) }
        : { body: completeBody(request) },
    });
    const report = await h.enricher.refresh(['BTCUSDT']);
    assert.equal(report.results.find((entry) => entry.kind === 'OPEN_INTEREST_CURRENT').status, 'FAILED', label);
    assert.equal(h.budget.observations.length, 5, label);
    assert.equal(fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT').lastError.code,
      'INVALID_RESPONSE', label);
  }
  assert.equal(getterCalls, 0);
});

test('response body accessors and oversized JSON fail closed before parsing or budget observation', async () => {
  let nestedGetterCalls = 0;
  const nestedAccessorBody = { symbol: 'BTCUSDT', openInterest: '100', time: 1_000 };
  Object.defineProperty(nestedAccessorBody, 'ignoredPadding', {
    enumerable: true,
    get() { nestedGetterCalls += 1; return 'must-not-run'; },
  });
  const oversizedBody = {
    symbol: 'BTCUSDT', openInterest: '100', time: 1_000, ignoredPadding: 'x'.repeat(2_000),
  };
  for (const [label, body] of [['nested accessor', nestedAccessorBody], ['oversized JSON', oversizedBody]]) {
    const h = harness({
      config: { maximumResponseBytes: 1_024 },
      responder: (request) => request.path === '/fapi/v1/openInterest'
        ? { body }
        : { body: completeBody(request) },
    });
    const report = await h.enricher.refresh(['BTCUSDT']);
    assert.equal(report.results.find((entry) => entry.kind === 'OPEN_INTEREST_CURRENT').status, 'FAILED', label);
    assert.equal(h.budget.observations.length, 5, label);
    assert.equal(fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT').lastError.code,
      'INVALID_RESPONSE', label);
  }
  assert.equal(nestedGetterCalls, 0);

  let envelopeGetterCalls = 0;
  const direct = harness({
    transport: {
      async request() {
        const response = {
          status: 200,
          headers: { 'X-MBX-USED-WEIGHT-1M': '1' },
          receiveTimeMs: 1_000,
        };
        Object.defineProperty(response, 'body', {
          enumerable: true,
          get() { envelopeGetterCalls += 1; return {}; },
        });
        return response;
      },
    },
  });
  const directReport = await direct.enricher.refresh(['BTCUSDT']);
  assert.equal(directReport.failedCount, 6);
  assert.equal(direct.budget.observations.length, 0);
  assert.equal(envelopeGetterCalls, 0);
});

test('request completion time controls fact evaluation, TTL state, and task outcome', async () => {
  const clock = new ManualClock(100);
  const h = harness({
    clock,
    config: { ttlMs: { OPEN_INTEREST_CURRENT: 100 } },
    responder: (request) => {
      if (request.path === '/fapi/v1/openInterest') {
        const body = completeBody(request, { time: 100 });
        clock.set(201);
        return { body, receiveTimeMs: 100 };
      }
      return { body: completeBody(request, { time: clock.nowMs() }), receiveTimeMs: clock.nowMs() };
    },
  });
  const report = await h.enricher.refresh(['BTCUSDT']);
  const result = report.results.find((entry) => entry.kind === 'OPEN_INTEREST_CURRENT');
  const current = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'OPEN_INTEREST_CURRENT');
  assert.equal(report.completedAtMs, 201);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(current.receiveTimeMs, 100);
  assert.equal(current.evaluatedAtMs, 201);
  assert.equal(current.expiresAtMs, 200);
  assert.equal(current.availability, 'STALE');
  assert.equal(current.lastError.code, 'STALE_SOURCE');
  assert.equal(h.budget.observations[0].observedAtMs, 201);
});

test('completion after the receive-time TTL keeps funding-info from reporting current success', async () => {
  const clock = new ManualClock(100);
  const h = harness({
    clock,
    config: { ttlMs: { FUNDING_INFO: 100 } },
    responder: (request) => {
      if (request.path === '/fapi/v1/fundingInfo') {
        const body = completeBody(request, { time: 100 });
        clock.set(201);
        return { body, receiveTimeMs: 100 };
      }
      return { body: completeBody(request, { time: clock.nowMs() }), receiveTimeMs: clock.nowMs() };
    },
  });
  const report = await h.enricher.refresh(['BTCUSDT']);
  const result = report.results.find((entry) => entry.kind === 'FUNDING_INFO');
  const fundingInfo = fact(h.enricher.snapshot(['BTCUSDT']), 'BTCUSDT', 'FUNDING_INFO');
  assert.equal(result.status, 'PARTIAL');
  assert.equal(fundingInfo.receiveTimeMs, 100);
  assert.equal(fundingInfo.evaluatedAtMs, 201);
  assert.equal(fundingInfo.expiresAtMs, 200);
  assert.equal(fundingInfo.availability, 'STALE');
  assert.equal(fundingInfo.lastError.code, 'STALE_SOURCE');
});

test('ports.config and nested ttlMs reject unknown, symbol, and accessor fields without executing getters', () => {
  const base = harness();
  const ports = { clock: base.clock, rateBudget: base.budget, transport: base.transport };
  assert.throws(
    () => new BinancePublicDerivativesEnricher({ ...ports, config: { unknown: true } }),
    /unknown field unknown/,
  );
  assert.throws(
    () => new BinancePublicDerivativesEnricher({
      ...ports,
      config: { [Symbol('hidden')]: 1 },
    }),
    /symbol fields/,
  );
  assert.throws(
    () => new BinancePublicDerivativesEnricher({
      ...ports,
      config: { ttlMs: { UNKNOWN_KIND: 100 } },
    }),
    /unknown field UNKNOWN_KIND/,
  );

  let configGetterCalls = 0;
  const accessorPorts = { ...ports };
  Object.defineProperty(accessorPorts, 'config', {
    enumerable: true,
    get() { configGetterCalls += 1; return {}; },
  });
  assert.throws(() => new BinancePublicDerivativesEnricher(accessorPorts), /ports.config must be a data property/);
  assert.equal(configGetterCalls, 0);

  let ttlGetterCalls = 0;
  const ttlMs = {};
  Object.defineProperty(ttlMs, 'OPEN_INTEREST_CURRENT', {
    enumerable: true,
    get() { ttlGetterCalls += 1; return 100; },
  });
  assert.throws(
    () => new BinancePublicDerivativesEnricher({ ...ports, config: { ttlMs } }),
    /must be an enumerable data property/,
  );
  assert.equal(ttlGetterCalls, 0);
});
