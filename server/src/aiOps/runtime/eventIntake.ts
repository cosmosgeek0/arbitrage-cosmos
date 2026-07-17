/**
 * Provider-neutral A2X shadow event intake.
 *
 * This is a pure CloudEvents-style adapter into the sealed A2 observation
 * contract. It owns no transport, router, store, provider SDK, acknowledgement,
 * or operational authority.
 */
import { guardReplayPayload } from '../../foundation/replay/guard.js';
import type { ShadowNormalizedObservation, ShadowObservationInput } from './types.js';
import { normalizeObservation } from './incident.js';
import {
  assertClosedKeys,
  assertSafeNonNegative,
  assertUtc,
  boundedSortedIdentifiers,
  canonicalJson,
  digestValue,
  shadowSpeculativeId,
  snapshotInertJson,
} from './support.js';
import { SHADOW_A2_STATUS } from './types.js';

const PROVIDER_EVENT_DATA_SCHEMA = 'urn:cosmos:aiops:a2:event-data:v1' as const;
const EVENT_CONTENT_TYPE = 'application/json' as const;
const INTAKE_PRODUCER_REVISION = 'a2x-event-intake-v1' as const;
const MAX_PROVIDER_EVENT_BYTES = 64 * 1_024;
const MAX_CLOUD_EVENT_TEXT_BYTES = 1_024;
const MAX_MESSAGE_BYTES = 16_384;
const MAX_REASON_CODES = 32;
const MAX_UNRESERVED_REASON_CODES = MAX_REASON_CODES - 1;
const MAX_PROVIDER_ATTRIBUTES = 54;
const MAX_ATTRIBUTE_KEY_BYTES = 128;
const MAX_ATTRIBUTE_VALUE_BYTES = 2_048;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
const URI_REFERENCE_PATTERN = /^[^\u0000-\u0020\u007F]+$/u;
const RFC3339_MILLIS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u;
const TRACEPARENT_V00_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;

const RESERVED_ATTRIBUTE_KEYS = Object.freeze([
  'ce_datacontenttype',
  'ce_dataschema',
  'ce_id',
  'ce_source',
  'ce_specversion',
  'ce_subject',
  'provider_component_id',
  'provider_incident_id',
  'provider_resource_id',
  'provider_revision',
] as const);
const RESERVED_ATTRIBUTE_KEY_SET = new Set<string>(RESERVED_ATTRIBUTE_KEYS);

export interface ShadowProviderNeutralEventDataV1 {
  readonly producerRevision: string;
  /** Null is explicit owner evidence that ordering information is unavailable. */
  readonly sequence: number | null;
  readonly resourceId: string;
  readonly componentId: string;
  readonly incidentId: string | null;
  readonly replayClassification: ShadowObservationInput['replayClassification'];
  readonly dataClassification: ShadowObservationInput['dataClassification'];
  readonly message: string;
  readonly reasonCodes: readonly string[];
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

/** Closed CloudEvents 1.0 JSON projection plus the W3C traceparent extension. */
export interface ShadowProviderNeutralEventV1 {
  readonly specversion: '1.0';
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly subject: string | null;
  readonly time: string | null;
  readonly datacontenttype: typeof EVENT_CONTENT_TYPE;
  readonly dataschema: typeof PROVIDER_EVENT_DATA_SCHEMA;
  readonly traceparent: string | null;
  readonly data: Readonly<ShadowProviderNeutralEventDataV1>;
}

export interface ShadowEventIntakeReceipt {
  readonly schema: 'AI_OPS_A2X_EVENT_INTAKE_RECEIPT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly operationalAuthority: 'NONE';
  readonly status: 'ADAPTED' | 'QUARANTINED';
  readonly observedAtMs: number;
  /** CloudEvents source + id identity, independent of delivery classification. */
  readonly sourceEventKey: string;
  /** Digest of the complete received event, including delivery classification. */
  readonly providerEventDigest: string;
  /** Digest of semantic event content; delivery classification is excluded. */
  readonly semanticEventDigest: string;
  readonly normalizedObservationDigest: string | null;
  readonly reasonCodes: readonly string[];
  readonly receiptId: string;
  readonly receiptDigest: string;
}

export interface ShadowEventIntakeResult {
  readonly receipt: Readonly<ShadowEventIntakeReceipt>;
  readonly observation: Readonly<ShadowNormalizedObservation> | null;
}

function assertBoundedText(value: unknown, label: string, maximumBytes: number): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value !== value.trim()
    || CONTROL_PATTERN.test(value)
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new TypeError(`${label} must be non-empty bounded text without control characters`);
  }
}

