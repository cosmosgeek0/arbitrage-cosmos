import {
  CONFORMANCE_VERDICTS,
  MAPPING_ATOMICITIES,
  MAPPING_STATUSES,
  REPLAY_STATUSES,
} from './vocabularies.mjs';
import {
  boundedString,
  boundedStringArray,
  enumValue,
  exactKeys,
  gitSha,
  isPlainObject,
  result,
  safeInteger,
  sha256,
  stableId,
} from './validation.mjs';
import {
  MODEL_MANIFEST_BY_ID,
  MODEL_MANIFEST_SCHEMA,
} from '../fixtures/model-manifest.mjs';

export const CONFORMANCE_MAPPING_SCHEMA = 'ip-assurance.s3.conformance-map.v1';
export const MAPPING_CATEGORIES = Object.freeze(['STATE', 'ACTION', 'INVARIANT', 'POSTCONDITION']);

function modelElements(rows) {
  return Object.freeze(rows.map(([category, modelElementId]) => Object.freeze({ category, modelElementId })));
}

// This is the packet-owned abstraction surface. A caller cannot substitute a
// convenient set of model-element strings and call it independent readback.
export const MODEL_ELEMENT_MANIFEST_BY_ID = Object.freeze({
  'S3-M01-AMBIGUOUS-MUTATION': modelElements([
    ['STATE', 'INTENT_DURABLE|IN_FLIGHT|AMBIGUOUS|LOOKUP|TERMINAL'],
    ['ACTION', 'PERSIST_INTENT|DISPATCH_MUTATION|BEGIN_RECONCILIATION|LOOKUP_*'],
    ['INVARIANT', 'S3-SAF-03|S3-SAF-04|S3-SAF-05|S3-SAF-06'],
    ['POSTCONDITION', 'AUTHORITATIVE_APPLIED|AUTHORITATIVE_ABSENT|DURABLE_UNRESOLVED'],
  ]),
  'S3-M02-TWO-LEG-RECOVERY': modelElements([
    ['STATE', 'FIRST_IN_FLIGHT|PARTIAL|CANCEL_PENDING|AMBIGUOUS|RECOVERY|TERMINAL'],
    ['ACTION', 'SUBMIT_FIRST_LEG|REQUEST_CANCEL|LATE_FILL|HEDGE_RESIDUAL|CLOSE_EXPOSED_LEG'],
    ['INVARIANT', 'S3-SAF-04|S3-SAF-06|S3-SAF-07'],
    ['POSTCONDITION', 'HEDGED|CLOSED|UNRESOLVED'],
  ]),
  'S3-M03-EXECUTION-FENCING': modelElements([
    ['STATE', 'EXECUTION_LEASE_AND_EPOCH'],
    ['ACTION', 'OVERLAP_ACQUIRE_AND_REVOKE'],
    ['INVARIANT', 'S3-SAF-01|S3-SAF-02|S3-SAF-03'],
    ['POSTCONDITION', 'LOST_OWNER_REVOKED_OR_UNRESOLVED'],
  ]),
  'S3-M04-REPAIR-CAMPAIGN': modelElements([
    ['STATE', 'DURABLE_REPAIR_CAMPAIGN'],
    ['ACTION', 'RETRY_ROLLBACK_COMPENSATE_QUARANTINE'],
    ['INVARIANT', 'S3-SAF-01|S3-SAF-02|S3-SAF-06|S3-SAF-09|S3-M04-INV-01'],
    ['POSTCONDITION', 'INDEPENDENT_RECOVERY_OR_VISIBLE_TERMINAL'],
  ]),
  'S3-M05-BORROW-LIABILITY': modelElements([
    ['STATE', 'BORROW_SHORT_INTEREST_REPAY_LIABILITY'],
    ['ACTION', 'DURABLE_MUTATION_AND_RECONCILIATION'],
    ['INVARIANT', 'S3-SAF-04|S3-SAF-05|S3-SAF-06|S3-SAF-07'],
    ['POSTCONDITION', 'AUTHORITATIVE_ZERO_OR_DURABLE_UNRESOLVED'],
  ]),
  'S3-M06-HALT-RISK-REDUCTION': modelElements([
    ['STATE', 'OPEN|HALT_NEW_EXPOSURE|UNKNOWN'],
    ['ACTION', 'EVALUATE_CANONICAL_RISK|COMMIT_OR_BLOCK_REDUCTION'],
    ['INVARIANT', 'S3-SAF-08|S3-SAF-10|S3-M06-INV-01'],
    ['POSTCONDITION', 'APPLIED_REDUCTION|BLOCKED|UNRESOLVED'],
  ]),
  'S3-M07-CANCELLATION-BOUNDARY': modelElements([
    ['STATE', 'LOCAL_CHILD_VS_EXTERNAL_MUTATION'],
    ['ACTION', 'CANCEL_OBSERVE_DETACH_HANDOFF_RECONCILE'],
    ['INVARIANT', 'S3-SAF-01|S3-SAF-02|S3-SAF-03|S3-SAF-04|S3-SAF-06'],
    ['POSTCONDITION', 'CANCELLED_OR_AUTHORITATIVE_EXTERNAL_TERMINAL'],
  ]),
  'S3-M08-ORDER-POLICY': modelElements([
    ['STATE', 'RAW|EVALUATE|PLANNED|REJECTED'],
    ['ACTION', 'PARSE_POLICY_ENVELOPE'],
    ['ACTION', 'EVALUATE_GLOBAL_AUTHORITY_AND_DEPENDENCIES'],
    ['ACTION', 'VALIDATE_CANCEL_REPLACE_AND_RECOVERY_GRAPH'],
    ['INVARIANT', 'S3-SAF-08|S3-SAF-11|S3-SAF-12|S3-SAF-13|S3-SAF-14'],
    ['POSTCONDITION', 'NON_SENDABLE_PLANNED_OR_FAIL_CLOSED_REJECTED'],
  ]),
  'S3-M09-NORMAL-BASIS-LIFECYCLE': modelElements([
    ['STATE', 'FOUNDATION_PLAN_AND_LEG_LIFECYCLES'],
    ['ACTION', 'PLAN_PREFLIGHT_OPEN_CLOSE_TRANSITIONS'],
    ['ACTION', 'LEG_SUBMIT_FILL_CANCEL_AMBIGUITY_TRANSITIONS'],
    ['ACTION', 'NORMAL_BASIS_TWIN_OBSERVATION_AND_AGREEMENT'],
    ['ACTION', 'RECONCILE_OR_REPAIR_RESIDUAL'],
    ['INVARIANT', 'S3-SAF-03|S3-SAF-06|S3-SAF-07|S3-SAF-12|S3-SAF-13|S3-SAF-14|S3-SAF-15|S3-M09-INV-01'],
    ['POSTCONDITION', 'HEDGED_OPEN|CLOSED|BLOCKED|DURABLE_UNRESOLVED'],
  ]),
  'S3-M10-REVERSE-BASIS-LIABILITY': modelElements([
    ['STATE', 'DERIVED_REVERSE_BASIS_STAGE_AND_EVENT_FOLD'],
    ['ACTION', 'OBSERVE_BORROW_LIABILITY_AND_REPAY'],
    ['ACTION', 'OBSERVE_ENTRY_HEDGE_EXIT_AND_COVER'],
    ['ACTION', 'OBSERVE_RECOVERY_CLOSURE_OR_MANUAL_EVIDENCE'],
    ['ACTION', 'DERIVE_REVERSE_BASIS_STAGE'],
    ['INVARIANT', 'S3-SAF-06|S3-SAF-07|S3-SAF-12|S3-SAF-13|S3-SAF-14|S3-SAF-15|S3-M10-INV-01|S3-M10-INV-02'],
    ['POSTCONDITION', 'EXACT_ZERO_LIABILITY_CLOSURE_OR_VISIBLE_RECOVERY'],
  ]),
  'S3-M11-VOLUME-LIFECYCLE': modelElements([
    ['STATE', 'ABSENT|PROBE|CONFIRM|ADD_ALLOWED|HOLD|REDUCE|EXIT|RECOVERY_REQUIRED'],
    ['ACTION', 'PLAN_RECORD_ONLY_ENTRY_OR_ADD'],
    ['ACTION', 'CLASSIFY_PROTECTION_AND_PLAN_REDUCE_OR_EXIT'],
    ['ACTION', 'SETTLE_TWIN_OR_ENTER_RECOVERY'],
    ['ACTION', 'RESOLVE_VOLUME_RECOVERY'],
    ['INVARIANT', 'S3-SAF-06|S3-SAF-08|S3-SAF-11|S3-SAF-12|S3-SAF-13|S3-SAF-14|S3-M11-INV-01'],
    ['POSTCONDITION', 'FLAT_BLOCKED_ABSENT|SETTLED_STAGE|PROTECTIVE_EXIT|VISIBLE_RECOVERY'],
  ]),
  'S3-M12-EXCHANGE-TWIN-AMBIGUITY': modelElements([
    ['STATE', 'TWIN_ORDER_CANCEL_CRASH_AND_RECONCILIATION'],
    ['ACTION', 'PREFLIGHT_AND_SINGLE_PLACEMENT'],
    ['ACTION', 'TRADE_CANCEL_RACE_AND_DELIVERY'],
    ['ACTION', 'CRASH_AND_RESTORE_CHECKPOINT'],
    ['ACTION', 'APPLY_EXACT_OR_VISIBLE_UNRESOLVED_RECONCILIATION'],
    ['INVARIANT', 'S3-SAF-03|S3-SAF-05|S3-SAF-06|S3-SAF-11|S3-SAF-13|S3-SAF-14|S3-M12-INV-01|S3-M12-INV-02'],
    ['POSTCONDITION', 'OBSERVED_EXACT_OR_RECOVERY_REQUIRED'],
  ]),
  'S3-M13-DURABLE-CONTROL-REVISION': modelElements([
    ['STATE', 'CONTROL_PREVIEW_JOURNAL_REVISION_PUBLICATION_AND_REPLAY'],
    ['ACTION', 'PREVIEW_AND_CANONICAL_GUARDS'],
    ['ACTION', 'APPEND_INTENT_AND_RESERVE_GLOBAL_REVISION'],
    ['ACTION', 'PREPARE_AND_CONFIRM_CONTROL_EVENT_APPEND'],
    ['ACTION', 'PUBLISH_RESERVED_COMMAND'],
    ['ACTION', 'FINALIZE_OR_RETAIN_PENDING_AMBIGUITY'],
    ['ACTION', 'RELOAD_AND_REPLAY_DURABLE_RESULT'],
    ['INVARIANT', 'S3-SAF-01|S3-SAF-04|S3-SAF-08|S3-SAF-11|S3-SAF-12|S3-SAF-13|S3-M13-INV-01|S3-M13-INV-02|S3-M13-INV-03'],
    ['POSTCONDITION', 'COMPLETED|REJECTED|PREINTENT_REJECTED|WAITING_L08|PENDING_AMBIGUOUS'],
  ]),
});

