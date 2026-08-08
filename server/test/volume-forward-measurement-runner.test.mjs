#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVolumeForwardDetectorSourceCut,
  VOLUME_FORWARD_DETECTOR_SOURCE_ID,
} from '../dist/engine/volume/forwardMeasurementDetectorSource.js';
import { VolumeEngine } from '../dist/engine/volume/engine.js';
import {
  createVolumeForwardMeasurementRunner,
  VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY,
} from '../dist/engine/volume/forwardMeasurementRunner.js';
import { ManualClock } from '../dist/engine/v0/clock.js';
import { VolumeRuntime } from '../dist/services/volumeRuntime.js';

const INTERVAL_START_MS = Date.UTC(2026, 7, 1);
const INTERVAL_END_EXCLUSIVE_MS = INTERVAL_START_MS + 2_592_000_000;
const MATURITY_AT_MS = INTERVAL_END_EXCLUSIVE_MS + 62_000;
const WARMUP_START_MS = INTERVAL_START_MS - 14_400_000;
const SOURCE_DIGEST = `sha256:${'2'.repeat(64)}`;
const CORE_POLICY_DIGEST = `sha256:${'3'.repeat(64)}`;
const PACKET_POLICY_SHA256 = '4'.repeat(64);

function decision({
  correlationId = 'vs_qualified_signal_0001',
  symbol = 'BTCUSDT',
  ts = INTERVAL_START_MS,
} = {}) {
  return {
    symbol,
    ts,
    strategy: 'volume_spike',
    kind: 'reject',
    rejectCode: 'kill_switch_on',
    humanReason: 'verified wakeup but kill switch is ON — no proposal',
    correlationId,
    evidence: {
      direction: 'long',
      confidence: 0.91,
      volumeMultiple5s: 9.5,
    },
  };
}

function feature({
  symbol = 'BTCUSDT',
  ts = INTERVAL_START_MS,
} = {}) {
  return {
    symbol,
    ts,
    spotBid: 100,
    spotAsk: 101,
    perpBid: null,
    perpAsk: null,
    markPrice: null,
    fundingRate: null,
    spotSpreadBps: 99.00990099009901,
    perpSpreadBps: null,
    spotStalenessMs: 0,
    perpStalenessMs: null,
    basisLongSpotPct: null,
    basisShortSpotPct: null,
    basisSlopePctPerMin: null,
    windows: {},
    volumeMultiple: {},
    tradeCountMultiple: {},
    baselineReady: true,
    depthScore: 1,
    baseline: {
      ready: true,
      samples: 60,
      confidence: 1,
      quotePerSecNorm: 1,
      tradesPerSecNorm: 1,
      quotePerMinMedian: 60,
      quotePerMinMad: 0,
      isDead: false,
    },
    tape: null,
    book: {
      spreadBps: 99.00990099009901,
      topDepthUsd: 1_000,
      depthScore: 1,
      depthVsNorm: 1,
      stalenessMs: 0,
    },
    accelerationPctPerMin: 1,
    realizedVolPct: {},
    focusAgeMs: 5_000,
    signalAgeMs: 5_000,
  };
}

function sourceCut({
  correlationId,
  ts,
  symbol = 'BTCUSDT',
} = {}) {
  return buildVolumeForwardDetectorSourceCut({
    configuration: {
      baselineMinSamples: 60,
      killSwitch: true,
      tickMs: 2_000,
    },
    configurationRevision: 'volume_config_revision_0001',
    evaluations: [{
      decision: decision({ correlationId, symbol, ts }),
      feature: feature({ symbol, ts }),
    }],
    tickAtMs: ts,
  });
}

function schedule() {
  return {
    schemaVersion: 'volume.forward.scheduled-capture.v1',
    activationId: `ve2_activation_${'1'.repeat(64)}`,
    captureId: `ve2_capture_${'5'.repeat(64)}`,
    detectorCoverageChainKey: `ve2_detector_coverage_${'6'.repeat(64)}`,
    detectorCoverageCorePolicyDigest: CORE_POLICY_DIGEST,
    detectorInputSourceId: VOLUME_FORWARD_DETECTOR_SOURCE_ID,
    detectorInputSourceDigest: SOURCE_DIGEST,
    packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    warmupStartMs: WARMUP_START_MS,
    intervalStartMs: INTERVAL_START_MS,
    intervalEndExclusiveMs: INTERVAL_END_EXCLUSIVE_MS,
    maturityAtMs: MATURITY_AT_MS,
    detectorCadenceMs: 2_000,
    detectorCutsPerSegment: 99_998,
    controls: {
      enabled: false,
      killSwitchEngaged: true,
      mode: 'SHADOW_ONLY',
      recordOnly: true,
    },
  };
}

