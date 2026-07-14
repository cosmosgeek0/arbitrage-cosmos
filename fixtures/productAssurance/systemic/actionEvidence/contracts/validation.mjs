import {
  ACTION_EVIDENCE_ASSERTIONS,
  ACTION_EVIDENCE_AUTHORITY_EFFECT,
  ACTION_EVIDENCE_CLASSES,
  ACTION_EVIDENCE_FAMILIES,
  ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA_VERSION,
  ACTION_EVIDENCE_LIMITS,
  ACTION_EVIDENCE_RESULT_SCHEMA_VERSION,
  ACTION_EVIDENCE_SCHEMA_VERSION,
  ACTION_EVIDENCE_STATUSES,
  ACTION_EVIDENCE_TRUTH_LABEL,
  ACTION_EVIDENCE_USE_CLASS,
  ACTION_FACT_FIELDS,
  ACTION_IDENTITY_FIELDS,
  CANONICAL_OWNER_REFERENCE_IDS,
  CANONICAL_DECISION_OWNER_IDS_BY_CLASS,
  EVIDENCE_REASON_CODES,
  EVIDENCE_REASON_CODES_BY_ASSERTION,
  EVIDENCE_SOURCE_ROLES_BY_CLASS,
  EVIDENCE_SOURCE_ROLES,
  FROZEN_ACTION_BINDINGS,
  FROZEN_AUTHORITY_MAP_COMMIT,
  FROZEN_CORE_COMMIT,
  FROZEN_HAZARD_COMMIT,
  FROZEN_L_COMMIT,
  FROZEN_POLICY_REVISIONS,
  INVALIDATION_REASON_CODES,
  REQUIRED_EVIDENCE_DEPENDENCY_FAMILIES,
  REQUIRED_EVIDENCE_FAMILIES,
  evidenceSourceOwnerFor,
  deepFreeze,
} from './schema.mjs';
import { sha256Hex } from './digest.mjs';
import {
  frozenControlActionMaterial,
  frozenPolicyActionMaterial,
} from './internal-binding.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/u;
const CODE = /^[A-Z][A-Z0-9_]{0,99}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OWNER_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const POLICY_ACTION_ID = /^epact_[a-f0-9]{64}$/u;
const POLICY_ACTION_REVISION = /^epactrev_[a-f0-9]{64}$/u;
const COMMAND_ID = /^cmd_[a-f0-9]{16,64}$/u;
const FROZEN_TEXT_ID = /^[A-Za-z][A-Za-z0-9._:-]{2,255}$/u;
const FROZEN_SYMBOL = /^(?=.{2,40}$)[A-Z0-9._-]+$/u;
const CONTROL_REVISION = /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTC_MIN = 1_262_304_000_000;
const UTC_MAX = 4_102_444_800_000;

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'approved',
  'accepted',
  'admitted',
  'isApproved',
  'authorized',
  'isAuthorized',
  'authorization',
  'authorizationToken',
  'executionAuthorized',
  'allow',
  'allowed',
  'block',
  'blocked',
  'rank',
  'ranking',
  'score',
  'priority',
  'selected',
  'decision',
  'decisionOutcome',
  'command',
  'execute',
  'sendEligible',
  'tradeReady',
  'machineReady',
  'readiness',
]);

const SECRET_LIKE_KEYS = /^(api[_-]?key|secret|private[_-]?key|password|credential|signature|bearer[_-]?token)$/iu;

const ENVELOPE_KEYS = [
  'authorityEffect', 'record', 'revision', 'schemaVersion', 'sourceCommits',
  'truthLabel', 'useClass',
];
const FIXTURE_BUNDLE_KEYS = ['authorityEffect', 'envelopes', 'schemaVersion', 'truthLabel', 'useClass'];
const SOURCE_COMMIT_KEYS = ['coreScaffold', 'frozenL', 'hazardContracts'];
const RECORD_KEYS = [
  'actionBinding', 'actionClass', 'actionFacts', 'actionReference', 'activeAssumptions',
  'createdAtMs', 'expiresAtMs', 'families', 'fencingContext', 'identity',
  'invalidations', 'invariantResults', 'maximumAgeMs', 'ownerReferences', 'recordId',
  'scenarioEnvelope', 'subjectDigest', 'temporalContext', 'versions',
];
const VERSION_KEYS = [
  'authorityMapCommit', 'modelRevision', 'ownerContractCommit', 'policyRevision',
  'releaseId', 'schemaRevision',
];
const TEMPORAL_KEYS = [
  'duplicateDisposition', 'futureDisposition', 'joinPolicy', 'lateDisposition',
  'maximumPairwiseSkewMs', 'maximumReferenceAgeMs', 'referenceTimeMs',
  'reorderedDisposition', 'sources', 'watermarkMs',
];
const TEMPORAL_SOURCE_KEYS = [
  'accountRealmId', 'availableAtMs', 'clockQuality', 'componentId', 'eventAtMs',
  'evidenceId', 'expiresAtMs', 'maximumAgeMs', 'processedAtMs', 'product',
  'receivedAtMs', 'sequenceGap', 'sequenceId', 'snapshotId', 'sourceId',
  'symbol', 'venue',
];
const FENCING_KEYS = ['epoch', 'leaseExpiresAtMs', 'ownerEvidenceId', 'relevant'];
const EVIDENCE_REFERENCE_KEYS = [
  'digest', 'expiresAtMs', 'maximumAgeMs', 'observedAtMs', 'ownerId',
  'referenceId', 'revision', 'sourceRole',
];
const OWNER_DECISION_REFERENCE_KEYS = [...EVIDENCE_REFERENCE_KEYS, 'binding'];
const OWNER_DECISION_BINDING_KEYS = [
  'authorityMapCommit', 'policyRevision', 'releaseId', 'subjectDigest',
];
const SCENARIO_KEYS = [
  'bounded', 'disturbanceIds', 'excludedStateIds', 'maximumExposure',
  'maximumLiability', 'maximumRecoveryCost', 'rateLimitHeadroomKnown', 'scenarioId',
  'timeHeadroomMs',
];
const FAMILY_KEYS = [
  'assertion', 'dependencyEvidenceIds', 'evidenceIds', 'expiresAtMs', 'family',
  'maximumAgeMs', 'producedAtMs', 'producedBy', 'reasonCodes', 'verifiedAtMs',
  'verifiedBy', 'sourceRefs',
];
const ACTOR_KEYS = ['actorId', 'independenceDomainId', 'ownerId', 'role'];
const INVALIDATION_KEYS = [
  'evidenceId', 'invalidatedAtMs', 'invalidationId', 'producerEvidenceId', 'reasonCode',
];
const ASSUMPTION_KEYS = [
  'assumptionId', 'evidenceIds', 'expiresAtMs', 'maximumAgeMs', 'observedAtMs',
  'revision', 'state',
];
const INVARIANT_RESULT_KEYS = [
  'evaluatedAtMs', 'evidenceIds', 'expiresAtMs', 'invariantId', 'maximumAgeMs',
  'revision', 'status',
];
const RESULT_KEYS = [
  'actionClass', 'assumptionResults', 'authorityEffect',
  'canonicalRiskReductionUnaffected', 'commandsIssued', 'evaluatedAtMs',
  'familyResults', 'invalidatedEvidenceIds', 'invariantResults',
  'nextCurrentnessBoundaryAtMs', 'reasonCodes', 'recordId', 'schemaVersion',
  'status', 'truthLabel', 'useClass',
];
const FAMILY_RESULT_KEYS = [
  'dependencyEvidenceIds', 'evidenceIds', 'expiresAtMs', 'family',
  'invalidationIds', 'reasonCodes', 'status',
];
const ASSUMPTION_RESULT_KEYS = [
  'assumptionId', 'evidenceIds', 'expiresAtMs', 'invalidationIds', 'reasonCodes',
  'status',
];
const INVARIANT_EVALUATION_RESULT_KEYS = [
  'evidenceIds', 'expiresAtMs', 'invalidationIds', 'invariantId', 'reasonCodes',
  'status',
];

const RESULT_PASS_REASON_CODES = new Set([
  'ASSUMPTION_PASS',
  'CURRENT_SYNTHETIC_FIXTURE',
  'EVIDENCE_SATISFIED',
  'INVARIANT_PASS',
]);
const RESULT_FAIL_REASON_CODES = new Set([
  'ASSUMPTION_DEPENDENCY_FAILED',
  'ASSUMPTION_FAIL',
  'CANCELLATION_TARGET_FILLED',
  'EVIDENCE_CONTRADICTED',
  'EVIDENCE_DEPENDENCY_FAILED',
  'FENCING_LEASE_LOST',
  'HALT_READBACK_NOT_HALTED',
  'INVARIANT_DEPENDENCY_FAILED',
  'INVARIANT_FAIL',
  'LATE_FILL_AFTER_CANCEL_TIMEOUT',
  'LEASE_LOST_BEFORE_ACKNOWLEDGEMENT',
  'OWNER_REGISTERED_FALLBACK_MISSING',
  'PARTIAL_FILL_RECOVERY_RATE_LIMITED',
  'PREVIOUS_BINDING_CONTRADICTION',
  'PRODUCER_VERIFIER_NOT_INDEPENDENT',
  'RECOVERY_NOT_EXECUTION_BOUND',
  'RECOVERY_RECOMMENDATION_AUTOMATION_FORBIDDEN',
  'REPAIR_POSTCONDITION_NOT_RECONCILED',
]);
const RESULT_UNKNOWN_REASON_CODES = new Set([
  'ACTION_FACTS_NOT_YET_VALID',
  'ACTION_REFERENCE_EXPIRED',
  'ACTION_REFERENCE_NOT_YET_VALID',
  'ACTION_REFERENCE_STALE',
  'ASSUMPTION_DEPENDENCY_UNKNOWN',
  'ASSUMPTION_EVIDENCE_INVALIDATED',
  'ASSUMPTION_EXPIRED',
  'ASSUMPTION_NOT_YET_VALID',
  'ASSUMPTION_STALE',
  'ASSUMPTION_UNKNOWN',
  'CANCEL_PENDING_NOT_TERMINAL',
  'EVIDENCE_DEPENDENCY_CYCLE',
  'EVIDENCE_DEPENDENCY_UNKNOWN',
  'EVIDENCE_EXPIRED',
  'EVIDENCE_INVALIDATED',
  'EVIDENCE_NOT_YET_VALID',
  'EVIDENCE_STALE',
  'EVIDENCE_TIMELINE_INCOHERENT',
  'EVIDENCE_UNRESOLVED',
  'FENCING_LEASE_EXPIRED',
  'FENCING_LEASE_UNKNOWN',
  'HALT_READBACK_EXPIRED',
  'HALT_READBACK_NOT_YET_VALID',
  'HALT_READBACK_UNKNOWN',
  'HALT_RECEIPT_UNKNOWN',
  'INDEPENDENT_VERIFIER_MISSING',
  'INVARIANT_DEPENDENCY_UNKNOWN',
  'INVARIANT_EVIDENCE_INVALIDATED',
  'INVARIANT_EXPIRED',
  'INVARIANT_NOT_YET_VALID',
  'INVARIANT_STALE',
  'INVARIANT_UNKNOWN',
  'LATE_RESULT_UNKNOWN',
  'LEASE_LOST_AFTER_ACKNOWLEDGEMENT',
  'OWNER_DECISION_REFERENCE_POLICY_MISMATCH',
  'OWNER_DECISION_REFERENCE_STALE',
  'OWNER_DECISION_REFERENCE_SUBJECT_MISMATCH',
  'OWNER_DECISION_REFERENCE_UNKNOWN',
  'OWNER_REFERENCE_EXPIRED',
  'OWNER_REFERENCE_NOT_YET_VALID',
  'OWNER_REFERENCE_STALE',
  'OWNER_TRUTH_CHANGED_AFTER_PROPOSAL',
  'OWNER_TRUTH_UNKNOWN',
  'PARTIAL_FILL_STATE_UNKNOWN',
  'PRODUCER_VERIFIER_INDEPENDENCE_UNPROVEN',
  'RECORD_EXPIRED',
  'RECORD_STALE',
  'RECOVERY_EXECUTION_BINDING_UNKNOWN',
  'RECOVERY_HEADROOM_UNKNOWN',
  'RECOVERY_PATH_EXPIRED',
  'RECOVERY_PATH_UNKNOWN',
  'RECOVERY_RATE_LIMIT_UNKNOWN',
  'REPAIR_POSTCONDITION_EXPIRED',
  'REPAIR_POSTCONDITION_NOT_YET_VALID',
  'REPAIR_POSTCONDITION_UNKNOWN',
  'REPAIR_RECEIPT_UNKNOWN',
  'SCENARIO_TIME_HEADROOM_EXHAUSTED',
  'SOURCE_REFERENCE_EXPIRED',
  'SOURCE_REFERENCE_NOT_YET_VALID',
  'SOURCE_REFERENCE_STALE',
  'TEMPORAL_CLOCK_UNBOUNDED',
  'TEMPORAL_REFERENCE_STALE',
  'TEMPORAL_SEQUENCE_GAP',
  'TEMPORAL_SKEW_EXCEEDED',
  'TEMPORAL_SOURCE_EXPIRED',
  'TEMPORAL_SOURCE_NOT_YET_VALID',
  'TEMPORAL_SOURCE_STALE',
  'TEMPORAL_TIMELINE_INCOHERENT',
  'UNKNOWN_UNBOUNDED',
  'VERIFICATION_INCOMPLETE',
]);
const RESULT_REASON_CODES = new Set([
  ...RESULT_PASS_REASON_CODES,
  ...RESULT_FAIL_REASON_CODES,
  ...RESULT_UNKNOWN_REASON_CODES,
]);


