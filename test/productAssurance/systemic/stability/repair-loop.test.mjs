import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXTURE_NOW_MS,
  REPAIR_FIXTURES,
  makeRepairCircuitEvidence,
  makeRepairEvidence,
  makeRepairPolicy,
  makeResourceEvidenceBundle,
} from '../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs';
import {
  REPAIR_LATE_RESULT_LAW,
  REPAIR_RESTART_BEHAVIOR,
} from '../../../../fixtures/productAssurance/systemic/stability/contracts.mjs';
import {
  evaluateRepairLoop,
  evaluateResourceEvidence,
} from '../../../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs';

function refreshAttemptEvidence(evidence) {
  const earliestAttemptStartMs = evidence.attempts.length === 0
    ? evidence.campaignStartedAtMs
    : Math.min(...evidence.attempts.map((attempt) => attempt.startedAtMs));
  if (evidence.readinessEvidence.observedAtMs > earliestAttemptStartMs
    || evidence.conflictGraphEvidence.observedAtMs > earliestAttemptStartMs) {
    evidence.readinessEvidence.observedAtMs = evidence.campaignStartedAtMs;
    evidence.conflictGraphEvidence.observedAtMs = evidence.campaignStartedAtMs;
  }
  evidence.attempts.forEach((attempt, index) => {
    attempt.actuationGateEvidence = {
      readinessEvidenceRef: evidence.readinessEvidence.evidenceRef,
      readinessObservedAtMs: evidence.readinessEvidence.observedAtMs,
      readinessMaxAgeMs: evidence.readinessEvidence.maxAgeMs,
      conflictGraphEvidenceRef: evidence.conflictGraphEvidence.evidenceRef,
      conflictGraphObservedAtMs: evidence.conflictGraphEvidence.observedAtMs,
      conflictGraphMaxAgeMs: evidence.conflictGraphEvidence.maxAgeMs,
    };
    const priorCircuit = index === 0 ? null : evidence.attempts[index - 1].circuitEvidence;
    attempt.circuitEvidence = structuredClone(makeRepairCircuitEvidence(attempt, index));
    if (attempt.circuitState === 'CLOSED'
      && (priorCircuit === null || priorCircuit.state === 'CLOSED')) {
      Object.assign(attempt.circuitEvidence, {
        priorEvidenceRef: null,
        baselineNeverOpenedEvidenceRef: `synthetic.independent-circuit-baseline.${index + 1}`,
        baselineEvidenceOwner: 'synthetic.independent-repair-circuit-verifier',
        baselineEvidenceFailureDomain: 'synthetic.independent-repair-circuit-verifier-domain',
        openedAtMs: null,
        halfOpenAtMs: null,
        resetEligibleAtMs: null,
        closedAtMs: null,
        independentCloseEvidenceRef: null,
        independentCloseOwner: null,
        independentCloseFailureDomain: null,
      });
      return;
    }
    if (attempt.circuitState === 'UNKNOWN') return;
    attempt.circuitEvidence.openedAtMs = priorCircuit?.openedAtMs ?? evidence.campaignStartedAtMs;
    if (attempt.circuitState === 'HALF_OPEN') {
      attempt.circuitEvidence.halfOpenAtMs = priorCircuit?.halfOpenAtMs ?? attempt.completedAtMs;
    } else if (attempt.circuitState === 'OPEN') {
      attempt.circuitEvidence.halfOpenAtMs = priorCircuit?.halfOpenAtMs ?? null;
    } else if (attempt.circuitState === 'CLOSED') {
      attempt.circuitEvidence.halfOpenAtMs = priorCircuit?.halfOpenAtMs ?? attempt.startedAtMs;
      attempt.circuitEvidence.resetEligibleAtMs = Math.max(
        attempt.circuitEvidence.halfOpenAtMs,
        attempt.startedAtMs,
      );
      attempt.circuitEvidence.closedAtMs = attempt.completedAtMs;
    }
  });
  return evidence;
}

function assessmentHasCode(assessment, code) {
  return assessment.reasonCodes?.includes(code)
    || assessment.violationCodes?.includes(code)
    || assessment.contractIssues?.some((issue) => issue.code === code);
}

for (const fixture of REPAIR_FIXTURES) {
  test(`${fixture.id} evaluates deterministically`, () => {
    const first = evaluateRepairLoop(fixture.policy, fixture.evidence, FIXTURE_NOW_MS);
    const second = evaluateRepairLoop(fixture.policy, fixture.evidence, FIXTURE_NOW_MS);
    assert.deepEqual(first, second);
    assert.equal(first.assuranceResult, fixture.expectedResult);
    assert.equal(first.dataAuthority, 'SYNTHETIC_TEST');
    assert.equal(first.effectAuthority, 'NONE');
    assert.equal(first.automaticActionIssued, false);
    assert.equal(Object.isFrozen(first), true);
    if (fixture.expectedReason) assert.ok(first.reasonCodes.includes(fixture.expectedReason), first.reasonCodes.join(','));
    if (fixture.expectedPromotionEvidence) assert.equal(first.promotionEvidence, fixture.expectedPromotionEvidence);
    if (fixture.expectedTerminationClaim) assert.equal(first.terminationClaim, fixture.expectedTerminationClaim);
  });
}

test('action completion alone never becomes recovery evidence', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R02_PRODUCER_SELF_REPORT_IS_NOT_RECOVERY');
  const assessment = evaluateRepairLoop(fixture.policy, fixture.evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.ok(assessment.reasonCodes.includes('PRODUCER_SELF_REPORT_CANNOT_PROVE_RECOVERY'));
  assert.equal('recovered' in assessment, false);
});

test('all four termination assumptions independently degrade to UNKNOWN', () => {
  for (const assumption of ['durableStore', 'injectedClock', 'leaseFence', 'observability']) {
    const evidence = structuredClone(makeRepairEvidence({ attempts: [] }));
    evidence.assumptions[assumption] = 'UNKNOWN';
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'UNKNOWN', assumption);
    assert.equal(assessment.terminationWithinDeclaredBudget, null, assumption);
    assert.equal(assessment.terminationClaim, 'UNKNOWN_UNBOUNDED', assumption);
  }
});