// INVARIANT rows enumerate every safety checker in each model. Liveness is
// intentionally mapped through that model's STATE, ACTION, and POSTCONDITION
// rows because progress is a trace obligation, not a state invariant.

const UNKNOWN_VERSION_MARKERS = new Set([
  'UNKNOWN', 'NOT_IMPLEMENTED', 'UNAVAILABLE', 'NOT_APPLICABLE', 'UNVERIFIED',
  'TBD', 'N_A', 'NONE',
]);

const BOUNDARY_MAX_DEPTH = 32;
const BOUNDARY_MAX_NODES = 10_000;
const BOUNDARY_MAX_PROPERTIES = 1_024;

function boundaryFailure(path, code, detail) {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([Object.freeze({ path, code, detail })]),
  });
}

// Evaluation is a trust boundary: validation and verdict selection must never
// observe two different values from the same caller-owned object. Descriptor
// reads avoid invoking getters; accepted data is copied into a recursively
// frozen, prototype-neutral snapshot before any schema or semantic read.
function snapshotBoundary(value, rootPath) {
  const memo = new WeakMap();
  const active = new WeakSet();
  const state = { nodes: 0 };

  function copy(input, path, depth) {
    if (input === null || ['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof input)) {
      return Object.freeze({ ok: true, value: input });
    }
    if (typeof input !== 'object') {
      return boundaryFailure(path, 'BOUNDARY_VALUE_REJECTED', 'functions and symbols are not valid conformance input');
    }
    if (depth > BOUNDARY_MAX_DEPTH) {
      return boundaryFailure(path, 'BOUNDARY_DEPTH_EXCEEDED', `snapshot depth exceeds ${BOUNDARY_MAX_DEPTH}`);
    }
    if (active.has(input)) {
      return boundaryFailure(path, 'BOUNDARY_CYCLE_REJECTED', 'cyclic conformance input is not permitted');
    }
    if (memo.has(input)) return Object.freeze({ ok: true, value: memo.get(input) });
    state.nodes += 1;
    if (state.nodes > BOUNDARY_MAX_NODES) {
      return boundaryFailure(path, 'BOUNDARY_NODE_LIMIT_EXCEEDED', `snapshot node count exceeds ${BOUNDARY_MAX_NODES}`);
    }

    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(input);
      descriptors = Object.getOwnPropertyDescriptors(input);
    } catch {
      return boundaryFailure(path, 'BOUNDARY_SNAPSHOT_FAILED', 'input descriptors could not be read safely');
    }
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      return boundaryFailure(path, 'BOUNDARY_SYMBOL_KEY_REJECTED', 'symbol-keyed input is not permitted');
    }
    if (ownKeys.length > BOUNDARY_MAX_PROPERTIES) {
      return boundaryFailure(path, 'BOUNDARY_PROPERTY_LIMIT_EXCEEDED', `object property count exceeds ${BOUNDARY_MAX_PROPERTIES}`);
    }
    for (const key of ownKeys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) {
        return boundaryFailure(`${path}.${String(key)}`, 'BOUNDARY_ACCESSOR_REJECTED', 'accessor-bearing input is not permitted');
      }
    }

    const arrayInput = Array.isArray(input);
    if (arrayInput && prototype !== Array.prototype) {
      return boundaryFailure(path, 'BOUNDARY_PROTOTYPE_REJECTED', 'array input must use the intrinsic array prototype');
    }
    if (!arrayInput && prototype !== Object.prototype && prototype !== null) {
      return boundaryFailure(path, 'BOUNDARY_PROTOTYPE_REJECTED', 'object input must be a plain object');
    }

    active.add(input);
    if (arrayInput) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > BOUNDARY_MAX_PROPERTIES - 1) {
        active.delete(input);
        return boundaryFailure(path, 'BOUNDARY_ARRAY_LIMIT_EXCEEDED', `array length exceeds ${BOUNDARY_MAX_PROPERTIES - 1}`);
      }
      const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
      if (ownKeys.length !== expectedKeys.size || ownKeys.some((key) => !expectedKeys.has(key))) {
        active.delete(input);
        return boundaryFailure(path, 'BOUNDARY_ARRAY_SHAPE_REJECTED', 'arrays must be dense and may not carry extra properties');
      }
      const output = new Array(length);
      memo.set(input, output);
      for (let index = 0; index < length; index += 1) {
        const entry = copy(descriptors[String(index)].value, `${path}[${index}]`, depth + 1);
        if (!entry.ok) {
          active.delete(input);
          return entry;
        }
        output[index] = entry.value;
      }
      active.delete(input);
      return Object.freeze({ ok: true, value: Object.freeze(output) });
    }

    const output = Object.create(null);
    memo.set(input, output);
    for (const key of ownKeys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) {
        active.delete(input);
        return boundaryFailure(`${path}.${String(key)}`, 'BOUNDARY_HIDDEN_PROPERTY_REJECTED', 'non-enumerable object input is not permitted');
      }
      const entry = copy(descriptor.value, `${path}.${String(key)}`, depth + 1);
      if (!entry.ok) {
        active.delete(input);
        return entry;
      }
      Object.defineProperty(output, key, {
        value: entry.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    active.delete(input);
    return Object.freeze({ ok: true, value: Object.freeze(output) });
  }

  return copy(value, rootPath, 0);
}