export function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function snapshotPlainData(value) {
  const budget = { nodes: 0 };
  const fail = (code, message) => {
    const error = new TypeError(message);
    error.code = code;
    throw error;
  };
  const clone = (current, ancestors = new Set(), depth = 0) => {
    budget.nodes += 1;
    if (budget.nodes > 100_000 || depth > ACTION_EVIDENCE_LIMITS.maxNestingDepth) fail('NESTING_DEPTH_EXCEEDED', 'bounded plain-data snapshot exceeded');
    if (current === null || ['string', 'boolean'].includes(typeof current)) return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current !== 'object') fail('NON_JSON_VALUE_FORBIDDEN', 'non-JSON snapshot input');
    if (ancestors.has(current)) fail('CYCLIC_DATA_FORBIDDEN', 'cyclic snapshot input');
    let prototype;
    let descriptors;
    let keys;
    try {
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current);
      keys = Reflect.ownKeys(descriptors);
    } catch {
      fail('REFLECTION_FAILURE', 'snapshot reflection failed');
    }
    const next = new Set(ancestors);
    next.add(current);
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) fail('PLAIN_DATA_REQUIRED', 'array snapshot prototype is invalid');
      if (keys.some((key) => typeof key !== 'string')) fail('ARRAY_PROPERTY_FORBIDDEN', 'array symbol properties are forbidden');
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) fail('ARRAY_PROPERTY_FORBIDDEN', 'array length is invalid');
      const result = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) fail('SPARSE_ARRAY_FORBIDDEN', 'sparse arrays are forbidden');
        if (!descriptor.enumerable) fail('NON_ENUMERABLE_PROPERTY_FORBIDDEN', 'array entries must be enumerable');
        if (!Object.hasOwn(descriptor, 'value')) fail('ACCESSOR_PROPERTY_FORBIDDEN', 'array accessors are forbidden');
        result.push(clone(descriptor.value, next, depth + 1));
      }
      if (keys.length !== lengthDescriptor.value + 1) fail('ARRAY_PROPERTY_FORBIDDEN', 'decorated arrays are forbidden');
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null
      || keys.some((key) => typeof key !== 'string')) fail('PLAIN_DATA_REQUIRED', 'record snapshot shape is invalid');
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable) fail('NON_ENUMERABLE_PROPERTY_FORBIDDEN', 'record fields must be enumerable');
      if (!Object.hasOwn(descriptor, 'value')) fail('ACCESSOR_PROPERTY_FORBIDDEN', 'record accessors are forbidden');
      result[key] = clone(descriptor.value, next, depth + 1);
    }
    return result;
  };
  try {
    return { ok: true, value: deepFreeze(clone(value)) };
  } catch (error) {
    return {
      ok: false,
      value: null,
      issueCode: typeof error?.code === 'string' ? error.code : 'PLAIN_DATA_SNAPSHOT_FAILED',
    };
  }
}

export function canonicalStringify(value, ancestors = new Set(), depth = 0) {
  if (depth > ACTION_EVIDENCE_LIMITS.maxNestingDepth) return JSON.stringify('[NON_JSON_DEPTH_EXCEEDED]');
  if (Array.isArray(value) || isPlainRecord(value)) {
    if (ancestors.has(value)) return JSON.stringify(`[NON_JSON_CYCLE:${typeof value}]`);
    const next = new Set(ancestors);
    next.add(value);
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalStringify(entry, next, depth + 1)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalStringify(value[key], next, depth + 1)}`
    )).join(',')}}`;
  }
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  return JSON.stringify(`[NON_JSON_VALUE:${typeof value}]`);
}

function hasExactKeys(value, expected) {
  return isPlainRecord(value)
    && Object.keys(value).sort().join('\n') === [...expected].sort().join('\n');
}

function isUtcMs(value) {
  return Number.isSafeInteger(value) && value >= UTC_MIN && value <= UTC_MAX;
}

function isNullableUtcMs(value) {
  return value === null || isUtcMs(value);
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isId(value) {
  return typeof value === 'string' && ID.test(value);
}

function isNullableId(value) {
  return value === null || isId(value);
}

function isDigest(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function isReferenceDigest(value) {
  return typeof value === 'string' && (SHA256.test(value) || OWNER_SHA256.test(value));
}

function isNullableCanonicalPolicyDecimal(value) {
  return value === null || (typeof value === 'string'
    && value.replace('.', '').length <= 72
    && /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value));
}

function isPositiveCanonicalPolicyDecimal(value) {
  return isNullableCanonicalPolicyDecimal(value) && value !== null && value !== '0';
}

function isNullableNonNegativeDecimal(value) {
  return value === null || (typeof value === 'string'
    && value.length <= ACTION_EVIDENCE_LIMITS.maxText
    && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value));
}

function uniqueIds(values, maximum = ACTION_EVIDENCE_LIMITS.maxIdsPerList) {
  return Array.isArray(values)
    && values.length <= maximum
    && values.every(isId)
    && new Set(values).size === values.length;
}

function issue(issues, code, path, message) {
  issues.push(Object.freeze({ code, path, message }));
}

const STRUCTURAL_SCAN_ISSUES = new Set([
  'ACCESSOR_PROPERTY_FORBIDDEN',
  'CYCLIC_DATA_FORBIDDEN',
  'ARRAY_PROPERTY_FORBIDDEN',
  'NESTING_DEPTH_EXCEEDED',
  'NON_ENUMERABLE_PROPERTY_FORBIDDEN',
  'NON_JSON_VALUE_FORBIDDEN',
  'PLAIN_DATA_REQUIRED',
  'REFLECTION_FAILURE',
  'SPARSE_ARRAY_FORBIDDEN',
  'SYMBOL_PROPERTY_FORBIDDEN',
]);

function validationResult(issues) {
  const sorted = issues.sort((left, right) => (
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
  ));
  return deepFreeze({ valid: sorted.length === 0, issues: sorted });
}

function validateResultReasonStatus(status, reasonCodes, path, issues) {
  if (!Array.isArray(reasonCodes)) return;
  if (reasonCodes.some((reason) => !RESULT_REASON_CODES.has(reason))) {
    issue(issues, 'RESULT_REASON_CODE_UNSUPPORTED', path, 'complete result reasons must come from the finite derived-result vocabulary');
    return;
  }
  const hasFail = reasonCodes.some((reason) => RESULT_FAIL_REASON_CODES.has(reason));
  const hasUnknown = reasonCodes.some((reason) => RESULT_UNKNOWN_REASON_CODES.has(reason));
  const hasPass = reasonCodes.some((reason) => RESULT_PASS_REASON_CODES.has(reason));
  if ((status === 'PASS' && reasonCodes.some((reason) => !RESULT_PASS_REASON_CODES.has(reason)))
    || (status === 'UNKNOWN' && (hasFail || hasPass || !hasUnknown))
    || (status === 'FAIL' && (hasPass || !hasFail))) {
    issue(issues, 'RESULT_REASON_STATUS_MISMATCH', path, 'result reasons must be coherent with PASS, FAIL, or UNKNOWN status');
  }
}

function scanForbiddenKeys(value, path, issues, ancestors = new Set(), depth = 0) {
  if (depth > ACTION_EVIDENCE_LIMITS.maxNestingDepth) {
    issue(issues, 'NESTING_DEPTH_EXCEEDED', path, 'action evidence nesting exceeds the bounded depth');
    return;
  }
  if (value === null || ['string', 'boolean'].includes(typeof value)
    || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object') {
    issue(issues, 'NON_JSON_VALUE_FORBIDDEN', path, 'action evidence accepts finite JSON data only');
    return;
  }
  if (ancestors.has(value)) {
    issue(issues, 'CYCLIC_DATA_FORBIDDEN', path, 'cyclic action evidence is not JSON and is forbidden');
    return;
  }
  const next = new Set(ancestors);
  next.add(value);
  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    issue(issues, 'REFLECTION_FAILURE', path, 'action evidence must expose stable plain-data properties');
    return;
  }
  if (Array.isArray(value)) {
    const stringKeys = ownKeys.filter((key) => typeof key === 'string');
    const extraKeys = stringKeys.filter((key) => (
      key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)
    ));
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      issue(issues, 'ARRAY_PROPERTY_FORBIDDEN', path, 'symbol properties are forbidden on evidence arrays');
    }
    for (const key of extraKeys) {
      issue(issues, 'ARRAY_PROPERTY_FORBIDDEN', `${path}.${key}`, 'non-index properties are forbidden on evidence arrays');
      if (FORBIDDEN_AUTHORITY_KEYS.has(key)) issue(issues, 'AUTHORITY_FIELD_FORBIDDEN', `${path}.${key}`, 'authority fields are forbidden on evidence arrays');
      if (SECRET_LIKE_KEYS.test(key)) issue(issues, 'SECRET_FIELD_FORBIDDEN', `${path}.${key}`, 'secret-like fields are forbidden on evidence arrays');
    }
    const indexKeys = new Set(stringKeys.filter((key) => /^(?:0|[1-9][0-9]*)$/u.test(key)));
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      if (!indexKeys.has(key)) {
        issue(issues, 'SPARSE_ARRAY_FORBIDDEN', `${path}[${index}]`, 'sparse arrays are not canonical JSON evidence');
      } else {
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          issue(issues, 'REFLECTION_FAILURE', `${path}[${index}]`, 'array entries must expose stable plain-data descriptors');
          continue;
        }
        if (!descriptor?.enumerable) issue(issues, 'NON_ENUMERABLE_PROPERTY_FORBIDDEN', `${path}[${index}]`, 'non-enumerable array entries are not canonical JSON evidence');
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          issue(issues, 'ACCESSOR_PROPERTY_FORBIDDEN', `${path}[${index}]`, 'accessor properties are forbidden in action evidence');
          continue;
        }
        scanForbiddenKeys(descriptor.value, `${path}[${index}]`, issues, next, depth + 1);
      }
    }
    return;
  }
  if (!isPlainRecord(value)) {
    issue(issues, 'PLAIN_DATA_REQUIRED', path, 'action evidence accepts plain data only');
    return;
  }
  for (const key of ownKeys) {
    if (typeof key === 'symbol') {
      issue(issues, 'SYMBOL_PROPERTY_FORBIDDEN', path, 'symbol properties are forbidden in action evidence');
      continue;
    }
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) {
      issue(issues, 'AUTHORITY_FIELD_FORBIDDEN', childPath, 'action evidence cannot carry approval, blocking, ranking, command, or execution fields');
    }
    if (SECRET_LIKE_KEYS.test(key)) {
      issue(issues, 'SECRET_FIELD_FORBIDDEN', childPath, 'secret-like fields are forbidden in action evidence');
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      issue(issues, 'REFLECTION_FAILURE', childPath, 'object properties must expose stable plain-data descriptors');
      continue;
    }
    if (!descriptor?.enumerable) issue(issues, 'NON_ENUMERABLE_PROPERTY_FORBIDDEN', childPath, 'non-enumerable properties are not canonical JSON evidence');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      issue(issues, 'ACCESSOR_PROPERTY_FORBIDDEN', childPath, 'accessor properties are forbidden in action evidence');
      continue;
    }
    scanForbiddenKeys(descriptor.value, childPath, issues, next, depth + 1);
  }
}

