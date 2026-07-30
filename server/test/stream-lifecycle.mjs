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
import { VolumeRuntime } from '../src/services/volumeRuntime.ts';
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

test('BinanceStream with production timing defaults reconnects after a mid-life disconnect past the retry deadline', (t) => {
  // Production construction sites pass no timing options. The regression this
  // pins: DEFAULT_STABLE_CONNECTION_MS (60s) was larger than the 30s retry
  // deadline, so healthy connected time was charged against the campaign and
  // a drop in the 30-60s band exhausted the stream with zero attempts.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const sockets = [];
  const statuses = [];
  const stream = new BinanceStream(
    'production-defaults-feed',
    'wss://example.invalid/feed',
    () => {},
    (_name, status) => statuses.push(status),
    {
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      random: () => 0.5,
    },
  );

  stream.start();
  sockets[0].open();
  assert.deepEqual(statuses, ['connecting', 'open']);

  t.mock.timers.tick(45_000);
  sockets[0].remoteClose();
  assert.equal(
    statuses.includes('exhausted'),
    false,
    'a connection that held past the stability threshold must have cleared the retry campaign',
  );
  assert.equal(statuses.at(-1), 'cooldown');

  t.mock.timers.tick(1_000);
  assert.equal(sockets.length, 2, 'the stream opens a fresh socket after a routine mid-life disconnect');
  assert.equal(statuses.at(-1), 'connecting');
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

test('MarketEngine self-heals an exhausted public feed after an outage longer than the retry deadline', async () => {
  // Placed directly after the latch test above so the two invariants are read
  // together: BinanceStream deliberately latches exhaustion and never
  // self-rearms (unmodified above); recovery belongs to the stream's OWNER,
  // which holds the lifecycle authority. V5 measured the real system reaching
  // 'exhausted' at fault+26.4s and never leaving — still exhausted 150s after
  // full upstream restore, with no transport event for the rest of the
  // process lifetime.
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for supervisory rearm');
      await sleep(2);
    }
  };
  const handles = new Map();
  const streamFactory = (name, url, onMessage, onStatus) => {
    const handle = {
      name,
      url,
      onStatus,
      startCalls: 0,
      stopCalls: 0,
      start() { this.startCalls += 1; },
      stop() { this.stopCalls += 1; },
    };
    handles.set(name, handle);
    return handle;
  };
  const events = [];
  const engine = new MarketEngine(
    { logEvent(kind, _symbol, data) { events.push({ kind, data }); } },
    async () => ({ pairs: [], filters: new Map() }),
    { start() {}, stop() {}, observeSourceStatus() {}, ingestPrint() {} },
    {
      publicSourceStartupEgressAdmitted: true,
      streamFactory,
      sourceRecoveryBaseMs: 5, // compressed schedule, mirroring retryBaseMs injection above
      random: () => 0.5,       // zero jitter: (0.5 * 2) - 1 === 0
    },
  );
  engine.start();
  try {
    const spot = handles.get('spot-miniticker');
    assert.equal(spot.startCalls, 1);

    spot.onStatus('spot-miniticker', 'exhausted');
    await waitFor(() => spot.startCalls >= 2, 1_000);
    // The owner must issue stop() THEN start(): start() alone is a no-op
    // while a stream is not stopped. Before the fix both counters stayed at
    // their initial values forever.
    assert.ok(spot.stopCalls >= 1, 'rearm must stop the latched stream first');
    assert.ok(events.some((entry) => entry.kind === 'ws.rearm' && entry.data?.feed === 'spot-miniticker'),
      'every supervisory rearm is ledgered as ws.rearm');

    // Recovery clears the campaign: the box returns to green without a
    // process restart, and a healthy feed is never rearmed again.
    spot.onStatus('spot-miniticker', 'open');
    assert.equal(engine.readPublicSourceControl('public-spot-source').lifecycle, 'LIVE');
    const startsAfterRecovery = spot.startCalls;
    await sleep(50);
    assert.equal(spot.startCalls, startsAfterRecovery, 'a healthy feed is never rearmed');

    // Guard (passes before and after): an isolated source is never
    // auto-rearmed — the operator owns an isolated source.
    engine.isolatePublicSource('public-spot-source');
    const startsAfterIsolate = spot.startCalls;
    spot.onStatus('spot-miniticker', 'exhausted');
    await sleep(50);
    assert.equal(spot.startCalls, startsAfterIsolate, 'operator isolation outranks supervisory recovery');
  } finally {
    engine.stop();
  }

  // Guard (passes before and after): a stopped engine never rearms.
  const usdm = handles.get('futures-markprice');
  const startsAfterStop = usdm.startCalls;
  usdm.onStatus('futures-markprice', 'exhausted');
  await sleep(50);
  assert.equal(usdm.startCalls, startsAfterStop, 'a stopped engine never resurrects a stream');
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

test('UserStream latches terminal exhaustion and re-arms only for an explicit lifecycle restart', async () => {
  let socketFactoryCalls = 0;
  const statuses = [];
  const exhaustionWaiters = [];
  const waitForExhaustion = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for user-stream exhaustion')), 250);
    exhaustionWaiters.push(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  const stream = new UserStream(
    {
      userDataStreamSubscribeFrame() {
        throw new Error('private subscription must not be reached when socket construction fails');
      },
    },
    () => undefined,
    (status, detail) => {
      statuses.push({ status, detail });
      if (status === 'exhausted') exhaustionWaiters.shift()?.();
    },
    {
      socketFactory: () => {
        socketFactoryCalls += 1;
        throw new Error('synthetic private socket construction failure');
      },
      retryBaseMs: 1,
      retryMaxMs: 1,
      maximumAttempts: 99,
      random: () => 0.5,
    },
  );

  try {
    const firstExhaustion = waitForExhaustion();
    await stream.start();
    await firstExhaustion;
    assert.equal(socketFactoryCalls, 8, 'a widening override cannot construct canonical attempt nine');
    assert.deepEqual(statuses.at(-1), {
      status: 'exhausted',
      detail: 'private stream retry campaign exhausted',
    });
    assert.equal(stream.status, 'exhausted');
    await sleep(10);
    assert.equal(socketFactoryCalls, 8, 'terminal exhaustion cannot self-rearm');

    stream.stop();
    const secondExhaustion = waitForExhaustion();
    await stream.start();
    await secondExhaustion;
    assert.equal(socketFactoryCalls, 16, 'an explicit lifecycle restart owns one fresh bounded campaign');
    assert.equal(stream.status, 'exhausted');
  } finally {
    stream.stop();
  }
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

test('BookStreamHub generation-fences automatic recovery without duplicating a viewed producer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  const streamFactory = (name, url, onMessage, onStatus) => {
    const handle = {
      name,
      url,
      onMessage,
      onStatus,
      starts: 0,
      stops: 0,
      active: false,
      start() {
        assert.equal(this.active, false, 'a Book producer must stop before the same handle restarts');
        this.active = true;
        this.starts += 1;
        activeProducers += 1;
        peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
      },
      stop() {
        this.stops += 1;
        if (!this.active) return;
        this.active = false;
        activeProducers -= 1;
      },
    };
    handles.push(handle);
    return handle;
  };
  const hub = new BookStreamHub(
    (symbol) => symbol === 'BTCUSDT',
    {
      maxFeeds: 1,
      maxSubscriptions: 1,
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory,
    },
  );
  const viewer = new FakeSocket();
  viewer.open();

  hub.handleMessage(viewer, { type: 'sub-book', symbol: 'BTCUSDT' });
  assert.equal(handles.length, 1);
  assert.deepEqual(JSON.parse(viewer.sent.at(-1)), {
    type: 'book-status',
    symbol: 'BTCUSDT',
    status: 'connecting',
    lastMessageAtMs: null,
  }, 'a new viewer receives the retained pre-message lifecycle truth');

  handles[0].onStatus(handles[0].name, 'open');
  assert.deepEqual(JSON.parse(viewer.sent.at(-1)), {
    type: 'book-status',
    symbol: 'BTCUSDT',
    status: 'open',
    lastMessageAtMs: null,
  });

  const beforeMessageAtMs = Date.now();
  handles[0].onMessage({
    stream: 'btcusdt@depth20@100ms',
    data: { lastUpdateId: 42, bids: [['100', '2']], asks: [['101', '3']] },
  });
  const afterMessageAtMs = Date.now();
  handles[0].onStatus(handles[0].name, 'closed');
  const closed = JSON.parse(viewer.sent.at(-1));
  assert.deepEqual(Object.keys(closed).sort(), ['lastMessageAtMs', 'status', 'symbol', 'type']);
  assert.equal(closed.type, 'book-status');
  assert.equal(closed.symbol, 'BTCUSDT');
  assert.equal(closed.status, 'closed');
  assert.ok(
    closed.lastMessageAtMs >= beforeMessageAtMs && closed.lastMessageAtMs <= afterMessageAtMs,
    'the status frame retains the real last upstream message receipt time',
  );
  assert.ok(JSON.stringify(closed).length < 256, 'lifecycle frames have a fixed bounded shape');

  const producer = handles[0];
  producer.onStatus(producer.name, 'exhausted');
  producer.onStatus(producer.name, 'exhausted');
  const exhausted = JSON.parse(viewer.sent.at(-1));
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.lastMessageAtMs, closed.lastMessageAtMs);

  // More than the former five-recycle ceiling proves that retry-budget
  // exhaustion never permanently abandons a still-viewed public feed.
  for (let campaign = 0; campaign < 7; campaign += 1) {
    t.mock.timers.tick(1_000);
    assert.equal(
      producer.starts,
      campaign + 2,
      `retry-budget exhaustion ${campaign + 1} rearms the same viewed producer`,
    );
    assert.equal(producer.stops, campaign + 1);
    assert.equal(handles.length, 1, 'recovery never constructs a duplicate physical producer');
    assert.equal(activeProducers, 1, 'one viewed Book feed retains exactly one active producer');
    assert.equal(peakActiveProducers, 1, 'recovery never overlaps Book producers');
    producer.onStatus(producer.name, 'closed');
    producer.onStatus(producer.name, 'exhausted');
    producer.onStatus(producer.name, 'exhausted');
  }

  producer.onStatus(producer.name, 'open');
  const startsAfterOpen = producer.starts;
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  t.mock.timers.tick(1);
  assert.equal(
    producer.starts,
    startsAfterOpen + 1,
    'open resets recovery backoff to the injected base delay',
  );

  producer.onStatus(producer.name, 'open');
  const startsBeforeOpenCancellation = producer.starts;
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  producer.onStatus(producer.name, 'open');
  t.mock.timers.tick(60_000);
  assert.equal(
    producer.starts,
    startsBeforeOpenCancellation,
    'a late recovery callback cannot replace a feed that reopened first',
  );

  hub.drop(viewer);
  t.mock.timers.tick(30_000);
  hub.handleMessage(viewer, { type: 'sub-book', symbol: 'BTCUSDT' });
  assert.equal(handles.length, 2, 'an explicit subscription after idle disposal creates one new generation');
  const replacement = handles[1];
  const oldStartsAfterReplacement = producer.starts;
  producer.onStatus(producer.name, 'exhausted');
  t.mock.timers.tick(60_000);
  assert.equal(
    producer.starts,
    oldStartsAfterReplacement,
    'a stale feed-generation callback cannot rearm its disposed producer',
  );
  assert.equal(replacement.starts, 1, 'stale recovery cannot disturb the current feed generation');
  const sentBeforeStaleFrames = viewer.sent.length;
  producer.onMessage({
    stream: 'btcusdt@depth20@100ms',
    data: { lastUpdateId: 43, bids: [['102', '2']], asks: [['103', '3']] },
  });
  producer.onMessage({
    stream: 'btcusdt@aggTrade',
    data: {
      e: 'aggTrade',
      s: 'BTCUSDT',
      a: 43,
      p: '102',
      q: '1',
      T: Date.now(),
      m: false,
    },
  });
  t.mock.timers.tick(250);
  assert.equal(
    viewer.sent.length,
    sentBeforeStaleFrames,
    'disposed-generation frames cannot publish through the replacement feed',
  );

  replacement.onStatus(replacement.name, 'exhausted');
  const startsAtStop = replacement.starts;
  hub.stop();
  t.mock.timers.tick(60_000);
  assert.equal(replacement.starts, startsAtStop, 'hub stop cancels every pending recovery callback');
  replacement.onStatus(replacement.name, 'exhausted');
  t.mock.timers.tick(60_000);
  assert.equal(replacement.starts, startsAtStop, 'late terminal status cannot resurrect a stopped hub');
  assert.equal(activeProducers, 0, 'hub stop owns the final active Book producer');
  assert.equal(peakActiveProducers, 1, 'the complete Book lifecycle never duplicates a producer');
});

test('BookStreamHub retains one bounded recovery after a synchronous restart failure', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let randomHook = () => {};
  const hub = new BookStreamHub(
    (symbol) => symbol === 'BTCUSDT',
    {
      sourceRecoveryBaseMs: 1,
      random: () => {
        randomHook();
        return 0.5;
      },
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          starts: 0,
          stops: 0,
          start() {
            assert.equal(this.active, false, 'a failed Book restart must still follow a stop');
            this.active = true;
            this.starts += 1;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            if (this.starts === 2) throw new Error('synthetic synchronous Book restart failure');
            if (this.starts === 3) onStatus(name, 'open');
          },
          stop() {
            this.stops += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  const viewer = new FakeSocket();
  viewer.open();
  hub.handleMessage(viewer, { type: 'sub-book', symbol: 'BTCUSDT' });
  const producer = handles[0];
  producer.onStatus(producer.name, 'open');
  producer.onStatus(producer.name, 'exhausted');

  t.mock.timers.tick(1);
  const feed = hub.feeds.get('BTCUSDT');
  assert.equal(producer.starts, 2);
  assert.equal(producer.stops, 1);
  assert.equal(feed.status, 'exhausted', 'the current owner restores terminal truth after start throws');
  assert.equal(
    JSON.parse(viewer.sent.at(-1)).status,
    'exhausted',
    'the restored terminal truth is published to the current viewer',
  );
  assert.equal(feed.recoveryAttempt, 2, 'the failed restart retains one next bounded attempt');
  assert.notEqual(feed.recoveryTimer, null, 'the failed restart retains exactly one next timer');
  assert.equal(handles.length, 1, 'the failed restart reuses its existing handle');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1, 'a throwing restart never overlaps Book producers');

  t.mock.timers.tick(2);
  assert.equal(producer.starts, 3);
  assert.equal(producer.stops, 2);
  assert.equal(feed.status, 'open');
  assert.equal(feed.recoveryAttempt, 0, 'open resets the failed-restart backoff');
  assert.equal(feed.recoveryTimer, null, 'open cancels the retained next timer');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  const originalSend = viewer.send.bind(viewer);
  let reopenDuringPublication = true;
  viewer.send = (value, callback) => {
    originalSend(value, callback);
    if (
      reopenDuringPublication
      && JSON.parse(String(value)).status === 'exhausted'
    ) {
      reopenDuringPublication = false;
      producer.onStatus(producer.name, 'open');
    }
  };
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(feed.recoveryAttempt, 0, 'a publication-hook reopen cannot consume an attempt');
  assert.equal(feed.recoveryTimer, null, 'ownership is rechecked after status publication');
  viewer.send = originalSend;

  let reopenDuringRandom = true;
  randomHook = () => {
    if (!reopenDuringRandom) return;
    reopenDuringRandom = false;
    producer.onStatus(producer.name, 'open');
  };
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(feed.recoveryAttempt, 0, 'a random-hook reopen cannot consume an attempt');
  assert.equal(feed.recoveryTimer, null, 'ownership is rechecked after injected random');

  randomHook = () => {};
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  const startsAtStop = producer.starts;
  hub.stop();
  t.mock.timers.tick(60_000);
  assert.equal(producer.starts, startsAtStop, 'hub stop cancels a retained failed-restart timer');
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
});

test('BookStreamHub preserves a newer exhausted status emitted during open publication', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  const hub = new BookStreamHub(
    (symbol) => symbol === 'BTCUSDT',
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          starts: 0,
          stops: 0,
          start() {
            assert.equal(this.active, false, 'reverse-reentrant Book recovery must stop first');
            this.active = true;
            this.starts += 1;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            if (this.starts > 1) onStatus(name, 'open');
          },
          stop() {
            this.stops += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  const viewer = new FakeSocket();
  viewer.open();
  hub.handleMessage(viewer, { type: 'sub-book', symbol: 'BTCUSDT' });
  const producer = handles[0];
  const originalSend = viewer.send.bind(viewer);
  let exhaustDuringOpenPublication = true;
  viewer.send = (value, callback) => {
    originalSend(value, callback);
    if (
      exhaustDuringOpenPublication
      && JSON.parse(String(value)).status === 'open'
    ) {
      exhaustDuringOpenPublication = false;
      producer.onStatus(producer.name, 'exhausted');
    }
  };

  producer.onStatus(producer.name, 'open');
  const feed = hub.feeds.get('BTCUSDT');
  assert.equal(feed.status, 'exhausted', 'the newer current Book status wins over the outer open');
  assert.equal(feed.recoveryAttempt, 1);
  assert.notEqual(feed.recoveryTimer, null, 'the newer exhausted status owns exactly one timer');

  t.mock.timers.tick(1);
  assert.equal(producer.starts, 2);
  assert.equal(producer.stops, 1);
  assert.equal(handles.length, 1);
  assert.equal(feed.status, 'open', 'a later genuine open becomes current');
  assert.equal(feed.recoveryAttempt, 0);
  assert.equal(feed.recoveryTimer, null, 'the later genuine open clears timer and attempt state');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1, 'reverse reentrancy never overlaps Book producers');

  hub.stop();
  assert.equal(activeProducers, 0);
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
  const cuts = [];
  const clock = { value: Date.now(), nowMs() { return this.value; } };
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
    { publicSourceStartupEgressAdmitted: true, clock },
  );
  await engine.init();
  engine.setLiquidationEvidenceObserver((cut) => cuts.push(cut));
  // Drive the private transport boundary without constructing a network
  // socket: the owner lifecycle itself is what this regression exercises.
  engine.running = true;
  engine.generation = 1;
  engine.observeFeedStatus('futures-liquidations', 'open', 1);
  const timestamp = clock.value - 10;
  const first = { e: 'forceOrder', E: timestamp, ps: 'BTCUSDT', st: 1, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', X: 'FILLED', l: '0.5', z: '1.5', q: '1.5', ap: '100', T: timestamp } };
  engine.onLiquidationFrame([
    first,
    first,
    { ...first, o: { ...first.o, ap: '101' } },
    { e: 'forceOrder', E: timestamp + 1, ps: 'BTCUSDT', st: 1, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', X: 'FILLED', l: '0.25', z: '0.75', q: '0.75', ap: '100', T: timestamp + 1 } },
    { e: 'forceOrder', E: timestamp + 2, ps: 'BTCUSDT', st: 1, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', X: 'PARTIALLY_FILLED', z: '1', q: '1', ap: '100', T: timestamp + 2 } },
    { e: 'forceOrder', E: timestamp + 3, ps: 'BTCUSDT', o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', X: 'FILLED', l: '1', z: '1', q: '1', ap: '100', T: timestamp + 3 } },
    { e: 'forceOrder', E: timestamp + 4, ps: 'BTCUSDT', st: 2, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', X: 'FILLED', l: '1', z: '1', q: '1', ap: '100', T: timestamp + 4 } },
  ], 1);
  assert.equal(projected.length, 2);
  assert.equal(projected.reduce((sum, print) => sum + print.notionalUsd, 0), 225);
  const row = engine.rows().find((candidate) => candidate.symbol === 'BTCUSDT');
  assert.equal(row.liquidations15mUsd, 225);
  assert.equal(row.longLiquidations15mUsd, 225);
  assert.equal(row.shortLiquidations15mUsd, null);
  assert.equal(engine.liquidationEventTimestamp('BTCUSDT'), timestamp + 1);
  assert.equal(engine.liquidationEventTimestamp('../BTCUSDT'), null);
  assert.deepEqual(cuts.map((cut) => [cut.kind, cut.generation, cut.revision]), [
    ['FORCE_ORDER', 1, 1],
    ['FORCE_ORDER', 1, 2],
  ]);
  assert.equal(cuts[0].bootstrap, 'CURRENT_SNAPSHOT');
  assert.deepEqual([cuts[0].raw.o.o, cuts[0].raw.o.f], ['LIMIT', 'IOC']);
  assert.equal(Object.isFrozen(cuts[0].raw.o), true);

  engine.observeFeedStatus('futures-liquidations', 'closed', 1);
  assert.equal(engine.liquidationEventTimestamp('BTCUSDT'), null);
  assert.deepEqual([cuts.at(-1).kind, cuts.at(-1).generation, cuts.at(-1).revision], ['SOURCE_CLOSED', 1, 3]);
  engine.onLiquidationFrame({ ...first, E: timestamp + 2, o: { ...first.o, T: timestamp + 2 } }, 1);
  assert.equal(cuts.length, 3, 'closed generations reject late force-order frames');

  engine.observeFeedStatus('futures-liquidations', 'open', 1);
  assert.equal(engine.liquidationEventTimestamp('BTCUSDT'), null, 'a restart cannot reuse a prior-generation observation');
  engine.onLiquidationFrame({ ...first, E: timestamp + 2, o: { ...first.o, q: '1', z: '1', T: timestamp + 2 } }, 1);
  assert.deepEqual([cuts.at(-1).kind, cuts.at(-1).generation, cuts.at(-1).revision], ['FORCE_ORDER', 2, 1]);
  engine.stop();
  assert.deepEqual([cuts.at(-1).kind, cuts.at(-1).generation, cuts.at(-1).revision], ['SOURCE_CLOSED', 2, 2]);
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

test('VolumeRuntime generation-fences continuous recovery after retry-budget exhaustion', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let streamFactoryCalls = 0;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: () => {
        streamFactoryCalls += 1;
        throw new Error('recovery must reuse the existing physical producer');
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  const epoch = runtime.streamEpoch;
  let activeProducers = 1;
  let peakActiveProducers = 1;
  const fake = {
    name: 'volume-aggtrade-1',
    stopCalls: 0,
    startCalls: 0,
    active: true,
    stop() {
      this.stopCalls += 1;
      if (!this.active) return;
      this.active = false;
      activeProducers -= 1;
    },
    start() {
      assert.equal(this.active, false, 'a Volume producer must stop before the same handle restarts');
      this.active = true;
      this.startCalls += 1;
      activeProducers += 1;
      peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
    },
  };
  runtime.streams = [fake];

  // More than the former five-recycle ceiling proves a recovered network can
  // always be observed after an arbitrarily long but bounded retry campaign.
  for (let campaign = 0; campaign < 7; campaign += 1) {
    runtime.onStreamStatus('volume-aggtrade-1', 'closed', generation, epoch);
    runtime.onStreamStatus('volume-aggtrade-1', 'exhausted', generation, epoch);
    runtime.onStreamStatus('volume-aggtrade-1', 'exhausted', generation, epoch);
    t.mock.timers.tick(1_000);
    assert.equal(
      fake.startCalls,
      campaign + 1,
      `retry-budget exhaustion ${campaign + 1} rearms the existing producer`,
    );
    assert.equal(fake.stopCalls, campaign + 1);
    assert.equal(runtime.streams.length, 1, 'recovery never constructs a duplicate producer');
    assert.equal(runtime.streams[0], fake);
    assert.equal(streamFactoryCalls, 0);
    assert.equal(activeProducers, 1);
    assert.equal(peakActiveProducers, 1, 'Volume recovery never overlaps physical producers');
  }

  runtime.onStreamStatus('volume-aggtrade-1', 'open', generation, epoch);
  const startsAfterOpen = fake.startCalls;
  runtime.onStreamStatus('volume-aggtrade-1', 'closed', generation, epoch);
  runtime.onStreamStatus('volume-aggtrade-1', 'exhausted', generation, epoch);
  t.mock.timers.tick(1);
  assert.equal(
    fake.startCalls,
    startsAfterOpen + 1,
    'open resets recovery backoff to the injected base delay',
  );

  runtime.onStreamStatus('volume-aggtrade-1', 'open', generation, epoch);
  const startsBeforeOpenCancellation = fake.startCalls;
  runtime.onStreamStatus('volume-aggtrade-1', 'closed', generation, epoch);
  runtime.onStreamStatus('volume-aggtrade-1', 'exhausted', generation, epoch);
  runtime.onStreamStatus('volume-aggtrade-1', 'open', generation, epoch);
  t.mock.timers.tick(60_000);
  assert.equal(
    fake.startCalls,
    startsBeforeOpenCancellation,
    'a late recovery callback cannot replace a stream that reopened first',
  );

  runtime.onStreamStatus('volume-aggtrade-1', 'closed', generation, epoch);
  runtime.onStreamStatus('volume-aggtrade-1', 'exhausted', generation, epoch);
  const startsAtStop = fake.startCalls;
  runtime.stop();
  t.mock.timers.tick(60_000);
  assert.equal(fake.startCalls, startsAtStop, 'runtime stop cancels every pending recovery callback');
  runtime.onStreamStatus('volume-aggtrade-1', 'exhausted', generation, epoch);
  t.mock.timers.tick(60_000);
  assert.equal(fake.startCalls, startsAtStop, 'late terminal status cannot resurrect a stopped runtime');
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1, 'the complete Volume lifecycle never duplicates a producer');
});

test('VolumeRuntime registers synchronous terminal status before start returns and fences its timer epoch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            assert.equal(this.active, false, 'synchronous start cannot overlap its prior producer');
            this.active = true;
            this.startCalls += 1;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            onStatus(name, 'exhausted');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  runtime.restartTradeStreams(['BTCUSDT'], generation);
  const epoch = runtime.streamEpoch;
  const producer = handles[0];

  assert.equal(handles.length, 1);
  assert.equal(runtime.streams[0], producer, 'the handle is registered before start emits status');
  assert.equal(runtime.streamRecoveryTimers.size, 1, 'synchronous exhaustion owns one recovery timer');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(runtime.streamRecoveryTimers.size, 1, 'duplicate terminal status cannot stack timers');

  t.mock.timers.tick(1);
  assert.equal(producer.stopCalls, 1);
  assert.equal(producer.startCalls, 2);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1, 'stop precedes every synchronous recovery start');
  assert.equal(handles.length, 1, 'supervisory recovery reuses the registered producer');
  assert.equal(runtime.streamRecoveryTimers.size, 1, 'the next terminal campaign owns one timer');

  const startsBeforeEpochChange = producer.startCalls;
  runtime.streamEpoch += 1;
  t.mock.timers.tick(60_000);
  assert.equal(
    producer.startCalls,
    startsBeforeEpochChange,
    'a captured recovery timer cannot cross its monotonically advanced stream epoch',
  );
  runtime.stop();
  assert.equal(activeProducers, 0);
});

test('VolumeRuntime retains one bounded recovery after a synchronous restart failure', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let randomHook = () => {};
  let logHook = () => {};
  let runtime;
  runtime = new VolumeRuntime(
    { logEvent: (kind) => logHook(kind) },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => {
        randomHook();
        return 0.5;
      },
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            assert.equal(this.active, false, 'a failed Volume restart must still follow a stop');
            this.active = true;
            this.startCalls += 1;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            if (this.startCalls === 2) throw new Error('synthetic synchronous Volume restart failure');
            if (this.startCalls === 3) onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  runtime.restartTradeStreams(['BTCUSDT'], generation);
  const epoch = runtime.streamEpoch;
  const producer = handles[0];
  producer.onStatus(producer.name, 'open');
  producer.onStatus(producer.name, 'exhausted');

  t.mock.timers.tick(1);
  assert.equal(producer.startCalls, 2);
  assert.equal(producer.stopCalls, 1);
  assert.equal(runtime.streamStatus.get(producer.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(producer.name), 2);
  assert.equal(runtime.streamRecoveryTimers.size, 1, 'the failed restart retains exactly one next timer');
  assert.equal(runtime.streams[0], producer, 'the failed restart retains its exact handle');
  assert.equal(handles.length, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1, 'a throwing restart never overlaps Volume producers');

  t.mock.timers.tick(2);
  assert.equal(producer.startCalls, 3);
  assert.equal(producer.stopCalls, 2);
  assert.equal(runtime.streamStatus.get(producer.name), 'open');
  assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false, 'open resets failed-restart backoff');
  assert.equal(runtime.streamRecoveryTimers.size, 0, 'open cancels the retained next timer');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  let reopenDuringLog = true;
  logHook = (kind) => {
    if (kind !== 'ws.exhausted' || !reopenDuringLog) return;
    reopenDuringLog = false;
    producer.onStatus(producer.name, 'open');
  };
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false);
  assert.equal(runtime.streamRecoveryTimers.size, 0, 'ownership is rechecked after lifecycle logging');
  logHook = () => {};

  let reopenDuringRandom = true;
  randomHook = () => {
    if (!reopenDuringRandom) return;
    reopenDuringRandom = false;
    producer.onStatus(producer.name, 'open');
  };
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false);
  assert.equal(runtime.streamRecoveryTimers.size, 0, 'ownership is rechecked after injected random');

  randomHook = () => {};
  producer.onStatus(producer.name, 'closed');
  producer.onStatus(producer.name, 'exhausted');
  const startsAtStop = producer.startCalls;
  runtime.stop();
  t.mock.timers.tick(60_000);
  assert.equal(producer.startCalls, startsAtStop, 'runtime stop cancels a retained failed-restart timer');
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
});

test('VolumeRuntime preserves a newer exhausted status emitted during open logging', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let logHook = () => {};
  const runtime = new VolumeRuntime(
    { logEvent: (kind) => logHook(kind) },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            assert.equal(this.active, false, 'reverse-reentrant Volume recovery must stop first');
            this.active = true;
            this.startCalls += 1;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            if (this.startCalls > 1) onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  runtime.restartTradeStreams(['BTCUSDT'], generation);
  const epoch = runtime.streamEpoch;
  const producer = handles[0];
  let exhaustDuringOpenLog = true;
  logHook = (kind) => {
    if (kind !== 'ws.open' || !exhaustDuringOpenLog) return;
    exhaustDuringOpenLog = false;
    producer.onStatus(producer.name, 'exhausted');
  };

  producer.onStatus(producer.name, 'open');
  assert.equal(
    runtime.streamStatus.get(producer.name),
    'exhausted',
    'the newer current Volume status wins over the outer open',
  );
  assert.equal(runtime.streamRecoveryAttempts.get(producer.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1, 'the newer exhausted status owns one timer');

  t.mock.timers.tick(1);
  assert.equal(producer.startCalls, 2);
  assert.equal(producer.stopCalls, 1);
  assert.equal(handles.length, 1);
  assert.equal(runtime.streamStatus.get(producer.name), 'open');
  assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false);
  assert.equal(runtime.streamRecoveryTimers.size, 0, 'the later genuine open clears recovery state');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1, 'reverse reentrancy never overlaps Volume producers');

  runtime.stop();
  assert.equal(activeProducers, 0);
});

test('VolumeRuntime stops rearm when logging reports the current producer open', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let logHook = () => {};
  const runtime = new VolumeRuntime(
    { logEvent: (kind) => logHook(kind) },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            assert.equal(this.active, false, 'rearm cannot overlap a current Volume producer');
            this.active = true;
            this.startCalls += 1;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  runtime.restartTradeStreams(['BTCUSDT'], generation);
  const producer = handles[0];
  producer.onStatus(producer.name, 'open');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(producer.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);

  let reopenDuringRearmLog = true;
  logHook = (kind) => {
    if (kind !== 'ws.rearm' || !reopenDuringRearmLog) return;
    reopenDuringRearmLog = false;
    producer.onStatus(producer.name, 'open');
  };
  const startsBeforeRecovery = producer.startCalls;
  const stopsBeforeRecovery = producer.stopCalls;

  t.mock.timers.tick(1);
  assert.equal(producer.startCalls, startsBeforeRecovery, 'a newer open prevents the stale rearm start');
  assert.equal(producer.stopCalls, stopsBeforeRecovery, 'a newer open prevents the stale rearm stop');
  assert.equal(runtime.streamStatus.get(producer.name), 'open');
  assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false, 'open clears the rearm attempt');
  assert.equal(runtime.streamRecoveryTimers.size, 0, 'open leaves no recovery timer');
  assert.equal(runtime.streams[0], producer, 'the current handle remains registered');
  assert.equal(handles.length, 1, 'rearm does not create a duplicate producer');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.equal(producer.stopCalls, stopsBeforeRecovery + 1, 'runtime stop still owns final cleanup');
  assert.equal(activeProducers, 0);
});

function runBookPostStopReentrancy(t, nestedStatus) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let duplicateStarts = 0;
  let nestedStart = false;
  const hub = new BookStreamHub(
    (symbol) => symbol === 'BTCUSDT',
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          starts: 0,
          stops: 0,
          start() {
            this.starts += 1;
            if (this.active) {
              duplicateStarts += 1;
              return;
            }
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            if (nestedStart) onStatus(name, nestedStatus);
          },
          stop() {
            this.stops += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  const viewer = new FakeSocket();
  viewer.open();
  hub.handleMessage(viewer, { type: 'sub-book', symbol: 'BTCUSDT' });
  const producer = handles[0];
  const feed = hub.feeds.get('BTCUSDT');
  const originalSend = viewer.send.bind(viewer);
  let reenterOnClosed = true;
  viewer.send = (value, callback) => {
    originalSend(value, callback);
    if (
      !reenterOnClosed
      || JSON.parse(String(value)).status !== 'closed'
    ) return;
    reenterOnClosed = false;
    nestedStart = true;
    producer.start();
  };

  producer.onStatus(producer.name, 'open');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(feed.recoveryAttempt, 1);
  assert.notEqual(feed.recoveryTimer, null);

  t.mock.timers.tick(1);
  assert.equal(producer.starts, 2, 'only the closed-publication hook may restart the producer');
  assert.equal(producer.stops, 1);
  assert.equal(duplicateStarts, 0, 'the outer Book recovery cannot duplicate a nested start');
  assert.equal(hub.feeds.get('BTCUSDT'), feed);
  assert.equal(feed.stream, producer);
  assert.equal(handles.length, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  if (nestedStatus === 'open') {
    assert.equal(feed.status, 'open');
    assert.equal(feed.recoveryAttempt, 0);
    assert.equal(feed.recoveryTimer, null, 'nested open clears all recovery ownership');
  } else {
    assert.equal(feed.status, 'exhausted');
    assert.equal(feed.recoveryAttempt, 2, 'nested exhaustion owns the next bounded attempt');
    assert.notEqual(feed.recoveryTimer, null, 'nested exhaustion retains exactly one next timer');
  }

  hub.stop();
  assert.equal(producer.stops, 2);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
}

test('BookStreamHub post-stop reentrancy defers to a nested open producer', (t) => {
  runBookPostStopReentrancy(t, 'open');
});

test('BookStreamHub post-stop reentrancy defers to a nested exhausted timer owner', (t) => {
  runBookPostStopReentrancy(t, 'exhausted');
});

function runVolumePostStopReentrancy(t, nestedStatus) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let duplicateStarts = 0;
  let nestedStart = false;
  let reenterOnClosed = true;
  let producer;
  const runtime = new VolumeRuntime(
    {
      logEvent(kind) {
        if (kind !== 'ws.closed' || !reenterOnClosed) return;
        reenterOnClosed = false;
        nestedStart = true;
        producer.start();
      },
    },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (this.active) {
              duplicateStarts += 1;
              return;
            }
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'connecting');
            if (nestedStart) onStatus(name, nestedStatus);
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            onStatus(name, 'closed');
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  runtime.restartTradeStreams(['BTCUSDT'], generation);
  const epoch = runtime.streamEpoch;
  producer = handles[0];
  producer.onStatus(producer.name, 'open');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(producer.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);

  t.mock.timers.tick(1);
  assert.equal(producer.startCalls, 2, 'only the ws.closed log hook may restart the producer');
  assert.equal(producer.stopCalls, 1);
  assert.equal(duplicateStarts, 0, 'the outer Volume recovery cannot duplicate a nested start');
  assert.equal(runtime.streams[0], producer);
  assert.equal(handles.length, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  if (nestedStatus === 'open') {
    assert.equal(runtime.streamStatus.get(producer.name), 'open');
    assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false);
    assert.equal(runtime.streamRecoveryTimers.size, 0, 'nested open clears all recovery ownership');
  } else {
    assert.equal(runtime.streamStatus.get(producer.name), 'exhausted');
    assert.equal(
      runtime.streamRecoveryAttempts.get(producer.name),
      2,
      'nested exhaustion owns the next bounded attempt',
    );
    assert.equal(runtime.streamRecoveryTimers.size, 1, 'nested exhaustion retains exactly one next timer');
  }

  runtime.stop();
  assert.equal(producer.stopCalls, 2);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
}

test('VolumeRuntime post-stop reentrancy defers to a nested open producer', (t) => {
  runVolumePostStopReentrancy(t, 'open');
});

test('VolumeRuntime post-stop reentrancy defers to a nested exhausted timer owner', (t) => {
  runVolumePostStopReentrancy(t, 'exhausted');
});

test('VolumeRuntime duplicate exhausted reacquires recovery during a silent reentrant stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let duplicateStarts = 0;
  let reenterOnStop = false;
  let nextStartStatus = null;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (this.active) {
              duplicateStarts += 1;
              return;
            }
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            const status = nextStartStatus;
            nextStartStatus = null;
            if (status) onStatus(name, status);
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            if (!reenterOnStop) return;
            reenterOnStop = false;
            nextStartStatus = 'exhausted';
            this.start();
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  runtime.restartTradeStreams(['BTCUSDT'], generation);
  const producer = handles[0];
  producer.onStatus(producer.name, 'open');
  producer.onStatus(producer.name, 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(producer.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);

  reenterOnStop = true;
  t.mock.timers.tick(1);
  assert.equal(producer.stopCalls, 1);
  assert.equal(producer.startCalls, 2, 'only the stop hook performs the immediate terminal start');
  assert.equal(duplicateStarts, 0, 'the outer recovery defers to duplicate exhausted timer ownership');
  assert.equal(runtime.streamStatus.get(producer.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(producer.name), 2);
  assert.equal(runtime.streamRecoveryTimers.size, 1, 'duplicate exhausted reacquires exactly one timer');
  assert.equal(runtime.streams[0], producer);
  assert.equal(handles.length, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  nextStartStatus = 'open';
  t.mock.timers.tick(2);
  assert.equal(producer.stopCalls, 2, 'the next bounded turn performs one silent stop');
  assert.equal(producer.startCalls, 3, 'silent stop with no status preserves direct outer restart');
  assert.equal(duplicateStarts, 0);
  assert.equal(runtime.streamStatus.get(producer.name), 'open');
  assert.equal(runtime.streamRecoveryAttempts.has(producer.name), false);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streams[0], producer);
  assert.equal(handles.length, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.equal(producer.stopCalls, 3);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
});

test('VolumeRuntime rolls back every registered multi-chunk stream after a later start failure', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `S${String(index).padStart(3, '0')}USDT`,
  );
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (handles.indexOf(this) === 1) {
              throw new Error('synthetic second chunk start failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'exhausted');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.eligibleSymbolSet.add(symbols[0]);
  runtime.engine.onTrade = () => true;
  const generation = runtime.generation;
  const epochBeforeRestart = runtime.streamEpoch;

  assert.throws(
    () => runtime.restartTradeStreams(symbols, generation),
    /synthetic second chunk start failure/,
  );
  assert.equal(handles.length, 2, '141 symbols create the 140-plus-1 stream chunks');
  assert.equal(handles[0].name, 'volume-aggtrade-1');
  assert.equal(handles[1].name, 'volume-aggtrade-2');
  assert.equal(handles[0].url.split('@aggTrade').length - 1, 140);
  assert.equal(handles[1].url.split('@aggTrade').length - 1, 1);
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1, 1]);
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [1, 1]);
  assert.equal(activeProducers, 0, 'rollback stops the first active registered producer');
  assert.equal(peakActiveProducers, 1);
  assert.equal(
    runtime.streamEpoch,
    epochBeforeRestart + 2,
    'entry and rollback each advance the callback ownership epoch',
  );
  assert.deepEqual(runtime.streams, [], 'rollback removes every registered handle');
  assert.equal(runtime.streamStatus.size, 0);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);

  const first = handles[0];
  first.onStatus(first.name, 'exhausted');
  first.onMessage({
    e: 'aggTrade',
    E: 1_000,
    s: symbols[0],
    a: 1,
    p: '1',
    q: '1',
    f: 1,
    l: 1,
    T: 1_000,
    m: false,
  });
  t.mock.timers.tick(60_000);

  assert.deepEqual(handles.map((handle) => handle.startCalls), [1, 1]);
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [1, 1]);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStatus.size, 0, 'stale terminal status cannot repopulate rollback state');
  assert.equal(runtime.streamRecoveryTimers.size, 0, 'rollback leaves no delayed resurrection');
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
  assert.equal(runtime.tradeMessages, 0, 'stale messages cannot mutate trade state after rollback');
  assert.equal(runtime.lastAggTradeId.size, 0);
  assert.equal(runtime.lastRawTradeId.size, 0);
});

