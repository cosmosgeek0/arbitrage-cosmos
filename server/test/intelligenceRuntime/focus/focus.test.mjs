import test from 'node:test';
import assert from 'node:assert/strict';

const focusModuleUrl = process.env.FOCUS_MODULE
  ? new URL(process.env.FOCUS_MODULE, import.meta.url).href
  : new URL('../../../dist/intelligenceRuntime/focus/index.js', import.meta.url).href;

const {
  FocusSubscriptionAllocator,
  buildFocusDemands,
  focusAllocatorConfig,
} = await import(focusModuleUrl);

class ManualClock {
  constructor(now = 1_000) { this.now = now; }
  nowMs() { return this.now; }
  advance(ms) { this.now += ms; }
}

function instrument(symbol, productFamily, instrumentId = `${productFamily}:${symbol}`) {
  const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const quoteAsset = 'USDT';
  return {
    instrumentId,
    venue: 'BINANCE',
    productFamily,
    symbol,
    pair: `${baseAsset || symbol}/${quoteAsset}`,
    baseAsset: baseAsset || symbol,
    quoteAsset,
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  };
}

function capability(id, symbol, { spot = true, futures = false } = {}) {
  return {
    attentionInstrumentId: id,
    symbol,
    spot: spot ? instrument(symbol, 'SPOT', `spot:${symbol}`) : null,
    usdMPerpetual: futures ? instrument(symbol, 'USD_M_PERPETUAL', `usdm:${symbol}`) : null,
  };
}

function allocation(id, symbol, requestedEvidence, overrides = {}) {
  return {
    id: `allocation:${id}`,
    instrumentId: id,
    symbol,
    tier: overrides.tier ?? 'FOCUS',
    desiredTier: overrides.desiredTier ?? overrides.tier ?? 'FOCUS',
    enteredAtMs: overrides.enteredAtMs ?? 100,
    lastChangedAtMs: overrides.lastChangedAtMs ?? 100,
    protected: overrides.protected ?? false,
    promotionReasons: [],
    demotionReasons: [],
    requestedEvidence,
    requestedFeatures: [],
    priority: overrides.priority ?? 0.5,
    hintIds: [],
    lastSignalAtMs: overrides.lastSignalAtMs ?? 900,
    cooldownUntilMs: null,
    candidateOpenedAtMs: null,
    focusEligibility: { state: 'ELIGIBLE', reasonCodes: [] },
    sourceQuality: 'HEALTHY',
    truth: {},
  };
}

function plan(allocations, id = 'plan-1') {
  return {
    id,
    atMs: 1_000,
    configurationVersion: 'test',
    allocations,
    candidates: [],
    requests: [],
    ignoredHints: [],
    hintPortFailures: [],
    tierCounts: { UNIVERSE: 0, WATCH: 0, CANDIDATE: 0, FOCUS: allocations.length, DEEP_FOCUS: 0, RELEASED: 0 },
    truth: {},
  };
}

function harness({ allocations = [], capabilities = [], deliveries = [], protectedSymbols = [], config = {} } = {}) {
  const clock = new ManualClock();
  const state = {
    plan: plan(allocations),
    capabilities,
    deliveries,
    protectedSymbols,
  };
  const allocator = new FocusSubscriptionAllocator({
    clock,
    attentionPlans: { readAttentionPlan: () => state.plan },
    capabilities: { readCapabilities: () => state.capabilities },
    deliveries: { readDeliveredEvidence: () => state.deliveries },
    protectedSymbols: { protectedSymbols: () => state.protectedSymbols },
  }, config);
  return { clock, state, allocator };
}

function activate(h, route, generation = 1, slot = 0) {
  const id = h.allocator.connectionIds(route)[slot];
  h.allocator.updateConnection({ route, connectionId: id, generation, state: 'AVAILABLE' });
  return id;
}

function accept(h, command) {
  assert.equal(h.allocator.acknowledge({ ...command, accepted: true, observedAtMs: h.clock.nowMs() }), true);
}

