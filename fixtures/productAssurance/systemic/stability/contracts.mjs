/**
 * IP-ASSURANCE amendment S8 packet-local contracts.
 *
 * These are fixture/reference contracts only. They do not register operations,
 * execute repairs, grant cancellation authority, manage leases, throttle work,
 * or widen any production lifecycle vocabulary.
 */

export const STABILITY_SCHEMA_VERSION = 'ip-assurance.systemic.stability.v1';
export const STABILITY_PACKET_STATE = 'DRAFT_PRESTAGE_IN_PROGRESS';

export const CANCELLATION_LATE_RESULT_LAW = 'LATE_EXTERNAL_FACTS_DURABLY_RETAINED_STALE_EPOCH_CANNOT_AUTHORIZE_NEW_WORK_V1';
export const REPAIR_LATE_RESULT_LAW = 'REPAIR_TRUTH_RETAINED_STALE_LEASE_OR_FENCE_COMPLETION_REJECTED_V1';
export const REPAIR_RESTART_BEHAVIOR = 'RESTORE_CAMPAIGN_ATTEMPTS_BUDGETS_COOLDOWN_LEASE_FENCE_AND_LATE_RESULT_LAW_V1';

export const STABILITY_STRUCTURE_LIMITS = deepFreeze({
  stringArrayEntries: 64,
  observedSignals: 64,
  repairAttempts: 256,
  conflictCampaigns: 256,
  topConsumersPerResource: 128,
});

export const ASSURANCE_RESULTS = Object.freeze(['PASS', 'FAIL', 'UNKNOWN']);
export const OPERATION_CLASSES = Object.freeze([
  'PURE_READ',
  'REPLAYABLE_SUBSCRIPTION',
  'IDEMPOTENT_COMMAND',
  'NON_IDEMPOTENT_MUTATION',
  'MULTI_LEG_SAGA',
  'RISK_REDUCING_RECOVERY',
]);
export const REQUEST_KINDS = Object.freeze(['BOUNDED_INTERNAL', 'LONG_LIVED_LEASED']);
export const EFFECT_KINDS = Object.freeze(['LOCAL', 'EXTERNAL_OR_ALREADY_ACCEPTED']);
export const LATE_FACT_TYPES = Object.freeze([
  'ACKNOWLEDGMENT',
  'FILL',
  'CANCEL_ACKNOWLEDGMENT',
  'FUNDING',
  'BORROW',
  'REPAY',
  'ACCOUNT_EVENT',
  'OTHER_EXTERNAL_FACT',
]);
export const DETACH_REASONS = Object.freeze([
  'DURABLE_RECONCILIATION',
  'AUTHORITATIVE_EVIDENCE_INGESTION',
  'ALREADY_AUTHORIZED_RISK_REDUCTION',
]);
export const REMEDIATION_CONTAINMENT_LIFECYCLES = Object.freeze([
  'QUARANTINED',
  'FAILED_ATTENTION_REQUIRED',
]);
export const RESOURCE_FAMILIES = Object.freeze([
  'LLM_TOKENS',
  'APIS',
  'BINANCE_RATE_LIMITS',
  'TELEMETRY_STORAGE',
  'REPLAY_COMPUTE',
  'DATABASE_WAL_GROWTH',
  'CLOUD_COST',
  'BACKGROUND_JOB_CONCURRENCY',
]);
export const OPTIONAL_SHEDDING_CLASSES = Object.freeze([
  'OPTIONAL_RESEARCH',
  'REPLAY',
  'NEWS',
  'CHART_DETAIL',
  'BROAD_ENRICHMENT',
]);
export const PROTECTED_WORK_CLASSES = Object.freeze([
  'ACTIVE_POSITION_SUPERVISION',
  'RECONCILIATION',
  'RECOVERY',
  'PRIVATE_TRUTH',
  'LEDGER',
  'OPERATOR_CONTROL',
  'SAFE_RISK_REDUCTION',
]);

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function schema(id, required, enums, laws) {
  return deepFreeze({
    id,
    version: STABILITY_SCHEMA_VERSION,
    additionalProperties: false,
    required,
    enums,
    laws,
  });
}

export const STABILITY_SCHEMAS = deepFreeze({
  cancellationEvidence: schema(
    'ip-assurance.s8.cancellation-evidence',
    [
      'schemaVersion', 'recordId', 'operationId', 'operationClass', 'canonicalOwner',
      'requestId', 'parentRequestId', 'requestKind', 'clockDomain', 'startedAtMs',
      'inheritedDeadlineAtMs', 'childBudgetMs', 'localDeadlineAtMs',
      'cancellationContextId', 'lateResultLaw', 'cancelRequestedAtMs', 'cancelObservedAtMs',
      'cancellationSupported', 'cancellationUnknownReason', 'effect', 'lease',
      'detachedRecovery', 'lateFact', 'reconciliationEvidence', 'restartEvidence',
      'dataAuthority', 'effectAuthority',
    ],
    { operationClass: OPERATION_CLASSES, requestKind: REQUEST_KINDS },
    [
      'bounded children cannot outlive or out-budget their parent',
      'long-lived work uses lease and heartbeat evidence instead of a root deadline',
      'cancellation is intent and never proves an external mutation absent',
      'late external truth is retained even when its epoch cannot authorize new work',
    ],
  ),
  repairPolicyExtension: schema(
    'ip-assurance.s8.repair-policy-extension',
    [
      'schemaVersion', 'draftState', 'policyId', 'operationPolicyId', 'operationClass',
      'policyRevision', 'managedComponentId', 'canonicalOwner', 'implementationPath',
      'commandIdentity', 'commandRegistration', 'controlledState',
      'observedSignals', 'prerequisites', 'forbiddenContexts', 'evaluationCadenceMs',
      'observationHorizonMs', 'actuationDelayMs', 'deadband', 'hysteresis',
      'cooldownMs', 'maximumStep', 'maximumSlew', 'successPredicate', 'progressLaw',
      'budgets', 'oscillationLaw', 'rollbackCompensation', 'quarantineEscalation',
      'lateResultLaw', 'restartBehavior', 'resourceLeaseLaw',
      'dependencies', 'invariants', 'triggerEvidenceRequirements',
      'failureFingerprintFields', 'diagnosticConfidenceLaw', 'maximumScope',
      'minimumDiagnosticConfidence',
      'capitalPosture', 'predictedResult', 'fencingOwner', 'repairConflictGraph',
      'promotionLaw', 'reserveCapacityLaw', 'circuitLaw',
      'automaticRemediationAllowed', 'dataAuthority', 'effectAuthority',
    ],
    { operationClass: OPERATION_CLASSES },
    [
      'action completion is not recovery',
      'independent postconditions and quiet-period evidence gate promotion',
      'no-progress, contradictory progress, rollback recurrence, oscillation, and budget exhaustion stop automatic actuation',
      'missing store, clock, fence, or observability assumptions make termination UNKNOWN',
    ],
  ),
  repairEvidence: schema(
    'ip-assurance.s8.repair-evidence',
    [
      'schemaVersion', 'campaignId', 'policyId', 'policyRevision',
      'campaignStartedAtMs', 'failureFingerprint', 'diagnosticConfidence',
      'triggerEvidenceRef', 'readinessEvidence', 'conflictGraphEvidence',
      'assumptions', 'currentFenceEpoch', 'lease', 'attempts', 'containment',
      'postconditionWindow', 'restartEvidence', 'nextActuationRequested',
      'promotionClaimed', 'observedConcurrentActuations', 'dataAuthority',
      'effectAuthority',
    ],
    {},
    [
      'attempts and budgets survive restart',
      'stale completion cannot apply after lease expiry or handoff',
      'packet output is evidence only and cannot actuate containment',
    ],
  ),
  resourceEvidenceBundle: schema(
    'ip-assurance.s8.resource-evidence-bundle',
    ['schemaVersion', 'bundleId', 'rows', 'loadSheddingOrder', 'dataAuthority', 'effectBoundary'],
    { resourceFamily: RESOURCE_FAMILIES },
    [
      'the eight-family denominator is exact and versioned',
      'unknown burn, budget, or forecast remains null with an exact blocker',
      'material money and audit evidence and independently safe risk reduction are protected',
      'IP-ASSURANCE has no throttling or execution authority',
    ],
  ),
});

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function add(issues, path, code, detail) {
  issues.push({ path, code, detail });
}

function exactKeys(issues, value, path, expected) {
  if (!isPlainRecord(value)) {
    add(issues, path, 'OBJECT_REQUIRED', 'plain object required');
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('|') !== wanted.join('|')) {
    add(issues, path, 'EXACT_KEYS_REQUIRED', `expected [${wanted.join(', ')}], received [${actual.join(', ')}]`);
  }
  return true;
}

function label(issues, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 240) {
    add(issues, path, 'LABEL_INVALID', 'non-empty string of at most 240 characters required');
  }
}

function enumValue(issues, value, path, allowed) {
  if (!allowed.includes(value)) add(issues, path, 'ENUM_INVALID', `expected one of ${allowed.join('|')}`);
}

function safeTime(issues, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) add(issues, path, 'TIME_INVALID', 'non-negative safe integer required');
}

function positiveInteger(issues, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value) || value <= 0) add(issues, path, 'POSITIVE_INTEGER_REQUIRED', 'positive safe integer required');
}

function nonNegativeNumber(issues, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    add(issues, path, 'NON_NEGATIVE_NUMBER_REQUIRED', 'finite non-negative number no greater than Number.MAX_SAFE_INTEGER required');
  }
}

function boundedFiniteNumber(issues, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    add(issues, path, 'BOUNDED_FINITE_NUMBER_REQUIRED', 'finite number with magnitude no greater than Number.MAX_SAFE_INTEGER required');
  }
}

function hasSparseEntries(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return true;
  return false;
}

function stringArray(issues, value, path, { nonEmpty = false, unique = true } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    add(issues, path, 'STRING_ARRAY_REQUIRED', nonEmpty ? 'non-empty string array required' : 'string array required');
    return;
  }
  if (value.length > STABILITY_STRUCTURE_LIMITS.stringArrayEntries) {
    add(issues, path, 'TOO_MANY_ARRAY_ENTRIES', `at most ${STABILITY_STRUCTURE_LIMITS.stringArrayEntries} entries allowed`);
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      add(issues, path, 'SPARSE_ARRAY_FORBIDDEN', 'array entries must be dense and explicitly present');
      return;
    }
  }
  for (let index = 0; index < value.length; index += 1) label(issues, value[index], `${path}[${index}]`);
  if (unique && new Set(value).size !== value.length) add(issues, path, 'DUPLICATE_VALUE', 'array entries must be unique');
}

function finish(issues) {
  issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  return deepFreeze(issues);
}

