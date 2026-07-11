import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NodePublicRestTransport,
  PUBLIC_SMOKE_MANUAL_COMMAND,
  PublicNoKeySmokeHarness,
  isAllowedPublicSmokeWebSocketUrl,
} from '../../../dist/intelligenceRuntime/smoke/index.js';

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  advance(delta) { this.now += delta; }
}

class CollectReporter {
  constructor() { this.entries = []; }
  report(entry) { this.entries.push(structuredClone(entry)); }
}

function spotFilters() {
  return [
    { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
    { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '100000', stepSize: '0.00001' },
    { filterType: 'NOTIONAL', minNotional: '5', applyMinToMarket: true, maxNotional: '10000000', applyMaxToMarket: false, avgPriceMins: 5 },
  ];
}

function futuresFilters() {
  return [
    { filterType: 'PRICE_FILTER', minPrice: '0.1', maxPrice: '1000000', tickSize: '0.1' },
    { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
    { filterType: 'MIN_NOTIONAL', notional: '5' },
  ];
}

function spotExchangeInfo() {
  return {
    timezone: 'UTC',
    serverTime: T0,
    rateLimits: [],
    exchangeFilters: [],
    symbols: [{
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      baseAssetPrecision: 8,
      quoteAsset: 'USDT',
      quotePrecision: 8,
      quoteAssetPrecision: 8,
      baseCommissionPrecision: 8,
      quoteCommissionPrecision: 8,
      orderTypes: ['LIMIT', 'MARKET'],
      isSpotTradingAllowed: true,
      isMarginTradingAllowed: false,
      permissionSets: [['SPOT']],
      filters: spotFilters(),
    }],
  };
}

function futuresExchangeInfo() {
  return {
    timezone: 'UTC',
    serverTime: T0,
    rateLimits: [],
    exchangeFilters: [],
    symbols: [{
      symbol: 'BTCUSDT',
      pair: 'BTCUSDT',
      contractType: 'PERPETUAL',
      deliveryDate: 4_133_404_800_000,
      onboardDate: T0 - 365 * 24 * 60 * 60_000,
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marginAsset: 'USDT',
      pricePrecision: 2,
      quantityPrecision: 3,
      baseAssetPrecision: 8,
      quotePrecision: 8,
      underlyingType: 'COIN',
      underlyingSubType: ['Layer-1'],
      orderTypes: ['LIMIT', 'MARKET'],
      timeInForce: ['GTC', 'IOC'],
      filters: futuresFilters(),
    }],
  };
}

class FixtureRest {
  constructor(clock, blocked = false) {
    this.clock = clock;
    this.blocked = blocked;
    this.calls = [];
  }
  async request(request) {
    this.calls.push(structuredClone(request));
    if (this.blocked) return { status: 451, headers: {}, body: { code: 451 }, receiveTimeMs: this.clock.nowMs() };
    return {
      status: 200,
      headers: {},
      body: request.path === '/api/v3/exchangeInfo' ? spotExchangeInfo() : futuresExchangeInfo(),
      receiveTimeMs: this.clock.nowMs(),
    };
  }
}

class FixtureWebSockets {
  constructor(clock, blocked = false) {
    this.clock = clock;
    this.blocked = blocked;
    this.requests = [];
    this.closeCount = 0;
    this.garbage = false;
    this.garbageDepth = false;
    this.earlyRequiredError = false;
  }
  connect(request) {
    const record = { request, closed: false };
    this.requests.push(record);
    return {
      send() { throw new Error('send forbidden'); },
      close: () => {
        if (record.closed) return;
        record.closed = true;
        this.closeCount += 1;
        request.onEvent({ kind: 'CLOSE', receiveTimeMs: this.clock.nowMs(), code: 1000, reason: 'fixture close' });
      },
    };
  }
  emitObservationWindow() {
    for (const { request } of this.requests) {
      request.onEvent({ kind: 'OPEN', receiveTimeMs: this.clock.nowMs() });
      if (this.blocked) {
        request.onEvent({ kind: 'ERROR', receiveTimeMs: this.clock.nowMs(), code: 'HTTP_451', message: 'geolocation restricted' });
        continue;
      }
      if (this.garbage) {
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: request.url.includes('/stream?streams=')
            ? { stream: 'btcusdt@depth@100ms', data: { garbage: true } }
            : { garbage: true },
        });
        continue;
      }
      const eventTime = this.clock.nowMs() - 10;
      if (request.url.includes('/ws/!miniTicker@arr')) {
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: [{ e: '24hrMiniTicker', E: eventTime, s: 'BTCUSDT', c: '60000', o: '59000', h: '61000', l: '58000', v: '1000', q: '60000000' }],
        });
        if (this.earlyRequiredError) {
          request.onEvent({ kind: 'ERROR', receiveTimeMs: this.clock.nowMs(), code: 'NETWORK_ERROR', message: 'fixture source failed after one accepted message' });
        }
      } else if (request.url.includes('/public/ws/!bookTicker')) {
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: { e: 'bookTicker', E: eventTime, T: eventTime + 1, s: 'BTCUSDT', ps: 'BTCUSDT', st: 1, u: '90071992547409935', b: '60000', B: '2', a: '60001', A: '3' },
        });
      } else if (request.url.includes('/market/ws/!markPrice@arr@1s')) {
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: [{ e: 'markPriceUpdate', E: eventTime, s: 'BTCUSDT', ps: 'BTCUSDT', st: 1, p: '60010', i: '60005', P: '60007', ap: '60008', r: '0.0001', T: eventTime + 28_800_000 }],
        });
      } else if (request.url.includes('/stream?streams=')) {
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: { stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', E: eventTime, s: 'BTCUSDT', a: '1', p: '60000', q: '0.1', f: '1', l: '1', T: eventTime + 1, m: false } },
        });
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: { stream: 'btcusdt@bookTicker', data: { u: '1', s: 'BTCUSDT', b: '60000', B: '2', a: '60001', A: '3' } },
        });
        request.onEvent({
          kind: 'MESSAGE',
          receiveTimeMs: this.clock.nowMs(),
          data: this.garbageDepth
            ? { stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', E: eventTime, s: 'BTCUSDT', U: 1, u: 1, b: 'garbage', a: [] } }
            : { stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', E: eventTime, s: 'BTCUSDT', U: 1, u: 1, b: [['60000', '1']], a: [] } },
        });
      }
    }
  }
}