test('catalog maps every attention evidence kind to current routed public resources', () => {
  const attention = allocation('btc', 'BTCUSDT', [
    'TRADE', 'BOOK_TICKER', 'DEPTH_SNAPSHOT', 'DEPTH_DELTA', 'MARK_PRICE',
    'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION', 'BORROW', 'CONTEXT',
  ]);
  const delivered = [{
    attentionInstrumentId: 'btc',
    productFamily: 'SPOT',
    evidenceKind: 'BOOK_TICKER',
    sourceId: 'existing.spot.broad-book',
    state: 'FRESH',
    observedAtMs: 999,
  }];
  const demands = buildFocusDemands(attention, capability('btc', 'BTCUSDT', { spot: true, futures: true }), delivered);
  const descriptor = demands.map((entry) => [
    entry.productFamily, entry.evidenceKind, entry.transport, entry.route, entry.streamOrPath, entry.initialReason,
  ]);

  assert.ok(descriptor.some((row) => row[0] === 'SPOT' && row[1] === 'BOOK_TICKER' && row[2] === 'REUSED_BROAD'));
  assert.ok(descriptor.some((row) => row[1] === 'TRADE' && row[3] === 'SPOT_MARKET' && row[4] === 'btcusdt@aggTrade'));
  assert.ok(descriptor.some((row) => row[1] === 'TRADE' && row[3] === 'USD_M_MARKET' && row[4] === 'btcusdt@aggTrade'));
  assert.ok(descriptor.some((row) => row[1] === 'BOOK_TICKER' && row[3] === 'USD_M_PUBLIC'));
  assert.ok(descriptor.some((row) => row[1] === 'DEPTH_DELTA' && row[3] === 'USD_M_PUBLIC' && row[4] === 'btcusdt@depth@100ms'));
  assert.ok(descriptor.some((row) => row[1] === 'MARK_PRICE' && row[3] === 'USD_M_MARKET' && row[4] === 'btcusdt@markPrice@1s'));
  assert.ok(descriptor.some((row) => row[1] === 'FUNDING' && row[3] === 'USD_M_MARKET' && row[4] === 'btcusdt@markPrice@1s'));
  assert.ok(descriptor.some((row) => row[1] === 'LIQUIDATION' && row[3] === 'USD_M_MARKET' && row[4] === 'btcusdt@forceOrder'));
  assert.ok(descriptor.some((row) => row[1] === 'DEPTH_SNAPSHOT' && row[4] === '/api/v3/depth'));
  assert.ok(descriptor.some((row) => row[1] === 'DEPTH_SNAPSHOT' && row[4] === '/fapi/v1/depth'));
  assert.ok(descriptor.some((row) => row[1] === 'OPEN_INTEREST' && row[4] === '/fapi/v1/openInterest'));
  assert.ok(descriptor.some((row) => row[1] === 'CONTEXT' && row[2] === 'REST'));
  assert.ok(descriptor.some((row) => row[1] === 'BORROW' && row[5] === 'PRIVATE_ENDPOINT_FORBIDDEN'));
  assert.ok(demands.every((entry) => (
    entry.streamOrPath === null || !entry.streamOrPath.toLowerCase().includes('private')
  )));
});

test('capability legs must preserve allocation and capability symbol identity', () => {
  const attention = allocation('btc', 'BTCUSDT', ['TRADE']);
  const mismatched = capability('btc', 'BTCUSDT');
  mismatched.spot = instrument('ETHUSDT', 'SPOT', 'spot:ETHUSDT');
  assert.throws(() => buildFocusDemands(attention, mismatched, []), /mismatched SPOT focus capability symbol/);

  const h = harness({ allocations: [attention], capabilities: [mismatched] });
  activate(h, 'SPOT_MARKET');
  const result = h.allocator.reconcile();
  assert.equal(result.commands.length, 0);
  assert.equal(result.snapshot.requirements[0].symbol, 'BTCUSDT');
  assert.equal(result.snapshot.requirements[0].state, 'UNFULFILLED');
  assert.equal(result.snapshot.requirements[0].reasonCodes.includes('INVALID_CAPABILITY'), true);
  assert.equal(result.snapshot.streams.some((entry) => entry.stream.includes('ethusdt')), false);
});

