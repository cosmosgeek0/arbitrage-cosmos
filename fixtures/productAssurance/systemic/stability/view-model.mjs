/** Render-neutral S8 projection. It formats evidence and never recomputes owner truth. */
import {
  ASSURANCE_RESULTS,
  CANCELLATION_LATE_RESULT_LAW,
  OPTIONAL_SHEDDING_CLASSES,
  PROTECTED_WORK_CLASSES,
  RESOURCE_FAMILIES,
  STABILITY_SCHEMA_VERSION,
  STABILITY_STRUCTURE_LIMITS,
  deepFreeze,
} from './contracts.mjs';

const DATA_AUTHORITY = 'SYNTHETIC_TEST';
const EFFECT_AUTHORITY = 'NONE';

function validNow(nowMs) {
  return Number.isSafeInteger(nowMs) && nowMs >= 0;
}

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function overall(results) {
  if (results.includes('FAIL')) return 'FAIL';
  if (results.includes('UNKNOWN') || results.length === 0) return 'UNKNOWN';
  return 'PASS';
}

function validReasonCodes(value) {
  if (!Array.isArray(value) || value.length > STABILITY_STRUCTURE_LIMITS.stringArrayEntries) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== 'string' || value[index].length === 0) return false;
  }
  return true;
}

const VALID_ASSESSMENT_KEYS = Object.freeze({
  CANCELLATION_DEADLINE_LEASE: Object.freeze([
    'schemaVersion', 'assessmentKind', 'recordId', 'requestId', 'operationId',
    'canonicalOwner', 'lateResultLaw', 'evaluatedAtMs', 'assuranceResult',
    'effectiveDeadlineAtMs', 'deadlineEvidence', 'leaseEvidence',
    'cancelIntentObserved', 'cancellationSupported', 'cancellationProvesMutationAbsence',
    'mayInitiateNewLocalEffects', 'authoritativeReconciliationRequired',
    'detachedRecoveryContinuationRequired', 'lateFactDisposition',
    'staleAuthorityRejected', 'reasonCodes', 'violationCodes', 'unknownCodes',
    'contractIssues', 'dataAuthority', 'effectAuthority',
  ]),
  REPAIR_CONTROL_LOOP: Object.freeze([
    'schemaVersion', 'assessmentKind', 'campaignId', 'policyId', 'canonicalOwner',
    'evaluatedAtMs', 'assuranceResult', 'reasonCodes', 'violationCodes',
    'unknownCodes', 'triggerCodes', 'progressEvidence', 'budgetEvidence',
    'containmentEvidenceSufficient', 'containmentLifecycle',
    'durableUnresolvedEvidenceRef', 'escalationOwner',
    'terminationWithinDeclaredBudget', 'terminationClaim', 'promotionEvidence',
    'requiredCanonicalResponse', 'automaticActionIssued', 'contractIssues',
    'dataAuthority', 'effectAuthority',
  ]),
  RESOURCE_COST_CIRCUIT_EVIDENCE: Object.freeze([
    'schemaVersion', 'assessmentKind', 'bundleId', 'evaluatedAtMs',
    'assuranceResult', 'rows', 'loadSheddingOrder', 'mayThrottle', 'mayExecute',
    'mayCloseOrResetCircuit', 'controllerOwner', 'throttleDecision', 'commands',
    'contractIssues', 'dataAuthority', 'effectAuthority',
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
  return (nullable && value === null) || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function clonePlain(value) {
  if (Array.isArray(value)) return Array.from(value, clonePlain);
  if (!plainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlain(child)]));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assessmentAuthorityValid(assessment) {
  return assessment.dataAuthority === DATA_AUTHORITY
    && assessment.effectAuthority === EFFECT_AUTHORITY
    && !Object.hasOwn(assessment, 'authority');
}

function normalizeAssessment(assessment, expectedKind, index, nowMs, { reasonCodesOptional = false } = {}) {
  const issues = [];
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
        'budgetEvidence', 'containmentEvidenceSufficient',
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
    if (!contractInvalid && ['CANCELLATION_DEADLINE_LEASE', 'REPAIR_CONTROL_LOOP'].includes(expectedKind)) {
      if (!validReasonCodes(assessment.violationCodes) || !validReasonCodes(assessment.unknownCodes)) {
        issues.push('ASSESSMENT_CODE_ARRAY_INVALID');
      } else if ((assessment.assuranceResult === 'PASS'
          && (assessment.violationCodes.length > 0 || assessment.unknownCodes.length > 0))
        || (assessment.assuranceResult === 'UNKNOWN'
          && (assessment.violationCodes.length > 0 || assessment.unknownCodes.length === 0))
        || (assessment.assuranceResult === 'FAIL' && assessment.violationCodes.length === 0)) {
        issues.push('ASSESSMENT_RESULT_CODE_MISMATCH');
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
    }
    if (!contractInvalid && expectedKind === 'REPAIR_CONTROL_LOOP'
      && assessment.automaticActionIssued !== false) issues.push('AUTOMATIC_ACTION_CLAIM_FORBIDDEN');
    if (!contractInvalid && expectedKind === 'REPAIR_CONTROL_LOOP') {
      const progressKeys = [
        'trailingNoProgress', 'contradictoryCount', 'rollbackCount', 'alternations',
        'netProgress', 'noProgressWindowStartMs', 'missingProgress',
        'conflictingControllersPresent', 'historicalTerminationTriggerDetected',
        'firstHistoricalTriggerAtMs',
      ];
      const progress = assessment.progressEvidence;
      if (!exactObjectKeys(progress, progressKeys)
        || !['trailingNoProgress', 'contradictoryCount', 'rollbackCount', 'alternations'].every((field) => Number.isSafeInteger(progress?.[field]) && progress[field] >= 0)
        || !(progress?.netProgress === null || (typeof progress?.netProgress === 'number' && Number.isFinite(progress.netProgress)))
        || !safeTime(progress?.noProgressWindowStartMs)
        || typeof progress?.missingProgress !== 'boolean'
        || typeof progress?.conflictingControllersPresent !== 'boolean'
        || typeof progress?.historicalTerminationTriggerDetected !== 'boolean'
        || !safeTime(progress?.firstHistoricalTriggerAtMs, { nullable: true })
        || (progress?.historicalTerminationTriggerDetected && progress?.firstHistoricalTriggerAtMs === null)
        || (!progress?.historicalTerminationTriggerDetected && progress?.firstHistoricalTriggerAtMs !== null)) {
        issues.push('REPAIR_PROGRESS_EVIDENCE_INVALID');
      }
      const budgetKeys = [
        'attempts', 'retryTimeMs', 'retryExecutionTimeMs', 'rateUnits',
        'resourceUnits', 'costUnits', 'observedConcurrentActuations',
      ];
      const budget = assessment.budgetEvidence;
      if (!exactObjectKeys(budget, budgetKeys)
        || !Number.isSafeInteger(budget?.attempts) || budget.attempts < 0
        || !Number.isSafeInteger(budget?.observedConcurrentActuations) || budget.observedConcurrentActuations < 0
        || !['retryTimeMs', 'retryExecutionTimeMs', 'rateUnits', 'resourceUnits', 'costUnits'].every((field) => nonNegativeNumber(budget?.[field]))) {
        issues.push('REPAIR_BUDGET_EVIDENCE_INVALID');
      }
      if (!validReasonCodes(assessment.triggerCodes)) issues.push('REPAIR_TRIGGER_CODES_INVALID');
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
      if (terminalEvidencePresent && promotionProven) issues.push('REPAIR_PROMOTION_CONTAINMENT_CONFLICT');
      if (terminalEvidencePresent && assessment.requiredCanonicalResponse !== 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED') issues.push('REPAIR_TERMINAL_RESPONSE_CONFLICT');
      if (assessment.containmentLifecycle === 'QUARANTINED'
        && (assessment.durableUnresolvedEvidenceRef === null || assessment.containmentEvidenceSufficient !== true)) issues.push('REPAIR_QUARANTINE_EVIDENCE_INVALID');
      if (assessment.containmentLifecycle === 'FAILED_ATTENTION_REQUIRED'
        && (assessment.durableUnresolvedEvidenceRef === null || assessment.escalationOwner === null || assessment.containmentEvidenceSufficient !== true)) issues.push('REPAIR_ESCALATION_EVIDENCE_INVALID');
      if (assessment.assuranceResult === 'PASS' && assessment.requiredCanonicalResponse === 'NONE'
        && (!promotionProven || terminalEvidencePresent || assessment.terminationWithinDeclaredBudget !== true
          || assessment.terminationClaim !== 'BOUNDED_BY_DECLARED_EVIDENCE')) issues.push('REPAIR_PASS_PROMOTION_COHERENCE_INVALID');
      if (assessment.assuranceResult === 'PASS'
        && assessment.requiredCanonicalResponse === 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED'
        && (!assessment.containmentEvidenceSufficient || promotionProven
          || assessment.terminationWithinDeclaredBudget !== true
          || assessment.terminationClaim !== 'BOUNDED_BY_DECLARED_EVIDENCE')) issues.push('REPAIR_PASS_CONTAINMENT_COHERENCE_INVALID');
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
  return deepFreeze({
    source: valid ? clonePlain(assessment) : null,
    expectedKind,
    index,
    assuranceResult: valid ? assessment.assuranceResult : 'FAIL',
    reasonCodes: sortedUnique([
      ...(plainRecord(assessment) && validReasonCodes(assessment.reasonCodes) ? assessment.reasonCodes : []),
      ...issues,
    ]),
    contractInvalid: !valid,
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
  const rowResult = overall(normalizedRows.map((row) => row.assuranceResult));
  if (ASSURANCE_RESULTS.includes(resourceAssessment.assuranceResult)
    && resourceAssessment.assuranceResult !== rowResult) issues.push('RESOURCE_BUNDLE_RESULT_MISMATCH');
  return issues;
}

function normalizeResourceRow(row, index, nowMs) {
  const issues = [];
  if (!plainRecord(row)) {
    issues.push('RESOURCE_ROW_OBJECT_REQUIRED');
  } else {
    const required = [
      'rowId', 'resourceFamily', 'assuranceResult', 'reasonCodes',
      'currentBurn', 'budgetLimit', 'budgetRemaining', 'forecast',
      'forecastHorizonMs', 'unknownReason', 'unknownReasons', 'topConsumers',
      'throttlingEvidence', 'circuitEvidence', 'canonicalResponse', 'protections',
      'throttleDecision', 'commands',
    ];
    if (!exactObjectKeys(row, required)) issues.push('RESOURCE_ROW_EXACT_SHAPE_REQUIRED');
    if (!RESOURCE_FAMILIES.includes(row.resourceFamily)) issues.push('RESOURCE_FAMILY_INVALID');
    if (!label(row.rowId)) issues.push('RESOURCE_ROW_ID_INVALID');
    if (!ASSURANCE_RESULTS.includes(row.assuranceResult)) issues.push('RESOURCE_RESULT_INVALID');
    const reasonCodesValid = validReasonCodes(row.reasonCodes);
    if (!reasonCodesValid) issues.push('RESOURCE_REASON_CODES_INVALID');
    if (row.throttleDecision !== null || !Array.isArray(row.commands) || row.commands.length !== 0) issues.push('RESOURCE_EFFECT_FIELDS_FORBIDDEN');
    if (reasonCodesValid && ((row.assuranceResult === 'PASS' && row.reasonCodes.length > 0)
      || (row.assuranceResult !== 'PASS' && row.reasonCodes.length === 0))) issues.push('RESOURCE_RESULT_CODE_MISMATCH');

    const numericFields = ['currentBurn', 'budgetLimit', 'budgetRemaining', 'forecast', 'forecastHorizonMs'];
    if (!numericFields.every((field) => nonNegativeNumber(row[field], { nullable: true }))) issues.push('RESOURCE_NUMERIC_EVIDENCE_INVALID');
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
      let consumerUnknown = false;
      row.topConsumers.forEach((consumer) => {
        if (!exactObjectKeys(consumer, ['consumerId', 'amount', 'unknownReason', 'evidenceRef'])
          || !label(consumer.consumerId)
          || !nonNegativeNumber(consumer.amount, { nullable: true })
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
        else knownTotal += consumer.amount;
      });
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
      || (throttling?.observed === 'UNKNOWN' && (throttling.observedAtMs !== null || throttling.evidenceRef !== null || throttling.unknownReason === null))
      || (throttling?.observed !== 'UNKNOWN' && (throttling?.observedAtMs === null || throttling?.evidenceRef === null || throttling?.unknownReason !== null))) {
      issues.push('RESOURCE_THROTTLING_EVIDENCE_INVALID');
    } else if (throttling.observedAtMs !== null && throttling.observedAtMs > nowMs) {
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
      const transitionValues = [circuit.openedAtMs, circuit.halfOpenAtMs, circuit.closedAtMs, circuit.resetEligibleAtMs, circuit.independentCloseEvidenceRef, circuit.independentCloseOwner, circuit.independentCloseFailureDomain];
      const baselineValues = [circuit.baselineNeverOpenedEvidenceRef, circuit.baselineEvidenceOwner, circuit.baselineEvidenceFailureDomain];
      const baselinePresent = baselineValues.some((entry) => entry !== null);
      const baselineComplete = baselineValues.every((entry) => entry !== null);
      const priorOpen = transitionValues.some((entry) => entry !== null);
      if (circuit.state === 'UNKNOWN' && (circuit.ownerFailureDomain !== null || circuit.observedAtMs !== null || circuit.evidenceRef !== null || circuit.unknownReason === null || priorOpen || baselinePresent)) issues.push('RESOURCE_CIRCUIT_UNKNOWN_EVIDENCE_CONFLICT');
      if (circuit.state !== 'UNKNOWN' && (circuit.ownerFailureDomain === null || circuit.observedAtMs === null || circuit.evidenceRef === null || circuit.unknownReason !== null)) issues.push('RESOURCE_CIRCUIT_KNOWN_EVIDENCE_INVALID');
      if (circuit.observedAtMs !== null && [circuit.openedAtMs, circuit.halfOpenAtMs, circuit.resetEligibleAtMs, circuit.closedAtMs].some((time) => time !== null && time > circuit.observedAtMs)) issues.push('RESOURCE_CIRCUIT_TRANSITION_AFTER_OBSERVATION');
      if (circuit.observedAtMs !== null && circuit.observedAtMs > nowMs) issues.push('RESOURCE_CIRCUIT_EVIDENCE_FROM_FUTURE');
      if (row.assuranceResult === 'PASS' && circuit.observedAtMs !== null
        && nowMs - circuit.observedAtMs > circuit.maxAgeMs) issues.push('RESOURCE_PASS_WITH_STALE_CIRCUIT_EVIDENCE');
      if (circuit.state === 'OPEN' && (circuit.openedAtMs === null || transitionValues.slice(1).some((entry) => entry !== null))) issues.push('RESOURCE_CIRCUIT_OPEN_SEQUENCE_INVALID');
      if (circuit.state === 'HALF_OPEN' && (circuit.openedAtMs === null || circuit.halfOpenAtMs === null || circuit.halfOpenAtMs < circuit.openedAtMs || circuit.closedAtMs !== null || circuit.independentCloseEvidenceRef !== null || circuit.independentCloseOwner !== null || circuit.independentCloseFailureDomain !== null || (circuit.resetEligibleAtMs !== null && circuit.resetEligibleAtMs < circuit.halfOpenAtMs))) issues.push('RESOURCE_CIRCUIT_HALF_OPEN_SEQUENCE_INVALID');
      if (circuit.state === 'CLOSED' && priorOpen
        && (circuit.openedAtMs === null || circuit.halfOpenAtMs === null || circuit.resetEligibleAtMs === null || circuit.closedAtMs === null
          || circuit.independentCloseEvidenceRef === null || circuit.independentCloseOwner === null || circuit.independentCloseFailureDomain === null
          || circuit.halfOpenAtMs < circuit.openedAtMs || circuit.resetEligibleAtMs < circuit.halfOpenAtMs || circuit.closedAtMs < circuit.resetEligibleAtMs
          || circuit.independentCloseEvidenceRef === circuit.evidenceRef || circuit.independentCloseOwner === circuit.canonicalOwner
          || circuit.independentCloseFailureDomain === circuit.ownerFailureDomain)) issues.push('RESOURCE_CIRCUIT_CLOSE_PROOF_INVALID');
      if (circuit.state !== 'CLOSED' && baselinePresent) issues.push('RESOURCE_CIRCUIT_BASELINE_CONFLICT');
      if (circuit.state === 'CLOSED' && priorOpen && baselinePresent) issues.push('RESOURCE_CIRCUIT_BASELINE_TRANSITION_CONFLICT');
      if (circuit.state === 'CLOSED' && !priorOpen
        && (!baselineComplete
          || circuit.baselineNeverOpenedEvidenceRef === circuit.evidenceRef
          || circuit.baselineEvidenceOwner === circuit.canonicalOwner
          || circuit.baselineEvidenceFailureDomain === circuit.ownerFailureDomain)) issues.push('RESOURCE_CIRCUIT_BASELINE_PROOF_INVALID');
      if (row.assuranceResult === 'PASS' && circuit.state !== 'CLOSED') issues.push('RESOURCE_PASS_WITH_UNPROVED_CIRCUIT_POSTURE');
    }

    const response = row.canonicalResponse;
    if (!exactObjectKeys(response, ['kind', 'referenceId', 'owner', 'wiringState', 'unknownReason'])
      || !['OWNER_ACTION_REFERENCE', 'RECOMMENDATION', 'NONE', 'UNKNOWN'].includes(response?.kind)
      || !label(response?.referenceId, { nullable: true }) || !label(response?.owner)
      || !['DRAFT_INSERTION_REQUEST', 'OWNER_GATED', 'UNAVAILABLE'].includes(response?.wiringState)
      || !label(response?.unknownReason, { nullable: true })
      || (['OWNER_ACTION_REFERENCE', 'RECOMMENDATION'].includes(response?.kind) && (response.referenceId === null || response.unknownReason !== null || response.wiringState === 'UNAVAILABLE'))
      || (response?.kind === 'UNKNOWN' && (response.referenceId !== null || response.unknownReason === null || response.wiringState !== 'UNAVAILABLE'))
      || (response?.kind === 'NONE' && (response.referenceId !== null || response.unknownReason !== null))) {
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
  }
  const valid = issues.length === 0;
  return deepFreeze({
    source: valid ? clonePlain(row) : null,
    index,
    resourceFamily: plainRecord(row) && typeof row.resourceFamily === 'string' ? row.resourceFamily : null,
    assuranceResult: valid ? row.assuranceResult : 'FAIL',
    reasonCodes: sortedUnique([
      ...(plainRecord(row) && validReasonCodes(row.reasonCodes) ? row.reasonCodes : []),
      ...issues,
    ]),
    contractInvalid: !valid,
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
  const source = plainRecord(input) ? input : {};
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
      assuranceResult: normalized.assuranceResult,
      deadlineEvidence: assessment.deadlineEvidence ?? 'UNKNOWN',
      effectiveDeadlineAtMs: assessment.effectiveDeadlineAtMs ?? null,
      leaseEvidence: assessment.leaseEvidence ?? 'UNKNOWN',
      cancellationIntentObserved: assessment.cancelIntentObserved ?? null,
      cancellationSupported: assessment.cancellationSupported ?? null,
      cancellationProvesMutationAbsence: false,
      reconciliationRequired: assessment.authoritativeReconciliationRequired ?? null,
      mayInitiateNewLocalEffects: assessment.mayInitiateNewLocalEffects ?? null,
      detachedRecoveryContinuationRequired: assessment.detachedRecoveryContinuationRequired ?? null,
      lateFactDisposition: assessment.lateFactDisposition ?? 'UNKNOWN',
      staleAuthorityRejected: assessment.staleAuthorityRejected ?? null,
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
      assuranceResult: normalized.assuranceResult,
      progressEvidence: assessment.progressEvidence ?? null,
      budgetEvidence: assessment.budgetEvidence ?? null,
      terminationClaim: assessment.terminationClaim ?? 'UNKNOWN_UNBOUNDED',
      containmentEvidenceSufficient: assessment.containmentEvidenceSufficient ?? null,
      containmentLifecycle: assessment.containmentLifecycle ?? null,
      durableUnresolvedEvidenceRef: assessment.durableUnresolvedEvidenceRef ?? null,
      escalationOwner: assessment.escalationOwner ?? null,
      promotionEvidence: assessment.promotionEvidence ?? 'NOT_PROVEN',
      requiredCanonicalResponse: assessment.requiredCanonicalResponse ?? 'OWNER_REVIEW_REQUIRED',
      automaticActionIssued: false,
      reasonCodes: normalized.reasonCodes,
      ...authorityFields(),
    });
  });

  const resourceSource = assessmentSource(resource);
  const normalizedResourceRows = Array.isArray(resourceSource.rows)
    ? Array.from(resourceSource.rows, (row, index) => normalizeResourceRow(row, index, nowMs))
    : [];
  const resources = normalizedResourceRows.map((normalized) => {
    const row = normalized.source ?? {};
    return deepFreeze({
      rowId: row.rowId ?? null,
      resourceFamily: normalized.resourceFamily,
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
  const resourceBundleResult = resource.contractInvalid || resourceDenominatorReasonCodes.length > 0
    ? 'FAIL'
    : resource.assuranceResult;
  const resourceBundleAnnunciator = {
    id: `resource-bundle:${resourceSource.bundleId ?? 'invalid'}`,
    family: 'ASSURANCE_RESOURCE_COST_CIRCUIT_BUNDLE',
    assuranceResult: resourceBundleResult,
    reasonCodes: sortedUnique([...resource.reasonCodes, ...resourceDenominatorReasonCodes]),
  };

  const annunciators = [
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
    integrationStatus: 'DESIGNED',
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