function runtimeCut({
  correlationId,
  cutAtMs,
  localReceivedAtMs = cutAtMs,
  localMonotonicNs,
  runtimeGeneration = 1,
  detectorTickRevision =
    Math.floor((cutAtMs - WARMUP_START_MS) / 2_000) + 1,
} = {}) {
  return {
    schemaVersion: 'volume.runtime.forward-detector-cut.v1',
    runtimeGeneration,
    detectorTickRevision,
    localReceivedAtMs,
    localMonotonicNs,
    observerFailureCount: 0,
    sourceCut: sourceCut({ correlationId, ts: localReceivedAtMs }),
  };
}

function completeWarmup(runner, correlationId = 'vs_warmup_signal_0001') {
  let snapshot;
  for (let offset = 0; offset < 7_200; offset += 1) {
    const cutAtMs = WARMUP_START_MS + offset * 2_000;
    snapshot = runner.observe(runtimeCut({
      correlationId,
      cutAtMs,
      localMonotonicNs:
        String(1_000_000_000n + BigInt(offset) * 2_000_000_000n),
    }));
  }
  assert.equal(snapshot.state, 'WARMING');
  assert.equal(snapshot.recordedWarmupCutCount, 7_200);
  return 1_000_000_000n + 7_200n * 2_000_000_000n;
}

test('runner authority is immutable default-OFF, KILL-ON, public record-only', () => {
  assert.deepEqual(VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY, {
    enabled: false,
    killSwitchEngaged: true,
    mode: 'SHADOW_ONLY',
    recordOnly: true,
    publicOnly: true,
    executionAuthority: 'NONE',
    submitAuthority: 'NONE',
    casAuthority: 'NONE',
    privateDataAuthority: 'NONE',
    signedRequestAuthority: 'NONE',
    keyAuthority: 'NONE',
    providerAuthority: 'NONE',
    hostAuthority: 'NONE',
    submitPortPresent: false,
    queryPortPresent: false,
    sends: 0,
    sideEffects: 0,
    orders: 0,
    transfers: 0,
    withdrawals: 0,
    moneyUsd: 0,
  });
  assert.equal(Object.isFrozen(VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY), true);
});

test('VolumeEngine exports qualified KILL_ON detector truth before proposal-store suppression', () => {
  const clock = new ManualClock(INTERVAL_START_MS);
  const engine = new VolumeEngine(clock);
  const exactFeature = {
    ...feature({ ts: INTERVAL_START_MS }),
    signalAgeMs: Number.POSITIVE_INFINITY,
  };
  const exactDecision = decision({ ts: INTERVAL_START_MS });
  engine.features.symbols = () => ['BTCUSDT'];
  engine.features.snapshotEx = () => exactFeature;
  engine.detector.evaluate = () => exactDecision;
  engine.focusMgr.inCooldown = () => false;
  engine.focusMgr.noteDecision = () => {};
  engine.focusMgr.tick = () => {};
  engine.start();
  engine.setKillSwitch(true);

  assert.equal(engine.tick(), null);
  const cut = engine.tick(true);
  assert.notEqual(cut, null);
  assert.equal(cut.evaluationUniverseCount, 1);
  assert.equal(cut.qualifiedProposals.length, 1);
  assert.match(cut.qualifiedProposals[0].proposal.proposalId, /^vvop_[a-f0-9]{64}$/);
  assert.equal(
    cut.qualifiedProposals[0].proposal.correlationId,
    exactDecision.correlationId,
  );
  assert.equal(engine.proposalStore.all().length, 0);
});

