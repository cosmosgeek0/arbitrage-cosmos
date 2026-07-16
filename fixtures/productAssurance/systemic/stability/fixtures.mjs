/** Deterministic S8 fixture corpus. No fixture is live or runtime-wired. */
import {
  CANCELLATION_LATE_RESULT_LAW,
  OPTIONAL_SHEDDING_CLASSES,
  PROTECTED_WORK_CLASSES,
  REPAIR_LATE_RESULT_LAW,
  REPAIR_RESTART_BEHAVIOR,
  RESOURCE_FAMILIES,
  STABILITY_SCHEMA_VERSION,
  SYNTHETIC_RESOURCE_OWNER,
  SYNTHETIC_RESOURCE_TRUST_BINDING,
  deepFreeze,
} from './contracts.mjs';
import {
  cancellationRestartDigest,
  captureCanonicalEvidence,
} from './integrity.mjs';

export const FIXTURE_NOW_MS = 1_800_000_000_000;

const REPAIR_GATE_OBSERVED_AT_MS = FIXTURE_NOW_MS - 20_000;
const REPAIR_GATE_MAX_AGE_MS = 60_000;
const REPAIR_READINESS_EVIDENCE_REF = 'synthetic.readiness.sequence-gap.001';
const REPAIR_CONFLICT_GRAPH_EVIDENCE_REF = 'synthetic.conflict-graph-observation.001';
const REPAIR_CIRCUIT_OPENED_AT_MS = FIXTURE_NOW_MS - 20_000;
const REPAIR_CIRCUIT_HALF_OPEN_AT_MS = FIXTURE_NOW_MS - 16_000;

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneFixtureValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('fixture overrides must be acyclic');
  if (!Array.isArray(value) && !plain(value)) {
    throw new TypeError('fixture overrides must contain only plain records, arrays, and primitives');
  }
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('fixture override arrays must be dense');
      output.push(cloneFixtureValue(value[index], seen));
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      output[key] = cloneFixtureValue(child, seen);
    }
  }
  seen.delete(value);
  return output;
}

function mergeCaptured(base, override) {
  if (!plain(base) || !plain(override)) return cloneFixtureValue(override);
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = plain(value) && plain(base[key])
      ? mergeCaptured(base[key], value)
      : cloneFixtureValue(value);
  }
  return output;
}

function merge(base, override) {
  try {
    return mergeCaptured(base, captureCanonicalEvidence(override));
  } catch {
    throw new TypeError('fixture overrides must contain only plain records, arrays, and primitives with enumerable data properties');
  }
}

function cancellationRestartSnapshot(record) {
  return cloneFixtureValue({
    recordId: record.recordId,
    operationId: record.operationId,
    operationClass: record.operationClass,
    canonicalOwner: record.canonicalOwner,
    requestId: record.requestId,
    parentRequestId: record.parentRequestId,
    requestKind: record.requestKind,
    startedAtMs: record.startedAtMs,
    inheritedDeadlineAtMs: record.inheritedDeadlineAtMs,
    childBudgetMs: record.childBudgetMs,
    localDeadlineAtMs: record.localDeadlineAtMs,
    cancellationContextId: record.cancellationContextId,
    lateResultLaw: record.lateResultLaw,
    cancelRequestedAtMs: record.cancelRequestedAtMs,
    cancelObservedAtMs: record.cancelObservedAtMs,
    cancellationSupported: record.cancellationSupported,
    cancellationUnknownReason: record.cancellationUnknownReason,
    effect: record.effect,
    lease: record.lease,
    detachedRecovery: record.detachedRecovery,
    lateFact: record.lateFact,
    reconciliationEvidence: record.reconciliationEvidence,
  });
}

export function makeCancellationEvidence(override = {}) {
  const base = {
    schemaVersion: STABILITY_SCHEMA_VERSION,
    recordId: 's8-cancel-bounded-001',
    operationId: 'operation.local.diagnostic-child',
    operationClass: 'PURE_READ',
    canonicalOwner: 'canonical.control-plane.owner',
    requestId: 'request-parent.001.child.001',
    parentRequestId: 'request-parent.001',
    requestKind: 'BOUNDED_INTERNAL',
    clockDomain: 'INJECTED_MONOTONIC_MS',
    startedAtMs: FIXTURE_NOW_MS - 5_000,
    inheritedDeadlineAtMs: FIXTURE_NOW_MS + 10_000,
    childBudgetMs: 10_000,
    localDeadlineAtMs: FIXTURE_NOW_MS + 5_000,
    cancellationContextId: 'cancel-context.001',
    lateResultLaw: CANCELLATION_LATE_RESULT_LAW,
    cancelRequestedAtMs: null,
    cancelObservedAtMs: null,
    cancellationSupported: true,
    cancellationUnknownReason: null,
    effect: {
      kind: 'LOCAL',
      initiatedAtMs: null,
      committedAtMs: null,
    },
    lease: null,
    detachedRecovery: null,
    lateFact: null,
    reconciliationEvidence: {
      required: false,
      operationLookupRef: null,
      durableEvidenceRef: null,
    },
    restartEvidence: {
      restoredFromCheckpoint: false,
      preservedRequestId: true,
      preservedLateResultLaw: true,
      checkpointRef: null,
      stateDigestBeforeRestart: null,
      stateDigestAfterRestart: null,
      restoredRequestId: null,
      restoredCancellationContextId: null,
      restoredReconciliationIdentityRef: null,
      restoredLateResultLaw: null,
      preservedFields: [],
      stateBeforeRestart: null,
      stateAfterRestart: null,
    },
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  };
  return deepFreeze(merge(base, override));
}

const lateFill = {
  factId: 'exchange-fill.001',
  factType: 'FILL',
  occurredAtMs: FIXTURE_NOW_MS - 1_500,
  receivedAtMs: FIXTURE_NOW_MS - 1_000,
  sourceEpoch: 6,
  activeEpoch: 7,
  durableIngestionRef: 'ledger-material-event.001',
  reconciliationRef: 'reconciliation.lookup.client-order.001',
  attemptedToAuthorizeNewWork: false,
};

const cancellationRestartBaseline = makeCancellationEvidence({ recordId: 's8-restart-loss' });
const cancellationRestartState011 = cancellationRestartSnapshot(cancellationRestartBaseline);
const cancellationRestartDigest011 = cancellationRestartDigest(
  'synthetic.checkpoint.cancel-011',
  cancellationRestartState011,
);

