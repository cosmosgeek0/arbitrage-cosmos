import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPITAL_EVIDENCE_DIMENSIONS,
  buildCapitalEvidenceCandidate,
  buildFullChainLatencyEvidence,
  buildMutationReconciliationHandoff,
  evaluateSyntheticSubmissionBoundary,
  mutationObservationId,
  prepareInitialMutationAppend,
  prepareMutationObservationAppend,
  prepareSyntheticSubmissionObservationAppend,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  T0,
  inputFixture,
  initialPersisted,
  l03AttemptContentRevision,
  l03HttpAttempt,
  l03SubmittedAttempt,
  persist,
  privateLineage,
  submittingPersisted,
} from './fixtures.mjs';

const CLOCK_REVISION = `l03-clock-calibration:${'6'.repeat(24)}`;

function healthyRecording(observedAtMs = T0 + 20) {
  return {
    state: 'RUNNING',
    observedAtMs,
    gapCount: 0,
    quotaState: 'OK',
    storagePressure: 'OK',
  };
}

function dimensions(state = 'PROVEN') {
  return CAPITAL_EVIDENCE_DIMENSIONS.map((dimension, index) => ({
    dimension,
    state,
    evidenceRevision: state === 'PROVEN'
      ? `owner-evidence-revision:${String(index).padStart(2, '0')}`
      : null,
  }));
}

function latencyInput(overrides = {}) {
  return {
    exchangeEventAtMs: T0 - 400,
    localReceiveAtMs: T0 - 390,
    featuresReadyAtMs: T0 - 300,
    decisionAtMs: T0 - 250,
    approvalAtMs: T0 - 150,
    durableIntentAtMs: T0 + 3,
    syntheticSubmissionAtMs: null,
    acknowledgementAtMs: null,
    privateConfirmationAtMs: null,
    exchangeClockCalibration: 'UTC_CALIBRATED',
    exchangeClockCalibrationRevision: CLOCK_REVISION,
    recording: healthyRecording(),
    observedAtMs: T0 + 30,
    ...overrides,
  };
}

