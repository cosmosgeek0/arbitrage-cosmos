import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeObservedEvidence } from '../../../dist/foundation/reconciliation/index.js';
import {
  OBSERVED_ORDER_FOCUS_CONFIG_KEY,
  DurableObservedOrderFocusCoordinator,
  createObservedOrderFocusPersistence,
} from '../../../dist/services/observedOrderFocus.js';
import { VolumeRuntime } from '../../../dist/services/volumeRuntime.js';
import {
  OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
  VolumeEngine,
  observedOrderFocusFingerprint,
} from '../../../dist/engine/volume/index.js';
import { projectObservedOrderFocus } from '../../../dist/systemIntegration/adapters/index.js';
import {
  createProductionObservedOrderFocusPort,
  createProductionSystemIntegrationPorts,
} from '../../../dist/systemIntegration/production/index.js';
import { BoundedInMemoryLedger } from '../fixtures/memory-ledger.mjs';

const NOW = 1_800_000_000_000;

class DualClock {
  constructor(now = NOW) { this.value = now; }
  now() { return this.value; }
  nowMs() { return this.value; }
  set(value) { this.value = value; }
}

class ScriptedClock extends DualClock {
  constructor(now = NOW) {
    super(now);
    this.script = [];
    this.reads = 0;
  }
  next() {
    this.reads += 1;
    return this.script.length > 0 ? this.script.shift() : this.value;
  }
  now() { return this.next(); }
  nowMs() { return this.next(); }
  setScript(values) {
    this.script = [...values];
    this.reads = 0;
  }
}

function symbolMeta(symbol) {
  return {
    symbol,
    base: symbol.slice(0, -4),
    quote: 'USDT',
    hasSpot: true,
    hasPerp: false,
    marginBorrowable: null,
    minNotionalUsd: 5,
    tickSize: 0.01,
    stepSize: 0.001,
    quoteVolume24hUsd: 5_000_000,
    eligible: true,
    ineligibleReason: null,
  };
}

function volumeEngine(clock) {
  const engine = new VolumeEngine(clock, {
    focusSoftCap: 2,
    focusHardCap: 3,
    focusMaxAgeMs: 60_000,
  });
  engine.start();
  engine.setUniverse(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map(symbolMeta));
  return engine;
}

function strategyPort(engine) {
  return {
    applyObservedOrderFocus: (snapshot) => engine.applyObservedOrderFocus(snapshot),
    restoreObservedOrderFocus: (snapshot) => engine.restoreObservedOrderFocus(snapshot),
    observedOrderFocusReadback: (status, applied, reasonCodes) =>
      engine.observedOrderFocusReadback(status, applied, reasonCodes),
  };
}

function focusSnapshot(overrides = {}) {
  return {
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: 'foundation.reconciliation.open-orders',
    authority: 'SYNTHETIC_TEST',
    state: 'AVAILABLE',
    observedAtMs: NOW - 100,
    validUntilMs: NOW + 900,
    openSymbols: ['BTCUSDT'],
    reasonCodes: [],
    ...overrides,
  };
}

function unavailableSnapshot(overrides = {}) {
  return {
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: 'foundation.reconciliation.open-orders',
    authority: 'UNAVAILABLE',
    state: 'UNAVAILABLE',
    observedAtMs: NOW,
    validUntilMs: null,
    openSymbols: null,
    reasonCodes: ['OPEN_ORDER_TRUTH_UNAVAILABLE'],
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    sourceId: 'foundation.reconciliation.open-orders',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    coverageStartMs: null,
    coverageEndMs: null,
    ...overrides,
  };
}

function order(symbol, status, index, overrides = {}) {
  return {
    venue: 'BINANCE_SPOT',
    symbol,
    clientOrderId: `client-${index}`,
    venueOrderId: `venue-${index}`,
    side: 'BUY',
    originalQuantity: 1,
    cumulativeFilledQuantity: status === 'FILLED' ? 1 : 0,
    status,
    reduceOnly: null,
    updatedAtMs: NOW - 100,
    ...overrides,
  };
}

function evidence(records, metadataOverrides = {}) {
  return {
    orders: { metadata: metadata(metadataOverrides), records },
    fills: { metadata: metadata({ sourceId: 'foundation.reconciliation.fills' }), records: [] },
    positions: { metadata: metadata({ sourceId: 'foundation.reconciliation.positions' }), records: [] },
  };
}

