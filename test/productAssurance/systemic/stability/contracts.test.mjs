import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSURANCE_RESULTS,
  REMEDIATION_CONTAINMENT_LIFECYCLES,
  OPERATION_CLASSES,
  RESOURCE_FAMILIES,
  STABILITY_SCHEMAS,
  STABILITY_SCHEMA_VERSION,
  STABILITY_STRUCTURE_LIMITS,
  validateCancellationEvidence,
  validateRepairEvidence,
  validateRepairPolicy,
  validateResourceEvidenceBundle,
} from '../../../../fixtures/productAssurance/systemic/stability/contracts.mjs';
import {
  FIXTURE_NOW_MS,
  makeCancellationEvidence,
  makeRepairEvidence,
  makeRepairPolicy,
  makeResourceEvidenceBundle,
} from '../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs';

test('S8 exposes one versioned packet-local schema family', () => {
  assert.equal(STABILITY_SCHEMA_VERSION, 'ip-assurance.systemic.stability.v1');
  assert.deepEqual(Object.keys(STABILITY_SCHEMAS).sort(), [
    'cancellationEvidence',
    'repairEvidence',
    'repairPolicyExtension',
    'resourceEvidenceBundle',
  ]);
  for (const schema of Object.values(STABILITY_SCHEMAS)) {
    assert.equal(schema.version, STABILITY_SCHEMA_VERSION);
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.required.length > 0);
    assert.ok(schema.laws.length > 0);
    assert.ok(Object.isFrozen(schema));
  }
});

test('schemas reuse the exact base operation classes and tri-state assurance result', () => {
  assert.deepEqual(OPERATION_CLASSES, [
    'PURE_READ',
    'REPLAYABLE_SUBSCRIPTION',
    'IDEMPOTENT_COMMAND',
    'NON_IDEMPOTENT_MUTATION',
    'MULTI_LEG_SAGA',
    'RISK_REDUCING_RECOVERY',
  ]);
  assert.deepEqual(ASSURANCE_RESULTS, ['PASS', 'FAIL', 'UNKNOWN']);
});

test('cancellation evidence accepts every canonical base operation class', () => {
  for (const operationClass of OPERATION_CLASSES) {
    assert.deepEqual(
      validateCancellationEvidence(makeCancellationEvidence({ operationClass })),
      [],
      operationClass,
    );
  }
});

test('S8 does not invent cancellation, oscillation, or durable-unresolved lifecycle states', () => {
  assert.deepEqual(REMEDIATION_CONTAINMENT_LIFECYCLES, [
    'QUARANTINED',
    'FAILED_ATTENTION_REQUIRED',
  ]);
  for (const invented of ['CANCELLED', 'OSCILLATING', 'DURABLE_UNRESOLVED']) {
    assert.equal(REMEDIATION_CONTAINMENT_LIFECYCLES.includes(invented), false);
  }
});

test('canonical fixture records pass strict contract validation', () => {
  assert.deepEqual(validateCancellationEvidence(makeCancellationEvidence()), []);
  assert.deepEqual(validateRepairPolicy(makeRepairPolicy()), []);
  assert.deepEqual(validateRepairEvidence(makeRepairEvidence()), []);
  assert.deepEqual(validateResourceEvidenceBundle(makeResourceEvidenceBundle()), []);
});

test('unknown fields and schema drift fail closed', () => {
  const cancellation = structuredClone(makeCancellationEvidence());
  cancellation.unregisteredStatus = 'CANCELLED';
  assert.ok(validateCancellationEvidence(cancellation).some((issue) => issue.code === 'EXACT_KEYS_REQUIRED'));

  const policy = structuredClone(makeRepairPolicy());
  policy.schemaVersion = 'ip-assurance.systemic.stability.v2';
  assert.ok(validateRepairPolicy(policy).some((issue) => issue.code === 'SCHEMA_UNSUPPORTED'));
});

