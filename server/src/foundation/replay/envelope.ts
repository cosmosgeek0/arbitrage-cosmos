/** Versioned replay envelope, checksum, strict schema, and integrity inspection. */
import {
  canonicalJson,
  deriveEventId,
  isValidUtcMillis,
  ok,
  stableHash128Hex,
  type ContractResult,
  type ValidationIssue,
} from '../contracts/index.js';
import {
  compareReplayEvents,
  createReplayEvent,
  createReplayTrigger,
  sortReplayEvents,
} from './event.js';
import { replayFailure, REPLAY_FAILURE_CODES } from './failures.js';
import { utf8ByteLength } from './guard.js';
import {
  MAX_REPLAY_ENVELOPE_BYTES,
  MAX_REPLAY_ENVELOPE_EVENTS,
  MAX_REPLAY_POST_TRIGGER_EVENTS,
  MAX_REPLAY_RETAINED_EVENT_BYTES,
  MAX_REPLAY_RING_CAPACITY,
  MAX_REPLAY_VALIDATION_ISSUES,
  REPLAY_CHECKSUM_ALGORITHM,
  REPLAY_EVENT_VERSION,
  REPLAY_SCHEMA,
  REPLAY_SCHEMA_VERSION,
  REPLAY_TRIGGER_VERSION,
  isValidReplayCaptureId,
  type ReplayCaptureMetadata,
  type ReplayChecksum,
  type ReplayEnvelopeBodyV1,
  type ReplayEnvelopeV1,
  type ReplayEvent,
  type ReplayInspection,
  type ReplayIntegrityIssue,
  type ReplayIntegrityState,
  type ReplayTrigger,
} from './types.js';

const ENVELOPE_KEYS = [
  'schema',
  'schemaVersion',
  'captureId',
  'authority',
  'createdAtMs',
  'completedAtMs',
  'trigger',
  'capture',
  'events',
  'checksum',
] as const;
const TRIGGER_KEYS = [
  'triggerVersion',
  'triggerId',
  'kind',
  'sourceTimeMs',
  'receivedAtMs',
  'authority',
  'sourceId',
  'correlationId',
] as const;
const CAPTURE_KEYS = [
  'preTriggerCapacity',
  'postTriggerEventLimit',
  'preTriggerObservedCount',
  'preTriggerRetainedCount',
  'preTriggerDroppedCount',
  'postTriggerCapturedCount',
  'postTriggerComplete',
  'eventCount',
] as const;
const EVENT_KEYS = [
  'eventVersion',
  'eventId',
  'streamId',
  'sequence',
  'kind',
  'phase',
  'timestamp',
  'correlationId',
  'payload',
] as const;
const TIMESTAMP_KEYS = [
  'sourceTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'sourceId',
] as const;
const CHECKSUM_KEYS = ['algorithm', 'value'] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactRecordIssues(
  value: unknown,
  path: string,
  keys: readonly string[],
): ValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [{ path, code: 'OBJECT_REQUIRED', message: `${path} must be a plain object` }];
  }
  const issues: ValidationIssue[] = [];
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return [{ path, code: 'SYMBOL_FIELD_FORBIDDEN', message: `${path} contains a symbol-keyed field` }];
  }
  if (ownKeys.length > keys.length) {
    return [{ path, code: 'FIELD_COUNT_EXCEEDED', message: `${path} contains too many fields` }];
  }
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    descriptors.set(key, descriptor);
    if (descriptor.get || descriptor.set) {
      issues.push({ path: `${path}.${key}`, code: 'ACCESSOR_FORBIDDEN', message: 'accessors are forbidden' });
    }
    if (!descriptor.enumerable) {
      issues.push({ path: `${path}.${key}`, code: 'NON_ENUMERABLE_FIELD', message: 'hidden fields are forbidden' });
    }
    if (!keys.includes(key)) {
      issues.push({ path: `${path}.${key}`, code: 'UNKNOWN_FIELD', message: `unexpected field '${key}'` });
    }
  }
  for (const key of keys) {
    if (!descriptors.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'FIELD_REQUIRED', message: `missing field '${key}'` });
    }
  }
  return issues;
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function isLabel(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateIntegerRange(
  issues: ValidationIssue[],
  value: unknown,
  path: string,
  min: number,
  max: number,
): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    issues.push(issue(path, 'INTEGER_OUT_OF_RANGE', `${path} must be an integer in [${min}, ${max}]`));
  }
}

