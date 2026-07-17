import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BASELINE_BOOTSTRAP_STATES,
  BASELINE_HISTORY_INTEGRATION_GAP,
  BASELINE_HISTORY_SOURCES,
  BaselineBootstrapScheduler,
  createBaselineBootstrapConfig,
  estimateKlineRequestWeight,
  parseCompletedKlinePage,
} from '../../../dist/intelligenceRuntime/baseline/index.js';

const MINUTE = 60_000;
const WEEK = 7 * 24 * 60 * MINUTE;
const T0 = 1_800_000_000_000;
const NOW = T0 + 3 * MINUTE;

class ManualClock {
  constructor(now = NOW) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
}

class ManualDeadlineScheduler {
  constructor(clock) {
    this.clock = clock;
    this.tasks = new Map();
  }
  schedule(id, delayMs, task) {
    assert.equal(this.tasks.has(id), false, `duplicate deadline id: ${id}`);
    this.tasks.set(id, { delayMs, task });
  }
  cancel(id) {
    this.tasks.delete(id);
  }
  fireNext() {
    const next = this.tasks.entries().next();
    if (next.done) return false;
    const [id, entry] = next.value;
    this.tasks.delete(id);
    this.clock.set(this.clock.nowMs() + entry.delayMs);
    entry.task();
    return true;
  }
}

class MemoryCheckpoint {
  constructor() {
    this.values = new Map();
    this.loads = [];
    this.saves = [];
  }
  async load(id) {
    this.loads.push(id);
    const value = this.values.get(id);
    return value === undefined ? null : structuredClone(value);
  }
  async save(id, value) {
    const clone = structuredClone(value);
    this.values.set(id, clone);
    this.saves.push({ id, value: clone });
  }
}

class FailOnSaveCheckpoint extends MemoryCheckpoint {
  constructor(failOnSave) {
    super();
    this.failOnSave = failOnSave;
    this.attempts = 0;
  }
  async save(id, value) {
    this.attempts += 1;
    if (this.attempts === this.failOnSave) throw new Error('fixture checkpoint save failure');
    return super.save(id, value);
  }
}

class QueueHistory {
  constructor() {
    this.calls = [];
    this.contexts = [];
    this.queue = [];
    this.handler = null;
  }
  enqueue(result) { this.queue.push(result); }
  async fetch(request, context) {
    this.calls.push(structuredClone(request));
    this.contexts.push(context);
    if (this.handler) return this.handler(request, context);
    if (this.queue.length === 0) throw new Error('no history result queued');
    const result = this.queue.shift();
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result(request) : result;
  }
}

class FixtureBudget {
  constructor() {
    this.reservations = [];
    this.settlements = [];
    this.queue = [];
    this.sequence = 0;
  }
  enqueue(result) { this.queue.push(result); }
  async reserve(request) {
    this.reservations.push(structuredClone(request));
    if (this.queue.length > 0) return this.queue.shift();
    this.sequence += 1;
    return { kind: 'GRANTED', reservationId: `reservation-${this.sequence}` };
  }
  async settle(value) { this.settlements.push(structuredClone(value)); }
}

class CollectSink {
  constructor() {
    this.batches = [];
    this.failuresRemaining = 0;
  }
  async write(batch) {
    this.batches.push(structuredClone(batch));
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('fixture sink failure');
    }
  }
}

function kline(openTimeMs, overrides = {}) {
  return [
    openTimeMs,
    overrides.open ?? '10.00000000',
    overrides.high ?? '12.00000000',
    overrides.low ?? '9.00000000',
    overrides.close ?? '11.00000000',
    overrides.baseVolume ?? '5.00000000',
    overrides.closeTimeMs ?? openTimeMs + MINUTE - 1,
    overrides.quoteVolume ?? '55.00000000',
    overrides.tradeCount ?? 7,
    overrides.takerBuyBaseVolume ?? '3.00000000',
    overrides.takerBuyQuoteVolume ?? '33.00000000',
    '0',
  ];
}

function success(rows, overrides = {}) {
  return {
    kind: 'SUCCESS',
    rows,
    hasMore: overrides.hasMore ?? false,
    receiveTimeMs: overrides.receiveTimeMs ?? NOW,
    actualWeight: overrides.actualWeight ?? 2,
  };
}

function item(symbol = 'BTCUSDT', overrides = {}) {
  return {
    symbol,
    instrumentId: `instrument:${symbol}`,
    productFamily: 'SPOT',
    feature: 'activity_baseline',
    featureVersion: 'activity-baseline-1',
    interval: '1m',
    requestedStartTimeMs: T0,
    targetEndTimeMs: NOW,
    minimumSamples: 1,
    listedAtMs: T0 - 365 * 24 * 60 * MINUTE,
    delistedAtMs: null,
    listingState: 'ACTIVE',
    ...overrides,
  };
}

function plan(items = [item()], overrides = {}) {
  return { name: 'runtime-baseline', version: '1', items, ...overrides };
}

function fixture(overrides = {}) {
  const clock = overrides.clock ?? new ManualClock();
  const history = overrides.history ?? new QueueHistory();
  const budget = overrides.budget ?? new FixtureBudget();
  const checkpoint = overrides.checkpoint ?? new MemoryCheckpoint();
  const sink = overrides.sink ?? new CollectSink();
  const deadlineScheduler = overrides.deadlineScheduler ?? new ManualDeadlineScheduler(clock);
  const scheduler = new BaselineBootstrapScheduler({
    clock,
    history,
    weightBudget: budget,
    checkpoint,
    sink,
    deadlineScheduler,
    config: overrides.config,
  });
  return { scheduler, clock, history, budget, checkpoint, sink, deadlineScheduler };
}

