import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANCELLATION_LATE_RESULT_LAW,
  OPTIONAL_SHEDDING_CLASSES,
  PROTECTED_WORK_CLASSES,
  RESOURCE_FAMILIES,
} from '../../../../fixtures/productAssurance/systemic/stability/contracts.mjs';
import {
  CANCELLATION_FIXTURES,
  FIXTURE_NOW_MS as EVALUATOR_NOW_MS,
} from '../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs';
import { evaluateCancellationEvidence } from '../../../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs';
import { projectStabilityViewModel } from '../../../../fixtures/productAssurance/systemic/stability/view-model.mjs';

const FIXTURE_NOW_MS = 1_800_000_000_000;

function authority() {
  return { dataAuthority: 'SYNTHETIC_TEST', effectAuthority: 'NONE' };
}

function cancellationAssessment(recordId, assuranceResult, override = {}) {
  return {
    schemaVersion: 'ip-assurance.systemic.stability.v1',
    assessmentKind: 'CANCELLATION_DEADLINE_LEASE',
    recordId,
    requestId: `request.${recordId}`,
    operationId: `operation.${recordId}`,
    canonicalOwner: 'fixture.owner',
    lateResultLaw: CANCELLATION_LATE_RESULT_LAW,
    evaluatedAtMs: FIXTURE_NOW_MS,
    assuranceResult,
    deadlineEvidence: 'ACTIVE',
    effectiveDeadlineAtMs: FIXTURE_NOW_MS + 1_000,
    leaseEvidence: 'NOT_APPLICABLE',
    cancelIntentObserved: false,
    cancellationSupported: true,
    cancellationProvesMutationAbsence: false,
    mayInitiateNewLocalEffects: true,
    authoritativeReconciliationRequired: false,
    detachedRecoveryContinuationRequired: false,
    lateFactDisposition: 'NOT_APPLICABLE',
    staleAuthorityRejected: false,
    reasonCodes: [],
    violationCodes: assuranceResult === 'FAIL' ? ['SYNTHETIC_FIXTURE_FAILURE'] : [],
    unknownCodes: assuranceResult === 'UNKNOWN' ? ['SYNTHETIC_FIXTURE_UNKNOWN'] : [],
    contractIssues: [],
    ...authority(),
    ...override,
  };
}

function repairAssessment(campaignId, assuranceResult, override = {}) {
  return {
    schemaVersion: 'ip-assurance.systemic.stability.v1',
    assessmentKind: 'REPAIR_CONTROL_LOOP',
    campaignId,
    policyId: `policy.${campaignId}`,
    canonicalOwner: 'fixture.owner',
    evaluatedAtMs: FIXTURE_NOW_MS,
    assuranceResult,
    reasonCodes: [],
    violationCodes: [],
    unknownCodes: [],
    triggerCodes: [],
    progressEvidence: {
      trailingNoProgress: 0,
      contradictoryCount: 0,
      rollbackCount: 0,
      alternations: 0,
      netProgress: 1,
      noProgressWindowStartMs: FIXTURE_NOW_MS - 20_000,
      missingProgress: false,
      conflictingControllersPresent: false,
      historicalTerminationTriggerDetected: false,
      firstHistoricalTriggerAtMs: null,
    },
    budgetEvidence: {
      attempts: 1,
      retryTimeMs: 1_000,
      retryExecutionTimeMs: 1_000,
      rateUnits: 1,
      resourceUnits: 1,
      costUnits: 1,
      observedConcurrentActuations: 1,
    },
    terminationClaim: 'BOUNDED_BY_DECLARED_EVIDENCE',
    terminationWithinDeclaredBudget: true,
    containmentEvidenceSufficient: false,
    containmentLifecycle: null,
    durableUnresolvedEvidenceRef: null,
    escalationOwner: null,
    promotionEvidence: 'INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD_PROVEN_FOR_OWNER_REVIEW',
    requiredCanonicalResponse: 'NONE',
    automaticActionIssued: false,
    contractIssues: [],
    ...authority(),
    ...override,
  };
}

