import test from 'node:test';
import assert from 'node:assert/strict';

import { EdgeProtocolV1Client } from '../../../dist/liveEdge/adapters/edgeProtocol/client.js';
import { createEdgeProtocolSchemaRuntime } from '../../../dist/liveEdge/adapters/edgeProtocol/schemaValidator.js';
import { EdgeAssessmentBridge } from '../../../dist/liveEdge/integration/assessmentBridge.js';
import {
  FROZEN_PROTOCOL_SCHEMA_TEXT,
  buildActionableAssessment,
  canonicalFrame,
  cloneFrozenFixture,
  cloneJson,
} from '../fixtures/protocol-fixtures.mjs';

const NOW = 1_800_000_000_000;
const ACTIONABLE_TTL_MS = 60_000;
const HEARTBEAT_TTL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 500;
const FUTURE_SKEW_MS = 100;

const schema = createEdgeProtocolSchemaRuntime(FROZEN_PROTOCOL_SCHEMA_TEXT);
const client = new EdgeProtocolV1Client(schema);

const BASE_CONFIG = Object.freeze({
  adapterPolicy: 'L_ADAPTER_POLICY_V1',
  expectedRemoteComponentId: 'quant-inference',
  queueCapacity: 8,
  maximumQueueEntryBytes: 64 * 1024,
  maximumQueueRetainedBytes: 512 * 1024,
  identityCapacity: 64,
  identityRetentionGraceMs: 1_000,
  maximumDwellMs: 5_000,
  heartbeatTtlMs: HEARTBEAT_TTL_MS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  maximumFutureSkewMs: FUTURE_SKEW_MS,
  queuePressureRatio: 0.75,
  supportedStrategyFamilies: ['BASIS_CONVERGENCE'],
  supportedRegimeKeys: ['RANGE_BOUND', 'RISK_ON'],
});

function healthyRecording(observedAtMs = NOW) {
  return {
    snapshot() {
      return {
        state: 'RUNNING',
        observedAtMs,
        gapCount: 0,
        quotaState: 'OK',
        storagePressure: 'OK',
      };
    },
  };
}

function harness(options = {}) {
  let currentTimeMs = options.nowMs ?? NOW;
  const ownerCalls = [];
  const config = {
    ...BASE_CONFIG,
    ...(options.config ?? {}),
  };
  const owner = options.owner ?? ((observation) => ({
    state: 'OBSERVED',
    ownerReference: `basis-owner-r${observation.revision}`,
    reasonCode: 'ADVISORY_OBSERVED',
  }));
  const strategyPorts = Object.fromEntries(config.supportedStrategyFamilies.map((family) => [
    family,
    {
      observeAssessment(observation) {
        ownerCalls.push(observation);
        return owner(observation, ownerCalls.length);
      },
    },
  ]));
  const bridge = new EdgeAssessmentBridge({
    client,
    clock: { nowMs: () => currentTimeMs },
    config,
    strategyPorts,
    recordingHealth: options.recordingHealth ?? null,
  });
  return {
    bridge,
    config,
    ownerCalls,
    now: () => currentTimeMs,
    setNow(nextTimeMs) {
      currentTimeMs = nextTimeMs;
    },
    advance(deltaMs) {
      currentTimeMs += deltaMs;
    },
  };
}

function assessmentFrame(nowMs = NOW, overrides = {}) {
  return canonicalFrame(buildActionableAssessment(nowMs, overrides));
}

function healthEnvelope(nowMs, overrides = {}) {
  const fixture = cloneFrozenFixture('brain-health-degraded').envelope;
  return {
    ...cloneJson(fixture),
    generatedAtMs: nowMs,
    state: 'OK',
    lastSuccessMs: nowMs,
    lastErrorCode: null,
    queueDepth: 0,
    modelVersions: { stage: 'md_l01_v1' },
    driftState: 'STABLE',
    truthLabel: 'LIVE',
    blockingReasons: [],
    ...cloneJson(overrides),
  };
}

function connect(subject, overrides = {}) {
  return subject.bridge.observeTransport({
    state: 'CONNECTED',
    observedAtMs: subject.now(),
    requestStartedAtMs: null,
    requestCompletedAtMs: null,
    reasonCode: null,
    ...overrides,
  });
}

function ingestHealth(subject, overrides = {}) {
  return subject.bridge.ingest(canonicalFrame(healthEnvelope(subject.now(), overrides)));
}

function establishAdvisoryReady(subject, healthOverrides = {}) {
  connect(subject);
  const result = ingestHealth(subject, healthOverrides);
  assert.equal(result.kind, 'REMOTE_HEALTH_UPDATED');
  assert.equal(subject.bridge.snapshot().advisoryReady, true);
}

