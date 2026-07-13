import { types as utilTypes } from 'node:util';

import {
  isCompleteness,
  isDataAuthority,
  isDesiredRuntimeState,
  findSecretLikePaths,
  isStructuredFailure,
  isValidUtcMillis,
  type ValidationIssue,
} from '../../foundation/contracts/index.js';
import {
  PRODUCT_CAPABILITY_POSTURES,
  PRODUCT_COMPONENT_LIFECYCLES,
  PRODUCT_COMPONENT_ROLES,
  PRODUCT_LIVENESS_STATES,
  PRODUCT_READINESS_STATES,
  PRODUCT_SEVERITIES,
  PRODUCT_TRADE_READINESS_STATES,
  type ProductComponentEvidence,
  type ProductComponentProjection,
  type ProductSupervisorProjection,
} from './types.js';

const ID_PATTERN = /^[A-Za-z0-9_.:\-]{1,128}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;
const MAX_COMPONENTS = 128;
const MAX_PRODUCT_JSON_DEPTH = 64;
const MAX_PRODUCT_JSON_NODES = 200_000;
export const MAX_PRODUCT_SUPERVISOR_BYTES = 1_048_576;

const COMPONENT_EVIDENCE_KEYS = Object.freeze([
  'componentId', 'ownerId', 'ownerPath', 'desiredState', 'observedLifecycle', 'capability', 'authority', 'completeness',
  'roles', 'requiredDependencies', 'optionalDependencies', 'timing', 'queue', 'queueRequired', 'blockerCodes', 'lastFailure',
  'supportedCommandIds', 'revisions', 'restartGeneration', 'restartCount', 'capitalExposed', 'operatorAttentionRequired',
  'tradeCritical', 'requiredForProductReadiness',
] as const);
const COMPONENT_PROJECTION_KEYS = Object.freeze([
  ...COMPONENT_EVIDENCE_KEYS, 'liveness', 'readiness', 'tradeReadiness', 'ages', 'rootBlockerComponentId', 'dependencyPath',
  'affectedComponentIds', 'affectedCapitalExposed', 'severity', 'projectionReasonCodes',
] as const);

function closedObject(path: string, input: Record<string, unknown>, allowed: readonly string[], issues: ValidationIssue[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) issues.push(issue(path ? `${path}.${key}` : key, 'UNKNOWN_FIELD', `unexpected field '${key}'`));
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return keys.every((key) => typeof key === 'string'
    && descriptors[key]?.enumerable === true
    && Object.hasOwn(descriptors[key] as PropertyDescriptor, 'value'));
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function id(path: string, value: unknown, issues: ValidationIssue[]): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    issues.push(issue(path, 'ID_INVALID', `${path} must be a bounded scoped identifier`));
  }
}

function nullableId(path: string, value: unknown, issues: ValidationIssue[]): void {
  if (value !== null) id(path, value, issues);
}

function nonNegative(path: string, value: unknown, issues: ValidationIssue[], nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    issues.push(issue(path, 'NON_NEGATIVE_INTEGER_REQUIRED', `${path} must be ${nullable ? 'null or ' : ''}a non-negative safe integer`));
  }
}

function positive(path: string, value: unknown, issues: ValidationIssue[], nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    issues.push(issue(path, 'POSITIVE_INTEGER_REQUIRED', `${path} must be ${nullable ? 'null or ' : ''}a positive safe integer`));
  }
}

function utc(path: string, value: unknown, issues: ValidationIssue[], nullable = false): void {
  if (nullable && value === null) return;
  if (!isValidUtcMillis(value)) issues.push(issue(path, 'UTC_MILLIS_INVALID', `${path} must be ${nullable ? 'null or ' : ''}valid UTC ms`));
}

function enumValue(path: string, value: unknown, values: readonly string[], issues: ValidationIssue[]): void {
  if (typeof value !== 'string' || !values.includes(value)) issues.push(issue(path, 'ENUM_INVALID', `${path} has an unknown value`));
}