test('VolumeRuntime multi-handle reentrancy stops the start loop when runtime stop wins', () => {
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `T${String(index).padStart(3, '0')}USDT`,
  );
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let stopDuringFirstOpen = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind) {
        if (kind !== 'ws.open' || !stopDuringFirstOpen) return;
        stopDuringFirstOpen = false;
        runtime.stop();
      },
    },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            if (creationIndex === 0) onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  const epochBeforeRestart = runtime.streamEpoch;

  runtime.restartTradeStreams(symbols, generation);
  assert.equal(handles.length, 1, 'B is never constructed after stop wins the incremental turn');
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1]);
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2]);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.running, false);
  assert.equal(runtime.streamEpoch, epochBeforeRestart + 2);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStatus.size, 0);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime multi-handle reentrancy preserves a replacement when the stale turn throws', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const outerSymbols = Array.from(
    { length: 141 },
    (_, index) => `U${String(index).padStart(3, '0')}USDT`,
  );
  const replacementSymbols = ['REPLUSDT'];
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installReplacement = true;
  let runtime;
  let generation;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.open'
          || payload.feed !== 'volume-aggtrade-2'
          || !installReplacement
        ) return;
        installReplacement = false;
        runtime.restartTradeStreams(replacementSymbols, generation);
      },
    },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (creationIndex === 1) {
              onStatus(name, 'open');
              throw new Error('synthetic stale B start failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, creationIndex === 2 ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  generation = runtime.generation;
  runtime.eligibleSymbolSet.add(outerSymbols[0]);
  runtime.eligibleSymbolSet.add(outerSymbols[140]);
  runtime.engine.onTrade = () => true;
  const epochBeforeRestart = runtime.streamEpoch;

  assert.doesNotThrow(
    () => runtime.restartTradeStreams(outerSymbols, generation),
    'a turn displaced by replacement C retires its stale B failure',
  );
  assert.equal(handles.length, 3, 'outer A/B and the reentrant replacement C are registered');
  const [first, second, replacement] = handles;
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1, 1, 1]);
  assert.deepEqual(
    handles.map((handle) => handle.stopCalls),
    [2, 2, 0],
    'replacement install and stale catch each stop only old A/B',
  );
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(
    runtime.streamEpoch,
    epochBeforeRestart + 2,
    'the stale catch cannot advance the replacement epoch',
  );
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.streamStatus.size, 1);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);

  first.onStatus(first.name, 'open');
  second.onStatus(second.name, 'exhausted');
  first.onMessage({
    e: 'aggTrade',
    E: 1_000,
    s: outerSymbols[0],
    a: 1,
    p: '1',
    q: '1',
    f: 1,
    l: 1,
    T: 1_000,
    m: false,
  });
  second.onMessage({
    e: 'aggTrade',
    E: 1_000,
    s: outerSymbols[140],
    a: 2,
    p: '1',
    q: '1',
    f: 2,
    l: 2,
    T: 1_000,
    m: false,
  });
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.tradeMessages, 0, 'stale A/B messages cannot mutate replacement state');
  assert.equal(runtime.lastAggTradeId.size, 0);
  assert.equal(runtime.lastRawTradeId.size, 0);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2, 2, 1]);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStatus.size, 0);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime public start retires a stale multi-handle failure after replacement wins', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const outerSymbols = Array.from(
    { length: 141 },
    (_, index) => `V${String(index).padStart(3, '0')}USDT`,
  );
  const universe = outerSymbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));
  const replacementSymbols = ['REPLUSDT'];
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installReplacement = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.open'
          || payload.feed !== 'volume-aggtrade-2'
          || !installReplacement
        ) return;
        installReplacement = false;
        runtime.restartTradeStreams(replacementSymbols, runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (creationIndex === 1) {
              onStatus(name, 'open');
              throw new Error('synthetic stale public B start failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, creationIndex === 2 ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};
  runtime.engine.onTrade = () => true;

  await runtime.start();
  assert.equal(runtime.running, true, 'stale B failure cannot stop the public runtime owner');
  assert.equal(runtime.startPromise, null);
  assert.equal(handles.length, 3);
  const [first, second, replacement] = handles;
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1, 1, 1]);
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2, 2, 0]);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streamEpoch, 2, 'public owner retains replacement C epoch');
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.streamStatus.size, 1);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.streamRetryTimer, null, 'retired stale errors cannot schedule universe retry');
  assert.equal(runtime.streamRetryMs, 1_000);

  first.onStatus(first.name, 'open');
  second.onStatus(second.name, 'exhausted');
  first.onMessage({
    e: 'aggTrade',
    E: 1_000,
    s: outerSymbols[0],
    a: 1,
    p: '1',
    q: '1',
    f: 1,
    l: 1,
    T: 1_000,
    m: false,
  });
  second.onMessage({
    e: 'aggTrade',
    E: 1_000,
    s: outerSymbols[140],
    a: 2,
    p: '1',
    q: '1',
    f: 2,
    l: 2,
    T: 1_000,
    m: false,
  });
  assert.equal(runtime.running, true);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(runtime.tradeMessages, 0);
  assert.equal(runtime.lastAggTradeId.size, 0);
  assert.equal(runtime.lastRawTradeId.size, 0);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2, 2, 1]);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.running, false);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStatus.size, 0);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
  assert.equal(runtime.streamRetryTimer, null);
});