export function validateCancellationEvidence(value) {
  const issues = [];
  if (!exactKeys(issues, value, '$', STABILITY_SCHEMAS.cancellationEvidence.required)) return finish(issues);
  if (value.schemaVersion !== STABILITY_SCHEMA_VERSION) add(issues, '$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'unsupported schema version');
  for (const field of ['recordId', 'operationId', 'canonicalOwner', 'requestId', 'cancellationContextId', 'lateResultLaw']) label(issues, value[field], `$.${field}`);
  if (value.lateResultLaw !== CANCELLATION_LATE_RESULT_LAW) add(issues, '$.lateResultLaw', 'LATE_RESULT_LAW_INVALID', 'cancellation evidence must use the exact retained-truth and stale-authority law identity');
  label(issues, value.parentRequestId, '$.parentRequestId', { nullable: true });
  enumValue(issues, value.operationClass, '$.operationClass', OPERATION_CLASSES);
  if (value.operationClass !== 'IDEMPOTENT_COMMAND') add(issues, '$.operationClass', 'AUTOMATIC_LOCAL_OPERATION_CLASS_REQUIRED', 'automatic local repair is limited to the explicitly idempotent command operation class');
  enumValue(issues, value.requestKind, '$.requestKind', REQUEST_KINDS);
  if (value.clockDomain !== 'INJECTED_MONOTONIC_MS') add(issues, '$.clockDomain', 'INJECTED_CLOCK_DOMAIN_REQUIRED', 'packet fixtures use only an injected monotonic clock');
  safeTime(issues, value.startedAtMs, '$.startedAtMs');
  safeTime(issues, value.inheritedDeadlineAtMs, '$.inheritedDeadlineAtMs', { nullable: true });
  positiveInteger(issues, value.childBudgetMs, '$.childBudgetMs', { nullable: true });
  safeTime(issues, value.localDeadlineAtMs, '$.localDeadlineAtMs', { nullable: true });
  safeTime(issues, value.cancelRequestedAtMs, '$.cancelRequestedAtMs', { nullable: true });
  safeTime(issues, value.cancelObservedAtMs, '$.cancelObservedAtMs', { nullable: true });
  if (!(typeof value.cancellationSupported === 'boolean' || value.cancellationSupported === null)) {
    add(issues, '$.cancellationSupported', 'TRISTATE_REQUIRED', 'boolean or null required');
  }
  label(issues, value.cancellationUnknownReason, '$.cancellationUnknownReason', { nullable: true });
  if (value.cancellationSupported === null && value.cancellationUnknownReason === null) {
    add(issues, '$.cancellationUnknownReason', 'UNKNOWN_REASON_REQUIRED', 'unknown cancellation support requires an exact reason');
  }
  if (value.cancellationSupported !== null && value.cancellationUnknownReason !== null) {
    add(issues, '$.cancellationUnknownReason', 'UNKNOWN_REASON_CONFLICT', 'known support cannot carry an unknown reason');
  }

  if (exactKeys(issues, value.effect, '$.effect', ['kind', 'initiatedAtMs', 'committedAtMs'])) {
    enumValue(issues, value.effect.kind, '$.effect.kind', EFFECT_KINDS);
    safeTime(issues, value.effect.initiatedAtMs, '$.effect.initiatedAtMs', { nullable: true });
    safeTime(issues, value.effect.committedAtMs, '$.effect.committedAtMs', { nullable: true });
    if (value.effect.committedAtMs !== null && value.effect.initiatedAtMs === null) {
      add(issues, '$.effect', 'COMMIT_WITHOUT_INITIATION', 'committed effect requires initiation evidence');
    }
    if (value.effect.committedAtMs !== null && value.effect.initiatedAtMs !== null && value.effect.committedAtMs < value.effect.initiatedAtMs) {
      add(issues, '$.effect.committedAtMs', 'TIME_REGRESSION', 'commit cannot precede initiation');
    }
  }

  if (value.lease !== null) {
    const leaseKeys = [
      'resourceId', 'ownerId', 'processId', 'releaseId', 'leaseId', 'fenceEpoch',
      'activeFenceEpoch', 'acquiredAtMs', 'renewalSequence', 'lastRenewedAtMs',
      'lastHeartbeatAtMs', 'heartbeatMaxAgeMs', 'expiresAtMs', 'completionEpoch',
      'completionDisposition',
    ];
    if (exactKeys(issues, value.lease, '$.lease', leaseKeys)) {
      for (const field of ['resourceId', 'ownerId', 'processId', 'releaseId', 'leaseId']) label(issues, value.lease[field], `$.lease.${field}`);
      positiveInteger(issues, value.lease.fenceEpoch, '$.lease.fenceEpoch');
      positiveInteger(issues, value.lease.activeFenceEpoch, '$.lease.activeFenceEpoch');
      safeTime(issues, value.lease.acquiredAtMs, '$.lease.acquiredAtMs');
      positiveInteger(issues, value.lease.renewalSequence, '$.lease.renewalSequence');
      safeTime(issues, value.lease.lastRenewedAtMs, '$.lease.lastRenewedAtMs');
      safeTime(issues, value.lease.lastHeartbeatAtMs, '$.lease.lastHeartbeatAtMs');
      positiveInteger(issues, value.lease.heartbeatMaxAgeMs, '$.lease.heartbeatMaxAgeMs');
      safeTime(issues, value.lease.expiresAtMs, '$.lease.expiresAtMs');
      positiveInteger(issues, value.lease.completionEpoch, '$.lease.completionEpoch', { nullable: true });
      enumValue(issues, value.lease.completionDisposition, '$.lease.completionDisposition', ['NOT_OBSERVED', 'APPLIED', 'REJECTED']);
      if (value.lease.completionEpoch === null && value.lease.completionDisposition !== 'NOT_OBSERVED') add(issues, '$.lease.completionDisposition', 'COMPLETION_DISPOSITION_CONFLICT', 'missing completion epoch requires NOT_OBSERVED disposition');
      if (value.lease.completionEpoch !== null && value.lease.completionDisposition === 'NOT_OBSERVED') add(issues, '$.lease.completionDisposition', 'COMPLETION_DISPOSITION_REQUIRED', 'observed completion epoch requires applied or rejected disposition evidence');
      if (value.lease.lastRenewedAtMs < value.lease.acquiredAtMs) add(issues, '$.lease.lastRenewedAtMs', 'TIME_REGRESSION', 'renewal cannot precede acquisition');
      if (value.lease.lastHeartbeatAtMs < value.lease.acquiredAtMs) add(issues, '$.lease.lastHeartbeatAtMs', 'TIME_REGRESSION', 'heartbeat cannot precede acquisition');
      if (value.lease.expiresAtMs <= value.lease.acquiredAtMs) add(issues, '$.lease.expiresAtMs', 'LEASE_WINDOW_INVALID', 'lease expiry must follow acquisition');
    }
  }

  if (value.detachedRecovery !== null) {
    const detachedKeys = [
      'reason', 'operationRegistered', 'operationRegistryRef', 'priorAuthorizationRef',
      'operationClass', 'canonicalOwner', 'fencedRecoveryContextId', 'leaseId',
      'leaseOwner', 'fenceEpoch', 'activeFenceEpoch', 'leaseExpiresAtMs',
      'fenceObservedAtMs', 'fenceMaxAgeMs', 'fenceEvidenceRef',
    ];
    if (exactKeys(issues, value.detachedRecovery, '$.detachedRecovery', detachedKeys)) {
      enumValue(issues, value.detachedRecovery.reason, '$.detachedRecovery.reason', DETACH_REASONS);
      if (typeof value.detachedRecovery.operationRegistered !== 'boolean') add(issues, '$.detachedRecovery.operationRegistered', 'BOOLEAN_REQUIRED', 'boolean required');
      label(issues, value.detachedRecovery.operationRegistryRef, '$.detachedRecovery.operationRegistryRef', { nullable: true });
      label(issues, value.detachedRecovery.priorAuthorizationRef, '$.detachedRecovery.priorAuthorizationRef', { nullable: true });
      enumValue(issues, value.detachedRecovery.operationClass, '$.detachedRecovery.operationClass', OPERATION_CLASSES);
      label(issues, value.detachedRecovery.canonicalOwner, '$.detachedRecovery.canonicalOwner');
      label(issues, value.detachedRecovery.fencedRecoveryContextId, '$.detachedRecovery.fencedRecoveryContextId');
      label(issues, value.detachedRecovery.leaseId, '$.detachedRecovery.leaseId');
      label(issues, value.detachedRecovery.leaseOwner, '$.detachedRecovery.leaseOwner');
      positiveInteger(issues, value.detachedRecovery.fenceEpoch, '$.detachedRecovery.fenceEpoch');
      positiveInteger(issues, value.detachedRecovery.activeFenceEpoch, '$.detachedRecovery.activeFenceEpoch');
      safeTime(issues, value.detachedRecovery.leaseExpiresAtMs, '$.detachedRecovery.leaseExpiresAtMs');
      safeTime(issues, value.detachedRecovery.fenceObservedAtMs, '$.detachedRecovery.fenceObservedAtMs');
      positiveInteger(issues, value.detachedRecovery.fenceMaxAgeMs, '$.detachedRecovery.fenceMaxAgeMs');
      label(issues, value.detachedRecovery.fenceEvidenceRef, '$.detachedRecovery.fenceEvidenceRef');
      if (value.detachedRecovery.operationRegistered && value.detachedRecovery.operationRegistryRef === null) {
        add(issues, '$.detachedRecovery.operationRegistryRef', 'REGISTRY_EVIDENCE_REQUIRED', 'registered detached recovery requires an owner registry reference');
      }
      if (value.detachedRecovery.reason === 'ALREADY_AUTHORIZED_RISK_REDUCTION'
        && value.detachedRecovery.priorAuthorizationRef === null) {
        add(issues, '$.detachedRecovery.priorAuthorizationRef', 'PRIOR_AUTHORIZATION_EVIDENCE_REQUIRED', 'risk reduction detach requires prior authorization evidence');
      }
    }
  }

  if (exactKeys(issues, value.reconciliationEvidence, '$.reconciliationEvidence', ['required', 'operationLookupRef', 'durableEvidenceRef'])) {
    if (typeof value.reconciliationEvidence.required !== 'boolean') add(issues, '$.reconciliationEvidence.required', 'BOOLEAN_REQUIRED', 'boolean required');
    label(issues, value.reconciliationEvidence.operationLookupRef, '$.reconciliationEvidence.operationLookupRef', { nullable: true });
    label(issues, value.reconciliationEvidence.durableEvidenceRef, '$.reconciliationEvidence.durableEvidenceRef', { nullable: true });
    if (value.reconciliationEvidence.required
      && (value.reconciliationEvidence.operationLookupRef === null || value.reconciliationEvidence.durableEvidenceRef === null)) {
      add(issues, '$.reconciliationEvidence', 'RECONCILIATION_EVIDENCE_REQUIRED', 'required reconciliation needs canonical lookup and durable evidence references');
    }
    if (!value.reconciliationEvidence.required
      && (value.reconciliationEvidence.operationLookupRef !== null || value.reconciliationEvidence.durableEvidenceRef !== null)) {
      add(issues, '$.reconciliationEvidence', 'RECONCILIATION_EVIDENCE_CONFLICT', 'non-required reconciliation cannot carry affirmative references');
    }
  }

  if (value.lateFact !== null) {
    const factKeys = ['factId', 'factType', 'occurredAtMs', 'receivedAtMs', 'sourceEpoch', 'activeEpoch', 'durableIngestionRef', 'reconciliationRef', 'attemptedToAuthorizeNewWork'];
    if (exactKeys(issues, value.lateFact, '$.lateFact', factKeys)) {
      label(issues, value.lateFact.factId, '$.lateFact.factId');
      enumValue(issues, value.lateFact.factType, '$.lateFact.factType', LATE_FACT_TYPES);
      safeTime(issues, value.lateFact.occurredAtMs, '$.lateFact.occurredAtMs');
      safeTime(issues, value.lateFact.receivedAtMs, '$.lateFact.receivedAtMs');
      positiveInteger(issues, value.lateFact.sourceEpoch, '$.lateFact.sourceEpoch');
      positiveInteger(issues, value.lateFact.activeEpoch, '$.lateFact.activeEpoch');
      label(issues, value.lateFact.durableIngestionRef, '$.lateFact.durableIngestionRef');
      label(issues, value.lateFact.reconciliationRef, '$.lateFact.reconciliationRef');
      if (typeof value.lateFact.attemptedToAuthorizeNewWork !== 'boolean') add(issues, '$.lateFact.attemptedToAuthorizeNewWork', 'BOOLEAN_REQUIRED', 'boolean required');
      if (value.lateFact.receivedAtMs < value.lateFact.occurredAtMs) add(issues, '$.lateFact.receivedAtMs', 'TIME_REGRESSION', 'receipt cannot precede occurrence');
    }
  }

  if (exactKeys(issues, value.restartEvidence, '$.restartEvidence', [
    'restoredFromCheckpoint', 'preservedRequestId', 'preservedLateResultLaw',
    'checkpointRef', 'stateDigestBeforeRestart', 'stateDigestAfterRestart',
    'restoredRequestId', 'restoredCancellationContextId',
    'restoredReconciliationIdentityRef', 'restoredLateResultLaw', 'preservedFields',
  ])) {
    for (const field of ['restoredFromCheckpoint', 'preservedRequestId', 'preservedLateResultLaw']) {
      if (typeof value.restartEvidence[field] !== 'boolean') add(issues, `$.restartEvidence.${field}`, 'BOOLEAN_REQUIRED', 'boolean required');
    }
    for (const field of [
      'checkpointRef', 'stateDigestBeforeRestart', 'stateDigestAfterRestart',
      'restoredRequestId', 'restoredCancellationContextId',
      'restoredReconciliationIdentityRef', 'restoredLateResultLaw',
    ]) label(issues, value.restartEvidence[field], `$.restartEvidence.${field}`, { nullable: true });
    stringArray(issues, value.restartEvidence.preservedFields, '$.restartEvidence.preservedFields');
    const requiredFields = ['requestId', 'cancellationContextId', 'deadline', 'effect', 'reconciliation', 'leaseFence', 'lateResultLaw'];
    if (value.restartEvidence.restoredFromCheckpoint) {
      if ([
        value.restartEvidence.checkpointRef, value.restartEvidence.stateDigestBeforeRestart,
        value.restartEvidence.stateDigestAfterRestart, value.restartEvidence.restoredRequestId,
        value.restartEvidence.restoredCancellationContextId, value.restartEvidence.restoredLateResultLaw,
      ].includes(null)) add(issues, '$.restartEvidence', 'RESTART_CHECKPOINT_EVIDENCE_REQUIRED', 'restored request requires checkpoint, before/after state digests, request ID, and cancel-context ID');
      if (!Array.isArray(value.restartEvidence.preservedFields)
        || value.restartEvidence.preservedFields.length > STABILITY_STRUCTURE_LIMITS.stringArrayEntries
        || requiredFields.some((field) => !value.restartEvidence.preservedFields.includes(field))) add(issues, '$.restartEvidence.preservedFields', 'RESTART_STATE_FIELDS_MISSING', 'request identity, cancel context, deadline, effect, reconciliation, lease/fence, and late-result law must survive restart');
      if (value.restartEvidence.restoredLateResultLaw !== CANCELLATION_LATE_RESULT_LAW) add(issues, '$.restartEvidence.restoredLateResultLaw', 'RESTORED_LATE_RESULT_LAW_INVALID', 'restart must restore the exact cancellation late-result law identity');
    } else if (value.restartEvidence.checkpointRef !== null
      || value.restartEvidence.stateDigestBeforeRestart !== null
      || value.restartEvidence.stateDigestAfterRestart !== null
      || value.restartEvidence.restoredRequestId !== null
      || value.restartEvidence.restoredCancellationContextId !== null
      || value.restartEvidence.restoredReconciliationIdentityRef !== null
      || value.restartEvidence.restoredLateResultLaw !== null
      || (Array.isArray(value.restartEvidence.preservedFields) && value.restartEvidence.preservedFields.length > 0)) {
      add(issues, '$.restartEvidence', 'UNEXPECTED_RESTART_EVIDENCE', 'non-restored request cannot claim checkpoint restoration');
    }
  }

  if (value.requestKind === 'BOUNDED_INTERNAL') {
    if (value.inheritedDeadlineAtMs === null || value.childBudgetMs === null || value.localDeadlineAtMs === null) {
      add(issues, '$', 'BOUNDED_DEADLINE_FIELDS_REQUIRED', 'bounded requests require inherited deadline, child budget, and local deadline');
    }
    if (value.lease !== null) add(issues, '$.lease', 'BOUNDED_LEASE_CONFLICT', 'bounded request cannot use the long-lived lease branch');
    if (value.inheritedDeadlineAtMs !== null && value.inheritedDeadlineAtMs < value.startedAtMs) add(issues, '$.inheritedDeadlineAtMs', 'DEADLINE_PRECEDES_REQUEST_START', 'inherited deadline cannot precede request start');
    if (value.localDeadlineAtMs !== null && value.localDeadlineAtMs < value.startedAtMs) add(issues, '$.localDeadlineAtMs', 'DEADLINE_PRECEDES_REQUEST_START', 'local deadline cannot precede request start');
  }
  if (value.requestKind === 'LONG_LIVED_LEASED') {
    if (value.inheritedDeadlineAtMs !== null || value.childBudgetMs !== null || value.localDeadlineAtMs !== null) {
      add(issues, '$', 'LONG_LIVED_ROOT_DEADLINE_FORBIDDEN', 'long-lived work uses lease and heartbeat evidence, not a root deadline');
    }
    if (value.lease === null) add(issues, '$.lease', 'LEASE_REQUIRED', 'long-lived work requires lease evidence');
  }
  const reconciliationMustBeRecorded = value.effect?.kind === 'EXTERNAL_OR_ALREADY_ACCEPTED'
    || value.lateFact !== null
    || value.detachedRecovery?.reason === 'DURABLE_RECONCILIATION';
  if (reconciliationMustBeRecorded && value.reconciliationEvidence?.required !== true) {
    add(issues, '$.reconciliationEvidence.required', 'AUTHORITATIVE_RECONCILIATION_REQUIRED', 'external or late truth requires durable authoritative reconciliation evidence');
  }
  if (!reconciliationMustBeRecorded && value.reconciliationEvidence?.required !== false) {
    add(issues, '$.reconciliationEvidence.required', 'UNSUPPORTED_RECONCILIATION_CLAIM', 'local-only evidence cannot assert reconciliation without an accepted reason');
  }
  if (value.dataAuthority !== 'SYNTHETIC_TEST') add(issues, '$.dataAuthority', 'DATA_AUTHORITY_INVALID', 'packet fixture evidence is SYNTHETIC_TEST only');
  if (value.effectAuthority !== 'NONE') add(issues, '$.effectAuthority', 'EFFECT_AUTHORITY_FORBIDDEN', 'packet evidence has no effect authority');
  return finish(issues);
}

export function validateRepairPolicy(value) {
  const issues = [];
  if (!exactKeys(issues, value, '$', STABILITY_SCHEMAS.repairPolicyExtension.required)) return finish(issues);
  if (value.schemaVersion !== STABILITY_SCHEMA_VERSION) add(issues, '$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'unsupported schema version');
  if (value.draftState !== 'DRAFT_INSERTION_REQUEST') add(issues, '$.draftState', 'DRAFT_STATE_REQUIRED', 'shared registry rows remain drafts in this subtree');
  for (const field of [
    'policyId', 'operationPolicyId', 'policyRevision', 'managedComponentId',
    'canonicalOwner', 'implementationPath', 'commandIdentity', 'diagnosticConfidenceLaw',
    'maximumScope', 'capitalPosture', 'predictedResult', 'fencingOwner',
    'promotionLaw', 'reserveCapacityLaw', 'circuitLaw',
  ]) label(issues, value[field], `$.${field}`);
  enumValue(issues, value.operationClass, '$.operationClass', OPERATION_CLASSES);
  nonNegativeNumber(issues, value.minimumDiagnosticConfidence, '$.minimumDiagnosticConfidence');
  if (typeof value.minimumDiagnosticConfidence === 'number' && (value.minimumDiagnosticConfidence <= 0 || value.minimumDiagnosticConfidence > 1)) add(issues, '$.minimumDiagnosticConfidence', 'CONFIDENCE_THRESHOLD_OUT_OF_RANGE', 'minimum diagnostic confidence must be in (0,1]');
  for (const field of ['evaluationCadenceMs', 'observationHorizonMs', 'actuationDelayMs', 'cooldownMs']) positiveInteger(issues, value[field], `$.${field}`);
  stringArray(issues, value.dependencies, '$.dependencies', { nonEmpty: true });
  stringArray(issues, value.invariants, '$.invariants', { nonEmpty: true });
  stringArray(issues, value.triggerEvidenceRequirements, '$.triggerEvidenceRequirements', { nonEmpty: true });
  stringArray(issues, value.failureFingerprintFields, '$.failureFingerprintFields', { nonEmpty: true });
  stringArray(issues, value.prerequisites, '$.prerequisites', { nonEmpty: true });
  stringArray(issues, value.forbiddenContexts, '$.forbiddenContexts', { nonEmpty: true });
  if (value.automaticRemediationAllowed !== true) add(issues, '$.automaticRemediationAllowed', 'LOCAL_AUTOMATION_DECLARATION_REQUIRED', 'row must explicitly describe an automatic local repair');
  if (value.dataAuthority !== 'SYNTHETIC_TEST') add(issues, '$.dataAuthority', 'DATA_AUTHORITY_INVALID', 'packet fixture evidence is SYNTHETIC_TEST only');
  if (value.effectAuthority !== 'NONE') add(issues, '$.effectAuthority', 'EFFECT_AUTHORITY_FORBIDDEN', 'IP-ASSURANCE has no effect authority');

  if (exactKeys(issues, value.commandRegistration, '$.commandRegistration', ['state', 'registryRef', 'implementationRef'])) {
    enumValue(issues, value.commandRegistration.state, '$.commandRegistration.state', ['OWNER_CONFIRMATION_REQUIRED', 'CONFIRMED_IN_SYNTHETIC_FIXTURE']);
    label(issues, value.commandRegistration.registryRef, '$.commandRegistration.registryRef', { nullable: true });
    label(issues, value.commandRegistration.implementationRef, '$.commandRegistration.implementationRef', { nullable: true });
    if (value.commandRegistration.state === 'OWNER_CONFIRMATION_REQUIRED'
      && (value.commandRegistration.registryRef !== null || value.commandRegistration.implementationRef !== null)) {
      add(issues, '$.commandRegistration', 'UNCONFIRMED_MAPPING_CANNOT_CARRY_REFS', 'owner-confirmation-required mapping keeps production references null');
    }
    if (value.commandRegistration.state === 'CONFIRMED_IN_SYNTHETIC_FIXTURE'
      && (value.commandRegistration.registryRef === null || value.commandRegistration.implementationRef === null)) {
      add(issues, '$.commandRegistration', 'SYNTHETIC_MAPPING_REFS_REQUIRED', 'confirmed synthetic mapping requires fixture registry and implementation references');
    }
  }

  if (exactKeys(issues, value.controlledState, '$.controlledState', ['resourceIds', 'desired', 'observedSignalIds', 'lastKnownGood', 'allowedDegraded'])) {
    stringArray(issues, value.controlledState.resourceIds, '$.controlledState.resourceIds', { nonEmpty: true });
    stringArray(issues, value.controlledState.observedSignalIds, '$.controlledState.observedSignalIds', { nonEmpty: true });
    for (const field of ['desired', 'lastKnownGood', 'allowedDegraded']) label(issues, value.controlledState[field], `$.controlledState.${field}`);
    if (Array.isArray(value.controlledState.resourceIds)
      && value.controlledState.resourceIds.length <= STABILITY_STRUCTURE_LIMITS.stringArrayEntries) {
      const sorted = [...value.controlledState.resourceIds].sort();
      if (sorted.join('|') !== value.controlledState.resourceIds.join('|')) add(issues, '$.controlledState.resourceIds', 'ORDERED_RESOURCE_SET_REQUIRED', 'resource IDs must be sorted for ordered atomic acquisition');
    }
  }
  if (!Array.isArray(value.observedSignals) || value.observedSignals.length === 0) {
    add(issues, '$.observedSignals', 'SIGNALS_REQUIRED', 'at least one observed signal required');
  } else if (value.observedSignals.length > STABILITY_STRUCTURE_LIMITS.observedSignals) {
    add(issues, '$.observedSignals', 'TOO_MANY_OBSERVED_SIGNALS', `at most ${STABILITY_STRUCTURE_LIMITS.observedSignals} observed signals allowed`);
  } else if (hasSparseEntries(value.observedSignals)) {
    add(issues, '$.observedSignals', 'SPARSE_ARRAY_FORBIDDEN', 'observed signals must be dense');
  } else {
    value.observedSignals.forEach((signal, index) => {
      const path = `$.observedSignals[${index}]`;
      if (exactKeys(issues, signal, path, ['signalId', 'unit', 'required', 'sourceOwner', 'evidencePath', 'failureDomain', 'independent'])) {
        label(issues, signal.signalId, `${path}.signalId`);
        label(issues, signal.unit, `${path}.unit`);
        label(issues, signal.sourceOwner, `${path}.sourceOwner`);
        label(issues, signal.evidencePath, `${path}.evidencePath`);
        label(issues, signal.failureDomain, `${path}.failureDomain`);
        if (typeof signal.required !== 'boolean' || typeof signal.independent !== 'boolean') add(issues, path, 'BOOLEAN_FIELDS_REQUIRED', 'required and independent must be boolean');
      }
    });
    const signalIds = value.observedSignals.map((signal) => signal?.signalId);
    if (new Set(signalIds).size !== signalIds.length) add(issues, '$.observedSignals', 'DUPLICATE_SIGNAL_ID', 'observed signal IDs must be unique');
    if (Array.isArray(value.controlledState?.observedSignalIds)
      && (signalIds.length !== value.controlledState.observedSignalIds.length
        || signalIds.some((signalId) => !value.controlledState.observedSignalIds.includes(signalId)))) {
      add(issues, '$.controlledState.observedSignalIds', 'OBSERVED_SIGNAL_COVERAGE_MISMATCH', 'controlled-state signal IDs must exactly cover the uniquely declared observed signals');
    }
  }
  if (exactKeys(issues, value.deadband, '$.deadband', ['metricId', 'lowerInclusive', 'upperInclusive'])) {
    label(issues, value.deadband.metricId, '$.deadband.metricId');
    boundedFiniteNumber(issues, value.deadband.lowerInclusive, '$.deadband.lowerInclusive');
    boundedFiniteNumber(issues, value.deadband.upperInclusive, '$.deadband.upperInclusive');
    if (value.deadband.lowerInclusive > value.deadband.upperInclusive) {
      add(issues, '$.deadband', 'DEADBAND_INVALID', 'finite ordered inclusive bounds required');
    }
  }
  if (exactKeys(issues, value.hysteresis, '$.hysteresis', ['direction', 'enterThreshold', 'exitThreshold', 'minimumDwellMs'])) {
    enumValue(issues, value.hysteresis.direction, '$.hysteresis.direction', ['INCREASE_IS_PROGRESS', 'DECREASE_IS_PROGRESS']);
    boundedFiniteNumber(issues, value.hysteresis.enterThreshold, '$.hysteresis.enterThreshold');
    boundedFiniteNumber(issues, value.hysteresis.exitThreshold, '$.hysteresis.exitThreshold');
    positiveInteger(issues, value.hysteresis.minimumDwellMs, '$.hysteresis.minimumDwellMs');
    if (value.hysteresis.direction === 'INCREASE_IS_PROGRESS' && value.hysteresis.exitThreshold <= value.hysteresis.enterThreshold) add(issues, '$.hysteresis', 'HYSTERESIS_ORDER_INVALID', 'increase-is-progress requires exit threshold greater than enter threshold');
    if (value.hysteresis.direction === 'DECREASE_IS_PROGRESS' && value.hysteresis.exitThreshold >= value.hysteresis.enterThreshold) add(issues, '$.hysteresis', 'HYSTERESIS_ORDER_INVALID', 'decrease-is-progress requires exit threshold less than enter threshold');
  }
  for (const [field, keys] of [['maximumStep', ['value', 'unit']], ['maximumSlew', ['valuePerMs', 'unit']]]) {
    if (exactKeys(issues, value[field], `$.${field}`, keys)) {
      nonNegativeNumber(issues, value[field][keys[0]], `$.${field}.${keys[0]}`);
      label(issues, value[field].unit, `$.${field}.unit`);
    }
  }
  if (exactKeys(issues, value.successPredicate, '$.successPredicate', ['predicateId', 'producerSignalId', 'verifierSignalId', 'verifierOwner', 'verifierEvidencePath', 'verifierFailureDomain', 'quietPeriodMs'])) {
    for (const field of ['predicateId', 'producerSignalId', 'verifierSignalId', 'verifierOwner', 'verifierEvidencePath', 'verifierFailureDomain']) label(issues, value.successPredicate[field], `$.successPredicate.${field}`);
    positiveInteger(issues, value.successPredicate.quietPeriodMs, '$.successPredicate.quietPeriodMs');
    if (value.successPredicate.producerSignalId === value.successPredicate.verifierSignalId) add(issues, '$.successPredicate', 'INDEPENDENT_VERIFIER_REQUIRED', 'producer and verifier signals must differ');
    const boundedObservedSignals = Array.isArray(value.observedSignals)
      && value.observedSignals.length <= STABILITY_STRUCTURE_LIMITS.observedSignals;
    const producerSignal = boundedObservedSignals
      ? value.observedSignals.find((signal) => signal?.signalId === value.successPredicate.producerSignalId)
      : null;
    const verifierSignal = boundedObservedSignals
      ? value.observedSignals.find((signal) => signal?.signalId === value.successPredicate.verifierSignalId)
      : null;
    if (!producerSignal || !verifierSignal || producerSignal.required !== true
      || verifierSignal.required !== true || verifierSignal.independent !== true) {
      add(issues, '$.successPredicate', 'VERIFIER_SIGNAL_MAPPING_INVALID', 'producer and independent verifier signals must exist in observedSignals');
    } else if (producerSignal.sourceOwner === verifierSignal.sourceOwner
      || producerSignal.evidencePath === verifierSignal.evidencePath
      || producerSignal.failureDomain === verifierSignal.failureDomain
      || verifierSignal.sourceOwner !== value.successPredicate.verifierOwner
      || verifierSignal.evidencePath !== value.successPredicate.verifierEvidencePath
      || verifierSignal.failureDomain !== value.successPredicate.verifierFailureDomain) {
      add(issues, '$.successPredicate', 'COMMON_MODE_VERIFIER_FORBIDDEN', 'verifier owner, evidence path, and failure domain must be independent and exactly mapped');
    }
  }
  if (exactKeys(issues, value.progressLaw, '$.progressLaw', ['metricId', 'direction', 'minimumDelta', 'noProgressAttemptThreshold', 'noProgressWindowMs', 'contradictoryAttemptThreshold', 'repeatedRollbackThreshold'])) {
    label(issues, value.progressLaw.metricId, '$.progressLaw.metricId');
    enumValue(issues, value.progressLaw.direction, '$.progressLaw.direction', ['INCREASE_IS_PROGRESS', 'DECREASE_IS_PROGRESS']);
    nonNegativeNumber(issues, value.progressLaw.minimumDelta, '$.progressLaw.minimumDelta');
    for (const field of ['noProgressAttemptThreshold', 'noProgressWindowMs', 'contradictoryAttemptThreshold', 'repeatedRollbackThreshold']) positiveInteger(issues, value.progressLaw[field], `$.progressLaw.${field}`);
  }
  if (exactKeys(issues, value.budgets, '$.budgets', ['maximumLocalAttempts', 'maximumGlobalAttempts', 'backoffScheduleMs', 'maximumRetryTimeMs', 'rateUnits', 'resourceUnits', 'costUnits', 'maximumConcurrency', 'convergenceWindowMs'])) {
    for (const field of ['maximumLocalAttempts', 'maximumGlobalAttempts', 'maximumRetryTimeMs', 'rateUnits', 'resourceUnits', 'costUnits', 'maximumConcurrency', 'convergenceWindowMs']) positiveInteger(issues, value.budgets[field], `$.budgets.${field}`);
    if (!Array.isArray(value.budgets.backoffScheduleMs) || value.budgets.backoffScheduleMs.length === 0) add(issues, '$.budgets.backoffScheduleMs', 'BACKOFF_REQUIRED', 'non-empty deterministic backoff schedule required');
    else if (value.budgets.backoffScheduleMs.length > STABILITY_STRUCTURE_LIMITS.repairAttempts) add(issues, '$.budgets.backoffScheduleMs', 'TOO_MANY_BACKOFF_ENTRIES', 'backoff schedule cannot exceed the schema-bounded attempt domain');
    else if (hasSparseEntries(value.budgets.backoffScheduleMs)) add(issues, '$.budgets.backoffScheduleMs', 'SPARSE_ARRAY_FORBIDDEN', 'backoff schedule must be dense');
    else {
      value.budgets.backoffScheduleMs.forEach((entry, index) => positiveInteger(issues, entry, `$.budgets.backoffScheduleMs[${index}]`));
      for (let index = 1; index < value.budgets.backoffScheduleMs.length; index += 1) {
        if (value.budgets.backoffScheduleMs[index] < value.budgets.backoffScheduleMs[index - 1]) add(issues, `$.budgets.backoffScheduleMs[${index}]`, 'BACKOFF_REGRESSION', 'backoff schedule must be monotonic non-decreasing');
      }
    }
    if (value.budgets.maximumLocalAttempts > STABILITY_STRUCTURE_LIMITS.repairAttempts) add(issues, '$.budgets.maximumLocalAttempts', 'REPAIR_ATTEMPT_LIMIT_EXCEEDS_SCHEMA_BOUND', `maximumLocalAttempts cannot exceed ${STABILITY_STRUCTURE_LIMITS.repairAttempts}`);
  }
  if (exactKeys(issues, value.oscillationLaw, '$.oscillationLaw', ['windowMs', 'minimumAlternations', 'minimumNetProgress', 'conflictingControllerIds', 'actionFingerprintFields'])) {
    positiveInteger(issues, value.oscillationLaw.windowMs, '$.oscillationLaw.windowMs');
    positiveInteger(issues, value.oscillationLaw.minimumAlternations, '$.oscillationLaw.minimumAlternations');
    nonNegativeNumber(issues, value.oscillationLaw.minimumNetProgress, '$.oscillationLaw.minimumNetProgress');
    stringArray(issues, value.oscillationLaw.conflictingControllerIds, '$.oscillationLaw.conflictingControllerIds', { nonEmpty: true });
    stringArray(issues, value.oscillationLaw.actionFingerprintFields, '$.oscillationLaw.actionFingerprintFields', { nonEmpty: true });
    const supportedFingerprintFields = ['commandIdentity', 'resourceIds', 'actionDirection'];
    if (Array.isArray(value.oscillationLaw.actionFingerprintFields)
      && value.oscillationLaw.actionFingerprintFields.length <= STABILITY_STRUCTURE_LIMITS.stringArrayEntries
      && (value.oscillationLaw.actionFingerprintFields.length !== supportedFingerprintFields.length
        || supportedFingerprintFields.some((field) => !value.oscillationLaw.actionFingerprintFields.includes(field)))) {
      add(issues, '$.oscillationLaw.actionFingerprintFields', 'ACTION_FINGERPRINT_FIELDS_UNSUPPORTED', 'deterministic S8 fixture requires commandIdentity, resourceIds, and actionDirection');
    }
  }
  if (exactKeys(issues, value.rollbackCompensation, '$.rollbackCompensation', ['rollbackActionIdentity', 'rollbackCommandMapping', 'compensationActionIdentity', 'compensationCommandMapping'])) {
    label(issues, value.rollbackCompensation.rollbackActionIdentity, '$.rollbackCompensation.rollbackActionIdentity');
    label(issues, value.rollbackCompensation.rollbackCommandMapping, '$.rollbackCompensation.rollbackCommandMapping', { nullable: true });
    label(issues, value.rollbackCompensation.compensationActionIdentity, '$.rollbackCompensation.compensationActionIdentity');
    label(issues, value.rollbackCompensation.compensationCommandMapping, '$.rollbackCompensation.compensationCommandMapping', { nullable: true });
  }
  if (exactKeys(issues, value.quarantineEscalation, '$.quarantineEscalation', ['quarantineActionIdentity', 'quarantineCommandMapping', 'escalationOwner', 'durableUnresolvedEvidenceRequired'])) {
    label(issues, value.quarantineEscalation.quarantineActionIdentity, '$.quarantineEscalation.quarantineActionIdentity');
    label(issues, value.quarantineEscalation.quarantineCommandMapping, '$.quarantineEscalation.quarantineCommandMapping', { nullable: true });
    label(issues, value.quarantineEscalation.escalationOwner, '$.quarantineEscalation.escalationOwner');
    if (value.quarantineEscalation.durableUnresolvedEvidenceRequired !== true) add(issues, '$.quarantineEscalation.durableUnresolvedEvidenceRequired', 'DURABLE_UNRESOLVED_EVIDENCE_REQUIRED', 'unresolved state must remain durable evidence');
  }
  for (const field of ['lateResultLaw', 'restartBehavior']) label(issues, value[field], `$.${field}`);
  if (value.lateResultLaw !== REPAIR_LATE_RESULT_LAW) add(issues, '$.lateResultLaw', 'LATE_RESULT_LAW_INVALID', 'repair policy must use the exact stale-completion rejection law identity');
  if (value.restartBehavior !== REPAIR_RESTART_BEHAVIOR) add(issues, '$.restartBehavior', 'RESTART_BEHAVIOR_INVALID', 'repair policy must use the exact bounded-state restoration law identity');
  if (exactKeys(issues, value.resourceLeaseLaw, '$.resourceLeaseLaw', ['exclusive', 'orderedAtomicAcquisition', 'staleCompletionRejected'])) {
    for (const field of ['exclusive', 'orderedAtomicAcquisition', 'staleCompletionRejected']) if (value.resourceLeaseLaw[field] !== true) add(issues, `$.resourceLeaseLaw.${field}`, 'LEASE_LAW_REQUIRED', 'value must be true');
  }
  if (Number.isSafeInteger(value.observationHorizonMs) && Number.isSafeInteger(value.progressLaw?.noProgressWindowMs)
    && value.progressLaw.noProgressWindowMs > value.observationHorizonMs) add(issues, '$.progressLaw.noProgressWindowMs', 'NO_PROGRESS_WINDOW_EXCEEDS_HORIZON', 'no-progress evidence window cannot exceed observation horizon');
  if (Number.isSafeInteger(value.observationHorizonMs) && Number.isSafeInteger(value.oscillationLaw?.windowMs)
    && value.oscillationLaw.windowMs > value.observationHorizonMs) add(issues, '$.oscillationLaw.windowMs', 'OSCILLATION_WINDOW_EXCEEDS_HORIZON', 'oscillation evidence window cannot exceed observation horizon');
  if (exactKeys(issues, value.repairConflictGraph, '$.repairConflictGraph', ['graphRef', 'sameResourceExclusion', 'differentFingerprintExclusion'])) {
    label(issues, value.repairConflictGraph.graphRef, '$.repairConflictGraph.graphRef');
    for (const field of ['sameResourceExclusion', 'differentFingerprintExclusion']) {
      if (value.repairConflictGraph[field] !== true) add(issues, `$.repairConflictGraph.${field}`, 'CONFLICT_EXCLUSION_REQUIRED', 'value must be true');
    }
  }
  return finish(issues);
}

export function validateRepairEvidence(value) {
  const issues = [];
  if (!exactKeys(issues, value, '$', STABILITY_SCHEMAS.repairEvidence.required)) return finish(issues);
  if (value.schemaVersion !== STABILITY_SCHEMA_VERSION) add(issues, '$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'unsupported schema version');
  for (const field of ['campaignId', 'policyId', 'policyRevision', 'failureFingerprint', 'triggerEvidenceRef']) label(issues, value[field], `$.${field}`);
  nonNegativeNumber(issues, value.diagnosticConfidence, '$.diagnosticConfidence');
  if (typeof value.diagnosticConfidence === 'number' && value.diagnosticConfidence > 1) add(issues, '$.diagnosticConfidence', 'CONFIDENCE_OUT_OF_RANGE', 'diagnostic confidence must be in [0,1]');
  safeTime(issues, value.campaignStartedAtMs, '$.campaignStartedAtMs');
  if (exactKeys(issues, value.assumptions, '$.assumptions', ['durableStore', 'injectedClock', 'leaseFence', 'observability'])) {
    for (const field of ['durableStore', 'injectedClock', 'leaseFence', 'observability']) enumValue(issues, value.assumptions[field], `$.assumptions.${field}`, ASSURANCE_RESULTS);
  }
  if (exactKeys(issues, value.readinessEvidence, '$.readinessEvidence', [
    'dependencies', 'invariants', 'prerequisites', 'forbiddenContextsClear',
    'capitalPostureSafe', 'reserveCapacityProtected', 'circuitAllowsAction',
    'observedAtMs', 'maxAgeMs', 'evidenceRef',
  ])) {
    for (const field of ['dependencies', 'invariants', 'prerequisites', 'forbiddenContextsClear', 'capitalPostureSafe', 'reserveCapacityProtected', 'circuitAllowsAction']) enumValue(issues, value.readinessEvidence[field], `$.readinessEvidence.${field}`, ASSURANCE_RESULTS);
    safeTime(issues, value.readinessEvidence.observedAtMs, '$.readinessEvidence.observedAtMs');
    positiveInteger(issues, value.readinessEvidence.maxAgeMs, '$.readinessEvidence.maxAgeMs');
    label(issues, value.readinessEvidence.evidenceRef, '$.readinessEvidence.evidenceRef');
  }
  if (exactKeys(issues, value.conflictGraphEvidence, '$.conflictGraphEvidence', ['graphRef', 'observedAtMs', 'maxAgeMs', 'evidenceRef', 'observedCampaigns'])) {
    label(issues, value.conflictGraphEvidence.graphRef, '$.conflictGraphEvidence.graphRef');
    safeTime(issues, value.conflictGraphEvidence.observedAtMs, '$.conflictGraphEvidence.observedAtMs');
    positiveInteger(issues, value.conflictGraphEvidence.maxAgeMs, '$.conflictGraphEvidence.maxAgeMs');
    label(issues, value.conflictGraphEvidence.evidenceRef, '$.conflictGraphEvidence.evidenceRef');
    if (!Array.isArray(value.conflictGraphEvidence.observedCampaigns) || value.conflictGraphEvidence.observedCampaigns.length === 0) add(issues, '$.conflictGraphEvidence.observedCampaigns', 'CAMPAIGN_OBSERVATIONS_REQUIRED', 'conflict graph requires at least the current campaign observation');
    else if (value.conflictGraphEvidence.observedCampaigns.length > STABILITY_STRUCTURE_LIMITS.conflictCampaigns) add(issues, '$.conflictGraphEvidence.observedCampaigns', 'TOO_MANY_CONFLICT_CAMPAIGNS', `at most ${STABILITY_STRUCTURE_LIMITS.conflictCampaigns} campaign observations allowed`);
    else if (hasSparseEntries(value.conflictGraphEvidence.observedCampaigns)) add(issues, '$.conflictGraphEvidence.observedCampaigns', 'SPARSE_ARRAY_FORBIDDEN', 'campaign observations must be dense');
    else {
      const campaignIds = new Set();
      value.conflictGraphEvidence.observedCampaigns.forEach((campaign, index) => {
      const path = `$.conflictGraphEvidence.observedCampaigns[${index}]`;
      if (!exactKeys(issues, campaign, path, ['campaignId', 'failureFingerprint', 'resourceIds', 'startedAtMs', 'completedAtMs', 'acquisitionDisposition', 'evidenceRef'])) return;
      for (const field of ['campaignId', 'failureFingerprint', 'evidenceRef']) label(issues, campaign[field], `${path}.${field}`);
      stringArray(issues, campaign.resourceIds, `${path}.resourceIds`, { nonEmpty: true });
      safeTime(issues, campaign.startedAtMs, `${path}.startedAtMs`);
      safeTime(issues, campaign.completedAtMs, `${path}.completedAtMs`, { nullable: true });
      enumValue(issues, campaign.acquisitionDisposition, `${path}.acquisitionDisposition`, ['ACQUIRED_ATOMICALLY', 'REJECTED_CONFLICT', 'RELEASED']);
      if (campaign.completedAtMs !== null && campaign.completedAtMs < campaign.startedAtMs) add(issues, `${path}.completedAtMs`, 'TIME_REGRESSION', 'campaign completion cannot precede start');
      if (campaign.startedAtMs > value.conflictGraphEvidence.observedAtMs
        || (campaign.completedAtMs !== null && campaign.completedAtMs > value.conflictGraphEvidence.observedAtMs)) {
        add(issues, path, 'CAMPAIGN_EVENT_AFTER_CONFLICT_GRAPH_OBSERVATION', 'conflict-graph observation cannot attest to a campaign event that occurred later');
      }
      if (campaign.acquisitionDisposition === 'ACQUIRED_ATOMICALLY' && campaign.completedAtMs !== null) add(issues, path, 'ACTIVE_CAMPAIGN_COMPLETION_CONFLICT', 'active acquired campaign must have null completion');
      if (campaign.acquisitionDisposition === 'RELEASED' && campaign.completedAtMs === null) add(issues, path, 'RELEASED_CAMPAIGN_COMPLETION_REQUIRED', 'released campaign requires completion evidence');
      if (campaignIds.has(campaign.campaignId)) add(issues, `${path}.campaignId`, 'DUPLICATE_CAMPAIGN_ID', 'campaign IDs must be unique');
      campaignIds.add(campaign.campaignId);
      });
    }
  }
  positiveInteger(issues, value.currentFenceEpoch, '$.currentFenceEpoch');
  if (value.lease !== null && exactKeys(issues, value.lease, '$.lease', [
    'leaseId', 'ownerId', 'processId', 'releaseId', 'fenceEpoch', 'acquiredAtMs',
    'renewalSequence', 'lastRenewedAtMs', 'expiresAtMs', 'resourceIds',
    'atomicAcquisitionEvidenceRef',
  ])) {
    for (const field of ['leaseId', 'ownerId', 'processId', 'releaseId', 'atomicAcquisitionEvidenceRef']) label(issues, value.lease[field], `$.lease.${field}`);
    positiveInteger(issues, value.lease.fenceEpoch, '$.lease.fenceEpoch');
    safeTime(issues, value.lease.acquiredAtMs, '$.lease.acquiredAtMs');
    positiveInteger(issues, value.lease.renewalSequence, '$.lease.renewalSequence');
    safeTime(issues, value.lease.lastRenewedAtMs, '$.lease.lastRenewedAtMs');
    safeTime(issues, value.lease.expiresAtMs, '$.lease.expiresAtMs');
    stringArray(issues, value.lease.resourceIds, '$.lease.resourceIds', { nonEmpty: true });
    if (value.lease.lastRenewedAtMs < value.lease.acquiredAtMs) add(issues, '$.lease.lastRenewedAtMs', 'TIME_REGRESSION', 'renewal cannot precede acquisition');
    if (value.lease.expiresAtMs <= value.lease.lastRenewedAtMs) add(issues, '$.lease.expiresAtMs', 'LEASE_WINDOW_INVALID', 'expiry must follow latest renewal');
  }
  if (!Array.isArray(value.attempts)) add(issues, '$.attempts', 'ARRAY_REQUIRED', 'attempt array required');
  else if (value.attempts.length > STABILITY_STRUCTURE_LIMITS.repairAttempts) add(issues, '$.attempts', 'TOO_MANY_REPAIR_ATTEMPTS', `at most ${STABILITY_STRUCTURE_LIMITS.repairAttempts} repair attempts allowed`);
  else if (hasSparseEntries(value.attempts)) add(issues, '$.attempts', 'SPARSE_ARRAY_FORBIDDEN', 'attempt array must be dense');
  else {
    const seenIds = new Set();
    value.attempts.forEach((attempt, index) => {
      const path = `$.attempts[${index}]`;
      const keys = [
        'attemptId', 'localAttempt', 'globalAttempt', 'controllerId', 'cause',
        'policyRevision', 'commandIdentity', 'commandRegistryRef', 'resourceIds',
        'failureFingerprint', 'diagnosticConfidence', 'startedAtMs', 'completedAtMs',
        'beforeStateRef', 'actionRef', 'afterStateRef', 'result', 'nextRetryAtMs',
        'circuitState', 'materialEventOrLedgerRef', 'cockpitTraceRef',
        'actionDirection', 'controlErrorBefore', 'stepMagnitude', 'progressValue',
        'producerPredicate', 'independentVerifier', 'producerOwner', 'verifierOwner',
        'producerEvidenceRef', 'verifierEvidenceRef', 'producerObservedAtMs',
        'verifierObservedAtMs', 'verifierIndependence', 'rollback', 'compensation',
        'compensationEvidenceRef', 'rateUnits',
        'resourceUnits', 'costUnits', 'fenceEpoch', 'completionApplied', 'afterRestart',
      ];
      if (!exactKeys(issues, attempt, path, keys)) return;
      for (const field of [
        'attemptId', 'controllerId', 'cause', 'policyRevision', 'commandIdentity',
        'commandRegistryRef', 'failureFingerprint', 'beforeStateRef', 'actionRef',
        'afterStateRef', 'materialEventOrLedgerRef', 'cockpitTraceRef',
        'producerOwner', 'verifierOwner', 'producerEvidenceRef', 'verifierEvidenceRef',
      ]) label(issues, attempt[field], `${path}.${field}`);
      stringArray(issues, attempt.resourceIds, `${path}.resourceIds`, { nonEmpty: true });
      for (const field of ['localAttempt', 'globalAttempt', 'fenceEpoch']) positiveInteger(issues, attempt[field], `${path}.${field}`);
      nonNegativeNumber(issues, attempt.diagnosticConfidence, `${path}.diagnosticConfidence`);
      if (typeof attempt.diagnosticConfidence === 'number' && attempt.diagnosticConfidence > 1) add(issues, `${path}.diagnosticConfidence`, 'CONFIDENCE_OUT_OF_RANGE', 'diagnostic confidence must be in [0,1]');
      safeTime(issues, attempt.startedAtMs, `${path}.startedAtMs`);
      safeTime(issues, attempt.completedAtMs, `${path}.completedAtMs`);
      safeTime(issues, attempt.nextRetryAtMs, `${path}.nextRetryAtMs`, { nullable: true });
      safeTime(issues, attempt.producerObservedAtMs, `${path}.producerObservedAtMs`);
      safeTime(issues, attempt.verifierObservedAtMs, `${path}.verifierObservedAtMs`);
      if (attempt.completedAtMs < attempt.startedAtMs) add(issues, `${path}.completedAtMs`, 'TIME_REGRESSION', 'completion cannot precede start');
      if (attempt.nextRetryAtMs !== null && attempt.nextRetryAtMs < attempt.completedAtMs) add(issues, `${path}.nextRetryAtMs`, 'TIME_REGRESSION', 'next retry cannot precede completion');
      if (attempt.producerObservedAtMs < attempt.completedAtMs || attempt.verifierObservedAtMs < attempt.completedAtMs) add(issues, path, 'POSTCONDITION_BEFORE_COMPLETION', 'postcondition observations cannot precede action completion');
      if (attempt.verifierObservedAtMs < attempt.producerObservedAtMs) add(issues, `${path}.verifierObservedAtMs`, 'TIME_REGRESSION', 'verifier evidence cannot precede producer evidence in this deterministic fixture contract');
      if (attempt.nextRetryAtMs !== null
        && attempt.nextRetryAtMs < Math.max(attempt.producerObservedAtMs, attempt.verifierObservedAtMs)) {
        add(issues, `${path}.nextRetryAtMs`, 'RETRY_BEFORE_PROGRESS_EVIDENCE', 'a retry cannot be scheduled before producer and independent-verifier observations exist');
      }
      enumValue(issues, attempt.actionDirection, `${path}.actionDirection`, ['INCREASE', 'DECREASE', 'RESET', 'HOLD']);
      enumValue(issues, attempt.result, `${path}.result`, ['SUCCEEDED', 'FAILED', 'UNKNOWN']);
      enumValue(issues, attempt.circuitState, `${path}.circuitState`, ['OPEN', 'HALF_OPEN', 'CLOSED', 'UNKNOWN']);
      boundedFiniteNumber(issues, attempt.controlErrorBefore, `${path}.controlErrorBefore`);
      for (const field of ['stepMagnitude', 'rateUnits', 'resourceUnits', 'costUnits']) nonNegativeNumber(issues, attempt[field], `${path}.${field}`);
      boundedFiniteNumber(issues, attempt.progressValue, `${path}.progressValue`, { nullable: true });
      enumValue(issues, attempt.producerPredicate, `${path}.producerPredicate`, ASSURANCE_RESULTS);
      enumValue(issues, attempt.independentVerifier, `${path}.independentVerifier`, ASSURANCE_RESULTS);
      enumValue(issues, attempt.verifierIndependence, `${path}.verifierIndependence`, ASSURANCE_RESULTS);
      enumValue(issues, attempt.rollback, `${path}.rollback`, ['NONE', 'SUCCEEDED', 'FAILED']);
      enumValue(issues, attempt.compensation, `${path}.compensation`, ['NOT_REQUIRED', 'SUCCEEDED', 'FAILED', 'UNKNOWN']);
      label(issues, attempt.compensationEvidenceRef, `${path}.compensationEvidenceRef`, { nullable: true });
      if (attempt.compensation === 'NOT_REQUIRED' && attempt.compensationEvidenceRef !== null) add(issues, `${path}.compensationEvidenceRef`, 'COMPENSATION_EVIDENCE_CONFLICT', 'NOT_REQUIRED compensation cannot carry evidence');
      if (attempt.compensation !== 'NOT_REQUIRED' && attempt.compensationEvidenceRef === null) add(issues, `${path}.compensationEvidenceRef`, 'COMPENSATION_EVIDENCE_REQUIRED', 'observed compensation state requires an evidence reference');
      if (typeof attempt.completionApplied !== 'boolean' || typeof attempt.afterRestart !== 'boolean') add(issues, path, 'BOOLEAN_FIELDS_REQUIRED', 'completionApplied and afterRestart must be boolean');
      if (seenIds.has(attempt.attemptId)) add(issues, `${path}.attemptId`, 'DUPLICATE_ATTEMPT_ID', 'attempt IDs must be stable and unique across the campaign');
      seenIds.add(attempt.attemptId);
      const prior = index === 0 ? null : value.attempts[index - 1];
      if (attempt.localAttempt !== index + 1) add(issues, `${path}.localAttempt`, 'LOCAL_ATTEMPT_SEQUENCE_INVALID', 'local attempt ordinals must be strictly contiguous');
      if (isPlainRecord(prior)) {
        if (attempt.globalAttempt <= prior.globalAttempt) add(issues, `${path}.globalAttempt`, 'GLOBAL_ATTEMPT_SEQUENCE_INVALID', 'global attempt ordinal must strictly increase');
        if (attempt.startedAtMs < prior.completedAtMs) add(issues, `${path}.startedAtMs`, 'ATTEMPT_OVERLAP_OR_REORDER', 'attempts must be chronological and non-overlapping');
        if (attempt.startedAtMs < Math.max(prior.producerObservedAtMs, prior.verifierObservedAtMs)) {
          add(issues, `${path}.startedAtMs`, 'ATTEMPT_BEFORE_PRIOR_PROGRESS_EVIDENCE', 'a later attempt cannot start before prior producer and independent-verifier observations exist');
        }
      }
    });
  }
  if (exactKeys(issues, value.containment, '$.containment', ['lifecycle', 'durableUnresolvedEvidenceRef', 'escalationOwner', 'furtherAutomaticActuation'])) {
    if (value.containment.lifecycle !== null) enumValue(issues, value.containment.lifecycle, '$.containment.lifecycle', REMEDIATION_CONTAINMENT_LIFECYCLES);
    label(issues, value.containment.durableUnresolvedEvidenceRef, '$.containment.durableUnresolvedEvidenceRef', { nullable: true });
    label(issues, value.containment.escalationOwner, '$.containment.escalationOwner', { nullable: true });
    if (typeof value.containment.furtherAutomaticActuation !== 'boolean') add(issues, '$.containment.furtherAutomaticActuation', 'BOOLEAN_REQUIRED', 'boolean required');
  }
  if (exactKeys(issues, value.postconditionWindow, '$.postconditionWindow', [
    'producerEvidenceRef', 'verifierEvidenceRef', 'producerOwner', 'verifierOwner',
    'firstIndependentPassAtMs', 'lastIndependentPassAtMs', 'commonModeIndependence',
  ])) {
    for (const field of ['producerEvidenceRef', 'verifierEvidenceRef', 'producerOwner', 'verifierOwner']) label(issues, value.postconditionWindow[field], `$.postconditionWindow.${field}`, { nullable: true });
    safeTime(issues, value.postconditionWindow.firstIndependentPassAtMs, '$.postconditionWindow.firstIndependentPassAtMs', { nullable: true });
    safeTime(issues, value.postconditionWindow.lastIndependentPassAtMs, '$.postconditionWindow.lastIndependentPassAtMs', { nullable: true });
    enumValue(issues, value.postconditionWindow.commonModeIndependence, '$.postconditionWindow.commonModeIndependence', ASSURANCE_RESULTS);
    const nullableFields = [
      value.postconditionWindow.producerEvidenceRef, value.postconditionWindow.verifierEvidenceRef,
      value.postconditionWindow.producerOwner, value.postconditionWindow.verifierOwner,
      value.postconditionWindow.firstIndependentPassAtMs, value.postconditionWindow.lastIndependentPassAtMs,
    ];
    const allNull = nullableFields.every((entry) => entry === null);
    const allKnown = nullableFields.every((entry) => entry !== null);
    if (!allNull && !allKnown) add(issues, '$.postconditionWindow', 'PARTIAL_POSTCONDITION_WINDOW_FORBIDDEN', 'postcondition window must be wholly evidenced or wholly unavailable');
    if (allNull && value.postconditionWindow.commonModeIndependence !== 'UNKNOWN') add(issues, '$.postconditionWindow.commonModeIndependence', 'UNSUPPORTED_INDEPENDENCE_CLAIM', 'missing window evidence keeps independence UNKNOWN');
    if (allKnown) {
      if (value.postconditionWindow.lastIndependentPassAtMs < value.postconditionWindow.firstIndependentPassAtMs) add(issues, '$.postconditionWindow.lastIndependentPassAtMs', 'TIME_REGRESSION', 'quiet window end cannot precede start');
      if (value.postconditionWindow.producerEvidenceRef === value.postconditionWindow.verifierEvidenceRef
        || value.postconditionWindow.producerOwner === value.postconditionWindow.verifierOwner) {
        add(issues, '$.postconditionWindow', 'COMMON_MODE_VERIFIER_FORBIDDEN', 'producer and verifier evidence references and owners must differ');
      }
    }
  }
  if (exactKeys(issues, value.restartEvidence, '$.restartEvidence', [
    'restored', 'preservedCampaignId', 'checkpointRef', 'stateDigestBeforeRestart',
    'stateDigestAfterRestart', 'restoredCampaignId', 'stateBeforeRestart', 'stateAfterRestart',
    'preservedFields', 'attemptCountBeforeRestart',
    'restoredAttemptCount', 'remainingCostUnitsBeforeRestart',
    'remainingCostUnitsAfterRestart',
  ])) {
    if (typeof value.restartEvidence.restored !== 'boolean' || typeof value.restartEvidence.preservedCampaignId !== 'boolean') add(issues, '$.restartEvidence', 'BOOLEAN_FIELDS_REQUIRED', 'restored and preservedCampaignId must be boolean');
    for (const field of ['checkpointRef', 'stateDigestBeforeRestart', 'stateDigestAfterRestart', 'restoredCampaignId']) label(issues, value.restartEvidence[field], `$.restartEvidence.${field}`, { nullable: true });
    stringArray(issues, value.restartEvidence.preservedFields, '$.restartEvidence.preservedFields');
    const stateKeys = [
      'localAttempts', 'globalAttempts', 'remainingRetryTimeMs', 'remainingRateUnits',
      'remainingResourceUnits', 'remainingCostUnits', 'cooldownUntilMs',
      'convergenceDeadlineAtMs', 'leaseId', 'fenceEpoch', 'lateResultLaw',
    ];
    for (const field of ['stateBeforeRestart', 'stateAfterRestart']) {
      const state = value.restartEvidence[field];
      if (state === null) continue;
      const path = `$.restartEvidence.${field}`;
      if (exactKeys(issues, state, path, stateKeys)) {
        for (const counter of ['localAttempts', 'globalAttempts']) {
          if (!Number.isSafeInteger(state[counter]) || state[counter] < 0) add(issues, `${path}.${counter}`, 'NON_NEGATIVE_INTEGER_REQUIRED', 'non-negative safe integer required');
        }
        for (const counter of ['remainingRetryTimeMs', 'remainingRateUnits', 'remainingResourceUnits', 'remainingCostUnits']) nonNegativeNumber(issues, state[counter], `${path}.${counter}`);
        safeTime(issues, state.cooldownUntilMs, `${path}.cooldownUntilMs`);
        safeTime(issues, state.convergenceDeadlineAtMs, `${path}.convergenceDeadlineAtMs`);
        label(issues, state.leaseId, `${path}.leaseId`);
        positiveInteger(issues, state.fenceEpoch, `${path}.fenceEpoch`);
        label(issues, state.lateResultLaw, `${path}.lateResultLaw`);
        if (state.lateResultLaw !== REPAIR_LATE_RESULT_LAW) add(issues, `${path}.lateResultLaw`, 'LATE_RESULT_LAW_INVALID', 'restart state must preserve the exact repair late-result law identity');
      }
    }
    for (const field of ['attemptCountBeforeRestart', 'restoredAttemptCount']) {
      if (!Number.isSafeInteger(value.restartEvidence[field]) || value.restartEvidence[field] < 0) add(issues, `$.restartEvidence.${field}`, 'NON_NEGATIVE_INTEGER_REQUIRED', 'non-negative safe integer required');
    }
    for (const field of ['remainingCostUnitsBeforeRestart', 'remainingCostUnitsAfterRestart']) nonNegativeNumber(issues, value.restartEvidence[field], `$.restartEvidence.${field}`);
    const requiredPreservedFields = ['attempts', 'budgets', 'cooldown', 'lease', 'lateResultLaw', 'convergenceDeadline'];
    if (value.restartEvidence.restored) {
      if ([value.restartEvidence.checkpointRef, value.restartEvidence.stateDigestBeforeRestart, value.restartEvidence.stateDigestAfterRestart, value.restartEvidence.restoredCampaignId].includes(null)) {
        add(issues, '$.restartEvidence', 'RESTART_CHECKPOINT_EVIDENCE_REQUIRED', 'restored campaign requires checkpoint and before/after state digests');
      }
      if (value.restartEvidence.stateBeforeRestart === null || value.restartEvidence.stateAfterRestart === null) {
        add(issues, '$.restartEvidence', 'RESTART_STATE_SNAPSHOT_REQUIRED', 'restored campaign requires before and after bounded-state snapshots');
      }
      if (!Array.isArray(value.restartEvidence.preservedFields)
        || value.restartEvidence.preservedFields.length > STABILITY_STRUCTURE_LIMITS.stringArrayEntries
        || requiredPreservedFields.some((field) => !value.restartEvidence.preservedFields.includes(field))) {
        add(issues, '$.restartEvidence.preservedFields', 'RESTART_STATE_FIELDS_MISSING', 'restart must preserve attempts, budgets, cooldown, lease, late-result law, and convergence deadline');
      }
    } else if (value.restartEvidence.preservedCampaignId !== false
      || value.restartEvidence.checkpointRef !== null
      || value.restartEvidence.stateDigestBeforeRestart !== null
      || value.restartEvidence.stateDigestAfterRestart !== null
      || value.restartEvidence.restoredCampaignId !== null
      || value.restartEvidence.stateBeforeRestart !== null
      || value.restartEvidence.stateAfterRestart !== null
      || (Array.isArray(value.restartEvidence.preservedFields) && value.restartEvidence.preservedFields.length !== 0)
      || value.restartEvidence.attemptCountBeforeRestart !== 0
      || value.restartEvidence.restoredAttemptCount !== 0
      || value.restartEvidence.remainingCostUnitsBeforeRestart !== 0
      || value.restartEvidence.remainingCostUnitsAfterRestart !== 0) {
      add(issues, '$.restartEvidence', 'UNEXPECTED_RESTART_STATE', 'non-restored campaign must use the exact neutral no-restart evidence state');
    }
  }
  if (typeof value.nextActuationRequested !== 'boolean' || typeof value.promotionClaimed !== 'boolean') add(issues, '$', 'BOOLEAN_FIELDS_REQUIRED', 'nextActuationRequested and promotionClaimed must be boolean');
  if (!Number.isSafeInteger(value.observedConcurrentActuations) || value.observedConcurrentActuations < 0) add(issues, '$.observedConcurrentActuations', 'NON_NEGATIVE_INTEGER_REQUIRED', 'non-negative safe integer required');
  if (value.dataAuthority !== 'SYNTHETIC_TEST') add(issues, '$.dataAuthority', 'DATA_AUTHORITY_INVALID', 'packet fixture evidence is SYNTHETIC_TEST only');
  if (value.effectAuthority !== 'NONE') add(issues, '$.effectAuthority', 'EFFECT_AUTHORITY_FORBIDDEN', 'packet evidence has no effect authority');
  return finish(issues);
}

function validateNullableMeasurement(issues, value, path, fields) {
  if (!exactKeys(issues, value, path, fields)) return;
  const numericFields = fields.filter((field) => field !== 'unknownReason');
  for (const field of numericFields) nonNegativeNumber(issues, value[field], `${path}.${field}`, { nullable: true });
  label(issues, value.unknownReason, `${path}.unknownReason`, { nullable: true });
  const numbers = numericFields.map((field) => value[field]);
  const allKnown = numbers.every((entry) => entry !== null);
  const allUnknown = numbers.every((entry) => entry === null);
  if (!allKnown && !allUnknown) add(issues, path, 'PARTIAL_NUMERIC_TRUTH_FORBIDDEN', 'numeric fields must be wholly known or wholly null');
  if (allUnknown && value.unknownReason === null) add(issues, `${path}.unknownReason`, 'UNKNOWN_REASON_REQUIRED', 'null numeric truth requires an exact reason');
  if (allKnown && value.unknownReason !== null) add(issues, `${path}.unknownReason`, 'UNKNOWN_REASON_CONFLICT', 'known numeric truth cannot carry unknown reason');
}

export function validateResourceEvidenceBundle(value) {
  const issues = [];
  if (!exactKeys(issues, value, '$', STABILITY_SCHEMAS.resourceEvidenceBundle.required)) return finish(issues);
  if (value.schemaVersion !== STABILITY_SCHEMA_VERSION) add(issues, '$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'unsupported schema version');
  label(issues, value.bundleId, '$.bundleId');
  if (!Array.isArray(value.rows)) add(issues, '$.rows', 'ARRAY_REQUIRED', 'resource rows required');
  else if (value.rows.length > RESOURCE_FAMILIES.length) add(issues, '$.rows', 'RESOURCE_DENOMINATOR_MISMATCH', `at most the exact ${RESOURCE_FAMILIES.length}-family denominator may be validated`);
  else if (hasSparseEntries(value.rows)) add(issues, '$.rows', 'SPARSE_ARRAY_FORBIDDEN', 'resource rows must be dense');
  else {
    const seenRowIds = new Set();
    value.rows.forEach((row, index) => {
    const path = `$.rows[${index}]`;
    const keys = ['rowId', 'resourceFamily', 'canonicalOwner', 'unit', 'windowMs', 'observedAtMs', 'maxAgeMs', 'provenance', 'truthLabel', 'burn', 'budget', 'forecast', 'topConsumers', 'throttling', 'circuit', 'canonicalResponse', 'protections'];
    if (!exactKeys(issues, row, path, keys)) return;
    for (const field of ['rowId', 'canonicalOwner', 'unit', 'provenance']) label(issues, row[field], `${path}.${field}`);
    if (seenRowIds.has(row.rowId)) add(issues, `${path}.rowId`, 'DUPLICATE_RESOURCE_ROW_ID', 'resource row IDs must be unique');
    seenRowIds.add(row.rowId);
    enumValue(issues, row.resourceFamily, `${path}.resourceFamily`, RESOURCE_FAMILIES);
    positiveInteger(issues, row.windowMs, `${path}.windowMs`);
    safeTime(issues, row.observedAtMs, `${path}.observedAtMs`);
    positiveInteger(issues, row.maxAgeMs, `${path}.maxAgeMs`);
    enumValue(issues, row.truthLabel, `${path}.truthLabel`, ['SYNTHETIC_ONLY', 'UNAVAILABLE']);
    validateNullableMeasurement(issues, row.burn, `${path}.burn`, ['value', 'unknownReason']);
    validateNullableMeasurement(issues, row.budget, `${path}.budget`, ['limit', 'remaining', 'unknownReason']);
    validateNullableMeasurement(issues, row.forecast, `${path}.forecast`, ['value', 'horizonMs', 'unknownReason']);
    if (row.truthLabel === 'UNAVAILABLE') {
      const numericValues = [row.burn?.value, row.budget?.limit, row.budget?.remaining, row.forecast?.value, row.forecast?.horizonMs];
      if (numericValues.some((entry) => entry !== null)) add(issues, path, 'UNAVAILABLE_TRUTH_CANNOT_HAVE_NUMBERS', 'UNAVAILABLE truth keeps all numeric values null');
    }
    if (isPlainRecord(row.budget)
      && row.budget.limit !== null && row.budget.remaining !== null
      && row.budget.remaining > row.budget.limit) {
      add(issues, `${path}.budget.remaining`, 'BUDGET_REMAINING_EXCEEDS_LIMIT', 'remaining budget cannot exceed the declared limit');
    }
    if (isPlainRecord(row.burn) && isPlainRecord(row.budget)
      && row.burn.value !== null && row.budget.limit !== null && row.budget.remaining !== null) {
      const expectedRemaining = Math.max(0, row.budget.limit - row.burn.value);
      if (Math.abs(expectedRemaining - row.budget.remaining) > Number.EPSILON) add(issues, `${path}.budget`, 'BUDGET_ACCOUNTING_INCONSISTENT', 'remaining budget must equal max(limit - current burn, 0)');
    }
    if (!Array.isArray(row.topConsumers)) add(issues, `${path}.topConsumers`, 'ARRAY_REQUIRED', 'top-consumer evidence array required');
    else if (row.topConsumers.length > STABILITY_STRUCTURE_LIMITS.topConsumersPerResource) add(issues, `${path}.topConsumers`, 'TOO_MANY_TOP_CONSUMERS', `at most ${STABILITY_STRUCTURE_LIMITS.topConsumersPerResource} top consumers allowed per resource`);
    else if (hasSparseEntries(row.topConsumers)) add(issues, `${path}.topConsumers`, 'SPARSE_ARRAY_FORBIDDEN', 'top-consumer evidence must be dense');
    else {
      const consumerIds = new Set();
      let knownConsumerTotal = 0;
      row.topConsumers.forEach((consumer, consumerIndex) => {
      const consumerPath = `${path}.topConsumers[${consumerIndex}]`;
      if (exactKeys(issues, consumer, consumerPath, ['consumerId', 'amount', 'unknownReason', 'evidenceRef'])) {
        label(issues, consumer.consumerId, `${consumerPath}.consumerId`);
        if (consumerIds.has(consumer.consumerId)) add(issues, `${consumerPath}.consumerId`, 'DUPLICATE_CONSUMER_ID', 'top-consumer IDs must be unique within a resource row');
        consumerIds.add(consumer.consumerId);
        nonNegativeNumber(issues, consumer.amount, `${consumerPath}.amount`, { nullable: true });
        label(issues, consumer.unknownReason, `${consumerPath}.unknownReason`, { nullable: true });
        label(issues, consumer.evidenceRef, `${consumerPath}.evidenceRef`, { nullable: true });
        if (consumer.amount === null && consumer.unknownReason === null) add(issues, `${consumerPath}.unknownReason`, 'UNKNOWN_REASON_REQUIRED', 'unknown consumer amount requires an exact blocker');
        if (consumer.amount === null && consumer.evidenceRef !== null) add(issues, `${consumerPath}.evidenceRef`, 'UNKNOWN_EVIDENCE_CONFLICT', 'unknown amount cannot carry affirmative evidence');
        if (consumer.amount !== null && (consumer.unknownReason !== null || consumer.evidenceRef === null)) add(issues, consumerPath, 'TOP_CONSUMER_EVIDENCE_REQUIRED', 'known consumer amount requires an evidence reference and no unknown reason');
        if (typeof consumer.amount === 'number' && Number.isFinite(consumer.amount)) knownConsumerTotal += consumer.amount;
      }
    });
      if (typeof row.burn?.value === 'number' && Number.isFinite(row.burn.value)
        && knownConsumerTotal - row.burn.value > Number.EPSILON) add(issues, `${path}.topConsumers`, 'TOP_CONSUMER_ATTRIBUTION_EXCEEDS_BURN', 'known top-consumer attribution cannot exceed known current burn');
    }
    if (exactKeys(issues, row.throttling, `${path}.throttling`, ['observed', 'observedAtMs', 'maxAgeMs', 'evidenceRef', 'unknownReason', 'canonicalOwner'])) {
      enumValue(issues, row.throttling.observed, `${path}.throttling.observed`, ['ACTIVE', 'INACTIVE', 'UNKNOWN']);
      safeTime(issues, row.throttling.observedAtMs, `${path}.throttling.observedAtMs`, { nullable: true });
      positiveInteger(issues, row.throttling.maxAgeMs, `${path}.throttling.maxAgeMs`);
      label(issues, row.throttling.evidenceRef, `${path}.throttling.evidenceRef`, { nullable: true });
      label(issues, row.throttling.unknownReason, `${path}.throttling.unknownReason`, { nullable: true });
      label(issues, row.throttling.canonicalOwner, `${path}.throttling.canonicalOwner`);
      if (row.throttling.observed === 'UNKNOWN' && row.throttling.unknownReason === null) add(issues, `${path}.throttling.unknownReason`, 'UNKNOWN_REASON_REQUIRED', 'unknown throttling requires an exact blocker');
      if (row.throttling.observed === 'UNKNOWN' && (row.throttling.observedAtMs !== null || row.throttling.evidenceRef !== null)) add(issues, `${path}.throttling`, 'UNKNOWN_EVIDENCE_CONFLICT', 'unknown throttling cannot carry affirmative observation evidence');
      if (row.throttling.observed !== 'UNKNOWN' && (row.throttling.observedAtMs === null || row.throttling.evidenceRef === null || row.throttling.unknownReason !== null)) add(issues, `${path}.throttling`, 'THROTTLING_EVIDENCE_REQUIRED', 'known throttling state requires owner observation time, evidence reference, and no unknown reason');
    }
    if (exactKeys(issues, row.circuit, `${path}.circuit`, ['state', 'canonicalOwner', 'ownerFailureDomain', 'observedAtMs', 'maxAgeMs', 'evidenceRef', 'unknownReason', 'baselineNeverOpenedEvidenceRef', 'baselineEvidenceOwner', 'baselineEvidenceFailureDomain', 'openedAtMs', 'halfOpenAtMs', 'closedAtMs', 'resetEligibleAtMs', 'independentCloseEvidenceRef', 'independentCloseOwner', 'independentCloseFailureDomain', 'mayCloseOrReset'])) {
      enumValue(issues, row.circuit.state, `${path}.circuit.state`, ['OPEN', 'HALF_OPEN', 'CLOSED', 'UNKNOWN']);
      label(issues, row.circuit.canonicalOwner, `${path}.circuit.canonicalOwner`);
      label(issues, row.circuit.ownerFailureDomain, `${path}.circuit.ownerFailureDomain`, { nullable: true });
      positiveInteger(issues, row.circuit.maxAgeMs, `${path}.circuit.maxAgeMs`);
      for (const field of ['observedAtMs', 'openedAtMs', 'halfOpenAtMs', 'closedAtMs', 'resetEligibleAtMs']) safeTime(issues, row.circuit[field], `${path}.circuit.${field}`, { nullable: true });
      label(issues, row.circuit.evidenceRef, `${path}.circuit.evidenceRef`, { nullable: true });
      label(issues, row.circuit.unknownReason, `${path}.circuit.unknownReason`, { nullable: true });
      label(issues, row.circuit.baselineNeverOpenedEvidenceRef, `${path}.circuit.baselineNeverOpenedEvidenceRef`, { nullable: true });
      label(issues, row.circuit.baselineEvidenceOwner, `${path}.circuit.baselineEvidenceOwner`, { nullable: true });
      label(issues, row.circuit.baselineEvidenceFailureDomain, `${path}.circuit.baselineEvidenceFailureDomain`, { nullable: true });
      label(issues, row.circuit.independentCloseEvidenceRef, `${path}.circuit.independentCloseEvidenceRef`, { nullable: true });
      label(issues, row.circuit.independentCloseOwner, `${path}.circuit.independentCloseOwner`, { nullable: true });
      label(issues, row.circuit.independentCloseFailureDomain, `${path}.circuit.independentCloseFailureDomain`, { nullable: true });
      if (row.circuit.mayCloseOrReset !== false) add(issues, `${path}.circuit.mayCloseOrReset`, 'CIRCUIT_AUTHORITY_FORBIDDEN', 'packet evidence cannot close or reset a circuit');
      if (row.circuit.canonicalOwner === row.canonicalOwner || row.circuit.ownerFailureDomain === row.canonicalOwner) add(issues, `${path}.circuit`, 'CIRCUIT_OWNER_INDEPENDENCE_REQUIRED', 'resource producer and circuit evidence must come from structurally distinct owners and failure domains');
      const baselineFields = [row.circuit.baselineNeverOpenedEvidenceRef, row.circuit.baselineEvidenceOwner, row.circuit.baselineEvidenceFailureDomain];
      const baselinePresent = baselineFields.some((entry) => entry !== null);
      const baselineComplete = baselineFields.every((entry) => entry !== null);
      if (row.circuit.state === 'UNKNOWN' && row.circuit.unknownReason === null) add(issues, `${path}.circuit.unknownReason`, 'UNKNOWN_REASON_REQUIRED', 'unknown circuit state requires an exact blocker');
      if (row.circuit.state === 'UNKNOWN' && (row.circuit.ownerFailureDomain !== null || row.circuit.observedAtMs !== null || row.circuit.evidenceRef !== null
        || row.circuit.openedAtMs !== null || row.circuit.halfOpenAtMs !== null || row.circuit.closedAtMs !== null
        || row.circuit.resetEligibleAtMs !== null || row.circuit.independentCloseEvidenceRef !== null
        || row.circuit.independentCloseOwner !== null || row.circuit.independentCloseFailureDomain !== null || baselinePresent)) add(issues, `${path}.circuit`, 'UNKNOWN_EVIDENCE_CONFLICT', 'unknown circuit state cannot carry affirmative observation, baseline, or transition evidence');
      if (row.circuit.state !== 'UNKNOWN' && (row.circuit.ownerFailureDomain === null || row.circuit.observedAtMs === null || row.circuit.evidenceRef === null || row.circuit.unknownReason !== null)) add(issues, `${path}.circuit`, 'CIRCUIT_EVIDENCE_REQUIRED', 'known circuit state requires owner failure domain, observation time, evidence reference, and no unknown reason');
      if (row.circuit.state === 'OPEN' && row.circuit.openedAtMs === null) add(issues, `${path}.circuit.openedAtMs`, 'OPEN_TRANSITION_EVIDENCE_REQUIRED', 'OPEN circuit requires its observed open transition time');
      if (row.circuit.state === 'OPEN' && (row.circuit.halfOpenAtMs !== null || row.circuit.closedAtMs !== null || row.circuit.resetEligibleAtMs !== null || row.circuit.independentCloseEvidenceRef !== null || row.circuit.independentCloseOwner !== null || row.circuit.independentCloseFailureDomain !== null)) add(issues, `${path}.circuit`, 'OPEN_STATE_TRANSITION_CONFLICT', 'OPEN circuit cannot carry half-open, reset-eligible, or close evidence');
      if (row.circuit.state === 'HALF_OPEN' && (row.circuit.openedAtMs === null || row.circuit.halfOpenAtMs === null || row.circuit.halfOpenAtMs < row.circuit.openedAtMs)) add(issues, `${path}.circuit`, 'HALF_OPEN_SEQUENCE_INVALID', 'half-open evidence requires an ordered prior open transition');
      if (row.circuit.state === 'HALF_OPEN' && (row.circuit.closedAtMs !== null || row.circuit.independentCloseEvidenceRef !== null || row.circuit.independentCloseOwner !== null || row.circuit.independentCloseFailureDomain !== null)) add(issues, `${path}.circuit`, 'HALF_OPEN_CLOSE_CONFLICT', 'HALF_OPEN circuit cannot carry close evidence');
      if (row.circuit.state === 'HALF_OPEN' && row.circuit.resetEligibleAtMs !== null && row.circuit.resetEligibleAtMs < row.circuit.halfOpenAtMs) add(issues, `${path}.circuit.resetEligibleAtMs`, 'RESET_ELIGIBILITY_SEQUENCE_INVALID', 'reset eligibility cannot precede HALF_OPEN');
      if (row.circuit.observedAtMs !== null && [row.circuit.openedAtMs, row.circuit.halfOpenAtMs, row.circuit.resetEligibleAtMs, row.circuit.closedAtMs].some((time) => time !== null && time > row.circuit.observedAtMs)) add(issues, `${path}.circuit`, 'CIRCUIT_TRANSITION_AFTER_OBSERVATION', 'circuit transitions cannot follow the owner observation');
      const priorOpen = [row.circuit.openedAtMs, row.circuit.halfOpenAtMs, row.circuit.closedAtMs, row.circuit.resetEligibleAtMs, row.circuit.independentCloseEvidenceRef, row.circuit.independentCloseOwner, row.circuit.independentCloseFailureDomain].some((entry) => entry !== null);
      if (row.circuit.state !== 'CLOSED' && baselinePresent) add(issues, `${path}.circuit`, 'BASELINE_CLOSED_EVIDENCE_CONFLICT', 'baseline-never-open evidence is valid only for a CLOSED circuit');
      if (row.circuit.state === 'CLOSED' && priorOpen && baselinePresent) add(issues, `${path}.circuit`, 'BASELINE_AND_TRANSITION_PROOF_CONFLICT', 'CLOSED circuit uses either baseline-never-open proof or a full close transition, never both');
      if (row.circuit.state === 'CLOSED' && !priorOpen
        && (!baselineComplete
          || row.circuit.baselineNeverOpenedEvidenceRef === row.circuit.evidenceRef
          || row.circuit.baselineEvidenceOwner === row.circuit.canonicalOwner
          || row.circuit.baselineEvidenceOwner === row.canonicalOwner
          || row.circuit.baselineEvidenceFailureDomain === row.circuit.ownerFailureDomain
          || row.circuit.baselineEvidenceFailureDomain === row.canonicalOwner)) {
        add(issues, `${path}.circuit`, 'INDEPENDENT_CIRCUIT_BASELINE_EVIDENCE_REQUIRED', 'a never-open CLOSED baseline requires complete structurally independent reference, owner, and failure-domain evidence');
      }
      if (row.circuit.state === 'CLOSED' && priorOpen
        && (row.circuit.openedAtMs === null || row.circuit.halfOpenAtMs === null || row.circuit.closedAtMs === null
          || row.circuit.resetEligibleAtMs === null || row.circuit.independentCloseEvidenceRef === null
          || row.circuit.independentCloseOwner === null || row.circuit.independentCloseFailureDomain === null
          || row.circuit.halfOpenAtMs < row.circuit.openedAtMs
          || row.circuit.resetEligibleAtMs < row.circuit.halfOpenAtMs
          || row.circuit.closedAtMs < row.circuit.resetEligibleAtMs)) add(issues, `${path}.circuit`, 'INDEPENDENT_CIRCUIT_CLOSE_EVIDENCE_REQUIRED', 'closing a previously open circuit requires fully ordered OPEN, HALF_OPEN, reset-eligible, CLOSED, and structurally independent evidence');
      if (row.circuit.state === 'CLOSED' && priorOpen
        && (row.circuit.independentCloseEvidenceRef === row.circuit.evidenceRef
          || row.circuit.independentCloseOwner === row.circuit.canonicalOwner
          || row.circuit.independentCloseOwner === row.canonicalOwner
          || row.circuit.independentCloseFailureDomain === row.circuit.ownerFailureDomain)) add(issues, `${path}.circuit.independentCloseEvidenceRef`, 'COMMON_MODE_CIRCUIT_CLOSE_FORBIDDEN', 'circuit-close evidence must differ by reference, owner, and failure domain from owner state evidence');
    }
    if (exactKeys(issues, row.canonicalResponse, `${path}.canonicalResponse`, ['kind', 'referenceId', 'owner', 'wiringState', 'unknownReason'])) {
      enumValue(issues, row.canonicalResponse.kind, `${path}.canonicalResponse.kind`, ['OWNER_ACTION_REFERENCE', 'RECOMMENDATION', 'NONE', 'UNKNOWN']);
      label(issues, row.canonicalResponse.referenceId, `${path}.canonicalResponse.referenceId`, { nullable: true });
      label(issues, row.canonicalResponse.owner, `${path}.canonicalResponse.owner`);
      label(issues, row.canonicalResponse.unknownReason, `${path}.canonicalResponse.unknownReason`, { nullable: true });
      enumValue(issues, row.canonicalResponse.wiringState, `${path}.canonicalResponse.wiringState`, ['DRAFT_INSERTION_REQUEST', 'OWNER_GATED', 'UNAVAILABLE']);
      if (['OWNER_ACTION_REFERENCE', 'RECOMMENDATION'].includes(row.canonicalResponse.kind)
        && (row.canonicalResponse.referenceId === null || row.canonicalResponse.unknownReason !== null)) {
        add(issues, `${path}.canonicalResponse`, 'CANONICAL_RESPONSE_REFERENCE_REQUIRED', 'action references and recommendations require an exact reference and no unknown reason');
      }
      if (row.canonicalResponse.kind === 'UNKNOWN' && (row.canonicalResponse.referenceId !== null || row.canonicalResponse.unknownReason === null)) add(issues, `${path}.canonicalResponse`, 'UNKNOWN_RESPONSE_EVIDENCE_CONFLICT', 'unknown canonical response requires no affirmative reference and an exact blocker');
      if (row.canonicalResponse.kind === 'NONE' && (row.canonicalResponse.referenceId !== null || row.canonicalResponse.unknownReason !== null)) add(issues, `${path}.canonicalResponse`, 'NONE_RESPONSE_EVIDENCE_CONFLICT', 'NONE response carries neither an action reference nor an unknown reason');
      if (row.canonicalResponse.wiringState === 'UNAVAILABLE' && row.canonicalResponse.kind !== 'UNKNOWN') add(issues, `${path}.canonicalResponse`, 'UNAVAILABLE_RESPONSE_MUST_BE_UNKNOWN', 'UNAVAILABLE response wiring cannot carry an affirmative action or recommendation');
      if (row.canonicalResponse.kind === 'UNKNOWN' && row.canonicalResponse.wiringState !== 'UNAVAILABLE') add(issues, `${path}.canonicalResponse`, 'UNKNOWN_RESPONSE_WIRING_CONFLICT', 'UNKNOWN response must expose UNAVAILABLE wiring');
      const numericAttention = row.burn?.value === null
        || row.budget?.limit === null
        || row.budget?.remaining === null
        || row.forecast?.value === null
        || (typeof row.burn?.value === 'number' && typeof row.budget?.limit === 'number'
          && row.burn.value >= row.budget.limit)
        || row.budget?.remaining === 0
        || (typeof row.forecast?.value === 'number' && typeof row.budget?.remaining === 'number'
          && row.forecast.value >= row.budget.remaining);
      const consumerAttention = Array.isArray(row.topConsumers)
        && (row.topConsumers.length === 0 || row.topConsumers.some((consumer) => consumer?.amount === null));
      const protectionAttention = isPlainRecord(row.protections)
        && Object.values(row.protections).some((result) => result !== 'PASS');
      const staticAttention = row.truthLabel === 'UNAVAILABLE'
        || numericAttention
        || consumerAttention
        || row.throttling?.observed === 'UNKNOWN'
        || row.circuit?.state !== 'CLOSED'
        || protectionAttention;
      if (staticAttention && row.canonicalResponse.kind === 'NONE') {
        add(issues, `${path}.canonicalResponse`, 'ATTENTION_RESPONSE_REQUIRED', 'resource attention requires an owner action reference, recommendation, or an honest UNKNOWN and UNAVAILABLE blocker');
      }
    }
    if (exactKeys(issues, row.protections, `${path}.protections`, ['materialMoneyEvidencePreserved', 'auditEvidencePreserved', 'safeRiskReductionUnblocked'])) {
      for (const field of ['materialMoneyEvidencePreserved', 'auditEvidencePreserved', 'safeRiskReductionUnblocked']) enumValue(issues, row.protections[field], `${path}.protections.${field}`, ASSURANCE_RESULTS);
    }
    });
  }
  stringArray(issues, value.loadSheddingOrder, '$.loadSheddingOrder', { nonEmpty: true });
  if (value.dataAuthority !== 'SYNTHETIC_TEST') add(issues, '$.dataAuthority', 'DATA_AUTHORITY_INVALID', 'packet fixture evidence is SYNTHETIC_TEST only');
  if (exactKeys(issues, value.effectBoundary, '$.effectBoundary', ['mayThrottle', 'mayExecute', 'mayCloseOrResetCircuit', 'controllerOwner'])) {
    if (value.effectBoundary.mayThrottle !== false || value.effectBoundary.mayExecute !== false
      || value.effectBoundary.mayCloseOrResetCircuit !== false || value.effectBoundary.controllerOwner !== null) {
      add(issues, '$.effectBoundary', 'AUTHORITY_FORBIDDEN', 'resource evidence must have no throttling, execution, circuit, or controller authority');
    }
  }
  const families = Array.isArray(value.rows) && value.rows.length <= RESOURCE_FAMILIES.length
    ? value.rows.map((row) => row?.resourceFamily)
    : [];
  if (families.length !== RESOURCE_FAMILIES.length || new Set(families).size !== RESOURCE_FAMILIES.length || RESOURCE_FAMILIES.some((family) => !families.includes(family))) {
    add(issues, '$.rows', 'RESOURCE_DENOMINATOR_MISMATCH', `exact families required: ${RESOURCE_FAMILIES.join('|')}`);
  }
  if (Array.isArray(value.loadSheddingOrder)) {
    const acceptedSheddingClasses = [...OPTIONAL_SHEDDING_CLASSES, ...PROTECTED_WORK_CLASSES];
    if (value.loadSheddingOrder.length !== acceptedSheddingClasses.length
      || (value.loadSheddingOrder.length === acceptedSheddingClasses.length
        && (new Set(value.loadSheddingOrder).size !== acceptedSheddingClasses.length
          || value.loadSheddingOrder.some((entry) => !acceptedSheddingClasses.includes(entry))))) {
      add(issues, '$.loadSheddingOrder', 'SHEDDING_DENOMINATOR_MISMATCH', 'load-shedding order must contain exactly the accepted optional and protected work classes');
    }
    if (value.loadSheddingOrder.length !== acceptedSheddingClasses.length) return finish(issues);
    const optionalIndexes = OPTIONAL_SHEDDING_CLASSES.map((entry) => value.loadSheddingOrder.indexOf(entry));
    const protectedIndexes = PROTECTED_WORK_CLASSES.map((entry) => value.loadSheddingOrder.indexOf(entry));
    if ([...optionalIndexes, ...protectedIndexes].some((index) => index < 0)) {
      add(issues, '$.loadSheddingOrder', 'SHEDDING_CLASS_MISSING', 'all optional and protected work classes must be present');
    } else if (Math.max(...optionalIndexes) >= Math.min(...protectedIndexes)) {
      add(issues, '$.loadSheddingOrder', 'SHEDDING_PRIORITY_INVERTED', 'all optional work must shed before protected truth and risk-reduction work');
    }
  }
  return finish(issues);
}