test('normalized owner projection exposes only active symbols and a known empty cut stays exact', () => {
  const normalized = normalizeObservedEvidence(evidence([
    order('ETHUSDT', 'PARTIALLY_FILLED', 2),
    order('BTCUSDT', 'NEW', 1),
    order('SOLUSDT', 'FILLED', 3),
  ]), NOW);
  const projected = projectObservedOrderFocus(normalized);
  assert.equal(projected.state, 'AVAILABLE');
  assert.deepEqual(projected.openSymbols, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(projected.observedAtMs, NOW - 100);
  assert.equal(projected.validUntilMs, NOW + 900);
  assert.equal(JSON.stringify(projected).includes('client-'), false);
  assert.equal(JSON.stringify(projected).includes('venue-'), false);

  const knownEmpty = projectObservedOrderFocus(normalizeObservedEvidence(evidence([]), NOW));
  assert.equal(knownEmpty.state, 'AVAILABLE');
  assert.deepEqual(knownEmpty.openSymbols, []);

  const zeroInput = evidence([]);
  for (const collection of ['orders', 'fills', 'positions']) {
    zeroInput[collection].metadata.sourceTimeMs = 0;
    zeroInput[collection].metadata.receivedAtMs = 0;
  }
  const normalizedAtZero = normalizeObservedEvidence(zeroInput, 0);
  assert.equal(Object.is(normalizedAtZero.evaluatedAtMs, 0), true);
  assert.equal(Object.is(normalizedAtZero.evaluatedAtMs, -0), false);
  assert.throws(() => normalizeObservedEvidence(zeroInput, -0), TypeError);

  const negativeZeroCuts = [
    { ...normalized, evaluatedAtMs: -0 },
    { ...normalized, orders: {
      ...normalized.orders,
      metadata: { ...normalized.orders.metadata, receivedAtMs: -0 },
    } },
    { ...normalized, stats: {
      ...normalized.stats,
      exactDuplicateOrdersDropped: -0,
    } },
  ];
  for (const cut of negativeZeroCuts) {
    assert.throws(() => projectObservedOrderFocus(cut), TypeError);
  }
});

test('strategy snapshot boundary rejects Proxy, oversize, and digest-colliding negative zero trap-free', () => {
  const clock = new DualClock(0);
  const engine = volumeEngine(clock);
  let traps = 0;
  const statefulRoot = new Proxy(focusSnapshot(), {
    get() { traps += 1; throw new Error('root get trap must not run'); },
    getPrototypeOf() { traps += 1; throw new Error('root prototype trap must not run'); },
    ownKeys() { traps += 1; throw new Error('root ownKeys trap must not run'); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error('root descriptor trap must not run'); },
  });
  const revokedRoot = Proxy.revocable(focusSnapshot(), {});
  revokedRoot.revoke();
  const statefulSymbols = new Proxy(['BTCUSDT'], {
    get() { traps += 1; throw new Error('array get trap must not run'); },
    getPrototypeOf() { traps += 1; throw new Error('array prototype trap must not run'); },
    ownKeys() { traps += 1; throw new Error('array ownKeys trap must not run'); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error('array descriptor trap must not run'); },
  });
  const revokedReasons = Proxy.revocable([], {});
  revokedReasons.revoke();
  const oversizedReasons = new Array(101);
  Object.defineProperty(oversizedReasons, '0', {
    enumerable: true,
    configurable: true,
    get() { traps += 1; throw new Error('reason accessor must not run before the bound'); },
  });
  const oversizedSymbols = new Array(4_097);
  Object.defineProperty(oversizedSymbols, '0', {
    enumerable: true,
    configurable: true,
    get() { traps += 1; throw new Error('symbol accessor must not run before the bound'); },
  });
  const oversizedRoot = { ...focusSnapshot() };
  Object.defineProperty(oversizedRoot, 'extra', {
    enumerable: true,
    configurable: true,
    get() { traps += 1; throw new Error('root accessor must not run before the key bound'); },
  });
  const hostile = [
    statefulRoot,
    revokedRoot.proxy,
    focusSnapshot({ openSymbols: statefulSymbols }),
    focusSnapshot({ reasonCodes: revokedReasons.proxy }),
    focusSnapshot({ reasonCodes: oversizedReasons }),
    focusSnapshot({ openSymbols: oversizedSymbols }),
    oversizedRoot,
  ];
  for (const snapshot of hostile) {
    let result;
    assert.doesNotThrow(() => { result = engine.applyObservedOrderFocus(snapshot); });
    assert.equal(result.status, 'REJECTED_INVALID');
  }
  assert.equal(traps, 0);

  const positiveZero = focusSnapshot({ observedAtMs: 0, validUntilMs: 0, openSymbols: [] });
  const negativeObserved = { ...positiveZero, observedAtMs: -0 };
  const negativeValidUntil = { ...positiveZero, validUntilMs: -0 };
  assert.equal(observedOrderFocusFingerprint(positiveZero), observedOrderFocusFingerprint(negativeObserved));
  assert.equal(observedOrderFocusFingerprint(positiveZero), observedOrderFocusFingerprint(negativeValidUntil));
  assert.equal(engine.applyObservedOrderFocus(negativeObserved).status, 'REJECTED_INVALID');
  assert.equal(engine.applyObservedOrderFocus(negativeValidUntil).status, 'REJECTED_INVALID');
  assert.equal(engine.applyObservedOrderFocus(positiveZero).status, 'APPLIED');
  assert.ok(Object.is(engine.focusMgr.observedOrderCut().observedAtMs, 0));
  assert.equal(Object.is(engine.focusMgr.observedOrderCut().observedAtMs, -0), false);

  const invalidClock = new DualClock(0);
  const invalidClockEngine = volumeEngine(invalidClock);
  const eventsBefore = invalidClockEngine.memSink.count();
  const focusBefore = invalidClockEngine.focusMgr.observedOrderCut();
  invalidClock.set(-0);
  assert.equal(invalidClockEngine.applyObservedOrderFocus(positiveZero).status, 'REJECTED_INVALID');
  assert.equal(invalidClockEngine.restoreObservedOrderFocus(positiveZero).status, 'REJECTED_INVALID');
  assert.deepEqual(invalidClockEngine.focusMgr.observedOrderCut(), focusBefore);
  assert.deepEqual(invalidClockEngine.focusMgr.observedOpenOrderSymbols(), []);
  assert.equal(invalidClockEngine.memSink.count(), eventsBefore);

  for (const method of ['applyObservedOrderFocus', 'restoreObservedOrderFocus']) {
    const scriptedClock = new ScriptedClock(0);
    const scriptedEngine = volumeEngine(scriptedClock);
    scriptedClock.setScript([0, -0]);
    const result = scriptedEngine[method](focusSnapshot({
      observedAtMs: 0,
      validUntilMs: 0,
      openSymbols: ['BTCUSDT'],
    }));
    assert.equal(result.status, 'APPLIED');
    assert.equal(scriptedClock.reads, 1, `${method} must reuse its validated clock cut`);
    const session = scriptedEngine.focusMgr.focusSessions().find((item) => item.symbol === 'BTCUSDT');
    assert.ok(session.correlationId.startsWith('vs_0_'));
    assert.equal(scriptedEngine.memSink.byKind('focus_opened').some((event) => Object.is(event.ts, -0)), false);
    assert.equal(scriptedEngine.memSink.byKind('focus_opened').every((event) => Object.is(event.ts, 0)), true);
  }

  const universeClock = new ScriptedClock(0);
  const universeEngine = new VolumeEngine(universeClock, {
    focusSoftCap: 2,
    focusHardCap: 3,
    focusMaxAgeMs: 60_000,
  });
  universeEngine.start();
  universeEngine.setUniverse([]);
  assert.equal(universeEngine.applyObservedOrderFocus(focusSnapshot({
    observedAtMs: 0,
    validUntilMs: 1_000,
    openSymbols: ['BTCUSDT'],
  })).status, 'APPLIED');
  assert.deepEqual(universeEngine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  assert.deepEqual(universeEngine.focusMgr.focusSessions(), []);
  const universeEventsBefore = universeEngine.memSink.count();
  const universeProposalsBefore = structuredClone(universeEngine.proposalStore.all());
  const universeFeaturesBefore = [...universeEngine.features.symbols()];
  universeClock.set(-0);
  universeClock.setScript([]);
  assert.throws(() => universeEngine.setUniverse([symbolMeta('BTCUSDT')]), TypeError);
  assert.equal(universeClock.reads, 1);
  assert.deepEqual(universeEngine.proposalStore.all(), universeProposalsBefore);
  assert.deepEqual(universeEngine.features.symbols(), universeFeaturesBefore);
  assert.deepEqual(universeEngine.focusMgr.focusSessions(), []);
  assert.deepEqual(universeEngine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  assert.equal(universeEngine.memSink.count(), universeEventsBefore);

  universeClock.setScript([0, -0]);
  universeEngine.setUniverse([symbolMeta('BTCUSDT')]);
  assert.equal(universeClock.reads, 1, 'setUniverse must reuse one clock cut across every mutation and event');
  const universeSession = universeEngine.focusMgr.focusSessions().find((item) => item.symbol === 'BTCUSDT');
  assert.ok(universeSession.correlationId.startsWith('vs_0_'));
  assert.equal(universeEngine.memSink.all().some((event) => Object.is(event.ts, -0)), false);
});

test('partial, stale, public, unknown-status, and conflicting truth can never clear orders', () => {
  const cases = [
    evidence([], { completeness: 'PARTIAL' }),
    evidence([], { sourceTimeMs: NOW - 2_000, receivedAtMs: NOW - 2_000, maxAgeMs: 1_000 }),
    evidence([], { authority: 'LIVE_PUBLIC' }),
    evidence([order('BTCUSDT', 'UNKNOWN', 1)]),
    evidence([
      order('BTCUSDT', 'NEW', 1),
      order('ETHUSDT', 'NEW', 2, { clientOrderId: 'client-1' }),
    ]),
    evidence([order('btc/usdt', 'NEW', 1)]),
  ];
  const reasonSets = cases.map((input) => {
    const projected = projectObservedOrderFocus(normalizeObservedEvidence(input, NOW));
    assert.equal(projected.state, 'UNAVAILABLE');
    assert.equal(projected.openSymbols, null);
    assert.equal(projected.validUntilMs, null);
    assert.ok(projected.reasonCodes.length > 0);
    return projected.reasonCodes;
  });
  assert.ok(reasonSets[0].includes('OPEN_ORDER_TRUTH_NOT_COMPLETE'));
  assert.ok(reasonSets[1].includes('OPEN_ORDER_TRUTH_STALE'));
  assert.ok(reasonSets[2].includes('OPEN_ORDER_PRIVATE_AUTHORITY_REQUIRED'));
  assert.ok(reasonSets[3].includes('OPEN_ORDER_STATUS_UNKNOWN'));
  assert.ok(reasonSets[4].includes('OPEN_ORDER_IDENTITY_CONFLICT'));
  assert.ok(reasonSets[5].includes('OPEN_ORDER_SYMBOL_INVALID'));
});

test('projection rejects nested caller code before traps, getters, or coercion and never applies it', () => {
  const normalized = normalizeObservedEvidence(evidence([order('BTCUSDT', 'NEW', 1)]), NOW);
  let proxyTraps = 0;
  const hostileProxy = (target) => new Proxy(target, {
    get() { proxyTraps += 1; throw new Error('proxy get must not run'); },
    getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('proxy descriptor must not run'); },
    ownKeys() { proxyTraps += 1; throw new Error('proxy keys must not run'); },
    getPrototypeOf() { proxyTraps += 1; throw new Error('proxy prototype must not run'); },
  });
  const topProxy = hostileProxy(normalized);
  const nestedProxy = {
    ...normalized,
    orders: hostileProxy(normalized.orders),
  };

  let getterReads = 0;
  const accessorRoot = { ...normalized };
  Object.defineProperty(accessorRoot, 'evaluatedAtMs', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('root getter must not run'); },
  });
  const accessorMetadata = { ...normalized.orders.metadata };
  Object.defineProperty(accessorMetadata, 'sourceId', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('metadata getter must not run'); },
  });
  const accessorEvidence = {
    ...normalized,
    orders: { ...normalized.orders, metadata: accessorMetadata },
  };

  let coercions = 0;
  const coercionEvidence = {
    ...normalized,
    orders: {
      ...normalized.orders,
      metadata: {
        ...normalized.orders.metadata,
        sourceId: {
          toString() { coercions += 1; throw new Error('toString must not run'); },
          valueOf() { coercions += 1; throw new Error('valueOf must not run'); },
        },
      },
    },
  };
  const forgedConflictingEvidence = {
    ...normalized,
    orders: {
      ...normalized.orders,
      records: [
        order('BTCUSDT', 'FILLED', 1, {
          clientOrderId: 'duplicate-client',
          venueOrderId: 'venue-btc',
        }),
        order('ETHUSDT', 'FILLED', 2, {
          clientOrderId: 'duplicate-client',
          venueOrderId: 'venue-eth',
        }),
      ],
    },
    issues: [],
  };

  const hostileCuts = [
    topProxy,
    nestedProxy,
    accessorRoot,
    accessorEvidence,
    coercionEvidence,
    forgedConflictingEvidence,
  ];
  for (const hostile of hostileCuts) {
    assert.throws(() => projectObservedOrderFocus(hostile), TypeError);
  }
  assert.equal(proxyTraps, 0);
  assert.equal(getterReads, 0);
  assert.equal(coercions, 0);

  let applications = 0;
  const runtime = {
    applyObservedOrderFocus() {
      applications += 1;
      throw new Error('hostile evidence must never reach Volume');
    },
  };
  for (const hostile of hostileCuts) {
    const result = createProductionObservedOrderFocusPort({
      clock: new DualClock(),
      runtime,
      owner: { readNormalizedObservedEvidence: () => hostile },
    }).readAndApplyCachedEvidence();
    assert.equal(result.state, 'INPUT_REJECTED');
    assert.deepEqual(result.reasonCodes, ['OBSERVED_ORDER_FOCUS_PROJECTION_FAILED']);
  }
  assert.equal(applications, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(getterReads, 0);
  assert.equal(coercions, 0);

  const protectedClock = new DualClock();
  const protectedEngine = volumeEngine(protectedClock);
  assert.equal(protectedEngine.applyObservedOrderFocus(focusSnapshot()).status, 'APPLIED');
  const forgedResult = createProductionObservedOrderFocusPort({
    clock: protectedClock,
    runtime: strategyPort(protectedEngine),
    owner: { readNormalizedObservedEvidence: () => forgedConflictingEvidence },
  }).readAndApplyCachedEvidence();
  assert.equal(forgedResult.state, 'INPUT_REJECTED');
  assert.deepEqual(protectedEngine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  assert.equal(protectedEngine.focusMgr.isFocused('BTCUSDT'), true);
});