export const CANCELLATION_FIXTURES = deepFreeze([
  {
    id: 'C01_PARENT_CANCEL_STOPS_NEW_LOCAL_EFFECT',
    input: makeCancellationEvidence({
      cancelRequestedAtMs: FIXTURE_NOW_MS - 3_000,
      cancelObservedAtMs: FIXTURE_NOW_MS - 2_500,
    }),
    expectedResult: 'PASS',
    expectedReason: 'CANCELLATION_INTENT_OBSERVED',
  },
  {
    id: 'C02_CHILD_DEADLINE_CANNOT_ESCAPE_PARENT',
    input: makeCancellationEvidence({ localDeadlineAtMs: FIXTURE_NOW_MS + 20_000 }),
    expectedResult: 'FAIL',
    expectedReason: 'CHILD_DEADLINE_ESCAPES_PARENT',
  },
  {
    id: 'C03_EXTERNAL_CANCEL_INTENT_REQUIRES_RECONCILIATION',
    input: makeCancellationEvidence({
      recordId: 's8-cancel-external-001',
      operationId: 'operation.external.accepted-mutation',
      operationClass: 'NON_IDEMPOTENT_MUTATION',
      cancelRequestedAtMs: FIXTURE_NOW_MS - 3_000,
      cancelObservedAtMs: FIXTURE_NOW_MS - 2_900,
      cancellationSupported: false,
      effect: {
        kind: 'EXTERNAL_OR_ALREADY_ACCEPTED',
        initiatedAtMs: FIXTURE_NOW_MS - 4_500,
        committedAtMs: FIXTURE_NOW_MS - 4_000,
      },
      reconciliationEvidence: {
        required: true,
        operationLookupRef: 'synthetic.operation-lookup.external-001',
        durableEvidenceRef: 'synthetic.reconciliation.external-001',
      },
    }),
    expectedResult: 'PASS',
    expectedReason: 'CANCELLATION_INTENT_DOES_NOT_PROVE_MUTATION_ABSENCE',
  },
  {
    id: 'C04_UNKNOWN_CANCELLATION_SUPPORT_STAYS_UNKNOWN',
    input: makeCancellationEvidence({
      recordId: 's8-cancel-support-unknown',
      cancellationSupported: null,
      cancellationUnknownReason: 'owner adapter has not supplied cancellation capability evidence',
    }),
    expectedResult: 'UNKNOWN',
    expectedReason: 'CANCELLATION_SUPPORT_UNKNOWN',
  },
  {
    id: 'C05_STALE_EPOCH_LATE_FILL_IS_TRUTH_NOT_AUTHORITY',
    input: makeCancellationEvidence({
      recordId: 's8-late-fill-retained',
      operationClass: 'NON_IDEMPOTENT_MUTATION',
      effect: {
        kind: 'EXTERNAL_OR_ALREADY_ACCEPTED',
        initiatedAtMs: FIXTURE_NOW_MS - 4_500,
        committedAtMs: FIXTURE_NOW_MS - 4_000,
      },
      lateFact: lateFill,
      reconciliationEvidence: {
        required: true,
        operationLookupRef: 'synthetic.operation-lookup.late-fill-001',
        durableEvidenceRef: 'synthetic.reconciliation.late-fill-001',
      },
    }),
    expectedResult: 'PASS',
    expectedReason: 'STALE_EPOCH_FACT_RETAINED_BUT_CANNOT_AUTHORIZE_NEW_WORK',
  },
  {
    id: 'C06_STALE_EPOCH_FACT_CANNOT_AUTHORIZE_NEW_WORK',
    input: makeCancellationEvidence({
      recordId: 's8-late-fill-authority-attempt',
      operationClass: 'NON_IDEMPOTENT_MUTATION',
      effect: {
        kind: 'EXTERNAL_OR_ALREADY_ACCEPTED',
        initiatedAtMs: FIXTURE_NOW_MS - 4_500,
        committedAtMs: FIXTURE_NOW_MS - 4_000,
      },
      lateFact: { ...lateFill, factId: 'exchange-fill.002', attemptedToAuthorizeNewWork: true },
      reconciliationEvidence: {
        required: true,
        operationLookupRef: 'synthetic.operation-lookup.late-fill-002',
        durableEvidenceRef: 'synthetic.reconciliation.late-fill-002',
      },
    }),
    expectedResult: 'FAIL',
    expectedReason: 'STALE_EPOCH_FACT_ATTEMPTED_NEW_AUTHORITY',
  },
  {
    id: 'C07_LONG_LIVED_CONTROLLER_USES_CURRENT_LEASE',
    input: makeCancellationEvidence({
      recordId: 's8-lease-current',
      requestId: 'controller.public-source.001',
      canonicalOwner: 'canonical.runtime.owner',
      parentRequestId: null,
      requestKind: 'LONG_LIVED_LEASED',
      startedAtMs: FIXTURE_NOW_MS - 10_000,
      inheritedDeadlineAtMs: null,
      childBudgetMs: null,
      localDeadlineAtMs: null,
      lease: {
        resourceId: 'source.spot.public',
        ownerId: 'canonical.runtime.owner',
        processId: 'process.runtime.synthetic-007',
        releaseId: 'release.synthetic-007',
        leaseId: 'lease.source.spot.007',
        fenceEpoch: 7,
        activeFenceEpoch: 7,
        acquiredAtMs: FIXTURE_NOW_MS - 10_000,
        renewalSequence: 2,
        lastRenewedAtMs: FIXTURE_NOW_MS - 1_000,
        lastHeartbeatAtMs: FIXTURE_NOW_MS - 100,
        heartbeatMaxAgeMs: 1_000,
        expiresAtMs: FIXTURE_NOW_MS + 10_000,
        completionEpoch: null,
        completionDisposition: 'NOT_OBSERVED',
      },
    }),
    expectedResult: 'PASS',
    expectedLeaseEvidence: 'CURRENT',
  },
  {
    id: 'C08_LEASE_EXPIRY_BOUNDARY_REJECTS_AUTHORITY',
    input: makeCancellationEvidence({
      recordId: 's8-lease-expired-boundary',
      requestId: 'controller.public-source.002',
      canonicalOwner: 'canonical.runtime.owner',
      parentRequestId: null,
      requestKind: 'LONG_LIVED_LEASED',
      startedAtMs: FIXTURE_NOW_MS - 10_000,
      inheritedDeadlineAtMs: null,
      childBudgetMs: null,
      localDeadlineAtMs: null,
      lease: {
        resourceId: 'source.spot.public',
        ownerId: 'canonical.runtime.owner',
        processId: 'process.runtime.synthetic-008',
        releaseId: 'release.synthetic-008',
        leaseId: 'lease.source.spot.008',
        fenceEpoch: 8,
        activeFenceEpoch: 8,
        acquiredAtMs: FIXTURE_NOW_MS - 10_000,
        renewalSequence: 2,
        lastRenewedAtMs: FIXTURE_NOW_MS - 1_000,
        lastHeartbeatAtMs: FIXTURE_NOW_MS - 100,
        heartbeatMaxAgeMs: 1_000,
        expiresAtMs: FIXTURE_NOW_MS,
        completionEpoch: null,
        completionDisposition: 'NOT_OBSERVED',
      },
    }),
    expectedResult: 'FAIL',
    expectedReason: 'LEASE_EXPIRED',
  },
  {
    id: 'C09_REGISTERED_FENCED_RECOVERY_SURVIVES_PARENT_TIMEOUT',
    input: makeCancellationEvidence({
      recordId: 's8-detached-recovery-valid',
      operationId: 'operation.reconcile.external-truth',
      operationClass: 'RISK_REDUCING_RECOVERY',
      startedAtMs: FIXTURE_NOW_MS - 20_000,
      inheritedDeadlineAtMs: FIXTURE_NOW_MS - 1_000,
      childBudgetMs: 10_000,
      localDeadlineAtMs: FIXTURE_NOW_MS - 10_000,
      detachedRecovery: {
        reason: 'DURABLE_RECONCILIATION',
        operationRegistered: true,
        operationRegistryRef: 'synthetic.registry.reconcile-external-truth',
        priorAuthorizationRef: null,
        operationClass: 'RISK_REDUCING_RECOVERY',
        canonicalOwner: 'canonical.control-plane.owner',
        fencedRecoveryContextId: 'recovery-context.009',
        leaseId: 'synthetic.detached-lease.009',
        leaseOwner: 'canonical.control-plane.owner',
        fenceEpoch: 9,
        activeFenceEpoch: 9,
        leaseExpiresAtMs: FIXTURE_NOW_MS + 10_000,
        fenceObservedAtMs: FIXTURE_NOW_MS - 100,
        fenceMaxAgeMs: 5_000,
        fenceEvidenceRef: 'synthetic.detached-fence-evidence.009',
      },
      reconciliationEvidence: {
        required: true,
        operationLookupRef: 'synthetic.operation-lookup.recovery-009',
        durableEvidenceRef: 'synthetic.reconciliation.recovery-009',
      },
    }),
    expectedResult: 'PASS',
    expectedReason: 'REGISTERED_FENCED_RECOVERY_SURVIVES_INITIATOR_TIMEOUT',
  },
  {
    id: 'C10_UNREGISTERED_DETACH_IS_REJECTED',
    input: makeCancellationEvidence({
      recordId: 's8-detached-recovery-invalid',
      operationClass: 'RISK_REDUCING_RECOVERY',
      detachedRecovery: {
        reason: 'ALREADY_AUTHORIZED_RISK_REDUCTION',
        operationRegistered: false,
        operationRegistryRef: null,
        priorAuthorizationRef: 'synthetic.prior-authorization.risk-reduction-010',
        operationClass: 'RISK_REDUCING_RECOVERY',
        canonicalOwner: 'wrong.owner',
        fencedRecoveryContextId: 'recovery-context.010',
        leaseId: 'synthetic.detached-lease.010',
        leaseOwner: 'wrong.owner',
        fenceEpoch: 10,
        activeFenceEpoch: 10,
        leaseExpiresAtMs: FIXTURE_NOW_MS + 10_000,
        fenceObservedAtMs: FIXTURE_NOW_MS - 100,
        fenceMaxAgeMs: 5_000,
        fenceEvidenceRef: 'synthetic.detached-fence-evidence.010',
      },
    }),
    expectedResult: 'FAIL',
    expectedReason: 'DETACHED_RECOVERY_NOT_REGISTERED_OR_FENCED',
  },
  {
    id: 'C11_RESTART_CANNOT_LOSE_LATE_RESULT_LAW',
    input: makeCancellationEvidence({
      recordId: 's8-restart-loss',
      restartEvidence: {
        restoredFromCheckpoint: true,
        preservedRequestId: true,
        preservedLateResultLaw: false,
        checkpointRef: 'synthetic.checkpoint.cancel-011',
        stateDigestBeforeRestart: cancellationRestartDigest011,
        stateDigestAfterRestart: cancellationRestartDigest011,
        restoredRequestId: 'request-parent.001.child.001',
        restoredCancellationContextId: 'cancel-context.001',
        restoredReconciliationIdentityRef: null,
        restoredLateResultLaw: CANCELLATION_LATE_RESULT_LAW,
        preservedFields: ['requestId', 'cancellationContextId', 'deadline', 'effect', 'reconciliation', 'leaseFence', 'lateResultLaw'],
        stateBeforeRestart: cloneFixtureValue(cancellationRestartState011),
        stateAfterRestart: cloneFixtureValue(cancellationRestartState011),
      },
    }),
    expectedResult: 'FAIL',
    expectedReason: 'RESTART_LOST_CANCELLATION_OR_LATE_RESULT_IDENTITY',
  },
  {
    id: 'C12_CANCEL_OBSERVED_LOCAL_CHILD_CANNOT_START_EFFECT',
    input: makeCancellationEvidence({
      recordId: 's8-local-effect-after-cancel',
      cancelRequestedAtMs: FIXTURE_NOW_MS - 3_000,
      cancelObservedAtMs: FIXTURE_NOW_MS - 2_500,
      effect: {
        kind: 'LOCAL',
        initiatedAtMs: FIXTURE_NOW_MS - 2_000,
        committedAtMs: FIXTURE_NOW_MS - 1_900,
      },
    }),
    expectedResult: 'FAIL',
    expectedReason: 'LOCAL_EFFECT_INITIATED_AFTER_CANCELLATION_OBSERVED',
  },
]);