function assertUriReference(value: unknown, label: string): asserts value is string {
  assertBoundedText(value, label, MAX_CLOUD_EVENT_TEXT_BYTES);
  if (!URI_REFERENCE_PATTERN.test(value) || /%(?![0-9a-f]{2})/iu.test(value)) {
    throw new TypeError(`${label} must be a bounded URI-reference`);
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseOccurredAtMs(value: string | null): number | null {
  if (value === null) return null;
  const match = RFC3339_MILLIS_PATTERN.exec(value);
  if (!match) throw new TypeError('provider-neutral event.time must be RFC3339 with millisecond-safe precision');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8];
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1
    || month > 12
    || day < 1
    || day > (monthDays[month - 1] ?? 0)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new TypeError('provider-neutral event.time contains an invalid calendar value');
  }
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new TypeError('provider-neutral event.time contains an invalid UTC offset');
    }
  }
  const parsed = Date.parse(value);
  assertUtc(parsed, 'provider-neutral event.time');
  return parsed;
}

function parseTraceparent(value: string | null): Readonly<{ traceId: string | null; spanId: string | null }> {
  if (value === null) return Object.freeze({ traceId: null, spanId: null });
  if (typeof value !== 'string' || value !== value.toLowerCase()) {
    throw new TypeError('provider-neutral event.traceparent must be lowercase W3C traceparent v00');
  }
  const match = TRACEPARENT_V00_PATTERN.exec(value);
  if (!match || /^0{32}$/u.test(match[1]) || /^0{16}$/u.test(match[2])) {
    throw new TypeError('provider-neutral event.traceparent is invalid');
  }
  return Object.freeze({ traceId: match[1], spanId: match[2] });
}

function validateProviderAttributes(
  attributes: Readonly<Record<string, string | number | boolean | null>>,
): void {
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
    throw new TypeError('provider-neutral event.data.attributes must be a plain object');
  }
  const keys = Object.keys(attributes);
  if (keys.length > MAX_PROVIDER_ATTRIBUTES) {
    throw new TypeError('provider-neutral event.data.attributes exceeds its reserved item bound');
  }
  const normalizedKeys = new Set<string>();
  for (const key of keys) {
    assertBoundedText(key, 'provider-neutral event attribute key', MAX_ATTRIBUTE_KEY_BYTES);
    const normalizedKey = key.normalize('NFKC').trim().toLowerCase();
    if (normalizedKeys.has(normalizedKey)) {
      throw new TypeError('provider-neutral event attribute keys collide after normalization');
    }
    if (RESERVED_ATTRIBUTE_KEY_SET.has(normalizedKey)) {
      throw new TypeError('provider-neutral event attribute uses an adapter-reserved key');
    }
    normalizedKeys.add(normalizedKey);
    const value = attributes[key];
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || !Number.isFinite(value))) {
      throw new TypeError('provider-neutral numeric event attributes must be finite safe integers');
    }
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
      throw new TypeError('provider-neutral event attribute value is unsupported');
    }
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_ATTRIBUTE_VALUE_BYTES) {
      throw new TypeError('provider-neutral event attribute value exceeds its byte bound');
    }
  }
}

function semanticEventValue(event: Readonly<ShadowProviderNeutralEventV1>): Readonly<Record<string, unknown>> {
  const {
    replayClassification: _deliveryClassification,
    ...semanticData
  } = event.data;
  return Object.freeze({
    specversion: event.specversion,
    id: event.id,
    source: event.source,
    type: event.type,
    subject: event.subject,
    time: event.time,
    datacontenttype: event.datacontenttype,
    dataschema: event.dataschema,
    traceparent: event.traceparent,
    data: Object.freeze(semanticData),
  });
}