test('durable high-water survives restart, known-empty cuts, expiry, and older replay', () => {
  const clock = new DualClock();
  const ledger = new BoundedInMemoryLedger(clock);
  const persistence = createObservedOrderFocusPersistence(ledger);
  const firstEngine = volumeEngine(clock);
  const first = new DurableObservedOrderFocusCoordinator(clock, persistence, strategyPort(firstEngine));

  const initial = focusSnapshot();
  const empty = persistence.read();
  assert.equal(persistence.compareAndSet(empty, initial, -0).state, 'UNAVAILABLE');
  assert.equal(ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY), null);
  assert.equal(ledger.countEvents('volume.observed_order_focus'), 0);
  assert.equal(first.apply(initial).status, 'APPLIED');
  assert.deepEqual(firstEngine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  assert.equal(ledger.countEvents('volume.observed_order_focus'), 1);
  assert.equal(JSON.parse(ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY)).revision, 1);

  assert.equal(first.apply(structuredClone(initial)).status, 'IDEMPOTENT');
  assert.equal(ledger.countEvents('volume.observed_order_focus'), 1, 'exact replay must not rewrite durability');

  const restartedEngine = volumeEngine(clock);
  const restarted = new DurableObservedOrderFocusCoordinator(clock, persistence, strategyPort(restartedEngine));
  const restoration = restarted.restore();
  assert.equal(restoration.state, 'RESTORED');
  assert.deepEqual(restartedEngine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  assert.equal(restartedEngine.focusMgr.isFocused('BTCUSDT'), true);
  const retained = restarted.apply(unavailableSnapshot());
  assert.equal(retained.status, 'UNAVAILABLE_RETAINED');
  assert.deepEqual(restartedEngine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  assert.equal(restartedEngine.focusMgr.isFocused('BTCUSDT'), true);

  clock.set(NOW + 100);
  const knownEmpty = focusSnapshot({
    observedAtMs: NOW + 100,
    validUntilMs: NOW + 1_000,
    openSymbols: [],
  });
  assert.equal(restarted.apply(knownEmpty).status, 'APPLIED');
  assert.deepEqual(restartedEngine.focusMgr.observedOpenOrderSymbols(), []);
  assert.equal(ledger.countEvents('volume.observed_order_focus'), 2);
  assert.equal(JSON.parse(ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY)).revision, 2);

  const secondRestartEngine = volumeEngine(clock);
  const secondRestart = new DurableObservedOrderFocusCoordinator(
    clock, persistence, strategyPort(secondRestartEngine),
  );
  assert.equal(secondRestart.apply(structuredClone(knownEmpty)).status, 'IDEMPOTENT');
  assert.deepEqual(secondRestartEngine.focusMgr.observedOpenOrderSymbols(), []);
  assert.equal(secondRestart.apply(initial).status, 'REJECTED_NON_MONOTONIC');
  assert.deepEqual(secondRestartEngine.focusMgr.observedOpenOrderSymbols(), []);

  const durableBeforeExpiry = ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY);
  clock.set(NOW + 1_001);
  secondRestartEngine.tick();
  assert.equal(secondRestart.apply(initial).status, 'REJECTED_NON_MONOTONIC');
  assert.equal(ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY), durableBeforeExpiry);
  assert.deepEqual(secondRestartEngine.focusMgr.observedOpenOrderSymbols(), []);

  const zeroClock = new DualClock(0);
  const zeroLedger = new BoundedInMemoryLedger(zeroClock);
  const zeroPersistence = createObservedOrderFocusPersistence(zeroLedger);
  const zeroSnapshot = focusSnapshot({ observedAtMs: 0, validUntilMs: 0, openSymbols: [] });
  assert.equal(zeroPersistence.compareAndSet(zeroPersistence.read(), zeroSnapshot, 0).state, 'COMMITTED');
  const zeroEvent = zeroLedger.recentEvents(1, 'volume.observed_order_focus')[0];
  assert.equal(Object.is(zeroEvent.ts, 0), true);
  assert.equal(Object.is(zeroEvent.ts, -0), false);
  assert.equal(Object.is(zeroEvent.data.persistedAtMs, 0), true);
  assert.equal(Object.is(zeroEvent.data.persistedAtMs, -0), false);
});