test('repair late-result and restart behavior use exact accepted law identities', () => {
  const canonical = makeRepairPolicy();
  assert.equal(canonical.lateResultLaw, REPAIR_LATE_RESULT_LAW);
  assert.equal(canonical.restartBehavior, REPAIR_RESTART_BEHAVIOR);
  for (const [field, value, expectedCode] of [
    ['lateResultLaw', 'discard stale facts and let them authorize work', 'LATE_RESULT_LAW_INVALID'],
    ['restartBehavior', 'reset attempts budgets and fence after crash', 'RESTART_BEHAVIOR_INVALID'],
  ]) {
    const policy = structuredClone(canonical);
    policy[field] = value;
    const assessment = evaluateRepairLoop(policy, makeRepairEvidence(), FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.contractIssues.some((issue) => issue.code === expectedCode));
  }
});

test('observed signal identities are unique and exactly cover controlled-state signals', () => {
  const policy = structuredClone(makeRepairPolicy());
  policy.observedSignals.push({
    ...structuredClone(policy.observedSignals[0]),
    sourceOwner: 'conflicting.producer.owner',
    evidencePath: 'synthetic.conflicting.producer-path',
    failureDomain: 'conflicting.producer-domain',
  });
  const assessment = evaluateRepairLoop(policy, makeRepairEvidence(), FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'DUPLICATE_SIGNAL_ID'));
});

test('missing termination assumptions plus requested actuation fails', () => {
  const evidence = structuredClone(makeRepairEvidence({ attempts: [] }));
  evidence.assumptions.injectedClock = 'FAIL';
  evidence.nextActuationRequested = true;
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('ACTUATION_REQUESTED_WITH_UNPROVED_TERMINATION_ASSUMPTIONS'));
});

test('cooldown, maximum step, maximum slew, and concurrency remain bounded', () => {
  const policy = makeRepairPolicy();
  const cooldownAttempts = structuredClone(makeRepairEvidence().attempts);
  cooldownAttempts[1].startedAtMs = cooldownAttempts[0].completedAtMs + 500;
  cooldownAttempts[1].completedAtMs = cooldownAttempts[1].startedAtMs + 1_000;
  cooldownAttempts[1].producerObservedAtMs = cooldownAttempts[1].completedAtMs + 100;
  cooldownAttempts[1].verifierObservedAtMs = cooldownAttempts[1].completedAtMs + 200;
  const cases = [
    ['COOLDOWN_NOT_OBSERVED', { attempts: cooldownAttempts }],
    ['MAXIMUM_STEP_EXCEEDED', { attempts: [{ ...structuredClone(makeRepairEvidence().attempts[0]), stepMagnitude: 2 }] }],
    ['MAXIMUM_SLEW_EXCEEDED', { attempts: [{ ...structuredClone(makeRepairEvidence().attempts[0]), startedAtMs: makeRepairEvidence().campaignStartedAtMs + 1_000, stepMagnitude: 3 }] }],
    ['CONCURRENCY_BUDGET_OVERRUN', { observedConcurrentActuations: 2 }],
  ];
  for (const [reason, patch] of cases) {
    const evidence = refreshAttemptEvidence(structuredClone(makeRepairEvidence(patch)));
    const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL', reason);
    assert.ok(assessment.reasonCodes.includes(reason), `${reason}: ${assessment.reasonCodes.join(',')}`);
  }
});

test('no-progress and oscillation are reason evidence, not lifecycle states', () => {
  for (const id of ['R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE', 'R06_ALTERNATING_CONTROLLERS_QUARANTINE_AND_ESCALATE']) {
    const fixture = REPAIR_FIXTURES.find((entry) => entry.id === id);
    const assessment = evaluateRepairLoop(fixture.policy, fixture.evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'PASS');
    assert.equal('lifecycle' in assessment, false);
    assert.equal(assessment.requiredCanonicalResponse, 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED');
  }
});

function unavailablePostconditionWindow() {
  return {
    producerEvidenceRef: null,
    verifierEvidenceRef: null,
    producerOwner: null,
    verifierOwner: null,
    firstIndependentPassAtMs: null,
    lastIndependentPassAtMs: null,
    commonModeIndependence: 'UNKNOWN',
  };
}

test('future attempt and lease evidence cannot prove present repair authority', () => {
  const evidence = structuredClone(makeRepairEvidence());
  const latest = evidence.attempts.at(-1);
  latest.startedAtMs = FIXTURE_NOW_MS + 1;
  latest.completedAtMs = FIXTURE_NOW_MS + 2;
  latest.producerObservedAtMs = FIXTURE_NOW_MS + 3;
  latest.verifierObservedAtMs = FIXTURE_NOW_MS + 4;
  refreshAttemptEvidence(evidence);
  evidence.lease.lastRenewedAtMs = FIXTURE_NOW_MS + 1;
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.reasonCodes.includes('ATTEMPT_EVIDENCE_FROM_FUTURE'));
  assert.ok(assessment.reasonCodes.includes('LEASE_EVIDENCE_FROM_FUTURE'));
});

test('applied attempt must belong to the current lease owner and resource set', () => {
  const evidence = structuredClone(makeRepairEvidence());
  evidence.attempts[0].controllerId = 'controller.not-lease-owner';
  evidence.attempts[0].resourceIds = ['component.other'];
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('ATTEMPT_CONTROLLER_NOT_LEASE_OWNER'));
  assert.ok(assessment.violationCodes.includes('ATTEMPT_RESOURCE_SET_NOT_LEASED'));
});

test('termination trigger forbids another actuation request even after durable containment', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const evidence = structuredClone(fixture.evidence);
  evidence.nextActuationRequested = true;
  const assessment = evaluateRepairLoop(fixture.policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('FURTHER_ACTUATION_AFTER_TERMINATION_TRIGGER'));
});

test('a stopped loop without quarantine, escalation, or durable unresolved evidence is not contained', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const evidence = structuredClone(fixture.evidence);
  evidence.containment = {
    lifecycle: null,
    durableUnresolvedEvidenceRef: null,
    escalationOwner: null,
    furtherAutomaticActuation: false,
  };
  const assessment = evaluateRepairLoop(fixture.policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessment.containmentEvidenceSufficient, false);
});

test('single-controller alternating repair detects self-oscillation', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R06_ALTERNATING_CONTROLLERS_QUARANTINE_AND_ESCALATE');
  const evidence = structuredClone(fixture.evidence);
  for (const attempt of evidence.attempts) {
    attempt.controllerId = 'controller.alpha';
    attempt.completionApplied = true;
  }
  const assessment = evaluateRepairLoop(fixture.policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS');
  assert.ok(assessment.triggerCodes.includes('OSCILLATION_SIGNATURE_DETECTED'));
  assert.equal(assessment.progressEvidence.conflictingControllersPresent, false);
});

