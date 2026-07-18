import { createHash } from 'node:crypto';

import {
  DIALECT_LOSS_CODES,
  SYSTEM_COMPONENT_IDS,
  SYSTEM_RELEASE_STATUSES,
  SYSTEM_SAFE_MODES,
  SYSTEM_TRACE_EVENT_KINDS,
  SYSTEM_TRUTH_LABELS,
} from '../contracts/constants.js';
import type { SystemTraceEvent } from '../contracts/types.js';
import {
  SYSTEM_PERSISTENCE_LIMITS,
  SYSTEM_PERSISTENCE_SCHEMA,
  SYSTEM_PERSISTENCE_VERSION,
  type PersistenceResult,
  type SystemIntegrationCheckpointState,
  type SystemJsonValue,
  type SystemPersistenceCheckpoint,
} from './types.js';
import { validatePersistedLiveEdgeControlEvents } from './liveEdgeControlCheckpoint.js';

const MAX_UTC_MS = 4_102_444_800_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const DOMAIN_STATE = /^[A-Z][A-Z0-9_.:-]{0,127}$/;
const DIGEST = /^[a-z0-9][a-z0-9._:-]{0,255}$/i;
const REASON_CODE = /^[A-Z][A-Z0-9_.:-]{0,127}$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY = /(?:secret|api[_-]?key|private[_-]?key|authorization|cookie|credential|password|signature|signed[_-]?request)/i;
const SENSITIVE_TEXT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;

export class PersistenceValidationError extends Error {
  readonly code = 'CHECKPOINT_INVALID';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`system integration checkpoint is invalid: ${issues.slice(0, 8).join(', ')}`);
    this.name = 'PersistenceValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, issues: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    issues.push(`${path}:UNKNOWN_OR_MISSING_FIELDS`);
  }
}

function safeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function utcMillis(value: unknown): value is number {
  return safeInteger(value, 0, MAX_UTC_MS);
}

function boundedIdentifier(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum && IDENTIFIER.test(value);
}

function boundedDigest(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum && DIGEST.test(value);
}

function domainState(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_STATE.test(value);
}