test('promotion warms only after ACK and becomes ready only after a current message', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
  });
  const connectionId = activate(h, 'SPOT_MARKET');
  const promoted = h.allocator.reconcile();
  assert.equal(promoted.commands.length, 1);
  assert.deepEqual(promoted.commands[0].params, ['btcusdt@aggTrade']);
  assert.equal(promoted.snapshot.requirements[0].state, 'SUBSCRIBING');
  assert.equal(promoted.snapshot.requirements[0].reasonCodes.includes('WAITING_FOR_SUBSCRIBE_ACK'), true);

  accept(h, promoted.commands[0]);
  const warming = h.allocator.reconcile();
  assert.equal(warming.commands.length, 0);
  assert.equal(warming.snapshot.requirements[0].state, 'WARMING');
  assert.equal(h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: h.clock.nowMs(),
  }), true);
  assert.equal(h.allocator.reconcile().snapshot.requirements[0].state, 'READY');
});

test('acknowledgements and readiness observations are bounded by command time, injected now, and monotonicity', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
  });
  const connectionId = activate(h, 'SPOT_MARKET');
  const promoted = h.allocator.reconcile();
  const command = promoted.commands[0];
  assert.equal(command.createdAtMs, 1_000);
  assert.throws(() => h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 999,
  }), /precede its subscribe command/);
  assert.throws(() => h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 1_001,
  }), /cannot be in the future/);
  assert.throws(() => h.allocator.acknowledge({ ...command, accepted: true, observedAtMs: 999 }), /precede its command/);
  assert.throws(() => h.allocator.acknowledge({ ...command, accepted: true, observedAtMs: 1_001 }), /cannot be in the future/);
  accept(h, command);
  assert.equal(h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 1_000,
  }), true);
  h.clock.advance(1);
  assert.equal(h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 1_001,
  }), true);
  assert.throws(() => h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 1_000,
  }), /cannot regress/);
});

test('forged acknowledgement booleans cannot consume pending control state', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
  });
  activate(h, 'SPOT_MARKET');
  const command = h.allocator.reconcile().commands[0];
  assert.throws(
    () => h.allocator.acknowledge({ ...command, accepted: 'false', observedAtMs: h.clock.nowMs() }),
    /accepted must be boolean/,
  );
  assert.equal(h.allocator.acknowledge({ ...command, accepted: true, observedAtMs: h.clock.nowMs() }), true);
});

test('reconnect generation invalidates readiness and deterministically replays subscriptions', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
  });
  const connectionId = activate(h, 'SPOT_MARKET');
  const first = h.allocator.reconcile();
  accept(h, first.commands[0]);
  h.allocator.observe({ route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 1_000 });
  assert.equal(h.allocator.reconcile().snapshot.requirements[0].state, 'READY');

  h.allocator.updateConnection({ route: 'SPOT_MARKET', connectionId, generation: 2, state: 'AVAILABLE' });
  h.clock.advance(1);
  assert.equal(h.allocator.observe({
    route: 'SPOT_MARKET', connectionId, generation: 1, stream: 'btcusdt@aggTrade', observedAtMs: 1_001,
  }), false);
  const replay = h.allocator.reconcile();
  assert.equal(replay.commands.length, 1);
  assert.equal(replay.commands[0].generation, 2);
  assert.deepEqual(replay.commands[0].params, ['btcusdt@aggTrade']);
  assert.equal(replay.snapshot.requirements[0].state, 'SUBSCRIBING');
});

test('an unavailable connection cannot reconnect under a reused generation', () => {
  const h = harness();
  const connectionId = activate(h, 'SPOT_MARKET', 1);
  h.allocator.updateConnection({ route: 'SPOT_MARKET', connectionId, generation: 1, state: 'UNAVAILABLE' });
  assert.throws(
    () => h.allocator.updateConnection({ route: 'SPOT_MARKET', connectionId, generation: 1, state: 'AVAILABLE' }),
    /requires a newer generation/,
  );
  h.allocator.updateConnection({ route: 'SPOT_MARKET', connectionId, generation: 2, state: 'AVAILABLE' });
});

test('attention plan time cannot roll back retained allocator knowledge', () => {
  const h = harness({ allocations: [], capabilities: [] });
  h.allocator.reconcile();
  h.clock.advance(1);
  h.state.plan = { ...plan([], 'older'), atMs: 999 };
  assert.throws(() => h.allocator.reconcile(), /cannot move backwards/);
  h.state.plan = { ...plan([], 'newer'), atMs: 1_001 };
  assert.equal(h.allocator.reconcile().snapshot.lastAppliedPlanId, 'newer');
});