function resourceRow(resourceFamily, assuranceResult = 'PASS', override = {}) {
  return {
    rowId: `resource.${resourceFamily.toLowerCase()}`,
    resourceFamily,
    assuranceResult,
    reasonCodes: [],
    currentBurn: 40,
    budgetLimit: 100,
    budgetRemaining: 60,
    forecast: 50,
    forecastHorizonMs: 60_000,
    unknownReason: null,
    unknownReasons: { burn: null, budget: null, forecast: null },
    topConsumers: [{
      consumerId: `consumer.${resourceFamily.toLowerCase()}`,
      amount: 20,
      unknownReason: null,
      evidenceRef: `synthetic.consumer-evidence.${resourceFamily.toLowerCase()}`,
    }],
    throttlingEvidence: {
      observed: 'INACTIVE',
      observedAtMs: FIXTURE_NOW_MS - 100,
      maxAgeMs: 5_000,
      evidenceRef: `synthetic.throttle-evidence.${resourceFamily.toLowerCase()}`,
      unknownReason: null,
      canonicalOwner: 'fixture.resource.owner',
    },
    circuitEvidence: {
      state: 'CLOSED',
      canonicalOwner: 'fixture.circuit.owner',
      ownerFailureDomain: 'fixture.circuit-owner',
      observedAtMs: FIXTURE_NOW_MS - 100,
      maxAgeMs: 5_000,
      evidenceRef: `synthetic.circuit-evidence.${resourceFamily.toLowerCase()}`,
      unknownReason: null,
      baselineNeverOpenedEvidenceRef: `synthetic.circuit-baseline.${resourceFamily.toLowerCase()}`,
      baselineEvidenceOwner: 'fixture.independent-circuit-baseline.owner',
      baselineEvidenceFailureDomain: 'fixture.independent-circuit-baseline-domain',
      openedAtMs: null,
      halfOpenAtMs: null,
      closedAtMs: null,
      resetEligibleAtMs: null,
      independentCloseEvidenceRef: null,
      independentCloseOwner: null,
      independentCloseFailureDomain: null,
      mayCloseOrReset: false,
    },
    canonicalResponse: {
      kind: 'RECOMMENDATION',
      referenceId: `synthetic.recommendation.${resourceFamily.toLowerCase()}`,
      owner: 'fixture.resource.owner',
      wiringState: 'DRAFT_INSERTION_REQUEST',
      unknownReason: null,
    },
    protections: {
      materialMoneyEvidencePreserved: 'PASS',
      auditEvidencePreserved: 'PASS',
      safeRiskReductionUnblocked: 'PASS',
    },
    throttleDecision: null,
    commands: [],
    ...override,
  };
}

function resourceAssessment(assuranceResult, rows, override = {}) {
  return {
    schemaVersion: 'ip-assurance.systemic.stability.v1',
    assessmentKind: 'RESOURCE_COST_CIRCUIT_EVIDENCE',
    bundleId: 'resource.bundle.fixture',
    evaluatedAtMs: FIXTURE_NOW_MS,
    assuranceResult,
    rows,
    loadSheddingOrder: [...OPTIONAL_SHEDDING_CLASSES, ...PROTECTED_WORK_CLASSES],
    mayThrottle: false,
    mayExecute: false,
    mayCloseOrResetCircuit: false,
    controllerOwner: null,
    throttleDecision: null,
    commands: [],
    contractIssues: [],
    ...authority(),
    ...override,
  };
}

function assessmentInput() {
  const cancellationAssessments = [
    cancellationAssessment('cancel-observed', 'PASS', {
      cancelIntentObserved: true,
      mayInitiateNewLocalEffects: false,
      reasonCodes: ['CANCELLATION_INTENT_OBSERVED'],
    }),
    cancellationAssessment('reconciliation-required', 'FAIL', {
      authoritativeReconciliationRequired: true,
      reasonCodes: ['CANCELLATION_INTENT_DOES_NOT_PROVE_MUTATION_ABSENCE'],
    }),
  ];
  const repairAssessments = [repairAssessment('campaign.fixture', 'PASS')];
  const rows = RESOURCE_FAMILIES.map((family) => family === 'TELEMETRY_STORAGE'
    ? resourceRow(family, 'UNKNOWN', {
      forecast: null,
      forecastHorizonMs: null,
      unknownReason: 'forecast unavailable in fixture',
      unknownReasons: { burn: null, budget: null, forecast: 'forecast unavailable in fixture' },
      reasonCodes: ['BURN_BUDGET_OR_FORECAST_UNKNOWN'],
    })
    : resourceRow(family));
  return {
    cancellationAssessments,
    repairAssessments,
    resourceAssessment: resourceAssessment('UNKNOWN', rows),
  };
}