test('a valid PROPOSE_CONSIDERATION is queued before exactly one immutable advisory-owner observation', () => {
  const subject = harness();
  establishAdvisoryReady(subject);
  const frame = assessmentFrame(NOW, {
    eventTimeMs: NOW - 30,
    receiveTimeMs: NOW - 20,
    generationTimeMs: NOW - 10,
    expiryTimeMs: NOW + 50_000,
    economicAssumptionContext: { expiresAtMs: NOW + 45_000 },
  });

  assert.deepEqual(subject.bridge.ingest(frame), {
    kind: 'QUEUED',
    assessmentId: 'as_l01_actionable_0001',
    revision: 0,
    reasonCodes: ['ADVISORY_ASSESSMENT_QUEUED'],
    ownerReference: null,
  });
  assert.equal(subject.ownerCalls.length, 0, 'ingest must not synchronously call the strategy owner');

  assert.deepEqual(subject.bridge.drainOne(), {
    kind: 'DISPATCHED_TO_CANONICAL_STRATEGY',
    assessmentId: 'as_l01_actionable_0001',
    revision: 0,
    reasonCodes: ['ADVISORY_OBSERVED'],
    ownerReference: 'basis-owner-r0',
  });
  assert.equal(subject.ownerCalls.length, 1);
  assert.equal(subject.ownerCalls[0].localReceiptTimeMs, NOW);
  assert.equal(subject.ownerCalls[0].eventTimeMs, NOW - 30);
  assert.equal(subject.ownerCalls[0].peerReceiveTimeMs, NOW - 20);
  assert.equal(subject.ownerCalls[0].generationTimeMs, NOW - 10);
  assert.equal(subject.ownerCalls[0].expiryTimeMs, NOW + 50_000);
  assert.equal(subject.ownerCalls[0].economicExpiryTimeMs, NOW + 45_000);
  assert.equal(subject.ownerCalls[0].strategyFamily, 'BASIS_CONVERGENCE');
  assert.deepEqual(subject.ownerCalls[0].regime, {
    state: 'PRESENT',
    probabilities: { RANGE_BOUND: 0.3, RISK_ON: 0.7 },
  });
  assert.equal(Object.isFrozen(subject.ownerCalls[0]), true);
  assert.equal(Object.isFrozen(subject.ownerCalls[0].instrumentGraph), true);
  assert.equal(subject.bridge.drainOne().kind, 'QUEUE_EMPTY');
  assert.equal(subject.ownerCalls.length, 1, 'an accepted assessment must never be delivered twice');
});

test('expired, stale, unknown, OOD, drifted, uneconomic, conflicting, unsupported, and skewed assessments make zero owner calls', async (t) => {
  const cases = [
    {
      name: 'assessment expiry exact boundary',
      overrides: { expiryTimeMs: NOW },
      reason: 'ASSESSMENT_EXPIRED',
    },
    {
      name: 'economic expiry exact boundary',
      overrides: { economicAssumptionContext: { expiresAtMs: NOW } },
      reason: 'ECONOMIC_ASSUMPTIONS_EXPIRED',
    },
    {
      name: 'stale source quality',
      overrides: { sourceQuality: { freshness: 'STALE' } },
      reason: 'SOURCE_QUALITY_STALE',
    },
    {
      name: 'unknown source quality',
      overrides: { sourceQuality: { freshness: 'UNKNOWN' } },
      reason: 'SOURCE_QUALITY_UNKNOWN',
    },
    {
      name: 'explicit abstention',
      overrides: { advisoryAction: 'ABSTAIN_UNKNOWN', abstentionReasonCodes: ['MODEL_UNKNOWN'] },
      reason: 'ADVISORY_ACTION_ABSTAIN_UNKNOWN',
    },
    {
      name: 'out of distribution',
      overrides: { oodState: 'OUT_OF_DISTRIBUTION' },
      reason: 'ASSESSMENT_OOD_OUT_OF_DISTRIBUTION',
    },
    {
      name: 'drifting model',
      overrides: { driftState: 'DRIFTING' },
      reason: 'ASSESSMENT_DRIFT_DRIFTING',
    },
    {
      name: 'unknown economics',
      overrides: {
        netExpectedValue: { state: 'UNKNOWN' },
        economicAssumptionContext: { missingFields: ['funding.rate'] },
      },
      reason: 'NET_EXPECTED_VALUE_UNKNOWN',
    },
    {
      name: 'hypothetical economic context',
      overrides: { economicAssumptionContext: { state: 'HYPOTHETICAL' } },
      reason: 'ECONOMIC_CONTEXT_NOT_LIVE',
    },
    {
      name: 'expired borrow evidence',
      overrides: { economicAssumptionContext: { borrow: { expiresAtMs: NOW } } },
      reason: 'BORROW_ASSUMPTION_EXPIRED',
    },
    {
      name: 'missing borrow evidence',
      overrides: {},
      mutate(envelope) {
        delete envelope.economicAssumptionContext.borrow;
      },
      reason: 'BORROW_ASSUMPTION_UNAVAILABLE',
    },
    {
      name: 'missing spread and slippage model',
      overrides: {},
      mutate(envelope) {
        delete envelope.economicAssumptionContext.spreadSlippageModel;
      },
      reason: 'SPREAD_SLIPPAGE_MODEL_UNKNOWN',
    },
    {
      name: 'unknown latency scenario',
      overrides: { economicAssumptionContext: { latencyScenarioMs: null } },
      reason: 'LATENCY_SCENARIO_UNKNOWN',
    },
    {
      name: 'unknown recovery-cost scenario',
      overrides: { economicAssumptionContext: { recoveryCostScenario: null } },
      reason: 'RECOVERY_COST_SCENARIO_UNKNOWN',
    },
    {
      name: 'missing fee evidence',
      overrides: {},
      mutate(envelope) {
        delete envelope.economicAssumptionContext.feeTier;
      },
      reason: 'FEE_ASSUMPTION_UNKNOWN',
    },
    {
      name: 'missing funding evidence',
      overrides: {},
      mutate(envelope) {
        delete envelope.economicAssumptionContext.funding;
      },
      reason: 'FUNDING_ASSUMPTION_UNKNOWN',
    },
    {
      name: 'conflicting evidence',
      overrides: { evidence: { conflicting: ['spot and perp evidence disagree'] } },
      reason: 'ASSESSMENT_CONFLICTING_EVIDENCE',
    },
    {
      name: 'unsupported strategy family',
      overrides: { strategyFamily: 'UNSUPPORTED_FAMILY' },
      reason: 'STRATEGY_FAMILY_UNSUPPORTED',
    },
    {
      name: 'unknown regime posture',
      overrides: {},
      mutate(envelope) {
        envelope.regimeProbabilities = {};
      },
      reason: 'REGIME_POSTURE_UNKNOWN',
    },
    {
      name: 'unsupported regime posture',
      overrides: { regimeProbabilities: { PANIC: 1 } },
      reason: 'REGIME_POSTURE_UNSUPPORTED',
    },
    {
      name: 'future clock skew',
      overrides: {
        eventTimeMs: NOW + FUTURE_SKEW_MS + 1,
        receiveTimeMs: NOW + FUTURE_SKEW_MS + 1,
        generationTimeMs: NOW + FUTURE_SKEW_MS + 1,
      },
      reason: 'ASSESSMENT_CLOCK_SKEWED',
    },
    {
      name: 'peer and event timestamps independently exceed future-skew bound',
      overrides: {
        eventTimeMs: NOW + FUTURE_SKEW_MS + 1,
        receiveTimeMs: NOW + FUTURE_SKEW_MS + 1,
        generationTimeMs: NOW + FUTURE_SKEW_MS,
      },
      reason: 'ASSESSMENT_CLOCK_SKEWED',
    },
    {
      name: 'event after peer receive beyond allowed skew',
      overrides: {
        eventTimeMs: NOW,
        receiveTimeMs: NOW - FUTURE_SKEW_MS - 1,
        generationTimeMs: NOW,
      },
      reason: 'ASSESSMENT_TIME_ORDER_INVALID',
    },
    {
      name: 'economic snapshot after assessment generation beyond allowed skew',
      overrides: {
        eventTimeMs: NOW - FUTURE_SKEW_MS,
        receiveTimeMs: NOW - FUTURE_SKEW_MS,
        generationTimeMs: NOW - FUTURE_SKEW_MS,
        economicAssumptionContext: { asOfMs: NOW + 1 },
      },
      reason: 'ASSESSMENT_TIME_ORDER_INVALID',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const subject = harness();
      const envelope = buildActionableAssessment(NOW, entry.overrides);
      entry.mutate?.(envelope);
      const result = subject.bridge.ingest(canonicalFrame(envelope));
      assert.equal(result.kind, 'NON_ACTIONABLE');
      assert.ok(result.reasonCodes.includes(entry.reason), `${entry.reason} missing from ${result.reasonCodes.join(',')}`);
      assert.equal(subject.bridge.drainOne().kind, 'QUEUE_EMPTY');
      assert.equal(subject.ownerCalls.length, 0);
    });
  }
});