test('corrupt persistence and stale-writer CAS conflicts fail closed before the requested cut mutates Volume', () => {
  const invalidClock = new DualClock(0);
  invalidClock.set(-0);
  const invalidCounts = { reads: 0, commits: 0, applies: 0, restores: 0, readbacks: 0 };
  const invalidCoordinator = new DurableObservedOrderFocusCoordinator(
    invalidClock,
    {
      read() {
        invalidCounts.reads += 1;
        return { state: 'EMPTY', raw: null, checkpoint: null };
      },
      compareAndSet() {
        invalidCounts.commits += 1;
        return { state: 'UNAVAILABLE', checkpoint: null };
      },
    },
    {
      applyObservedOrderFocus() { invalidCounts.applies += 1; throw new Error('must not apply'); },
      restoreObservedOrderFocus() { invalidCounts.restores += 1; throw new Error('must not restore'); },
      observedOrderFocusReadback() { invalidCounts.readbacks += 1; throw new Error('must not read back'); },
    },
  );
  assert.throws(() => invalidCoordinator.apply(focusSnapshot()), TypeError);
  assert.throws(() => invalidCoordinator.restore(), TypeError);
  assert.deepEqual(invalidCounts, { reads: 0, commits: 0, applies: 0, restores: 0, readbacks: 0 });

  let guardedReads = 0;
  let guardedCommits = 0;
  const guardedPersistence = createObservedOrderFocusPersistence({
    getConfigValue() { guardedReads += 1; return null; },
    compareAndSetConfigValueAndLogEvents() { guardedCommits += 1; throw new Error('must not commit'); },
  });
  assert.equal(guardedPersistence.compareAndSet(
    { state: 'EMPTY', raw: null, checkpoint: null }, focusSnapshot(), -0,
  ).state, 'UNAVAILABLE');
  assert.equal(guardedReads, 0);
  assert.equal(guardedCommits, 0);

  const corruptClock = new DualClock();
  const corruptLedger = new BoundedInMemoryLedger(corruptClock, {
    initialConfig: { [OBSERVED_ORDER_FOCUS_CONFIG_KEY]: '{}' },
  });
  const corruptEngine = volumeEngine(corruptClock);
  const corrupt = new DurableObservedOrderFocusCoordinator(
    corruptClock,
    createObservedOrderFocusPersistence(corruptLedger),
    strategyPort(corruptEngine),
  );
  const corruptResult = corrupt.apply(focusSnapshot());
  assert.equal(corruptResult.status, 'REJECTED_PERSISTENCE_CORRUPT');
  assert.deepEqual(corruptEngine.focusMgr.observedOpenOrderSymbols(), []);
  assert.equal(corruptLedger.countEvents('volume.observed_order_focus'), 0);

  const clock = new DualClock();
  const ledger = new BoundedInMemoryLedger(clock);
  const persistence = createObservedOrderFocusPersistence(ledger);
  const seedEngine = volumeEngine(clock);
  const seed = new DurableObservedOrderFocusCoordinator(clock, persistence, strategyPort(seedEngine));
  assert.equal(seed.apply(focusSnapshot()).status, 'APPLIED');
  const staleRead = persistence.read();
  assert.equal(staleRead.state, 'AVAILABLE');

  const competing = focusSnapshot({
    observedAtMs: NOW,
    validUntilMs: NOW + 1_000,
    openSymbols: ['ETHUSDT'],
  });
  assert.equal(persistence.compareAndSet(staleRead, competing, NOW).state, 'COMMITTED');

  let staleReads = 0;
  const stalePersistence = {
    read: () => (++staleReads === 1 ? staleRead : persistence.read()),
    compareAndSet: (expected, snapshot, persistedAtMs) =>
      persistence.compareAndSet(expected, snapshot, persistedAtMs),
  };
  const staleEngine = volumeEngine(clock);
  const staleWriter = new DurableObservedOrderFocusCoordinator(
    clock, stalePersistence, strategyPort(staleEngine),
  );
  const requested = focusSnapshot({
    observedAtMs: NOW + 100,
    validUntilMs: NOW + 1_100,
    openSymbols: ['SOLUSDT'],
  });
  const staleResult = staleWriter.apply(requested);
  assert.equal(staleResult.status, 'REJECTED_PERSISTENCE_CONFLICT');
  assert.deepEqual(staleEngine.focusMgr.observedOpenOrderSymbols(), ['ETHUSDT']);
  assert.deepEqual(JSON.parse(ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY)).snapshot.openSymbols, ['ETHUSDT']);
});