function validateIdentity(identity, actionClass, path, issues) {
  const expected = ACTION_IDENTITY_FIELDS[actionClass];
  if (!hasExactKeys(identity, expected)) {
    issue(issues, 'IDENTITY_FIELD_SET_MISMATCH', path, 'identity must use the exact frozen action-class field set');
    return;
  }
  const controlClass = actionClass === 'REPAIR_STEP' || actionClass === 'HALT';
  if (controlClass) {
    if (!isId(identity.commandId)) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.commandId`, 'control command identity must be a stable identifier');
    if (!COMMAND_ID.test(identity.commandId)) issue(issues, 'CONTROL_COMMAND_ID_INVALID', `${path}.commandId`, 'control command ID must preserve the frozen L14 cmd_ format');
    if (!FROZEN_TEXT_ID.test(identity.correlationId)) issue(issues, 'CONTROL_CORRELATION_ID_INVALID', `${path}.correlationId`, 'control correlation ID must preserve bounded owner-safe syntax');
    if (!OWNER_SHA256.test(identity.actionDigest)) issue(issues, 'IDENTITY_DIGEST_INVALID', path, 'L14 action digest must preserve sha256: owner format');
    const expectedActionDigest = `sha256:${sha256Hex(canonicalStringify({
      schema: 'LIVE_EDGE_CONTROL_ACTION_DIGEST_V1',
      action: frozenControlActionMaterial(identity, actionClass),
    }))}`;
    if (identity.actionDigest !== expectedActionDigest) issue(issues, 'CONTROL_ACTION_DIGEST_MISMATCH', `${path}.actionDigest`, 'L14 action digest must content-bind the exact frozen DurableControlAction');
    if (!isNonNegativeSafeInteger(identity.expectedControlRevision)) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.expectedControlRevision`, 'control revision must be a non-negative safe integer');
  } else {
    for (const key of ['actionId', 'actionRevision', 'venue', 'product', 'symbol']) {
      if (!isId(identity[key])) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.${key}`, 'policy action identity values must be stable identifiers');
    }
    if (!POLICY_ACTION_ID.test(identity.actionId) || !POLICY_ACTION_REVISION.test(identity.actionRevision)) {
      issue(issues, 'POLICY_ACTION_CONTENT_ID_INVALID', path, 'L08 action ID and revision must preserve epact_ and epactrev_ content-addressed formats');
    }
    for (const key of ['targetActionId', 'requiresConfirmedCancelActionId']) {
      if (!isNullableId(identity[key])) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.${key}`, 'optional policy action identity must be null or a stable identifier');
    }
    for (const key of ['targetActionId', 'requiresConfirmedCancelActionId']) {
      if (identity[key] !== null && !POLICY_ACTION_ID.test(identity[key])) issue(issues, 'POLICY_ACTION_REFERENCE_ID_INVALID', `${path}.${key}`, 'action-to-action references must preserve epact_ content IDs');
    }
    for (const key of ['legId', 'correlationId', 'accountRealmId']) {
      if (!FROZEN_TEXT_ID.test(identity[key])) issue(issues, 'POLICY_ACTION_LOCAL_ID_INVALID', `${path}.${key}`, 'frozen local identity must start with a letter and use bounded owner-safe characters');
    }
    for (const key of ['recoveryEvidenceRevision', 'targetExposureRevision']) {
      if (identity[key] !== null && !FROZEN_TEXT_ID.test(identity[key])) issue(issues, 'POLICY_ACTION_REVISION_INVALID', `${path}.${key}`, 'policy evidence revisions must preserve frozen owner-safe text syntax');
    }
    if (identity.dependsOnActualFillLegId !== null && !FROZEN_TEXT_ID.test(identity.dependsOnActualFillLegId)) issue(issues, 'POLICY_ACTION_LOCAL_ID_INVALID', `${path}.dependsOnActualFillLegId`, 'actual-fill leg reference must use the frozen local ID syntax');
    if (!FROZEN_SYMBOL.test(identity.symbol)) issue(issues, 'POLICY_ACTION_SYMBOL_INVALID', `${path}.symbol`, 'symbol must preserve the frozen uppercase owner syntax');
    if (identity.actionSchema !== 'EXECUTION_POLICY_ACTION_V1') issue(issues, 'POLICY_ACTION_SCHEMA_INVALID', `${path}.actionSchema`, 'policy action schema must match frozen L08');
    if (!isNonNegativeSafeInteger(identity.step) || identity.step > 31) issue(issues, 'POLICY_ACTION_STEP_INVALID', `${path}.step`, 'policy action step must be within frozen L bounds 0..31');
    if (!isNonNegativeSafeInteger(identity.deadlineOffsetMs) || identity.deadlineOffsetMs > 86_400_000) issue(issues, 'POLICY_ACTION_DEADLINE_INVALID', `${path}.deadlineOffsetMs`, 'policy action deadline offset must be bounded');
    if (identity.ambiguityPosture !== 'RECONCILE_ONLY') issue(issues, 'POLICY_ACTION_AMBIGUITY_POSTURE_INVALID', `${path}.ambiguityPosture`, 'frozen L ambiguity posture is RECONCILE_ONLY');
    if (![null, 'LIMIT', 'MARKET'].includes(identity.orderType)) issue(issues, 'POLICY_ACTION_ORDER_TYPE_INVALID', `${path}.orderType`, 'order type is unsupported');
    if (![null, 'GTC', 'IOC', 'FOK'].includes(identity.timeInForce)) issue(issues, 'POLICY_ACTION_TIF_INVALID', `${path}.timeInForce`, 'time in force is unsupported');
    if (!isNullableCanonicalPolicyDecimal(identity.quantity) || !isNullableCanonicalPolicyDecimal(identity.price)) issue(issues, 'POLICY_ACTION_DECIMAL_INVALID', path, 'quantity and price must be canonical L08 decimals with at most 72 digits');
    if (identity.venue !== 'BINANCE') issue(issues, 'POLICY_ACTION_VENUE_INVALID', `${path}.venue`, 'frozen adapter action evidence is BINANCE-only');
    if (!['SPOT', 'USD_M_PERPETUAL'].includes(identity.product)) issue(issues, 'POLICY_ACTION_PRODUCT_INVALID', `${path}.product`, 'frozen L policy product must be SPOT or USD_M_PERPETUAL');
    const expectedContentHash = sha256Hex(canonicalStringify(frozenPolicyActionMaterial(
      identity,
      FROZEN_ACTION_BINDINGS[actionClass].discriminantValue,
    )));
    if (identity.actionId !== `epact_${expectedContentHash}`
      || identity.actionRevision !== `epactrev_${expectedContentHash}`) {
      issue(issues, 'POLICY_ACTION_CONTENT_BINDING_MISMATCH', path, 'L08 action ID and revision must content-bind the exact frozen PolicyAction material');
    }
  }

  if (actionClass === 'ORDER_INTENT') {
    for (const key of ['intentId', 'intentRevision', 'externalPlanId']) if (!isId(identity[key])) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.${key}`, 'order intent lineage must be explicit');
    if (!['BUY', 'SELL'].includes(identity.side)) issue(issues, 'ORDER_SIDE_INVALID', `${path}.side`, 'order side must be BUY or SELL');
    if (identity.orderType === null || !isPositiveCanonicalPolicyDecimal(identity.quantity)) issue(issues, 'ORDER_PLACEMENT_FIELDS_INVALID', path, 'PLACE requires order type and positive canonical quantity');
    if (identity.orderType === 'LIMIT' && (!isPositiveCanonicalPolicyDecimal(identity.price) || identity.timeInForce === null)) issue(issues, 'ORDER_LIMIT_FIELDS_INVALID', path, 'LIMIT PLACE requires positive canonical price and time in force');
    if (identity.orderType === 'MARKET' && (identity.price !== null || identity.timeInForce !== null)) issue(issues, 'ORDER_MARKET_FIELDS_INVALID', path, 'MARKET PLACE cannot carry price or time in force');
    const expectedQuantitySource = identity.dependsOnActualFillLegId === null
      ? 'AUTHORIZED_FILTERED_QUANTITY' : 'ACTUAL_FILL_OF_LEG';
    if (identity.quantitySource !== expectedQuantitySource) issue(issues, 'ORDER_QUANTITY_SOURCE_INVALID', `${path}.quantitySource`, 'PLACE quantity source must match the frozen dependency law');
    if (identity.targetActionId !== null || identity.requiresConfirmedCancelActionId !== null
      || identity.exposureEffect !== 'MAY_OPEN_WITHIN_AUTHORIZATION'
      || identity.recoveryEvidenceRevision !== null || identity.targetExposureRevision !== null) {
      issue(issues, 'ORDER_FROZEN_FIELDS_INVALID', path, 'PLACE fields must match frozen L08 semantics');
    }
  }
  if (actionClass === 'CANCELLATION') {
    for (const key of ['mutationId', 'commandId']) if (!isId(identity[key])) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.${key}`, 'cancellation lineage must be explicit');
    if (!COMMAND_ID.test(identity.commandId)) issue(issues, 'CONTROL_COMMAND_ID_INVALID', `${path}.commandId`, 'cancellation command lineage must preserve the frozen L14 cmd_ format');
    if (identity.orderType !== null || identity.timeInForce !== null || identity.quantity !== null
      || identity.quantitySource !== null || identity.price !== null || identity.targetActionId === null
      || identity.dependsOnActualFillLegId !== null || identity.requiresConfirmedCancelActionId !== null
      || identity.exposureEffect !== 'NO_EXPOSURE_EFFECT'
      || identity.recoveryEvidenceRevision !== null || identity.targetExposureRevision !== null) {
      issue(issues, 'CANCELLATION_FROZEN_FIELDS_INVALID', path, 'CANCEL fields must match frozen L08 semantics');
    }
  }
  if (actionClass === 'REPAIR_STEP') {
    if (identity.actionType !== 'SAFE_RESTART_COMPONENT') issue(issues, 'REPAIR_ACTION_TYPE_INVALID', `${path}.actionType`, 'repair binds only SAFE_RESTART_COMPONENT');
    if (identity.componentOwner !== 'FOUNDATION_CONTROL') issue(issues, 'REPAIR_COMPONENT_OWNER_INVALID', `${path}.componentOwner`, 'repair component owner must remain FOUNDATION_CONTROL');
    if (identity.componentReferenceSchema !== 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1'
      || !CONTROL_REVISION.test(identity.componentRevision) || !isReferenceDigest(identity.componentDigest)) {
      issue(issues, 'REPAIR_COMPONENT_REFERENCE_INVALID', path, 'repair component must preserve the complete frozen L14 opaque owner reference');
    }
    if (identity.componentId !== 'control-plane-runtime') issue(issues, 'REPAIR_COMPONENT_NOT_FROZEN_BINDING', `${path}.componentId`, 'only the frozen control-plane-runtime restart binding is represented');
    if (identity.restartMode !== 'SAFE_RECONCILE_FIRST') issue(issues, 'REPAIR_MODE_NOT_FROZEN_BINDING', `${path}.restartMode`, 'repair evidence binds SAFE_RECONCILE_FIRST only');
  }
  if (actionClass === 'HALT') {
    if (identity.actionType !== 'HALT') issue(issues, 'HALT_ACTION_TYPE_INVALID', `${path}.actionType`, 'halt action type must remain HALT');
    if (identity.scope !== 'NEW_RISK') issue(issues, 'HALT_SCOPE_NOT_FROZEN_BINDING', `${path}.scope`, 'HALT scope must be NEW_RISK');
    if (identity.retainSupervision !== true) issue(issues, 'HALT_SUPERVISION_MUST_REMAIN', `${path}.retainSupervision`, 'HALT must retain supervision');
  }
  if (actionClass === 'RECOVERY_STEP') {
    for (const key of ['actualFillLegId', 'planId']) if (!isId(identity[key])) issue(issues, 'IDENTITY_VALUE_INVALID', `${path}.${key}`, 'recovery lineage must be explicit');
    if (identity.orderType === null || !isPositiveCanonicalPolicyDecimal(identity.quantity)) issue(issues, 'RECOVERY_PLACEMENT_FIELDS_INVALID', path, 'RECOVER requires order type and positive canonical quantity');
    if (identity.orderType === 'LIMIT' && (!isPositiveCanonicalPolicyDecimal(identity.price)
      || identity.timeInForce === null)) issue(issues, 'RECOVERY_LIMIT_FIELDS_INVALID', path, 'LIMIT RECOVER requires price and time in force');
    if (identity.orderType === 'MARKET' && (identity.price !== null || identity.timeInForce !== null)) issue(issues, 'RECOVERY_MARKET_FIELDS_INVALID', path, 'MARKET RECOVER cannot carry price or time in force');
    if (identity.quantitySource !== 'RISK_REDUCING_RECOVERY_EVIDENCE') issue(issues, 'RECOVERY_QUANTITY_SOURCE_INVALID', `${path}.quantitySource`, 'RECOVER requires the frozen risk-reducing quantity source');
    if (identity.exposureEffect !== 'RISK_REDUCING_ONLY') issue(issues, 'RECOVERY_EXPOSURE_EFFECT_INVALID', `${path}.exposureEffect`, 'RECOVER must remain risk-reducing only');
    if (identity.dependsOnActualFillLegId !== identity.actualFillLegId
      || identity.recoveryEvidenceRevision === null || identity.targetExposureRevision === null
      || identity.targetActionId !== null || identity.requiresConfirmedCancelActionId !== null) {
      issue(issues, 'RECOVERY_FROZEN_FIELDS_INVALID', path, 'RECOVER must bind actual-fill, recovery, and exposure evidence exactly');
    }
  }
}

function validateVersions(versions, actionClass, path, issues) {
  if (!hasExactKeys(versions, VERSION_KEYS)) {
    issue(issues, 'VERSION_FIELD_SET_MISMATCH', path, 'version binding field set is closed');
    return;
  }
  for (const key of ['releaseId', 'policyRevision', 'schemaRevision']) {
    if (!isId(versions[key])) issue(issues, 'VERSION_VALUE_INVALID', `${path}.${key}`, 'version must be a stable identifier');
  }
  if (!isNullableId(versions.modelRevision)) issue(issues, 'VERSION_VALUE_INVALID', `${path}.modelRevision`, 'model revision must be null or a stable identifier');
  if (versions.authorityMapCommit !== FROZEN_AUTHORITY_MAP_COMMIT) issue(issues, 'AUTHORITY_MAP_COMMIT_MISMATCH', `${path}.authorityMapCommit`, 'authority map commit must bind the immutable governing object');
  if (versions.ownerContractCommit !== FROZEN_L_COMMIT) issue(issues, 'OWNER_CONTRACT_COMMIT_MISMATCH', `${path}.ownerContractCommit`, 'owner contract must bind the frozen L commit');
  if (versions.policyRevision !== FROZEN_POLICY_REVISIONS[actionClass]) issue(issues, 'POLICY_REVISION_MISMATCH', `${path}.policyRevision`, 'policy revision must match the frozen owner family');
  if (versions.schemaRevision !== ACTION_EVIDENCE_SCHEMA_VERSION) issue(issues, 'SCHEMA_REVISION_MISMATCH', `${path}.schemaRevision`, 'record schema revision must match the envelope schema');
}

