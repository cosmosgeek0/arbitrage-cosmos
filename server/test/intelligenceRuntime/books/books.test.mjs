import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BINANCE_SOURCE_FACTS,
  normalizeDepth,
} from '../../../dist/intelligenceFoundation/evidence/index.js';
import {
  LocalOrderBookReducer,
  calculateBookDepthMetrics,
  calculateSlippage,
  serializeLocalBookSnapshot,
} from '../../../dist/intelligenceRuntime/books/index.js';

const T0 = 1_720_000_000_000;

class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
  advance(delta) { this.now += delta; }
}

function instrument(productFamily) {
  return {
    productFamily,
    symbol: 'BTCUSDT',
    pair: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
  };
}

function normalize(sourceKey, raw, receiveTimeMs) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  const result = normalizeDepth(raw, {
    sourceKey,
    sourceId: fact.sourceId,
    endpointClass: fact.endpointClass,
    instrument: instrument(fact.productFamily),
    receivedTimeMs: receiveTimeMs,
    evaluatedAtMs: receiveTimeMs,
    maxAgeMs: 60_000,
    maximumFutureSkewMs: 1_000,
    schemaVersion: 'test-schema-v1',
    producerVersion: 'test-producer-v1',
    configurationVersion: 'test-config-v1',
  });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.failures));
  assert.equal(result.value.truth.completeness.state, 'COMPLETE');
  assert.equal(result.value.truth.freshness.state, 'FRESH');
  return result.value;
}

function snapshotRaw(productFamily, sequence, requestedLimit, bids, asks, receiveTimeMs) {
  return productFamily === 'SPOT'
    ? { lastUpdateId: String(sequence), bids, asks, requestedLimit }
    : {
      lastUpdateId: String(sequence), E: receiveTimeMs, T: receiveTimeMs,
      symbol: 'BTCUSDT', bids, asks, requestedLimit,
    };
}

function deltaRaw(productFamily, first, last, previous, bids, asks, receiveTimeMs) {
  const common = {
    e: 'depthUpdate', E: receiveTimeMs, s: 'BTCUSDT',
    U: String(first), u: String(last), b: bids, a: asks,
  };
  return productFamily === 'SPOT'
    ? common
    : { ...common, T: receiveTimeMs, pu: String(previous), ps: 'BTCUSDT', st: 1 };
}

function sourceKey(productFamily, kind) {
  if (productFamily === 'SPOT') return kind === 'SNAPSHOT' ? 'SPOT_DEPTH_SNAPSHOT' : 'SPOT_DEPTH_DELTA';
  return kind === 'SNAPSHOT' ? 'USD_M_DEPTH_SNAPSHOT' : 'USD_M_DEPTH_DELTA';
}

function runtimeEvent(productFamily, kind, raw, receiveTimeMs, generation = 1, correlationSuffix = '') {
  const key = sourceKey(productFamily, kind);
  const fact = BINANCE_SOURCE_FACTS[key];
  const evidence = normalize(key, raw, receiveTimeMs);
  return Object.freeze({
    sourceId: fact.sourceId,
    connectionGeneration: generation,
    productFamily,
    endpointClass: fact.endpointClass,
    stream: fact.channel,
    sourceEventTimeMs: evidence.truth.temporal.sourceEventTimeMs,
    sourceTransactionTimeMs: evidence.truth.temporal.sourceTransactionTimeMs,
    receiveTimeMs,
    sequence: evidence.truth.temporal.sequence,
    correlationId: `book.${productFamily}.${kind}.${evidence.truth.temporal.sequence.last}${correlationSuffix}`,
    payload: evidence,
  });
}