function bySymbol(snapshot, symbol) {
  return snapshot.items.find((entry) => entry.symbol === symbol);
}

test('official public source catalog and request-weight tiers are explicit and keyless', () => {
  assert.deepEqual(BASELINE_HISTORY_SOURCES.SPOT, {
    sourceId: BASELINE_HISTORY_SOURCES.SPOT.sourceId,
    baseUrl: 'https://data-api.binance.vision',
    path: '/api/v3/klines',
    credentials: 'NONE',
  });
  assert.equal(BASELINE_HISTORY_SOURCES.USD_M_PERPETUAL.baseUrl, 'https://fapi.binance.com');
  assert.equal(BASELINE_HISTORY_SOURCES.USD_M_PERPETUAL.path, '/fapi/v1/klines');
  assert.equal(estimateKlineRequestWeight('SPOT', 1_000), 2);
  assert.equal(estimateKlineRequestWeight('USD_M_PERPETUAL', 99), 1);
  assert.equal(estimateKlineRequestWeight('USD_M_PERPETUAL', 100), 2);
  assert.equal(estimateKlineRequestWeight('USD_M_PERPETUAL', 499), 2);
  assert.equal(estimateKlineRequestWeight('USD_M_PERPETUAL', 500), 5);
  assert.equal(estimateKlineRequestWeight('USD_M_PERPETUAL', 1_000), 5);
  assert.equal(estimateKlineRequestWeight('USD_M_PERPETUAL', 1_001), 10);
});

test('construction and initialization are inert, deterministic, and expose the honest integration seam', async () => {
  const first = fixture();
  assert.equal(first.scheduler.snapshot(), null);
  assert.deepEqual(first.history.calls, []);
  assert.deepEqual(first.budget.reservations, []);
  assert.deepEqual(first.sink.batches, []);
  const firstSnapshot = await first.scheduler.initialize(plan([item('ETHUSDT'), item('BTCUSDT')]));

  const second = fixture();
  const secondSnapshot = await second.scheduler.initialize(plan([item('BTCUSDT'), item('ETHUSDT')]));
  assert.equal(firstSnapshot.planId, secondSnapshot.planId);
  assert.deepEqual(firstSnapshot.items.map((entry) => entry.id), secondSnapshot.items.map((entry) => entry.id));
  assert.equal(firstSnapshot.integrationGap, BASELINE_HISTORY_INTEGRATION_GAP);
  assert.match(firstSnapshot.integrationGap, /must not fabricate trades/);
  assert.equal(Object.isFrozen(firstSnapshot), true);
  assert.deepEqual(first.history.calls, []);
  assert.deepEqual(first.budget.reservations, []);
  assert.deepEqual(first.sink.batches, []);
});

test('cold start writes only completed aggregate candles and reaches COMPLETE', async () => {
  const f = fixture();
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  await f.scheduler.initialize(plan());
  const snapshot = await f.scheduler.tick();

  assert.equal(snapshot.stateCounts.COMPLETE, 1);
  assert.equal(snapshot.totals.acceptedRecords, 3);
  assert.equal(snapshot.totals.batches, 1);
  assert.equal(snapshot.totals.estimatedWeight, 2);
  assert.equal(snapshot.totals.actualWeight, 2);
  assert.equal(f.history.calls[0].baseUrl, 'https://data-api.binance.vision');
  assert.equal(f.history.calls[0].path, '/api/v3/klines');
  assert.equal(f.history.calls[0].credentials, 'NONE');
  assert.deepEqual(f.history.calls[0].startTimeMs, T0);
  assert.equal(f.sink.batches[0].records.length, 3);
  assert.equal('kind' in f.sink.batches[0].records[0], false);
  assert.equal('aggressorSide' in f.sink.batches[0].records[0], false);
  assert.equal(f.sink.batches[0].records[0].baseVolume, '5.00000000');
  assert.ok(f.checkpoint.saves.length >= 2);
});

test('checkpoint resume continues from the exact cursor and recovers an in-flight marker safely', async () => {
  const checkpoint = new MemoryCheckpoint();
  const first = fixture({ checkpoint, config: { pageLimit: 2 } });
  first.history.enqueue(success([kline(T0), kline(T0 + MINUTE)], { hasMore: true }));
  const planInput = plan();
  const initialized = await first.scheduler.initialize(planInput);
  const partial = await first.scheduler.tick();
  assert.equal(partial.items[0].state, 'PARTIAL');
  assert.equal(partial.items[0].cursorTimeMs, T0 + 2 * MINUTE);

  const stored = checkpoint.values.get(initialized.planId);
  stored.items[0].state = 'FETCHING';
  stored.items[0].terminal = false;
  checkpoint.values.set(initialized.planId, stored);
  const second = fixture({ checkpoint, config: { pageLimit: 2 } });
  second.history.enqueue(success([kline(T0 + 2 * MINUTE)]));
  const restored = await second.scheduler.initialize(planInput);
  assert.equal(restored.restored, true);
  assert.equal(restored.items[0].state, 'PARTIAL');
  assert.equal(restored.items[0].lastReasonCode, 'RECOVERED_IN_FLIGHT_CHECKPOINT');
  const complete = await second.scheduler.tick();
  assert.equal(complete.items[0].state, 'COMPLETE');
  assert.equal(second.history.calls[0].startTimeMs, T0 + 2 * MINUTE);
});