test('protocol compatibility rejects a version-2-and-expired frame before expiry semantics', () => {
  const subject = harness();
  const frame = assessmentFrame(NOW, {
    version: 2,
    expiryTimeMs: NOW - 1,
    economicAssumptionContext: { expiresAtMs: NOW - 1 },
  });

  const result = subject.bridge.ingest(frame);
  assert.equal(result.kind, 'INVALID');
  assert.deepEqual(result.reasonCodes, ['PROTOCOL_VERSION_UNSUPPORTED']);
  assert.equal(result.assessmentId, null);
  assert.equal(subject.bridge.drainOne().kind, 'QUEUE_EMPTY');
  assert.equal(subject.ownerCalls.length, 0);
});

test('identical redelivery is a no-op while same-revision conflict poisons the identity', () => {
  const subject = harness();
  const original = assessmentFrame();
  const conflict = assessmentFrame(NOW, { traceId: 'tr_l01_actionable_9999' });
  const later = assessmentFrame(NOW, { revision: 1 });

  assert.equal(subject.bridge.ingest(original).kind, 'QUEUED');
  assert.deepEqual(subject.bridge.ingest(original).reasonCodes, ['IDENTICAL_REDELIVERY']);
  assert.deepEqual(subject.bridge.ingest(conflict).reasonCodes, ['ASSESSMENT_IDENTITY_CONFLICT']);
  assert.deepEqual(subject.bridge.ingest(later).reasonCodes, ['IDENTITY_POISONED']);
  assert.equal(subject.bridge.snapshot().identities.poisoned, 1);
  assert.equal(subject.ownerCalls.length, 0);
});

test('lower revisions are stale and a non-contiguous higher revision supersedes queued older work', () => {
  const subject = harness();
  establishAdvisoryReady(subject);
  const revisionOne = assessmentFrame(NOW, { revision: 1 });
  const revisionZero = assessmentFrame(NOW, { revision: 0 });
  const revisionThree = assessmentFrame(NOW, { revision: 3 });

  assert.equal(subject.bridge.ingest(revisionOne).kind, 'QUEUED');
  assert.deepEqual(subject.bridge.ingest(revisionZero).reasonCodes, ['ASSESSMENT_REVISION_STALE']);
  assert.equal(subject.bridge.ingest(revisionThree).kind, 'QUEUED');

  const superseded = subject.bridge.drainOne();
  assert.equal(superseded.revision, 1);
  assert.equal(superseded.kind, 'REVISION_STALE');
  assert.deepEqual(superseded.reasonCodes, ['ASSESSMENT_SUPERSEDED_BEFORE_DISPATCH']);
  assert.equal(subject.bridge.drainOne().revision, 3);
  assert.deepEqual(subject.ownerCalls.map((observation) => observation.revision), [3]);
});