test('no-progress evidence outside its declared window does not trigger termination', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const policy = structuredClone(fixture.policy);
  policy.progressLaw.noProgressWindowMs = 1_000;
  const evidence = structuredClone(fixture.evidence);
  for (const attempt of evidence.attempts) attempt.circuitState = 'CLOSED';
  refreshAttemptEvidence(evidence);
  const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.triggerCodes.includes('NO_PROGRESS_THRESHOLD_REACHED'), false);
  assert.equal(assessment.terminationWithinDeclaredBudget, true);
  assert.equal(assessment.terminationClaim, 'BOUNDED_BY_DECLARED_EVIDENCE');
  assert.equal(assessment.containmentLifecycle, 'QUARANTINED');
});

test('missing required progress evidence is UNKNOWN and cannot authorize another actuation', () => {
  const evidence = structuredClone(makeRepairEvidence({
    attempts: [structuredClone(makeRepairEvidence().attempts[0])],
    postconditionWindow: unavailablePostconditionWindow(),
  }));
  evidence.attempts[0].progressValue = null;
  let assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.ok(assessment.unknownCodes.includes('PROGRESS_METRIC_UNAVAILABLE'));
  evidence.nextActuationRequested = true;
  assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('ACTUATION_REQUESTED_WITH_MISSING_PROGRESS_EVIDENCE'));
});

test('common-mode producer and verifier evidence cannot prove promotion', () => {
  const evidence = structuredClone(makeRepairEvidence());
  const latest = evidence.attempts.at(-1);
  latest.verifierOwner = latest.producerOwner;
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('COMMON_MODE_VERIFIER_EVIDENCE'));
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
});

test('cadence, backoff, observation horizon, and hysteresis are evaluated control laws', () => {
  const cadenceEvidence = structuredClone(makeRepairEvidence());
  for (const field of ['startedAtMs', 'completedAtMs', 'producerObservedAtMs', 'verifierObservedAtMs']) cadenceEvidence.attempts[0][field] += 500;
  refreshAttemptEvidence(cadenceEvidence);
  let assessment = evaluateRepairLoop(makeRepairPolicy(), cadenceEvidence, FIXTURE_NOW_MS);
  assert.ok(assessment.violationCodes.includes('EVALUATION_CADENCE_NOT_OBSERVED'));

  const backoffEvidence = structuredClone(makeRepairEvidence());
  const first = backoffEvidence.attempts[0];
  const second = backoffEvidence.attempts[1];
  second.startedAtMs = first.completedAtMs + 500;
  second.completedAtMs = second.startedAtMs + 1_000;
  second.producerObservedAtMs = second.completedAtMs + 100;
  second.verifierObservedAtMs = second.completedAtMs + 200;
  refreshAttemptEvidence(backoffEvidence);
  assessment = evaluateRepairLoop(makeRepairPolicy(), backoffEvidence, FIXTURE_NOW_MS);
  assert.ok(assessment.violationCodes.includes('BACKOFF_SCHEDULE_NOT_OBSERVED'));

  const horizonPolicy = structuredClone(makeRepairPolicy());
  horizonPolicy.observationHorizonMs = 15_000;
  horizonPolicy.progressLaw.noProgressWindowMs = 15_000;
  horizonPolicy.oscillationLaw.windowMs = 15_000;
  assessment = evaluateRepairLoop(horizonPolicy, makeRepairEvidence(), FIXTURE_NOW_MS);
  assert.ok(assessment.violationCodes.includes('ATTEMPT_OUTSIDE_OBSERVATION_HORIZON'));

  const hysteresisEvidence = structuredClone(makeRepairEvidence());
  hysteresisEvidence.attempts.at(-1).progressValue = 2;
  assessment = evaluateRepairLoop(makeRepairPolicy(), hysteresisEvidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
});

test('no trigger is not proof that the loop terminates within budget', () => {
  const evidence = makeRepairEvidence({
    attempts: [],
    postconditionWindow: unavailablePostconditionWindow(),
  });
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.ok(assessment.unknownCodes.includes('TERMINATION_NOT_YET_PROVEN'));
  assert.equal(assessment.terminationWithinDeclaredBudget, null);
  assert.equal(assessment.terminationClaim, 'NOT_YET_PROVEN_WITHIN_DECLARED_BUDGET');
});

test('an applied repair attempt cannot predate exclusive lease acquisition', () => {
  const boundary = evaluateRepairLoop(makeRepairPolicy(), makeRepairEvidence(), FIXTURE_NOW_MS);
  assert.equal(boundary.assuranceResult, 'PASS');
  const evidence = structuredClone(makeRepairEvidence());
  evidence.lease.acquiredAtMs = FIXTURE_NOW_MS - 16_000;
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('CAMPAIGN_STARTED_BEFORE_EXCLUSIVE_LEASE_ACQUISITION'));
  assert.ok(assessment.violationCodes.includes('ATTEMPT_STARTED_BEFORE_LEASE_ACQUISITION'));
});

test('ordered atomic resource acquisition is exact across policy, campaign, lease, and applied attempts', () => {
  const policy = structuredClone(makeRepairPolicy());
  policy.controlledState.resourceIds = ['component.a', 'component.b'];
  const evidence = structuredClone(makeRepairEvidence());
  evidence.conflictGraphEvidence.observedCampaigns[0].resourceIds = ['component.b', 'component.a'];
  evidence.lease.resourceIds = ['component.b', 'component.a'];
  for (const attempt of evidence.attempts) attempt.resourceIds = ['component.b', 'component.a'];
  const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('CURRENT_CAMPAIGN_ATOMIC_ACQUISITION_UNPROVED'));
  assert.ok(assessment.violationCodes.includes('LEASE_RESOURCE_SET_MISMATCH'));
});

