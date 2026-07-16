import { createHash } from 'node:crypto';

import {
  deepFreezePrivate,
  privateAccountRealmReference,
  snapshotPrivateData,
} from './bounds.js';
import {
  PRIVATE_LIFECYCLE_AUTHORITY,
  type PrivateLifecycleAuthority,
} from './types.js';
import { BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 } from '../binanceContracts/matrix.js';
import { BINANCE_CONTRACT_MATRIX_REVISION } from '../binanceContracts/types.js';

/**
 * Pure documentary reducer for the current Cross Margin risk stream.
 *
 * This module accepts observations made elsewhere. It never accepts credential
 * material, constructs a route, opens a connection, schedules renewal, reads an
 * account, or treats risk events as account/trading reconciliation truth.
 */

export const MARGIN_RISK_LIFECYCLE_SCHEMA = 'BINANCE_MARGIN_RISK_LIFECYCLE_V1' as const;
export const MARGIN_RISK_LIFECYCLE_VERSION = 1 as const;

export const MARGIN_RISK_LEASE_LIFETIME_MS = 60 * 60 * 1_000;
export const MARGIN_RISK_CONNECTION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS = 2_000;
export const MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS = 128;
export const MARGIN_RISK_DEFAULT_ACCOUNT_REALM_ID = 'account-realm-synthetic-a' as const;

export const MARGIN_RISK_DOCUMENTARY_CONTRACTS = Object.freeze({
  leasePost: 'MARGIN_RISK_LISTEN_KEY_POST',
  leasePut: 'MARGIN_RISK_LISTEN_KEY_PUT',
  closeConflict: 'MARGIN_RISK_LISTEN_KEY_DELETE_CONFLICT',
  rawRoute: 'MARGIN_RISK_WS_RAW',
  combinedRoute: 'MARGIN_RISK_WS_COMBINED',
  accountTradingPost: 'MARGIN_TRADE_LISTEN_TOKEN_POST_UNKNOWN',
  accountTradingSubscribe: 'MARGIN_TRADE_LISTEN_TOKEN_SUBSCRIBE_UNKNOWN',
} as const);

export const MARGIN_RISK_EVENT_KINDS = Object.freeze([
  'MARGIN_LEVEL_STATUS_CHANGE',
  'USER_LIABILITY_CHANGE',
] as const);

export type MarginRiskEventKind = (typeof MARGIN_RISK_EVENT_KINDS)[number];
export type MarginRiskRouteClass = 'RAW' | 'COMBINED';
export type MarginRiskRouteContractId =
  | typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute
  | typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute;
export type MarginRiskLeaseContractId =
  | typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost
  | typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut;

export const MARGIN_RISK_LIFECYCLE_PHASES = Object.freeze([
  'UNCONFIGURED',
  'LEASE_ACTIVE',
  'CONNECTED_RISK_ONLY',
  'DISCONNECTED_LEASE_UNRESOLVED',
  'LEASE_EXPIRED',
  'CONNECTION_EXPIRED',
] as const);

export type MarginRiskLifecyclePhase = (typeof MARGIN_RISK_LIFECYCLE_PHASES)[number];

export const MARGIN_RISK_CONTINUITY_POSTURES = Object.freeze([
  'UNPROVED',
  'RECONCILIATION_REQUIRED',
] as const);

export type MarginRiskContinuityPosture =
  (typeof MARGIN_RISK_CONTINUITY_POSTURES)[number];

export interface MarginRiskRecentEventMarker {
  readonly accountRealmId: string;
  readonly generation: number;
  readonly eventRevision: string;
  /** Sanitized content digest only; never raw private risk/account payload. */
  readonly contentRevision: string;
  readonly eventKind: MarginRiskEventKind;
  readonly exchangeEventTimeMs: number;
  readonly receiptTimeMs: number;
}

export interface MarginRiskLifecycleState extends PrivateLifecycleAuthority {
  readonly schema: typeof MARGIN_RISK_LIFECYCLE_SCHEMA;
  readonly version: typeof MARGIN_RISK_LIFECYCLE_VERSION;
  readonly product: 'MARGIN';
  readonly environment: 'PRODUCTION';
  readonly realm: 'PRIVATE_RISK_DATA';
  readonly purpose: 'CROSS_MARGIN_RISK_ONLY';
  readonly accountRealmId: string;
  /** Deterministic content binding; never an exchange or credential identity. */
  readonly accountRealmBindingRevision: string;
  readonly sourceRevision: typeof BINANCE_CONTRACT_MATRIX_REVISION;
  readonly matrixSha256: typeof BINANCE_CONTRACT_MATRIX_CONTENT_SHA256;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly truthAuthority: 'EVIDENCE_ONLY';
  readonly revision: number;
  /** Documentary lease generation only; it is not a retained credential identity. */
  readonly leaseGeneration: number;
  /** Locally injected connection generation. */
  readonly generation: number;
  readonly phase: MarginRiskLifecyclePhase;
  readonly leaseObservedBy: MarginRiskLeaseContractId | null;
  readonly leaseObservedAtMs: number | null;
  readonly leaseValidUntilMs: number | null;
  /** A deterministic deadline marker, not a timer or scheduling command. */
  readonly renewBeforeMs: number | null;
  readonly routeClass: MarginRiskRouteClass | null;
  readonly routeContractId: MarginRiskRouteContractId | null;
  readonly connected: boolean;
  readonly connectedAtMs: number | null;
  readonly connectionValidUntilMs: number | null;
  /** A deterministic deadline marker, not a timer or reconnect command. */
  readonly reconnectBeforeMs: number | null;
  readonly disconnectedAtMs: number | null;
  readonly lastEvaluatedAtMs: number;
  readonly lastRiskEventKind: MarginRiskEventKind | null;
  readonly lastExchangeEventTimeMs: number | null;
  readonly lastReceiptTimeMs: number | null;
  /** Bounded semantic identities; never evidence of gap-free stream coverage. */
  readonly recentEventMarkers: readonly Readonly<MarginRiskRecentEventMarker>[];
  readonly recentEventRevisions: readonly string[];
  /** Irreversible once an event identity is evicted from the bounded window. */
  readonly dedupeCoverageTruncated: boolean;
  readonly observedEventCount: number;
  readonly duplicateEventCount: number;
  readonly outOfOrderEventCount: number;
  readonly conflictingEventCount: number;
  readonly malformedEventCount: number;
  readonly reconnectCount: number;
  readonly lastContinuityBreakAtMs: number | null;
  readonly continuityPosture: MarginRiskContinuityPosture;
  readonly riskEvidenceCompleteness: 'UNAVAILABLE' | 'PARTIAL_RISK_ONLY';
  readonly accountTradingStreamAvailability: 'UNAVAILABLE_DOCUMENTARY_CONTRACT_INCOMPLETE';
  readonly accountCompleteness: 'UNAVAILABLE_RISK_STREAM_NOT_ACCOUNT_TRUTH';
  readonly orderCompleteness: 'UNAVAILABLE_RISK_STREAM_NOT_ORDER_TRUTH';
  readonly tradeCompleteness: 'UNAVAILABLE_RISK_STREAM_NOT_TRADE_TRUTH';
  readonly liabilityCompleteness: 'UNAVAILABLE_RISK_EVENT_NOT_RECONCILIATION';
  readonly restReconciliationCompleteness: 'UNAVAILABLE';
  readonly sequenceCompleteness: 'UNKNOWN_NO_CONTRACT_SEQUENCE';
  readonly closeDisposition: 'BLOCKED_OFFICIAL_DOC_CONFLICT';
}