function uniqueStrings(
  path: string,
  value: unknown,
  issues: ValidationIssue[],
  options: Readonly<{ maximum?: number; pattern?: RegExp; allowed?: readonly string[] }> = {},
): void {
  const maximum = options.maximum ?? 128;
  if (!Array.isArray(value) || value.length > maximum) {
    issues.push(issue(path, 'BOUNDED_ARRAY_REQUIRED', `${path} must contain at most ${maximum} entries`));
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 256) {
      issues.push(issue(`${path}[${index}]`, 'STRING_INVALID', 'entry must be a bounded non-empty string'));
    } else {
      if (seen.has(entry)) issues.push(issue(`${path}[${index}]`, 'DUPLICATE', 'duplicate entry'));
      seen.add(entry);
      if (options.pattern && !options.pattern.test(entry)) issues.push(issue(`${path}[${index}]`, 'FORMAT_INVALID', 'entry has invalid format'));
      if (options.allowed && !options.allowed.includes(entry)) issues.push(issue(`${path}[${index}]`, 'ENUM_INVALID', 'entry has an unknown value'));
    }
  });
}

export function validateProductComponentEvidence(input: unknown, path = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  try {
    normalizeJson(input, new WeakSet<object>());
  } catch {
    return [issue(path, 'PLAIN_DATA_REQUIRED', 'component evidence must contain only closed, accessor-free plain JSON data')];
  }
  if (!plainObject(input)) return [issue(path, 'OBJECT_REQUIRED', 'component evidence must be a plain object')];
  const at = (field: string): string => path ? `${path}.${field}` : field;
  closedObject(path, input, COMPONENT_EVIDENCE_KEYS, issues);
  for (const secretPath of findSecretLikePaths(input)) issues.push(issue(at(secretPath), 'SECRET_LIKE_FIELD', 'secret-like fields are forbidden'));
  id(at('componentId'), input.componentId, issues);
  id(at('ownerId'), input.ownerId, issues);
  if (typeof input.ownerPath !== 'string' || input.ownerPath.length === 0 || input.ownerPath.length > 512) {
    issues.push(issue(at('ownerPath'), 'PATH_INVALID', 'ownerPath must be bounded and non-empty'));
  }
  if (!isDesiredRuntimeState(input.desiredState)) issues.push(issue(at('desiredState'), 'ENUM_INVALID', 'desiredState is invalid'));
  enumValue(at('observedLifecycle'), input.observedLifecycle, PRODUCT_COMPONENT_LIFECYCLES, issues);
  enumValue(at('capability'), input.capability, PRODUCT_CAPABILITY_POSTURES, issues);
  if (!isDataAuthority(input.authority)) issues.push(issue(at('authority'), 'ENUM_INVALID', 'authority is invalid'));
  if (!isCompleteness(input.completeness)) issues.push(issue(at('completeness'), 'ENUM_INVALID', 'completeness is invalid'));
  uniqueStrings(at('roles'), input.roles, issues, { allowed: PRODUCT_COMPONENT_ROLES, maximum: PRODUCT_COMPONENT_ROLES.length });
  uniqueStrings(at('requiredDependencies'), input.requiredDependencies, issues, { pattern: ID_PATTERN });
  uniqueStrings(at('optionalDependencies'), input.optionalDependencies, issues, { pattern: ID_PATTERN });
  if (Array.isArray(input.requiredDependencies) && Array.isArray(input.optionalDependencies)) {
    for (const dependency of input.requiredDependencies) {
      if (input.optionalDependencies.includes(dependency)) issues.push(issue(at('optionalDependencies'), 'DEPENDENCY_DUPLICATE_KIND', 'dependency cannot be both required and optional'));
    }
  }
  if (!plainObject(input.timing)) {
    issues.push(issue(at('timing'), 'OBJECT_REQUIRED', 'timing is required'));
  } else {
    closedObject(at('timing'), input.timing, ['heartbeatAtMs', 'lastInputEventAtMs', 'lastReceiveAtMs', 'lastProcessedAtMs', 'lastMeaningfulAdvanceAtMs', 'heartbeatMaxAgeMs', 'sourceMaxAgeMs', 'processingMaxAgeMs', 'meaningfulAdvanceMaxAgeMs'], issues);
    utc(at('timing.heartbeatAtMs'), input.timing.heartbeatAtMs, issues, true);
    utc(at('timing.lastInputEventAtMs'), input.timing.lastInputEventAtMs, issues, true);
    utc(at('timing.lastReceiveAtMs'), input.timing.lastReceiveAtMs, issues, true);
    utc(at('timing.lastProcessedAtMs'), input.timing.lastProcessedAtMs, issues, true);
    utc(at('timing.lastMeaningfulAdvanceAtMs'), input.timing.lastMeaningfulAdvanceAtMs, issues, true);
    positive(at('timing.heartbeatMaxAgeMs'), input.timing.heartbeatMaxAgeMs, issues);
    positive(at('timing.sourceMaxAgeMs'), input.timing.sourceMaxAgeMs, issues, true);
    positive(at('timing.processingMaxAgeMs'), input.timing.processingMaxAgeMs, issues, true);
    positive(at('timing.meaningfulAdvanceMaxAgeMs'), input.timing.meaningfulAdvanceMaxAgeMs, issues, true);
  }
  if (input.queue !== null) {
    if (!plainObject(input.queue)) {
      issues.push(issue(at('queue'), 'OBJECT_REQUIRED', 'queue must be null or an object'));
    } else {
      closedObject(at('queue'), input.queue, ['depth', 'capacity', 'dropped', 'coalesced', 'backpressure', 'observedAtMs', 'maxAgeMs'], issues);
      nonNegative(at('queue.depth'), input.queue.depth, issues, true);
      positive(at('queue.capacity'), input.queue.capacity, issues, true);
      nonNegative(at('queue.dropped'), input.queue.dropped, issues, true);
      nonNegative(at('queue.coalesced'), input.queue.coalesced, issues, true);
      enumValue(at('queue.backpressure'), input.queue.backpressure, ['NONE', 'ACTIVE', 'SATURATED', 'UNKNOWN'], issues);
      utc(at('queue.observedAtMs'), input.queue.observedAtMs, issues, true);
      positive(at('queue.maxAgeMs'), input.queue.maxAgeMs, issues);
      if (typeof input.queue.depth === 'number' && typeof input.queue.capacity === 'number' && input.queue.depth > input.queue.capacity) {
        issues.push(issue(at('queue.depth'), 'QUEUE_CAPACITY_EXCEEDED', 'queue depth exceeds capacity'));
      }
    }
  }
  uniqueStrings(at('blockerCodes'), input.blockerCodes, issues, { pattern: CODE_PATTERN, maximum: 64 });
  if (input.lastFailure !== null && !isStructuredFailure(input.lastFailure)) issues.push(issue(at('lastFailure'), 'STRUCTURED_FAILURE_INVALID', 'lastFailure is invalid'));
  uniqueStrings(at('supportedCommandIds'), input.supportedCommandIds, issues, { pattern: ID_PATTERN, maximum: 128 });
  if (!plainObject(input.revisions)) {
    issues.push(issue(at('revisions'), 'OBJECT_REQUIRED', 'revisions is required'));
  } else {
    closedObject(at('revisions'), input.revisions, ['build', 'config', 'schema', 'model'], issues);
    for (const field of ['build', 'config', 'schema', 'model'] as const) nullableId(at(`revisions.${field}`), input.revisions[field], issues);
  }
  nonNegative(at('restartGeneration'), input.restartGeneration, issues);
  nonNegative(at('restartCount'), input.restartCount, issues);
  for (const field of ['capitalExposed', 'operatorAttentionRequired', 'tradeCritical', 'requiredForProductReadiness', 'queueRequired'] as const) {
    if (typeof input[field] !== 'boolean') issues.push(issue(at(field), 'BOOLEAN_REQUIRED', `${field} must be boolean`));
  }
  return issues;
}