function validateTemporalContext(context, record, path, issues) {
  if (!hasExactKeys(context, TEMPORAL_KEYS)) {
    issue(issues, 'TEMPORAL_FIELD_SET_MISMATCH', path, 'temporal context field set is closed');
    return;
  }
  if (!isUtcMs(context.referenceTimeMs) || !isUtcMs(context.watermarkMs)) issue(issues, 'TEMPORAL_TIME_INVALID', path, 'reference and watermark times must be valid UTC milliseconds');
  if (!isPositiveSafeInteger(context.maximumReferenceAgeMs)) issue(issues, 'TEMPORAL_REFERENCE_MAXIMUM_AGE_INVALID', `${path}.maximumReferenceAgeMs`, 'reference decision time requires a positive maximum age');
  if (!isNonNegativeSafeInteger(context.maximumPairwiseSkewMs)) issue(issues, 'TEMPORAL_SKEW_BUDGET_INVALID', `${path}.maximumPairwiseSkewMs`, 'skew budget must be a non-negative safe integer');
  if (!isId(context.joinPolicy)) issue(issues, 'TEMPORAL_JOIN_POLICY_INVALID', `${path}.joinPolicy`, 'join policy must be a stable identifier');
  const expectedDispositions = {
    lateDisposition: 'QUARANTINE',
    reorderedDisposition: 'REJECT',
    duplicateDisposition: 'IGNORE_EXACT_DUPLICATE',
    futureDisposition: 'REJECT',
  };
  for (const [field, expected] of Object.entries(expectedDispositions)) {
    if (context[field] !== expected) {
      issue(issues, 'TEMPORAL_DISPOSITION_INVALID', `${path}.${field}`, `temporal ${field} must use the frozen ${expected} disposition`);
    }
  }
  if (!Array.isArray(context.sources) || context.sources.length === 0 || context.sources.length > ACTION_EVIDENCE_LIMITS.maxTemporalSources) {
    issue(issues, 'TEMPORAL_SOURCES_INVALID', `${path}.sources`, 'temporal context needs a bounded non-empty source set');
    return;
  }
  const sourceIds = new Set();
  const evidenceIds = new Set();
  const trade = ['ORDER_INTENT', 'CANCELLATION', 'RECOVERY_STEP'].includes(record.actionClass);
  context.sources.forEach((source, index) => {
    const sourcePath = `${path}.sources[${index}]`;
    if (!hasExactKeys(source, TEMPORAL_SOURCE_KEYS)) {
      issue(issues, 'TEMPORAL_SOURCE_FIELD_SET_MISMATCH', sourcePath, 'temporal source field set is closed');
      return;
    }
    if (!isId(source.sourceId) || sourceIds.has(source.sourceId)) issue(issues, 'TEMPORAL_SOURCE_ID_INVALID', `${sourcePath}.sourceId`, 'source IDs must be stable and unique');
    if (!isId(source.evidenceId) || evidenceIds.has(source.evidenceId)) issue(issues, 'TEMPORAL_EVIDENCE_ID_INVALID', `${sourcePath}.evidenceId`, 'source evidence IDs must be stable and unique');
    sourceIds.add(source.sourceId);
    evidenceIds.add(source.evidenceId);
    for (const field of ['eventAtMs', 'receivedAtMs', 'availableAtMs', 'processedAtMs']) {
      if (!isUtcMs(source[field])) issue(issues, 'TEMPORAL_SOURCE_TIME_INVALID', `${sourcePath}.${field}`, 'source time must be valid UTC milliseconds');
    }
    if (!isPositiveSafeInteger(source.maximumAgeMs)) issue(issues, 'TEMPORAL_SOURCE_MAXIMUM_AGE_INVALID', `${sourcePath}.maximumAgeMs`, 'each source requires a positive maximum age');
    if (!isUtcMs(source.expiresAtMs)) issue(issues, 'TEMPORAL_SOURCE_EXPIRY_INVALID', `${sourcePath}.expiresAtMs`, 'each source requires an absolute expiry');
    if (!isId(source.sequenceId) || !isId(source.snapshotId)) issue(issues, 'TEMPORAL_SOURCE_SEQUENCE_INVALID', sourcePath, 'sequence and snapshot identities are required');
    if (!['NONE', 'PRESENT', 'UNKNOWN'].includes(source.sequenceGap)) issue(issues, 'TEMPORAL_SEQUENCE_STATE_INVALID', `${sourcePath}.sequenceGap`, 'sequence gap state is unsupported');
    if (!['BOUNDED', 'UNBOUNDED', 'UNKNOWN'].includes(source.clockQuality)) issue(issues, 'TEMPORAL_CLOCK_STATE_INVALID', `${sourcePath}.clockQuality`, 'clock quality state is unsupported');
    if (isUtcMs(source.eventAtMs) && isUtcMs(context.watermarkMs)
      && source.eventAtMs > context.watermarkMs) issue(issues, 'TEMPORAL_SOURCE_AFTER_WATERMARK', sourcePath, 'bounded watermark must cover every joined source event');

    if (trade) {
      for (const field of ['venue', 'symbol', 'accountRealmId']) {
        if (!isId(source[field]) || source[field] !== record.identity[field]) issue(issues, 'TEMPORAL_SUBJECT_BINDING_MISMATCH', `${sourcePath}.${field}`, 'market/account source identity must match the action identity');
      }
      if (!isId(source.product)) issue(issues, 'TEMPORAL_PRODUCT_ID_MISSING', `${sourcePath}.product`, 'each market/account source must name its exact product');
      if (source.componentId !== null) issue(issues, 'TEMPORAL_COMPONENT_NOT_APPLICABLE', `${sourcePath}.componentId`, 'trade evidence cannot substitute a component identity');
    } else {
      if (!isId(source.componentId)) issue(issues, 'TEMPORAL_COMPONENT_ID_MISSING', `${sourcePath}.componentId`, 'control evidence requires a component identity');
      for (const field of ['venue', 'product', 'symbol', 'accountRealmId']) {
        if (source[field] !== null) issue(issues, 'TEMPORAL_TRADE_IDENTITY_NOT_APPLICABLE', `${sourcePath}.${field}`, 'irrelevant trade identity must remain null');
      }
    }
  });
  if (trade) {
    const products = context.sources.map((source) => source?.product).sort();
    if (products.join('\n') !== ['ACCOUNT', 'SPOT', 'USD_M_PERPETUAL'].sort().join('\n')) {
      issue(issues, 'TEMPORAL_TRADE_DENOMINATOR_MISMATCH', `${path}.sources`, 'trade evidence requires exactly SPOT, USD_M_PERPETUAL, and ACCOUNT sources');
    }
  } else if (context.sources.length !== 1 || context.sources[0]?.componentId !== 'control-plane-runtime') {
    issue(issues, 'TEMPORAL_CONTROL_DENOMINATOR_MISMATCH', `${path}.sources`, 'control evidence requires exactly the frozen control-plane-runtime source');
  }
}

function validateFencing(context, record, path, issues) {
  if (!hasExactKeys(context, FENCING_KEYS)) {
    issue(issues, 'FENCING_FIELD_SET_MISMATCH', path, 'fencing context field set is closed');
    return;
  }
  if (typeof context.relevant !== 'boolean') issue(issues, 'FENCING_RELEVANCE_INVALID', `${path}.relevant`, 'fencing relevance must be boolean');
  const mustBeRelevant = record.actionClass !== 'HALT';
  if (context.relevant !== mustBeRelevant) {
    issue(issues, 'FENCING_RELEVANCE_CLASS_MISMATCH', `${path}.relevant`, 'fencing relevance must match the frozen action class');
  }
  if (context.relevant) {
    if (!isNonNegativeSafeInteger(context.epoch)) issue(issues, 'FENCING_EPOCH_MISSING', `${path}.epoch`, 'relevant fencing requires a non-negative epoch');
    if (!isId(context.ownerEvidenceId)) issue(issues, 'FENCING_OWNER_EVIDENCE_MISSING', `${path}.ownerEvidenceId`, 'relevant fencing requires current-owner evidence');
    if (!isUtcMs(context.leaseExpiresAtMs)) issue(issues, 'FENCING_EXPIRY_MISSING', `${path}.leaseExpiresAtMs`, 'relevant fencing requires lease expiry');
    const fencingFamily = Array.isArray(record.families)
      ? record.families.find((entry) => entry?.family === 'FENCING_AND_IDEMPOTENCY')
      : null;
    if (!fencingFamily?.evidenceIds?.includes(context.ownerEvidenceId)) issue(issues, 'FENCING_OWNER_EVIDENCE_UNBOUND', `${path}.ownerEvidenceId`, 'current-owner evidence must resolve to the record-local fencing family');
  } else if (context.epoch !== null || context.ownerEvidenceId !== null || context.leaseExpiresAtMs !== null) {
    issue(issues, 'FENCING_IRRELEVANT_FIELDS_PRESENT', path, 'irrelevant fencing fields must remain null');
  }
}

function validateEvidenceReference(reference, path, issues) {
  if (!hasExactKeys(reference, EVIDENCE_REFERENCE_KEYS)) {
    issue(issues, 'OWNER_REFERENCE_FIELD_SET_MISMATCH', path, 'evidence reference field set is closed');
    return;
  }
  if (!CANONICAL_OWNER_REFERENCE_IDS.includes(reference.ownerId)) issue(issues, 'OWNER_REFERENCE_OWNER_NONCANONICAL', `${path}.ownerId`, 'reference owner must be a canonical frozen owner');
  if (!EVIDENCE_SOURCE_ROLES.includes(reference.sourceRole)) issue(issues, 'OWNER_REFERENCE_SOURCE_ROLE_INVALID', `${path}.sourceRole`, 'reference source role is unsupported');
  if (!isId(reference.referenceId) || !isId(reference.revision)) issue(issues, 'OWNER_REFERENCE_ID_INVALID', path, 'owner reference identities are required');
  if (!isReferenceDigest(reference.digest)) issue(issues, 'OWNER_REFERENCE_DIGEST_INVALID', `${path}.digest`, 'owner reference digest must be raw or sha256:-prefixed lowercase SHA-256');
  if (!isUtcMs(reference.observedAtMs) || !isUtcMs(reference.expiresAtMs)) issue(issues, 'OWNER_REFERENCE_TIME_INVALID', path, 'owner reference observation and expiry must be valid UTC milliseconds');
  if (!isPositiveSafeInteger(reference.maximumAgeMs)) issue(issues, 'OWNER_REFERENCE_MAXIMUM_AGE_INVALID', `${path}.maximumAgeMs`, 'owner reference maximum age must be positive');
  if (isUtcMs(reference.observedAtMs) && isUtcMs(reference.expiresAtMs)
    && reference.observedAtMs >= reference.expiresAtMs) {
    issue(issues, 'OWNER_REFERENCE_TIMELINE_INVALID', path, 'owner reference observation must precede expiry');
  }
}

function validateActionReference(reference, record, path, issues) {
  validateEvidenceReference(reference, path, issues);
  if (!isPlainRecord(reference) || !isPlainRecord(record.identity)) return;
  const control = record.actionClass === 'REPAIR_STEP' || record.actionClass === 'HALT';
  const expectedId = control ? record.identity.commandId : record.identity.actionId;
  const expectedRevision = control
    ? `control_revision_${record.identity.expectedControlRevision}`
    : record.identity.actionRevision;
  if (reference.sourceRole !== 'ACTION'
    || reference.ownerId !== FROZEN_ACTION_BINDINGS[record.actionClass].ownerId
    || reference.referenceId !== expectedId
    || reference.revision !== expectedRevision
    || reference.digest !== (control
      ? record.identity.actionDigest
      : record.identity.actionId?.slice('epact_'.length))) {
    issue(issues, 'ACTION_REFERENCE_BINDING_MISMATCH', path, 'action reference must bind exact owner, identity, revision, and digest');
  }
}

function validateOwnerReferences(references, record, path, issues) {
  if (!Array.isArray(references) || references.length > ACTION_EVIDENCE_LIMITS.maxOwnerReferences) {
    issue(issues, 'OWNER_REFERENCES_INVALID', path, 'owner references must be a bounded array');
    return;
  }
  const ids = new Set();
  references.forEach((reference, index) => {
    const referencePath = `${path}[${index}]`;
    if (!hasExactKeys(reference, OWNER_DECISION_REFERENCE_KEYS)) {
      issue(issues, 'OWNER_REFERENCE_FIELD_SET_MISMATCH', referencePath, 'owner decision reference field set is closed');
      return;
    }
    const { binding, ...evidenceReference } = reference;
    validateEvidenceReference(evidenceReference, referencePath, issues);
    if (reference?.sourceRole !== 'OWNER_DECISION') issue(issues, 'OWNER_REFERENCE_ROLE_INVALID', `${referencePath}.sourceRole`, 'optional canonical owner references must use OWNER_DECISION role');
    if (!CANONICAL_DECISION_OWNER_IDS_BY_CLASS[record.actionClass]?.includes(reference?.ownerId)) {
      issue(issues, 'OWNER_DECISION_OWNER_INVALID', `${referencePath}.ownerId`, 'owner-decision references must come from a class-appropriate canonical decision owner');
    }
    if (!isPlainRecord(reference)) return;
    if (!hasExactKeys(binding, OWNER_DECISION_BINDING_KEYS)) {
      issue(issues, 'OWNER_REFERENCE_BINDING_FIELD_SET_MISMATCH', `${referencePath}.binding`, 'owner decision binding field set is closed');
    } else {
      if (!isDigest(binding.subjectDigest)) issue(issues, 'OWNER_REFERENCE_BINDING_DIGEST_INVALID', `${referencePath}.binding.subjectDigest`, 'owner decision subject digest is invalid');
      if (!isId(binding.releaseId) || !isId(binding.policyRevision)) issue(issues, 'OWNER_REFERENCE_BINDING_VERSION_INVALID', `${referencePath}.binding`, 'owner decision release and policy versions are required');
      if (!SHA1.test(binding.authorityMapCommit)) issue(issues, 'OWNER_REFERENCE_BINDING_AUTHORITY_INVALID', `${referencePath}.binding.authorityMapCommit`, 'owner decision authority-map commit is invalid');
    }
    const key = reference.referenceId;
    if (ids.has(key)) issue(issues, 'OWNER_REFERENCE_DUPLICATE', referencePath, 'owner references must be unique');
    ids.add(key);
  });
  const state = record.actionFacts?.ownerDecisionReferenceState;
  if (state !== undefined) {
    if (references.length === 0 && state !== 'ABSENT') issue(issues, 'OWNER_REFERENCE_STATE_INCOHERENT', path, 'non-ABSENT owner-reference state requires a supplied reference');
    if (references.length > 0 && state === 'ABSENT') issue(issues, 'OWNER_REFERENCE_STATE_INCOHERENT', path, 'supplied owner reference cannot be labeled ABSENT');
  }
  if (state === undefined || state === 'CURRENT_EXACT_SUBJECT') {
    for (const [index, reference] of references.entries()) {
      if (reference?.binding?.subjectDigest !== record.subjectDigest
        || reference?.binding?.releaseId !== record.versions?.releaseId
        || reference?.binding?.policyRevision !== record.versions?.policyRevision
        || reference?.binding?.authorityMapCommit !== record.versions?.authorityMapCommit) {
        issue(issues, 'OWNER_REFERENCE_BINDING_MISMATCH', `${path}[${index}].binding`, 'current owner decision must bind the exact action, release, policy, and authority map');
      }
    }
  }
}

