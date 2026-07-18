#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BinanceStream, PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY } from '../src/binance/ws.ts';
import { UserStream } from '../src/binance/userStream.ts';
import { CORE_OPERATION_POLICIES } from '../src/productAssurance/catalog/core.ts';
import { BookStreamHub } from '../src/services/bookStream.ts';
import { MarketEngine } from '../src/engine/marketData.ts';
import { projectMarketApiRow } from '../src/engine/marketApiProjection.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('public WebSocket retry policy pins the production attempt and elapsed ceilings', () => {
  assert.deepEqual(PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY, {
    deadlineMs: 30_000,
    maximumAttempts: 8,
    backoff: {
      baseDelayMs: 250,
      maximumDelayMs: 15_000,
      jitterRatio: 0.35,
      totalRetryBudgetMs: 90_000,
    },
  });
  const declared = CORE_OPERATION_POLICIES.find(
    (policy) => policy.operationId === 'OP_PUBLIC_WEBSOCKET_STREAM',
  );
  assert.ok(declared);
  assert.equal(declared.deadlineMs, PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.deadlineMs);
  assert.equal(declared.maximumAttempts, PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.maximumAttempts);
  assert.deepEqual(declared.backoff, PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff);
});

class FakeSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  terminated = false;

  open() {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.emit('open');
  }

  message(value, isBinary = false) {
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    this.emit('message', raw, isBinary);
  }

  remoteClose() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  }

  close() {
    this.remoteClose();
  }

  terminate() {
    this.terminated = true;
    this.remoteClose();
  }

  send(value, callback) {
    this.sent.push(String(value));
    callback?.();
  }
}