function isUnknownMarker(value) {
  if (typeof value !== 'string') return true;
  const normalized = value.trim().toUpperCase().replace(/[\s./-]+/g, '_');
  return UNKNOWN_VERSION_MARKERS.has(normalized)
    || normalized.startsWith('UNKNOWN_')
    || normalized.startsWith('UNVERIFIED_')
    || normalized.startsWith('NOT_IMPLEMENTED_');
}

function validateMappingRow(value, index, issues) {
  const path = `$.mappings[${index}]`;
  const keys = [
    'mappingId', 'category', 'modelElementId', 'implementationOwner', 'implementationPath',
    'implementationSymbol', 'durableRecord', 'postcondition', 'atomicity', 'status', 'evidenceRefs',
  ];
  if (!exactKeys(value, keys, path, issues)) return;
  stableId(value.mappingId, `${path}.mappingId`, issues);
  enumValue(value.category, MAPPING_CATEGORIES, `${path}.category`, issues);
  boundedString(value.modelElementId, `${path}.modelElementId`, issues, { max: 240 });
  boundedString(value.implementationOwner, `${path}.implementationOwner`, issues, { max: 240 });
  boundedString(value.implementationPath, `${path}.implementationPath`, issues, { max: 500 });
  if (value.implementationSymbol !== null) boundedString(value.implementationSymbol, `${path}.implementationSymbol`, issues, { max: 240 });
  if (value.durableRecord !== null) boundedString(value.durableRecord, `${path}.durableRecord`, issues, { max: 500 });
  if (value.postcondition !== null) boundedString(value.postcondition, `${path}.postcondition`, issues, { max: 1_000 });
  enumValue(value.atomicity, MAPPING_ATOMICITIES, `${path}.atomicity`, issues);
  enumValue(value.status, MAPPING_STATUSES, `${path}.status`, issues);
  boundedStringArray(value.evidenceRefs, `${path}.evidenceRefs`, issues, { max: 32, itemMax: 500 });
  if (['MAPPED', 'PARTIAL'].includes(value.status)) {
    if (isUnknownMarker(value.implementationOwner) || isUnknownMarker(value.implementationPath)) {
      issues.push(Object.freeze({ path, code: 'MAPPING_TARGET_INVALID', detail: 'mapped or partial row requires a concrete implementation owner and path' }));
    }
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1) issues.push(Object.freeze({ path: `${path}.evidenceRefs`, code: 'EVIDENCE_REQUIRED', detail: 'mapped or partial row requires evidence' }));
  }
  if (value.status === 'MAPPED') {
    if (value.implementationSymbol === null || isUnknownMarker(value.implementationSymbol)) {
      issues.push(Object.freeze({ path: `${path}.implementationSymbol`, code: 'SYMBOL_REQUIRED', detail: 'mapped row requires a concrete implementation symbol' }));
    }
    if (['INVARIANT', 'POSTCONDITION'].includes(value.category) && value.postcondition === null) {
      issues.push(Object.freeze({ path: `${path}.postcondition`, code: 'POSTCONDITION_REQUIRED', detail: 'mapped invariant or postcondition row requires an implementation postcondition' }));
    }
  }
  if (value.status === 'UNREACHABLE' && (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1)) {
    issues.push(Object.freeze({ path: `${path}.evidenceRefs`, code: 'EVIDENCE_REQUIRED', detail: 'unreachable row requires reachability evidence' }));
  }
}