export function makeRepairPolicy(override = {}) {
  const base = {
    schemaVersion: STABILITY_SCHEMA_VERSION,
    draftState: 'DRAFT_INSERTION_REQUEST',
    policyId: 'repair.local.resnapshot-sequence-gap.v1',
    operationPolicyId: 'OWNER_CONFIRMATION_REQUIRED:RELIABILITY_POLICY_REGISTRY',
    operationClass: 'IDEMPOTENT_COMMAND',
    policyRevision: 'synthetic.policy-revision.001',
    managedComponentId: 'component.public-source',
    canonicalOwner: 'synthetic.canonical-control-plane-owner',
    implementationPath: 'fixtures/productAssurance/systemic/stability/reference-evaluator.mjs#evaluateRepairLoop',
    commandIdentity: 'RESNAPSHOT_SEQUENCE_GAP',
    commandRegistration: {
      state: 'CONFIRMED_IN_SYNTHETIC_FIXTURE',
      registryRef: 'synthetic.registry-mapping.RESNAPSHOT_SEQUENCE_GAP',
      implementationRef: 'synthetic.reference-evaluator.evaluateRepairLoop',
      registeredFencingOwner: 'controller.alpha',
      fencingOwnerEvidenceRef: 'synthetic.registry-mapping.RESNAPSHOT_SEQUENCE_GAP.fencing-owner',
    },
    controlledState: {
      resourceIds: ['component.public-source'],
      desired: 'sequence continuity independently proven',
      observedSignalIds: ['signal.sequence-continuity', 'signal.independent-book-proof'],
      lastKnownGood: 'last independently proven continuity watermark',
      allowedDegraded: 'BLOCKED with reconciliation and risk reduction preserved',
    },
    observedSignals: [
      {
        signalId: 'signal.sequence-continuity', unit: 'boolean-evidence', required: true,
        sourceOwner: 'canonical public-source owner', evidencePath: 'synthetic.producer.continuity',
        failureDomain: 'producer.public-source', independent: false,
      },
      {
        signalId: 'signal.independent-book-proof', unit: 'boolean-evidence', required: true,
        sourceOwner: 'independent sentinel owner', evidencePath: 'synthetic.verifier.book-proof',
        failureDomain: 'verifier.independent-sentinel', independent: true,
      },
    ],
    prerequisites: ['durable campaign record current', 'injected monotonic clock current', 'exclusive resource lease current', 'required observability current'],
    forbiddenContexts: ['money mutation', 'risk or capital policy mutation', 'missing lease fence', 'unknown durable state'],
    evaluationCadenceMs: 1_000,
    observationHorizonMs: 60_000,
    actuationDelayMs: 1_000,
    deadband: { metricId: 'metric.continuity-error', lowerInclusive: -0.05, upperInclusive: 0.05 },
    hysteresis: { direction: 'INCREASE_IS_PROGRESS', enterThreshold: 1, exitThreshold: 3, minimumDwellMs: 5_000 },
    cooldownMs: 1_000,
    maximumStep: { value: 1, unit: 'registered-command' },
    maximumSlew: { valuePerMs: 0.002, unit: 'registered-command-per-ms' },
    successPredicate: {
      predicateId: 'predicate.sequence-continuity-restored',
      producerSignalId: 'signal.sequence-continuity',
      verifierSignalId: 'signal.independent-book-proof',
      verifierOwner: 'independent sentinel owner',
      verifierEvidencePath: 'synthetic.verifier.book-proof',
      verifierFailureDomain: 'verifier.independent-sentinel',
      quietPeriodMs: 5_000,
    },
    progressLaw: {
      metricId: 'metric.continuity-watermark',
      direction: 'INCREASE_IS_PROGRESS',
      minimumDelta: 1,
      noProgressAttemptThreshold: 2,
      noProgressWindowMs: 20_000,
      contradictoryAttemptThreshold: 2,
      repeatedRollbackThreshold: 2,
    },
    budgets: {
      maximumLocalAttempts: 6,
      maximumGlobalAttempts: 12,
      backoffScheduleMs: [1_000, 2_000, 4_000],
      maximumRetryTimeMs: 20_000,
      rateUnits: 100,
      resourceUnits: 100,
      costUnits: 100,
      maximumConcurrency: 1,
      convergenceWindowMs: 60_000,
    },
    oscillationLaw: {
      windowMs: 20_000,
      minimumAlternations: 3,
      minimumNetProgress: 1,
      conflictingControllerIds: ['controller.beta'],
      actionFingerprintFields: ['commandIdentity', 'resourceIds', 'actionDirection'],
    },
    rollbackCompensation: {
      rollbackActionIdentity: 'OWNER_CONFIRMATION_REQUIRED:rollback-resnapshot',
      rollbackCommandMapping: null,
      compensationActionIdentity: 'OWNER_CONFIRMATION_REQUIRED:restore-last-known-good-book',
      compensationCommandMapping: null,
    },
    quarantineEscalation: {
      quarantineActionIdentity: 'OWNER_CONFIRMATION_REQUIRED:quarantine-public-source',
      quarantineCommandMapping: null,
      escalationOwner: 'canonical incident and control owner',
      durableUnresolvedEvidenceRequired: true,
    },
    lateResultLaw: REPAIR_LATE_RESULT_LAW,
    restartBehavior: REPAIR_RESTART_BEHAVIOR,
    resourceLeaseLaw: {
      exclusive: true,
      orderedAtomicAcquisition: true,
      staleCompletionRejected: true,
    },
    dependencies: ['canonical public-source owner', 'independent sentinel owner', 'durable campaign store owner'],
    invariants: ['no money mutation', 'one current fence epoch', 'material and audit truth retained'],
    triggerEvidenceRequirements: ['sequence-gap evidence reference', 'current continuity watermark', 'current fence evidence'],
    failureFingerprintFields: ['managedComponentId', 'triggerEvidenceRef', 'controlledResourceIds'],
    diagnosticConfidenceLaw: 'bounded [0,1] evidence only; never authorizes repair',
    minimumDiagnosticConfidence: 0.75,
    maximumScope: 'one ordered resource set under one exclusive synthetic lease',
    capitalPosture: 'NO_CHANGE; reconciliation and independently safe risk reduction remain available',
    predictedResult: 'continuity postcondition may become independently provable after owner-controlled action',
    fencingOwner: 'controller.alpha',
    repairConflictGraph: {
      graphRef: 'synthetic.conflict-graph.sequence-gap',
      sameResourceExclusion: true,
      differentFingerprintExclusion: true,
    },
    promotionLaw: 'owner review only after independent readback, hysteresis exit, and quiet-period evidence',
    reserveCapacityLaw: 'reconciliation and independently safe risk reduction capacity remain protected',
    circuitLaw: 'owner circuit state is evidence; packet cannot close or reset it and producer self-report is insufficient',
    automaticRemediationAllowed: true,
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  };
  return deepFreeze(merge(base, override));
}

