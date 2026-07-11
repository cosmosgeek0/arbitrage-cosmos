/** Guarded event/trigger construction and deterministic replay ordering. */
import {
  createSourcedTimestamp,
  deriveEventId,
  isDataAuthority,
  isValidUtcMillis,
  ok,
  validateSourcedTimestamp,
  type ContractResult,
} from '../contracts/index.js';
import { replayFailure, REPLAY_FAILURE_CODES } from './failures.js';
import { guardReplayPayload } from './guard.js';
import {
  REPLAY_EVENT_VERSION,
  REPLAY_PHASES,
  REPLAY_TRIGGER_VERSION,
  type ReplayEvent,
  type ReplayEventInput,
  type ReplayPhase,
  type ReplayTrigger,
  type ReplayTriggerInput,
} from './types.js';

function isBoundedLabel(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isCorrelationId(value: unknown): value is string | null {
  return value === null || isBoundedLabel(value, 128);
}

const EVENT_INPUT_KEYS = [
  'streamId',
  'sequence',
  'kind',
  'timestamp',
  'correlationId',
  'payload',
] as const;
const TIMESTAMP_INPUT_KEYS = [
  'sourceTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'sourceId',
] as const;
const TRIGGER_INPUT_KEYS = [
  'triggerId',
  'kind',
  'sourceTimeMs',
  'receivedAtMs',
  'authority',
  'sourceId',
  'correlationId',
] as const;

/** Exact enumerable data records only; reads no getter values. */
function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== 'string')) return null;
  const expected = new Set(expectedKeys);
  for (const key of ownKeys as string[]) {
    if (!expected.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
  }
  return value as Record<string, unknown>;
}

export function safeReplayCorrelationId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'correlationId');
  return descriptor && !descriptor.get && !descriptor.set && isCorrelationId(descriptor.value)
    ? descriptor.value
    : null;
}

export function isReplayPhase(value: unknown): value is ReplayPhase {
  return typeof value === 'string' && (REPLAY_PHASES as readonly string[]).includes(value);
}

