import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PRODUCTION_SOURCE_REGISTRY_RECORDS,
  createProductionSystemIntegrationPorts,
  validateProductionSourceRegistryRecords,
} from '../../../dist/systemIntegration/production/index.js';
import {
  SourceObservationTracker,
} from '../../../dist/systemIntegration/production/temporal.js';
import {
  defaultApplicationSummaries,
  mergeApplicationSummaries,
} from '../../../dist/systemIntegration/application/projection.js';
import {
  createEmptyCapitalCheckpointState,
  projectRestartSafety,
} from '../../../dist/capitalFoundation/checkpoint/index.js';

const START = Date.UTC(2026, 6, 12, 12, 0, 0);

class ManualClock {
  constructor(now = START) {
    this.now = now;
  }

  nowMs() {
    return this.now;
  }
}

function decision(kind, ts, suffix) {
  return {
    symbol: 'BTCUSDT',
    ts,
    strategy: suffix.startsWith('basis') ? 'basis' : 'volume_spike',
    kind,
    rejectCode: kind === 'reject' ? 'data_stale' : null,
    humanReason: `exact-${suffix}`,
    correlationId: `corr-${suffix}`,
    evidence: { exact: true },
  };
}

function proposal(strategy, ts, suffix) {
  return {
    id: `proposal-${suffix}`,
    correlationId: `corr-${suffix}`,
    strategy,
    symbol: 'BTCUSDT',
    direction: strategy === 'basis' ? 'long_spot_short_perp' : 'long',
    createdTs: ts,
    updatedTs: ts,
    status: 'open',
    reason: 'owner supplied',
    grossEdgePct: 1,
    netEdgePct: 0.5,
    fundingAdjPct: 0,
    borrowRequired: false,
    borrowStatus: 'not_needed',
    suggestedNotionalUsd: 100,
    confidence: 0.8,
    invalidation: null,
    evidence: { exact: true },
  };
}

function capitalSummaryCut(projection) {
  return Object.freeze({
    availability: 'AVAILABLE',
    checkpoint: Object.freeze({
      id: projection.checkpointId,
      revision: projection.checkpointState.revision,
    }),
    safety: Object.freeze({
      canOpenOrIncrease: projection.safety.canOpenOrIncrease,
      supervisionContinues: projection.safety.supervisionContinues,
      visiblePositionIds: Object.freeze([...projection.safety.visiblePositionIds]),
      recoveryRequiredPositionIds: Object.freeze([...projection.safety.recoveryRequiredPositionIds]),
      effectiveActiveReservationIds: Object.freeze([...projection.safety.effectiveActiveReservationIds]),
      reasonCodes: Object.freeze([...projection.safety.reasonCodes]),
    }),
  });
}

function createWorld({ capitalSummary, intelligenceEvidenceMaximumBytes } = {}) {
  const clock = new ManualClock();
  const calls = {
    marketInit: 0,
    marketStart: 0,
    marketStop: 0,
    basisStart: 0,
    basisStop: 0,
    volumeStart: 0,
    volumeStop: 0,
  };
  const spot = new Map();
  const usdm = new Map();
  const market = {
    feeds: {},
    pairCount: 0,
    rows: [],
    async init() { calls.marketInit += 1; },
    start() { calls.marketStart += 1; },
    stop() { calls.marketStop += 1; },
    allRows() { return this.rows; },
    priceUpdatedAt(symbol) { return spot.get(symbol) ?? null; },
    markEventTimestamp(symbol) { return usdm.get(symbol) ?? null; },
  };
  const basisStatus = {
    running: false,
    lastBookTs: null,
    lastMarkTs: null,
    lastError: null,
  };
  const basisSnapshot = {
    capturedAtMs: START + 9_999_999,
    lastTickTs: null,
    decisions: [],
    proposals: [],
    ownerSummary: { candidateCount: 0, opportunityCount: 0, cooldownCount: 0 },
  };
  const basis = {
    async start() { calls.basisStart += 1; basisStatus.running = true; },
    stop() { calls.basisStop += 1; basisStatus.running = false; },
    connectionStatus() { return { ...basisStatus }; },
    integrationSnapshot() { return structuredClone(basisSnapshot); },
  };
  const volumeStatus = {
    running: false,
    streamState: 'starting',
    streamConnections: 0,
    openConnections: 0,
    lastBookTs: null,
    lastTradeTs: null,
  };
  const volumeSnapshot = {
    capturedAtMs: START + 9_999_999,
    lastTickTs: null,
    decisions: [],
    proposals: [],
    ownerSummary: { candidateCount: 0, opportunityCount: 0, cooldownCount: 0 },
  };
  let volumeEvidenceObserver = null;
  const volume = {
    async start() { calls.volumeStart += 1; volumeStatus.running = true; },
    stop() { calls.volumeStop += 1; volumeStatus.running = false; },
    connectionStatus() { return { ...volumeStatus }; },
    integrationSnapshot() { return structuredClone(volumeSnapshot); },
    setEvidenceObserver(observer) { volumeEvidenceObserver = observer; },
  };
  const ports = createProductionSystemIntegrationPorts({
    clock,
    market,
    basis,
    volume,
    capitalSummary,
    sourceMaxAgeMs: 10_000,
    ...(intelligenceEvidenceMaximumBytes === undefined
      ? {}
      : { intelligenceEvidenceMaximumBytes }),
  });
  const ctx = () => ({
    nowMs: clock.nowMs(),
    generation: 1,
    correlationId: 'production-test',
    runMode: 'INTELLIGENCE',
    privateKeysAvailable: false,
  });
  return {
    clock,
    calls,
    spot,
    usdm,
    market,
    basis,
    basisStatus,
    basisSnapshot,
    volume,
    volumeStatus,
    volumeSnapshot,
    emitVolumeEvidence(cut) {
      assert.equal(typeof volumeEvidenceObserver, 'function');
      volumeEvidenceObserver(structuredClone(cut));
    },
    ports,
    ctx,
  };
}

test('rejected Basis and Volume starts stop partial runtimes and preserve the startup error', async () => {
  const world = createWorld();
  const basisStartFailure = new Error('basis partial-start rejection');
  world.basis.start = async () => {
    world.calls.basisStart += 1;
    world.basisStatus.running = true;
    await Promise.resolve();
    throw basisStartFailure;
  };
  world.basis.stop = () => {
    world.calls.basisStop += 1;
    world.basisStatus.running = false;
    throw new Error('basis cleanup rejection');
  };

  await assert.rejects(
    world.ports.runtimes.basis.start(),
    (error) => error === basisStartFailure,
  );
  assert.equal(world.calls.basisStop, 1);
  assert.equal(world.basisStatus.running, false);

  const volumeStartFailure = new Error('volume partial-start rejection');
  world.volume.start = async () => {
    world.calls.volumeStart += 1;
    world.volumeStatus.running = true;
    await Promise.resolve();
    throw volumeStartFailure;
  };
  world.volume.stop = () => {
    world.calls.volumeStop += 1;
    world.volumeStatus.running = false;
  };

  await assert.rejects(
    world.ports.runtimes.volume.start(),
    (error) => error === volumeStartFailure,
  );
  assert.equal(world.calls.volumeStop, 1);
  assert.equal(world.volumeStatus.running, false);
});