function validateScenario(scenario, path, issues) {
  if (!hasExactKeys(scenario, SCENARIO_KEYS)) {
    issue(issues, 'SCENARIO_FIELD_SET_MISMATCH', path, 'scenario envelope field set is closed');
    return;
  }
  if (!isId(scenario.scenarioId)) issue(issues, 'SCENARIO_ID_INVALID', `${path}.scenarioId`, 'scenario ID is required');
  if (typeof scenario.bounded !== 'boolean') issue(issues, 'SCENARIO_BOUNDED_STATE_INVALID', `${path}.bounded`, 'bounded state must be boolean');
  if (!uniqueIds(scenario.disturbanceIds) || !uniqueIds(scenario.excludedStateIds)) issue(issues, 'SCENARIO_ID_LIST_INVALID', path, 'scenario disturbance/exclusion lists must be bounded unique IDs');
  for (const field of ['maximumExposure', 'maximumLiability', 'maximumRecoveryCost']) {
    if (!isNullableNonNegativeDecimal(scenario[field])) issue(issues, 'SCENARIO_DECIMAL_INVALID', `${path}.${field}`, 'scenario bounds must be null or exact non-negative decimal strings');
  }
  if (!isNonNegativeSafeInteger(scenario.timeHeadroomMs)) issue(issues, 'SCENARIO_TIME_HEADROOM_INVALID', `${path}.timeHeadroomMs`, 'scenario time headroom must be an explicit non-negative safe integer');
  if (typeof scenario.rateLimitHeadroomKnown !== 'boolean') issue(issues, 'SCENARIO_RATE_HEADROOM_INVALID', `${path}.rateLimitHeadroomKnown`, 'rate-limit headroom knowledge must be boolean');
}

function validateActionFacts(facts, record, path, issues) {
  const { actionClass } = record;
  if (!hasExactKeys(facts, ACTION_FACT_FIELDS[actionClass])) {
    issue(issues, 'ACTION_FACT_FIELD_SET_MISMATCH', path, 'action facts must use the exact class-discriminated field set');
    return;
  }
  const ownerTruth = ['CURRENT', 'CHANGED_AFTER_PROPOSAL', 'UNKNOWN'];
  const ownerDecision = ['ABSENT', 'CURRENT_EXACT_SUBJECT', 'STALE', 'SUBJECT_MISMATCH', 'POLICY_MISMATCH', 'UNKNOWN'];
  const lease = ['HELD', 'LOST', 'UNKNOWN'];
  const recoveryPath = ['CURRENT', 'MISSING', 'EXPIRED', 'UNKNOWN'];
  const rateLimit = ['AVAILABLE', 'RATE_LIMITED', 'UNKNOWN'];

  if (actionClass === 'ORDER_INTENT') {
    if (facts.factType !== 'ORDER_INTENT_FACTS') issue(issues, 'ACTION_FACT_TYPE_MISMATCH', `${path}.factType`, 'order intent facts discriminant is invalid');
    if (!ownerTruth.includes(facts.ownerTruthState)) issue(issues, 'ACTION_FACT_STATE_INVALID', `${path}.ownerTruthState`, 'owner truth state is invalid');
    if (!ownerDecision.includes(facts.ownerDecisionReferenceState)) issue(issues, 'ACTION_FACT_STATE_INVALID', `${path}.ownerDecisionReferenceState`, 'owner decision reference state is invalid');
    if (!['NONE', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(facts.partialFillState)) issue(issues, 'ACTION_FACT_STATE_INVALID', `${path}.partialFillState`, 'partial-fill state is invalid');
    if (!recoveryPath.includes(facts.recoveryPathState) || !rateLimit.includes(facts.rateLimitState) || !lease.includes(facts.leaseState)) issue(issues, 'ACTION_FACT_STATE_INVALID', path, 'order safety facts contain an unsupported state');
    for (const key of ['signedAtMs', 'acknowledgedAtMs']) if (!isUtcMs(facts[key])) issue(issues, 'ACTION_FACT_TIME_INVALID', `${path}.${key}`, 'submission timestamps are required');
    if (!isNullableUtcMs(facts.leaseLossObservedAtMs)) issue(issues, 'ACTION_FACT_TIME_INVALID', `${path}.leaseLossObservedAtMs`, 'lease-loss time must be null or valid UTC milliseconds');
    if (isUtcMs(facts.signedAtMs) && isUtcMs(facts.acknowledgedAtMs)
      && facts.signedAtMs > facts.acknowledgedAtMs) issue(issues, 'ACTION_FACT_TIMELINE_INCOHERENT', path, 'order signing must not follow acknowledgement');
    if ((facts.leaseState === 'HELD' && facts.leaseLossObservedAtMs !== null)
      || (facts.leaseState === 'LOST' && facts.leaseLossObservedAtMs === null)) issue(issues, 'ACTION_FACT_LEASE_STATE_INCOHERENT', path, 'lease state and loss observation must agree');
    if (facts.leaseLossObservedAtMs !== null && isUtcMs(facts.signedAtMs)
      && facts.leaseLossObservedAtMs < facts.signedAtMs) issue(issues, 'ACTION_FACT_TIMELINE_INCOHERENT', `${path}.leaseLossObservedAtMs`, 'lease loss cannot predate signing');
  } else if (actionClass === 'CANCELLATION') {
    if (facts.factType !== 'CANCELLATION_FACTS') issue(issues, 'ACTION_FACT_TYPE_MISMATCH', `${path}.factType`, 'cancellation facts discriminant is invalid');
    if (!['CANCEL_PENDING', 'CANCELLED', 'FILLED', 'AMBIGUOUS', 'UNKNOWN'].includes(facts.cancellationState)) issue(issues, 'ACTION_FACT_STATE_INVALID', `${path}.cancellationState`, 'cancellation lifecycle state is invalid');
    if (!ownerTruth.includes(facts.ownerTruthState) || !ownerDecision.includes(facts.ownerDecisionReferenceState)
      || !recoveryPath.includes(facts.recoveryPathState) || !rateLimit.includes(facts.rateLimitState)
      || !lease.includes(facts.leaseState)) issue(issues, 'ACTION_FACT_STATE_INVALID', path, 'cancellation safety facts contain an unsupported state');
    for (const key of ['cancellationRequestedAtMs', 'signedAtMs', 'acknowledgedAtMs']) if (!isUtcMs(facts[key])) issue(issues, 'ACTION_FACT_TIME_INVALID', `${path}.${key}`, 'cancellation timestamp is required');
    for (const key of ['localTimeoutAtMs', 'terminalAtMs', 'latestFillAtMs', 'leaseLossObservedAtMs']) if (!isNullableUtcMs(facts[key])) issue(issues, 'ACTION_FACT_TIME_INVALID', `${path}.${key}`, 'optional cancellation timestamp is invalid');
    if (!isNullableCanonicalPolicyDecimal(facts.cumulativeFilledQuantity)) issue(issues, 'ACTION_FACT_DECIMAL_INVALID', `${path}.cumulativeFilledQuantity`, 'cumulative fill must be null or a canonical bounded policy decimal');
    if (isUtcMs(facts.signedAtMs) && isUtcMs(facts.cancellationRequestedAtMs)
      && isUtcMs(facts.acknowledgedAtMs)
      && !(facts.signedAtMs <= facts.cancellationRequestedAtMs
        && facts.cancellationRequestedAtMs <= facts.acknowledgedAtMs)) issue(issues, 'ACTION_FACT_TIMELINE_INCOHERENT', path, 'cancellation signing, request, and acknowledgement order is invalid');
    if ((facts.leaseState === 'HELD' && facts.leaseLossObservedAtMs !== null)
      || (facts.leaseState === 'LOST' && facts.leaseLossObservedAtMs === null)) issue(issues, 'ACTION_FACT_LEASE_STATE_INCOHERENT', path, 'cancellation lease state and loss observation must agree');
    if (facts.leaseLossObservedAtMs !== null && isUtcMs(facts.signedAtMs)
      && facts.leaseLossObservedAtMs < facts.signedAtMs) issue(issues, 'ACTION_FACT_TIMELINE_INCOHERENT', `${path}.leaseLossObservedAtMs`, 'cancellation lease loss cannot predate signing');
    for (const key of ['localTimeoutAtMs', 'latestFillAtMs']) {
      if (facts[key] !== null && isUtcMs(facts.cancellationRequestedAtMs)
        && facts[key] < facts.cancellationRequestedAtMs) issue(issues, 'ACTION_FACT_TIMELINE_INCOHERENT', `${path}.${key}`, `${key} cannot predate cancellation request`);
    }
    const terminal = ['CANCELLED', 'FILLED'].includes(facts.cancellationState);
    if (terminal && (facts.terminalAtMs === null || facts.cumulativeFilledQuantity === null)) issue(issues, 'CANCELLATION_TERMINAL_EVIDENCE_INCOMPLETE', path, 'terminal cancellation outcome needs time and cumulative fill truth');
    if (terminal && typeof facts.cumulativeFilledQuantity === 'string'
      && facts.cumulativeFilledQuantity !== '0' && facts.latestFillAtMs === null) {
      issue(issues, 'CANCELLATION_FILL_TIME_MISSING', `${path}.latestFillAtMs`, 'nonzero terminal cumulative fill requires a latest-fill observation time');
    }
    if (facts.latestFillAtMs !== null
      && (facts.cumulativeFilledQuantity === null || facts.cumulativeFilledQuantity === '0')) {
      issue(issues, 'CANCELLATION_FILL_QUANTITY_MISSING', `${path}.cumulativeFilledQuantity`, 'latest-fill observation requires nonzero cumulative fill truth');
    }
    if (terminal && facts.terminalAtMs !== null && isUtcMs(facts.cancellationRequestedAtMs)
      && facts.terminalAtMs < facts.cancellationRequestedAtMs) issue(issues, 'ACTION_FACT_TIMELINE_INCOHERENT', `${path}.terminalAtMs`, 'terminal outcome cannot predate cancellation request');
    if (!terminal && facts.terminalAtMs !== null) issue(issues, 'CANCELLATION_NONTERMINAL_CLAIMS_TERMINAL_TIME', `${path}.terminalAtMs`, 'nonterminal cancellation state cannot claim terminal completion time');
  } else if (actionClass === 'REPAIR_STEP') {
    if (facts.factType !== 'REPAIR_STEP_FACTS') issue(issues, 'ACTION_FACT_TYPE_MISMATCH', `${path}.factType`, 'repair facts discriminant is invalid');
    if (!lease.includes(facts.leaseState) || !['APPLIED', 'NOOP', 'MISSING', 'UNKNOWN'].includes(facts.receiptState)
      || !['RECONCILED_HEALTHY', 'RESTARTED_UNRECONCILED', 'FAILED_OR_RECURRED', 'QUIET_PERIOD_INCOMPLETE', 'UNKNOWN'].includes(facts.postconditionState)) issue(issues, 'ACTION_FACT_STATE_INVALID', path, 'repair facts contain an unsupported state');
    if (!isUtcMs(facts.postconditionObservedAtMs) || !isUtcMs(facts.postconditionExpiresAtMs)
      || facts.postconditionObservedAtMs >= facts.postconditionExpiresAtMs) issue(issues, 'ACTION_FACT_TIME_INVALID', path, 'repair postcondition requires a bounded validity window');
    if (isUtcMs(facts.postconditionObservedAtMs)
      && facts.postconditionObservedAtMs <= record.actionReference?.observedAtMs) issue(issues, 'POSTACTION_EVIDENCE_PRECEDES_ACTION', `${path}.postconditionObservedAtMs`, 'repair postcondition must follow the bound action observation');
  } else if (actionClass === 'HALT') {
    if (facts.factType !== 'HALT_FACTS') issue(issues, 'ACTION_FACT_TYPE_MISMATCH', `${path}.factType`, 'halt facts discriminant is invalid');
    if (!['APPLIED', 'NOOP', 'MISSING', 'UNKNOWN'].includes(facts.receiptState)
      || !['HALTED', 'NOT_HALTED', 'MISSING', 'UNKNOWN'].includes(facts.readbackState)) issue(issues, 'ACTION_FACT_STATE_INVALID', path, 'halt facts contain an unsupported state');
    if (!isUtcMs(facts.readbackObservedAtMs) || !isUtcMs(facts.readbackExpiresAtMs)
      || facts.readbackObservedAtMs >= facts.readbackExpiresAtMs) issue(issues, 'ACTION_FACT_TIME_INVALID', path, 'halt readback requires a bounded validity window');
    if (isUtcMs(facts.readbackObservedAtMs)
      && facts.readbackObservedAtMs <= record.actionReference?.observedAtMs) issue(issues, 'POSTACTION_EVIDENCE_PRECEDES_ACTION', `${path}.readbackObservedAtMs`, 'halt readback must follow the bound action observation');
  } else if (actionClass === 'RECOVERY_STEP') {
    if (facts.factType !== 'RECOVERY_STEP_FACTS') issue(issues, 'ACTION_FACT_TYPE_MISMATCH', `${path}.factType`, 'recovery facts discriminant is invalid');
    if (!['PRECOMPUTED_EXECUTION_BOUND', 'RECOMMENDATION_ONLY', 'AWARENESS_ONLY', 'MISSING', 'UNKNOWN'].includes(facts.executionBindingState)
      || !['NONE', 'FILL_AFTER_CANCEL', 'UNKNOWN'].includes(facts.lateResultState)
      || !['BOUNDED', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(facts.partialFillState)
      || !ownerTruth.includes(facts.ownerTruthState) || !ownerDecision.includes(facts.ownerDecisionReferenceState)
      || !recoveryPath.includes(facts.recoveryPathState) || !rateLimit.includes(facts.rateLimitState)
      || !lease.includes(facts.leaseState)) issue(issues, 'ACTION_FACT_STATE_INVALID', path, 'recovery facts contain an unsupported state');
    if (typeof facts.recommendationAutomatic !== 'boolean') issue(issues, 'ACTION_FACT_STATE_INVALID', `${path}.recommendationAutomatic`, 'recovery recommendation automatic flag must be explicit');
  }
}

function validateAssumptions(assumptions, evidenceIds, path, issues) {
  if (!Array.isArray(assumptions) || assumptions.length === 0
    || assumptions.length > ACTION_EVIDENCE_LIMITS.maxActiveAssumptions) {
    issue(issues, 'ACTIVE_ASSUMPTIONS_INVALID', path, 'active assumptions must be finite, bounded, and non-empty');
    return;
  }
  const ids = new Set();
  assumptions.forEach((assumption, index) => {
    const assumptionPath = `${path}[${index}]`;
    if (!hasExactKeys(assumption, ASSUMPTION_KEYS)) {
      issue(issues, 'ASSUMPTION_FIELD_SET_MISMATCH', assumptionPath, 'active assumption field set is closed');
      return;
    }
    if (!isId(assumption.assumptionId) || ids.has(assumption.assumptionId) || !isId(assumption.revision)) issue(issues, 'ASSUMPTION_ID_INVALID', assumptionPath, 'assumption identity and revision must be unique and stable');
    ids.add(assumption.assumptionId);
    if (!['SATISFIED', 'CONTRADICTED', 'UNKNOWN'].includes(assumption.state)) issue(issues, 'ASSUMPTION_STATE_INVALID', `${assumptionPath}.state`, 'assumption state is unsupported');
    if (!uniqueIds(assumption.evidenceIds) || assumption.evidenceIds.length === 0
      || assumption.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))) issue(issues, 'ASSUMPTION_EVIDENCE_UNBOUND', `${assumptionPath}.evidenceIds`, 'assumption evidence must resolve within the record');
    if (!isUtcMs(assumption.observedAtMs) || !isUtcMs(assumption.expiresAtMs)
      || !isPositiveSafeInteger(assumption.maximumAgeMs)
      || assumption.observedAtMs >= assumption.expiresAtMs) issue(issues, 'ASSUMPTION_TIME_INVALID', assumptionPath, 'assumption validity window is invalid');
  });
}