test('VolumeRuntime startup restores durable protection without an incoming owner cut and rejects corrupt state', async () => {
  const wallNow = Date.now();
  const clock = new DualClock(wallNow);
  const ledger = new BoundedInMemoryLedger(clock);
  const persistence = createObservedOrderFocusPersistence(ledger);
  const durable = focusSnapshot({
    observedAtMs: wallNow - 100,
    validUntilMs: wallNow + 60_000,
  });
  assert.equal(persistence.compareAndSet(persistence.read(), durable, wallNow).state, 'COMMITTED');
  const config = {
    killSwitch: true,
    maxOrderNotionalUsd: 10,
    minQuoteVolume24h: 3_000_000,
    allowedSymbols: [],
    blockedSymbols: [],
  };
  const runtime = new VolumeRuntime(ledger, () => config, () => []);
  await runtime.start();
  try {
    assert.deepEqual(runtime.engine.focusMgr.observedOpenOrderSymbols(), ['BTCUSDT']);
  } finally {
    runtime.stop();
  }

  const corruptLedger = new BoundedInMemoryLedger(clock, {
    initialConfig: { [OBSERVED_ORDER_FOCUS_CONFIG_KEY]: '{}' },
  });
  const corruptRuntime = new VolumeRuntime(corruptLedger, () => config, () => []);
  await assert.rejects(() => corruptRuntime.start(), /observed-order focus restore failed: CORRUPT/);
  assert.equal(corruptRuntime.connectionStatus().running, false);
});