async function startMarket(world) {
  await world.ports.runtimes.market.init();
  world.ports.runtimes.market.start();
}

function routingCapability(world, name) {
  const value = world.ports.intelligenceEvidence.readRoutingSnapshot().capabilities
    .find((entry) => entry.capability === name);
  assert.ok(value, `missing routing capability ${name}`);
  return value;
}

test('factory construction is inert and exposes only passive public source projections', () => {
  const world = createWorld();
  assert.deepEqual(world.calls, {
    marketInit: 0,
    marketStart: 0,
    marketStop: 0,
    basisStart: 0,
    basisStop: 0,
    volumeStart: 0,
    volumeStop: 0,
  });
  assert.deepEqual(Object.keys(world.ports.components).sort(), [
    'public-spot-source',
    'public-usdm-source',
    'q-inference',
  ]);
  const q = world.ports.components['q-inference'].readComponentSnapshot();
  assert.equal(q.readiness, 'STOPPED');
  assert.ok(q.releaseStatuses.includes('NOT_CONFIGURED'));
  assert.equal(world.ports.components['intelligence-runtime'], undefined);
  assert.equal(world.ports.components['market-intelligence'], undefined);
  assert.equal(world.ports.components['capital-supervision'], undefined);
  assert.equal(world.ports.sourceRegistry.records.length, 7);
  assert.equal(Object.isFrozen(world.ports.sourceRegistry), true);
  assert.deepEqual(
    world.ports.sourceRegistry.records.map((record) => record.semanticStream).sort(),
    PRODUCTION_SOURCE_REGISTRY_RECORDS.map((record) => record.semanticStream).sort(),
  );
});

test('production source admission rejects duplicate, incomplete, or counterfeit ownership before lifecycle use', () => {
  const clock = new ManualClock();
  const duplicate = [
    ...PRODUCTION_SOURCE_REGISTRY_RECORDS,
    { ...PRODUCTION_SOURCE_REGISTRY_RECORDS[6], sourceId: 'competing-usdm-liquidation' },
  ];
  const inert = {
    feeds: {}, pairCount: 0,
    async init() { throw new Error('must remain inert'); },
    start() { throw new Error('must remain inert'); },
    stop() { throw new Error('must remain inert'); },
    allRows() { return []; },
    priceUpdatedAt() { return null; },
    markEventTimestamp() { return null; },
  };
  const strategy = {
    async start() { throw new Error('must remain inert'); },
    stop() { throw new Error('must remain inert'); },
    connectionStatus() { throw new Error('must remain inert'); },
    integrationSnapshot() { throw new Error('must remain inert'); },
  };
  assert.throws(
    () => validateProductionSourceRegistryRecords(clock, duplicate),
    /DUPLICATE_SEMANTIC_PRODUCER/,
  );
  assert.throws(
    () => validateProductionSourceRegistryRecords(clock, PRODUCTION_SOURCE_REGISTRY_RECORDS.slice(0, -1)),
    /SOURCE_REGISTRY_INCOMPLETE/,
  );
  for (const mutation of [
    (row) => ({ ...row, endpointClass: 'REST' }),
    (row) => ({ ...row, consumers: ['engine-supervisor'] }),
    (row) => ({ ...row, physicalProducer: { ...row.physicalProducer, producerId: 'CounterfeitRuntime' } }),
    (row) => ({ ...row, physicalProducer: { ...row.physicalProducer, ownerPath: 'server/src/binance/liquidations.ts' } }),
  ]) {
    const counterfeit = structuredClone(PRODUCTION_SOURCE_REGISTRY_RECORDS);
    counterfeit[6] = mutation(counterfeit[6]);
    assert.throws(
      () => validateProductionSourceRegistryRecords(clock, counterfeit),
      /SOURCE_REGISTRY_CANONICAL_MISMATCH/,
    );
  }
  const input = { clock, market: inert, basis: strategy, volume: strategy };
  const ignoredLegacyOverride = createProductionSystemIntegrationPorts({
    ...input,
    sourceRegistryRecords: duplicate,
  });
  assert.deepEqual(ignoredLegacyOverride.sourceRegistry.records, PRODUCTION_SOURCE_REGISTRY_RECORDS);
});

test('empty uninitialized market cannot claim source or universe readiness', async () => {
  const world = createWorld();
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';

  const spot = world.ports.components['public-spot-source'].readComponentSnapshot();
  const usdm = world.ports.components['public-usdm-source'].readComponentSnapshot();
  const health = world.ports.runtimes.market.health(world.ctx());
  assert.equal(spot.truthLabel, 'UNAVAILABLE');
  assert.equal(spot.readiness, 'WARMING');
  assert.equal(usdm.truthLabel, 'UNAVAILABLE');
  assert.equal(health.timestamp, null);
  assert.equal(world.ports.summaries.readSupervisorSummaries().sourceCoverage.universeSymbols, 0);
});

test('public Spot and USD-M become LIVE_PUBLIC only with connected fresh raw events', async () => {
  const world = createWorld();
  world.market.rows = [{ symbol: 'BTCUSDT', hasSpot: true, hasPerp: true }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);

  const spot = world.ports.components['public-spot-source'].readComponentSnapshot();
  const usdm = world.ports.components['public-usdm-source'].readComponentSnapshot();
  assert.equal(spot.truthLabel, 'LIVE_PUBLIC');
  assert.equal(spot.readiness, 'READY');
  assert.equal(spot.sourceTimestamp.sourceTimeMs, START - 250);
  assert.equal(spot.sourceTimestamp.receivedAtMs, START);
  assert.equal(spot.freshness.state, 'FRESH');
  assert.equal(usdm.truthLabel, 'LIVE_PUBLIC');
  assert.equal(usdm.sourceTimestamp.sourceTimeMs, START - 200);
  assert.ok(spot.releaseStatuses.includes('LIVE_PUBLIC'));
  assert.ok(usdm.releaseStatuses.includes('LIVE_PUBLIC'));

  const source = world.ports.summaries.readSupervisorSummaries().sourceCoverage;
  assert.deepEqual(
    [source.truthLabel, source.universeSymbols, source.spotCoveredSymbols, source.usdMCoveredSymbols],
    ['LIVE_PUBLIC', 1, 1, 1],
  );
});