function validateReplay(value, path, issues) {
  if (!exactKeys(value, ['traceId', 'status', 'traceSha256', 'harness', 'evidenceRefs'], path, issues)) return;
  stableId(value.traceId, `${path}.traceId`, issues);
  enumValue(value.status, REPLAY_STATUSES, `${path}.status`, issues);
  if (value.traceSha256 !== null) sha256(value.traceSha256, `${path}.traceSha256`, issues);
  if (value.harness !== null) boundedString(value.harness, `${path}.harness`, issues, { max: 500 });
  boundedStringArray(value.evidenceRefs, `${path}.evidenceRefs`, issues, { max: 32, itemMax: 500 });
  if (['REPRODUCED', 'NOT_REPRODUCED'].includes(value.status)) {
    if (value.traceSha256 === null) issues.push(Object.freeze({ path: `${path}.traceSha256`, code: 'TRACE_HASH_REQUIRED', detail: 'an executed replay requires the canonical trace content hash' }));
    if (value.harness === null) issues.push(Object.freeze({ path: `${path}.harness`, code: 'HARNESS_REQUIRED', detail: 'an executed replay requires its ordinary harness identity' }));
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1) issues.push(Object.freeze({ path: `${path}.evidenceRefs`, code: 'EVIDENCE_REQUIRED', detail: 'an executed replay requires evidence' }));
  }
  if (['NOT_RUN', 'NOT_APPLICABLE'].includes(value.status)
    && (value.traceSha256 !== null || value.harness !== null || (Array.isArray(value.evidenceRefs) && value.evidenceRefs.length > 0))) {
    issues.push(Object.freeze({ path, code: 'REPLAY_STATUS_CONFLICT', detail: 'a replay that did not run cannot carry harness or replay evidence' }));
  }
}