test('VolumeRuntime ownership follow-through leaves no stale key and rebuilds after reentrant stop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `W${String(index).padStart(3, '0')}USDT`,
  );
  const universe = symbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));
  const handles = [];
  let activeProducers = 0;
  let stopDuringFirstOpen = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.open'
          || payload.feed !== 'volume-aggtrade-1'
          || !stopDuringFirstOpen
        ) return;
        stopDuringFirstOpen = false;
        runtime.stop();
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  assert.equal(runtime.running, false);
  assert.equal(runtime.symbolSetKey, '', 'the stopped restart cannot commit its outer universe key');
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(handles.length, 1, 'stopped first turn never constructs its second chunk');
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1]);
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2]);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStatus.size, 0);

  await runtime.start();
  assert.equal(runtime.running, true);
  assert.equal(handles.length, 3, 'a second public start rebuilds both physical chunks');
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1, 1, 1]);
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2, 0, 0]);
  assert.equal(runtime.streams.length, 2);
  assert.equal(runtime.streams[0], handles[1]);
  assert.equal(runtime.streams[1], handles[2]);
  assert.equal(runtime.streamStatus.get(handles[1].name), 'open');
  assert.equal(runtime.streamStatus.get(handles[2].name), 'open');
  assert.equal(runtime.symbolSetKey, symbols.join(','));
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(activeProducers, 2);

  runtime.stop();
  assert.deepEqual(handles.map((handle) => handle.stopCalls), [2, 1, 1]);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime ownership follow-through preserves a replacement that reuses old handle A', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `X${String(index).padStart(3, '0')}USDT`,
  );
  const universe = symbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));
  const handles = [];
  let factoryCalls = 0;
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installReplacement = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.open'
          || payload.feed !== 'volume-aggtrade-2'
          || !installReplacement
        ) return;
        installReplacement = false;
        runtime.restartTradeStreams(['REPLUSDT'], runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = factoryCalls;
        factoryCalls += 1;
        if (creationIndex === 2) {
          const reused = handles[0];
          reused.name = name;
          reused.url = url;
          reused.onMessage = onMessage;
          reused.onStatus = onStatus;
          reused.replacement = true;
          return reused;
        }
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          replacement: false,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (creationIndex === 1) {
              this.onStatus(this.name, 'open');
              throw new Error('synthetic stale reused-handle B failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            this.onStatus(this.name, this.replacement ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  const [reused, second] = handles;
  assert.equal(factoryCalls, 3);
  assert.equal(runtime.running, true);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], reused);
  assert.equal(reused.active, true);
  assert.equal(reused.startCalls, 2);
  assert.equal(reused.stopCalls, 1, 'stale catch skips A because replacement C reuses its identity');
  assert.equal(second.startCalls, 1);
  assert.equal(second.stopCalls, 2);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streamStatus.get(reused.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(reused.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.symbolSetKey, '');
  assert.equal(runtime.streamRetryTimer, null);

  runtime.stop();
  assert.equal(reused.stopCalls, 2, 'runtime stop owns the reused replacement final cleanup');
  assert.equal(second.stopCalls, 2);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime ownership follow-through contains stale cleanup throws around fresh C', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `Y${String(index).padStart(3, '0')}USDT`,
  );
  const universe = symbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installReplacement = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.open'
          || payload.feed !== 'volume-aggtrade-2'
          || !installReplacement
        ) return;
        installReplacement = false;
        runtime.restartTradeStreams(['REPLUSDT'], runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (creationIndex === 1) {
              onStatus(name, 'open');
              throw new Error('synthetic stale cleanup B failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, creationIndex === 2 ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (creationIndex === 0 && this.stopCalls === 2) {
              throw new Error('synthetic stale A cleanup failure');
            }
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  const [first, second, replacement] = handles;
  assert.equal(runtime.running, true);
  assert.deepEqual(handles.map((handle) => handle.startCalls), [1, 1, 1]);
  assert.deepEqual(
    handles.map((handle) => handle.stopCalls),
    [2, 2, 0],
    'cleanup continues through B after stale A stop throws',
  );
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.symbolSetKey, '');
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(first.active, false);
  assert.equal(second.active, false);
  assert.equal(replacement.active, true);

  runtime.stop();
  assert.deepEqual(
    handles.map((handle) => handle.stopCalls),
    [3, 2, 1],
    'runtime stop retries quarantined A alongside replacement C',
  );
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime retry ownership follow-through does not commit a superseded retry key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const intendedSymbols = ['Z000USDT'];
  const intendedKey = intendedSymbols.join(',');
  const universe = [{
    symbol: intendedSymbols[0],
    base: 'Z000',
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }];
  const handles = [];
  let activeProducers = 0;
  let installReplacement = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind) {
        if (kind !== 'ws.open' || !installReplacement) return;
        installReplacement = false;
        runtime.restartTradeStreams(['REPLUSDT'], runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            onStatus(name, creationIndex === 1 ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.eligibleSymbols = intendedSymbols;
  runtime.eligibleSymbolSet = new Set(intendedSymbols);
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};
  const generation = runtime.generation;

  runtime.scheduleStreamRetry(intendedSymbols, intendedKey, generation);
  t.mock.timers.tick(1_000);
  assert.equal(handles.length, 2);
  const replacement = handles[1];
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.symbolSetKey, '', 'superseded retry cannot commit its outer key');
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(runtime.streamRetryMs, 2_000, 'false retry disposition is not cleared as a success');
  assert.equal(activeProducers, 1);

  await runtime.refreshUniverse(generation);
  assert.equal(handles.length, 3, 'uncommitted key allows the next intended refresh to rebuild');
  const intended = handles[2];
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], intended);
  assert.equal(runtime.streamStatus.get(intended.name), 'open');
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
  assert.equal(runtime.symbolSetKey, intendedKey);
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(runtime.streamRetryMs, 1_000);
  assert.equal(activeProducers, 1);

  runtime.stop();
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime dynamic stale cleanup preserves later owner D that reuses old B', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `Q${String(index).padStart(3, '0')}USDT`,
  );
  const universe = symbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));
  const handles = [];
  let factoryCalls = 0;
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installC = true;
  let installD = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.open'
          || payload.feed !== 'volume-aggtrade-2'
          || !installC
        ) return;
        installC = false;
        runtime.restartTradeStreams(['CPLUSDT'], runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = factoryCalls;
        factoryCalls += 1;
        if (creationIndex === 3) {
          const reused = handles[1];
          reused.name = name;
          reused.url = url;
          reused.onMessage = onMessage;
          reused.onStatus = onStatus;
          reused.role = 'D';
          return reused;
        }
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          role: creationIndex === 0 ? 'A' : creationIndex === 1 ? 'B' : 'C',
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (this.role === 'B') {
              this.onStatus(this.name, 'open');
              throw new Error('synthetic stale dynamic B failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            this.onStatus(this.name, this.role === 'A' ? 'open' : 'exhausted');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            if (this.role !== 'A' || this.stopCalls !== 2 || !installD) return;
            installD = false;
            runtime.restartTradeStreams(['DPLUSDT'], runtime.generation);
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  assert.equal(factoryCalls, 4);
  assert.equal(handles.length, 3);
  const [first, reused, third] = handles;
  assert.equal(runtime.running, true);
  assert.equal(first.stopCalls, 2);
  assert.equal(third.stopCalls, 1, 'installing D stops superseded C');
  assert.equal(reused.role, 'D');
  assert.equal(reused.startCalls, 2);
  assert.equal(reused.stopCalls, 1, 'dynamic cleanup check skips B after it becomes current D');
  assert.equal(reused.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], reused);
  assert.equal(runtime.streamStatus.get(reused.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(reused.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.symbolSetKey, '');
  assert.equal(runtime.streamRetryTimer, null);

  runtime.stop();
  assert.equal(reused.stopCalls, 2, 'runtime stop owns D final cleanup');
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime transactional restart entry preserves D installed by old A stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let factoryCalls = 0;
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installD = false;
  let runtime;
  let generation;
  let reused;
  runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const call = factoryCalls;
        factoryCalls += 1;
        if (call === 1) {
          reused.name = name;
          reused.url = url;
          reused.onMessage = onMessage;
          reused.onStatus = onStatus;
          reused.role = 'D';
          return reused;
        }
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          role: 'A',
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            this.onStatus(this.name, this.role === 'D' ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            if (!installD) return;
            installD = false;
            runtime.restartTradeStreams(['DPLUSDT'], generation);
          },
        };
        reused = handle;
        return handle;
      },
    },
  );
  runtime.running = true;
  generation = runtime.generation;
  assert.equal(runtime.restartTradeStreams(['APLUSDT'], generation), true);
  assert.equal(factoryCalls, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  installD = true;
  assert.equal(
    runtime.restartTradeStreams(['OUTERUSDT'], generation),
    false,
    'the entry turn retires after predecessor A stop installs D',
  );
  assert.equal(factoryCalls, 2, 'superseded outer turn never reaches its factory');
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], reused);
  assert.equal(runtime.streamOwnershipKey, 'DPLUSDT');
  assert.equal(reused.role, 'D');
  assert.equal(reused.active, true);
  assert.equal(reused.startCalls, 2);
  assert.equal(reused.stopCalls, 1);
  assert.equal(runtime.streamStatus.get(reused.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(reused.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.equal(reused.stopCalls, 2);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime transactional restart rollback preserves D installed by A cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `R${String(index).padStart(3, '0')}USDT`,
  );
  const universe = symbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));
  const handles = [];
  let factoryCalls = 0;
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installD = true;
  let runtime;
  runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = factoryCalls;
        factoryCalls += 1;
        if (creationIndex === 2) {
          const reused = handles[1];
          reused.name = name;
          reused.url = url;
          reused.onMessage = onMessage;
          reused.onStatus = onStatus;
          reused.role = 'D';
          return reused;
        }
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          role: creationIndex === 0 ? 'A' : 'B',
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (this.role === 'B') {
              throw new Error('synthetic authoritative B failure');
            }
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            this.onStatus(this.name, this.role === 'D' ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            if (this.role !== 'A' || !installD) return;
            installD = false;
            runtime.restartTradeStreams(['DPLUSDT'], runtime.generation);
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  assert.equal(factoryCalls, 3);
  assert.equal(handles.length, 2);
  const [first, reused] = handles;
  assert.equal(runtime.running, true, 'rollback supersession retires the original B error');
  assert.equal(first.stopCalls, 1);
  assert.equal(reused.role, 'D');
  assert.equal(reused.startCalls, 2);
  assert.equal(reused.stopCalls, 0, 'dynamic rollback cleanup skips B after it becomes current D');
  assert.equal(reused.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], reused);
  assert.equal(runtime.streamOwnershipKey, 'DPLUSDT');
  assert.equal(runtime.streamStatus.get(reused.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(reused.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.symbolSetKey, '');
  assert.equal(runtime.streamRetryTimer, null);

  runtime.stop();
  assert.equal(reused.stopCalls, 1);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
});