export function makeRepairCircuitEvidence(attemptRecord, index) {
  let capturedAttempt;
  try {
    capturedAttempt = captureCanonicalEvidence(attemptRecord);
  } catch {
    throw new TypeError('repair circuit fixture input must contain only enumerable JSON-plain data properties');
  }
  const state = capturedAttempt.circuitState;
  const common = {
    state,
    canonicalOwner: 'synthetic.repair-circuit-owner',
    ownerFailureDomain: state === 'UNKNOWN' ? null : 'synthetic.repair-circuit-owner-domain',
    observedAtMs: state === 'UNKNOWN' ? null : capturedAttempt.verifierObservedAtMs,
    maxAgeMs: 60_000,
    evidenceRef: state === 'UNKNOWN' ? null : `synthetic.repair-circuit.attempt.${index + 1}`,
    unknownReason: state === 'UNKNOWN' ? 'repair circuit owner state is unavailable' : null,
    priorEvidenceRef: null,
    baselineNeverOpenedEvidenceRef: null,
    baselineEvidenceOwner: null,
    baselineEvidenceFailureDomain: null,
    openedAtMs: null,
    halfOpenAtMs: null,
    resetEligibleAtMs: null,
    closedAtMs: null,
    independentCloseEvidenceRef: null,
    independentCloseOwner: null,
    independentCloseFailureDomain: null,
    mayCloseOrReset: false,
  };
  if (state === 'OPEN') {
    common.priorEvidenceRef = index === 0
      ? 'synthetic.repair-circuit.pre-campaign-closed'
      : `synthetic.repair-circuit.attempt.${index}`;
    common.openedAtMs = REPAIR_CIRCUIT_OPENED_AT_MS;
    if (index > 0) common.halfOpenAtMs = REPAIR_CIRCUIT_HALF_OPEN_AT_MS;
  }
  if (state === 'HALF_OPEN') {
    common.priorEvidenceRef = index === 0
      ? 'synthetic.repair-circuit.pre-campaign-open'
      : `synthetic.repair-circuit.attempt.${index}`;
    common.openedAtMs = REPAIR_CIRCUIT_OPENED_AT_MS;
    common.halfOpenAtMs = REPAIR_CIRCUIT_HALF_OPEN_AT_MS;
  }
  if (state === 'CLOSED') {
    common.priorEvidenceRef = index === 0
      ? 'synthetic.repair-circuit.pre-campaign-transition'
      : `synthetic.repair-circuit.attempt.${index}`;
    common.openedAtMs = REPAIR_CIRCUIT_OPENED_AT_MS;
    common.halfOpenAtMs = REPAIR_CIRCUIT_HALF_OPEN_AT_MS;
    common.resetEligibleAtMs = capturedAttempt.startedAtMs;
    common.closedAtMs = capturedAttempt.completedAtMs;
    common.independentCloseEvidenceRef = `synthetic.independent-repair-circuit-close.${index + 1}`;
    common.independentCloseOwner = 'synthetic.independent-repair-circuit-verifier';
    common.independentCloseFailureDomain = 'synthetic.independent-repair-circuit-verifier-domain';
  }
  return deepFreeze(common);
}