test('stale, non-owner, or non-applied success evidence cannot prove promotion', () => {
  for (const mutate of [
    (latest) => { latest.fenceEpoch -= 1; latest.completionApplied = false; },
    (latest) => { latest.controllerId = 'controller.non-owner'; latest.completionApplied = false; },
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    mutate(evidence.attempts.at(-1));
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.notEqual(assessment.assuranceResult, 'PASS');
    assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  }
});

test('terminal quarantine is durable and sticky even after its trigger ages out', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const missingDurability = structuredClone(fixture.evidence);
  missingDurability.containment.durableUnresolvedEvidenceRef = null;
  let assessment = evaluateRepairLoop(fixture.policy, missingDurability, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessment.containmentEvidenceSufficient, false);

  const shortWindowPolicy = structuredClone(fixture.policy);
  shortWindowPolicy.progressLaw.noProgressWindowMs = 1_000;
  const resumed = structuredClone(fixture.evidence);
  for (const attempt of resumed.attempts) attempt.circuitState = 'CLOSED';
  refreshAttemptEvidence(resumed);
  resumed.nextActuationRequested = true;
  assessment = evaluateRepairLoop(shortWindowPolicy, resumed, FIXTURE_NOW_MS);
  assert.equal(assessment.triggerCodes.length, 0);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('FURTHER_ACTUATION_AFTER_TERMINATION_TRIGGER'));
});

test('postcondition and quiet-period evidence must follow the latest repair evidence', () => {
  const evidence = structuredClone(makeRepairEvidence());
  evidence.postconditionWindow.firstIndependentPassAtMs = FIXTURE_NOW_MS - 15_000;
  evidence.postconditionWindow.lastIndependentPassAtMs = FIXTURE_NOW_MS - 9_000;
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('POSTCONDITION_WINDOW_PRECEDES_LATEST_REPAIR_EVIDENCE'));
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
});

test('unconfirmed command mappings and unproved readiness cannot authorize actuation', () => {
  const policy = structuredClone(makeRepairPolicy());
  policy.commandRegistration = {
    state: 'OWNER_CONFIRMATION_REQUIRED',
    registryRef: null,
    implementationRef: null,
    registeredFencingOwner: null,
    fencingOwnerEvidenceRef: null,
  };
  let evidence = structuredClone(makeRepairEvidence({
    attempts: [],
    postconditionWindow: unavailablePostconditionWindow(),
  }));
  let assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.ok(assessment.unknownCodes.includes('COMMAND_MAPPING_OWNER_CONFIRMATION_REQUIRED'));

  evidence.nextActuationRequested = true;
  assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('ACTUATION_REQUESTED_WITH_UNCONFIRMED_COMMAND_MAPPING'));

  evidence = structuredClone(makeRepairEvidence());
  evidence.readinessEvidence.prerequisites = 'UNKNOWN';
  evidence.nextActuationRequested = true;
  assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('ACTUATION_REQUESTED_WITH_UNPROVED_REPAIR_READINESS'));
});

test('retry chronology and repair-conflict graph evidence are enforced', () => {
  const retryEvidence = structuredClone(makeRepairEvidence());
  retryEvidence.attempts[0].nextRetryAtMs += 1;
  let assessment = evaluateRepairLoop(makeRepairPolicy(), retryEvidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('NEXT_RETRY_DOES_NOT_MATCH_NEXT_ATTEMPT'));

  const conflictEvidence = structuredClone(makeRepairEvidence());
  conflictEvidence.conflictGraphEvidence.observedCampaigns.push({
    campaignId: 'campaign.conflicting.002',
    failureFingerprint: 'fingerprint.different',
    resourceIds: ['component.public-source'],
    startedAtMs: conflictEvidence.campaignStartedAtMs - 5_000,
    completedAtMs: null,
    acquisitionDisposition: 'ACQUIRED_ATOMICALLY',
    evidenceRef: 'synthetic.campaign-acquisition.conflicting-002',
  });
  assessment = evaluateRepairLoop(makeRepairPolicy(), conflictEvidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('CONFLICTING_CAMPAIGN_ACQUIRED_SAME_RESOURCE'));
});

test('released overlapping campaigns and duplicate campaign identities fail closed', () => {
  const releasedOverlap = structuredClone(makeRepairEvidence());
  releasedOverlap.conflictGraphEvidence.observedCampaigns.push({
    campaignId: 'campaign.released-overlap.003',
    failureFingerprint: 'fingerprint.different',
    resourceIds: ['component.public-source'],
    startedAtMs: releasedOverlap.campaignStartedAtMs - 5_000,
    completedAtMs: releasedOverlap.campaignStartedAtMs,
    acquisitionDisposition: 'RELEASED',
    evidenceRef: 'synthetic.campaign-release.overlap-003',
  });
  let assessment = evaluateRepairLoop(makeRepairPolicy(), releasedOverlap, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('CONFLICTING_CAMPAIGN_ACQUIRED_SAME_RESOURCE'));

  const duplicate = structuredClone(makeRepairEvidence());
  duplicate.conflictGraphEvidence.observedCampaigns.push(structuredClone(duplicate.conflictGraphEvidence.observedCampaigns[0]));
  assessment = evaluateRepairLoop(makeRepairPolicy(), duplicate, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'DUPLICATE_CAMPAIGN_ID'));
});