test('long-lived controllers cannot smuggle in a root deadline', () => {
  const record = structuredClone(makeCancellationEvidence());
  record.requestKind = 'LONG_LIVED_LEASED';
  record.lease = {
    resourceId: 'source.public', ownerId: 'owner', processId: 'process', releaseId: 'release',
    leaseId: 'lease', fenceEpoch: 1, activeFenceEpoch: 1, acquiredAtMs: 1,
    renewalSequence: 1, lastRenewedAtMs: 1, lastHeartbeatAtMs: 1,
    heartbeatMaxAgeMs: 1_000, expiresAtMs: 2_000, completionEpoch: null,
    completionDisposition: 'NOT_OBSERVED',
  };
  const issues = validateCancellationEvidence(record);
  assert.ok(issues.some((issue) => issue.code === 'LONG_LIVED_ROOT_DEADLINE_FORBIDDEN'));
});

test('every cancellation record carries an explicit late-result law that survives restart', () => {
  const missing = structuredClone(makeCancellationEvidence());
  delete missing.lateResultLaw;
  assert.ok(validateCancellationEvidence(missing).some((issue) => issue.code === 'EXACT_KEYS_REQUIRED'));

  const empty = structuredClone(makeCancellationEvidence());
  empty.lateResultLaw = '';
  assert.ok(validateCancellationEvidence(empty).some((issue) => issue.code === 'LABEL_INVALID'));
});

test('repair contract includes §9.2 and base §3.4 evidence groups and rejects omissions', () => {
  for (const field of [
    'policyRevision', 'managedComponentId', 'commandRegistration',
    'controlledState', 'observedSignals', 'prerequisites', 'forbiddenContexts',
    'deadband', 'hysteresis', 'successPredicate', 'progressLaw', 'budgets',
    'oscillationLaw', 'rollbackCompensation', 'quarantineEscalation',
    'lateResultLaw', 'restartBehavior', 'resourceLeaseLaw', 'dependencies',
    'invariants', 'triggerEvidenceRequirements', 'failureFingerprintFields',
    'diagnosticConfidenceLaw', 'maximumScope', 'capitalPosture', 'predictedResult',
    'fencingOwner', 'repairConflictGraph', 'promotionLaw', 'reserveCapacityLaw',
    'circuitLaw',
  ]) {
    const policy = structuredClone(makeRepairPolicy());
    delete policy[field];
    assert.ok(validateRepairPolicy(policy).some((issue) => issue.code === 'EXACT_KEYS_REQUIRED'), field);
  }
});

test('repair attempts record campaign identity, before/action/after, circuit, trace, and independent evidence', () => {
  const evidence = makeRepairEvidence();
  const attempt = evidence.attempts[0];
  for (const field of [
    'attemptId', 'cause', 'policyRevision', 'beforeStateRef', 'actionRef',
    'afterStateRef', 'result', 'nextRetryAtMs', 'circuitState',
    'materialEventOrLedgerRef', 'cockpitTraceRef', 'producerEvidenceRef',
    'producerFailureDomain', 'verifierEvidenceRef', 'verifierIndependence', 'actuationGateEvidence',
    'circuitEvidence',
  ]) assert.ok(Object.hasOwn(attempt, field), field);
  assert.notEqual(attempt.producerEvidenceRef, attempt.verifierEvidenceRef);
  assert.notEqual(attempt.producerOwner, attempt.verifierOwner);
});

test('common-mode producer/verifier policy evidence fails closed', () => {
  const policy = structuredClone(makeRepairPolicy());
  policy.observedSignals[1].sourceOwner = policy.observedSignals[0].sourceOwner;
  assert.ok(validateRepairPolicy(policy).some((issue) => issue.code === 'COMMON_MODE_VERIFIER_FORBIDDEN'));
});

test('automatic local repair is restricted to the idempotent command operation class', () => {
  const policy = structuredClone(makeRepairPolicy());
  policy.operationClass = 'PURE_READ';
  assert.ok(validateRepairPolicy(policy).some((issue) => issue.code === 'AUTOMATIC_LOCAL_OPERATION_CLASS_REQUIRED'));
});

