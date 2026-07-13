import { types as utilTypes } from 'node:util';

import {
  canonicalJson,
  EXPLICIT_STATE_CHECKER,
  EXPLICIT_STATE_REPORT_SCHEMA,
  exploreModel,
} from '../explicitState/kernel.mjs';
import { CANONICAL_MODELS, NEGATIVE_CONTROL_MODELS } from '../explicitState/index.mjs';
import { PROPERTY_BY_ID } from '../explicitState/properties.mjs';
import {
  boundedString,
  boundedStringArray,
  enumValue,
  exactKeys,
  isPlainObject,
  issue,
  result,
  safeInteger,
  stableId,
} from './validation.mjs';

const ACTION_ID = /^[A-Z][A-Z0-9_]{1,95}$/;
const FINGERPRINT = /^[a-f0-9]{16}$/;
const STATUS_ORDER = Object.freeze({ PASS: 0, UNKNOWN: 1, FAIL: 2 });
const MAX_SNAPSHOT_ARRAY_LENGTH = 100_000;
const MAX_SNAPSHOT_OBJECT_KEYS = 10_000;
const MODEL_BY_ID_AND_PROFILE = new Map(
  [...CANONICAL_MODELS, ...NEGATIVE_CONTROL_MODELS]
    .map((model) => [`${model.modelId}:${model.profile}`, model]),
);