test('accepted public owners drive UniverseGraph and IntelligenceRuntimeBridge readiness without Q', async () => {
  const world = createWorld();
  const originalAllRows = world.market.allRows;
  const originalPriceUpdatedAt = world.market.priceUpdatedAt;
  const originalMarkEventTimestamp = world.market.markEventTimestamp;
  let allRowsReads = 0;
  let priceTimestampReads = 0;
  let markTimestampReads = 0;
  world.market.allRows = function countedAllRows() {
    allRowsReads += 1;
    return originalAllRows.call(this);
  };
  world.market.priceUpdatedAt = function countedPriceUpdatedAt(symbol) {
    priceTimestampReads += 1;
    return originalPriceUpdatedAt.call(this, symbol);
  };
  world.market.markEventTimestamp = function countedMarkEventTimestamp(symbol) {
    markTimestampReads += 1;
    return originalMarkEventTimestamp.call(this, symbol);
  };
  world.market.rows = [{
    symbol: 'BTCUSDT',
    base: 'BTC',
    hasSpot: true,
    hasPerp: true,
    perpMark: 60_000,
    perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);

  await world.ports.runtimes.intelligenceRuntime.start();
  const universe = world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  assert.equal(universe.running, true);
  assert.equal(universe.timestamp.sourceTimeMs, START - 250);
  assert.equal(allRowsReads, 2);
  assert.equal(priceTimestampReads, 2);
  assert.equal(markTimestampReads, 2);

  await world.ports.runtimes.marketIntelligence.start();
  const intelligence = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(intelligence.running, true);
  assert.equal(intelligence.timestamp.sourceTimeMs, START - 200);
  const focusReadback = world.ports.attentionFocus.readFocusState('BTCUSDT');
  assert.equal(focusReadback.canPin, true, JSON.stringify(focusReadback));
  assert.equal(focusReadback.effectivePinned, false);
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', true), true);
  assert.deepEqual(world.ports.attentionFocus.readPinnedSymbols(), ['BTCUSDT']);
  assert.equal(world.ports.attentionFocus.readFocusState('BTCUSDT').effectivePinned, true);
  await world.ports.runtimes.q.start();
  assert.equal(world.ports.runtimes.q.health(world.ctx()).fatal.code, 'CHAMPION_UNAVAILABLE');

  world.clock.now = START + 1_000;
  world.spot.set('BTCUSDT', START + 900);
  world.usdm.set('BTCUSDT', START + 950);
  const held = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(held.timestamp.sourceTimeMs, START - 200);
  assert.equal(allRowsReads, 4);

  world.clock.now = START + 5_000;
  world.spot.set('BTCUSDT', START + 4_900);
  world.usdm.set('BTCUSDT', START + 4_950);
  const advanced = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(advanced.timestamp.sourceTimeMs, START + 4_950);
  assert.ok(advanced.timestamp.receivedAtMs >= intelligence.timestamp.receivedAtMs);
  assert.equal(allRowsReads, 5);

  world.clock.now = START + 14_951;
  const stale = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(stale.timestamp, null);
  assert.equal(allRowsReads, 6);
  const staleFocus = world.ports.attentionFocus.readFocusState('BTCUSDT');
  assert.equal(staleFocus.pinned, true);
  assert.equal(staleFocus.canPin, false);
  assert.equal(staleFocus.effectivePinned, null);
  assert.equal(staleFocus.effectiveTier, null);
  assert.throws(
    () => world.ports.attentionFocus.setPinned('BTCUSDT', true),
    /eligible symbol and available FOCUS capacity/,
  );
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', false), true);
  assert.deepEqual(world.ports.attentionFocus.readPinnedSymbols(), []);
  assert.equal(world.ports.attentionFocus.readFocusState('BTCUSDT').effectivePinned, false);
});

test('one production router projects current mark/funding and OI with fresh, missing, restart, and stale truth', async () => {
  const world = createWorld();
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
    fundingRate: 0.0001, nextFundingTime: START + 8 * 60 * 60_000,
    openInterest: 2_000, openInterestUsd: 120_000_000,
    openInterestChangePct: 1.2, openInterestUpdatedAt: START - 150,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());

  assert.equal(routingCapability(world, 'FUNDING').freshness, 'FRESH');
  assert.equal(routingCapability(world, 'OPEN_INTEREST').freshness, 'FRESH');
  const firstSources = world.ports.intelligenceEvidence.readRoutingSnapshot().sources;
  assert.ok(firstSources.some((entry) => entry.generation === 1 && entry.bootstrapped));

  world.market.feeds['futures-markprice'] = 'closed';
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  assert.equal(routingCapability(world, 'FUNDING').freshness, 'MISSING');
  assert.equal(routingCapability(world, 'OPEN_INTEREST').freshness, 'MISSING');

  world.clock.now = START + 5_000;
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START + 4_900);
  world.usdm.set('BTCUSDT', START + 4_950);
  world.market.rows[0].openInterestUpdatedAt = START + 4_940;
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  assert.equal(routingCapability(world, 'FUNDING').freshness, 'FRESH');
  assert.equal(routingCapability(world, 'OPEN_INTEREST').freshness, 'FRESH');

  world.clock.now = START + 10_000;
  world.spot.set('BTCUSDT', START + 9_900);
  world.usdm.set('BTCUSDT', START + 9_950);
  world.market.rows[0].openInterest = null;
  world.market.rows[0].openInterestUsd = null;
  world.market.rows[0].openInterestChangePct = null;
  world.market.rows[0].openInterestUpdatedAt = null;
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  assert.equal(routingCapability(world, 'FUNDING').freshness, 'FRESH');
  assert.equal(routingCapability(world, 'OPEN_INTEREST').freshness, 'MISSING');

  world.clock.now = START + 15_000;
  world.spot.set('BTCUSDT', START + 14_900);
  world.usdm.set('BTCUSDT', START + 14_950);
  world.market.rows[0].openInterest = 2_100;
  world.market.rows[0].openInterestUsd = 126_000_000;
  world.market.rows[0].openInterestChangePct = null;
  world.market.rows[0].openInterestUpdatedAt = START + 14_940;
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  assert.equal(routingCapability(world, 'OPEN_INTEREST').freshness, 'FRESH');

  world.clock.now = START + 25_001;
  assert.equal(routingCapability(world, 'FUNDING').freshness, 'STALE');
  assert.equal(routingCapability(world, 'OPEN_INTEREST').freshness, 'STALE');
});