function inspectJson(value: unknown): string[] {
  const issues: string[] = [];
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; path: string; depth: number; exit?: boolean }> = [
    { value, path: '$', depth: 0 },
  ];
  let nodes = 0;

  while (stack.length > 0 && issues.length < 128) {
    const current = stack.pop() as { value: unknown; path: string; depth: number; exit?: boolean };
    if (current.exit) {
      if (current.value !== null && typeof current.value === 'object') seen.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > SYSTEM_PERSISTENCE_LIMITS.maximumJsonNodes) {
      issues.push('$:NODE_LIMIT_EXCEEDED');
      break;
    }
    if (current.depth > SYSTEM_PERSISTENCE_LIMITS.maximumJsonDepth) {
      issues.push(`${current.path}:DEPTH_LIMIT_EXCEEDED`);
      continue;
    }

    const candidate = current.value;
    if (candidate === null || typeof candidate === 'boolean') continue;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) issues.push(`${current.path}:FINITE_NUMBER_REQUIRED`);
      continue;
    }
    if (typeof candidate === 'string') {
      if (Buffer.byteLength(candidate, 'utf8') > SYSTEM_PERSISTENCE_LIMITS.maximumStringBytes) {
        issues.push(`${current.path}:STRING_LIMIT_EXCEEDED`);
      }
      if (SENSITIVE_TEXT.test(candidate)) issues.push(`${current.path}:SENSITIVE_TEXT_FORBIDDEN`);
      continue;
    }
    if (typeof candidate !== 'object') {
      issues.push(`${current.path}:UNSERIALIZABLE_VALUE`);
      continue;
    }
    if (seen.has(candidate)) {
      issues.push(`${current.path}:CYCLIC_VALUE`);
      continue;
    }
    seen.add(candidate);
    stack.push({ ...current, exit: true });

    if (Array.isArray(candidate)) {
      if (candidate.length > SYSTEM_PERSISTENCE_LIMITS.maximumArrayLength) {
        issues.push(`${current.path}:ARRAY_LIMIT_EXCEEDED`);
        continue;
      }
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        stack.push({ value: candidate[index], path: `${current.path}[${index}]`, depth: current.depth + 1 });
      }
      continue;
    }
    if (!plainObject(candidate)) {
      issues.push(`${current.path}:PLAIN_OBJECT_REQUIRED`);
      continue;
    }
    const keys = Object.keys(candidate);
    if (keys.length > SYSTEM_PERSISTENCE_LIMITS.maximumObjectKeys) {
      issues.push(`${current.path}:OBJECT_KEY_LIMIT_EXCEEDED`);
      continue;
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const explicitlyNoneAuthorization = key === 'externalActionAuthorization'
        && (candidate as Record<string, unknown>)[key] === 'NONE';
      if (FORBIDDEN_KEY.test(key) && !explicitlyNoneAuthorization) {
        issues.push(`${current.path}.${key}:SECRET_FIELD_FORBIDDEN`);
      }
      if (Buffer.byteLength(key, 'utf8') > 256) issues.push(`${current.path}.${key}:FIELD_NAME_LIMIT_EXCEEDED`);
      stack.push({
        value: (candidate as Record<string, unknown>)[key],
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }
  return issues;
}

function encodeCanonical(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`non-canonical number at ${path}`);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') throw new TypeError(`unserializable value at ${path}`);
  if (seen.has(value)) throw new TypeError(`cyclic value at ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry, index) => encodeCanonical(entry, `${path}[${index}]`, seen)).join(',')}]`;
    }
    if (!plainObject(value)) throw new TypeError(`non-plain object at ${path}`);
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${encodeCanonical(value[key], `${path}.${key}`, seen)}`
    )).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalPersistenceJson(value: unknown): string {
  const issues = inspectJson(value);
  if (issues.length > 0) throw new PersistenceValidationError(issues);
  const encoded = encodeCanonical(value, '$', new Set<object>());
  if (Buffer.byteLength(encoded, 'utf8') > SYSTEM_PERSISTENCE_LIMITS.maximumCheckpointBytes) {
    throw new PersistenceValidationError(['$:CHECKPOINT_BYTE_LIMIT_EXCEEDED']);
  }
  return encoded;
}

export function persistenceDigest(value: unknown): string {
  const canonical = canonicalPersistenceJson(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function validateArray(
  value: unknown,
  path: string,
  maximum: number,
  issues: string[],
  validate: (record: Record<string, unknown>, index: number) => void,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    issues.push(`${path}:ARRAY_REQUIRED`);
    return [];
  }
  if (value.length > maximum) issues.push(`${path}:COUNT_LIMIT_EXCEEDED`);
  const records: Record<string, unknown>[] = [];
  value.slice(0, maximum + 1).forEach((entry, index) => {
    if (!plainObject(entry)) {
      issues.push(`${path}[${index}]:OBJECT_REQUIRED`);
      return;
    }
    records.push(entry);
    validate(entry, index);
  });
  return records;
}

function duplicateValues(values: readonly string[], path: string, issues: string[]): void {
  if (new Set(values).size !== values.length) issues.push(`${path}:DUPLICATE_ID`);
}

export function validateSystemTraceEvent(value: unknown): string[] {
  const issues = inspectJson(value);
  if (!plainObject(value)) return [...issues, '$:TRACE_OBJECT_REQUIRED'];
  exactKeys(value, [
    'id', 'sequence', 'kind', 'componentId', 'correlationId', 'occurredAtMs', 'persistedAtMs',
    'truthLabel', 'releaseStatuses', 'ownerId', 'canonicalProjectionId', 'revisionDigest',
    'domainLifecycle', 'machinePhase', 'failure', 'referenceIds', 'lossCodes',
  ], '$', issues);
  if (!boundedIdentifier(value.id)) issues.push('$.id:TRACE_ID_INVALID');
  if (!safeInteger(value.sequence, 1)) issues.push('$.sequence:POSITIVE_INTEGER_REQUIRED');
  if (!(SYSTEM_TRACE_EVENT_KINDS as readonly unknown[]).includes(value.kind)) issues.push('$.kind:TRACE_KIND_INVALID');
  if (!(SYSTEM_COMPONENT_IDS as readonly unknown[]).includes(value.componentId)) issues.push('$.componentId:COMPONENT_ID_INVALID');
  if (!boundedIdentifier(value.correlationId)) issues.push('$.correlationId:CORRELATION_ID_INVALID');
  if (!utcMillis(value.occurredAtMs)) issues.push('$.occurredAtMs:UTC_MILLIS_INVALID');
  if (value.persistedAtMs !== null && !utcMillis(value.persistedAtMs)) issues.push('$.persistedAtMs:UTC_MILLIS_INVALID');
  if (!(SYSTEM_TRUTH_LABELS as readonly unknown[]).includes(value.truthLabel)) issues.push('$.truthLabel:TRUTH_LABEL_INVALID');
  if (!Array.isArray(value.releaseStatuses)
    || value.releaseStatuses.length > SYSTEM_RELEASE_STATUSES.length
    || value.releaseStatuses.some((entry) => !(SYSTEM_RELEASE_STATUSES as readonly unknown[]).includes(entry))) {
    issues.push('$.releaseStatuses:RELEASE_STATUS_INVALID');
  }
  for (const field of ['ownerId', 'canonicalProjectionId', 'revisionDigest', 'domainLifecycle', 'machinePhase'] as const) {
    if (value[field] !== null && !boundedIdentifier(value[field])) issues.push(`$.${field}:IDENTIFIER_INVALID`);
  }
  if (!Array.isArray(value.referenceIds) || value.referenceIds.length > 64
    || value.referenceIds.some((entry) => !boundedIdentifier(entry))) issues.push('$.referenceIds:REFERENCE_IDS_INVALID');
  if (!Array.isArray(value.lossCodes) || value.lossCodes.length > DIALECT_LOSS_CODES.length
    || value.lossCodes.some((entry) => !(DIALECT_LOSS_CODES as readonly unknown[]).includes(entry))) {
    issues.push('$.lossCodes:LOSS_CODES_INVALID');
  }
  return issues;
}

export function validateCheckpointState(value: unknown): string[] {
  const issues = inspectJson(value);
  if (!plainObject(value)) return [...issues, '$:STATE_OBJECT_REQUIRED'];
  exactKeys(value, [
    'revision', 'generation', 'control', 'desiredComponents', 'authorityReferences', 'reservations',
    'approvals', 'dryRunExecutions', 'reconciliations', 'idempotencyReceipts', 'liveEdgeControlEvents', 'traceIndex',
    'controlRejections', 'restartTruth', 'lastStartup', 'lastShutdown',
  ], '$', issues);
  if (!safeInteger(value.revision)) issues.push('$.revision:NON_NEGATIVE_INTEGER_REQUIRED');
  if (!safeInteger(value.generation)) issues.push('$.generation:NON_NEGATIVE_INTEGER_REQUIRED');

  const control = value.control;
  if (!plainObject(control)) issues.push('$.control:OBJECT_REQUIRED');
  else {
    exactKeys(control, [
      'revision', 'generation', 'safeMode', 'killSwitchEngaged', 'intakePaused', 'updatedAtMs', 'correlationId',
    ], '$.control', issues);
    if (!safeInteger(control.revision)) issues.push('$.control.revision:NON_NEGATIVE_INTEGER_REQUIRED');
    if (!safeInteger(control.generation) || control.generation !== value.generation) issues.push('$.control.generation:GENERATION_MISMATCH');
    if (!(SYSTEM_SAFE_MODES as readonly unknown[]).includes(control.safeMode)) issues.push('$.control.safeMode:SAFE_MODE_INVALID');
    if (typeof control.killSwitchEngaged !== 'boolean') issues.push('$.control.killSwitchEngaged:BOOLEAN_REQUIRED');
    if (typeof control.intakePaused !== 'boolean') issues.push('$.control.intakePaused:BOOLEAN_REQUIRED');
    if (!utcMillis(control.updatedAtMs)) issues.push('$.control.updatedAtMs:UTC_MILLIS_INVALID');
    if (!boundedIdentifier(control.correlationId)) issues.push('$.control.correlationId:CORRELATION_ID_INVALID');
  }

  const desired = validateArray(
    value.desiredComponents,
    '$.desiredComponents',
    SYSTEM_PERSISTENCE_LIMITS.maximumDesiredComponents,
    issues,
    (entry, index) => {
      exactKeys(entry, ['componentId', 'desiredState', 'generation', 'updatedAtMs'], `$.desiredComponents[${index}]`, issues);
      if (!(SYSTEM_COMPONENT_IDS as readonly unknown[]).includes(entry.componentId)) issues.push(`$.desiredComponents[${index}].componentId:INVALID`);
      if (!['STOPPED', 'RUNNING', 'PAUSED'].includes(String(entry.desiredState))) issues.push(`$.desiredComponents[${index}].desiredState:INVALID`);
      if (!safeInteger(entry.generation) || (safeInteger(value.generation) && (entry.generation as number) > (value.generation as number))) issues.push(`$.desiredComponents[${index}].generation:INVALID`);
      if (!utcMillis(entry.updatedAtMs)) issues.push(`$.desiredComponents[${index}].updatedAtMs:INVALID`);
    },
  );
  duplicateValues(desired.flatMap((entry) => typeof entry.componentId === 'string' ? [entry.componentId] : []), '$.desiredComponents', issues);

  const authority = validateArray(
    value.authorityReferences,
    '$.authorityReferences',
    SYSTEM_PERSISTENCE_LIMITS.maximumAuthorityReferences,
    issues,
    (entry, index) => {
      exactKeys(entry, ['kind', 'ownerId', 'ownerRevision', 'correlationId', 'updatedAtMs'], `$.authorityReferences[${index}]`, issues);
      if (!['PROPOSAL', 'MANDATE', 'CONFIGURATION', 'ACTIVE_POSITION_POLICY'].includes(String(entry.kind))) issues.push(`$.authorityReferences[${index}].kind:INVALID`);
      if (!boundedIdentifier(entry.ownerId)) issues.push(`$.authorityReferences[${index}].ownerId:INVALID`);
      if (!boundedDigest(entry.ownerRevision)) issues.push(`$.authorityReferences[${index}].ownerRevision:INVALID`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.authorityReferences[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.updatedAtMs)) issues.push(`$.authorityReferences[${index}].updatedAtMs:INVALID`);
    },
  );
  duplicateValues(authority.flatMap((entry) => typeof entry.kind === 'string' && typeof entry.ownerId === 'string' ? [`${entry.kind}:${entry.ownerId}`] : []), '$.authorityReferences', issues);

  const reservations = validateArray(
    value.reservations,
    '$.reservations',
    SYSTEM_PERSISTENCE_LIMITS.maximumReservations,
    issues,
    (entry, index) => {
      exactKeys(entry, ['reservationId', 'allocationKey', 'ownerRevision', 'domainState', 'blocksAllocation', 'correlationId', 'updatedAtMs'], `$.reservations[${index}]`, issues);
      if (!boundedIdentifier(entry.reservationId)) issues.push(`$.reservations[${index}].reservationId:INVALID`);
      if (!boundedIdentifier(entry.allocationKey)) issues.push(`$.reservations[${index}].allocationKey:INVALID`);
      if (!boundedDigest(entry.ownerRevision)) issues.push(`$.reservations[${index}].ownerRevision:INVALID`);
      if (!domainState(entry.domainState)) issues.push(`$.reservations[${index}].domainState:INVALID`);
      if (typeof entry.blocksAllocation !== 'boolean') issues.push(`$.reservations[${index}].blocksAllocation:BOOLEAN_REQUIRED`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.reservations[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.updatedAtMs)) issues.push(`$.reservations[${index}].updatedAtMs:INVALID`);
    },
  );
  duplicateValues(reservations.flatMap((entry) => typeof entry.reservationId === 'string' ? [entry.reservationId] : []), '$.reservations', issues);
  const blockingAllocationKeys = reservations.flatMap((entry) => entry.blocksAllocation === true && typeof entry.allocationKey === 'string' ? [entry.allocationKey] : []);
  duplicateValues(blockingAllocationKeys, '$.reservations.blockingAllocationKeys', issues);

  const approvals = validateArray(
    value.approvals,
    '$.approvals',
    SYSTEM_PERSISTENCE_LIMITS.maximumApprovals,
    issues,
    (entry, index) => {
      exactKeys(entry, ['approvalId', 'bindingDigest', 'ownerRevision', 'domainState', 'usable', 'expiresAtMs', 'correlationId', 'updatedAtMs'], `$.approvals[${index}]`, issues);
      if (!boundedIdentifier(entry.approvalId)) issues.push(`$.approvals[${index}].approvalId:INVALID`);
      if (!boundedDigest(entry.bindingDigest)) issues.push(`$.approvals[${index}].bindingDigest:INVALID`);
      if (!boundedDigest(entry.ownerRevision)) issues.push(`$.approvals[${index}].ownerRevision:INVALID`);
      if (!domainState(entry.domainState)) issues.push(`$.approvals[${index}].domainState:INVALID`);
      if (typeof entry.usable !== 'boolean') issues.push(`$.approvals[${index}].usable:BOOLEAN_REQUIRED`);
      if (entry.expiresAtMs !== null && !utcMillis(entry.expiresAtMs)) issues.push(`$.approvals[${index}].expiresAtMs:INVALID`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.approvals[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.updatedAtMs)) issues.push(`$.approvals[${index}].updatedAtMs:INVALID`);
    },
  );
  duplicateValues(approvals.flatMap((entry) => typeof entry.approvalId === 'string' ? [entry.approvalId] : []), '$.approvals', issues);

  const executions = validateArray(
    value.dryRunExecutions,
    '$.dryRunExecutions',
    SYSTEM_PERSISTENCE_LIMITS.maximumExecutions,
    issues,
    (entry, index) => {
      exactKeys(entry, ['planId', 'checkpointDigest', 'serializedCheckpoint', 'domainLifecycle', 'dryRun', 'requiresReconciliation', 'correlationId', 'updatedAtMs'], `$.dryRunExecutions[${index}]`, issues);
      if (!boundedIdentifier(entry.planId)) issues.push(`$.dryRunExecutions[${index}].planId:INVALID`);
      if (!boundedDigest(entry.checkpointDigest)) issues.push(`$.dryRunExecutions[${index}].checkpointDigest:INVALID`);
      if (typeof entry.serializedCheckpoint !== 'string' || entry.serializedCheckpoint.length < 2) issues.push(`$.dryRunExecutions[${index}].serializedCheckpoint:INVALID`);
      if (!domainState(entry.domainLifecycle)) issues.push(`$.dryRunExecutions[${index}].domainLifecycle:INVALID`);
      if (entry.dryRun !== true) issues.push(`$.dryRunExecutions[${index}].dryRun:TRUE_REQUIRED`);
      if (typeof entry.requiresReconciliation !== 'boolean') issues.push(`$.dryRunExecutions[${index}].requiresReconciliation:BOOLEAN_REQUIRED`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.dryRunExecutions[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.updatedAtMs)) issues.push(`$.dryRunExecutions[${index}].updatedAtMs:INVALID`);
    },
  );
  duplicateValues(executions.flatMap((entry) => typeof entry.planId === 'string' ? [entry.planId] : []), '$.dryRunExecutions', issues);

  const reconciliations = validateArray(
    value.reconciliations,
    '$.reconciliations',
    SYSTEM_PERSISTENCE_LIMITS.maximumReconciliations,
    issues,
    (entry, index) => {
      exactKeys(entry, ['planId', 'ownerRevision', 'domainStatus', 'allowsNewExposure', 'reasonCodes', 'correlationId', 'observedAtMs'], `$.reconciliations[${index}]`, issues);
      if (!boundedIdentifier(entry.planId)) issues.push(`$.reconciliations[${index}].planId:INVALID`);
      if (!boundedDigest(entry.ownerRevision)) issues.push(`$.reconciliations[${index}].ownerRevision:INVALID`);
      if (!domainState(entry.domainStatus)) issues.push(`$.reconciliations[${index}].domainStatus:INVALID`);
      if (typeof entry.allowsNewExposure !== 'boolean') issues.push(`$.reconciliations[${index}].allowsNewExposure:BOOLEAN_REQUIRED`);
      if (!Array.isArray(entry.reasonCodes) || entry.reasonCodes.length > SYSTEM_PERSISTENCE_LIMITS.maximumReasonCodes
        || entry.reasonCodes.some((reason) => typeof reason !== 'string' || !REASON_CODE.test(reason))) issues.push(`$.reconciliations[${index}].reasonCodes:INVALID`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.reconciliations[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.observedAtMs)) issues.push(`$.reconciliations[${index}].observedAtMs:INVALID`);
    },
  );
  duplicateValues(reconciliations.flatMap((entry) => typeof entry.planId === 'string' ? [entry.planId] : []), '$.reconciliations', issues);

  const idempotency = validateArray(
    value.idempotencyReceipts,
    '$.idempotencyReceipts',
    SYSTEM_PERSISTENCE_LIMITS.maximumIdempotencyReceipts,
    issues,
    (entry, index) => {
      exactKeys(entry, ['idempotencyKey', 'requestDigest', 'correlationId', 'recordedAtMs', 'checkpointRevision', 'receipt'], `$.idempotencyReceipts[${index}]`, issues);
      if (!boundedIdentifier(entry.idempotencyKey)) issues.push(`$.idempotencyReceipts[${index}].idempotencyKey:INVALID`);
      if (!boundedDigest(entry.requestDigest)) issues.push(`$.idempotencyReceipts[${index}].requestDigest:INVALID`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.idempotencyReceipts[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.recordedAtMs)) issues.push(`$.idempotencyReceipts[${index}].recordedAtMs:INVALID`);
      if (!safeInteger(entry.checkpointRevision) || (safeInteger(value.revision) && (entry.checkpointRevision as number) > (value.revision as number))) issues.push(`$.idempotencyReceipts[${index}].checkpointRevision:INVALID`);
      const receiptIssues = inspectJson(entry.receipt);
      issues.push(...receiptIssues.map((issue) => `$.idempotencyReceipts[${index}].receipt${issue.slice(1)}`));
    },
  );
  duplicateValues(idempotency.flatMap((entry) => typeof entry.idempotencyKey === 'string' ? [entry.idempotencyKey] : []), '$.idempotencyReceipts', issues);

  issues.push(...validatePersistedLiveEdgeControlEvents(
    value.liveEdgeControlEvents,
    value.revision,
    SYSTEM_PERSISTENCE_LIMITS.maximumLiveEdgeControlEvents,
  ));

  const controlRejections = validateArray(
    value.controlRejections,
    '$.controlRejections',
    SYSTEM_PERSISTENCE_LIMITS.maximumControlRejections,
    issues,
    (entry, index) => {
      exactKeys(entry, [
        'dedupeKey', 'idempotencyKey', 'requestDigest', 'command', 'expectedRevision',
        'currentRevision', 'code', 'message', 'correlationId', 'occurredAtMs',
        'actorIdDigest', 'actorSource', 'checkpointRevision',
      ], `$.controlRejections[${index}]`, issues);
      if (!boundedIdentifier(entry.dedupeKey)) issues.push(`$.controlRejections[${index}].dedupeKey:INVALID`);
      if (entry.idempotencyKey !== null && !boundedIdentifier(entry.idempotencyKey, 128)) issues.push(`$.controlRejections[${index}].idempotencyKey:INVALID`);
      if (!boundedDigest(entry.requestDigest)) issues.push(`$.controlRejections[${index}].requestDigest:INVALID`);
      if (entry.command !== null && !domainState(entry.command)) issues.push(`$.controlRejections[${index}].command:INVALID`);
      if (entry.expectedRevision !== null && !safeInteger(entry.expectedRevision)) issues.push(`$.controlRejections[${index}].expectedRevision:INVALID`);
      if (!safeInteger(entry.currentRevision)) issues.push(`$.controlRejections[${index}].currentRevision:INVALID`);
      if (typeof entry.code !== 'string' || !REASON_CODE.test(entry.code)) issues.push(`$.controlRejections[${index}].code:INVALID`);
      if (entry.message !== 'Control request rejected.') issues.push(`$.controlRejections[${index}].message:INVALID`);
      if (!boundedIdentifier(entry.correlationId, 128)) issues.push(`$.controlRejections[${index}].correlationId:INVALID`);
      if (!utcMillis(entry.occurredAtMs)) issues.push(`$.controlRejections[${index}].occurredAtMs:INVALID`);
      if (!CHECKSUM.test(String(entry.actorIdDigest))) issues.push(`$.controlRejections[${index}].actorIdDigest:INVALID`);
      if (!['loopback', 'cloudflare-access', 'canonical-alarm'].includes(String(entry.actorSource))) issues.push(`$.controlRejections[${index}].actorSource:INVALID`);
      if (!safeInteger(entry.checkpointRevision) || (safeInteger(value.revision) && (entry.checkpointRevision as number) > (value.revision as number))) issues.push(`$.controlRejections[${index}].checkpointRevision:INVALID`);
    },
  );
  duplicateValues(controlRejections.flatMap((entry) => typeof entry.dedupeKey === 'string' ? [entry.dedupeKey] : []), '$.controlRejections', issues);

  const traceIndex = validateArray(
    value.traceIndex,
    '$.traceIndex',
    SYSTEM_PERSISTENCE_LIMITS.maximumTraceIndexEntries,
    issues,
    (entry, index) => {
      exactKeys(entry, ['eventId', 'correlationId', 'eventDigest', 'occurredAtMs'], `$.traceIndex[${index}]`, issues);
      if (!boundedIdentifier(entry.eventId)) issues.push(`$.traceIndex[${index}].eventId:INVALID`);
      if (!boundedIdentifier(entry.correlationId)) issues.push(`$.traceIndex[${index}].correlationId:INVALID`);
      if (!CHECKSUM.test(String(entry.eventDigest))) issues.push(`$.traceIndex[${index}].eventDigest:INVALID`);
      if (!utcMillis(entry.occurredAtMs)) issues.push(`$.traceIndex[${index}].occurredAtMs:INVALID`);
    },
  );
  duplicateValues(traceIndex.flatMap((entry) => typeof entry.eventId === 'string' ? [entry.eventId] : []), '$.traceIndex', issues);

  const truth = value.restartTruth;
  if (!plainObject(truth)) issues.push('$.restartTruth:OBJECT_REQUIRED');
  else {
    exactKeys(truth, ['publicSourceTruth', 'accountTruth', 'reconciliationTruth', 'observedAtMs'], '$.restartTruth', issues);
    for (const field of ['publicSourceTruth', 'accountTruth', 'reconciliationTruth'] as const) {
      if (!['FRESH', 'STALE', 'UNKNOWN', 'UNAVAILABLE'].includes(String(truth[field]))) issues.push(`$.restartTruth.${field}:INVALID`);
    }
    if (truth.observedAtMs !== null && !utcMillis(truth.observedAtMs)) issues.push('$.restartTruth.observedAtMs:INVALID');
  }

  const startup = value.lastStartup;
  if (startup !== null) {
    if (!plainObject(startup)) issues.push('$.lastStartup:OBJECT_REQUIRED');
    else {
      exactKeys(startup, ['generation', 'startedAtMs', 'correlationId', 'restoredFromRevision'], '$.lastStartup', issues);
      if (!safeInteger(startup.generation) || (safeInteger(value.generation) && (startup.generation as number) > (value.generation as number))) issues.push('$.lastStartup.generation:GENERATION_MISMATCH');
      if (!utcMillis(startup.startedAtMs)) issues.push('$.lastStartup.startedAtMs:INVALID');
      if (!boundedIdentifier(startup.correlationId)) issues.push('$.lastStartup.correlationId:INVALID');
      if (!safeInteger(startup.restoredFromRevision) || (safeInteger(value.revision) && (startup.restoredFromRevision as number) > (value.revision as number))) issues.push('$.lastStartup.restoredFromRevision:INVALID');
    }
  }

  const shutdown = value.lastShutdown;
  if (shutdown !== null) {
    if (!plainObject(shutdown)) issues.push('$.lastShutdown:OBJECT_REQUIRED');
    else {
      exactKeys(shutdown, ['generation', 'stoppedAtMs', 'correlationId', 'clean', 'finalComponentStateDigest'], '$.lastShutdown', issues);
      if (!safeInteger(shutdown.generation) || (safeInteger(value.generation) && (shutdown.generation as number) > (value.generation as number))) issues.push('$.lastShutdown.generation:INVALID');
      if (!utcMillis(shutdown.stoppedAtMs)) issues.push('$.lastShutdown.stoppedAtMs:INVALID');
      if (!boundedIdentifier(shutdown.correlationId)) issues.push('$.lastShutdown.correlationId:INVALID');
      if (typeof shutdown.clean !== 'boolean') issues.push('$.lastShutdown.clean:BOOLEAN_REQUIRED');
      if (!CHECKSUM.test(String(shutdown.finalComponentStateDigest))) issues.push('$.lastShutdown.finalComponentStateDigest:INVALID');
    }
  }
  return issues.slice(0, 128);
}

function frozenClone<T>(value: T): Readonly<T> {
  const encoded = canonicalPersistenceJson(value);
  const clone = JSON.parse(encoded) as T;
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export function encodeSystemCheckpoint(state: Readonly<SystemIntegrationCheckpointState>): string {
  const issues = validateCheckpointState(state);
  if (issues.length > 0) throw new PersistenceValidationError(issues);
  const payload = {
    schema: SYSTEM_PERSISTENCE_SCHEMA,
    version: SYSTEM_PERSISTENCE_VERSION,
    state,
  } as const;
  const checkpoint: SystemPersistenceCheckpoint = {
    ...payload,
    checksum: persistenceDigest(payload),
  };
  return canonicalPersistenceJson(checkpoint);
}

export function decodeSystemCheckpoint(serialized: string): PersistenceResult<Readonly<SystemIntegrationCheckpointState>> {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > SYSTEM_PERSISTENCE_LIMITS.maximumCheckpointBytes) {
    return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint is missing or exceeds its byte bound' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint is not valid JSON' };
  }
  if (!plainObject(parsed)) return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint must be an object' };
  const keys = Object.keys(parsed).sort().join('|');
  if (keys !== ['checksum', 'schema', 'state', 'version'].sort().join('|')) {
    return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint contains missing or unknown fields' };
  }
  if (parsed.schema !== SYSTEM_PERSISTENCE_SCHEMA || parsed.version !== SYSTEM_PERSISTENCE_VERSION) {
    return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint schema or version is unsupported' };
  }
  if (typeof parsed.checksum !== 'string' || !CHECKSUM.test(parsed.checksum)) {
    return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint checksum is malformed' };
  }
  try {
    const expected = persistenceDigest({ schema: parsed.schema, version: parsed.version, state: parsed.state });
    if (parsed.checksum !== expected) return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint checksum does not match its state' };
    if (canonicalPersistenceJson(parsed) !== serialized) return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint is not canonically serialized' };
    if (!plainObject(parsed.state)) return { ok: false, code: 'CHECKPOINT_INVALID', message: 'checkpoint state must be an object' };
    const migratedState = Object.hasOwn(parsed.state, 'liveEdgeControlEvents')
      ? parsed.state
      : { ...parsed.state, liveEdgeControlEvents: [] };
    const issues = validateCheckpointState(migratedState);
    if (issues.length > 0) return { ok: false, code: 'CHECKPOINT_INVALID', message: `checkpoint state failed validation: ${issues.slice(0, 8).join(', ')}` };
    return { ok: true, value: frozenClone(migratedState as unknown as SystemIntegrationCheckpointState) };
  } catch (error) {
    return {
      ok: false,
      code: 'CHECKPOINT_INVALID',
      message: error instanceof Error ? error.message : 'checkpoint canonicalization failed',
    };
  }
}

export function cloneCheckpointState(
  state: Readonly<SystemIntegrationCheckpointState>,
): Readonly<SystemIntegrationCheckpointState> {
  return frozenClone(state);
}

export function traceEventDigest(event: Readonly<SystemTraceEvent>): string {
  const issues = validateSystemTraceEvent(event);
  if (issues.length > 0) throw new PersistenceValidationError(issues);
  return persistenceDigest(event);
}