test('a backpressured higher revision still supersedes older queued work for the same assessment', () => {
  const subject = harness({ config: { queueCapacity: 1 } });
  const revisionZero = assessmentFrame(NOW, { revision: 0 });
  const revisionOne = assessmentFrame(NOW, { revision: 1 });

  assert.equal(subject.bridge.ingest(revisionZero).kind, 'QUEUED');
  assert.equal(subject.bridge.ingest(revisionOne).kind, 'BACKPRESSURE_DROPPED');
  assert.deepEqual(subject.bridge.ingest(revisionOne).reasonCodes, ['IDENTICAL_REDELIVERY']);
  assert.deepEqual(subject.bridge.drainOne(), {
    kind: 'REVISION_STALE',
    assessmentId: 'as_l01_actionable_0001',
    revision: 0,
    reasonCodes: ['ASSESSMENT_SUPERSEDED_BEFORE_DISPATCH'],
    ownerReference: null,
  });
  assert.equal(subject.ownerCalls.length, 0);
});

test('a newer expired revision invalidates older queued work without retaining unrelated expired identities', () => {
  const subject = harness({ config: { identityCapacity: 2 } });
  assert.equal(subject.bridge.ingest(assessmentFrame(NOW, { revision: 0 })).kind, 'QUEUED');

  const expiredRevision = subject.bridge.ingest(assessmentFrame(NOW, {
    revision: 1,
    expiryTimeMs: NOW,
    economicAssumptionContext: {
      expiresAtMs: NOW,
      borrow: { expiresAtMs: NOW },
      funding: { nextFundingTimeMs: NOW },
    },
  }));
  assert.equal(expiredRevision.kind, 'NON_ACTIONABLE');
  assert.ok(expiredRevision.reasonCodes.includes('ASSESSMENT_EXPIRED'));
  assert.equal(subject.bridge.drainOne().kind, 'REVISION_STALE');
  assert.equal(subject.ownerCalls.length, 0);

  const unrelatedExpired = subject.bridge.ingest(assessmentFrame(NOW, {
    revision: 0,
    assessmentId: 'as_l01_unrelated_expired',
    traceId: 'tr_l01_unrelated_expired',
    expiryTimeMs: NOW,
    economicAssumptionContext: {
      expiresAtMs: NOW,
      borrow: { expiresAtMs: NOW },
      funding: { nextFundingTimeMs: NOW },
    },
  }));
  assert.equal(unrelatedExpired.kind, 'NON_ACTIONABLE');
  assert.equal(subject.bridge.snapshot().identities.retained, 1);
});

test('a newer economic-expired-only revision independently invalidates older queued work', () => {
  const subject = harness();
  assert.equal(subject.bridge.ingest(assessmentFrame(NOW, { revision: 0 })).kind, 'QUEUED');

  const economicExpiredRevision = subject.bridge.ingest(assessmentFrame(NOW, {
    revision: 1,
    economicAssumptionContext: { expiresAtMs: NOW },
  }));
  assert.equal(economicExpiredRevision.kind, 'NON_ACTIONABLE');
  assert.ok(economicExpiredRevision.reasonCodes.includes('ECONOMIC_ASSUMPTIONS_EXPIRED'));
  assert.ok(!economicExpiredRevision.reasonCodes.includes('ASSESSMENT_EXPIRED'));
  assert.equal(subject.bridge.drainOne().kind, 'REVISION_STALE');
  assert.equal(subject.ownerCalls.length, 0);
});

test('a higher revision cannot change immutable strategy route identity', () => {
  const subject = harness();
  assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');

  const routeConflict = subject.bridge.ingest(assessmentFrame(NOW, {
    revision: 1,
    hypothesisId: 'hyp_l01_different_route',
  }));
  assert.equal(routeConflict.kind, 'IDENTITY_CONFLICT');
  assert.deepEqual(routeConflict.reasonCodes, ['ASSESSMENT_ROUTE_IDENTITY_CONFLICT']);

  const afterPoison = subject.bridge.ingest(assessmentFrame(NOW, { revision: 2 }));
  assert.equal(afterPoison.kind, 'IDENTITY_CONFLICT');
  assert.deepEqual(afterPoison.reasonCodes, ['IDENTITY_POISONED']);
});

test('count backpressure drops only the new item and preserves FIFO owner delivery', () => {
  const subject = harness({
    config: { queueCapacity: 2 },
    recordingHealth: healthyRecording(),
  });
  establishAdvisoryReady(subject);
  assert.equal(subject.bridge.snapshot().state, 'RUNNING');
  const first = assessmentFrame(NOW, {
    assessmentId: 'as_l01_actionable_0001',
    traceId: 'tr_l01_actionable_0001',
  });
  const second = assessmentFrame(NOW, {
    assessmentId: 'as_l01_actionable_0002',
    traceId: 'tr_l01_actionable_0002',
  });
  const third = assessmentFrame(NOW, {
    assessmentId: 'as_l01_actionable_0003',
    traceId: 'tr_l01_actionable_0003',
  });

  assert.equal(subject.bridge.ingest(first).kind, 'QUEUED');
  assert.equal(subject.bridge.ingest(second).kind, 'QUEUED');
  assert.equal(subject.bridge.ingest(third).kind, 'BACKPRESSURE_DROPPED');
  assert.equal(subject.ownerCalls.length, 0);

  const pressured = subject.bridge.snapshot();
  assert.equal(pressured.queue.depth, 2);
  assert.equal(pressured.queue.droppedCount, 1);
  assert.equal(pressured.queue.resyncRequired, true);
  assert.equal(pressured.counters.dropped, 1);
  assert.equal(pressured.state, 'DEGRADED');
  assert.equal(pressured.advisoryReady, false);
  assert.ok(pressured.reasonCodes.includes('ASSESSMENT_QUEUE_PRESSURED'));
  assert.ok(pressured.reasonCodes.includes('ASSESSMENT_QUEUE_RESYNC_REQUIRED'));

  assert.equal(subject.bridge.drainOne().assessmentId, 'as_l01_actionable_0001');
  assert.equal(subject.bridge.drainOne().assessmentId, 'as_l01_actionable_0002');
  assert.deepEqual(subject.ownerCalls.map((observation) => observation.assessmentId), [
    'as_l01_actionable_0001',
    'as_l01_actionable_0002',
  ]);
});