test('registered fencing-owner binding rejects paired policy and lease-owner forgery', () => {
  const policy = structuredClone(makeRepairPolicy());
  const evidence = structuredClone(makeRepairEvidence());
  policy.fencingOwner = 'controller.forged';
  evidence.lease.ownerId = 'controller.forged';
  for (const attempt of evidence.attempts) attempt.controllerId = 'controller.forged';

  assert.deepEqual(validateRepairEvidence(evidence), []);
  assert.ok(validateRepairPolicy(policy).some((issue) => issue.code === 'FENCING_OWNER_REGISTRATION_MISMATCH'));
});

test('malformed controlled resource sets and optional verifier signals fail closed without throwing', () => {
  const malformedResources = structuredClone(makeRepairPolicy());
  malformedResources.controlledState.resourceIds = null;
  let issues;
  assert.doesNotThrow(() => { issues = validateRepairPolicy(malformedResources); });
  assert.ok(issues.some((issue) => issue.code === 'STRING_ARRAY_REQUIRED'));

  const optionalVerifier = structuredClone(makeRepairPolicy());
  optionalVerifier.observedSignals[1].required = false;
  assert.ok(validateRepairPolicy(optionalVerifier).some((issue) => issue.code === 'VERIFIER_SIGNAL_MAPPING_INVALID'));
});

test('attempt identity and ordinal resets fail the strict campaign contract', () => {
  const evidence = structuredClone(makeRepairEvidence());
  evidence.attempts[1].attemptId = evidence.attempts[0].attemptId;
  evidence.attempts[1].localAttempt = 1;
  const codes = validateRepairEvidence(evidence).map((issue) => issue.code);
  assert.ok(codes.includes('DUPLICATE_ATTEMPT_ID'));
  assert.ok(codes.includes('LOCAL_ATTEMPT_SEQUENCE_INVALID'));
});

test('per-attempt gate and circuit evidence use strict exact contracts', () => {
  const missingGate = structuredClone(makeRepairEvidence());
  delete missingGate.attempts[0].actuationGateEvidence;
  assert.ok(validateRepairEvidence(missingGate).some((issue) => issue.code === 'EXACT_KEYS_REQUIRED'));

  const extraGateKey = structuredClone(makeRepairEvidence());
  extraGateKey.attempts[0].actuationGateEvidence.unregisteredTruth = 'PASS';
  assert.ok(validateRepairEvidence(extraGateKey).some((issue) => (
    issue.path === '$.attempts[0].actuationGateEvidence' && issue.code === 'EXACT_KEYS_REQUIRED'
  )));

  const extraCircuitKey = structuredClone(makeRepairEvidence());
  extraCircuitKey.attempts[0].circuitEvidence.syntheticCloseAuthority = true;
  assert.ok(validateRepairEvidence(extraCircuitKey).some((issue) => (
    issue.path === '$.attempts[0].circuitEvidence' && issue.code === 'EXACT_KEYS_REQUIRED'
  )));
});

test('each attempt requires gate evidence that is present and fresh at its own start', () => {
  const staleReadiness = structuredClone(makeRepairEvidence());
  const staleAttempt = staleReadiness.attempts[0];
  staleAttempt.actuationGateEvidence.readinessObservedAtMs = staleAttempt.startedAtMs
    - staleAttempt.actuationGateEvidence.readinessMaxAgeMs - 1;
  assert.ok(validateRepairEvidence(staleReadiness).some((issue) => issue.code === 'ATTEMPT_READINESS_EVIDENCE_STALE'));

  const futureConflictGraph = structuredClone(makeRepairEvidence());
  const futureAttempt = futureConflictGraph.attempts[0];
  futureAttempt.actuationGateEvidence.conflictGraphObservedAtMs = futureAttempt.startedAtMs + 1;
  assert.ok(validateRepairEvidence(futureConflictGraph).some((issue) => issue.code === 'ATTEMPT_CONFLICT_GRAPH_EVIDENCE_FROM_FUTURE'));
});

