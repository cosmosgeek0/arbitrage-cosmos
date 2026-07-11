import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPACITY_ATTENTION_CEILINGS,
  CAPACITY_CHANNELS,
  CAPACITY_MODEL_LIMITS,
  CAPACITY_QUEUE_CLASSES,
  createCapacityWorkloadPlan,
  measureRetainedStructures,
  nearestRankPercentile,
  runDeterministicCapacityWorkload,
} from '../../../dist/intelligenceRuntime/capacity/index.js';

const ZERO_RATES = Object.freeze(Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, 0])));
const ZERO_DRAIN = Object.freeze(Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [queueClass, 0])));

test('capacity plan is a hard-bounded canonical 452-symbol model', () => {
  const plan = createCapacityWorkloadPlan({ durationMs: 500, tickMs: 50 });
  assert.equal(plan.symbolCount, 452);
  assert.match(plan.id, /^capacity-plan:/);
  assert.ok(Object.isFrozen(plan));
  assert.throws(() => createCapacityWorkloadPlan({
    durationMs: CAPACITY_MODEL_LIMITS.maximumDurationMs + 1,
  }), /durationMs/);
  assert.throws(() => createCapacityWorkloadPlan({ durationMs: 100, tickMs: 30 }), /divisible/);
  assert.throws(() => createCapacityWorkloadPlan({
    startTimeMs: Number.MAX_SAFE_INTEGER - 100,
    durationMs: 100,
    tickMs: 100,
  }), /timestamp range/);
  assert.throws(() => createCapacityWorkloadPlan({
    ratesPerSecond: { SPOT_MINI_TICKER: CAPACITY_MODEL_LIMITS.maximumRatePerSecond + 1 },
  }), /SPOT_MINI_TICKER/);
  assert.throws(() => createCapacityWorkloadPlan({
    queueCapacities: { CORE_BROAD: CAPACITY_MODEL_LIMITS.maximumQueueCapacity + 1 },
  }), /CORE_BROAD/);
  assert.throws(() => createCapacityWorkloadPlan({
    focus: { protectedSymbols: Array.from({ length: 26 }, (_, index) => `S${String(index).padStart(4, '0')}USDT`) },
  }), /protected symbols/);
  assert.throws(() => createCapacityWorkloadPlan({
    focus: { focusCapacity: CAPACITY_ATTENTION_CEILINGS.FOCUS + 1 },
  }), /focusCapacity/);
  assert.throws(() => createCapacityWorkloadPlan({
    ratesPerSecond: { ...ZERO_RATES, SPOT_AGG_TRADE: 1 },
    focus: { watchCount: 0, candidateCount: 0, focusRequestCount: 0, deepFocusCount: 0 },
  }), /focused message rates/);
  assert.throws(() => createCapacityWorkloadPlan({
    durationMs: 300_000,
    tickMs: 1_000,
    ratesPerSecond: Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, 50_000])),
  }), /maximumSyntheticMessages/);
});

test('nominal repeated runs retain 452 broad symbols and are byte-for-byte deterministic', () => {
  const plan = createCapacityWorkloadPlan({ durationMs: 500, tickMs: 50 });
  const left = runDeterministicCapacityWorkload(plan);
  const right = runDeterministicCapacityWorkload(plan);
  assert.deepEqual(left, right);
  assert.equal(left.scope, 'SYNTHETIC_DETERMINISTIC_LOCAL_MODEL');
  assert.equal(left.productionCapacityClaim, null);
  assert.equal(left.hostTiming, null);
  assert.equal(left.liveMoneyAuthority, 'NONE');
  assert.equal(left.broadState.requestedSymbols, 452);
  assert.equal(left.broadState.spotSymbols, 452);
  assert.equal(left.broadState.futuresSymbols, 452);
  assert.ok(left.broadState.quietSpotSymbolsRetained > 400);
  assert.equal(left.overloadState, 'NOMINAL');
  assert.equal(left.focus.tierCounts.FOCUS + left.focus.tierCounts.DEEP_FOCUS, left.focus.focusCapacity);
  assert.ok(left.focus.tierCounts.DEEP_FOCUS <= CAPACITY_ATTENTION_CEILINGS.DEEP_FOCUS);
  assert.ok(Object.values(left.channelStats).every((stats) => stats.processingFailures === 0));
  for (const queue of Object.values(left.queues)) {
    assert.ok(queue.depthBeforeAudit <= queue.capacity);
    assert.ok(queue.highWatermark <= queue.capacity);
  }
  assert.ok(left.memory.nodeCount > 0);
  assert.ok(left.memory.modeledUpperBytes >= left.memory.modeledLowerBytes);
  assert.match(left.memory.caveat, /not an exact V8 heap measurement or a production capacity claim/);
  assert.equal(left.memory.queueAuditDestructive, true);
  assert.equal(left.percentileAlgorithm, 'NEAREST_RANK_CEIL_NQ_ON_BOUNDED_RECENT_RING');
});