test('independent success, terminal containment, and failure posture are mutually exclusive', () => {
  const quarantined = structuredClone(makeRepairEvidence());
  quarantined.containment = {
    lifecycle: 'QUARANTINED',
    durableUnresolvedEvidenceRef: 'synthetic.unresolved.terminal-success-conflict',
    escalationOwner: null,
    furtherAutomaticActuation: false,
  };
  let assessment = evaluateRepairLoop(makeRepairPolicy(), quarantined, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS');
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  assert.equal(assessment.containmentLifecycle, 'QUARANTINED');

  quarantined.promotionClaimed = true;
  assessment = evaluateRepairLoop(makeRepairPolicy(), quarantined, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('PROMOTION_CLAIM_WITHOUT_INDEPENDENT_QUIET_POSTCONDITION'));

  const rollbackFailed = structuredClone(makeRepairEvidence());
  rollbackFailed.attempts.at(-1).rollback = 'FAILED';
  assessment = evaluateRepairLoop(makeRepairPolicy(), rollbackFailed, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  assert.ok(assessment.triggerCodes.includes('ROLLBACK_FAILED'));

  const compensationFixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R12_COMPENSATION_FAILURE_ESCALATES_DURABLY');
  assessment = evaluateRepairLoop(compensationFixture.policy, compensationFixture.evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
});

test('independent success forbids another actuation or scheduled retry', () => {
  const actuation = structuredClone(makeRepairEvidence());
  actuation.nextActuationRequested = true;
  let assessment = evaluateRepairLoop(makeRepairPolicy(), actuation, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  assert.ok(assessment.violationCodes.includes('FURTHER_ACTUATION_AFTER_INDEPENDENT_SUCCESS'));

  const retry = structuredClone(makeRepairEvidence());
  retry.attempts.at(-1).nextRetryAtMs = FIXTURE_NOW_MS + 1_000;
  assessment = evaluateRepairLoop(makeRepairPolicy(), retry, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  assert.ok(assessment.violationCodes.includes('FURTHER_ACTUATION_AFTER_INDEPENDENT_SUCCESS'));
});

test('inclusive budget exhaustion permits proven success while any overrun fails', () => {
  for (const mutate of [
    (policy) => { policy.budgets.maximumLocalAttempts = 2; },
    (policy) => { policy.budgets.maximumGlobalAttempts = 2; },
    (policy) => { policy.budgets.rateUnits = 2; },
    (policy) => { policy.budgets.resourceUnits = 2; },
    (policy) => { policy.budgets.costUnits = 2; },
  ]) {
    const policy = structuredClone(makeRepairPolicy());
    mutate(policy);
    const assessment = evaluateRepairLoop(policy, makeRepairEvidence(), FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'PASS', assessment.reasonCodes.join(','));
    assert.equal(assessment.terminationWithinDeclaredBudget, true);
  }

  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const overruns = [
    ['LOCAL_ATTEMPT_BUDGET_OVERRUN', (policy) => { policy.budgets.maximumLocalAttempts = 2; }],
    ['GLOBAL_ATTEMPT_BUDGET_OVERRUN', (policy) => { policy.budgets.maximumGlobalAttempts = 2; }],
    ['RATE_BUDGET_OVERRUN', (policy) => { policy.budgets.rateUnits = 2; }],
    ['RESOURCE_BUDGET_OVERRUN', (policy) => { policy.budgets.resourceUnits = 2; }],
    ['COST_BUDGET_OVERRUN', (policy) => { policy.budgets.costUnits = 2; }],
    ['RETRY_TIME_BUDGET_OVERRUN', (policy) => { policy.budgets.maximumRetryTimeMs = 5_000; }],
  ];
  for (const [code, mutate] of overruns) {
    const policy = structuredClone(fixture.policy);
    mutate(policy);
    const assessment = evaluateRepairLoop(policy, fixture.evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL', code);
    assert.ok(assessment.violationCodes.includes(code), assessment.reasonCodes.join(','));
    assert.equal(assessment.terminationWithinDeclaredBudget, false);
  }
});

test('historical progress triggers forbid a later attempt even if final containment exists', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const evidence = structuredClone(fixture.evidence);
  const prior = evidence.attempts.at(-1);
  prior.nextRetryAtMs = FIXTURE_NOW_MS - 4_000;
  evidence.attempts.push({
    ...structuredClone(prior),
    attemptId: 'attempt.4',
    localAttempt: 4,
    globalAttempt: 4,
    startedAtMs: FIXTURE_NOW_MS - 4_000,
    completedAtMs: FIXTURE_NOW_MS - 3_000,
    beforeStateRef: 'synthetic.state.before.4',
    actionRef: 'synthetic.action.4',
    afterStateRef: 'synthetic.state.after.4',
    materialEventOrLedgerRef: 'synthetic.material-event.4',
    cockpitTraceRef: 'synthetic.cockpit-trace.4',
    progressValue: 1.4,
    producerEvidenceRef: 'synthetic.producer-evidence.4',
    verifierEvidenceRef: 'synthetic.verifier-evidence.4',
    producerObservedAtMs: FIXTURE_NOW_MS - 2_900,
    verifierObservedAtMs: FIXTURE_NOW_MS - 2_800,
    nextRetryAtMs: null,
  });
  refreshAttemptEvidence(evidence);
  const assessment = evaluateRepairLoop(fixture.policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('ATTEMPT_AFTER_PROGRESS_TERMINATION_TRIGGER'));
});

test('an aged no-progress trigger cannot disappear before a later successful-looking attempt', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE');
  const policy = structuredClone(fixture.policy);
  policy.budgets.maximumRetryTimeMs = 50_000;
  const evidence = structuredClone(fixture.evidence);
  evidence.campaignStartedAtMs = FIXTURE_NOW_MS - 50_000;
  evidence.conflictGraphEvidence.observedCampaigns[0].startedAtMs = evidence.campaignStartedAtMs;
  evidence.lease.acquiredAtMs = evidence.campaignStartedAtMs;
  evidence.lease.lastRenewedAtMs = FIXTURE_NOW_MS - 5_000;
  evidence.containment = {
    lifecycle: null,
    durableUnresolvedEvidenceRef: null,
    escalationOwner: null,
    furtherAutomaticActuation: true,
  };
  const starts = [-45_000, -40_000, -35_000, -10_000].map((offset) => FIXTURE_NOW_MS + offset);
  const progress = [1, 1.1, 1.2, 3.5];
  const attempts = [...evidence.attempts, structuredClone(evidence.attempts.at(-1))];
  attempts.forEach((attempt, index) => {
    attempt.attemptId = `attempt.aged-no-progress.${index + 1}`;
    attempt.localAttempt = index + 1;
    attempt.globalAttempt = index + 1;
    attempt.startedAtMs = starts[index];
    attempt.completedAtMs = starts[index] + 1_000;
    attempt.producerObservedAtMs = starts[index] + 1_100;
    attempt.verifierObservedAtMs = starts[index] + 1_200;
    attempt.progressValue = progress[index];
    attempt.nextRetryAtMs = starts[index + 1] ?? null;
    attempt.circuitState = index === attempts.length - 1 ? 'CLOSED' : 'HALF_OPEN';
    attempt.result = index === attempts.length - 1 ? 'SUCCEEDED' : 'FAILED';
    attempt.producerPredicate = index === attempts.length - 1 ? 'PASS' : 'FAIL';
    attempt.independentVerifier = index === attempts.length - 1 ? 'PASS' : 'FAIL';
    attempt.producerEvidenceRef = `synthetic.aged-producer.${index + 1}`;
    attempt.verifierEvidenceRef = `synthetic.aged-verifier.${index + 1}`;
  });
  evidence.attempts = attempts;
  refreshAttemptEvidence(evidence);
  const latest = attempts.at(-1);
  evidence.postconditionWindow = {
    producerEvidenceRef: latest.producerEvidenceRef,
    verifierEvidenceRef: latest.verifierEvidenceRef,
    producerOwner: latest.producerOwner,
    verifierOwner: latest.verifierOwner,
    firstIndependentPassAtMs: FIXTURE_NOW_MS - 8_000,
    lastIndependentPassAtMs: FIXTURE_NOW_MS - 2_000,
    commonModeIndependence: 'PASS',
  };
  const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.triggerCodes.includes('NO_PROGRESS_THRESHOLD_REACHED'));
  assert.ok(assessment.violationCodes.includes('ATTEMPT_AFTER_HISTORICAL_TERMINATION_TRIGGER'));
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
  assert.equal(assessment.progressEvidence.historicalTerminationTriggerDetected, true);
});

test('aged oscillation and controller-conflict history cannot be erased by a later current-owner success', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R06_ALTERNATING_CONTROLLERS_QUARANTINE_AND_ESCALATE');
  const policy = structuredClone(fixture.policy);
  policy.budgets.maximumRetryTimeMs = 50_000;
  const evidence = structuredClone(fixture.evidence);
  evidence.campaignStartedAtMs = FIXTURE_NOW_MS - 50_000;
  evidence.conflictGraphEvidence.observedCampaigns[0].startedAtMs = evidence.campaignStartedAtMs;
  evidence.lease.acquiredAtMs = evidence.campaignStartedAtMs;
  evidence.lease.lastRenewedAtMs = FIXTURE_NOW_MS - 5_000;
  evidence.containment = {
    lifecycle: null,
    durableUnresolvedEvidenceRef: null,
    escalationOwner: null,
    furtherAutomaticActuation: true,
  };
  const starts = [-45_000, -40_000, -35_000, -30_000, -10_000].map((offset) => FIXTURE_NOW_MS + offset);
  const attempts = [...evidence.attempts, structuredClone(evidence.attempts.at(-1))];
  attempts.forEach((attempt, index) => {
    attempt.attemptId = `attempt.aged-oscillation.${index + 1}`;
    attempt.localAttempt = index + 1;
    attempt.globalAttempt = index + 1;
    attempt.startedAtMs = starts[index];
    attempt.completedAtMs = starts[index] + 1_000;
    attempt.producerObservedAtMs = starts[index] + 1_100;
    attempt.verifierObservedAtMs = starts[index] + 1_200;
    attempt.nextRetryAtMs = starts[index + 1] ?? null;
    attempt.producerEvidenceRef = `synthetic.aged-oscillation-producer.${index + 1}`;
    attempt.verifierEvidenceRef = `synthetic.aged-oscillation-verifier.${index + 1}`;
  });
  const latest = attempts.at(-1);
  Object.assign(latest, {
    controllerId: evidence.lease.ownerId,
    completionApplied: true,
    fenceEpoch: evidence.currentFenceEpoch,
    actionDirection: 'INCREASE',
    progressValue: 4,
    result: 'SUCCEEDED',
    circuitState: 'CLOSED',
    producerPredicate: 'PASS',
    independentVerifier: 'PASS',
  });
  evidence.attempts = attempts;
  refreshAttemptEvidence(evidence);
  evidence.postconditionWindow = {
    producerEvidenceRef: latest.producerEvidenceRef,
    verifierEvidenceRef: latest.verifierEvidenceRef,
    producerOwner: latest.producerOwner,
    verifierOwner: latest.verifierOwner,
    firstIndependentPassAtMs: FIXTURE_NOW_MS - 8_000,
    lastIndependentPassAtMs: FIXTURE_NOW_MS - 2_000,
    commonModeIndependence: 'PASS',
  };
  const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.triggerCodes.includes('OSCILLATION_SIGNATURE_DETECTED')
    || assessment.triggerCodes.includes('CONFLICTING_CONTROLLERS_PRESENT'));
  assert.ok(assessment.violationCodes.includes('ATTEMPT_AFTER_OSCILLATION_OR_CONTROLLER_CONFLICT_TRIGGER'));
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
});

test('repair circuit posture gates promotion and further actuation', () => {
  for (const state of ['HALF_OPEN', 'UNKNOWN']) {
    const evidence = structuredClone(makeRepairEvidence());
    evidence.attempts.at(-1).circuitState = state;
    refreshAttemptEvidence(evidence);
    let assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'UNKNOWN');
    assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
    evidence.nextActuationRequested = true;
    assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.violationCodes.includes('ACTUATION_REQUESTED_WITH_UNPROVED_CIRCUIT_STATE'));
  }

  const open = structuredClone(makeRepairEvidence());
  open.attempts.at(-1).circuitState = 'OPEN';
  refreshAttemptEvidence(open);
  const assessment = evaluateRepairLoop(makeRepairPolicy(), open, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.triggerCodes.includes('REPAIR_CIRCUIT_OPEN'));
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');
});