test('expired unprotected assignments on a dead route release capacity for a healthy fallback route', () => {
  const request = allocation('btc', 'BTCUSDT', ['TRADE']);
  const h = harness({
    allocations: [request],
    capabilities: [capability('btc', 'BTCUSDT', { spot: true, futures: false })],
    config: { maximumTotalStreams: 1, minimumLeaseMs: 10 },
  });
  const spotConnection = activate(h, 'SPOT_MARKET', 1);
  assert.equal(h.allocator.reconcile().commands[0].route, 'SPOT_MARKET');
  h.allocator.updateConnection({ route: 'SPOT_MARKET', connectionId: spotConnection, generation: 1, state: 'UNAVAILABLE' });
  h.state.capabilities = [capability('btc', 'BTCUSDT', { spot: false, futures: true })];
  activate(h, 'USD_M_MARKET', 1);
  h.clock.advance(11);
  h.state.plan = { ...plan([request], 'futures-fallback'), atMs: 1_011 };
  const fallback = h.allocator.reconcile();
  assert.equal(fallback.commands.length, 1);
  assert.equal(fallback.commands[0].route, 'USD_M_MARKET');
  assert.deepEqual(fallback.commands[0].params, ['btcusdt@aggTrade']);
});

test('focus config is an exact plain-data schema and never executes accessors', () => {
  assert.throws(() => focusAllocatorConfig({ secret: 'no' }), /unknown field secret/);
  assert.throws(() => focusAllocatorConfig({ routes: { PRIVATE: {} } }), /unknown field PRIVATE/);
  assert.throws(() => focusAllocatorConfig({ routes: { SPOT_MARKET: { secret: 'no' } } }), /unknown field secret/);
  const symbolConfig = {};
  symbolConfig[Symbol('secret')] = 'no';
  assert.throws(() => focusAllocatorConfig(symbolConfig), /symbol keys/);
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'maximumTotalStreams', { enumerable: true, get() { getterCalls += 1; return 1; } });
  assert.throws(() => focusAllocatorConfig(accessor), /data property/);
  assert.equal(getterCalls, 0);
});

test('allocation protection is a strict boolean at both catalog and allocator boundaries', () => {
  const forged = allocation('btc', 'BTCUSDT', ['TRADE'], { protected: 'false' });
  assert.throws(() => buildFocusDemands(forged, capability('btc', 'BTCUSDT'), []), /protected must be boolean/);
  const h = harness({ allocations: [forged], capabilities: [capability('btc', 'BTCUSDT')] });
  activate(h, 'SPOT_MARKET');
  assert.throws(() => h.allocator.reconcile(), /protected must be boolean/);
});

test('demotion honors a minimum lease and focus thrash does not churn controls', () => {
  const request = allocation('btc', 'BTCUSDT', ['TRADE']);
  const h = harness({
    allocations: [request],
    capabilities: [capability('btc', 'BTCUSDT')],
    config: { minimumLeaseMs: 5_000 },
  });
  activate(h, 'SPOT_MARKET');
  const subscribe = h.allocator.reconcile();
  accept(h, subscribe.commands[0]);

  h.state.plan = plan([], 'demoted');
  const held = h.allocator.reconcile();
  assert.equal(held.commands.length, 0);
  assert.equal(held.snapshot.streams.length, 1);
  assert.equal(held.snapshot.counts.retainedByHysteresis, 1);

  h.state.plan = plan([request], 'repromoted');
  assert.equal(h.allocator.reconcile().commands.length, 0);
  h.state.plan = plan([], 'demoted-again');
  h.clock.advance(5_001);
  const release = h.allocator.reconcile();
  assert.equal(release.commands.length, 1);
  assert.equal(release.commands[0].method, 'UNSUBSCRIBE');
  accept(h, release.commands[0]);
  assert.equal(h.allocator.reconcile().snapshot.streams.length, 0);

  h.state.plan = plan([request], 'immediate-repromotion');
  const cooling = h.allocator.reconcile();
  assert.equal(cooling.commands.length, 0);
  assert.equal(cooling.snapshot.requirements[0].reasonCodes.includes('LEASE_HYSTERESIS_ACTIVE'), true);
  assert.equal(cooling.snapshot.counts.cooldownDeferredRequirements, 1);
  h.clock.advance(2_001);
  assert.equal(h.allocator.reconcile().commands[0].method, 'SUBSCRIBE');
});