test('BinanceStream owns retries by generation and cannot resurrect after stop', async () => {
  const sockets = [];
  const socketOptions = [];
  const statuses = [];
  const messages = [];
  const stream = new BinanceStream(
    'test-feed',
    'wss://example.invalid/feed',
    (message) => messages.push(message),
    (_name, status) => statuses.push(status),
    {
      socketFactory: (_url, options) => {
        socketOptions.push(options);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      retryBaseMs: 5,
      retryMaxMs: 10,
      livenessCheckMs: 1_000,
      staleAfterMs: 2_000,
      maxLifetimeMs: 5_000,
      random: () => 0.5,
    },
  );

  stream.start();
  stream.start();
  assert.equal(sockets.length, 1, 'start is idempotent');
  assert.equal(socketOptions[0].perMessageDeflate, false);
  assert.equal(socketOptions[0].maxPayload, 512 * 1024);
  sockets[0].open();
  sockets[0].message({ ok: true });
  assert.deepEqual(messages, [{ ok: true }]);
  assert.deepEqual(statuses.slice(0, 2), ['connecting', 'open']);

  sockets[0].remoteClose();
  await sleep(8);
  assert.equal(sockets.length, 2, 'a live generation reconnects');
  stream.stop();
  const countAtStop = sockets.length;
  sockets[0].emit('close', 1006, Buffer.alloc(0));
  await sleep(20);
  assert.equal(sockets.length, countAtStop, 'old close and retry callbacks cannot restart a stopped stream');
  assert.equal(statuses.at(-1), 'closed');
});

test('BinanceStream never constructs a socket after a synchronous status callback stops its generation', async () => {
  let socketFactoryCalls = 0;
  const statuses = [];
  let stream;
  stream = new BinanceStream(
    'synchronous-stop-feed',
    'wss://example.invalid/synchronous-stop',
    () => undefined,
    (_name, status) => {
      statuses.push(status);
      if (status === 'connecting') stream.stop();
    },
    {
      socketFactory: () => {
        socketFactoryCalls += 1;
        return new FakeSocket();
      },
    },
  );

  stream.start();
  await sleep(5);
  assert.equal(socketFactoryCalls, 0);
  assert.deepEqual(statuses, ['connecting', 'closed']);
});

test('BinanceStream terminates a half-open connection with no Binance activity', async () => {
  const sockets = [];
  const stream = new BinanceStream(
    'stale-feed',
    'wss://example.invalid/stale',
    () => undefined,
    () => undefined,
    {
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      retryBaseMs: 50,
      retryMaxMs: 50,
      livenessCheckMs: 5,
      staleAfterMs: 5,
      maxLifetimeMs: 5_000,
      random: () => 0.5,
    },
  );
  stream.start();
  sockets[0].open();
  await sleep(15);
  assert.equal(sockets[0].terminated, true);
  stream.stop();
});

test('BinanceStream preserves exponential backoff until a connection is stable', async () => {
  const sockets = [];
  const stream = new BinanceStream(
    'backoff-feed',
    'wss://example.invalid/backoff',
    () => undefined,
    () => undefined,
    {
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      retryBaseMs: 20,
      retryMaxMs: 40,
      stableConnectionMs: 30,
      livenessCheckMs: 1_000,
      staleAfterMs: 2_000,
      maxLifetimeMs: 5_000,
      maximumAttempts: 3,
      random: () => 0.5,
    },
  );

  stream.start();
  sockets[0].open();
  sockets[0].remoteClose();
  await sleep(25);
  assert.equal(sockets.length, 2, 'the first failed session retries at the base delay');

  sockets[1].open();
  sockets[1].remoteClose();
  await sleep(25);
  assert.equal(sockets.length, 2, 'a short TCP-open session does not reset the retry delay');
  await sleep(20);
  assert.equal(sockets.length, 3, 'the retry delay remains exponentially backed off');

  sockets[2].open();
  await sleep(35);
  sockets[2].remoteClose();
  await sleep(25);
  assert.equal(sockets.length, 4, 'a stable session resets the retry delay');
  stream.stop();
});

test('BinanceStream latches visible exhaustion before canonical attempt nine and re-arms only on explicit restart', async () => {
  let socketFactoryCalls = 0;
  const statuses = [];
  let resolveExhaustion = null;
  const waitForExhaustion = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for retry exhaustion')), 500);
    resolveExhaustion = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
  const stream = new BinanceStream(
    'bounded-retry-feed',
    'wss://example.invalid/bounded-retry',
    () => undefined,
    (_name, status) => {
      statuses.push(status);
      if (status === 'exhausted') {
        const resolve = resolveExhaustion;
        resolveExhaustion = null;
        resolve?.();
      }
    },
    {
      socketFactory: () => {
        socketFactoryCalls += 1;
        throw new Error('synthetic connect failure');
      },
      retryBaseMs: 1,
      retryMaxMs: 1,
      maximumAttempts: 99,
      totalRetryBudgetMs: 999_999,
      random: () => 0,
    },
  );

  const firstExhaustion = waitForExhaustion();
  stream.start();
  await firstExhaustion;
  assert.equal(socketFactoryCalls, 8, 'the initial call is attempt one and attempt nine is never constructed');
  assert.equal(statuses.at(-1), 'exhausted', 'attempt exhaustion is visible while the lifecycle remains active');
  assert.ok(statuses.includes('cooldown'), 'scheduled retry backoff is visible');
  await sleep(10);
  assert.equal(socketFactoryCalls, 8, 'exhaustion is latched and never self-rearms');

  stream.stop();
  const secondExhaustion = waitForExhaustion();
  stream.start();
  await secondExhaustion;
  assert.equal(socketFactoryCalls, 16, 'an explicit lifecycle restart owns one fresh bounded campaign');
  assert.equal(statuses.at(-1), 'exhausted');
  stream.stop();
});

test('BinanceStream rechecks elapsed policy after a scheduled cooldown and before socket dispatch', async () => {
  let nowMs = 10_000;
  let socketFactoryCalls = 0;
  const statuses = [];
  const stream = new BinanceStream(
    'late-timer-feed',
    'wss://example.invalid/late-timer',
    () => undefined,
    (_name, status) => statuses.push(status),
    {
      socketFactory: () => {
        socketFactoryCalls += 1;
        throw new Error('synthetic connect failure');
      },
      retryBaseMs: 5,
      retryMaxMs: 5,
      nowMs: () => nowMs,
      random: () => 0.5,
    },
  );

  stream.start();
  assert.equal(socketFactoryCalls, 1);
  assert.equal(statuses.at(-1), 'cooldown');
  nowMs += 30_001;
  await sleep(15);
  assert.equal(socketFactoryCalls, 1, 'a late timer cannot construct a socket past the deadline');
  assert.equal(statuses.at(-1), 'exhausted');
  stream.stop();
});

test('BinanceStream clamps widening overrides and exhausts the canonical operation deadline before another dispatch', async () => {
  let nowMs = 10_000;
  let socketFactoryCalls = 0;
  const statuses = [];
  const stream = new BinanceStream(
    'elapsed-budget-feed',
    'wss://example.invalid/elapsed-budget',
    () => undefined,
    (_name, status) => statuses.push(status),
    {
      socketFactory: () => {
        socketFactoryCalls += 1;
        nowMs += 30_001;
        throw new Error('synthetic slow connect failure');
      },
      retryBaseMs: 1,
      retryMaxMs: 1,
      maximumAttempts: 99,
      totalRetryBudgetMs: 999_999,
      nowMs: () => nowMs,
      random: () => 0.5,
    },
  );

  stream.start();
  assert.equal(socketFactoryCalls, 1);
  assert.equal(statuses.at(-1), 'exhausted', 'elapsed budget exhaustion is synchronous and visible');
  await sleep(5);
  assert.equal(socketFactoryCalls, 1, 'no timer can dispatch beyond the elapsed budget');
  stream.stop();
});

test('BinanceStream enforces a reduced elapsed retry budget independently of the operation deadline', async () => {
  let nowMs = 10_000;
  let socketFactoryCalls = 0;
  const statuses = [];
  const stream = new BinanceStream(
    'reduced-budget-feed',
    'wss://example.invalid/reduced-budget',
    () => undefined,
    (_name, status) => statuses.push(status),
    {
      socketFactory: () => {
        socketFactoryCalls += 1;
        nowMs += 11;
        throw new Error('synthetic slow connect failure');
      },
      retryBaseMs: 1,
      retryMaxMs: 1,
      totalRetryBudgetMs: 10,
      nowMs: () => nowMs,
      random: () => 0.5,
    },
  );

  stream.start();
  assert.equal(socketFactoryCalls, 1);
  assert.equal(statuses.at(-1), 'exhausted');
  await sleep(5);
  assert.equal(socketFactoryCalls, 1, 'the elapsed retry budget blocks another dispatch before 30 seconds');
  stream.stop();
});

test('UserStream signs the current WebSocket API subscription, validates wrapped events, and stops retries', async () => {
  let requestNumber = 0;
  const subscriptionRequests = [];
  const client = {
    userDataStreamSubscribeFrame(id) {
      subscriptionRequests.push(id);
      return JSON.stringify({
        id,
        method: 'userDataStream.subscribe.signature',
        params: { apiKey: 'TEST_API_KEY_TRANSPORT_ONLY', signature: 'signed-not-secret' },
      });
    },
  };
  const sockets = [];
  const socketUrls = [];
  const events = [];
  const statuses = [];
  const stream = new UserStream(
    client,
    (event) => events.push(event),
    (status, detail) => statuses.push({ status, detail }),
    {
      socketFactory: (url, options) => {
        socketUrls.push(url);
        assert.equal(options.perMessageDeflate, false);
        assert.equal(options.followRedirects, false);
        assert.equal(options.maxPayload, 64 * 1024);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      retryBaseMs: 5,
      retryMaxMs: 10,
      subscriptionTimeoutMs: 1_000,
      livenessCheckMs: 1_000,
      staleAfterMs: 2_000,
      maxLifetimeMs: 5_000,
      random: () => 0.5,
      requestIdFactory: () => `request_${++requestNumber}`,
    },
  );

  await stream.start();
  stream.stop();
  sockets[0].open();
  assert.equal(sockets[0].sent.length, 0, 'an obsolete socket cannot subscribe after stop');
  assert.equal(stream.status, 'off');

  await stream.start();
  await stream.start();
  assert.equal(sockets.length, 2, 'active user-stream start is idempotent');
  assert.equal(socketUrls[1], 'wss://ws-api.binance.com:443/ws-api/v3');
  const active = sockets[1];
  active.open();
  assert.equal(stream.status, 'connecting', 'TCP open is not reported as subscribed');
  const request = JSON.parse(active.sent[0]);
  assert.equal(request.method, 'userDataStream.subscribe.signature');
  assert.equal(request.id, 'request_1');
  active.message({ id: request.id, status: 200, result: { subscriptionId: 7 } });
  assert.equal(stream.status, 'open');
  assert.deepEqual(subscriptionRequests, ['request_1']);

  const validEvent = {
    e: 'executionReport',
    s: '比特币USDT',
    S: 'BUY',
    o: 'MARKET',
    i: 123,
    x: 'TRADE',
    X: 'FILLED',
    l: '0.01',
    L: '60000',
    n: '0.00001',
    N: '手续费币',
    t: 456,
    T: Date.now(),
  };
  active.message(validEvent);
  active.message({ subscriptionId: 8, event: validEvent });
  active.message({
    subscriptionId: 7,
    event: { ...validEvent, l: 'NaN' },
  });
  active.message({ subscriptionId: 7, event: validEvent });
  assert.equal(events.length, 1, 'only matching, schema-valid wrapped events reach the account callback');
  assert.equal(events[0].s, '比特币USDT', 'bounded Unicode symbols remain valid');

  active.message({
    subscriptionId: 7,
    event: { e: 'eventStreamTerminated', E: Date.now() },
  });
  await sleep(8);
  assert.equal(sockets.length, 3, 'a terminated subscription reconnects through the bounded backoff');
  assert.equal(statuses.some(({ status }) => status === 'failed'), true);

  sockets[2].open();
  const rejectedRequest = JSON.parse(sockets[2].sent[0]);
  sockets[2].message({
    id: rejectedRequest.id,
    status: 401,
    error: { msg: 'SUPER_SECRET_SHOULD_NOT_REACH_STATUS' },
  });
  await sleep(15);
  assert.equal(sockets.length, 4, 'a rejected signed subscription reconnects');
  assert.equal(JSON.stringify(statuses).includes('SUPER_SECRET_SHOULD_NOT_REACH_STATUS'), false);

  sockets[3].open();
  const finalRequest = JSON.parse(sockets[3].sent[0]);
  sockets[3].message({ id: finalRequest.id, status: 200, result: { subscriptionId: 9 } });
  sockets[3].remoteClose();
  await sleep(8);
  assert.equal(sockets.length, 4, 'a short-lived accepted session does not reset reconnect backoff');
  await sleep(7);
  assert.equal(sockets.length, 5, 'a current socket close opens a fresh WebSocket API session');
  stream.stop();
  const socketsAtStop = sockets.length;
  await sleep(20);
  assert.equal(sockets.length, socketsAtStop, 'restart timers are cancelled by stop');
  assert.equal(stream.status, 'off');
  assert.equal(statuses.at(-1).status, 'off');
});

test('UserStream honors Binance retryAfter and stop cancels the deferred reconnect', async () => {
  const sockets = [];
  const statuses = [];
  const client = {
    userDataStreamSubscribeFrame(id) {
      return JSON.stringify({ id, method: 'userDataStream.subscribe.signature', params: {} });
    },
  };
  const stream = new UserStream(
    client,
    () => undefined,
    (status, detail) => statuses.push({ status, detail }),
    {
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      retryBaseMs: 5,
      retryMaxMs: 10,
      subscriptionTimeoutMs: 1_000,
      livenessCheckMs: 1_000,
      staleAfterMs: 2_000,
      maxLifetimeMs: 5_000,
      random: () => 0.5,
      requestIdFactory: () => 'rate_limit_request',
    },
  );

  await stream.start();
  sockets[0].open();
  const request = JSON.parse(sockets[0].sent[0]);
  const retryAfter = Date.now() + 250;
  sockets[0].message({
    id: request.id,
    status: 429,
    error: { code: -1003, msg: 'rate limited', data: { retryAfter } },
  });
  await sleep(20);
  assert.equal(sockets.length, 1, 'server retryAfter overrides the shorter local retry');
  assert.equal(JSON.stringify(statuses).includes(String(retryAfter)), false, 'retry timing is not exposed');

  stream.stop();
  await sleep(260);
  assert.equal(sockets.length, 1, 'stop cancels a server-directed long retry timer');
  assert.equal(stream.status, 'off');
});

test('BookStreamHub bounds feeds, validates payloads, deduplicates trades, and evicts slow viewers', () => {
  const handles = [];
  const streamFactory = (name, url, onMessage) => {
    const handle = {
      name,
      url,
      onMessage,
      starts: 0,
      stops: 0,
      start() { this.starts += 1; },
      stop() { this.stops += 1; },
    };
    handles.push(handle);
    return handle;
  };
  const hub = new BookStreamHub(
    (symbol) => symbol === 'BTCUSDT' || symbol === 'ETHUSDT',
    { maxFeeds: 1, maxSubscriptions: 2, maxClientBufferedBytes: 1_024, streamFactory },
  );
  const first = new FakeSocket();
  first.open();
  hub.handleMessage(first, { type: 'sub-book', symbol: 'BTCUSDT' });
  assert.equal(handles.length, 1);
  assert.equal(handles[0].starts, 1);

  const depth = {
    stream: 'btcusdt@depth20@100ms',
    data: { lastUpdateId: 42, bids: [['100', '2'], ['99', '1']], asks: [['101', '3'], ['102', '2']] },
  };
  handles[0].onMessage(depth);
  assert.equal(JSON.parse(first.sent.at(-1)).type, 'book');
  const sentAfterValidBook = first.sent.length;
  handles[0].onMessage({
    ...depth,
    data: { lastUpdateId: 43, bids: [['102', '2']], asks: [['101', '3']] },
  });
  assert.equal(first.sent.length, sentAfterValidBook, 'crossed books are rejected');

  const trade = {
    stream: 'btcusdt@aggTrade',
    data: { e: 'aggTrade', s: 'BTCUSDT', a: 100, p: '100.5', q: '0.2', T: Date.now(), m: false },
  };
  handles[0].onMessage(trade);
  handles[0].onMessage(trade);
  hub.flushTrades('BTCUSDT');
  const tradeMessage = JSON.parse(first.sent.at(-1));
  assert.equal(tradeMessage.type, 'btrades');
  assert.equal(tradeMessage.trades.length, 1, 'replayed aggregate trade ids are not double counted');

  first.bufferedAmount = 2_000;
  handles[0].onMessage(depth);
  assert.equal(first.terminated, true, 'slow viewers are removed before their buffers become unbounded');

  const second = new FakeSocket();
  second.open();
  hub.handleMessage(second, { type: 'sub-book', symbol: 'ETHUSDT' });
  assert.equal(handles.length, 2, 'the idle feed is evicted to stay under the feed cap');
  assert.equal(handles[0].stops, 1);

  const third = new FakeSocket();
  third.open();
  hub.handleMessage(third, { type: 'sub-book', symbol: 'BTCUSDT' });
  assert.equal(handles.length, 2, 'an active feed is never displaced past the cap');
  hub.stop();
  hub.stop();
  assert.equal(handles[1].stops, 1, 'hub stop is idempotent');
  hub.handleMessage(third, { type: 'sub-book', symbol: 'BTCUSDT' });
  assert.equal(handles.length, 2, 'messages cannot reopen feeds after hub stop');
});

test('passive liquidation projection is restart-safe, bounded, and rejects malformed canonical prints', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'cosmos-liq-stream-test-'));
  process.env.SKIP_DOTENV = '1';
  process.env.DATA_DIR = path.join(cacheDir, 'data');
  process.env.LIQ_CACHE = path.join(process.env.DATA_DIR, 'liquidations.json');
  const module = await import(`../src/binance/liquidations.ts?test=${Date.now()}`);
  const options = {
    maintenanceMs: 5_000,
  };

  module.startLiquidationProjection(options);
  const firstGeneration = module.liquidationStats().generation;
  module.startLiquidationProjection(options);
  assert.equal(module.liquidationStats().generation, firstGeneration, 'projection start is idempotent');
  assert.equal(module.liquidationStats().state, 'connecting');
  module.observeLiquidationSourceStatus('open');
  assert.equal(module.liquidationStats().state, 'live');
  const timestamp = Date.now();
  const valid = { symbol: 'BTCUSDT', side: 'LONG', notionalUsd: 50, eventTimeMs: timestamp, sourceEventKey: 'BTCUSDT:SELL:first' };
  module.ingestLiquidationPrint({ ...valid, symbol: 'bad-symbol' });
  module.ingestLiquidationPrint({ ...valid, eventTimeMs: timestamp - 2 * 60 * 60_000, sourceEventKey: 'stale' });
  module.ingestLiquidationPrint(valid);
  module.ingestLiquidationPrint({ ...valid, notionalUsd: 75, eventTimeMs: timestamp + 1, sourceEventKey: 'BTCUSDT:SELL:second' });
  module.ingestLiquidationPrint({ ...valid, notionalUsd: Number.NaN, sourceEventKey: 'invalid' });
  assert.equal(module.liquidationStats().events, 2, 'malformed and stale canonical prints are rejected');
  const series = module.liquidationSeries('BTCUSDT', 5 * 60_000);
  assert.equal(
    series.points.reduce((sum, point) => sum + point.long, 0),
    125,
    'canonical completed-order notionals are retained exactly once',
  );

  module.observeLiquidationSourceStatus('closed');
  assert.equal(module.liquidationStats().state, 'down');
  module.stopLiquidationProjection();
  await module.flushLiquidationCache();
  assert.equal(module.liquidationStats().state, 'down');
  assert.equal(module.liquidationStats().running, false);
  module.ingestLiquidationPrint({ ...valid, eventTimeMs: timestamp + 3, sourceEventKey: 'late' });
  assert.equal(module.liquidationStats().events, 2, 'stopped projections reject late owner frames');
  const persisted = JSON.parse(readFileSync(process.env.LIQ_CACHE, 'utf8'));
  assert.equal(persisted.books.BTCUSDT !== undefined, true, 'stop flushes the last valid in-memory buckets');
  assert.equal(statSync(process.env.LIQ_CACHE).size <= 32 * 1024 * 1024, true, 'serialized cache stays inside its byte budget');

  module.startLiquidationProjection(options);
  assert.equal(module.liquidationStats().generation, firstGeneration + 2, 'projection can be explicitly started as a new generation');
  module.stopLiquidationProjection();
  await module.flushLiquidationCache();
});