test('an exhausted response with a missing interval is terminal PARTIAL, never silently complete', async () => {
  const f = fixture();
  f.history.enqueue(success([kline(T0), kline(T0 + 2 * MINUTE)]));
  await f.scheduler.initialize(plan([item('GAPUSDT', { minimumSamples: 2 })]));
  const snapshot = await f.scheduler.tick();
  assert.equal(snapshot.items[0].state, 'PARTIAL');
  assert.equal(snapshot.items[0].terminal, true);
  assert.equal(snapshot.items[0].gapCount, 1);
  assert.equal(snapshot.items[0].lastReasonCode, 'COMPLETED_HISTORY_HAS_GAPS');
});

test('delisted and too-young listings resolve honestly without spending request weight', async () => {
  const f = fixture();
  const snapshot = await f.scheduler.initialize(plan([
    item('OLDUSDT', { listingState: 'DELISTED', delistedAtMs: T0 + MINUTE }),
    item('NEWUSDT', { listedAtMs: NOW - MINUTE, minimumSamples: 2 }),
  ]));
  assert.equal(bySymbol(snapshot, 'OLDUSDT').state, 'UNAVAILABLE');
  assert.equal(bySymbol(snapshot, 'NEWUSDT').state, 'INSUFFICIENT_HISTORY');
  const afterTick = await f.scheduler.tick();
  assert.equal(afterTick.totals.estimatedWeight, 0);
  assert.deepEqual(f.history.calls, []);
  assert.deepEqual(f.budget.reservations, []);
});

test('request-budget rate limiting pauses without transport work and resumes at Retry-After', async () => {
  const f = fixture();
  f.budget.enqueue({ kind: 'RATE_LIMITED', retryAtMs: NOW + 5_000, reasonCode: 'WEIGHT_WINDOW_EXHAUSTED' });
  await f.scheduler.initialize(plan());
  const paused = await f.scheduler.tick();
  assert.equal(paused.items[0].state, 'RATE_LIMITED');
  assert.equal(paused.items[0].retryAtMs, NOW + 5_000);
  assert.deepEqual(f.history.calls, []);

  f.clock.set(NOW + 5_000);
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)], { receiveTimeMs: NOW + 5_000 }));
  const resumed = await f.scheduler.tick();
  assert.equal(resumed.items[0].state, 'COMPLETE');
  assert.equal(f.history.calls.length, 1);
});

test('transient source failures use deterministic injected-clock backoff and bounded retry', async () => {
  const f = fixture({ config: { retryBaseDelayMs: 1_000, retryMaximumDelayMs: 8_000 } });
  f.history.enqueue({
    kind: 'TRANSIENT_FAILURE',
    observedAtMs: NOW,
    retryAtMs: null,
    actualWeight: 2,
    message: 'fixture 503',
  });
  await f.scheduler.initialize(plan());
  const waiting = await f.scheduler.tick();
  assert.equal(waiting.items[0].state, 'RETRY_WAIT');
  assert.equal(waiting.items[0].retryAtMs, NOW + 1_000);
  const tooSoon = await f.scheduler.tick();
  assert.equal(tooSoon.items[0].dispatchCount, 1);

  f.clock.set(NOW + 1_000);
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)], { receiveTimeMs: NOW + 1_000 }));
  const recovered = await f.scheduler.tick();
  assert.equal(recovered.items[0].state, 'COMPLETE');
  assert.equal(recovered.items[0].retryCount, 0);
});