test('per-attempt gate references and observations bind the canonical campaign evidence', () => {
  const forgedReadiness = structuredClone(makeRepairEvidence());
  Object.assign(forgedReadiness.attempts[0].actuationGateEvidence, {
    readinessEvidenceRef: 'synthetic.fresh-but-unrelated-readiness',
    readinessObservedAtMs: forgedReadiness.attempts[0].startedAtMs - 1,
    readinessMaxAgeMs: 5_000,
  });
  assert.ok(validateRepairEvidence(forgedReadiness).some((issue) => (
    issue.code === 'ATTEMPT_READINESS_EVIDENCE_BINDING_MISMATCH'
  )));

  const forgedConflictGraph = structuredClone(makeRepairEvidence());
  Object.assign(forgedConflictGraph.attempts[0].actuationGateEvidence, {
    conflictGraphEvidenceRef: 'synthetic.fresh-but-unrelated-conflict-graph',
    conflictGraphObservedAtMs: forgedConflictGraph.attempts[0].startedAtMs - 1,
    conflictGraphMaxAgeMs: 5_000,
  });
  assert.ok(validateRepairEvidence(forgedConflictGraph).some((issue) => (
    issue.code === 'ATTEMPT_CONFLICT_GRAPH_EVIDENCE_BINDING_MISMATCH'
  )));
});

test('attempt circuit evidence matches state, chronology, and immediate prior owner evidence', () => {
  const mismatchedState = structuredClone(makeRepairEvidence());
  mismatchedState.attempts[0].circuitEvidence.state = 'OPEN';
  assert.ok(validateRepairEvidence(mismatchedState).some((issue) => issue.code === 'ATTEMPT_CIRCUIT_STATE_EVIDENCE_MISMATCH'));

  const stalePrior = structuredClone(makeRepairEvidence());
  stalePrior.attempts[1].circuitEvidence.priorEvidenceRef = 'synthetic.unrelated-circuit-evidence';
  assert.ok(validateRepairEvidence(stalePrior).some((issue) => issue.code === 'REPAIR_CIRCUIT_PRIOR_EVIDENCE_CHAIN_INVALID'));

  const missingPrior = structuredClone(makeRepairEvidence());
  missingPrior.attempts[0].circuitEvidence.priorEvidenceRef = null;
  assert.ok(validateRepairEvidence(missingPrior).some((issue) => issue.code === 'REPAIR_CIRCUIT_PRIOR_EVIDENCE_CHAIN_INVALID'));

  const beforeCompletion = structuredClone(makeRepairEvidence());
  beforeCompletion.attempts[0].circuitEvidence.observedAtMs = beforeCompletion.attempts[0].completedAtMs - 1;
  assert.ok(validateRepairEvidence(beforeCompletion).some((issue) => issue.code === 'CIRCUIT_EVIDENCE_BEFORE_ATTEMPT_COMPLETION'));

  const transitionAfterObservation = structuredClone(makeRepairEvidence());
  transitionAfterObservation.attempts[0].circuitEvidence.halfOpenAtMs
    = transitionAfterObservation.attempts[0].circuitEvidence.observedAtMs + 1;
  assert.ok(validateRepairEvidence(transitionAfterObservation).some((issue) => issue.code === 'CIRCUIT_TRANSITION_AFTER_OBSERVATION'));
});

test('linked circuit evidence preserves owner, failure domain, and carried transition history', () => {
  for (const [field, forgedValue, expectedCode] of [
    ['canonicalOwner', 'synthetic.forged-circuit-owner', 'REPAIR_CIRCUIT_OWNER_CHAIN_MISMATCH'],
    ['ownerFailureDomain', 'synthetic.forged-circuit-owner-domain', 'REPAIR_CIRCUIT_OWNER_FAILURE_DOMAIN_CHAIN_MISMATCH'],
    ['openedAtMs', FIXTURE_NOW_MS - 19_000, 'REPAIR_CIRCUIT_TRANSITION_HISTORY_CHAIN_INVALID'],
  ]) {
    const evidence = structuredClone(makeRepairEvidence());
    evidence.attempts[1].circuitEvidence[field] = forgedValue;
    const issues = validateRepairEvidence(evidence);
    assert.ok(issues.some((issue) => issue.code === expectedCode), `${field}: ${JSON.stringify(issues)}`);
  }
});