function submissionObserved(input) {
  const intent = submittingPersisted(input);
  const decision = evaluateSyntheticSubmissionBoundary(intent, T0 + 3);
  assert.equal(decision.state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');
  return persist(prepareSyntheticSubmissionObservationAppend(
    intent,
    decision,
    l03SubmittedAttempt(intent),
    T0 + 4,
  ));
}

function observation(current, kind, payload, occurredAtMs, receivedAtMs, marker) {
  const boundPayload = kind === 'HTTP_OBSERVED' && Object.hasOwn(payload, 'classification')
    ? (() => {
        const l03RequestAttempt = l03HttpAttempt(current, payload);
        return {
          l03RequestAttempt,
          partialMixed: payload.classification === 'PARTIAL_MIXED',
          venueOrderId: payload.venueOrderId,
          responseContentRevision: l03RequestAttempt.httpStatus === null
            ? null
            : payload.responseContentRevision,
        };
      })()
    : kind === 'PRIVATE_ORDER_OBSERVED' || kind === 'PRIVATE_FILL_OBSERVED'
    ? {
        product: current.snapshot.identity.product,
        accountRealmId: current.snapshot.identity.accountRealmId,
        symbol: current.snapshot.identity.symbol,
        clientOrderId: current.snapshot.identity.clientOrderId,
        ...payload,
      }
    : payload;
  const sourceRevision = kind === 'HTTP_OBSERVED'
    ? l03AttemptContentRevision(boundPayload.l03RequestAttempt)
    : kind === 'PRIVATE_ORDER_OBSERVED' || kind === 'PRIVATE_FILL_OBSERVED'
      ? boundPayload.privateEventRevision
      : `l06-section7-source:${marker}`;
  const input = {
    kind,
    occurredAtMs,
    receivedAtMs,
    sourceRevision,
    payload: boundPayload,
  };
  return {
    observationId: mutationObservationId(current, input),
    ...input,
  };
}

function append(current, input) {
  const result = prepareMutationObservationAppend(current, input);
  assert.equal(result.kind, 'PREPARED');
  return persist(result.prepared);
}

function convergedPermutation(httpFirst) {
  let current = submissionObserved();
  const lineage = privateLineage(current, 'section7-private-new', {
    observationKind: 'ORDER',
    exchangeEventTimeMs: T0 + 5,
    receiptTimeMs: T0 + 7,
    generation: 1,
    fact: {
      status: 'NEW',
      cumulativeFilledQuantity: '0',
      venueOrderId: '1001',
      exchangeEventTimeMs: T0 + 5,
      connectionGeneration: 1,
    },
  });
  const http = observation(current, 'HTTP_OBSERVED', {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '1001',
    responseContentRevision: `sha256:${'1'.repeat(64)}`,
  }, T0 + 6, T0 + 7, 'http-ack');
  const privateOrder = observation(current, 'PRIVATE_ORDER_OBSERVED', {
    status: 'NEW',
    cumulativeFilledQuantity: '0',
    venueOrderId: '1001',
    exchangeEventTimeMs: T0 + 5,
    connectionGeneration: 1,
    ...lineage,
  }, T0 + 5, T0 + 7, 'private-new');
  for (const item of httpFirst ? [http, privateOrder] : [privateOrder, http]) {
    current = append(current, item);
  }
  return current;
}

function exactConvergedLatency() {
  return latencyInput({
    durableIntentAtMs: T0 + 3,
    syntheticSubmissionAtMs: T0 + 4,
    acknowledgementAtMs: T0 + 7,
    privateConfirmationAtMs: T0 + 7,
    exchangeClockCalibration: 'UTC_CALIBRATED',
    exchangeClockCalibrationRevision: CLOCK_REVISION,
  });
}

test('all capital evidence remains owner-review-only at exactly 10 USDT', () => {
  const persisted = submissionObserved();
  const forward = buildCapitalEvidenceCandidate(persisted, dimensions());
  const reverse = buildCapitalEvidenceCandidate(persisted, [...dimensions()].reverse());
  assert.equal(forward.policyRevision, reverse.policyRevision);
  assert.equal(forward.state, 'OWNER_REVIEW_REQUIRED');
  assert.equal(forward.currentCanaryMaximumNotional, '10');
  assert.equal(forward.recommendedMaximumNotional, '10');
  assert.equal(forward.notionalUnit, 'USDT');
  assert.equal(forward.boundPreflightResultNotional, '9.5');
  assert.deepEqual(forward.reasonCodes, [
    'OWNER_AUTHORIZATION_REQUIRED',
    'ROLLBACK_DEMOTION_REQUIRED',
  ]);
  assert.equal(forward.explicitOwnerAuthorizationPresent, false);
  assert.equal(forward.rollbackDemotionPolicyRevision, null);
  assert.equal(forward.automaticPromotion, false);
  assert.equal(forward.injectedEvidenceOnly, true);
  assert.equal(forward.capitalAuthority, 'NONE');
  assert.equal(forward.riskAuthority, 'NONE');
  assert.equal(forward.actionAuthority, 'NONE_RECORD_ONLY');
});

test('incomplete, duplicate, missing, and revision-inconsistent capital ladders fail closed', () => {
  const persisted = submissionObserved();
  const incomplete = dimensions();
  incomplete[0] = { ...incomplete[0], state: 'UNKNOWN', evidenceRevision: null };
  const blocked = buildCapitalEvidenceCandidate(persisted, incomplete);
  assert.equal(blocked.state, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes(`${incomplete[0].dimension}_UNKNOWN`));
  assert.throws(() => buildCapitalEvidenceCandidate(persisted, dimensions().slice(1)), TypeError);
  const duplicate = dimensions();
  duplicate[1] = { ...duplicate[1], dimension: duplicate[0].dimension };
  assert.throws(() => buildCapitalEvidenceCandidate(persisted, duplicate), TypeError);
  const inconsistent = dimensions();
  inconsistent[0] = { ...inconsistent[0], evidenceRevision: null };
  assert.throws(() => buildCapitalEvidenceCandidate(persisted, inconsistent), TypeError);
});

test('durable intent time remains bound after later journal heads advance', () => {
  const intent = submittingPersisted();
  const intentEvidence = buildFullChainLatencyEvidence(intent, latencyInput({
    durableIntentAtMs: intent.acknowledgement.committedAtMs,
  }));
  assert.equal(intentEvidence.milestones.durableIntentAtMs, intent.acknowledgement.committedAtMs);
  assert.equal(intentEvidence.completeness, 'PARTIAL_INJECTED');
  assert.throws(() => buildFullChainLatencyEvidence(intent, latencyInput({
    durableIntentAtMs: intent.acknowledgement.committedAtMs + 1,
  })), TypeError);

  const submitted = submissionObserved();
  const afterAdvance = buildFullChainLatencyEvidence(submitted, latencyInput({
    syntheticSubmissionAtMs: T0 + 4,
  }));
  assert.equal(afterAdvance.milestones.durableIntentAtMs, T0 + 3);
  assert.throws(() => buildFullChainLatencyEvidence(submitted, latencyInput({
    durableIntentAtMs: null,
    syntheticSubmissionAtMs: T0 + 4,
  })), TypeError);
});

test('telemetry after durable intent cannot erase or fabricate unavailable historical append ACK time', () => {
  const intent = submittingPersisted();
  const telemetry = append(intent, observation(
    intent,
    'TELEMETRY_DEGRADED',
    { subsystem: 'TRACE', reasonCode: 'TRACE_DEGRADED_BEFORE_SUBMISSION' },
    T0 + 4,
    T0 + 4,
    'trace-after-intent',
  ));
  assert.throws(() => buildFullChainLatencyEvidence(telemetry, latencyInput({
    durableIntentAtMs: null,
  })), /historical append ACK evidence is required/);
  assert.throws(() => buildFullChainLatencyEvidence(telemetry, latencyInput({
    durableIntentAtMs: intent.acknowledgement.committedAtMs,
  })), /historical append ACK evidence is required/);
});

test('HTTP/private arrival permutations derive one exact partial latency evidence revision', () => {
  const httpFirst = convergedPermutation(true);
  const eventFirst = convergedPermutation(false);
  assert.equal(httpFirst.snapshot.outcomeRevision, eventFirst.snapshot.outcomeRevision);
  const left = buildFullChainLatencyEvidence(httpFirst, exactConvergedLatency());
  const right = buildFullChainLatencyEvidence(eventFirst, exactConvergedLatency());
  assert.equal(left.evidenceRevision, right.evidenceRevision);
  assert.deepEqual(left.milestones, right.milestones);
  assert.equal(left.segmentsMs.exchangeEventToLocalReceive, 10);
  assert.equal(left.segmentsMs.localReceiveToFeatures, 90);
  assert.equal(left.segmentsMs.featuresToDecision, 50);
  assert.equal(left.segmentsMs.approvalToDurableIntent, 153);
  assert.equal(left.segmentsMs.syntheticSubmissionToAcknowledgement, 3);
  assert.equal(left.segmentsMs.acknowledgementToPrivateConfirmation, 0);
  assert.equal(left.completeness, 'COMPLETE_INJECTED');
  assert.equal(left.empiricalRegionBenchmark, 'NOT_PERFORMED');
  assert.equal(left.syntheticOnly, true);
  assert.equal(left.externalActionAuthorization, 'NONE');
});

test('every available journal latency milestone rejects substitution and unavailable evidence stays null', () => {
  const persisted = convergedPermutation(true);
  const exact = exactConvergedLatency();
  for (const field of [
    'exchangeEventAtMs',
    'localReceiveAtMs',
    'featuresReadyAtMs',
    'decisionAtMs',
    'approvalAtMs',
    'syntheticSubmissionAtMs',
    'acknowledgementAtMs',
    'privateConfirmationAtMs',
  ]) {
    assert.throws(() => buildFullChainLatencyEvidence(persisted, {
      ...exact,
      [field]: exact[field] + 1,
    }), TypeError, field);
  }
  assert.throws(() => buildFullChainLatencyEvidence(persisted, {
    ...exact,
    durableIntentAtMs: T0 + 4,
  }), TypeError);
  assert.throws(() => buildFullChainLatencyEvidence(persisted, {
    ...exact,
    exchangeClockCalibrationRevision: null,
  }), TypeError);
});

test('ambiguous HTTP evidence never fabricates an acknowledgement milestone', () => {
  const submitted = submissionObserved();
  const ambiguous = append(submitted, observation(submitted, 'HTTP_OBSERVED', {
    classification: 'AMBIGUOUS',
    httpStatus: 500,
    ambiguityCause: 'HTTP_5XX',
    venueOrderId: null,
    responseContentRevision: `sha256:${'2'.repeat(64)}`,
  }, T0 + 6, T0 + 7, 'ambiguous-http'));
  const evidence = buildFullChainLatencyEvidence(ambiguous, latencyInput({
    syntheticSubmissionAtMs: T0 + 4,
  }));
  assert.equal(evidence.milestones.acknowledgementAtMs, null);
  assert.throws(() => buildFullChainLatencyEvidence(ambiguous, latencyInput({
    syntheticSubmissionAtMs: T0 + 4,
    acknowledgementAtMs: T0 + 7,
  })), TypeError);
});

test('canonical Intelligence Runtime recording truth preserves health, gaps, quotas and storage pressure', () => {
  const submitted = submissionObserved();
  const cases = [
    [healthyRecording(), true, 'AVAILABLE'],
    [{ ...healthyRecording(), gapCount: 1 }, false, 'DEGRADED'],
    [{ ...healthyRecording(), quotaState: 'PRESSURED' }, false, 'DEGRADED'],
    [{ ...healthyRecording(), quotaState: 'EXHAUSTED' }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), storagePressure: 'PRESSURED' }, false, 'DEGRADED'],
    [{ ...healthyRecording(), storagePressure: 'FULL' }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), observedAtMs: null }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), gapCount: null }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), quotaState: 'UNKNOWN' }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), storagePressure: 'UNKNOWN' }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), state: 'STALE' }, false, 'DEGRADED'],
    [{ ...healthyRecording(), state: 'FAILED' }, false, 'UNAVAILABLE'],
    [{ ...healthyRecording(), state: 'UNKNOWN' }, false, 'UNAVAILABLE'],
  ];
  for (const [recording, ready, truth] of cases) {
    const evidence = buildFullChainLatencyEvidence(submitted, latencyInput({
      syntheticSubmissionAtMs: T0 + 4,
      recording,
    }));
    assert.equal(evidence.researchRecordingReady, ready);
    assert.equal(evidence.researchTruthState, truth);
    assert.deepEqual(evidence.milestones.recording, recording);
    assert.equal(evidence.canonicalRecordingOwner, 'INTELLIGENCE_RUNTIME');
    assert.equal(evidence.moneyCriticalRecoveryBlockedByRecording, false);
  }
});