function validateProjectionComponent(input: unknown, path: string): ValidationIssue[] {
  const evidence = plainObject(input)
    ? Object.fromEntries(COMPONENT_EVIDENCE_KEYS.map((key) => [key, input[key]]))
    : input;
  const issues = validateProductComponentEvidence(evidence, path);
  if (!plainObject(input)) return issues;
  closedObject(path, input, COMPONENT_PROJECTION_KEYS, issues);
  enumValue(`${path}.liveness`, input.liveness, PRODUCT_LIVENESS_STATES, issues);
  enumValue(`${path}.readiness`, input.readiness, PRODUCT_READINESS_STATES, issues);
  enumValue(`${path}.tradeReadiness`, input.tradeReadiness, PRODUCT_TRADE_READINESS_STATES, issues);
  nullableId(`${path}.rootBlockerComponentId`, input.rootBlockerComponentId, issues);
  uniqueStrings(`${path}.dependencyPath`, input.dependencyPath, issues, { pattern: ID_PATTERN });
  uniqueStrings(`${path}.affectedComponentIds`, input.affectedComponentIds, issues, { pattern: ID_PATTERN });
  if (typeof input.affectedCapitalExposed !== 'boolean') issues.push(issue(`${path}.affectedCapitalExposed`, 'BOOLEAN_REQUIRED', 'affectedCapitalExposed must be boolean'));
  enumValue(`${path}.severity`, input.severity, PRODUCT_SEVERITIES, issues);
  uniqueStrings(`${path}.projectionReasonCodes`, input.projectionReasonCodes, issues, { pattern: CODE_PATTERN });
  if (!plainObject(input.ages)) issues.push(issue(`${path}.ages`, 'OBJECT_REQUIRED', 'ages is required'));
  else {
    closedObject(`${path}.ages`, input.ages, ['heartbeatAgeMs', 'sourceEventAgeMs', 'receiveAgeMs', 'processingAgeMs', 'meaningfulAdvanceAgeMs'], issues);
    for (const field of ['heartbeatAgeMs', 'sourceEventAgeMs', 'receiveAgeMs', 'processingAgeMs', 'meaningfulAdvanceAgeMs']) nonNegative(`${path}.ages.${field}`, input.ages[field], issues, true);
  }
  return issues;
}