test('never-settling history fetch times out, aborts, releases the tick, and retries', async () => {
  const f = fixture({ config: { retryBaseDelayMs: 10, retryMaximumDelayMs: 100 } });
  f.history.handler = () => new Promise(() => {});
  await f.scheduler.initialize(plan());
  const pendingTick = f.scheduler.tick();
  for (let index = 0; index < 20 && f.deadlineScheduler.tasks.size === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(f.deadlineScheduler.tasks.size, 1, 'history fetch must install an injected deadline');
  assert.equal(f.deadlineScheduler.fireNext(), true);
  const timedOut = await pendingTick;
  assert.equal(f.history.contexts[0].signal.aborted, true);
  assert.equal(timedOut.activeFetchCount, 0);
  assert.equal(timedOut.items[0].state, 'RETRY_WAIT');
  assert.equal(timedOut.items[0].lastReasonCode, 'HISTORY_FETCH_TIMEOUT');
  assert.equal(f.budget.settlements[0].outcome, 'TIMEOUT');
  assert.equal(f.budget.settlements[0].actualWeight, 0);
  assert.equal(f.deadlineScheduler.tasks.size, 0);

  f.history.handler = null;
  f.clock.set(timedOut.items[0].retryAtMs);
  f.history.enqueue(success([
    kline(T0),
    kline(T0 + MINUTE),
    kline(T0 + 2 * MINUTE),
  ], { receiveTimeMs: f.clock.nowMs() }));
  const recovered = await f.scheduler.tick();
  assert.equal(recovered.items[0].state, 'COMPLETE');
  assert.equal(recovered.activeFetchCount, 0);
  assert.equal(f.deadlineScheduler.tasks.size, 0);
});

test('history deadline is anchored to actual dispatch after prefetch port delay', async () => {
  const f = fixture({ config: { historyRequestTimeoutMs: 25, retryBaseDelayMs: 10, retryMaximumDelayMs: 100 } });
  const reserve = f.budget.reserve.bind(f.budget);
  f.budget.reserve = async (request) => {
    const reservation = await reserve(request);
    f.clock.set(NOW + 100);
    return reservation;
  };
  f.history.handler = () => new Promise(() => {});
  await f.scheduler.initialize(plan());
  const pendingTick = f.scheduler.tick();
  for (let index = 0; index < 20 && f.deadlineScheduler.tasks.size === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(f.history.contexts.length, 1);
  assert.equal(f.history.contexts[0].method, 'GET');
  assert.equal(f.history.contexts[0].deadlineAtMs, NOW + 125);
  assert.equal([...f.deadlineScheduler.tasks.values()][0]?.delayMs, 25);
  assert.equal(f.deadlineScheduler.fireNext(), true);
  const timedOut = await pendingTick;
  assert.equal(timedOut.items[0].lastReasonCode, 'HISTORY_FETCH_TIMEOUT');
  assert.equal(f.clock.nowMs(), f.history.contexts[0].deadlineAtMs);
});

test('focused burst priority forces universe coverage before a focus symbol can starve it', async () => {
  const f = fixture({ config: { maximumParallelism: 1, focusedBurstLimit: 2 } });
  f.history.handler = (request) => success([kline(request.startTimeMs)]);
  await f.scheduler.initialize(plan([
    item('FOCUSA', { targetEndTimeMs: T0 + MINUTE }),
    item('FOCUSB', { targetEndTimeMs: T0 + MINUTE }),
    item('FOCUSC', { targetEndTimeMs: T0 + MINUTE }),
    item('UNIVERSEZ', { targetEndTimeMs: T0 + MINUTE }),
  ]));
  await f.scheduler.tick({ focusedSymbols: ['FOCUSA', 'FOCUSB', 'FOCUSC'] });
  await f.scheduler.tick({ focusedSymbols: ['FOCUSA', 'FOCUSB', 'FOCUSC'] });
  await f.scheduler.tick({ focusedSymbols: ['FOCUSA', 'FOCUSB', 'FOCUSC'] });
  assert.match(f.history.calls[0].symbol, /^FOCUS/);
  assert.match(f.history.calls[1].symbol, /^FOCUS/);
  assert.equal(f.history.calls[2].symbol, 'UNIVERSEZ');
});

test('the current incomplete candle is counted and excluded until a later explicit tick completes it', async () => {
  const clock = new ManualClock(T0 + 2 * MINUTE + 30_000);
  const f = fixture({ clock, config: { pageLimit: 3 } });
  f.history.enqueue(success([
    kline(T0),
    kline(T0 + MINUTE),
    kline(T0 + 2 * MINUTE),
  ], { receiveTimeMs: clock.nowMs() }));
  await f.scheduler.initialize(plan());
  const partial = await f.scheduler.tick();
  assert.equal(partial.items[0].state, 'PARTIAL');
  assert.equal(partial.items[0].terminal, false);
  assert.equal(partial.items[0].acceptedRecordCount, 2);
  assert.equal(partial.items[0].excludedIncompleteCount, 1);
  assert.equal(f.sink.batches[0].records.length, 2);
  assert.equal(f.sink.batches[0].records.some((record) => record.openTimeMs === T0 + 2 * MINUTE), false);

  clock.set(NOW);
  f.history.enqueue(success([kline(T0 + 2 * MINUTE)], { receiveTimeMs: NOW }));
  const complete = await f.scheduler.tick();
  assert.equal(complete.items[0].state, 'COMPLETE');
  assert.equal(complete.items[0].acceptedRecordCount, 3);
});

test('history freshness and source unavailability remain distinct truthful states', async () => {
  const staleClock = new ManualClock(T0 + 10 * MINUTE);
  const stale = fixture({ staleClock, clock: staleClock, config: { staleAfterMs: MINUTE } });
  stale.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)], {
    receiveTimeMs: staleClock.nowMs(),
  }));
  await stale.scheduler.initialize(plan());
  const staleSnapshot = await stale.scheduler.tick();
  assert.equal(staleSnapshot.items[0].state, 'STALE');

  const unavailable = fixture();
  unavailable.history.enqueue({
    kind: 'UNAVAILABLE',
    observedAtMs: NOW,
    actualWeight: 2,
    message: 'symbol history unavailable',
  });
  await unavailable.scheduler.initialize(plan());
  const unavailableSnapshot = await unavailable.scheduler.tick();
  assert.equal(unavailableSnapshot.items[0].state, 'UNAVAILABLE');
});

test('record and page bounds terminate as explicit PARTIAL instead of retaining unbounded history', async () => {
  const f = fixture({ config: { pageLimit: 2, maximumRecordsPerItem: 2 } });
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE)], { hasMore: true }));
  await f.scheduler.initialize(plan());
  const snapshot = await f.scheduler.tick();
  assert.equal(snapshot.items[0].acceptedRecordCount, 2);
  assert.equal(snapshot.items[0].state, 'PARTIAL');
  assert.equal(snapshot.items[0].terminal, true);
  assert.equal(snapshot.items[0].lastReasonCode, 'BASELINE_BOUND_REACHED');
});