test('CLOSED attempt circuit evidence accepts independent baseline or transition proof and rejects common mode', () => {
  const baseline = structuredClone(makeRepairEvidence());
  baseline.attempts = [baseline.attempts[0]];
  baseline.attempts[0].circuitState = 'CLOSED';
  Object.assign(baseline.attempts[0].circuitEvidence, {
    state: 'CLOSED',
    priorEvidenceRef: null,
    baselineNeverOpenedEvidenceRef: 'synthetic.independent-baseline.never-opened',
    baselineEvidenceOwner: 'synthetic.independent-baseline-owner',
    baselineEvidenceFailureDomain: 'synthetic.independent-baseline-domain',
    openedAtMs: null,
    halfOpenAtMs: null,
    resetEligibleAtMs: null,
    closedAtMs: null,
    independentCloseEvidenceRef: null,
    independentCloseOwner: null,
    independentCloseFailureDomain: null,
  });
  assert.deepEqual(validateRepairEvidence(baseline), []);

  const transitioned = structuredClone(makeRepairEvidence());
  assert.deepEqual(validateRepairEvidence(transitioned), []);

  const incompleteBaseline = structuredClone(baseline);
  incompleteBaseline.attempts[0].circuitEvidence.baselineEvidenceFailureDomain = null;
  assert.ok(validateRepairEvidence(incompleteBaseline).some((issue) => issue.code === 'INDEPENDENT_CIRCUIT_BASELINE_EVIDENCE_REQUIRED'));

  const commonModeClose = structuredClone(makeRepairEvidence());
  commonModeClose.attempts[1].circuitEvidence.independentCloseOwner
    = commonModeClose.attempts[1].circuitEvidence.canonicalOwner;
  assert.ok(validateRepairEvidence(commonModeClose).some((issue) => issue.code === 'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_FORBIDDEN'));

  const producerOwnedClose = structuredClone(makeRepairEvidence());
  producerOwnedClose.attempts[1].circuitEvidence.independentCloseOwner
    = producerOwnedClose.attempts[1].producerOwner;
  assert.ok(validateRepairEvidence(producerOwnedClose).some((issue) => (
    issue.code === 'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_OWNER_FORBIDDEN'
  )));

  const producerDomainClose = structuredClone(makeRepairEvidence());
  producerDomainClose.attempts[1].circuitEvidence.independentCloseFailureDomain
    = producerDomainClose.attempts[1].producerFailureDomain;
  assert.ok(validateRepairEvidence(producerDomainClose).some((issue) => (
    issue.code === 'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_FAILURE_DOMAIN_FORBIDDEN'
  )));

  const producerOwnedBaseline = structuredClone(baseline);
  producerOwnedBaseline.attempts[0].circuitEvidence.baselineEvidenceOwner
    = producerOwnedBaseline.attempts[0].producerOwner;
  assert.ok(validateRepairEvidence(producerOwnedBaseline).some((issue) => (
    issue.code === 'COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_OWNER_FORBIDDEN'
  )));
});

test('resource denominator is exactly the eight accepted S8 families', () => {
  assert.deepEqual(RESOURCE_FAMILIES, [
    'LLM_TOKENS',
    'APIS',
    'BINANCE_RATE_LIMITS',
    'TELEMETRY_STORAGE',
    'REPLAY_COMPUTE',
    'DATABASE_WAL_GROWTH',
    'CLOUD_COST',
    'BACKGROUND_JOB_CONCURRENCY',
  ]);
  const missing = structuredClone(makeResourceEvidenceBundle());
  missing.rows.pop();
  assert.ok(validateResourceEvidenceBundle(missing).some((issue) => issue.code === 'RESOURCE_DENOMINATOR_MISMATCH'));
  const duplicate = structuredClone(makeResourceEvidenceBundle());
  duplicate.rows[7].resourceFamily = duplicate.rows[0].resourceFamily;
  assert.ok(validateResourceEvidenceBundle(duplicate).some((issue) => issue.code === 'RESOURCE_DENOMINATOR_MISMATCH'));

  const duplicateRowId = structuredClone(makeResourceEvidenceBundle());
  duplicateRowId.rows[1].rowId = duplicateRowId.rows[0].rowId;
  assert.ok(validateResourceEvidenceBundle(duplicateRowId).some((issue) => issue.code === 'DUPLICATE_RESOURCE_ROW_ID'));
});