export function validateProductSupervisorProjection(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  try {
    normalizeJson(input, new WeakSet<object>());
  } catch {
    return [issue('', 'PLAIN_DATA_REQUIRED', 'supervisor projection must contain only closed, accessor-free plain JSON data')];
  }
  if (!plainObject(input)) return [issue('', 'OBJECT_REQUIRED', 'supervisor projection must be a plain object')];
  closedObject('', input, ['schemaVersion', 'revision', 'evaluatedAtMs', 'overallReadiness', 'tradeReadiness', 'components', 'dependencies', 'rootBlockerComponentIds', 'operatorAttention', 'revisions'], issues);
  for (const secretPath of findSecretLikePaths(input)) issues.push(issue(secretPath, 'SECRET_LIKE_FIELD', 'secret-like fields are forbidden'));
  if (input.schemaVersion !== 1) issues.push(issue('schemaVersion', 'VERSION_UNSUPPORTED', 'schemaVersion must equal 1'));
  nonNegative('revision', input.revision, issues);
  utc('evaluatedAtMs', input.evaluatedAtMs, issues);
  enumValue('overallReadiness', input.overallReadiness, PRODUCT_READINESS_STATES, issues);
  enumValue('tradeReadiness', input.tradeReadiness, PRODUCT_TRADE_READINESS_STATES, issues);
  let componentIds = new Set<unknown>();
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.length > MAX_COMPONENTS) {
    issues.push(issue('components', 'BOUNDED_ARRAY_REQUIRED', `components must contain 1..${MAX_COMPONENTS} entries`));
  } else {
    input.components.forEach((component, index) => issues.push(...validateProjectionComponent(component, `components[${index}]`)));
    const ids = input.components.filter(plainObject).map((component) => component.componentId);
    componentIds = new Set(ids);
    if (new Set(ids).size !== ids.length) issues.push(issue('components', 'DUPLICATE_COMPONENT', 'component IDs must be unique'));
  }
  if (!Array.isArray(input.dependencies) || input.dependencies.length > MAX_COMPONENTS * MAX_COMPONENTS) {
    issues.push(issue('dependencies', 'BOUNDED_ARRAY_REQUIRED', 'dependencies are invalid'));
  } else {
    const edges = new Set<string>();
    input.dependencies.forEach((dependency, index) => {
      const path = `dependencies[${index}]`;
      if (!plainObject(dependency)) {
        issues.push(issue(path, 'OBJECT_REQUIRED', 'dependency must be a plain object'));
        return;
      }
      closedObject(path, dependency, ['from', 'to', 'required', 'state', 'rootBlockerComponentId'], issues);
      id(`${path}.from`, dependency.from, issues);
      id(`${path}.to`, dependency.to, issues);
      if (!componentIds.has(dependency.from) || !componentIds.has(dependency.to)) issues.push(issue(path, 'DEPENDENCY_COMPONENT_UNKNOWN', 'dependency endpoint is not present in components'));
      if (typeof dependency.required !== 'boolean') issues.push(issue(`${path}.required`, 'BOOLEAN_REQUIRED', 'required must be boolean'));
      enumValue(`${path}.state`, dependency.state, ['AVAILABLE', 'DEGRADED', 'BLOCKED', 'UNKNOWN'], issues);
      nullableId(`${path}.rootBlockerComponentId`, dependency.rootBlockerComponentId, issues);
      if (dependency.rootBlockerComponentId !== null && !componentIds.has(dependency.rootBlockerComponentId)) issues.push(issue(`${path}.rootBlockerComponentId`, 'ROOT_BLOCKER_UNKNOWN', 'root blocker is not present in components'));
      const key = `${String(dependency.from)}|${String(dependency.to)}`;
      if (edges.has(key)) issues.push(issue(path, 'DUPLICATE_DEPENDENCY', 'dependency edge is duplicated'));
      edges.add(key);
    });
  }
  uniqueStrings('rootBlockerComponentIds', input.rootBlockerComponentIds, issues, { pattern: ID_PATTERN });
  if (Array.isArray(input.rootBlockerComponentIds)) {
    input.rootBlockerComponentIds.forEach((componentId, index) => {
      if (!componentIds.has(componentId)) issues.push(issue(`rootBlockerComponentIds[${index}]`, 'ROOT_BLOCKER_UNKNOWN', 'root blocker is not present in components'));
    });
  }
  if (!Array.isArray(input.operatorAttention) || input.operatorAttention.length > MAX_COMPONENTS) {
    issues.push(issue('operatorAttention', 'BOUNDED_ARRAY_REQUIRED', 'operatorAttention is invalid'));
  } else {
    input.operatorAttention.forEach((item, index) => {
      const path = `operatorAttention[${index}]`;
      if (!plainObject(item)) {
        issues.push(issue(path, 'OBJECT_REQUIRED', 'attention item must be a plain object'));
        return;
      }
      closedObject(path, item, ['componentId', 'rootBlockerComponentId', 'severity', 'reasonCodes', 'capitalExposed', 'recommendedOperatorAction'], issues);
      id(`${path}.componentId`, item.componentId, issues);
      id(`${path}.rootBlockerComponentId`, item.rootBlockerComponentId, issues);
      if (!componentIds.has(item.componentId) || !componentIds.has(item.rootBlockerComponentId)) issues.push(issue(path, 'ATTENTION_COMPONENT_UNKNOWN', 'attention component is not present in components'));
      enumValue(`${path}.severity`, item.severity, PRODUCT_SEVERITIES, issues);
      uniqueStrings(`${path}.reasonCodes`, item.reasonCodes, issues, { pattern: CODE_PATTERN, maximum: 128 });
      if (typeof item.capitalExposed !== 'boolean') issues.push(issue(`${path}.capitalExposed`, 'BOOLEAN_REQUIRED', 'capitalExposed must be boolean'));
      if (item.recommendedOperatorAction !== null && (typeof item.recommendedOperatorAction !== 'string' || item.recommendedOperatorAction.length === 0 || item.recommendedOperatorAction.length > 500)) issues.push(issue(`${path}.recommendedOperatorAction`, 'STRING_INVALID', 'recommended action is invalid'));
    });
  }
  if (!plainObject(input.revisions)) {
    issues.push(issue('revisions', 'OBJECT_REQUIRED', 'revisions is required'));
  } else {
    closedObject('revisions', input.revisions, ['build', 'config', 'schema', 'model'], issues);
    for (const field of ['build', 'config', 'schema', 'model'] as const) nullableId(`revisions.${field}`, input.revisions[field], issues);
  }
  try {
    const byteLength = new TextEncoder().encode(canonicalProductJson(input)).byteLength;
    if (byteLength > MAX_PRODUCT_SUPERVISOR_BYTES) issues.push(issue('', 'BYTE_LIMIT_EXCEEDED', `supervisor projection exceeds ${MAX_PRODUCT_SUPERVISOR_BYTES} UTF-8 bytes`));
  } catch {
    issues.push(issue('', 'JSON_SERIALIZATION_INVALID', 'supervisor projection is not canonical serializable JSON'));
  }
  return issues;
}

