import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BoundedInboundQueue,
  BoundedProcessingLagMetrics,
  ControlMessageThrottle,
  DeterministicBackoff,
  RestWeightBudget,
  WebSocketSourceRunner,
  parseRestRateHeaders,
} from '../../../dist/intelligenceRuntime/lifecycle/index.js';
import { sourceDefinition } from '../../../dist/intelligenceRuntime/contracts/index.js';

class ManualClock {
  constructor(now = 1_000) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
  advance(ms) { this.now += ms; }
}

class SequenceJitter {
  constructor(values = [0.5]) { this.values = values; this.index = 0; }
  next() { return this.values[Math.min(this.index++, this.values.length - 1)]; }
}

class FakeConnection {
  constructor(request) {
    this.request = request;
    this.sent = [];
    this.closes = [];
    this.throwOnSend = false;
  }
  emit(event) { this.request.onEvent(event); }
  send(data) {
    if (this.throwOnSend) throw new Error('synthetic send failure');
    this.sent.push(data);
  }
  close(code, reason) { this.closes.push({ code: code ?? null, reason: reason ?? '' }); }
}

class FakeTransport {
  constructor() { this.requests = []; this.connections = []; this.failuresRemaining = 0; }
  connect(request) {
    this.requests.push(request);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('synthetic connect failure');
    }
    const connection = new FakeConnection(request);
    this.connections.push(connection);
    return connection;
  }
}

function definition(overrides = {}) {
  return sourceDefinition({
    capability: 'lifecycle-test-feed',
    streamOrPath: 'btcusdt@bookTicker',
    transportKind: 'WEBSOCKET',
    endpointClass: 'PUBLIC',
    productFamily: 'SPOT',
    silentAfterMs: 100,
    staleAfterMs: 500,
    maximumFutureSkewMs: 10,
    retryCeiling: 2,
    authority: 'COMPLETE',
    ...overrides,
  });
}

function decode(data, context) {
  if (!data || typeof data !== 'object' || data.invalid) return null;
  const mode = data.mode ?? 'REPLACEABLE';
  return {
    payload: data.payload ?? data,
    stream: data.stream ?? 'btcusdt@bookTicker',
    sourceEventTimeMs: data.sourceEventTimeMs ?? context.receiveTimeMs,
    sourceTransactionTimeMs: data.sourceTransactionTimeMs ?? null,
    sequence: data.sequence ?? null,
    correlationId: data.id ?? `event-${context.receiveTimeMs}`,
    queueMode: mode,
    coalescingKey: mode === 'REPLACEABLE' ? (data.key ?? 'BTCUSDT') : null,
  };
}

function harness(overrides = {}) {
  const clock = overrides.clock ?? new ManualClock();
  const transport = overrides.transport ?? new FakeTransport();
  const accepted = [];
  const metrics = [];
  const source = overrides.definition ?? definition(overrides.definitionOverrides);
  const runner = new WebSocketSourceRunner({
    definition: source,
    url: 'wss://example.invalid/ws/test',
    maximumMessageBytes: overrides.maximumMessageBytes ?? 64 * 1024,
    queueCapacity: overrides.queueCapacity ?? 4,
    openTimeoutMs: overrides.openTimeoutMs ?? 100,
    rotationAfterMs: overrides.rotationAfterMs ?? 10_000,
    stableConnectionMs: overrides.stableConnectionMs ?? 100,
    backoff: {
      baseDelayMs: 100,
      maximumDelayMs: 400,
      retryCeiling: source.retryCeiling,
      cooldownMs: 500,
      jitterRatio: overrides.jitterRatio ?? 0,
    },
    controlThrottle: { maximumMessages: 2, intervalMs: 1_000 },
  }, {
    clock,
    jitter: overrides.jitter ?? new SequenceJitter(),
    transport,
    decoder: overrides.decoder ?? decode,
    sink: overrides.sink ?? { accept: (event) => accepted.push(event) },
    metricSink: overrides.metricSink ?? { record: (metric) => metrics.push(metric) },
    lagMetrics: overrides.lagMetrics,
  });
  return { clock, transport, runner, accepted, metrics };
}

function openAndMessage(h, receiveTimeMs = h.clock.nowMs(), data = {}) {
  const connection = h.transport.connections.at(-1);
  connection.emit({ kind: 'OPEN', receiveTimeMs });
  connection.emit({ kind: 'MESSAGE', receiveTimeMs, data: { id: `event-${receiveTimeMs}`, ...data } });
  return connection;
}