function harness(productFamily = 'SPOT', overrides = {}, ports = {}) {
  const clock = ports.clock ?? new ManualClock();
  const snapshotLimit = overrides.snapshotLimit ?? 10;
  const identityEvidence = normalize(
    sourceKey(productFamily, 'SNAPSHOT'),
    snapshotRaw(productFamily, 1, snapshotLimit, [['100', '1']], [['101', '1']], clock.nowMs()),
    clock.nowMs(),
  );
  const config = {
    sourceId: `runtime.local-book.${productFamily}.BTCUSDT`,
    snapshotSourceId: BINANCE_SOURCE_FACTS[sourceKey(productFamily, 'SNAPSHOT')].sourceId,
    deltaSourceId: BINANCE_SOURCE_FACTS[sourceKey(productFamily, 'DELTA')].sourceId,
    productFamily,
    instrumentId: identityEvidence.instrument.instrumentId,
    symbol: 'BTCUSDT',
    bookScope: productFamily === 'SPOT' ? 'UNKNOWN' : 'STANDARD_NO_RPI',
    snapshotLimit,
    maximumLevelsPerSide: 10,
    maximumBufferedEvents: 8,
    maximumBufferedLevelUpdates: 32,
    maximumRecentFingerprints: 16,
    maximumFlowSamples: 16,
    staleAfterMs: 1_000,
    maximumSnapshotApplyAgeMs: 500,
    maximumFutureSkewMs: 10,
    depthBandsBps: [100, 250],
    flowWindowsMs: [1_000, 5_000],
    ...overrides,
  };
  const reducer = new LocalOrderBookReducer(config, { clock, metricSink: ports.metricSink });
  const request = reducer.beginGeneration(1);
  const snapshot = (
    sequence,
    bids = [['100', '10'], ['99', '5']],
    asks = [['101', '10'], ['102', '5']],
    receiveTimeMs = clock.nowMs(),
    generation = 1,
  ) => runtimeEvent(
    productFamily,
    'SNAPSHOT',
    snapshotRaw(productFamily, sequence, config.snapshotLimit, bids, asks, receiveTimeMs),
    receiveTimeMs,
    generation,
  );
  const delta = (
    first,
    last,
    previous,
    bids = [],
    asks = [],
    receiveTimeMs = clock.nowMs(),
    generation = 1,
    correlationSuffix = '',
  ) => runtimeEvent(
    productFamily,
    'DELTA',
    deltaRaw(productFamily, first, last, previous, bids, asks, receiveTimeMs),
    receiveTimeMs,
    generation,
    correlationSuffix,
  );
  return { clock, config, reducer, request, snapshot, delta };
}

function applyInitialSnapshot(value, sequence = 100, bids, asks) {
  return value.reducer.applySnapshot({
    connectionGeneration: 1,
    syncEpoch: value.request.syncEpoch,
    event: value.snapshot(sequence, bids, asks),
  });
}

function makeLive(value, sequence = 100, bids, asks) {
  const accepted = applyInitialSnapshot(value, sequence, bids, asks);
  assert.equal(accepted.kind, 'SNAPSHOT_ACCEPTED_WAITING_BRIDGE');
  const bridge = value.reducer.ingestDelta(value.delta(
    sequence + 1,
    sequence + 1,
    value.config.productFamily === 'SPOT' ? null : sequence,
    [],
    [],
  ));
  assert.equal(bridge.kind, 'BOOTSTRAPPED');
  return bridge;
}