function createReceipt(input: Readonly<{
  status: ShadowEventIntakeReceipt['status'];
  observedAtMs: number;
  sourceEventKey: string;
  providerEventDigest: string;
  semanticEventDigest: string;
  normalizedObservationDigest: string | null;
  reasonCodes: readonly string[];
}>): Readonly<ShadowEventIntakeReceipt> {
  const core = Object.freeze({
    schema: 'AI_OPS_A2X_EVENT_INTAKE_RECEIPT_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    operationalAuthority: 'NONE' as const,
    status: input.status,
    observedAtMs: input.observedAtMs,
    sourceEventKey: input.sourceEventKey,
    providerEventDigest: input.providerEventDigest,
    semanticEventDigest: input.semanticEventDigest,
    normalizedObservationDigest: input.normalizedObservationDigest,
    reasonCodes: Object.freeze(Array.from(input.reasonCodes)),
  });
  const receiptId = shadowSpeculativeId('a2-event-intake-receipt', {
    sourceEventKey: input.sourceEventKey,
    providerEventDigest: input.providerEventDigest,
    observedAtMs: input.observedAtMs,
    status: input.status,
  });
  return Object.freeze({
    ...core,
    receiptId,
    receiptDigest: digestValue({ ...core, receiptId }),
  });
}

/**
 * Adapts one inert provider-neutral event. A null source sequence is retained as
 * a quarantine receipt; this lane never fabricates ordering or acceptance.
 */
