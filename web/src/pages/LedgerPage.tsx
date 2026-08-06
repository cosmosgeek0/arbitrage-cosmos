import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Page } from '../store';
import { Pill, type Tone } from '../components/px';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll, type SettledPoll } from '../lib/polling';
import { fmtPrice, timeAgo } from '../format';
import { TIME_ZONE_OPTIONS, addDays, dayBounds, dayKey, formatKey, resolvedZoneLabel } from '../lib/time';
import type { LedgerEvent } from '../types';
import { TokenIcon } from '../components/TokenIcon';
import { PillSelect } from '../components/PillSelect';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import {
  IconDatabase,
  IconRefresh,
  IconSearch,
  IconShield,
  IconWallet,
} from '../components/Icons';
import './LiveIntelligence.css';
import './LedgerPage.css';

type Severity = 'Critical' | 'Warning' | 'Info' | 'Debug' | 'Unknown';
type SeverityFilter = 'all' | Exclude<Severity, 'Unknown'>;
type DecisionFilter = 'all' | 'accepted' | 'rejected';
type LedgerMetadataField = 'severity' | 'source' | 'strategy' | 'status' | 'reason' | 'message' | 'correlation' | 'createdAt';
type LedgerTextMetadataField = Exclude<LedgerMetadataField, 'createdAt'>;
type LedgerProjectionState =
  | 'RECORDED_V3'
  | 'PROJECTED_LEGACY_PAYLOAD'
  | 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3'
  | 'UNAVAILABLE'
  | 'INVALID_LEGACY_PAYLOAD'
  | 'INVALID_STORED_PAYLOAD';
type LedgerStoredPayloadState = 'RECORDED_JSON' | 'NO_STORED_PAYLOAD' | 'INVALID_STORED_PAYLOAD';
type LedgerHorizonReason = 'TEXT_SEARCH' | 'PROJECTED_METADATA_FILTER';

interface LedgerFieldProvenance {
  state: LedgerProjectionState;
  path: string | null;
  basisPath?: string;
}

interface CanonicalLedgerEvent extends LedgerEvent {
  severity: string | null;
  source: string | null;
  strategy: string | null;
  status: string | null;
  reason: string | null;
  message: string | null;
  correlation: string | null;
  createdAt: number;
  decision: 'ACCEPTED' | 'REJECTED' | null;
  metadataProjection: {
    schema: 'cosmos.ledger-event-api-metadata.v1';
    payload: {
      state: LedgerStoredPayloadState;
      path: 'events.data';
    };
    fields: Record<LedgerMetadataField, LedgerFieldProvenance>;
    decision: {
      value: 'ACCEPTED' | 'REJECTED' | null;
      state: 'RECORDED_ALLOWED' | 'RECORDED_STATUS' | 'CONTRADICTORY_RECORDED_FIELDS' | 'UNAVAILABLE';
      paths: string[];
    };
  };
}

interface LedgerPageHorizon {
  kind: 'RECENT_EVENT_ID_WINDOW';
  maxIdSpan: number;
  highWaterId: number;
  afterIdExclusive: number;
  reasons: LedgerHorizonReason[];
  token: string;
}

interface LedgerCountHorizon extends LedgerPageHorizon {
  retainedFromId: number | null;
  ledgerHighWaterId: number;
  complete: boolean;
  appliesTo: ['RECENT_EVENTS', 'COUNT'];
}

interface LedgerCountEvidence {
  count: number | null;
  scope: 'FILTERED_RETAINED_LEDGER' | 'RECENT_EVENT_ID_WINDOW' | 'UNKNOWN';
  completeness: 'COMPLETE_RETAINED_SET' | 'BOUNDED_RECENT_ID_HORIZON' | 'UNKNOWN';
  queryHorizon: LedgerCountHorizon | null;
  qHorizon: LedgerCountHorizon | null;
}

type LedgerDaySeverity = Exclude<Severity, 'Unknown'>;

interface LedgerDayCounts {
  total: LedgerCountEvidence;
  severities: Readonly<Record<LedgerDaySeverity, LedgerCountEvidence>>;
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  Critical: 'bad',
  Warning: 'warn',
  Info: 'idle',
  Debug: 'idle',
  Unknown: 'idle',
};
const SEVERITY_FILTERS: { id: SeverityFilter; label: string }[] = [
  { id: 'all', label: 'All Logs' },
  { id: 'Critical', label: 'Critical' },
  { id: 'Warning', label: 'Warning' },
  { id: 'Info', label: 'Info' },
  { id: 'Debug', label: 'Debug' },
];
const LOG_PAGE_SIZE = 200;
export const LOG_SEARCH_DEBOUNCE_MS = 400;
const LEDGER_DAY_SEVERITIES = Object.freeze([
  'Critical',
  'Warning',
  'Info',
  'Debug',
] as const satisfies readonly LedgerDaySeverity[]);
const UNKNOWN_COUNT_EVIDENCE: LedgerCountEvidence = Object.freeze({
  count: null,
  scope: 'UNKNOWN',
  completeness: 'UNKNOWN',
  queryHorizon: null,
  qHorizon: null,
});
const UNKNOWN_DAY_COUNTS: LedgerDayCounts = Object.freeze({
  total: UNKNOWN_COUNT_EVIDENCE,
  severities: Object.freeze({
    Critical: UNKNOWN_COUNT_EVIDENCE,
    Warning: UNKNOWN_COUNT_EVIDENCE,
    Info: UNKNOWN_COUNT_EVIDENCE,
    Debug: UNKNOWN_COUNT_EVIDENCE,
  }),
});

const KNOWN_KINDS = [
  'account_snapshot',
  'binance.connected',
  'config_change',
  'engine.start',
  'error_event',
  'feed-open',
  'feed.open',
  'fill_event',
  'heartbeat',
  'loan_request',
  'loan_response',
  'manual_action',
  'order_intent',
  'order_request',
  'order_response',
  'risk_decision',
  'strategy_signal',
  'user_stream',
  'ws.closed',
  'ws.open',
];

const DETAIL_KEYS = [
  'allowed',
  'action',
  'stage',
  'result',
  'state',
  'feed',
  'service',
  'reasonCode',
  'detail',
  'orderId',
  'proposalId',
  'side',
  'type',
  'estNotionalUsd',
  'executedQuoteUsd',
  'imported',
  'fetched',
  'pairs',
  'assets',
  'mode',
];

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function recordValue(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
}

function isInvalidStoredPayloadSentinel(value: unknown): boolean {
  const record = recordValue(value);
  if (record === null) return false;
  const keys = Object.keys(record);
  return keys.length === 2
    && Object.hasOwn(record, 'unavailable')
    && record.unavailable === true
    && Object.hasOwn(record, 'reason')
    && record.reason === 'invalid_json';
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

const LEDGER_TEXT_LIMITS = Object.freeze({
  severity: 64,
  source: 256,
  strategy: 256,
  status: 128,
  reason: 2_048,
  message: 8_192,
  correlation: 256,
});
const LEDGER_PROJECTION_STATES = new Set<LedgerProjectionState>([
  'RECORDED_V3',
  'PROJECTED_LEGACY_PAYLOAD',
  'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3',
  'UNAVAILABLE',
  'INVALID_LEGACY_PAYLOAD',
  'INVALID_STORED_PAYLOAD',
]);
const LEDGER_HORIZON_TOKEN_PATTERN =
  /^v1\.(0|[1-9][0-9]{0,15})\.(0|[1-9][0-9]{0,15})\.[a-f0-9]{64}$/;

function exactNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactPositiveInteger(value: unknown): number | null {
  const parsed = exactNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function validLedgerText(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) return false;
  let scalarCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
    scalarCount += 1;
  }
  return scalarCount <= maximum && !/[\p{Cc}\p{Bidi_Control}]/u.test(value);
}

