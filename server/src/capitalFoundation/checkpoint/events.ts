import {
  canonicalJson,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import {
  deriveCapitalEventId,
  validateCapitalJsonValue,
  type CapitalJsonValue,
} from '../contracts/index.js';
import {
  CAPITAL_CHECKPOINT_EVENT_KINDS,
  CAPITAL_CHECKPOINT_EVENT_SCHEMA_VERSION,
  type CapitalCheckpointEvent,
  type CapitalCheckpointRecord,
  type CreateCapitalCheckpointEventInput,
} from './types.js';

const INTEGER_TAG = '$capitalInteger';

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function encodeRecord(value: unknown, path: string, seen: Set<object>): CapitalJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`checkpoint record number at ${path} must be a safe metadata integer`);
    return Object.freeze({ [INTEGER_TAG]: String(value) });
  }
  if (typeof value !== 'object') throw new TypeError(`checkpoint record at ${path} is not serializable`);
  if (seen.has(value)) throw new TypeError(`checkpoint record at ${path} is cyclic`);
  seen.add(value);
  if (Array.isArray(value)) {
    const out = Object.freeze(value.map((entry, index) => encodeRecord(entry, `${path}[${index}]`, seen)));
    seen.delete(value);
    return out;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`checkpoint record at ${path} must be plain data`);
  const out: Record<string, CapitalJsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry === undefined) throw new TypeError(`checkpoint record at ${path}.${key} contains undefined`);
    out[key] = encodeRecord(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return Object.freeze(out);
}

function decodeInteger(input: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(input) || input.length > 16) throw new TypeError('checkpoint integer tag is invalid');
  let value = 0;
  for (const character of input) value = value * 10 + (character.charCodeAt(0) - 48);
  if (!Number.isSafeInteger(value)) throw new TypeError('checkpoint integer exceeds safe metadata range');
  return value;
}

function decodeRecord(value: CapitalJsonValue): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(decodeRecord);
  const record = value as { readonly [key: string]: CapitalJsonValue };
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === INTEGER_TAG) {
    const encoded = record[INTEGER_TAG];
    if (typeof encoded !== 'string') throw new TypeError('checkpoint integer tag must contain a string');
    return decodeInteger(encoded);
  }
  const out: Record<string, unknown> = {};
  for (const key of keys.sort()) out[key] = decodeRecord(record[key]);
  return out;
}

export function createCapitalCheckpointEvent(
  input: CreateCapitalCheckpointEventInput,
): Readonly<CapitalCheckpointEvent> {
  if (!nonEmpty(input.streamId) || !nonEmpty(input.correlationId, 128)) {
    throw new TypeError('capital checkpoint event requires bounded stream and correlation IDs');
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new TypeError('capital checkpoint event sequence must be a positive safe integer');
  }
  if (!isValidUtcMillis(input.occurredAtMs)) throw new TypeError('capital checkpoint event requires injected UTC time');
  if (!(CAPITAL_CHECKPOINT_EVENT_KINDS as readonly string[]).includes(input.kind)) {
    throw new TypeError('capital checkpoint event kind is unsupported');
  }
  const payload = Object.freeze({ record: encodeRecord(input.record, '$.record', new Set()) });
  const issues = validateCapitalJsonValue(payload);
  if (issues.length > 0) throw new TypeError(`capital checkpoint payload is unsafe: ${issues.join(',')}`);
  return Object.freeze({
    id: deriveCapitalEventId({ streamId: input.streamId, sequence: input.sequence, kind: input.kind }),
    schemaVersion: CAPITAL_CHECKPOINT_EVENT_SCHEMA_VERSION,
    streamId: input.streamId,
    sequence: input.sequence,
    kind: input.kind,
    occurredAtMs: input.occurredAtMs,
    correlationId: input.correlationId,
    payload,
  });
}

export function validateCapitalCheckpointEvent(event: unknown): readonly string[] {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return Object.freeze(['EVENT_OBJECT_REQUIRED']);
  const record = event as Record<string, unknown>;
  const reasons: string[] = [];
  if (record.schemaVersion !== CAPITAL_CHECKPOINT_EVENT_SCHEMA_VERSION) reasons.push('EVENT_SCHEMA_UNSUPPORTED');
  if (!nonEmpty(record.streamId)) reasons.push('EVENT_STREAM_ID_INVALID');
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 1) reasons.push('EVENT_SEQUENCE_INVALID');
  if (!(CAPITAL_CHECKPOINT_EVENT_KINDS as readonly unknown[]).includes(record.kind)) reasons.push('EVENT_KIND_INVALID');
  if (!isValidUtcMillis(record.occurredAtMs)) reasons.push('EVENT_TIME_INVALID');
  if (!nonEmpty(record.correlationId, 128)) reasons.push('EVENT_CORRELATION_INVALID');
  if (typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) {
    reasons.push('EVENT_PAYLOAD_INVALID');
  } else {
    reasons.push(...validateCapitalJsonValue(record.payload).map((issue) => `EVENT_PAYLOAD_${issue}`));
  }
  if (reasons.length === 0) {
    const expected = deriveCapitalEventId({ streamId: record.streamId, sequence: record.sequence, kind: record.kind });
    if (record.id !== expected) reasons.push('EVENT_ID_INVALID');
    const payloadKeys = Object.keys(record.payload as object);
    if (payloadKeys.length !== 1 || payloadKeys[0] !== 'record') reasons.push('EVENT_PAYLOAD_SHAPE_INVALID');
  }
  try {
    canonicalJson(event);
  } catch {
    reasons.push('EVENT_NOT_CANONICAL_DATA');
  }
  return Object.freeze([...new Set(reasons)]);
}

export function decodeCapitalCheckpointEventRecord(event: CapitalCheckpointEvent): CapitalCheckpointRecord {
  const issues = validateCapitalCheckpointEvent(event);
  if (issues.length > 0) throw new TypeError(`invalid capital checkpoint event: ${issues.join(',')}`);
  const payload = event.payload as { readonly record: CapitalJsonValue };
  return decodeRecord(payload.record) as CapitalCheckpointRecord;
}