export type MarginRiskLifecycleEvent =
  | {
      readonly kind: 'LEASE_POST_OBSERVED';
      readonly accountRealmId: string;
      readonly contractId: typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost;
      readonly leaseGeneration: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'LEASE_PUT_OBSERVED';
      readonly accountRealmId: string;
      readonly contractId: typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut;
      readonly leaseGeneration: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'CONNECTION_OPENED';
      readonly accountRealmId: string;
      readonly contractId: MarginRiskRouteContractId;
      readonly generation: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'RISK_EVENT_OBSERVED';
      readonly accountRealmId: string;
      readonly generation: number;
      readonly eventKind: MarginRiskEventKind;
      readonly exchangeEventTimeMs: number;
      readonly receiptTimeMs: number;
      readonly eventRevision: string;
      readonly contentRevision: string;
    }
  | {
      readonly kind: 'MALFORMED_EVENT_OBSERVED';
      readonly accountRealmId: string;
      readonly generation: number;
      readonly receiptTimeMs: number;
    }
  | {
      readonly kind: 'CONNECTION_CLOSED';
      readonly accountRealmId: string;
      readonly generation: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'DELETE_CLOSE_REQUESTED';
      readonly accountRealmId: string;
      readonly contractId: typeof MARGIN_RISK_DOCUMENTARY_CONTRACTS.closeConflict;
      readonly generation: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'EVALUATED';
      readonly accountRealmId: string;
      readonly evaluatedAtMs: number;
    };

export type MarginRiskLifecycleRejectReason =
  | 'STATE_INVALID'
  | 'EVENT_INVALID'
  | 'ACCOUNT_REALM_MISMATCH'
  | 'TIME_REGRESSION'
  | 'TIME_OVERFLOW'
  | 'LEASE_GENERATION_MISMATCH'
  | 'CONNECTION_GENERATION_MISMATCH'
  | 'LEASE_REQUIRED'
  | 'LEASE_EXPIRED'
  | 'CONNECTION_REQUIRED'
  | 'CONNECTION_EXPIRED'
  | 'ROUTE_CONTRACT_MISMATCH'
  | 'EVENT_TIME_IN_FUTURE'
  | 'COUNTER_LIMIT_REACHED'
  | 'DELETE_CONTRACT_CONFLICT';

export type MarginRiskLifecycleReducerResult =
  | {
      readonly applied: true;
      readonly state: Readonly<MarginRiskLifecycleState>;
    }
  | {
      readonly applied: false;
      readonly state: Readonly<MarginRiskLifecycleState> | null;
      readonly reasonCode: MarginRiskLifecycleRejectReason;
    };

type DataRecord = Readonly<Record<string, unknown>>;

const MAXIMUM_COUNTER = 1_000_000;
const EVENT_REVISION_PATTERN = /^mrisk_[0-9a-f]{32}$/;
const CONTENT_REVISION_PATTERN = /^mrisk_content_[0-9a-f]{32}$/;
const ACCOUNT_REALM_BINDING_REVISION_PATTERN = /^mrealm_[0-9a-f]{32}$/;

const STATE_FIELDS = Object.freeze([
  'schema',
  'version',
  'product',
  'environment',
  'realm',
  'purpose',
  'accountRealmId',
  'accountRealmBindingRevision',
  'sourceRevision',
  'matrixSha256',
  'documentaryAuthority',
  'truthAuthority',
  'revision',
  'leaseGeneration',
  'generation',
  'phase',
  'leaseObservedBy',
  'leaseObservedAtMs',
  'leaseValidUntilMs',
  'renewBeforeMs',
  'routeClass',
  'routeContractId',
  'connected',
  'connectedAtMs',
  'connectionValidUntilMs',
  'reconnectBeforeMs',
  'disconnectedAtMs',
  'lastEvaluatedAtMs',
  'lastRiskEventKind',
  'lastExchangeEventTimeMs',
  'lastReceiptTimeMs',
  'recentEventMarkers',
  'recentEventRevisions',
  'dedupeCoverageTruncated',
  'observedEventCount',
  'duplicateEventCount',
  'outOfOrderEventCount',
  'conflictingEventCount',
  'malformedEventCount',
  'reconnectCount',
  'lastContinuityBreakAtMs',
  'continuityPosture',
  'riskEvidenceCompleteness',
  'accountTradingStreamAvailability',
  'accountCompleteness',
  'orderCompleteness',
  'tradeCompleteness',
  'liabilityCompleteness',
  'restReconciliationCompleteness',
  'sequenceCompleteness',
  'closeDisposition',
  'sendEligible',
  'accountReadAuthority',
  'mutationAuthority',
  'reconciliationAuthority',
  'capitalAuthority',
  'riskAuthority',
  'externalActionAuthorization',
  'actionAuthority',
  'gapFreeSequenceProven',
  'runtimeWired',
] as const);