function elementKey(value) {
  return `${value?.category}:${value?.modelElementId}`;
}

function validateReplays(value, issues) {
  if (!exactKeys(value, ['representativeSuccess', 'validatedCounterexamples'], '$.replays', issues)) return;
  validateReplay(value.representativeSuccess, '$.replays.representativeSuccess', issues);
  if (!Array.isArray(value.validatedCounterexamples) || value.validatedCounterexamples.length > 64) {
    issues.push(Object.freeze({ path: '$.replays.validatedCounterexamples', code: 'ARRAY_BOUNDS', detail: 'expected 0..64 replay rows' }));
  } else {
    value.validatedCounterexamples.forEach((entry, index) => validateReplay(entry, `$.replays.validatedCounterexamples[${index}]`, issues));
  }
}

export function validateConformanceMapping(value) {
  const issues = [];
  const keys = [
    'schemaVersion', 'mappingId', 'modelId', 'modelVersion', 'modelContentSha256',
    'implementationReleaseSha', 'implementationSchemaVersions', 'implementationCommandVersions',
    'implementationStorageTransitionVersions', 'normalizerVersion', 'mappings', 'replays',
    'mismatches', 'unreachableAbstractions', 'omittedEnvironmentBehavior', 'residualAssumptions',
    'evaluatedAtMs',
  ];
  if (!exactKeys(value, keys, '$', issues)) return result(null, issues);
  if (value.schemaVersion !== CONFORMANCE_MAPPING_SCHEMA) issues.push(Object.freeze({ path: '$.schemaVersion', code: 'SCHEMA_UNSUPPORTED', detail: 'unsupported conformance schema' }));
  stableId(value.mappingId, '$.mappingId', issues);
  stableId(value.modelId, '$.modelId', issues);
  boundedString(value.modelVersion, '$.modelVersion', issues, { max: 80 });
  sha256(value.modelContentSha256, '$.modelContentSha256', issues);
  const manifest = MODEL_MANIFEST_BY_ID[value.modelId];
  if (manifest === undefined) {
    issues.push(Object.freeze({ path: '$.modelId', code: 'MODEL_MANIFEST_UNKNOWN', detail: 'model is not present in the packet manifest' }));
  } else {
    if (value.modelVersion !== manifest.modelVersion) issues.push(Object.freeze({ path: '$.modelVersion', code: 'MODEL_VERSION_MISMATCH', detail: 'model version differs from the packet manifest' }));
    if (value.modelContentSha256 !== manifest.bundleSha256) issues.push(Object.freeze({ path: '$.modelContentSha256', code: 'MODEL_HASH_MISMATCH', detail: 'model content hash differs from the packet manifest' }));
  }
  gitSha(value.implementationReleaseSha, '$.implementationReleaseSha', issues);
  boundedStringArray(value.implementationSchemaVersions, '$.implementationSchemaVersions', issues, { min: 1, max: 32, itemMax: 240 });
  boundedStringArray(value.implementationCommandVersions, '$.implementationCommandVersions', issues, { min: 1, max: 32, itemMax: 240 });
  boundedStringArray(value.implementationStorageTransitionVersions, '$.implementationStorageTransitionVersions', issues, { min: 1, max: 32, itemMax: 240 });
  boundedString(value.normalizerVersion, '$.normalizerVersion', issues, { max: 160 });
  if (!Array.isArray(value.mappings) || value.mappings.length < 1 || value.mappings.length > 256) {
    issues.push(Object.freeze({ path: '$.mappings', code: 'ARRAY_BOUNDS', detail: 'expected 1..256 mapping rows' }));
  } else {
    value.mappings.forEach((entry, index) => validateMappingRow(entry, index, issues));
    const mappingIds = value.mappings.map((entry) => entry?.mappingId);
    const modelElements = value.mappings.map((entry) => `${entry?.category}:${entry?.modelElementId}`);
    if (new Set(mappingIds).size !== mappingIds.length) issues.push(Object.freeze({ path: '$.mappings', code: 'DUPLICATE_MAPPING_ID', detail: 'mapping IDs must be unique' }));
    if (new Set(modelElements).size !== modelElements.length) issues.push(Object.freeze({ path: '$.mappings', code: 'DUPLICATE_MODEL_ELEMENT', detail: 'model elements must have one mapping row each' }));
    const expectedElements = MODEL_ELEMENT_MANIFEST_BY_ID[value.modelId];
    if (expectedElements === undefined
      || expectedElements.length !== value.mappings.length
      || expectedElements.some((entry) => !modelElements.includes(elementKey(entry)))) {
      issues.push(Object.freeze({ path: '$.mappings', code: 'MODEL_ELEMENT_MANIFEST_MISMATCH', detail: 'mapping rows must cover exactly the packet-owned model-element manifest' }));
    }
  }
  validateReplays(value.replays, issues);
  boundedStringArray(value.mismatches, '$.mismatches', issues, { max: 64, itemMax: 1_000 });
  boundedStringArray(value.unreachableAbstractions, '$.unreachableAbstractions', issues, { max: 64, itemMax: 1_000 });
  boundedStringArray(value.omittedEnvironmentBehavior, '$.omittedEnvironmentBehavior', issues, { max: 64, itemMax: 1_000 });
  boundedStringArray(value.residualAssumptions, '$.residualAssumptions', issues, { min: 1, max: 64, itemMax: 1_000 });
  safeInteger(value.evaluatedAtMs, '$.evaluatedAtMs', issues, { min: 0 });
  return result(value, issues);
}