export function assertProductComponentEvidence(input: unknown): asserts input is ProductComponentEvidence {
  const issues = validateProductComponentEvidence(input);
  if (issues.length > 0) throw new TypeError(`invalid ProductComponentEvidence: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}`);
}

export function snapshotProductComponentEvidence(input: ProductComponentEvidence): Readonly<ProductComponentEvidence> {
  const snapshot: Readonly<ProductComponentEvidence> = Object.freeze({
    componentId: input.componentId, ownerId: input.ownerId, ownerPath: input.ownerPath,
    desiredState: input.desiredState, observedLifecycle: input.observedLifecycle, capability: input.capability,
    authority: input.authority, completeness: input.completeness, roles: Object.freeze([...input.roles]),
    requiredDependencies: Object.freeze([...input.requiredDependencies]), optionalDependencies: Object.freeze([...input.optionalDependencies]),
    timing: Object.freeze({ ...input.timing }), queue: input.queue === null ? null : Object.freeze({ ...input.queue }),
    queueRequired: input.queueRequired, blockerCodes: Object.freeze([...input.blockerCodes]),
    lastFailure: input.lastFailure === null ? null : Object.freeze({ ...input.lastFailure }),
    supportedCommandIds: Object.freeze([...input.supportedCommandIds]), revisions: Object.freeze({ ...input.revisions }),
    restartGeneration: input.restartGeneration, restartCount: input.restartCount, capitalExposed: input.capitalExposed,
    operatorAttentionRequired: input.operatorAttentionRequired, tradeCritical: input.tradeCritical,
    requiredForProductReadiness: input.requiredForProductReadiness,
  });
  assertProductComponentEvidence(snapshot);
  return snapshot;
}