test('MarketEngine normalizes force-order snapshots once and both liquidation views stay equal', async () => {
  let deniedUniverseFetchCalls = 0;
  const deniedEngine = new MarketEngine(
    { logEvent() {} },
    async () => {
      deniedUniverseFetchCalls += 1;
      return { pairs: [], filters: new Map() };
    },
    undefined,
    { publicSourceStartupEgressAdmitted: false },
  );
  await assert.rejects(deniedEngine.init(), /PUBLIC_SOURCE_STARTUP_EGRESS_NOT_ADMITTED/);
  assert.equal(deniedUniverseFetchCalls, 0, 'denied startup stops before the REST universe owner');
  assert.throws(() => deniedEngine.start(), /PUBLIC_SOURCE_STARTUP_EGRESS_NOT_ADMITTED/);
  assert.deepEqual(deniedEngine.feeds, {}, 'denied startup cannot activate a WebSocket owner');

  const projected = [];
  const engine = new MarketEngine(
    { logEvent() {} },
    async () => ({
      pairs: [{ symbol: 'BTCUSDT', base: 'BTC' }],
      filters: new Map([['BTCUSDT', {
        symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', status: 'TRADING',
        stepSize: 0.001, minQty: 0.001, tickSize: 0.01, minNotional: 5,
      }]]),
    }),
    {
      start() {}, stop() {}, observeSourceStatus() {},
      ingestPrint(print) { projected.push(print); },
    },
    { publicSourceStartupEgressAdmitted: true },
  );
  await engine.init();
  const timestamp = Date.now();
  const first = { e: 'forceOrder', E: timestamp, ps: 'BTCUSDT', st: 1, o: { s: 'BTCUSDT', S: 'SELL', X: 'FILLED', l: '0.5', z: '1.5', q: '1.5', ap: '100', T: timestamp } };
  engine.onForceOrders([
    first,
    first,
    { ...first, o: { ...first.o, ap: '101' } },
    { e: 'forceOrder', E: timestamp + 1, ps: 'BTCUSDT', st: 1, o: { s: 'BTCUSDT', S: 'SELL', X: 'FILLED', l: '0.25', z: '0.75', q: '0.75', ap: '100', T: timestamp + 1 } },
    { e: 'forceOrder', E: timestamp + 2, ps: 'BTCUSDT', st: 1, o: { s: 'BTCUSDT', S: 'SELL', X: 'PARTIALLY_FILLED', z: '1', q: '1', ap: '100', T: timestamp + 2 } },
    { e: 'forceOrder', E: timestamp + 3, ps: 'BTCUSDT', o: { s: 'BTCUSDT', S: 'SELL', X: 'FILLED', l: '1', z: '1', q: '1', ap: '100', T: timestamp + 3 } },
    { e: 'forceOrder', E: timestamp + 4, ps: 'BTCUSDT', st: 2, o: { s: 'BTCUSDT', S: 'SELL', X: 'FILLED', l: '1', z: '1', q: '1', ap: '100', T: timestamp + 4 } },
  ]);
  assert.equal(projected.length, 2);
  assert.equal(projected.reduce((sum, print) => sum + print.notionalUsd, 0), 225);
  const row = engine.rows().find((candidate) => candidate.symbol === 'BTCUSDT');
  assert.equal(row.liquidations15mUsd, 225);
  assert.equal(row.longLiquidations15mUsd, 225);
  assert.equal(row.shortLiquidations15mUsd, null);
});