test('per-entry and aggregate byte backpressure fail closed without evicting protected work', () => {
  const first = assessmentFrame(NOW, {
    assessmentId: 'as_l01_actionable_0001',
    traceId: 'tr_l01_actionable_0001',
  });
  const second = assessmentFrame(NOW, {
    assessmentId: 'as_l01_actionable_0002',
    traceId: 'tr_l01_actionable_0002',
  });

  const measurement = harness();
  assert.equal(measurement.bridge.ingest(first).kind, 'QUEUED');
  const oneRetainedEntryBytes = measurement.bridge.snapshot().queue.retainedBytes;
  assert.ok(oneRetainedEntryBytes > 0);

  const aggregateBounded = harness({
    config: {
      queueCapacity: 3,
      maximumQueueEntryBytes: oneRetainedEntryBytes,
      maximumQueueRetainedBytes: oneRetainedEntryBytes,
    },
  });
  establishAdvisoryReady(aggregateBounded);
  assert.equal(aggregateBounded.bridge.ingest(first).kind, 'QUEUED');
  assert.equal(aggregateBounded.bridge.ingest(second).kind, 'BACKPRESSURE_DROPPED');
  const aggregateSnapshot = aggregateBounded.bridge.snapshot();
  assert.equal(aggregateSnapshot.queue.depth, 1);
  assert.equal(aggregateSnapshot.queue.retainedBytes, oneRetainedEntryBytes);
  assert.equal(aggregateSnapshot.queue.overflowCount, 1);
  assert.equal(aggregateSnapshot.queue.oversizeDropCount, 0);
  assert.equal(aggregateBounded.bridge.drainOne().assessmentId, 'as_l01_actionable_0001');

  const entryBounded = harness({
    config: {
      maximumQueueEntryBytes: 1,
      maximumQueueRetainedBytes: 1,
    },
  });
  assert.equal(entryBounded.bridge.ingest(first).kind, 'BACKPRESSURE_DROPPED');
  const entrySnapshot = entryBounded.bridge.snapshot();
  assert.equal(entrySnapshot.queue.depth, 0);
  assert.equal(entrySnapshot.queue.oversizeDropCount, 1);
  assert.equal(entrySnapshot.queue.resyncRequired, true);
  assert.equal(entryBounded.ownerCalls.length, 0);
});