/** Source-time when present; receipt-time only when source-time is unknown. */
export function replayEventTimeMs(event: ReplayEvent): number {
  return event.timestamp.sourceTimeMs ?? event.timestamp.receivedAtMs;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Stable total order independent of arrival-array position:
 * event time -> receipt time -> source -> stream -> sequence -> event id.
 */
export function compareReplayEvents(a: ReplayEvent, b: ReplayEvent): number {
  const eventTime = replayEventTimeMs(a) - replayEventTimeMs(b);
  if (eventTime !== 0) return eventTime;
  const receiptTime = a.timestamp.receivedAtMs - b.timestamp.receivedAtMs;
  if (receiptTime !== 0) return receiptTime;
  const source = compareString(a.timestamp.sourceId, b.timestamp.sourceId);
  if (source !== 0) return source;
  const stream = compareString(a.streamId, b.streamId);
  if (stream !== 0) return stream;
  const sequence = a.sequence - b.sequence;
  if (sequence !== 0) return sequence;
  return compareString(a.eventId, b.eventId);
}

export function sortReplayEvents(events: readonly ReplayEvent[]): readonly Readonly<ReplayEvent>[] {
  return Object.freeze([...events].sort(compareReplayEvents));
}

export function createReplayEvent(
  input: ReplayEventInput,
  phase: ReplayPhase,
  nowMs: number,
): ContractResult<Readonly<ReplayEvent>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('createReplayEvent: nowMs must be valid UTC ms from an injected clock');
  }
  const correlationId = safeReplayCorrelationId(input);
  if (!isReplayPhase(phase)) {
    return replayFailure({
      stage: 'createEvent',
      code: REPLAY_FAILURE_CODES.EVENT_INVALID,
      message: 'replay event phase is invalid',
      nowMs,
      correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
    });
  }
  const record = exactDataRecord(input, EVENT_INPUT_KEYS);
  const timestampRecord = record ? exactDataRecord(record.timestamp, TIMESTAMP_INPUT_KEYS) : null;
  if (
    !record ||
    !timestampRecord ||
    !isBoundedLabel(record.streamId, 256) ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 0 ||
    !isBoundedLabel(record.kind, 200) ||
    !isCorrelationId(record.correlationId)
  ) {
    return replayFailure({
      stage: 'createEvent',
      code: REPLAY_FAILURE_CODES.EVENT_INVALID,
      message: 'replay event requires bounded stream/kind labels, non-negative sequence, and correlationId string|null',
      nowMs,
      correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
    });
  }
  const timestampIssues = validateSourcedTimestamp(timestampRecord);
  if (timestampIssues.length > 0) {
    return replayFailure({
      stage: 'createEvent',
      code: REPLAY_FAILURE_CODES.EVENT_INVALID,
      message: `replay event timestamp is invalid: ${timestampIssues.map((x) => `${x.path}:${x.code}`).join(', ')}`,
      nowMs,
      correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
    });
  }
  if (timestampRecord.authority === 'LIVE_PRIVATE') {
    return replayFailure({
      stage: 'createEvent',
      code: REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED,
      message: 'LIVE_PRIVATE facts are forbidden in replay capture',
      nowMs,
      correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
      recommendedOperatorAction: 'Emit a separately designed redacted public evidence projection.',
    });
  }

  const guardedPayload = guardReplayPayload(record.payload, {
    kind: record.kind as string,
    createdAtMs: timestampRecord.receivedAtMs as number,
    authority: timestampRecord.authority as Exclude<ReplayEvent['timestamp']['authority'], 'LIVE_PRIVATE'>,
    correlationId: record.correlationId as string | null,
    nowMs,
  });
  if (!guardedPayload.ok) return guardedPayload;

  const timestamp = createSourcedTimestamp(timestampRecord as unknown as ReplayEventInput['timestamp']);
  return ok(
    Object.freeze({
      eventVersion: REPLAY_EVENT_VERSION,
      eventId: deriveEventId({ streamId: record.streamId as string, sequence: record.sequence as number }),
      streamId: record.streamId as string,
      sequence: record.sequence as number,
      kind: record.kind as string,
      phase,
      timestamp,
      correlationId: record.correlationId as string | null,
      payload: guardedPayload.value,
    }),
  );
}

export function createReplayTrigger(
  input: ReplayTriggerInput,
  nowMs: number,
): ContractResult<Readonly<ReplayTrigger>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('createReplayTrigger: nowMs must be valid UTC ms from an injected clock');
  }
  const correlationId = safeReplayCorrelationId(input);
  const record = exactDataRecord(input, TRIGGER_INPUT_KEYS);
  if (
    !record ||
    !isBoundedLabel(record.triggerId, 256) ||
    !isBoundedLabel(record.kind, 200) ||
    (record.sourceTimeMs !== null && !isValidUtcMillis(record.sourceTimeMs)) ||
    !isValidUtcMillis(record.receivedAtMs) ||
    !isDataAuthority(record.authority) ||
    record.authority === 'LIVE_PRIVATE' ||
    !isBoundedLabel(record.sourceId, 200) ||
    !isCorrelationId(record.correlationId)
  ) {
    return replayFailure({
      stage: 'createTrigger',
      code:
        record?.authority === 'LIVE_PRIVATE'
          ? REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED
          : REPLAY_FAILURE_CODES.TRIGGER_INVALID,
      message:
        record?.authority === 'LIVE_PRIVATE'
          ? 'LIVE_PRIVATE trigger facts are forbidden in replay capture'
          : 'replay trigger fields are invalid or unbounded',
      nowMs,
      correlationId,
      safeCurrentState: 'CAPTURE_REMAINS_ARMED',
    });
  }
  return ok(
    Object.freeze({
      triggerVersion: REPLAY_TRIGGER_VERSION,
      triggerId: record.triggerId as string,
      kind: record.kind as string,
      sourceTimeMs: record.sourceTimeMs as number | null,
      receivedAtMs: record.receivedAtMs as number,
      authority: record.authority as ReplayTrigger['authority'],
      sourceId: record.sourceId as string,
      correlationId: record.correlationId as string | null,
    }),
  );
}