test('VolumeRuntime final ownership boundary contains a stale factory return after replacement', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let factoryCalls = 0;
  let activeProducers = 0;
  let nestedInstalled = false;
  let runtime;
  runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = factoryCalls;
        factoryCalls += 1;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            onStatus(name, creationIndex === 1 ? 'exhausted' : 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        if (creationIndex === 0) {
          runtime.stop();
          runtime.running = true;
          nestedInstalled = runtime.restartTradeStreams(['DPLUSDT'], runtime.generation);
          runtime.symbolSetKey = 'DPLUSDT';
        }
        return handle;
      },
    },
  );
  runtime.running = true;
  const outerGeneration = runtime.generation;

  assert.equal(runtime.restartTradeStreams(['OUTERUSDT'], outerGeneration), false);
  assert.equal(nestedInstalled, true);
  assert.equal(handles.length, 2);
  const [stale, replacement] = handles;
  assert.equal(stale.startCalls, 0, 'stale factory return is never started');
  assert.equal(stale.stopCalls, 1, 'stale factory return is best-effort cleaned');
  assert.equal(replacement.startCalls, 1);
  assert.equal(replacement.stopCalls, 0);
  assert.equal(replacement.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.symbolSetKey, 'DPLUSDT');
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);

  runtime.stop();
  assert.equal(replacement.stopCalls, 1);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime final ownership boundary retains a predecessor whose stop throws', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let factoryCalls = 0;
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let producer;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        factoryCalls += 1;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.stopCalls === 1) throw new Error('synthetic predecessor stop failure');
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        producer = handle;
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;
  assert.equal(runtime.restartTradeStreams(['APLUSDT'], generation), true);

  assert.throws(
    () => runtime.restartTradeStreams(['BPLUSDT'], generation),
    /synthetic predecessor stop failure/,
  );
  assert.equal(factoryCalls, 1, 'predecessor failure aborts before replacement construction');
  assert.equal(producer.startCalls, 1);
  assert.equal(producer.stopCalls, 1);
  assert.equal(producer.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], producer, 'failed live predecessor remains registered');
  assert.equal(runtime.streamStatus.size, 0);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);

  producer.onStatus(producer.name, 'exhausted');
  t.mock.timers.tick(60_000);
  assert.equal(producer.startCalls, 1, 'failed predecessor callbacks remain epoch-fenced');
  assert.equal(runtime.streamRecoveryTimers.size, 0);

  runtime.stop();
  assert.equal(producer.stopCalls, 2, 'public stop retries the retained predecessor');
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime final ownership boundary retains an owned start whose rollback stop throws', () => {
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let producer;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            throw new Error('synthetic authoritative start failure');
          },
          stop() {
            this.stopCalls += 1;
            if (this.stopCalls === 1) throw new Error('synthetic rollback stop failure');
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        producer = handle;
        return handle;
      },
    },
  );
  runtime.running = true;
  const generation = runtime.generation;

  assert.throws(
    () => runtime.restartTradeStreams(['APLUSDT'], generation),
    /synthetic authoritative start failure/,
    'owned rollback rethrows the original start error',
  );
  assert.equal(producer.startCalls, 1);
  assert.equal(producer.stopCalls, 1);
  assert.equal(producer.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], producer, 'rollback stop failure remains registered');
  assert.equal(runtime.streamStatus.size, 0);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.streamRecoveryAttempts.size, 0);
  assert.equal(runtime.streamRetryTimer, null);

  runtime.stop();
  assert.equal(producer.stopCalls, 2);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime final ownership boundary preserves D installed by start error logging until empty teardown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let universe = [{
    symbol: 'APLUSDT',
    base: 'APL',
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }];
  const handles = [];
  let activeProducers = 0;
  let installD = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'error_event'
          || payload.source !== 'volume-runtime.start'
          || !installD
        ) return;
        installD = false;
        runtime.restartTradeStreams(['DPLUSDT'], runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (creationIndex === 0) throw new Error('synthetic public owned start failure');
            this.active = true;
            activeProducers += 1;
            onStatus(name, 'exhausted');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  assert.equal(handles.length, 2);
  const replacement = handles[1];
  assert.equal(runtime.running, true);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(replacement.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.streamRetryTimer, null, 'unchanged stale universe retry is cancelled');
  assert.equal(runtime.streamRetryMs, 1_000, 'stale universe retry cancellation resets backoff');
  assert.equal(runtime.symbolSetKey, '');

  universe = [];
  await runtime.refreshUniverse(runtime.generation);
  assert.equal(replacement.stopCalls, 1);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStopQuarantine.size, 0);
  assert.equal(runtime.symbolSetKey, '');
  assert.equal(runtime.streamRetryTimer, null);

  runtime.stop();
  assert.equal(replacement.stopCalls, 1, 'inactive stop does not repeat completed ghost teardown');
});

