/** Render-neutral S8 projection. It replay-verifies synthetic assessments and never derives runtime owner truth. */
import {
  ASSURANCE_RESULTS,
  CANCELLATION_LATE_RESULT_LAW,
  OPERATION_CLASSES,
  OPTIONAL_SHEDDING_CLASSES,
  PROTECTED_WORK_CLASSES,
  RESOURCE_FAMILIES,
  STABILITY_SCHEMA_VERSION,
  STABILITY_STRUCTURE_LIMITS,
  SYNTHETIC_REPAIR_TRUST_BINDING,
  SYNTHETIC_CANCELLATION_TRUST_BINDINGS,
  SYNTHETIC_RESOURCE_OWNER,
  SYNTHETIC_RESOURCE_TRUST_BINDING,
  deepFreeze,
} from './contracts.mjs';
import {
  evaluateCancellationEvidence,
  evaluateRepairLoop,
  evaluateResourceEvidence,
} from './reference-evaluator.mjs';
import { captureCanonicalEvidence } from './integrity.mjs';

const DATA_AUTHORITY = 'SYNTHETIC_TEST';
const EFFECT_AUTHORITY = 'NONE';
const HISTORICAL_REPAIR_TRIGGER_CODES = Object.freeze([
  'NO_PROGRESS_THRESHOLD_REACHED',
  'CONTRADICTORY_PROGRESS_THRESHOLD_REACHED',
  'REPEATED_ROLLBACK_THRESHOLD_REACHED',
  'OSCILLATION_SIGNATURE_DETECTED',
  'CONFLICTING_CONTROLLERS_PRESENT',
]);
const CANCELLATION_INFORMATIONAL_CODES = Object.freeze([
  'DEADLINE_REACHED',
  'STALE_COMPLETION_REJECTED_AS_AUTHORITY',
  'CANCELLATION_INTENT_REQUESTED',
  'CANCELLATION_INTENT_OBSERVED',
  'CANCELLATION_INTENT_DOES_NOT_PROVE_MUTATION_ABSENCE',
  'REGISTERED_FENCED_RECOVERY_SURVIVES_INITIATOR_TIMEOUT',
  'LATE_EXTERNAL_TRUTH_RETAINED',
  'STALE_EPOCH_FACT_RETAINED_BUT_CANNOT_AUTHORIZE_NEW_WORK',
]);
const CANCELLATION_UNKNOWN_CODES = Object.freeze([
  'CANCELLATION_PROPAGATION_UNPROVED',
  'CANCELLATION_SUPPORT_UNKNOWN',
]);
const CANCELLATION_VIOLATION_CODES = Object.freeze([
  'EVALUATION_PRECEDES_REQUEST',
  'CANCEL_REQUEST_FROM_FUTURE',
  'CANCEL_OBSERVATION_FROM_FUTURE',
  'EFFECT_INITIATION_FROM_FUTURE',
  'EFFECT_COMMIT_FROM_FUTURE',
  'CANCELLATION_REQUEST_PRECEDES_REQUEST_START',
  'EFFECT_PRECEDES_REQUEST_START',
  'CHILD_BUDGET_OVERFLOW',
  'CHILD_DEADLINE_ESCAPES_PARENT',
  'CHILD_BUDGET_ESCAPES_PARENT',
  'EFFECT_INITIATED_AT_OR_AFTER_DEADLINE',
  'LEASE_OWNER_NOT_CANONICAL_OWNER',
  'LEASE_EVIDENCE_FROM_FUTURE',
  'LEASE_EPOCH_NOT_CURRENT',
  'LEASE_EXPIRED',
  'LEASE_HEARTBEAT_STALE',
  'STALE_COMPLETION_APPLIED_AFTER_HANDOFF',
  'LEASED_EFFECT_INITIATED_BEFORE_ACQUISITION',
  'LEASED_EFFECT_INITIATED_AT_OR_AFTER_EXPIRY',
  'LEASED_EFFECT_COMMITTED_BEFORE_ACQUISITION',
  'LEASED_EFFECT_COMMITTED_AT_OR_AFTER_EXPIRY',
  'CANCELLATION_OBSERVED_WITHOUT_REQUEST',
  'CANCELLATION_OBSERVED_BEFORE_REQUEST',
  'LOCAL_EFFECT_INITIATED_AFTER_CANCELLATION_OBSERVED',
  'DETACHED_RECOVERY_NOT_REGISTERED_OR_FENCED',
  'LATE_FACT_EVIDENCE_FROM_FUTURE',
  'STALE_EPOCH_FACT_ATTEMPTED_NEW_AUTHORITY',
  'AUTHORITATIVE_RECONCILIATION_EVIDENCE_MISSING',
  'RESTART_LOST_CANCELLATION_OR_LATE_RESULT_IDENTITY',
  'SYNTHETIC_CURRENT_LEASE_TRUST_BINDING_MISMATCH',
  'SYNTHETIC_DETACHED_RECOVERY_TRUST_BINDING_MISMATCH',
  'SYNTHETIC_RESTART_TRUST_BINDING_MISMATCH',
]);

// The evaluator does not project a source-owned validUntil. A PASS is therefore
// actionable only in the exact injected-clock frame in which it was evaluated.
export const STABILITY_PASS_ASSESSMENT_MAX_AGE_MS = 0;

function validNow(nowMs) {
  return Number.isSafeInteger(nowMs) && nowMs >= 0;
}

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fieldsMatch(value, expected) {
  return plainRecord(value)
    && Object.entries(expected).every(([field, expectedValue]) => (
      plainRecord(expectedValue)
        ? fieldsMatch(value[field], expectedValue)
        : value[field] === expectedValue
    ));
}

function overall(results) {
  if (results.includes('FAIL')) return 'FAIL';
  if (results.includes('UNKNOWN') || results.length === 0) return 'UNKNOWN';
  return 'PASS';
}

function validReasonCodes(value) {
  if (!Array.isArray(value) || value.length > STABILITY_STRUCTURE_LIMITS.stringArrayEntries) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)
      || typeof value[index] !== 'string'
      || value[index].length === 0
      || value[index].length > 240
      || !/^[A-Z][A-Z0-9_]*$/.test(value[index])) return false;
  }
  return true;
}

function sortedUniqueCodes(value) {
  return validReasonCodes(value)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1].localeCompare(entry) < 0);
}

const VALID_ASSESSMENT_KEYS = Object.freeze({
  CANCELLATION_DEADLINE_LEASE: Object.freeze([
    'schemaVersion', 'assessmentKind', 'recordId', 'requestId', 'operationId',
    'canonicalOwner', 'lateResultLaw', 'evaluatedAtMs', 'assuranceResult',
    'effectiveDeadlineAtMs', 'deadlineEvidence', 'leaseEvidence',
    'cancelIntentObserved', 'cancellationSupported', 'cancellationProvesMutationAbsence',
    'mayInitiateNewLocalEffects', 'authoritativeReconciliationRequired',
    'detachedRecoveryContinuationRequired', 'lateFactDisposition',
    'staleAuthorityRejected', 'sourceEvidence', 'authorityEvidence',
    'reasonCodes', 'violationCodes', 'unknownCodes',
    'contractIssues', 'dataAuthority', 'effectAuthority',
  ]),
  REPAIR_CONTROL_LOOP: Object.freeze([
    'schemaVersion', 'assessmentKind', 'campaignId', 'policyId', 'canonicalOwner',
    'evaluatedAtMs', 'assuranceResult', 'reasonCodes', 'violationCodes',
    'unknownCodes', 'triggerCodes', 'progressEvidence', 'budgetEvidence',
    'actuationGateBinding', 'attemptEvidence', 'circuitPosture',
    'containmentEvidenceSufficient', 'containmentLifecycle',
    'durableUnresolvedEvidenceRef', 'escalationOwner',
    'terminationWithinDeclaredBudget', 'terminationClaim', 'promotionEvidence',
    'requiredCanonicalResponse', 'automaticActionIssued', 'sourceEvidence', 'contractIssues',
    'dataAuthority', 'effectAuthority',
  ]),
  RESOURCE_COST_CIRCUIT_EVIDENCE: Object.freeze([
    'schemaVersion', 'assessmentKind', 'bundleId', 'evaluatedAtMs',
    'assuranceResult', 'rows', 'loadSheddingOrder', 'mayThrottle', 'mayExecute',
    'mayCloseOrResetCircuit', 'controllerOwner', 'throttleDecision', 'commands',
    'sourceEvidence', 'contractIssues', 'dataAuthority', 'effectAuthority',
  ]),
});

const INVALID_ASSESSMENT_KEYS = Object.freeze([
  'schemaVersion', 'assessmentKind', 'evaluatedAtMs', 'assuranceResult',
  'reasonCodes', 'contractIssues', 'dataAuthority', 'effectAuthority',
]);

function denseArray(value, maximumLength = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value) || value.length > maximumLength) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}

function exactObjectKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((entry, index) => entry === wanted[index]);
}

function label(value, { nullable = false } = {}) {
  return (nullable && value === null)
    || (typeof value === 'string' && value.length > 0 && value.length <= 240);
}

function safeTime(value, { nullable = false } = {}) {
  return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 0);
}

function nonNegativeNumber(value, { nullable = false } = {}) {
  return (nullable && value === null)
    || (typeof value === 'number' && Number.isFinite(value)
      && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
}

function boundedNumber(value, { nullable = false } = {}) {
  return (nullable && value === null)
    || (typeof value === 'number' && Number.isFinite(value)
      && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
}

function clonePlain(value) {
  if (Array.isArray(value)) return Array.from(value, clonePlain);
  if (!plainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlain(child)]));
}

function sameStructuredValue(candidate, expected, seen = new WeakMap()) {
  if (expected === null || typeof expected !== 'object') return candidate === expected;
  if (candidate === null || typeof candidate !== 'object') return false;
  if (seen.get(candidate) === expected) return true;
  seen.set(candidate, expected);
  if (Array.isArray(expected)) {
    if (!Array.isArray(candidate) || candidate.length !== expected.length) return false;
    for (let index = 0; index < expected.length; index += 1) {
      if (!Object.hasOwn(candidate, index) || !Object.hasOwn(expected, index)
        || !sameStructuredValue(candidate[index], expected[index], seen)) return false;
    }
    return true;
  }
  if (!plainRecord(expected) || !plainRecord(candidate)) return false;
  const candidateKeys = Object.keys(candidate).sort();
  const expectedKeys = Object.keys(expected).sort();
  return candidateKeys.length === expectedKeys.length
    && candidateKeys.every((key, index) => key === expectedKeys[index]
      && sameStructuredValue(candidate[key], expected[key], seen));
}

const CANCELLATION_LEASE_KEYS = Object.freeze([
  'resourceId', 'ownerId', 'processId', 'releaseId', 'leaseId', 'fenceEpoch',
  'activeFenceEpoch', 'acquiredAtMs', 'renewalSequence', 'lastRenewedAtMs',
  'lastHeartbeatAtMs', 'heartbeatMaxAgeMs', 'expiresAtMs', 'completionEpoch',
  'completionDisposition',
]);
const CANCELLATION_DETACHED_KEYS = Object.freeze([
  'reason', 'operationRegistered', 'operationRegistryRef', 'priorAuthorizationRef',
  'operationClass', 'canonicalOwner', 'fencedRecoveryContextId', 'leaseId',
  'leaseOwner', 'fenceEpoch', 'activeFenceEpoch', 'leaseExpiresAtMs',
  'fenceObservedAtMs', 'fenceMaxAgeMs', 'fenceEvidenceRef',
]);
const CANCELLATION_RESTART_KEYS = Object.freeze([
  'restoredFromCheckpoint', 'preservedRequestId', 'preservedLateResultLaw',
  'checkpointRef', 'stateDigestBeforeRestart', 'stateDigestAfterRestart',
  'restoredRequestId', 'restoredCancellationContextId',
  'restoredReconciliationIdentityRef', 'restoredLateResultLaw', 'preservedFields',
  'stateBeforeRestart', 'stateAfterRestart',
]);

function validCancellationLease(lease) {
  return exactObjectKeys(lease, CANCELLATION_LEASE_KEYS)
    && ['resourceId', 'ownerId', 'processId', 'releaseId', 'leaseId'].every((field) => label(lease[field]))
    && ['fenceEpoch', 'activeFenceEpoch', 'renewalSequence', 'heartbeatMaxAgeMs']
      .every((field) => Number.isSafeInteger(lease[field]) && lease[field] > 0)
    && ['acquiredAtMs', 'lastRenewedAtMs', 'lastHeartbeatAtMs', 'expiresAtMs']
      .every((field) => safeTime(lease[field]))
    && (lease.completionEpoch === null
      || (Number.isSafeInteger(lease.completionEpoch) && lease.completionEpoch > 0))
    && ['NOT_OBSERVED', 'APPLIED', 'REJECTED'].includes(lease.completionDisposition);
}

function cancellationLeasePosture(lease, atMs) {
  if ([lease.acquiredAtMs, lease.lastRenewedAtMs, lease.lastHeartbeatAtMs]
    .some((observedAtMs) => observedAtMs > atMs)) return 'FUTURE_EVIDENCE';
  if (lease.fenceEpoch !== lease.activeFenceEpoch) return 'STALE_EPOCH';
  if (atMs >= lease.expiresAtMs) return 'EXPIRED';
  if (atMs - lease.lastHeartbeatAtMs > lease.heartbeatMaxAgeMs) return 'STALE_HEARTBEAT';
  return 'CURRENT';
}