test('restart can restore safely before another attempt and preserves wall-time budget', () => {
  const evidence = structuredClone(makeRepairEvidence());
  const expectedState = {
    localAttempts: 2,
    globalAttempts: 2,
    remainingRetryTimeMs: 15_800,
    remainingRateUnits: 98,
    remainingResourceUnits: 98,
    remainingCostUnits: 98,
    cooldownUntilMs: FIXTURE_NOW_MS - 11_800,
    convergenceDeadlineAtMs: FIXTURE_NOW_MS + 40_000,
    leaseId: 'synthetic.lease.repair.003',
    fenceEpoch: 3,
    lateResultLaw: REPAIR_LATE_RESULT_LAW,
  };
  evidence.restartEvidence = {
    restored: true,
    preservedCampaignId: true,
    checkpointRef: 'synthetic.checkpoint.restore-before-next-attempt',
    stateDigestBeforeRestart: 'synthetic.state.restart-stable',
    stateDigestAfterRestart: 'synthetic.state.restart-stable',
    restoredCampaignId: evidence.campaignId,
    stateBeforeRestart: structuredClone(expectedState),
    stateAfterRestart: structuredClone(expectedState),
    preservedFields: ['attempts', 'budgets', 'cooldown', 'lease', 'lateResultLaw', 'convergenceDeadline'],
    attemptCountBeforeRestart: 2,
    restoredAttemptCount: 2,
    remainingCostUnitsBeforeRestart: 98,
    remainingCostUnitsAfterRestart: 98,
  };
  let assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS', assessment.reasonCodes.join(','));
  assert.equal(assessment.violationCodes.includes('RESTART_ATTEMPT_BOUNDARY_INVALID'), false);

  evidence.restartEvidence.stateBeforeRestart.remainingRetryTimeMs = 19_000;
  evidence.restartEvidence.stateAfterRestart.remainingRetryTimeMs = 19_000;
  assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('RESTART_RESET_CAMPAIGN_OR_BUDGET'));
});