function validOptionalLedgerText(
  value: unknown,
  field: keyof typeof LEDGER_TEXT_LIMITS,
): value is string | null {
  return value === null || validLedgerText(value, LEDGER_TEXT_LIMITS[field]);
}

function horizonTokenParts(value: unknown): Readonly<{
  token: string;
  highWaterId: number;
  afterIdExclusive: number;
}> | null {
  if (typeof value !== 'string' || value.trim() !== value) return null;
  const match = LEDGER_HORIZON_TOKEN_PATTERN.exec(value);
  if (!match) return null;
  const highWaterId = Number(match[1]);
  const afterIdExclusive = Number(match[2]);
  if (!Number.isSafeInteger(highWaterId) || !Number.isSafeInteger(afterIdExclusive)) return null;
  return Object.freeze({ token: value, highWaterId, afterIdExclusive });
}

function exactHorizonReasons(value: unknown): LedgerHorizonReason[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const reasons: LedgerHorizonReason[] = [];
  for (const reason of value) {
    if (reason !== 'TEXT_SEARCH' && reason !== 'PROJECTED_METADATA_FILTER') return null;
    if (reasons.includes(reason)) return null;
    reasons.push(reason);
  }
  return reasons;
}

function decodePageHorizon(value: unknown): LedgerPageHorizon | null {
  const record = recordValue(value);
  if (!record || record.kind !== 'RECENT_EVENT_ID_WINDOW') return null;
  const maxIdSpan = exactPositiveInteger(record.maxIdSpan);
  const highWaterId = exactNonNegativeInteger(record.highWaterId);
  const afterIdExclusive = exactNonNegativeInteger(record.afterIdExclusive);
  const tokenParts = horizonTokenParts(record.token);
  const reasons = exactHorizonReasons(record.reasons);
  if (maxIdSpan !== 25_000
      || highWaterId === null
      || afterIdExclusive === null
      || afterIdExclusive !== Math.max(0, highWaterId - maxIdSpan)
      || tokenParts === null
      || tokenParts.highWaterId !== highWaterId
      || tokenParts.afterIdExclusive !== afterIdExclusive
      || reasons === null) {
    return null;
  }
  return {
    kind: 'RECENT_EVENT_ID_WINDOW',
    maxIdSpan,
    highWaterId,
    afterIdExclusive,
    reasons,
    token: tokenParts.token,
  };
}

function decodeCountHorizon(value: unknown): LedgerCountHorizon | null {
  const record = recordValue(value);
  const page = decodePageHorizon(value);
  if (!record || !page) return null;
  const retainedFromId = record.retainedFromId === null
    ? null
    : exactPositiveInteger(record.retainedFromId);
  const ledgerHighWaterId = exactNonNegativeInteger(record.ledgerHighWaterId);
  if (!(record.retainedFromId === null || retainedFromId !== null)
      || ledgerHighWaterId === null
      || ledgerHighWaterId < page.highWaterId
      || typeof record.complete !== 'boolean'
      || !Array.isArray(record.appliesTo)
      || record.appliesTo.length !== 2
      || record.appliesTo[0] !== 'RECENT_EVENTS'
      || record.appliesTo[1] !== 'COUNT') {
    return null;
  }
  const complete = retainedFromId === null
    || (ledgerHighWaterId === page.highWaterId && retainedFromId > page.afterIdExclusive);
  if (record.complete !== complete) return null;
  return {
    ...page,
    retainedFromId,
    ledgerHighWaterId,
    complete,
    appliesTo: ['RECENT_EVENTS', 'COUNT'],
  };
}

function samePageHorizon(
  left: LedgerPageHorizon | null,
  right: LedgerPageHorizon | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind
    && left.maxIdSpan === right.maxIdSpan
    && left.highWaterId === right.highWaterId
    && left.afterIdExclusive === right.afterIdExclusive
    && left.token === right.token
    && left.reasons.length === right.reasons.length
    && left.reasons.every((reason, index) => reason === right.reasons[index]);
}

function decodeFieldProvenance(
  value: unknown,
  field: LedgerMetadataField,
): LedgerFieldProvenance | null {
  const record = recordValue(value);
  if (!record || !LEDGER_PROJECTION_STATES.has(record.state as LedgerProjectionState)) return null;
  const state = record.state as LedgerProjectionState;
  const path = record.path;
  if (!(path === null || typeof path === 'string')) return null;
  const recordedPath = field === 'createdAt' ? 'events.created_at' : `events.${field}`;
  const legacyPath = `data.${field}`;
  if (state === 'RECORDED_V3' && path !== recordedPath) return null;
  if ((state === 'PROJECTED_LEGACY_PAYLOAD' || state === 'INVALID_LEGACY_PAYLOAD')
      && (field === 'createdAt' || path !== legacyPath)) {
    return null;
  }
  if (state === 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3'
      && (field !== 'createdAt' || path !== 'events.created_at' || record.basisPath !== 'events.ts')) {
    return null;
  }
  if (state === 'INVALID_STORED_PAYLOAD' && path !== 'events.data') return null;
  if (state === 'UNAVAILABLE' && !(path === null || (field !== 'createdAt' && path === legacyPath))) {
    return null;
  }
  if (state !== 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3' && record.basisPath !== undefined) {
    return null;
  }
  return state === 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3'
    ? { state, path, basisPath: 'events.ts' }
    : { state, path };
}