class ScriptedWait {
  constructor(clock, sockets) {
    this.clock = clock;
    this.sockets = sockets;
    this.calls = [];
  }
  async wait(delayMs) {
    this.calls.push(delayMs);
    if (this.calls.length === 1) this.sockets.emitObservationWindow();
    this.clock.advance(delayMs);
  }
}

function fixture(blocked = false, config = {}) {
  const clock = new ManualClock();
  const sockets = new FixtureWebSockets(clock, blocked);
  const reporter = new CollectReporter();
  const harness = new PublicNoKeySmokeHarness({
    clock,
    wait: new ScriptedWait(clock, sockets),
    reporter,
    restTransport: new FixtureRest(clock, blocked),
    webSocketTransport: sockets,
    config: { defaultDurationMs: 1_000, maximumDurationMs: 5_000, shutdownGraceMs: 100, ...config },
  });
  return { harness, clock, sockets, reporter };
}

test('deterministic keyless smoke proves public universe, broad/focus messages, normalization, health, and shutdown', async () => {
  const f = fixture();
  const result = await f.harness.run({ durationMs: 1_000, focusSymbol: 'BTCUSDT' });
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.manualOnly, true);
  assert.equal(result.credentialsUsed, false);
  assert.equal(result.privateEndpointsUsed, false);
  assert.equal(result.moneyActionAuthority, 'NONE');
  assert.equal(result.universe.state, 'COMPLETE');
  assert.equal(result.universe.focusSymbolPresent, true);
  assert.equal(result.sources.filter((source) => source.required && source.acceptedMessageCount > 0).length, 3);
  assert.ok(result.sources.find((source) => source.key === 'SPOT_FOCUS').acceptedMessageCount >= 3);
  assert.ok(result.normalizedEvidenceCount >= 4);
  assert.ok(result.runtimeSnapshot);
  assert.equal(result.runtimeSnapshot.mutationAuthority, 'NONE');
  assert.equal(result.steps.find((step) => step.step === 'message_age').state, 'PASS');
  assert.equal(result.steps.find((step) => step.step === 'focused_trade_or_depth').state, 'PASS');
  assert.equal(result.shutdown.allConnectionsClosed, true);
  assert.equal(result.shutdown.closeRequests, 4);
  assert.equal(f.sockets.closeCount, 4);
  assert.equal(Object.isFrozen(result), true);
});

test('HTTP 451 and geolocation-restricted sockets are an honest BLOCKED result, not fake green or test failure', async () => {
  const f = fixture(true);
  const result = await f.harness.run({ durationMs: 1_000, focusSymbol: 'BTCUSDT' });
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.universe.blocked, true);
  assert.equal(result.universe.nodeCount, 0);
  assert.ok(result.steps.some((step) => step.state === 'BLOCKED'));
  assert.equal(result.normalizedEvidenceCount, 0);
  assert.equal(result.credentialsUsed, false);
  assert.equal(result.shutdown.allConnectionsClosed, true);
});