test('non-restored campaigns reject every affirmative or contradictory restart claim', () => {
  const evidence = structuredClone(makeRepairEvidence());
  Object.assign(evidence.restartEvidence, {
    checkpointRef: 'synthetic.unexpected-checkpoint',
    stateDigestBeforeRestart: 'synthetic.before',
    stateDigestAfterRestart: 'synthetic.after',
    preservedCampaignId: true,
    preservedFields: ['attempts'],
    attemptCountBeforeRestart: 99,
    restoredAttemptCount: 1,
    remainingCostUnitsBeforeRestart: 0,
    remainingCostUnitsAfterRestart: 99,
  });
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'UNEXPECTED_RESTART_STATE'));
});

test('FAILED_ATTENTION_REQUIRED must retain the policy escalation owner', () => {
  const fixture = REPAIR_FIXTURES.find((entry) => entry.id === 'R06_ALTERNATING_CONTROLLERS_QUARANTINE_AND_ESCALATE');
  const evidence = structuredClone(fixture.evidence);
  evidence.containment.escalationOwner = 'different.owner';
  const assessment = evaluateRepairLoop(fixture.policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessment.containmentEvidenceSufficient, false);
  assert.ok(assessment.violationCodes.includes('TERMINAL_CONTAINMENT_EVIDENCE_INVALID'));
});

test('every attempt carries bounded actuation-gate and owner-circuit evidence into the assessment', () => {
  const evidence = makeRepairEvidence();
  const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS', assessment.reasonCodes.join(','));
  assert.deepEqual(Object.keys(assessment.actuationGateBinding).sort(), [
    'conflictGraphEvidenceRef', 'conflictGraphMaxAgeMs', 'conflictGraphObservedAtMs',
    'readinessEvidenceRef', 'readinessMaxAgeMs', 'readinessObservedAtMs',
  ]);
  assert.deepEqual(assessment.actuationGateBinding, {
    readinessEvidenceRef: evidence.readinessEvidence.evidenceRef,
    readinessObservedAtMs: evidence.readinessEvidence.observedAtMs,
    readinessMaxAgeMs: evidence.readinessEvidence.maxAgeMs,
    conflictGraphEvidenceRef: evidence.conflictGraphEvidence.evidenceRef,
    conflictGraphObservedAtMs: evidence.conflictGraphEvidence.observedAtMs,
    conflictGraphMaxAgeMs: evidence.conflictGraphEvidence.maxAgeMs,
  });
  assert.equal(Object.isFrozen(assessment.actuationGateBinding), true);
  assert.equal(assessment.attemptEvidence.length, 2);
  assert.deepEqual(Object.keys(assessment.attemptEvidence[0]).sort(), [
    'actuationGateEvidence', 'attemptId', 'circuitEvidence', 'completedAtMs',
    'producerFailureDomain', 'producerOwner', 'startedAtMs',
  ]);
  assert.equal(assessment.attemptEvidence[0].producerOwner, evidence.attempts[0].producerOwner);
  assert.equal(
    assessment.attemptEvidence[0].producerFailureDomain,
    evidence.attempts[0].producerFailureDomain,
  );
  assert.equal(assessment.attemptEvidence[0].circuitEvidence.mayCloseOrReset, false);
  assert.deepEqual(assessment.circuitPosture, {
    state: 'CLOSED',
    evidenceFresh: true,
    independentCloseProven: true,
  });
  assert.equal(Object.isFrozen(assessment.attemptEvidence), true);
});