function marketUniverse(symbols = ['BTCUSDT']) {
  return {
    pairs: symbols.map((symbol) => ({ symbol, base: symbol.slice(0, -4) })),
    filters: new Map(symbols.map((symbol) => [symbol, {
      symbol, base: symbol.slice(0, -4), quote: 'USDT', status: 'TRADING',
      stepSize: 0.001, minQty: 0.001, tickSize: 0.01, minNotional: 5,
    }])),
  };
}

async function openInterestHarness({ ttlMs = 1_000, symbols = ['BTCUSDT'] } = {}) {
  const clock = {
    value: 1_000_000,
    nowMs() { return this.value; },
  };
  let fetcher = async () => {
    throw new Error('OPEN_INTEREST_TEST_SAMPLE_NOT_CONFIGURED');
  };
  const engine = new MarketEngine(
    { logEvent() {} },
    async () => marketUniverse(symbols),
    undefined,
    {
      publicSourceStartupEgressAdmitted: true,
      clock,
      fetchOpenInterest: (symbol) => fetcher(symbol),
      openInterestTtlMs: ttlMs,
    },
  );
  await engine.init();
  // Exercise the owner synchronously without constructing a socket or timer.
  engine.running = true;
  engine.generation = 1;
  engine.observeFeedStatus('futures-markprice', 'open', 1);
  const mark = (price = 100, symbol = symbols[0]) => engine.onMarkPrices([{
    E: clock.value,
    s: symbol,
    p: String(price),
    i: String(price),
    r: '0.0001',
    T: clock.value + 60_000,
  }], 1);
  const sample = async (openInterest, time = clock.value, size = 1) => {
    fetcher = async (symbol) => ({ symbol, openInterest, time });
    await engine.refreshOpenInterestSlice(size, 1);
  };
  const row = (symbol = symbols[0]) => engine.rows().find((candidate) => candidate.symbol === symbol);
  return {
    clock,
    engine,
    mark,
    row,
    sample,
    feedStatus(status) { engine.observeFeedStatus('futures-markprice', status, 1); },
    setFetcher(next) { fetcher = next; },
  };
}