function passingResourceAssessment() {
  return resourceAssessment('PASS', RESOURCE_FAMILIES.map((family) => resourceRow(family)));
}

test('view model is deterministic, frozen, render-neutral, and honestly synthetic', () => {
  const input = assessmentInput();
  const first = projectStabilityViewModel(input, FIXTURE_NOW_MS);
  const second = projectStabilityViewModel(input, FIXTURE_NOW_MS);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.integrationStatus, 'DESIGNED');
  assert.equal(first.dataAuthority, 'SYNTHETIC_TEST');
  assert.equal(first.effectAuthority, 'NONE');
  assert.equal('authority' in first, false);
  assert.equal('wiringState' in first, false);
  assert.equal(first.overallAssuranceResult, 'FAIL');
});

test('view model exposes intent, reconciliation, leases, progress, budgets, unknown forecasts, and bundle posture', () => {
  const view = projectStabilityViewModel(assessmentInput(), FIXTURE_NOW_MS);
  assert.ok(view.deadlineLease.some((row) => row.cancellationIntentObserved === true));
  assert.ok(view.deadlineLease.some((row) => row.reconciliationRequired === true));
  assert.ok(view.repairLoops.some((row) => row.progressEvidence !== null && row.budgetEvidence !== null));
  assert.ok(view.resources.some((row) => row.resourceFamily === 'TELEMETRY_STORAGE' && row.forecast === null && row.unknownReason !== null));
  assert.ok(view.annunciators.some((row) => row.family === 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE' && row.assuranceResult === 'UNKNOWN'));
  assert.ok(view.annunciators.every((row) => ['PASS', 'FAIL', 'UNKNOWN'].includes(row.assuranceResult)));
});

test('view model never emits controls, throttle decisions, runtime claims, or effect authority', () => {
  const view = projectStabilityViewModel(assessmentInput(), FIXTURE_NOW_MS);
  assert.deepEqual(view.controls, []);
  assert.equal(view.throttleDecision, null);
  assert.equal(view.effectAuthority, 'NONE');
  assert.deepEqual(view.runtimeClaims, []);
  assert.ok(view.deadlineLease.every((row) => row.effectAuthority === 'NONE'));
  assert.ok(view.repairLoops.every((row) => row.effectAuthority === 'NONE' && row.automaticActionIssued === false));
  assert.ok(view.resources.every((row) => row.effectAuthority === 'NONE' && row.throttleDecision === null && row.commands.length === 0));
  assert.ok(view.nonClaims.some((entry) => entry.includes('does not declare recovery')));
});

test('attention ordering puts FAIL before UNKNOWN before PASS', () => {
  const view = projectStabilityViewModel(assessmentInput(), FIXTURE_NOW_MS);
  const rank = { FAIL: 0, UNKNOWN: 1, PASS: 2 };
  for (let index = 1; index < view.annunciators.length; index += 1) {
    assert.ok(rank[view.annunciators[index - 1].assuranceResult] <= rank[view.annunciators[index].assuranceResult]);
  }
});

test('contract-invalid resource bundle remains a top-level failure when rows are absent', () => {
  const invalidResourceAssessment = {
    schemaVersion: 'ip-assurance.systemic.stability.v1',
    assessmentKind: 'RESOURCE_COST_CIRCUIT_EVIDENCE',
    evaluatedAtMs: FIXTURE_NOW_MS,
    assuranceResult: 'FAIL',
    reasonCodes: ['CONTRACT_INVALID'],
    contractIssues: [{ path: '$.rows', code: 'RESOURCE_DENOMINATOR_MISMATCH', detail: 'exact resource denominator required' }],
    ...authority(),
  };
  assert.equal(invalidResourceAssessment.assuranceResult, 'FAIL');
  assert.equal(invalidResourceAssessment.rows, undefined);

  const view = projectStabilityViewModel({
    cancellationAssessments: [],
    repairAssessments: [],
    resourceAssessment: invalidResourceAssessment,
  }, FIXTURE_NOW_MS);
  const bundle = view.annunciators.find((entry) => entry.family === 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE');
  assert.equal(bundle.assuranceResult, 'FAIL');
  assert.ok(bundle.reasonCodes.includes('CONTRACT_INVALID'));
  assert.ok(bundle.reasonCodes.includes('RESOURCE_ROWS_MISSING'));
  assert.equal(view.overallAssuranceResult, 'FAIL');
  assert.deepEqual(view.resources, []);
});

test('empty assessment denominators remain unknown instead of becoming green', () => {
  const view = projectStabilityViewModel({
    cancellationAssessments: [],
    repairAssessments: [],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  assert.equal(view.overallAssuranceResult, 'UNKNOWN');
  assert.ok(view.annunciators.some((entry) => entry.family === 'ASSURANCE_CANCELLATION_DEADLINE_LEASE'
    && entry.reasonCodes.includes('ASSESSMENT_DENOMINATOR_EMPTY')));
  assert.ok(view.annunciators.some((entry) => entry.family === 'ASSURANCE_REMEDIATION_CONTROL_LOOP'
    && entry.reasonCodes.includes('ASSESSMENT_DENOMINATOR_EMPTY')));
  assert.ok(view.annunciators.some((entry) => entry.family === 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE'
    && entry.assuranceResult === 'PASS'));
});

test('malformed assessments and forbidden effect-authority claims render as failures with no effects', () => {
  const unsafe = assessmentInput();
  unsafe.cancellationAssessments = [null, {
    assessmentKind: 'CANCELLATION_DEADLINE_LEASE',
    assuranceResult: 'PASS',
    reasonCodes: [],
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'CONTROL',
  }];
  unsafe.repairAssessments = 'not-an-array';

  const view = projectStabilityViewModel(unsafe, FIXTURE_NOW_MS);
  assert.equal(view.overallAssuranceResult, 'FAIL');
  assert.equal(view.effectAuthority, 'NONE');
  assert.equal(view.deadlineLease.length, 2);
  assert.ok(view.deadlineLease.every((entry) => entry.assuranceResult === 'FAIL' && entry.effectAuthority === 'NONE'));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('ASSESSMENT_OBJECT_REQUIRED')));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('ASSESSMENT_EFFECT_AUTHORITY_FORBIDDEN')));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('ASSESSMENT_COLLECTION_INVALID')));
  assert.deepEqual(view.controls, []);
});