test('per-attempt readiness and conflict snapshots are fresh before actuation', () => {
  for (const [field, valueAt, expectedCode] of [
    ['readinessObservedAtMs', (attempt) => attempt.startedAtMs + 1, 'ATTEMPT_READINESS_EVIDENCE_FROM_FUTURE'],
    ['readinessObservedAtMs', (attempt) => attempt.startedAtMs - attempt.actuationGateEvidence.readinessMaxAgeMs - 1, 'ATTEMPT_READINESS_EVIDENCE_STALE'],
    ['conflictGraphObservedAtMs', (attempt) => attempt.startedAtMs + 1, 'ATTEMPT_CONFLICT_GRAPH_EVIDENCE_FROM_FUTURE'],
    ['conflictGraphObservedAtMs', (attempt) => attempt.startedAtMs - attempt.actuationGateEvidence.conflictGraphMaxAgeMs - 1, 'ATTEMPT_CONFLICT_GRAPH_EVIDENCE_STALE'],
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    const attempt = evidence.attempts[0];
    attempt.actuationGateEvidence[field] = valueAt(attempt);
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL', expectedCode);
    assert.equal(assessmentHasCode(assessment, expectedCode), true, `${expectedCode}: ${JSON.stringify(assessment)}`);
  }
});

test('fresh arbitrary labels cannot replace campaign readiness or conflict evidence', () => {
  for (const [field, forgedValue, expectedCode] of [
    ['readinessEvidenceRef', 'synthetic.fresh-unbound-readiness', 'ATTEMPT_READINESS_EVIDENCE_BINDING_MISMATCH'],
    ['conflictGraphEvidenceRef', 'synthetic.fresh-unbound-conflict-graph', 'ATTEMPT_CONFLICT_GRAPH_EVIDENCE_BINDING_MISMATCH'],
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    evidence.attempts[0].actuationGateEvidence[field] = forgedValue;
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.equal(assessmentHasCode(assessment, expectedCode), true, `${expectedCode}: ${JSON.stringify(assessment)}`);
  }
});

test('repair circuit evidence is state-bound, chained, and gates the next attempt', () => {
  const mismatch = structuredClone(makeRepairEvidence());
  mismatch.attempts[0].circuitEvidence.state = 'OPEN';
  let assessment = evaluateRepairLoop(makeRepairPolicy(), mismatch, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessmentHasCode(assessment, 'ATTEMPT_CIRCUIT_STATE_EVIDENCE_MISMATCH'), true);

  const brokenChain = structuredClone(makeRepairEvidence());
  brokenChain.attempts[1].circuitEvidence.priorEvidenceRef = 'synthetic.forged-prior-circuit';
  assessment = evaluateRepairLoop(makeRepairPolicy(), brokenChain, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessmentHasCode(assessment, 'REPAIR_CIRCUIT_PRIOR_EVIDENCE_CHAIN_INVALID'), true);

  const openBeforeRetry = structuredClone(makeRepairEvidence());
  openBeforeRetry.attempts[0].circuitState = 'OPEN';
  refreshAttemptEvidence(openBeforeRetry);
  assessment = evaluateRepairLoop(makeRepairPolicy(), openBeforeRetry, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('NEXT_ATTEMPT_WHILE_CIRCUIT_OPEN'));
});

test('linked repair circuit owner, domain, and transition history cannot be forged', () => {
  for (const [field, forgedValue, expectedCode] of [
    ['canonicalOwner', 'synthetic.forged-circuit-owner', 'REPAIR_CIRCUIT_OWNER_CHAIN_MISMATCH'],
    ['ownerFailureDomain', 'synthetic.forged-circuit-domain', 'REPAIR_CIRCUIT_OWNER_FAILURE_DOMAIN_CHAIN_MISMATCH'],
    ['halfOpenAtMs', FIXTURE_NOW_MS - 15_000, 'REPAIR_CIRCUIT_TRANSITION_HISTORY_CHAIN_INVALID'],
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    evidence.attempts[1].circuitEvidence[field] = forgedValue;
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.equal(assessmentHasCode(assessment, expectedCode), true, `${field}: ${JSON.stringify(assessment)}`);
  }
});

test('stale or common-mode circuit-close evidence cannot prove promotion', () => {
  const stale = structuredClone(makeRepairEvidence());
  stale.attempts.at(-1).circuitEvidence.maxAgeMs = 1;
  let assessment = evaluateRepairLoop(makeRepairPolicy(), stale, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.ok(assessment.unknownCodes.includes('REPAIR_CIRCUIT_EVIDENCE_STALE'));
  assert.equal(assessment.promotionEvidence, 'NOT_PROVEN');

  const commonMode = structuredClone(makeRepairEvidence());
  commonMode.attempts.at(-1).circuitEvidence.independentCloseOwner = commonMode.attempts.at(-1).circuitEvidence.canonicalOwner;
  assessment = evaluateRepairLoop(makeRepairPolicy(), commonMode, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessmentHasCode(assessment, 'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_FORBIDDEN'), true);
});

test('repair producer owner and failure-domain cannot self-prove circuit close', () => {
  for (const [field, forgedValueAt, expectedCode] of [
    [
      'independentCloseOwner',
      (attempt) => attempt.producerOwner,
      'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_OWNER_FORBIDDEN',
    ],
    [
      'independentCloseFailureDomain',
      (attempt) => attempt.producerFailureDomain,
      'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_FAILURE_DOMAIN_FORBIDDEN',
    ],
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    const attempt = evidence.attempts.at(-1);
    attempt.circuitEvidence[field] = forgedValueAt(attempt);
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.equal(assessmentHasCode(assessment, expectedCode), true, `${expectedCode}: ${JSON.stringify(assessment)}`);
  }
});

test('attempt producer and verifier identities bind their canonical policy signals', () => {
  for (const [field, forgedValue] of [
    ['producerOwner', 'synthetic.forged-producer-owner'],
    ['producerFailureDomain', 'synthetic.forged-producer-domain'],
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    evidence.attempts.at(-1)[field] = forgedValue;
    const assessment = evaluateRepairLoop(makeRepairPolicy(), evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.equal(assessmentHasCode(assessment, 'ATTEMPT_PRODUCER_EVIDENCE_BINDING_MISMATCH'), true);
  }

  const forgedVerifier = structuredClone(makeRepairEvidence());
  forgedVerifier.attempts[0].verifierOwner = 'synthetic.forged-verifier-owner';
  const assessment = evaluateRepairLoop(makeRepairPolicy(), forgedVerifier, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessmentHasCode(assessment, 'ATTEMPT_VERIFIER_EVIDENCE_BINDING_MISMATCH'), true);
});

test('resource assessment rows preserve source freshness metadata', () => {
  const bundle = makeResourceEvidenceBundle();
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS');
  assert.deepEqual(
    assessment.rows.map(({ rowId, observedAtMs, maxAgeMs }) => ({ rowId, observedAtMs, maxAgeMs })),
    bundle.rows.map(({ rowId, observedAtMs, maxAgeMs }) => ({ rowId, observedAtMs, maxAgeMs })),
  );
});

test('paired lease and policy owner forgery loses the independent registration binding', () => {
  const policy = structuredClone(makeRepairPolicy());
  const evidence = structuredClone(makeRepairEvidence());
  policy.fencingOwner = 'controller.forged';
  evidence.lease.ownerId = 'controller.forged';
  for (const attempt of evidence.attempts) attempt.controllerId = 'controller.forged';
  const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.equal(assessmentHasCode(assessment, 'FENCING_OWNER_REGISTRATION_MISMATCH'), true);
});

test('derived attempt-budget arithmetic fails closed before numeric precision is lost', () => {
  for (const [field, expectedCode] of [
    ['rateUnits', 'RATE_BUDGET_ARITHMETIC_OVERFLOW'],
    ['resourceUnits', 'RESOURCE_BUDGET_ARITHMETIC_OVERFLOW'],
    ['costUnits', 'COST_BUDGET_ARITHMETIC_OVERFLOW'],
  ]) {
    const policy = structuredClone(makeRepairPolicy());
    policy.budgets[field] = Number.MAX_SAFE_INTEGER;
    const evidence = structuredClone(makeRepairEvidence());
    for (const attempt of evidence.attempts) attempt[field] = Number.MAX_SAFE_INTEGER;
    const assessment = evaluateRepairLoop(policy, evidence, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL', expectedCode);
    assert.ok(assessment.violationCodes.includes(expectedCode), assessment.reasonCodes.join(','));
    assert.equal(assessment.budgetEvidence[field], null);
  }

  const progress = structuredClone(makeRepairEvidence());
  progress.attempts[0].progressValue = -Number.MAX_SAFE_INTEGER;
  progress.attempts[1].progressValue = Number.MAX_SAFE_INTEGER;
  const assessment = evaluateRepairLoop(makeRepairPolicy(), progress, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('PROGRESS_ARITHMETIC_OVERFLOW'));
});