function projectMarketRow(row, perpVolume24h = 10_000) {
  return projectMarketApiRow({
    row: { ...row, hasSpot: true, hasPerp: true },
    perpTicker: {
      symbol: row.symbol,
      lastPrice: row.perpMark ?? 1,
      priceChangePct: 0,
      highPrice: row.perpMark ?? 1,
      lowPrice: row.perpMark ?? 1,
      volume: 1,
      quoteVolume: perpVolume24h,
      count: 1,
    },
    spark: [],
  });
}

function assertOpenInterestUnavailable(row) {
  assert.ok(row);
  assert.deepEqual({
    openInterest: row.openInterest,
    openInterestUsd: row.openInterestUsd,
    openInterestChangePct: row.openInterestChangePct,
    openInterestUpdatedAt: row.openInterestUpdatedAt,
  }, {
    openInterest: null,
    openInterestUsd: null,
    openInterestChangePct: null,
    openInterestUpdatedAt: null,
  });
  assert.equal(projectMarketRow(row).oiToPerpVolume24h, null);
}

test('MarketEngine bounds OI TTL and separates source observation from local freshness', async () => {
  assert.throws(() => new MarketEngine(
    { logEvent() {} }, async () => marketUniverse(), undefined,
    { publicSourceStartupEgressAdmitted: true, openInterestTtlMs: 999 },
  ), /OPEN_INTEREST_TTL_OUT_OF_BOUNDS:999/);
  assert.throws(() => new MarketEngine(
    { logEvent() {} }, async () => marketUniverse(), undefined,
    { publicSourceStartupEgressAdmitted: true, openInterestTtlMs: 300_001 },
  ), /OPEN_INTEREST_TTL_OUT_OF_BOUNDS:300001/);

  const h = await openInterestHarness();
  h.mark();
  await h.sample(10, h.clock.value - 100);
  let row = h.row();
  assert.equal(row.openInterest, 10);
  assert.equal(row.openInterestUsd, 1_000);
  assert.equal(row.openInterestChangePct, null, 'the first observation establishes a baseline only');
  assert.equal(row.openInterestUpdatedAt, 999_900, 'public time remains the exchange observation, not local receipt');
  assert.equal(projectMarketRow(row).oiToPerpVolume24h, 0.1);

  h.clock.value += 100;
  await h.sample(11);
  row = h.row();
  assert.equal(row.openInterestChangePct, 10);

  h.clock.value += 1_001;
  assertOpenInterestUnavailable(h.row());
  await h.sample(12);
  assert.equal(h.row().openInterestChangePct, null, 'the first post-TTL observation cannot reuse the expired baseline');
  h.clock.value += 100;
  await h.sample(13.2);
  assert.ok(Math.abs(h.row().openInterestChangePct - 10) < 1e-12);

  h.clock.value += 100;
  await h.sample(14, h.clock.value + 1);
  assertOpenInterestUnavailable(h.row());
  h.clock.value += 100;
  await h.sample(14);
  assert.equal(h.row().openInterestChangePct, null, 'a rejected future sample cannot become a recovery baseline');

  await h.sample(15, h.clock.value);
  assertOpenInterestUnavailable(h.row(), 'same-time conflicting source truth fails closed');
  h.clock.value += 100;
  await h.sample(15);
  assert.equal(h.row().openInterestChangePct, null);
  h.clock.value += 100;
  await h.sample(16, h.clock.value - 101);
  assertOpenInterestUnavailable(h.row(), 'nonmonotonic source truth fails closed');
  h.engine.stop();
});