function attempt(index, override = {}) {
  const scheduledOffsets = [-17_000, -14_000, -10_000, -4_000, 4_000, 14_000];
  const startedAtMs = FIXTURE_NOW_MS + scheduledOffsets[index];
  const record = merge({
    attemptId: `attempt.${index + 1}`,
    localAttempt: index + 1,
    globalAttempt: index + 1,
    controllerId: 'controller.alpha',
    cause: 'synthetic sequence-gap trigger remains outside deadband',
    policyRevision: 'synthetic.policy-revision.001',
    commandIdentity: 'RESNAPSHOT_SEQUENCE_GAP',
    commandRegistryRef: 'synthetic.registry-mapping.RESNAPSHOT_SEQUENCE_GAP',
    resourceIds: ['component.public-source'],
    failureFingerprint: 'fingerprint.sequence-gap.component-public-source',
    diagnosticConfidence: 0.8,
    startedAtMs,
    completedAtMs: startedAtMs + 1_000,
    beforeStateRef: `synthetic.state.before.${index + 1}`,
    actionRef: `synthetic.action.${index + 1}`,
    afterStateRef: `synthetic.state.after.${index + 1}`,
    result: 'FAILED',
    nextRetryAtMs: null,
    circuitState: 'OPEN',
    materialEventOrLedgerRef: `synthetic.material-event.${index + 1}`,
    cockpitTraceRef: `synthetic.cockpit-trace.${index + 1}`,
    actionDirection: 'INCREASE',
    controlErrorBefore: 1,
    stepMagnitude: 1,
    progressValue: index + 1,
    producerPredicate: 'FAIL',
    independentVerifier: 'FAIL',
    producerOwner: 'canonical public-source owner',
    producerFailureDomain: 'producer.public-source',
    verifierOwner: 'independent sentinel owner',
    producerEvidenceRef: `synthetic.producer-evidence.${index + 1}`,
    verifierEvidenceRef: `synthetic.verifier-evidence.${index + 1}`,
    producerObservedAtMs: startedAtMs + 1_100,
    verifierObservedAtMs: startedAtMs + 1_200,
    verifierIndependence: 'PASS',
    rollback: 'NONE',
    compensation: 'NOT_REQUIRED',
    compensationEvidenceRef: null,
    rateUnits: 1,
    resourceUnits: 1,
    costUnits: 1,
    fenceEpoch: 3,
    completionApplied: true,
    afterRestart: false,
  }, override);
  if (!Object.hasOwn(override, 'actuationGateEvidence')) {
    record.actuationGateEvidence = {
      readinessEvidenceRef: REPAIR_READINESS_EVIDENCE_REF,
      readinessObservedAtMs: REPAIR_GATE_OBSERVED_AT_MS,
      readinessMaxAgeMs: REPAIR_GATE_MAX_AGE_MS,
      conflictGraphEvidenceRef: REPAIR_CONFLICT_GRAPH_EVIDENCE_REF,
      conflictGraphObservedAtMs: REPAIR_GATE_OBSERVED_AT_MS,
      conflictGraphMaxAgeMs: REPAIR_GATE_MAX_AGE_MS,
    };
  }
  if (!Object.hasOwn(override, 'circuitEvidence')) record.circuitEvidence = makeRepairCircuitEvidence(record, index);
  return record;
}