function versionsUsable(values) {
  return values.length > 0 && values.every((value) => !isUnknownMarker(value));
}

function verifiedContext(value, context) {
  if (!isPlainObject(context) || context.verificationAuthority !== 'INDEPENDENT_READBACK') return Object.freeze({
    verificationAuthority: false,
    modelIdentity: false,
    releaseIdentity: false,
    elementCoverage: false,
    mappingEvidence: false,
    replayProvenance: false,
    ownerEvidenceRegistry: false,
  });
  const verificationAuthority = true;
  const manifest = MODEL_MANIFEST_BY_ID[value.modelId];
  const modelIdentity = isPlainObject(context.modelIdentity)
    && context.modelIdentity.manifestSchemaVersion === MODEL_MANIFEST_SCHEMA
    && context.modelIdentity.modelId === manifest?.modelId
    && context.modelIdentity.modelVersion === manifest?.modelVersion
    && context.modelIdentity.modelContentSha256 === manifest?.bundleSha256;
  const releaseIdentity = context.implementationReleaseSha === value.implementationReleaseSha;
  const expected = Array.isArray(context.expectedModelElements)
    ? new Set(context.expectedModelElements.map((entry) => `${entry?.category}:${entry?.modelElementId}`))
    : new Set();
  const canonicalElements = new Set((MODEL_ELEMENT_MANIFEST_BY_ID[value.modelId] ?? []).map(elementKey));
  const elementCoverage = expected.size > 0
    && expected.size === canonicalElements.size
    && [...expected].every((entry) => canonicalElements.has(entry));

  // No owner-accepted evidence registry exists in this packet. Caller-provided
  // paths, harness names, or receipt strings are claims, not readback. The
  // insertion request must add a pinned registry before these can become true.
  const mappingEvidence = false;
  const replayProvenance = false;
  const ownerEvidenceRegistry = false;
  return Object.freeze({
    verificationAuthority,
    modelIdentity,
    releaseIdentity,
    elementCoverage,
    mappingEvidence,
    replayProvenance,
    ownerEvidenceRegistry,
  });
}