function sameJson(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function validBounds(value) {
  return isPlainObject(value)
    && Number.isSafeInteger(value.maxStates)
    && Number.isSafeInteger(value.maxTransitions)
    && Number.isSafeInteger(value.maxDepth);
}

function snapshotReportData(value, path = '$', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-data value`);
  if (utilTypes.isProxy(value)) throw new TypeError(`${path} cannot be a Proxy`);
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) throw new TypeError(`${path} must contain only arrays and plain objects`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError(`${path} cannot contain symbol fields`);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) throw new TypeError(`${path}.${String(key)} cannot be an accessor`);
    }
    if (isArray) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SNAPSHOT_ARRAY_LENGTH) throw new TypeError(`${path} has an invalid array length`);
      if (keys.filter((key) => key !== 'length').length !== length) throw new TypeError(`${path} must be a dense array without extra fields`);
      const snapshot = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || descriptor.enumerable !== true) throw new TypeError(`${path}[${index}] must be an enumerable data field`);
        snapshot[index] = snapshotReportData(descriptor.value, `${path}[${index}]`, ancestors);
      }
      return Object.freeze(snapshot);
    }
    if (keys.length > MAX_SNAPSHOT_OBJECT_KEYS) throw new TypeError(`${path} has too many fields`);
    const prototype = Object.getPrototypeOf(value);
    const snapshot = Object.create(prototype === null ? null : Object.prototype);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor.enumerable !== true) throw new TypeError(`${path}.${key} must be an enumerable data field`);
      Object.defineProperty(snapshot, key, {
        value: snapshotReportData(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

function validateBounds(value, path, issues) {
  if (!exactKeys(value, ['maxStates', 'maxTransitions', 'maxDepth'], path, issues)) return;
  safeInteger(value.maxStates, `${path}.maxStates`, issues, { min: 1, max: 1_000_000 });
  safeInteger(value.maxTransitions, `${path}.maxTransitions`, issues, { min: 1, max: 10_000_000 });
  safeInteger(value.maxDepth, `${path}.maxDepth`, issues, { min: 1, max: 100_000 });
}

function validateStep(step, path, index, issues) {
  if (!exactKeys(step, ['index', 'actionId', 'state'], path, issues)) return;
  safeInteger(step.index, `${path}.index`, issues, { min: index, max: index });
  boundedString(step.actionId, `${path}.actionId`, issues, { max: 96, pattern: ACTION_ID });
  if (!isPlainObject(step.state)) issues.push(Object.freeze({ path: `${path}.state`, code: 'OBJECT_REQUIRED', detail: 'state must be a plain object' }));
}

function validateSteps(value, path, issues) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4_096) {
    issues.push(Object.freeze({ path, code: 'ARRAY_BOUNDS', detail: 'trace must contain 1..4096 steps' }));
    return;
  }
  value.forEach((step, index) => validateStep(step, `${path}[${index}]`, index, issues));
}

function validatePropertyTrace(value, property, path, issues) {
  if (value === null) {
    if (property.status === 'FAIL') issues.push(Object.freeze({ path, code: 'TRACE_REQUIRED', detail: 'failed property requires a counterexample trace' }));
    return;
  }
  if (property.kind === 'SAFETY') {
    validateSteps(value, path, issues);
    return;
  }
  if (!exactKeys(value, ['loopStart', 'steps'], path, issues)) return;
  validateSteps(value.steps, `${path}.steps`, issues);
  if (value.loopStart !== null) safeInteger(value.loopStart, `${path}.loopStart`, issues, { min: 0, max: Math.max(0, (value.steps?.length ?? 1) - 1) });
}

function validateProperty(value, index, issues) {
  const path = `$.properties[${index}]`;
  if (!exactKeys(value, ['propertyId', 'kind', 'status', 'detail', 'trace'], path, issues)) return;
  stableId(value.propertyId, `${path}.propertyId`, issues);
  enumValue(value.kind, ['SAFETY', 'LIVENESS'], `${path}.kind`, issues);
  enumValue(value.status, ['PASS', 'FAIL', 'UNKNOWN'], `${path}.status`, issues);
  if (value.detail !== null) boundedString(value.detail, `${path}.detail`, issues, { max: 1_000 });
  const catalogEntry = PROPERTY_BY_ID[value.propertyId];
  if (catalogEntry === undefined) {
    issues.push(Object.freeze({ path: `${path}.propertyId`, code: 'PROPERTY_UNKNOWN', detail: 'property is not in the packet catalog' }));
  } else if (catalogEntry.kind !== value.kind) {
    issues.push(Object.freeze({ path: `${path}.kind`, code: 'PROPERTY_KIND_MISMATCH', detail: 'property kind differs from the packet catalog' }));
  }
  if (value.status === 'PASS' && value.trace !== null) issues.push(Object.freeze({ path: `${path}.trace`, code: 'PASS_TRACE_FORBIDDEN', detail: 'passing property cannot carry a counterexample' }));
  validatePropertyTrace(value.trace, value, `${path}.trace`, issues);
}

function validateExplicitStateReportSnapshot(value) {
  const issues = [];
  const keys = [
    'schemaVersion', 'checker', 'modelId', 'modelVersion', 'profile', 'authority',
    'assumptions', 'declaredBounds', 'executedBounds', 'overallStatus',
    'exploration', 'properties', 'representativeTraces', 'limitations',
  ];
  if (!exactKeys(value, keys, '$', issues)) return result(null, issues);
  if (value.schemaVersion !== EXPLICIT_STATE_REPORT_SCHEMA) issues.push(Object.freeze({ path: '$.schemaVersion', code: 'SCHEMA_UNSUPPORTED', detail: 'unsupported explicit-state report schema' }));
  if (!exactKeys(value.checker, ['checkerId', 'checkerVersion', 'algorithm'], '$.checker', issues)) return result(null, issues);
  if (value.checker.checkerId !== EXPLICIT_STATE_CHECKER.checkerId
    || value.checker.checkerVersion !== EXPLICIT_STATE_CHECKER.checkerVersion
    || value.checker.algorithm !== EXPLICIT_STATE_CHECKER.algorithm) {
    issues.push(Object.freeze({ path: '$.checker', code: 'CHECKER_IDENTITY_MISMATCH', detail: 'checker identity is not the accepted packet checker' }));
  }
  stableId(value.modelId, '$.modelId', issues);
  boundedString(value.modelVersion, '$.modelVersion', issues, { max: 80 });
  boundedString(value.profile, '$.profile', issues, { max: 96 });
  const model = MODEL_BY_ID_AND_PROFILE.get(`${value.modelId}:${value.profile}`);
  if (model === undefined) issues.push(Object.freeze({ path: '$.profile', code: 'MODEL_PROFILE_UNKNOWN', detail: 'model ID and profile are not a packet-owned checker identity' }));
  if (value.authority !== 'SUPPORTING_EVIDENCE_ONLY') issues.push(Object.freeze({ path: '$.authority', code: 'AUTHORITY_INVALID', detail: 'report may only claim supporting evidence' }));
  boundedStringArray(value.assumptions, '$.assumptions', issues, { min: 1, max: 32, itemMax: 500 });
  validateBounds(value.declaredBounds, '$.declaredBounds', issues);
  validateBounds(value.executedBounds, '$.executedBounds', issues);
  if (model !== undefined) {
    if (value.modelVersion !== model.modelVersion) issues.push(Object.freeze({ path: '$.modelVersion', code: 'MODEL_VERSION_MISMATCH', detail: 'report version differs from the packet-owned model' }));
    if (value.authority !== model.authority) issues.push(Object.freeze({ path: '$.authority', code: 'MODEL_AUTHORITY_MISMATCH', detail: 'report authority differs from the packet-owned model' }));
    if (!sameJson(value.assumptions, model.assumptions)) issues.push(Object.freeze({ path: '$.assumptions', code: 'MODEL_ASSUMPTIONS_MISMATCH', detail: 'report assumptions differ from the packet-owned model' }));
    if (!sameJson(value.declaredBounds, model.bounds)) issues.push(Object.freeze({ path: '$.declaredBounds', code: 'DECLARED_BOUNDS_MISMATCH', detail: 'declared bounds differ from the packet-owned model' }));
  }
  if (validBounds(value.declaredBounds) && validBounds(value.executedBounds)
    && (value.executedBounds.maxStates > value.declaredBounds.maxStates
      || value.executedBounds.maxTransitions > value.declaredBounds.maxTransitions
      || value.executedBounds.maxDepth > value.declaredBounds.maxDepth)) {
    issues.push(Object.freeze({ path: '$.executedBounds', code: 'EXECUTED_BOUNDS_EXCEED_DECLARED', detail: 'executed bounds cannot exceed the declared model bounds' }));
  }
  enumValue(value.overallStatus, ['PASS', 'FAIL', 'UNKNOWN'], '$.overallStatus', issues);

  const explorationKeys = [
    'status', 'states', 'transitions', 'maxDepthReached', 'terminalStates',
    'deadlocks', 'graphFingerprint', 'truncatedReasons', 'actionCoverage',
  ];
  if (exactKeys(value.exploration, explorationKeys, '$.exploration', issues)) {
    enumValue(value.exploration.status, ['EXHAUSTIVE', 'TRUNCATED'], '$.exploration.status', issues);
    const statesValid = safeInteger(value.exploration.states, '$.exploration.states', issues, { min: 1, max: 1_000_000 });
    const transitionsValid = safeInteger(value.exploration.transitions, '$.exploration.transitions', issues, { min: 0, max: 10_000_000 });
    const depthValid = safeInteger(value.exploration.maxDepthReached, '$.exploration.maxDepthReached', issues, { min: 0, max: 100_000 });
    const terminalValid = safeInteger(value.exploration.terminalStates, '$.exploration.terminalStates', issues, { min: 0, max: 1_000_000 });
    const deadlocksValid = safeInteger(value.exploration.deadlocks, '$.exploration.deadlocks', issues, { min: 0, max: 1_000_000 });
    boundedString(value.exploration.graphFingerprint, '$.exploration.graphFingerprint', issues, { min: 16, max: 16, pattern: FINGERPRINT });
    const truncatedReasonsValid = boundedStringArray(value.exploration.truncatedReasons, '$.exploration.truncatedReasons', issues, { max: 32, itemMax: 160 });
    if (truncatedReasonsValid && new Set(value.exploration.truncatedReasons).size !== value.exploration.truncatedReasons.length) {
      issues.push(Object.freeze({ path: '$.exploration.truncatedReasons', code: 'DUPLICATE_TRUNCATION_REASON', detail: 'truncation reasons must be unique' }));
    }
    if (value.exploration.status === 'EXHAUSTIVE' && truncatedReasonsValid && value.exploration.truncatedReasons.length !== 0) {
      issues.push(Object.freeze({ path: '$.exploration.truncatedReasons', code: 'EXPLORATION_STATUS_CONFLICT', detail: 'exhaustive exploration cannot carry truncation reasons' }));
    }
    if (value.exploration.status === 'TRUNCATED' && truncatedReasonsValid && value.exploration.truncatedReasons.length === 0) {
      issues.push(Object.freeze({ path: '$.exploration.truncatedReasons', code: 'EXPLORATION_STATUS_CONFLICT', detail: 'truncated exploration requires a reason' }));
    }
    if (validBounds(value.executedBounds)) {
      if (statesValid && value.exploration.states > value.executedBounds.maxStates) issues.push(Object.freeze({ path: '$.exploration.states', code: 'COUNT_EXCEEDS_BOUND', detail: 'state count exceeds the executed state bound' }));
      if (transitionsValid && value.exploration.transitions > value.executedBounds.maxTransitions) issues.push(Object.freeze({ path: '$.exploration.transitions', code: 'COUNT_EXCEEDS_BOUND', detail: 'transition count exceeds the executed transition bound' }));
      if (depthValid && value.exploration.maxDepthReached > value.executedBounds.maxDepth) issues.push(Object.freeze({ path: '$.exploration.maxDepthReached', code: 'COUNT_EXCEEDS_BOUND', detail: 'reached depth exceeds the executed depth bound' }));
      if (truncatedReasonsValid && value.exploration.truncatedReasons.includes('MAX_STATES') && statesValid && value.exploration.states !== value.executedBounds.maxStates) issues.push(Object.freeze({ path: '$.exploration.states', code: 'TRUNCATION_COUNT_MISMATCH', detail: 'MAX_STATES requires reaching the configured state bound' }));
      if (truncatedReasonsValid && value.exploration.truncatedReasons.includes('MAX_TRANSITIONS') && transitionsValid && value.exploration.transitions !== value.executedBounds.maxTransitions) issues.push(Object.freeze({ path: '$.exploration.transitions', code: 'TRUNCATION_COUNT_MISMATCH', detail: 'MAX_TRANSITIONS requires reaching the configured transition bound' }));
      if (truncatedReasonsValid && value.exploration.truncatedReasons.includes('MAX_DEPTH') && depthValid && value.exploration.maxDepthReached !== value.executedBounds.maxDepth) issues.push(Object.freeze({ path: '$.exploration.maxDepthReached', code: 'TRUNCATION_COUNT_MISMATCH', detail: 'MAX_DEPTH requires reaching the configured depth bound' }));
    }
    if (statesValid && depthValid && value.exploration.maxDepthReached > value.exploration.states - 1) {
      issues.push(Object.freeze({ path: '$.exploration.maxDepthReached', code: 'DEPTH_STATE_COUNT_MISMATCH', detail: 'reached depth cannot exceed the discovered-state chain length' }));
    }
    if (statesValid && terminalValid && deadlocksValid
      && value.exploration.terminalStates + value.exploration.deadlocks > value.exploration.states) {
      issues.push(Object.freeze({ path: '$.exploration.deadlocks', code: 'STATE_PARTITION_INVALID', detail: 'terminal and non-terminal deadlocked states cannot exceed all states' }));
    }
    if (!Array.isArray(value.exploration.actionCoverage) || value.exploration.actionCoverage.length > 4_096) {
      issues.push(Object.freeze({ path: '$.exploration.actionCoverage', code: 'ARRAY_BOUNDS', detail: 'expected 0..4096 action rows' }));
    } else {
      const actions = new Set();
      let actionCount = 0;
      let actionRowsValid = true;
      value.exploration.actionCoverage.forEach((entry, index) => {
        const path = `$.exploration.actionCoverage[${index}]`;
        if (!exactKeys(entry, ['actionId', 'count'], path, issues)) {
          actionRowsValid = false;
          return;
        }
        const actionIdValid = boundedString(entry.actionId, `${path}.actionId`, issues, { max: 96, pattern: ACTION_ID });
        const countValid = safeInteger(entry.count, `${path}.count`, issues, { min: 1, max: 10_000_000 });
        actionRowsValid = actionRowsValid && actionIdValid && countValid;
        if (countValid) actionCount += entry.count;
        if (actions.has(entry.actionId)) issues.push(Object.freeze({ path: `${path}.actionId`, code: 'DUPLICATE_ACTION', detail: 'action coverage row is duplicated' }));
        actions.add(entry.actionId);
      });
      if (actionRowsValid && transitionsValid && actionCount !== value.exploration.transitions) {
        issues.push(Object.freeze({ path: '$.exploration.actionCoverage', code: 'ACTION_COVERAGE_MISMATCH', detail: 'action coverage counts must sum exactly to explored transitions' }));
      }
    }
  }

  if (!Array.isArray(value.properties) || value.properties.length < 1 || value.properties.length > 128) {
    issues.push(Object.freeze({ path: '$.properties', code: 'ARRAY_BOUNDS', detail: 'expected 1..128 property rows' }));
  } else {
    value.properties.forEach((entry, index) => validateProperty(entry, index, issues));
    const propertyIds = value.properties.map((entry) => entry?.propertyId);
    if (new Set(propertyIds).size !== propertyIds.length) issues.push(Object.freeze({ path: '$.properties', code: 'DUPLICATE_PROPERTY', detail: 'property rows must be unique' }));
    if (model !== undefined) {
      const expectedPropertyIds = [...model.safety, ...model.liveness].map((entry) => entry.propertyId);
      const actualPropertyIds = new Set(propertyIds);
      if (actualPropertyIds.size !== expectedPropertyIds.length
        || expectedPropertyIds.some((propertyId) => !actualPropertyIds.has(propertyId))) {
        issues.push(Object.freeze({ path: '$.properties', code: 'MODEL_PROPERTY_SET_MISMATCH', detail: 'property rows must match the complete packet-owned model/profile property set' }));
      }
    }
    const propertyStatusesValid = value.properties.every((entry) => (
      isPlainObject(entry) && Object.hasOwn(STATUS_ORDER, entry.status)
    ));
    if (propertyStatusesValid) {
      const expectedStatus = value.properties.reduce((current, entry) => (
        STATUS_ORDER[entry.status] > STATUS_ORDER[current] ? entry.status : current
      ), 'PASS');
      if (value.overallStatus !== expectedStatus) issues.push(Object.freeze({ path: '$.overallStatus', code: 'STATUS_MISMATCH', detail: 'overall status does not match property statuses' }));
    }
    if (value.exploration?.status !== 'EXHAUSTIVE' && value.overallStatus === 'PASS') {
      issues.push(Object.freeze({ path: '$.overallStatus', code: 'TRUNCATED_PASS_FORBIDDEN', detail: 'truncated exploration cannot pass' }));
    }
    if (value.exploration?.status === 'TRUNCATED' && propertyStatusesValid
      && value.properties.some((entry) => entry.status === 'PASS')) {
      issues.push(Object.freeze({ path: '$.properties', code: 'TRUNCATED_PROPERTY_PASS_FORBIDDEN', detail: 'unproven properties in a truncated exploration must be UNKNOWN' }));
    }
  }

  if (!Array.isArray(value.representativeTraces) || value.representativeTraces.length > 256) {
    issues.push(Object.freeze({ path: '$.representativeTraces', code: 'ARRAY_BOUNDS', detail: 'expected 0..256 representative traces' }));
  } else {
    const terminalClasses = new Set();
    value.representativeTraces.forEach((entry, index) => {
      const path = `$.representativeTraces[${index}]`;
      if (!exactKeys(entry, ['terminalClass', 'steps'], path, issues)) return;
      boundedString(entry.terminalClass, `${path}.terminalClass`, issues, { max: 96, pattern: ACTION_ID });
      validateSteps(entry.steps, `${path}.steps`, issues);
      if (terminalClasses.has(entry.terminalClass)) issues.push(Object.freeze({ path: `${path}.terminalClass`, code: 'DUPLICATE_TERMINAL_CLASS', detail: 'representative terminal classes must be unique' }));
      terminalClasses.add(entry.terminalClass);
      if (Array.isArray(entry.steps) && Number.isSafeInteger(value.exploration?.maxDepthReached)
        && entry.steps.length - 1 > value.exploration.maxDepthReached) {
        issues.push(Object.freeze({ path: `${path}.steps`, code: 'TRACE_DEPTH_MISMATCH', detail: 'representative trace exceeds the explored depth' }));
      }
    });
    if (Number.isSafeInteger(value.exploration?.terminalStates)) {
      if (value.representativeTraces.length > value.exploration.terminalStates) issues.push(Object.freeze({ path: '$.representativeTraces', code: 'TERMINAL_TRACE_COUNT_MISMATCH', detail: 'representative classes cannot exceed terminal states' }));
      if (value.exploration.terminalStates === 0 && value.representativeTraces.length !== 0) issues.push(Object.freeze({ path: '$.representativeTraces', code: 'TERMINAL_TRACE_COUNT_MISMATCH', detail: 'no terminal state can have a representative trace' }));
      if (value.exploration.terminalStates > 0 && value.representativeTraces.length === 0) issues.push(Object.freeze({ path: '$.representativeTraces', code: 'TERMINAL_TRACE_COUNT_MISMATCH', detail: 'terminal states require at least one representative class' }));
    }
  }
  boundedStringArray(value.limitations, '$.limitations', issues, { max: 64, itemMax: 1_000 });
  if (issues.length === 0 && model !== undefined) {
    const expected = exploreModel(model, value.executedBounds);
    if (!sameJson(value, expected)) {
      issues.push(Object.freeze({ path: '$', code: 'REPORT_IDENTITY_MISMATCH', detail: 'report differs from an independent deterministic rerun of its packet-owned model/profile/bounds identity' }));
    }
  }
  return result(value, issues);
}

export function validateExplicitStateReport(value) {
  try {
    return validateExplicitStateReportSnapshot(snapshotReportData(value));
  } catch (error) {
    return result(null, [issue('$', 'INPUT_SNAPSHOT_INVALID', `${error.name}: ${error.message}`)]);
  }
}
