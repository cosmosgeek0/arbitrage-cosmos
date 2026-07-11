import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RUNTIME_ENDPOINTS,
  RUNTIME_LIFECYCLE_STATES,
  SourceLifecycleTracker,
  createRuntimeSourceId,
  serializeRuntimeSourceSnapshot,
  sourceDefinition,
} from '../../../dist/intelligenceRuntime/contracts/index.js';

class ManualClock {
  constructor(now = 1_000) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
}

function definition(overrides = {}) {
  return sourceDefinition({
    capability: 'spot-broad-book',
    streamOrPath: 'btcusdt@bookTicker',
    transportKind: 'WEBSOCKET',
    endpointClass: 'PUBLIC',
    productFamily: 'SPOT',
    silentAfterMs: 100,
    staleAfterMs: 500,
    maximumFutureSkewMs: 10,
    retryCeiling: 5,
    authority: 'COMPLETE',
    ...overrides,
  });
}

test('lifecycle vocabulary is frozen and complete', () => {
  assert.deepEqual(RUNTIME_LIFECYCLE_STATES, [
    'STOPPED', 'CONNECTING', 'WARMING', 'LIVE', 'SILENT', 'STALE', 'DEGRADED',
    'BACKING_OFF', 'RATE_LIMITED', 'FAILED',
  ]);
  assert.ok(Object.isFrozen(RUNTIME_LIFECYCLE_STATES));
});

test('source IDs and endpoint catalog are deterministic and routed', () => {
  const input = {
    capability: 'broad-usdm-mark',
    endpointClass: 'MARKET',
    productFamily: 'USD_M_PERPETUAL',
    streamOrPath: '!markPrice@arr@1s',
  };
  assert.equal(createRuntimeSourceId(input), createRuntimeSourceId({ ...input }));
  assert.equal(RUNTIME_ENDPOINTS.USD_M_PUBLIC_WEBSOCKET.baseUrl, 'wss://fstream.binance.com/public');
  assert.equal(RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl, 'wss://fstream.binance.com/market');
  assert.equal(RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.credentials, 'NONE');
});

test('start, connect, useful message, process, and stop are explicit', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  const generation = tracker.start();
  assert.equal(tracker.snapshot().observedState, 'CONNECTING');
  assert.equal(tracker.connected(generation), true);
  assert.equal(tracker.snapshot().observedState, 'WARMING');
  clock.set(1_010);
  assert.equal(tracker.message({ generation, sourceTimeMs: 1_005, receiveTimeMs: 1_010 }), true);
  clock.set(1_012);
  assert.equal(tracker.processed(generation), true);
  const live = tracker.snapshot();
  assert.equal(live.observedState, 'LIVE');
  assert.equal(live.messageAgeMs, 2);
  assert.equal(live.processingLagMs, 2);
  tracker.stop();
  assert.equal(tracker.snapshot().observedState, 'STOPPED');
});

test('socket open without a useful message becomes SILENT', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  const generation = tracker.start();
  tracker.connected(generation);
  clock.set(1_100);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.observedState, 'SILENT');
  assert.equal(snapshot.completeness, 'PARTIAL');
  assert.match(snapshot.recommendedAction, /useful messages/i);
});

test('an aging useful message becomes STALE rather than healthy', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  const generation = tracker.start();
  tracker.connected(generation);
  tracker.message({ generation, sourceTimeMs: 1_000, receiveTimeMs: 1_000 });
  clock.set(1_500);
  assert.equal(tracker.snapshot().observedState, 'STALE');
});

test('old connection generations cannot publish after reconnect', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  const first = tracker.start();
  tracker.connected(first);
  const second = tracker.reconnect();
  assert.equal(second, first + 1);
  assert.equal(tracker.message({ generation: first, sourceTimeMs: 1_000, receiveTimeMs: 1_000 }), false);
  tracker.connected(second);
  assert.equal(tracker.message({ generation: second, sourceTimeMs: 1_000, receiveTimeMs: 1_000 }), true);
  assert.equal(tracker.snapshot().messageCount, 1);
});

test('invalid and future timestamps are rejected with injected time', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  const generation = tracker.start();
  tracker.connected(generation);
  assert.throws(
    () => tracker.message({ generation, sourceTimeMs: -1, receiveTimeMs: 1_000 }),
    /non-negative safe integer/,
  );
  assert.throws(
    () => tracker.message({ generation, sourceTimeMs: 1_000, receiveTimeMs: 1_011 }),
    /future skew/,
  );
});

test('quality counters are explicit and never silently lost', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  tracker.start();
  tracker.count('invalid', 2);
  tracker.count('duplicate');
  tracker.count('outOfOrder');
  tracker.count('sequenceGap', 3);
  tracker.count('dropped', 4);
  tracker.count('coalesced', 5);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.observedState, 'DEGRADED');
  assert.deepEqual(
    [snapshot.invalidCount, snapshot.duplicateCount, snapshot.outOfOrderCount, snapshot.sequenceGapCount, snapshot.droppedCount, snapshot.coalescedCount],
    [2, 1, 1, 3, 4, 5],
  );
});

test('backoff and rate-limit truth are caller supplied and bounded', () => {
  const clock = new ManualClock();
  const tracker = new SourceLifecycleTracker(definition(), clock);
  tracker.start();
  tracker.backoff({ attempt: 2, delayMs: 200, retryAtMs: 1_200 });
  assert.equal(tracker.snapshot().observedState, 'BACKING_OFF');
  assert.throws(() => tracker.backoff({ attempt: 6, delayMs: 1, retryAtMs: 1_001 }), /ceiling/);
  tracker.rateLimited({
    state: 'COOLDOWN', usedWeight: 2_400, limit: 2_400, intervalMs: 60_000,
    resetsAtMs: 61_000, retryAfterMs: 5_000, observedAtMs: 1_000,
  });
  const limited = tracker.snapshot();
  assert.equal(limited.observedState, 'RATE_LIMITED');
  assert.equal(limited.rateBudget.retryAfterMs, 5_000);
});

test('stable serialization is independent of object access history', () => {
  const clock = new ManualClock();
  const left = new SourceLifecycleTracker(definition(), clock);
  const right = new SourceLifecycleTracker(definition(), clock);
  left.start(); right.start();
  left.snapshot(); left.snapshot();
  assert.equal(serializeRuntimeSourceSnapshot(left.snapshot()), serializeRuntimeSourceSnapshot(right.snapshot()));
});

test('definitions reject unbounded or contradictory freshness policy', () => {
  assert.throws(() => definition({ silentAfterMs: 0 }), /thresholds/);
  assert.throws(() => definition({ silentAfterMs: 500, staleAfterMs: 100 }), /thresholds/);
  assert.throws(() => sourceDefinition({
    capability: 'x', streamOrPath: 'x', transportKind: 'REST', endpointClass: 'REST', productFamily: 'SPOT',
    silentAfterMs: 1, staleAfterMs: 2, maximumFutureSkewMs: 0, retryCeiling: 1, authority: 'COMPLETE',
  }), /capability/);
});

test('snapshot values are defensively frozen', () => {
  const tracker = new SourceLifecycleTracker(definition(), new ManualClock());
  const snapshot = tracker.snapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.backoff));
  assert.ok(Object.isFrozen(snapshot.rateBudget));
});