test('same-priority allocation is stable under reversed plan input and reports budget exhaustion', () => {
  const a = allocation('a', 'AAAUSDT', ['TRADE'], { priority: 0.5, lastSignalAtMs: 900 });
  const b = allocation('b', 'BBBUSDT', ['TRADE'], { priority: 0.5, lastSignalAtMs: 900 });
  const config = {
    maximumTotalStreams: 1,
    routes: { SPOT_MARKET: { maximumConnections: 1, maximumStreamsPerConnection: 1 } },
  };
  const first = harness({ allocations: [b, a], capabilities: [capability('a', 'AAAUSDT'), capability('b', 'BBBUSDT')], config });
  const second = harness({ allocations: [a, b], capabilities: [capability('b', 'BBBUSDT'), capability('a', 'AAAUSDT')], config });
  activate(first, 'SPOT_MARKET');
  activate(second, 'SPOT_MARKET');
  const left = first.allocator.reconcile();
  const right = second.allocator.reconcile();
  assert.deepEqual(left.commands, right.commands);
  assert.deepEqual(left.commands[0].params, ['aaausdt@aggTrade']);
  const rejected = left.snapshot.requirements.find((entry) => entry.attentionInstrumentId === 'b');
  assert.equal(rejected.state, 'UNFULFILLED');
  assert.equal(rejected.reasonCodes.includes('STREAM_BUDGET_EXHAUSTED'), true);
});

test('control batches are bounded and enforced against the per-connection message rate', () => {
  const allocations = ['a', 'b', 'c'].map((id) => allocation(id, `${id.toUpperCase()}AAUSDT`, ['TRADE']));
  const capabilities = allocations.map((entry) => capability(entry.instrumentId, entry.symbol));
  const h = harness({
    allocations,
    capabilities,
    config: {
      maximumTotalStreams: 3,
      maximumStreamsPerControlMessage: 1,
      routes: { SPOT_MARKET: {
        maximumConnections: 1,
        maximumStreamsPerConnection: 3,
        maximumControlMessagesPerInterval: 1,
      } },
    },
  });
  activate(h, 'SPOT_MARKET');
  const first = h.allocator.reconcile();
  assert.equal(first.commands.length, 1);
  assert.equal(first.commands[0].params.length, 1);
  assert.equal(first.snapshot.counts.pendingControlMessages, 1);
  assert.equal(first.snapshot.requirements.filter((entry) => entry.reasonCodes.includes('CONTROL_RATE_DEFERRED')).length, 2);

  accept(h, first.commands[0]);
  h.clock.advance(1_000);
  const second = h.allocator.reconcile();
  assert.equal(second.commands.length, 1);
  assert.equal(second.commands[0].params.length, 1);
});

test('lost control acknowledgements expire into bounded retries and recover on a new connection generation', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
    config: {
      controlAcknowledgementTimeoutMs: 100,
      maximumControlRetries: 1,
    },
  });
  const connectionId = activate(h, 'SPOT_MARKET');
  const first = h.allocator.reconcile();
  assert.equal(first.commands.length, 1);
  assert.equal(first.snapshot.counts.pendingControlMessages, 1);

  h.clock.advance(100);
  const retry = h.allocator.reconcile();
  assert.equal(retry.commands.length, 1);
  assert.notEqual(retry.commands[0].id, first.commands[0].id);
  assert.deepEqual(retry.commands[0].params, ['btcusdt@aggTrade']);
  assert.equal(retry.snapshot.counts.pendingControlMessages, 1);

  h.clock.advance(100);
  const exhausted = h.allocator.reconcile();
  assert.equal(exhausted.commands.length, 0);
  assert.equal(exhausted.snapshot.counts.pendingControlMessages, 0);
  assert.equal(exhausted.snapshot.requirements[0].state, 'UNFULFILLED');
  assert.equal(exhausted.snapshot.requirements[0].reasonCodes.includes('CONTROL_ACK_TIMEOUT'), true);
  assert.equal(exhausted.snapshot.requirements[0].reasonCodes.includes('CONTROL_RETRY_EXHAUSTED'), true);

  h.allocator.updateConnection({ route: 'SPOT_MARKET', connectionId, generation: 2, state: 'AVAILABLE' });
  const replay = h.allocator.reconcile();
  assert.equal(replay.commands.length, 1);
  assert.equal(replay.commands[0].generation, 2);
  assert.deepEqual(replay.commands[0].params, ['btcusdt@aggTrade']);
});