test('production factory binds normalized Foundation evidence to the durable Volume seam without private transport', () => {
  const clock = new DualClock();
  const applications = [];
  const normalized = normalizeObservedEvidence(evidence([
    order('BTCUSDT', 'NEW', 1),
    order('ETHUSDT', 'FILLED', 2),
  ]), NOW);
  const market = {
    feeds: {}, pairCount: 0,
    async init() {}, start() {}, stop() {}, allRows() { return []; },
    priceUpdatedAt() { return null; }, markEventTimestamp() { return null; },
  };
  const basis = {
    async start() {}, stop() {},
    connectionStatus() { return { running: false, lastBookTs: null, lastMarkTs: null, lastError: null }; },
    integrationSnapshot() { return { lastTickTs: null, decisions: [], proposals: [] }; },
    setIntakePaused() { return true; }, intakePaused() { return false; },
  };
  const volume = {
    async start() {}, stop() {},
    connectionStatus() {
      return {
        running: false, streamState: 'starting', streamConnections: 0, openConnections: 0,
        lastBookTs: null, lastTradeTs: null,
      };
    },
    integrationSnapshot() { return { lastTickTs: null, decisions: [], proposals: [] }; },
    readProposalRiskCut() { return null; }, recordFoundationRiskResult() { return false; },
    setIntakePaused() { return true; }, intakePaused() { return false; },
    applyObservedOrderFocus(snapshot) {
      applications.push(structuredClone(snapshot));
      return {
        status: 'APPLIED', applied: true,
        focusedOpenSymbols: [...snapshot.openSymbols], unfocusedOpenSymbols: [], untrackedOpenSymbols: [],
        reasonCodes: [],
      };
    },
  };
  const owner = {
    readNormalizedObservedEvidence(evaluatedAtMs) {
      assert.equal(evaluatedAtMs, NOW);
      return normalized;
    },
  };
  const configured = createProductionSystemIntegrationPorts({ clock, market, basis, volume, observedOrderFocusEvidenceOwner: owner });
  const applied = configured.observedOrderFocus.readAndApplyCachedEvidence();
  assert.equal(applied.state, 'APPLIED');
  assert.deepEqual(applications[0].openSymbols, ['BTCUSDT']);
  assert.equal(JSON.stringify(applications[0]).includes('client-1'), false);
  assert.equal(JSON.stringify(applications[0]).includes('venue-1'), false);

  const unconfigured = createProductionSystemIntegrationPorts({ clock, market, basis, volume });
  const before = applications.length;
  const unavailable = unconfigured.observedOrderFocus.readAndApplyCachedEvidence();
  assert.equal(unavailable.state, 'NOT_CONFIGURED');
  assert.equal(applications.length, before);

  const mismatched = createProductionObservedOrderFocusPort({
    clock,
    runtime: volume,
    owner: { readNormalizedObservedEvidence: () => ({ ...normalized, evaluatedAtMs: NOW - 1 }) },
  }).readAndApplyCachedEvidence();
  assert.equal(mismatched.state, 'INPUT_REJECTED');
  assert.ok(mismatched.reasonCodes.includes('OBSERVED_ORDER_FOCUS_EVIDENCE_CUT_MISMATCH'));
  assert.equal(applications.length, before);

  const invalidClock = new DualClock(0);
  invalidClock.set(-0);
  let invalidOwnerReads = 0;
  let invalidApplications = 0;
  const invalidPort = createProductionObservedOrderFocusPort({
    clock: invalidClock,
    runtime: { applyObservedOrderFocus() { invalidApplications += 1; throw new Error('must not apply'); } },
    owner: { readNormalizedObservedEvidence() { invalidOwnerReads += 1; throw new Error('must not read'); } },
  });
  assert.throws(() => invalidPort.readAndApplyCachedEvidence(), TypeError);
  assert.equal(invalidOwnerReads, 0);
  assert.equal(invalidApplications, 0);

  const zeroInput = evidence([]);
  for (const collection of ['orders', 'fills', 'positions']) {
    zeroInput[collection].metadata.sourceTimeMs = 0;
    zeroInput[collection].metadata.receivedAtMs = 0;
  }
  const zeroNormalized = normalizeObservedEvidence(zeroInput, 0);
  const zeroReads = [];
  const zeroApplications = [];
  const zeroPort = createProductionObservedOrderFocusPort({
    clock: new DualClock(0),
    runtime: {
      applyObservedOrderFocus(snapshot) {
        zeroApplications.push(snapshot);
        return {
          status: 'APPLIED', applied: true,
          focusedOpenSymbols: [], unfocusedOpenSymbols: [], untrackedOpenSymbols: [], reasonCodes: [],
        };
      },
    },
    owner: {
      readNormalizedObservedEvidence(evaluatedAtMs) {
        zeroReads.push(evaluatedAtMs);
        return zeroNormalized;
      },
    },
  });
  assert.equal(zeroPort.readAndApplyCachedEvidence().state, 'APPLIED');
  assert.equal(zeroReads.length, 1);
  assert.equal(Object.is(zeroReads[0], 0), true);
  assert.equal(Object.is(zeroReads[0], -0), false);
  assert.equal(zeroApplications.length, 1);
  assert.equal(Object.is(zeroApplications[0].observedAtMs, 0), true);
  assert.equal(Object.is(zeroApplications[0].observedAtMs, -0), false);
});
