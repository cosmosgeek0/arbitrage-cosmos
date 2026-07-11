import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProductionSystemIntegrationPorts,
} from '../../../dist/systemIntegration/production/index.js';

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

function createWorld() {
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
  };
  const volume = {
    async start() { calls.volumeStart += 1; volumeStatus.running = true; },
    stop() { calls.volumeStop += 1; volumeStatus.running = false; },
    connectionStatus() { return { ...volumeStatus }; },
    integrationSnapshot() { return structuredClone(volumeSnapshot); },
  };
  const ports = createProductionSystemIntegrationPorts({
    clock,
    market,
    basis,
    volume,
    sourceMaxAgeMs: 10_000,
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
    basisStatus,
    basisSnapshot,
    volumeStatus,
    volumeSnapshot,
    ports,
    ctx,
  };
}

async function startMarket(world) {
  await world.ports.runtimes.market.init();
  world.ports.runtimes.market.start();
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
  ]);
  assert.equal(world.ports.components['intelligence-runtime'], undefined);
  assert.equal(world.ports.components['market-intelligence'], undefined);
  assert.equal(world.ports.components['capital-supervision'], undefined);
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

  const summaries = world.ports.summaries.readSupervisorSummaries().strategies;
  assert.deepEqual(summaries.basis, {
    truthLabel: 'LIVE_PUBLIC',
    heartbeatAtMs: START - 50,
    candidateCount: 2,
    proposalCount: 1,
    rejectionCount: 1,
    acceptedCount: 1,
    lastDecisionAtMs: START - 200,
    sourceRevision: null,
  });
  assert.deepEqual(summaries.volume, {
    truthLabel: 'LIVE_PUBLIC',
    heartbeatAtMs: START - 60,
    candidateCount: 0,
    proposalCount: 1,
    rejectionCount: 1,
    acceptedCount: 1,
    lastDecisionAtMs: START - 250,
    sourceRevision: null,
  });
  assert.equal(JSON.stringify(summaries).includes(String(START + 9_999_999)), false);
});