test('lifecycle configs are exact data-only projections with no accessor execution', () => {
  const clock = new ManualClock();
  const jitter = new SequenceJitter();
  const makeRunnerConfig = () => ({
    definition: { ...definition() },
    url: 'wss://example.invalid/ws/test',
    maximumMessageBytes: 64 * 1024,
    queueCapacity: 4,
    openTimeoutMs: 100,
    rotationAfterMs: 10_000,
    stableConnectionMs: 100,
    backoff: { baseDelayMs: 100, maximumDelayMs: 400, retryCeiling: 2, cooldownMs: 500, jitterRatio: 0 },
    controlThrottle: { maximumMessages: 2, intervalMs: 1_000 },
  });
  const makePorts = (transport = new FakeTransport()) => ({ clock, jitter, transport, decoder: decode });
  let reads = 0;
  const withAccessor = (value, field) => {
    const projected = { ...value };
    Object.defineProperty(projected, field, {
      enumerable: true,
      get() { reads += 1; return value[field]; },
    });
    return projected;
  };

  assert.throws(
    () => new WebSocketSourceRunner({ ...makeRunnerConfig(), extra: 'SECRET' }, makePorts()),
    /unsupported or missing fields/,
  );
  const symbolConfig = makeRunnerConfig();
  symbolConfig[Symbol('secret')] = true;
  assert.throws(() => new WebSocketSourceRunner(symbolConfig, makePorts()), /symbol keys/);
  assert.throws(
    () => new WebSocketSourceRunner(withAccessor(makeRunnerConfig(), 'url'), makePorts()),
    /enumerable data property/,
  );
  const definitionAccessor = makeRunnerConfig();
  definitionAccessor.definition = withAccessor(definitionAccessor.definition, 'sourceId');
  assert.throws(() => new WebSocketSourceRunner(definitionAccessor, makePorts()), /enumerable data property/);

  const backoffConfig = { baseDelayMs: 100, maximumDelayMs: 400, retryCeiling: 2, cooldownMs: 500, jitterRatio: 0 };
  assert.throws(
    () => new DeterministicBackoff(clock, jitter, { ...backoffConfig, extra: true }),
    /unsupported or missing fields/,
  );
  assert.throws(
    () => new DeterministicBackoff(clock, jitter, withAccessor(backoffConfig, 'jitterRatio')),
    /enumerable data property/,
  );
  const throttleConfig = { maximumMessages: 2, intervalMs: 1_000 };
  assert.throws(
    () => new ControlMessageThrottle(clock, { ...throttleConfig, extra: true }),
    /unsupported or missing fields/,
  );
  assert.throws(
    () => new ControlMessageThrottle(clock, withAccessor(throttleConfig, 'intervalMs')),
    /enumerable data property/,
  );
  const budgetConfig = { limit: 10, intervalMs: 60_000, nearLimitRatio: 0.8, defaultCooldownMs: 1_000 };
  assert.throws(
    () => new RestWeightBudget(clock, { ...budgetConfig, extra: true }),
    /unsupported or missing fields/,
  );
  assert.throws(
    () => new RestWeightBudget(clock, withAccessor(budgetConfig, 'nearLimitRatio')),
    /enumerable data property/,
  );
  assert.equal(reads, 0);

  const retainedConfig = makeRunnerConfig();
  const transport = new FakeTransport();
  const runner = new WebSocketSourceRunner(retainedConfig, makePorts(transport));
  const retainedSourceId = retainedConfig.definition.sourceId;
  retainedConfig.url = 'wss://mutated.invalid/ws';
  retainedConfig.definition.sourceId = 'mutated-source';
  retainedConfig.controlThrottle.maximumMessages = 99;
  runner.start();
  assert.equal(transport.requests[0].url, 'wss://example.invalid/ws/test');
  assert.equal(transport.requests[0].sourceId, retainedSourceId);
  assert.equal(runner.snapshot().controlThrottle.maximumMessages, 2);
});

test('normal connect, useful arrival, bounded drain, and graceful stop are explicit', () => {
  const h = harness();
  const generation = h.runner.start();
  assert.equal(generation, 1);
  assert.equal(h.transport.requests.length, 1);
  const connection = openAndMessage(h);
  assert.equal(h.runner.snapshot().source.observedState, 'LIVE');
  assert.equal(h.runner.snapshot().queue.depth, 1);
  h.clock.advance(7);
  assert.deepEqual(h.runner.drain(4), { processed: 1, failed: 0, remaining: 0 });
  assert.equal(h.accepted.length, 1);
  assert.equal(h.accepted[0].receiveTimeMs, 1_000);
  assert.equal(h.runner.snapshot().source.processingLagMs, 7);
  assert.equal(h.runner.snapshot().lag.global.lastLagMs, 7);
  h.runner.stop();
  h.clock.advance(1_000);
  const stopped = h.runner.snapshot().source;
  assert.equal(stopped.desiredState, 'STOPPED');
  assert.equal(stopped.observedState, 'STOPPED');
  assert.equal(stopped.completeness, 'MISSING');
  assert.equal(stopped.messageAgeMs, null);
  assert.equal(stopped.processingLagMs, null);
  assert.equal(stopped.lastMessageReceiveTimeMs, null);
  assert.equal(stopped.lastProcessedTimeMs, null);
  assert.equal(stopped.messageCount, 1);
  assert.match(connection.closes.at(-1).reason, /stopped/);
});