function validDetachedRecovery(detached, operationClass, canonicalOwner, atMs) {
  return exactObjectKeys(detached, CANCELLATION_DETACHED_KEYS)
    && ['DURABLE_RECONCILIATION', 'AUTHORITATIVE_EVIDENCE_INGESTION', 'ALREADY_AUTHORIZED_RISK_REDUCTION'].includes(detached.reason)
    && detached.operationRegistered === true
    && label(detached.operationRegistryRef)
    && label(detached.priorAuthorizationRef, { nullable: true })
    && detached.operationClass === operationClass
    && detached.canonicalOwner === canonicalOwner
    && label(detached.fencedRecoveryContextId)
    && label(detached.leaseId)
    && detached.leaseOwner === canonicalOwner
    && Number.isSafeInteger(detached.fenceEpoch) && detached.fenceEpoch > 0
    && detached.fenceEpoch === detached.activeFenceEpoch
    && safeTime(detached.leaseExpiresAtMs)
    && safeTime(detached.fenceObservedAtMs)
    && Number.isSafeInteger(detached.fenceMaxAgeMs) && detached.fenceMaxAgeMs > 0
    && label(detached.fenceEvidenceRef)
    && detached.fenceObservedAtMs <= atMs
    && atMs - detached.fenceObservedAtMs <= detached.fenceMaxAgeMs
    && atMs < detached.leaseExpiresAtMs
    && (detached.reason !== 'ALREADY_AUTHORIZED_RISK_REDUCTION'
      || (operationClass === 'RISK_REDUCING_RECOVERY' && label(detached.priorAuthorizationRef)));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assessmentAuthorityValid(assessment) {
  return assessment.dataAuthority === DATA_AUTHORITY
    && assessment.effectAuthority === EFFECT_AUTHORITY
    && !Object.hasOwn(assessment, 'authority');
}

const REPAIR_GATE_KEYS = Object.freeze([
  'readinessEvidenceRef', 'readinessObservedAtMs', 'readinessMaxAgeMs',
  'conflictGraphEvidenceRef', 'conflictGraphObservedAtMs', 'conflictGraphMaxAgeMs',
]);

function validRepairGateEvidence(gate) {
  return exactObjectKeys(gate, REPAIR_GATE_KEYS)
    && label(gate.readinessEvidenceRef)
    && safeTime(gate.readinessObservedAtMs)
    && Number.isSafeInteger(gate.readinessMaxAgeMs)
    && gate.readinessMaxAgeMs > 0
    && label(gate.conflictGraphEvidenceRef)
    && safeTime(gate.conflictGraphObservedAtMs)
    && Number.isSafeInteger(gate.conflictGraphMaxAgeMs)
    && gate.conflictGraphMaxAgeMs > 0;
}

function repairGateMatchesBinding(gate, binding) {
  return validRepairGateEvidence(gate)
    && validRepairGateEvidence(binding)
    && REPAIR_GATE_KEYS.every((field) => gate[field] === binding[field]);
}

const REPAIR_CIRCUIT_KEYS = Object.freeze([
  'state', 'canonicalOwner', 'ownerFailureDomain', 'observedAtMs', 'maxAgeMs',
  'evidenceRef', 'unknownReason', 'priorEvidenceRef',
  'baselineNeverOpenedEvidenceRef', 'baselineEvidenceOwner',
  'baselineEvidenceFailureDomain', 'openedAtMs', 'halfOpenAtMs',
  'resetEligibleAtMs', 'closedAtMs', 'independentCloseEvidenceRef',
  'independentCloseOwner', 'independentCloseFailureDomain', 'mayCloseOrReset',
]);

function knownRepairCircuit(circuit) {
  return plainRecord(circuit) && circuit.state !== 'UNKNOWN';
}

function repairCircuitCloseProven(circuit, producerOwner, producerFailureDomain) {
  if (circuit?.state !== 'CLOSED') return false;
  const baselineFields = [
    circuit.baselineNeverOpenedEvidenceRef,
    circuit.baselineEvidenceOwner,
    circuit.baselineEvidenceFailureDomain,
  ];
  const transitionFields = [
    circuit.priorEvidenceRef, circuit.openedAtMs, circuit.halfOpenAtMs,
    circuit.resetEligibleAtMs, circuit.closedAtMs,
    circuit.independentCloseEvidenceRef, circuit.independentCloseOwner,
    circuit.independentCloseFailureDomain,
  ];
  const baselinePresent = baselineFields.some((entry) => entry !== null);
  const transitionPresent = transitionFields.some((entry) => entry !== null);
  const baselineProven = !transitionPresent
    && baselineFields.every((entry) => entry !== null)
    && circuit.baselineEvidenceOwner !== null
    && circuit.baselineEvidenceFailureDomain !== null
    && circuit.baselineNeverOpenedEvidenceRef !== circuit.evidenceRef
    && circuit.baselineEvidenceOwner !== circuit.canonicalOwner
    && circuit.baselineEvidenceFailureDomain !== circuit.ownerFailureDomain
    && circuit.baselineEvidenceOwner !== producerOwner
    && circuit.baselineEvidenceFailureDomain !== producerFailureDomain;
  const transitionProven = !baselinePresent
    && transitionFields.every((entry) => entry !== null)
    && circuit.openedAtMs <= circuit.halfOpenAtMs
    && circuit.halfOpenAtMs <= circuit.resetEligibleAtMs
    && circuit.resetEligibleAtMs <= circuit.closedAtMs
    && circuit.independentCloseEvidenceRef !== circuit.evidenceRef
    && circuit.independentCloseOwner !== circuit.canonicalOwner
    && circuit.independentCloseFailureDomain !== circuit.ownerFailureDomain
    && circuit.independentCloseOwner !== producerOwner
    && circuit.independentCloseFailureDomain !== producerFailureDomain;
  return baselineProven !== transitionProven && circuit.mayCloseOrReset === false;
}

function repairCircuitFresh(circuit, nowMs) {
  return knownRepairCircuit(circuit)
    && safeTime(circuit.observedAtMs)
    && Number.isSafeInteger(circuit.maxAgeMs)
    && circuit.maxAgeMs > 0
    && circuit.observedAtMs <= nowMs
    && nowMs - circuit.observedAtMs <= circuit.maxAgeMs;
}

function repairCircuitMatchesSyntheticTrust(circuit, index) {
  if (!plainRecord(circuit)) return false;
  const trust = SYNTHETIC_REPAIR_TRUST_BINDING;
  const knownCircuit = circuit.state !== 'UNKNOWN';
  const initialPriorMatches = index !== 0
    || circuit.priorEvidenceRef === null
    || circuit.priorEvidenceRef === trust.initialCircuitPriorEvidenceRefs[circuit.state];
  const independentCloseMatches = circuit.independentCloseEvidenceRef === null
    || (circuit.independentCloseEvidenceRef === `${trust.independentCircuitEvidenceRefPrefix}${index + 1}`
      && circuit.independentCloseOwner === trust.independentCircuitOwner
      && circuit.independentCloseFailureDomain === trust.independentCircuitFailureDomain);
  const baselineMatches = circuit.baselineNeverOpenedEvidenceRef === null
    || (circuit.baselineNeverOpenedEvidenceRef === `${trust.independentCircuitBaselineEvidenceRefPrefix}${index + 1}`
      && circuit.baselineEvidenceOwner === trust.independentCircuitOwner
      && circuit.baselineEvidenceFailureDomain === trust.independentCircuitFailureDomain);
  return circuit.canonicalOwner === trust.circuitOwner
    && (!knownCircuit || circuit.ownerFailureDomain === trust.circuitOwnerFailureDomain)
    && (!knownCircuit || circuit.evidenceRef === `${trust.circuitEvidenceRefPrefix}${index + 1}`)
    && initialPriorMatches
    && independentCloseMatches
    && baselineMatches;
}

function validateRepairCircuitEvidence(
  circuit,
  producerOwner,
  producerFailureDomain,
  completedAtMs,
  evaluatedAtMs,
  nowMs,
  issues,
) {
  if (!exactObjectKeys(circuit, REPAIR_CIRCUIT_KEYS)
    || !['OPEN', 'HALF_OPEN', 'CLOSED', 'UNKNOWN'].includes(circuit?.state)
    || !label(circuit?.canonicalOwner)
    || !label(circuit?.ownerFailureDomain, { nullable: true })
    || !safeTime(circuit?.observedAtMs, { nullable: true })
    || !Number.isSafeInteger(circuit?.maxAgeMs) || circuit.maxAgeMs <= 0
    || !['evidenceRef', 'unknownReason', 'priorEvidenceRef',
      'baselineNeverOpenedEvidenceRef', 'baselineEvidenceOwner',
      'baselineEvidenceFailureDomain', 'independentCloseEvidenceRef',
      'independentCloseOwner', 'independentCloseFailureDomain']
      .every((field) => label(circuit?.[field], { nullable: true }))
    || !['openedAtMs', 'halfOpenAtMs', 'resetEligibleAtMs', 'closedAtMs']
      .every((field) => safeTime(circuit?.[field], { nullable: true }))
    || circuit?.mayCloseOrReset !== false) {
    issues.push('REPAIR_ATTEMPT_CIRCUIT_EVIDENCE_INVALID');
    return;
  }

  const transitionValues = [
    circuit.openedAtMs, circuit.halfOpenAtMs, circuit.resetEligibleAtMs,
    circuit.closedAtMs, circuit.independentCloseEvidenceRef,
    circuit.independentCloseOwner, circuit.independentCloseFailureDomain,
  ];
  const baselineValues = [
    circuit.baselineNeverOpenedEvidenceRef, circuit.baselineEvidenceOwner,
    circuit.baselineEvidenceFailureDomain,
  ];
  const baselinePresent = baselineValues.some((entry) => entry !== null);
  const priorOpen = transitionValues.some((entry) => entry !== null);
  if (circuit.state === 'UNKNOWN') {
    if (circuit.ownerFailureDomain !== null || circuit.observedAtMs !== null
      || circuit.evidenceRef !== null || circuit.unknownReason === null
      || circuit.priorEvidenceRef !== null || priorOpen || baselinePresent) {
      issues.push('REPAIR_ATTEMPT_CIRCUIT_EVIDENCE_INVALID');
    }
    return;
  }
  if (circuit.ownerFailureDomain === null || circuit.observedAtMs === null
    || circuit.evidenceRef === null || circuit.unknownReason !== null) {
    issues.push('REPAIR_ATTEMPT_CIRCUIT_EVIDENCE_INVALID');
    return;
  }
  if (circuit.observedAtMs < completedAtMs
    || circuit.observedAtMs > evaluatedAtMs || circuit.observedAtMs > nowMs
    || [circuit.openedAtMs, circuit.halfOpenAtMs, circuit.resetEligibleAtMs, circuit.closedAtMs]
      .some((time) => time !== null && time > circuit.observedAtMs)) {
    issues.push('REPAIR_ATTEMPT_CIRCUIT_EVIDENCE_TIME_INVALID');
  }
  if (circuit.state === 'OPEN'
    && (circuit.priorEvidenceRef === null || circuit.openedAtMs === null
      || circuit.resetEligibleAtMs !== null || circuit.closedAtMs !== null
      || circuit.independentCloseEvidenceRef !== null || circuit.independentCloseOwner !== null
      || circuit.independentCloseFailureDomain !== null
      || (circuit.halfOpenAtMs !== null && circuit.halfOpenAtMs < circuit.openedAtMs)
      || baselinePresent)) issues.push('REPAIR_ATTEMPT_CIRCUIT_EVIDENCE_INVALID');
  if (circuit.state === 'HALF_OPEN'
    && (circuit.priorEvidenceRef === null || circuit.openedAtMs === null
      || circuit.halfOpenAtMs === null || circuit.halfOpenAtMs < circuit.openedAtMs
      || (circuit.resetEligibleAtMs !== null && circuit.resetEligibleAtMs < circuit.halfOpenAtMs)
      || circuit.closedAtMs !== null
      || circuit.independentCloseEvidenceRef !== null || circuit.independentCloseOwner !== null
      || circuit.independentCloseFailureDomain !== null || baselinePresent)) {
    issues.push('REPAIR_ATTEMPT_CIRCUIT_EVIDENCE_INVALID');
  }
  if (circuit.state === 'CLOSED'
    && !repairCircuitCloseProven(circuit, producerOwner, producerFailureDomain)) {
    issues.push('REPAIR_ATTEMPT_CIRCUIT_CLOSE_PROOF_INVALID');
  }
}

function validateRepairAttemptEvidence(assessment, nowMs, issues) {
  if (!denseArray(assessment.attemptEvidence, STABILITY_STRUCTURE_LIMITS.repairAttempts)) {
    issues.push('REPAIR_ATTEMPT_EVIDENCE_INVALID');
    return;
  }
  if (plainRecord(assessment.budgetEvidence)
    && Number.isSafeInteger(assessment.budgetEvidence.attempts)
    && assessment.attemptEvidence.length !== assessment.budgetEvidence.attempts) {
    issues.push('REPAIR_ATTEMPT_COUNT_MISMATCH');
  }
  const ids = new Set();
  let previous = null;
  for (let index = 0; index < assessment.attemptEvidence.length; index += 1) {
    const attempt = assessment.attemptEvidence[index];
    if (!exactObjectKeys(attempt, [
      'attemptId', 'startedAtMs', 'completedAtMs', 'producerOwner',
      'producerFailureDomain', 'producerEvidenceRef', 'verifierOwner',
      'verifierFailureDomain', 'verifierEvidenceRef',
      'actuationGateEvidence', 'circuitEvidence',
    ]) || !label(attempt?.attemptId) || !safeTime(attempt?.startedAtMs)
      || !safeTime(attempt?.completedAtMs) || attempt.completedAtMs < attempt.startedAtMs
      || !label(attempt?.producerOwner) || !label(attempt?.producerFailureDomain)
      || !label(attempt?.producerEvidenceRef) || !label(attempt?.verifierOwner)
      || !label(attempt?.verifierFailureDomain) || !label(attempt?.verifierEvidenceRef)
      || attempt?.producerOwner === attempt?.verifierOwner
      || attempt?.producerFailureDomain === attempt?.verifierFailureDomain
      || attempt?.producerEvidenceRef === attempt?.verifierEvidenceRef
      || attempt.completedAtMs > assessment.evaluatedAtMs || ids.has(attempt.attemptId)) {
      issues.push('REPAIR_ATTEMPT_EVIDENCE_INVALID');
      continue;
    }
    if (previous !== null && attempt.startedAtMs < previous.completedAtMs) {
      issues.push('REPAIR_ATTEMPT_SEQUENCE_INVALID');
    }
    ids.add(attempt.attemptId);
    const gate = attempt.actuationGateEvidence;
    if (!validRepairGateEvidence(gate)
      || gate.readinessObservedAtMs > attempt.startedAtMs
      || attempt.startedAtMs - gate.readinessObservedAtMs > gate.readinessMaxAgeMs
      || gate.conflictGraphObservedAtMs > attempt.startedAtMs
      || attempt.startedAtMs - gate.conflictGraphObservedAtMs > gate.conflictGraphMaxAgeMs) {
      issues.push('REPAIR_ATTEMPT_GATE_EVIDENCE_INVALID');
    }
    if (!repairGateMatchesBinding(gate, assessment.actuationGateBinding)) {
      issues.push('REPAIR_ATTEMPT_GATE_BINDING_MISMATCH');
    }
    validateRepairCircuitEvidence(
      attempt.circuitEvidence,
      attempt.producerOwner,
      attempt.producerFailureDomain,
      attempt.completedAtMs,
      assessment.evaluatedAtMs,
      nowMs,
      issues,
    );
    if (!repairCircuitMatchesSyntheticTrust(attempt.circuitEvidence, index)) {
      issues.push('REPAIR_CIRCUIT_TRUST_BINDING_MISMATCH');
    }
    if (previous !== null && attempt.circuitEvidence?.state !== 'UNKNOWN'
      && attempt.circuitEvidence?.priorEvidenceRef !== previous.circuitEvidence?.evidenceRef) {
      issues.push('REPAIR_ATTEMPT_CIRCUIT_CHAIN_INVALID');
    }
    if (previous !== null
      && plainRecord(previous.circuitEvidence)
      && attempt.circuitEvidence?.priorEvidenceRef === previous.circuitEvidence.evidenceRef) {
      if (attempt.circuitEvidence.canonicalOwner !== previous.circuitEvidence.canonicalOwner) {
        issues.push('REPAIR_ATTEMPT_CIRCUIT_OWNER_CHAIN_MISMATCH');
      }
      if (attempt.circuitEvidence.ownerFailureDomain !== previous.circuitEvidence.ownerFailureDomain) {
        issues.push('REPAIR_ATTEMPT_CIRCUIT_OWNER_FAILURE_DOMAIN_CHAIN_MISMATCH');
      }
      if (['openedAtMs', 'halfOpenAtMs', 'resetEligibleAtMs', 'closedAtMs']
        .some((field) => previous.circuitEvidence[field] !== null
          && attempt.circuitEvidence[field] !== previous.circuitEvidence[field])) {
        issues.push('REPAIR_ATTEMPT_CIRCUIT_TRANSITION_HISTORY_CHAIN_INVALID');
      }
    }
    if (previous !== null && plainRecord(previous.circuitEvidence)) {
      const priorCircuit = previous.circuitEvidence;
      if (priorCircuit.state === 'UNKNOWN') {
        issues.push('REPAIR_NEXT_ATTEMPT_WITH_UNKNOWN_CIRCUIT');
      } else {
        if (priorCircuit.observedAtMs > attempt.startedAtMs
          || !repairCircuitFresh(priorCircuit, attempt.startedAtMs)) {
          issues.push('REPAIR_PRIOR_CIRCUIT_NOT_FRESH_AT_NEXT_ATTEMPT');
        }
        if (priorCircuit.state === 'OPEN') {
          issues.push('REPAIR_NEXT_ATTEMPT_WITH_OPEN_CIRCUIT');
        }
      }
    }
    previous = attempt;
  }

  const trust = SYNTHETIC_REPAIR_TRUST_BINDING;
  const producerRefs = assessment.attemptEvidence.map((attempt) => attempt?.producerEvidenceRef);
  const verifierRefs = assessment.attemptEvidence.map((attempt) => attempt?.verifierEvidenceRef);
  const identitiesMatch = assessment.attemptEvidence.every((attempt) => (
    attempt?.producerOwner === trust.producerSignal.sourceOwner
      && attempt?.producerFailureDomain === trust.producerSignal.failureDomain
      && attempt?.verifierOwner === trust.verifierSignal.sourceOwner
      && attempt?.verifierFailureDomain === trust.verifierSignal.failureDomain
  ));
  if (!identitiesMatch) issues.push('REPAIR_ATTEMPT_IDENTITY_TRUST_BINDING_MISMATCH');
  if (new Set(producerRefs).size !== producerRefs.length
    || new Set(verifierRefs).size !== verifierRefs.length
    || producerRefs.some((entry) => verifierRefs.includes(entry))) {
    issues.push('REPAIR_CAMPAIGN_EVIDENCE_REFERENCE_REUSE_FORBIDDEN');
  }
  const circuitRefs = assessment.attemptEvidence
    .map((attempt) => attempt?.circuitEvidence?.evidenceRef)
    .filter((entry) => typeof entry === 'string');
  const firstPriorRef = assessment.attemptEvidence[0]?.circuitEvidence?.priorEvidenceRef;
  if (new Set(circuitRefs).size !== circuitRefs.length
    || (typeof firstPriorRef === 'string' && circuitRefs.includes(firstPriorRef))) {
    issues.push('REPAIR_CIRCUIT_REFERENCE_GRAPH_INVALID');
  }
  const signalRefs = [...producerRefs, ...verifierRefs];
  const circuitRoleRefs = assessment.attemptEvidence.flatMap((attempt) => [
    attempt?.circuitEvidence?.evidenceRef,
    attempt?.circuitEvidence?.priorEvidenceRef,
    attempt?.circuitEvidence?.baselineNeverOpenedEvidenceRef,
    attempt?.circuitEvidence?.independentCloseEvidenceRef,
  ]).filter((entry) => typeof entry === 'string');
  const gateRefs = [
    assessment.actuationGateBinding?.readinessEvidenceRef,
    assessment.actuationGateBinding?.conflictGraphEvidenceRef,
  ].filter((entry) => typeof entry === 'string');
  if (signalRefs.some((entry) => circuitRoleRefs.includes(entry) || gateRefs.includes(entry))
    || gateRefs.some((entry) => circuitRoleRefs.includes(entry))) {
    issues.push('REPAIR_CROSS_ROLE_EVIDENCE_REFERENCE_REUSE_FORBIDDEN');
  }

  if (!exactObjectKeys(assessment.circuitPosture, ['state', 'evidenceFresh', 'independentCloseProven'])
    || !['OPEN', 'HALF_OPEN', 'CLOSED', 'UNKNOWN'].includes(assessment.circuitPosture?.state)
    || !(typeof assessment.circuitPosture?.evidenceFresh === 'boolean'
      || assessment.circuitPosture?.evidenceFresh === null)
    || !(typeof assessment.circuitPosture?.independentCloseProven === 'boolean'
      || assessment.circuitPosture?.independentCloseProven === null)) {
    issues.push('REPAIR_CIRCUIT_POSTURE_INVALID');
    return;
  }
  const latest = assessment.attemptEvidence.at(-1) ?? null;
  const expectedState = latest?.circuitEvidence?.state ?? 'UNKNOWN';
  const expectedFresh = latest === null
    ? null
    : repairCircuitFresh(latest.circuitEvidence, assessment.evaluatedAtMs);
  const expectedClose = latest === null
    ? null
    : repairCircuitCloseProven(
      latest.circuitEvidence,
      latest.producerOwner,
      latest.producerFailureDomain,
    );
  if (assessment.circuitPosture.state !== expectedState
    || assessment.circuitPosture.evidenceFresh !== expectedFresh
    || assessment.circuitPosture.independentCloseProven !== expectedClose) {
    issues.push('REPAIR_CIRCUIT_POSTURE_INVALID');
  }
}

function canonicalAssessmentReplay(assessment) {
  if (!plainRecord(assessment.sourceEvidence) || !safeTime(assessment.evaluatedAtMs)) return null;
  try {
    if (assessment.assessmentKind === 'CANCELLATION_DEADLINE_LEASE') {
      return evaluateCancellationEvidence(assessment.sourceEvidence, assessment.evaluatedAtMs);
    }
    if (assessment.assessmentKind === 'REPAIR_CONTROL_LOOP') {
      if (!exactObjectKeys(assessment.sourceEvidence, ['policy', 'evidence'])) return null;
      return evaluateRepairLoop(
        assessment.sourceEvidence.policy,
        assessment.sourceEvidence.evidence,
        assessment.evaluatedAtMs,
      );
    }
    if (assessment.assessmentKind === 'RESOURCE_COST_CIRCUIT_EVIDENCE') {
      return evaluateResourceEvidence(assessment.sourceEvidence, assessment.evaluatedAtMs);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAssessment(assessment, expectedKind, index, nowMs, { reasonCodesOptional = false } = {}) {
  const issues = [];
  let stalePassCode = null;
  let projectedLeaseEvidence = null;
  let projectedDetachedRecoveryContinuationRequired = null;
  if (!plainRecord(assessment)) {
    issues.push('ASSESSMENT_OBJECT_REQUIRED');
  } else {
    if (assessment.assessmentKind !== expectedKind) issues.push('ASSESSMENT_KIND_INVALID');
    if (!ASSURANCE_RESULTS.includes(assessment.assuranceResult)) issues.push('ASSESSMENT_RESULT_INVALID');
    if (!(reasonCodesOptional && assessment.reasonCodes === undefined)
      && !validReasonCodes(assessment.reasonCodes)) issues.push('ASSESSMENT_REASON_CODES_INVALID');
    if (!assessmentAuthorityValid(assessment)) issues.push('ASSESSMENT_EFFECT_AUTHORITY_FORBIDDEN');
    if (!Number.isSafeInteger(assessment.evaluatedAtMs) || assessment.evaluatedAtMs < 0
      || assessment.evaluatedAtMs > nowMs) issues.push('ASSESSMENT_EVALUATED_AT_INVALID');
    if (assessment.assuranceResult === 'PASS'
      && Number.isSafeInteger(assessment.evaluatedAtMs)
      && assessment.evaluatedAtMs >= 0
      && assessment.evaluatedAtMs <= nowMs
      && nowMs - assessment.evaluatedAtMs > STABILITY_PASS_ASSESSMENT_MAX_AGE_MS
      && ['CANCELLATION_DEADLINE_LEASE', 'REPAIR_CONTROL_LOOP'].includes(expectedKind)) {
      stalePassCode = `${expectedKind === 'CANCELLATION_DEADLINE_LEASE' ? 'CANCELLATION' : 'REPAIR'}_PASS_ASSESSMENT_STALE`;
    }
    const contractInvalid = assessment.assuranceResult === 'FAIL'
      && Array.isArray(assessment.reasonCodes)
      && assessment.reasonCodes.includes('CONTRACT_INVALID');
    if (!exactObjectKeys(assessment, contractInvalid ? INVALID_ASSESSMENT_KEYS : VALID_ASSESSMENT_KEYS[expectedKind])) {
      issues.push('ASSESSMENT_EXACT_SHAPE_REQUIRED');
    }
    if (assessment.schemaVersion !== STABILITY_SCHEMA_VERSION) issues.push('ASSESSMENT_SCHEMA_INVALID');
    if (!denseArray(assessment.contractIssues, STABILITY_STRUCTURE_LIMITS.repairAttempts)
      || assessment.contractIssues.some((issue) => !exactObjectKeys(issue, ['path', 'code', 'detail'])
        || !label(issue.path) || !label(issue.code) || !label(issue.detail))) {
      issues.push('ASSESSMENT_CONTRACT_ISSUES_INVALID');
    } else if ((contractInvalid && assessment.contractIssues.length === 0)
      || (!contractInvalid && assessment.contractIssues.length !== 0)) {
      issues.push('ASSESSMENT_CONTRACT_ISSUES_RESULT_CONFLICT');
    }
    const requiredByKind = {
      CANCELLATION_DEADLINE_LEASE: [
        'recordId', 'requestId', 'operationId', 'canonicalOwner', 'lateResultLaw', 'evaluatedAtMs',
        'deadlineEvidence', 'leaseEvidence', 'cancelIntentObserved',
        'cancellationProvesMutationAbsence', 'mayInitiateNewLocalEffects',
        'authoritativeReconciliationRequired', 'lateFactDisposition',
        'staleAuthorityRejected', 'violationCodes', 'unknownCodes', 'contractIssues',
      ],
      REPAIR_CONTROL_LOOP: [
        'campaignId', 'policyId', 'canonicalOwner', 'evaluatedAtMs',
        'violationCodes', 'unknownCodes', 'triggerCodes', 'progressEvidence',
        'budgetEvidence', 'actuationGateBinding', 'attemptEvidence', 'circuitPosture',
        'containmentEvidenceSufficient',
        'containmentLifecycle', 'durableUnresolvedEvidenceRef', 'escalationOwner',
        'terminationWithinDeclaredBudget', 'terminationClaim', 'promotionEvidence',
        'requiredCanonicalResponse', 'automaticActionIssued', 'contractIssues',
      ],
      RESOURCE_COST_CIRCUIT_EVIDENCE: [
        'bundleId', 'evaluatedAtMs', 'rows', 'loadSheddingOrder', 'mayThrottle',
        'mayExecute', 'mayCloseOrResetCircuit', 'controllerOwner',
        'throttleDecision', 'commands', 'contractIssues',
      ],
    };
    if (!contractInvalid && requiredByKind[expectedKind]
      && requiredByKind[expectedKind].some((field) => !Object.hasOwn(assessment, field))) {
      issues.push('ASSESSMENT_REQUIRED_FIELDS_MISSING');
    }
    if (!contractInvalid) {
      const replay = canonicalAssessmentReplay(assessment);
      if (replay === null || !sameStructuredValue(assessment, replay)) {
        issues.push('ASSESSMENT_SOURCE_REPLAY_MISMATCH');
      }
    }
    if (!contractInvalid && ['CANCELLATION_DEADLINE_LEASE', 'REPAIR_CONTROL_LOOP'].includes(expectedKind)) {
      if (!sortedUniqueCodes(assessment.violationCodes)
        || !sortedUniqueCodes(assessment.unknownCodes)) {
        issues.push('ASSESSMENT_CODE_ARRAY_INVALID');
      } else if ((assessment.assuranceResult === 'PASS'
          && (assessment.violationCodes.length > 0 || assessment.unknownCodes.length > 0))
        || (assessment.assuranceResult === 'UNKNOWN'
          && (assessment.violationCodes.length > 0 || assessment.unknownCodes.length === 0))
        || (assessment.assuranceResult === 'FAIL' && assessment.violationCodes.length === 0)) {
        issues.push('ASSESSMENT_RESULT_CODE_MISMATCH');
      }
      if (validReasonCodes(assessment.reasonCodes)
        && validReasonCodes(assessment.violationCodes)
        && validReasonCodes(assessment.unknownCodes)
        && [...assessment.violationCodes, ...assessment.unknownCodes]
          .some((code) => !assessment.reasonCodes.includes(code))) {
        issues.push('ASSESSMENT_REASON_CODE_BINDING_INVALID');
      }
    }
    if (!contractInvalid && expectedKind === 'CANCELLATION_DEADLINE_LEASE'
      && assessment.cancellationProvesMutationAbsence !== false) issues.push('CANCELLATION_ABSENCE_CLAIM_FORBIDDEN');
    if (!contractInvalid && expectedKind === 'CANCELLATION_DEADLINE_LEASE'
      && assessment.lateResultLaw !== CANCELLATION_LATE_RESULT_LAW) issues.push('CANCELLATION_LATE_RESULT_LAW_INVALID');
    if (!contractInvalid && expectedKind === 'CANCELLATION_DEADLINE_LEASE') {
      if (!label(assessment.recordId) || !label(assessment.requestId) || !label(assessment.operationId)
        || !label(assessment.canonicalOwner)
        || !safeTime(assessment.effectiveDeadlineAtMs, { nullable: true })
        || !['ACTIVE', 'EXPIRED', 'LEASE_GOVERNED'].includes(assessment.deadlineEvidence)
        || !['NOT_APPLICABLE', 'CURRENT', 'FUTURE_EVIDENCE', 'STALE_EPOCH', 'EXPIRED', 'STALE_HEARTBEAT'].includes(assessment.leaseEvidence)
        || typeof assessment.cancelIntentObserved !== 'boolean'
        || !(typeof assessment.cancellationSupported === 'boolean' || assessment.cancellationSupported === null)
        || typeof assessment.mayInitiateNewLocalEffects !== 'boolean'
        || typeof assessment.authoritativeReconciliationRequired !== 'boolean'
        || typeof assessment.detachedRecoveryContinuationRequired !== 'boolean'
        || !['NOT_APPLICABLE', 'INGEST_DURABLY_AND_RECONCILE'].includes(assessment.lateFactDisposition)
        || typeof assessment.staleAuthorityRejected !== 'boolean') {
        issues.push('CANCELLATION_ASSESSMENT_FIELDS_INVALID');
      }
      if ((assessment.deadlineEvidence === 'LEASE_GOVERNED') !== (assessment.leaseEvidence !== 'NOT_APPLICABLE')) issues.push('CANCELLATION_DEADLINE_LEASE_BRANCH_CONFLICT');
      if (assessment.deadlineEvidence !== 'LEASE_GOVERNED' && assessment.effectiveDeadlineAtMs === null) issues.push('CANCELLATION_DEADLINE_EVIDENCE_MISSING');
      if (assessment.deadlineEvidence === 'LEASE_GOVERNED' && assessment.effectiveDeadlineAtMs !== null) issues.push('CANCELLATION_ROOT_DEADLINE_FOR_LONG_LIVED_WORK');
      if ((assessment.cancelIntentObserved || assessment.deadlineEvidence === 'EXPIRED'
          || (assessment.leaseEvidence !== 'NOT_APPLICABLE' && assessment.leaseEvidence !== 'CURRENT'))
        && assessment.mayInitiateNewLocalEffects) issues.push('CANCELLATION_MAY_INITIATE_CONTRADICTS_STOP_EVIDENCE');
      if (assessment.lateFactDisposition === 'INGEST_DURABLY_AND_RECONCILE'
        && !assessment.authoritativeReconciliationRequired) issues.push('CANCELLATION_LATE_FACT_RECONCILIATION_CONFLICT');
      if (validReasonCodes(assessment.reasonCodes)
        && validReasonCodes(assessment.violationCodes)
        && validReasonCodes(assessment.unknownCodes)) {
        const reasons = new Set(assessment.reasonCodes);
        const violations = new Set(assessment.violationCodes);
        const unknowns = new Set(assessment.unknownCodes);
        const allowedReasons = new Set([
          ...CANCELLATION_INFORMATIONAL_CODES,
          ...CANCELLATION_UNKNOWN_CODES,
          ...CANCELLATION_VIOLATION_CODES,
        ]);
        if (!sortedUniqueCodes(assessment.reasonCodes)
          || assessment.reasonCodes.some((code) => !allowedReasons.has(code))
          || assessment.violationCodes.some((code) => !CANCELLATION_VIOLATION_CODES.includes(code))
          || assessment.unknownCodes.some((code) => !CANCELLATION_UNKNOWN_CODES.includes(code))) {
          issues.push('CANCELLATION_CODE_TAXONOMY_INVALID');
        }

        const authority = assessment.authorityEvidence;
        const authorityKeys = [
          'requestKind', 'operationClass', 'cancellationContextId', 'lease',
          'detachedRecovery', 'reconciliationEvidence', 'restartEvidence',
        ];
        const authorityShapeValid = exactObjectKeys(authority, authorityKeys)
          && ['BOUNDED_INTERNAL', 'LONG_LIVED_LEASED'].includes(authority.requestKind)
          && OPERATION_CLASSES.includes(authority.operationClass)
          && label(authority.cancellationContextId)
          && (authority.lease === null || validCancellationLease(authority.lease))
          && (authority.detachedRecovery === null || plainRecord(authority.detachedRecovery))
          && exactObjectKeys(authority.reconciliationEvidence, ['required', 'operationLookupRef', 'durableEvidenceRef'])
          && typeof authority.reconciliationEvidence.required === 'boolean'
          && label(authority.reconciliationEvidence.operationLookupRef, { nullable: true })
          && label(authority.reconciliationEvidence.durableEvidenceRef, { nullable: true })
          && exactObjectKeys(authority.restartEvidence, CANCELLATION_RESTART_KEYS);
        if (!authorityShapeValid) {
          issues.push('CANCELLATION_AUTHORITY_EVIDENCE_INVALID');
        } else {
          const reconciliationComplete = authority.reconciliationEvidence.required
            && authority.reconciliationEvidence.operationLookupRef !== null
            && authority.reconciliationEvidence.durableEvidenceRef !== null;
          const reconciliationAbsent = !authority.reconciliationEvidence.required
            && authority.reconciliationEvidence.operationLookupRef === null
            && authority.reconciliationEvidence.durableEvidenceRef === null;
          if ((!reconciliationComplete && !reconciliationAbsent)
            || authority.reconciliationEvidence.required !== assessment.authoritativeReconciliationRequired) {
            issues.push('CANCELLATION_RECONCILIATION_PROOF_MISMATCH');
          }

          const longLived = authority.requestKind === 'LONG_LIVED_LEASED';
          if (longLived !== (authority.lease !== null)
            || longLived !== (assessment.deadlineEvidence === 'LEASE_GOVERNED')) {
            issues.push('CANCELLATION_AUTHORITY_BRANCH_MISMATCH');
          }
          if (authority.lease !== null && validCancellationLease(authority.lease)) {
            const leaseAtEvaluation = cancellationLeasePosture(authority.lease, assessment.evaluatedAtMs);
            projectedLeaseEvidence = cancellationLeasePosture(authority.lease, nowMs);
            if (leaseAtEvaluation !== assessment.leaseEvidence) {
              issues.push('CANCELLATION_LEASE_PROOF_POSTURE_MISMATCH');
            }
            if (projectedLeaseEvidence !== assessment.leaseEvidence) {
              issues.push('CANCELLATION_LEASE_PROOF_NOT_CURRENT_AT_PROJECTION');
            }
            const ownerMismatch = authority.lease.ownerId !== assessment.canonicalOwner;
            if (ownerMismatch !== violations.has('LEASE_OWNER_NOT_CANONICAL_OWNER')) {
              issues.push('CANCELLATION_LEASE_OWNER_PROOF_MISMATCH');
            }
            const staleCompletion = authority.lease.completionEpoch !== null
              && authority.lease.completionEpoch !== authority.lease.activeFenceEpoch;
            const appliedStale = staleCompletion && authority.lease.completionDisposition === 'APPLIED';
            const rejectedStale = staleCompletion && authority.lease.completionDisposition === 'REJECTED';
            if (appliedStale !== violations.has('STALE_COMPLETION_APPLIED_AFTER_HANDOFF')
              || rejectedStale !== reasons.has('STALE_COMPLETION_REJECTED_AS_AUTHORITY')) {
              issues.push('CANCELLATION_LEASE_COMPLETION_PROOF_MISMATCH');
            }
          } else {
            projectedLeaseEvidence = 'NOT_APPLICABLE';
          }

          const detachedPresent = authority.detachedRecovery !== null;
          const detachedValidAtEvaluation = detachedPresent
            && validDetachedRecovery(
              authority.detachedRecovery,
              authority.operationClass,
              assessment.canonicalOwner,
              assessment.evaluatedAtMs,
            );
          const detachedValidAtProjection = detachedPresent
            && validDetachedRecovery(
              authority.detachedRecovery,
              authority.operationClass,
              assessment.canonicalOwner,
              nowMs,
            );
          const proofIdentity = {
            recordId: assessment.recordId,
            requestId: assessment.requestId,
            operationId: assessment.operationId,
            operationClass: authority.operationClass,
            canonicalOwner: assessment.canonicalOwner,
            cancellationContextId: authority.cancellationContextId,
            lease: authority.lease,
            detachedRecovery: authority.detachedRecovery,
            reconciliationEvidence: authority.reconciliationEvidence,
            restartEvidence: authority.restartEvidence,
          };
          const leaseTrustMismatch = longLived
            && !fieldsMatch(proofIdentity, SYNTHETIC_CANCELLATION_TRUST_BINDINGS.CURRENT_LEASE);
          const detachedTrustMismatch = detachedValidAtEvaluation
            && !fieldsMatch(proofIdentity, SYNTHETIC_CANCELLATION_TRUST_BINDINGS.DETACHED_RECOVERY);
          if (leaseTrustMismatch
            !== violations.has('SYNTHETIC_CURRENT_LEASE_TRUST_BINDING_MISMATCH')) {
            issues.push('CANCELLATION_CURRENT_LEASE_TRUST_PROOF_MISMATCH');
          }
          if (detachedTrustMismatch
            !== violations.has('SYNTHETIC_DETACHED_RECOVERY_TRUST_BINDING_MISMATCH')) {
            issues.push('CANCELLATION_DETACHED_TRUST_PROOF_MISMATCH');
          }
          if ((detachedPresent && !detachedValidAtEvaluation)
            !== violations.has('DETACHED_RECOVERY_NOT_REGISTERED_OR_FENCED')) {
            issues.push('CANCELLATION_DETACHED_VALIDITY_PROOF_MISMATCH');
          }
          const expectedDetachedContinuation = detachedValidAtEvaluation && !detachedTrustMismatch;
          projectedDetachedRecoveryContinuationRequired = expectedDetachedContinuation
            && detachedValidAtProjection;
          if (assessment.detachedRecoveryContinuationRequired !== expectedDetachedContinuation
            || (expectedDetachedContinuation
              !== reasons.has('REGISTERED_FENCED_RECOVERY_SURVIVES_INITIATOR_TIMEOUT'))) {
            issues.push('CANCELLATION_DETACHED_RECOVERY_PROOF_MISMATCH');
          }
          if (expectedDetachedContinuation && !detachedValidAtProjection) {
            issues.push('CANCELLATION_DETACHED_FENCE_NOT_CURRENT_AT_PROJECTION');
          }

          const restart = authority.restartEvidence;
          const restored = restart.restoredFromCheckpoint === true;
          const restartTrustMismatch = restored
            && !fieldsMatch(proofIdentity, SYNTHETIC_CANCELLATION_TRUST_BINDINGS.RESTART);
          if (restartTrustMismatch
            !== violations.has('SYNTHETIC_RESTART_TRUST_BINDING_MISMATCH')) {
            issues.push('CANCELLATION_RESTART_TRUST_PROOF_MISMATCH');
          }
          if (restored) {
            const before = restart.stateBeforeRestart;
            const after = restart.stateAfterRestart;
            const snapshotIdentityMatches = plainRecord(before)
              && plainRecord(after)
              && sameStructuredValue(before, after)
              && before.recordId === assessment.recordId
              && before.requestId === assessment.requestId
              && before.operationId === assessment.operationId
              && before.operationClass === authority.operationClass
              && before.canonicalOwner === assessment.canonicalOwner
              && before.cancellationContextId === authority.cancellationContextId
              && before.requestKind === authority.requestKind
              && before.lateResultLaw === assessment.lateResultLaw
              && before.cancellationSupported === assessment.cancellationSupported
              && (before.cancelObservedAtMs !== null) === assessment.cancelIntentObserved
              && sameStructuredValue(before.lease, authority.lease)
              && sameStructuredValue(before.detachedRecovery, authority.detachedRecovery)
              && sameStructuredValue(before.reconciliationEvidence, authority.reconciliationEvidence)
              && ((before.lateFact === null) === (assessment.lateFactDisposition === 'NOT_APPLICABLE'));
            if (!snapshotIdentityMatches) {
              issues.push('CANCELLATION_RESTART_STATE_PROOF_MISMATCH');
            }
          } else if (restart.stateBeforeRestart !== null
            || restart.stateAfterRestart !== null
            || restart.checkpointRef !== null
            || restart.stateDigestBeforeRestart !== null
            || restart.stateDigestAfterRestart !== null
            || restart.restoredRequestId !== null
            || restart.restoredCancellationContextId !== null
            || restart.restoredReconciliationIdentityRef !== null
            || restart.restoredLateResultLaw !== null
            || !Array.isArray(restart.preservedFields)
            || restart.preservedFields.length !== 0) {
            issues.push('CANCELLATION_UNEXPECTED_RESTART_PROOF');
          }
        }

        const supportUnknownDeclared = unknowns.has('CANCELLATION_SUPPORT_UNKNOWN')
          && reasons.has('CANCELLATION_SUPPORT_UNKNOWN');
        if ((assessment.cancellationSupported === null) !== supportUnknownDeclared
          || unknowns.has('CANCELLATION_SUPPORT_UNKNOWN')
            !== reasons.has('CANCELLATION_SUPPORT_UNKNOWN')) {
          issues.push('CANCELLATION_SUPPORT_UNKNOWN_EVIDENCE_MISMATCH');
        }

        const deadlineReached = reasons.has('DEADLINE_REACHED');
        const deadlineCoherent = (assessment.deadlineEvidence === 'ACTIVE'
            && assessment.effectiveDeadlineAtMs !== null
            && assessment.evaluatedAtMs < assessment.effectiveDeadlineAtMs
            && !deadlineReached)
          || (assessment.deadlineEvidence === 'EXPIRED'
            && assessment.effectiveDeadlineAtMs !== null
            && assessment.evaluatedAtMs >= assessment.effectiveDeadlineAtMs
            && deadlineReached)
          || (assessment.deadlineEvidence === 'LEASE_GOVERNED'
            && assessment.effectiveDeadlineAtMs === null
            && !deadlineReached);
        if (!deadlineCoherent) issues.push('CANCELLATION_DEADLINE_CHRONOLOGY_MISMATCH');

        const requested = reasons.has('CANCELLATION_INTENT_REQUESTED');
        const observedReason = reasons.has('CANCELLATION_INTENT_OBSERVED');
        const propagationUnproved = unknowns.has('CANCELLATION_PROPAGATION_UNPROVED');
        const observedWithoutRequest = violations.has('CANCELLATION_OBSERVED_WITHOUT_REQUEST');
        if (assessment.cancelIntentObserved !== observedReason
          || propagationUnproved !== (requested && !assessment.cancelIntentObserved)
          || observedWithoutRequest !== (assessment.cancelIntentObserved && !requested)
          || (violations.has('CANCELLATION_OBSERVED_BEFORE_REQUEST')
            && (!requested || !assessment.cancelIntentObserved))
          || (['CANCEL_REQUEST_FROM_FUTURE', 'CANCELLATION_REQUEST_PRECEDES_REQUEST_START']
            .some((code) => violations.has(code)) && !requested)
          || (['CANCEL_OBSERVATION_FROM_FUTURE', 'LOCAL_EFFECT_INITIATED_AFTER_CANCELLATION_OBSERVED']
            .some((code) => violations.has(code)) && !assessment.cancelIntentObserved)
          || (reasons.has('CANCELLATION_INTENT_DOES_NOT_PROVE_MUTATION_ABSENCE') && !requested)) {
          issues.push('CANCELLATION_INTENT_EVIDENCE_MISMATCH');
        }

        const leaseStateCodes = Object.freeze({
          FUTURE_EVIDENCE: 'LEASE_EVIDENCE_FROM_FUTURE',
          STALE_EPOCH: 'LEASE_EPOCH_NOT_CURRENT',
          EXPIRED: 'LEASE_EXPIRED',
          STALE_HEARTBEAT: 'LEASE_HEARTBEAT_STALE',
        });
        if (Object.entries(leaseStateCodes)
          .some(([state, code]) => (assessment.leaseEvidence === state) !== violations.has(code))) {
          issues.push('CANCELLATION_LEASE_POSTURE_CODE_MISMATCH');
        }
        const leaseOnlyCodes = [
          'LEASE_OWNER_NOT_CANONICAL_OWNER',
          ...Object.values(leaseStateCodes),
          'STALE_COMPLETION_APPLIED_AFTER_HANDOFF',
          'LEASED_EFFECT_INITIATED_BEFORE_ACQUISITION',
          'LEASED_EFFECT_INITIATED_AT_OR_AFTER_EXPIRY',
          'LEASED_EFFECT_COMMITTED_BEFORE_ACQUISITION',
          'LEASED_EFFECT_COMMITTED_AT_OR_AFTER_EXPIRY',
        ];
        const boundedOnlyCodes = [
          'CHILD_BUDGET_OVERFLOW',
          'CHILD_DEADLINE_ESCAPES_PARENT',
          'CHILD_BUDGET_ESCAPES_PARENT',
          'EFFECT_INITIATED_AT_OR_AFTER_DEADLINE',
        ];
        if ((leaseOnlyCodes.some((code) => violations.has(code))
            || reasons.has('STALE_COMPLETION_REJECTED_AS_AUTHORITY'))
          && assessment.deadlineEvidence !== 'LEASE_GOVERNED') {
          issues.push('CANCELLATION_LEASE_CODE_ON_BOUNDED_BRANCH');
        }
        if ((boundedOnlyCodes.some((code) => violations.has(code)) || deadlineReached)
          && assessment.deadlineEvidence === 'LEASE_GOVERNED') {
          issues.push('CANCELLATION_BOUNDED_CODE_ON_LEASE_BRANCH');
        }

        const stopForLeaseAuthority = [
          'LEASE_OWNER_NOT_CANONICAL_OWNER',
          'SYNTHETIC_CURRENT_LEASE_TRUST_BINDING_MISMATCH',
          'STALE_COMPLETION_APPLIED_AFTER_HANDOFF',
          'LEASED_EFFECT_INITIATED_BEFORE_ACQUISITION',
          'LEASED_EFFECT_INITIATED_AT_OR_AFTER_EXPIRY',
          'LEASED_EFFECT_COMMITTED_BEFORE_ACQUISITION',
          'LEASED_EFFECT_COMMITTED_AT_OR_AFTER_EXPIRY',
        ].some((code) => violations.has(code));
        const expectedMayInitiate = !(assessment.deadlineEvidence === 'EXPIRED'
          || (assessment.leaseEvidence !== 'NOT_APPLICABLE' && assessment.leaseEvidence !== 'CURRENT')
          || requested || assessment.cancelIntentObserved || stopForLeaseAuthority);
        if (assessment.mayInitiateNewLocalEffects !== expectedMayInitiate) {
          issues.push('CANCELLATION_MAY_INITIATE_EVIDENCE_MISMATCH');
        }

        const lateTruth = reasons.has('LATE_EXTERNAL_TRUTH_RETAINED');
        const staleLateTruth = reasons.has('STALE_EPOCH_FACT_RETAINED_BUT_CANNOT_AUTHORIZE_NEW_WORK');
        const lateEvidenceCode = violations.has('LATE_FACT_EVIDENCE_FROM_FUTURE')
          || violations.has('STALE_EPOCH_FACT_ATTEMPTED_NEW_AUTHORITY');
        if ((assessment.lateFactDisposition === 'INGEST_DURABLY_AND_RECONCILE') !== lateTruth
          || (staleLateTruth && !lateTruth)
          || (lateEvidenceCode && !lateTruth)) {
          issues.push('CANCELLATION_LATE_FACT_EVIDENCE_MISMATCH');
        }
        const reconciliationImplied = reasons.has('CANCELLATION_INTENT_DOES_NOT_PROVE_MUTATION_ABSENCE')
          || lateTruth
          || violations.has('AUTHORITATIVE_RECONCILIATION_EVIDENCE_MISSING');
        if (reconciliationImplied && !assessment.authoritativeReconciliationRequired) {
          issues.push('CANCELLATION_RECONCILIATION_EVIDENCE_MISMATCH');
        }

        const nonCurrentLease = !['NOT_APPLICABLE', 'CURRENT'].includes(assessment.leaseEvidence);
        const expectedStaleAuthorityRejected = nonCurrentLease
          || reasons.has('STALE_COMPLETION_REJECTED_AS_AUTHORITY')
          || staleLateTruth;
        if (assessment.staleAuthorityRejected !== expectedStaleAuthorityRejected
          || (reasons.has('STALE_COMPLETION_REJECTED_AS_AUTHORITY')
            && violations.has('STALE_COMPLETION_APPLIED_AFTER_HANDOFF'))) {
          issues.push('CANCELLATION_STALE_AUTHORITY_EVIDENCE_MISMATCH');
        }

        const registeredDetach = reasons
          .has('REGISTERED_FENCED_RECOVERY_SURVIVES_INITIATOR_TIMEOUT');
        if (assessment.detachedRecoveryContinuationRequired !== registeredDetach
          || (registeredDetach && violations.has('DETACHED_RECOVERY_NOT_REGISTERED_OR_FENCED'))) {
          issues.push('CANCELLATION_DETACHED_RECOVERY_EVIDENCE_MISMATCH');
        }
        const publicIdentity = {
          recordId: assessment.recordId,
          requestId: assessment.requestId,
          operationId: assessment.operationId,
          canonicalOwner: assessment.canonicalOwner,
        };
        const leaseTrust = SYNTHETIC_CANCELLATION_TRUST_BINDINGS.CURRENT_LEASE;
        const detachedTrust = SYNTHETIC_CANCELLATION_TRUST_BINDINGS.DETACHED_RECOVERY;
        const leaseIdentity = {
          recordId: leaseTrust.recordId,
          requestId: leaseTrust.requestId,
          operationId: leaseTrust.operationId,
          canonicalOwner: leaseTrust.canonicalOwner,
        };
        const detachedIdentity = {
          recordId: detachedTrust.recordId,
          requestId: detachedTrust.requestId,
          operationId: detachedTrust.operationId,
          canonicalOwner: detachedTrust.canonicalOwner,
        };
        if (assessment.deadlineEvidence === 'LEASE_GOVERNED'
          && !fieldsMatch(publicIdentity, leaseIdentity)) {
          issues.push('CANCELLATION_CURRENT_LEASE_TRUST_BINDING_MISMATCH');
        }
        if (assessment.detachedRecoveryContinuationRequired
          && !fieldsMatch(publicIdentity, detachedIdentity)) {
          issues.push('CANCELLATION_DETACHED_RECOVERY_TRUST_BINDING_MISMATCH');
        }
      }
    }
    if (!contractInvalid && expectedKind === 'REPAIR_CONTROL_LOOP'
      && assessment.automaticActionIssued !== false) issues.push('AUTOMATIC_ACTION_CLAIM_FORBIDDEN');
    if (!contractInvalid && expectedKind === 'REPAIR_CONTROL_LOOP') {
      const gateBinding = assessment.actuationGateBinding;
      if (assessment.policyId !== SYNTHETIC_REPAIR_TRUST_BINDING.policyId
        || assessment.canonicalOwner !== SYNTHETIC_REPAIR_TRUST_BINDING.canonicalOwner) {
        issues.push('REPAIR_POLICY_TRUST_BINDING_MISMATCH');
      }
      if (!validRepairGateEvidence(gateBinding)) {
        issues.push('REPAIR_ACTUATION_GATE_BINDING_INVALID');
      } else if (gateBinding.readinessEvidenceRef !== SYNTHETIC_REPAIR_TRUST_BINDING.readinessEvidenceRef
        || gateBinding.conflictGraphEvidenceRef !== SYNTHETIC_REPAIR_TRUST_BINDING.conflictGraphEvidenceRef) {
        issues.push('REPAIR_ACTUATION_GATE_TRUST_BINDING_MISMATCH');
      } else if (gateBinding.readinessObservedAtMs > assessment.evaluatedAtMs
        || gateBinding.conflictGraphObservedAtMs > assessment.evaluatedAtMs) {
        issues.push('REPAIR_ACTUATION_GATE_BINDING_FROM_FUTURE');
      } else if (assessment.assuranceResult === 'PASS'
        && (assessment.evaluatedAtMs - gateBinding.readinessObservedAtMs > gateBinding.readinessMaxAgeMs
          || assessment.evaluatedAtMs - gateBinding.conflictGraphObservedAtMs > gateBinding.conflictGraphMaxAgeMs)) {
        issues.push('REPAIR_PASS_ACTUATION_GATE_BINDING_STALE');
      }
      const progressKeys = [
        'trailingNoProgress', 'contradictoryCount', 'rollbackCount', 'alternations',
        'netProgress', 'noProgressWindowStartMs', 'missingProgress',
        'conflictingControllersPresent', 'historicalTerminationTriggerDetected',
        'firstHistoricalTriggerAtMs',
      ];
      const progress = assessment.progressEvidence;
      if (!exactObjectKeys(progress, progressKeys)
        || !['trailingNoProgress', 'contradictoryCount', 'rollbackCount', 'alternations'].every((field) => Number.isSafeInteger(progress?.[field]) && progress[field] >= 0)
        || !boundedNumber(progress?.netProgress, { nullable: true })
        || !safeTime(progress?.noProgressWindowStartMs)
        || typeof progress?.missingProgress !== 'boolean'
        || typeof progress?.conflictingControllersPresent !== 'boolean'
        || typeof progress?.historicalTerminationTriggerDetected !== 'boolean'
        || !safeTime(progress?.firstHistoricalTriggerAtMs, { nullable: true })
        || (progress?.historicalTerminationTriggerDetected && progress?.firstHistoricalTriggerAtMs === null)
        || (!progress?.historicalTerminationTriggerDetected && progress?.firstHistoricalTriggerAtMs !== null)
        || (progress?.firstHistoricalTriggerAtMs !== null
          && progress.firstHistoricalTriggerAtMs > assessment.evaluatedAtMs)) {
        issues.push('REPAIR_PROGRESS_EVIDENCE_INVALID');
      }
      const budgetKeys = [
        'attempts', 'retryTimeMs', 'retryExecutionTimeMs', 'rateUnits',
        'resourceUnits', 'costUnits', 'observedConcurrentActuations',
      ];
      const budget = assessment.budgetEvidence;
      const nullableTotals = Object.freeze({
        retryExecutionTimeMs: 'RETRY_EXECUTION_TIME_ARITHMETIC_OVERFLOW',
        rateUnits: 'RATE_BUDGET_ARITHMETIC_OVERFLOW',
        resourceUnits: 'RESOURCE_BUDGET_ARITHMETIC_OVERFLOW',
        costUnits: 'COST_BUDGET_ARITHMETIC_OVERFLOW',
      });
      if (!exactObjectKeys(budget, budgetKeys)
        || !Number.isSafeInteger(budget?.attempts) || budget.attempts < 0
        || !Number.isSafeInteger(budget?.observedConcurrentActuations) || budget.observedConcurrentActuations < 0
        || !Number.isSafeInteger(budget?.retryTimeMs) || budget.retryTimeMs < 0
        || !Object.keys(nullableTotals).every((field) => budget?.[field] === null
          || (Number.isSafeInteger(budget?.[field]) && budget[field] >= 0))) {
        issues.push('REPAIR_BUDGET_EVIDENCE_INVALID');
      }
      if (plainRecord(budget) && validReasonCodes(assessment.violationCodes)) {
        for (const [field, overflowCode] of Object.entries(nullableTotals)) {
          const overflowDeclared = assessment.violationCodes.includes(overflowCode);
          if ((budget[field] === null) !== overflowDeclared
            || (assessment.assuranceResult === 'PASS' && budget[field] === null)) {
            issues.push('REPAIR_BUDGET_OVERFLOW_EVIDENCE_MISMATCH');
          }
        }
      }
      if (!validReasonCodes(assessment.triggerCodes)) {
        issues.push('REPAIR_TRIGGER_CODES_INVALID');
      } else {
        const historicalTriggerCodePresent = assessment.triggerCodes
          .some((code) => HISTORICAL_REPAIR_TRIGGER_CODES.includes(code));
        const controllerConflictCodePresent = assessment.triggerCodes
          .includes('CONFLICTING_CONTROLLERS_PRESENT');
        const missingProgressCodePresent = validReasonCodes(assessment.unknownCodes)
          && assessment.unknownCodes.includes('PROGRESS_METRIC_UNAVAILABLE');
        if (progress?.historicalTerminationTriggerDetected !== historicalTriggerCodePresent) {
          issues.push('REPAIR_HISTORICAL_TRIGGER_EVIDENCE_MISMATCH');
        }
        if (progress?.conflictingControllersPresent !== controllerConflictCodePresent) {
          issues.push('REPAIR_CONTROLLER_CONFLICT_EVIDENCE_MISMATCH');
        }
        if (progress?.missingProgress !== missingProgressCodePresent) {
          issues.push('REPAIR_MISSING_PROGRESS_EVIDENCE_MISMATCH');
        }
      }
      validateRepairAttemptEvidence(assessment, nowMs, issues);
      if (!(typeof assessment.containmentEvidenceSufficient === 'boolean')
        || !(assessment.containmentLifecycle === null || ['QUARANTINED', 'FAILED_ATTENTION_REQUIRED'].includes(assessment.containmentLifecycle))
        || !label(assessment.durableUnresolvedEvidenceRef, { nullable: true })
        || !label(assessment.escalationOwner, { nullable: true })
        || !(assessment.terminationWithinDeclaredBudget === null || typeof assessment.terminationWithinDeclaredBudget === 'boolean')
        || !['UNKNOWN_UNBOUNDED', 'BOUNDED_BY_DECLARED_EVIDENCE', 'NOT_YET_PROVEN_WITHIN_DECLARED_BUDGET'].includes(assessment.terminationClaim)
        || !['INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD_PROVEN_FOR_OWNER_REVIEW', 'NOT_PROVEN'].includes(assessment.promotionEvidence)
        || !['QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED', 'NONE'].includes(assessment.requiredCanonicalResponse)) {
        issues.push('REPAIR_ASSESSMENT_FIELDS_INVALID');
      }
      const terminalEvidencePresent = assessment.containmentLifecycle !== null
        || assessment.durableUnresolvedEvidenceRef !== null;
      const promotionProven = assessment.promotionEvidence === 'INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD_PROVEN_FOR_OWNER_REVIEW';
      const promotableCircuitProven = assessment.circuitPosture?.state === 'CLOSED'
        && assessment.circuitPosture.evidenceFresh === true
        && assessment.circuitPosture.independentCloseProven === true;
      if (terminalEvidencePresent && promotionProven) issues.push('REPAIR_PROMOTION_CONTAINMENT_CONFLICT');
      if (terminalEvidencePresent && assessment.requiredCanonicalResponse !== 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED') issues.push('REPAIR_TERMINAL_RESPONSE_CONFLICT');
      if (assessment.containmentLifecycle === 'QUARANTINED'
        && (assessment.durableUnresolvedEvidenceRef === null || assessment.containmentEvidenceSufficient !== true)) issues.push('REPAIR_QUARANTINE_EVIDENCE_INVALID');
      if (assessment.containmentLifecycle === 'FAILED_ATTENTION_REQUIRED'
        && (assessment.durableUnresolvedEvidenceRef === null || assessment.escalationOwner === null || assessment.containmentEvidenceSufficient !== true)) issues.push('REPAIR_ESCALATION_EVIDENCE_INVALID');
      if (assessment.assuranceResult === 'PASS' && assessment.requiredCanonicalResponse === 'NONE'
        && (!promotionProven || terminalEvidencePresent || assessment.terminationWithinDeclaredBudget !== true
          || assessment.terminationClaim !== 'BOUNDED_BY_DECLARED_EVIDENCE'
          || !promotableCircuitProven)) issues.push('REPAIR_PASS_PROMOTION_COHERENCE_INVALID');
      if (assessment.assuranceResult === 'PASS'
        && assessment.requiredCanonicalResponse === 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED'
        && (!assessment.containmentEvidenceSufficient || promotionProven
          || assessment.terminationWithinDeclaredBudget !== true
          || assessment.terminationClaim !== 'BOUNDED_BY_DECLARED_EVIDENCE')) issues.push('REPAIR_PASS_CONTAINMENT_COHERENCE_INVALID');
      const attentionTriggerPresent = validReasonCodes(assessment.triggerCodes)
        && assessment.triggerCodes.length > 0;
      const circuitOpen = assessment.circuitPosture?.state === 'OPEN';
      if (assessment.assuranceResult === 'PASS'
        && ['UNKNOWN', 'HALF_OPEN'].includes(assessment.circuitPosture?.state)) {
        issues.push('REPAIR_PASS_CIRCUIT_POSTURE_UNPROVEN');
      }
      if (assessment.assuranceResult === 'PASS' && (attentionTriggerPresent || circuitOpen)
        && !(assessment.requiredCanonicalResponse === 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED'
          && assessment.containmentEvidenceSufficient === true
          && assessment.terminationWithinDeclaredBudget === true
          && assessment.terminationClaim === 'BOUNDED_BY_DECLARED_EVIDENCE'
          && terminalEvidencePresent
          && (!circuitOpen || assessment.circuitPosture.evidenceFresh === true)
          && !promotionProven)) {
        issues.push('REPAIR_PASS_ATTENTION_COHERENCE_INVALID');
      }
    }
    if (!contractInvalid && expectedKind === 'RESOURCE_COST_CIRCUIT_EVIDENCE') {
      if (!denseArray(assessment.rows, RESOURCE_FAMILIES.length)
        || assessment.rows.length !== RESOURCE_FAMILIES.length) issues.push('RESOURCE_ROWS_NOT_EXACTLY_BOUNDED');
      if (assessment.mayThrottle !== false || assessment.mayExecute !== false
        || assessment.mayCloseOrResetCircuit !== false || assessment.controllerOwner !== null
        || assessment.throttleDecision !== null || !Array.isArray(assessment.commands)
        || assessment.commands.length !== 0) issues.push('RESOURCE_EFFECT_FIELDS_FORBIDDEN');
      const accepted = [...OPTIONAL_SHEDDING_CLASSES, ...PROTECTED_WORK_CLASSES];
      if (!Array.isArray(assessment.loadSheddingOrder)
        || assessment.loadSheddingOrder.length !== accepted.length
        || new Set(assessment.loadSheddingOrder).size !== accepted.length
        || assessment.loadSheddingOrder.some((entry) => !accepted.includes(entry))) {
        issues.push('RESOURCE_SHEDDING_DENOMINATOR_INVALID');
      } else {
        const lastOptional = Math.max(...OPTIONAL_SHEDDING_CLASSES.map((entry) => assessment.loadSheddingOrder.indexOf(entry)));
        const firstProtected = Math.min(...PROTECTED_WORK_CLASSES.map((entry) => assessment.loadSheddingOrder.indexOf(entry)));
        if (lastOptional >= firstProtected) issues.push('RESOURCE_SHEDDING_PRIORITY_INVERTED');
      }
    }
  }

  const valid = issues.length === 0;
  const stalePass = valid && stalePassCode !== null;
  return deepFreeze({
    source: valid ? clonePlain(assessment) : null,
    expectedKind,
    index,
    evaluatedAtMs: plainRecord(assessment) && safeTime(assessment.evaluatedAtMs)
      ? assessment.evaluatedAtMs
      : null,
    assuranceResult: valid ? (stalePass ? 'UNKNOWN' : assessment.assuranceResult) : 'FAIL',
    reasonCodes: sortedUnique([
      ...(plainRecord(assessment) && validReasonCodes(assessment.reasonCodes) ? assessment.reasonCodes : []),
      ...(stalePassCode === null ? [] : [stalePassCode]),
      ...issues,
    ]),
    contractInvalid: !valid,
    stalePass,
    projectedLeaseEvidence,
    projectedDetachedRecoveryContinuationRequired,
  });
}

function normalizeCollection(value, expectedKind, nowMs) {
  if (!Array.isArray(value)) {
    return deepFreeze({
      assessments: [],
      denominatorAnnunciator: {
        id: `${expectedKind.toLowerCase()}:collection-invalid`,
        family: expectedKind === 'CANCELLATION_DEADLINE_LEASE'
          ? 'ASSURANCE_CANCELLATION_DEADLINE_LEASE'
          : 'ASSURANCE_REMEDIATION_CONTROL_LOOP',
        assuranceResult: 'FAIL',
        reasonCodes: ['ASSESSMENT_COLLECTION_INVALID'],
      },
    });
  }
  if (!denseArray(value, STABILITY_STRUCTURE_LIMITS.repairAttempts)) {
    return deepFreeze({
      assessments: [],
      denominatorAnnunciator: {
        id: `${expectedKind.toLowerCase()}:collection-invalid`,
        family: expectedKind === 'CANCELLATION_DEADLINE_LEASE'
          ? 'ASSURANCE_CANCELLATION_DEADLINE_LEASE'
          : 'ASSURANCE_REMEDIATION_CONTROL_LOOP',
        assuranceResult: 'FAIL',
        reasonCodes: ['ASSESSMENT_COLLECTION_NOT_DENSE_OR_BOUNDED'],
      },
    });
  }
  if (value.length === 0) {
    return deepFreeze({
      assessments: [],
      denominatorAnnunciator: {
        id: `${expectedKind.toLowerCase()}:evidence-missing`,
        family: expectedKind === 'CANCELLATION_DEADLINE_LEASE'
          ? 'ASSURANCE_CANCELLATION_DEADLINE_LEASE'
          : 'ASSURANCE_REMEDIATION_CONTROL_LOOP',
        assuranceResult: 'UNKNOWN',
        reasonCodes: ['ASSESSMENT_DENOMINATOR_EMPTY'],
      },
    });
  }
  return deepFreeze({
    assessments: Array.from(value, (assessment, index) => normalizeAssessment(assessment, expectedKind, index, nowMs)),
    denominatorAnnunciator: null,
  });
}

function assessmentSource(normalized) {
  return normalized.source ?? {};
}

function resourceDenominatorIssues(resourceAssessment, normalizedRows) {
  const issues = [];
  if (!Array.isArray(resourceAssessment?.rows)) return ['RESOURCE_ROWS_MISSING'];
  if (resourceAssessment.rows.length === 0) return ['RESOURCE_DENOMINATOR_EMPTY'];
  if (normalizedRows.some((row) => row.contractInvalid)) issues.push('RESOURCE_ROW_CONTRACT_INVALID');
  const families = normalizedRows.map((row) => row.resourceFamily);
  const rowIds = normalizedRows.map((row) => row.source?.rowId ?? null);
  if (new Set(rowIds).size !== rowIds.length) issues.push('RESOURCE_ROW_ID_DUPLICATE');
  if (families.length !== RESOURCE_FAMILIES.length
    || new Set(families).size !== RESOURCE_FAMILIES.length
    || RESOURCE_FAMILIES.some((family) => !families.includes(family))) {
    issues.push('RESOURCE_DENOMINATOR_MISMATCH');
  }
  // Source result coherence is distinct from the view's later fail-closed
  // freshness normalization. A once-valid PASS becoming stale is UNKNOWN, not
  // evidence that the evaluator forged its original bundle result.
  const rowResult = overall(normalizedRows.map((row) => row.source?.assuranceResult ?? row.assuranceResult));
  if (ASSURANCE_RESULTS.includes(resourceAssessment.assuranceResult)
    && resourceAssessment.assuranceResult !== rowResult) issues.push('RESOURCE_BUNDLE_RESULT_MISMATCH');
  return issues;
}

function normalizeResourceRow(row, index, nowMs, evaluatedAtMs) {
  const issues = [];
  if (!plainRecord(row)) {
    issues.push('RESOURCE_ROW_OBJECT_REQUIRED');
  } else {
    const required = [
      'rowId', 'resourceFamily', 'canonicalOwner', 'provenance',
      'observedAtMs', 'maxAgeMs',
      'assuranceResult', 'reasonCodes',
      'currentBurn', 'budgetLimit', 'budgetRemaining', 'forecast',
      'forecastHorizonMs', 'unknownReason', 'unknownReasons', 'topConsumers',
      'throttlingEvidence', 'circuitEvidence', 'canonicalResponse', 'protections',
      'throttleDecision', 'commands',
    ];
    if (!exactObjectKeys(row, required)) issues.push('RESOURCE_ROW_EXACT_SHAPE_REQUIRED');
    if (!RESOURCE_FAMILIES.includes(row.resourceFamily)) issues.push('RESOURCE_FAMILY_INVALID');
    if (!label(row.rowId)) issues.push('RESOURCE_ROW_ID_INVALID');
    if (!label(row.canonicalOwner)) issues.push('RESOURCE_CANONICAL_OWNER_INVALID');
    if (row.canonicalOwner !== SYNTHETIC_RESOURCE_OWNER) {
      issues.push('RESOURCE_CANONICAL_OWNER_TRUST_BINDING_MISMATCH');
    }
    if (!label(row.provenance)) issues.push('RESOURCE_PROVENANCE_INVALID');
    if (!safeTime(row.observedAtMs)
      || !Number.isSafeInteger(row.maxAgeMs) || row.maxAgeMs <= 0) {
      issues.push('RESOURCE_MEASUREMENT_FRESHNESS_INVALID');
    } else if (row.observedAtMs > nowMs || row.observedAtMs > evaluatedAtMs) {
      issues.push('RESOURCE_MEASUREMENT_FROM_FUTURE');
    }
    if (!ASSURANCE_RESULTS.includes(row.assuranceResult)) issues.push('RESOURCE_RESULT_INVALID');
    const reasonCodesValid = validReasonCodes(row.reasonCodes);
    if (!reasonCodesValid) issues.push('RESOURCE_REASON_CODES_INVALID');
    if (row.throttleDecision !== null || !Array.isArray(row.commands) || row.commands.length !== 0) issues.push('RESOURCE_EFFECT_FIELDS_FORBIDDEN');
    if (reasonCodesValid && ((row.assuranceResult === 'PASS' && row.reasonCodes.length > 0)
      || (row.assuranceResult !== 'PASS' && row.reasonCodes.length === 0))) issues.push('RESOURCE_RESULT_CODE_MISMATCH');
    if (reasonCodesValid && (row.assuranceResult === 'PASS'
      || !row.reasonCodes.includes('CANONICAL_OWNER_CONFIRMATION_REQUIRED'))) {
      issues.push('RESOURCE_OWNER_CONFIRMATION_RESULT_MISMATCH');
    }

    const numericFields = ['currentBurn', 'budgetLimit', 'budgetRemaining', 'forecast', 'forecastHorizonMs'];
    if (!numericFields.every((field) => row[field] === null
      || (Number.isSafeInteger(row[field]) && row[field] >= 0))) {
      issues.push('RESOURCE_NUMERIC_EVIDENCE_INVALID');
    }
    if ((row.budgetLimit === null) !== (row.budgetRemaining === null)) issues.push('RESOURCE_BUDGET_PAIR_INVALID');
    if ((row.forecast === null) !== (row.forecastHorizonMs === null)) issues.push('RESOURCE_FORECAST_PAIR_INVALID');
    if (row.currentBurn !== null && row.budgetLimit !== null && row.budgetRemaining !== null
      && Math.abs(row.budgetRemaining - Math.max(0, row.budgetLimit - row.currentBurn)) > Number.EPSILON) issues.push('RESOURCE_BUDGET_ACCOUNTING_INVALID');
    const numericUnknown = numericFields.some((field) => row[field] === null);
    if (!exactObjectKeys(row.unknownReasons, ['burn', 'budget', 'forecast'])
      || !['burn', 'budget', 'forecast'].every((field) => label(row.unknownReasons?.[field], { nullable: true }))) {
      issues.push('RESOURCE_UNKNOWN_REASONS_INVALID');
    } else {
      if ((row.currentBurn === null) !== (row.unknownReasons.burn !== null)) issues.push('RESOURCE_BURN_UNKNOWN_REASON_MISMATCH');
      if ((row.budgetLimit === null) !== (row.unknownReasons.budget !== null)) issues.push('RESOURCE_BUDGET_UNKNOWN_REASON_MISMATCH');
      if ((row.forecast === null) !== (row.unknownReasons.forecast !== null)) issues.push('RESOURCE_FORECAST_UNKNOWN_REASON_MISMATCH');
      const expectedUnknownReason = row.unknownReasons.burn ?? row.unknownReasons.budget ?? row.unknownReasons.forecast;
      if (row.unknownReason !== expectedUnknownReason) issues.push('RESOURCE_UNKNOWN_REASON_PROJECTION_MISMATCH');
    }
    if (row.assuranceResult === 'PASS' && numericUnknown) issues.push('RESOURCE_PASS_WITH_UNKNOWN_NUMERIC_TRUTH');
    if (row.assuranceResult === 'PASS' && row.currentBurn !== null && row.budgetLimit !== null
      && (row.currentBurn >= row.budgetLimit || row.budgetRemaining === 0)) issues.push('RESOURCE_PASS_WHILE_BUDGET_EXHAUSTED');
    if (row.assuranceResult === 'PASS' && row.forecast !== null && row.budgetRemaining !== null
      && row.forecast >= row.budgetRemaining) issues.push('RESOURCE_PASS_WHILE_FORECAST_EXHAUSTS_BUDGET');

    if (!denseArray(row.topConsumers, STABILITY_STRUCTURE_LIMITS.topConsumersPerResource)) {
      issues.push('RESOURCE_TOP_CONSUMERS_INVALID');
    } else {
      const consumerIds = new Set();
      let knownTotal = 0;
      let totalBounded = true;
      let consumerUnknown = false;
      row.topConsumers.forEach((consumer) => {
        if (!exactObjectKeys(consumer, ['consumerId', 'amount', 'unknownReason', 'evidenceRef'])
          || !label(consumer.consumerId)
          || !(consumer.amount === null
            || (Number.isSafeInteger(consumer.amount) && consumer.amount >= 0))
          || !label(consumer.unknownReason, { nullable: true })
          || !label(consumer.evidenceRef, { nullable: true })
          || (consumer.amount === null && (consumer.unknownReason === null || consumer.evidenceRef !== null))
          || (consumer.amount !== null && (consumer.unknownReason !== null || consumer.evidenceRef === null))) {
          issues.push('RESOURCE_TOP_CONSUMER_EVIDENCE_INVALID');
          return;
        }
        if (consumerIds.has(consumer.consumerId)) issues.push('RESOURCE_TOP_CONSUMER_ID_DUPLICATE');
        consumerIds.add(consumer.consumerId);
        if (consumer.amount === null) consumerUnknown = true;
        else if (knownTotal > Number.MAX_SAFE_INTEGER - consumer.amount) totalBounded = false;
        else knownTotal += consumer.amount;
      });
      if (!totalBounded) issues.push('RESOURCE_TOP_CONSUMER_TOTAL_UNSAFE');
      if (row.currentBurn !== null && knownTotal - row.currentBurn > Number.EPSILON) issues.push('RESOURCE_TOP_CONSUMER_ATTRIBUTION_EXCEEDS_BURN');
      if (row.assuranceResult === 'PASS' && (row.topConsumers.length === 0 || consumerUnknown)) issues.push('RESOURCE_PASS_WITH_UNPROVED_TOP_CONSUMERS');
    }

    const throttling = row.throttlingEvidence;
    if (!exactObjectKeys(throttling, ['observed', 'observedAtMs', 'maxAgeMs', 'evidenceRef', 'unknownReason', 'canonicalOwner'])
      || !['ACTIVE', 'INACTIVE', 'UNKNOWN'].includes(throttling?.observed)
      || !safeTime(throttling?.observedAtMs, { nullable: true })
      || !Number.isSafeInteger(throttling?.maxAgeMs) || throttling.maxAgeMs <= 0
      || !label(throttling?.evidenceRef, { nullable: true })
      || !label(throttling?.unknownReason, { nullable: true })
      || !label(throttling?.canonicalOwner)
      || throttling?.canonicalOwner !== SYNTHETIC_RESOURCE_TRUST_BINDING.canonicalOwner
      || (throttling?.observed === 'UNKNOWN' && (throttling.observedAtMs !== null || throttling.evidenceRef !== null || throttling.unknownReason === null))
      || (throttling?.observed !== 'UNKNOWN' && (throttling?.observedAtMs === null || throttling?.evidenceRef === null || throttling?.unknownReason !== null))) {
      issues.push('RESOURCE_THROTTLING_EVIDENCE_INVALID');
    } else if (throttling.observedAtMs !== null
      && (throttling.observedAtMs > nowMs || throttling.observedAtMs > evaluatedAtMs)) {
      issues.push('RESOURCE_THROTTLING_EVIDENCE_FROM_FUTURE');
    } else if (row.assuranceResult === 'PASS' && (throttling.observed === 'UNKNOWN'
      || nowMs - throttling.observedAtMs > throttling.maxAgeMs)) {
      issues.push('RESOURCE_PASS_WITH_UNPROVED_THROTTLING_EVIDENCE');
    }

    const circuit = row.circuitEvidence;
    const circuitKeys = ['state', 'canonicalOwner', 'ownerFailureDomain', 'observedAtMs', 'maxAgeMs', 'evidenceRef', 'unknownReason', 'baselineNeverOpenedEvidenceRef', 'baselineEvidenceOwner', 'baselineEvidenceFailureDomain', 'openedAtMs', 'halfOpenAtMs', 'closedAtMs', 'resetEligibleAtMs', 'independentCloseEvidenceRef', 'independentCloseOwner', 'independentCloseFailureDomain', 'mayCloseOrReset'];
    if (!exactObjectKeys(circuit, circuitKeys)
      || !['OPEN', 'HALF_OPEN', 'CLOSED', 'UNKNOWN'].includes(circuit?.state)
      || !label(circuit?.canonicalOwner)
      || !label(circuit?.ownerFailureDomain, { nullable: true })
      || !Number.isSafeInteger(circuit?.maxAgeMs) || circuit.maxAgeMs <= 0
      || !['observedAtMs', 'openedAtMs', 'halfOpenAtMs', 'closedAtMs', 'resetEligibleAtMs'].every((field) => safeTime(circuit?.[field], { nullable: true }))
      || !['evidenceRef', 'unknownReason', 'baselineNeverOpenedEvidenceRef', 'baselineEvidenceOwner', 'baselineEvidenceFailureDomain', 'independentCloseEvidenceRef', 'independentCloseOwner', 'independentCloseFailureDomain'].every((field) => label(circuit?.[field], { nullable: true }))) {
      issues.push('RESOURCE_CIRCUIT_EVIDENCE_INVALID');
    } else {
      if (circuit.mayCloseOrReset !== false) issues.push('RESOURCE_CIRCUIT_AUTHORITY_FORBIDDEN');
      if (circuit.canonicalOwner !== SYNTHETIC_RESOURCE_TRUST_BINDING.circuitOwner
        || (circuit.state !== 'UNKNOWN'
          && circuit.ownerFailureDomain !== SYNTHETIC_RESOURCE_TRUST_BINDING.circuitOwnerFailureDomain)
        || (circuit.baselineEvidenceOwner !== null
          && circuit.baselineEvidenceOwner !== SYNTHETIC_RESOURCE_TRUST_BINDING.independentCircuitOwner)
        || (circuit.baselineEvidenceFailureDomain !== null
          && circuit.baselineEvidenceFailureDomain !== SYNTHETIC_RESOURCE_TRUST_BINDING.independentCircuitFailureDomain)
        || (circuit.independentCloseOwner !== null
          && circuit.independentCloseOwner !== SYNTHETIC_RESOURCE_TRUST_BINDING.independentCircuitOwner)
        || (circuit.independentCloseFailureDomain !== null
          && circuit.independentCloseFailureDomain !== SYNTHETIC_RESOURCE_TRUST_BINDING.independentCircuitFailureDomain)) {
        issues.push('RESOURCE_CIRCUIT_TRUST_BINDING_MISMATCH');
      }
      if (circuit.canonicalOwner === row.canonicalOwner
        || circuit.ownerFailureDomain === row.canonicalOwner) {
        issues.push('RESOURCE_CIRCUIT_OWNER_INDEPENDENCE_REQUIRED');
      }
      const transitionValues = [circuit.openedAtMs, circuit.halfOpenAtMs, circuit.closedAtMs, circuit.resetEligibleAtMs, circuit.independentCloseEvidenceRef, circuit.independentCloseOwner, circuit.independentCloseFailureDomain];
      const baselineValues = [circuit.baselineNeverOpenedEvidenceRef, circuit.baselineEvidenceOwner, circuit.baselineEvidenceFailureDomain];
      const baselinePresent = baselineValues.some((entry) => entry !== null);
      const baselineComplete = baselineValues.every((entry) => entry !== null);
      const priorOpen = transitionValues.some((entry) => entry !== null);
      if (circuit.state === 'UNKNOWN' && (circuit.ownerFailureDomain !== null || circuit.observedAtMs !== null || circuit.evidenceRef !== null || circuit.unknownReason === null || priorOpen || baselinePresent)) issues.push('RESOURCE_CIRCUIT_UNKNOWN_EVIDENCE_CONFLICT');
      if (circuit.state !== 'UNKNOWN' && (circuit.ownerFailureDomain === null || circuit.observedAtMs === null || circuit.evidenceRef === null || circuit.unknownReason !== null)) issues.push('RESOURCE_CIRCUIT_KNOWN_EVIDENCE_INVALID');
      if (circuit.observedAtMs !== null && [circuit.openedAtMs, circuit.halfOpenAtMs, circuit.resetEligibleAtMs, circuit.closedAtMs].some((time) => time !== null && time > circuit.observedAtMs)) issues.push('RESOURCE_CIRCUIT_TRANSITION_AFTER_OBSERVATION');
      if (circuit.observedAtMs !== null
        && (circuit.observedAtMs > nowMs || circuit.observedAtMs > evaluatedAtMs)) {
        issues.push('RESOURCE_CIRCUIT_EVIDENCE_FROM_FUTURE');
      }
      if (row.assuranceResult === 'PASS' && circuit.observedAtMs !== null
        && nowMs - circuit.observedAtMs > circuit.maxAgeMs) issues.push('RESOURCE_PASS_WITH_STALE_CIRCUIT_EVIDENCE');
      if (circuit.state === 'OPEN' && (circuit.openedAtMs === null || transitionValues.slice(1).some((entry) => entry !== null))) issues.push('RESOURCE_CIRCUIT_OPEN_SEQUENCE_INVALID');
      if (circuit.state === 'HALF_OPEN' && (circuit.openedAtMs === null || circuit.halfOpenAtMs === null || circuit.halfOpenAtMs < circuit.openedAtMs || circuit.closedAtMs !== null || circuit.independentCloseEvidenceRef !== null || circuit.independentCloseOwner !== null || circuit.independentCloseFailureDomain !== null || (circuit.resetEligibleAtMs !== null && circuit.resetEligibleAtMs < circuit.halfOpenAtMs))) issues.push('RESOURCE_CIRCUIT_HALF_OPEN_SEQUENCE_INVALID');
      if (circuit.state === 'CLOSED' && priorOpen
        && (circuit.openedAtMs === null || circuit.halfOpenAtMs === null || circuit.resetEligibleAtMs === null || circuit.closedAtMs === null
          || circuit.independentCloseEvidenceRef === null || circuit.independentCloseOwner === null || circuit.independentCloseFailureDomain === null
          || circuit.halfOpenAtMs < circuit.openedAtMs || circuit.resetEligibleAtMs < circuit.halfOpenAtMs || circuit.closedAtMs < circuit.resetEligibleAtMs
          || circuit.independentCloseEvidenceRef === circuit.evidenceRef || circuit.independentCloseOwner === circuit.canonicalOwner
          || circuit.independentCloseOwner === row.canonicalOwner
          || circuit.independentCloseFailureDomain === circuit.ownerFailureDomain
          || circuit.independentCloseFailureDomain === row.canonicalOwner)) issues.push('RESOURCE_CIRCUIT_CLOSE_PROOF_INVALID');
      if (circuit.state !== 'CLOSED' && baselinePresent) issues.push('RESOURCE_CIRCUIT_BASELINE_CONFLICT');
      if (circuit.state === 'CLOSED' && priorOpen && baselinePresent) issues.push('RESOURCE_CIRCUIT_BASELINE_TRANSITION_CONFLICT');
      if (circuit.state === 'CLOSED' && !priorOpen
        && (!baselineComplete
          || circuit.baselineNeverOpenedEvidenceRef === circuit.evidenceRef
          || circuit.baselineEvidenceOwner === circuit.canonicalOwner
          || circuit.baselineEvidenceOwner === row.canonicalOwner
          || circuit.baselineEvidenceFailureDomain === circuit.ownerFailureDomain
          || circuit.baselineEvidenceFailureDomain === row.canonicalOwner)) issues.push('RESOURCE_CIRCUIT_BASELINE_PROOF_INVALID');
      if (row.assuranceResult === 'PASS' && circuit.state !== 'CLOSED') issues.push('RESOURCE_PASS_WITH_UNPROVED_CIRCUIT_POSTURE');
    }

    const response = row.canonicalResponse;
    if (!exactObjectKeys(response, ['kind', 'referenceId', 'owner', 'wiringState', 'unknownReason'])
      || !['OWNER_ACTION_REFERENCE', 'RECOMMENDATION', 'NONE', 'UNKNOWN'].includes(response?.kind)
      || !label(response?.referenceId, { nullable: true }) || !label(response?.owner)
      || response?.owner !== row.canonicalOwner
      || !['DRAFT_INSERTION_REQUEST', 'OWNER_GATED', 'UNAVAILABLE'].includes(response?.wiringState)
      || !label(response?.unknownReason, { nullable: true })
      || (['OWNER_ACTION_REFERENCE', 'RECOMMENDATION'].includes(response?.kind) && (response.referenceId === null || response.unknownReason !== null || response.wiringState === 'UNAVAILABLE'))
      || (response?.kind === 'UNKNOWN' && (response.referenceId !== null || response.unknownReason === null || response.wiringState !== 'UNAVAILABLE'))
      || (response?.kind === 'NONE' && (response.referenceId !== null
        || response.unknownReason !== null || response.wiringState === 'UNAVAILABLE'))) {
      issues.push('RESOURCE_CANONICAL_RESPONSE_INVALID');
    } else if (row.assuranceResult === 'PASS' && response.kind === 'UNKNOWN') {
      issues.push('RESOURCE_PASS_WITH_UNKNOWN_CANONICAL_RESPONSE');
    } else if (row.assuranceResult !== 'PASS' && response.kind === 'NONE') {
      issues.push('RESOURCE_ATTENTION_WITHOUT_CANONICAL_RESPONSE');
    }

    const protections = row.protections;
    if (!exactObjectKeys(protections, ['materialMoneyEvidencePreserved', 'auditEvidencePreserved', 'safeRiskReductionUnblocked'])
      || !Object.values(protections ?? {}).every((value) => ASSURANCE_RESULTS.includes(value))) {
      issues.push('RESOURCE_PROTECTIONS_INVALID');
    } else if (row.assuranceResult === 'PASS' && Object.values(protections).some((value) => value !== 'PASS')) {
      issues.push('RESOURCE_PASS_WITH_UNPROVED_PROTECTIONS');
    }

    const hardFailurePresent = (row.currentBurn !== null && row.budgetLimit !== null
        && (row.currentBurn >= row.budgetLimit || row.budgetRemaining === 0))
      || (row.forecast !== null && row.budgetRemaining !== null && row.forecast >= row.budgetRemaining)
      || row.circuitEvidence?.state === 'OPEN'
      || (plainRecord(row.protections) && Object.values(row.protections).includes('FAIL'));
    if (hardFailurePresent && row.assuranceResult !== 'FAIL') {
      issues.push('RESOURCE_HARD_FAILURE_RESULT_MISMATCH');
    }
  }
  const valid = issues.length === 0;
  const measurementStale = valid
    && nowMs - row.observedAtMs > row.maxAgeMs;
  const stalePass = measurementStale && row.assuranceResult === 'PASS';
  return deepFreeze({
    source: valid ? clonePlain(row) : null,
    index,
    resourceFamily: plainRecord(row) && typeof row.resourceFamily === 'string' ? row.resourceFamily : null,
    assuranceResult: valid ? (stalePass ? 'UNKNOWN' : row.assuranceResult) : 'FAIL',
    reasonCodes: sortedUnique([
      ...(plainRecord(row) && validReasonCodes(row.reasonCodes) ? row.reasonCodes : []),
      ...(stalePass ? ['RESOURCE_PASS_MEASUREMENT_STALE'] : []),
      ...(measurementStale && !stalePass ? ['RESOURCE_MEASUREMENT_STALE'] : []),
      ...issues,
    ]),
    contractInvalid: !valid,
    stalePass,
    measurementStale,
  });
}

function authorityFields() {
  return { dataAuthority: DATA_AUTHORITY, effectAuthority: EFFECT_AUTHORITY };
}

function attentionRank(result) {
  return result === 'FAIL' ? 0 : result === 'UNKNOWN' ? 1 : 2;
}

export function projectStabilityViewModel(input, nowMs) {
  if (!validNow(nowMs)) throw new TypeError('nowMs must be a non-negative safe integer from an injected clock');
  let viewInputSnapshotInvalid = false;
  let source;
  try {
    source = captureCanonicalEvidence(input);
    if (!plainRecord(source)) throw new TypeError('view input must be a plain record');
  } catch {
    source = {};
    viewInputSnapshotInvalid = true;
  }
  const cancellation = normalizeCollection(source.cancellationAssessments, 'CANCELLATION_DEADLINE_LEASE', nowMs);
  const repair = normalizeCollection(source.repairAssessments, 'REPAIR_CONTROL_LOOP', nowMs);
  const resource = normalizeAssessment(
    source.resourceAssessment,
    'RESOURCE_COST_CIRCUIT_EVIDENCE',
    0,
    nowMs,
    { reasonCodesOptional: true },
  );

  const deadlineLease = cancellation.assessments.map((normalized) => {
    const assessment = assessmentSource(normalized);
    return deepFreeze({
      recordId: assessment.recordId ?? null,
      requestId: assessment.requestId ?? null,
      operationId: assessment.operationId ?? null,
      owner: assessment.canonicalOwner ?? null,
      lateResultLaw: assessment.lateResultLaw ?? null,
      evaluatedAtMs: normalized.evaluatedAtMs,
      assessmentFreshness: normalized.contractInvalid ? 'INVALID' : normalized.stalePass ? 'STALE' : 'CURRENT',
      assuranceResult: normalized.assuranceResult,
      deadlineEvidence: assessment.deadlineEvidence ?? 'UNKNOWN',
      effectiveDeadlineAtMs: assessment.effectiveDeadlineAtMs ?? null,
      leaseEvidence: normalized.projectedLeaseEvidence
        ?? assessment.leaseEvidence
        ?? 'UNKNOWN',
      cancellationIntentObserved: assessment.cancelIntentObserved ?? null,
      cancellationSupported: assessment.cancellationSupported ?? null,
      cancellationProvesMutationAbsence: false,
      reconciliationRequired: assessment.authoritativeReconciliationRequired ?? null,
      mayInitiateNewLocalEffects: normalized.stalePass ? false : (assessment.mayInitiateNewLocalEffects ?? null),
      detachedRecoveryContinuationRequired: normalized.stalePass
        ? false
        : (normalized.projectedDetachedRecoveryContinuationRequired
          ?? assessment.detachedRecoveryContinuationRequired
          ?? null),
      lateFactDisposition: assessment.lateFactDisposition ?? 'UNKNOWN',
      staleAuthorityRejected: normalized.stalePass ? true : (assessment.staleAuthorityRejected ?? null),
      reasonCodes: normalized.reasonCodes,
      ...authorityFields(),
    });
  });

  const repairLoops = repair.assessments.map((normalized) => {
    const assessment = assessmentSource(normalized);
    return deepFreeze({
      campaignId: assessment.campaignId ?? null,
      policyId: assessment.policyId ?? null,
      owner: assessment.canonicalOwner ?? null,
      evaluatedAtMs: normalized.evaluatedAtMs,
      assessmentFreshness: normalized.contractInvalid ? 'INVALID' : normalized.stalePass ? 'STALE' : 'CURRENT',
      assuranceResult: normalized.assuranceResult,
      progressEvidence: assessment.progressEvidence ?? null,
      budgetEvidence: assessment.budgetEvidence ?? null,
      actuationGateBinding: assessment.actuationGateBinding ?? null,
      attemptEvidence: assessment.attemptEvidence ?? [],
      circuitPosture: assessment.circuitPosture ?? null,
      triggerCodes: validReasonCodes(assessment.triggerCodes) ? [...assessment.triggerCodes] : [],
      terminationClaim: assessment.terminationClaim ?? 'UNKNOWN_UNBOUNDED',
      terminationWithinDeclaredBudget: normalized.stalePass
        ? null
        : (assessment.terminationWithinDeclaredBudget ?? null),
      containmentEvidenceSufficient: assessment.containmentEvidenceSufficient ?? null,
      containmentLifecycle: assessment.containmentLifecycle ?? null,
      durableUnresolvedEvidenceRef: assessment.durableUnresolvedEvidenceRef ?? null,
      escalationOwner: assessment.escalationOwner ?? null,
      promotionEvidence: normalized.stalePass
        ? 'NOT_PROVEN'
        : (assessment.promotionEvidence ?? 'NOT_PROVEN'),
      requiredCanonicalResponse: normalized.stalePass
        ? 'OWNER_REVIEW_REQUIRED'
        : (assessment.requiredCanonicalResponse ?? 'OWNER_REVIEW_REQUIRED'),
      attentionRequired: normalized.stalePass
        || (validReasonCodes(assessment.triggerCodes) && assessment.triggerCodes.length > 0)
        || assessment.circuitPosture?.state === 'OPEN'
        || (assessment.requiredCanonicalResponse !== undefined
          && assessment.requiredCanonicalResponse !== 'NONE'),
      automaticActionIssued: false,
      reasonCodes: normalized.reasonCodes,
      ...authorityFields(),
    });
  });

  const resourceSource = assessmentSource(resource);
  const normalizedResourceRows = Array.isArray(resourceSource.rows)
    ? Array.from(resourceSource.rows, (row, index) => normalizeResourceRow(
      row,
      index,
      nowMs,
      resource.evaluatedAtMs,
    ))
    : [];
  const resources = normalizedResourceRows.map((normalized) => {
    const row = normalized.source ?? {};
    return deepFreeze({
      rowId: row.rowId ?? null,
      resourceFamily: normalized.resourceFamily,
      canonicalOwner: row.canonicalOwner ?? null,
      provenance: row.provenance ?? null,
      evaluatedAtMs: resource.evaluatedAtMs,
      observedAtMs: row.observedAtMs ?? null,
      maxAgeMs: row.maxAgeMs ?? null,
      assessmentFreshness: normalized.contractInvalid ? 'INVALID' : normalized.measurementStale ? 'STALE' : 'CURRENT',
      assuranceResult: normalized.assuranceResult,
      currentBurn: row.currentBurn ?? null,
      budgetLimit: row.budgetLimit ?? null,
      budgetRemaining: row.budgetRemaining ?? null,
      forecast: row.forecast ?? null,
      forecastHorizonMs: row.forecastHorizonMs ?? null,
      unknownReason: row.unknownReason ?? null,
      unknownReasons: row.unknownReasons ?? { burn: null, budget: null, forecast: null },
      topConsumers: row.topConsumers ?? [],
      throttlingEvidence: row.throttlingEvidence ?? null,
      circuitEvidence: row.circuitEvidence ?? null,
      canonicalResponse: row.canonicalResponse ?? null,
      protections: row.protections ?? null,
      throttleDecision: null,
      commands: [],
      reasonCodes: normalized.reasonCodes,
      ...authorityFields(),
    });
  });

  const resourceDenominatorReasonCodes = resourceDenominatorIssues(resourceSource, normalizedResourceRows);
  const rowBlockers = normalizedResourceRows.flatMap((row) => row.reasonCodes);
  const resourceBundleBlockers = sortedUnique([
    ...resource.reasonCodes,
    ...resourceDenominatorReasonCodes,
    ...rowBlockers,
  ]);
  const resourceBlockerMissing = resource.assuranceResult !== 'PASS'
    && resourceBundleBlockers.length === 0;
  if (resourceBlockerMissing) resourceBundleBlockers.push('RESOURCE_BUNDLE_BLOCKER_REQUIRED');
  const staleResourcePass = resource.assuranceResult === 'PASS'
    && normalizedResourceRows.some((row) => row.stalePass);
  const resourceBundleResult = resource.contractInvalid
    || resourceDenominatorReasonCodes.length > 0
    || resourceBlockerMissing
    ? 'FAIL'
    : staleResourcePass ? 'UNKNOWN' : resource.assuranceResult;
  const resourceBundleAnnunciator = {
    id: `resource-bundle:${resourceSource.bundleId ?? 'invalid'}`,
    family: 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE',
    assuranceResult: resourceBundleResult,
    reasonCodes: resourceBundleBlockers,
  };

  const annunciators = [
    ...(viewInputSnapshotInvalid ? [{
      id: 'view:input-snapshot',
      family: 'ASSURANCE_STABILITY_VIEW_INPUT',
      assuranceResult: 'FAIL',
      reasonCodes: ['VIEW_INPUT_SNAPSHOT_INVALID'],
    }] : []),
    ...(cancellation.denominatorAnnunciator === null ? [] : [cancellation.denominatorAnnunciator]),
    ...cancellation.assessments.map((normalized) => {
      const assessment = assessmentSource(normalized);
      return {
        id: `cancellation:${assessment.recordId ?? `invalid-${normalized.index}`}`,
        family: 'ASSURANCE_CANCELLATION_DEADLINE_LEASE',
        assuranceResult: normalized.assuranceResult,
        reasonCodes: normalized.reasonCodes,
      };
    }),
    ...(repair.denominatorAnnunciator === null ? [] : [repair.denominatorAnnunciator]),
    ...repair.assessments.map((normalized) => {
      const assessment = assessmentSource(normalized);
      return {
        id: `repair:${assessment.campaignId ?? `invalid-${normalized.index}`}`,
        family: 'ASSURANCE_REMEDIATION_CONTROL_LOOP',
        assuranceResult: normalized.assuranceResult,
        reasonCodes: normalized.reasonCodes,
      };
    }),
    resourceBundleAnnunciator,
    ...normalizedResourceRows.map((normalized) => ({
      id: `resource:${normalized.resourceFamily ?? `invalid-${normalized.index}`}`,
      family: 'ASSURANCE_RESOURCE_COST_CIRCUIT_ROW',
      assuranceResult: normalized.assuranceResult,
      reasonCodes: normalized.reasonCodes,
    })),
  ].sort((left, right) => attentionRank(left.assuranceResult) - attentionRank(right.assuranceResult) || left.id.localeCompare(right.id));

  return deepFreeze({
    schemaVersion: STABILITY_SCHEMA_VERSION,
    viewModelId: 'ip-assurance.s8.stability.view.v1',
    generatedAtMs: nowMs,
    integrationStatus: 'SYNTHETIC_ONLY',
    ...authorityFields(),
    overallAssuranceResult: overall(annunciators.map((entry) => entry.assuranceResult)),
    annunciators,
    deadlineLease,
    repairLoops,
    resources,
    loadSheddingOrder: Array.isArray(resourceSource.loadSheddingOrder) ? [...resourceSource.loadSheddingOrder] : [],
    controls: [],
    throttleDecision: null,
    runtimeClaims: [],
    nonClaims: [
      'does not declare recovery',
      'does not cancel or execute work',
      'does not acquire or renew a lease',
      'does not throttle or shed work',
      'does not mutate Control, Risk, Capital, execution, persistence, or supervisor state',
    ],
  });
}