test('partial canonical bootstrap cannot publish cached focus and recovers only after full duplicate reconciliation', async () => {
  // This bound is deliberately between the canonical current funding record
  // and the larger mark record below, forcing the real Bridge to accept one
  // immutable row and reject the other without a fabricated sink receipt.
  const world = createWorld({ intelligenceEvidenceMaximumBytes: 1_270 });
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
    fundingRate: 0.0001, nextFundingTime: START + 8 * 60 * 60_000,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();

  const runtimeHealth = world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  assert.notEqual(runtimeHealth.timestamp, null);
  const partialHealth = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(partialHealth.timestamp, null);
  let routing = world.ports.intelligenceEvidence.readRoutingSnapshot();
  assert.deepEqual([routing.routed, routing.duplicate, routing.rejected], [1, 0, 1]);
  const partialSource = routing.sources.find((entry) => entry.dataset === 'usd_m.mark_price');
  assert.deepEqual(
    [partialSource.generation, partialSource.revision, partialSource.closed, partialSource.bootstrapped],
    [1, 1, false, false],
  );
  assert.equal(routingCapability(world, 'FUNDING').freshness, 'MISSING');
  const cachedPlanFocus = world.ports.attentionFocus.readFocusState('BTCUSDT');
  assert.equal(cachedPlanFocus.canPin, false);
  assert.equal(cachedPlanFocus.attentionPlanId, null);
  assert.equal(cachedPlanFocus.effectiveTier, null);

  // Reconstruct at the same injected clock so the accepted funding row is an
  // exact Bridge duplicate. A smaller, new mark row supplies the missing cut;
  // only that complete duplicate+accepted reconciliation may republish health.
  world.ports.runtimes.marketIntelligence.stop();
  world.ports.runtimes.intelligenceRuntime.stop();
  world.market.rows[0].perpMark = 1;
  world.market.rows[0].perpIndexPrice = null;
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  const recoveredHealth = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(recoveredHealth.timestamp.sourceTimeMs, START - 200);

  routing = world.ports.intelligenceEvidence.readRoutingSnapshot();
  assert.deepEqual([routing.routed, routing.duplicate, routing.rejected], [2, 1, 1]);
  const recoveredSource = routing.sources.find((entry) => entry.dataset === 'usd_m.mark_price');
  assert.deepEqual(
    [recoveredSource.generation, recoveredSource.revision, recoveredSource.closed, recoveredSource.bootstrapped],
    [2, 1, false, true],
  );
  assert.equal(routingCapability(world, 'FUNDING').freshness, 'FRESH');
  const recoveredFocus = world.ports.attentionFocus.readFocusState('BTCUSDT');
  assert.equal(recoveredFocus.canPin, true);
  assert.notEqual(recoveredFocus.attentionPlanId, null);
});