test('queue expiry and dwell use exact conservative boundaries', () => {
  const beforeExpiry = harness({ config: { maximumDwellMs: 120_000 } });
  establishAdvisoryReady(beforeExpiry);
  assert.equal(beforeExpiry.bridge.ingest(assessmentFrame(NOW, {
    economicAssumptionContext: {
      funding: { nextFundingTimeMs: NOW + ACTIONABLE_TTL_MS },
    },
  })).kind, 'QUEUED');
  beforeExpiry.setNow(NOW + ACTIONABLE_TTL_MS - 1);
  assert.equal(ingestHealth(beforeExpiry, { revision: 1 }).kind, 'REMOTE_HEALTH_UPDATED');
  assert.equal(beforeExpiry.bridge.drainOne().kind, 'DISPATCHED_TO_CANONICAL_STRATEGY');

  const atExpiry = harness({ config: { maximumDwellMs: 120_000 } });
  assert.equal(atExpiry.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  atExpiry.setNow(NOW + ACTIONABLE_TTL_MS);
  const expired = atExpiry.bridge.drainOne();
  assert.equal(expired.kind, 'NON_ACTIONABLE');
  assert.ok(expired.reasonCodes.includes('ASSESSMENT_EXPIRED'));
  assert.ok(expired.reasonCodes.includes('ECONOMIC_ASSUMPTIONS_EXPIRED'));
  assert.equal(atExpiry.ownerCalls.length, 0);

  const beforeDwell = harness({ config: { maximumDwellMs: 1_000 } });
  establishAdvisoryReady(beforeDwell);
  assert.equal(beforeDwell.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  beforeDwell.setNow(NOW + 999);
  assert.equal(beforeDwell.bridge.drainOne().kind, 'DISPATCHED_TO_CANONICAL_STRATEGY');

  const atDwell = harness({ config: { maximumDwellMs: 1_000 } });
  assert.equal(atDwell.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  atDwell.setNow(NOW + 1_000);
  assert.deepEqual(atDwell.bridge.drainOne().reasonCodes, ['ASSESSMENT_QUEUE_DWELL_TIMEOUT']);
  assert.equal(atDwell.ownerCalls.length, 0);
});

test('exact expiry remains explicit when identity retention grace is zero', () => {
  const subject = harness({
    config: {
      identityRetentionGraceMs: 0,
      maximumDwellMs: 120_000,
    },
  });
  assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  subject.setNow(NOW + ACTIONABLE_TTL_MS);

  const result = subject.bridge.drainOne();
  assert.equal(result.kind, 'NON_ACTIONABLE');
  assert.ok(result.reasonCodes.includes('ASSESSMENT_EXPIRED'));
  assert.ok(result.reasonCodes.includes('ECONOMIC_ASSUMPTIONS_EXPIRED'));
  assert.ok(!result.reasonCodes.includes('ASSESSMENT_IDENTITY_UNAVAILABLE'));
  assert.equal(subject.ownerCalls.length, 0);
});

test('identity capacity never evicts live memory and prunes at the exact retention boundary', () => {
  const graceMs = 100;
  const subject = harness({
    config: {
      identityCapacity: 1,
      identityRetentionGraceMs: graceMs,
      queueCapacity: 4,
      maximumDwellMs: 120_000,
    },
  });
  assert.equal(subject.bridge.ingest(assessmentFrame(NOW, {
    assessmentId: 'as_l01_identity_0001',
    traceId: 'tr_l01_identity_0001',
  })).kind, 'QUEUED');
  assert.equal(subject.bridge.ingest(assessmentFrame(NOW, {
    assessmentId: 'as_l01_identity_0002',
    traceId: 'tr_l01_identity_0002',
  })).kind, 'IDENTITY_CAPACITY_BLOCKED');
  assert.equal(subject.bridge.snapshot().identities.retained, 1);

  const pruneBoundary = NOW + ACTIONABLE_TTL_MS + graceMs;
  subject.setNow(pruneBoundary);
  assert.equal(subject.bridge.ingest(assessmentFrame(pruneBoundary, {
    assessmentId: 'as_l01_identity_0003',
    traceId: 'tr_l01_identity_0003',
  })).kind, 'QUEUED');
  const identities = subject.bridge.snapshot().identities;
  assert.equal(identities.retained, 1);
  assert.equal(identities.capacityBlocks, 1);
  assert.equal(identities.pruned, 1);
  assert.equal(identities.accepted, 2);
});

test('health is truthful at startup, fresh, exact-TTL stale, degraded, and failed', () => {
  const startup = harness({ recordingHealth: healthyRecording() }).bridge.snapshot();
  assert.equal(startup.state, 'UNKNOWN');
  assert.equal(startup.advisoryReady, false);
  assert.ok(startup.reasonCodes.includes('TRANSPORT_UNOBSERVED'));
  assert.ok(startup.reasonCodes.includes('REMOTE_HEARTBEAT_UNKNOWN'));

  const freshSubject = harness({ recordingHealth: healthyRecording() });
  connect(freshSubject);
  assert.equal(ingestHealth(freshSubject).kind, 'REMOTE_HEALTH_UPDATED');
  const fresh = freshSubject.bridge.snapshot();
  assert.equal(fresh.state, 'RUNNING');
  assert.equal(fresh.advisoryReady, true);
  assert.equal(fresh.researchRecordingReady, true);

  freshSubject.advance(HEARTBEAT_TTL_MS);
  const stale = freshSubject.bridge.snapshot();
  assert.equal(stale.state, 'STALE');
  assert.equal(stale.remoteBrain.ageMs, HEARTBEAT_TTL_MS);
  assert.ok(stale.reasonCodes.includes('REMOTE_HEARTBEAT_STALE'));

  const degradedSubject = harness({ recordingHealth: healthyRecording() });
  connect(degradedSubject);
  ingestHealth(degradedSubject, {
    state: 'DEGRADED',
    lastErrorCode: 'FEATURE_SOURCE_STALE',
    blockingReasons: ['spot feed stale'],
  });
  const degraded = degradedSubject.bridge.snapshot();
  assert.equal(degraded.state, 'DEGRADED');
  assert.ok(degraded.reasonCodes.includes('REMOTE_STATE_DEGRADED'));
  assert.ok(degraded.reasonCodes.includes('REMOTE_BLOCKERS_PRESENT'));

  const failedSubject = harness({ recordingHealth: healthyRecording() });
  connect(failedSubject);
  ingestHealth(failedSubject, { state: 'FAILED', lastErrorCode: 'MODEL_FAILED' });
  assert.equal(failedSubject.bridge.snapshot().state, 'FAILED');
});

test('startup, disconnected transport, and missing remote health make zero advisory-owner calls', async (t) => {
  await t.test('zero-owner startup', () => {
    const subject = harness();
    assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
    const result = subject.bridge.drainOne();
    assert.equal(result.kind, 'NON_ACTIONABLE');
    assert.ok(result.reasonCodes.includes('TRANSPORT_UNOBSERVED'));
    assert.ok(result.reasonCodes.includes('REMOTE_HEARTBEAT_UNKNOWN'));
    assert.equal(subject.ownerCalls.length, 0);
  });

  await t.test('connected transport without remote evidence', () => {
    const subject = harness();
    connect(subject);
    assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
    const result = subject.bridge.drainOne();
    assert.equal(result.kind, 'NON_ACTIONABLE');
    assert.deepEqual(result.reasonCodes, ['REMOTE_HEARTBEAT_UNKNOWN']);
    assert.equal(subject.ownerCalls.length, 0);
  });

  await t.test('healthy remote evidence without transport evidence', () => {
    const subject = harness();
    assert.equal(ingestHealth(subject).kind, 'REMOTE_HEALTH_UPDATED');
    assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
    const result = subject.bridge.drainOne();
    assert.equal(result.kind, 'NON_ACTIONABLE');
    assert.deepEqual(result.reasonCodes, ['TRANSPORT_UNOBSERVED']);
    assert.equal(subject.ownerCalls.length, 0);
  });

  await t.test('transport disconnect after healthy evidence', () => {
    const subject = harness();
    establishAdvisoryReady(subject);
    assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
    subject.bridge.observeTransport({
      state: 'DISCONNECTED',
      observedAtMs: subject.now(),
      requestStartedAtMs: null,
      requestCompletedAtMs: null,
      reasonCode: 'TRANSPORT_DISCONNECTED',
    });
    const result = subject.bridge.drainOne();
    assert.equal(result.kind, 'NON_ACTIONABLE');
    assert.deepEqual(result.reasonCodes, ['TRANSPORT_DISCONNECTED']);
    assert.equal(subject.ownerCalls.length, 0);
  });

  await t.test('transport failure after healthy evidence', () => {
    const subject = harness();
    establishAdvisoryReady(subject);
    assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
    subject.bridge.observeTransport({
      state: 'FAILED',
      observedAtMs: subject.now(),
      requestStartedAtMs: subject.now(),
      requestCompletedAtMs: subject.now(),
      reasonCode: 'TRANSPORT_IO_FAILED',
    });
    const result = subject.bridge.drainOne();
    assert.equal(result.kind, 'NON_ACTIONABLE');
    assert.deepEqual(result.reasonCodes, ['TRANSPORT_IO_FAILED']);
    assert.equal(subject.ownerCalls.length, 0);
  });

  await t.test('transport request timeout after healthy evidence', () => {
    const subject = harness();
    establishAdvisoryReady(subject);
    assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
    connect(subject, { requestStartedAtMs: subject.now() });
    subject.advance(REQUEST_TIMEOUT_MS);
    const result = subject.bridge.drainOne();
    assert.equal(result.kind, 'NON_ACTIONABLE');
    assert.deepEqual(result.reasonCodes, ['TRANSPORT_REQUEST_TIMEOUT']);
    assert.equal(subject.ownerCalls.length, 0);
  });
});

test('every required remote-health truth gate blocks advisory-owner dispatch independently', async (t) => {
  const cases = [
    { name: 'remote state', overrides: { state: 'DEGRADED' }, reason: 'REMOTE_STATE_DEGRADED' },
    { name: 'truth label', overrides: { truthLabel: 'REPLAY' }, reason: 'REMOTE_TRUTH_REPLAY' },
    { name: 'drift state', overrides: { driftState: 'DRIFTING' }, reason: 'REMOTE_DRIFT_DRIFTING' },
    { name: 'blocking reason', overrides: { blockingReasons: ['source stale'] }, reason: 'REMOTE_BLOCKERS_PRESENT' },
    { name: 'empty model lineage', overrides: { modelVersions: {} }, reason: 'REMOTE_MODEL_LINEAGE_UNKNOWN' },
    { name: 'missing last success', overrides: { lastSuccessMs: null }, reason: 'REMOTE_LAST_SUCCESS_UNKNOWN' },
    { name: 'stale last success', overrides: { lastSuccessMs: NOW - HEARTBEAT_TTL_MS }, reason: 'REMOTE_LAST_SUCCESS_STALE' },
    {
      name: 'last success after heartbeat generation',
      overrides: { generatedAtMs: NOW - FUTURE_SKEW_MS, lastSuccessMs: NOW + 1 },
      reason: 'REMOTE_LAST_SUCCESS_TIME_ORDER_INVALID',
    },
    { name: 'stale heartbeat', overrides: {}, advanceMs: HEARTBEAT_TTL_MS, reason: 'REMOTE_HEARTBEAT_STALE' },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const subject = harness();
      connect(subject);
      assert.equal(ingestHealth(subject, entry.overrides).kind, 'REMOTE_HEALTH_UPDATED');
      assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
      if (entry.advanceMs !== undefined) subject.advance(entry.advanceMs);
      const result = subject.bridge.drainOne();
      assert.equal(result.kind, 'NON_ACTIONABLE');
      assert.ok(result.reasonCodes.includes(entry.reason), `${entry.reason} missing from ${result.reasonCodes.join(',')}`);
      assert.equal(subject.ownerCalls.length, 0);
    });
  }
});

test('foreign health is rejected without replacing the bound remote singleton', () => {
  const subject = harness();
  establishAdvisoryReady(subject);

  const foreign = ingestHealth(subject, {
    revision: 1,
    componentId: 'foreign-quant-inference',
    state: 'FAILED',
    lastErrorCode: 'FOREIGN_FAILED',
  });
  assert.equal(foreign.kind, 'DIRECTION_REJECTED');
  assert.deepEqual(foreign.reasonCodes, ['REMOTE_COMPONENT_ID_UNEXPECTED']);

  const snapshot = subject.bridge.snapshot();
  assert.equal(snapshot.remoteBrain.componentId, 'quant-inference');
  assert.equal(snapshot.remoteBrain.state, 'OK');
  assert.equal(snapshot.advisoryReady, true);
  assert.equal(snapshot.counters.healthUpdates, 1);
  assert.equal(snapshot.counters.directionRejected, 1);
});

test('conflicting health for the expected singleton latches readiness closed', () => {
  const subject = harness();
  establishAdvisoryReady(subject);
  assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');

  const conflict = ingestHealth(subject, {
    state: 'DEGRADED',
    lastErrorCode: 'CONFLICTING_HEALTH',
  });
  assert.equal(conflict.kind, 'IDENTITY_CONFLICT');
  assert.deepEqual(conflict.reasonCodes, ['ASSESSMENT_IDENTITY_CONFLICT']);
  const snapshot = subject.bridge.snapshot();
  assert.equal(snapshot.advisoryReady, false);
  assert.equal(snapshot.remoteBrain.componentId, null);
  assert.ok(snapshot.reasonCodes.includes('REMOTE_HEARTBEAT_UNKNOWN'));

  const result = subject.bridge.drainOne();
  assert.equal(result.kind, 'NON_ACTIONABLE');
  assert.deepEqual(result.reasonCodes, ['REMOTE_HEARTBEAT_UNKNOWN']);
  assert.equal(subject.ownerCalls.length, 0);
});

test('OBSERVED requires a bounded owner reference while REJECTED may return null', () => {
  const invalidObserved = harness({
    owner: () => ({ state: 'OBSERVED', ownerReference: null, reasonCode: 'ADVISORY_OBSERVED' }),
  });
  establishAdvisoryReady(invalidObserved);
  assert.equal(invalidObserved.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  assert.deepEqual(invalidObserved.bridge.drainOne(), {
    kind: 'OWNER_PORT_FAILURE',
    assessmentId: 'as_l01_actionable_0001',
    revision: 0,
    reasonCodes: ['ADVISORY_OWNER_RESULT_INVALID'],
    ownerReference: null,
  });
  assert.equal(invalidObserved.bridge.snapshot().counters.dispatched, 0);

  const rejected = harness({
    owner: () => ({ state: 'REJECTED', ownerReference: null, reasonCode: 'ADVISORY_REJECTED' }),
  });
  establishAdvisoryReady(rejected);
  assert.equal(rejected.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  assert.deepEqual(rejected.bridge.drainOne(), {
    kind: 'OWNER_REJECTED',
    assessmentId: 'as_l01_actionable_0001',
    revision: 0,
    reasonCodes: ['ADVISORY_REJECTED'],
    ownerReference: null,
  });
});

test('transport disconnect, failure, and exact request timeout remain blocked or failed', () => {
  const disconnected = harness({ recordingHealth: healthyRecording() });
  ingestHealth(disconnected);
  disconnected.bridge.observeTransport({
    state: 'DISCONNECTED',
    observedAtMs: NOW,
    requestStartedAtMs: null,
    requestCompletedAtMs: null,
    reasonCode: 'TRANSPORT_DISCONNECTED',
  });
  assert.equal(disconnected.bridge.snapshot().state, 'BLOCKED');

  const failed = harness({ recordingHealth: healthyRecording() });
  ingestHealth(failed);
  failed.bridge.observeTransport({
    state: 'FAILED',
    observedAtMs: NOW,
    requestStartedAtMs: NOW,
    requestCompletedAtMs: NOW,
    reasonCode: 'TRANSPORT_IO_FAILED',
  });
  assert.equal(failed.bridge.snapshot().state, 'FAILED');

  const timedOut = harness({ recordingHealth: healthyRecording() });
  ingestHealth(timedOut);
  connect(timedOut, { requestStartedAtMs: NOW });
  timedOut.advance(REQUEST_TIMEOUT_MS);
  const timeoutSnapshot = timedOut.bridge.snapshot();
  assert.equal(timeoutSnapshot.transport.state, 'TIMED_OUT');
  assert.equal(timeoutSnapshot.state, 'BLOCKED');
  assert.equal(timeoutSnapshot.transport.reasonCode, 'TRANSPORT_REQUEST_TIMEOUT');
});

test('RUNNING recording without an observation time is not research-ready or overall RUNNING', () => {
  const recordingHealth = {
    snapshot() {
      return {
        state: 'RUNNING',
        observedAtMs: null,
        gapCount: 0,
        quotaState: 'OK',
        storagePressure: 'OK',
      };
    },
  };
  const subject = harness({ recordingHealth });
  establishAdvisoryReady(subject);

  const snapshot = subject.bridge.snapshot();
  assert.equal(snapshot.state, 'DEGRADED');
  assert.equal(snapshot.advisoryReady, true, 'recording evidence is not a Q advisory dispatch gate');
  assert.equal(snapshot.researchRecordingReady, false);
  assert.ok(snapshot.reasonCodes.includes('CANONICAL_RECORDING_DEGRADED'));
});

test('recording failure degrades research truth without gating healthy advisory dispatch', () => {
  const recordingHealth = {
    snapshot() {
      throw new Error('simulated canonical recording failure');
    },
  };
  const subject = harness({ recordingHealth });
  establishAdvisoryReady(subject);

  const failedHealth = subject.bridge.snapshot();
  assert.equal(failedHealth.state, 'DEGRADED');
  assert.equal(failedHealth.advisoryReady, true);
  assert.equal(failedHealth.recording.state, 'FAILED');
  assert.equal(failedHealth.researchRecordingReady, false);
  assert.ok(failedHealth.reasonCodes.includes('CANONICAL_RECORDING_DEGRADED'));

  assert.equal(subject.bridge.ingest(assessmentFrame()).kind, 'QUEUED');
  assert.equal(subject.bridge.drainOne().kind, 'DISPATCHED_TO_CANONICAL_STRATEGY');
  assert.equal(subject.ownerCalls.length, 1, 'recording health must not gate the advisory observation seam');
});