test('a forged PASS bundle with an empty denominator is forced to failure', () => {
  const forged = structuredClone(passingResourceAssessment());
  forged.rows = [];
  const view = projectStabilityViewModel({
    cancellationAssessments: [],
    repairAssessments: [],
    resourceAssessment: forged,
  }, FIXTURE_NOW_MS);
  const bundle = view.annunciators.find((entry) => entry.family === 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE');
  assert.equal(bundle.assuranceResult, 'FAIL');
  assert.ok(bundle.reasonCodes.includes('RESOURCE_ROWS_NOT_EXACTLY_BOUNDED'));
  assert.equal(view.overallAssuranceResult, 'FAIL');
});

test('future, contradictory, and authority-bearing PASS envelopes fail closed', () => {
  const unsafeCancellation = cancellationAssessment('unsafe-cancellation', 'PASS', {
    evaluatedAtMs: FIXTURE_NOW_MS + 1,
    cancellationProvesMutationAbsence: true,
    violationCodes: ['FORGED_PASS_VIOLATION'],
  });
  const unsafeRepair = repairAssessment('unsafe-repair', 'PASS', {
    automaticActionIssued: true,
    violationCodes: ['FORGED_PASS_VIOLATION'],
  });
  const unsafeResource = passingResourceAssessment();
  unsafeResource.mayThrottle = true;
  unsafeResource.mayExecute = true;
  unsafeResource.mayCloseOrResetCircuit = true;
  unsafeResource.controllerOwner = 'forged.controller';
  unsafeResource.throttleDecision = { kind: 'FORGED' };
  unsafeResource.commands = ['FORGED_COMMAND'];

  const view = projectStabilityViewModel({
    cancellationAssessments: [unsafeCancellation],
    repairAssessments: [unsafeRepair],
    resourceAssessment: unsafeResource,
  }, FIXTURE_NOW_MS);
  assert.equal(view.overallAssuranceResult, 'FAIL');
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('ASSESSMENT_EVALUATED_AT_INVALID')));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('ASSESSMENT_RESULT_CODE_MISMATCH')));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('CANCELLATION_ABSENCE_CLAIM_FORBIDDEN')));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('AUTOMATIC_ACTION_CLAIM_FORBIDDEN')));
  assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('RESOURCE_EFFECT_FIELDS_FORBIDDEN')));
  assert.deepEqual(view.controls, []);
  assert.deepEqual(view.resources, []);
  assert.deepEqual(view.loadSheddingOrder, []);
});