test('sink retries reuse the same request and batch identities for idempotent crash-safe delivery', async () => {
  const sink = new CollectSink();
  sink.failuresRemaining = 1;
  const f = fixture({ sink, config: { retryBaseDelayMs: 1_000 } });
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)], {
    receiveTimeMs: NOW + 1_000,
  }));
  await f.scheduler.initialize(plan());
  const retry = await f.scheduler.tick();
  assert.equal(retry.items[0].state, 'RETRY_WAIT');
  f.clock.set(NOW + 1_000);
  const complete = await f.scheduler.tick();
  assert.equal(complete.items[0].state, 'COMPLETE');
  assert.equal(f.history.calls[0].requestId, f.history.calls[1].requestId);
  assert.equal(sink.batches[0].id, sink.batches[1].id);
});

test('strict page validation rejects impossible tuples without contaminating the sink', async () => {
  const f = fixture({ config: { retryCeiling: 1 } });
  f.history.enqueue(success([kline(T0, { baseVolume: '-1' })]));
  await f.scheduler.initialize(plan());
  const snapshot = await f.scheduler.tick();
  assert.equal(snapshot.items[0].state, 'RETRY_WAIT');
  assert.equal(snapshot.items[0].lastReasonCode, 'INVALID_KLINE_DECIMAL');
  assert.deepEqual(f.sink.batches, []);
});

test('checkpoint validation rejects corrupt or future-shaped state instead of blindly resuming it', async () => {
  const checkpoint = new MemoryCheckpoint();
  const first = fixture({ checkpoint, config: { pageLimit: 2 } });
  first.history.enqueue(success([kline(T0), kline(T0 + MINUTE)], { hasMore: true }));
  const planInput = plan();
  const initial = await first.scheduler.initialize(planInput);
  await first.scheduler.tick();
  const corrupt = checkpoint.values.get(initial.planId);
  corrupt.unexpected = true;
  checkpoint.values.set(initial.planId, corrupt);

  const second = fixture({ checkpoint, config: { pageLimit: 2 } });
  await assert.rejects(second.scheduler.initialize(planInput), /invalid checkpoint shape/);
});

test('checkpoint restore rejects false COMPLETE semantics and scheduler/item accounting disagreement', async () => {
  const checkpoint = new MemoryCheckpoint();
  const first = fixture({ checkpoint, config: { pageLimit: 2 } });
  first.history.enqueue(success([kline(T0), kline(T0 + MINUTE)], { hasMore: true }));
  const planInput = plan();
  const initial = await first.scheduler.initialize(planInput);
  await first.scheduler.tick();
  const valid = structuredClone(checkpoint.values.get(initial.planId));

  const falseComplete = structuredClone(valid);
  falseComplete.items[0].state = 'COMPLETE';
  falseComplete.items[0].terminal = true;
  checkpoint.values.set(initial.planId, falseComplete);
  const semantic = fixture({ checkpoint, config: { pageLimit: 2 } });
  await assert.rejects(semantic.scheduler.initialize(planInput), /COMPLETE checkpoint does not satisfy terminal history invariants/);

  const badTotals = structuredClone(valid);
  badTotals.totals.actualWeight += 1;
  checkpoint.values.set(initial.planId, badTotals);
  const accounting = fixture({ checkpoint, config: { pageLimit: 2 } });
  await assert.rejects(accounting.scheduler.initialize(planInput), /does not reconcile with scheduler totals/);
});

test('a fresh COMPLETE checkpoint is re-aged to STALE against the new injected clock', async () => {
  const checkpoint = new MemoryCheckpoint();
  const first = fixture({ checkpoint, config: { staleAfterMs: 1_000 } });
  first.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  const planInput = plan();
  await first.scheduler.initialize(planInput);
  assert.equal((await first.scheduler.tick()).items[0].state, 'COMPLETE');

  const laterClock = new ManualClock(NOW + 2_000);
  const restored = fixture({ checkpoint, clock: laterClock, config: { staleAfterMs: 1_000 } });
  const snapshot = await restored.scheduler.initialize(planInput);
  assert.equal(snapshot.items[0].state, 'STALE');
  assert.equal(snapshot.items[0].lastReasonCode, 'COMPLETED_HISTORY_STALE_AFTER_RESTORE');
});

test('valid Binance Monday-UTC weekly candles retain 1w support and exact planning boundaries', async () => {
  const monday = Date.UTC(2024, 6, 1);
  const weeklyClock = new ManualClock(monday + WEEK);
  const f = fixture({ clock: weeklyClock });
  f.history.enqueue(success([
    kline(monday, { closeTimeMs: monday + WEEK - 1 }),
  ], { receiveTimeMs: weeklyClock.nowMs() }));
  await f.scheduler.initialize(plan([item('WEEKUSDT', {
    interval: '1w',
    requestedStartTimeMs: monday - 24 * 60 * MINUTE,
    targetEndTimeMs: monday + WEEK,
    listedAtMs: monday - WEEK,
    minimumSamples: 1,
  })]));
  const snapshot = await f.scheduler.tick();
  assert.equal(f.history.calls[0].startTimeMs, monday);
  assert.equal(snapshot.items[0].state, 'COMPLETE');
  assert.equal(snapshot.items[0].acceptedRecordCount, 1);
});

