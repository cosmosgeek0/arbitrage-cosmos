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
});

test('durable high-water survives restart, known-empty cuts, expiry, and older replay', () => {
  const clock = new DualClock();
  const ledger = new BoundedInMemoryLedger(clock);
  const persistence = createObservedOrderFocusPersistence(ledger);
  const firstEngine = volumeEngine(clock);
  const first = new DurableObservedOrderFocusCoordinator(clock, persistence, strategyPort(firstEngine));

  const initial = focusSnapshot();
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
});

test('corrupt persistence and stale-writer CAS conflicts fail closed before the requested cut mutates Volume', () => {
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
});