test('runner binds exact production detector decisions to scheduled coverage and capture', () => {
  const cuts = [];
  const proposals = [];
  const rotations = [];
  let checkpointCount = 0;
  let latestCheckpoint = null;
  const seals = [];
  const runner = createVolumeForwardMeasurementRunner({
    schedule: schedule(),
    sink: {
      rotateDetectorSegment: (rotation) => rotations.push(rotation),
      appendDetectorCoverage: (cut) => cuts.push(cut),
      openProposalCapture: (proposal) => proposals.push(proposal),
      persistRunnerCheckpoint: (checkpoint) => {
        checkpointCount += 1;
        latestCheckpoint = checkpoint;
      },
      sealDetectorCapture: (seal) => seals.push(seal),
    },
  });

  const warmupProposal = 'vs_warmup_signal_0001';
  const firstScoredMonotonic = completeWarmup(runner, warmupProposal);
  assert.equal(cuts.length, 0);

  assert.equal(runner.observe(runtimeCut({
    correlationId: warmupProposal,
    cutAtMs: INTERVAL_START_MS,
    localMonotonicNs: String(firstScoredMonotonic),
  })).state, 'CAPTURING');
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].cutOffset, 0);
  assert.deepEqual(cuts[0].acceptedProposals, []);

  const newProposal = 'vs_scored_signal_0002';
  assert.equal(runner.observe(runtimeCut({
    correlationId: newProposal,
    cutAtMs: INTERVAL_START_MS + 2_000,
    localMonotonicNs: String(firstScoredMonotonic + 2_000_000_000n),
  })).state, 'CAPTURING');
  assert.equal(cuts.length, 2);
  assert.equal(cuts[1].cutOffset, 1);
  assert.equal(cuts[1].previousCutDigest, cuts[0].cutDigest);
  assert.equal(cuts[1].acceptedProposals.length, 1);
  assert.equal(proposals.length, 1);
  assert.equal(
    proposals[0].proposal.proposalId,
    cuts[1].acceptedProposals[0].proposalId,
  );
  assert.equal(proposals[0].entryQuoteNotional, '10.00');
  assert.equal(rotations.length, 1);
  assert.equal(rotations[0].segmentIndex, 0);
  assert.equal(checkpointCount, 7_202);
  assert.equal(latestCheckpoint.nextCutOffset, 2);
  assert.equal(seals.length, 0);
  assert.equal(runner.snapshot().observerFailureCount, 0);
});

test('runner fails closed on missed source clock, generation changes, or sink failure', () => {
  const makeRunner = (sink = {}) => createVolumeForwardMeasurementRunner({
    schedule: schedule(),
    sink: {
      rotateDetectorSegment() {},
      appendDetectorCoverage() {},
      openProposalCapture() {},
      persistRunnerCheckpoint() {},
      sealDetectorCapture() {},
      ...sink,
    },
  });

  const late = makeRunner();
  const lateMonotonic = completeWarmup(late, 'vs_late_warmup_0001');
  assert.equal(late.observe(runtimeCut({
    correlationId: 'vs_late_signal_0001',
    cutAtMs: INTERVAL_START_MS,
    localReceivedAtMs: INTERVAL_START_MS + 2_000,
    localMonotonicNs: String(lateMonotonic),
  })).state, 'FAILED');
  assert.deepEqual(late.snapshot().reasonCodes, [
    'DETECTOR_CUT_RECEIVE_CLOCK_OUT_OF_RANGE',
  ]);

  const changed = makeRunner();
  assert.equal(changed.observe(runtimeCut({
    correlationId: 'vs_generation_signal_0001',
    cutAtMs: WARMUP_START_MS,
    localMonotonicNs: '1000000000',
  })).state, 'WARMING');
  assert.equal(changed.observe(runtimeCut({
    correlationId: 'vs_generation_signal_0002',
    cutAtMs: WARMUP_START_MS + 2_000,
    localMonotonicNs: '3000000000',
    runtimeGeneration: 2,
  })).state, 'FAILED');
  assert.deepEqual(changed.snapshot().reasonCodes, [
    'DETECTOR_RUNTIME_GENERATION_CHANGED',
  ]);

  const failedSink = makeRunner({
    appendDetectorCoverage() {
      throw new Error('disk full');
    },
  });
  const sinkMonotonic = completeWarmup(
    failedSink,
    'vs_sink_warmup_0001',
  );
  assert.equal(failedSink.observe(runtimeCut({
    correlationId: 'vs_sink_signal_0001',
    cutAtMs: INTERVAL_START_MS,
    localMonotonicNs: String(sinkMonotonic),
  })).state, 'FAILED');
  assert.deepEqual(failedSink.snapshot().reasonCodes, [
    'DETECTOR_EVIDENCE_APPEND_FAILED',
  ]);
});

