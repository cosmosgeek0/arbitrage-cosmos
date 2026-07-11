#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BinanceStream } from '../src/binance/ws.ts';
import { UserStream } from '../src/binance/userStream.ts';
import { BookStreamHub } from '../src/services/bookStream.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

test('liquidation collector is restart-safe, bounded, and rejects malformed or duplicate events', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'cosmos-liq-stream-test-'));
  process.env.LIQ_CACHE = path.join(cacheDir, 'liquidations.json');
  const module = await import(`../src/binance/liquidations.ts?test=${Date.now()}`);
  const sockets = [];
  const options = {
    socketFactory: (_url, wsOptions) => {
      assert.equal(wsOptions.perMessageDeflate, false);
      assert.equal(wsOptions.maxPayload, 64 * 1024);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    retryBaseMs: 5,
    retryMaxMs: 10,
    stableConnectionMs: 30,
    maintenanceMs: 5_000,
    livenessCheckMs: 1_000,
    staleAfterMs: 2_000,
    maxLifetimeMs: 5_000,
    random: () => 0.5,
    isKnownSymbol: (symbol) => symbol === 'BTCUSDT',
  };

  module.startLiquidationCollector(options);
  module.startLiquidationCollector(options);
  assert.equal(sockets.length, 1, 'collector start is idempotent');
  sockets[0].open();
  const timestamp = Date.now();
  sockets[0].message({ o: { s: 'ETHUSDT', S: 'SELL', l: '1', z: '1', ap: '100', T: timestamp } });
  sockets[0].message({ o: { s: 'BTCUSDT', S: 'SELL', l: '1', z: '1', ap: '100', T: timestamp - 2 * 60 * 60_000 } });
  const valid = { e: 'forceOrder', E: timestamp, o: { s: 'BTCUSDT', S: 'SELL', l: '0.5', z: '0.5', q: '1', ap: '100', T: timestamp } };
  sockets[0].message(valid);
  sockets[0].message(valid);
  sockets[0].message({
    e: 'forceOrder',
    E: timestamp + 1,
    o: { s: 'BTCUSDT', S: 'SELL', l: '0.25', z: '0.75', q: '1', ap: '100', T: timestamp + 1 },
  });
  sockets[0].message({
    e: 'forceOrder',
    E: timestamp + 2,
    o: { s: 'BTCUSDT', S: 'SELL', z: '1', q: '1', ap: '100', T: timestamp + 2 },
  });
  assert.equal(module.liquidationStats().events, 2, 'unknown, stale, duplicate, and last-fill-less events are rejected');
  const series = module.liquidationSeries('BTCUSDT', 5 * 60_000);
  assert.equal(
    series.points.reduce((sum, point) => sum + point.long, 0),
    75,
    'cumulative filled quantity is not counted again on later snapshots',
  );

  sockets[0].remoteClose();
  await sleep(8);
  assert.equal(sockets.length, 2, 'collector retries a first short session at the base delay');
  sockets[1].open();
  sockets[1].remoteClose();
  await sleep(8);
  assert.equal(sockets.length, 2, 'collector does not reset backoff merely because TCP opened');
  await sleep(6);
  assert.equal(sockets.length, 3, 'collector preserves exponential backoff across short sessions');
  sockets[2].open();
  await sleep(35);
  sockets[2].remoteClose();
  await sleep(8);
  assert.equal(sockets.length, 4, 'collector resets backoff after a stable session');

  module.stopLiquidationCollector();
  await module.flushLiquidationCache();
  const countAtStop = sockets.length;
  await sleep(20);
  assert.equal(sockets.length, countAtStop, 'collector retry cannot fire after stop');
  assert.equal(module.liquidationStats().state, 'down');
  const persisted = JSON.parse(readFileSync(process.env.LIQ_CACHE, 'utf8'));
  assert.equal(persisted.books.BTCUSDT !== undefined, true, 'stop flushes the last valid in-memory buckets');
  assert.equal(statSync(process.env.LIQ_CACHE).size <= 32 * 1024 * 1024, true, 'serialized cache stays inside its byte budget');

  module.startLiquidationCollector(options);
  assert.equal(sockets.length, countAtStop + 1, 'collector can be explicitly started as a new generation');
  module.stopLiquidationCollector();
  await module.flushLiquidationCache();
});