test('broad evidence is reused while an unavailable optional venue remains explicitly partial', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT', { spot: true, futures: true })],
    deliveries: [{
      attentionInstrumentId: 'btc',
      productFamily: 'SPOT',
      evidenceKind: 'TRADE',
      sourceId: 'existing.spot.trade',
      state: 'FRESH',
      observedAtMs: 999,
    }],
  });
  const result = h.allocator.reconcile();
  assert.equal(result.commands.length, 0);
  assert.equal(result.snapshot.requirements.find((entry) => entry.productFamily === 'SPOT').state, 'REUSED_BROAD');
  const futures = result.snapshot.requirements.find((entry) => entry.productFamily === 'USD_M_PERPETUAL');
  assert.equal(futures.state, 'UNFULFILLED');
  assert.equal(futures.reasonCodes.includes('SOURCE_UNAVAILABLE'), true);
  assert.equal(result.snapshot.counts.reusedBroad, 1);
});

test('protected symbols win capacity and survive plan removal beyond the lease', () => {
  const low = allocation('low', 'LOWUSDT', ['TRADE'], { priority: 0.01 });
  const high = allocation('high', 'HIGHUSDT', ['TRADE'], { priority: 0.99 });
  const h = harness({
    allocations: [high, low],
    capabilities: [capability('low', 'LOWUSDT'), capability('high', 'HIGHUSDT')],
    protectedSymbols: ['LOWUSDT'],
    config: {
      maximumTotalStreams: 1,
      minimumLeaseMs: 10,
      routes: { SPOT_MARKET: { maximumConnections: 1, maximumStreamsPerConnection: 1 } },
    },
  });
  activate(h, 'SPOT_MARKET');
  const first = h.allocator.reconcile();
  assert.deepEqual(first.commands[0].params, ['lowusdt@aggTrade']);
  accept(h, first.commands[0]);

  h.state.plan = plan([high], 'protected-removed');
  h.clock.advance(100);
  const preserved = h.allocator.reconcile();
  assert.equal(preserved.commands.length, 0);
  assert.equal(preserved.snapshot.streams[0].protected, true);
  assert.equal(preserved.snapshot.protectedSymbols[0].state, 'PRESERVED');
  assert.equal(preserved.snapshot.protectedSymbols[0].reasonCodes.includes('PROTECTED_SYMBOL_NOT_IN_ATTENTION_PLAN'), true);
  assert.equal(preserved.snapshot.requirements[0].reasonCodes.includes('STREAM_BUDGET_EXHAUSTED'), true);

  const unresolved = harness({ protectedSymbols: ['GHOSTUSDT'] }).allocator.reconcile();
  assert.deepEqual(unresolved.snapshot.protectedSymbols, [{
    symbol: 'GHOSTUSDT', state: 'UNRESOLVED', reasonCodes: ['PROTECTED_SYMBOL_UNRESOLVED'],
  }]);
});