test('all variable-size contract structures have explicit deterministic caps', () => {
  const policySignals = structuredClone(makeRepairPolicy());
  policySignals.observedSignals = Array.from(
    { length: STABILITY_STRUCTURE_LIMITS.observedSignals + 1 },
    () => structuredClone(policySignals.observedSignals[0]),
  );
  assert.ok(validateRepairPolicy(policySignals).some((issue) => issue.code === 'TOO_MANY_OBSERVED_SIGNALS'));

  const policyStrings = structuredClone(makeRepairPolicy());
  policyStrings.dependencies = Array.from(
    { length: STABILITY_STRUCTURE_LIMITS.stringArrayEntries + 1 },
    (_, index) => `dependency.${String(index).padStart(3, '0')}`,
  );
  assert.ok(validateRepairPolicy(policyStrings).some((issue) => issue.code === 'TOO_MANY_ARRAY_ENTRIES'));

  const attempts = structuredClone(makeRepairEvidence());
  attempts.attempts = Array.from(
    { length: STABILITY_STRUCTURE_LIMITS.repairAttempts + 1 },
    () => structuredClone(attempts.attempts[0]),
  );
  assert.ok(validateRepairEvidence(attempts).some((issue) => issue.code === 'TOO_MANY_REPAIR_ATTEMPTS'));

  const backoff = structuredClone(makeRepairPolicy());
  backoff.budgets.backoffScheduleMs = Array.from(
    { length: STABILITY_STRUCTURE_LIMITS.repairAttempts + 1 },
    (_, index) => index + 1,
  );
  assert.ok(validateRepairPolicy(backoff).some((issue) => issue.code === 'TOO_MANY_BACKOFF_ENTRIES'));

  const campaigns = structuredClone(makeRepairEvidence());
  campaigns.conflictGraphEvidence.observedCampaigns = Array.from(
    { length: STABILITY_STRUCTURE_LIMITS.conflictCampaigns + 1 },
    () => structuredClone(campaigns.conflictGraphEvidence.observedCampaigns[0]),
  );
  assert.ok(validateRepairEvidence(campaigns).some((issue) => issue.code === 'TOO_MANY_CONFLICT_CAMPAIGNS'));

  const consumers = structuredClone(makeResourceEvidenceBundle());
  consumers.rows[0].topConsumers = Array.from(
    { length: STABILITY_STRUCTURE_LIMITS.topConsumersPerResource + 1 },
    () => structuredClone(consumers.rows[0].topConsumers[0]),
  );
  assert.ok(validateResourceEvidenceBundle(consumers).some((issue) => issue.code === 'TOO_MANY_TOP_CONSUMERS'));
});

test('over-cap structures short-circuit before adversarial entries are inspected', () => {
  function overCapWithThrowingEntry(limit) {
    const values = new Array(limit + 1);
    Object.defineProperty(values, 0, {
      configurable: true,
      get() { throw new Error('over-cap entry must not be inspected'); },
    });
    return values;
  }

  const cases = [
    {
      code: 'TOO_MANY_OBSERVED_SIGNALS',
      value: (() => {
        const policy = structuredClone(makeRepairPolicy());
        policy.observedSignals = overCapWithThrowingEntry(STABILITY_STRUCTURE_LIMITS.observedSignals);
        return () => validateRepairPolicy(policy);
      })(),
    },
    {
      code: 'TOO_MANY_BACKOFF_ENTRIES',
      value: (() => {
        const policy = structuredClone(makeRepairPolicy());
        policy.budgets.backoffScheduleMs = overCapWithThrowingEntry(STABILITY_STRUCTURE_LIMITS.repairAttempts);
        return () => validateRepairPolicy(policy);
      })(),
    },
    {
      code: 'TOO_MANY_REPAIR_ATTEMPTS',
      value: (() => {
        const evidence = structuredClone(makeRepairEvidence());
        evidence.attempts = overCapWithThrowingEntry(STABILITY_STRUCTURE_LIMITS.repairAttempts);
        return () => validateRepairEvidence(evidence);
      })(),
    },
    {
      code: 'TOO_MANY_CONFLICT_CAMPAIGNS',
      value: (() => {
        const evidence = structuredClone(makeRepairEvidence());
        evidence.conflictGraphEvidence.observedCampaigns = overCapWithThrowingEntry(STABILITY_STRUCTURE_LIMITS.conflictCampaigns);
        return () => validateRepairEvidence(evidence);
      })(),
    },
    {
      code: 'TOO_MANY_TOP_CONSUMERS',
      value: (() => {
        const bundle = structuredClone(makeResourceEvidenceBundle());
        bundle.rows[0].topConsumers = overCapWithThrowingEntry(STABILITY_STRUCTURE_LIMITS.topConsumersPerResource);
        return () => validateResourceEvidenceBundle(bundle);
      })(),
    },
  ];

  for (const scenario of cases) {
    let issues;
    assert.doesNotThrow(() => { issues = scenario.value(); }, scenario.code);
    assert.ok(issues.some((issue) => issue.code === scenario.code), scenario.code);
  }
});