test('known owner-side latency chronology cannot regress across omitted segments', () => {
  const submitted = submissionObserved();
  assert.throws(() => buildFullChainLatencyEvidence(submitted, latencyInput({
    featuresReadyAtMs: T0 + 1,
    decisionAtMs: T0 + 3,
    approvalAtMs: T0 + 2,
    syntheticSubmissionAtMs: T0 + 4,
  })), TypeError);
});

test('unavailable exchange-clock calibration never creates a cross-clock segment', () => {
  const input = inputFixture({
    bindings: {
      sourceExchangeEventAtMs: null,
      sourceLocalReceiveAtMs: null,
      exchangeClockCalibrationRevision: null,
    },
  });
  const submitted = submissionObserved(input);
  const evidence = buildFullChainLatencyEvidence(submitted, latencyInput({
    exchangeEventAtMs: null,
    localReceiveAtMs: null,
    exchangeClockCalibration: 'UNAVAILABLE',
    exchangeClockCalibrationRevision: null,
    syntheticSubmissionAtMs: T0 + 4,
  }));
  assert.equal(evidence.segmentsMs.exchangeEventToLocalReceive, null);
  assert.equal(evidence.segmentsMs.localReceiveToFeatures, null);
  assert.equal(evidence.completeness, 'PARTIAL_INJECTED');
});