function approx(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('Spot buffers in arrival order, discards u <= snapshot cursor, and applies the official overlapping bridge', () => {
  const value = harness('SPOT');
  assert.equal(value.request.reason, 'INITIAL_BOOTSTRAP');
  assert.equal(value.reducer.ingestDelta(value.delta(98, 100, null, [['100', '999']], [])).kind, 'BUFFERED');
  assert.equal(value.reducer.ingestDelta(value.delta(99, 101, null, [['100', '12']], [['102', '0']])).kind, 'BUFFERED');

  const result = applyInitialSnapshot(value, 100);
  assert.equal(result.kind, 'BOOTSTRAPPED');
  assert.equal(result.appliedEvents, 1);
  assert.equal(result.cursor, '101');
  const snapshot = value.reducer.snapshot();
  assert.equal(snapshot.phase, 'LIVE');
  assert.equal(snapshot.counters.bootstrapDiscardedCount, 1);
  assert.deepEqual(snapshot.bids.slice(0, 2), [
    { price: 100, baseQuantity: 12 },
    { price: 99, baseQuantity: 5 },
  ]);
  assert.deepEqual(snapshot.asks, [{ price: 101, baseQuantity: 10 }]);
});

test('Spot accepts a live range containing cursor + 1, ignores unseen old ranges, and resyncs on a forward gap', () => {
  const value = harness('SPOT');
  makeLive(value);
  const overlap = value.reducer.ingestDelta(value.delta(100, 103, null, [['99', '7']], []));
  assert.equal(overlap.kind, 'APPLIED');
  assert.equal(overlap.cursor, '103');
  const old = value.reducer.ingestDelta(value.delta(90, 99, null, [['98', '1']], []));
  assert.equal(old.kind, 'OUT_OF_ORDER');
  assert.equal(value.reducer.snapshot().cursor, '103');
  const gap = value.reducer.ingestDelta(value.delta(105, 105, null, [], [['103', '1']]));
  assert.equal(gap.kind, 'RESYNC_REQUIRED');
  assert.equal(gap.resyncRequest.reason, 'SEQUENCE_GAP');
  assert.equal(value.reducer.snapshot().phase, 'BUFFERING');
});

test('USD-M retains u == snapshot cursor for the bootstrap bridge and requires pu to equal prior applied u', () => {
  const value = harness('USD_M_PERPETUAL');
  assert.equal(value.reducer.ingestDelta(value.delta(99, 100, 98, [['100', '11']], [])).kind, 'BUFFERED');
  const boot = applyInitialSnapshot(value, 100);
  assert.equal(boot.kind, 'BOOTSTRAPPED');
  assert.equal(boot.cursor, '100');
  assert.equal(value.reducer.snapshot().bids[0].baseQuantity, 11);
  value.clock.advance(10);
  const live = value.reducer.ingestDelta(value.delta(101, 102, 100, [], [['101', '8']]));
  assert.equal(live.kind, 'APPLIED');
  assert.equal(live.cursor, '102');
  value.clock.advance(10);
  const broken = value.reducer.ingestDelta(value.delta(103, 103, 101, [], [['102', '6']]));
  assert.equal(broken.kind, 'RESYNC_REQUIRED');
  assert.equal(broken.resyncRequest.reason, 'PREDECESSOR_MISMATCH');
  assert.equal(broken.failure.code, 'SEQUENCE_GAP');
});

test('USD-M predecessor mismatches fail closed whether pu moves backward or forward', () => {
  for (const previous of [99, 102]) {
    const value = harness('USD_M_PERPETUAL');
    makeLive(value);
    const result = value.reducer.ingestDelta(value.delta(102, 102, previous, [['100', '9']], []));
    assert.equal(result.kind, 'RESYNC_REQUIRED');
    assert.equal(result.resyncRequest.reason, 'PREDECESSOR_MISMATCH');
  }
});

test('USD-M accepts non-contiguous U when pu links to the previous applied u', () => {
  const value = harness('USD_M_PERPETUAL');
  makeLive(value);
  const valid = value.reducer.ingestDelta(value.delta(157, 160, 101, [['100', '12']], []));
  assert.equal(valid.kind, 'APPLIED');
  assert.equal(valid.cursor, '160');
});

test('a quiet snapshot accepts the next legitimate Spot and USD-M live event', () => {
  const spot = harness('SPOT');
  assert.equal(applyInitialSnapshot(spot).kind, 'SNAPSHOT_ACCEPTED_WAITING_BRIDGE');
  assert.equal(spot.reducer.ingestDelta(spot.delta(101, 101, null, [['100', '11']], [])).kind, 'BOOTSTRAPPED');
  assert.equal(spot.reducer.flowMetrics(20).sampleCount, 1);
  assert.equal(spot.reducer.flowMetrics(20).addedBidQuote, 100);
  const futures = harness('USD_M_PERPETUAL');
  assert.equal(applyInitialSnapshot(futures).kind, 'SNAPSHOT_ACCEPTED_WAITING_BRIDGE');
  assert.equal(futures.reducer.ingestDelta(futures.delta(157, 160, 100, [['100', '11']], [])).kind, 'BOOTSTRAPPED');
  assert.equal(futures.reducer.flowMetrics(20).sampleCount, 1);
  assert.equal(futures.reducer.flowMetrics(20).addedBidQuote, 100);
});

test('exact duplicate is harmless while different content reusing the cursor invalidates the book', () => {
  const value = harness('SPOT');
  applyInitialSnapshot(value);
  const bridgeEvent = value.delta(100, 101, null, [['100', '11']], []);
  assert.equal(value.reducer.ingestDelta(bridgeEvent).kind, 'BOOTSTRAPPED');
  assert.equal(value.reducer.ingestDelta(bridgeEvent).kind, 'DUPLICATE');
  const conflict = value.reducer.ingestDelta(value.delta(101, 101, null, [['100', '12']], [], T0, 1, '.conflict'));
  assert.equal(conflict.kind, 'RESYNC_REQUIRED');
  assert.equal(conflict.resyncRequest.reason, 'CONFLICTING_SEQUENCE_REUSE');
});

test('pre-snapshot event and aggregate level-update capacities are strict and produce explicit resync requests', () => {
  const eventBound = harness('SPOT', { maximumBufferedEvents: 1 });
  assert.equal(eventBound.reducer.ingestDelta(eventBound.delta(99, 100, null, [['100', '10']], [])).kind, 'BUFFERED');
  const eventOverflow = eventBound.reducer.ingestDelta(eventBound.delta(100, 101, null, [['99', '5']], []));
  assert.equal(eventOverflow.kind, 'RESYNC_REQUIRED');
  assert.equal(eventOverflow.resyncRequest.reason, 'BUFFER_EVENT_CAPACITY');

  const rowBound = harness('SPOT', { maximumBufferedLevelUpdates: 3 });
  assert.equal(rowBound.reducer.ingestDelta(rowBound.delta(99, 100, null, [['100', '10']], [['101', '10']])).kind, 'BUFFERED');
  const rowOverflow = rowBound.reducer.ingestDelta(rowBound.delta(100, 101, null, [['99', '5']], [['102', '5']]));
  assert.equal(rowOverflow.kind, 'RESYNC_REQUIRED');
  assert.equal(rowOverflow.resyncRequest.reason, 'BUFFER_UPDATE_CAPACITY');
  assert.equal(rowBound.reducer.snapshot().bufferedEvents, 0);
});

test('missing bridge, crossed update, and removal of the final visible side invalidate instead of fabricating a book', () => {
  const missingBridge = harness('SPOT');
  missingBridge.reducer.ingestDelta(missingBridge.delta(102, 103, null, [['100', '1']], []));
  const oldSnapshot = applyInitialSnapshot(missingBridge, 100);
  assert.equal(oldSnapshot.kind, 'RESYNC_REQUIRED');
  assert.equal(oldSnapshot.resyncRequest.reason, 'SNAPSHOT_TOO_OLD');

  const crossed = harness('SPOT');
  makeLive(crossed);
  const crossedResult = crossed.reducer.ingestDelta(crossed.delta(102, 102, null, [], [['99', '1']]));
  assert.equal(crossedResult.kind, 'RESYNC_REQUIRED');
  assert.equal(crossedResult.resyncRequest.reason, 'CROSSED_BOOK');
  assert.equal(crossed.reducer.snapshot().counters.crossedCount, 1);

  const empty = harness('SPOT');
  makeLive(empty, 100, [['100', '10']], [['101', '10']]);
  const emptyResult = empty.reducer.ingestDelta(empty.delta(102, 102, null, [['100', '0']], [['999', '0']]));
  assert.equal(emptyResult.kind, 'RESYNC_REQUIRED');
  assert.equal(emptyResult.resyncRequest.reason, 'EMPTY_BOOK_SIDE');
});

test('generation and sync-epoch tokens reject stale deltas and stale REST snapshots without replacing current state', () => {
  const value = harness('SPOT');
  const oldToken = value.request;
  const nextToken = value.reducer.beginGeneration(2);
  assert.equal(nextToken.connectionGeneration, 2);
  assert.ok(nextToken.syncEpoch > oldToken.syncEpoch);
  const staleDelta = value.reducer.ingestDelta(value.delta(99, 100, null, [], [], T0, 1));
  assert.equal(staleDelta.kind, 'OUT_OF_ORDER');
  const staleSnapshot = value.reducer.applySnapshot({
    connectionGeneration: 2,
    syncEpoch: nextToken.syncEpoch,
    event: value.snapshot(100, undefined, undefined, T0, 1),
  });
  assert.equal(staleSnapshot.kind, 'OUT_OF_ORDER');
  assert.equal(value.reducer.snapshot().connectionGeneration, 2);
  assert.equal(value.reducer.snapshot().phase, 'BUFFERING');
  assert.throws(() => value.reducer.beginGeneration(2), /advance monotonically/);
  assert.throws(() => value.reducer.beginGeneration(1), /advance monotonically/);
});

test('a fulfilled snapshot token cannot be replayed to replace an already live book', () => {
  const value = harness('SPOT');
  makeLive(value);
  const before = value.reducer.snapshot();
  const replay = value.reducer.applySnapshot({
    connectionGeneration: 1,
    syncEpoch: value.request.syncEpoch,
    event: value.snapshot(500, [['100', '999']], [['101', '999']]),
  });
  assert.equal(replay.kind, 'OUT_OF_ORDER');
  assert.equal(replay.failure.code, 'OUT_OF_ORDER_EVENT');
  const after = value.reducer.snapshot();
  assert.equal(after.cursor, before.cursor);
  assert.deepEqual(after.bids, before.bids);
  assert.deepEqual(after.asks, before.asks);
  assert.equal(after.provenanceDigest, before.provenanceDigest);
});

test('depth-at-distance, slope, spread, and quote imbalance use explicit numeric semantics', () => {
  const metrics = calculateBookDepthMetrics(
    [{ price: 99, baseQuantity: 10 }, { price: 98, baseQuantity: 20 }],
    [{ price: 101, baseQuantity: 5 }, { price: 102, baseQuantity: 15 }],
    [100, 250],
  );
  assert.equal(metrics.midpoint, 100);
  assert.equal(metrics.spreadQuote, 2);
  assert.equal(metrics.spreadBps, 200);
  assert.equal(metrics.bidSlopeBpsPerLevel, 100);
  assert.equal(metrics.askSlopeBpsPerLevel, 100);
  assert.equal(metrics.symmetricSlopeBpsPerLevel, 100);
  assert.deepEqual(metrics.bands.map((band) => band.totalQuoteNotional), [1_495, 4_985]);
  approx(metrics.bands[0].quoteImbalance, 485 / 1_495);
  approx(metrics.bands[1].quoteImbalance, 915 / 4_985);
  assert.deepEqual(metrics.bands.map((band) => [band.bidCoverageComplete, band.askCoverageComplete]), [
    [true, true], [false, false],
  ]);
});

test('exported metrics reject unsorted, crossed, non-positive, and unbounded book inputs', () => {
  assert.throws(() => calculateBookDepthMetrics(
    [{ price: 98, baseQuantity: 1 }, { price: 99, baseQuantity: 1 }],
    [{ price: 101, baseQuantity: 1 }],
    [100],
  ), /strictly price sorted/);
  assert.throws(() => calculateBookDepthMetrics(
    [{ price: 101, baseQuantity: 1 }],
    [{ price: 100, baseQuantity: 1 }],
    [100],
  ), /crossed or locked/);
  assert.throws(() => calculateBookDepthMetrics(
    [{ price: 99, baseQuantity: 0 }],
    [{ price: 101, baseQuantity: 1 }],
    [100],
  ), /positive finite/);
  assert.throws(() => calculateBookDepthMetrics([], [], [250, 100]), /strictly increasing/);
  assert.throws(() => calculateBookDepthMetrics(
    new Array(100_001).fill({ price: 99, baseQuantity: 1 }), [], [100],
  ), /safety bound/);
  assert.throws(() => calculateSlippage(
    [{ price: 99, baseQuantity: 1 }],
    [{ price: 102, baseQuantity: 1 }, { price: 101, baseQuantity: 1 }],
    { side: 'BUY', size: { unit: 'BASE', value: 2 } },
  ), /strictly price sorted/);
});

test('intended-size slippage supports base and quote targets and names insufficient visible depth', () => {
  const bids = [{ price: 99, baseQuantity: 1 }, { price: 98, baseQuantity: 2 }];
  const asks = [{ price: 101, baseQuantity: 1 }, { price: 102, baseQuantity: 2 }];
  const buy = calculateSlippage(bids, asks, { side: 'BUY', size: { unit: 'BASE', value: 2 } });
  assert.equal(buy.state, 'COMPLETE');
  assert.equal(buy.averageFillPrice, 101.5);
  approx(buy.slippageBpsAtRequestedSize, (0.5 / 101) * 10_000);
  const sell = calculateSlippage(bids, asks, { side: 'SELL', size: { unit: 'BASE', value: 2 } });
  assert.equal(sell.averageFillPrice, 98.5);
  approx(sell.slippageBpsAtRequestedSize, (0.5 / 99) * 10_000);
  const quote = calculateSlippage(bids, asks, { side: 'BUY', size: { unit: 'QUOTE', value: 152 } });
  assert.equal(quote.state, 'COMPLETE');
  approx(quote.filledBaseQuantity, 1.5);
  assert.equal(quote.filledQuoteNotional, 152);
  const insufficient = calculateSlippage(bids, asks, { side: 'BUY', size: { unit: 'BASE', value: 4 } });
  assert.equal(insufficient.state, 'INSUFFICIENT_VISIBLE_DEPTH');
  assert.equal(insufficient.slippageBpsAtRequestedSize, null);
  assert.equal(insufficient.averageFillPrice, null);
  assert.equal(insufficient.visibleFillAveragePrice, 305 / 3);
  assert.equal(insufficient.unfilledValue, 1);
});

test('slippage fails unavailable instead of returning non-finite cumulative fills', () => {
  const result = calculateSlippage(
    [{ price: 1, baseQuantity: 1 }],
    [{ price: 2, baseQuantity: 5e307 }, { price: 3, baseQuantity: 5e307 }],
    { side: 'BUY', size: { unit: 'BASE', value: 1e308 } },
  );
  assert.equal(result.state, 'UNAVAILABLE');
  assert.deepEqual(result.reasonCodes, ['NUMERIC_OVERFLOW']);
  assert.equal(result.averageFillPrice, null);
});

test('live deltas expose bounded replenishment and depletion evidence while bootstrap bridge flow is suppressed', () => {
  const value = harness('SPOT');
  assert.equal(applyInitialSnapshot(value, 100, [['100', '10']], [['101', '10']]).kind,
    'SNAPSHOT_ACCEPTED_WAITING_BRIDGE');
  assert.equal(value.reducer.ingestDelta(value.delta(100, 101, null, [], [])).kind, 'BOOTSTRAPPED');
  assert.equal(value.reducer.flowMetrics(1_000).sampleCount, 0);
  value.clock.advance(10);
  value.reducer.ingestDelta(value.delta(102, 102, null, [['100', '12']], [['101', '7']]));
  value.clock.advance(10);
  value.reducer.ingestDelta(value.delta(103, 103, null, [['100', '11']], [['101', '9']]));
  const flow = value.reducer.flowMetrics(20);
  assert.equal(flow.sampleCount, 2);
  assert.equal(flow.addedBidQuote, 200);
  assert.equal(flow.removedBidQuote, 100);
  assert.equal(flow.addedAskQuote, 202);
  assert.equal(flow.removedAskQuote, 303);
  assert.equal(flow.addedQuote, 402);
  assert.equal(flow.removedQuote, 403);
  assert.equal(flow.netDepthChangeQuote, -1);
  approx(flow.grossAdditionRemovalRatio, 402 / 403);
  assert.equal(flow.complete, true);
});

test('flow stays partial until the requested window is fully observed', () => {
  const value = harness('SPOT');
  makeLive(value);
  value.clock.advance(10);
  value.reducer.ingestDelta(value.delta(102, 102, null, [['100', '11']], []));
  let flow = value.reducer.flowMetrics(1_000);
  assert.equal(flow.complete, false);
  assert.ok(flow.reasonCodes.includes('WINDOW_NOT_FULLY_OBSERVED'));
  value.clock.advance(990);
  flow = value.reducer.flowMetrics(1_000);
  assert.equal(flow.complete, true);
  assert.equal(flow.reasonCodes.includes('WINDOW_NOT_FULLY_OBSERVED'), false);
});

test('flow completeness fails when its latest evidence is stale', () => {
  const value = harness('SPOT', { staleAfterMs: 100 });
  makeLive(value);
  value.clock.advance(100);
  const flow = value.reducer.flowMetrics(100);
  assert.equal(flow.complete, false);
  assert.ok(flow.reasonCodes.includes('BOOK_STALE'));
});

test('flow never invents a prior zero for absent levels outside known snapshot coverage', () => {
  for (const quantity of ['10', '0']) {
    const value = harness('SPOT');
    makeLive(value);
    value.clock.advance(10);
    const applied = value.reducer.ingestDelta(value.delta(102, 102, null, [['98', quantity]], []));
    assert.equal(applied.kind, 'APPLIED');
    const flow = value.reducer.flowMetrics(1_000);
    assert.equal(flow.complete, false);
    assert.equal(flow.addedBidQuote, null);
    assert.equal(flow.removedBidQuote, null);
    assert.equal(flow.addedQuote, null);
    assert.ok(flow.reasonCodes.includes('BID_PRIOR_DEPTH_UNKNOWN'));
  }
});

test('retention bounds degrade completeness honestly and flow retention reports truncated windows', () => {
  const value = harness('SPOT', { maximumLevelsPerSide: 2, maximumFlowSamples: 1 });
  makeLive(
    value,
    100,
    [['100', '1'], ['99', '1'], ['98', '1']],
    [['101', '1'], ['102', '1'], ['103', '1']],
  );
  let snapshot = value.reducer.snapshot();
  assert.equal(snapshot.observedState, 'DEGRADED');
  assert.equal(snapshot.completeness.state, 'PARTIAL');
  assert.equal(snapshot.completeness.retentionTruncated, true);
  assert.deepEqual(snapshot.bids.map((level) => level.price), [100, 99]);
  assert.deepEqual(snapshot.asks.map((level) => level.price), [101, 102]);
  value.clock.advance(10);
  value.reducer.ingestDelta(value.delta(102, 102, null, [['100', '2']], []));
  value.clock.advance(10);
  value.reducer.ingestDelta(value.delta(103, 103, null, [['100', '3']], []));
  const flow = value.reducer.flowMetrics(1_000);
  assert.equal(flow.sampleCount, 1);
  assert.equal(flow.complete, false);
  assert.ok(flow.reasonCodes.includes('FLOW_RETENTION_TRUNCATED'));
  snapshot = value.reducer.snapshot();
  assert.equal(snapshot.counters.flowDroppedCount, 2);
});

test('future flow reads are rejected without destroying the current retained window', () => {
  const value = harness('SPOT');
  makeLive(value);
  value.clock.advance(10);
  value.reducer.ingestDelta(value.delta(102, 102, null, [['100', '11']], []));
  const before = value.reducer.flowMetrics(1_000);
  assert.throws(() => value.reducer.flowMetrics(1_000, value.clock.nowMs() + 5_001), /cannot exceed/);
  const after = value.reducer.flowMetrics(1_000);
  assert.deepEqual(after, before);
});

test('age-pruned flow history retains an explicit truncation horizon for backdated reads', () => {
  const value = harness('SPOT', { staleAfterMs: 10_000 });
  makeLive(value);
  value.clock.advance(1_000);
  value.reducer.ingestDelta(value.delta(102, 102, null, [['100', '11']], []));
  value.clock.advance(2_000);
  value.reducer.ingestDelta(value.delta(103, 103, null, [['100', '12']], []));
  value.clock.advance(4_001);
  value.reducer.ingestDelta(value.delta(104, 104, null, [['100', '13']], []));
  const historical = value.reducer.flowMetrics(5_000, T0 + 6_000);
  assert.equal(historical.sampleCount, 1);
  assert.equal(historical.complete, false);
  assert.ok(historical.reasonCodes.includes('FLOW_RETENTION_TRUNCATED'));
});

test('book age and intended-size queries become explicitly stale from the injected clock', () => {
  const value = harness('SPOT', { staleAfterMs: 100 });
  makeLive(value);
  value.clock.advance(99);
  assert.equal(value.reducer.snapshot().freshnessState, 'FRESH');
  value.clock.advance(1);
  const snapshot = value.reducer.snapshot();
  assert.equal(snapshot.freshnessState, 'STALE');
  assert.equal(snapshot.observedState, 'STALE');
  assert.equal(snapshot.temporal.receiveAgeMs, 100);
  const slippage = value.reducer.querySlippage({ side: 'BUY', size: { unit: 'BASE', value: 1 } });
  assert.equal(slippage.state, 'STALE');
  assert.deepEqual(slippage.reasonCodes, ['BOOK_STALE']);
});

test('authoritative source age can stale or reject a freshly received delta', () => {
  const value = harness('SPOT', { staleAfterMs: 100 });
  assert.equal(applyInitialSnapshot(value).kind, 'SNAPSHOT_ACCEPTED_WAITING_BRIDGE');
  const delayedBridgeRaw = deltaRaw('SPOT', 101, 101, null, [], [], T0);
  delayedBridgeRaw.E = T0 - 50;
  assert.equal(value.reducer.ingestDelta(runtimeEvent('SPOT', 'DELTA', delayedBridgeRaw, T0)).kind, 'BOOTSTRAPPED');
  value.clock.advance(50);
  const stale = value.reducer.snapshot();
  assert.equal(stale.temporal.receiveAgeMs, 50);
  assert.equal(stale.temporal.sourceAgeMs, 100);
  assert.equal(stale.freshnessState, 'STALE');

  const rejected = harness('USD_M_PERPETUAL', { staleAfterMs: 100 });
  makeLive(rejected);
  rejected.clock.advance(10);
  const delayedRaw = deltaRaw('USD_M_PERPETUAL', 102, 102, 101, [], [], rejected.clock.nowMs());
  delayedRaw.E -= 200;
  delayedRaw.T -= 200;
  const result = rejected.reducer.ingestDelta(runtimeEvent(
    'USD_M_PERPETUAL', 'DELTA', delayedRaw, rejected.clock.nowMs(),
  ));
  assert.equal(result.kind, 'RESYNC_REQUIRED');
  assert.equal(result.failure.code, 'STALE_SOURCE');
});

test('current-state snapshots and slippage cannot be backdated before retained knowledge', () => {
  const value = harness('SPOT');
  makeLive(value);
  assert.throws(() => value.reducer.snapshot(T0 - 1), /cannot precede current book knowledge/);
  assert.throws(() => value.reducer.querySlippage(
    { side: 'BUY', size: { unit: 'BASE', value: 1 } }, T0 - 1,
  ), /cannot precede current book knowledge/);
  assert.throws(() => value.reducer.emitMetrics(T0 - 1), /cannot precede current book knowledge/);
});

test('throwing metric sinks are contained and counted without corrupting book truth', () => {
  const clock = new ManualClock();
  const metricSink = { record() { throw new Error('sink unavailable'); } };
  const value = harness('SPOT', {}, { clock, metricSink });
  makeLive(value);
  assert.doesNotThrow(() => value.reducer.emitMetrics());
  const snapshot = value.reducer.snapshot();
  assert.equal(snapshot.phase, 'LIVE');
  assert.ok(snapshot.counters.metricSinkFailureCount > 0);
});

test('future metric emission fails before writing a partial metric batch', () => {
  const clock = new ManualClock();
  const records = [];
  const value = harness('SPOT', {}, { clock, metricSink: { record(metric) { records.push(metric); } } });
  makeLive(value);
  assert.throws(() => value.reducer.emitMetrics(clock.nowMs() + 1), /cannot exceed/);
  assert.deepEqual(records, []);
});

test('deterministic replay has canonical identical output and does not mutate official-shaped inputs', () => {
  const rawSnapshot = snapshotRaw('SPOT', 100, 10, [['100', '10']], [['101', '10']], T0);
  const rawBridge = deltaRaw('SPOT', 100, 101, null, [['100', '11']], [['101', '9']], T0);
  const rawLive = deltaRaw('SPOT', 102, 103, null, [['99', '4']], [['102', '3']], T0 + 10);
  const originals = structuredClone({ rawSnapshot, rawBridge, rawLive });
  const replay = () => {
    const value = harness('SPOT');
    const snapshot = runtimeEvent('SPOT', 'SNAPSHOT', rawSnapshot, T0);
    const bridge = runtimeEvent('SPOT', 'DELTA', rawBridge, T0);
    value.reducer.applySnapshot({ connectionGeneration: 1, syncEpoch: value.request.syncEpoch, event: snapshot });
    value.reducer.ingestDelta(bridge);
    value.clock.advance(10);
    value.reducer.ingestDelta(runtimeEvent('SPOT', 'DELTA', rawLive, T0 + 10));
    return serializeLocalBookSnapshot(value.reducer.snapshot());
  };
  assert.equal(replay(), replay());
  assert.deepEqual({ rawSnapshot, rawBridge, rawLive }, originals);
});

test('config rejects unbounded policies and any attempt to mix standard USD-M with RPI scope', () => {
  assert.throws(() => harness('SPOT', { maximumBufferedEvents: 100_001 }), /hard safety bound/);
  assert.throws(() => harness('USD_M_PERPETUAL', { bookScope: 'RPI_INCLUDED' }), /exclude RPI/);
  assert.throws(() => harness('SPOT', { snapshotLimit: 5_001 }), /official snapshot bound/);
});

test('snapshot tokens reject a response produced with the wrong requested depth limit', () => {
  const value = harness('SPOT', { snapshotLimit: 10 });
  const wrongLimit = runtimeEvent(
    'SPOT', 'SNAPSHOT',
    snapshotRaw('SPOT', 100, 5, [['100', '1']], [['101', '1']], T0),
    T0,
  );
  const result = value.reducer.applySnapshot({
    connectionGeneration: 1,
    syncEpoch: value.request.syncEpoch,
    event: wrongLimit,
  });
  assert.equal(result.kind, 'RESYNC_REQUIRED');
  assert.equal(result.failure.code, 'INVALID_VALUE');
});

test('overlong public sequence identifiers are rejected before local BigInt retention', () => {
  const value = harness('SPOT');
  const identifier = '9'.repeat(40);
  const event = runtimeEvent(
    'SPOT', 'DELTA',
    deltaRaw('SPOT', identifier, identifier, null, [['100', '1']], [], T0),
    T0,
  );
  const result = value.reducer.ingestDelta(event);
  assert.equal(result.kind, 'RESYNC_REQUIRED');
  assert.equal(result.failure.code, 'INVALID_VALUE');
  assert.equal(value.reducer.snapshot().bufferedEvents, 0);
});