test('unknown numeric resource truth must be wholly null with an exact blocker', () => {
  const partial = structuredClone(makeResourceEvidenceBundle());
  partial.rows[0].budget.remaining = null;
  assert.ok(validateResourceEvidenceBundle(partial).some((issue) => issue.code === 'PARTIAL_NUMERIC_TRUTH_FORBIDDEN'));

  const fabricated = structuredClone(makeResourceEvidenceBundle());
  fabricated.rows[0].burn = { value: 0, unknownReason: 'measurement absent' };
  assert.ok(validateResourceEvidenceBundle(fabricated).some((issue) => issue.code === 'UNKNOWN_REASON_CONFLICT'));
});

test('derived top-consumer attribution fails closed before bounded numeric overflow', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].topConsumers = [
    {
      consumerId: 'synthetic.consumer.maximum',
      amount: Number.MAX_SAFE_INTEGER,
      unknownReason: null,
      evidenceRef: 'synthetic.consumer.maximum.evidence',
    },
    {
      consumerId: 'synthetic.consumer.one-more',
      amount: 1,
      unknownReason: null,
      evidenceRef: 'synthetic.consumer.one-more.evidence',
    },
  ];
  assert.ok(validateResourceEvidenceBundle(bundle).some((issue) => issue.code === 'TOP_CONSUMER_TOTAL_OVERFLOW'));
});

test('resource truth conditionally requires consumer, throttle, response, and circuit evidence', () => {
  const consumer = structuredClone(makeResourceEvidenceBundle());
  consumer.rows[0].topConsumers[0] = {
    consumerId: 'synthetic.consumer', amount: null, unknownReason: null, evidenceRef: null,
  };
  assert.ok(validateResourceEvidenceBundle(consumer).some((issue) => issue.code === 'UNKNOWN_REASON_REQUIRED'));

  const throttle = structuredClone(makeResourceEvidenceBundle());
  throttle.rows[0].throttling.evidenceRef = null;
  assert.ok(validateResourceEvidenceBundle(throttle).some((issue) => issue.code === 'THROTTLING_EVIDENCE_REQUIRED'));

  const response = structuredClone(makeResourceEvidenceBundle());
  response.rows[0].canonicalResponse.referenceId = null;
  assert.ok(validateResourceEvidenceBundle(response).some((issue) => issue.code === 'CANONICAL_RESPONSE_REFERENCE_REQUIRED'));

  const circuit = structuredClone(makeResourceEvidenceBundle());
  circuit.rows[0].circuit.evidenceRef = null;
  assert.ok(validateResourceEvidenceBundle(circuit).some((issue) => issue.code === 'CIRCUIT_EVIDENCE_REQUIRED'));
});

test('malformed resource rows return contract issues instead of throwing', () => {
  for (const mutate of [
    (bundle) => { bundle.rows[0].burn = null; },
    (bundle) => { bundle.rows[0].budget = null; },
    (bundle) => { bundle.rows[0] = {}; },
  ]) {
    const bundle = structuredClone(makeResourceEvidenceBundle());
    mutate(bundle);
    let issues;
    assert.doesNotThrow(() => { issues = validateResourceEvidenceBundle(bundle); });
    assert.ok(issues.length > 0);
  }
});

