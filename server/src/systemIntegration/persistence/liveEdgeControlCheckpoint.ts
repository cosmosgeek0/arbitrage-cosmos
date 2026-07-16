import { canonicalJson } from '../../foundation/contracts/index.js';
import {
  CONTROL_REASON_CODES,
  DURABLE_CONTROL_ACTION_TYPES,
  DURABLE_CONTROL_EVENT_SCHEMA,
  buildControlEvent,
  prepareControlEventAppend,
  validateDurableControlAction,
  validateRiskWitness,
  type DurableControlEvent,
} from '../../liveEdge/controls/index.js';

const MAX_UTC_MS = 4_102_444_800_000;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const COMMAND_ID = /^cmd_[a-f0-9]{16,64}$/;
const EVENT_ID = /^l14evt_[a-f0-9]{64}$/;
const ACTOR_BINDING = /^l14actor_[a-f0-9]{64}$/;
const HEAD_DIGEST = /^l14head_[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
  issues: string[],
): Record<string, unknown> | null {
  if (!plainObject(value)) {
    issues.push(`${path}:OBJECT_REQUIRED`);
    return null;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    issues.push(`${path}:UNKNOWN_OR_MISSING_FIELDS`);
    return null;
  }
  return value;
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function utcMillis(value: unknown): value is number {
  return safeInteger(value) && value <= MAX_UTC_MS;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function validateEvent(value: unknown, path: string, issues: string[]): Readonly<DurableControlEvent> | null {
  const kind = plainObject(value) ? value.kind : null;
  const variantFields = kind === 'CONTROL_INTENT_COMMITTED'
    ? ['action', 'expiresAtMs', 'decisionCode', 'riskWitness']
    : kind === 'CONTROL_APPLIED'
      ? ['applied', 'reasonCode', 'recoveryStateChanged']
      : kind === 'CONTROL_AWARENESS_RECORDED'
        ? ['recoveryRevision', 'awarenessOnly', 'recoveryStateChanged', 'reasonCode']
        : kind === 'CONTROL_REJECTED'
          ? ['reasonCode', 'redacted', 'intentCommitted', 'recoveryStateChanged']
          : null;
  if (variantFields === null) {
    issues.push(`${path}.kind:INVALID`);
    return null;
  }
  const row = exactRecord(value, [
    'schema', 'version', 'kind', 'commandId', 'previewDigest', 'actionType',
    'actorBinding', 'expectedConfigVersion', 'expectedControlRevision',
    'occurredAtMs', 'eventId', 'contentDigest', 'externalActionAuthorization',
    ...variantFields,
  ], path, issues);
  if (!row) return null;
  if (row.schema !== DURABLE_CONTROL_EVENT_SCHEMA) issues.push(`${path}.schema:INVALID`);
  if (row.version !== 1) issues.push(`${path}.version:INVALID`);
  if (typeof row.commandId !== 'string' || !COMMAND_ID.test(row.commandId)) issues.push(`${path}.commandId:INVALID`);
  if (typeof row.previewDigest !== 'string' || !SHA256.test(row.previewDigest)) issues.push(`${path}.previewDigest:INVALID`);
  if (!(DURABLE_CONTROL_ACTION_TYPES as readonly unknown[]).includes(row.actionType)) issues.push(`${path}.actionType:INVALID`);
  if (typeof row.actorBinding !== 'string' || !ACTOR_BINDING.test(row.actorBinding)) issues.push(`${path}.actorBinding:INVALID`);
  if (!safeInteger(row.expectedConfigVersion)) issues.push(`${path}.expectedConfigVersion:INVALID`);
  if (!safeInteger(row.expectedControlRevision)) issues.push(`${path}.expectedControlRevision:INVALID`);
  if (!utcMillis(row.occurredAtMs)) issues.push(`${path}.occurredAtMs:INVALID`);
  if (typeof row.eventId !== 'string' || !EVENT_ID.test(row.eventId)) issues.push(`${path}.eventId:INVALID`);
  if (typeof row.contentDigest !== 'string' || !SHA256.test(row.contentDigest)) issues.push(`${path}.contentDigest:INVALID`);
  if (row.externalActionAuthorization !== 'NONE') issues.push(`${path}.externalActionAuthorization:INVALID`);

  if (kind === 'CONTROL_INTENT_COMMITTED') {
    const action = validateDurableControlAction(row.action);
    if (!action.ok || action.value.type !== row.actionType) issues.push(`${path}.action:INVALID`);
    if (!utcMillis(row.expiresAtMs) || (utcMillis(row.occurredAtMs) && Number(row.expiresAtMs) <= row.occurredAtMs)) {
      issues.push(`${path}.expiresAtMs:INVALID`);
    }
    if (typeof row.decisionCode !== 'string' || !(CONTROL_REASON_CODES as readonly string[]).includes(row.decisionCode)) {
      issues.push(`${path}.decisionCode:INVALID`);
    }
    if (row.riskWitness !== null && !validateRiskWitness(row.riskWitness).ok) issues.push(`${path}.riskWitness:INVALID`);
  } else if (kind === 'CONTROL_APPLIED') {
    if (typeof row.applied !== 'boolean'
      || row.recoveryStateChanged !== false
      || !((row.applied === true && row.reasonCode === 'CONTROL_APPLIED')
        || (row.applied === false && row.reasonCode === 'CONTROL_NOOP'))) {
      issues.push(`${path}:APPLIED_EVENT_INCONSISTENT`);
    }
  } else if (kind === 'CONTROL_AWARENESS_RECORDED') {
    if (row.actionType !== 'ACKNOWLEDGE_RECOVERY'
      || typeof row.recoveryRevision !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.recoveryRevision)
      || row.awarenessOnly !== true
      || row.recoveryStateChanged !== false
      || row.reasonCode !== 'AWARENESS_RECORDED') {
      issues.push(`${path}:AWARENESS_EVENT_INCONSISTENT`);
    }
  } else if (row.redacted !== true
    || typeof row.intentCommitted !== 'boolean'
    || row.recoveryStateChanged !== false
    || typeof row.reasonCode !== 'string'
    || !(CONTROL_REASON_CODES as readonly string[]).includes(row.reasonCode)
    || ['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(String(row.reasonCode))) {
    issues.push(`${path}:REJECTION_EVENT_INCONSISTENT`);
  }

  if (issues.some((issue) => issue.startsWith(path))) return null;
  const event = row as unknown as Readonly<DurableControlEvent>;
  const { eventId: _eventId, contentDigest: _contentDigest, ...draft } = event;
  try {
    if (!canonicalEqual(buildControlEvent(draft), event)) issues.push(`${path}:EVENT_ID_OR_DIGEST_MISMATCH`);
  } catch {
    issues.push(`${path}:EVENT_REGENERATION_FAILED`);
  }
  return issues.some((issue) => issue.startsWith(path)) ? null : event;
}

export interface ValidatedPersistedLiveEdgeControlEvent {
  readonly storageKey: string;
  readonly storageKind: 'JOURNAL' | 'PRE_INTENT_AUDIT';
  readonly commandId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly journalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly headDigest: string;
  readonly event: Readonly<DurableControlEvent>;
  readonly occurredAtMs: number;
  readonly checkpointRevision: number;
}

export function validatePersistedLiveEdgeControlEvents(
  value: unknown,
  checkpointRevision: unknown,
  maximum: number,
): readonly string[] {
  const issues: string[] = [];
  if (!Array.isArray(value)) return Object.freeze(['$.liveEdgeControlEvents:ARRAY_REQUIRED']);
  if (value.length > maximum) issues.push('$.liveEdgeControlEvents:COUNT_LIMIT_EXCEEDED');
  const rows: ValidatedPersistedLiveEdgeControlEvent[] = [];
  value.slice(0, maximum + 1).forEach((candidate, index) => {
    const path = `$.liveEdgeControlEvents[${index}]`;
    const row = exactRecord(candidate, [
      'storageKey', 'storageKind', 'commandId', 'eventId', 'idempotencyKey',
      'appendRequestDigest', 'journalVersion', 'previousHeadDigest', 'headDigest',
      'event', 'occurredAtMs', 'checkpointRevision',
    ], path, issues);
    if (!row) return;
    if (typeof row.storageKey !== 'string' || !IDENTIFIER.test(row.storageKey)) issues.push(`${path}.storageKey:INVALID`);
    if (!['JOURNAL', 'PRE_INTENT_AUDIT'].includes(String(row.storageKind))) issues.push(`${path}.storageKind:INVALID`);
    if (typeof row.commandId !== 'string' || !COMMAND_ID.test(row.commandId)) issues.push(`${path}.commandId:INVALID`);
    if (typeof row.eventId !== 'string' || !EVENT_ID.test(row.eventId)) issues.push(`${path}.eventId:INVALID`);
    if (typeof row.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(row.idempotencyKey)) issues.push(`${path}.idempotencyKey:INVALID`);
    if (typeof row.appendRequestDigest !== 'string' || !SHA256.test(row.appendRequestDigest)) issues.push(`${path}.appendRequestDigest:INVALID`);
    if (!safeInteger(row.journalVersion, 1)) issues.push(`${path}.journalVersion:INVALID`);
    if (row.previousHeadDigest !== null && (typeof row.previousHeadDigest !== 'string' || !HEAD_DIGEST.test(row.previousHeadDigest))) issues.push(`${path}.previousHeadDigest:INVALID`);
    if (typeof row.headDigest !== 'string' || !HEAD_DIGEST.test(row.headDigest)) issues.push(`${path}.headDigest:INVALID`);
    if (!utcMillis(row.occurredAtMs)) issues.push(`${path}.occurredAtMs:INVALID`);
    if (!safeInteger(row.checkpointRevision, 1)
      || (safeInteger(checkpointRevision) && row.checkpointRevision > checkpointRevision)) issues.push(`${path}.checkpointRevision:INVALID`);
    const event = validateEvent(row.event, `${path}.event`, issues);
    if (!event || issues.some((issue) => issue.startsWith(path) && !issue.startsWith(`${path}.event`))) return;
    const preIntentAudit = event.kind === 'CONTROL_REJECTED' && event.intentCommitted === false;
    const expectedKind = preIntentAudit ? 'PRE_INTENT_AUDIT' : 'JOURNAL';
    const expectedPrefix = preIntentAudit ? 'l14audit' : 'l14control';
    if (row.storageKind !== expectedKind) issues.push(`${path}.storageKind:EVENT_CLASS_MISMATCH`);
    if (row.storageKey !== `${expectedPrefix}:${row.idempotencyKey}`) issues.push(`${path}.storageKey:BINDING_MISMATCH`);
    if (event.commandId !== row.commandId || event.eventId !== row.eventId || event.occurredAtMs !== row.occurredAtMs) {
      issues.push(`${path}:EVENT_BINDING_MISMATCH`);
    }
    if (preIntentAudit && (row.journalVersion !== 1 || row.previousHeadDigest !== null)) {
      issues.push(`${path}:PRE_INTENT_AUDIT_RESERVED_JOURNAL`);
    }
    try {
      const request = prepareControlEventAppend(
        event,
        Number(row.journalVersion) - 1,
        row.previousHeadDigest as string | null,
      );
      if (request.idempotencyKey !== row.idempotencyKey
        || request.appendRequestDigest !== row.appendRequestDigest
        || request.nextHeadDigest !== row.headDigest) issues.push(`${path}:APPEND_BINDING_MISMATCH`);
    } catch {
      issues.push(`${path}:APPEND_REGENERATION_FAILED`);
    }
    if (!issues.some((issue) => issue.startsWith(path))) {
      rows.push(row as unknown as ValidatedPersistedLiveEdgeControlEvent);
    }
  });

  const duplicate = (values: readonly string[], path: string): void => {
    if (new Set(values).size !== values.length) issues.push(`${path}:DUPLICATE`);
  };
  duplicate(rows.map((row) => row.storageKey), '$.liveEdgeControlEvents.storageKey');
  duplicate(rows.map((row) => row.eventId), '$.liveEdgeControlEvents.eventId');

  const journals = new Map<string, ValidatedPersistedLiveEdgeControlEvent[]>();
  for (const row of rows) {
    if (row.storageKind !== 'JOURNAL') continue;
    const current = journals.get(row.commandId) ?? [];
    current.push(row);
    journals.set(row.commandId, current);
  }
  let pendingCount = 0;
  for (const [commandId, journal] of journals) {
    journal.sort((left, right) => left.journalVersion - right.journalVersion);
    const path = `$.liveEdgeControlEvents.journal[${commandId}]`;
    if (journal.length < 1 || journal.length > 2
      || journal[0].journalVersion !== 1
      || journal[0].previousHeadDigest !== null
      || journal[0].event.kind !== 'CONTROL_INTENT_COMMITTED') {
      issues.push(`${path}:INTENT_REQUIRED`);
      continue;
    }
    const intent = journal[0].event;
    if (intent.kind !== 'CONTROL_INTENT_COMMITTED') continue;
    for (let index = 0; index < journal.length; index += 1) {
      const row = journal[index];
      if (row.journalVersion !== index + 1
        || (index > 0 && row.previousHeadDigest !== journal[index - 1].headDigest)
        || row.event.previewDigest !== intent.previewDigest
        || row.event.actorBinding !== intent.actorBinding
        || row.event.actionType !== intent.actionType
        || row.event.expectedConfigVersion !== intent.expectedConfigVersion
        || row.event.expectedControlRevision !== intent.expectedControlRevision
        || row.event.occurredAtMs < intent.occurredAtMs) {
        issues.push(`${path}:CONTINUITY_INVALID`);
      }
    }
    if (journal.length === 2) {
      const terminal = journal[1].event;
      if (terminal.kind === 'CONTROL_INTENT_COMMITTED'
        || (terminal.kind === 'CONTROL_REJECTED' && terminal.intentCommitted !== true)
        || ((terminal.kind === 'CONTROL_APPLIED' || terminal.kind === 'CONTROL_AWARENESS_RECORDED')
          && terminal.occurredAtMs >= intent.expiresAtMs)
        || (terminal.kind === 'CONTROL_AWARENESS_RECORDED'
          && (intent.action.type !== 'ACKNOWLEDGE_RECOVERY'
            || terminal.recoveryRevision !== intent.action.observedRecoveryRevision))
        || (terminal.kind === 'CONTROL_APPLIED' && intent.action.type === 'ACKNOWLEDGE_RECOVERY')) {
        issues.push(`${path}:TERMINAL_INVALID`);
      }
    } else {
      pendingCount += 1;
    }
  }
  if (pendingCount > 1) issues.push('$.liveEdgeControlEvents:MULTIPLE_PENDING_INTENTS');
  if (maximum - value.length < pendingCount) {
    issues.push('$.liveEdgeControlEvents:TERMINAL_CAPACITY_NOT_RESERVED');
  }
  return Object.freeze(issues.slice(0, 128));
}

export function countPendingLiveEdgeControlIntents(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const counts = new Map<string, number>();
  for (const row of value) {
    if (!plainObject(row) || row.storageKind !== 'JOURNAL' || typeof row.commandId !== 'string') continue;
    counts.set(row.commandId, (counts.get(row.commandId) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count === 1).length;
}