test('replaceable book workload coalesces to one retained state per 452 symbols', () => {
  const plan = createCapacityWorkloadPlan({
    durationMs: 100,
    tickMs: 100,
    ratesPerSecond: { ...ZERO_RATES, USD_M_BOOK_TICKER: 10_000 },
    drainPerTick: ZERO_DRAIN,
    overload: { criticalQueueBps: 9_900 },
  });
  const report = runDeterministicCapacityWorkload(plan);
  assert.equal(report.channelStats.USD_M_BOOK_TICKER.generated, 1_000);
  assert.equal(report.queues.CORE_BROAD.depthBeforeAudit, 452);
  assert.equal(report.queues.CORE_BROAD.coalesced, 548);
  assert.equal(report.queues.CORE_BROAD.dropped, 0);
  assert.equal(report.queues.CORE_BROAD.resyncRequired, false);
});

test('burst accounting integrates exact start-zero, sub-tick, and cross-tick overlap for trade and depth', () => {
  const starts = [0, 37, 88];
  const reports = starts.map((startOffsetMs) => runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 200,
    tickMs: 100,
    ratesPerSecond: {
      ...ZERO_RATES,
      SPOT_AGG_TRADE: 200,
      SPOT_DEPTH_DELTA: 200,
    },
    bursts: [{
      channels: ['SPOT_AGG_TRADE', 'SPOT_DEPTH_DELTA'],
      startOffsetMs,
      durationMs: 25,
      multiplierBps: 100_000,
    }],
    drainPerTick: { ...ZERO_DRAIN, FOCUS: 256 },
  })));
  for (const report of reports) {
    assert.equal(report.channelStats.SPOT_AGG_TRADE.generated, 85);
    assert.equal(report.channelStats.SPOT_DEPTH_DELTA.generated, 85);
    assert.equal(report.broadState.requestedSymbols, 452);
    assert.equal(report.broadState.spotSymbols, 452);
    assert.equal(report.broadState.futuresSymbols, 452);
  }
  assert.deepEqual(
    reports.map((report) => report.channelStats.SPOT_AGG_TRADE.generated),
    [85, 85, 85],
  );
  assert.deepEqual(
    reports.map((report) => report.channelStats.SPOT_DEPTH_DELTA.generated),
    [85, 85, 85],
  );
});

test('optional sources shed at pressure before core broad observation is dropped', () => {
  const report = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 900,
    tickMs: 100,
    ratesPerSecond: {
      ...ZERO_RATES,
      USD_M_BOOK_TICKER: 500,
      OPTIONAL_LIQUIDATION: 100,
    },
    drainPerTick: { ...ZERO_DRAIN, OPTIONAL: 10 },
    overload: {
      recoveryQueueBps: 100,
      pressureQueueBps: 500,
      shedQueueBps: 1_000,
      criticalQueueBps: 9_900,
    },
  }));
  assert.equal(report.overloadState, 'OPTIONAL_SHED');
  assert.equal(report.queues.CORE_BROAD.dropped, 0);
  assert.equal(report.queues.CORE_BROAD.resyncRequired, false);
  assert.ok(report.optionalShedCount > 0);
  assert.equal(report.channelStats.OPTIONAL_LIQUIDATION.shed, report.optionalShedCount);
  assert.deepEqual(report.transitions.map((transition) => transition.to), ['PRESSURED', 'OPTIONAL_SHED']);
});