test('sparse arrays fail closed across policy, campaign, and resource evidence', () => {
  const policy = structuredClone(makeRepairPolicy());
  policy.budgets.backoffScheduleMs = new Array(1);
  assert.ok(validateRepairPolicy(policy).some((issue) => issue.code === 'SPARSE_ARRAY_FORBIDDEN'));

  for (const field of ['attempts', 'observedCampaigns']) {
    const evidence = structuredClone(makeRepairEvidence());
    if (field === 'attempts') evidence.attempts = new Array(1);
    else evidence.conflictGraphEvidence.observedCampaigns = new Array(1);
    assert.ok(validateRepairEvidence(evidence).some((issue) => issue.code === 'SPARSE_ARRAY_FORBIDDEN'), field);
  }

  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].topConsumers = new Array(1);
  assert.ok(validateResourceEvidenceBundle(bundle).some((issue) => issue.code === 'SPARSE_ARRAY_FORBIDDEN'));
});

test('resource response, shedding, and circuit-close evidence cannot relabel uncertainty green', () => {
  const noneWithUnknown = structuredClone(makeResourceEvidenceBundle());
  noneWithUnknown.rows[0].canonicalResponse = {
    kind: 'NONE', referenceId: null, owner: 'accepted resource owner',
    wiringState: 'DRAFT_INSERTION_REQUEST', unknownReason: 'response actually unknown',
  };
  assert.ok(validateResourceEvidenceBundle(noneWithUnknown).some((issue) => issue.code === 'NONE_RESPONSE_EVIDENCE_CONFLICT'));

  const unknownWithReference = structuredClone(makeResourceEvidenceBundle());
  unknownWithReference.rows[0].canonicalResponse = {
    kind: 'UNKNOWN', referenceId: 'affirmative.reference', owner: 'accepted resource owner',
    wiringState: 'UNAVAILABLE', unknownReason: 'owner response unavailable',
  };
  assert.ok(validateResourceEvidenceBundle(unknownWithReference).some((issue) => issue.code === 'UNKNOWN_RESPONSE_EVIDENCE_CONFLICT'));

  const extraClass = structuredClone(makeResourceEvidenceBundle());
  extraClass.loadSheddingOrder.unshift('MONEY_MUTATION');
  assert.ok(validateResourceEvidenceBundle(extraClass).some((issue) => issue.code === 'SHEDDING_DENOMINATOR_MISMATCH'));

  const commonModeClose = structuredClone(makeResourceEvidenceBundle());
  commonModeClose.rows[0].circuit = {
    ...commonModeClose.rows[0].circuit,
    openedAtMs: FIXTURE_NOW_MS - 4_000,
    halfOpenAtMs: FIXTURE_NOW_MS - 3_000,
    resetEligibleAtMs: FIXTURE_NOW_MS - 2_000,
    closedAtMs: FIXTURE_NOW_MS - 1_000,
    independentCloseEvidenceRef: commonModeClose.rows[0].circuit.evidenceRef,
  };
  assert.ok(validateResourceEvidenceBundle(commonModeClose).some((issue) => issue.code === 'COMMON_MODE_CIRCUIT_CLOSE_FORBIDDEN'));
});

test('UNAVAILABLE resource truth cannot carry fabricated numeric values', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].truthLabel = 'UNAVAILABLE';
  assert.ok(validateResourceEvidenceBundle(bundle).some((issue) => issue.code === 'UNAVAILABLE_TRUTH_CANNOT_HAVE_NUMBERS'));
});

test('all fixture contracts and schema metadata are immutable', () => {
  const values = [makeCancellationEvidence(), makeRepairPolicy(), makeRepairEvidence(), makeResourceEvidenceBundle()];
  for (const value of values) {
    assert.ok(Object.isFrozen(value));
    assert.throws(() => { value.schemaVersion = 'mutated'; }, TypeError);
  }
});