export function adaptProviderNeutralEvent(
  rawEvent: Readonly<ShadowProviderNeutralEventV1>,
  observedAtMs: number,
): Readonly<ShadowEventIntakeResult> {
  assertUtc(observedAtMs, 'provider-neutral event observedAtMs');
  const event = snapshotInertJson(rawEvent, 'provider-neutral event', 25_000) as Readonly<ShadowProviderNeutralEventV1>;
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new TypeError('provider-neutral event must be a plain object');
  }
  assertClosedKeys(event, [
    'specversion', 'id', 'source', 'type', 'subject', 'time', 'datacontenttype', 'dataschema',
    'traceparent', 'data',
  ], 'provider-neutral event');
  if (event.specversion !== '1.0') throw new TypeError('provider-neutral event.specversion unsupported');
  if (event.datacontenttype !== EVENT_CONTENT_TYPE) throw new TypeError('provider-neutral event.datacontenttype unsupported');
  if (event.dataschema !== PROVIDER_EVENT_DATA_SCHEMA) throw new TypeError('provider-neutral event.dataschema unsupported');
  assertBoundedText(event.id, 'provider-neutral event.id', MAX_CLOUD_EVENT_TEXT_BYTES);
  assertUriReference(event.source, 'provider-neutral event.source');
  assertBoundedText(event.type, 'provider-neutral event.type', MAX_CLOUD_EVENT_TEXT_BYTES);
  if (event.subject !== null) assertBoundedText(event.subject, 'provider-neutral event.subject', MAX_CLOUD_EVENT_TEXT_BYTES);
  const occurredAtMs = parseOccurredAtMs(event.time);
  const traceContext = parseTraceparent(event.traceparent);
  if (typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) {
    throw new TypeError('provider-neutral event.data must be a plain object');
  }
  assertClosedKeys(event.data, [
    'producerRevision', 'sequence', 'resourceId', 'componentId', 'incidentId', 'replayClassification',
    'dataClassification', 'message', 'reasonCodes', 'attributes',
  ], 'provider-neutral event.data');
  assertBoundedText(event.data.producerRevision, 'provider-neutral event.data.producerRevision', MAX_CLOUD_EVENT_TEXT_BYTES);
  if (event.data.sequence !== null) assertSafeNonNegative(event.data.sequence, 'provider-neutral event.data.sequence');
  assertBoundedText(event.data.resourceId, 'provider-neutral event.data.resourceId', MAX_CLOUD_EVENT_TEXT_BYTES);
  assertBoundedText(event.data.componentId, 'provider-neutral event.data.componentId', MAX_CLOUD_EVENT_TEXT_BYTES);
  if (event.data.incidentId !== null) {
    assertBoundedText(event.data.incidentId, 'provider-neutral event.data.incidentId', MAX_CLOUD_EVENT_TEXT_BYTES);
  }
  if (!(['LIVE', 'REPLAY', 'REDRIVE'] as const).includes(event.data.replayClassification)) {
    throw new TypeError('provider-neutral event replay classification unsupported');
  }
  if (!(['PUBLIC', 'INTERNAL', 'SENSITIVE_REDACTED'] as const).includes(event.data.dataClassification)) {
    throw new TypeError('provider-neutral event data classification unsupported');
  }
  assertBoundedText(event.data.message, 'provider-neutral event.data.message', MAX_MESSAGE_BYTES);
  const includesIntakeMarker = Array.isArray(event.data.reasonCodes)
    && event.data.reasonCodes.includes('PROVIDER_NEUTRAL_EVENT_INTAKE');
  const maximumProviderReasonCodes = includesIntakeMarker ? MAX_REASON_CODES : MAX_UNRESERVED_REASON_CODES;
  if (!Array.isArray(event.data.reasonCodes) || event.data.reasonCodes.length > maximumProviderReasonCodes) {
    throw new TypeError('provider-neutral event.data.reasonCodes exceeds its item bound');
  }
  const observationReasonInputs = includesIntakeMarker
    ? event.data.reasonCodes
    : [...event.data.reasonCodes, 'PROVIDER_NEUTRAL_EVENT_INTAKE'];
  const observationReasonCodes = boundedSortedIdentifiers(
    observationReasonInputs,
    'provider-neutral event.data.reasonCodes',
    MAX_REASON_CODES,
  );
  validateProviderAttributes(event.data.attributes);

  const guarded = guardReplayPayload(event, {
    kind: 'aiops.a2.provider-neutral-event',
    createdAtMs: observedAtMs,
    authority: 'UNAVAILABLE',
    correlationId: null,
    nowMs: observedAtMs,
  });
  if (!guarded.ok) {
    throw new TypeError(`provider-neutral event rejected by replay guard: ${guarded.failure.code}`);
  }
  const providerEventCanonical = canonicalJson(guarded.value);
  if (Buffer.byteLength(providerEventCanonical, 'utf8') > MAX_PROVIDER_EVENT_BYTES) {
    throw new TypeError(`provider-neutral event exceeds ${MAX_PROVIDER_EVENT_BYTES} canonical UTF-8 bytes`);
  }
  const providerEventDigest = digestValue(guarded.value);
  const semanticEventDigest = digestValue(semanticEventValue(event));
  const sourceEventKey = shadowSpeculativeId('a2-provider-source-event', {
    source: event.source,
    id: event.id,
  });

  if (event.data.sequence === null) {
    const receipt = createReceipt({
      status: 'QUARANTINED',
      observedAtMs,
      sourceEventKey,
      providerEventDigest,
      semanticEventDigest,
      normalizedObservationDigest: null,
      reasonCodes: Object.freeze(['SOURCE_SEQUENCE_UNAVAILABLE']),
    });
    return Object.freeze({ receipt, observation: null });
  }

  const attributes = Object.freeze({
    ...event.data.attributes,
    ce_datacontenttype: event.datacontenttype,
    ce_dataschema: event.dataschema,
    ce_id: event.id,
    ce_source: event.source,
    ce_specversion: event.specversion,
    ce_subject: event.subject,
    provider_component_id: event.data.componentId,
    provider_incident_id: event.data.incidentId,
    provider_resource_id: event.data.resourceId,
    provider_revision: event.data.producerRevision,
  });
  const observation = normalizeObservation(Object.freeze({
    schema: 'AI_OPS_A2_OBSERVATION_V1',
    source: shadowSpeculativeId('a2-provider-source', { source: event.source }),
    producerRevision: INTAKE_PRODUCER_REVISION,
    eventId: shadowSpeculativeId('a2-provider-event', { source: event.source, id: event.id }),
    sequence: event.data.sequence,
    dedupKey: shadowSpeculativeId('a2-provider-dedup', { source: event.source, id: event.id }),
    eventType: shadowSpeculativeId('a2-provider-event-type', { type: event.type }),
    resourceId: shadowSpeculativeId('a2-provider-resource', {
      source: event.source,
      resourceId: event.data.resourceId,
    }),
    componentId: shadowSpeculativeId('a2-provider-component', {
      source: event.source,
      componentId: event.data.componentId,
    }),
    incidentId: event.data.incidentId === null
      ? null
      : shadowSpeculativeId('a2-provider-incident', {
        source: event.source,
        incidentId: event.data.incidentId,
      }),
    occurredAtMs,
    observedAtMs,
    replayClassification: event.data.replayClassification,
    dataClassification: event.data.dataClassification,
    provenanceDigest: semanticEventDigest,
    traceId: traceContext.traceId,
    spanId: traceContext.spanId,
    message: event.data.message,
    reasonCodes: observationReasonCodes,
    attributes,
  } satisfies ShadowObservationInput));
  const receipt = createReceipt({
    status: 'ADAPTED',
    observedAtMs,
    sourceEventKey,
    providerEventDigest,
    semanticEventDigest,
    normalizedObservationDigest: observation.contentDigest,
    reasonCodes: Object.freeze(['PROVIDER_NEUTRAL_EVENT_ADAPTED']),
  });
  return Object.freeze({ receipt, observation });
}