test('runner refuses a shortened schedule and reports exact full-interval cut count', () => {
  assert.throws(() => createVolumeForwardMeasurementRunner({
    schedule: {
      ...schedule(),
      intervalEndExclusiveMs: INTERVAL_START_MS + 4_000,
      maturityAtMs: INTERVAL_START_MS + 8_000,
    },
    sink: {
      rotateDetectorSegment() {},
      appendDetectorCoverage() {},
      openProposalCapture() {},
      persistRunnerCheckpoint() {},
      sealDetectorCapture() {},
    },
  }), /forward scheduled capture is invalid/);

  const runner = createVolumeForwardMeasurementRunner({
    schedule: schedule(),
    sink: {
      rotateDetectorSegment() {},
      appendDetectorCoverage() {},
      openProposalCapture() {},
      persistRunnerCheckpoint() {},
      sealDetectorCapture() {},
    },
  });
  assert.equal(runner.snapshot().expectedDetectorCutCount, 1_296_031);
  assert.equal(
    runner.advanceTime(MATURITY_AT_MS - 1).state,
    'SCHEDULED',
  );
  assert.equal(
    runner.advanceTime(MATURITY_AT_MS).state,
    'FAILED',
  );
  assert.deepEqual(runner.snapshot().reasonCodes, [
    'DETECTOR_COVERAGE_INCOMPLETE_AT_MATURITY',
  ]);
});

test('durable checkpoint resumes the exact cut cursor across one runtime generation', () => {
  let checkpoint = null;
  const first = createVolumeForwardMeasurementRunner({
    schedule: schedule(),
    sink: {
      rotateDetectorSegment() {},
      appendDetectorCoverage() {},
      openProposalCapture() {},
      persistRunnerCheckpoint: (value) => {
        checkpoint = value;
      },
      sealDetectorCapture() {},
    },
  });
  const firstMonotonic = completeWarmup(
    first,
    'vs_resume_warmup_0001',
  );
  first.observe(runtimeCut({
    correlationId: 'vs_resume_signal_0001',
    cutAtMs: INTERVAL_START_MS,
    localMonotonicNs: String(firstMonotonic),
  }));
  assert.equal(checkpoint.nextCutOffset, 1);
  assert.equal(checkpoint.state, 'CAPTURING');
  const priorDigest = checkpoint.previousCutDigest;

  const resumedCuts = [];
  const resumed = createVolumeForwardMeasurementRunner({
    schedule: schedule(),
    checkpoint,
    sink: {
      rotateDetectorSegment() {},
      appendDetectorCoverage: (cut) => resumedCuts.push(cut),
      openProposalCapture() {},
      persistRunnerCheckpoint: (value) => {
        checkpoint = value;
      },
      sealDetectorCapture() {},
    },
  });
  const snapshot = resumed.observe(runtimeCut({
    correlationId: 'vs_resume_signal_0002',
    cutAtMs: INTERVAL_START_MS + 2_000,
    localMonotonicNs: '1',
    runtimeGeneration: 2,
    detectorTickRevision: 1,
  }));
  assert.equal(snapshot.state, 'CAPTURING');
  assert.equal(snapshot.nextCutOffset, 2);
  assert.equal(snapshot.runtimeGeneration, 2);
  assert.equal(resumedCuts.length, 1);
  assert.equal(resumedCuts[0].cutOffset, 1);
  assert.equal(
    resumedCuts[0].previousCutDigest,
    priorDigest,
  );
  assert.equal(resumed.checkpoint().checkpointRevision, 7_202);
});

test('VolumeRuntime forwards every direct engine evaluation cut synchronously and latches observer failure', () => {
  const observed = [];
  let observerCalls = 0;
  let monotonic = 1_000_000_000n;
  const runtime = new VolumeRuntime(
    { logEvent() {} },
    () => ({
      allowedSymbols: [],
      blockedSymbols: [],
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 1,
    }),
    () => [],
    null,
    () => INTERVAL_START_MS,
    {
      forwardMeasurementMonotonicNowNs: () => {
        const value = monotonic;
        monotonic += 2_000_000_000n;
        return value;
      },
      forwardMeasurementObserver: (cut) => {
        observerCalls += 1;
        if (observerCalls === 1) throw new Error('durable sink unavailable');
        observed.push(cut);
      },
    },
  );
  runtime.running = true;
  runtime.generation = 1;
  runtime.engine.start();
  runtime.onTick(1);
  runtime.onTick(1);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].runtimeGeneration, 1);
  assert.equal(observed[0].detectorTickRevision, 2);
  assert.equal(observed[0].observerFailureCount, 1);
  assert.equal(observed[0].sourceCut.sourceId, VOLUME_FORWARD_DETECTOR_SOURCE_ID);
  assert.equal(observed[0].sourceCut.evaluationUniverseCount, 0);
  runtime.stop();
});