function decodeCanonicalLedgerEvent(value: unknown): CanonicalLedgerEvent | null {
  const record = recordValue(value);
  if (!record || !Object.hasOwn(record, 'data')) return null;
  const id = exactPositiveInteger(record.id);
  const ts = exactNonNegativeInteger(record.ts);
  const createdAt = exactNonNegativeInteger(record.createdAt);
  if (id === null
      || ts === null
      || createdAt === null
      || !validLedgerText(record.kind, 256)
      || !(record.symbol === null
        || (typeof record.symbol === 'string' && /^[A-Z0-9]{2,20}$/.test(record.symbol)))) {
    return null;
  }

  const textFields: LedgerTextMetadataField[] = [
    'severity',
    'source',
    'strategy',
    'status',
    'reason',
    'message',
    'correlation',
  ];
  for (const field of textFields) {
    if (!validOptionalLedgerText(record[field], field)) return null;
  }

  const projection = recordValue(record.metadataProjection);
  const payload = recordValue(projection?.payload);
  const fields = recordValue(projection?.fields);
  const decisionProjection = recordValue(projection?.decision);
  if (!projection
      || projection.schema !== 'cosmos.ledger-event-api-metadata.v1'
      || !payload
      || !['RECORDED_JSON', 'NO_STORED_PAYLOAD', 'INVALID_STORED_PAYLOAD'].includes(String(payload.state))
      || payload.path !== 'events.data'
      || !fields
      || !decisionProjection) {
    return null;
  }
  const payloadState = payload.state as LedgerStoredPayloadState;
  if ((payloadState === 'NO_STORED_PAYLOAD' && record.data !== null)
      || (payloadState === 'INVALID_STORED_PAYLOAD'
        && !isInvalidStoredPayloadSentinel(record.data))) {
    return null;
  }

  const decodedFields = {} as Record<LedgerMetadataField, LedgerFieldProvenance>;
  for (const field of [...textFields, 'createdAt'] as LedgerMetadataField[]) {
    const provenance = decodeFieldProvenance(fields[field], field);
    if (!provenance) return null;
    decodedFields[field] = provenance;
    if (field === 'createdAt') {
      if (provenance.state !== 'RECORDED_V3'
          && provenance.state !== 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3') {
        return null;
      }
      continue;
    }
    const recorded = provenance.state === 'RECORDED_V3'
      || provenance.state === 'PROJECTED_LEGACY_PAYLOAD';
    if (recorded !== (record[field] !== null)
        || ((provenance.state === 'PROJECTED_LEGACY_PAYLOAD'
          || provenance.state === 'INVALID_LEGACY_PAYLOAD')
          && payloadState !== 'RECORDED_JSON')
        || (provenance.state === 'INVALID_STORED_PAYLOAD'
          && payloadState !== 'INVALID_STORED_PAYLOAD')
        || (payloadState === 'INVALID_STORED_PAYLOAD'
          && record[field] === null
          && provenance.state !== 'INVALID_STORED_PAYLOAD')
        || (payloadState === 'NO_STORED_PAYLOAD'
          && record[field] === null
          && (provenance.state !== 'UNAVAILABLE' || provenance.path !== null))) {
      return null;
    }
  }
  const createdAtProvenance = decodedFields.createdAt;
  const hasRecordedText = textFields.some(
    (field) => decodedFields[field].state === 'RECORDED_V3',
  );
  if ((createdAtProvenance.state === 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3'
      && (createdAt !== ts || hasRecordedText))
      || (createdAtProvenance.state === 'RECORDED_V3'
        && createdAt === ts
        && !hasRecordedText)) {
    return null;
  }

  const decision = record.decision;
  const projectedDecision = decisionProjection.value;
  const decisionState = decisionProjection.state;
  const decisionPaths = decisionProjection.paths;
  if (!(decision === null || decision === 'ACCEPTED' || decision === 'REJECTED')
      || projectedDecision !== decision
      || !Array.isArray(decisionPaths)
      || !decisionPaths.every((path) => typeof path === 'string')
      || !['RECORDED_ALLOWED', 'RECORDED_STATUS', 'CONTRADICTORY_RECORDED_FIELDS', 'UNAVAILABLE'].includes(String(decisionState))) {
    return null;
  }
  const dataRecord = recordValue(record.data);
  const allowedDecision = payloadState === 'RECORDED_JSON'
    && dataRecord !== null
    && Object.hasOwn(dataRecord, 'allowed')
    && typeof dataRecord.allowed === 'boolean'
    ? dataRecord.allowed ? 'ACCEPTED' as const : 'REJECTED' as const
    : null;
  const statusDecision = typeof record.status === 'string'
    && (record.status.toUpperCase() === 'ACCEPTED' || record.status.toUpperCase() === 'REJECTED')
    ? record.status.toUpperCase() as 'ACCEPTED' | 'REJECTED'
    : null;
  let expectedDecision: 'ACCEPTED' | 'REJECTED' | null = null;
  let expectedDecisionState: CanonicalLedgerEvent['metadataProjection']['decision']['state'] = 'UNAVAILABLE';
  let expectedDecisionPaths: string[] = [];
  if (allowedDecision !== null
      && statusDecision !== null
      && allowedDecision !== statusDecision) {
    expectedDecisionState = 'CONTRADICTORY_RECORDED_FIELDS';
    expectedDecisionPaths = ['data.allowed', decodedFields.status.path as string];
  } else if (allowedDecision !== null) {
    expectedDecision = allowedDecision;
    expectedDecisionState = 'RECORDED_ALLOWED';
    expectedDecisionPaths = ['data.allowed'];
  } else if (statusDecision !== null) {
    expectedDecision = statusDecision;
    expectedDecisionState = 'RECORDED_STATUS';
    expectedDecisionPaths = [decodedFields.status.path as string];
  }
  if (decision !== expectedDecision
      || decisionState !== expectedDecisionState
      || decisionPaths.length !== expectedDecisionPaths.length
      || !decisionPaths.every((path, index) => path === expectedDecisionPaths[index])) {
    return null;
  }

  return {
    id,
    ts,
    kind: record.kind,
    symbol: record.symbol as string | null,
    data: record.data,
    severity: record.severity as string | null,
    source: record.source as string | null,
    strategy: record.strategy as string | null,
    status: record.status as string | null,
    reason: record.reason as string | null,
    message: record.message as string | null,
    correlation: record.correlation as string | null,
    createdAt,
    decision,
    metadataProjection: {
      schema: 'cosmos.ledger-event-api-metadata.v1',
      payload: {
        state: payloadState,
        path: 'events.data',
      },
      fields: decodedFields,
      decision: {
        value: decision,
        state: decisionState as CanonicalLedgerEvent['metadataProjection']['decision']['state'],
        paths: [...decisionPaths],
      },
    },
  };
}

export function decodeLedgerEventPage(
  value: unknown,
  expected: Readonly<{
    horizon: LedgerPageHorizon | null;
    limit: number;
    beforeId?: number;
  }>,
): Readonly<{ items: CanonicalLedgerEvent[]; queryHorizon: LedgerPageHorizon | null }> {
  const record = recordValue(value);
  if (!record
      || !Array.isArray(record.items)
      || record.items.length > expected.limit
      || !Object.hasOwn(record, 'queryHorizon')) {
    throw new Error('LEDGER_EVENT_PAGE_MALFORMED');
  }
  const queryHorizon = record.queryHorizon === null
    ? null
    : decodePageHorizon(record.queryHorizon);
  if (record.queryHorizon !== null && queryHorizon === null) {
    throw new Error('LEDGER_EVENT_PAGE_MALFORMED');
  }
  if (!samePageHorizon(queryHorizon, expected.horizon)) {
    throw new Error('LEDGER_EVENT_PAGE_HORIZON_MISMATCH');
  }
  const items: CanonicalLedgerEvent[] = [];
  let previousId = Number.POSITIVE_INFINITY;
  for (const item of record.items) {
    const decoded = decodeCanonicalLedgerEvent(item);
    if (!decoded
        || decoded.id >= previousId
        || (expected.beforeId !== undefined && decoded.id >= expected.beforeId)
        || (queryHorizon !== null
          && (decoded.id <= queryHorizon.afterIdExclusive || decoded.id > queryHorizon.highWaterId))) {
      throw new Error('LEDGER_EVENT_PAGE_MALFORMED');
    }
    previousId = decoded.id;
    items.push(decoded);
  }
  return Object.freeze({ items, queryHorizon });
}

function safeJson(value: unknown, spacing = 0): string {
  try {
    return JSON.stringify(value, null, spacing);
  } catch {
    return String(value);
  }
}