test('transport creation without OPEN reaches an explicit deadline and is never reported connected', () => {
  const h = harness({ openTimeoutMs: 50 });
  h.runner.start();
  assert.equal(h.runner.snapshot().source.observedState, 'CONNECTING');
  assert.equal(h.runner.snapshot().connection.connected, false);
  h.clock.set(1_049);
  h.runner.tick();
  assert.equal(h.runner.snapshot().source.observedState, 'CONNECTING');
  h.clock.set(1_050);
  h.runner.tick();
  const timedOut = h.runner.snapshot();
  assert.equal(timedOut.source.observedState, 'BACKING_OFF');
  assert.equal(timedOut.source.lastError.code, 'WEBSOCKET_OPEN_TIMEOUT');
  assert.equal(timedOut.connection.connected, false);
  assert.match(h.transport.connections[0].closes.at(-1).reason, /reconnect/);
});

test('ping and pong activity never disguises a socket with no useful messages', () => {
  const h = harness();
  h.runner.start();
  const connection = h.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  h.clock.set(1_050);
  connection.emit({ kind: 'PING', receiveTimeMs: 1_050, payload: 'p' });
  h.clock.set(1_090);
  connection.emit({ kind: 'PONG', receiveTimeMs: 1_090, payload: 'p' });
  h.clock.set(1_100);
  const snapshot = h.runner.snapshot();
  assert.equal(snapshot.source.observedState, 'SILENT');
  assert.equal(snapshot.connection.lastPongAtMs, 1_090);
  assert.equal(snapshot.source.messageCount, 0);
});

test('runner rejects regressed transport receive times without regressing current health', () => {
  const h = harness();
  h.runner.start();
  const connection = h.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  h.clock.set(1_002);
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_002, data: { id: 'newer' } });
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_001, data: { id: 'older' } });
  const snapshot = h.runner.snapshot();
  assert.equal(snapshot.source.lastMessageReceiveTimeMs, 1_002);
  assert.equal(snapshot.connection.lastTransportActivityMs, 1_002);
  assert.equal(snapshot.source.messageCount, 1);
  assert.equal(snapshot.source.invalidCount, 1);
});

test('scheduled lifetime rotation advances generation without backoff', () => {
  const source = definition({ silentAfterMs: 5_000, staleAfterMs: 10_000 });
  const h = harness({ definition: source, rotationAfterMs: 1_000 });
  h.runner.start();
  const first = openAndMessage(h);
  h.clock.set(1_999);
  h.runner.tick();
  assert.equal(h.transport.connections.length, 1);
  h.clock.set(2_000);
  h.runner.tick();
  assert.equal(h.transport.connections.length, 2);
  assert.equal(h.transport.requests[1].generation, 2);
  assert.match(first.closes.at(-1).reason, /rotation/);
  assert.equal(h.runner.snapshot().connection.rotations, 1);
  assert.equal(h.runner.snapshot().source.backoff.attempt, 0);
});

test('reconnect storm obeys exponential retry ceiling and deterministic cooldown', () => {
  const h = harness();
  h.runner.start();
  h.transport.connections[0].emit({ kind: 'ERROR', receiveTimeMs: 1_000, code: 'E1', message: 'first' });
  assert.equal(h.runner.snapshot().source.backoff.retryAtMs, 1_100);
  h.clock.set(1_099); h.runner.tick();
  assert.equal(h.transport.connections.length, 1);
  h.clock.set(1_100); h.runner.tick();
  assert.equal(h.transport.connections.length, 2);
  h.transport.connections[1].emit({ kind: 'ERROR', receiveTimeMs: 1_100, code: 'E2', message: 'second' });
  assert.equal(h.runner.snapshot().source.backoff.retryAtMs, 1_300);
  h.clock.set(1_300); h.runner.tick();
  assert.equal(h.transport.connections.length, 3);
  h.transport.connections[2].emit({ kind: 'ERROR', receiveTimeMs: 1_300, code: 'E3', message: 'third' });
  const cooling = h.runner.snapshot();
  assert.equal(cooling.source.observedState, 'FAILED');
  assert.equal(cooling.source.lastError.code, 'RETRY_CEILING_REACHED');
  assert.equal(cooling.source.backoff.cooldownUntilMs, 1_800);
  h.clock.set(1_799); h.runner.tick();
  assert.equal(h.transport.connections.length, 3);
  h.clock.set(1_800); h.runner.tick();
  assert.equal(h.transport.connections.length, 4);
  assert.equal(h.runner.snapshot().source.backoff.attempt, 0);
});