test('pre-fetch checkpoint failure releases every granted weight reservation and leaves no FETCHING ghost', async () => {
  const checkpoint = new MemoryCheckpoint();
  checkpoint.save = async () => { throw new Error('checkpoint unavailable'); };
  const f = fixture({ checkpoint });
  f.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  await f.scheduler.initialize(plan());
  await assert.rejects(f.scheduler.tick(), /checkpoint unavailable/);
  assert.equal(f.history.calls.length, 0);
  assert.equal(f.budget.reservations.length, 1);
  assert.equal(f.budget.settlements.length, 1);
  assert.equal(f.budget.settlements[0].outcome, 'DISPATCH_ABORTED');
  assert.equal(f.budget.settlements[0].actualWeight, 0);
  const snapshot = f.scheduler.snapshot();
  assert.equal(snapshot.items[0].state, 'RETRY_WAIT');
  assert.equal(snapshot.items[0].dispatchCount, 0);
  assert.equal(snapshot.items[0].estimatedWeight, 0);
  assert.equal(snapshot.activeFetchCount, 0);
  assert.equal(snapshot.totals.estimatedWeight, 0);
});

test('parallelism is bounded and concurrent ticks coalesce to one in-flight operation', async () => {
  const history = new QueueHistory();
  const pending = [];
  history.handler = (request) => new Promise((resolve) => pending.push({ request, resolve }));
  const f = fixture({ history, config: { maximumParallelism: 2 } });
  await f.scheduler.initialize(plan([item('AAAUSDT'), item('BBBUSDT'), item('CCCUSDT')]));
  const first = f.scheduler.tick();
  const second = f.scheduler.tick();
  assert.strictEqual(first, second);
  for (let index = 0; index < 6 && pending.length < 2; index += 1) await Promise.resolve();
  assert.equal(pending.length, 2);
  assert.equal(f.scheduler.snapshot().activeFetchCount, 2);
  for (const entry of pending) {
    entry.resolve(success([
      kline(T0),
      kline(T0 + MINUTE),
      kline(T0 + 2 * MINUTE),
    ]));
  }
  await first;
  assert.equal(history.calls.length, 2);
  assert.equal(f.scheduler.snapshot().activeFetchCount, 0);
});

test('concurrent ticks coalesce only for the same canonical focus input', async () => {
  const history = new QueueHistory();
  const pending = [];
  history.handler = (request) => new Promise((resolve) => pending.push({ request, resolve }));
  const f = fixture({ history, config: { maximumParallelism: 1 } });
  await f.scheduler.initialize(plan([item('AAAUSDT'), item('BBBUSDT'), item('CCCUSDT')]));
  const first = f.scheduler.tick({ focusedSymbols: ['BBBUSDT', 'AAAUSDT', 'AAAUSDT'] });
  const equivalent = f.scheduler.tick({ focusedSymbols: ['AAAUSDT', 'BBBUSDT'] });
  assert.strictEqual(first, equivalent);
  await assert.rejects(
    f.scheduler.tick({ focusedSymbols: ['CCCUSDT'] }),
    /different focus input is already in flight/,
  );
  for (let index = 0; index < 6 && pending.length < 1; index += 1) await Promise.resolve();
  pending[0].resolve(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  await first;
  assert.equal(history.calls.length, 1);
});

test('post-fetch checkpoint failure still settles and applies every completed parallel outcome', async () => {
  const checkpoint = new FailOnSaveCheckpoint(2);
  const f = fixture({ checkpoint, config: { maximumParallelism: 2 } });
  f.history.handler = (request) => success([kline(request.startTimeMs)], { receiveTimeMs: NOW });
  await f.scheduler.initialize(plan([
    item('AAAUSDT', { targetEndTimeMs: T0 + MINUTE }),
    item('BBBUSDT', { targetEndTimeMs: T0 + MINUTE }),
  ]));
  await assert.rejects(f.scheduler.tick(), /checkpoint save failure/);
  const snapshot = f.scheduler.snapshot();
  assert.equal(snapshot.activeFetchCount, 0);
  assert.equal(snapshot.items.some((entry) => entry.state === 'FETCHING'), false);
  assert.equal(snapshot.items.every((entry) => entry.state === 'COMPLETE'), true);
  assert.equal(f.budget.settlements.length, 2);
  assert.equal(snapshot.totals.actualWeight, 4);
  assert.equal(checkpoint.attempts, 3);
});

test('known consumed weight remains accounted when the injected settlement port throws', async () => {
  const budget = new FixtureBudget();
  budget.settle = async (value) => {
    budget.settlements.push(structuredClone(value));
    throw new Error('fixture settlement failure');
  };
  const f = fixture({ budget });
  f.history.enqueue(success([kline(T0)], { actualWeight: 7 }));
  await f.scheduler.initialize(plan());
  const snapshot = await f.scheduler.tick();
  assert.equal(snapshot.items[0].state, 'RETRY_WAIT');
  assert.equal(snapshot.items[0].lastReasonCode, 'WEIGHT_SETTLEMENT_FAILURE');
  assert.equal(snapshot.items[0].actualWeight, 7);
  assert.equal(snapshot.totals.actualWeight, 7);
});

test('successful history receive time must fall between dispatch and injected completion', async () => {
  for (const receiveTimeMs of [NOW - 1, NOW + 1]) {
    const f = fixture();
    f.history.enqueue(success([kline(T0)], { receiveTimeMs }));
    await f.scheduler.initialize(plan());
    const snapshot = await f.scheduler.tick();
    assert.equal(snapshot.items[0].state, 'RETRY_WAIT');
    assert.equal(snapshot.items[0].lastReasonCode, 'INVALID_HISTORY_RESULT');
    assert.deepEqual(f.sink.batches, []);
  }
});

test('fetch completion time governs success freshness, snapshots, and checkpoints', async () => {
  const completionTimeMs = NOW + 2_000;
  const clock = new ManualClock();
  const history = new QueueHistory();
  history.handler = () => {
    clock.set(completionTimeMs);
    return success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)], {
      receiveTimeMs: completionTimeMs,
    });
  };
  const f = fixture({ clock, history, config: { staleAfterMs: 1_000 } });
  const initialized = await f.scheduler.initialize(plan());
  const snapshot = await f.scheduler.tick();

  assert.equal(snapshot.snapshotTimeMs, completionTimeMs);
  assert.equal(snapshot.items[0].state, 'STALE');
  assert.equal(f.checkpoint.saves.at(-1).value.savedAtMs, completionTimeMs);
  assert.equal(f.checkpoint.values.get(initialized.planId).savedAtMs, completionTimeMs);
});