function validateInvariantResults(results, evidenceIds, path, issues) {
  if (!Array.isArray(results) || results.length === 0
    || results.length > ACTION_EVIDENCE_LIMITS.maxInvariantResults) {
    issue(issues, 'INVARIANT_RESULTS_INVALID', path, 'invariant results must be finite, bounded, and non-empty');
    return;
  }
  const ids = new Set();
  results.forEach((result, index) => {
    const resultPath = `${path}[${index}]`;
    if (!hasExactKeys(result, INVARIANT_RESULT_KEYS)) {
      issue(issues, 'INVARIANT_RESULT_FIELD_SET_MISMATCH', resultPath, 'invariant result field set is closed');
      return;
    }
    if (!isId(result.invariantId) || ids.has(result.invariantId) || !isId(result.revision)) issue(issues, 'INVARIANT_RESULT_ID_INVALID', resultPath, 'invariant identity and revision must be unique and stable');
    ids.add(result.invariantId);
    if (!ACTION_EVIDENCE_STATUSES.includes(result.status)) issue(issues, 'INVARIANT_RESULT_STATUS_INVALID', `${resultPath}.status`, 'invariant result status is unsupported');
    if (!uniqueIds(result.evidenceIds) || result.evidenceIds.length === 0
      || result.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))) issue(issues, 'INVARIANT_RESULT_EVIDENCE_UNBOUND', `${resultPath}.evidenceIds`, 'invariant evidence must resolve within the record');
    if (!isUtcMs(result.evaluatedAtMs) || !isUtcMs(result.expiresAtMs)
      || !isPositiveSafeInteger(result.maximumAgeMs)
      || result.evaluatedAtMs >= result.expiresAtMs) issue(issues, 'INVARIANT_RESULT_TIME_INVALID', resultPath, 'invariant result validity window is invalid');
  });
}

function validateActor(actor, expectedRole, path, issues) {
  if (!hasExactKeys(actor, ACTOR_KEYS)) {
    issue(issues, 'EVIDENCE_ACTOR_FIELD_SET_MISMATCH', path, 'evidence actor field set is closed');
    return;
  }
  for (const field of ['actorId', 'ownerId', 'independenceDomainId']) {
    if (!isId(actor[field])) issue(issues, 'EVIDENCE_ACTOR_ID_INVALID', `${path}.${field}`, 'actor identity is required');
  }
  if (actor.role !== expectedRole) issue(issues, 'EVIDENCE_ACTOR_ROLE_INVALID', `${path}.role`, `actor role must be ${expectedRole}`);
}

function latestActionFactObservationForFamily(record, family) {
  const facts = record.actionFacts ?? {};
  let values = [];
  if (record.actionClass === 'ORDER_INTENT') {
    if (['FENCING_AND_IDEMPOTENCY', 'LIFECYCLE_STATE_AND_OUTCOME', 'OUTCOME_OBSERVABILITY_AND_SUPERVISION', 'CANCELLATION_AND_LATE_RESULT', 'REGISTERED_RECOVERY_OR_REPAIR_PATH'].includes(family)) {
      values = [facts.signedAtMs, facts.acknowledgedAtMs, facts.leaseLossObservedAtMs];
    } else if (family === 'MUTATION_INPUT_TRUTH') values = [facts.signedAtMs];
  } else if (record.actionClass === 'CANCELLATION') {
    if (['FENCING_AND_IDEMPOTENCY', 'LIFECYCLE_STATE_AND_OUTCOME', 'OUTCOME_OBSERVABILITY_AND_SUPERVISION', 'CANCELLATION_AND_LATE_RESULT', 'REGISTERED_RECOVERY_OR_REPAIR_PATH'].includes(family)) {
      values = [
        facts.signedAtMs,
        facts.cancellationRequestedAtMs,
        facts.acknowledgedAtMs,
        facts.terminalAtMs,
        facts.latestFillAtMs,
        facts.leaseLossObservedAtMs,
      ];
    } else if (family === 'MUTATION_INPUT_TRUTH') values = [facts.signedAtMs, facts.cancellationRequestedAtMs];
  } else if (record.actionClass === 'REPAIR_STEP'
    && ['LIFECYCLE_STATE_AND_OUTCOME', 'REGISTERED_RECOVERY_OR_REPAIR_PATH'].includes(family)) {
    values = [facts.postconditionObservedAtMs];
  } else if (record.actionClass === 'HALT'
    && ['LIFECYCLE_STATE_AND_OUTCOME', 'OUTCOME_OBSERVABILITY_AND_SUPERVISION'].includes(family)) {
    values = [facts.readbackObservedAtMs];
  }
  return values.filter(isUtcMs).reduce((latest, value) => Math.max(latest, value), 0);
}

function validateFamilies(families, record, path, issues) {
  if (!Array.isArray(families) || families.length === 0 || families.length > ACTION_EVIDENCE_LIMITS.maxFamiliesPerRecord) {
    issue(issues, 'EVIDENCE_FAMILIES_INVALID', path, 'required evidence families must be a bounded non-empty array');
    return new Set();
  }
  const required = [...REQUIRED_EVIDENCE_FAMILIES[record.actionClass]].sort();
  const actual = families.map((family) => family?.family).sort();
  if (required.join('\n') !== actual.join('\n')) issue(issues, 'REQUIRED_EVIDENCE_FAMILY_SET_MISMATCH', path, 'record must contain every and only required family for its action class');
  const evidenceIds = new Set();
  const evidenceToFamily = new Map();
  const familyIds = new Set();
  families.forEach((family, index) => {
    const familyPath = `${path}[${index}]`;
    if (!hasExactKeys(family, FAMILY_KEYS)) {
      issue(issues, 'EVIDENCE_FAMILY_FIELD_SET_MISMATCH', familyPath, 'evidence family field set is closed');
      return;
    }
    if (!ACTION_EVIDENCE_FAMILIES.includes(family.family) || familyIds.has(family.family)) issue(issues, 'EVIDENCE_FAMILY_INVALID', `${familyPath}.family`, 'evidence family must be supported and unique');
    familyIds.add(family.family);
    if (!ACTION_EVIDENCE_ASSERTIONS.includes(family.assertion)) issue(issues, 'EVIDENCE_ASSERTION_INVALID', `${familyPath}.assertion`, 'evidence assertion is unsupported');
    if (!uniqueIds(family.evidenceIds) || family.evidenceIds.length === 0) issue(issues, 'EVIDENCE_IDS_INVALID', `${familyPath}.evidenceIds`, 'family needs bounded unique evidence IDs');
    if (Array.isArray(family.evidenceIds)) {
      for (const evidenceId of family.evidenceIds) {
        if (evidenceIds.has(evidenceId)) issue(issues, 'EVIDENCE_ID_DUPLICATE', `${familyPath}.evidenceIds`, 'evidence IDs must be unique within a record');
        evidenceIds.add(evidenceId);
        evidenceToFamily.set(evidenceId, family.family);
      }
    }
    if (!Array.isArray(family.sourceRefs) || family.sourceRefs.length === 0
      || family.sourceRefs.length > ACTION_EVIDENCE_LIMITS.maxIdsPerList) {
      issue(issues, 'EVIDENCE_SOURCE_REFERENCES_INVALID', `${familyPath}.sourceRefs`, 'every evidence ID requires a bounded content-bound source reference');
    } else {
      family.sourceRefs.forEach((reference, sourceIndex) => validateEvidenceReference(
        reference,
        `${familyPath}.sourceRefs[${sourceIndex}]`,
        issues,
      ));
      const referenceIds = family.sourceRefs.map((reference) => reference?.referenceId);
      if (referenceIds.some((referenceId) => !isId(referenceId))
        || new Set(referenceIds).size !== referenceIds.length
        || [...referenceIds].sort().join('\n') !== [...(family.evidenceIds ?? [])].sort().join('\n')) {
        issue(issues, 'EVIDENCE_SOURCE_BINDING_MISMATCH', `${familyPath}.sourceRefs`, 'source references must bind every and only family evidence ID');
      }
      const expectedRoles = [...(EVIDENCE_SOURCE_ROLES_BY_CLASS[record.actionClass]?.[family.family] ?? [])].sort();
      const actualRoles = family.sourceRefs.map((reference) => reference?.sourceRole).sort();
      if (actualRoles.join('\n') !== expectedRoles.join('\n')) {
        issue(issues, 'EVIDENCE_SOURCE_ROLE_SET_MISMATCH', `${familyPath}.sourceRefs`, 'source roles must match the exact class and family denominator');
      }
      family.sourceRefs.forEach((reference, sourceIndex) => {
        if (reference?.ownerId !== evidenceSourceOwnerFor(record.actionClass, reference?.sourceRole)) {
          issue(issues, 'EVIDENCE_SOURCE_OWNER_MISMATCH', `${familyPath}.sourceRefs[${sourceIndex}].ownerId`, 'source role must remain bound to its canonical owner');
        }
        if (isUtcMs(reference?.observedAtMs) && isUtcMs(family.producedAtMs)
          && reference.observedAtMs > family.producedAtMs) {
          issue(issues, 'EVIDENCE_PRODUCED_BEFORE_SOURCE', familyPath, 'derived evidence cannot predate a source it claims to verify');
        }
      });
    }
    if (!uniqueIds(family.dependencyEvidenceIds)) issue(issues, 'EVIDENCE_DEPENDENCIES_INVALID', `${familyPath}.dependencyEvidenceIds`, 'dependencies must be bounded unique evidence IDs');
    if (!uniqueIds(family.reasonCodes) || family.reasonCodes.length === 0) issue(issues, 'EVIDENCE_REASON_CODES_INVALID', `${familyPath}.reasonCodes`, 'reason codes must be a bounded non-empty unique set');
    for (const reason of Array.isArray(family.reasonCodes) ? family.reasonCodes : []) {
      if (!CODE.test(reason) || !EVIDENCE_REASON_CODES.includes(reason)) issue(issues, 'EVIDENCE_REASON_CODE_INVALID', `${familyPath}.reasonCodes`, 'reason code must be in the finite S2 vocabulary');
      if (ACTION_EVIDENCE_ASSERTIONS.includes(family.assertion)
        && !EVIDENCE_REASON_CODES_BY_ASSERTION[family.assertion].includes(reason)) {
        issue(issues, 'EVIDENCE_REASON_ASSERTION_MISMATCH', `${familyPath}.reasonCodes`, 'reason code must be coherent with the declared assertion');
      }
    }
    validateActor(family.producedBy, 'PRODUCER', `${familyPath}.producedBy`, issues);
    const primaryRole = EVIDENCE_SOURCE_ROLES_BY_CLASS[record.actionClass]?.[family.family]?.[0];
    if (family.producedBy?.ownerId !== evidenceSourceOwnerFor(record.actionClass, primaryRole)) {
      issue(issues, 'EVIDENCE_PRODUCER_OWNER_MISMATCH', `${familyPath}.producedBy.ownerId`, 'derived evidence producer must remain bound to the primary source owner');
    }
    if (family.verifiedBy !== null) validateActor(family.verifiedBy, 'VERIFIER', `${familyPath}.verifiedBy`, issues);
    if (!isUtcMs(family.producedAtMs) || (family.verifiedAtMs !== null && !isUtcMs(family.verifiedAtMs)) || !isUtcMs(family.expiresAtMs)) issue(issues, 'EVIDENCE_TIME_INVALID', familyPath, 'evidence times must be valid UTC milliseconds or allowed null verifier time');
    if (!isPositiveSafeInteger(family.maximumAgeMs)) issue(issues, 'EVIDENCE_MAXIMUM_AGE_INVALID', `${familyPath}.maximumAgeMs`, 'maximum age must be a positive safe integer');
    if ((family.verifiedBy === null) !== (family.verifiedAtMs === null)) issue(issues, 'VERIFIER_TIME_BINDING_INVALID', familyPath, 'verifier identity and verification time must both be present or both be null');
    if (isUtcMs(family.producedAtMs) && family.verifiedAtMs !== null
      && isUtcMs(family.verifiedAtMs) && family.producedAtMs > family.verifiedAtMs) {
      issue(issues, 'EVIDENCE_TIMELINE_INCOHERENT', familyPath, 'production must not follow independent verification');
    }
    const latestActionFactObservation = latestActionFactObservationForFamily(record, family.family);
    if (latestActionFactObservation > 0 && isUtcMs(family.verifiedAtMs)
      && family.verifiedAtMs < latestActionFactObservation) {
      issue(issues, 'EVIDENCE_VERIFIED_BEFORE_ACTION_FACT', familyPath, 'family verification cannot predate action facts consumed by the derived envelope');
    }
    if (family.family === 'LIFECYCLE_STATE_AND_OUTCOME'
      && ['REPAIR_STEP', 'HALT'].includes(record.actionClass)) {
      const observation = record.actionClass === 'REPAIR_STEP'
        ? record.actionFacts?.postconditionObservedAtMs
        : record.actionFacts?.readbackObservedAtMs;
      const receiptObservation = Array.isArray(family.sourceRefs)
        ? family.sourceRefs.find((reference) => reference?.sourceRole === 'LIFECYCLE')?.observedAtMs
        : null;
      if (isUtcMs(observation) && isUtcMs(receiptObservation)
        && (observation <= receiptObservation
          || (isUtcMs(family.verifiedAtMs) && observation > family.verifiedAtMs))) {
        issue(issues, 'POSTACTION_EVIDENCE_TIMELINE_INVALID', familyPath, 'readback or postcondition must follow the lifecycle receipt and not follow verification');
      }
    }
  });
  for (const [index, family] of families.entries()) {
    const dependencies = Array.isArray(family?.dependencyEvidenceIds) ? family.dependencyEvidenceIds : [];
    for (const dependency of dependencies) {
      if (!evidenceIds.has(dependency)) issue(issues, 'EVIDENCE_DEPENDENCY_UNKNOWN', `${path}[${index}].dependencyEvidenceIds`, 'dependency must reference evidence in the same record');
      if (family.evidenceIds?.includes(dependency)) issue(issues, 'EVIDENCE_DEPENDENCY_SELF_REFERENCE', `${path}[${index}].dependencyEvidenceIds`, 'family evidence cannot depend on itself');
    }
    const actualDependencyFamilies = new Set(dependencies.map((dependency) => evidenceToFamily.get(dependency)));
    for (const requiredFamily of REQUIRED_EVIDENCE_DEPENDENCY_FAMILIES[family?.family] ?? []) {
      if (!actualDependencyFamilies.has(requiredFamily)) {
        issue(issues, 'EVIDENCE_REQUIRED_DEPENDENCY_MISSING', `${path}[${index}].dependencyEvidenceIds`, 'family must retain every required upstream evidence dependency');
      }
    }
  }
  return evidenceIds;
}