test('a reconnect starts with generation-local message health instead of inherited age', () => {
  const h = harness();
  h.runner.start();
  const first = openAndMessage(h, 1_000);
  first.emit({ kind: 'ERROR', receiveTimeMs: 1_000, code: 'RESET', message: 'reset' });
  h.clock.set(1_100);
  h.runner.tick();
  let current = h.runner.snapshot();
  assert.equal(current.source.connectionGeneration, 2);
  assert.equal(current.source.observedState, 'CONNECTING');
  assert.equal(current.source.lastMessageReceiveTimeMs, null);
  assert.equal(current.source.messageAgeMs, null);
  assert.equal(current.connection.connected, false);
  h.transport.connections.at(-1).emit({ kind: 'OPEN', receiveTimeMs: 1_100 });
  current = h.runner.snapshot();
  assert.equal(current.source.observedState, 'WARMING');
  assert.equal(current.source.lastMessageReceiveTimeMs, null);
  assert.equal(current.connection.connected, true);
  h.clock.set(1_199);
  assert.equal(h.runner.snapshot().source.observedState, 'WARMING');
  h.clock.set(1_200);
  assert.equal(h.runner.snapshot().source.observedState, 'SILENT');
});

test('a useful stable generation resets accumulated backoff', () => {
  const h = harness({ stableConnectionMs: 100 });
  h.runner.start();
  h.transport.connections[0].emit({ kind: 'CLOSE', receiveTimeMs: 1_000, code: 1006, reason: 'lost' });
  h.clock.set(1_100); h.runner.tick();
  openAndMessage(h, 1_100);
  assert.equal(h.runner.snapshot().source.backoff.attempt, 1);
  h.clock.set(1_200); h.runner.tick();
  assert.equal(h.runner.snapshot().source.backoff.attempt, 1);
  h.transport.connections.at(-1).emit({ kind: 'MESSAGE', receiveTimeMs: 1_200, data: { id: 'continued-health' } });
  h.runner.tick();
  const stable = h.runner.snapshot();
  assert.equal(stable.source.backoff.attempt, 0);
  assert.equal(stable.connection.stableBackoffResets, 1);
});

test('stop during backoff clears retry state and stale callbacks cannot reconnect', () => {
  const h = harness();
  h.runner.start();
  const first = h.transport.connections[0];
  first.emit({ kind: 'ERROR', receiveTimeMs: 1_000, code: 'DOWN', message: 'down' });
  assert.equal(h.runner.snapshot().source.backoff.attempt, 1);
  h.runner.stop();
  first.emit({ kind: 'CLOSE', receiveTimeMs: 1_001, code: 1006, reason: 'late' });
  h.clock.set(2_000); h.runner.tick();
  assert.equal(h.transport.connections.length, 1);
  assert.equal(h.runner.snapshot().source.observedState, 'STOPPED');
  assert.equal(h.runner.snapshot().source.backoff.retryAtMs, null);
});

test('replaceable state coalesces and retains the newest value', () => {
  const queue = new BoundedInboundQueue(2);
  assert.equal(queue.offer({ id: 'a', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 1, value: 1 }).action, 'ENQUEUED');
  assert.equal(queue.offer({ id: 'b', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 2, value: 2 }).action, 'COALESCED');
  assert.equal(queue.snapshot().depth, 1);
  assert.equal(queue.snapshot().coalescedCount, 1);
  assert.equal(queue.shift().value, 2);
});

test('replaceable state rejects receive-time regression and moves newer state to the chronological tail', () => {
  const queue = new BoundedInboundQueue(4);
  queue.offer({ id: 'btc-10', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 10, value: 'btc-10' });
  queue.offer({ id: 'eth-20', mode: 'REPLACEABLE', coalescingKey: 'ETH', receiveTimeMs: 20, value: 'eth-20' });
  const older = queue.offer({ id: 'btc-15', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 15, value: 'btc-15' });
  assert.deepEqual(
    { accepted: older.accepted, action: older.action, dropped: older.dropped },
    { accepted: false, action: 'IGNORED_OLDER', dropped: 1 },
  );
  const newer = queue.offer({ id: 'btc-30', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 30, value: 'btc-30' });
  assert.equal(newer.action, 'COALESCED');
  assert.equal(queue.shift().value, 'eth-20');
  assert.equal(queue.shift().value, 'btc-30');
  assert.equal(queue.snapshot().droppedCount, 1);
});

test('sequence-sensitive depth never coalesces and overflow demands resync', () => {
  const queue = new BoundedInboundQueue(2);
  queue.offer({ id: 'd1', mode: 'SEQUENCE_SENSITIVE', coalescingKey: 'BTC', receiveTimeMs: 1, value: 1 });
  queue.offer({ id: 'd2', mode: 'SEQUENCE_SENSITIVE', coalescingKey: 'BTC', receiveTimeMs: 2, value: 2 });
  const overflow = queue.offer({ id: 'd3', mode: 'SEQUENCE_SENSITIVE', coalescingKey: 'BTC', receiveTimeMs: 3, value: 3 });
  assert.equal(overflow.accepted, false);
  assert.equal(overflow.dropped, 1);
  assert.equal(overflow.requiresResync, true);
  assert.equal(queue.snapshot().depth, 2);
  assert.equal(queue.snapshot().resyncRequired, true);
});