export function evaluateConformanceMapping(value, context = null) {
  const snapshot = snapshotBoundary(value, '$');
  if (!snapshot.ok) {
    return Object.freeze({
      verdict: 'UNKNOWN',
      runtimeClaimClosure: 'NOT_PERMITTED',
      mappingId: null,
      modelId: null,
      reasons: Object.freeze(['CONFORMANCE_INPUT_INVALID']),
      issues: snapshot.issues,
    });
  }
  const candidate = snapshot.value;
  const contextSnapshot = context === null ? Object.freeze({ ok: true, value: null }) : snapshotBoundary(context, '$context');
  const evaluatedContext = contextSnapshot.ok ? contextSnapshot.value : null;
  const validated = validateConformanceMapping(candidate);
  if (!validated.ok) {
    return Object.freeze({
      verdict: 'UNKNOWN',
      runtimeClaimClosure: 'NOT_PERMITTED',
      mappingId: typeof candidate?.mappingId === 'string' ? candidate.mappingId : null,
      modelId: typeof candidate?.modelId === 'string' ? candidate.modelId : null,
      reasons: Object.freeze(['CONFORMANCE_INPUT_INVALID']),
      issues: validated.issues,
    });
  }

  const reasons = [];
  if (!contextSnapshot.ok) reasons.push('CONFORMANCE_CONTEXT_INVALID');
  const categoriesPresent = new Set(candidate.mappings.map((row) => row.category));
  const categoryCoverageComplete = MAPPING_CATEGORIES.every((category) => categoriesPresent.has(category));
  if (!categoryCoverageComplete) reasons.push('MAPPING_CATEGORY_MISSING');
  const hasMappedSurface = candidate.mappings.some((row) => row.status === 'MAPPED' || row.status === 'PARTIAL');
  if (!hasMappedSurface) reasons.push('IMPLEMENTATION_MAPPING_ABSENT');
  const allRowsMapped = candidate.mappings.every((row) => row.status === 'MAPPED');
  if (!allRowsMapped) reasons.push('MAPPING_NOT_COMPLETE');
  const durableRecordCoverage = candidate.mappings.some((row) => row.status === 'MAPPED' && row.durableRecord !== null);
  const postconditionCoverage = candidate.mappings.some((row) => row.status === 'MAPPED' && row.postcondition !== null);
  if (!durableRecordCoverage) reasons.push('DURABLE_RECORD_MAPPING_MISSING');
  if (!postconditionCoverage) reasons.push('POSTCONDITION_MAPPING_MISSING');

  const identityComplete = versionsUsable(candidate.implementationSchemaVersions)
    && versionsUsable(candidate.implementationCommandVersions)
    && versionsUsable(candidate.implementationStorageTransitionVersions);
  if (!identityComplete) reasons.push('IMPLEMENTATION_VERSION_IDENTITY_INCOMPLETE');

  const successReplay = candidate.replays.representativeSuccess;
  const successReproduced = successReplay.status === 'REPRODUCED' && successReplay.harness !== null && successReplay.evidenceRefs.length > 0;
  if (!successReproduced) reasons.push('REPRESENTATIVE_SUCCESS_REPLAY_MISSING');
  const counterexamplesPresent = candidate.replays.validatedCounterexamples.length > 0;
  if (!counterexamplesPresent) reasons.push('COUNTEREXAMPLE_REPLAY_MISSING');
  const counterexamplesReproduced = counterexamplesPresent && candidate.replays.validatedCounterexamples.every(
    (replay) => replay.status === 'REPRODUCED' && replay.harness !== null && replay.evidenceRefs.length > 0,
  );
  if (counterexamplesPresent && !counterexamplesReproduced) reasons.push('COUNTEREXAMPLE_REPLAY_INCOMPLETE');

  const verified = verifiedContext(candidate, evaluatedContext);
  if (!verified.verificationAuthority) reasons.push('INDEPENDENT_VERIFICATION_AUTHORITY_MISSING');
  if (!verified.modelIdentity) reasons.push('MODEL_IDENTITY_NOT_INDEPENDENTLY_VERIFIED');
  if (!verified.releaseIdentity) reasons.push('IMPLEMENTATION_RELEASE_NOT_INDEPENDENTLY_VERIFIED');
  if (!verified.elementCoverage) reasons.push('MODEL_ELEMENT_MANIFEST_NOT_VERIFIED');
  if (!verified.mappingEvidence) reasons.push('MAPPING_EVIDENCE_NOT_VERIFIED');
  if (!verified.replayProvenance) reasons.push('REPLAY_PROVENANCE_NOT_VERIFIED');
  if (!verified.ownerEvidenceRegistry) reasons.push('OWNER_EVIDENCE_REGISTRY_NOT_CONFIGURED');
  if (candidate.unreachableAbstractions.length > 0) reasons.push('UNREACHABLE_ABSTRACTIONS_PRESENT');
  if (candidate.omittedEnvironmentBehavior.length > 0) reasons.push('OMITTED_ENVIRONMENT_BEHAVIOR_PRESENT');

  const replayMismatch = successReplay.status === 'NOT_REPRODUCED'
    || candidate.replays.validatedCounterexamples.some((replay) => replay.status === 'NOT_REPRODUCED');
  const mismatch = replayMismatch || candidate.mismatches.length > 0;
  let verdict;
  if (mismatch) verdict = 'MISMATCH';
  else if (!hasMappedSurface || !categoryCoverageComplete || !identityComplete) verdict = 'UNKNOWN';
  else if (allRowsMapped
    && durableRecordCoverage
    && postconditionCoverage
    && successReproduced
    && counterexamplesReproduced
    && Object.values(verified).every(Boolean)
    && candidate.unreachableAbstractions.length === 0
    && candidate.omittedEnvironmentBehavior.length === 0) verdict = 'SUPPORTING_EVIDENCE';
  else verdict = 'REFERENCE_ONLY';

  if (!CONFORMANCE_VERDICTS.includes(verdict)) throw new TypeError('internal conformance verdict is invalid');
  return Object.freeze({
    verdict,
    runtimeClaimClosure: 'NOT_PERMITTED',
    mappingId: candidate.mappingId,
    modelId: candidate.modelId,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    issues: Object.freeze([]),
    coverage: Object.freeze({
      categoryCoverageComplete,
      mappedRows: candidate.mappings.filter((row) => row.status === 'MAPPED').length,
      partialRows: candidate.mappings.filter((row) => row.status === 'PARTIAL').length,
      absentRows: candidate.mappings.filter((row) => row.status === 'ABSENT').length,
      unreachableRows: candidate.mappings.filter((row) => row.status === 'UNREACHABLE').length,
      totalRows: candidate.mappings.length,
    }),
  });
}