function validateInvalidations(invalidations, evidenceIds, path, issues) {
  if (!Array.isArray(invalidations) || invalidations.length > ACTION_EVIDENCE_LIMITS.maxInvalidations) {
    issue(issues, 'INVALIDATIONS_INVALID', path, 'invalidations must be a bounded array');
    return;
  }
  const ids = new Set();
  invalidations.forEach((invalidation, index) => {
    const invalidationPath = `${path}[${index}]`;
    if (!hasExactKeys(invalidation, INVALIDATION_KEYS)) {
      issue(issues, 'INVALIDATION_FIELD_SET_MISMATCH', invalidationPath, 'invalidation field set is closed');
      return;
    }
    if (!isId(invalidation.invalidationId) || ids.has(invalidation.invalidationId)) issue(issues, 'INVALIDATION_ID_INVALID', `${invalidationPath}.invalidationId`, 'invalidation IDs must be stable and unique');
    ids.add(invalidation.invalidationId);
    if (!evidenceIds.has(invalidation.evidenceId)) issue(issues, 'INVALIDATION_EVIDENCE_UNKNOWN', `${invalidationPath}.evidenceId`, 'invalidation must target evidence in the same record');
    if (!isId(invalidation.producerEvidenceId)) issue(issues, 'INVALIDATION_PRODUCER_EVIDENCE_INVALID', `${invalidationPath}.producerEvidenceId`, 'invalidation producer evidence ID is required');
    if (!isUtcMs(invalidation.invalidatedAtMs)) issue(issues, 'INVALIDATION_TIME_INVALID', `${invalidationPath}.invalidatedAtMs`, 'invalidation time must be valid UTC milliseconds');
    if (!INVALIDATION_REASON_CODES.includes(invalidation.reasonCode)) issue(issues, 'INVALIDATION_REASON_INVALID', `${invalidationPath}.reasonCode`, 'invalidation reason is unsupported');
  });
}

function validateRecord(record, path, issues) {
  if (!hasExactKeys(record, RECORD_KEYS)) {
    issue(issues, 'RECORD_FIELD_SET_MISMATCH', path, 'action evidence record field set is closed');
    return;
  }
  if (!isId(record.recordId)) issue(issues, 'RECORD_ID_INVALID', `${path}.recordId`, 'record ID is required');
  if (!ACTION_EVIDENCE_CLASSES.includes(record.actionClass)) {
    issue(issues, 'ACTION_CLASS_INVALID', `${path}.actionClass`, 'action class is unsupported');
    return;
  }
  if (canonicalStringify(record.actionBinding) !== canonicalStringify(FROZEN_ACTION_BINDINGS[record.actionClass])) issue(issues, 'ACTION_BINDING_MISMATCH', `${path}.actionBinding`, 'record must bind the exact frozen L owner discriminant');
  validateIdentity(record.identity, record.actionClass, `${path}.identity`, issues);
  if (!isPlainRecord(record.identity)) return;
  const expectedSubjectDigest = sha256Hex(canonicalStringify({
    actionClass: record.actionClass,
    actionBinding: record.actionBinding,
    identity: record.identity,
  }));
  if (record.subjectDigest !== expectedSubjectDigest) issue(issues, 'SUBJECT_DIGEST_MISMATCH', `${path}.subjectDigest`, 'subject digest must content-bind action class, frozen binding, and exact identity');
  validateActionReference(record.actionReference, record, `${path}.actionReference`, issues);
  validateVersions(record.versions, record.actionClass, `${path}.versions`, issues);
  if (!isUtcMs(record.createdAtMs) || !isUtcMs(record.expiresAtMs)) issue(issues, 'RECORD_TIME_INVALID', path, 'record creation and expiry must be valid UTC milliseconds');
  if (isUtcMs(record.createdAtMs) && isUtcMs(record.expiresAtMs)
    && record.createdAtMs >= record.expiresAtMs) issue(issues, 'RECORD_TIMELINE_INVALID', path, 'record creation must precede expiry');
  if (!isPositiveSafeInteger(record.maximumAgeMs)) issue(issues, 'RECORD_MAXIMUM_AGE_INVALID', `${path}.maximumAgeMs`, 'record maximum age must be a positive safe integer');
  validateTemporalContext(record.temporalContext, record, `${path}.temporalContext`, issues);
  validateOwnerReferences(record.ownerReferences, record, `${path}.ownerReferences`, issues);
  validateActionFacts(record.actionFacts, record, `${path}.actionFacts`, issues);
  validateScenario(record.scenarioEnvelope, `${path}.scenarioEnvelope`, issues);
  const evidenceIds = validateFamilies(record.families, record, `${path}.families`, issues);
  const actionSource = Array.isArray(record.families)
    ? record.families
      .find((family) => family?.family === 'ACTION_BINDING')
      ?.sourceRefs?.find((reference) => reference?.sourceRole === 'ACTION')
    : null;
  if (!actionSource || actionSource.ownerId !== record.actionReference?.ownerId
    || actionSource.digest !== record.actionReference?.digest) {
    issue(issues, 'ACTION_SOURCE_BINDING_MISMATCH', `${path}.families`, 'ACTION_BINDING source must bind the exact action owner and digest');
  }
  const actionBindingFamily = Array.isArray(record.families)
    ? record.families.find((family) => family?.family === 'ACTION_BINDING')
    : null;
  const bindingInputs = [record.actionReference, ...(Array.isArray(record.ownerReferences) ? record.ownerReferences : [])];
  if (actionBindingFamily && bindingInputs.some((reference) => (
    isUtcMs(reference?.observedAtMs) && isUtcMs(actionBindingFamily.producedAtMs)
      && reference.observedAtMs > actionBindingFamily.producedAtMs
  ))) {
    issue(issues, 'EVIDENCE_PRODUCED_BEFORE_SOURCE', `${path}.families`, 'ACTION_BINDING evidence cannot predate its action or owner-decision source');
  }
  validateFencing(record.fencingContext, record, `${path}.fencingContext`, issues);
  validateAssumptions(record.activeAssumptions, evidenceIds, `${path}.activeAssumptions`, issues);
  validateInvariantResults(record.invariantResults, evidenceIds, `${path}.invariantResults`, issues);
  validateInvalidations(record.invalidations, evidenceIds, `${path}.invalidations`, issues);
}

function validateActionEvidenceEnvelopeUnsafe(envelope) {
  const issues = [];
  scanForbiddenKeys(envelope, '', issues);
  if (issues.some((entry) => STRUCTURAL_SCAN_ISSUES.has(entry.code))) return validationResult(issues);
  if (!hasExactKeys(envelope, ENVELOPE_KEYS)) {
    issue(issues, 'ENVELOPE_FIELD_SET_MISMATCH', '', 'action evidence envelope field set is closed');
  } else {
    if (envelope.schemaVersion !== ACTION_EVIDENCE_SCHEMA_VERSION) issue(issues, 'SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion', 'action evidence schema version is unsupported');
    if (!isId(envelope.revision)) issue(issues, 'ENVELOPE_REVISION_INVALID', 'revision', 'envelope revision is required');
    if (envelope.truthLabel !== ACTION_EVIDENCE_TRUTH_LABEL) issue(issues, 'TRUTH_LABEL_OVERCLAIM', 'truthLabel', 'packet evidence must remain SYNTHETIC_ONLY');
    if (envelope.useClass !== ACTION_EVIDENCE_USE_CLASS) issue(issues, 'USE_CLASS_OVERCLAIM', 'useClass', 'packet evidence is supporting evidence only');
    if (envelope.authorityEffect !== ACTION_EVIDENCE_AUTHORITY_EFFECT) issue(issues, 'AUTHORITY_EFFECT_FORBIDDEN', 'authorityEffect', 'action evidence authority effect must be NONE');
    if (!hasExactKeys(envelope.sourceCommits, SOURCE_COMMIT_KEYS)) {
      issue(issues, 'SOURCE_COMMIT_FIELD_SET_MISMATCH', 'sourceCommits', 'source commit set is closed');
    } else {
      if (envelope.sourceCommits.coreScaffold !== FROZEN_CORE_COMMIT) issue(issues, 'CORE_COMMIT_MISMATCH', 'sourceCommits.coreScaffold', 'core scaffold commit mismatch');
      if (envelope.sourceCommits.hazardContracts !== FROZEN_HAZARD_COMMIT) issue(issues, 'HAZARD_COMMIT_MISMATCH', 'sourceCommits.hazardContracts', 'hazard contract commit mismatch');
      if (envelope.sourceCommits.frozenL !== FROZEN_L_COMMIT) issue(issues, 'FROZEN_L_COMMIT_MISMATCH', 'sourceCommits.frozenL', 'frozen L commit mismatch');
    }
    validateRecord(envelope.record, 'record', issues);
  }
  return validationResult(issues);
}

export function validateActionEvidenceEnvelope(envelope) {
  try {
    const snapshot = snapshotPlainData(envelope);
    if (!snapshot.ok) {
      const issues = [];
      issue(issues, snapshot.issueCode, '', 'action evidence must be stable bounded plain data');
      return validationResult(issues);
    }
    return validateActionEvidenceEnvelopeUnsafe(snapshot.value);
  } catch {
    const issues = [];
    issue(issues, 'VALIDATION_EXCEPTION', '', 'malformed action evidence could not satisfy the total closed validator');
    return validationResult(issues);
  }
}