test('a symbol protected after unsubscribe dispatch retains identity and is deterministically resubscribed', () => {
  const request = allocation('late-protected', 'LOWUSDT', ['TRADE']);
  const h = harness({
    allocations: [request],
    capabilities: [capability('late-protected', 'LOWUSDT')],
    config: { minimumLeaseMs: 0 },
  });
  activate(h, 'SPOT_MARKET');
  const initial = h.allocator.reconcile();
  accept(h, initial.commands[0]);

  h.state.plan = plan([], 'removed-before-protection');
  const unsubscribe = h.allocator.reconcile();
  assert.equal(unsubscribe.commands[0].method, 'UNSUBSCRIBE');
  h.state.protectedSymbols = ['LOWUSDT'];
  const protectedPending = h.allocator.reconcile();
  assert.equal(protectedPending.snapshot.protectedSymbols[0].state, 'PRESERVED');
  assert.equal(protectedPending.snapshot.streams[0].protected, true);

  accept(h, unsubscribe.commands[0]);
  const recovery = h.allocator.reconcile();
  assert.equal(recovery.commands.length, 1);
  assert.equal(recovery.commands[0].method, 'SUBSCRIBE');
  assert.deepEqual(recovery.commands[0].params, ['lowusdt@aggTrade']);
  assert.equal(recovery.snapshot.streams.length, 1);
  assert.equal(recovery.snapshot.streams[0].protected, true);
  assert.equal(recovery.snapshot.protectedSymbols[0].state, 'PRESERVED');
});

test('missing/invalid capabilities and private evidence remain honest unfulfilled rows', () => {
  const missing = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE', 'BORROW'])],
  }).allocator.reconcile();
  assert.equal(missing.snapshot.requirements.length, 2);
  assert.equal(
    missing.snapshot.requirements.find((entry) => entry.evidenceKind === 'TRADE').reasonCodes.includes('CAPABILITY_UNAVAILABLE'),
    true,
  );
  assert.equal(
    missing.snapshot.requirements.find((entry) => entry.evidenceKind === 'BORROW').reasonCodes.includes('PRIVATE_ENDPOINT_FORBIDDEN'),
    true,
  );

  const attention = allocation('btc', 'BTCUSDT', ['BORROW']);
  const privateDemand = buildFocusDemands(attention, capability('btc', 'BTCUSDT'), []);
  assert.equal(privateDemand[0].transport, 'UNAVAILABLE');
  assert.equal(privateDemand[0].initialReason, 'PRIVATE_ENDPOINT_FORBIDDEN');
});

test('plan loss preserves bounded assignments and never mass-unsubscribes', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
  });
  activate(h, 'SPOT_MARKET');
  const first = h.allocator.reconcile();
  accept(h, first.commands[0]);
  h.state.plan = null;
  h.clock.advance(60_000);
  const unavailable = h.allocator.reconcile();
  assert.equal(unavailable.commands.length, 0);
  assert.equal(unavailable.snapshot.streams.length, 1);
  assert.equal(unavailable.snapshot.planId, null);
  assert.equal(unavailable.snapshot.lastAppliedPlanId, 'plan-1');
  assert.deepEqual(unavailable.snapshot.reasonCodes, ['ATTENTION_PLAN_UNAVAILABLE']);
});

test('configuration rejects impossible or unbounded connection/stream plans', () => {
  assert.throws(() => focusAllocatorConfig({ maximumTotalStreams: 100_000 }), /maximumTotalStreams/);
  assert.throws(() => focusAllocatorConfig({
    maximumTotalStreams: 4,
    routes: {
      SPOT_MARKET: { maximumConnections: 1, maximumStreamsPerConnection: 1 },
      USD_M_PUBLIC: { maximumConnections: 1, maximumStreamsPerConnection: 1 },
      USD_M_MARKET: { maximumConnections: 1, maximumStreamsPerConnection: 1 },
    },
  }), /physical connection capacity/);
  assert.throws(() => focusAllocatorConfig({
    routes: { SPOT_MARKET: { maximumStreamsPerConnection: 1_025 } },
  }), /maximumStreamsPerConnection/);
  assert.throws(() => focusAllocatorConfig({ controlAcknowledgementTimeoutMs: 0 }), /controlAcknowledgementTimeoutMs/);
  assert.throws(() => focusAllocatorConfig({ maximumControlRetries: 101 }), /maximumControlRetries/);
});

test('future delivery observations are rejected instead of being reused as current evidence', () => {
  const h = harness({
    allocations: [allocation('btc', 'BTCUSDT', ['TRADE'])],
    capabilities: [capability('btc', 'BTCUSDT')],
    deliveries: [{
      attentionInstrumentId: 'btc', productFamily: 'SPOT', evidenceKind: 'TRADE',
      sourceId: 'future.source', state: 'FRESH', observedAtMs: 1_001,
    }],
  });
  assert.throws(() => h.allocator.reconcile(), /cannot be in the future/);
});