test('MarketEngine nulls every OI field when mark truth goes stale and requires two recovered observations', async () => {
  const h = await openInterestHarness({ ttlMs: 60_000 });
  h.mark(100);
  await h.sample(10);
  h.clock.value += 100;
  await h.sample(11);
  assert.equal(h.row().openInterestChangePct, 10);

  h.clock.value += 30_001;
  assertOpenInterestUnavailable(h.row());
  await h.sample(12);
  assertOpenInterestUnavailable(h.row());

  h.clock.value += 100;
  h.mark(101);
  await h.sample(13);
  assert.equal(h.row().openInterestChangePct, null);
  h.clock.value += 100;
  await h.sample(14);
  assert.ok(h.row().openInterestChangePct > 0, 'the second fresh priced observation may compute a change');
  h.engine.stop();
});

test('MarketEngine nulls OI on every non-open mark-feed state and requires fresh mark plus OI recovery', async () => {
  for (const status of ['closed', 'cooldown', 'exhausted']) {
    const h = await openInterestHarness({ ttlMs: 60_000 });
    h.mark(100);
    await h.sample(10);
    h.clock.value += 100;
    await h.sample(11);
    assert.equal(h.row().openInterestChangePct, 10);

    h.feedStatus(status);
    assertOpenInterestUnavailable(h.row());

    h.feedStatus('open');
    h.clock.value += 100;
    await h.sample(12);
    assertOpenInterestUnavailable(h.row());

    h.clock.value += 100;
    h.mark(101);
    await h.sample(13);
    assert.equal(h.row().openInterest, 13);
    assert.equal(h.row().openInterestChangePct, null, `${status} recovery starts a new OI baseline`);
    h.clock.value += 100;
    await h.sample(14);
    assert.ok(h.row().openInterestChangePct > 0, `${status} recovery needs a second fresh OI observation`);
    h.engine.stop();
  }
});