test('canonical recording degradation changes lineage but never semantic outcome or recovery handoff availability', () => {
  const submitted = submissionObserved();
  const payload = {
    subsystem: 'INTELLIGENCE_RUNTIME_RECORDING',
    reasonCode: 'CANONICAL_RECORDING_DEGRADED',
  };
  const input = observation(
    submitted,
    'TELEMETRY_DEGRADED',
    payload,
    T0 + 8,
    T0 + 8,
    'runtime-recording-degraded',
  );
  const degraded = append(submitted, input);
  assert.notEqual(degraded.snapshot.headDigest, submitted.snapshot.headDigest);
  assert.equal(degraded.snapshot.outcomeRevision, submitted.snapshot.outcomeRevision);
  assert.equal(degraded.snapshot.projection.telemetryDegraded, true);
  assert.equal(degraded.snapshot.projection.recoveryRequired, true);
  const handoff = buildMutationReconciliationHandoff(degraded);
  assert.equal(handoff.queryAuthorized, false);
  assert.equal(handoff.retryAuthorized, false);
  assert.ok(handoff.reasonCodes.includes('NONCRITICAL_TELEMETRY_DEGRADED'));
});

test('all conservative regime postures retain evidence but grant no regime, capital, risk, or order authority', () => {
  for (const state of ['UNKNOWN', 'CURRENT_ADVISORY', 'STALE', 'UNSUPPORTED', 'DISAGREEING']) {
    const revision = state === 'UNKNOWN' ? null : `regime-advisory:${state.toLowerCase()}`;
    const persisted = initialPersisted(inputFixture({
      bindings: { regimePostureState: state, regimeAdvisoryRevision: revision },
    }));
    const candidate = buildCapitalEvidenceCandidate(persisted, dimensions());
    assert.equal(candidate.regimePosture.state, state);
    assert.equal(candidate.regimePosture.advisoryRevision, revision);
    assert.equal(candidate.regimePosture.regimeAuthority, 'NONE');
    assert.equal(candidate.regimePosture.capitalAuthority, 'NONE');
    assert.equal(candidate.regimePosture.riskAuthority, 'NONE');
    assert.equal(candidate.regimePosture.orderAuthorization, false);
  }
  assert.throws(() => prepareInitialMutationAppend(inputFixture({
    bindings: { regimePostureState: 'UNKNOWN', regimeAdvisoryRevision: 'regime-advisory:foreign' },
  })), TypeError);
  assert.throws(() => prepareInitialMutationAppend(inputFixture({
    bindings: { regimePostureState: 'STALE', regimeAdvisoryRevision: null },
  })), TypeError);
});