function correlationFor(input: unknown): string | null {
  if (!isPlainRecord(input)) return null;
  const triggerDescriptor = Object.getOwnPropertyDescriptor(input, 'trigger');
  if (!triggerDescriptor || triggerDescriptor.get || triggerDescriptor.set) return null;
  const trigger = triggerDescriptor.value;
  if (!isPlainRecord(trigger)) return null;
  const correlationDescriptor = Object.getOwnPropertyDescriptor(trigger, 'correlationId');
  if (!correlationDescriptor || correlationDescriptor.get || correlationDescriptor.set) return null;
  return typeof correlationDescriptor.value === 'string' ? correlationDescriptor.value : null;
}

function shapeFailure(
  issues: readonly ValidationIssue[],
  nowMs: number,
  correlationId: string | null,
): ContractResult<never> {
  return replayFailure({
    stage: 'inspectEnvelope',
    code: REPLAY_FAILURE_CODES.SCHEMA_INVALID,
    message: `replay envelope schema invalid: ${issues.slice(0, 16).map((x) => `${x.path}:${x.code}`).join(', ')}`,
    nowMs,
    correlationId,
    safeCurrentState: 'ENVELOPE_REJECTED',
    recommendedOperatorAction: 'Restore an exact supported replay envelope without unknown fields.',
  });
}

function bodyFromEnvelope(envelope: ReplayEnvelopeV1): ReplayEnvelopeBodyV1 {
  return {
    schema: envelope.schema,
    schemaVersion: envelope.schemaVersion,
    captureId: envelope.captureId,
    authority: envelope.authority,
    createdAtMs: envelope.createdAtMs,
    completedAtMs: envelope.completedAtMs,
    trigger: envelope.trigger,
    capture: envelope.capture,
    events: envelope.events,
  };
}

export function computeReplayChecksum(body: ReplayEnvelopeBodyV1): string {
  return stableHash128Hex(`foundation.replay.v1|${canonicalJson(body)}`);
}

export function serializeReplayEnvelope(envelope: ReplayEnvelopeV1): string {
  const serialized = canonicalJson(envelope);
  const bytes = utf8ByteLength(serialized);
  if (bytes > MAX_REPLAY_ENVELOPE_BYTES) {
    throw new RangeError(
      `serializeReplayEnvelope: envelope exceeds ${MAX_REPLAY_ENVELOPE_BYTES} UTF-8 bytes`,
    );
  }
  return serialized;
}