export function makeRepairEvidence(override = {}) {
  const base = {
    schemaVersion: STABILITY_SCHEMA_VERSION,
    campaignId: 'campaign.resnapshot.001',
    policyId: 'repair.local.resnapshot-sequence-gap.v1',
    policyRevision: 'synthetic.policy-revision.001',
    campaignStartedAtMs: FIXTURE_NOW_MS - 20_000,
    failureFingerprint: 'fingerprint.sequence-gap.component-public-source',
    diagnosticConfidence: 0.8,
    triggerEvidenceRef: 'synthetic.trigger.sequence-gap.001',
    readinessEvidence: {
      dependencies: 'PASS',
      invariants: 'PASS',
      prerequisites: 'PASS',
      forbiddenContextsClear: 'PASS',
      capitalPostureSafe: 'PASS',
      reserveCapacityProtected: 'PASS',
      circuitAllowsAction: 'PASS',
      observedAtMs: REPAIR_GATE_OBSERVED_AT_MS,
      maxAgeMs: REPAIR_GATE_MAX_AGE_MS,
      evidenceRef: REPAIR_READINESS_EVIDENCE_REF,
    },
    conflictGraphEvidence: {
      graphRef: 'synthetic.conflict-graph.sequence-gap',
      observedAtMs: REPAIR_GATE_OBSERVED_AT_MS,
      maxAgeMs: REPAIR_GATE_MAX_AGE_MS,
      evidenceRef: REPAIR_CONFLICT_GRAPH_EVIDENCE_REF,
      observedCampaigns: [{
        campaignId: 'campaign.resnapshot.001',
        failureFingerprint: 'fingerprint.sequence-gap.component-public-source',
        resourceIds: ['component.public-source'],
        startedAtMs: FIXTURE_NOW_MS - 20_000,
        completedAtMs: null,
        acquisitionDisposition: 'ACQUIRED_ATOMICALLY',
        evidenceRef: 'synthetic.campaign-acquisition.001',
      }],
    },
    assumptions: {
      durableStore: 'PASS',
      injectedClock: 'PASS',
      leaseFence: 'PASS',
      observability: 'PASS',
    },
    currentFenceEpoch: 3,
    lease: {
      leaseId: 'synthetic.lease.repair.003',
      ownerId: 'controller.alpha',
      processId: 'synthetic.process.repair-alpha',
      releaseId: 'synthetic.release.repair-001',
      fenceEpoch: 3,
      acquiredAtMs: FIXTURE_NOW_MS - 20_000,
      renewalSequence: 2,
      lastRenewedAtMs: FIXTURE_NOW_MS - 5_000,
      expiresAtMs: FIXTURE_NOW_MS + 10_000,
      resourceIds: ['component.public-source'],
      atomicAcquisitionEvidenceRef: 'synthetic.lease-acquisition.repair.003',
    },
    attempts: [
      attempt(0, { progressValue: 1, circuitState: 'HALF_OPEN', nextRetryAtMs: FIXTURE_NOW_MS - 14_000 }),
      attempt(1, {
        progressValue: 3, producerPredicate: 'PASS', independentVerifier: 'PASS',
        result: 'SUCCEEDED', circuitState: 'CLOSED',
      }),
    ],
    containment: {
      lifecycle: null,
      durableUnresolvedEvidenceRef: null,
      escalationOwner: null,
      furtherAutomaticActuation: true,
    },
    postconditionWindow: {
      producerEvidenceRef: 'synthetic.producer-evidence.2',
      verifierEvidenceRef: 'synthetic.verifier-evidence.2',
      producerOwner: 'canonical public-source owner',
      verifierOwner: 'independent sentinel owner',
      firstIndependentPassAtMs: FIXTURE_NOW_MS - 6_000,
      lastIndependentPassAtMs: FIXTURE_NOW_MS,
      commonModeIndependence: 'PASS',
    },
    restartEvidence: {
      restored: false,
      preservedCampaignId: false,
      checkpointRef: null,
      stateDigestBeforeRestart: null,
      stateDigestAfterRestart: null,
      restoredCampaignId: null,
      stateBeforeRestart: null,
      stateAfterRestart: null,
      attemptsBeforeRestart: [],
      attemptsAfterRestart: [],
      preservedFields: [],
      attemptCountBeforeRestart: 0,
      restoredAttemptCount: 0,
      remainingCostUnitsBeforeRestart: 0,
      remainingCostUnitsAfterRestart: 0,
    },
    nextActuationRequested: false,
    promotionClaimed: false,
    observedConcurrentActuations: 1,
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  };
  return deepFreeze(merge(base, override));
}

const noProgressAttempts = [
  attempt(0, { progressValue: 1, circuitState: 'HALF_OPEN', nextRetryAtMs: FIXTURE_NOW_MS - 14_000 }),
  attempt(1, { progressValue: 1.2, circuitState: 'HALF_OPEN', nextRetryAtMs: FIXTURE_NOW_MS - 10_000 }),
  attempt(2, { progressValue: 1.3 }),
];
const oscillatingAttempts = [
  attempt(0, { progressValue: 1, circuitState: 'HALF_OPEN', actionDirection: 'INCREASE', controllerId: 'controller.alpha', nextRetryAtMs: FIXTURE_NOW_MS - 14_000 }),
  attempt(1, { progressValue: 2, circuitState: 'HALF_OPEN', actionDirection: 'DECREASE', controllerId: 'controller.alpha', nextRetryAtMs: FIXTURE_NOW_MS - 10_000 }),
  attempt(2, { progressValue: 1, circuitState: 'HALF_OPEN', actionDirection: 'INCREASE', controllerId: 'controller.alpha', nextRetryAtMs: FIXTURE_NOW_MS - 4_000 }),
  attempt(3, { progressValue: 1.5, actionDirection: 'DECREASE', controllerId: 'controller.beta', completionApplied: false }),
];
const unavailablePostconditionWindow = {
  producerEvidenceRef: null,
  verifierEvidenceRef: null,
  producerOwner: null,
  verifierOwner: null,
  firstIndependentPassAtMs: null,
  lastIndependentPassAtMs: null,
  commonModeIndependence: 'UNKNOWN',
};