test('unresolved depth resync keeps runner degraded across newer frames until explicit acknowledgement', () => {
  const h = harness({ queueCapacity: 1 });
  h.runner.start();
  const connection = h.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_000, data: { id: 'depth-1', mode: 'SEQUENCE_SENSITIVE' } });
  h.clock.set(1_001);
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_001, data: { id: 'depth-2', mode: 'SEQUENCE_SENSITIVE' } });
  assert.equal(h.runner.snapshot().queue.resyncRequired, true);
  assert.equal(h.runner.snapshot().source.observedState, 'DEGRADED');
  h.runner.drain(1);
  h.clock.set(1_002);
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_002, data: { id: 'new-state' } });
  assert.equal(h.runner.snapshot().source.observedState, 'DEGRADED');
  h.runner.acknowledgeSequenceResync();
  assert.equal(h.runner.snapshot().source.observedState, 'LIVE');
});

test('queue overflow sheds replaceable state before protected depth', () => {
  const queue = new BoundedInboundQueue(2);
  queue.offer({ id: 'state', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 1, value: 'state' });
  queue.offer({ id: 'depth', mode: 'SEQUENCE_SENSITIVE', coalescingKey: null, receiveTimeMs: 2, value: 'depth' });
  const result = queue.offer({ id: 'depth2', mode: 'SEQUENCE_SENSITIVE', coalescingKey: null, receiveTimeMs: 3, value: 'depth2' });
  assert.equal(result.action, 'EVICTED_REPLACEABLE');
  assert.equal(queue.shift().value, 'depth');
  assert.equal(queue.shift().value, 'depth2');
});

test('queue detaches and freezes retained values while enforcing per-entry and aggregate byte bounds', () => {
  const queue = new BoundedInboundQueue(2, 128, 160);
  const original = { nested: { value: 1 } };
  assert.equal(queue.offer({
    id: 'detached', mode: 'REPLACEABLE', coalescingKey: 'BTC', receiveTimeMs: 1, value: original,
  }).accepted, true);
  original.nested.value = 2;
  const retained = queue.peek().value;
  assert.equal(retained.nested.value, 1);
  assert.equal(Object.isFrozen(retained), true);
  assert.equal(Object.isFrozen(retained.nested), true);
  assert.throws(() => { retained.nested.value = 3; }, TypeError);
  assert.ok(queue.snapshot().retainedBytes > 0);
  assert.ok(queue.snapshot().highWatermarkRetainedBytes >= queue.snapshot().retainedBytes);

  const oversized = queue.offer({
    id: 'oversized', mode: 'SEQUENCE_SENSITIVE', coalescingKey: null, receiveTimeMs: 2,
    value: { text: 'x'.repeat(256) },
  });
  assert.equal(oversized.accepted, false);
  assert.equal(oversized.requiresResync, true);
  assert.equal(queue.snapshot().oversizeDropCount, 1);
  assert.equal(queue.snapshot().depth, 1);
  queue.acknowledgeResync();

  const protectedQueue = new BoundedInboundQueue(3, 256, 240);
  protectedQueue.offer({ id: 'protected', mode: 'SEQUENCE_SENSITIVE', coalescingKey: null, receiveTimeMs: 1, value: { text: 'p'.repeat(60) } });
  const blocked = protectedQueue.offer({ id: 'cannot-fit', mode: 'SEQUENCE_SENSITIVE', coalescingKey: null, receiveTimeMs: 2, value: { text: 'q'.repeat(60) } });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.requiresResync, true);
  assert.equal(protectedQueue.snapshot().depth, 1);
  const beforeShift = protectedQueue.snapshot().retainedBytes;
  assert.ok(beforeShift > 0);
  protectedQueue.shift();
  assert.equal(protectedQueue.snapshot().retainedBytes, 0);
});

test('queue rejects accessors and unsupported retained graphs without executing caller code', () => {
  const queue = new BoundedInboundQueue(2);
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'unsafe', {
    enumerable: true,
    get() { reads += 1; return 'secret side effect'; },
  });
  assert.throws(() => queue.offer({
    id: 'accessor', mode: 'REPLACEABLE', coalescingKey: 'A', receiveTimeMs: 1, value: accessor,
  }), /data properties/);
  assert.equal(reads, 0);
  assert.throws(() => queue.offer({
    id: 'symbol', mode: 'REPLACEABLE', coalescingKey: 'S', receiveTimeMs: 1,
    value: { [Symbol('hidden')]: 'value' },
  }), /symbol keys/);
  assert.throws(() => queue.offer({
    id: 'extra', mode: 'REPLACEABLE', coalescingKey: 'E', receiveTimeMs: 1,
    value: { ok: true }, extra: 'x'.repeat(10_000),
  }), /unsupported fields/);
  const envelope = { mode: 'REPLACEABLE', coalescingKey: 'G', receiveTimeMs: 1, value: { ok: true } };
  Object.defineProperty(envelope, 'id', {
    enumerable: true,
    get() { reads += 1; return 'getter-backed-id'; },
  });
  assert.throws(() => queue.offer(envelope), /enumerable data property/);
  assert.equal(reads, 0);
  assert.equal(queue.snapshot().depth, 0);
});