test('a pre-close OI request cannot publish after mark-feed recovery', async () => {
  const h = await openInterestHarness({ ttlMs: 60_000 });
  h.mark(100);
  await h.sample(10);
  let resolveOld;
  h.clock.value += 100;
  h.setFetcher(() => new Promise((resolve) => { resolveOld = resolve; }));
  const oldRequest = h.engine.refreshOpenInterestSlice(1, 1);

  h.feedStatus('closed');
  assertOpenInterestUnavailable(h.row());
  h.feedStatus('open');
  h.clock.value += 100;
  h.mark(101);
  await h.sample(12);
  assert.equal(h.row().openInterest, 12);
  assert.equal(h.row().openInterestChangePct, null);

  resolveOld({ symbol: 'BTCUSDT', openInterest: 999, time: h.clock.value - 100 });
  await oldRequest;
  assert.equal(h.row().openInterest, 12);
  assert.equal(h.row().openInterestChangePct, null);
  h.engine.stop();
});

test('MarketEngine fails OI closed on outage, isolation, stop, and late promises', async () => {
  const h = await openInterestHarness({ ttlMs: 60_000 });
  h.mark();
  await h.sample(10);
  h.clock.value += 100;
  await h.sample(11);

  h.setFetcher(async () => { throw new Error('PUBLIC_SOURCE_DOWN'); });
  await assert.rejects(h.engine.refreshOpenInterestSlice(1, 1), /OPEN_INTEREST_SOURCE_UNAVAILABLE:1/);
  assertOpenInterestUnavailable(h.row());

  h.clock.value += 100;
  await h.sample(12);
  assert.equal(h.row().openInterestChangePct, null);
  h.clock.value += 100;
  await h.sample(13);
  assert.ok(h.row().openInterestChangePct > 0);

  let resolveLate;
  h.setFetcher(() => new Promise((resolve) => { resolveLate = resolve; }));
  h.clock.value += 100;
  const late = h.engine.refreshOpenInterestSlice(1, 1);
  let streamStops = 0;
  let streamStarts = 0;
  const fakeStream = {
    stop() { streamStops += 1; },
    start() { streamStarts += 1; },
  };
  h.engine.streams = new Map([
    ['futures-markprice', fakeStream],
    ['futures-liquidations', fakeStream],
  ]);
  h.engine.isolatePublicSource('public-usdm-source');
  assert.equal(streamStops, 2);
  assertOpenInterestUnavailable(h.row());

  h.engine.restartPublicSource('public-usdm-source');
  assert.equal(streamStarts, 2);
  h.clock.value += 100;
  h.mark();
  await h.sample(14);
  assert.equal(h.row().openInterestChangePct, null, 'a never-settling isolated fetch cannot block recovery');
  h.clock.value += 100;
  await h.sample(15);
  assert.ok(h.row().openInterestChangePct > 0);

  resolveLate({ symbol: 'BTCUSDT', openInterest: 99, time: h.clock.value - 200 });
  await late;
  assert.equal(h.row().openInterest, 15, 'late isolated completion cannot publish or clear newer recovery truth');
  assert.ok(h.row().openInterestChangePct > 0);

  h.engine.stop();
  assertOpenInterestUnavailable(h.row());
});