export const REPAIR_FIXTURES = deepFreeze([
  {
    id: 'R01_INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence(),
    expectedResult: 'PASS',
    expectedPromotionEvidence: 'INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD_PROVEN_FOR_OWNER_REVIEW',
  },
  {
    id: 'R02_PRODUCER_SELF_REPORT_IS_NOT_RECOVERY',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: [attempt(0, { producerPredicate: 'PASS', independentVerifier: 'UNKNOWN', circuitState: 'HALF_OPEN' })],
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'UNKNOWN',
    expectedReason: 'INDEPENDENT_POSTCONDITION_UNPROVED',
  },
  {
    id: 'R03_FALSE_PROMOTION_WITHOUT_VERIFIER_FAILS',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: [attempt(0, { producerPredicate: 'PASS', independentVerifier: 'UNKNOWN' })],
      postconditionWindow: unavailablePostconditionWindow,
      promotionClaimed: true,
    }),
    expectedResult: 'FAIL',
    expectedReason: 'PROMOTION_CLAIM_WITHOUT_INDEPENDENT_QUIET_POSTCONDITION',
  },
  {
    id: 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: noProgressAttempts,
      containment: {
        lifecycle: 'QUARANTINED',
        durableUnresolvedEvidenceRef: 'ledger.campaign.resnapshot.004',
        escalationOwner: null,
        furtherAutomaticActuation: false,
      },
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'PASS',
    expectedReason: 'NO_PROGRESS_THRESHOLD_REACHED',
  },
  {
    id: 'R05_NO_PROGRESS_CANNOT_CONTINUE_ACTUATING',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: noProgressAttempts,
      nextActuationRequested: true,
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'FAIL',
    expectedReason: 'TERMINATION_TRIGGER_WITHOUT_QUARANTINE_ESCALATION_OR_DURABLE_UNRESOLVED_EVIDENCE',
  },
  {
    id: 'R06_ALTERNATING_CONTROLLERS_QUARANTINE_AND_ESCALATE',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: oscillatingAttempts,
      containment: {
        lifecycle: 'FAILED_ATTENTION_REQUIRED',
        durableUnresolvedEvidenceRef: 'ledger.campaign.oscillation.006',
        escalationOwner: 'canonical incident and control owner',
        furtherAutomaticActuation: false,
      },
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'PASS',
    expectedReason: 'OSCILLATION_SIGNATURE_DETECTED',
  },
  {
    id: 'R07_MISSING_OBSERVABILITY_MAKES_TERMINATION_UNKNOWN',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      assumptions: {
        durableStore: 'PASS',
        injectedClock: 'PASS',
        leaseFence: 'PASS',
        observability: 'UNKNOWN',
      },
      attempts: [attempt(0, { circuitState: 'HALF_OPEN' })],
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'UNKNOWN',
    expectedReason: 'TERMINATION_ASSUMPTIONS_UNPROVED',
    expectedTerminationClaim: 'UNKNOWN_UNBOUNDED',
  },
  {
    id: 'R08_MISSING_ASSUMPTION_FORBIDS_NEXT_ACTUATION',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      assumptions: {
        durableStore: 'UNKNOWN',
        injectedClock: 'PASS',
        leaseFence: 'PASS',
        observability: 'PASS',
      },
      attempts: [attempt(0)],
      nextActuationRequested: true,
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'FAIL',
    expectedReason: 'ACTUATION_REQUESTED_WITH_UNPROVED_TERMINATION_ASSUMPTIONS',
  },
  {
    id: 'R09_STALE_HANDOFF_COMPLETION_CANNOT_APPLY',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: [attempt(0, { fenceEpoch: 2, completionApplied: true })],
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'FAIL',
    expectedReason: 'STALE_COMPLETION_APPLIED_AFTER_HANDOFF',
  },
  {
    id: 'R10_RESTART_CANNOT_RESET_ATTEMPTS_OR_COST',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: [
        attempt(0, { circuitState: 'HALF_OPEN', nextRetryAtMs: FIXTURE_NOW_MS - 14_000 }),
        attempt(1, { afterRestart: true }),
      ],
      restartEvidence: {
        restored: true,
        preservedCampaignId: true,
        checkpointRef: 'synthetic.checkpoint.campaign-resnapshot-010',
        stateDigestBeforeRestart: 'sha256:398674341fac1c8b87ae7e047507a869acceb5a6d352a569f103cd0239bfbf46',
        stateDigestAfterRestart: 'sha256:795668561a555fc7dd098de2624671e6994651f370c6e293c0640e82c0d221cf',
        restoredCampaignId: 'campaign.resnapshot.001',
        stateBeforeRestart: {
          localAttempts: 1,
          globalAttempts: 1,
          remainingRetryTimeMs: 19_000,
          remainingRateUnits: 99,
          remainingResourceUnits: 99,
          remainingCostUnits: 99,
          cooldownUntilMs: FIXTURE_NOW_MS - 15_000,
          convergenceDeadlineAtMs: FIXTURE_NOW_MS + 40_000,
          leaseId: 'synthetic.lease.repair.003',
          fenceEpoch: 3,
          lateResultLaw: REPAIR_LATE_RESULT_LAW,
        },
        stateAfterRestart: {
          localAttempts: 0,
          globalAttempts: 1,
          remainingRetryTimeMs: 20_000,
          remainingRateUnits: 100,
          remainingResourceUnits: 100,
          remainingCostUnits: 100,
          cooldownUntilMs: FIXTURE_NOW_MS - 15_000,
          convergenceDeadlineAtMs: FIXTURE_NOW_MS + 40_000,
          leaseId: 'synthetic.lease.repair.003',
          fenceEpoch: 3,
          lateResultLaw: REPAIR_LATE_RESULT_LAW,
        },
        attemptsBeforeRestart: [attempt(0, { circuitState: 'HALF_OPEN', nextRetryAtMs: FIXTURE_NOW_MS - 14_000 })],
        attemptsAfterRestart: [attempt(0, { circuitState: 'HALF_OPEN', nextRetryAtMs: FIXTURE_NOW_MS - 14_000 })],
        preservedFields: ['attempts', 'budgets', 'cooldown', 'lease', 'lateResultLaw', 'convergenceDeadline'],
        attemptCountBeforeRestart: 1,
        restoredAttemptCount: 0,
        remainingCostUnitsBeforeRestart: 99,
        remainingCostUnitsAfterRestart: 100,
      },
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'FAIL',
    expectedReason: 'RESTART_RESET_CAMPAIGN_OR_BUDGET',
  },
  {
    id: 'R11_DEADBAND_BLOCKS_UNNECESSARY_ACTUATION',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: [attempt(0, { controlErrorBefore: 0 })],
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'FAIL',
    expectedReason: 'ACTUATION_INSIDE_DEADBAND',
  },
  {
    id: 'R12_COMPENSATION_FAILURE_ESCALATES_DURABLY',
    policy: makeRepairPolicy(),
    evidence: makeRepairEvidence({
      attempts: [attempt(0, {
        rollback: 'FAILED',
        compensation: 'FAILED',
        compensationEvidenceRef: 'synthetic.compensation-failure.012',
      })],
      containment: {
        lifecycle: 'FAILED_ATTENTION_REQUIRED',
        durableUnresolvedEvidenceRef: 'synthetic.unresolved.compensation.012',
        escalationOwner: 'canonical incident and control owner',
        furtherAutomaticActuation: false,
      },
      postconditionWindow: unavailablePostconditionWindow,
    }),
    expectedResult: 'PASS',
    expectedReason: 'COMPENSATION_FAILED',
  },
]);

function resourceRow(resourceFamily, index) {
  return {
    rowId: `resource.${String(index + 1).padStart(2, '0')}.${resourceFamily.toLowerCase()}`,
    resourceFamily,
    canonicalOwner: SYNTHETIC_RESOURCE_OWNER,
    unit: resourceFamily === 'CLOUD_COST' ? 'usd-equivalent' : 'resource-units',
    windowMs: 60_000,
    observedAtMs: FIXTURE_NOW_MS - 100,
    maxAgeMs: 5_000,
    provenance: `synthetic.fixture.${resourceFamily.toLowerCase()}`,
    truthLabel: 'SYNTHETIC_ONLY',
    burn: { value: 40, unknownReason: null },
    budget: { limit: 100, remaining: 60, unknownReason: null },
    forecast: { value: 50, horizonMs: 60_000, unknownReason: null },
    topConsumers: [{
      consumerId: `fixture-consumer.${index + 1}`,
      amount: 20,
      unknownReason: null,
      evidenceRef: `fixture.evidence.${index + 1}`,
    }],
    throttling: {
      observed: 'INACTIVE',
      observedAtMs: FIXTURE_NOW_MS - 100,
      maxAgeMs: 5_000,
      evidenceRef: `fixture.throttling.${index + 1}`,
      unknownReason: null,
      canonicalOwner: SYNTHETIC_RESOURCE_OWNER,
    },
    circuit: {
      state: 'CLOSED',
      canonicalOwner: SYNTHETIC_RESOURCE_TRUST_BINDING.circuitOwner,
      ownerFailureDomain: SYNTHETIC_RESOURCE_TRUST_BINDING.circuitOwnerFailureDomain,
      observedAtMs: FIXTURE_NOW_MS - 100,
      maxAgeMs: 5_000,
      evidenceRef: `fixture.circuit.${index + 1}`,
      unknownReason: null,
      baselineNeverOpenedEvidenceRef: `fixture.circuit-baseline.${index + 1}`,
      baselineEvidenceOwner: SYNTHETIC_RESOURCE_TRUST_BINDING.independentCircuitOwner,
      baselineEvidenceFailureDomain: SYNTHETIC_RESOURCE_TRUST_BINDING.independentCircuitFailureDomain,
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
      kind: 'UNKNOWN',
      referenceId: null,
      owner: SYNTHETIC_RESOURCE_OWNER,
      wiringState: 'UNAVAILABLE',
      unknownReason: 'canonical resource owner confirmation is pending I00/I03 fan-in',
    },
    protections: {
      materialMoneyEvidencePreserved: 'PASS',
      auditEvidencePreserved: 'PASS',
      safeRiskReductionUnblocked: 'PASS',
    },
  };
}