test('parallel outcomes retain dispatch order with a monotonic completion-time retry watermark', async () => {
  const clock = new ManualClock();
  const history = new QueueHistory();
  const pending = new Map();
  history.handler = (request) => new Promise((resolve) => pending.set(request.symbol, resolve));
  const f = fixture({
    clock,
    history,
    config: { maximumParallelism: 2, retryBaseDelayMs: 1_000, retryMaximumDelayMs: 8_000 },
  });
  await f.scheduler.initialize(plan([
    item('AAAUSDT', { targetEndTimeMs: T0 + MINUTE }),
    item('BBBUSDT', { targetEndTimeMs: T0 + MINUTE }),
  ]));

  const ticking = f.scheduler.tick();
  for (let index = 0; index < 10 && history.calls.length < 2; index += 1) await Promise.resolve();
  assert.equal(history.calls.length, 2);
  const first = history.calls[0];
  const second = history.calls[1];

  const earlierCompletionMs = NOW + 2_000;
  clock.set(earlierCompletionMs);
  pending.get(second.symbol)({
    kind: 'TRANSIENT_FAILURE',
    observedAtMs: earlierCompletionMs,
    retryAtMs: null,
    actualWeight: 2,
    message: 'fixture 503',
  });
  for (let index = 0; index < 4; index += 1) await Promise.resolve();

  const laterCompletionMs = NOW + 5_000;
  clock.set(laterCompletionMs);
  pending.get(first.symbol)(success([kline(T0)], { receiveTimeMs: laterCompletionMs }));
  const snapshot = await ticking;

  assert.equal(snapshot.snapshotTimeMs, laterCompletionMs);
  assert.equal(bySymbol(snapshot, first.symbol).state, 'COMPLETE');
  assert.equal(bySymbol(snapshot, second.symbol).state, 'RETRY_WAIT');
  assert.equal(bySymbol(snapshot, second.symbol).lastReasonCode, 'HISTORY_TRANSIENT_FAILURE');
  assert.equal(bySymbol(snapshot, second.symbol).retryAtMs, laterCompletionMs + 1_000);
  assert.deepEqual(
    f.checkpoint.saves.map(({ value }) => value.savedAtMs),
    [NOW, laterCompletionMs, laterCompletionMs],
  );
});

test('baseline config is exact, accessor-safe, and its minimum bounds restore self-written checkpoints', async () => {
  assert.throws(() => createBaselineBootstrapConfig({ secret: 'no' }), /unknown field secret/);
  assert.throws(() => createBaselineBootstrapConfig({ maximumIdentityLength: 63 }), /maximumIdentityLength/);
  assert.throws(() => createBaselineBootstrapConfig({ maximumMessageLength: 127 }), /maximumMessageLength/);
  const symbolConfig = {};
  symbolConfig[Symbol('secret')] = 'no';
  assert.throws(() => createBaselineBootstrapConfig(symbolConfig), /symbol keys/);
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'pageLimit', { enumerable: true, get() { getterCalls += 1; return 1; } });
  assert.throws(() => createBaselineBootstrapConfig(accessor), /data property/);
  assert.equal(getterCalls, 0);

  const checkpoint = new MemoryCheckpoint();
  const config = { maximumIdentityLength: 64, maximumMessageLength: 128 };
  const first = fixture({ checkpoint, config });
  first.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  const initialized = await first.scheduler.initialize(plan());
  await first.scheduler.tick();
  assert.ok(checkpoint.values.has(initialized.planId));
  const restored = fixture({ checkpoint, config });
  assert.equal((await restored.scheduler.initialize(plan())).restored, true);
});