test('overload recovery uses bounded hysteresis and unwinds one level at a time', () => {
  const report = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 1_500,
    tickMs: 100,
    ratesPerSecond: {
      ...ZERO_RATES,
      USD_M_BOOK_TICKER: 100,
      OPTIONAL_LIQUIDATION: 100,
    },
    bursts: [{
      channels: ['USD_M_BOOK_TICKER'],
      startOffsetMs: 100,
      durationMs: 100,
      multiplierBps: 100_000,
    }],
    drainPerTick: { ...ZERO_DRAIN, CORE_BROAD: 20, OPTIONAL: 10 },
    overload: {
      recoveryQueueBps: 500,
      pressureQueueBps: 1_000,
      shedQueueBps: 1_500,
      criticalQueueBps: 9_900,
      recoveryLagMs: 10_000,
      pressureLagMs: 10_000,
      shedLagMs: 20_000,
      criticalLagMs: 30_000,
      recoveryTicks: 2,
    },
  }));
  assert.equal(report.overloadState, 'NOMINAL');
  assert.deepEqual(report.transitions.map((transition) => transition.to), [
    'OPTIONAL_SHED', 'PRESSURED', 'NOMINAL',
  ]);
  assert.deepEqual(report.transitions.slice(1).map((transition) => transition.reasonCodes), [
    ['RECOVERY_HYSTERESIS_SATISFIED'],
    ['RECOVERY_HYSTERESIS_SATISFIED'],
  ]);
  assert.equal(report.queues.CORE_BROAD.dropped, 0);
});

test('depth burst degrades on bounded loss while protected active capital keeps its focus slot', () => {
  const protectedSymbol = 'S0451USDT';
  const report = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 300,
    tickMs: 100,
    ratesPerSecond: {
      ...ZERO_RATES,
      SPOT_DEPTH_DELTA: 100,
      OPTIONAL_LIQUIDATION: 100,
    },
    bursts: [{
      channels: ['SPOT_DEPTH_DELTA'],
      startOffsetMs: 100,
      durationMs: 100,
      multiplierBps: 100_000,
    }],
    queueCapacities: { CORE_BROAD: 32, PROTECTED_FOCUS: 1, FOCUS: 8, OPTIONAL: 8 },
    drainPerTick: ZERO_DRAIN,
    focus: {
      watchCount: 20,
      candidateCount: 10,
      focusRequestCount: 10,
      deepFocusCount: 1,
      focusCapacity: 5,
      deepFocusCapacity: 1,
      protectedSymbols: [protectedSymbol],
    },
  }));
  const allocation = report.focus.allocations.find((entry) => entry.symbol === protectedSymbol);
  assert.equal(report.channelStats.SPOT_DEPTH_DELTA.generated, 120);
  assert.equal(report.focus.protectedPreserved, true);
  assert.equal(allocation?.focusDelivered, true);
  assert.ok(allocation?.tier === 'FOCUS' || allocation?.tier === 'DEEP_FOCUS');
  assert.equal(report.overloadState, 'CORE_DEGRADED');
  assert.equal(report.queues.PROTECTED_FOCUS.resyncRequired, true);
  assert.ok(report.queues.PROTECTED_FOCUS.dropped > 0);
  assert.ok(report.nonProtectedFocusShedCount > 0);
  assert.ok(report.optionalShedCount > 0);
  assert.ok(report.transitions.some((transition) => transition.reasonCodes.includes('PROTECTED_FOCUS_DROP')));
});

test('bounded trade retention reaches a plateau instead of growing with duration', () => {
  const rates = { ...ZERO_RATES, SPOT_AGG_TRADE: 1_000 };
  const short = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 500,
    tickMs: 100,
    ratesPerSecond: rates,
    drainPerTick: { ...ZERO_DRAIN, PROTECTED_FOCUS: 100, FOCUS: 100 },
  }));
  const long = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 1_000,
    tickMs: 100,
    ratesPerSecond: rates,
    drainPerTick: { ...ZERO_DRAIN, PROTECTED_FOCUS: 100, FOCUS: 100 },
  }));
  assert.equal(short.broadState.spotRecentTrades, 25 * 16);
  assert.equal(long.broadState.spotRecentTrades, 25 * 16);
  assert.equal(short.memory.nodeCount, long.memory.nodeCount);
  assert.ok(long.memory.modeledUpperBytes <= short.memory.modeledUpperBytes + 20_000);
  assert.equal(long.queues.FOCUS.depthBeforeAudit, 0);
});