test('VolumeRuntime final ownership boundary does not reschedule after retry error logging replaces owner', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  let activeProducers = 0;
  let installReplacement = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'error_event'
          || payload.source !== 'volume-runtime.stream-retry'
          || !installReplacement
        ) return;
        installReplacement = false;
        runtime.restartTradeStreams(['CPLUSDT'], runtime.generation);
      },
    },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            if (creationIndex === 0) throw new Error('synthetic retry start failure');
            this.active = true;
            activeProducers += 1;
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.eligibleSymbols = ['APLUSDT'];
  runtime.eligibleSymbolSet = new Set(['APLUSDT']);
  const generation = runtime.generation;

  runtime.scheduleStreamRetry(['APLUSDT'], 'APLUSDT', generation);
  t.mock.timers.tick(1_000);
  assert.equal(handles.length, 2);
  const replacement = handles[1];
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(replacement.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(runtime.streamStatus.get(replacement.name), 'open');
  assert.equal(runtime.streamRetryTimer, null, 'stale retry error cannot schedule another retry');
  assert.equal(runtime.symbolSetKey, '');

  t.mock.timers.tick(60_000);
  assert.equal(handles.length, 2);
  assert.equal(replacement.startCalls, 1);
  assert.equal(activeProducers, 1);

  runtime.stop();
  assert.equal(replacement.stopCalls, 1);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime quarantine boundary retries an inactive retained handle until stop succeeds', () => {
  let activeProducers = 0;
  let producer;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            this.active = true;
            activeProducers += 1;
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.stopCalls === 1) throw new Error('synthetic first public stop failure');
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        producer = handle;
        return handle;
      },
    },
  );
  runtime.running = true;
  assert.equal(runtime.restartTradeStreams(['APLUSDT'], runtime.generation), true);

  runtime.stop();
  assert.equal(runtime.running, false);
  assert.equal(producer.stopCalls, 1);
  assert.equal(producer.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], producer);
  assert.equal(runtime.streamStopQuarantine.has(producer), true);

  runtime.stop();
  assert.equal(runtime.running, false);
  assert.equal(producer.stopCalls, 2);
  assert.equal(producer.active, false);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.streamStopQuarantine.size, 0);
});