function validateActionEvidenceFixtureBundleUnsafe(bundle) {
  const issues = [];
  scanForbiddenKeys(bundle, '', issues);
  if (issues.some((entry) => STRUCTURAL_SCAN_ISSUES.has(entry.code))) return validationResult(issues);
  if (!hasExactKeys(bundle, FIXTURE_BUNDLE_KEYS)) {
    issue(issues, 'FIXTURE_BUNDLE_FIELD_SET_MISMATCH', '', 'fixture bundle field set is closed');
  } else {
    if (bundle.schemaVersion !== ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA_VERSION) issue(issues, 'FIXTURE_BUNDLE_SCHEMA_UNSUPPORTED', 'schemaVersion', 'fixture bundle schema is unsupported');
    if (bundle.truthLabel !== ACTION_EVIDENCE_TRUTH_LABEL) issue(issues, 'TRUTH_LABEL_OVERCLAIM', 'truthLabel', 'fixture bundle must remain SYNTHETIC_ONLY');
    if (bundle.useClass !== ACTION_EVIDENCE_USE_CLASS) issue(issues, 'USE_CLASS_OVERCLAIM', 'useClass', 'fixture bundle is supporting evidence only');
    if (bundle.authorityEffect !== ACTION_EVIDENCE_AUTHORITY_EFFECT) issue(issues, 'AUTHORITY_EFFECT_FORBIDDEN', 'authorityEffect', 'fixture bundle authority effect must be NONE');
    if (!Array.isArray(bundle.envelopes) || bundle.envelopes.length !== ACTION_EVIDENCE_CLASSES.length) {
      issue(issues, 'ACTION_CLASS_DENOMINATOR_MISMATCH', 'envelopes', 'fixture bundle requires exactly one single-action envelope for each class');
    } else {
      bundle.envelopes.forEach((envelope, index) => {
        const validation = validateActionEvidenceEnvelope(envelope);
        validation.issues.forEach((nested) => issue(
          issues,
          nested.code,
          `envelopes[${index}]${nested.path ? `.${nested.path}` : ''}`,
          nested.message,
        ));
      });
      const classes = bundle.envelopes.map((envelope) => envelope?.record?.actionClass).sort();
      if (classes.join('\n') !== [...ACTION_EVIDENCE_CLASSES].sort().join('\n')) issue(issues, 'ACTION_CLASS_SET_MISMATCH', 'envelopes', 'fixture bundle action class denominator must be complete and unique');
      const recordIds = bundle.envelopes.map((envelope) => envelope?.record?.recordId);
      if (recordIds.some((recordId) => !isId(recordId)) || new Set(recordIds).size !== recordIds.length) issue(issues, 'RECORD_IDS_NOT_UNIQUE', 'envelopes', 'fixture record IDs must be stable and unique');
    }
  }
  return validationResult(issues);
}

export function validateActionEvidenceFixtureBundle(bundle) {
  try {
    const snapshot = snapshotPlainData(bundle);
    if (!snapshot.ok) {
      const issues = [];
      issue(issues, snapshot.issueCode, '', 'fixture bundle must be stable bounded plain data');
      return validationResult(issues);
    }
    return validateActionEvidenceFixtureBundleUnsafe(snapshot.value);
  } catch {
    const issues = [];
    issue(issues, 'VALIDATION_EXCEPTION', '', 'malformed fixture bundle could not satisfy the total closed validator');
    return validationResult(issues);
  }
}

function validateActionEvidenceResultUnsafe(result) {
  const issues = [];
  scanForbiddenKeys(result, '', issues);
  if (issues.some((entry) => STRUCTURAL_SCAN_ISSUES.has(entry.code))) return validationResult(issues);
  if (!hasExactKeys(result, RESULT_KEYS)) {
    issue(issues, 'RESULT_FIELD_SET_MISMATCH', '', 'action-evidence result field set is closed');
    return validationResult(issues);
  }
  if (result.schemaVersion !== ACTION_EVIDENCE_RESULT_SCHEMA_VERSION) issue(issues, 'RESULT_SCHEMA_UNSUPPORTED', 'schemaVersion', 'result schema is unsupported');
  if (result.truthLabel !== ACTION_EVIDENCE_TRUTH_LABEL) issue(issues, 'TRUTH_LABEL_OVERCLAIM', 'truthLabel', 'result must remain SYNTHETIC_ONLY');
  if (result.useClass !== ACTION_EVIDENCE_USE_CLASS) issue(issues, 'USE_CLASS_OVERCLAIM', 'useClass', 'result is supporting evidence only');
  if (result.authorityEffect !== ACTION_EVIDENCE_AUTHORITY_EFFECT) issue(issues, 'AUTHORITY_EFFECT_FORBIDDEN', 'authorityEffect', 'result authority effect must be NONE');
  if (!ACTION_EVIDENCE_STATUSES.includes(result.status)) issue(issues, 'RESULT_STATUS_INVALID', 'status', 'result status is unsupported');
  if (result.commandsIssued !== 0) issue(issues, 'RESULT_COMMAND_COUNT_FORBIDDEN', 'commandsIssued', 'action evidence can issue no commands');
  if (result.canonicalRiskReductionUnaffected !== true) issue(issues, 'RESULT_CANONICAL_RISK_EFFECT_FORBIDDEN', 'canonicalRiskReductionUnaffected', 'canonical risk-reduction authority must remain unaffected');
  if (!uniqueIds(result.reasonCodes) || result.reasonCodes.length === 0) issue(issues, 'RESULT_REASON_CODES_INVALID', 'reasonCodes', 'result reason codes must be bounded and non-empty');
  if (!uniqueIds(result.invalidatedEvidenceIds, ACTION_EVIDENCE_LIMITS.maxInvalidations)) issue(issues, 'RESULT_INVALIDATED_IDS_INVALID', 'invalidatedEvidenceIds', 'invalidated evidence IDs must be bounded and unique');

  const diagnostic = Array.isArray(result.familyResults) && result.familyResults.length === 0;
  if (diagnostic) {
    if (result.status !== 'UNKNOWN'
      || !Array.isArray(result.reasonCodes)
      || !result.reasonCodes.some((reason) => ['SCHEMA_INVALID', 'EVALUATION_TIME_INVALID'].includes(reason))
      || result.reasonCodes.some((reason) => (
        RESULT_PASS_REASON_CODES.has(reason) || RESULT_FAIL_REASON_CODES.has(reason)
      ))
      || !(result.recordId === null || isId(result.recordId))
      || !(result.actionClass === null || ACTION_EVIDENCE_CLASSES.includes(result.actionClass))
      || !(result.evaluatedAtMs === null || isUtcMs(result.evaluatedAtMs))
      || result.nextCurrentnessBoundaryAtMs !== null
      || !Array.isArray(result.assumptionResults) || result.assumptionResults.length !== 0
      || !Array.isArray(result.invariantResults) || result.invariantResults.length !== 0) {
      issue(issues, 'RESULT_DIAGNOSTIC_INVALID', '', 'empty-family results are permitted only for fail-closed schema or clock diagnostics');
    }
    return validationResult(issues);
  }

  validateResultReasonStatus(result.status, result.reasonCodes, 'reasonCodes', issues);

  if (!isId(result.recordId) || !ACTION_EVIDENCE_CLASSES.includes(result.actionClass)
    || !isUtcMs(result.evaluatedAtMs)) issue(issues, 'RESULT_BINDING_INVALID', '', 'complete result requires record, action-class, and evaluation-time binding');
  if (!(result.nextCurrentnessBoundaryAtMs === null || isUtcMs(result.nextCurrentnessBoundaryAtMs))) issue(issues, 'RESULT_CURRENTNESS_BOUNDARY_INVALID', 'nextCurrentnessBoundaryAtMs', 'currentness boundary must be null or valid UTC milliseconds');
  if (result.status === 'PASS'
    && (!isUtcMs(result.nextCurrentnessBoundaryAtMs)
      || result.nextCurrentnessBoundaryAtMs <= result.evaluatedAtMs)) issue(issues, 'PASS_CURRENTNESS_BOUNDARY_MISSING', 'nextCurrentnessBoundaryAtMs', 'PASS requires a future currentness boundary');

  const requiredFamilies = REQUIRED_EVIDENCE_FAMILIES[result.actionClass] ?? [];
  if (!Array.isArray(result.familyResults)
    || result.familyResults.length !== requiredFamilies.length) {
    issue(issues, 'RESULT_FAMILY_DENOMINATOR_MISMATCH', 'familyResults', 'complete result requires every and only class-required family');
  } else {
    const actualFamilies = result.familyResults.map((entry) => entry?.family).sort();
    if (actualFamilies.join('\n') !== [...requiredFamilies].sort().join('\n')) issue(issues, 'RESULT_FAMILY_SET_MISMATCH', 'familyResults', 'result family set must match the class denominator');
    result.familyResults.forEach((entry, index) => {
      const path = `familyResults[${index}]`;
      if (!hasExactKeys(entry, FAMILY_RESULT_KEYS)) {
        issue(issues, 'RESULT_FAMILY_FIELD_SET_MISMATCH', path, 'family result field set is closed');
        return;
      }
      if (!ACTION_EVIDENCE_FAMILIES.includes(entry.family) || !ACTION_EVIDENCE_STATUSES.includes(entry.status)) issue(issues, 'RESULT_FAMILY_VALUE_INVALID', path, 'family result identity or status is invalid');
      if (!uniqueIds(entry.reasonCodes) || entry.reasonCodes.length === 0
        || !uniqueIds(entry.evidenceIds) || entry.evidenceIds.length === 0
        || !uniqueIds(entry.dependencyEvidenceIds)
        || !uniqueIds(entry.invalidationIds, ACTION_EVIDENCE_LIMITS.maxInvalidations)
        || !isUtcMs(entry.expiresAtMs)) issue(issues, 'RESULT_FAMILY_CONTENT_INVALID', path, 'family result content is invalid');
      validateResultReasonStatus(entry.status, entry.reasonCodes, `${path}.reasonCodes`, issues);
    });
  }

  const validateSupportResults = (values, kind) => {
    const expectedKeys = kind === 'ASSUMPTION' ? ASSUMPTION_RESULT_KEYS : INVARIANT_EVALUATION_RESULT_KEYS;
    const idKey = kind === 'ASSUMPTION' ? 'assumptionId' : 'invariantId';
    if (!Array.isArray(values) || values.length === 0) {
      issue(issues, `RESULT_${kind}_DENOMINATOR_INVALID`, `${kind.toLowerCase()}Results`, `${kind.toLowerCase()} results must be non-empty`);
      return;
    }
    const ids = new Set();
    values.forEach((entry, index) => {
      const path = `${kind.toLowerCase()}Results[${index}]`;
      if (!hasExactKeys(entry, expectedKeys)) {
        issue(issues, `RESULT_${kind}_FIELD_SET_MISMATCH`, path, `${kind.toLowerCase()} result field set is closed`);
        return;
      }
      if (!isId(entry[idKey]) || ids.has(entry[idKey]) || !ACTION_EVIDENCE_STATUSES.includes(entry.status)
        || !uniqueIds(entry.reasonCodes) || entry.reasonCodes.length === 0
        || !uniqueIds(entry.evidenceIds) || entry.evidenceIds.length === 0
        || !uniqueIds(entry.invalidationIds, ACTION_EVIDENCE_LIMITS.maxInvalidations)
        || !isUtcMs(entry.expiresAtMs)) issue(issues, `RESULT_${kind}_CONTENT_INVALID`, path, `${kind.toLowerCase()} result content is invalid`);
      validateResultReasonStatus(entry.status, entry.reasonCodes, `${path}.reasonCodes`, issues);
      ids.add(entry[idKey]);
    });
  };
  validateSupportResults(result.assumptionResults, 'ASSUMPTION');
  validateSupportResults(result.invariantResults, 'INVARIANT');

  if (Array.isArray(result.familyResults) && Array.isArray(result.assumptionResults)
    && Array.isArray(result.invariantResults)) {
    const children = [...result.familyResults, ...result.assumptionResults, ...result.invariantResults];
    const expectedStatus = children.some((entry) => entry?.status === 'FAIL') ? 'FAIL'
      : children.some((entry) => entry?.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
    if (result.status !== expectedStatus) issue(issues, 'RESULT_AGGREGATE_STATUS_MISMATCH', 'status', 'result status must be derived from child statuses');
    const expectedReasons = [...new Set(children
      .flatMap((entry) => entry?.reasonCodes ?? [])
      .filter((reason) => result.status === 'PASS' || !RESULT_PASS_REASON_CODES.has(reason)))].sort();
    if (Array.isArray(result.reasonCodes)
      && expectedReasons.join('\n') !== [...result.reasonCodes].sort().join('\n')) issue(issues, 'RESULT_REASON_UNION_MISMATCH', 'reasonCodes', 'result reasons must equal the child reason union');
  }
  return validationResult(issues);
}

export function validateActionEvidenceResult(result) {
  try {
    const snapshot = snapshotPlainData(result);
    if (!snapshot.ok) {
      const issues = [];
      issue(issues, snapshot.issueCode, '', 'action-evidence result must be stable bounded plain data');
      return validationResult(issues);
    }
    return validateActionEvidenceResultUnsafe(snapshot.value);
  } catch {
    const issues = [];
    issue(issues, 'VALIDATION_EXCEPTION', '', 'malformed action-evidence result could not satisfy the total closed validator');
    return validationResult(issues);
  }
}

export const ACTION_EVIDENCE_VALIDATION_RULES = deepFreeze({
  closedSchema: true,
  plainDataOnly: true,
  completeActionClassDenominator: ACTION_EVIDENCE_CLASSES,
  sourceBindings: FROZEN_ACTION_BINDINGS,
  requiredFamilies: REQUIRED_EVIDENCE_FAMILIES,
  authorityFieldsForbidden: [...FORBIDDEN_AUTHORITY_KEYS].sort(),
  secretLikeFieldsForbidden: true,
});