test('opened transports that do not acknowledge close make shutdown and the final outcome fail honestly', async () => {
  const clock = new ManualClock();
  const sockets = new FixtureWebSockets(clock, false);
  const originalConnect = sockets.connect.bind(sockets);
  sockets.connect = (request) => {
    const connection = originalConnect(request);
    return { ...connection, close() { sockets.closeCount += 1; } };
  };
  const harness = new PublicNoKeySmokeHarness({
    clock,
    wait: new ScriptedWait(clock, sockets),
    reporter: new CollectReporter(),
    restTransport: new FixtureRest(clock),
    webSocketTransport: sockets,
    config: { defaultDurationMs: 1_000, maximumDurationMs: 5_000, shutdownGraceMs: 100 },
  });
  const result = await harness.run({ durationMs: 1_000 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.shutdown.allConnectionsClosed, false);
  assert.equal(result.steps.find((step) => step.step === 'clean_shutdown').state, 'FAIL');
});

test('raw garbage receipts never become accepted/live required-source health or a green runtime result', async () => {
  const f = fixture();
  f.sockets.garbage = true;
  const result = await f.harness.run({ durationMs: 1_000 });
  const required = result.sources.filter((source) => source.required);
  assert.equal(required.every((source) => source.receivedMessageCount === 1), true);
  assert.equal(required.every((source) => source.acceptedMessageCount === 0), true);
  assert.equal(required.every((source) => source.droppedMessageCount === 1), true);
  assert.notEqual(result.outcome, 'PASS');
  assert.notEqual(result.steps.find((step) => step.step === 'final_runtime_health').state, 'PASS');
  assert.equal(result.normalizedEvidenceCount, 0);
});

test('focused depth suffix alone cannot satisfy readiness without official shape and cursor semantics', async () => {
  const f = fixture();
  f.sockets.garbageDepth = true;
  const result = await f.harness.run({ durationMs: 1_000 });
  const focus = result.sources.find((source) => source.key === 'SPOT_FOCUS');
  assert.equal(focus.receivedMessageCount, 3);
  assert.equal(focus.acceptedMessageCount, 2);
  assert.equal(focus.droppedMessageCount, 1);
  assert.equal(result.runtimeSnapshot.focus.ready, 2);
  assert.notEqual(result.runtimeSnapshot.focus.ready, result.runtimeSnapshot.focus.requirements);
});

test('a required source that accepts once and then errors cannot remain fresh or produce PASS', async () => {
  const f = fixture();
  f.sockets.earlyRequiredError = true;
  const result = await f.harness.run({ durationMs: 1_000 });
  const spot = result.sources.find((source) => source.key === 'SPOT_BROAD');
  assert.equal(spot.acceptedMessageCount, 1);
  assert.equal(spot.fresh, false);
  assert.equal(spot.state, 'UNAVAILABLE');
  assert.notEqual(result.outcome, 'PASS');
  assert.equal(result.steps.find((step) => step.step === 'broad_spot_messages').state, 'UNAVAILABLE');
  assert.notEqual(result.steps.find((step) => step.step === 'final_runtime_health').state, 'PASS');
});

test('message-cap close requests are counted once in the shutdown receipt', async () => {
  const f = fixture(false, { maximumMessagesPerSource: 1 });
  const result = await f.harness.run({ durationMs: 1_000 });
  assert.equal(result.shutdown.createdConnections, 4);
  assert.equal(result.shutdown.closeRequests, 4);
  assert.equal(result.shutdown.observedCloses, 4);
  assert.equal(result.shutdown.allConnectionsClosed, true);
  assert.equal(f.sockets.closeCount, 4);
  assert.ok(result.sources.some((source) => source.endedBeforeShutdown));
  assert.notEqual(result.outcome, 'PASS');
});

test('Node transport public allowlists reject private, signed, legacy, and non-tiered routes without network', async () => {
  assert.equal(isAllowedPublicSmokeWebSocketUrl('wss://stream.binance.com:9443/ws/!miniTicker@arr'), true);
  assert.equal(isAllowedPublicSmokeWebSocketUrl('wss://fstream.binance.com/public/ws/!bookTicker'), true);
  assert.equal(isAllowedPublicSmokeWebSocketUrl('wss://fstream.binance.com/market/ws/!markPrice@arr@1s'), true);
  assert.equal(isAllowedPublicSmokeWebSocketUrl('wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@bookTicker/btcusdt@depth@100ms'), true);
  assert.equal(isAllowedPublicSmokeWebSocketUrl('wss://fstream.binance.com/ws/!bookTicker'), false);
  assert.equal(isAllowedPublicSmokeWebSocketUrl('wss://stream.binance.com:9443/ws/userData'), false);

  const clock = new ManualClock();
  const calls = [];
  const transport = new NodePublicRestTransport({
    clock,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ symbols: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const response = await transport.request({
    sourceId: 'test',
    method: 'GET',
    baseUrl: 'https://data-api.binance.vision',
    path: '/api/v3/exchangeInfo',
    query: {},
    timeoutMs: 1_000,
    maximumResponseBytes: 10_000,
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://data-api.binance.vision/api/v3/exchangeInfo');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal('authorization' in calls[0].init.headers, false);
  await assert.rejects(() => transport.request({
    sourceId: 'bad', method: 'GET', baseUrl: 'https://api.binance.com', path: '/api/v3/account', query: {}, timeoutMs: 1_000, maximumResponseBytes: 10_000,
  }), /keyless public allowlist/);
});

test('manual command is explicit and does not require a package script', () => {
  assert.equal(PUBLIC_SMOKE_MANUAL_COMMAND, 'node server/dist/intelligenceRuntime/smoke/manual.js --duration-ms 15000 --symbol BTCUSDT');
});