export function assertProductSupervisorProjection(input: unknown): asserts input is ProductSupervisorProjection {
  const issues = validateProductSupervisorProjection(input);
  if (issues.length > 0) throw new TypeError(`invalid ProductSupervisorProjection: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}`);
}

function normalizeJson(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_PRODUCT_JSON_NODES) throw new RangeError('canonicalProductJson rejects overbound graphs');
  if (depth > MAX_PRODUCT_JSON_DEPTH) throw new RangeError('canonicalProductJson rejects overdeep graphs');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalProductJson rejects non-finite numbers');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`canonicalProductJson rejects ${typeof value}`);
  if (utilTypes.isProxy(value)) throw new TypeError('canonicalProductJson rejects Proxy values');
  if (seen.has(value)) throw new TypeError('canonicalProductJson rejects cyclic or aliased values');
  seen.add(value);
  let normalized: unknown;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('canonicalProductJson accepts ordinary arrays only');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string') || keys.length !== value.length + 1) {
      throw new TypeError('canonicalProductJson rejects sparse, decorated, or symbol-bearing arrays');
    }
    normalized = Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('canonicalProductJson rejects sparse arrays and accessors');
      }
      return normalizeJson(descriptor.value, seen, depth + 1, budget);
    });
  } else if (plainObject(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(descriptors).sort()) {
      record[key] = normalizeJson(descriptors[key]?.value, seen, depth + 1, budget);
    }
    normalized = record;
  } else {
    throw new TypeError('canonicalProductJson accepts accessor-free plain objects only');
  }
  seen.delete(value);
  return normalized;
}

export function canonicalProductJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new WeakSet<object>()));
}

export function deepFreezeProductJson<T>(value: T): Readonly<T> {
  normalizeJson(value, new WeakSet<object>());
  const freeze = (current: unknown, seen: WeakSet<object>): void => {
    if (typeof current !== 'object' || current === null || seen.has(current)) return;
    seen.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === 'length' && Array.isArray(current)) continue;
      freeze(Object.getOwnPropertyDescriptor(current, key)?.value, seen);
    }
    Object.freeze(current);
  };
  freeze(value, new WeakSet<object>());
  return value as Readonly<T>;
}

export type { ProductComponentProjection };