test('production Volume owner publishes one lifecycle-bound trade source and delayed pre-close LIVE stays fenced', async () => {
  const world = createWorld();
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());

  const tradeCut = (generation, revision, id, continuity) => ({
    kind: 'SPOT_AGG_TRADE', generation, revision, receivedAtMs: START,
    continuity, baseAsset: 'BTC',
    raw: {
      e: 'aggTrade', E: START - 100 + id, T: START - 99 + id, s: 'BTCUSDT',
      a: id, f: id, l: id, p: '60000', q: '0.01', m: false,
    },
  });
  world.emitVolumeEvidence(tradeCut(1, 1, 1, 'UNKNOWN'));
  assert.equal(routingCapability(world, 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  world.emitVolumeEvidence(tradeCut(1, 2, 2, 'CONTIGUOUS'));
  assert.equal(
    routingCapability(world, 'ROLLING_ACTIVITY_FLOW').freshness,
    'FRESH',
    JSON.stringify(world.ports.intelligenceEvidence.readRoutingSnapshot()),
  );

  world.emitVolumeEvidence({ kind: 'SOURCE_CLOSED', generation: 1, revision: 3, observedAtMs: START });
  assert.equal(routingCapability(world, 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  world.emitVolumeEvidence(tradeCut(1, 4, 3, 'CONTIGUOUS'));
  const closed = world.ports.intelligenceEvidence.readRoutingSnapshot().sources
    .find((entry) => entry.dataset === 'spot.aggregate_trade');
  assert.deepEqual([closed.generation, closed.revision, closed.closed], [1, 3, true]);
  assert.equal(routingCapability(world, 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');

  world.emitVolumeEvidence(tradeCut(3, 1, 4, 'UNKNOWN'));
  assert.equal(routingCapability(world, 'ROLLING_ACTIVITY_FLOW').freshness, 'MISSING');
  world.emitVolumeEvidence(tradeCut(3, 2, 5, 'CONTIGUOUS'));
  assert.equal(routingCapability(world, 'ROLLING_ACTIVITY_FLOW').freshness, 'FRESH');
  const restarted = world.ports.intelligenceEvidence.readRoutingSnapshot().sources
    .find((entry) => entry.dataset === 'spot.aggregate_trade');
  assert.deepEqual([restarted.generation, restarted.revision, restarted.closed, restarted.bootstrapped], [3, 2, false, true]);
});

test('focus counts come from the canonical attention summary and disappear with owner truth', async () => {
  const world = createWorld();
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  world.ports.runtimes.intelligenceRuntime.health(world.ctx());
  await world.ports.runtimes.marketIntelligence.start();
  world.ports.runtimes.marketIntelligence.health(world.ctx());

  const broad = world.ports.summaries.readSupervisorSummaries().intelligence;
  assert.deepEqual([broad.truthLabel, broad.focusRequestedCount, broad.focusActiveCount], ['LIVE_PUBLIC', 0, 0]);
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', true), true);
  const focused = world.ports.summaries.readSupervisorSummaries().intelligence;
  assert.deepEqual([focused.focusRequestedCount, focused.focusActiveCount], [1, 1]);

  world.market.feeds['futures-markprice'] = 'closed';
  const unavailable = world.ports.summaries.readSupervisorSummaries().intelligence;
  assert.deepEqual(
    [unavailable.truthLabel, unavailable.focusRequestedCount, unavailable.focusActiveCount],
    ['UNAVAILABLE', null, null],
  );
});

test('market intelligence fails closed when USD-M disconnects with fresh cached evidence', async () => {
  const world = createWorld();
  world.market.rows = [{
    symbol: 'BTCUSDT',
    base: 'BTC',
    hasSpot: true,
    hasPerp: true,
    perpMark: 60_000,
    perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();

  assert.equal(
    world.ports.runtimes.marketIntelligence.health(world.ctx()).timestamp.sourceTimeMs,
    START - 200,
  );
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', true), true);
  assert.equal(world.ports.attentionFocus.readFocusState('BTCUSDT').effectivePinned, true);
  world.market.feeds['futures-markprice'] = 'closed';

  const disconnected = world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(disconnected.running, true);
  assert.equal(disconnected.timestamp, null);
  const disconnectedFocus = world.ports.attentionFocus.readFocusState('BTCUSDT');
  assert.equal(disconnectedFocus.pinned, true);
  assert.equal(disconnectedFocus.canPin, false);
  assert.equal(disconnectedFocus.effectivePinned, null);
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', false), true);
  assert.equal(world.ports.attentionFocus.readFocusState('BTCUSDT').effectivePinned, false);
  assert.equal(world.ports.runtimes.intelligenceRuntime.health(world.ctx()).timestamp.sourceTimeMs, START - 250);
});

test('focus readback becomes unavailable immediately when the intelligence owner stops', async () => {
  const world = createWorld();
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();
  world.ports.runtimes.marketIntelligence.health(world.ctx());
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', true), true);

  world.ports.runtimes.marketIntelligence.stop();
  const stopped = world.ports.attentionFocus.readFocusState('BTCUSDT');
  assert.equal(stopped.pinned, true);
  assert.equal(stopped.canPin, false);
  assert.equal(stopped.effectivePinned, null);
  assert.equal(stopped.attentionPlanId, null);
  assert.equal(world.ports.attentionFocus.setPinned('BTCUSDT', false), true);
  assert.equal(world.ports.attentionFocus.readFocusState('BTCUSDT').effectivePinned, false);
});

test('sibling intelligence probes share exactly one same-step refresh and never a later call', async () => {
  const world = createWorld();
  const originalAllRows = world.market.allRows;
  let allRowsReads = 0;
  world.market.allRows = function countedAllRows() {
    allRowsReads += 1;
    return originalAllRows.call(this);
  };
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();

  const sameStep = world.ctx();
  assert.equal(world.ports.runtimes.intelligenceRuntime.health(sameStep).timestamp.sourceTimeMs, START - 250);
  assert.equal(world.ports.runtimes.marketIntelligence.health(sameStep).timestamp.sourceTimeMs, START - 200);
  assert.equal(allRowsReads, 2);

  assert.equal(world.ports.runtimes.marketIntelligence.health(sameStep).timestamp.sourceTimeMs, START - 200);
  assert.equal(allRowsReads, 3);

  world.ports.runtimes.intelligenceRuntime.health(sameStep);
  const differentStep = { ...sameStep, correlationId: 'different-production-step' };
  assert.equal(world.ports.runtimes.marketIntelligence.health(differentStep).timestamp.sourceTimeMs, START - 200);
  assert.equal(allRowsReads, 5);

  world.ports.runtimes.intelligenceRuntime.stop();
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();
  assert.equal(world.ports.runtimes.marketIntelligence.health(sameStep).timestamp.sourceTimeMs, START - 200);
  assert.equal(allRowsReads, 6);
});

test('intelligence projection uses one supervisor-step clock for receipt and freshness truth', async () => {
  const world = createWorld();
  let clockReads = 0;
  world.clock.nowMs = () => START + clockReads++;
  world.market.rows = [{
    symbol: 'BTCUSDT',
    base: 'BTC',
    hasSpot: true,
    hasPerp: true,
    perpMark: 60_000,
    perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.market.feeds['futures-markprice'] = 'open';
  world.spot.set('BTCUSDT', START - 250);
  world.usdm.set('BTCUSDT', START - 200);
  await world.ports.runtimes.intelligenceRuntime.start();

  const ctx = world.ctx();
  const health = world.ports.runtimes.intelligenceRuntime.health(ctx);
  assert.equal(health.running, true);
  assert.equal(health.timestamp.sourceTimeMs, START - 250);
  assert.equal(health.timestamp.receivedAtMs, ctx.nowMs);
  assert.ok(clockReads > 1);
});

test('source observation tracker fails closed when a concurrent step regresses behind receipt time', () => {
  const tracker = new SourceObservationTracker();
  tracker.beginGeneration(null);
  const accepted = tracker.read(START - 100, START, 'public.test.source', 10_000);
  assert.equal(accepted.receivedAtMs, START);
  assert.equal(tracker.read(START - 100, START - 1, 'public.test.source', 10_000), null);
  const recovered = tracker.read(START - 100, START + 1, 'public.test.source', 10_000);
  assert.equal(recovered.receivedAtMs, START);
});

test('denied or disconnected public owners cannot admit intelligence readiness', async () => {
  const world = createWorld();
  world.market.rows = [{
    symbol: 'BTCUSDT', base: 'BTC', hasSpot: true, hasPerp: true,
    perpMark: 60_000, perpIndexPrice: 59_990,
  }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'closed';
  world.market.feeds['futures-markprice'] = 'closed';
  world.spot.set('BTCUSDT', START - 100);
  world.usdm.set('BTCUSDT', START - 90);
  await world.ports.runtimes.intelligenceRuntime.start();
  await world.ports.runtimes.marketIntelligence.start();
  assert.equal(world.ports.runtimes.intelligenceRuntime.health(world.ctx()).timestamp, null);
  assert.equal(world.ports.runtimes.marketIntelligence.health(world.ctx()).timestamp, null);
});

test('disconnected transport never emits READY or LIVE_PUBLIC despite a fresh cached event', async () => {
  const world = createWorld();
  world.market.rows = [{ symbol: 'BTCUSDT', hasSpot: true, hasPerp: true }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'closed';
  world.spot.set('BTCUSDT', START - 100);

  const source = world.ports.components['public-spot-source'].readComponentSnapshot();
  assert.equal(source.truthLabel, 'UNAVAILABLE');
  assert.equal(source.readiness, 'BLOCKED');
  assert.equal(source.releaseStatuses.includes('LIVE_PUBLIC'), false);
  assert.ok(source.blockerCodes.includes('SOURCE_TRANSPORT_DISCONNECTED'));
  assert.equal(world.ports.runtimes.market.health(world.ctx()).timestamp, null);
});

test('public retry cooldown and exhaustion remain explicit non-green source truth', async () => {
  const world = createWorld();
  world.market.rows = [{ symbol: 'BTCUSDT', hasSpot: true, hasPerp: true }];
  await startMarket(world);
  world.spot.set('BTCUSDT', START - 100);

  world.market.feeds['spot-miniticker'] = 'cooldown';
  const coolingDown = world.ports.components['public-spot-source'].readComponentSnapshot();
  assert.equal(coolingDown.domainObservedState, 'COOLDOWN');
  assert.equal(coolingDown.sourceLifecycle, 'BACKING_OFF');
  assert.equal(coolingDown.readiness, 'BLOCKED');
  assert.ok(coolingDown.blockerCodes.includes('SOURCE_TRANSPORT_COOLDOWN'));
  assert.equal(coolingDown.releaseStatuses.includes('LIVE_PUBLIC'), false);

  world.market.feeds['spot-miniticker'] = 'exhausted';
  world.clock.now = START + 20_000;
  const exhausted = world.ports.components['public-spot-source'].readComponentSnapshot();
  assert.equal(exhausted.domainObservedState, 'EXHAUSTED');
  assert.equal(exhausted.sourceLifecycle, 'FAILED');
  assert.equal(exhausted.readiness, 'BLOCKED');
  assert.ok(exhausted.blockerCodes.includes('SOURCE_RETRY_BUDGET_EXHAUSTED'));
  assert.equal(exhausted.blockerCodes.includes('SOURCE_TRANSPORT_DISCONNECTED'), false);
  assert.equal(exhausted.releaseStatuses.includes('LIVE_PUBLIC'), false);
});

test('stale source evidence remains visible but is downgraded from live authority', async () => {
  const world = createWorld();
  world.market.rows = [{ symbol: 'BTCUSDT', hasSpot: true, hasPerp: false }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.spot.set('BTCUSDT', START - 10_001);

  const source = world.ports.components['public-spot-source'].readComponentSnapshot();
  assert.equal(source.truthLabel, 'UNAVAILABLE');
  assert.equal(source.authority, 'UNAVAILABLE');
  assert.equal(source.freshness.state, 'STALE');
  assert.equal(source.sourceTimestamp.sourceTimeMs, START - 10_001);
  assert.ok(source.blockerCodes.includes('SOURCE_STALE'));
});

test('future-skewed source evidence fails closed and never receives a live release status', async () => {
  const world = createWorld();
  world.market.rows = [{ symbol: 'BTCUSDT', hasSpot: true, hasPerp: false }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.spot.set('BTCUSDT', START + 2_001);

  const source = world.ports.components['public-spot-source'].readComponentSnapshot();
  assert.equal(source.truthLabel, 'UNAVAILABLE');
  assert.equal(source.readiness, 'BLOCKED');
  assert.equal(source.freshness.state, 'CLOCK_SKEWED');
  assert.equal(source.releaseStatuses.includes('LIVE_PUBLIC'), false);
  assert.ok(source.blockerCodes.includes('SOURCE_CLOCK_SKEWED'));
});

test('restart ownership calls each existing runtime once and requires post-restart source progress', async () => {
  const world = createWorld();
  world.market.rows = [{ symbol: 'BTCUSDT', hasSpot: true, hasPerp: true }];
  await startMarket(world);
  world.market.feeds['spot-miniticker'] = 'open';
  world.spot.set('BTCUSDT', START - 100);
  assert.equal(world.ports.components['public-spot-source'].readComponentSnapshot().truthLabel, 'LIVE_PUBLIC');

  world.ports.runtimes.market.stop();
  world.ports.runtimes.market.start();
  assert.equal(world.ports.components['public-spot-source'].readComponentSnapshot().truthLabel, 'UNAVAILABLE');
  world.spot.set('BTCUSDT', START - 50);
  const restarted = world.ports.components['public-spot-source'].readComponentSnapshot();
  assert.equal(restarted.truthLabel, 'LIVE_PUBLIC');
  assert.equal(restarted.generation, 2);
  assert.equal(restarted.restartCount, 1);

  await world.ports.runtimes.basis.start();
  await world.ports.runtimes.volume.start();
  world.ports.runtimes.volume.stop();
  world.ports.runtimes.basis.stop();
  assert.deepEqual(world.calls, {
    marketInit: 1,
    marketStart: 2,
    marketStop: 1,
    basisStart: 1,
    basisStop: 1,
    volumeStart: 1,
    volumeStop: 1,
  });
});

test('Basis health uses book receipt and raw mark event, never capturedAt', async () => {
  const world = createWorld();
  await world.ports.runtimes.basis.start();
  world.basisStatus.lastBookTs = START - 100;
  world.basisStatus.lastMarkTs = START - 200;
  world.basisSnapshot.capturedAtMs = START + 50_000;

  const health = world.ports.runtimes.basis.health(world.ctx());
  assert.equal(health.running, true);
  assert.equal(health.timestamp.sourceTimeMs, START - 200);
  assert.equal(health.timestamp.receivedAtMs, START);

  world.clock.now = START + 10_000;
  const stale = world.ports.runtimes.basis.health(world.ctx());
  assert.equal(stale.timestamp.sourceTimeMs, START - 200);
});

test('Volume health requires all owned trade transports open and fresh post-start book/trade evidence', async () => {
  const world = createWorld();
  await world.ports.runtimes.volume.start();
  world.volumeStatus.lastBookTs = START - 100;
  world.volumeStatus.lastTradeTs = START - 200;
  world.volumeStatus.streamState = 'connecting';
  world.volumeStatus.streamConnections = 2;
  world.volumeStatus.openConnections = 1;
  assert.equal(world.ports.runtimes.volume.health(world.ctx()).timestamp, null);

  world.volumeStatus.streamState = 'open';
  world.volumeStatus.openConnections = 2;
  const health = world.ports.runtimes.volume.health(world.ctx());
  assert.equal(health.running, true);
  assert.equal(health.timestamp.sourceTimeMs, START - 200);
  assert.equal(health.timestamp.receivedAtMs, START);
});

test('strategy summaries count exact owner records without recomputing scores or using capture time', async () => {
  const world = createWorld();
  await world.ports.runtimes.basis.start();
  await world.ports.runtimes.volume.start();

  world.basisStatus.lastBookTs = START - 100;
  world.basisStatus.lastMarkTs = START - 150;
  world.basisSnapshot.lastTickTs = START - 50;
  world.basisSnapshot.decisions.push(
    decision('watch', START - 500, 'basis-watch'),
    decision('focus', START - 400, 'basis-focus'),
    decision('reject', START - 300, 'basis-reject'),
    decision('proposal', START - 200, 'basis-proposal'),
  );
  world.basisSnapshot.proposals.push(proposal('basis', START - 200, 'basis-one'));
  world.basisSnapshot.ownerSummary = { candidateCount: 7, opportunityCount: 3, cooldownCount: 2 };

  world.volumeStatus.lastBookTs = START - 120;
  world.volumeStatus.lastTradeTs = START - 140;
  world.volumeStatus.streamState = 'open';
  world.volumeStatus.streamConnections = 1;
  world.volumeStatus.openConnections = 1;
  world.volumeSnapshot.lastTickTs = START - 60;
  world.volumeSnapshot.decisions.push(
    decision('reject', START - 350, 'volume-reject'),
    decision('proposal', START - 250, 'volume-proposal'),
  );
  world.volumeSnapshot.proposals.push(proposal('volume_spike', START - 250, 'volume-one'));
  world.volumeSnapshot.ownerSummary = { candidateCount: 5, opportunityCount: 4, cooldownCount: 1 };

  const summaries = world.ports.summaries.readSupervisorSummaries().strategies;
  assert.deepEqual(summaries.basis, {
    truthLabel: 'LIVE_PUBLIC',
    heartbeatAtMs: START - 50,
    candidateCount: 7,
    proposalCount: 3,
    cooldownCount: 2,
    rejectionCount: 1,
    acceptedCount: 1,
    lastDecisionAtMs: START - 200,
    sourceRevision: null,
  });
  assert.deepEqual(summaries.volume, {
    truthLabel: 'LIVE_PUBLIC',
    heartbeatAtMs: START - 60,
    candidateCount: 5,
    proposalCount: 4,
    cooldownCount: 1,
    rejectionCount: 1,
    acceptedCount: 1,
    lastDecisionAtMs: START - 250,
    sourceRevision: null,
  });
  assert.equal(JSON.stringify(summaries).includes(String(START + 9_999_999)), false);
});

test('missing or malformed strategy owner counts remain null instead of becoming synthetic zero', async () => {
  const world = createWorld();
  await world.ports.runtimes.basis.start();
  await world.ports.runtimes.volume.start();
  world.basisStatus.lastBookTs = START - 100;
  world.basisStatus.lastMarkTs = START - 150;
  world.volumeStatus.lastBookTs = START - 120;
  world.volumeStatus.lastTradeTs = START - 140;
  world.volumeStatus.streamState = 'open';
  world.volumeStatus.streamConnections = 1;
  world.volumeStatus.openConnections = 1;
  world.basisSnapshot.decisions.push(decision('watch', START - 100, 'basis-raw'));
  world.basisSnapshot.proposals.push(proposal('basis', START - 100, 'basis-raw'));
  world.volumeSnapshot.decisions.push(decision('focus', START - 100, 'volume-raw'));
  world.volumeSnapshot.proposals.push(proposal('volume_spike', START - 100, 'volume-raw'));
  world.basisSnapshot.ownerSummary = null;
  world.volumeSnapshot.ownerSummary = { candidateCount: 0, opportunityCount: 0, cooldownCount: -1 };

  const summaries = world.ports.summaries.readSupervisorSummaries().strategies;
  assert.deepEqual(
    [summaries.basis.candidateCount, summaries.basis.proposalCount, summaries.basis.cooldownCount],
    [null, null, null],
  );
  assert.deepEqual(
    [summaries.volume.candidateCount, summaries.volume.proposalCount, summaries.volume.cooldownCount],
    [null, null, null],
  );
});

test('production summaries bind active-exposure and recovery counts to exact Capital owner cuts', () => {
  const state = createEmptyCapitalCheckpointState('capital:production-summary:test');
  const restart = projectRestartSafety(state, {
    nowMs: START,
    correlationId: 'capital-production-summary',
    accountTruth: null,
    reconciliationTruth: null,
    reconciliationReferences: [],
  });
  const world = createWorld({
    capitalSummary: Object.freeze({ readCapitalSummary: () => capitalSummaryCut(restart) }),
  });

  assert.deepEqual(world.ports.summaries.readSupervisorSummaries().capital, {
    truthLabel: 'RECORDED_REPLAY',
    accountTruthState: 'RESTART_TRUTH_BLOCKED',
    allocatableAmount: null,
    reservedAmount: null,
    activeExposureAmount: null,
    eligibleCount: null,
    reservationCount: 0,
    stagedMandateCount: null,
    activeExposureCount: 0,
    recoveryCount: 0,
    checkpointRevision: '0',
    blockerCodes: [
      'RESTART_ACCOUNT_TRUTH_NOT_FRESH',
      'RESTART_RECONCILIATION_TRUTH_NOT_FRESH',
    ],
  });
});

test('unavailable or malformed Capital restart truth keeps production counts null', () => {
  const unavailable = createWorld();
  assert.deepEqual(
    [
      unavailable.ports.summaries.readSupervisorSummaries().capital.activeExposureCount,
      unavailable.ports.summaries.readSupervisorSummaries().capital.recoveryCount,
    ],
    [null, null],
  );

  const ownerGated = createWorld({
    capitalSummary: Object.freeze({
      readCapitalSummary: () => Object.freeze({
        availability: 'UNAVAILABLE',
        accountTruthState: 'OWNER_GATED',
        reasonCodes: Object.freeze(['NO_CANONICAL_ACTIVE_L12_SUBJECT']),
      }),
    }),
  }).ports.summaries.readSupervisorSummaries().capital;
  assert.deepEqual(
    [ownerGated.activeExposureCount, ownerGated.recoveryCount, ownerGated.accountTruthState],
    [null, null, 'OWNER_GATED'],
  );
  assert.deepEqual(ownerGated.blockerCodes, ['NO_CANONICAL_ACTIVE_L12_SUBJECT']);

  const malformed = createWorld({
    capitalSummary: Object.freeze({
      readCapitalSummary: () => ({
        availability: 'AVAILABLE',
        checkpoint: { id: 'cchk-malformed', revision: 4 },
        safety: {
          canOpenOrIncrease: false,
          supervisionContinues: true,
          visiblePositionIds: [],
          recoveryRequiredPositionIds: ['position-not-visible'],
          effectiveActiveReservationIds: [],
          reasonCodes: [],
        },
      }),
    }),
  });
  const summary = malformed.ports.summaries.readSupervisorSummaries().capital;
  assert.deepEqual([summary.activeExposureCount, summary.recoveryCount, summary.checkpointRevision], [null, null, null]);
  assert.deepEqual(summary.blockerCodes, ['CAPITAL_SUMMARY_OWNER_MALFORMED']);
});

test('the real server entrypoint binds canonical L12 evidence through the lazy Capital summary port', () => {
  const source = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const declaration = source.indexOf('let canonicalOwnerEvidence: CanonicalOwnerEvidenceReadPort | null = null;');
  const construction = source.indexOf('const systemIntegrationProduction = createProductionSystemIntegrationPorts({');
  const assignment = source.indexOf('canonicalOwnerEvidence = createCanonicalOwnerEvidenceReadPort({');
  assert.ok(declaration >= 0 && declaration < construction && construction < assignment);
  assert.match(source, /readCapitalSummary: \(\) => \{[\s\S]*readCanonicalOwnerEvidence\(\)\.l12/u);
  assert.match(source, /capitalSummary: capitalSummaryReadPort/u);
  assert.doesNotMatch(source, /createEmptyCapitalCheckpointState/u);
});

test('Capital summary reads are lazy, exact, deeply snapshotted, and fail closed on hostile input', () => {
  let cut = null;
  let reads = 0;
  const port = Object.freeze({
    readCapitalSummary() {
      reads += 1;
      return cut;
    },
  });
  const world = createWorld({ capitalSummary: port });
  assert.equal(reads, 0);
  assert.equal(world.ports.summaries.readSupervisorSummaries().capital.activeExposureCount, null);
  assert.equal(reads, 1);

  cut = {
    availability: 'AVAILABLE',
    checkpoint: { id: 'capital:restored:7', revision: 7 },
    safety: {
      canOpenOrIncrease: false,
      supervisionContinues: true,
      visiblePositionIds: ['position-1', 'position-2'],
      recoveryRequiredPositionIds: ['position-2'],
      effectiveActiveReservationIds: ['reservation-1'],
      reasonCodes: ['RESTART_RECOVERY_REQUIRED'],
    },
  };
  const summary = world.ports.summaries.readSupervisorSummaries().capital;
  assert.deepEqual(
    [summary.activeExposureCount, summary.recoveryCount, summary.reservationCount, summary.checkpointRevision],
    [2, 1, 1, '7'],
  );
  cut.safety.visiblePositionIds.push('position-after-read');
  cut.safety.reasonCodes.push('AFTER_READ');
  assert.deepEqual(
    [summary.activeExposureCount, summary.recoveryCount, summary.reservationCount, summary.blockerCodes],
    [2, 1, 1, ['RESTART_RECOVERY_REQUIRED']],
  );

  let getterReads = 0;
  const getterSafety = {};
  Object.defineProperties(getterSafety, {
    canOpenOrIncrease: { enumerable: true, get() { getterReads += 1; return true; } },
    supervisionContinues: { enumerable: true, value: false },
    visiblePositionIds: { enumerable: true, value: [] },
    recoveryRequiredPositionIds: { enumerable: true, value: [] },
    effectiveActiveReservationIds: { enumerable: true, value: [] },
    reasonCodes: { enumerable: true, value: [] },
  });
  cut = {
    availability: 'AVAILABLE',
    checkpoint: { id: 'capital:getter', revision: 8 },
    safety: getterSafety,
  };
  const getterSummary = world.ports.summaries.readSupervisorSummaries().capital;
  assert.equal(getterReads, 0);
  assert.deepEqual(
    [getterSummary.activeExposureCount, getterSummary.recoveryCount, getterSummary.checkpointRevision],
    [null, null, null],
  );

  cut = new Proxy({
    availability: 'AVAILABLE',
    checkpoint: { id: 'capital:proxy', revision: 9 },
    safety: {
      canOpenOrIncrease: true,
      supervisionContinues: false,
      visiblePositionIds: [], recoveryRequiredPositionIds: [],
      effectiveActiveReservationIds: [], reasonCodes: [],
    },
  }, {});
  assert.equal(world.ports.summaries.readSupervisorSummaries().capital.activeExposureCount, null);
});

test('Capital summary reentrancy and READY/blocker contradictions invalidate the whole cut', () => {
  let world;
  let reenter = true;
  const port = Object.freeze({
    readCapitalSummary() {
      if (reenter) {
        reenter = false;
        world.ports.summaries.readSupervisorSummaries();
      }
      return {
        availability: 'AVAILABLE',
        checkpoint: { id: 'capital:reentrant', revision: 1 },
        safety: {
          canOpenOrIncrease: true,
          supervisionContinues: false,
          visiblePositionIds: [], recoveryRequiredPositionIds: [],
          effectiveActiveReservationIds: [], reasonCodes: ['CONTRADICTORY_BLOCKER'],
        },
      };
    },
  });
  world = createWorld({ capitalSummary: port });
  const summary = world.ports.summaries.readSupervisorSummaries().capital;
  assert.deepEqual(
    [summary.activeExposureCount, summary.recoveryCount, summary.checkpointRevision],
    [null, null, null],
  );
  assert.deepEqual(summary.blockerCodes, ['CAPITAL_SUMMARY_OWNER_MALFORMED']);
});

test('strategy owner summaries reject Proxy/accessor records and snapshot exact own data once', async () => {
  const world = createWorld();
  await world.ports.runtimes.basis.start();
  world.basisStatus.lastBookTs = START - 100;
  world.basisStatus.lastMarkTs = START - 100;
  world.basis.integrationSnapshot = () => ({
    capturedAtMs: world.basisSnapshot.capturedAtMs,
    lastTickTs: world.basisSnapshot.lastTickTs,
    decisions: world.basisSnapshot.decisions,
    proposals: world.basisSnapshot.proposals,
    ownerSummary: world.basisSnapshot.ownerSummary,
  });

  world.basisSnapshot.ownerSummary = new Proxy({
    candidateCount: 3, opportunityCount: 2, cooldownCount: 1,
  }, {});
  let summary = world.ports.summaries.readSupervisorSummaries().strategies.basis;
  assert.deepEqual([summary.candidateCount, summary.proposalCount, summary.cooldownCount], [null, null, null]);

  let getterReads = 0;
  const getterSummary = {};
  Object.defineProperties(getterSummary, {
    candidateCount: { enumerable: true, get() { getterReads += 1; return 3; } },
    opportunityCount: { enumerable: true, value: 2 },
    cooldownCount: { enumerable: true, value: 1 },
  });
  world.basisSnapshot.ownerSummary = getterSummary;
  summary = world.ports.summaries.readSupervisorSummaries().strategies.basis;
  assert.equal(getterReads, 0);
  assert.deepEqual([summary.candidateCount, summary.proposalCount, summary.cooldownCount], [null, null, null]);

  const owned = { candidateCount: 4, opportunityCount: 3, cooldownCount: 2 };
  world.basisSnapshot.ownerSummary = owned;
  summary = world.ports.summaries.readSupervisorSummaries().strategies.basis;
  owned.candidateCount = 999;
  assert.deepEqual([summary.candidateCount, summary.proposalCount, summary.cooldownCount], [4, 3, 2]);
  assert.equal(Object.isFrozen(summary), true);
});

test('active exposure and recovery counts are owner facts, never validate-only synthetic zeros', () => {
  const defaults = defaultApplicationSummaries(null, true, null);
  const ownerCapital = Object.freeze({
    ...defaults.capital,
    truthLabel: 'RECORDED_REPLAY',
    accountTruthState: 'OWNER_READBACK',
    activeExposureCount: 3,
    recoveryCount: 2,
    blockerCodes: Object.freeze([]),
  });
  const projected = mergeApplicationSummaries(defaults, { capital: ownerCapital }, null);
  assert.equal(projected.capital, ownerCapital);
  assert.deepEqual([projected.capital.activeExposureCount, projected.capital.recoveryCount], [3, 2]);

  const projectedDuringValidateOnly = mergeApplicationSummaries(defaults, { capital: ownerCapital }, {
    disposition: 'RISK_REJECTED',
    riskVerdict: null,
    executionState: null,
    reconciliation: null,
  });
  assert.equal(projectedDuringValidateOnly.capital, ownerCapital);
  assert.deepEqual(
    [projectedDuringValidateOnly.capital.activeExposureCount, projectedDuringValidateOnly.capital.recoveryCount],
    [3, 2],
  );

  const validateOnlyWithoutCapitalOwner = mergeApplicationSummaries(defaults, null, {
    disposition: 'RISK_REJECTED',
    riskVerdict: null,
    executionState: null,
    reconciliation: null,
  });
  assert.deepEqual(
    [validateOnlyWithoutCapitalOwner.capital.activeExposureCount, validateOnlyWithoutCapitalOwner.capital.recoveryCount],
    [null, null],
  );
  assert.ok(validateOnlyWithoutCapitalOwner.capital.blockerCodes.includes('CAPITAL_EXPOSURE_OWNER_UNAVAILABLE'));
});