test('MarketEngine snapshots hostile OI accessors once and rechecks lifecycle before mutation', async () => {
  const h = await openInterestHarness({ ttlMs: 60_000 });
  h.mark();
  let symbolReads = 0;
  let openInterestReads = 0;
  let timeReads = 0;
  h.setFetcher(async () => new Proxy({
    symbol: 'BTCUSDT',
    openInterest: 10,
    time: h.clock.value,
  }, {
    get(target, property, receiver) {
      if (property === 'symbol') symbolReads += 1;
      if (property === 'openInterest') {
        openInterestReads += 1;
        return openInterestReads === 1 ? 10 : Number.POSITIVE_INFINITY;
      }
      if (property === 'time') {
        timeReads += 1;
        return timeReads === 1 ? h.clock.value : h.clock.value + 100_000;
      }
      return Reflect.get(target, property, receiver);
    },
  }));
  await h.engine.refreshOpenInterestSlice(1, 1);
  assert.deepEqual({ symbolReads, openInterestReads, timeReads }, {
    symbolReads: 1,
    openInterestReads: 1,
    timeReads: 1,
  });
  assert.equal(h.row().openInterest, 10);
  assert.equal(h.row().openInterestUsd, 1_000);
  assert.equal(h.row().openInterestUpdatedAt, h.clock.value);

  h.clock.value += 100;
  h.setFetcher(async () => ({
    symbol: 'BTCUSDT',
    get openInterest() { throw new Error('HOSTILE_OPEN_INTEREST_ACCESSOR'); },
    time: h.clock.value,
  }));
  await assert.rejects(h.engine.refreshOpenInterestSlice(1, 1), /OPEN_INTEREST_SOURCE_UNAVAILABLE:1/);
  assertOpenInterestUnavailable(h.row());

  let streamStops = 0;
  let streamStarts = 0;
  const fakeStream = {
    stop() { streamStops += 1; },
    start() { streamStarts += 1; },
  };
  h.engine.streams = new Map([
    ['futures-markprice', fakeStream],
    ['futures-liquidations', fakeStream],
  ]);
  h.clock.value += 100;
  h.setFetcher(async () => new Proxy({
    symbol: 'BTCUSDT',
    openInterest: 99,
    time: h.clock.value,
  }, {
    get(target, property, receiver) {
      if (property === 'symbol') {
        h.engine.isolatePublicSource('public-usdm-source');
        h.engine.restartPublicSource('public-usdm-source');
      }
      return Reflect.get(target, property, receiver);
    },
  }));
  await h.engine.refreshOpenInterestSlice(1, 1);
  assert.equal(streamStops, 2);
  assert.equal(streamStarts, 2);
  assertOpenInterestUnavailable(h.row());

  h.clock.value += 100;
  h.mark();
  await h.sample(11);
  assert.equal(h.row().openInterestChangePct, null);
  h.clock.value += 100;
  await h.sample(12);
  assert.ok(h.row().openInterestChangePct > 0);
  h.engine.stop();
});

test('MarketEngine clears source-wide OI on one-symbol outage and requeues invalidated slices', async () => {
  const symbols = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'];
  const h = await openInterestHarness({ ttlMs: 60_000, symbols });
  for (const [index, symbol] of symbols.entries()) h.mark(100 + index * 50, symbol);
  h.setFetcher(async (symbol) => ({
    symbol,
    openInterest: symbol === 'AAAUSDT' ? 10 : symbol === 'BBBUSDT' ? 20 : 30,
    time: h.clock.value,
  }));
  await h.engine.refreshOpenInterestSlice(3, 1);
  assert.deepEqual(symbols.map((symbol) => h.row(symbol).openInterest), [10, 20, 30]);

  h.clock.value += 100;
  h.setFetcher(async () => { throw new Error('ONE_SYMBOL_SLICE_DOWN'); });
  await assert.rejects(h.engine.refreshOpenInterestSlice(1, 1), /OPEN_INTEREST_SOURCE_UNAVAILABLE:1/);
  for (const symbol of symbols) assertOpenInterestUnavailable(h.row(symbol));

  h.clock.value += 100;
  h.setFetcher(async (symbol) => ({ symbol, openInterest: 40, time: h.clock.value }));
  await h.engine.refreshOpenInterestSlice(3, 1);
  for (const symbol of symbols) assert.equal(h.row(symbol).openInterestChangePct, null);

  const advancedSymbols = [];
  h.clock.value += 100;
  h.setFetcher(async (symbol) => {
    advancedSymbols.push(symbol);
    return { symbol, openInterest: 40, time: h.clock.value };
  });
  await h.engine.refreshOpenInterestSlice(1, 1);
  assert.deepEqual(advancedSymbols, ['AAAUSDT'], 'a completed slice advances the cursor away from zero');

  let resolveInvalidated;
  h.clock.value += 100;
  let invalidatedSymbol = null;
  h.setFetcher((symbol) => {
    invalidatedSymbol = symbol;
    return new Promise((resolve) => { resolveInvalidated = resolve; });
  });
  const invalidated = h.engine.refreshOpenInterestSlice(1, 1);
  assert.equal(invalidatedSymbol, 'BBBUSDT', 'the never-settling slice starts from a nonzero cursor');
  const fakeStream = { stop() {}, start() {} };
  h.engine.streams = new Map([
    ['futures-markprice', fakeStream],
    ['futures-liquidations', fakeStream],
  ]);
  h.engine.isolatePublicSource('public-usdm-source');
  h.engine.restartPublicSource('public-usdm-source');

  const recoveredSymbols = [];
  h.clock.value += 100;
  for (const [index, symbol] of symbols.entries()) h.mark(100 + index * 50, symbol);
  h.setFetcher(async (symbol) => {
    recoveredSymbols.push(symbol);
    return { symbol, openInterest: 41, time: h.clock.value };
  });
  await h.engine.refreshOpenInterestSlice(1, 1);
  assert.deepEqual(recoveredSymbols, ['BBBUSDT'], 'restart prioritizes the invalidated nonzero slice cursor');
  assert.equal(h.row('BBBUSDT').openInterest, 41);
  assert.equal(h.row('BBBUSDT').openInterestChangePct, null);

  resolveInvalidated({ symbol: 'BBBUSDT', openInterest: 999, time: h.clock.value - 100 });
  await invalidated;
  assert.equal(h.row('BBBUSDT').openInterest, 41, 'late invalidated slice cannot replace recovery truth');
  h.engine.stop();
});