test('VolumeRuntime quarantine boundary blocks nested D until earlier P1 stop clears', () => {
  let activeProducers = 1;
  let peakActiveProducers = 1;
  let p1Fails = true;
  let nestedAttempted = false;
  let nestedError = null;
  let factoryCalls = 0;
  let replacement;
  let runtime;
  const p1 = {
    name: 'prior-1',
    active: true,
    stopCalls: 0,
    start() {},
    stop() {
      this.stopCalls += 1;
      if (p1Fails) throw new Error('synthetic quarantined P1 stop failure');
      if (!this.active) return;
      this.active = false;
      activeProducers -= 1;
    },
  };
  const p2 = {
    name: 'prior-2',
    active: false,
    stopCalls: 0,
    start() {},
    stop() {
      this.stopCalls += 1;
      if (nestedAttempted) return;
      nestedAttempted = true;
      try {
        runtime.restartTradeStreams(['DPLUSDT'], runtime.generation);
      } catch (error) {
        nestedError = error;
      }
    },
  };
  runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        factoryCalls += 1;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        replacement = handle;
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.streams = [p1, p2];

  assert.equal(runtime.restartTradeStreams(['OUTERUSDT'], runtime.generation), false);
  assert.equal(nestedAttempted, true);
  assert.match(String(nestedError), /synthetic quarantined P1 stop failure/);
  assert.equal(factoryCalls, 0, 'quarantine aborts nested D before construction');
  assert.equal(p1.stopCalls, 2, 'outer and nested turns both attempt quarantined P1');
  assert.equal(p1.active, true);
  assert.equal(p2.stopCalls, 1);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], p1);
  assert.equal(runtime.streamStopQuarantine.has(p1), true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  p1Fails = false;
  runtime.stop();
  assert.equal(p1.stopCalls, 3);
  assert.equal(activeProducers, 0);
  assert.equal(runtime.streamStopQuarantine.size, 0);
  assert.deepEqual(runtime.streams, []);

  runtime.running = true;
  assert.equal(runtime.restartTradeStreams(['DPLUSDT'], runtime.generation), true);
  assert.equal(factoryCalls, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(replacement.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.equal(replacement.stopCalls, 1);
  assert.equal(activeProducers, 0);
  assert.equal(runtime.streamStopQuarantine.size, 0);
});

test('VolumeRuntime quarantine boundary preserves D and cancels stale retry after background logging', async () => {
  const handles = [];
  let activeProducers = 0;
  let installD = true;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'error_event'
          || payload.source !== 'volume-runtime.background'
          || !installD
        ) return;
        installD = false;
        runtime.restartTradeStreams(['DPLUSDT'], runtime.generation);
      },
    },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      sourceRecoveryBaseMs: 1,
      random: () => 0.5,
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            this.active = true;
            activeProducers += 1;
            onStatus(name, 'exhausted');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.eligibleSymbols = ['APLUSDT'];
  runtime.scheduleStreamRetry(['APLUSDT'], 'APLUSDT', runtime.generation);
  const staleRetryTimer = runtime.streamRetryTimer;
  assert.notEqual(staleRetryTimer, null);

  runtime.launch(
    'synthetic background refresh',
    runtime.generation,
    async () => { throw new Error('synthetic background refresh failure'); },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(handles.length, 1);
  const replacement = handles[0];
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(replacement.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(runtime.streamStatus.get(replacement.name), 'exhausted');
  assert.equal(runtime.streamRecoveryAttempts.get(replacement.name), 1);
  assert.equal(runtime.streamRecoveryTimers.size, 1);
  assert.equal(runtime.streamRetryTimer, null, 'background catch cancels only unchanged stale retry');
  assert.equal(runtime.streamRetryMs, 1_000, 'background stale retry cancellation resets backoff');

  runtime.stop();
  assert.equal(replacement.stopCalls, 1);
  assert.equal(activeProducers, 0);
});