export function parseReplayEnvelope(
  serialized: string,
  nowMs: number,
  correlationId: string | null = null,
): ContractResult<Readonly<ReplayInspection>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('parseReplayEnvelope: nowMs must be valid UTC ms from an injected clock');
  }
  if (typeof serialized !== 'string') {
    return replayFailure({
      stage: 'parseEnvelope',
      code: REPLAY_FAILURE_CODES.JSON_MALFORMED,
      message: 'serialized replay envelope must be a string',
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
    });
  }
  if (utf8ByteLength(serialized) > MAX_REPLAY_ENVELOPE_BYTES) {
    return replayFailure({
      stage: 'parseEnvelope',
      code: REPLAY_FAILURE_CODES.ENVELOPE_TOO_LARGE,
      message: `serialized replay envelope exceeds ${MAX_REPLAY_ENVELOPE_BYTES} UTF-8 bytes`,
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const trimmed = serialized.trimEnd();
    const looksTruncated =
      /unexpected end|unterminated|end of json/.test(message) ||
      (trimmed.length > 0 && !trimmed.endsWith('}') && !trimmed.endsWith(']'));
    return replayFailure({
      stage: 'parseEnvelope',
      code: looksTruncated
        ? REPLAY_FAILURE_CODES.JSON_TRUNCATED
        : REPLAY_FAILURE_CODES.JSON_MALFORMED,
      message: looksTruncated
        ? 'serialized replay envelope is truncated'
        : 'serialized replay envelope is malformed JSON',
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
    });
  }
  return inspectReplayEnvelope(parsed, nowMs);
}

export function inspectReplayEnvelope(
  input: unknown,
  nowMs: number,
): ContractResult<Readonly<ReplayInspection>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('inspectReplayEnvelope: nowMs must be valid UTC ms from an injected clock');
  }
  const correlationId = correlationFor(input);
  if (!isPlainRecord(input)) {
    return shapeFailure([issue('$', 'OBJECT_REQUIRED', 'envelope must be a plain object')], nowMs, null);
  }

  const schemaVersion = Object.getOwnPropertyDescriptor(input, 'schemaVersion')?.value;
  if (schemaVersion !== REPLAY_SCHEMA_VERSION) {
    return replayFailure({
      stage: 'inspectEnvelope',
      code: REPLAY_FAILURE_CODES.SCHEMA_UNSUPPORTED,
      message: `replay schema version ${String(schemaVersion)} is unsupported`,
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
      recommendedOperatorAction: `Use replay schema version ${REPLAY_SCHEMA_VERSION} or an explicit future migrator.`,
    });
  }

  const topLevelIssues = exactRecordIssues(input, '$', ENVELOPE_KEYS);
  if (topLevelIssues.length > 0) return shapeFailure(topLevelIssues, nowMs, correlationId);
  const issues: ValidationIssue[] = [];
  if (input.schema !== REPLAY_SCHEMA) issues.push(issue('$.schema', 'SCHEMA_INVALID', 'schema identity is invalid'));
  if (!isValidReplayCaptureId(input.captureId)) issues.push(issue('$.captureId', 'LABEL_INVALID', 'captureId is invalid'));
  if (input.authority !== 'RECORDED_REPLAY') issues.push(issue('$.authority', 'AUTHORITY_INVALID', 'authority must be RECORDED_REPLAY'));
  if (!isValidUtcMillis(input.createdAtMs)) issues.push(issue('$.createdAtMs', 'UTC_MILLIS_INVALID', 'createdAtMs is invalid'));
  if (!isValidUtcMillis(input.completedAtMs)) issues.push(issue('$.completedAtMs', 'UTC_MILLIS_INVALID', 'completedAtMs is invalid'));

  issues.push(...exactRecordIssues(input.trigger, '$.trigger', TRIGGER_KEYS));
  issues.push(...exactRecordIssues(input.capture, '$.capture', CAPTURE_KEYS));
  issues.push(...exactRecordIssues(input.checksum, '$.checksum', CHECKSUM_KEYS));
  if (issues.length > 0) return shapeFailure(issues, nowMs, correlationId);

  const rawTrigger = isPlainRecord(input.trigger) ? input.trigger : null;
  const rawCapture = isPlainRecord(input.capture) ? input.capture : null;
  const rawChecksum = isPlainRecord(input.checksum) ? input.checksum : null;

  if (rawTrigger) {
    if (rawTrigger.triggerVersion !== REPLAY_TRIGGER_VERSION) issues.push(issue('$.trigger.triggerVersion', 'VERSION_INVALID', 'trigger version is invalid'));
    if (!isLabel(rawTrigger.triggerId, 256)) issues.push(issue('$.trigger.triggerId', 'LABEL_INVALID', 'triggerId is invalid'));
    if (!isLabel(rawTrigger.kind, 200)) issues.push(issue('$.trigger.kind', 'LABEL_INVALID', 'trigger kind is invalid'));
    if (rawTrigger.sourceTimeMs !== null && !isValidUtcMillis(rawTrigger.sourceTimeMs)) issues.push(issue('$.trigger.sourceTimeMs', 'UTC_MILLIS_INVALID', 'sourceTimeMs is invalid'));
    if (!isValidUtcMillis(rawTrigger.receivedAtMs)) issues.push(issue('$.trigger.receivedAtMs', 'UTC_MILLIS_INVALID', 'receivedAtMs is invalid'));
    if (!isLabel(rawTrigger.sourceId, 200)) issues.push(issue('$.trigger.sourceId', 'LABEL_INVALID', 'sourceId is invalid'));
  }

  if (rawCapture) {
    validateIntegerRange(issues, rawCapture.preTriggerCapacity, '$.capture.preTriggerCapacity', 1, MAX_REPLAY_RING_CAPACITY);
    validateIntegerRange(issues, rawCapture.postTriggerEventLimit, '$.capture.postTriggerEventLimit', 0, MAX_REPLAY_POST_TRIGGER_EVENTS);
    for (const field of [
      'preTriggerObservedCount',
      'preTriggerRetainedCount',
      'preTriggerDroppedCount',
      'postTriggerCapturedCount',
      'eventCount',
    ] as const) {
      if (!isNonNegativeInteger(rawCapture[field])) issues.push(issue(`$.capture.${field}`, 'NON_NEGATIVE_INTEGER_REQUIRED', `${field} is invalid`));
    }
    if (typeof rawCapture.postTriggerComplete !== 'boolean') issues.push(issue('$.capture.postTriggerComplete', 'BOOLEAN_REQUIRED', 'postTriggerComplete is invalid'));
  }

  if (rawChecksum) {
    if (rawChecksum.algorithm !== REPLAY_CHECKSUM_ALGORITHM) issues.push(issue('$.checksum.algorithm', 'CHECKSUM_ALGORITHM_INVALID', 'checksum algorithm is invalid'));
    if (typeof rawChecksum.value !== 'string' || !/^[0-9a-f]{32}$/.test(rawChecksum.value)) issues.push(issue('$.checksum.value', 'CHECKSUM_FORMAT_INVALID', 'checksum value is invalid'));
  }

  if (!Array.isArray(input.events)) {
    issues.push(issue('$.events', 'ARRAY_REQUIRED', 'events must be an array'));
  } else if (input.events.length > MAX_REPLAY_ENVELOPE_EVENTS) {
    issues.push(issue('$.events', 'EVENT_LIMIT_EXCEEDED', `event count exceeds ${MAX_REPLAY_ENVELOPE_EVENTS}`));
  } else {
    const eventArrayKeys = Reflect.ownKeys(input.events);
    if (eventArrayKeys.length > input.events.length + 1) {
      issues.push(issue('$.events', 'ARRAY_PROPERTY_COUNT_EXCEEDED', 'event array contains extra own properties'));
    }
    for (const ownKey of eventArrayKeys.slice(0, input.events.length + 1)) {
      if (issues.length >= MAX_REPLAY_VALIDATION_ISSUES) break;
      if (ownKey === 'length') continue;
      if (typeof ownKey === 'symbol') {
        issues.push(issue('$.events', 'SYMBOL_FIELD_FORBIDDEN', 'event arrays cannot contain symbol properties'));
        continue;
      }
      const index = /^(0|[1-9][0-9]*)$/.test(ownKey) ? Number(ownKey) : -1;
      if (!Number.isSafeInteger(index) || index < 0 || index >= input.events.length || String(index) !== ownKey) {
        issues.push(issue(`$.events.${ownKey.slice(0, 40)}`, 'ARRAY_EXTRA_PROPERTY', 'event arrays cannot contain named properties'));
      }
    }
    for (let i = 0; i < input.events.length; i += 1) {
      if (issues.length >= MAX_REPLAY_VALIDATION_ISSUES) break;
      const descriptor = Object.getOwnPropertyDescriptor(input.events, String(i));
      if (!descriptor) {
        issues.push(issue(`$.events[${i}]`, 'SPARSE_ARRAY', 'event array must be dense'));
        continue;
      }
      if (descriptor.get || descriptor.set || !descriptor.enumerable) {
        issues.push(issue(`$.events[${i}]`, 'ARRAY_ELEMENT_INVALID', 'event elements must be enumerable data properties'));
        continue;
      }
      const event = descriptor.value;
      const eventShapeIssues = exactRecordIssues(event, `$.events[${i}]`, EVENT_KEYS);
      issues.push(...eventShapeIssues);
      if (eventShapeIssues.length > 0) continue;
      if (!isPlainRecord(event)) continue;
      if (event.eventVersion !== REPLAY_EVENT_VERSION) issues.push(issue(`$.events[${i}].eventVersion`, 'VERSION_INVALID', 'event version is invalid'));
      if (!isLabel(event.eventId, 128)) issues.push(issue(`$.events[${i}].eventId`, 'LABEL_INVALID', 'eventId is invalid'));
      if (!isLabel(event.streamId, 256)) issues.push(issue(`$.events[${i}].streamId`, 'LABEL_INVALID', 'streamId is invalid'));
      if (!isNonNegativeInteger(event.sequence)) issues.push(issue(`$.events[${i}].sequence`, 'NON_NEGATIVE_INTEGER_REQUIRED', 'sequence is invalid'));
      if (!isLabel(event.kind, 200)) issues.push(issue(`$.events[${i}].kind`, 'LABEL_INVALID', 'kind is invalid'));
      if (event.phase !== 'PRE_TRIGGER' && event.phase !== 'POST_TRIGGER') issues.push(issue(`$.events[${i}].phase`, 'PHASE_INVALID', 'phase is invalid'));
      issues.push(...exactRecordIssues(event.timestamp, `$.events[${i}].timestamp`, TIMESTAMP_KEYS));
    }
  }
  if (issues.length > 0) return shapeFailure(issues, nowMs, correlationId);

  const triggerResult = createReplayTrigger(
    {
      triggerId: rawTrigger!.triggerId as string,
      kind: rawTrigger!.kind as string,
      sourceTimeMs: rawTrigger!.sourceTimeMs as number | null,
      receivedAtMs: rawTrigger!.receivedAtMs as number,
      authority: rawTrigger!.authority as ReplayTrigger['authority'],
      sourceId: rawTrigger!.sourceId as string,
      correlationId: rawTrigger!.correlationId as string | null,
    },
    nowMs,
  );
  if (!triggerResult.ok) return triggerResult;

  const normalizedEvents: Readonly<ReplayEvent>[] = [];
  let normalizedEventBytes = 0;
  for (let i = 0; i < (input.events as unknown[]).length; i += 1) {
    const raw = (input.events as Record<string, unknown>[])[i];
    const eventResult = createReplayEvent(
      {
        streamId: raw.streamId as string,
        sequence: raw.sequence as number,
        kind: raw.kind as string,
        timestamp: raw.timestamp as ReplayEvent['timestamp'],
        correlationId: raw.correlationId as string | null,
        payload: raw.payload,
      },
      raw.phase as ReplayEvent['phase'],
      nowMs,
    );
    if (!eventResult.ok) return eventResult;
    normalizedEventBytes += utf8ByteLength(canonicalJson(eventResult.value));
    if (normalizedEventBytes > MAX_REPLAY_RETAINED_EVENT_BYTES) {
      return replayFailure({
        stage: 'inspectEnvelope',
        code: REPLAY_FAILURE_CODES.ENVELOPE_TOO_LARGE,
        message: `restored replay events exceed ${MAX_REPLAY_RETAINED_EVENT_BYTES} canonical UTF-8 bytes`,
        nowMs,
        correlationId,
        safeCurrentState: 'ENVELOPE_REJECTED',
      });
    }
    if (raw.eventId !== eventResult.value.eventId || raw.eventId !== deriveEventId({ streamId: raw.streamId as string, sequence: raw.sequence as number })) {
      return shapeFailure([issue(`$.events[${i}].eventId`, 'EVENT_ID_MISMATCH', 'eventId does not match streamId + sequence')], nowMs, correlationId);
    }
    normalizedEvents.push(eventResult.value);
  }

  const capture: ReplayCaptureMetadata = {
    preTriggerCapacity: rawCapture!.preTriggerCapacity as number,
    postTriggerEventLimit: rawCapture!.postTriggerEventLimit as number,
    preTriggerObservedCount: rawCapture!.preTriggerObservedCount as number,
    preTriggerRetainedCount: rawCapture!.preTriggerRetainedCount as number,
    preTriggerDroppedCount: rawCapture!.preTriggerDroppedCount as number,
    postTriggerCapturedCount: rawCapture!.postTriggerCapturedCount as number,
    postTriggerComplete: rawCapture!.postTriggerComplete as boolean,
    eventCount: rawCapture!.eventCount as number,
  };

  if (capture.eventCount !== normalizedEvents.length) {
    return replayFailure({
      stage: 'inspectEnvelope',
      code: REPLAY_FAILURE_CODES.TRUNCATED,
      message: `declared eventCount ${capture.eventCount} does not match restored event count ${normalizedEvents.length}`,
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
      recommendedOperatorAction: 'Restore the complete envelope from another copy.',
    });
  }

  const preEvents = normalizedEvents.filter((event) => event.phase === 'PRE_TRIGGER');
  const postEvents = normalizedEvents.filter((event) => event.phase === 'POST_TRIGGER');
  const countIssues: ValidationIssue[] = [];
  const expectedRetained = Math.min(capture.preTriggerObservedCount, capture.preTriggerCapacity);
  const expectedDropped = Math.max(0, capture.preTriggerObservedCount - capture.preTriggerCapacity);
  if (capture.preTriggerRetainedCount !== expectedRetained) countIssues.push(issue('$.capture.preTriggerRetainedCount', 'RING_COUNT_IMPOSSIBLE', 'retained must equal min(observed, capacity)'));
  if (capture.preTriggerDroppedCount !== expectedDropped) countIssues.push(issue('$.capture.preTriggerDroppedCount', 'RING_COUNT_IMPOSSIBLE', 'dropped must equal max(0, observed - capacity)'));
  if (capture.preTriggerRetainedCount !== preEvents.length) countIssues.push(issue('$.capture.preTriggerRetainedCount', 'COUNT_MISMATCH', 'retained count does not match events'));
  if (capture.preTriggerRetainedCount > capture.preTriggerCapacity) countIssues.push(issue('$.capture.preTriggerRetainedCount', 'BOUND_EXCEEDED', 'retained count exceeds capacity'));
  if (capture.postTriggerCapturedCount !== postEvents.length) countIssues.push(issue('$.capture.postTriggerCapturedCount', 'COUNT_MISMATCH', 'post count does not match events'));
  if (capture.postTriggerCapturedCount > capture.postTriggerEventLimit) countIssues.push(issue('$.capture.postTriggerCapturedCount', 'BOUND_EXCEEDED', 'post count exceeds limit'));
  if (capture.postTriggerComplete !== (capture.postTriggerCapturedCount === capture.postTriggerEventLimit)) countIssues.push(issue('$.capture.postTriggerComplete', 'COMPLETION_MISMATCH', 'completion must exactly reflect the post limit'));
  if (capture.eventCount !== preEvents.length + postEvents.length) countIssues.push(issue('$.capture.eventCount', 'COUNT_MISMATCH', 'eventCount does not match phase counts'));

  const createdAtMs = input.createdAtMs as number;
  const completedAtMs = input.completedAtMs as number;
  const trigger = triggerResult.value;
  if (completedAtMs < createdAtMs) countIssues.push(issue('$.completedAtMs', 'TIME_ORDER_INVALID', 'completedAtMs precedes createdAtMs'));
  if (trigger.receivedAtMs < createdAtMs || trigger.receivedAtMs > completedAtMs) countIssues.push(issue('$.trigger.receivedAtMs', 'TIME_ORDER_INVALID', 'trigger receipt is outside capture window'));
  for (let i = 0; i < normalizedEvents.length; i += 1) {
    if (countIssues.length >= MAX_REPLAY_VALIDATION_ISSUES) break;
    const event = normalizedEvents[i];
    if (event.timestamp.receivedAtMs < createdAtMs || event.timestamp.receivedAtMs > completedAtMs) countIssues.push(issue(`$.events[${i}].timestamp.receivedAtMs`, 'TIME_ORDER_INVALID', 'event receipt is outside capture window'));
    if (event.phase === 'PRE_TRIGGER' && event.timestamp.receivedAtMs > trigger.receivedAtMs) countIssues.push(issue(`$.events[${i}].phase`, 'PHASE_TIME_INVALID', 'pre-trigger event was received after trigger'));
    if (event.phase === 'POST_TRIGGER' && event.timestamp.receivedAtMs < trigger.receivedAtMs) countIssues.push(issue(`$.events[${i}].phase`, 'PHASE_TIME_INVALID', 'post-trigger event was received before trigger'));
    if (i > 0 && compareReplayEvents(normalizedEvents[i - 1], event) > 0) countIssues.push(issue(`$.events[${i}]`, 'EVENT_ORDER_INVALID', 'events are not in canonical replay order'));
  }

  const streamSequences = new Map<string, Set<number>>();
  const sequenceRegressions: ReplayIntegrityIssue[] = [];
  const lastSequenceInReplayOrder = new Map<string, number>();
  for (const event of normalizedEvents) {
    if (countIssues.length >= MAX_REPLAY_VALIDATION_ISSUES) break;
    const seen = streamSequences.get(event.streamId) ?? new Set<number>();
    if (seen.has(event.sequence)) countIssues.push(issue('$.events', 'DUPLICATE_SEQUENCE', `duplicate sequence in stream ${event.streamId}`));
    seen.add(event.sequence);
    streamSequences.set(event.streamId, seen);
    const previousInReplay = lastSequenceInReplayOrder.get(event.streamId);
    if (previousInReplay !== undefined && event.sequence < previousInReplay) {
      if (sequenceRegressions.length < MAX_REPLAY_VALIDATION_ISSUES) sequenceRegressions.push({
        code: 'SEQUENCE_REGRESSION',
        message: `stream ${event.streamId} replay order regresses from sequence ${previousInReplay} to ${event.sequence}`,
        streamId: event.streamId,
        afterSequence: previousInReplay,
        beforeSequence: event.sequence,
        missingCount: null,
      });
    }
    lastSequenceInReplayOrder.set(event.streamId, event.sequence);
  }
  if (countIssues.length > 0) return shapeFailure(countIssues, nowMs, correlationId);

  const body: ReplayEnvelopeBodyV1 = {
    schema: REPLAY_SCHEMA,
    schemaVersion: REPLAY_SCHEMA_VERSION,
    captureId: input.captureId as string,
    authority: 'RECORDED_REPLAY',
    createdAtMs,
    completedAtMs,
    trigger,
    capture: Object.freeze({ ...capture }),
    events: Object.freeze(normalizedEvents),
  };
  let bodyBytes: number;
  try {
    bodyBytes = utf8ByteLength(canonicalJson(body));
  } catch {
    return shapeFailure([issue('$', 'CANONICALIZATION_FAILED', 'envelope cannot be canonicalized')], nowMs, correlationId);
  }
  if (bodyBytes > MAX_REPLAY_ENVELOPE_BYTES) {
    return replayFailure({
      stage: 'inspectEnvelope',
      code: REPLAY_FAILURE_CODES.ENVELOPE_TOO_LARGE,
      message: `replay envelope exceeds ${MAX_REPLAY_ENVELOPE_BYTES} canonical UTF-8 bytes`,
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
    });
  }
  const expectedChecksum = computeReplayChecksum(body);
  if (rawChecksum!.value !== expectedChecksum) {
    return replayFailure({
      stage: 'verifyChecksum',
      code: REPLAY_FAILURE_CODES.CHECKSUM_MISMATCH,
      message: 'replay envelope checksum does not match canonical content',
      nowMs,
      correlationId,
      safeCurrentState: 'ENVELOPE_REJECTED',
      recommendedOperatorAction: 'Treat the replay as corrupt and restore another copy.',
    });
  }

  const integrityIssues: ReplayIntegrityIssue[] = [];
  integrityIssues.push(...sequenceRegressions);
  if (capture.preTriggerDroppedCount > 0) {
    integrityIssues.push({
      code: 'PRE_TRIGGER_OVERWRITE',
      message: `${capture.preTriggerDroppedCount} oldest pre-trigger events were overwritten by the bound`,
      streamId: null,
      afterSequence: null,
      beforeSequence: null,
      missingCount: capture.preTriggerDroppedCount,
    });
  }
  if (!capture.postTriggerComplete) {
    integrityIssues.push({
      code: 'POST_TRIGGER_INCOMPLETE',
      message: `post-trigger capture ended ${capture.postTriggerEventLimit - capture.postTriggerCapturedCount} events before its configured limit`,
      streamId: null,
      afterSequence: null,
      beforeSequence: null,
      missingCount: capture.postTriggerEventLimit - capture.postTriggerCapturedCount,
    });
  }
  for (const [streamId, sequenceSet] of [...streamSequences.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (integrityIssues.length >= MAX_REPLAY_VALIDATION_ISSUES) break;
    const sequences = [...sequenceSet].sort((a, b) => a - b);
    for (let i = 1; i < sequences.length; i += 1) {
      if (integrityIssues.length >= MAX_REPLAY_VALIDATION_ISSUES) break;
      const previous = sequences[i - 1];
      const current = sequences[i];
      if (current > previous + 1) {
        integrityIssues.push({
          code: 'SEQUENCE_GAP',
          message: `stream ${streamId} jumps from sequence ${previous} to ${current}`,
          streamId,
          afterSequence: previous,
          beforeSequence: current,
          missingCount: current - previous - 1,
        });
      }
    }
  }

  const hasGap = integrityIssues.some(
    (x) => x.code === 'SEQUENCE_GAP' || x.code === 'SEQUENCE_REGRESSION',
  );
  const hasTruncation = integrityIssues.some(
    (x) => x.code === 'PRE_TRIGGER_OVERWRITE' || x.code === 'POST_TRIGGER_INCOMPLETE',
  );
  const state: ReplayIntegrityState = hasGap
    ? hasTruncation
      ? 'GAPPED_AND_TRUNCATED'
      : 'GAPPED'
    : hasTruncation
      ? 'TRUNCATED'
      : 'VALID';
  const checksum: ReplayChecksum = Object.freeze({
    algorithm: REPLAY_CHECKSUM_ALGORITHM,
    value: expectedChecksum,
  });
  const envelope: ReplayEnvelopeV1 = Object.freeze({ ...body, checksum });
  return ok(
    Object.freeze({
      envelope,
      integrity: Object.freeze({
        state,
        issues: Object.freeze(integrityIssues.map((entry) => Object.freeze(entry))),
      }),
    }),
  );
}

export function createReplayEnvelope(
  bodyInput: ReplayEnvelopeBodyV1,
  nowMs: number,
): ContractResult<Readonly<ReplayEnvelopeV1>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('createReplayEnvelope: nowMs must be valid UTC ms from an injected clock');
  }
  const body: ReplayEnvelopeBodyV1 = {
    ...bodyInput,
    events: sortReplayEvents(bodyInput.events),
  };
  const candidate: ReplayEnvelopeV1 = {
    ...body,
    checksum: {
      algorithm: REPLAY_CHECKSUM_ALGORITHM,
      value: computeReplayChecksum(body),
    },
  };
  const inspected = inspectReplayEnvelope(candidate, nowMs);
  return inspected.ok ? ok(inspected.value.envelope) : inspected;
}

/** Recompute checksum after an intentional fixture edit; not authentication. */
export function withRecomputedReplayChecksum(
  envelope: ReplayEnvelopeV1,
): ReplayEnvelopeV1 {
  const body = bodyFromEnvelope(envelope);
  return {
    ...envelope,
    checksum: {
      algorithm: REPLAY_CHECKSUM_ALGORITHM,
      value: computeReplayChecksum(body),
    },
  };
}