export function makeResourceEvidenceBundle(override = {}) {
  const base = {
    schemaVersion: STABILITY_SCHEMA_VERSION,
    bundleId: 'resource-evidence.s8.001',
    rows: RESOURCE_FAMILIES.map(resourceRow),
    loadSheddingOrder: [...OPTIONAL_SHEDDING_CLASSES, ...PROTECTED_WORK_CLASSES],
    dataAuthority: 'SYNTHETIC_TEST',
    effectBoundary: {
      mayThrottle: false,
      mayExecute: false,
      mayCloseOrResetCircuit: false,
      controllerOwner: null,
    },
  };
  return deepFreeze(merge(base, override));
}

function replaceResourceRow(bundle, family, patch) {
  return bundle.rows.map((row) => row.resourceFamily === family ? merge(row, patch) : row);
}

const completeResourceBundle = makeResourceEvidenceBundle();

export const RESOURCE_FIXTURES = deepFreeze([
  {
    id: 'E01_EXACT_EIGHT_FAMILY_EVIDENCE_DENOMINATOR',
    input: completeResourceBundle,
    expectedResult: 'UNKNOWN',
  },
  {
    id: 'E02_UNKNOWN_FORECAST_REMAINS_NULL',
    input: makeResourceEvidenceBundle({
      bundleId: 'resource-evidence.s8.unknown-forecast',
      rows: replaceResourceRow(completeResourceBundle, 'TELEMETRY_STORAGE', {
        forecast: { value: null, horizonMs: null, unknownReason: 'forecast owner has not supplied a bounded projection' },
      }),
    }),
    expectedResult: 'UNKNOWN',
    expectedFamily: 'TELEMETRY_STORAGE',
    expectedReason: 'BURN_BUDGET_OR_FORECAST_UNKNOWN',
  },
  {
    id: 'E03_MISSING_RESOURCE_FAMILY_FAILS_DENOMINATOR',
    input: makeResourceEvidenceBundle({ rows: completeResourceBundle.rows.slice(0, -1) }),
    expectedResult: 'FAIL',
    expectedContractCode: 'RESOURCE_DENOMINATOR_MISMATCH',
  },
  {
    id: 'E04_PACKET_CANNOT_CLAIM_THROTTLE_AUTHORITY',
    input: makeResourceEvidenceBundle({
      effectBoundary: {
        mayThrottle: true,
        mayExecute: false,
        mayCloseOrResetCircuit: false,
        controllerOwner: 'stability-packet',
      },
    }),
    expectedResult: 'FAIL',
    expectedContractCode: 'AUTHORITY_FORBIDDEN',
  },
  {
    id: 'E05_MATERIAL_AUDIT_EVIDENCE_CANNOT_SHED',
    input: makeResourceEvidenceBundle({
      rows: replaceResourceRow(completeResourceBundle, 'DATABASE_WAL_GROWTH', {
        protections: {
          materialMoneyEvidencePreserved: 'PASS',
          auditEvidencePreserved: 'FAIL',
          safeRiskReductionUnblocked: 'PASS',
        },
      }),
    }),
    expectedResult: 'FAIL',
    expectedFamily: 'DATABASE_WAL_GROWTH',
    expectedReason: 'PROTECTED_TRUTH_OR_RISK_REDUCTION_VIOLATED',
  },
  {
    id: 'E06_SAFE_RISK_REDUCTION_CANNOT_BE_BLOCKED',
    input: makeResourceEvidenceBundle({
      rows: replaceResourceRow(completeResourceBundle, 'BINANCE_RATE_LIMITS', {
        protections: {
          materialMoneyEvidencePreserved: 'PASS',
          auditEvidencePreserved: 'PASS',
          safeRiskReductionUnblocked: 'FAIL',
        },
      }),
    }),
    expectedResult: 'FAIL',
    expectedFamily: 'BINANCE_RATE_LIMITS',
    expectedReason: 'PROTECTED_TRUTH_OR_RISK_REDUCTION_VIOLATED',
  },
  {
    id: 'E07_RESOURCE_BUDGET_EXHAUSTION_IS_VISIBLE_EVIDENCE_ONLY',
    input: makeResourceEvidenceBundle({
      rows: replaceResourceRow(completeResourceBundle, 'LLM_TOKENS', {
        burn: { value: 100, unknownReason: null },
        budget: { limit: 100, remaining: 0, unknownReason: null },
      }),
    }),
    expectedResult: 'FAIL',
    expectedFamily: 'LLM_TOKENS',
    expectedReason: 'RESOURCE_BUDGET_EXHAUSTED',
  },
  {
    id: 'E08_STALE_RESOURCE_EVIDENCE_IS_UNKNOWN',
    input: makeResourceEvidenceBundle({
      rows: replaceResourceRow(completeResourceBundle, 'CLOUD_COST', {
        observedAtMs: FIXTURE_NOW_MS - 10_000,
        maxAgeMs: 5_000,
      }),
    }),
    expectedResult: 'UNKNOWN',
    expectedFamily: 'CLOUD_COST',
    expectedReason: 'MEASUREMENT_STALE',
  },
  {
    id: 'E09_OPTIONAL_WORK_MUST_SHED_BEFORE_PROTECTED_WORK',
    input: makeResourceEvidenceBundle({
      loadSheddingOrder: ['ACTIVE_POSITION_SUPERVISION', ...OPTIONAL_SHEDDING_CLASSES, ...PROTECTED_WORK_CLASSES.filter((entry) => entry !== 'ACTIVE_POSITION_SUPERVISION')],
    }),
    expectedResult: 'FAIL',
    expectedContractCode: 'SHEDDING_PRIORITY_INVERTED',
  },
  {
    id: 'E10_UNKNOWN_NUMERIC_TRUTH_CANNOT_BE_FABRICATED_ZERO',
    input: makeResourceEvidenceBundle({
      rows: replaceResourceRow(completeResourceBundle, 'REPLAY_COMPUTE', {
        burn: { value: 0, unknownReason: 'measurement missing; zero was fabricated' },
      }),
    }),
    expectedResult: 'FAIL',
    expectedContractCode: 'UNKNOWN_REASON_CONFLICT',
  },
]);