test('VolumeRuntime quarantine boundary preserves a nested retry timer without ownership change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let nestedTimer = null;
  let installNestedRetry = true;
  let producer;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'error_event'
          || payload.source !== 'volume-runtime.stream-retry'
          || !installNestedRetry
        ) return;
        installNestedRetry = false;
        runtime.scheduleStreamRetry(['APLUSDT'], 'APLUSDT', runtime.generation);
        nestedTimer = runtime.streamRetryTimer;
      },
    },
    () => ({}),
    () => [],
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            throw new Error('synthetic retry timer identity failure');
          },
          stop() {
            this.stopCalls += 1;
          },
        };
        producer = handle;
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.eligibleSymbols = ['APLUSDT'];
  runtime.scheduleStreamRetry(['APLUSDT'], 'APLUSDT', runtime.generation);

  t.mock.timers.tick(1_000);
  assert.notEqual(nestedTimer, null);
  assert.equal(runtime.streamRetryTimer, nestedTimer, 'outer catch preserves nested retry timer identity');
  assert.equal(runtime.streamRetryMs, 4_000, 'outer catch does not schedule over nested retry');
  assert.equal(producer.startCalls, 1);
  assert.equal(producer.stopCalls, 1);
  assert.equal(runtime.streams.length, 0);
  assert.equal(runtime.streamStopQuarantine.size, 0);

  runtime.stop();
  assert.equal(runtime.streamRetryTimer, null);
});

test('VolumeRuntime same-key refresh repairs a quarantined quiesced producer after retry-key mismatch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const row = (symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  });
  let universe = [row('AUSDT')];
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let staleBRetryTimer = null;
  let runtime;
  runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        if (creationIndex === 1) {
          assert.deepEqual(runtime.eligibleSymbols, ['AUSDT']);
          assert.equal(
            runtime.streamRetryTimer,
            staleBRetryTimer,
            'same-key repair begins while the stale B retry mismatches eligible A',
          );
        }
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (creationIndex === 0 && this.stopCalls === 1) {
              if (this.active) {
                this.active = false;
                activeProducers -= 1;
              }
              throw new Error('synthetic A quiesced before stop failure');
            }
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.warmBaselines = async () => {};
  const generation = runtime.generation;

  await runtime.refreshUniverse(generation);
  const originalA = handles[0];
  assert.equal(runtime.symbolSetKey, 'AUSDT');
  assert.equal(originalA.active, true);
  assert.equal(activeProducers, 1);

  universe = [row('BUSDT')];
  await assert.rejects(
    runtime.refreshUniverse(generation),
    /synthetic A quiesced before stop failure/,
  );
  staleBRetryTimer = runtime.streamRetryTimer;
  assert.notEqual(staleBRetryTimer, null);
  assert.deepEqual(runtime.eligibleSymbols, ['BUSDT']);
  assert.equal(runtime.symbolSetKey, 'AUSDT', 'failed B transition cannot commit its key');
  assert.equal(originalA.active, false, 'throwing stop already quiesced the A producer');
  assert.equal(runtime.streams[0], originalA);
  assert.equal(runtime.streamStopQuarantine.has(originalA), true);
  assert.equal(activeProducers, 0);

  universe = [row('AUSDT')];
  await runtime.refreshUniverse(generation);
  const replacementA = handles[1];
  assert.equal(handles.length, 2);
  assert.equal(originalA.stopCalls, 2, 'same-key repair drains the quarantined identity');
  assert.equal(runtime.streamStopQuarantine.size, 0);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], replacementA);
  assert.equal(replacementA.active, true);
  assert.equal(runtime.symbolSetKey, 'AUSDT');
  assert.equal(runtime.streamRetryTimer, null, 'successful A repair cancels the stale B retry');
  assert.equal(runtime.streamRetryMs, 1_000, 'successful A repair resets retry backoff');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  t.mock.timers.tick(60_000);
  assert.equal(handles.length, 2, 'the cancelled mismatched B retry cannot create a producer');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.scheduleStreamRetry(['AUSDT'], 'AUSDT', generation);
  const completeEpoch = runtime.streamEpoch;
  await runtime.refreshUniverse(generation);
  assert.equal(runtime.streamEpoch, completeEpoch, 'healthy same-key ownership does not transact');
  assert.equal(runtime.streamRetryTimer, null, 'healthy same-key refresh clears stale retry ownership');
  assert.equal(runtime.streamRetryMs, 1_000);
  assert.equal(handles.length, 2);

  universe = [];
  await runtime.refreshUniverse(generation);
  const emptyEpoch = runtime.streamEpoch;
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.symbolSetKey, '');
  await runtime.refreshUniverse(generation);
  assert.equal(runtime.streamEpoch, emptyEpoch, 'a healthy empty universe does not transact repeatedly');
  assert.equal(handles.length, 2);

  runtime.stop();
  assert.equal(activeProducers, 0);
  assert.equal(runtime.streamStopQuarantine.size, 0);
});