const EVENT_FIELDS = Object.freeze({
  LEASE_POST_OBSERVED: [
    'kind', 'accountRealmId', 'contractId', 'leaseGeneration', 'observedAtMs',
  ],
  LEASE_PUT_OBSERVED: [
    'kind', 'accountRealmId', 'contractId', 'leaseGeneration', 'observedAtMs',
  ],
  CONNECTION_OPENED: ['kind', 'accountRealmId', 'contractId', 'generation', 'observedAtMs'],
  RISK_EVENT_OBSERVED: [
    'kind', 'accountRealmId', 'generation', 'eventKind', 'exchangeEventTimeMs',
    'receiptTimeMs', 'eventRevision', 'contentRevision',
  ],
  MALFORMED_EVENT_OBSERVED: ['kind', 'accountRealmId', 'generation', 'receiptTimeMs'],
  CONNECTION_CLOSED: ['kind', 'accountRealmId', 'generation', 'observedAtMs'],
  DELETE_CLOSE_REQUESTED: [
    'kind', 'accountRealmId', 'contractId', 'generation', 'observedAtMs',
  ],
  EVALUATED: ['kind', 'accountRealmId', 'evaluatedAtMs'],
} as const);

const EVENT_MARKER_FIELDS = Object.freeze([
  'accountRealmId', 'generation', 'eventRevision', 'contentRevision', 'eventKind',
  'exchangeEventTimeMs', 'receiptTimeMs',
] as const);

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function snapshotDataRecord(value: unknown, maximumFields: number): DataRecord | null {
  try {
    const snapshot = snapshotPrivateData(value);
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
    const keys = Object.keys(snapshot);
    return keys.length <= maximumFields ? snapshot as DataRecord : null;
  } catch {
    return null;
  }
}

function snapshotClosedDataRecord(value: unknown, fields: readonly string[]): DataRecord | null {
  const record = snapshotDataRecord(value, fields.length);
  if (record === null) return null;
  const keys = Object.keys(record);
  return keys.length === fields.length && keys.every((key) => fields.includes(key)) ? record : null;
}

function accountRealmIdOrNull(value: unknown): string | null {
  try {
    return privateAccountRealmReference(value, 'margin risk accountRealmId');
  } catch {
    return null;
  }
}

function accountRealmBindingRevision(accountRealmId: string): string {
  return `mrealm_${createHash('sha256')
    .update(`L05_MARGIN_RISK_ACCOUNT_REALM_BINDING_V1\0${accountRealmId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/** Builds the closed realm-, generation-, sanitized-content-, semantic-, and time-bound identity. */
export function createMarginRiskRealmBoundRevision(
  accountRealmValue: unknown,
  generationValue: unknown,
  eventKindValue: unknown,
  contentRevisionValue: unknown,
  exchangeEventTimeMsValue: unknown,
  receiptTimeMsValue: unknown,
): string {
  const accountRealmId = privateAccountRealmReference(
    accountRealmValue,
    'Margin risk revision accountRealmId',
  );
  if (!isCounter(generationValue) || generationValue < 1
    || !includes(MARGIN_RISK_EVENT_KINDS, eventKindValue)
    || typeof contentRevisionValue !== 'string'
    || !CONTENT_REVISION_PATTERN.test(contentRevisionValue)
    || !isTime(exchangeEventTimeMsValue)
    || !isTime(receiptTimeMsValue)) {
    throw new TypeError('Margin risk revision content is invalid');
  }
  return `mrisk_${createHash('sha256')
    .update([
      'L05_MARGIN_RISK_EVENT_REVISION_V2',
      accountRealmId,
      String(generationValue),
      eventKindValue,
      contentRevisionValue,
      String(exchangeEventTimeMsValue),
      String(receiptTimeMsValue),
    ].join('\0'))
    .digest('hex')
    .slice(0, 32)}`;
}

function contentBoundEventRevision(
  value: unknown,
  accountRealmId: string,
  generation: number,
  eventKind: MarginRiskEventKind,
  contentRevision: string,
  exchangeEventTimeMs: number,
  receiptTimeMs: number,
): value is string {
  return typeof value === 'string' && EVENT_REVISION_PATTERN.test(value)
    && value === createMarginRiskRealmBoundRevision(
      accountRealmId,
      generation,
      eventKind,
      contentRevision,
      exchangeEventTimeMs,
      receiptTimeMs,
    );
}

function snapshotRevisionArray(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS
      || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = new Set<string>(['length']);
    const revisions: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const field = String(index);
      allowed.add(field);
      const descriptor = descriptors[field];
      if (descriptor === undefined || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || typeof descriptor.value !== 'string'
        || !EVENT_REVISION_PATTERN.test(descriptor.value)) return null;
      revisions.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((field) => !allowed.has(field))) return null;
    if (new Set(revisions).size !== revisions.length) return null;
    return Object.freeze(revisions);
  } catch {
    return null;
  }
}