test('oversized decoded payloads cannot make a source live and queued payloads are producer-detached', () => {
  const oversized = harness({ maximumMessageBytes: 128 });
  oversized.runner.start();
  const oversizedConnection = oversized.transport.connections[0];
  oversizedConnection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  oversizedConnection.emit({
    kind: 'MESSAGE', receiveTimeMs: 1_000,
    data: { id: 'oversized', payload: { text: 'x'.repeat(512) } },
  });
  const rejected = oversized.runner.snapshot();
  assert.equal(rejected.source.messageCount, 0);
  assert.equal(rejected.source.invalidCount, 1);
  assert.equal(rejected.queue.depth, 0);
  assert.notEqual(rejected.source.observedState, 'LIVE');

  const detached = harness();
  detached.runner.start();
  const connection = detached.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  const payload = { nested: { value: 1 } };
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_000, data: { id: 'bounded', payload } });
  payload.nested.value = 9;
  detached.runner.drain(1);
  assert.equal(detached.accepted[0].payload.nested.value, 1);
  assert.equal(Object.isFrozen(detached.accepted[0].payload.nested), true);
});

test('control-message throttle enforces a deterministic rolling window', () => {
  const clock = new ManualClock();
  const throttle = new ControlMessageThrottle(clock, { maximumMessages: 2, intervalMs: 1_000 });
  assert.equal(throttle.acquire().allowed, true);
  assert.equal(throttle.acquire().allowed, true);
  const blocked = throttle.acquire();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAtMs, 2_000);
  clock.set(1_999);
  assert.equal(throttle.acquire().allowed, false);
  clock.set(2_000);
  assert.equal(throttle.acquire().allowed, true);
});

test('control-message throttle rejects future and regressed observations without pruning its window', () => {
  const clock = new ManualClock();
  const throttle = new ControlMessageThrottle(clock, { maximumMessages: 1, intervalMs: 1_000 });
  assert.equal(throttle.acquire().allowed, true);
  assert.throws(() => throttle.snapshot(2_000), /ahead/);
  assert.throws(() => throttle.acquire(1, 2_000), /ahead/);
  assert.equal(throttle.acquire().allowed, false, 'rejected future reads cannot release the live window');
  clock.set(2_000);
  assert.equal(throttle.snapshot().used, 0);
  assert.throws(() => throttle.snapshot(1_999), /regress/);
  throttle.reset();
  assert.throws(() => throttle.acquire(1, 1_999), /regress/);
  assert.equal(throttle.acquire().allowed, true);

  const nearLimitClock = new ManualClock(Number.MAX_SAFE_INTEGER - 10);
  const nearLimit = new ControlMessageThrottle(nearLimitClock, { maximumMessages: 1, intervalMs: 100 });
  assert.equal(nearLimit.acquire().allowed, true);
  assert.throws(() => nearLimit.snapshot(), /safe timestamp range/);
  assert.throws(
    () => new ControlMessageThrottle(clock, { maximumMessages: 1, intervalMs: 7 * 24 * 60 * 60_000 + 1 }),
    /interval exceeds/,
  );
});

test('runner throttles control frames and a send failure enters bounded backoff', () => {
  const h = harness();
  h.runner.start();
  const connection = h.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  assert.equal(h.runner.sendControl('one').sent, true);
  assert.equal(h.runner.sendControl('two').sent, true);
  assert.equal(h.runner.sendControl('three').reason, 'RATE_LIMITED');
  connection.throwOnSend = true;
  h.clock.set(2_000);
  const failed = h.runner.sendControl('four');
  assert.equal(failed.sent, false);
  assert.equal(failed.reason, 'SEND_FAILED');
  assert.equal(h.runner.snapshot().source.observedState, 'BACKING_OFF');
});

test('REST rate headers are case-insensitive and 418/429 create explicit cooldown', () => {
  assert.deepEqual(parseRestRateHeaders({
    'X-MbX-UsEd-WeIgHt-1M': '2399',
    'rEtRy-AfTeR': '2',
  }), { usedWeight: 2_399, retryAfterMs: 2_000 });
  const clock = new ManualClock();
  const budget = new RestWeightBudget(clock, {
    limit: 2_400,
    intervalMs: 1_000,
    nearLimitRatio: 0.8,
    defaultCooldownMs: 5_000,
  });
  const limited = budget.observeResponse({
    status: 429,
    headers: { 'X-MBX-USED-WEIGHT-1M': '2400', 'Retry-After': '2' },
  });
  assert.equal(limited.state, 'COOLDOWN');
  assert.equal(limited.retryAfterMs, 2_000);
  assert.equal(budget.reserve(1).reason, 'COOLDOWN');
});