function kindLabel(kind: string): string {
  return kind
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function sentenceLabel(value: string): string {
  const label = value.replace(/[._-]/g, ' ').trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : value;
}

function sourceLabel(value: string): string {
  return sentenceLabel(value);
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not recorded';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (/usd|notional|price|quote/i.test(key)) return fmtPrice(value);
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length ? value.map((item) => formatDetailValue(key, item)).join(', ') : 'empty';
  const encoded = safeJson(value);
  return encoded.length > 120 ? `${encoded.slice(0, 120)}...` : encoded;
}

const UNAVAILABLE_FIELD_PROVENANCE: LedgerFieldProvenance = Object.freeze({
  state: 'UNAVAILABLE',
  path: null,
});

function fieldProvenance(
  ev: CanonicalLedgerEvent,
  field: LedgerMetadataField,
): LedgerFieldProvenance {
  const provenance = ev.metadataProjection?.schema === 'cosmos.ledger-event-api-metadata.v1'
    ? ev.metadataProjection.fields?.[field]
    : null;
  return decodeFieldProvenance(provenance, field) ?? UNAVAILABLE_FIELD_PROVENANCE;
}

export function ledgerEventTextFact(
  ev: CanonicalLedgerEvent,
  field: LedgerTextMetadataField,
): Readonly<{ value: string | null; provenance: LedgerFieldProvenance }> {
  const provenance = fieldProvenance(ev, field);
  return Object.freeze({
    value: provenance.state === 'RECORDED_V3' || provenance.state === 'PROJECTED_LEGACY_PAYLOAD'
      ? textValue(ev[field])
      : null,
    provenance,
  });
}

function reasonFact(ev: CanonicalLedgerEvent): Readonly<{
  value: string | null;
  provenance: LedgerFieldProvenance;
}> {
  const reason = ledgerEventTextFact(ev, 'reason');
  if (reason.value !== null) return reason;
  const message = ledgerEventTextFact(ev, 'message');
  return message.value !== null ? message : reason;
}

function sourceText(ev: CanonicalLedgerEvent): string {
  return ledgerEventTextFact(ev, 'source').value ?? 'Source Not Recorded';
}

function reasonText(ev: CanonicalLedgerEvent): string {
  return reasonFact(ev).value ?? 'Reason Not Recorded';
}

function statusText(ev: CanonicalLedgerEvent): string {
  return ledgerEventTextFact(ev, 'status').value ?? 'Not Recorded';
}

function statusLabel(ev: CanonicalLedgerEvent): string {
  return sentenceLabel(statusText(ev));
}

function eventTitle(ev: CanonicalLedgerEvent): string {
  if (ev.kind === 'strategy_signal') return 'Strategy Signal';
  if (ev.kind === 'risk_decision') return 'Risk Decision';
  if (ev.kind === 'account_snapshot') return 'Account snapshot';
  if (ev.kind === 'order_intent') return 'Order preview';
  if (ev.kind === 'order_request') return 'Order request';
  if (ev.kind === 'order_response') return 'Order response';
  if (ev.kind === 'fill_event') return 'Fill recorded';
  if (ev.kind === 'config_change') return 'Configuration updated';
  if (ev.kind === 'manual_action') return 'Manual action';
  if (ev.kind === 'engine.start') return 'Engine started';
  if (ev.kind === 'ws.open' || ev.kind === 'feed-open' || ev.kind === 'feed.open') return 'Connection opened';
  if (ev.kind === 'ws.closed') return 'Connection closed';
  if (ev.kind === 'heartbeat') return 'Heartbeat';
  if (ev.kind === 'user_stream') return 'User stream event';
  if (ev.kind === 'error_event') return 'Error recorded';
  return kindLabel(ev.kind);
}

function eventCaption(ev: CanonicalLedgerEvent): string {
  return reasonText(ev)
    .replace(/\|basis\|/gi, 'Basis')
    .replace(/\bws\.open\b/gi, 'connection opened')
    .replace(/\bws\.closed\b/gi, 'connection closed');
}

export function ledgerSeverityFamily(value: unknown): Severity {
  switch (textValue(value)?.toUpperCase()) {
    case 'CRITICAL':
    case 'ERROR':
    case 'FATAL':
    case 'EMERGENCY':
    case 'ALERT':
      return 'Critical';
    case 'WARNING':
    case 'WARN':
      return 'Warning';
    case 'INFO':
    case 'NOTICE':
    case 'NORMAL':
      return 'Info';
    case 'DEBUG':
    case 'TRACE':
      return 'Debug';
    default:
      return 'Unknown';
  }
}

function eventSeverity(ev: CanonicalLedgerEvent): Severity {
  return ledgerSeverityFamily(ledgerEventTextFact(ev, 'severity').value);
}

function provenanceLabel(provenance: LedgerFieldProvenance): string {
  const path = provenance.path ? ` · ${provenance.path}` : '';
  switch (provenance.state) {
    case 'RECORDED_V3':
      return `Recorded V3${path}`;
    case 'PROJECTED_LEGACY_PAYLOAD':
      return `Projected Legacy Payload${path}`;
    case 'MIGRATED_LEGACY_TS_OR_EQUAL_RECORDED_V3':
      return `Migrated Legacy Timestamp${path} · basis events.ts`;
    case 'INVALID_LEGACY_PAYLOAD':
      return `Invalid Legacy Payload${path}`;
    case 'INVALID_STORED_PAYLOAD':
      return `Invalid Stored Payload${path}`;
    default:
      return 'Unavailable';
  }
}

function hasLegacyProjection(ev: CanonicalLedgerEvent): boolean {
  return Object.values(ev.metadataProjection?.fields ?? {}).some(
    (provenance) => provenance?.state === 'PROJECTED_LEGACY_PAYLOAD',
  );
}

function decisionProvenanceLabel(ev: CanonicalLedgerEvent): string {
  const decision = ev.metadataProjection?.decision;
  if (!decision) return 'Unavailable';
  const paths = decision.paths.length ? ` · ${decision.paths.join(' + ')}` : '';
  switch (decision.state) {
    case 'RECORDED_ALLOWED':
      return `Recorded Allowed${paths}`;
    case 'RECORDED_STATUS':
      return `Recorded Status${paths}`;
    case 'CONTRADICTORY_RECORDED_FIELDS':
      return `Contradictory Recorded Fields${paths}`;
    default:
      return 'Unavailable';
  }
}

function decisionValue(ev: CanonicalLedgerEvent): 'ACCEPTED' | 'REJECTED' | null {
  const projection = ev.metadataProjection?.decision;
  if (!projection
      || projection.value !== ev.decision
      || !['RECORDED_ALLOWED', 'RECORDED_STATUS'].includes(projection.state)) {
    return null;
  }
  return projection.value;
}

function detailFields(ev: CanonicalLedgerEvent): { key: string; value: string }[] {
  const d = asRecord(ev.data);
  return DETAIL_KEYS.filter((key) => key in d).map((key) => ({ key: kindLabel(key), value: formatDetailValue(key, d[key]) }));
}

function contextAction(ev: CanonicalLedgerEvent): { page: Page; label: string } {
  const severity = eventSeverity(ev);
  if (severity === 'Critical' || ev.kind.startsWith('ws') || ev.kind === 'user_stream') return { page: 'system', label: 'Inspect source health' };
  if (ev.kind === 'risk_decision' || ev.kind === 'config_change') return { page: 'risk', label: 'Inspect risk guard' };
  if (ev.kind.startsWith('order') || ev.kind === 'fill_event') return { page: 'orders', label: 'Inspect execution path' };
  if (ev.kind === 'account_snapshot' || ev.kind === 'binance.connected') return { page: 'account', label: 'Inspect account state' };
  if (ev.kind === 'strategy_signal') return { page: 'opportunities', label: 'Inspect proposal board' };
  return { page: 'system', label: 'Inspect system health' };
}

function sortEvents(events: CanonicalLedgerEvent[]): CanonicalLedgerEvent[] {
  return [...events].sort((a, b) => b.id - a.id || b.ts - a.ts);
}

function formatLogTime(ts: number, zone?: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
}

function formatLogDateTime(ts: number, zone?: string): string {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SeverityBars({ severity }: { severity: Severity }) {
  return <span className={`logx-severity-bars ${severity.toLowerCase()}`} aria-label={`${severity} Severity`} title={`${severity} Severity`}>
    <i /><i /><i />
  </span>;
}

export function eventParams(input: Readonly<{
  day: string;
  zone?: string;
  kind: string;
  symbol: string;
  query: string;
  severity: SeverityFilter;
  decision: DecisionFilter;
  includeDebug: boolean;
  limit?: number;
  beforeId?: number;
  horizon?: string;
  envelope?: boolean;
}>): URLSearchParams {
  const bounds = dayBounds(input.day, input.zone);
  const params = new URLSearchParams({
    since: String(bounds.since),
    until: String(bounds.until),
  });
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.beforeId !== undefined) params.set('beforeId', String(input.beforeId));
  if (input.horizon !== undefined) params.set('horizon', input.horizon);
  if (input.envelope === true) params.set('envelope', 'true');
  if (input.kind !== 'all') params.set('kind', input.kind);
  if (input.symbol.trim()) params.set('symbol', input.symbol.trim().toUpperCase());
  if (input.query) params.set('q', input.query);
  if (input.severity !== 'all') params.set('severity', input.severity.toUpperCase());
  if (input.decision !== 'all') params.set('decision', input.decision);
  params.set('includeDebug', String(input.includeDebug));
  return params;
}

function mergeEventRows(
  current: readonly CanonicalLedgerEvent[],
  incoming: readonly CanonicalLedgerEvent[],
): CanonicalLedgerEvent[] {
  const rows = new Map<number, CanonicalLedgerEvent>();
  for (const event of current) rows.set(event.id, event);
  for (const event of incoming) rows.set(event.id, event);
  return sortEvents([...rows.values()]);
}

export function exactCount(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  const count = value;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function requireExactLedgerPageCardinality(
  actualLength: number,
  totalCount: number,
  alreadyLoaded = 0,
  limit = LOG_PAGE_SIZE,
): void {
  if (!Number.isSafeInteger(actualLength)
      || actualLength < 0
      || !Number.isSafeInteger(totalCount)
      || totalCount < 0
      || !Number.isSafeInteger(alreadyLoaded)
      || alreadyLoaded < 0
      || alreadyLoaded > totalCount
      || !Number.isSafeInteger(limit)
      || limit < 1
      || actualLength !== Math.min(limit, totalCount - alreadyLoaded)) {
    throw new Error('LEDGER_EVENT_PAGE_COUNT_MISMATCH');
  }
}

export function decodeLedgerCountEvidence(value: unknown): LedgerCountEvidence {
  const record = recordValue(value);
  if (!record) return UNKNOWN_COUNT_EVIDENCE;
  const count = exactCount(record.count);
  const scope = record.scope;
  const completeness = record.completeness;
  const admittedCompleteness = completeness === 'COMPLETE_RETAINED_SET'
    || completeness === 'BOUNDED_RECENT_ID_HORIZON'
    ? completeness
    : null;
  if (count === null
      || (scope !== 'FILTERED_RETAINED_LEDGER' && scope !== 'RECENT_EVENT_ID_WINDOW')
      || admittedCompleteness === null) {
    return UNKNOWN_COUNT_EVIDENCE;
  }

  if (scope === 'FILTERED_RETAINED_LEDGER') {
    if (admittedCompleteness !== 'COMPLETE_RETAINED_SET'
        || record.queryHorizon !== null
        || record.qHorizon !== null) {
      return UNKNOWN_COUNT_EVIDENCE;
    }
    return {
      count,
      scope,
      completeness: admittedCompleteness,
      queryHorizon: null,
      qHorizon: null,
    };
  }

  const queryHorizon = decodeCountHorizon(record.queryHorizon);
  if (queryHorizon === null
      || queryHorizon.complete !== (admittedCompleteness === 'COMPLETE_RETAINED_SET')
      || count > queryHorizon.highWaterId - queryHorizon.afterIdExclusive) {
    return UNKNOWN_COUNT_EVIDENCE;
  }

  const qHorizon = record.qHorizon === null ? null : decodeCountHorizon(record.qHorizon);
  const hasTextSearch = queryHorizon.reasons.includes('TEXT_SEARCH');
  if ((hasTextSearch && qHorizon === null)
      || (!hasTextSearch && record.qHorizon !== null)
      || (qHorizon !== null && (
        !samePageHorizon(qHorizon, queryHorizon)
        || qHorizon.retainedFromId !== queryHorizon.retainedFromId
        || qHorizon.ledgerHighWaterId !== queryHorizon.ledgerHighWaterId
        || qHorizon.complete !== queryHorizon.complete
      ))) {
    return UNKNOWN_COUNT_EVIDENCE;
  }
  return {
    count,
    scope,
    completeness: admittedCompleteness,
    queryHorizon,
    qHorizon,
  };
}

function decodeLedgerDayCounts(
  totalPayload: unknown,
  severityPayloads: Readonly<Record<LedgerDaySeverity, unknown>>,
): LedgerDayCounts {
  const total = decodeLedgerCountEvidence(totalPayload);
  const severities = Object.fromEntries(LEDGER_DAY_SEVERITIES.map((severity) => [
    severity,
    decodeLedgerCountEvidence(severityPayloads[severity]),
  ])) as Record<LedgerDaySeverity, LedgerCountEvidence>;
  if (total.count === null || LEDGER_DAY_SEVERITIES.some((severity) => severities[severity].count === null)) {
    throw new Error('LEDGER_EVENT_COUNT_MALFORMED');
  }
  const classifiedCount = LEDGER_DAY_SEVERITIES.reduce(
    (sum, severity) => sum + (severities[severity].count as number),
    0,
  );
  if (classifiedCount > total.count) throw new Error('LEDGER_EVENT_COUNT_INCONSISTENT');
  return Object.freeze({
    total,
    severities: Object.freeze(severities),
  });
}

export function ledgerCountLabel(
  evidence: LedgerCountEvidence,
  filtered: boolean,
): string {
  if (evidence.count === null) return 'Count Pending';
  const count = evidence.count.toLocaleString('en-US');
  if (evidence.completeness === 'BOUNDED_RECENT_ID_HORIZON' && evidence.queryHorizon !== null) {
    return `${count} In Recent ${evidence.queryHorizon.maxIdSpan.toLocaleString('en-US')}-ID Horizon`;
  }
  return `${count} ${filtered ? 'Matching' : 'Total'} · Complete Retained Set`;
}

function countModeLabel(
  evidence: LedgerCountEvidence,
  queryReady: boolean,
  querySettling: boolean,
): string {
  if (!queryReady) return 'Type At Least 2 Literal Characters To Search';
  if (querySettling) return 'Waiting For Search To Settle';
  if (evidence.completeness === 'BOUNDED_RECENT_ID_HORIZON') {
    return 'Server Filters · Bounded Recent-ID Count';
  }
  if (evidence.completeness === 'COMPLETE_RETAINED_SET') {
    return evidence.queryHorizon === null
      ? 'Server Filters · Complete Retained Count'
      : 'Server Filters · Complete Retained Horizon Count';
  }
  return 'Server Filters · Count Pending';
}

interface LedgerSearchDebounceRuntime {
  schedule: (task: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

export function createLedgerSearchDebouncer(
  runtime: LedgerSearchDebounceRuntime = {
    schedule: (task, delayMs) => window.setTimeout(task, delayMs),
    cancel: (handle) => window.clearTimeout(handle),
  },
) {
  let handle: number | null = null;
  const cancel = () => {
    if (handle !== null) runtime.cancel(handle);
    handle = null;
  };
  return {
    settle(value: string, onSettled: (value: string) => void) {
      cancel();
      handle = runtime.schedule(() => {
        handle = null;
        onSettled(value);
      }, LOG_SEARCH_DEBOUNCE_MS);
    },
    cancel,
  };
}

export function LedgerPage() {
  const { setPage, openDetail, prefs, updatePref } = useStore();
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;
  const today = dayKey(new Date(), zone);
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)), [today]);
  const [apiEvents, setApiEvents] = useState<CanonicalLedgerEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState(today);
  const [kind, setKind] = useState('all');
  const [symbol, setSymbol] = useState(() => {
    const v = sessionStorage.getItem('cosmos-ledger-symbol') ?? '';
    sessionStorage.removeItem('cosmos-ledger-symbol');
    return v;
  });
  const [query, setQuery] = useState('');
  const [settledQuery, setSettledQuery] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const [includeDebug, setIncludeDebug] = useState(false);
  // F-065: malformed or missing count evidence stays unknown, never a real 0.
  const [totalCountEvidence, setTotalCountEvidence] = useState<LedgerCountEvidence>(UNKNOWN_COUNT_EVIDENCE);
  const [dayTotals, setDayTotals] = useState<Record<string, LedgerDayCounts>>({});
  const [dayTotalsError, setDayTotalsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPinned, setHistoryPinned] = useState(false);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [loadedEventReadKey, setLoadedEventReadKey] = useState<string | null>(null);
  const [loadedDayCountKey, setLoadedDayCountKey] = useState<string | null>(null);
  const eventPollRef = useRef<SettledPoll | null>(null);
  const olderAbortRef = useRef<AbortController | null>(null);
  const searchDebouncerRef = useRef<ReturnType<typeof createLedgerSearchDebouncer> | null>(null);
  if (searchDebouncerRef.current === null) searchDebouncerRef.current = createLedgerSearchDebouncer();
  const normalizedQuery = query.trim();
  const queryReady = normalizedQuery.length === 0
    || (normalizedQuery.length >= 2 && normalizedQuery.length <= 60 && !/^[%_*\s]+$/.test(normalizedQuery));
  const serverQuery = queryReady ? settledQuery : '';
  const querySettling = queryReady && settledQuery !== normalizedQuery;
  const filterActive = kind !== 'all'
    || symbol.trim() !== ''
    || serverQuery !== ''
    || severity !== 'all'
    || decision !== 'all'
    || includeDebug;
  const eventReadKey = [
    selectedDay,
    zone ?? 'local',
    kind,
    symbol.trim().toUpperCase(),
    serverQuery,
    severity,
    decision,
    includeDebug ? 'debug' : 'no-debug',
  ].join('\u0000');
  const dayCountKey = [
    dayKeys.join(','),
    zone ?? 'local',
    kind,
    symbol.trim().toUpperCase(),
    serverQuery,
    decision,
  ].join('\u0000');

  useEffect(() => {
    const debouncer = searchDebouncerRef.current;
    if (!debouncer) return;
    if (!queryReady) {
      debouncer.cancel();
      setSettledQuery('');
      return;
    }
    debouncer.settle(normalizedQuery, setSettledQuery);
    return debouncer.cancel;
  }, [normalizedQuery, queryReady]);

  useEffect(() => {
    setSelectedDay(today);
    setSelectedId(null);
  }, [prefs.clockZone, today]);

  const refreshLogs = useCallback(() => {
    setHistoryPinned(false);
    setHistoryError(null);
    setRefreshEpoch((current) => current + 1);
  }, []);

  useEffect(() => {
    const countParams = eventParams({
      day: selectedDay,
      zone,
      kind,
      symbol,
      query: serverQuery,
      severity,
      decision,
      includeDebug,
    });
    olderAbortRef.current?.abort();
    olderAbortRef.current = null;
    setApiEvents([]);
    setTotalCountEvidence(UNKNOWN_COUNT_EVIDENCE);
    setSelectedId(null);
    setLoadingOlder(false);
    setLoadError(null);
    setHistoryError(null);
    setHistoryPinned(false);
    setLoadedEventReadKey(null);
    const poll = createSettledPoll<Readonly<{
      rows: CanonicalLedgerEvent[];
      countEvidence: LedgerCountEvidence;
    }>>({
      intervalMs: Math.max(30, prefs.dataCadence?.health ?? 10) * 1_000,
      request: async (signal) => {
        setLoading(true);
        const countPayload = await fetchJson<unknown>(
          `/api/events/count?${countParams}`,
          { cache: 'no-store', signal },
        );
        const countEvidence = decodeLedgerCountEvidence(countPayload);
        if (countEvidence.count === null) throw new Error('LEDGER_EVENT_COUNT_MALFORMED');
        const pageHorizon = countEvidence.queryHorizon;
        const params = eventParams({
          day: selectedDay,
          zone,
          kind,
          symbol,
          query: serverQuery,
          severity,
          decision,
          includeDebug,
          limit: LOG_PAGE_SIZE,
          horizon: pageHorizon?.token,
          envelope: true,
        });
        const pagePayload = await fetchJson<unknown>(
          `/api/events?${params}`,
          { cache: 'no-store', signal },
        );
        const page = decodeLedgerEventPage(pagePayload, {
          horizon: pageHorizon,
          limit: LOG_PAGE_SIZE,
        });
        requireExactLedgerPageCardinality(page.items.length, countEvidence.count);
        return Object.freeze({ rows: page.items, countEvidence });
      },
      onSuccess: ({ rows, countEvidence }) => {
        setApiEvents(sortEvents(rows));
        setTotalCountEvidence(countEvidence);
        setLoadedEventReadKey(eventReadKey);
        setLoadError(null);
        setHistoryError(null);
        setHistoryPinned(false);
        setLastLoaded(Date.now());
        setLoading(false);
      },
      onError: (error) => {
        setLoadError(apiErrorMessage(error, 'Failed to load events'));
        setLoading(false);
      },
    });
    eventPollRef.current = poll;
    poll.start();
    return () => {
      if (eventPollRef.current === poll) eventPollRef.current = null;
      poll.stop();
      olderAbortRef.current?.abort();
      olderAbortRef.current = null;
    };
  }, [decision, eventReadKey, includeDebug, kind, prefs.dataCadence?.health, refreshEpoch, selectedDay, serverQuery, severity, symbol, zone]);

  useEffect(() => {
    setDayTotals({});
    setDayTotalsError(null);
    setLoadedDayCountKey(null);
    const poll = createSettledPoll<Record<string, LedgerDayCounts>>({
      intervalMs: 60_000,
      request: async (signal) => {
        const pairs = await Promise.all(dayKeys.map(async (key) => {
          const fetchCount = (countSeverity: SeverityFilter) => {
            const params = eventParams({
              day: key,
              zone,
              kind,
              symbol,
              query: serverQuery,
              severity: countSeverity,
              decision,
              includeDebug: true,
            });
            return fetchJson<unknown>(`/api/events/count?${params}`, { cache: 'no-store', signal });
          };
          const [totalPayload, ...severityPayloadList] = await Promise.all([
            fetchCount('all'),
            ...LEDGER_DAY_SEVERITIES.map(fetchCount),
          ]);
          const severityPayloads = Object.fromEntries(LEDGER_DAY_SEVERITIES.map((countSeverity, index) => [
            countSeverity,
            severityPayloadList[index],
          ])) as Record<LedgerDaySeverity, unknown>;
          return [key, decodeLedgerDayCounts(totalPayload, severityPayloads)] as const;
        }));
        return Object.fromEntries(pairs);
      },
      onSuccess: (totals) => {
        setDayTotals(totals);
        setDayTotalsError(null);
        setLoadedDayCountKey(dayCountKey);
      },
      // F-065: this poll previously had no error handler at all, so a failing
      // count endpoint was silently indistinguishable from empty days.
      onError: (error) => {
        setDayTotalsError(apiErrorMessage(error, 'Failed to load day counts'));
      },
    });
    poll.start();
    return poll.stop;
  }, [dayCountKey, dayKeys, decision, kind, serverQuery, symbol, zone]);

  const events = useMemo(() => {
    const map = new Map<number, CanonicalLedgerEvent>();
    for (const ev of apiEvents) map.set(ev.id, ev);
    return sortEvents([...map.values()]);
  }, [apiEvents]);

  const kindOptions = useMemo(() => {
    const seen = new Set([...KNOWN_KINDS, ...(kind === 'all' ? [] : [kind]), ...events.map((ev) => ev.kind)]);
    return ['all', ...[...seen].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)))];
  }, [events, kind]);

  const rowsCurrent = queryReady && !querySettling && loadedEventReadKey === eventReadKey;
  const countsCurrent = queryReady && !querySettling && loadedDayCountKey === dayCountKey;
  const renderedEvents = rowsCurrent ? events : [];
  const renderedTotalCountEvidence = rowsCurrent ? totalCountEvidence : UNKNOWN_COUNT_EVIDENCE;
  const renderedTotalCount = renderedTotalCountEvidence.count;
  const renderedDayTotals = countsCurrent ? dayTotals : {};
  const dayFilterActive = kind !== 'all'
    || symbol.trim() !== ''
    || serverQuery !== ''
    || decision !== 'all';
  const selected = selectedId === null ? null : renderedEvents.find((ev) => ev.id === selectedId) ?? null;
  const canClear = kind !== 'all'
    || symbol !== ''
    || query !== ''
    || severity !== 'all'
    || decision !== 'all'
    || includeDebug;
  const canLoadOlder = renderedTotalCount !== null
    && renderedEvents.length > 0
    && renderedEvents.length < renderedTotalCount;
  const rangeLabel = `${formatKey(dayKeys[0], { month: 'short', day: 'numeric' })} — ${formatKey(dayKeys[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  useEffect(() => {
    setRawOpen(false);
  }, [selected?.id]);

  function clearFilters(): void {
    setKind('all');
    setSymbol('');
    setQuery('');
    setSeverity('all');
    setDecision('all');
    setIncludeDebug(false);
    setSelectedId(null);
  }

  function selectSeverity(next: SeverityFilter): void {
    setSeverity(next);
    if (next === 'Debug') setIncludeDebug(true);
    setSelectedId(null);
  }

  function toggleDebug(): void {
    setIncludeDebug((current) => !current);
    if (includeDebug && severity === 'Debug') setSeverity('all');
    setSelectedId(null);
  }

  async function loadOlder(): Promise<void> {
    if (!canLoadOlder || loadingOlder || renderedTotalCount === null) return;
    const beforeId = renderedEvents[renderedEvents.length - 1]?.id;
    if (beforeId === undefined) return;
    const alreadyLoaded = renderedEvents.length;
    const pageHorizon = renderedTotalCountEvidence.queryHorizon;
    eventPollRef.current?.stop();
    eventPollRef.current = null;
    setLoading(false);
    setHistoryPinned(true);
    setHistoryError(null);
    olderAbortRef.current?.abort();
    const controller = new AbortController();
    olderAbortRef.current = controller;
    setLoadingOlder(true);
    try {
      const params = eventParams({
        day: selectedDay,
        zone,
        kind,
        symbol,
        query: serverQuery,
        severity,
        decision,
        includeDebug,
        limit: LOG_PAGE_SIZE,
        beforeId,
        horizon: pageHorizon?.token,
        envelope: true,
      });
      const payload = await fetchJson<unknown>(`/api/events?${params}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (olderAbortRef.current !== controller) return;
      const page = decodeLedgerEventPage(payload, {
        horizon: pageHorizon,
        limit: LOG_PAGE_SIZE,
        beforeId,
      });
      requireExactLedgerPageCardinality(
        page.items.length,
        renderedTotalCount,
        alreadyLoaded,
      );
      setApiEvents((current) => mergeEventRows(current, page.items));
      setHistoryError(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        setHistoryError(apiErrorMessage(error, 'Failed to load older events'));
      }
    } finally {
      if (olderAbortRef.current === controller) {
        olderAbortRef.current = null;
        setLoadingOlder(false);
      }
    }
  }

  return (
    <div className="container page lix-page logx-page">
      <div className="lix-frame logx-frame">
        <header className="lix-toolbar">
          <div className="lix-title logx-title">
            <img className="logx-page-mark" src="/log-mark.png" alt="" aria-hidden="true" />
            <h1>Logs</h1>
            <span className={`lix-live ${loadError ? 'error' : historyPinned ? 'snapshot' : ''}`}>
              <i />
              {loadError
                ? 'Unavailable'
                : loading
                  ? 'Updating'
                  : historyPinned
                    ? `History Snapshot · ${lastLoaded ? timeAgo(lastLoaded) : 'Waiting'}`
                    : `Live · ${lastLoaded ? timeAgo(lastLoaded) : 'Waiting'}`}
            </span>
          </div>
          <label className="lix-search">
            <IconSearch size={15} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedId(null);
              }}
              placeholder="Search 2+ Characters"
              maxLength={60}
              aria-invalid={!queryReady}
              spellCheck={false}
            />
            {query && <button type="button" aria-label="Clear Search" onClick={() => {
              setQuery('');
              setSelectedId(null);
            }}>×</button>}
          </label>
        </header>

        <ProductSurfaceAdapter surfaceId="logs-ledger" />

        <section className="calx-navigation logx-navigation" aria-label="Logs Navigation">
          <div className="calx-range-controls">
            <button type="button" className="calx-today" onClick={() => { setSelectedDay(today); setSelectedId(null); }}>Today</button>
            <strong>{rangeLabel}</strong><span className="newsx-range-note">Rolling Seven Days</span>
          </div>
          <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
        </section>

        {dayTotalsError && <p className="logx-day-notice" role="status">Day counts unavailable: {dayTotalsError}</p>}

        <section className="calx-week logx-week" aria-label="Log Days" title={dayTotalsError ?? undefined}>
          {dayKeys.map((key) => {
            const counts = renderedDayTotals[key] ?? UNKNOWN_DAY_COUNTS;
            const count = counts.total.count;
            return <button type="button" key={key} aria-pressed={key === selectedDay} className={`${key === selectedDay ? 'selected' : ''} ${key === today ? 'today' : ''}`} onClick={() => { setSelectedDay(key); setSelectedId(null); }}>
              <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
              <span><em>{dayFilterActive ? 'Matching Total' : 'Total'}</em><b title={ledgerCountLabel(counts.total, dayFilterActive)}>{count ?? '—'}</b></span>
              <span className="logx-day-severity"><em>{key === selectedDay ? 'Current Day' : 'Select Day'}</em><b>
                {LEDGER_DAY_SEVERITIES.map((countSeverity) => {
                  const evidence = counts.severities[countSeverity];
                  return <i
                    key={countSeverity}
                    className={countSeverity.toLowerCase()}
                    title={ledgerCountLabel(evidence, dayFilterActive)}
                  >{countSeverity.charAt(0)} {evidence.count ?? '—'}</i>;
                })}
              </b></span>
            </button>;
          })}
        </section>

        <section className="lix-filters logx-filters" aria-label="Logs Filters">
          <div className="lix-segments logx-severity-tabs" role="group" aria-label="Server Severity Filter">
            {SEVERITY_FILTERS.map((option) => <button
              type="button"
              key={option.id}
              aria-pressed={severity === option.id}
              className={severity === option.id ? 'selected' : ''}
              onClick={() => selectSeverity(option.id)}
            >
              {option.label}
            </button>)}
          </div>
          <div className="logx-filter-actions">
            <PillSelect
              value={kind}
              options={kindOptions.map((item) => ({ id: item, label: item === 'all' ? 'All Kinds' : kindLabel(item) }))}
              onChange={(value) => { setKind(value); setSelectedId(null); }}
              ariaLabel="Kind Filter"
              className="lix-select"
            />
            <PillSelect
              value={decision}
              options={[
                { id: 'all' as DecisionFilter, label: 'All Decisions' },
                { id: 'accepted' as DecisionFilter, label: 'Accepted Only' },
                { id: 'rejected' as DecisionFilter, label: 'Rejected Only' },
              ]}
              onChange={(value) => {
                setDecision(value);
                setSelectedId(null);
              }}
              ariaLabel="Server Decision Filter"
              className="lix-select"
            />
            {symbol && <button type="button" className="logx-symbol-chip" onClick={() => setSymbol('')} title={`Clear ${symbol} filter`}>{symbol}<span>×</span></button>}
            <button
              type="button"
              className={`logx-debug-toggle${includeDebug ? ' active' : ''}`}
              aria-pressed={includeDebug}
              onClick={toggleDebug}
            >
              {includeDebug ? 'Debug Included' : 'Include Debug'}
            </button>
            <button type="button" className="logx-refresh" onClick={refreshLogs} disabled={loading}>
              <IconRefresh size={13} />
              Refresh
            </button>
            {canClear && <button type="button" className="logx-clear" onClick={clearFilters}>Clear</button>}
          </div>
        </section>

        <section className="logx-tape" aria-label="Log Activity">
          <div className="logx-filter-truth" role="status">
            <strong>Ledger Evidence</strong>
            <span>{countModeLabel(renderedTotalCountEvidence, queryReady, querySettling)}</span>
          </div>
          <div className="logx-day-header">
            <strong>{formatKey(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
            <span>{renderedEvents.length.toLocaleString('en-US')} Loaded · {ledgerCountLabel(renderedTotalCountEvidence, filterActive)} · {resolvedZoneLabel(prefs.clockZone)}</span>
          </div>
          <div className="logx-header"><span>Time</span><span>Severity</span><span>Event</span><span>Symbol</span><span>Source</span><span>Status</span><span /></div>
          <div className="logx-day-body" key={selectedDay} role="listbox" aria-label="Log Activity">
            {renderedEvents.map((ev) => {
              const evSeverity = eventSeverity(ev);
              const expanded = selected?.id === ev.id;
              const fields = detailFields(ev);
              const ctx = contextAction(ev);
              const severityFact = ledgerEventTextFact(ev, 'severity');
              const sourceFact = ledgerEventTextFact(ev, 'source');
              const eventReasonFact = ledgerEventTextFact(ev, 'reason');
              const eventMessageFact = ledgerEventTextFact(ev, 'message');
              const eventStatusFact = ledgerEventTextFact(ev, 'status');
              const eventStrategyFact = ledgerEventTextFact(ev, 'strategy');
              const eventCorrelationFact = ledgerEventTextFact(ev, 'correlation');
              const createdAtProvenance = fieldProvenance(ev, 'createdAt');
              const legacyProjection = hasLegacyProjection(ev);
              return <div className={`logx-entry${expanded ? ' expanded' : ''}`} key={ev.id}>
                <div
                  className={`lg-row${expanded ? ' selected' : ''}`}
                  onClick={() => setSelectedId((current) => current === ev.id ? null : ev.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId((current) => current === ev.id ? null : ev.id);
                    }
                  }}
                  role="option"
                  tabIndex={0}
                  aria-selected={expanded}
                  aria-expanded={expanded}
                >
                  <span className="lg-time" title={formatLogDateTime(ev.ts, zone)}>{formatLogTime(ev.ts, zone)}</span>
                  <SeverityBars severity={evSeverity} />
                  <span className="lg-main" title={`${eventTitle(ev)} — ${eventCaption(ev)}`}>
                    <b>{eventTitle(ev)}</b>
                    <em> — {eventCaption(ev)}</em>
                    {legacyProjection && <span className="logx-projection-tag">Legacy Projection</span>}
                  </span>
                  {ev.symbol ? (
                    <button
                      type="button"
                      className="lg-sym"
                      onClick={(event) => { event.stopPropagation(); openDetail(ev.symbol as string); }}
                      title={`Inspect ${ev.symbol} market detail`}
                    >
                      <TokenIcon symbol={ev.symbol} size={14} />
                      {ev.symbol}
                    </button>
                  ) : (
                    <span className="lg-sym system">System</span>
                  )}
                  <span className="lg-src" title={`${kindLabel(ev.kind)} · ${sourceLabel(sourceText(ev))}`}>{sourceLabel(sourceText(ev))}</span>
                  <span className="lg-status">{statusLabel(ev)}</span>
                  <span className={`logx-expand${expanded ? ' open' : ''}`} aria-hidden>
                    <svg viewBox="0 0 16 16"><path d="M4.5 6.25 8 9.75l3.5-3.5" /></svg>
                  </span>
                </div>
                {expanded && <div className="logx-detail">
                  <div className="logx-detail-head">
                    <div>
                      <Pill tone={SEVERITY_TONE[evSeverity]}>{evSeverity}</Pill>
                      <strong>{eventTitle(ev)}</strong>
                      <span>#{ev.id} · {kindLabel(ev.kind)}</span>
                      <small className="logx-provenance">{provenanceLabel(severityFact.provenance)}</small>
                    </div>
                    <time>{formatLogDateTime(ev.ts, zone)} · {timeAgo(ev.ts)}</time>
                  </div>
                  <dl className="lg-facts">
                    <div><dt>Severity</dt><dd>{severityFact.value ?? 'Not Recorded'}<small className="logx-provenance">{provenanceLabel(severityFact.provenance)}</small></dd></div>
                    <div><dt>Source</dt><dd>{sourceLabel(sourceFact.value ?? 'Source Not Recorded')}<small className="logx-provenance">{provenanceLabel(sourceFact.provenance)}</small></dd></div>
                    <div><dt>Strategy</dt><dd>{eventStrategyFact.value ?? 'Not Recorded'}<small className="logx-provenance">{provenanceLabel(eventStrategyFact.provenance)}</small></dd></div>
                    <div><dt>Status</dt><dd>{statusLabel(ev)}<small className="logx-provenance">{provenanceLabel(eventStatusFact.provenance)}</small></dd></div>
                    <div><dt>Reason</dt><dd>{eventReasonFact.value ?? 'Not Recorded'}<small className="logx-provenance">{provenanceLabel(eventReasonFact.provenance)}</small></dd></div>
                    <div><dt>Message</dt><dd>{eventMessageFact.value ?? 'Not Recorded'}<small className="logx-provenance">{provenanceLabel(eventMessageFact.provenance)}</small></dd></div>
                    <div><dt>Correlation</dt><dd>{eventCorrelationFact.value ?? 'Not Recorded'}<small className="logx-provenance">{provenanceLabel(eventCorrelationFact.provenance)}</small></dd></div>
                    <div><dt>Created At</dt><dd>{formatLogDateTime(ev.createdAt, zone)}<small className="logx-provenance">{provenanceLabel(createdAtProvenance)}</small></dd></div>
                    <div><dt>Decision</dt><dd>{decisionValue(ev) ?? 'Not Recorded'}<small className="logx-provenance">{decisionProvenanceLabel(ev)}</small></dd></div>
                    <div><dt>Symbol</dt><dd>{ev.symbol ?? 'System'}</dd></div>
                    {fields.map((field) => <div key={field.key}><dt>{field.key}</dt><dd>{field.value}</dd></div>)}
                  </dl>
                  <div className="lg-related">
                    <button type="button" className="hp-btn" onClick={() => setPage(ctx.page)}>
                      {ctx.page === 'risk'
                        ? <IconShield size={13} />
                        : ctx.page === 'account'
                          ? <IconWallet size={13} />
                          : <IconDatabase size={13} />}
                      {ctx.label}
                    </button>
                  </div>
                  <details className="lg-raw" open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}>
                    <summary>Raw JSON</summary>
                    <pre>{safeJson(ev, 2)}</pre>
                  </details>
                </div>}
              </div>;
            })}
            {renderedTotalCount !== null && renderedTotalCount > 0 && <div className="logx-load-more">
              <span>Showing {renderedEvents.length.toLocaleString('en-US')} Of {ledgerCountLabel(renderedTotalCountEvidence, filterActive)} Logs</span>
              <span className="logx-page-actions">
                {canLoadOlder && <button type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder ? 'Loading Older Logs…' : `Load Older Logs · ${LOG_PAGE_SIZE}`}
                </button>}
              </span>
            </div>}
            {historyError && <div className="lix-empty" role="alert">Older Logs Unavailable: {historyError}</div>}
            {loading && renderedEvents.length === 0 && <div className="lix-empty">Loading Logs…</div>}
            {loadError && renderedEvents.length === 0 && <div className="lix-empty">The Log Feed Is Currently Unavailable.</div>}
            {!loading && !loadError && !querySettling && renderedEvents.length === 0 && <div className="lix-empty">{serverQuery ? `Nothing Matches “${serverQuery}”.` : 'No Logs Match These Filters.'}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