function snapshotEventMarkers(
  value: unknown,
): readonly Readonly<MarginRiskRecentEventMarker>[] | null {
  try {
    if (!Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS
      || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = new Set<string>(['length']);
    const revisions = new Set<string>();
    const markers: MarginRiskRecentEventMarker[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const field = String(index);
      allowed.add(field);
      const descriptor = descriptors[field];
      if (descriptor === undefined || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      const record = snapshotClosedDataRecord(descriptor.value, EVENT_MARKER_FIELDS);
      const accountRealmId = record === null ? null : accountRealmIdOrNull(record.accountRealmId);
      const futureLimit = record === null || !isTime(record.receiptTimeMs)
        ? null : addLifetime(record.receiptTimeMs, MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS);
      if (record === null
        || accountRealmId === null
        || !isCounter(record.generation)
        || record.generation < 1
        || !includes(MARGIN_RISK_EVENT_KINDS, record.eventKind)
        || typeof record.contentRevision !== 'string'
        || !CONTENT_REVISION_PATTERN.test(record.contentRevision)
        || !isTime(record.exchangeEventTimeMs)
        || !isTime(record.receiptTimeMs)
        || !contentBoundEventRevision(
          record.eventRevision,
          accountRealmId,
          record.generation,
          record.eventKind,
          record.contentRevision,
          record.exchangeEventTimeMs,
          record.receiptTimeMs,
        )
        || revisions.has(record.eventRevision)
        || futureLimit === null
        || record.exchangeEventTimeMs > futureLimit) return null;
      revisions.add(record.eventRevision);
      markers.push(Object.freeze({
        accountRealmId,
        generation: record.generation,
        eventRevision: record.eventRevision,
        contentRevision: record.contentRevision,
        eventKind: record.eventKind,
        exchangeEventTimeMs: record.exchangeEventTimeMs,
        receiptTimeMs: record.receiptTimeMs,
      }));
    }
    if (Object.keys(descriptors).some((field) => !allowed.has(field))) return null;
    return Object.freeze(markers);
  } catch {
    return null;
  }
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCounter(value: unknown): value is number {
  return isTime(value) && value <= MAXIMUM_COUNTER;
}

function addLifetime(startMs: number, lifetimeMs: number): number | null {
  const result = startMs + lifetimeMs;
  return Number.isSafeInteger(result) ? result : null;
}

function increment(value: number): number | null {
  return value < MAXIMUM_COUNTER ? value + 1 : null;
}

function routeClassFor(contractId: unknown): MarginRiskRouteClass | null {
  if (contractId === MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute) return 'RAW';
  if (contractId === MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute) return 'COMBINED';
  return null;
}

function routeContractFor(routeClass: MarginRiskRouteClass | null): MarginRiskRouteContractId | null {
  if (routeClass === 'RAW') return MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute;
  if (routeClass === 'COMBINED') return MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute;
  return null;
}

function phaseAt(
  state: Pick<MarginRiskLifecycleState,
  | 'leaseGeneration'
  | 'leaseValidUntilMs'
  | 'connected'
  | 'connectionValidUntilMs'
  | 'disconnectedAtMs'>,
  evaluatedAtMs: number,
): MarginRiskLifecyclePhase {
  if (state.leaseGeneration === 0 || state.leaseValidUntilMs === null) return 'UNCONFIGURED';
  if (evaluatedAtMs > state.leaseValidUntilMs) return 'LEASE_EXPIRED';
  if (state.connectionValidUntilMs !== null
    && evaluatedAtMs >= state.connectionValidUntilMs) return 'CONNECTION_EXPIRED';
  if (state.connected) return 'CONNECTED_RISK_ONLY';
  return state.disconnectedAtMs === null ? 'LEASE_ACTIVE' : 'DISCONNECTED_LEASE_UNRESOLVED';
}

function continuityAt(
  state: Pick<MarginRiskLifecycleState,
  | 'dedupeCoverageTruncated'
  | 'lastContinuityBreakAtMs'>,
): MarginRiskContinuityPosture {
  return state.dedupeCoverageTruncated || state.lastContinuityBreakAtMs !== null
    ? 'RECONCILIATION_REQUIRED'
    : 'UNPROVED';
}

function freezeState(state: MarginRiskLifecycleState): Readonly<MarginRiskLifecycleState> {
  return deepFreezePrivate({
    ...state,
    recentEventMarkers: state.recentEventMarkers.map((marker) => ({ ...marker })),
    recentEventRevisions: [...state.recentEventRevisions],
  });
}

function applied(state: MarginRiskLifecycleState): MarginRiskLifecycleReducerResult {
  const validated = validateMarginRiskLifecycleState(state);
  return validated === null
    ? rejected(null, 'STATE_INVALID')
    : Object.freeze({ applied: true as const, state: validated });
}

function rejected(
  state: Readonly<MarginRiskLifecycleState> | null,
  reasonCode: MarginRiskLifecycleRejectReason,
): MarginRiskLifecycleReducerResult {
  return Object.freeze({ applied: false as const, state, reasonCode });
}

function replayMarginRiskMarkers(
  markers: readonly Readonly<MarginRiskRecentEventMarker>[],
): Readonly<MarginRiskRecentEventMarker> | null {
  let latest: Readonly<MarginRiskRecentEventMarker> | null = null;
  for (const marker of markers) {
    if (latest !== null && marker.exchangeEventTimeMs < latest.exchangeEventTimeMs) continue;
    latest = marker;
  }
  return latest;
}

/** Return a detached canonical lifecycle witness, or null for any invalid state. */
export function validateMarginRiskLifecycleState(
  value: unknown,
): Readonly<MarginRiskLifecycleState> | null {
  const record = snapshotClosedDataRecord(value, STATE_FIELDS);
  if (record === null) return null;
  const accountRealmId = accountRealmIdOrNull(record.accountRealmId);
  if (accountRealmId === null) return null;
  const revisions = snapshotRevisionArray(record.recentEventRevisions);
  const markers = snapshotEventMarkers(record.recentEventMarkers);
  if (revisions === null || markers === null
    || record.schema !== MARGIN_RISK_LIFECYCLE_SCHEMA
    || record.version !== MARGIN_RISK_LIFECYCLE_VERSION
    || record.product !== 'MARGIN'
    || record.environment !== 'PRODUCTION'
    || record.realm !== 'PRIVATE_RISK_DATA'
    || record.purpose !== 'CROSS_MARGIN_RISK_ONLY'
    || typeof record.accountRealmBindingRevision !== 'string'
    || !ACCOUNT_REALM_BINDING_REVISION_PATTERN.test(record.accountRealmBindingRevision)
    || record.accountRealmBindingRevision !== accountRealmBindingRevision(accountRealmId)
    || record.sourceRevision !== BINANCE_CONTRACT_MATRIX_REVISION
    || record.matrixSha256 !== BINANCE_CONTRACT_MATRIX_CONTENT_SHA256
    || record.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || record.truthAuthority !== 'EVIDENCE_ONLY'
    || !isCounter(record.revision)
    || !isCounter(record.leaseGeneration)
    || !isCounter(record.generation)
    || !includes(MARGIN_RISK_LIFECYCLE_PHASES, record.phase)
    || (record.leaseObservedBy !== null
      && record.leaseObservedBy !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost
      && record.leaseObservedBy !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut)
    || (record.routeClass !== null && record.routeClass !== 'RAW' && record.routeClass !== 'COMBINED')
    || (record.routeContractId !== null
      && record.routeContractId !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.rawRoute
      && record.routeContractId !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.combinedRoute)
    || typeof record.connected !== 'boolean'
    || typeof record.dedupeCoverageTruncated !== 'boolean'
    || !isTime(record.lastEvaluatedAtMs)
    || (record.lastRiskEventKind !== null
      && !includes(MARGIN_RISK_EVENT_KINDS, record.lastRiskEventKind))
    || !isCounter(record.observedEventCount)
    || !isCounter(record.duplicateEventCount)
    || !isCounter(record.outOfOrderEventCount)
    || !isCounter(record.conflictingEventCount)
    || !isCounter(record.malformedEventCount)
    || !isCounter(record.reconnectCount)
    || !includes(MARGIN_RISK_CONTINUITY_POSTURES, record.continuityPosture)
    || (record.riskEvidenceCompleteness !== 'UNAVAILABLE'
      && record.riskEvidenceCompleteness !== 'PARTIAL_RISK_ONLY')
    || record.accountTradingStreamAvailability !== 'UNAVAILABLE_DOCUMENTARY_CONTRACT_INCOMPLETE'
    || record.accountCompleteness !== 'UNAVAILABLE_RISK_STREAM_NOT_ACCOUNT_TRUTH'
    || record.orderCompleteness !== 'UNAVAILABLE_RISK_STREAM_NOT_ORDER_TRUTH'
    || record.tradeCompleteness !== 'UNAVAILABLE_RISK_STREAM_NOT_TRADE_TRUTH'
    || record.liabilityCompleteness !== 'UNAVAILABLE_RISK_EVENT_NOT_RECONCILIATION'
    || record.restReconciliationCompleteness !== 'UNAVAILABLE'
    || record.sequenceCompleteness !== 'UNKNOWN_NO_CONTRACT_SEQUENCE'
    || record.closeDisposition !== 'BLOCKED_OFFICIAL_DOC_CONFLICT'
    || record.sendEligible !== false
    || record.accountReadAuthority !== 'NONE'
    || record.mutationAuthority !== 'NONE'
    || record.reconciliationAuthority !== 'NONE'
    || record.capitalAuthority !== 'NONE'
    || record.riskAuthority !== 'NONE'
    || record.externalActionAuthorization !== 'NONE'
    || record.actionAuthority !== 'NONE_RECORD_ONLY'
    || record.gapFreeSequenceProven !== false
    || record.runtimeWired !== false) return null;

  const nullableTimes = [
    record.leaseObservedAtMs,
    record.leaseValidUntilMs,
    record.renewBeforeMs,
    record.connectedAtMs,
    record.connectionValidUntilMs,
    record.reconnectBeforeMs,
    record.disconnectedAtMs,
    record.lastExchangeEventTimeMs,
    record.lastReceiptTimeMs,
    record.lastContinuityBreakAtMs,
  ];
  if (nullableTimes.some((time) => time !== null && !isTime(time))) return null;

  const leaseEmpty = record.leaseGeneration === 0;
  if (leaseEmpty !== (record.leaseObservedBy === null
    && record.leaseObservedAtMs === null
    && record.leaseValidUntilMs === null
    && record.renewBeforeMs === null)) return null;
  if (leaseEmpty && (record.generation !== 0 || record.routeClass !== null
    || record.lastRiskEventKind !== null || revisions.length !== 0 || markers.length !== 0
    || record.dedupeCoverageTruncated || record.observedEventCount !== 0
    || record.duplicateEventCount !== 0 || record.outOfOrderEventCount !== 0
    || record.conflictingEventCount !== 0 || record.malformedEventCount !== 0
    || record.reconnectCount !== 0 || record.lastContinuityBreakAtMs !== null
    || record.continuityPosture !== 'UNPROVED')) return null;
  if (!leaseEmpty) {
    if (!isTime(record.leaseObservedAtMs) || !isTime(record.leaseValidUntilMs)
      || !isTime(record.renewBeforeMs)
      || addLifetime(record.leaseObservedAtMs, MARGIN_RISK_LEASE_LIFETIME_MS)
        !== record.leaseValidUntilMs
      || record.renewBeforeMs !== record.leaseValidUntilMs - 1) return null;
  }

  if (record.routeContractId !== routeContractFor(record.routeClass)) return null;
  if (record.routeClass === null) {
    if (record.connected || record.connectedAtMs !== null
      || record.connectionValidUntilMs !== null || record.reconnectBeforeMs !== null
      || record.disconnectedAtMs !== null || record.lastRiskEventKind !== null
      || record.lastExchangeEventTimeMs !== null || record.lastReceiptTimeMs !== null
      || revisions.length !== 0 || markers.length !== 0) return null;
  } else if (record.generation === 0 || !isTime(record.connectedAtMs)
    || !isTime(record.connectionValidUntilMs) || !isTime(record.reconnectBeforeMs)
    || addLifetime(record.connectedAtMs, MARGIN_RISK_CONNECTION_LIFETIME_MS)
      !== record.connectionValidUntilMs
    || record.reconnectBeforeMs !== record.connectionValidUntilMs - 1) return null;
  if (record.connected && record.disconnectedAtMs !== null) return null;
  const connectedLeaseValidUntilMs = record.leaseValidUntilMs;
  if (record.connected && (!isTime(connectedLeaseValidUntilMs)
    || (record.lastEvaluatedAtMs as number) > connectedLeaseValidUntilMs
    || record.phase !== 'CONNECTED_RISK_ONLY')) return null;
  if (record.connected && record.connectionValidUntilMs !== null
    && record.lastEvaluatedAtMs >= record.connectionValidUntilMs) return null;
  if (record.connectedAtMs !== null && record.disconnectedAtMs !== null
    && (!isTime(record.connectedAtMs) || !isTime(record.disconnectedAtMs)
      || record.disconnectedAtMs < record.connectedAtMs)) return null;

  const lastEventEmpty = record.lastRiskEventKind === null;
  if (lastEventEmpty !== (record.lastExchangeEventTimeMs === null && record.lastReceiptTimeMs === null)) {
    return null;
  }
  if (lastEventEmpty !== (record.riskEvidenceCompleteness === 'UNAVAILABLE')) return null;
  if (!lastEventEmpty && record.riskEvidenceCompleteness !== 'PARTIAL_RISK_ONLY') return null;
  if (record.lastExchangeEventTimeMs !== null && record.lastReceiptTimeMs !== null) {
    if (!isTime(record.lastExchangeEventTimeMs) || !isTime(record.lastReceiptTimeMs)
      || record.lastExchangeEventTimeMs
        > record.lastReceiptTimeMs + MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS) return null;
  }
  const markerFutureLimit = addLifetime(
    record.lastEvaluatedAtMs as number,
    MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS,
  );
  if (markerFutureLimit !== null
    && markers.some((marker) => marker.exchangeEventTimeMs > markerFutureLimit)) return null;
  const acceptedTimes = [
    record.leaseObservedAtMs,
    record.connectedAtMs,
    record.disconnectedAtMs,
    record.lastReceiptTimeMs,
    record.lastContinuityBreakAtMs,
  ].filter((time): time is number => time !== null);
  if (acceptedTimes.some((time) => time > (record.lastEvaluatedAtMs as number))) return null;
  if (record.observedEventCount < revisions.length
    || markers.length !== revisions.length
    || markers.some((marker) => marker.accountRealmId !== accountRealmId)
    || markers.some((marker) => marker.generation !== record.generation)
    || markers.some((marker, index) => marker.eventRevision !== revisions[index])
    || (record.connectedAtMs !== null
      && markers.some((marker) => marker.receiptTimeMs < (record.connectedAtMs as number)))
    || markers.some((marker, index) => index > 0
      && marker.receiptTimeMs
        < (markers[index - 1] as Readonly<MarginRiskRecentEventMarker>).receiptTimeMs)
    || record.duplicateEventCount > record.observedEventCount
    || record.outOfOrderEventCount > record.observedEventCount
    || record.conflictingEventCount > record.observedEventCount
    || (record.duplicateEventCount as number)
      + (record.outOfOrderEventCount as number)
      + (record.conflictingEventCount as number) > (record.observedEventCount as number)
    || (!record.dedupeCoverageTruncated
      && (record.malformedEventCount > 0
        || record.observedEventCount !== markers.length
          + (record.duplicateEventCount as number) + (record.conflictingEventCount as number)
        || record.observedEventCount > MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS
        || markers.length >= MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS))) return null;
  if (!record.dedupeCoverageTruncated) {
    const latest = replayMarginRiskMarkers(markers);
    if ((latest === null) !== lastEventEmpty
      || (latest !== null && (record.lastRiskEventKind !== latest.eventKind
        || record.lastExchangeEventTimeMs !== latest.exchangeEventTimeMs
        || record.lastReceiptTimeMs !== latest.receiptTimeMs))) return null;
  }
  const continuityBreakObserved = record.dedupeCoverageTruncated
    || (record.outOfOrderEventCount as number) > 0
    || (record.conflictingEventCount as number) > 0
    || (record.malformedEventCount as number) > 0
    || (record.reconnectCount as number) > 0
    || record.disconnectedAtMs !== null
    || ((record.generation as number) > 0 && record.routeClass === null);
  if (continuityBreakObserved !== (record.lastContinuityBreakAtMs !== null)
    || record.continuityPosture !== continuityAt({
      dedupeCoverageTruncated: record.dedupeCoverageTruncated,
      lastContinuityBreakAtMs: record.lastContinuityBreakAtMs as number | null,
    })) return null;
  if (record.phase !== phaseAt(
    record as unknown as MarginRiskLifecycleState,
    record.lastEvaluatedAtMs as number,
  )) {
    return null;
  }

  return freezeState({
    ...(record as unknown as MarginRiskLifecycleState),
    accountRealmId,
    recentEventMarkers: markers,
    recentEventRevisions: revisions,
  });
}

function validateEvent(value: unknown): DataRecord | null {
  const outer = snapshotDataRecord(value, 9);
  if (outer === null || typeof outer.kind !== 'string'
    || !Object.prototype.hasOwnProperty.call(EVENT_FIELDS, outer.kind)) return null;
  return snapshotClosedDataRecord(value, EVENT_FIELDS[outer.kind as keyof typeof EVENT_FIELDS]);
}

function withEvaluation(
  state: Readonly<MarginRiskLifecycleState>,
  evaluatedAtMs: number,
  patch: Partial<MarginRiskLifecycleState>,
): MarginRiskLifecycleState | null {
  const revision = increment(state.revision);
  if (revision === null) return null;
  const candidate = {
    ...state,
    ...patch,
    revision,
    lastEvaluatedAtMs: evaluatedAtMs,
  } as MarginRiskLifecycleState;
  const normalized = {
    ...candidate,
    connected: candidate.connected
      && candidate.leaseValidUntilMs !== null
      && evaluatedAtMs <= candidate.leaseValidUntilMs
      && candidate.connectionValidUntilMs !== null
      && evaluatedAtMs < candidate.connectionValidUntilMs,
  } as MarginRiskLifecycleState;
  const evaluated = {
    ...normalized,
    phase: phaseAt(normalized, evaluatedAtMs),
  };
  return {
    ...evaluated,
    continuityPosture: continuityAt(evaluated),
  };
}

/** Create an inert Cross Margin risk-only lifecycle state. */
export function createInitialMarginRiskLifecycleState(
  evaluatedAtMs = 0,
  accountRealmId = MARGIN_RISK_DEFAULT_ACCOUNT_REALM_ID,
): Readonly<MarginRiskLifecycleState> {
  if (!isTime(evaluatedAtMs)) throw new TypeError('Margin risk evaluation time must be a safe integer');
  const canonicalAccountRealmId = privateAccountRealmReference(
    accountRealmId,
    'margin risk accountRealmId',
  );
  return freezeState({
    schema: MARGIN_RISK_LIFECYCLE_SCHEMA,
    version: MARGIN_RISK_LIFECYCLE_VERSION,
    product: 'MARGIN',
    environment: 'PRODUCTION',
    realm: 'PRIVATE_RISK_DATA',
    purpose: 'CROSS_MARGIN_RISK_ONLY',
    accountRealmId: canonicalAccountRealmId,
    accountRealmBindingRevision: accountRealmBindingRevision(canonicalAccountRealmId),
    sourceRevision: BINANCE_CONTRACT_MATRIX_REVISION,
    matrixSha256: BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    truthAuthority: 'EVIDENCE_ONLY',
    revision: 0,
    leaseGeneration: 0,
    generation: 0,
    phase: 'UNCONFIGURED',
    leaseObservedBy: null,
    leaseObservedAtMs: null,
    leaseValidUntilMs: null,
    renewBeforeMs: null,
    routeClass: null,
    routeContractId: null,
    connected: false,
    connectedAtMs: null,
    connectionValidUntilMs: null,
    reconnectBeforeMs: null,
    disconnectedAtMs: null,
    lastEvaluatedAtMs: evaluatedAtMs,
    lastRiskEventKind: null,
    lastExchangeEventTimeMs: null,
    lastReceiptTimeMs: null,
    recentEventMarkers: Object.freeze([]),
    recentEventRevisions: Object.freeze([]),
    dedupeCoverageTruncated: false,
    observedEventCount: 0,
    duplicateEventCount: 0,
    outOfOrderEventCount: 0,
    conflictingEventCount: 0,
    malformedEventCount: 0,
    reconnectCount: 0,
    lastContinuityBreakAtMs: null,
    continuityPosture: 'UNPROVED',
    riskEvidenceCompleteness: 'UNAVAILABLE',
    accountTradingStreamAvailability: 'UNAVAILABLE_DOCUMENTARY_CONTRACT_INCOMPLETE',
    accountCompleteness: 'UNAVAILABLE_RISK_STREAM_NOT_ACCOUNT_TRUTH',
    orderCompleteness: 'UNAVAILABLE_RISK_STREAM_NOT_ORDER_TRUTH',
    tradeCompleteness: 'UNAVAILABLE_RISK_STREAM_NOT_TRADE_TRUTH',
    liabilityCompleteness: 'UNAVAILABLE_RISK_EVENT_NOT_RECONCILIATION',
    restReconciliationCompleteness: 'UNAVAILABLE',
    sequenceCompleteness: 'UNKNOWN_NO_CONTRACT_SEQUENCE',
    closeDisposition: 'BLOCKED_OFFICIAL_DOC_CONFLICT',
    ...PRIVATE_LIFECYCLE_AUTHORITY,
  });
}

/** Backwards-compatible local spelling; both constructors return the same inert state. */
export const createMarginRiskLifecycleState = createInitialMarginRiskLifecycleState;

/**
 * Apply one injected observation. Rejections never infer transport or account
 * state, and the conflicted DELETE contract can never invalidate the lease.
 */
export function reduceMarginRiskLifecycle(
  stateValue: unknown,
  eventValue: unknown,
): MarginRiskLifecycleReducerResult {
  const state = validateMarginRiskLifecycleState(stateValue);
  if (state === null) return rejected(null, 'STATE_INVALID');
  const event = validateEvent(eventValue);
  if (event === null) return rejected(state, 'EVENT_INVALID');
  const eventAccountRealmId = accountRealmIdOrNull(event.accountRealmId);
  if (eventAccountRealmId === null) return rejected(state, 'EVENT_INVALID');
  if (eventAccountRealmId !== state.accountRealmId) {
    return rejected(state, 'ACCOUNT_REALM_MISMATCH');
  }

  const eventTime = event.kind === 'RISK_EVENT_OBSERVED'
    || event.kind === 'MALFORMED_EVENT_OBSERVED'
    ? event.receiptTimeMs
    : event.kind === 'EVALUATED'
      ? event.evaluatedAtMs
      : event.observedAtMs;
  if (!isTime(eventTime)) return rejected(state, 'EVENT_INVALID');
  if (eventTime < state.lastEvaluatedAtMs) return rejected(state, 'TIME_REGRESSION');

  if (event.kind === 'EVALUATED') {
    const next = withEvaluation(state, eventTime, {
      connected: state.connected
        && state.leaseValidUntilMs !== null
        && eventTime <= state.leaseValidUntilMs
        && state.connectionValidUntilMs !== null
        && eventTime < state.connectionValidUntilMs,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (event.kind === 'DELETE_CLOSE_REQUESTED') {
    if (event.contractId !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.closeConflict
      || !isCounter(event.generation)) return rejected(state, 'EVENT_INVALID');
    if (event.generation !== state.generation) {
      return rejected(state, 'CONNECTION_GENERATION_MISMATCH');
    }
    return rejected(state, 'DELETE_CONTRACT_CONFLICT');
  }

  if (event.kind === 'LEASE_POST_OBSERVED') {
    if (event.contractId !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost
      || !isCounter(event.leaseGeneration) || event.leaseGeneration < 1) {
      return rejected(state, 'EVENT_INVALID');
    }
    const leaseActive = state.leaseValidUntilMs !== null && eventTime <= state.leaseValidUntilMs;
    const expectedGeneration = leaseActive
      ? state.leaseGeneration
      : state.leaseGeneration + 1;
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration > MAXIMUM_COUNTER) {
      return rejected(state, 'COUNTER_LIMIT_REACHED');
    }
    if (event.leaseGeneration !== expectedGeneration) {
      return rejected(state, 'LEASE_GENERATION_MISMATCH');
    }
    const validUntil = addLifetime(eventTime, MARGIN_RISK_LEASE_LIFETIME_MS);
    if (validUntil === null) return rejected(state, 'TIME_OVERFLOW');
    const leaseChanged = event.leaseGeneration !== state.leaseGeneration;
    const next = withEvaluation(state, eventTime, {
      leaseGeneration: event.leaseGeneration,
      leaseObservedBy: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePost,
      leaseObservedAtMs: eventTime,
      leaseValidUntilMs: validUntil,
      renewBeforeMs: validUntil - 1,
      ...(leaseChanged ? {
        connected: false,
        routeClass: null,
        routeContractId: null,
        connectedAtMs: null,
        connectionValidUntilMs: null,
        reconnectBeforeMs: null,
        disconnectedAtMs: null,
        lastRiskEventKind: null,
        lastExchangeEventTimeMs: null,
        lastReceiptTimeMs: null,
        recentEventMarkers: Object.freeze([]),
        recentEventRevisions: Object.freeze([]),
        dedupeCoverageTruncated: state.dedupeCoverageTruncated
          || state.recentEventMarkers.length > 0,
        lastContinuityBreakAtMs: state.generation === 0
          ? state.lastContinuityBreakAtMs : eventTime,
        riskEvidenceCompleteness: 'UNAVAILABLE',
      } : {}),
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (event.kind === 'LEASE_PUT_OBSERVED') {
    if (event.contractId !== MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut
      || !isCounter(event.leaseGeneration) || event.leaseGeneration < 1) {
      return rejected(state, 'EVENT_INVALID');
    }
    if (event.leaseGeneration !== state.leaseGeneration) {
      return rejected(state, 'LEASE_GENERATION_MISMATCH');
    }
    if (state.leaseValidUntilMs === null) return rejected(state, 'LEASE_REQUIRED');
    if (eventTime > state.leaseValidUntilMs) return rejected(state, 'LEASE_EXPIRED');
    const validUntil = addLifetime(eventTime, MARGIN_RISK_LEASE_LIFETIME_MS);
    if (validUntil === null) return rejected(state, 'TIME_OVERFLOW');
    const next = withEvaluation(state, eventTime, {
      leaseObservedBy: MARGIN_RISK_DOCUMENTARY_CONTRACTS.leasePut,
      leaseObservedAtMs: eventTime,
      leaseValidUntilMs: validUntil,
      renewBeforeMs: validUntil - 1,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (event.kind === 'CONNECTION_OPENED') {
    const routeClass = routeClassFor(event.contractId);
    if (routeClass === null || !isCounter(event.generation) || event.generation < 1) {
      return rejected(state, routeClass === null ? 'ROUTE_CONTRACT_MISMATCH' : 'EVENT_INVALID');
    }
    if (state.leaseValidUntilMs === null) return rejected(state, 'LEASE_REQUIRED');
    if (eventTime > state.leaseValidUntilMs) return rejected(state, 'LEASE_EXPIRED');
    if (event.generation !== state.generation + 1) {
      return rejected(state, 'CONNECTION_GENERATION_MISMATCH');
    }
    const validUntil = addLifetime(eventTime, MARGIN_RISK_CONNECTION_LIFETIME_MS);
    if (validUntil === null) return rejected(state, 'TIME_OVERFLOW');
    const reconnectCount = state.generation === 0 ? state.reconnectCount : increment(state.reconnectCount);
    if (reconnectCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, eventTime, {
      generation: event.generation,
      routeClass,
      routeContractId: event.contractId as MarginRiskRouteContractId,
      connected: true,
      connectedAtMs: eventTime,
      connectionValidUntilMs: validUntil,
      reconnectBeforeMs: validUntil - 1,
      disconnectedAtMs: null,
      lastRiskEventKind: null,
      lastExchangeEventTimeMs: null,
      lastReceiptTimeMs: null,
      recentEventMarkers: Object.freeze([]),
      recentEventRevisions: Object.freeze([]),
      dedupeCoverageTruncated: state.dedupeCoverageTruncated
        || state.recentEventMarkers.length > 0,
      lastContinuityBreakAtMs: state.generation === 0
        ? state.lastContinuityBreakAtMs : eventTime,
      riskEvidenceCompleteness: 'UNAVAILABLE',
      reconnectCount,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (!isCounter(event.generation) || event.generation !== state.generation) {
    return rejected(state, 'CONNECTION_GENERATION_MISMATCH');
  }
  if (!state.connected || state.connectedAtMs === null || state.connectionValidUntilMs === null) {
    return rejected(state, 'CONNECTION_REQUIRED');
  }
  if (event.kind === 'CONNECTION_CLOSED') {
    const next = withEvaluation(state, eventTime, {
      connected: false,
      disconnectedAtMs: eventTime,
      lastContinuityBreakAtMs: eventTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }
  if (state.leaseValidUntilMs === null || eventTime > state.leaseValidUntilMs) {
    return rejected(state, 'LEASE_EXPIRED');
  }
  if (eventTime >= state.connectionValidUntilMs) return rejected(state, 'CONNECTION_EXPIRED');

  if (event.kind === 'MALFORMED_EVENT_OBSERVED') {
    const malformedEventCount = increment(state.malformedEventCount);
    if (malformedEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, eventTime, {
      malformedEventCount,
      dedupeCoverageTruncated: true,
      lastContinuityBreakAtMs: eventTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (event.kind !== 'RISK_EVENT_OBSERVED'
    || !includes(MARGIN_RISK_EVENT_KINDS, event.eventKind)
    || typeof event.contentRevision !== 'string'
    || !CONTENT_REVISION_PATTERN.test(event.contentRevision)
    || !isTime(event.exchangeEventTimeMs)
    || !contentBoundEventRevision(
      event.eventRevision,
      state.accountRealmId,
      state.generation,
      event.eventKind,
      event.contentRevision,
      event.exchangeEventTimeMs,
      eventTime,
    )) {
    return rejected(state, 'EVENT_INVALID');
  }
  if (event.exchangeEventTimeMs > eventTime + MARGIN_RISK_MAXIMUM_FUTURE_SKEW_MS) {
    return rejected(state, 'EVENT_TIME_IN_FUTURE');
  }
  const observedEventCount = increment(state.observedEventCount);
  if (observedEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
  const existingMarker = state.recentEventMarkers.find((marker) =>
    marker.eventRevision === event.eventRevision
      || (marker.eventKind === event.eventKind
        && marker.exchangeEventTimeMs === event.exchangeEventTimeMs
        && marker.receiptTimeMs === eventTime));
  if (existingMarker !== undefined) {
    const exactDuplicate = existingMarker.eventRevision === event.eventRevision
      && existingMarker.contentRevision === event.contentRevision
      && existingMarker.eventKind === event.eventKind
      && existingMarker.exchangeEventTimeMs === event.exchangeEventTimeMs
      && existingMarker.receiptTimeMs === eventTime;
    if (!exactDuplicate) {
      const conflictingEventCount = increment(state.conflictingEventCount);
      if (conflictingEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
      const next = withEvaluation(state, eventTime, {
        observedEventCount,
        conflictingEventCount,
        ...(observedEventCount > MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS ? {
          dedupeCoverageTruncated: true,
        } : {}),
        lastContinuityBreakAtMs: eventTime,
      });
      return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
    }
    const duplicateEventCount = increment(state.duplicateEventCount);
    if (duplicateEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const coverageWillTruncate = observedEventCount
      > MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS;
    const next = withEvaluation(state, eventTime, {
      observedEventCount,
      duplicateEventCount,
      ...(coverageWillTruncate ? {
        dedupeCoverageTruncated: true,
        lastContinuityBreakAtMs: eventTime,
      } : {}),
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  const coverageWillTruncate = state.recentEventMarkers.length
    >= MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS - 1;
  const recentEventMarkers = Object.freeze([
    ...state.recentEventMarkers,
    Object.freeze({
      accountRealmId: state.accountRealmId,
      generation: state.generation,
      eventRevision: event.eventRevision,
      contentRevision: event.contentRevision,
      eventKind: event.eventKind,
      exchangeEventTimeMs: event.exchangeEventTimeMs,
      receiptTimeMs: eventTime,
    }),
  ].slice(-MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS));
  const recentEventRevisions = Object.freeze([
    ...state.recentEventRevisions,
    event.eventRevision,
  ].slice(-MARGIN_RISK_MAXIMUM_RECENT_EVENT_REVISIONS));
  if (state.lastExchangeEventTimeMs !== null
    && event.exchangeEventTimeMs < state.lastExchangeEventTimeMs) {
    const outOfOrderEventCount = increment(state.outOfOrderEventCount);
    if (outOfOrderEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, eventTime, {
      observedEventCount,
      outOfOrderEventCount,
      recentEventMarkers,
      recentEventRevisions,
      dedupeCoverageTruncated: state.dedupeCoverageTruncated || coverageWillTruncate,
      lastContinuityBreakAtMs: eventTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  const next = withEvaluation(state, eventTime, {
    observedEventCount,
    recentEventMarkers,
    recentEventRevisions,
    dedupeCoverageTruncated: state.dedupeCoverageTruncated || coverageWillTruncate,
    lastRiskEventKind: event.eventKind,
    lastExchangeEventTimeMs: event.exchangeEventTimeMs,
    lastReceiptTimeMs: eventTime,
    riskEvidenceCompleteness: 'PARTIAL_RISK_ONLY',
    ...(coverageWillTruncate ? { lastContinuityBreakAtMs: eventTime } : {}),
  });
  return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
}