test('retained graph estimator walks maps, cycles, and shared identity exactly once', () => {
  const shared = { value: 'shared' };
  const root = { left: shared, right: shared, map: new Map([['shared', shared]]) };
  root.self = root;
  const left = measureRetainedStructures([{ label: 'shared.graph', value: root }]);
  const right = measureRetainedStructures([{ label: 'shared.graph', value: root }]);
  assert.deepEqual(left, right);
  assert.ok(left.sharedReferenceCount >= 3);
  assert.equal(left.queueAuditDestructive, false);
  assert.equal(left.roots[0].canonicalUtf8Bytes, null);
  assert.ok(left.modeledUpperBytes > left.modeledLowerBytes);
  assert.throws(() => measureRetainedStructures([{ label: 'accessor', value: {
    get unsafe() { return 1; },
  } }]), /accessors/);
});

test('retained graph estimator accepts only a data-only boolean queue audit declaration before walking roots', () => {
  const roots = [{ label: 'queue.audit', value: { retained: true } }];
  assert.equal(measureRetainedStructures(roots).queueAuditDestructive, false);
  assert.equal(measureRetainedStructures(roots, { queueAuditDestructive: false }).queueAuditDestructive, false);
  assert.equal(measureRetainedStructures(roots, { queueAuditDestructive: true }).queueAuditDestructive, true);

  for (const value of [undefined, null, 0, 1, 'true', {}, []]) {
    assert.throws(
      () => measureRetainedStructures(roots, { queueAuditDestructive: value }),
      /queueAuditDestructive must be a boolean/,
    );
  }

  let optionGetterCalls = 0;
  let rootGetterCalls = 0;
  const options = Object.defineProperty({}, 'queueAuditDestructive', {
    enumerable: true,
    get() {
      optionGetterCalls += 1;
      return true;
    },
  });
  const unvisitedRoots = [Object.defineProperty({ label: 'queue.audit.unvisited' }, 'value', {
    enumerable: true,
    get() {
      rootGetterCalls += 1;
      return { retained: true };
    },
  })];
  assert.throws(
    () => measureRetainedStructures(unvisitedRoots, options),
    /queueAuditDestructive must be a data-only boolean/,
  );
  assert.equal(optionGetterCalls, 0);
  assert.equal(rootGetterCalls, 0);
});

test('retained graph estimator charges and deduplicates complete ArrayBuffer backings', () => {
  const normalBacking = new ArrayBuffer(32);
  const tinyNormalView = new Uint8Array(normalBacking, 8, 1);
  const direct = measureRetainedStructures([{ label: 'binary.direct', value: normalBacking }]);
  const normal = measureRetainedStructures([{ label: 'binary.normal-view', value: tinyNormalView }]);
  assert.equal(normal.nodeCount, 2);
  assert.equal(normal.modeledLowerBytes - direct.modeledLowerBytes, 16);
  assert.equal(normal.modeledUpperBytes - direct.modeledUpperBytes, 64);

  const sharedBacking = new ArrayBuffer(32);
  const shared = measureRetainedStructures([{ label: 'binary.shared', value: [
    new Uint8Array(sharedBacking, 0, 8),
    new DataView(sharedBacking, 8, 8),
  ] }]);
  const separate = measureRetainedStructures([{ label: 'binary.separate', value: [
    new Uint8Array(new ArrayBuffer(32), 0, 8),
    new DataView(new ArrayBuffer(32), 8, 8),
  ] }]);
  assert.equal(shared.nodeCount, 4);
  assert.equal(shared.sharedReferenceCount, 1);
  assert.equal(separate.nodeCount, 5);
  assert.equal(separate.modeledLowerBytes - shared.modeledLowerBytes, 48);
  assert.equal(separate.modeledUpperBytes - shared.modeledUpperBytes, 96);

  const oversizedBacking = new ArrayBuffer(CAPACITY_MODEL_LIMITS.maximumMeasuredBinaryBytes + 1);
  const oneByteView = new Uint8Array(oversizedBacking, 0, 1);
  assert.throws(
    () => measureRetainedStructures([{ label: 'binary.oversized-backing', value: oneByteView }]),
    /binary backing exceeds its hard bound/,
  );
});