test('terminal checkpoint states require structural justification and weights remain dispatch-derived', async () => {
  const checkpoint = new MemoryCheckpoint();
  const config = { pageLimit: 1 };
  const planInput = plan([item('FORGEUSDT', { minimumSamples: 2 })]);
  const first = fixture({ checkpoint, config });
  first.history.enqueue(success([kline(T0)], { hasMore: true }));
  const initialized = await first.scheduler.initialize(planInput);
  await first.scheduler.tick();
  const base = checkpoint.values.get(initialized.planId);

  async function rejectsMutation(mutator, pattern) {
    const value = structuredClone(base);
    mutator(value);
    const forgedCheckpoint = new MemoryCheckpoint();
    forgedCheckpoint.values.set(initialized.planId, value);
    const restored = fixture({ checkpoint: forgedCheckpoint, config });
    await assert.rejects(restored.scheduler.initialize(planInput), pattern);
  }

  await rejectsMutation((value) => {
    value.items[0].state = 'INSUFFICIENT_HISTORY';
    value.items[0].terminal = true;
    value.items[0].retryAtMs = null;
    value.items[0].lastReasonCode = 'COMPLETED_HISTORY_INSUFFICIENT';
  }, /lacks a terminal justification/);
  await rejectsMutation((value) => {
    value.items[0].terminal = true;
    value.items[0].retryAtMs = null;
    value.items[0].lastReasonCode = 'HISTORY_PAGE_APPLIED';
  }, /terminal PARTIAL checkpoint lacks/);
  await rejectsMutation((value) => {
    const itemValue = value.items[0];
    itemValue.state = 'UNAVAILABLE';
    itemValue.terminal = true;
    itemValue.retryAtMs = null;
    itemValue.cursorTimeMs = T0;
    itemValue.acceptedRecordCount = 0;
    itemValue.pageCount = 0;
    itemValue.batchCount = 0;
    itemValue.lastBatchId = null;
    itemValue.lastCompletedCloseTimeMs = null;
    itemValue.lastReasonCode = 'FORGED_UNAVAILABLE';
    value.totals.batches = 0;
  }, /lacks a terminal justification/);
  await rejectsMutation((value) => {
    value.items[0].estimatedWeight = 3;
    value.totals.estimatedWeight = 3;
  }, /dispatch-derived bounds/);
  await rejectsMutation((value) => {
    value.items[0].actualWeight = 1_000_001;
    value.totals.actualWeight = 1_000_001;
  }, /dispatch-derived bounds/);
});

test('legitimate initial terminal items remain restorable in a mixed checkpoint', async () => {
  const checkpoint = new MemoryCheckpoint();
  const planInput = plan([
    item('ACTIVEUSDT'),
    item('DELISTEDUSDT', { listingState: 'DELISTED', delistedAtMs: T0 + MINUTE }),
    item('YOUNGUSDT', { listedAtMs: NOW - MINUTE, minimumSamples: 2 }),
  ]);
  const first = fixture({ checkpoint });
  first.history.enqueue(success([kline(T0), kline(T0 + MINUTE), kline(T0 + 2 * MINUTE)]));
  await first.scheduler.initialize(planInput);
  await first.scheduler.tick();
  const restored = fixture({ checkpoint });
  const snapshot = await restored.scheduler.initialize(planInput);
  assert.equal(snapshot.restored, true);
  assert.equal(bySymbol(snapshot, 'DELISTEDUSDT').state, 'UNAVAILABLE');
  assert.equal(bySymbol(snapshot, 'YOUNGUSDT').state, 'INSUFFICIENT_HISTORY');
});

test('all declared state counters are present even when zero', async () => {
  const f = fixture();
  const snapshot = await f.scheduler.initialize(plan());
  assert.deepEqual(Object.keys(snapshot.stateCounts), [...BASELINE_BOOTSTRAP_STATES]);
  assert.equal(snapshot.stateCounts.PENDING, 1);
  assert.equal(Object.values(snapshot.stateCounts).reduce((sum, value) => sum + value, 0), 1);
});

test('the standalone parser preserves exact decimals and rejects conflicting duplicate opens', () => {
  const request = {
    requestId: 'request',
    planId: 'plan',
    planItemId: 'item',
    sourceId: 'source',
    productFamily: 'SPOT',
    symbol: 'BTCUSDT',
    instrumentId: 'instrument:BTCUSDT',
    feature: 'activity_baseline',
    featureVersion: '1',
    interval: '1m',
    intervalMs: MINUTE,
    baseUrl: 'https://data-api.binance.vision',
    path: '/api/v3/klines',
    credentials: 'NONE',
    startTimeMs: T0,
    endTimeMs: NOW - 1,
    limit: 3,
    estimatedWeight: 2,
    tickNowMs: NOW,
  };
  const parsed = parseCompletedKlinePage(request, [kline(T0)], NOW);
  assert.equal(parsed.records[0].open, '10.00000000');
  assert.throws(() => parseCompletedKlinePage(request, [
    kline(T0),
    kline(T0, { close: '10.50000000' }),
  ], NOW), /conflicting values/);
  assert.throws(() => parseCompletedKlinePage({ ...request, limit: 0 }, [], NOW), /limit must be in/);
  assert.throws(() => parseCompletedKlinePage({ ...request, limit: 1_001 }, [], NOW), /limit must be in/);
  assert.throws(() => parseCompletedKlinePage({ ...request, interval: '2s' }, [], NOW), /unsupported fixed baseline interval/);
  assert.throws(() => parseCompletedKlinePage({ ...request, intervalMs: MINUTE + 1 }, [], NOW), /does not match/);
});