test('REST rate observations and headers are exact bounded data-only contracts', () => {
  let reads = 0;
  const headers = {};
  Object.defineProperty(headers, 'retry-after', {
    enumerable: true,
    get() { reads += 1; return '1'; },
  });
  assert.throws(() => parseRestRateHeaders(headers), /data properties/);
  assert.equal(reads, 0);
  assert.throws(() => parseRestRateHeaders({ ['x'.repeat(257)]: '1' }), /bounded string contract/);
  assert.throws(() => parseRestRateHeaders({ ok: 'x'.repeat(8_193) }), /bounded string contract/);
  assert.throws(
    () => parseRestRateHeaders(Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`h${index}`, '1']))),
    /header-count bound/,
  );

  const clock = new ManualClock();
  const budget = new RestWeightBudget(clock, {
    limit: 10, intervalMs: 60_000, nearLimitRatio: 0.8, defaultCooldownMs: 1_000,
  });
  const observation = { headers: {} };
  Object.defineProperty(observation, 'status', {
    enumerable: true,
    get() { reads += 1; return 200; },
  });
  assert.throws(() => budget.observeResponse(observation), /enumerable data property/);
  assert.equal(reads, 0);
  assert.throws(
    () => budget.observeResponse({ status: 200, headers: {}, unexpected: 'not retained' }),
    /unsupported fields/,
  );
  assert.equal(budget.snapshot().usedWeight, 0);
});

test('REST weight snapshots advance interval and cooldown recovery without a separate tick', () => {
  const clock = new ManualClock();
  const budget = new RestWeightBudget(clock, {
    limit: 10,
    intervalMs: 1_000,
    nearLimitRatio: 0.8,
    defaultCooldownMs: 500,
  });
  assert.equal(budget.reserve(8).budget.state, 'NEAR_LIMIT');
  assert.equal(budget.reserve(2).budget.state, 'EXHAUSTED');
  assert.equal(budget.reserve(1).reason, 'WEIGHT_EXHAUSTED');
  clock.set(2_000);
  assert.equal(budget.snapshot().state, 'AVAILABLE');
  assert.equal(budget.snapshot().usedWeight, 0);
  budget.observeResponse({ status: 418, headers: {} });
  assert.equal(budget.snapshot().state, 'COOLDOWN');
  clock.advance(500);
  assert.equal(budget.snapshot().state, 'AVAILABLE');
});

test('REST cooldown overflow rejects transactionally without poisoning retained budget state', () => {
  const clock = new ManualClock(Number.MAX_SAFE_INTEGER - 1);
  const budget = new RestWeightBudget(clock, {
    limit: 10, intervalMs: 1, nearLimitRatio: 0.8, defaultCooldownMs: 10,
  });
  const before = budget.snapshot();
  assert.throws(() => budget.observeResponse({ status: 429, headers: {} }), /cooldown timestamp overflow/);
  assert.deepEqual(budget.snapshot(), before);
  assert.equal(budget.reserve(1).allowed, true);
});

test('REST weight budget stays on absolute Binance windows across headers and rate-limit cooldowns', () => {
  const clock = new ManualClock(61_234);
  const budget = new RestWeightBudget(clock, {
    limit: 10,
    intervalMs: 60_000,
    nearLimitRatio: 0.8,
    defaultCooldownMs: 5_000,
  });

  const constructed = budget.snapshot();
  assert.equal(constructed.resetsAtMs, 120_000);
  assert.equal(budget.reserve(8).budget.state, 'NEAR_LIMIT');

  clock.set(119_999);
  const headerObservation = budget.observeResponse({
    status: 200,
    headers: { 'X-MBX-USED-WEIGHT-1M': '9' },
  });
  assert.equal(headerObservation.usedWeight, 9);
  assert.equal(headerObservation.resetsAtMs, 120_000);

  clock.set(120_000);
  const nextWindow = budget.snapshot();
  assert.equal(nextWindow.usedWeight, 0);
  assert.equal(nextWindow.resetsAtMs, 180_000);

  clock.set(120_010);
  const limited = budget.observeResponse({
    status: 429,
    headers: { 'X-MBX-USED-WEIGHT-1M': '10', 'Retry-After': '2' },
  });
  assert.equal(limited.state, 'COOLDOWN');
  assert.equal(limited.resetsAtMs, 180_000);
  assert.equal(limited.retryAfterMs, 2_000);

  clock.set(122_010);
  const cooldownReleased = budget.snapshot();
  assert.equal(cooldownReleased.state, 'EXHAUSTED');
  assert.equal(cooldownReleased.usedWeight, 10);
  assert.equal(cooldownReleased.resetsAtMs, 180_000);
  const blocked = budget.reserve(1);
  assert.equal(blocked.reason, 'WEIGHT_EXHAUSTED');
  assert.equal(blocked.retryAtMs, 180_000);

  clock.set(180_000);
  assert.equal(budget.snapshot().state, 'AVAILABLE');
  assert.equal(budget.snapshot().usedWeight, 0);
  assert.equal(budget.snapshot().resetsAtMs, 240_000);
});