test('retained graph estimator rejects symbol and custom properties that could hide retained memory', () => {
  assert.throws(() => measureRetainedStructures([{
    label: 'hidden.symbol',
    value: { [Symbol('retained')]: new ArrayBuffer(1024) },
  }]), /symbol keys/);

  const array = [];
  array.retained = new ArrayBuffer(1024);
  assert.throws(() => measureRetainedStructures([{ label: 'hidden.array', value: array }]), /custom properties/);

  const map = new Map();
  map.retained = new ArrayBuffer(1024);
  assert.throws(() => measureRetainedStructures([{ label: 'hidden.map', value: map }]), /custom properties/);

  const view = new Uint8Array(1);
  view.retained = new ArrayBuffer(1024);
  assert.throws(() => measureRetainedStructures([{ label: 'hidden.view', value: view }]), /custom properties/);
});

test('processing-lag percentile uses exact nearest-rank without interpolation', () => {
  assert.equal(nearestRankPercentile([], 0.95), null);
  assert.equal(nearestRankPercentile([0, 1, 2, 3, 4], 0.50), 2);
  assert.equal(nearestRankPercentile([0, 1, 2, 3, 4], 0.95), 4);
  assert.equal(nearestRankPercentile([0, 1, 2, 3, 4], 0.99), 4);
  assert.throws(() => nearestRankPercentile([2, 1], 0.5), /sorted/);
  assert.throws(() => nearestRankPercentile([1], 0), /quantile/);
});

test('workload lag percentiles measure bounded queue residence in logical time', () => {
  const report = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 300,
    tickMs: 100,
    ratesPerSecond: { ...ZERO_RATES, USD_M_BOOK_TICKER: 100 },
    drainPerTick: { ...ZERO_DRAIN, CORE_BROAD: 5 },
    overload: {
      pressureLagMs: 50,
      shedLagMs: 500,
      criticalLagMs: 1_000,
      recoveryLagMs: 0,
    },
  }));
  const source = report.lag.sources.USD_M_BOOK_TICKER;
  assert.equal(source.sampleCount, 15);
  assert.equal(source.retainedSamples, 15);
  assert.equal(source.p50LagMs, 100);
  assert.equal(source.p95LagMs, 100);
  assert.equal(source.p99LagMs, 100);
  assert.ok(report.transitions.some((transition) => transition.reasonCodes.includes('PROCESSING_LAG_PRESSURE')));
});

test('lag memory accounting includes the global ring plus every bounded source ring', () => {
  const report = runDeterministicCapacityWorkload(createCapacityWorkloadPlan({
    durationMs: 100,
    tickMs: 100,
    ratesPerSecond: Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, 10])),
    lagSamplesPerSource: 1,
  }));
  assert.equal(report.lag.global.retainedSamples, 1);
  assert.equal(Object.keys(report.lag.sources).length, CAPACITY_CHANNELS.length);
  assert.equal(report.memory.lagRetainedSampleBytes, (CAPACITY_CHANNELS.length + 1) * 8);
});

test('canonical plan identity rejects mutation or a forged ID at execution', () => {
  const plan = createCapacityWorkloadPlan({ durationMs: 100, tickMs: 100, ratesPerSecond: ZERO_RATES });
  assert.throws(() => runDeterministicCapacityWorkload({ ...plan, id: 'capacity-plan:forged' }), /plan ID/);
  assert.throws(() => runDeterministicCapacityWorkload({ ...plan, symbolCount: 451 }), /symbolCount/);
  assert.throws(
    () => runDeterministicCapacityWorkload({ ...plan, configurationVersion: 'capacity-model-999' }),
    /configurationVersion/,
  );
});