test('VolumeRuntime same-key completeness independently repairs length or unique ownership and rejects duplicate factory identity', async () => {
  const symbols = Array.from(
    { length: 141 },
    (_, index) => `C${String(index).padStart(3, '0')}USDT`,
  );
  const universe = symbols.map((symbol) => ({
    symbol,
    base: symbol.slice(0, -4),
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }));

  for (const variant of ['unique', 'length']) {
    const replacements = [];
    const makePrior = (name) => ({
      name,
      active: true,
      stopCalls: 0,
      start() {},
      stop() {
        this.stopCalls += 1;
        if (!this.active) return;
        this.active = false;
        activeProducers -= 1;
      },
    });
    const firstPrior = makePrior('prior-1');
    const secondPrior = variant === 'length' ? makePrior('prior-2') : null;
    const priors = secondPrior === null ? [firstPrior] : [firstPrior, secondPrior];
    let activeProducers = priors.length;
    let peakActiveProducers = priors.length;
    const runtime = new VolumeRuntime(
      { logEvent() {} },
      () => ({
        killSwitch: true,
        maxOrderNotionalUsd: 10,
        minQuoteVolume24h: 1,
        allowedSymbols: [],
        blockedSymbols: [],
      }),
      () => universe,
      null,
      () => 1_000,
      {
        streamFactory: (name, url, onMessage, onStatus) => {
          const handle = {
            name,
            url,
            onMessage,
            onStatus,
            active: false,
            startCalls: 0,
            stopCalls: 0,
            start() {
              this.startCalls += 1;
              assert.equal(this.active, false);
              assert.ok(activeProducers < 2, `${variant} repair starts no third producer`);
              this.active = true;
              activeProducers += 1;
              peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
              onStatus(name, 'open');
            },
            stop() {
              this.stopCalls += 1;
              if (!this.active) return;
              this.active = false;
              activeProducers -= 1;
            },
          };
          replacements.push(handle);
          return handle;
        },
      },
    );
    runtime.running = true;
    runtime.symbolSetKey = symbols.join(',');
    runtime.streamOwnershipKey = symbols.join(',');
    runtime.streams = variant === 'unique'
      ? [firstPrior, firstPrior]
      : [firstPrior, secondPrior, secondPrior];
    runtime.warmBaselines = async () => {};

    assert.equal(
      runtime.streams.length,
      variant === 'unique' ? 2 : 3,
      `${variant} fixture pins only its intended shape clause`,
    );
    assert.equal(
      new Set(runtime.streams).size,
      variant === 'unique' ? 1 : 2,
      `${variant} fixture pins only its intended shape clause`,
    );
    await runtime.refreshUniverse(runtime.generation);
    for (const prior of priors) {
      assert.equal(prior.stopCalls, 1, `${variant} predecessor cleanup is identity-deduped`);
      assert.equal(prior.active, false);
    }
    assert.equal(replacements.length, 2);
    assert.equal(runtime.streams.length, 2);
    assert.equal(new Set(runtime.streams).size, 2);
    assert.equal(runtime.streams[0], replacements[0]);
    assert.equal(runtime.streams[1], replacements[1]);
    assert.equal(activeProducers, 2);
    assert.equal(peakActiveProducers, 2);
    assert.equal(runtime.symbolSetKey, symbols.join(','));

    runtime.stop();
    assert.equal(activeProducers, 0);
    assert.deepEqual(runtime.streams, []);
  }

  let duplicateFactoryCalls = 0;
  let duplicateActiveProducers = 0;
  const duplicateHandle = {
    name: 'duplicate-factory-handle',
    active: false,
    startCalls: 0,
    stopCalls: 0,
    start() {
      this.startCalls += 1;
      assert.equal(this.active, false);
      this.active = true;
      duplicateActiveProducers += 1;
    },
    stop() {
      this.stopCalls += 1;
      if (!this.active) return;
      this.active = false;
      duplicateActiveProducers -= 1;
    },
  };
  const duplicateRuntime = new VolumeRuntime(
    { logEvent() {} },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      streamFactory: () => {
        duplicateFactoryCalls += 1;
        return duplicateHandle;
      },
    },
  );
  duplicateRuntime.running = true;
  duplicateRuntime.warmBaselines = async () => {};

  await assert.rejects(
    duplicateRuntime.refreshUniverse(duplicateRuntime.generation),
    /volume stream factory returned a duplicate handle/,
  );
  assert.equal(duplicateFactoryCalls, 2);
  assert.equal(duplicateHandle.startCalls, 1, 'duplicate identity is rejected before a second start');
  assert.equal(duplicateHandle.stopCalls, 1, 'authoritative rollback stops the first registration');
  assert.equal(duplicateActiveProducers, 0);
  assert.deepEqual(duplicateRuntime.streams, []);
  assert.equal(duplicateRuntime.streamStopQuarantine.size, 0);
  assert.equal(duplicateRuntime.symbolSetKey, '');
  assert.notEqual(duplicateRuntime.streamRetryTimer, null);

  duplicateRuntime.stop();
  assert.equal(duplicateRuntime.streamRetryTimer, null);
});

test('VolumeRuntime ownership provenance rebuilds committed A after a nested same-cardinality B wins', async () => {
  const rows = [{
    symbol: 'AUSDT',
    base: 'A',
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }];
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let installB = true;
  let nestedBDisposition = null;
  let runtime;
  runtime = new VolumeRuntime(
    {
      logEvent(kind, _symbol, payload) {
        if (
          kind !== 'ws.exhausted'
          || payload.feed !== 'volume-aggtrade-1'
          || !installB
        ) return;
        installB = false;
        nestedBDisposition = runtime.restartTradeStreams(['BUSDT'], runtime.generation);
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => rows,
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (!this.active) return;
            this.active = false;
            activeProducers -= 1;
          },
          creationIndex,
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.running = true;
  runtime.warmBaselines = async () => {};
  runtime.engine.onTrade = () => true;
  const generation = runtime.generation;

  await runtime.refreshUniverse(generation);
  const originalA = handles[0];
  assert.equal(runtime.symbolSetKey, 'AUSDT');
  assert.equal(runtime.streamOwnershipKey, 'AUSDT');
  assert.equal(originalA.active, true);

  originalA.onStatus(originalA.name, 'exhausted');
  const nestedB = handles[1];
  assert.equal(nestedBDisposition, true);
  assert.equal(runtime.symbolSetKey, 'AUSDT', 'nested seam cannot commit the universe caller key');
  assert.equal(runtime.streamOwnershipKey, 'BUSDT', 'exact nested turn publishes physical B ownership');
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], nestedB);
  assert.equal(originalA.active, false);
  assert.equal(nestedB.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  await runtime.refreshUniverse(generation);
  const rebuiltA = handles[2];
  assert.equal(handles.length, 3, 'same-cardinality provenance mismatch rebuilds committed A');
  assert.equal(nestedB.stopCalls, 1);
  assert.equal(nestedB.active, false);
  assert.equal(rebuiltA.active, true);
  assert.equal(runtime.streams.length, 1);
  assert.equal(runtime.streams[0], rebuiltA);
  assert.equal(runtime.symbolSetKey, 'AUSDT');
  assert.equal(runtime.streamOwnershipKey, 'AUSDT');
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  originalA.onStatus(originalA.name, 'open');
  nestedB.onStatus(nestedB.name, 'exhausted');
  originalA.onMessage({
    e: 'aggTrade',
    E: 1_000,
    s: 'AUSDT',
    a: 1,
    p: '1',
    q: '1',
    f: 1,
    l: 1,
    T: 1_000,
    m: false,
  });
  assert.equal(runtime.streams[0], rebuiltA);
  assert.equal(runtime.streamStatus.get(rebuiltA.name), 'open');
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.equal(runtime.tradeMessages, 0, 'stale A/B callbacks remain epoch-fenced');
  assert.equal(activeProducers, 1);

  runtime.stop();
  assert.equal(rebuiltA.stopCalls, 1);
  assert.equal(runtime.streamOwnershipKey, null);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});

test('VolumeRuntime public stop blocks a quiescent handle from reentering public start', async () => {
  const universe = [{
    symbol: 'AUSDT',
    base: 'A',
    hasSpot: true,
    hasPerp: true,
    quoteVolume24h: 100,
  }];
  const handles = [];
  let activeProducers = 0;
  let peakActiveProducers = 0;
  let nestedStartPromise = null;
  let runtime;
  runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => universe,
    null,
    () => 1_000,
    {
      streamFactory: (name, url, onMessage, onStatus) => {
        const creationIndex = handles.length;
        const handle = {
          name,
          url,
          onMessage,
          onStatus,
          active: false,
          startCalls: 0,
          stopCalls: 0,
          start() {
            this.startCalls += 1;
            assert.equal(this.active, false);
            this.active = true;
            activeProducers += 1;
            peakActiveProducers = Math.max(peakActiveProducers, activeProducers);
            onStatus(name, 'open');
          },
          stop() {
            this.stopCalls += 1;
            if (this.active) {
              this.active = false;
              activeProducers -= 1;
            }
            if (creationIndex !== 0 || nestedStartPromise !== null) return;
            assert.equal(runtime.stopping, true);
            assert.equal(runtime.symbolSetKey, '');
            assert.equal(runtime.streamOwnershipKey, null);
            nestedStartPromise = runtime.start();
            runtime.stop();
          },
        };
        handles.push(handle);
        return handle;
      },
    },
  );
  runtime.refreshBooks = async () => {};
  runtime.warmBaselines = async () => {};

  await runtime.start();
  const original = handles[0];
  assert.equal(runtime.running, true);
  assert.equal(runtime.engine.isRunning(), true);
  assert.equal(runtime.symbolSetKey, 'AUSDT');
  assert.equal(runtime.streamOwnershipKey, 'AUSDT');
  assert.equal(activeProducers, 1);

  runtime.stop();
  await nestedStartPromise;
  assert.equal(runtime.stopping, false);
  assert.equal(runtime.running, false);
  assert.equal(runtime.engine.isRunning(), false);
  assert.equal(runtime.tickTimer, null);
  assert.equal(runtime.bookTimer, null);
  assert.equal(runtime.universeTimer, null);
  assert.equal(runtime.streamRetryTimer, null);
  assert.equal(runtime.streamRecoveryTimers.size, 0);
  assert.deepEqual(runtime.streams, []);
  assert.equal(runtime.symbolSetKey, '');
  assert.equal(runtime.streamOwnershipKey, null);
  assert.equal(handles.length, 1, 'nested public start cannot reach the stream factory');
  assert.equal(original.stopCalls, 1);
  assert.equal(activeProducers, 0);
  assert.equal(peakActiveProducers, 1);

  await runtime.start();
  const replacement = handles[1];
  assert.equal(handles.length, 2, 'a later explicit public start remains available');
  assert.equal(runtime.running, true);
  assert.equal(runtime.engine.isRunning(), true);
  assert.equal(runtime.streams[0], replacement);
  assert.equal(runtime.symbolSetKey, 'AUSDT');
  assert.equal(runtime.streamOwnershipKey, 'AUSDT');
  assert.equal(replacement.active, true);
  assert.equal(activeProducers, 1);
  assert.equal(peakActiveProducers, 1);

  runtime.stop();
  assert.equal(replacement.stopCalls, 1);
  assert.equal(runtime.running, false);
  assert.equal(runtime.engine.isRunning(), false);
  assert.equal(activeProducers, 0);
  assert.deepEqual(runtime.streams, []);
});