test('processing lag metrics remain bounded and expose per-source plus global percentiles', () => {
  const metrics = new BoundedProcessingLagMetrics(2, 3);
  metrics.record('a', 0, 10);
  metrics.record('a', 0, 20);
  metrics.record('a', 0, 30);
  metrics.record('a', 0, 40);
  metrics.record('b', 5, 10);
  assert.equal(metrics.record('c', 0, 1), false);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.sources.a.sampleCount, 4);
  assert.equal(snapshot.sources.a.retainedSamples, 3);
  assert.equal(snapshot.sources.a.p50LagMs, 30);
  assert.equal(snapshot.global.sampleCount, 5);
  assert.equal(snapshot.rejectedSourceCount, 1);
});

test('malformed frames and sink failures are explicit and do not silently lose queued data', () => {
  const h = harness({ sink: { accept: () => { throw new Error('sink down'); } } });
  h.runner.start();
  const connection = h.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_000, data: { invalid: true } });
  h.clock.set(1_001);
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_001, data: { id: 'valid' } });
  assert.equal(h.runner.snapshot().source.invalidCount, 1);
  const result = h.runner.drain(1);
  assert.deepEqual(result, { processed: 0, failed: 1, remaining: 1 });
  assert.equal(h.runner.snapshot().source.lastError.code, 'SOURCE_EVENT_SINK_FAILED');
  h.clock.set(1_002);
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_002, data: { id: 'newer-valid' } });
  const stillFailed = h.runner.snapshot();
  assert.equal(stillFailed.source.observedState, 'DEGRADED');
  assert.equal(stillFailed.source.lastError.code, 'SOURCE_EVENT_SINK_FAILED');
  assert.deepEqual(h.runner.drain(1, { accept: () => {} }), { processed: 1, failed: 0, remaining: 0 });
  assert.equal(h.runner.snapshot().source.observedState, 'LIVE');
  assert.equal(h.runner.snapshot().source.lastError, null);
  assert.equal(h.runner.snapshot().source.recommendedAction, 'No operator action required.');
});

test('decoded sequence metadata is an exact data-only contract with no secret-bearing extras', () => {
  const h = harness();
  h.runner.start();
  const connection = h.transport.connections[0];
  connection.emit({ kind: 'OPEN', receiveTimeMs: 1_000 });
  connection.emit({
    kind: 'MESSAGE', receiveTimeMs: 1_000,
    data: { id: 'extra-sequence', sequence: { first: '1', last: '1', previous: null, apiKey: 'SECRET' } },
  });
  assert.equal(h.runner.snapshot().source.invalidCount, 1);
  assert.equal(h.runner.snapshot().source.messageCount, 0);
  let getterCalls = 0;
  const sequence = { last: '2', previous: null };
  Object.defineProperty(sequence, 'first', { enumerable: true, get() { getterCalls += 1; return '2'; } });
  connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_000, data: { id: 'accessor-sequence', sequence } });
  assert.equal(getterCalls, 0);
  assert.equal(h.runner.snapshot().source.invalidCount, 2);
  assert.equal(h.runner.snapshot().queue.depth, 0);
});

test('same injected event script yields byte-identical runtime snapshots', () => {
  function scenario() {
    const h = harness({ jitter: new SequenceJitter([0.25, 0.75]), jitterRatio: 0.2 });
    h.runner.start();
    const connection = openAndMessage(h, 1_000, { id: 'same', key: 'BTC', payload: { bid: 10 } });
    connection.emit({ kind: 'MESSAGE', receiveTimeMs: 1_001, data: { id: 'same-2', key: 'BTC', payload: { bid: 11 } } });
    h.clock.set(1_010);
    h.runner.drain(4);
    return JSON.stringify(h.runner.snapshot());
  }
  assert.equal(scenario(), scenario());
});

test('backoff rejects ambient or invalid jitter instead of hiding nondeterminism', () => {
  const clock = new ManualClock();
  const policy = new DeterministicBackoff(clock, { next: () => 2 }, {
    baseDelayMs: 10,
    maximumDelayMs: 100,
    retryCeiling: 2,
    cooldownMs: 50,
    jitterRatio: 0.2,
  });
  assert.throws(() => policy.fail(), /jitter source/);
});

test('backoff cooldown overflow rejects transactionally without retaining an unsafe retry', () => {
  const clock = new ManualClock(Number.MAX_SAFE_INTEGER - 1);
  const backoff = new DeterministicBackoff(clock, { next: () => 0.5 }, {
    baseDelayMs: 1, maximumDelayMs: 1, retryCeiling: 0, cooldownMs: 10, jitterRatio: 0,
  });
  const before = backoff.snapshot();
  assert.throws(() => backoff.fail(), /cooldown timestamp overflow/);
  assert.deepEqual(backoff.snapshot(), before);
});