test('row-level circuit authority and bundle result contradictions cannot reach the view', () => {
  const unsafeCircuit = passingResourceAssessment();
  unsafeCircuit.rows[0].circuitEvidence.mayCloseOrReset = true;
  let view = projectStabilityViewModel({
    cancellationAssessments: [],
    repairAssessments: [],
    resourceAssessment: unsafeCircuit,
  }, FIXTURE_NOW_MS);
  const unsafeRow = view.resources.find((row) => row.resourceFamily === 'LLM_TOKENS');
  assert.equal(view.overallAssuranceResult, 'FAIL');
  assert.equal(unsafeRow.circuitEvidence, null);
  assert.ok(unsafeRow.reasonCodes.includes('RESOURCE_CIRCUIT_AUTHORITY_FORBIDDEN'));

  const mismatched = passingResourceAssessment();
  mismatched.rows[0].assuranceResult = 'UNKNOWN';
  mismatched.rows[0].reasonCodes = ['SYNTHETIC_UNKNOWN'];
  view = projectStabilityViewModel({
    cancellationAssessments: [],
    repairAssessments: [],
    resourceAssessment: mismatched,
  }, FIXTURE_NOW_MS);
  const bundle = view.annunciators.find((entry) => entry.family === 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE');
  assert.equal(bundle.assuranceResult, 'FAIL');
  assert.ok(bundle.reasonCodes.includes('RESOURCE_BUNDLE_RESULT_MISMATCH'));
});

test('terminal repair containment remains visible after its original trigger ages out', () => {
  const terminal = repairAssessment('campaign.terminal', 'PASS', {
    containmentEvidenceSufficient: true,
    containmentLifecycle: 'QUARANTINED',
    durableUnresolvedEvidenceRef: 'synthetic.unresolved.terminal',
    requiredCanonicalResponse: 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED',
    terminationWithinDeclaredBudget: true,
    terminationClaim: 'BOUNDED_BY_DECLARED_EVIDENCE',
    promotionEvidence: 'NOT_PROVEN',
    reasonCodes: ['DURABLE_TERMINAL_CONTAINMENT_ACTIVE'],
  });
  const view = projectStabilityViewModel({
    cancellationAssessments: [cancellationAssessment('baseline', 'PASS')],
    repairAssessments: [terminal],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  const row = view.repairLoops[0];
  assert.equal(row.containmentLifecycle, 'QUARANTINED');
  assert.equal(row.durableUnresolvedEvidenceRef, 'synthetic.unresolved.terminal');
  assert.equal(row.requiredCanonicalResponse, 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED');
  assert.equal(row.promotionEvidence, 'NOT_PROVEN');

  const forgedUnbounded = structuredClone(terminal);
  forgedUnbounded.terminationWithinDeclaredBudget = false;
  forgedUnbounded.terminationClaim = 'NOT_YET_PROVEN_WITHIN_DECLARED_BUDGET';
  const rejected = projectStabilityViewModel({
    cancellationAssessments: [cancellationAssessment('baseline', 'PASS')],
    repairAssessments: [forgedUnbounded],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  assert.equal(rejected.overallAssuranceResult, 'FAIL');
  assert.ok(rejected.repairLoops[0].reasonCodes.includes('REPAIR_PASS_CONTAINMENT_COHERENCE_INVALID'));
});

test('cancellation projection validates exact state semantics and preserves fenced continuation fields', () => {
  const fixture = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C09_REGISTERED_FENCED_RECOVERY_SURVIVES_PARENT_TIMEOUT');
  assert.equal(EVALUATOR_NOW_MS, FIXTURE_NOW_MS);
  const canonical = evaluateCancellationEvidence(fixture.input, FIXTURE_NOW_MS);
  let view = projectStabilityViewModel({
    cancellationAssessments: [canonical],
    repairAssessments: [],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  const row = view.deadlineLease[0];
  assert.equal(row.deadlineEvidence, 'EXPIRED');
  assert.equal(row.mayInitiateNewLocalEffects, false);
  assert.equal(row.detachedRecoveryContinuationRequired, true);
  assert.equal(row.cancellationSupported, true);

  const forged = structuredClone(canonical);
  forged.deadlineEvidence = 'GREEN_FOREVER';
  forged.leaseEvidence = 'CURRENT';
  forged.lateFactDisposition = 'ERASE_EXTERNAL_TRUTH';
  forged.mayInitiateNewLocalEffects = true;
  view = projectStabilityViewModel({
    cancellationAssessments: [forged],
    repairAssessments: [],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  assert.equal(view.overallAssuranceResult, 'FAIL');
  assert.equal(view.deadlineLease[0].deadlineEvidence, 'UNKNOWN');
  assert.equal(view.deadlineLease[0].mayInitiateNewLocalEffects, null);
  assert.ok(view.deadlineLease[0].reasonCodes.includes('CANCELLATION_ASSESSMENT_FIELDS_INVALID'));
});

test('repair projection rejects invented lifecycle, promotion, termination, and response labels', () => {
  const forged = repairAssessment('campaign.forged-repair-labels', 'PASS');
  Object.assign(forged, {
    terminationClaim: 'GREEN_UNBOUNDED',
    containmentLifecycle: 'RECOVERED',
    containmentEvidenceSufficient: true,
    escalationOwner: 'self-promoting.owner',
    promotionEvidence: 'SELF_REPORT_PROMOTED',
    requiredCanonicalResponse: 'PLACE_ORDER',
  });
  const view = projectStabilityViewModel({
    cancellationAssessments: [cancellationAssessment('baseline', 'PASS')],
    repairAssessments: [forged],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  assert.equal(view.overallAssuranceResult, 'FAIL');
  const row = view.repairLoops[0];
  assert.equal(row.containmentLifecycle, null);
  assert.equal(row.promotionEvidence, 'NOT_PROVEN');
  assert.equal(row.requiredCanonicalResponse, 'OWNER_REVIEW_REQUIRED');
  assert.ok(row.reasonCodes.includes('REPAIR_ASSESSMENT_FIELDS_INVALID'));
});

test('resource assessment enforces row identity, circuit freshness, and empty contract issues', () => {
  const cases = [
    ['RESOURCE_ROW_ID_DUPLICATE', (assessment) => { assessment.rows[1].rowId = assessment.rows[0].rowId; }],
    ['RESOURCE_PASS_WITH_STALE_CIRCUIT_EVIDENCE', (assessment) => { assessment.rows[0].circuitEvidence.observedAtMs = FIXTURE_NOW_MS - 10_000; }],
    ['ASSESSMENT_CONTRACT_ISSUES_RESULT_CONFLICT', (assessment) => {
      assessment.contractIssues.push({ path: '$.rows[0]', code: 'FORGED_ISSUE', detail: 'a PASS assessment cannot carry contract issues' });
    }],
  ];
  for (const [code, mutate] of cases) {
    const assessment = passingResourceAssessment();
    mutate(assessment);
    const view = projectStabilityViewModel({
      cancellationAssessments: [],
      repairAssessments: [],
      resourceAssessment: assessment,
    }, FIXTURE_NOW_MS);
    assert.equal(view.overallAssuranceResult, 'FAIL', code);
    assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes(code)), code);
  }
});

test('resource projection rejects inverted shedding and every nested authority or PASS contradiction', () => {
  const mutations = [
    ['RESOURCE_SHEDDING_PRIORITY_INVERTED', (assessment) => { assessment.loadSheddingOrder.reverse(); }, null],
    ['RESOURCE_PASS_WITH_UNPROVED_PROTECTIONS', (assessment) => { assessment.rows[0].protections.safeRiskReductionUnblocked = 'FAIL'; }, 'LLM_TOKENS'],
    ['RESOURCE_PASS_WHILE_BUDGET_EXHAUSTED', (assessment) => {
      assessment.rows[0].currentBurn = 100;
      assessment.rows[0].budgetRemaining = 0;
    }, 'LLM_TOKENS'],
    ['RESOURCE_THROTTLING_EVIDENCE_INVALID', (assessment) => {
      assessment.rows[0].throttlingEvidence.mayThrottle = true;
      assessment.rows[0].throttlingEvidence.command = 'FORGED_THROTTLE';
    }, 'LLM_TOKENS'],
    ['RESOURCE_CIRCUIT_EVIDENCE_INVALID', (assessment) => {
      assessment.rows[0].circuitEvidence.mayCloseCircuit = true;
      assessment.rows[0].circuitEvidence.resetCommand = 'FORGED_RESET';
    }, 'LLM_TOKENS'],
  ];
  for (const [expectedCode, mutate, family] of mutations) {
    const unsafe = passingResourceAssessment();
    mutate(unsafe);
    const view = projectStabilityViewModel({
      cancellationAssessments: [],
      repairAssessments: [],
      resourceAssessment: unsafe,
    }, FIXTURE_NOW_MS);
    assert.equal(view.overallAssuranceResult, 'FAIL', expectedCode);
    assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes(expectedCode)), expectedCode);
    if (family !== null) {
      const row = view.resources.find((entry) => entry.resourceFamily === family);
      assert.ok(row);
      assert.equal(row.throttleDecision, null);
      assert.deepEqual(row.commands, []);
      assert.equal(row.throttlingEvidence, null);
      assert.equal(row.circuitEvidence, null);
    } else {
      assert.deepEqual(view.loadSheddingOrder, []);
    }
  }
});

test('missing or null resource reason codes fail closed without throwing', () => {
  for (const mutate of [
    (row) => { delete row.reasonCodes; },
    (row) => { row.reasonCodes = null; },
  ]) {
    const assessment = passingResourceAssessment();
    mutate(assessment.rows[0]);
    let view;
    assert.doesNotThrow(() => { view = projectStabilityViewModel({
      cancellationAssessments: [],
      repairAssessments: [],
      resourceAssessment: assessment,
    }, FIXTURE_NOW_MS); });
    assert.equal(view.overallAssuranceResult, 'FAIL');
    assert.ok(view.annunciators.some((entry) => entry.reasonCodes.includes('RESOURCE_REASON_CODES_INVALID')));
  }
});

test('repair progress and budget projection is an exact authority-free whitelist', () => {
  const repair = repairAssessment('campaign.forged-nested-authority', 'PASS');
  repair.progressEvidence.mayActuate = true;
  repair.progressEvidence.commands = ['FORGED_REPAIR'];
  repair.budgetEvidence.resetBudget = true;
  const view = projectStabilityViewModel({
    cancellationAssessments: [cancellationAssessment('baseline', 'PASS')],
    repairAssessments: [repair],
    resourceAssessment: passingResourceAssessment(),
  }, FIXTURE_NOW_MS);
  assert.equal(view.overallAssuranceResult, 'FAIL');
  const row = view.repairLoops[0];
  assert.equal(row.progressEvidence, null);
  assert.equal(row.budgetEvidence, null);
  assert.equal(row.automaticActionIssued, false);
  assert.ok(row.reasonCodes.includes('REPAIR_PROGRESS_EVIDENCE_INVALID'));
  assert.ok(row.reasonCodes.includes('REPAIR_BUDGET_EVIDENCE_INVALID'));
});

test('view projection never freezes or mutates caller-owned assessment objects', () => {
  const input = assessmentInput();
  const before = structuredClone(input);
  const nestedResource = input.resourceAssessment.rows[0].circuitEvidence;
  const nestedRepair = input.repairAssessments[0].progressEvidence;
  const view = projectStabilityViewModel(input, FIXTURE_NOW_MS);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(nestedResource), false);
  assert.equal(Object.isFrozen(nestedRepair), false);
  assert.equal(Object.isFrozen(view), true);
  assert.notEqual(view.resources[0].circuitEvidence, nestedResource);
  assert.notEqual(view.repairLoops[0].progressEvidence, nestedRepair);
});
